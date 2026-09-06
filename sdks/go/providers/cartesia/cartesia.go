// Package cartesia implements its authored protocol, not its partial wire schemas.
package cartesia

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/cartesia"
	out "github.com/speechswitch/client/sdks/go/generated/cartesia_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

const version = "2026-08-14"

type Options struct {
	Auth auth.Auth
	// Nil selects native HTTP/WebSockets. Overrides must honor cancellation.
	Transport             runtime.HTTPTransport
	WebSocket             runtime.WebSocketLike
	BaseURL, WebSocketURL string
	// Zero selects 4 MiB messages/events and 1 MiB JSON/error bodies.
	MaxMessageBytes, MaxEventBytes, MaxJSONBytes int
}

// Synthesize streams audio and native timeline/control envelopes. Always Close,
// even if unread. The context deadline covers token exchange, connection and all
// input/output waits; successful live calls transfer ownership of the input.
func Synthesize(ctx context.Context, request schema.TtsRequest, options Options) (runtime.Input[out.SynthesisItem], error) {
	validate, err := schema.ValidateRequest(request)
	if err != nil {
		return nil, err
	}
	wire, err := settings(request)
	if err != nil {
		return nil, err
	}
	maxMessage, maxEvent, maxJSON := options.MaxMessageBytes, options.MaxEventBytes, options.MaxJSONBytes
	if maxMessage == 0 {
		maxMessage = 4 * 1024 * 1024
	}
	if maxEvent == 0 {
		maxEvent = 4 * 1024 * 1024
	}
	if maxJSON == 0 {
		maxJSON = 1024 * 1024
	}
	if maxMessage < 0 || maxEvent < 0 || maxJSON < 0 {
		return nil, errors.New("Cartesia byte limits must be positive")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	key, token := environment("API_KEY"), environment("ACCESS_TOKEN")
	if options.Auth.Cartesia.Present {
		if options.Auth.Cartesia.Value.ApiKey.Present {
			key = options.Auth.Cartesia.Value.ApiKey
		}
		if options.Auth.Cartesia.Value.AccessToken.Present {
			token = options.Auth.Cartesia.Value.AccessToken
		}
	}
	transport := options.Transport
	if transport == nil {
		transport = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	base := options.BaseURL
	if base == "" {
		base = "https://api.cartesia.ai"
	}
	if wire.input == nil {
		credential := token.Value
		if key.Present {
			credential = key.Value
		}
		if credential == "" {
			return nil, errors.New("Missing auth.cartesia.apiKey or auth.cartesia.accessToken configuration")
		}
		contextID, err := contextID()
		if err != nil {
			return nil, err
		}
		payload := maps.Clone(wire.wire)
		payload["transcript"] = wire.text
		path := "/tts/bytes"
		if wire.timed {
			path = "/tts/sse"
			payload["context_id"] = contextID
		}
		response, err := sendHTTP(ctx, transport, base, path, credential, payload)
		if err != nil {
			return nil, err
		}
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			defer response.Body.Close()
			return nil, httpError(ctx, response, maxJSON)
		}
		decoder, err := runtime.NewSSEDecoder(maxEvent)
		if err != nil {
			response.Body.Close()
			return nil, err
		}
		return &httpStream{ctx: ctx, body: response.Body, decoder: decoder, contextID: contextID, timed: wire.timed}, nil
	}
	socket := options.WebSocket
	if socket == nil {
		access := token.Value
		if access == "" {
			if key.Value == "" {
				return nil, errors.New("Missing auth.cartesia.apiKey or auth.cartesia.accessToken configuration")
			}
			response, err := sendHTTP(ctx, transport, base, "/access-token", key.Value, map[string]any{"grants": map[string]any{"tts": true}, "expires_in": 60})
			if err != nil {
				return nil, err
			}
			access, err = accessToken(ctx, response, maxJSON)
			if err != nil {
				return nil, err
			}
		}
		target := options.WebSocketURL
		if target == "" {
			target = "wss://api.cartesia.ai/tts/websocket"
		}
		address, err := url.Parse(target)
		if err != nil {
			return nil, errors.New("Invalid Cartesia WebSocket URL")
		}
		query, err := url.ParseQuery(address.RawQuery)
		if err != nil {
			return nil, errors.New("Invalid Cartesia WebSocket query")
		}
		query.Del("api_key")
		query.Set("access_token", access)
		query.Set("cartesia_version", version)
		address.RawQuery = query.Encode()
		socket, err = runtime.ConnectWebSocket(ctx, address.String(), runtime.WebSocketOptions{Transport: options.Transport, MaxMessageBytes: maxMessage})
		if err != nil {
			return nil, err
		}
	}
	if err := ctx.Err(); err != nil {
		socket.Close()
		return nil, err
	}
	id, err := contextID()
	if err != nil {
		socket.Close()
		return nil, err
	}
	operation, cancel := context.WithCancel(ctx)
	stream := &socketStream{ctx: operation, cancel: cancel, socket: socket, wire: wire, validate: validate, maxMessage: maxMessage, contextID: id, retired: map[string]bool{}, preferOutput: true}
	stream.stop = context.AfterFunc(operation, func() { stream.closeResources() })
	return stream, nil
}

func environment(name string) runtime.Optional[string] {
	if value, present := os.LookupEnv("SPEECHSWITCH_CARTESIA_" + name); present {
		return runtime.Some(value)
	}
	if value, present := os.LookupEnv("CARTESIA_" + name); present {
		return runtime.Some(value)
	}
	return runtime.Optional[string]{}
}

func contextID() (string, error) {
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return "", err
	}
	id[6], id[8] = id[6]&15|64, id[8]&63|128
	return fmt.Sprintf("%x-%x-%x-%x-%x", id[:4], id[4:6], id[6:8], id[8:10], id[10:]), nil
}

