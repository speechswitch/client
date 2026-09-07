// Package inworld implements Inworld's partially specified HTTP and socket protocols.
package inworld

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf16"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/inworld"
	out "github.com/speechswitch/client/sdks/go/generated/inworld_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type Options struct {
	Auth auth.Auth
	// Nil selects native transports. Overrides must honor cancellation, without replaying requests.
	Transport             runtime.HTTPTransport
	WebSocket             runtime.WebSocketLike
	BaseURL, WebSocketURL string
	// Omitted selects HTTP streaming; explicit "single" buffers a bounded JSON response.
	HTTPMode  runtime.Optional[string]
	ContextID runtime.Optional[string]
	// Zero selects 16 MiB per HTTP record and 4 MiB per socket message.
	MaxJSONBytes, MaxMessageBytes int
}

type Error struct {
	Message    string
	StatusCode runtime.Optional[int]
	Code       runtime.Optional[int64]
}

func (e *Error) Error() string { return e.Message }

// Synthesize owns one operation. Always Close, including unread streams. Parent
// and Next contexts cancel I/O; close/error does not wait for producer cleanup.
func Synthesize(ctx context.Context, request schema.TtsRequest, options Options) (runtime.Input[out.SynthesisItem], error) {
	validate, err := schema.ValidateRequest(request)
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	c, err := settings(request)
	if err != nil {
		return nil, err
	}
	live := c.input != nil
	if !live && (options.WebSocket != nil || options.WebSocketURL != "" || options.ContextID.Present) {
		return nil, errors.New("Inworld WebSocket options require streaming input")
	}
	if live && options.HTTPMode.Present {
		return nil, errors.New("Inworld HTTPMode requires static text")
	}
	mode := "stream"
	if options.HTTPMode.Present {
		mode = options.HTTPMode.Value
	}
	if mode != "stream" && mode != "single" {
		return nil, errors.New("Invalid Inworld HTTPMode")
	}
	if mode == "single" && len(utf16.Encode([]rune(c.text))) > 2000 {
		return nil, errors.New("Inworld single-response text must not exceed 2000 characters")
	}
	jsonLimit, messageLimit := options.MaxJSONBytes, options.MaxMessageBytes
	if jsonLimit == 0 {
		jsonLimit = 16 * 1024 * 1024
	}
	if messageLimit == 0 {
		messageLimit = 4 * 1024 * 1024
	}
	if jsonLimit < 0 || uint64(jsonLimit) > 4294967295 {
		return nil, errors.New("Inworld MaxJSONBytes must be a positive uint32 value")
	}
	if messageLimit < 0 || uint64(messageLimit) > 4294967295 {
		return nil, errors.New("Inworld MaxMessageBytes must be a positive uint32 value")
	}
	entry := options.Auth.Inworld
	key, token := "", ""
	if entry.Present && entry.Value.ApiKey.Present {
		key = entry.Value.ApiKey.Value
	} else if value, present := os.LookupEnv("SPEECHSWITCH_INWORLD_API_KEY"); present {
		key = value
	} else {
		key = os.Getenv("INWORLD_API_KEY")
	}
	if entry.Present && entry.Value.AccessToken.Present {
		token = entry.Value.AccessToken.Value
	}
	if key == "" && token == "" && options.WebSocket == nil {
		return nil, errors.New("Missing auth.inworld.apiKey configuration")
	}
	credential, authorization := key, "Basic "+key
	if token != "" {
		credential, authorization = token, "Bearer "+token
	}
	for _, c := range credential {
		if c < 32 || c > 126 {
			return nil, errors.New("Invalid Inworld authentication header")
		}
	}
	endpoint := options.BaseURL
	if endpoint == "" {
		endpoint = "https://api.inworld.ai"
	}
	explicit := live && options.WebSocketURL != ""
	if explicit {
		endpoint = options.WebSocketURL
	}
	target, err := speechURL(endpoint, live, explicit, mode)
	if err != nil {
		return nil, err
	}
	if live || mode == "stream" {
		c.body["timestampTransportStrategy"] = "ASYNC"
		if c.chunk {
			c.body["timestampTransportStrategy"] = "SYNC"
		}
	}
	if live {
		id := options.ContextID.Value
		if options.ContextID.Present && id == "" {
			return nil, errors.New("Inworld ContextID must not be empty")
		}
		if !options.ContextID.Present {
			var random [16]byte
			if _, err := rand.Read(random[:]); err != nil {
				return nil, err
			}
			id = hex.EncodeToString(random[:])
		}
		operation, cancel := context.WithCancel(ctx)
		socket := options.WebSocket
		if socket == nil {
			socket, err = runtime.ConnectWebSocket(operation, target, runtime.WebSocketOptions{Header: http.Header{"Authorization": {authorization}}, MaxMessageBytes: messageLimit})
			if err != nil {
				cancel()
				return nil, err
			}
		}
		idle := make(chan struct{})
		close(idle)
		stream := &socketStream{parent: ctx, ctx: operation, cancel: cancel, socket: socket, input: c.input, create: c.body, contextID: id, timed: c.timed, chunk: c.chunk, limit: messageLimit, validate: validate, inputIdle: idle, preferOutput: true}
		if c.format == "wav" {
			stream.wave = &waveStream{header: true}
		}
		stream.stop = context.AfterFunc(operation, func() { stream.closeResources() })
		return stream, nil
	}
	data, err := json.Marshal(c.body)
	if err != nil {
		return nil, err
	}
	native, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	native.Header.Set("Authorization", authorization)
	native.Header.Set("content-type", "application/json")
	transport := options.Transport
	if transport == nil {
		transport = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	response, err := runtime.OpenResponse(native, transport)
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		response.Body.Close()
		return nil, err
	}
	if mode == "single" || response.StatusCode < 200 || response.StatusCode >= 300 {
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
				return nil, errors.New("Inworld response exceeds MaxJSONBytes")
			}
			data = append(data, chunk...)
		}
		message := strings.TrimPrefix(runtime.DecodeUTF8(data), "\ufeff")
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			var fields map[string]any
			_ = json.Unmarshal([]byte(message), &fields)
			if v, ok := fields["message"].(string); ok {
				message = v
			}
			code := runtime.Optional[int64]{}
			if v, ok := fields["code"].(float64); ok && math.Trunc(v) == v && math.Abs(v) <= 9007199254740991 {
				code = runtime.Some(int64(v))
			}
			return nil, &Error{Message: message, StatusCode: runtime.Some(response.StatusCode), Code: code}
		}
		value, err := decode([]byte(message))
		if err != nil {
			return nil, err
		}
		if err := status(value); err != nil {
			return nil, err
		}
		if _, ok := value["audioContent"].(string); !ok {
			return nil, errors.New("Inworld single response omitted audio")
		}
		item, err := audioOutput(value, c.timed, true, runtime.Optional[string]{}, nil)
		if err != nil {
			return nil, err
		}
		return &singleStream{ctx: ctx, item: item}, nil
	}
	return &httpStream{ctx: ctx, body: response.Body, timed: c.timed, synchronized: c.chunk, first: true, limit: jsonLimit}, nil
}

