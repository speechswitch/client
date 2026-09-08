package murf

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	out "github.com/speechswitch/client/sdks/go/generated/murf_output"
	"github.com/speechswitch/client/sdks/go/runtime"
	"io"
	"maps"
	"sync"
	"unicode/utf16"
)

type contextState struct{ ended, written, flush, audio, final bool }
type inputResult struct {
	value Input
	err   error
}
type socketResult struct {
	value runtime.WebSocketMessage
	err   error
}
type write struct {
	value map[string]any
	endID string
}
type socketStream struct {
	parent, ctx                                      context.Context
	cancel                                           context.CancelFunc
	stop                                             func() bool
	socket                                           runtime.WebSocketLike
	input                                            runtime.Input[Input]
	voice                                            map[string]any
	threshold, delay                                 float64
	limit                                            int
	validate                                         runtime.InputValidator
	session                                          string
	sequence                                         uint64
	contexts                                         map[string]*contextState
	order                                            []string
	retired                                          map[string]bool
	current                                          string
	once                                             sync.Once
	mutex, lifecycle                                 sync.Mutex
	closeError                                       error
	inputIdle                                        <-chan struct{}
	started, terminal, done, inputDone, preferOutput bool
	pendingInput                                     <-chan inputResult
	pendingOutput                                    <-chan socketResult
	pendingSend                                      <-chan error
	writingEnd                                       string
	queue                                            []write
}