func sendHTTP(ctx context.Context, transport runtime.HTTPTransport, base, path, credential string, value map[string]any) (*runtime.HTTPResponse, error) {
	address, err := url.Parse(base)
	if err != nil || address.Hostname() == "" || address.User != nil || address.Fragment != "" || address.Opaque != "" || (address.Scheme != "https" && address.Scheme != "http") || strings.ContainsAny(base, "\\\r\n\t ") {
		return nil, errors.New("Cartesia BaseURL must be an HTTP(S) URL without credentials or a fragment")
	}
	escaped := strings.TrimRight(address.EscapedPath(), "/") + path
	address.Path, err = url.PathUnescape(escaped)
	if err != nil {
		return nil, errors.New("Invalid Cartesia HTTP path")
	}
	address.RawPath = escaped
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, "POST", address.String(), bytes.NewReader(encoded))
	if err != nil {
		return nil, err
	}
	request.Header.Set("authorization", "Bearer "+credential)
	request.Header.Set("cartesia-version", version)
	request.Header.Set("content-type", "application/json")
	response, err := runtime.OpenResponse(request, transport)
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		response.Body.Close()
		return nil, err
	}
	return response, nil
}

func responseText(ctx context.Context, body runtime.Input[[]byte], limit int) (string, error) {
	var data []byte
	for {
		chunk, err := body.Next(ctx)
		if err == io.EOF {
			return strings.TrimPrefix(runtime.DecodeUTF8(data), "\uFEFF"), nil
		}
		if err != nil {
			return "", err
		}
		if len(chunk) > limit-len(data) {
			return "", errors.New("Cartesia response exceeds MaxJSONBytes")
		}
		data = append(data, chunk...)
	}
}

func httpError(ctx context.Context, response *runtime.HTTPResponse, limit int) error {
	text, err := responseText(ctx, response.Body, limit)
	if err != nil {
		return err
	}
	value, err := load([]byte(text))
	if err != nil {
		value = text
	}
	return responseError(value, float64(response.StatusCode))
}

func accessToken(ctx context.Context, response *runtime.HTTPResponse, limit int) (string, error) {
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", httpError(ctx, response, limit)
	}
	text, err := responseText(ctx, response.Body, limit)
	if err != nil {
		return "", err
	}
	value, err := load([]byte(text))
	if err != nil {
		return "", err
	}
	fields, ok := value.(map[string]any)
	token, tokenOK := fields["token"].(string)
	if !ok || !tokenOK || token == "" {
		return "", errors.New("Cartesia returned an invalid access token")
	}
	return token, nil
}
