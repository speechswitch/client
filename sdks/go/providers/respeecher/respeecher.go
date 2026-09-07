// Package respeecher implements Space TTS directly; its upstream wire contracts are partial.
package respeecher

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/respeecher"
	out "github.com/speechswitch/client/sdks/go/generated/respeecher_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type Options struct {
	Auth auth.Auth
	// Nil selects native HTTP or header-authenticated WebSockets.
	Transport runtime.HTTPTransport
	// Already authenticated, exclusive override; closed even if the stream is unread.
	WebSocket             runtime.WebSocketLike
	BaseURL, WebSocketURL string
	// Empty defaults to websocket for PCM/mulaw and http for WAV.
	Protocol  string
	TimeoutMs runtime.Optional[int64]
	// Zero selects 4 MiB per socket message or JSONL line.
	MaxMessageBytes int
}
type configuration struct {
	settings
	transport     runtime.HTTPTransport
	key, httpURL  string
	socketMode    bool
	limit         int
	validate      runtime.InputValidator
	connectSocket func(context.Context) (runtime.WebSocketLike, error)
}
type result struct {
	item out.SynthesisItem
	err  error
}
type stream struct {
	ctx                            context.Context
	cancel                         context.CancelFunc
	stop                           func() bool
	config                         configuration
	results                        chan result
	start                          sync.Once
	closeOnce                      sync.Once
	nextMutex, resourceMutex       sync.Mutex
	terminal, closed, inputStarted bool
	socket                         runtime.WebSocketLike
	body                           runtime.Input[[]byte]
	closeError                     error
}

