// Package lovo implements job orchestration over the OpenAPI-generated HTTP client.
package lovo

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode"

	wire "github.com/speechswitch/client/sdks/go/clients/lovo"
	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/lovo"
	out "github.com/speechswitch/client/sdks/go/generated/lovo_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type Options struct {
	Auth auth.Auth
	// Nil uses native HTTP. Overrides must honor cancellation and reject redirects/retries.
	Transport runtime.HTTPTransport
	BaseURL   string
	// Omission selects synchronous submission and 1000 ms polling.
	Mode           runtime.Optional[string]
	PollIntervalMs runtime.Optional[int]
	// Zero selects the 16 MiB metadata/error-body limit.
	MaxJSONBytes int
}

type Error struct {
	Message                 string
	StatusCode              runtime.Optional[int]
	Code, JobID, RetryAfter runtime.Optional[string]
}

func (e *Error) Error() string { return e.Message }

type config struct {
	transport            runtime.HTTPTransport
	key, baseURL, origin string
	async                bool
	interval             time.Duration
	limit                int
	input                wire.CreateSpeechInput
}

// Synthesize validates without sending a job until the first Next. Always Close,
// including unread streams. Cancellation stops local work, not the remote job.
func Synthesize(ctx context.Context, request schema.TtsRequest, options Options) (runtime.Input[out.SynthesisItem], error) {
	if _, err := schema.ValidateRequest(request); err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	mode := "sync"
	if options.Mode.Present {
		mode = options.Mode.Value
	}
	if mode != "sync" && mode != "async" {
		return nil, errors.New("Invalid LOVO mode")
	}
	interval := 1000
	if options.PollIntervalMs.Present {
		interval = options.PollIntervalMs.Value
	}
	if interval < 0 || int64(interval) > 2147483647 {
		return nil, errors.New("LOVO polling interval must be an integer between 0 and 2147483647")
	}
	limit := options.MaxJSONBytes
	if limit == 0 {
		limit = 16 * 1024 * 1024
	}
	if limit < 0 || uint64(limit) > 4294967295 {
		return nil, errors.New("LOVO MaxJSONBytes must be a positive uint32 value")
	}
	key := ""
	entry := options.Auth.Lovo
	if entry.Present && entry.Value.ApiKey.Present {
		key = entry.Value.ApiKey.Value
	} else if value, present := os.LookupEnv("SPEECHSWITCH_LOVO_API_KEY"); present {
		key = value
	} else {
		key = os.Getenv("LOVO_API_KEY")
	}
	if key == "" {
		return nil, errors.New("Missing auth.lovo.apiKey configuration")
	}
	for _, r := range key {
		if r < 32 || r > 126 {
			return nil, errors.New("Invalid LOVO authentication header")
		}
	}
	baseURL := options.BaseURL
	if baseURL == "" {
		baseURL = wire.DefaultBaseURL
	}
	base, err := endpoint(baseURL)
	if err != nil {
		return nil, err
	}
	transport := options.Transport
	if transport == nil {
		transport = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	speed := 1.0
	if request.Speed.Present {
		speed = request.Speed.Value
	}
	c := config{transport: transport, key: key, baseURL: base.String(), origin: origin(base), async: mode == "async",
		interval: time.Duration(interval) * time.Millisecond, limit: limit,
		input: wire.CreateSpeechInput{Text: request.Text, Speaker: request.Voice, Speed: runtime.Some(speed), SpeakerStyle: request.VoiceStyle}}
	operation, cancel := context.WithCancel(ctx)
	return &stream{ctx: operation, cancel: cancel, config: c}, nil
}

func endpoint(value string) (*url.URL, error) {
	u, err := url.Parse(value)
	invalid := errors.New("LOVO URL must be HTTP(S) without credentials, fragments or invalid escapes")
	if err != nil || u.Hostname() == "" || u.User != nil || u.Fragment != "" || u.Opaque != "" ||
		(u.Scheme != "http" && u.Scheme != "https") || strings.ContainsFunc(value, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) || r == '\\' }) {
		return nil, invalid
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

type asset struct{ url, correlationID, inputGroupID string }
type stream struct {
	ctx               context.Context
	cancel            context.CancelFunc
	config            config
	mutex, resources  sync.Mutex
	closed            atomic.Bool
	body              runtime.Input[[]byte]
	started, terminal bool
	assets            []asset
	index             int
	jobID             string
}

func (s *stream) Close() error {
	s.closed.Store(true)
	s.cancel()
	return s.release()
}
func (s *stream) release() error {
	s.resources.Lock()
	body := s.body
	s.body = nil
	s.resources.Unlock()
	if body != nil {
		return body.Close()
	}
	return nil
}
func (s *stream) bind(body runtime.Input[[]byte]) error {
	s.resources.Lock()
	err := s.ctx.Err()
	if err == nil {
		s.body = body
	}
	s.resources.Unlock()
	if err != nil {
		body.Close()
	}
	return err
}
