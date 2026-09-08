// Package fish implements Fish Audio's authored MessagePack and SSE protocols.
package fish

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"unicode"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/fish"
	out "github.com/speechswitch/client/sdks/go/generated/fish_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type Options struct {
	Auth auth.Auth
	// Nil uses native HTTP/WebSockets. Overrides must honor cancellation.
	Transport             runtime.HTTPTransport
	WebSocket             runtime.WebSocketLike
	BaseURL, WebSocketURL string
	// Zero selects 16 MiB per SSE block/error body and 4 MiB per socket message.
	MaxJSONBytes, MaxMessageBytes int
}

// Synthesize always returns owned streaming items. Close even an unread stream.
// ctx owns setup, input, I/O and idle time; a Next context can also cancel it.
func Synthesize(ctx context.Context, request schema.TtsRequest, options Options) (runtime.Input[out.SynthesisItem], error) {
	validate, err := schema.ValidateRequest(request)
	if err != nil {
		return nil, err
	}
	c, err := settings(request)
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	jsonLimit, messageLimit := options.MaxJSONBytes, options.MaxMessageBytes
	if jsonLimit == 0 {
		jsonLimit = 16 * 1024 * 1024
	}
	if messageLimit == 0 {
		messageLimit = 4 * 1024 * 1024
	}
	if jsonLimit < 0 || messageLimit < 0 {
		return nil, errors.New("Fish byte limits must be positive")
	}
	var key string
	if options.Auth.Fish.Present && options.Auth.Fish.Value.ApiKey.Present {
		key = options.Auth.Fish.Value.ApiKey.Value
	} else if value, present := os.LookupEnv("SPEECHSWITCH_FISH_API_KEY"); present {
		key = value
	} else {
		key = os.Getenv("FISH_API_KEY")
	}
	streaming := c.input != nil
	if key == "" && !(streaming && options.WebSocket != nil) {
		return nil, errors.New("Missing auth.fish.apiKey configuration")
	}
	target, err := endpoint(options.BaseURL, options.WebSocketURL, streaming, c.timed)
	if err != nil {
		return nil, err
	}
	wire, err := wireSettings(c)
	if err != nil {
		return nil, err
	}
	if streaming {
		operation, cancel := context.WithCancel(ctx)
		socket := options.WebSocket
		if socket == nil {
			socket, err = runtime.ConnectWebSocket(operation, target, runtime.WebSocketOptions{Header: http.Header{"Authorization": []string{"Bearer " + key}, "Model": []string{c.model}}, MaxMessageBytes: messageLimit})
			if err != nil {
				cancel()
				return nil, err
			}
		}
		s := &socketStream{parent: ctx, ctx: operation, cancel: cancel, socket: socket, input: c.input, validate: validate, wire: wire, limit: messageLimit, preferOutput: true}
		s.stop = context.AfterFunc(operation, func() { s.closeResources() })
		return s, nil
	}
	data, err := runtime.EncodeMessagePack(wire)
	if err != nil {
		return nil, err
	}
	requestHTTP, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	requestHTTP.Header.Set("Authorization", "Bearer "+key)
	requestHTTP.Header.Set("Model", c.model)
	requestHTTP.Header.Set("Content-Type", "application/msgpack")
	transport := options.Transport
	if transport == nil {
		transport = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	response, err := runtime.OpenResponse(requestHTTP, transport)
	if err != nil {
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
			if len(chunk) > jsonLimit-len(data) {
				return nil, errors.New("Fish response exceeds MaxJSONBytes")
			}
			data = append(data, chunk...)
		}
		message := runtime.DecodeUTF8(bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf}))
		result := &Error{StatusCode: response.StatusCode, Message: message}
		var fields map[string]any
		if json.Unmarshal([]byte(message), &fields) == nil {
			if value, ok := fields["message"].(string); ok {
				result.Message = value
			}
			if value, ok := fields["reason"].(string); ok {
				result.Reason = runtime.Some(value)
			}
		}
		return nil, result
	}
	s := &httpStream{ctx: ctx, body: response.Body}
	if c.timed {
		s.decoder, err = runtime.NewSSEDecoder(jsonLimit)
		if err != nil {
			response.Body.Close()
			return nil, err
		}
	}
	return s, nil
}
func endpoint(base, override string, streaming, timed bool) (string, error) {
	if base == "" {
		base = "https://api.fish.audio"
	}
	target := base
	if streaming && override != "" {
		target = override
	}
	u, err := url.Parse(target)
	if err != nil || u.Hostname() == "" || u.User != nil || u.Fragment != "" || strings.IndexFunc(target, func(c rune) bool { return unicode.IsSpace(c) || unicode.IsControl(c) || c == '\\' }) >= 0 {
		return "", errors.New("Invalid Fish endpoint URL")
	}
	if u.Scheme != "http" && u.Scheme != "https" && !(streaming && (u.Scheme == "ws" || u.Scheme == "wss")) {
		return "", errors.New("Invalid Fish endpoint URL")
	}
	if port := u.Port(); port != "" {
		if _, err := strconv.ParseUint(port, 10, 16); err != nil {
			return "", errors.New("Invalid Fish endpoint URL")
		}
	}
	if _, err := url.ParseQuery(u.RawQuery); err != nil {
		return "", errors.New("Invalid Fish endpoint query")
	}
	if !streaming || override == "" {
		suffix := "/v1/tts"
		if streaming {
			suffix += "/live"
		} else if timed {
			suffix += "/stream/with-timestamp"
		}
		escaped := strings.TrimRight(u.EscapedPath(), "/") + suffix
		u.Path, err = url.PathUnescape(escaped)
		if err != nil {
			return "", errors.New("Invalid Fish endpoint URL")
		}
		u.RawPath = escaped
	}
	if streaming {
		if u.Scheme == "http" {
			u.Scheme = "ws"
		} else if u.Scheme == "https" {
			u.Scheme = "wss"
		}
	}
	return u.String(), nil
}
