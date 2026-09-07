// Package minimax implements MiniMax's HTTP and bidirectional WebSocket protocols.
package minimax

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/minimax"
	out "github.com/speechswitch/client/sdks/go/generated/minimax_output"
	"github.com/speechswitch/client/sdks/go/runtime"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"unicode"
)

type Options struct {
	Auth auth.Auth
	// Nil uses native HTTP/WebSockets. A socket override is exclusively owned.
	Transport             runtime.HTTPTransport
	WebSocket             runtime.WebSocketLike
	BaseURL, WebSocketURL string
	// Zero selects 16 MiB for JSON/SSE/subtitles, and 4 MiB for socket messages.
	MaxJSONBytes, MaxMessageBytes int
}
type Error struct {
	Message    string
	Code       runtime.Optional[int]
	StatusCode int
	RetryAfter runtime.Optional[string]
}

func (e *Error) Error() string { return e.Message }

// Synthesize returns one owned audio stream. Always Close it, including when unread.
// Whole text uses HTTP; streaming input uses WebSocket. All waits inherit ctx.
func Synthesize(ctx context.Context, request schema.TtsRequest, options Options) (runtime.Input[out.SynthesisItem], error) {
	validate, err := schema.ValidateRequest(request)
	if err != nil {
		return nil, err
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	c, err := settings(request)
	if err != nil {
		return nil, err
	}
	if c.input == nil && (options.WebSocket != nil || options.WebSocketURL != "") {
		return nil, errors.New("MiniMax WebSocket overrides require streaming input")
	}
	jsonLimit, messageLimit := options.MaxJSONBytes, options.MaxMessageBytes
	if jsonLimit == 0 {
		jsonLimit = 16 * 1024 * 1024
	}
	if messageLimit == 0 {
		messageLimit = 4 * 1024 * 1024
	}
	if jsonLimit < 0 || uint64(jsonLimit) > 4294967295 {
		return nil, errors.New("MiniMax MaxJSONBytes must be a positive uint32 value")
	}
	if messageLimit < 0 || uint64(messageLimit) > 4294967295 {
		return nil, errors.New("MiniMax MaxMessageBytes must be a positive uint32 value")
	}
	key := ""
	entry := options.Auth.Minimax
	if entry.Present && entry.Value.ApiKey.Present {
		key = entry.Value.ApiKey.Value
	} else {
		var present bool
		key, present = os.LookupEnv("SPEECHSWITCH_MINIMAX_API_KEY")
		if !present {
			key = os.Getenv("MINIMAX_API_KEY")
		}
	}
	if key == "" && options.WebSocket == nil {
		return nil, errors.New("Missing auth.minimax.apiKey configuration")
	}
	for _, r := range key {
		if r < 32 || r > 126 {
			return nil, errors.New("Invalid MiniMax authentication header")
		}
	}
	base := options.BaseURL
	if base == "" {
		base = "https://api.minimax.io"
	}
	address, err := endpoint(base, "", false)
	if err != nil {
		return nil, err
	}
	operation, cancel := context.WithCancel(ctx)
	if c.input != nil {
		if options.WebSocketURL != "" {
			address, err = endpoint(options.WebSocketURL, "", true)
		} else {
			u, _ := url.Parse(address)
			if u.Scheme == "https" {
				u.Scheme = "wss"
			} else {
				u.Scheme = "ws"
			}
			address, err = endpoint(u.String(), "/ws/v1/t2a_v2_bidi", true)
		}
		if err != nil {
			cancel()
			return nil, err
		}
		var nonce [16]byte
		if _, err = rand.Read(nonce[:]); err != nil {
			cancel()
			return nil, err
		}
		nonce[6] = (nonce[6] & 15) | 64
		nonce[8] = (nonce[8] & 63) | 128
		socket := options.WebSocket
		if socket == nil {
			socket, err = runtime.ConnectWebSocket(operation, address, runtime.WebSocketOptions{Header: http.Header{"Authorization": {"Bearer " + key}}, MaxMessageBytes: messageLimit})
			if err != nil {
				cancel()
				return nil, err
			}
		}
		idle := make(chan struct{})
		close(idle)
		s := &socketStream{parent: ctx, ctx: operation, cancel: cancel, socket: socket, config: c, validate: validate, limit: messageLimit,
			session: hex.EncodeToString(nonce[:]), producerIdle: idle, resume: make(chan struct{}, 1)}
		s.stop = context.AfterFunc(operation, func() { s.closeResources() })
		return s, nil
	}
	address, err = endpoint(address, "/v1/t2a_v2", false)
	if err != nil {
		cancel()
		return nil, err
	}
	c.wire["text"], c.wire["stream"], c.wire["output_format"], c.wire["subtitle_enable"] = c.text, c.streaming, "hex", c.timing != ""
	if c.streaming {
		c.wire["stream_options"] = map[string]bool{"exclude_aggregated_audio": true}
	}
	if c.timing != "" {
		c.wire["subtitle_type"] = c.timing
	}
	data, err := json.Marshal(c.wire)
	if err != nil {
		cancel()
		return nil, err
	}
	native, err := http.NewRequestWithContext(operation, http.MethodPost, address, bytes.NewReader(data))
	if err != nil {
		cancel()
		return nil, err
	}
	native.Header = http.Header{"Authorization": {"Bearer " + key}, "Content-Type": {"application/json"}}
	transport := options.Transport
	if transport == nil {
		transport = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	response, err := runtime.OpenResponse(native, transport)
	if err != nil {
		cancel()
		return nil, err
	}
	if err = ctx.Err(); err != nil {
		cancel()
		response.Body.Close()
		return nil, err
	}
	s := &httpStream{parent: ctx, ctx: operation, cancel: cancel, transport: transport, response: response, body: response.Body, limit: jsonLimit, timing: c.timing}
	s.stop = context.AfterFunc(operation, func() { s.closeResources() })
	return s, nil
}

func endpoint(base, path string, socket bool) (string, error) {
	invalid := errors.New("Invalid MiniMax endpoint URL")
	u, err := url.Parse(base)
	if err != nil || u.Hostname() == "" || u.User != nil || u.Fragment != "" || strings.Contains(base, "#") || strings.Contains(base, "\\") || strings.IndexFunc(base, func(r rune) bool { return unicode.IsSpace(r) || r < 32 || r == 127 }) >= 0 {
		return "", invalid
	}
	if (!socket && u.Scheme != "http" && u.Scheme != "https") || (socket && u.Scheme != "ws" && u.Scheme != "wss") {
		return "", invalid
	}
	if port := u.Port(); port != "" {
		n, err := strconv.Atoi(port)
		if err != nil || n > 65535 {
			return "", invalid
		}
	}
	if _, err = url.QueryUnescape(u.RawQuery); err != nil {
		return "", invalid
	}
	if path != "" {
		escaped := strings.TrimRight(u.EscapedPath(), "/") + path
		u.Path, err = url.PathUnescape(escaped)
		if err != nil {
			return "", invalid
		}
		u.RawPath = escaped
	}
	return u.String(), nil
}
