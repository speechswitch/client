// Package camb implements byte-native synthesis using contract-generated wire clients.
package camb

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"

	wire "github.com/speechswitch/client/sdks/go/clients/camb"
	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/camb"
	out "github.com/speechswitch/client/sdks/go/generated/camb_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type Options struct {
	Auth auth.Auth
	// Nil uses native HTTP/WebSockets. Overrides must honor cancellation and
	// must not redirect credential-bearing requests to another origin.
	Transport             runtime.HTTPTransport
	WebSocket             runtime.WebSocketLike
	BaseURL, WebSocketURL string
	// Zero selects 1 MiB error bodies and 4 MiB WebSocket messages.
	MaxErrorBytes, MaxMessageBytes int
}

// Synthesize opens one owned stream. Always Close, even without reading.
// A successful live call transfers input ownership; Close must unblock Next.
func Synthesize(ctx context.Context, request schema.TtsRequest, options Options) (runtime.Input[out.SynthesisItem], error) {
	validate, err := schema.ValidateRequest(request)
	if err != nil {
		return nil, err
	}
	settings, err := settings(request)
	if err != nil {
		return nil, err
	}
	key := ""
	if options.Auth.Camb.Present && options.Auth.Camb.Value.ApiKey.Present {
		key = options.Auth.Camb.Value.ApiKey.Value
	} else if value, present := os.LookupEnv("SPEECHSWITCH_CAMB_API_KEY"); present {
		key = value
	} else {
		key = os.Getenv("CAMB_API_KEY")
	}
	if key == "" {
		return nil, errors.New("Missing auth.camb.apiKey configuration")
	}
	maxError, maxMessage := options.MaxErrorBytes, options.MaxMessageBytes
	if maxError == 0 {
		maxError = 1024 * 1024
	}
	if maxMessage == 0 {
		maxMessage = 4 * 1024 * 1024
	}
	if maxError < 0 || maxMessage < 0 {
		return nil, errors.New("CAMB byte limits must be positive")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	transport := options.Transport
	if transport == nil {
		transport = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	if settings.input == nil {
		base := options.BaseURL
		if base == "" {
			base = wire.DefaultBaseURL
		}
		response, err := wire.StreamSpeech(ctx, settings.http, key, base, transport)
		if err != nil {
			return nil, err
		}
		if err := ctx.Err(); err != nil {
			response.Body.Close()
			return nil, err
		}
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			defer response.Body.Close()
			var data []byte
			for {
				chunk, err := response.Body.Next(ctx)
				if err == io.EOF {
					break
				}
				if err != nil {
					return nil, err
				}
				if len(chunk) > maxError-len(data) {
					return nil, errors.New("CAMB response exceeds MaxErrorBytes")
				}
				data = append(data, chunk...)
			}
			return nil, fmt.Errorf("CAMB returned HTTP %d: %s", response.StatusCode, strings.TrimSpace(strings.TrimPrefix(strings.ToValidUTF8(string(data), "\uFFFD"), "\uFEFF")))
		}
		return &audioStream{body: response.Body}, nil
	}
	// Validate and bound settings before opening a socket or touching the input.
	first, err := wire.EncodeMessage(settings.start)
	if err != nil {
		return nil, err
	}
	if len(first) > maxMessage {
		return nil, errors.New("CAMB message exceeds MaxMessageBytes")
	}
	ctx, cancel := context.WithCancel(ctx)
	socket := options.WebSocket
	if socket == nil {
		address := options.WebSocketURL
		if address == "" {
			address = wire.DefaultWebSocketURL
		}
		target, err := url.Parse(address)
		if err != nil {
			cancel()
			return nil, errors.New("Invalid CAMB WebSocketURL")
		}
		query, err := url.ParseQuery(target.RawQuery)
		if err != nil {
			cancel()
			return nil, errors.New("Invalid CAMB WebSocketURL query")
		}
		query.Del("api_key")
		target.RawQuery = query.Encode()
		socket, err = runtime.ConnectWebSocket(ctx, target.String(), runtime.WebSocketOptions{Transport: transport, Header: http.Header{"X-Api-Key": []string{key}}, MaxMessageBytes: maxMessage})
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
	stream := &socketStream{ctx: ctx, cancel: cancel, socket: socket, input: settings.input, first: first, validate: validate,
		timed: settings.timed, checkInput: settings.checkInput, maxMessage: maxMessage, seen: map[float64]bool{}}
	stream.stop = context.AfterFunc(ctx, func() { stream.closeResources() })
	return stream, nil
}

type audioStream struct{ body runtime.Input[[]byte] }

func (s *audioStream) Next(ctx context.Context) (out.SynthesisItem, error) {
	data, err := s.body.Next(ctx)
	if err != nil {
		return nil, err
	}
	return out.SynthesisItemAsBytes{Value: data}, nil
}
func (s *audioStream) Close() error { return s.body.Close() }
