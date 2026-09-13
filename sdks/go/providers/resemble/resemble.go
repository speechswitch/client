// Package resemble implements the deployed Chatterbox Gradio upload/queue/file protocol.
package resemble

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/resemble"
	out "github.com/speechswitch/client/sdks/go/generated/resemble_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type Options struct {
	Auth auth.Auth
	// Nil uses native HTTP with redirects disabled. Overrides must honor
	// cancellation, reject redirects/retries and add no ambient credentials.
	Transport runtime.HTTPTransport
	// Deployment root; empty selects the model's official Space.
	BaseURL string
	// Omission has no deadline; explicit zero prevents network I/O.
	Timeout runtime.Optional[time.Duration]
	// Zero selects 4 MiB per queue event and 16 MiB per metadata/error body.
	MaxEventBytes, MaxJSONBytes int
}

type Error struct {
	StatusCode            runtime.Optional[int]
	Body                  string
	RequestID, RetryAfter runtime.Optional[string]
}

func (e *Error) Error() string {
	if e.StatusCode.Present {
		return fmt.Sprintf("Resemble Chatterbox returned HTTP %d", e.StatusCode.Value)
	}
	return "Resemble Chatterbox generation failed"
}

type config struct {
	input     input
	base      *url.URL
	headers   http.Header
	transport runtime.HTTPTransport
	jsonLimit int
}

// Synthesize returns a lazy stream. Always Close, including unread streams.
// Generation completes before file download. Cancellation stops local work,
// not the remote GPU job or its cached files.
func Synthesize(ctx context.Context, request schema.TtsRequest, options Options) (runtime.Input[out.SynthesisItem], error) {
	if _, err := schema.ValidateRequest(request); err != nil {
		return nil, err
	}
	input, err := settings(request)
	if err != nil {
		return nil, err
	}
	baseURL := options.BaseURL
	if baseURL == "" {
		baseURL = input.host
	}
	base, err := parseURL(baseURL)
	if err != nil {
		return nil, err
	}
	base.RawPath = strings.TrimRight(base.EscapedPath(), "/") + "/"
	base.Path, _ = url.PathUnescape(base.RawPath)
	token := ""
	if options.Auth.Resemble.Present && options.Auth.Resemble.Value.Token.Present {
		token = options.Auth.Resemble.Value.Token.Value
	} else if value, present := os.LookupEnv("SPEECHSWITCH_RESEMBLE_TOKEN"); present {
		token = value
	} else {
		token = os.Getenv("HF_TOKEN")
	}
	for _, r := range token {
		if r < 32 || r > 126 {
			return nil, errors.New("Invalid Resemble token")
		}
	}
	headers := http.Header{}
	if token != "" {
		headers.Set("Authorization", "Bearer "+token)
	}
	if options.Timeout.Present && options.Timeout.Value < 0 {
		return nil, errors.New("Resemble Timeout must not be negative")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if options.Timeout.Present && options.Timeout.Value == 0 {
		return nil, context.DeadlineExceeded
	}
	eventLimit, jsonLimit := options.MaxEventBytes, options.MaxJSONBytes
	if eventLimit == 0 {
		eventLimit = 4 * 1024 * 1024
	}
	if jsonLimit == 0 {
		jsonLimit = 16 * 1024 * 1024
	}
	if eventLimit < 0 || jsonLimit < 0 {
		return nil, errors.New("Resemble response byte limits must be positive")
	}
	decoder, err := runtime.NewSSEDecoder(eventLimit)
	if err != nil {
		return nil, err
	}
	transport := options.Transport
	if transport == nil {
		transport = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	var cancel context.CancelFunc
	if options.Timeout.Present {
		ctx, cancel = context.WithTimeout(ctx, options.Timeout.Value)
	} else {
		ctx, cancel = context.WithCancel(ctx)
	}
	return &stream{ctx: ctx, cancel: cancel, decoder: decoder,
		config: config{input: input, base: base, headers: headers, transport: transport, jsonLimit: jsonLimit}}, nil
}

func parseURL(value string) (*url.URL, error) {
	invalid := errors.New("Invalid Resemble deployment or audio URL")
	u, err := url.Parse(value)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || u.Fragment != "" {
		return nil, invalid
	}
	for _, r := range value {
		if r <= 32 || r == 127 || r == '\\' {
			return nil, invalid
		}
	}
	if port := u.Port(); port != "" {
		n, err := strconv.Atoi(port)
		if err != nil || n > 65535 {
			return nil, invalid
		}
	}
	if _, err := url.QueryUnescape(u.RawQuery); err != nil {
		return nil, invalid
	}
	return u, nil
}
func origin(u *url.URL) string {
	port := u.Port()
	if port == "" {
		if u.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	number, _ := strconv.Atoi(port)
	return u.Scheme + "://" + strings.ToLower(u.Hostname()) + ":" + strconv.Itoa(number)
}
func endpoint(base *url.URL, path string) string {
	u := *base
	u.RawPath = strings.TrimRight(base.EscapedPath(), "/") + "/gradio_api/" + path
	u.Path, _ = url.PathUnescape(u.RawPath)
	return u.String()
}
func component(value string) string { return strings.ReplaceAll(url.QueryEscape(value), "+", "%20") }

type stream struct {
	ctx                         context.Context
	cancel                      context.CancelFunc
	config                      config
	mutex                       sync.Mutex
	body                        runtime.Input[[]byte]
	decoder                     *runtime.SSEDecoder
	requestID                   runtime.Optional[string]
	started, received, terminal bool
}

func (s *stream) release() error {
	body := s.body
	s.body = nil
	if body != nil {
		return body.Close()
	}
	return nil
}
func (s *stream) Close() error {
	// Cancellation closes an idle body and unblocks pending headers/reads before
	// waiting for Next's lock. Only Next/Close access mutable protocol state.
	s.cancel()
	s.mutex.Lock()
	defer s.mutex.Unlock()
	s.terminal = true
	s.config.input.data, s.config.input.reference.Value = nil, nil
	s.decoder.Finish()
	return s.release()
}
func (s *stream) Next(ctx context.Context) (out.SynthesisItem, error) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	if s.terminal {
		return nil, io.EOF
	}
	stop := context.AfterFunc(ctx, s.cancel)
	defer stop()
	item, err := s.next(ctx)
	if cause := ctx.Err(); cause != nil {
		item, err = nil, cause
	} else if cause := s.ctx.Err(); cause != nil {
		item, err = nil, cause
	}
	_, done := item.(out.SynthesisItemAsDone)
	if err != nil || done {
		s.terminal = true
		s.cancel()
		s.release()
		s.decoder.Finish()
		s.config.input.data, s.config.input.reference.Value = nil, nil
	}
	return item, err
}
func (s *stream) next(ctx context.Context) (out.SynthesisItem, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := s.ctx.Err(); err != nil {
		return nil, err
	}
	if !s.started {
		s.started = true
		if err := s.prepare(); err != nil {
			return nil, err
		}
		s.config.input.data, s.config.input.reference.Value = nil, nil
	}
	audio, err := s.body.Next(s.ctx)
	if err == io.EOF {
		s.release()
		if !s.received {
			return nil, errors.New("Resemble returned empty audio")
		}
		return out.SynthesisItemAsDone{Value: out.DoneEvent{RequestId: s.requestID.Value}}, nil
	}
	if err != nil {
		return nil, err
	}
	s.received = true
	return out.SynthesisItemAsBytes{Value: audio}, nil
}
