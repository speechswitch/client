// Package async implements Async's HTTP and incremental WebSocket protocols.
// The cataloged OpenAPI export is incomplete; request/output types and validators
// are generated from schemas/, while the wire protocol is authored here.
package async

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"strings"

	schema "github.com/speechswitch/client/sdks/go/generated/async_"
	out "github.com/speechswitch/client/sdks/go/generated/async_output"
	"github.com/speechswitch/client/sdks/go/generated/auth"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type Options struct {
	Auth auth.Auth
	// Nil uses native HTTP, with redirects disabled. Overrides must honor
	// cancellation and must not forward credentials to redirect destinations.
	// For native WebSockets, an override must also support duplex 101 responses.
	Transport    runtime.HTTPTransport
	WebSocket    runtime.WebSocketLike
	BaseURL      string
	WebSocketURL string
	// Zero selects 16 MiB per JSON/error body and 4 MiB per WebSocket message.
	MaxJSONBytes    int
	MaxMessageBytes int
}

// Synthesize opens one owned stream. Defer Close, including when never reading.
// Successful incremental calls transfer ownership of the input and socket;
// inputs must honor cancellation and Close must unblock pending Next calls.
func Synthesize(ctx context.Context, request schema.TtsRequest, options Options) (runtime.Input[out.SynthesisItem], error) {
	validate, err := schema.ValidateRequest(request)
	if err != nil {
		return nil, err
	}
	wire, err := settings(request)
	if err != nil {
		return nil, err
	}
	var key string
	if options.Auth.Async.Present && options.Auth.Async.Value.ApiKey.Present {
		key = options.Auth.Async.Value.ApiKey.Value
	} else if scoped, present := os.LookupEnv("SPEECHSWITCH_ASYNC_API_KEY"); present {
		key = scoped
	} else {
		key = os.Getenv("ASYNC_API_KEY")
	}
	if key == "" {
		return nil, errors.New("Missing auth.async.apiKey configuration")
	}
	maxJSON, maxMessage := options.MaxJSONBytes, options.MaxMessageBytes
	if maxJSON == 0 {
		maxJSON = 16 * 1024 * 1024
	}
	if maxMessage == 0 {
		maxMessage = 4 * 1024 * 1024
	}
	if maxJSON < 0 || maxMessage < 0 {
		return nil, errors.New("Async byte limits must be positive")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(ctx)
	if wire.input != nil {
		socket := options.WebSocket
		if socket == nil {
			address := options.WebSocketURL
			if address == "" {
				address = "wss://api.async.com/text_to_speech/websocket/ws"
			}
			target, err := url.Parse(address)
			if err != nil {
				cancel()
				return nil, errors.New("Invalid Async WebSocketURL")
			}
			query, err := url.ParseQuery(target.RawQuery)
			if err != nil {
				cancel()
				return nil, errors.New("Invalid Async WebSocketURL query")
			}
			query.Set("api_key", key)
			query.Set("version", "v1")
			target.RawQuery = query.Encode()
			socket, err = runtime.ConnectWebSocket(ctx, target.String(), runtime.WebSocketOptions{Transport: options.Transport, MaxMessageBytes: maxMessage})
			if err != nil {
				cancel()
				return nil, err
			}
		}
		if err := ctx.Err(); err != nil {
			cancel()
			socket.Close()
			return nil, err
		}
		stream := &socketStream{ctx: ctx, cancel: cancel, socket: socket, wire: wire, validate: validate, maxMessage: maxMessage}
		stream.stop = context.AfterFunc(ctx, func() { stream.closeResources() })
		return stream, nil
	}
	path := "/text_to_speech/streaming"
	if wire.timed {
		path = "/text_to_speech/with_timestamps"
	} else if wire.format == "wav" {
		path = "/text_to_speech"
	}
	base := options.BaseURL
	if base == "" {
		base = "https://api.async.com"
	}
	target, err := url.Parse(base)
	if err != nil || target.Hostname() == "" || target.User != nil || target.Fragment != "" || target.Opaque != "" || (target.Scheme != "http" && target.Scheme != "https") {
		cancel()
		return nil, errors.New("Async BaseURL must be an HTTP(S) URL without credentials or a fragment")
	}
	escapedPath := strings.TrimRight(target.EscapedPath(), "/") + path
	target.Path = strings.TrimRight(target.Path, "/") + path
	target.RawPath = escapedPath
	wire.settings["transcript"] = wire.text
	encoded, err := json.Marshal(wire.settings)
	if err != nil {
		cancel()
		return nil, err
	}
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, target.String(), bytes.NewReader(encoded))
	if err != nil {
		cancel()
		return nil, errors.New("Invalid Async request URL")
	}
	httpRequest.Header.Set("x-api-key", key)
	httpRequest.Header.Set("version", "v1")
	httpRequest.Header.Set("content-type", "application/json")
	transport := options.Transport
	if transport == nil {
		transport = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	response, err := runtime.OpenResponse(httpRequest, transport)
	if err != nil {
		cancel()
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		cancel()
		response.Body.Close()
		return nil, err
	}
	return &httpStream{ctx: ctx, cancel: cancel, response: response, timed: wire.timed, checkQuota: path == "/text_to_speech/streaming", maxJSON: maxJSON}, nil
}