func speechURL(endpoint string, live, explicit bool, mode string) (string, error) {
	u, err := url.Parse(endpoint)
	invalid := errors.New("Invalid Inworld endpoint URL")
	if err != nil || u.Hostname() == "" || u.User != nil || u.Fragment != "" || strings.ContainsFunc(endpoint, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) || r == '\\' }) {
		return "", invalid
	}
	if u.Scheme != "http" && u.Scheme != "https" && !(live && (u.Scheme == "ws" || u.Scheme == "wss")) {
		return "", invalid
	}
	if port := u.Port(); port != "" {
		n, err := strconv.Atoi(port)
		if err != nil || n > 65535 {
			return "", invalid
		}
	}
	if _, err := url.QueryUnescape(u.RawQuery); err != nil {
		return "", invalid
	}
	if !explicit {
		suffix := "/tts/v1/voice"
		if live {
			suffix += ":streamBidirectional"
		} else if mode == "stream" {
			suffix += ":stream"
		}
		escaped := strings.TrimRight(u.EscapedPath(), "/") + suffix
		u.Path, err = url.PathUnescape(escaped)
		if err != nil {
			return "", invalid
		}
		u.RawPath = escaped
	}
	if live {
		if u.Scheme == "http" {
			u.Scheme = "ws"
		} else if u.Scheme == "https" {
			u.Scheme = "wss"
		}
	}
	return u.String(), nil
}