// Synthesize validates at the boundary; network I/O starts on the first Next.
// Always Close. Both the operation context and each Next context can cancel all I/O.
func Synthesize(ctx context.Context, request schema.TtsRequest, options Options) (runtime.Input[out.SynthesisItem], error) {
	validate, err := schema.ValidateRequest(request)
	if err != nil {
		return nil, err
	}
	values, err := resolve(request)
	if err != nil {
		return nil, err
	}
	key, ok := os.LookupEnv("SPEECHSWITCH_RESPEECHER_API_KEY")
	if !ok {
		key = os.Getenv("RESPEECHER_API_KEY")
	}
	if options.Auth.Respeecher.Present && options.Auth.Respeecher.Value.ApiKey.Present {
		key = options.Auth.Respeecher.Value.ApiKey.Value
	}
	if key == "" {
		return nil, errors.New("Missing auth.respeecher.apiKey configuration")
	}
	for _, c := range key {
		if c < 32 || c > 126 {
			return nil, errors.New("Respeecher API key must be a printable ASCII header value")
		}
	}
	if options.Protocol != "" && options.Protocol != "http" && options.Protocol != "websocket" {
		return nil, errors.New("Respeecher Protocol must be http or websocket")
	}
	socketMode := !values.wave
	if options.Protocol != "" {
		socketMode = options.Protocol == "websocket"
	}
	if values.wave && socketMode {
		return nil, errors.New("Respeecher WAV output requires HTTP")
	}
	if !socketMode && values.input != nil {
		return nil, errors.New("Respeecher incremental text requires WebSocket")
	}
	if !socketMode && options.WebSocket != nil {
		return nil, errors.New("Respeecher HTTP cannot use a WebSocket override")
	}
	if options.TimeoutMs.Present && (options.TimeoutMs.Value < 0 || options.TimeoutMs.Value > 2147483647) {
		return nil, errors.New("Respeecher TimeoutMs must be between 0 and 2147483647")
	}
	if options.TimeoutMs.Present && options.TimeoutMs.Value == 0 {
		return nil, context.DeadlineExceeded
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	limit := options.MaxMessageBytes
	if limit == 0 {
		limit = 4 * 1024 * 1024
	}
	if limit < 0 {
		return nil, errors.New("Respeecher MaxMessageBytes must be positive")
	}
	base := options.BaseURL
	if base == "" {
		language := "en"
		if values.language == "uk" {
			language = "ua"
		}
		base = "https://api.respeecher.com/v1/public/tts/" + language + "-rt"
	}
	path := "/tts/sse"
	if values.wave {
		path = "/tts/bytes"
	}
	httpURL, err := endpoint(base, path, false)
	if err != nil {
		return nil, err
	}
	socketURL := options.WebSocketURL
	if socketURL == "" {
		raw, err := endpoint(base, "/tts/websocket", false)
		if err != nil {
			return nil, err
		}
		address, _ := url.Parse(raw)
		if address.Scheme == "https" {
			address.Scheme = "wss"
		} else {
			address.Scheme = "ws"
		}
		socketURL = address.String()
	}
	socketURL, err = endpoint(socketURL, "", true)
	if err != nil {
		return nil, err
	}
	transport := options.Transport
	if transport == nil {
		transport = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	var operation context.Context
	var cancel context.CancelFunc
	if options.TimeoutMs.Present {
		operation, cancel = context.WithTimeout(ctx, time.Duration(options.TimeoutMs.Value)*time.Millisecond)
	} else {
		operation, cancel = context.WithCancel(ctx)
	}
	s := &stream{ctx: operation, cancel: cancel, socket: options.WebSocket, results: make(chan result), config: configuration{settings: values, transport: transport, key: key, httpURL: httpURL, socketMode: socketMode, limit: limit, validate: validate}}
	s.config.connectSocket = func(ctx context.Context) (runtime.WebSocketLike, error) {
		return runtime.ConnectWebSocket(ctx, socketURL, runtime.WebSocketOptions{Header: http.Header{"X-Api-Key": {key}}, Transport: options.Transport, MaxMessageBytes: limit})
	}
	s.stop = context.AfterFunc(operation, func() { s.closeResources() })
	return s, nil
}

func endpoint(base, path string, socket bool) (string, error) {
	u, err := url.Parse(base)
	if err != nil || u.Hostname() == "" || u.User != nil || u.Fragment != "" || u.Opaque != "" || strings.ContainsAny(base, "\\\r\n\t ") || (socket && u.Scheme != "ws" && u.Scheme != "wss") || (!socket && u.Scheme != "http" && u.Scheme != "https") {
		return "", errors.New("Invalid Respeecher endpoint URL")
	}
	if path != "" {
		escaped := strings.TrimRight(u.EscapedPath(), "/") + path
		u.Path, err = url.PathUnescape(escaped)
		if err != nil {
			return "", err
		}
		u.RawPath = escaped
	}
	return u.String(), nil
}

func (s *stream) closeResources() error {
	s.closeOnce.Do(func() {
		s.resourceMutex.Lock()
		s.closed = true
		socket, body, inputStarted := s.socket, s.body, s.inputStarted
		s.resourceMutex.Unlock()
		if socket != nil {
			s.closeError = socket.Close()
		}
		if body != nil {
			s.closeError = errors.Join(s.closeError, body.Close())
		}
		// Application producers cannot be forcibly stopped; their Close must not hold cancellation.
		if inputStarted && s.config.input != nil {
			go s.config.input.Close()
		}
	})
	return s.closeError
}
func (s *stream) Close() error { s.stop(); s.cancel(); return s.closeResources() }
func (s *stream) Next(ctx context.Context) (out.SynthesisItem, error) {
	stop := context.AfterFunc(ctx, s.cancel)
	defer stop()
	s.nextMutex.Lock()
	defer s.nextMutex.Unlock()
	if s.terminal {
		return nil, io.EOF
	}
	if err := ctx.Err(); err != nil {
		s.terminal = true
		s.Close()
		return nil, err
	}
	if err := s.ctx.Err(); err != nil {
		s.terminal = true
		s.Close()
		return nil, err
	}
	s.start.Do(func() { go s.run() })
	var r result
	select {
	case r = <-s.results:
	case <-ctx.Done():
		r.err = ctx.Err()
	case <-s.ctx.Done():
		r.err = s.ctx.Err()
	}
	if err := ctx.Err(); err != nil {
		r = result{err: err}
	} else if err := s.ctx.Err(); err != nil {
		r = result{err: err}
	}
	if r.err != nil {
		s.terminal = true
		s.Close()
	}
	return r.item, r.err
}
func (s *stream) emit(item out.SynthesisItem) error {
	select {
	case s.results <- result{item: item}:
		return nil
	case <-s.ctx.Done():
		return s.ctx.Err()
	}
}
func (s *stream) run() {
	var err error
	if err = s.ctx.Err(); err != nil {
		s.closeResources()
		return
	} else if s.config.socketMode {
		err = s.runSocket()
	} else {
		err = s.runHTTP()
	}
	closeError := s.closeResources()
	if err == nil {
		err = closeError
	}
	if err == nil {
		err = s.emit(out.SynthesisItemAsDone{})
		if err == nil {
			err = io.EOF
		}
	}
	select {
	case s.results <- result{err: err}:
	case <-s.ctx.Done():
	}
}
