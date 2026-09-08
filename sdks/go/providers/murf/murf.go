// Package murf implements Murf's Falcon HTTP/WebSocket and Gen2 generation protocols.
package murf

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/murf"
	out "github.com/speechswitch/client/sdks/go/generated/murf_output"
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
	// Nil uses native transports. Overrides must honor cancellation and never replay requests.
	Transport             runtime.HTTPTransport
	WebSocket             runtime.WebSocketLike
	BaseURL, WebSocketURL string
	// Zero selects 16 MiB per JSON/error response and 4 MiB per socket message.
	MaxJSONBytes, MaxMessageBytes int
}

// Synthesize returns one owned stream. Always Close, including unread output.
// Parent and Next contexts cancel setup, input, generation and downloads.
func Synthesize(ctx context.Context, request schema.TtsRequest, options Options) (runtime.Input[out.SynthesisItem], error) {
	validate, err := schema.ValidateRequest(request)
	if err != nil {
		return nil, err
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	c := settings(request)
	if c.input == nil && (options.WebSocket != nil || options.WebSocketURL != "") {
		return nil, errors.New("Murf WebSocket overrides require streaming input")
	}
	jsonLimit, messageLimit := options.MaxJSONBytes, options.MaxMessageBytes
	if jsonLimit == 0 {
		jsonLimit = 16 * 1024 * 1024
	}
	if messageLimit == 0 {
		messageLimit = 4 * 1024 * 1024
	}
	if jsonLimit < 0 || uint64(jsonLimit) > 4294967295 {
		return nil, errors.New("Murf MaxJSONBytes must be a positive uint32 value")
	}
	if messageLimit < 0 || uint64(messageLimit) > 4294967295 {
		return nil, errors.New("Murf MaxMessageBytes must be a positive uint32 value")
	}
	key := ""
	entry := options.Auth.Murf
	if entry.Present && entry.Value.ApiKey.Present {
		key = entry.Value.ApiKey.Value
	} else {
		var present bool
		key, present = os.LookupEnv("SPEECHSWITCH_MURF_API_KEY")
		if !present {
			key = os.Getenv("MURF_API_KEY")
		}
	}
	if key == "" && options.WebSocket == nil {
		return nil, errors.New("Missing auth.murf.apiKey configuration")
	}
	for _, r := range key {
		if r < 32 || r > 126 {
			return nil, errors.New("Invalid Murf authentication header")
		}
	}
	base := options.BaseURL
	if base == "" {
		base = "https://global.api.murf.ai"
		if c.gen2 {
			base = "https://api.murf.ai"
		}
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
			address, err = endpoint(u.String(), "/v1/speech/stream-input", true)
		}
		if err != nil {
			cancel()
			return nil, err
		}
		u, _ := url.Parse(address)
		// Preserve unrelated raw query values, including escapes and semicolons.
		query := []string{}
		for _, part := range strings.Split(u.RawQuery, "&") {
			key, _ := url.QueryUnescape(strings.SplitN(part, "=", 2)[0])
			switch key {
			case "api_key", "model", "format", "sample_rate", "channel_type":
			default:
				if part != "" {
					query = append(query, part)
				}
			}
		}
		q := url.Values{}
		q.Set("model", "falcon-2")
		q.Set("format", c.format)
		q.Set("sample_rate", strconv.FormatFloat(c.rate, 'f', 0, 64))
		q.Set("channel_type", c.channel)
		u.RawQuery = strings.Join(append(query, q.Encode()), "&")
		var nonce [16]byte
		if _, err = rand.Read(nonce[:]); err != nil {
			cancel()
			return nil, err
		}
		socket := options.WebSocket
		if socket == nil {
			socket, err = runtime.ConnectWebSocket(operation, u.String(), runtime.WebSocketOptions{Header: http.Header{"Api_key": {key}}, MaxMessageBytes: messageLimit})
			if err != nil {
				cancel()
				return nil, err
			}
		}
		idle := make(chan struct{})
		close(idle)
		s := &socketStream{parent: ctx, ctx: operation, cancel: cancel, socket: socket, input: c.input, voice: c.voice,
			threshold: c.threshold, delay: c.delay, limit: messageLimit, validate: validate, session: hex.EncodeToString(nonce[:]), inputIdle: idle,
			contexts: map[string]*contextState{}, retired: map[string]bool{}, preferOutput: true}
		s.stop = context.AfterFunc(operation, func() { s.closeResources() })
		return s, nil
	}
	path, accept := "/v1/speech/stream", "audio/*, application/octet-stream"
	if c.gen2 {
		path, accept = "/v1/speech/generate", "application/json"
	}
	address, err = endpoint(address, path, false)
	if err != nil {
		cancel()
		return nil, err
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
	native.Header = http.Header{"Api-Key": {key}, "Content-Type": {"application/json"}, "Accept": {accept}}
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
	s := &httpStream{parent: ctx, ctx: operation, cancel: cancel, transport: transport, response: response, body: response.Body,
		limit: jsonLimit, gen2: c.gen2, timed: c.timed, inline: c.inline}
	s.stop = context.AfterFunc(operation, func() { s.closeResources() })
	return s, nil
}

func endpoint(base, suffix string, socket bool) (string, error) {
	invalid := errors.New("Invalid Murf endpoint URL")
	u, err := url.Parse(base)
	if err != nil || u.Hostname() == "" || u.User != nil || strings.ContainsAny(base, "#\\") || strings.ContainsFunc(base, func(r rune) bool { return unicode.IsSpace(r) || r < 32 || r == 127 }) {
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
	if suffix != "" {
		escaped := strings.TrimRight(u.EscapedPath(), "/") + suffix
		u.Path, err = url.PathUnescape(escaped)
		if err != nil {
			return "", invalid
		}
		u.RawPath = escaped
	}
	return u.String(), nil
}
