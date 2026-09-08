package minimax

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	out "github.com/speechswitch/client/sdks/go/generated/minimax_output"
	"github.com/speechswitch/client/sdks/go/runtime"
	"io"
	"net/http"
	"strings"
	"sync"
)

type httpStream struct {
	parent, ctx                                      context.Context
	cancel                                           context.CancelFunc
	stop                                             func() bool
	transport                                        runtime.HTTPTransport
	response                                         *runtime.HTTPResponse
	body                                             runtime.Input[[]byte]
	limit                                            int
	timing                                           string
	once                                             sync.Once
	mutex, lifecycle                                 sync.Mutex
	closed                                           bool
	closeError                                       error
	initialized, received, subtitles, done, terminal bool
	decoder                                          *runtime.SSEDecoder
	buffer                                           []byte
	final                                            *packet
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
			return nil, errors.New("MiniMax response exceeds MaxJSONBytes")
		}
		data = append(data, chunk...)
	}
}
func (s *httpStream) failure(p packet) *Error {
	code := runtime.Optional[int]{}
	if p.code != 0 {
		code = runtime.Some(p.code)
	}
	retry := runtime.Optional[string]{}
	if values, ok := s.response.Header["Retry-After"]; ok && len(values) > 0 {
		retry = runtime.Some(values[0])
	}
	message := p.message
	if message == "" {
		message = fmt.Sprintf("MiniMax HTTP %d", s.response.StatusCode)
	}
	return &Error{Message: message, Code: code, StatusCode: s.response.StatusCode, RetryAfter: retry}
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
func (s *httpStream) audio(p packet) out.SynthesisItem {
	s.received = true
	if s.timing == "" {
		return out.SynthesisItemAsBytes{Value: p.audio}
	}
	return out.SynthesisItemAsOrderedOrTimeline{Value: out.MiniMaxEnvelope{Correlation: out.MiniMaxEnvelopeCorrelationAsTimeline{}, Audio: runtime.Some(p.audio), Timestamps: []out.MiniMaxTimestamp{}, TraceId: p.trace}}
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
		isSSE := strings.ToLower(strings.TrimSpace(strings.SplitN(s.response.Header.Get("Content-Type"), ";", 2)[0])) == "text/event-stream"
		if s.response.StatusCode < 200 || s.response.StatusCode >= 300 || !isSSE {
			data, err := readDocument(ctx, s.response.Body, s.limit)
			if err != nil {
				return nil, err
			}
			if s.response.StatusCode < 200 || s.response.StatusCode >= 300 {
				if !json.Valid(data) {
					return nil, s.failure(packet{})
				}
				p, err := decodePacket(data)
				if err != nil {
					return nil, err
				}
				return nil, s.failure(p)
			}
			p, err := decodePacket(data)
			if err != nil {
				return nil, err
			}
			if p.code != 0 {
				return nil, s.failure(p)
			}
			if p.status != 2 {
				return nil, errors.New("MiniMax JSON synthesis did not report completion")
			}
			s.final = &p
			if len(p.audio) > 0 {
				return s.audio(p), nil
			}
		} else {
			var err error
			s.decoder, err = runtime.NewSSEDecoder(s.limit)
			if err != nil {
				return nil, err
			}
		}
	}
	for s.final == nil {
		if len(s.buffer) == 0 {
			data, err := s.response.Body.Next(ctx)
			if err == io.EOF {
				return nil, errors.New("MiniMax HTTP stream ended before completion")
			}
			if err != nil {
				return nil, err
			}
			s.buffer = data
		}
		for len(s.buffer) > 0 {
			event, err := s.decoder.Push(s.buffer[0])
			s.buffer = s.buffer[1:]
			if err != nil {
				return nil, err
			}
			if event == nil {
				continue
			}
			if event.Data == "[DONE]" {
				return nil, errors.New("MiniMax HTTP stream ended before completion")
			}
			p, err := decodePacket([]byte(event.Data))
			if err != nil {
				return nil, err
			}
			if p.code != 0 {
				return nil, s.failure(p)
			}
			if p.status != 1 && p.status != 2 {
				return nil, errors.New("MiniMax SSE audio is missing data.status")
			}
			if p.status == 2 {
				s.final = &p
			}
			if len(p.audio) > 0 {
				return s.audio(p), nil
			}
			if s.final != nil {
				break
			}
		}
	}
	if s.decoder != nil {
		s.decoder.Finish()
	}
	s.buffer = nil
	if err := s.replaceBody(nil); err != nil {
		return nil, err
	}
	if !s.received {
		return nil, errors.New("MiniMax returned no audio")
	}
	if s.timing != "" && !s.subtitles {
		if !s.final.subtitle.Present || s.final.subtitle.Value == "" {
			return nil, errors.New("MiniMax omitted requested subtitles")
		}
		target, err := endpoint(s.final.subtitle.Value, "", false)
		if err != nil {
			return nil, err
		}
		request, err := http.NewRequestWithContext(s.ctx, http.MethodGet, target, nil)
		if err != nil {
			return nil, err
		}
		// Never copy synthesis credentials onto the independent file request.
		response, err := runtime.OpenResponse(request, s.transport)
		if err != nil {
			return nil, err
		}
		if err = s.replaceBody(response.Body); err != nil {
			return nil, err
		}
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			return nil, &Error{Message: "MiniMax subtitle download failed", StatusCode: response.StatusCode}
		}
		data, err := readDocument(ctx, response.Body, s.limit)
		if err != nil {
			return nil, err
		}
		marks, err := decodeSubtitles(data, s.timing)
		if err != nil {
			return nil, err
		}
		if err = s.replaceBody(nil); err != nil {
			return nil, err
		}
		s.subtitles = true
		return out.SynthesisItemAsOrderedOrTimeline{Value: out.MiniMaxEnvelope{Correlation: out.MiniMaxEnvelopeCorrelationAsTimeline{}, Timestamps: marks, TraceId: s.final.trace}}, nil
	}
	s.done = true
	s.Close()
	return out.SynthesisItemAsDone{Value: out.MiniMaxDoneEvent{TraceId: s.final.trace, Usage: s.final.usage}}, nil
}