func (s *socketStream) closeResources() error {
	s.once.Do(func() {
		s.lifecycle.Lock()
		s.cancel()
		idle := s.inputIdle
		s.lifecycle.Unlock()
		s.closeError = s.socket.Close()
		// A blocked user producer must not keep the transport open or race its Close.
		go func() { <-idle; _ = s.input.Close() }()
	})
	return s.closeError
}
func (s *socketStream) Close() error { s.stop(); return s.closeResources() }
func (s *socketStream) Next(ctx context.Context) (out.SynthesisItem, error) {
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
func (s *socketStream) pullInput() {
	s.lifecycle.Lock()
	defer s.lifecycle.Unlock()
	if s.ctx.Err() != nil {
		return
	}
	pending, idle := make(chan inputResult, 1), make(chan struct{})
	s.pendingInput, s.inputIdle = pending, idle
	go func() { value, err := s.input.Next(s.ctx); close(idle); pending <- inputResult{value, err} }()
}
func (s *socketStream) pullOutput() {
	pending := make(chan socketResult, 1)
	s.pendingOutput = pending
	go func() { value, err := s.socket.Receive(s.ctx); pending <- socketResult{value, err} }()
}
func (s *socketStream) send(w write) {
	pending := make(chan error, 1)
	s.pendingSend, s.writingEnd = pending, w.endID
	// Snapshot before starting I/O; only Next owns mutable protocol state.
	data, err := json.Marshal(w.value)
	if err == nil && len(data) > s.limit {
		err = errors.New("Murf message exceeds MaxMessageBytes")
	}
	go func() {
		if err == nil {
			err = s.socket.Send(s.ctx, runtime.WebSocketText(data))
		}
		pending <- err
	}()
}
func (s *socketStream) end(flush bool) {
	if s.current == "" {
		return
	}
	id := s.current
	s.current = ""
	c := s.contexts[id]
	c.ended, c.flush = true, flush
	s.queue = append(s.queue, write{map[string]any{"context_id": id, "text": "", "end": true}, id})
}
func (s *socketStream) takeInput(value Input) (out.SynthesisItem, error) {
	if err := s.validate(value); err != nil {
		return nil, err
	}
	kind, text, voice, buffering := command(value)
	switch kind {
	case "text":
		if len(utf16.Encode([]rune(text))) > 3000 {
			return nil, errors.New("Murf text messages must not exceed 3000 characters")
		}
		if text != "" {
			if s.current == "" {
				s.current = fmt.Sprintf("%s:%d", s.session, s.sequence)
				s.sequence++
				s.contexts[s.current] = &contextState{}
				s.order = append(s.order, s.current)
			}
			s.queue = append(s.queue, write{value: map[string]any{"context_id": s.current, "voice_config": maps.Clone(s.voice), "text": text}})
		}
	case "flush":
		s.end(true)
	case "clear":
		for _, id := range s.order {
			s.retired[id] = true
			s.queue = append(s.queue, write{value: map[string]any{"context_id": id, "clear": true}})
		}
		clear(s.contexts)
		s.order = nil
		s.current = ""
		// This is local playback invalidation, emitted before potentially stalled writes.
		return out.SynthesisItemAsClear{}, nil
	case "update":
		maps.Copy(s.voice, voice)
		if s.current != "" {
			s.queue = append(s.queue, write{value: map[string]any{"context_id": s.current, "voice_config": maps.Clone(s.voice)}})
		}
		if len(buffering) > 0 {
			s.queue = append(s.queue, write{value: buffering})
		}
	}
	return nil, nil
}

func (s *socketStream) next(ctx context.Context) (out.SynthesisItem, error) {
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if s.ctx.Err() != nil {
			return nil, io.EOF
		}
		if !s.started {
			s.started = true
			s.send(write{value: map[string]any{"min_buffer_size": s.threshold, "max_buffer_delay_in_ms": s.delay}})
			s.pullOutput()
		}
		for index, id := range s.order {
			c := s.contexts[id]
			if c.final && c.written {
				delete(s.contexts, id)
				s.order = append(s.order[:index], s.order[index+1:]...)
				if c.flush {
					return out.SynthesisItemAsFlush{Value: out.FlushEvent{CorrelationId: id, InputGroupId: id}}, nil
				}
				break
			}
		}
		if s.pendingSend == nil {
			if len(s.queue) > 0 {
				w := s.queue[0]
				s.queue[0] = write{}
				s.queue = s.queue[1:]
				s.send(w)
			} else if s.inputDone && len(s.contexts) == 0 {
				s.done = true
				s.Close()
				return out.SynthesisItemAsDone{}, nil
			} else if !s.inputDone && s.pendingInput == nil {
				s.pullInput()
			}
		}
		var kind string
		var input inputResult
		var output socketResult
		var sendError error
		select {
		case sendError = <-s.pendingSend:
			kind = "send"
		default:
		}
		if kind == "" {
			if s.preferOutput {
				select {
				case output = <-s.pendingOutput:
					kind = "output"
				default:
					select {
					case input = <-s.pendingInput:
						kind = "input"
					default:
					}
				}
			} else {
				select {
				case input = <-s.pendingInput:
					kind = "input"
				default:
					select {
					case output = <-s.pendingOutput:
						kind = "output"
					default:
					}
				}
			}
		}
		if kind == "" {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-s.ctx.Done():
				return nil, io.EOF
			case sendError = <-s.pendingSend:
				kind = "send"
			case input = <-s.pendingInput:
				kind = "input"
			case output = <-s.pendingOutput:
				kind = "output"
			}
		}
		switch kind {
		case "send":
			s.pendingSend = nil
			if sendError != nil {
				return nil, sendError
			}
			if c := s.contexts[s.writingEnd]; c != nil {
				c.written = true
			}
			s.writingEnd = ""
		case "input":
			s.pendingInput = nil
			s.preferOutput = true
			if input.err == io.EOF {
				s.inputDone = true
				s.end(false)
				continue
			}
			if input.err != nil {
				return nil, input.err
			}
			item, err := s.takeInput(input.value)
			if item != nil || err != nil {
				return item, err
			}
		case "output":
			s.pendingOutput = nil
			s.preferOutput = false
			if output.err == io.EOF {
				return nil, errors.New("Murf WebSocket closed before all contexts completed")
			}
			if output.err != nil {
				return nil, output.err
			}
			frame, ok := output.value.(runtime.WebSocketText)
			if !ok {
				return nil, errors.New("Murf returned a non-text WebSocket message")
			}
			if len(frame) > s.limit {
				return nil, errors.New("Murf message exceeds MaxMessageBytes")
			}
			p, err := decodePacket([]byte(frame))
			if err != nil {
				return nil, err
			}
			s.pullOutput()
			if s.retired[p.context] {
				continue
			}
			c := s.contexts[p.context]
			if c == nil {
				return nil, errors.New("Murf returned an unknown context ID")
			}
			if len(p.audio) > 0 {
				c.audio = true
			}
			if p.final {
				if !c.ended {
					return nil, errors.New("Murf completed a context before its text ended")
				}
				if !c.audio {
					return nil, errors.New("Murf completed a context without audio")
				}
				c.final = true
			}
			if len(p.audio) > 0 {
				return out.SynthesisItemAsOrderedOrTimeline{Value: out.MurfEnvelope{Correlation: out.MurfEnvelopeCorrelationAsOrdered{}, CorrelationId: runtime.Some(p.context), Audio: runtime.Some(p.audio), Timestamps: []out.MurfTimestamp{}}}, nil
			}
		}
	}
}
