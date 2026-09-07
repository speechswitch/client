// Package xai implements xAI's handwritten HTTP/WebSocket protocol over generated contracts.
package xai

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
	"unicode/utf8"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/xai"
	out "github.com/speechswitch/client/sdks/go/generated/xai_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type Options struct {
	Auth auth.Auth
	// Nil selects native HTTP/WebSocket. Overrides must honor cancellation and reject redirects/retries/ambient credentials.
	Transport runtime.HTTPTransport
	// Exclusive, already authenticated/configured override; closed even on boundary failure.
	WebSocket             runtime.WebSocketLike
	BaseURL, WebSocketURL string
	TimeoutMs             runtime.Optional[int64]
	// Zero selects 4 MiB per JSON socket message, 16 MiB per buffered timing response.
	// Raw HTTP audio is never buffered or size-capped.
	MaxMessageBytes, MaxResponseBytes int
}
type configuration struct {
	settings
	transport                   runtime.HTTPTransport
	headers                     http.Header
	url                         string
	messageLimit, responseLimit int
	validate                    runtime.InputValidator
	connectSocket               func(context.Context) (runtime.WebSocketLike, error)
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

// Synthesize validates before I/O; first Next starts the transport. Always Close.
// String input uses byte-native HTTP, incremental input uses native authenticated
// WebSocket. Parent and Next contexts cancel the entire operation, including idle
// consumer time. Done is emitted only for a native audio.done acknowledgement.
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
	values, err := resolve(request)
	if err != nil {
		return nil, err
	}
	key, err := apiKey(options.Auth)
	if err != nil {
		return nil, err
	}
	messageLimit, responseLimit := options.MaxMessageBytes, options.MaxResponseBytes
	if messageLimit == 0 {
		messageLimit = 4 * 1024 * 1024
	}
	if responseLimit == 0 {
		responseLimit = 16 * 1024 * 1024
	}
	if messageLimit < 0 || uint64(messageLimit) > 9007199254740991 {
		return nil, errors.New("xAI MaxMessageBytes must be a positive safe integer")
	}
	if responseLimit < 0 || uint64(responseLimit) > 9007199254740991 {
		return nil, errors.New("xAI MaxResponseBytes must be a positive safe integer")
	}
	socketMode := values.input != nil
	if !socketMode && (options.WebSocket != nil || options.WebSocketURL != "") {
		return nil, errors.New("xAI socket overrides require streaming input")
	}
	base := options.BaseURL
	if base == "" {
		base = "https://api.x.ai"
	}
	address, err := endpoint(base, "/v1/tts", socketMode)
	if err != nil {
		return nil, err
	}
	if socketMode {
		if options.WebSocketURL != "" {
			address, err = endpoint(options.WebSocketURL, "", true)
			if err != nil {
				return nil, err
			}
		}
		address, err = socketURL(address, values.wire)
		if err != nil {
			return nil, err
		}
	} else {
		values.wire["text"] = values.text
	}
	operation, cancel, err := operationContext(ctx, options.TimeoutMs)
	if err != nil {
		return nil, err
	}
	transport := options.Transport
	if transport == nil {
		transport = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	headers := http.Header{"Authorization": {"Bearer " + key}}
	s := &stream{ctx: operation, cancel: cancel, socket: options.WebSocket, results: make(chan result), config: configuration{settings: values, transport: transport, headers: headers, url: address, messageLimit: messageLimit, responseLimit: responseLimit, validate: validate}}
	s.config.connectSocket = func(ctx context.Context) (runtime.WebSocketLike, error) {
		return runtime.ConnectWebSocket(ctx, address, runtime.WebSocketOptions{Header: headers, Transport: options.Transport, MaxMessageBytes: messageLimit})
	}
	s.stop = context.AfterFunc(operation, func() { s.closeResources() })
	return s, nil
}

func apiKey(a auth.Auth) (string, error) {
	key, ok := os.LookupEnv("SPEECHSWITCH_XAI_API_KEY")
	if !ok {
		key = os.Getenv("XAI_API_KEY")
	}
	if a.Xai.Present && a.Xai.Value.ApiKey.Present {
		key = a.Xai.Value.ApiKey.Value
	}
	if key == "" {
		return "", errors.New("Missing auth.xai.apiKey configuration")
	}
	for _, c := range key {
		if c < 33 || c > 126 {
			return "", errors.New("xAI API key must contain only visible ASCII characters")
		}
	}
	return key, nil
}
func operationContext(ctx context.Context, timeout runtime.Optional[int64]) (context.Context, context.CancelFunc, error) {
	if ctx == nil {
		return nil, nil, errors.New("xAI context is required")
	}
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	if timeout.Present && (timeout.Value < 0 || timeout.Value > 2147483647) {
		return nil, nil, errors.New("xAI TimeoutMs must be between 0 and 2147483647")
	}
	if timeout.Present && timeout.Value == 0 {
		return nil, nil, context.DeadlineExceeded
	}
	if timeout.Present {
		operation, cancel := context.WithTimeout(ctx, time.Duration(timeout.Value)*time.Millisecond)
		return operation, cancel, nil
	}
	operation, cancel := context.WithCancel(ctx)
	return operation, cancel, nil
}
func endpoint(base, path string, socket bool) (string, error) {
	invalid := errors.New("xAI endpoint must be HTTP(S) or WS(S) without credentials, fragments or invalid escapes")
	u, err := url.Parse(base)
	if err != nil || u.Hostname() == "" || u.User != nil || u.Opaque != "" || strings.ContainsAny(base, "#\\") || !utf8.ValidString(base) || strings.IndexFunc(base, func(c rune) bool { return unicode.IsSpace(c) || unicode.IsControl(c) }) >= 0 || (u.Scheme != "http" && u.Scheme != "https" && u.Scheme != "ws" && u.Scheme != "wss") {
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
	// Parse also validates query escapes before any credentials can be sent.
	if _, err := url.ParseQuery(u.RawQuery); err != nil {
		return "", invalid
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
func socketURL(address string, wire map[string]any) (string, error) {
	u, _ := url.Parse(address)
	query, err := url.ParseQuery(u.RawQuery)
	if err != nil {
		return "", err
	}
	for _, key := range []string{"language", "voice", "codec", "sample_rate", "bit_rate", "speed", "optimize_streaming_latency", "text_normalization", "with_timestamps"} {
		query.Del(key)
	}
	values := make(map[string]any, len(wire))
	for key, value := range wire {
		switch key {
		case "replace":
		case "voice_id":
			values["voice"] = value
		case "output_format":
			for k, v := range value.(map[string]any) {
				values[k] = v
			}
		default:
			values[key] = value
		}
	}
	for key, value := range values {
		switch v := value.(type) {
		case string:
			query.Set(key, v)
		case bool:
			query.Set(key, strconv.FormatBool(v))
		case float64:
			query.Set(key, strconv.FormatFloat(v, 'f', -1, 64))
		case int:
			query.Set(key, strconv.Itoa(v))
		default:
			return "", errors.New("Unsupported xAI socket parameter")
		}
	}
	u.RawQuery = query.Encode()
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
		// Application producers cannot be forcibly stopped or hold transport cleanup.
		if started {
			go s.config.input.Close()
		}
	})
	return s.closeError
}
func (s *stream) Close() error { s.stop(); s.cancel(); return s.closeResources() }
func (s *stream) Next(ctx context.Context) (out.SynthesisItem, error) {
	if ctx == nil {
		s.Close()
		return nil, errors.New("xAI context is required")
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
		if s.config.input != nil {
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
		err = io.EOF
	}
	select {
	case s.results <- result{err: err}:
	case <-s.ctx.Done():
	}
}
func contentType(header http.Header, timed bool) error {
	for key, values := range header {
		if strings.EqualFold(key, "content-type") {
			for _, value := range values {
				media := strings.ToLower(strings.TrimSpace(strings.SplitN(value, ";", 2)[0]))
				if media != "" && (timed && media != "application/json" || !timed && !strings.HasPrefix(media, "audio/") && media != "application/octet-stream") {
					return errors.New("xAI returned an unexpected content type")
				}
			}
		}
	}
	return nil
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
	if s.config.timed {
		request.Header.Set("Accept", "application/json")
	}
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
	if err := contentType(response.Header, s.config.timed); err != nil {
		return err
	}
	if s.config.timed {
		value, err := readJSON(s.ctx, response.Body, s.config.responseLimit)
		if err != nil {
			return err
		}
		fields, ok := value.(map[string]any)
		if !ok {
			return errors.New("Invalid xAI timestamped audio response")
		}
		item, err := audio(fields, "audio", "duration")
		if err != nil {
			return err
		}
		return s.emit(out.SynthesisItemAsChunk{Value: item})
	}
	received := false
	for {
		chunk, err := response.Body.Next(s.ctx)
		if err == io.EOF {
			if !received {
				return errors.New("xAI returned no audio bytes")
			}
			return nil
		}
		if err != nil {
			return err
		}
		if len(chunk) > 0 {
			received = true
			if err := s.emit(out.SynthesisItemAsBytes{Value: chunk}); err != nil {
				return err
			}
		}
	}
}
