// Package gradium implements Gradium's partially specified wire protocols directly.
package gradium

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
	schema "github.com/speechswitch/client/sdks/go/generated/gradium"
	out "github.com/speechswitch/client/sdks/go/generated/gradium_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type Input = schema.TtsRequestTextAsyncIterableItem

type Options struct {
	Auth auth.Auth
	// Nil selects native HTTP/WebSockets. Overrides must honor cancellation.
	Transport             runtime.HTTPTransport
	WebSocket             runtime.WebSocketLike
	BaseURL, WebSocketURL string
	// Presence selects WebSockets, including an explicit zero retry window.
	SetupRetryMs runtime.Optional[int64]
	// Zero selects 16 MiB per HTTP JSON line/error body and 4 MiB per socket message.
	MaxJSONBytes, MaxMessageBytes int
}

type Error struct {
	Message    string
	StatusCode runtime.Optional[int]
	Code       runtime.Optional[int64]
}

func (e *Error) Error() string { return e.Message }

// Synthesize owns one operation. Always Close, even if unread. The parent context
// covers headers, input, output and idle time; each Next can also cancel the stream.
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
		return nil, errors.New("Gradium MaxJSONBytes must be a positive uint32 value")
	}
	if messageLimit < 0 || uint64(messageLimit) > 4294967295 {
		return nil, errors.New("Gradium MaxMessageBytes must be a positive uint32 value")
	}
	retry := int64(0)
	if options.SetupRetryMs.Present {
		retry = options.SetupRetryMs.Value
		if retry < 0 || retry > 9007199254740991 {
			return nil, errors.New("Gradium SetupRetryMs must be a non-negative safe integer")
		}
	}
	wire, text, input := settings(request)
	var key string
	var token runtime.Optional[string]
	entry := options.Auth.Gradium
	if entry.Present && entry.Value.SingleUseToken.Present {
		token = entry.Value.SingleUseToken
	}
	if entry.Present && entry.Value.ApiKey.Present {
		key = entry.Value.ApiKey.Value
	} else if value, present := os.LookupEnv("SPEECHSWITCH_GRADIUM_API_KEY"); present {
		key = value
	} else {
		key = os.Getenv("GRADIUM_API_KEY")
	}
	socketMode := input != nil || request.Lexicon.Present || options.WebSocket != nil || token.Present || options.SetupRetryMs.Present
	if key == "" && !(socketMode && (options.WebSocket != nil || token.Value != "")) {
		return nil, errors.New("Missing auth.gradium.apiKey configuration")
	}
	for _, c := range key {
		if c < 32 || c > 126 {
			return nil, errors.New("Invalid Gradium authentication header")
		}
	}
	if !utf8.ValidString(token.Value) {
		return nil, errors.New("Invalid Gradium authentication token")
	}
	endpoint := options.BaseURL
	if endpoint == "" {
		endpoint = "https://api.gradium.ai/api"
	}
	explicitSocket := socketMode && options.WebSocketURL != ""
	if explicitSocket {
		endpoint = options.WebSocketURL
	}
	target, err := speechURL(endpoint, socketMode, explicitSocket, token.Value)
	if err != nil {
		return nil, err
	}
	timed := request.TimestampGranularity.Present
	if socketMode {
		wire["type"], wire["close_ws_on_eos"], wire["retry_for_s"] = "setup", true, float64(retry)/1000
		if request.Lexicon.Present {
			wire["pronunciation_id"] = request.Lexicon.Value
		}
		operation, cancel := context.WithCancel(ctx)
		socket := options.WebSocket
		if socket == nil {
			headers := http.Header{}
			if token.Value == "" {
				headers.Set("x-api-key", key)
			}
			socket, err = runtime.ConnectWebSocket(operation, target, runtime.WebSocketOptions{Header: headers, MaxMessageBytes: messageLimit})
			if err != nil {
				cancel()
				return nil, err
			}
		}
		idle := make(chan struct{})
		close(idle)
		stream := &socketStream{parent: ctx, ctx: operation, cancel: cancel, socket: socket, input: input, text: text,
			setup: wire, validate: validate, timed: timed, limit: messageLimit, inputIdle: idle, preferOutput: true}
		stream.stop = context.AfterFunc(operation, func() { stream.closeResources() })
		return stream, nil
	}
	config, err := json.Marshal(wire["json_config"])
	if err != nil {
		return nil, err
	}
	wire["json_config"], wire["text"], wire["only_audio"] = string(config), text, !timed
	encoded, err := json.Marshal(wire)
	if err != nil {
		return nil, err
	}
	native, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(encoded))
	if err != nil {
		return nil, err
	}
	native.Header.Set("x-api-key", key)
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
				return nil, errors.New("Gradium response exceeds MaxJSONBytes")
			}
			data = append(data, chunk...)
		}
		message := strings.TrimPrefix(runtime.DecodeUTF8(data), "\ufeff")
		code := runtime.Optional[int64]{}
		if suffix, ok := strings.CutPrefix(message, "error from server "); ok {
			digits, reason, found := strings.Cut(suffix, ": ")
			if found && digits != "" && strings.Trim(digits, "0123456789") == "" {
				message = reason
				parsed, err := strconv.ParseInt(strings.TrimLeft(digits, "0"), 10, 64)
				if strings.Trim(digits, "0") == "" {
					parsed, err = 0, nil
				}
				if err == nil && parsed <= 9007199254740991 {
					code = runtime.Some(parsed)
				}
			}
		}
		return nil, &Error{Message: message, StatusCode: runtime.Some(response.StatusCode), Code: code}
	}
	return &httpStream{ctx: ctx, body: response.Body, timed: timed, first: true, limit: jsonLimit}, nil
}

func speechURL(endpoint string, socket, explicitSocket bool, token string) (string, error) {
	u, err := url.Parse(endpoint)
	invalid := errors.New("Invalid Gradium endpoint URL")
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
		suffix := "/post/speech/tts"
		if socket {
			suffix = "/speech/tts"
		}
		escaped := strings.TrimRight(u.EscapedPath(), "/") + suffix
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
		if token != "" {
			query, err := url.ParseQuery(u.RawQuery)
			if err != nil {
				return "", invalid
			}
			query.Set("token", token)
			u.RawQuery = query.Encode()
		}
	}
	return u.String(), nil
}
