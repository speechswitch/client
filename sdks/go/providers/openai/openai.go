// Package openai normalizes speech synthesis over the source-generated wire client.
package openai

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	wire "github.com/speechswitch/client/sdks/go/clients/openai"
	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/openai"
	out "github.com/speechswitch/client/sdks/go/generated/openai_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type Options struct {
	Auth auth.Auth
	// Nil uses native HTTP with redirects disabled. Overrides must honor cancellation
	// and reject redirects, implicit retries and ambient credentials.
	Transport runtime.HTTPTransport
	// API root including /v1. Empty selects the source-defined default.
	BaseURL string
	// Omission has no deadline; explicit zero expires before network access.
	Timeout runtime.Optional[time.Duration]
	// Zero selects 4 MiB per SSE event and 16 MiB per error body.
	MaxEventBytes int
	MaxJSONBytes  int
}

type Error struct {
	StatusCode            int
	Body                  string
	RequestID, RetryAfter runtime.Optional[string]
}

func (e *Error) Error() string { return fmt.Sprintf("OpenAI speech failed (%d)", e.StatusCode) }

// Synthesize returns a pull-based stream. Always Close, even if unread. Parent and
// Next contexts cancel transport consumption; they do not promise remote cancellation.
func Synthesize(ctx context.Context, request schema.TtsRequest, options Options) (runtime.Input[out.SynthesisItem], error) {
	if _, err := schema.ValidateRequest(request); err != nil {
		return nil, err
	}
	input, usage, err := settings(request)
	if err != nil {
		return nil, err
	}
	var key string
	if options.Auth.Openai.Present && options.Auth.Openai.Value.ApiKey.Present {
		key = options.Auth.Openai.Value.ApiKey.Value
	} else if scoped, present := os.LookupEnv("SPEECHSWITCH_OPENAI_API_KEY"); present {
		key = scoped
	} else {
		key = os.Getenv("OPENAI_API_KEY")
	}
	if key == "" {
		return nil, errors.New("Missing auth.openai.apiKey configuration")
	}
	for _, r := range key {
		if r < 32 || r > 126 {
			return nil, errors.New("Invalid OpenAI authentication header")
		}
	}
	if options.Timeout.Present && options.Timeout.Value < 0 {
		return nil, errors.New("OpenAI Timeout must not be negative")
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
		return nil, errors.New("OpenAI response byte limits must be positive")
	}
	decoder, err := runtime.NewSSEDecoder(eventLimit)
	if err != nil {
		return nil, err
	}
	baseURL := options.BaseURL
	if baseURL == "" {
		baseURL = wire.DefaultBaseURL
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
	response, err := wire.CreateSpeech(ctx, input, key, baseURL, transport)
	if err != nil {
		cancel()
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		cancel()
		response.Body.Close()
		return nil, err
	}
	done := out.DoneEvent{}
	contentType := ""
	for name, values := range response.Header {
		if len(values) > 0 {
			switch strings.ToLower(name) {
			case "x-request-id":
				done.RequestId = runtime.Some(values[0])
			case "content-type":
				contentType = strings.ToLower(strings.TrimSpace(strings.SplitN(values[0], ";", 2)[0]))
			}
		}
	}
	return &stream{ctx: ctx, cancel: cancel, response: response, decoder: decoder, usage: usage, done: done, jsonLimit: jsonLimit,
		contentType: contentType}, nil
}

type stream struct {
	ctx                            context.Context
	cancel                         context.CancelFunc
	response                       *runtime.HTTPResponse
	decoder                        *runtime.SSEDecoder
	done                           out.DoneEvent
	contentType                    string
	jsonLimit                      int
	usage, receivedAudio, terminal bool
	buffer                         []byte
	mutex                          sync.Mutex
	once                           sync.Once
	closeError                     error
}

func (s *stream) closeBody() error {
	s.once.Do(func() { s.cancel(); s.closeError = s.response.Body.Close() })
	return s.closeError
}
func (s *stream) Close() error {
	err := s.closeBody()
	s.mutex.Lock()
	defer s.mutex.Unlock()
	s.buffer = nil
	s.decoder.Finish()
	return err
}
func (s *stream) Next(ctx context.Context) (out.SynthesisItem, error) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	if s.terminal {
		return nil, io.EOF
	}
	item, err := s.next(ctx)
	if err == nil {
		err = ctx.Err()
		if err == nil {
			err = s.ctx.Err()
		}
		if err != nil {
			item = nil
		}
	}
	_, done := item.(out.SynthesisItemAsDone)
	if err != nil || done {
		s.terminal = true
		s.closeBody()
		s.buffer = nil
		s.decoder.Finish()
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
	if s.response.StatusCode != wire.SpeechStatus {
		var data []byte
		for {
			chunk, err := s.response.Body.Next(ctx)
			if err != nil && err != io.EOF {
				return nil, err
			}
			if len(chunk) > s.jsonLimit-len(data) {
				return nil, errors.New("OpenAI response exceeds MaxJSONBytes")
			}
			data = append(data, chunk...)
			if err == io.EOF {
				break
			}
		}
		retry := runtime.Optional[string]{}
		for name, values := range s.response.Header {
			if strings.EqualFold(name, "retry-after") && len(values) > 0 {
				retry = runtime.Some(values[0])
			}
		}
		return nil, &Error{StatusCode: s.response.StatusCode, Body: runtime.DecodeUTF8(data), RequestID: s.done.RequestId, RetryAfter: retry}
	}
	if !s.usage {
		if s.contentType != "" && s.contentType != "application/octet-stream" && !strings.HasPrefix(s.contentType, "audio/") {
			return nil, errors.New("OpenAI returned a non-audio response")
		}
		audio, err := s.response.Body.Next(ctx)
		if err == io.EOF {
			if !s.receivedAudio {
				return nil, errors.New("OpenAI returned no audio")
			}
			return out.SynthesisItemAsDone{Value: s.done}, nil
		}
		if err != nil {
			return nil, err
		}
		s.receivedAudio = true
		return out.SynthesisItemAsBytes{Value: audio}, nil
	}
	if s.contentType != "text/event-stream" {
		return nil, errors.New("OpenAI returned no SSE usage stream")
	}
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if err := s.ctx.Err(); err != nil {
			return nil, err
		}
		if len(s.buffer) == 0 {
			chunk, err := s.response.Body.Next(ctx)
			if err == io.EOF {
				return nil, errors.New("OpenAI speech stream ended before speech.audio.done")
			}
			if err != nil {
				return nil, err
			}
			s.buffer = chunk
		}
		for len(s.buffer) > 0 {
			message, err := s.decoder.Push(s.buffer[0])
			s.buffer = s.buffer[1:]
			if err != nil {
				return nil, err
			}
			if message == nil {
				continue
			}
			event, err := wire.DecodeSpeechEvent([]byte(message.Data))
			if err != nil {
				return nil, err
			}
			switch event := event.(type) {
			case wire.CreateSpeechResponseStreamEventAsVariant0:
				if message.Event != "message" && message.Event != event.Value.Type {
					return nil, errors.New("OpenAI returned conflicting SSE event types")
				}
				text := event.Value.Audio
				// Go's base64 decoder permits CR/LF; the native JSON field does not.
				if strings.ContainsAny(text, "\r\n") {
					return nil, errors.New("OpenAI returned invalid base64 audio")
				}
				audio, err := base64.StdEncoding.DecodeString(text)
				if err != nil {
					return nil, errors.New("OpenAI returned invalid base64 audio")
				}
				if len(audio) == 0 {
					continue
				}
				s.receivedAudio = true
				return out.SynthesisItemAsBytes{Value: audio}, nil
			case wire.CreateSpeechResponseStreamEventAsVariant1:
				if message.Event != "message" && message.Event != event.Value.Type {
					return nil, errors.New("OpenAI returned conflicting SSE event types")
				}
				if !s.receivedAudio {
					return nil, errors.New("OpenAI returned no audio")
				}
				u := event.Value.Usage
				s.done.Usage = runtime.Some(out.Usage{InputTokens: u.InputTokens, OutputTokens: u.OutputTokens, TotalTokens: u.TotalTokens})
				return out.SynthesisItemAsDone{Value: s.done}, nil
			default:
				return nil, errors.New("Unsupported generated OpenAI event representation")
			}
		}
	}
}
