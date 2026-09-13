// Package voice_ai implements Voice.ai's handwritten HTTP and WebSocket protocol.
package voice_ai

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
	"sync"
	"time"
	"unicode"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/voice_ai"
	out "github.com/speechswitch/client/sdks/go/generated/voice_ai_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type Options struct {
	Auth auth.Auth
	// Nil selects native transports. Overrides must honor cancellation and reject redirects/retries/ambient credentials.
	Transport runtime.HTTPTransport
	// Exclusive, already-authenticated socket override, closed even on boundary failure.
	WebSocket runtime.WebSocketLike
	BaseURL   string
	// Empty selects WebSocket for incremental input/paced output, otherwise streaming HTTP.
	Protocol  string
	TimeoutMs runtime.Optional[int64]
	// Zero selects 4 MiB per JSON socket frame. HTTP audio is not capped.
	MaxMessageBytes int
}
type configuration struct {
	settings
	transport     runtime.HTTPTransport
	headers       http.Header
	url, protocol string
	limit         int
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
	start, closeOnce               sync.Once
	nextMutex, resourceMutex       sync.Mutex
	terminal, closed, inputStarted bool
	socket                         runtime.WebSocketLike
	body                           runtime.Input[[]byte]
	closeError                     error
}

// Synthesize validates and resolves defaults before I/O. First Next starts the
// transport; input ownership begins only after a successful socket handshake.
// Always Close. The parent and each Next context can cancel the whole operation,
// including idle consumer time. Local cancellation does not promise stopped billing.
func Synthesize(ctx context.Context, request schema.TtsRequest, options Options) (input runtime.Input[out.SynthesisItem], err error) {
	defer func() {
		if err != nil && options.WebSocket != nil {
			options.WebSocket.Close()
		}
	}()
	validate, err := schema.ValidateRequest(request)
	if err != nil {
		return nil, err
	}
	values, err := resolve(request, validate)
	if err != nil {
		return nil, err
	}
	key, ok := os.LookupEnv("SPEECHSWITCH_VOICE_AI_API_KEY")
	if !ok {
		key = os.Getenv("VOICE_AI_API_KEY")
	}
	if options.Auth.VoiceAi.Present && options.Auth.VoiceAi.Value.ApiKey.Present {
		key = options.Auth.VoiceAi.Value.ApiKey.Value
	}
	if key == "" {
		return nil, errors.New("Missing auth.voice.ai.apiKey configuration")
	}
	for _, c := range key {
		if c < 33 || c > 126 {
			return nil, errors.New("Voice.ai API key must contain only visible ASCII characters")
		}
	}
	if ctx == nil {
		return nil, errors.New("Voice.ai context is required")
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	if options.TimeoutMs.Present && (options.TimeoutMs.Value < 0 || options.TimeoutMs.Value > 2147483647) {
		return nil, errors.New("Voice.ai TimeoutMs must be between 0 and 2147483647")
	}
	if options.TimeoutMs.Present && options.TimeoutMs.Value == 0 {
		return nil, context.DeadlineExceeded
	}
	limit := options.MaxMessageBytes
	if limit == 0 {
		limit = 4 * 1024 * 1024
	}
	if limit < 0 || uint64(limit) > 9007199254740991 {
		return nil, errors.New("Voice.ai MaxMessageBytes must be a positive safe integer")
	}
	required := values.input != nil || values.paced
	protocol := options.Protocol
	if protocol == "" {
		protocol = "stream"
		if required || options.WebSocket != nil {
			protocol = "websocket"
		}
	}
	if protocol != "stream" && protocol != "http" && protocol != "websocket" {
		return nil, errors.New("Invalid Voice.ai protocol")
	}
	if protocol != "websocket" && required {
		return nil, errors.New("Voice.ai incremental input and paced delivery require WebSocket")
	}
	if protocol != "websocket" && options.WebSocket != nil {
		return nil, errors.New("Voice.ai WebSocket override requires WebSocket transport")
	}
	if protocol == "websocket" && values.legacy {
		return nil, errors.New("Voice.ai legacy API does not document WebSocket synthesis")
	}
	base, path := options.BaseURL, "/api/v1/tts/speech"
	if base == "" {
		base = "https://dev.voice.ai"
		if values.legacy {
			base = "https://api.voice.ai"
		}
	}
	if values.legacy {
		path = "/tts/v2/audio/speech"
		values.wire["streaming"] = protocol == "stream"
	} else if protocol == "stream" {
		path += "/stream"
	} else if protocol == "websocket" {
		path = "/api/v1/tts/multi-stream"
	}
	address, err := endpoint(base, path, protocol == "websocket")
	if err != nil {
		return nil, err
	}
	if protocol == "websocket" {
		values.wire["delivery_mode"] = "raw"
		if values.paced {
			values.wire["delivery_mode"] = "paced"
		}
	} else {
		values.wire["text"] = values.text
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
	headers := http.Header{"Authorization": {"Bearer " + key}}
	s := &stream{ctx: operation, cancel: cancel, socket: options.WebSocket, results: make(chan result), config: configuration{settings: values, transport: transport, headers: headers, url: address, protocol: protocol, limit: limit}}
	s.config.connectSocket = func(ctx context.Context) (runtime.WebSocketLike, error) {
		return runtime.ConnectWebSocket(ctx, address, runtime.WebSocketOptions{Header: headers, Transport: options.Transport, MaxMessageBytes: limit})
	}
	s.stop = context.AfterFunc(operation, func() { s.closeResources() })
	return s, nil
}

func endpoint(base, path string, socket bool) (string, error) {
	invalid := errors.New("Voice.ai BaseURL must be an HTTP or WebSocket base without credentials, query or fragment")
	u, err := url.Parse(base)
	if err != nil || u.Hostname() == "" || u.User != nil || u.Opaque != "" || strings.ContainsAny(base, "?#\\") || strings.IndexFunc(base, func(c rune) bool { return unicode.IsSpace(c) || unicode.IsControl(c) }) >= 0 || (u.Scheme != "http" && u.Scheme != "https" && u.Scheme != "ws" && u.Scheme != "wss") {
		return "", invalid
	}
	if strings.HasSuffix(u.Host, ":") {
		return "", invalid
	}
	if port := u.Port(); port != "" {
		if _, err := strconv.ParseUint(port, 10, 16); err != nil {
			return "", invalid
		}
	}
	if u.Scheme == "http" || u.Scheme == "ws" {
		u.Scheme = "http"
		if socket {
			u.Scheme = "ws"
		}
	} else {
		u.Scheme = "https"
		if socket {
			u.Scheme = "wss"
		}
	}
	escaped := strings.TrimRight(u.EscapedPath(), "/") + path
	u.Path, err = url.PathUnescape(escaped)
	if err != nil {
		return "", invalid
	}
	u.RawPath = escaped
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
		// A user producer cannot hold transport cancellation hostage.
		if started && s.config.input != nil {
			go s.config.input.Close()
		}
	})
	return s.closeError
}
func (s *stream) Close() error { s.stop(); s.cancel(); return s.closeResources() }
func (s *stream) Next(ctx context.Context) (out.SynthesisItem, error) {
	if ctx == nil {
		return nil, errors.New("Voice.ai context is required")
	}
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
	err := s.ctx.Err()
	if err == nil {
		if s.config.protocol == "websocket" {
			err = s.runSocket()
		} else {
			err = s.runHTTP()
		}
	}
	closeErr := s.closeResources()
	if err == nil {
		err = closeErr
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
func (s *stream) runHTTP() error {
	data, err := json.Marshal(s.config.wire)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(s.ctx, "POST", s.config.url, bytes.NewReader(data))
	if err != nil {
		return err
	}
	request.Header = s.config.headers.Clone()
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "audio/*, application/octet-stream")
	response, err := runtime.OpenResponse(request, s.config.transport)
	if err != nil {
		return err
	}
	s.resourceMutex.Lock()
	closed := s.closed
	if !closed {
		s.body = response.Body
	}
	s.resourceMutex.Unlock()
	if closed {
		response.Body.Close()
		return s.ctx.Err()
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return &Error{Status: runtime.Some(response.StatusCode)}
	}
	for key, values := range response.Header {
		if strings.EqualFold(key, "content-type") && len(values) > 0 {
			media := strings.ToLower(strings.TrimSpace(strings.SplitN(values[0], ";", 2)[0]))
			if media != "" && !strings.HasPrefix(media, "audio/") && media != "application/octet-stream" {
				return errors.New("Voice.ai returned an unexpected audio content type")
			}
		}
	}
	received := false
	for {
		chunk, err := response.Body.Next(s.ctx)
		if err == io.EOF {
			if !received {
				return errors.New("Voice.ai returned no audio bytes")
			}
			return nil
		}
		if err != nil {
			return err
		}
		if len(chunk) > 0 {
			received = true
			if err = s.emit(out.SynthesisItemAsBytes{Value: chunk}); err != nil {
				return err
			}
		}
	}
}
