// Package kugelaudio implements KugelAudio's native HTTP and turn-based WebSocket protocols.
package kugelaudio

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/kugelaudio"
	out "github.com/speechswitch/client/sdks/go/generated/kugelaudio_output"
	"github.com/speechswitch/client/sdks/go/runtime"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"unicode"
)

type Options struct {
	Auth auth.Auth
	// Nil selects native transports. Overrides must honor cancellation and not replay authentication.
	Transport             runtime.HTTPTransport
	WebSocket             runtime.WebSocketLike
	BaseURL, WebSocketURL string
	// Empty selects the key's region. Explicit EU keys still have their prefix stripped.
	Region    string
	OnWarning func(string)
	// Zero selects 16 MiB per HTTP error body and 4 MiB per WebSocket message.
	MaxJSONBytes, MaxMessageBytes int
}

type Error struct {
	Message          string
	StatusCode       runtime.Optional[int]
	Code, RetryAfter runtime.Optional[string]
}

func (e *Error) Error() string { return e.Message }

// Synthesize owns one stream. Always Close, including unread output.
// Parent and Next contexts support cancellation/deadlines without waiting for producer cleanup.
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
	jsonLimit, messageLimit := options.MaxJSONBytes, options.MaxMessageBytes
	if jsonLimit == 0 {
		jsonLimit = 16 * 1024 * 1024
	}
	if messageLimit == 0 {
		messageLimit = 4 * 1024 * 1024
	}
	if jsonLimit < 0 || uint64(jsonLimit) > 4294967295 {
		return nil, errors.New("KugelAudio MaxJSONBytes must be a positive uint32 value")
	}
	if messageLimit < 0 || uint64(messageLimit) > 4294967295 {
		return nil, errors.New("KugelAudio MaxMessageBytes must be a positive uint32 value")
	}
	region := options.Region
	if region != "" && region != "eu" && region != "global" {
		return nil, errors.New("Invalid KugelAudio region")
	}
	entry, key := options.Auth.Kugelaudio, ""
	if entry.Present && entry.Value.ApiKey.Present {
		key = entry.Value.ApiKey.Value
	} else if value, present := os.LookupEnv("SPEECHSWITCH_KUGELAUDIO_API_KEY"); present {
		key = value
	} else {
		key = os.Getenv("KUGELAUDIO_API_KEY")
	}
	if strings.HasPrefix(key, "eu-") {
		key = key[3:]
		if region == "" {
			region = "eu"
		}
	}
	if key == "" && options.WebSocket == nil {
		return nil, errors.New("Missing auth.kugelaudio.apiKey configuration")
	}
	for _, r := range key {
		if r < 32 || r > 126 {
			return nil, errors.New("Invalid KugelAudio authentication header")
		}
	}
	authorization := "Bearer " + key
	endpoint := options.BaseURL
	if endpoint == "" {
		endpoint = "https://api.kugelaudio.com"
		if region == "eu" {
			endpoint = "https://api.eu.kugelaudio.com"
		}
	}
	socketMode := c.socket || options.WebSocket != nil || options.WebSocketURL != ""
	if options.WebSocketURL != "" {
		endpoint = options.WebSocketURL
	}
	target, err := speechURL(endpoint, socketMode, options.WebSocketURL != "", c.input != nil)
	if err != nil {
		return nil, err
	}
	if socketMode {
		c.body["word_timestamps"], c.body["speaker_prefix"] = c.timed, c.speaker
		operation, cancel := context.WithCancel(ctx)
		socket := options.WebSocket
		if socket == nil {
			socket, err = runtime.ConnectWebSocket(operation, target, runtime.WebSocketOptions{Header: http.Header{"Authorization": {authorization}}, MaxMessageBytes: messageLimit})
			if err != nil {
				cancel()
				return nil, err
			}
		}
		warning := options.OnWarning
		if warning == nil {
			warning = func(string) {}
		}
		idle := make(chan struct{})
		close(idle)
		state := "idle"
		if c.input == nil {
			state = "active"
		}
		s := &socketStream{parent: ctx, ctx: operation, cancel: cancel, socket: socket, input: c.input, config: c.body,
			live: c.input != nil, timed: c.timed, rate: c.rate, encoding: c.encoding, limit: messageLimit, warning: warning,
			validate: validate, inputIdle: idle, state: state, inputDone: c.input == nil, samples: map[int64]int64{}, preferOutput: true}
		s.stop = context.AfterFunc(operation, func() { s.closeResources() })
		return s, nil
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
				return nil, errors.New("KugelAudio response exceeds MaxJSONBytes")
			}
			data = append(data, chunk...)
		}
		message := strings.TrimPrefix(runtime.DecodeUTF8(data), "\ufeff")
		var fields map[string]any
		_ = json.Unmarshal([]byte(message), &fields)
		if v, ok := fields["error"].(string); ok {
			message = v
		}
		failure := &Error{Message: message, StatusCode: runtime.Some(response.StatusCode)}
		if v, ok := fields["error_code"].(string); ok {
			failure.Code = runtime.Some(v)
		}
		if values, present := response.Header["Retry-After"]; present {
			failure.RetryAfter = runtime.Some(strings.Join(values, ", "))
		}
		return nil, failure
	}
	invalidFormat := false
	if values, present := response.Header["X-Sample-Rate"]; present {
		rate, err := strconv.ParseFloat(strings.TrimSpace(strings.Join(values, ", ")), 64)
		invalidFormat = err != nil || rate != c.rate
	}
	if values, present := response.Header["X-Audio-Format"]; present {
		invalidFormat = invalidFormat || strings.Join(values, ", ") != c.encoding
	}
	if invalidFormat {
		response.Body.Close()
		return nil, errors.New("KugelAudio returned an unexpected audio format")
	}
	return &httpStream{body: response.Body}, nil
}

type httpStream struct{ body runtime.Input[[]byte] }

func (s *httpStream) Close() error { return s.body.Close() }
func (s *httpStream) Next(ctx context.Context) (out.SynthesisItem, error) {
	data, err := s.body.Next(ctx)
	if err != nil {
		return nil, err
	}
	return out.SynthesisItemAsBytes{Value: data}, nil
}

func speechURL(endpoint string, socket, explicit, live bool) (string, error) {
	u, err := url.Parse(endpoint)
	invalid := errors.New("Invalid KugelAudio endpoint URL")
	if err != nil || u.Hostname() == "" || u.User != nil || u.Fragment != "" || strings.ContainsFunc(endpoint, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) || r == '\\' }) {
		return "", invalid
	}
	if u.Scheme != "http" && u.Scheme != "https" && !(socket && (u.Scheme == "ws" || u.Scheme == "wss")) {
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
		suffix := "/v1/tts/generate"
		if socket {
			suffix = "/ws/tts"
			if live {
				suffix += "/stream"
			}
		}
		escaped := strings.TrimRight(u.EscapedPath(), "/") + suffix
		u.Path, err = url.PathUnescape(escaped)
		if err != nil {
			return "", invalid
		}
		u.RawPath = escaped
	}
	if socket {
		if u.Scheme == "https" {
			u.Scheme = "wss"
		} else if u.Scheme == "http" {
			u.Scheme = "ws"
		}
	}
	return u.String(), nil
}
