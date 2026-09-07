// Package smallest_ai implements the handwritten Smallest.ai TTS wire protocol.
package smallest_ai

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/smallest_ai"
	out "github.com/speechswitch/client/sdks/go/generated/smallest_ai_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type Options struct {
	Auth auth.Auth
	// Nil selects native HTTP/WebSocket transports; overrides must honor cancellation and reject redirects.
	Transport runtime.HTTPTransport
	// Exclusive, already-authenticated/configured override; closed even when unread or rejected at preflight.
	WebSocket             runtime.WebSocketLike
	BaseURL, WebSocketURL string
	// Empty selects SSE for whole text, WebSocket for incremental text/timestamps.
	Protocol           string
	TimeoutMs          runtime.Optional[int64]
	IdleTimeoutSeconds runtime.Optional[int64]
	// Zero selects 4 MiB per WebSocket message or SSE event, not total synthesis.
	MaxMessageBytes int
}
type configuration struct {
	settings
	transport         runtime.HTTPTransport
	headers           http.Header
	httpURL, protocol string
	limit             int
	connectSocket     func(context.Context) (runtime.WebSocketLike, error)
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
	start, closeOnce               sync.Once
	nextMutex, resourceMutex       sync.Mutex
	terminal, closed, inputStarted bool
	socket                         runtime.WebSocketLike
	body                           runtime.Input[[]byte]
	closeError                     error
}

// Synthesize resolves and validates before I/O. The first Next starts networking.
// Always Close. Continuations emit batches until context cancellation or Close;
// neither a native segment completion nor silence proves final completion.
func Synthesize(ctx context.Context, request schema.TtsRequest, options Options) (input runtime.Input[out.SynthesisItem], err error) {
	defer func() {
		if err != nil && options.WebSocket != nil {
			options.WebSocket.Close()
		}
	}()
	request = trimRequest(request)
	validate, err := schema.ValidateRequest(request)
	if err != nil {
		return nil, err
	}
	values, err := resolve(request, validate)
	if err != nil {
		return nil, err
	}
	key, ok := os.LookupEnv("SPEECHSWITCH_SMALLEST_API_KEY")
	if !ok {
		key = os.Getenv("SMALLEST_API_KEY")
	}
	if options.Auth.SmallestAi.Present && options.Auth.SmallestAi.Value.ApiKey.Present {
		key = options.Auth.SmallestAi.Value.ApiKey.Value
	}
	if key == "" {
		return nil, errors.New("Missing auth.smallest.ai.apiKey configuration")
	}
	for _, c := range key {
		if c < 32 || c > 126 {
			return nil, errors.New("Smallest.ai API key must be a printable ASCII header value")
		}
	}
	if ctx == nil {
		return nil, errors.New("Smallest.ai context is required")
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	if options.TimeoutMs.Present && (options.TimeoutMs.Value < 0 || options.TimeoutMs.Value > 2147483647) {
		return nil, errors.New("Smallest.ai TimeoutMs must be between 0 and 2147483647")
	}
	if options.TimeoutMs.Present && options.TimeoutMs.Value == 0 {
		return nil, context.DeadlineExceeded
	}
	idle := int64(60)
	if options.IdleTimeoutSeconds.Present {
		idle = options.IdleTimeoutSeconds.Value
	}
	if idle <= 0 || idle > 9007199254740991 {
		return nil, errors.New("Smallest.ai IdleTimeoutSeconds must be a positive safe integer")
	}
	limit := options.MaxMessageBytes
	if limit == 0 {
		limit = 4 * 1024 * 1024
	}
	if limit < 0 {
		return nil, errors.New("Smallest.ai MaxMessageBytes must be positive")
	}
	required := values.input != nil || values.timed || options.WebSocket != nil || options.WebSocketURL != ""
	protocol := options.Protocol
	if protocol == "" {
		protocol = "sse"
		if required {
			protocol = "websocket"
		}
	}
	if protocol != "http" && protocol != "sse" && protocol != "websocket" {
		return nil, errors.New("Invalid Smallest.ai protocol")
	}
	if protocol != "websocket" && required {
		return nil, errors.New("Smallest.ai incremental text, timestamps and socket overrides require WebSocket transport")
	}
	if protocol == "websocket" && values.dictionaries {
		return nil, errors.New("Smallest.ai pronunciation dictionaries are documented only for HTTP/SSE")
	}
	base := options.BaseURL
	if base == "" {
		base = "https://api.smallest.ai"
	}
	path := "/waves/v1/tts"
	if protocol != "http" {
		path += "/live"
	}
	httpURL, err := endpoint(base, path, false)
	if err != nil {
		return nil, err
	}
	socketURL := options.WebSocketURL
	if protocol == "websocket" {
		address, _ := url.Parse(httpURL)
		if address.Scheme == "https" {
			address.Scheme = "wss"
		} else {
			address.Scheme = "ws"
		}
		if socketURL == "" {
			socketURL = address.String()
		}
		socketURL, err = endpoint(socketURL, "", true)
		if err != nil {
			return nil, err
		}
		address, _ = url.Parse(socketURL)
		query, err := url.ParseQuery(address.RawQuery)
		if err != nil {
			return nil, err
		}
		query.Set("timeout", strconv.FormatInt(idle, 10))
		address.RawQuery = query.Encode()
		socketURL = address.String()
	}
	headers := http.Header{"Authorization": {"Bearer " + key}}
	if values.retention {
		headers.Set("x-expire-content", "true")
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
	s := &stream{ctx: operation, cancel: cancel, socket: options.WebSocket, results: make(chan result), config: configuration{settings: values, transport: transport, headers: headers, httpURL: httpURL, protocol: protocol, limit: limit}}
	s.config.connectSocket = func(ctx context.Context) (runtime.WebSocketLike, error) {
		return runtime.ConnectWebSocket(ctx, socketURL, runtime.WebSocketOptions{Header: headers, Transport: options.Transport, MaxMessageBytes: limit})
	}
	s.stop = context.AfterFunc(operation, func() { s.closeResources() })
	return s, nil
}

func endpoint(base, path string, socket bool) (string, error) {
	u, err := url.Parse(base)
	if err != nil || u.Hostname() == "" || u.User != nil || u.Fragment != "" || u.Opaque != "" || strings.ContainsAny(base, "\\\r\n\t ") || (socket && u.Scheme != "ws" && u.Scheme != "wss") || (!socket && u.Scheme != "http" && u.Scheme != "https") {
		return "", errors.New("Invalid Smallest.ai endpoint URL")
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
		socket, body, started := s.socket, s.body, s.inputStarted
		s.resourceMutex.Unlock()
		if socket != nil {
			s.closeError = socket.Close()
		}
		if body != nil {
			s.closeError = errors.Join(s.closeError, body.Close())
		}
		// Application cleanup must not hold transport cancellation hostage.
		if started && s.config.input != nil {
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
	} else if s.config.protocol == "websocket" {
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
