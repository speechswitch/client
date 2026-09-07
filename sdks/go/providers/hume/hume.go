// Package hume implements Hume's partially specified streaming protocols directly.
package hume

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
	"unicode/utf8"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/hume"
	out "github.com/speechswitch/client/sdks/go/generated/hume_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type Options struct {
	Auth auth.Auth
	// Nil selects native transports. Overrides must honor cancellation and close promptly.
	Transport             runtime.HTTPTransport
	WebSocket             runtime.WebSocketLike
	BaseURL, WebSocketURL string
	IncludeMetadata       bool
	// Zero selects 16 MiB per HTTP line/error body and 4 MiB per socket message.
	MaxJSONBytes, MaxMessageBytes int
}
type Error struct {
	Message    string
	StatusCode runtime.Optional[int]
	Code       runtime.Optional[string]
}

func (e *Error) Error() string { return e.Message }

// Synthesize always streams. The parent context owns headers, input, output and
// idle time; a Next context can also cancel. Always Close, including unread streams.
func Synthesize(ctx context.Context, request schema.TtsRequest, options Options) (runtime.Input[out.SynthesisItem], error) {
	validate, err := schema.ValidateRequest(request)
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
	if jsonLimit < 0 || uint64(jsonLimit) > 4294967295 {
		return nil, errors.New("Hume MaxJSONBytes must be a positive uint32 value")
	}
	if messageLimit < 0 || uint64(messageLimit) > 4294967295 {
		return nil, errors.New("Hume MaxMessageBytes must be a positive uint32 value")
	}
	c, err := settings(request, validate)
	if err != nil {
		return nil, err
	}
	c.metadata = c.metadata || options.IncludeMetadata
	if options.WebSocket != nil && c.input == nil {
		return nil, errors.New("Hume WebSocket overrides require streaming input")
	}
	var key, token string
	entry := options.Auth.Hume
	if entry.Present && entry.Value.AccessToken.Present {
		token = entry.Value.AccessToken.Value
	}
	if entry.Present && entry.Value.ApiKey.Present {
		key = entry.Value.ApiKey.Value
	} else if value, present := os.LookupEnv("SPEECHSWITCH_HUME_API_KEY"); present {
		key = value
	} else {
		key = os.Getenv("HUME_API_KEY")
	}
	if key == "" && token == "" && options.WebSocket == nil {
		return nil, errors.New("Missing auth.hume.apiKey configuration")
	}
	credential := key
	if token != "" {
		credential = token
	}
	if !utf8.ValidString(credential) {
		return nil, errors.New("Invalid Hume authentication credential")
	}
	if c.input == nil {
		for _, r := range credential {
			if r < 32 || r > 126 {
				return nil, errors.New("Invalid Hume authentication header")
			}
		}
	}
	endpoint := options.BaseURL
	if endpoint == "" {
		endpoint = "https://api.hume.ai"
	}
	explicitSocket := c.input != nil && options.WebSocketURL != ""
	if explicitSocket {
		endpoint = options.WebSocketURL
	}
	target, err := speechURL(endpoint, explicitSocket, c, credential, token != "")
	if err != nil {
		return nil, err
	}
	if c.input != nil {
		operation, cancel := context.WithCancel(ctx)
		socket := options.WebSocket
		if socket == nil {
			socket, err = runtime.ConnectWebSocket(operation, target, runtime.WebSocketOptions{MaxMessageBytes: messageLimit})
			if err != nil {
				cancel()
				return nil, err
			}
		}
		idle := make(chan struct{})
		close(idle)
		s := &socketStream{parent: ctx, ctx: operation, cancel: cancel, socket: socket, input: c.input, metadata: c.metadata, limit: messageLimit, inputIdle: idle, preferOutput: true}
		s.stop = context.AfterFunc(operation, func() { s.closeResources() })
		return s, nil
	}
	encoded, err := json.Marshal(c.body)
	if err != nil {
		return nil, err
	}
	native, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(encoded))
	if err != nil {
		return nil, err
	}
	if token != "" {
		native.Header.Set("Authorization", "Bearer "+token)
	} else {
		native.Header.Set("X-Hume-Api-Key", key)
	}
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
				return nil, errors.New("Hume response exceeds MaxJSONBytes")
			}
			data = append(data, chunk...)
		}
		message := strings.TrimPrefix(runtime.DecodeUTF8(data), "\ufeff")
		var detail map[string]any
		_ = json.Unmarshal([]byte(message), &detail)
		if value, ok := detail["message"].(string); ok {
			message = value
		} else if value, ok := detail["error"].(string); ok {
			message = value
		}
		code := runtime.Optional[string]{}
		if value, ok := detail["code"].(string); ok {
			code = runtime.Some(value)
		}
		return nil, &Error{Message: message, StatusCode: runtime.Some(response.StatusCode), Code: code}
	}
	return &httpStream{ctx: ctx, body: response.Body, metadata: c.metadata, first: true, limit: jsonLimit}, nil
}

func speechURL(endpoint string, explicitSocket bool, c configuration, credential string, token bool) (string, error) {
	u, err := url.Parse(endpoint)
	invalid := errors.New("Invalid Hume endpoint URL")
	socket := c.input != nil
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
	if !explicitSocket {
		suffix := "file"
		if c.metadata {
			suffix = "json"
		}
		if socket {
			suffix = "input"
		}
		escaped := strings.TrimRight(u.EscapedPath(), "/") + "/v0/tts/stream/" + suffix
		u.Path, err = url.PathUnescape(escaped)
		if err != nil {
			return "", invalid
		}
		u.RawPath = escaped
	}
	if socket {
		if u.Scheme == "http" {
			u.Scheme = "ws"
		} else if u.Scheme == "https" {
			u.Scheme = "wss"
		}
		query, err := url.ParseQuery(u.RawQuery)
		if err != nil {
			return "", invalid
		}
		for _, name := range []string{"api_key", "access_token", "format_type", "version", "instant_mode", "no_binary", "strip_headers", "include_timestamp_types", "context_generation_id", "temperature"} {
			query.Del(name)
		}
		if token {
			query.Set("access_token", credential)
		} else {
			query.Set("api_key", credential)
		}
		query.Set("format_type", c.format)
		query.Set("version", c.version)
		query.Set("instant_mode", strconv.FormatBool(c.instant))
		query.Set("no_binary", strconv.FormatBool(c.metadata))
		query.Set("strip_headers", "true")
		for _, kind := range c.kinds {
			query.Add("include_timestamp_types", kind)
		}
		if c.priorID != "" {
			query.Set("context_generation_id", c.priorID)
		}
		if c.temperature.Present {
			query.Set("temperature", strconv.FormatFloat(c.temperature.Value, 'g', -1, 64))
		}
		u.RawQuery = query.Encode()
	}
	return u.String(), nil
}
