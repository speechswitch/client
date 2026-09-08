package hume

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"sync"

	out "github.com/speechswitch/client/sdks/go/generated/hume_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type inputResult struct {
	value map[string]any
	err   error
}
type socketResult struct {
	value runtime.WebSocketMessage
	err   error
}
type socketStream struct {
	parent, ctx                                context.Context
	cancel                                     context.CancelFunc
	stop                                       func() bool
	socket                                     runtime.WebSocketLike
	input                                      runtime.Input[map[string]any]
	metadata                                   bool
	limit                                      int
	once                                       sync.Once
	closeError                                 error
	mutex, lifecycle                           sync.Mutex
	inputIdle                                  <-chan struct{}
	started, terminal, inputDone, preferOutput bool
	pendingInput                               <-chan inputResult
	pendingOutput                              <-chan socketResult
	pendingSend                                <-chan error
}

func (s *socketStream) closeResources() error {
	s.once.Do(func() {
		s.lifecycle.Lock()
		s.cancel()
		idle := s.inputIdle
		s.lifecycle.Unlock()
		s.closeError = s.socket.Close()
		// The socket and caller never wait for an uncooperative Next/Close.
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
	if s.terminal {
		return nil, io.EOF
	}
	item, err := s.next(ctx)
	if cause := ctx.Err(); cause != nil {
		item, err = nil, cause
	} else if cause := s.parent.Err(); cause != nil {
		item, err = nil, cause
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
	pending := make(chan inputResult, 1)
	idle := make(chan struct{})
	s.inputIdle, s.pendingInput = idle, pending
	go func() { value, err := s.input.Next(s.ctx); close(idle); pending <- inputResult{value, err} }()
}
func (s *socketStream) pullOutput() {
	pending := make(chan socketResult, 1)
	s.pendingOutput = pending
	go func() { value, err := s.socket.Receive(s.ctx); pending <- socketResult{value, err} }()
}
func (s *socketStream) send(value map[string]any) {
	pending := make(chan error, 1)
	s.pendingSend = pending
	go func() {
		data, err := json.Marshal(value)
		if err == nil && len(data) > s.limit {
			err = errors.New("Hume message exceeds MaxMessageBytes")
		}
		if err == nil {
			err = s.socket.Send(s.ctx, runtime.WebSocketText(data))
		}
		pending <- err
	}()
}
func (s *socketStream) next(ctx context.Context) (out.SynthesisItem, error) {
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if err := s.parent.Err(); err != nil {
			return nil, err
		}
		if s.ctx.Err() != nil {
			return nil, io.EOF
		}
		if !s.started {
			s.started = true
			s.pullInput()
			s.pullOutput()
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
		// Alternate ready lanes, maintaining one outstanding pull/send/receive.
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
			case output = <-s.pendingOutput:
				kind = "output"
			case input = <-s.pendingInput:
				kind = "input"
			}
		}
		switch kind {
		case "send":
			s.pendingSend = nil
			if sendError != nil {
				return nil, sendError
			}
			if !s.inputDone {
				s.pullInput()
			}
		case "input":
			s.pendingInput = nil
			s.preferOutput = true
			if input.err == io.EOF {
				// Normal close can arrive before the final write finishes draining.
				s.inputDone = true
				s.send(map[string]any{"close": true})
				continue
			}
			if input.err != nil {
				return nil, input.err
			}
			s.send(input.value)
		case "output":
			s.pendingOutput = nil
			s.preferOutput = false
			if output.err == io.EOF {
				if !s.inputDone {
					return nil, errors.New("Hume WebSocket closed before the input stream ended")
				}
				return nil, io.EOF
			}
			if output.err != nil {
				return nil, output.err
			}
			var item out.SynthesisItem
			var err error
			switch frame := output.value.(type) {
			case runtime.WebSocketBinary:
				if len(frame) > s.limit {
					return nil, errors.New("Hume message exceeds MaxMessageBytes")
				}
				if s.metadata {
					return nil, errors.New("Hume returned binary audio in JSON mode")
				}
				item = out.SynthesisItemAsBytes{Value: []byte(frame)}
			case runtime.WebSocketText:
				if len(frame) > s.limit {
					return nil, errors.New("Hume message exceeds MaxMessageBytes")
				}
				item, err = packet([]byte(frame), s.metadata)
			default:
				return nil, errors.New("Hume returned an invalid WebSocket frame")
			}
			if err != nil {
				return nil, err
			}
			s.pullOutput()
			if item != nil {
				return item, nil
			}
		}
	}
}
