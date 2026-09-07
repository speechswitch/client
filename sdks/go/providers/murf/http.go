package murf

import (
	"bytes"
	"context"
	"errors"
	out "github.com/speechswitch/client/sdks/go/generated/murf_output"
	"github.com/speechswitch/client/sdks/go/runtime"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
)

type httpStream struct {
	parent, ctx                                                          context.Context
	cancel                                                               context.CancelFunc
	stop                                                                 func() bool
	transport                                                            runtime.HTTPTransport
	response                                                             *runtime.HTTPResponse
	body                                                                 runtime.Input[[]byte]
	limit                                                                int
	gen2, timed, inline                                                  bool
	once                                                                 sync.Once
	mutex, lifecycle                                                     sync.Mutex
	closed, initialized, received, audioDone, timingDone, done, terminal bool
	closeError                                                           error
	generation                                                           generation
}

func (s *httpStream) closeResources() error {
	s.once.Do(func() {
		s.cancel()
		s.lifecycle.Lock()
		s.closed = true
		body := s.body
		s.body = nil
		s.lifecycle.Unlock()
		if body != nil {
			s.closeError = body.Close()
		}
	})
	return s.closeError
}
func (s *httpStream) Close() error { s.stop(); return s.closeResources() }
func (s *httpStream) replaceBody(body runtime.Input[[]byte]) error {
	s.lifecycle.Lock()
	old, closed := s.body, s.closed
	if !closed {
		s.body = body
	}
	s.lifecycle.Unlock()
	if old != nil {
		_ = old.Close()
	}
	if closed && body != nil {
		_ = body.Close()
		return s.ctx.Err()
	}
	return nil
}
func readDocument(ctx context.Context, body runtime.Input[[]byte], limit int) ([]byte, error) {
	var data []byte
	for {
		chunk, err := body.Next(ctx)
		if err == io.EOF {
			return bytes.TrimPrefix(data, []byte{239, 187, 191}), nil
		}
		if err != nil {
			return nil, err
		}
		if len(chunk) > limit-len(data) {
			return nil, errors.New("Murf response exceeds MaxJSONBytes")
		}
		data = append(data, chunk...)
	}
}
func responseError(ctx context.Context, response *runtime.HTTPResponse, limit int) error {
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return nil
	}
	data, err := readDocument(ctx, response.Body, limit)
	if err != nil {
		return err
	}
	failure := &Error{StatusCode: runtime.Some(response.StatusCode), Body: runtime.DecodeUTF8(data)}
	if values, present := response.Header["Retry-After"]; present {
		failure.RetryAfter = runtime.Some(strings.Join(values, ", "))
	}
	return failure
}
func (s *httpStream) Next(ctx context.Context) (out.SynthesisItem, error) {
	stop := context.AfterFunc(ctx, func() { s.closeResources() })
	defer stop()
	s.mutex.Lock()
	defer s.mutex.Unlock()
	if s.terminal || s.done {
		return nil, io.EOF
	}
	item, err := s.next(ctx)
	if cause := ctx.Err(); cause != nil {
		item, err = nil, cause
	} else if cause := s.parent.Err(); cause != nil {
		item, err = nil, cause
	} else if s.ctx.Err() != nil && !s.done {
		item, err = nil, io.EOF
	}
	if err != nil {
		s.terminal = true
		s.Close()
	}
	return item, err
}
func (s *httpStream) next(ctx context.Context) (out.SynthesisItem, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if s.ctx.Err() != nil {
		return nil, io.EOF
	}
	if !s.initialized {
		s.initialized = true
		if err := responseError(ctx, s.response, s.limit); err != nil {
			return nil, err
		}
		if s.gen2 {
			data, err := readDocument(ctx, s.response.Body, s.limit)
			if err != nil {
				return nil, err
			}
			s.generation, err = decodeGeneration(data, s.timed, s.inline)
			if err != nil {
				return nil, err
			}
			if err = s.replaceBody(nil); err != nil {
				return nil, err
			}
			if !s.inline {
				target, err := endpoint(s.generation.url, "", false)
				if err != nil {
					return nil, err
				}
				u, _ := url.Parse(target)
				if u.Scheme != "https" {
					return nil, errors.New("Murf returned an unsafe audio file URL")
				}
				request, err := http.NewRequestWithContext(s.ctx, http.MethodGet, target, nil)
				if err != nil {
					return nil, err
				}
				// The audio file is an independent HTTPS resource; never copy API credentials.
				s.response, err = runtime.OpenResponse(request, s.transport)
				if err != nil {
					return nil, err
				}
				if err = s.replaceBody(s.response.Body); err != nil {
					return nil, err
				}
				if err = responseError(ctx, s.response, s.limit); err != nil {
					return nil, err
				}
			}
		} else {
			contentType := strings.ToLower(strings.TrimSpace(strings.SplitN(s.response.Header.Get("Content-Type"), ";", 2)[0]))
			if contentType != "" && !strings.HasPrefix(contentType, "audio/") && contentType != "application/octet-stream" {
				return nil, errors.New("Murf returned a non-audio streaming response")
			}
		}
	}
	if !s.audioDone {
		var data []byte
		var err error
		if s.gen2 && s.inline {
			data, s.audioDone = s.generation.audio, true
			s.generation.audio = nil
		} else {
			data, err = s.response.Body.Next(ctx)
			if err == io.EOF {
				s.audioDone = true
				if err = s.replaceBody(nil); err != nil {
					return nil, err
				}
			} else if err != nil {
				return nil, err
			}
		}
		if len(data) > 0 {
			s.received = true
			if s.timed {
				return out.SynthesisItemAsOrderedOrTimeline{Value: out.MurfEnvelope{Correlation: out.MurfEnvelopeCorrelationAsTimeline{}, Audio: runtime.Some(data), Timestamps: []out.MurfTimestamp{}}}, nil
			}
			return out.SynthesisItemAsBytes{Value: data}, nil
		}
	}
	if !s.received {
		return nil, errors.New("Murf returned no audio")
	}
	if s.timed && !s.timingDone {
		s.timingDone = true
		return out.SynthesisItemAsOrderedOrTimeline{Value: out.MurfEnvelope{Correlation: out.MurfEnvelopeCorrelationAsTimeline{}, DurationMs: runtime.Some(s.generation.duration), Timestamps: s.generation.timestamps}}, nil
	}
	done := out.DoneEvent{}
	if s.gen2 {
		done.RemainingCharacters, done.Warning = runtime.Some(s.generation.remaining), s.generation.warning
	}
	s.done = true
	s.Close()
	return out.SynthesisItemAsDone{Value: done}, nil
}
