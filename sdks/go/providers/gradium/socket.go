package gradium

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"sync"

	schema "github.com/speechswitch/client/sdks/go/generated/gradium"
	out "github.com/speechswitch/client/sdks/go/generated/gradium_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type inputResult struct {
	value Input
	err   error
}
type socketResult struct {
	value runtime.WebSocketMessage
	err   error
}
type socketStream struct {
	parent, ctx                                                  context.Context
	cancel                                                       context.CancelFunc
	stop                                                         func() bool
	socket                                                       runtime.WebSocketLike
	input                                                        runtime.Input[Input]
	text                                                         string
	setup                                                        map[string]any
	validate                                                     runtime.InputValidator
	timed                                                        bool
	limit                                                        int
	buffer                                                       textBuffer
	once                                                         sync.Once
	closeError                                                   error
	mutex, lifecycle                                             sync.Mutex
	inputIdle                                                    <-chan struct{}
	started, terminal, ready, finishing, inputDone, preferOutput bool
	pendingInput                                                 <-chan inputResult
	pendingOutput                                                <-chan socketResult
	pendingSend                                                  <-chan error
}

func (s *socketStream) closeResources() error {
	s.once.Do(func() {
		s.lifecycle.Lock()
		s.cancel()
		idle := s.inputIdle
		s.lifecycle.Unlock()
		s.closeError = s.socket.Close()
		// Close input only after its pending Next settles, without holding the socket
		// or caller hostage to an uncooperative producer or its cleanup.
		if s.input != nil {
			go func() { <-idle; _ = s.input.Close() }()
		}
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
		s.buffer.pending = ""
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
			err = errors.New("Gradium message exceeds MaxMessageBytes")
		}
		if err == nil {
			err = s.socket.Send(s.ctx, runtime.WebSocketText(data))
		}
		pending <- err
	}()
}
func (s *socketStream) endInput() {
	// The peer may acknowledge EOS before the transport finishes draining the write.
	s.inputDone = true
	s.send(map[string]any{"type": "end_of_stream"})
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
			s.buffer.limit = s.limit
			s.send(s.setup)
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
		// Alternate immediately ready input/output to keep either side from starving
		// its peer. Only one input pull, receive and send may be outstanding.
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
			if s.inputDone {
				continue
			}
			if s.finishing {
				s.endInput()
			} else if s.input != nil {
				s.pullInput()
			} else {
				s.finishing = true
				if s.text != "" {
					s.send(map[string]any{"type": "text", "text": s.text})
				} else {
					s.endInput()
				}
			}
		case "input":
			s.pendingInput = nil
			s.preferOutput = true
			if input.err == io.EOF {
				s.finishing = true
				if s.buffer.pending != "" {
					s.send(map[string]any{"type": "text", "text": s.buffer.pending})
					s.buffer.pending = ""
				} else {
					s.endInput()
				}
				continue
			}
			if input.err != nil {
				return nil, input.err
			}
			if err := s.validate(input.value); err != nil {
				return nil, err
			}
			item := input.value
			switch v := item.(type) {
			case *schema.TtsRequestTextAsyncIterableItemAsString:
				item = *v
			case *schema.TtsRequestTextAsyncIterableItemAsFlush:
				item = *v
			}
			var text string
			switch v := item.(type) {
			case schema.TtsRequestTextAsyncIterableItemAsString:
				var err error
				text, err = s.buffer.push(v.Value)
				if err != nil {
					return nil, err
				}
			case schema.TtsRequestTextAsyncIterableItemAsFlush:
				text = s.buffer.pending + " <flush>"
				s.buffer.pending = ""
			}
			if text != "" {
				s.send(map[string]any{"type": "text", "text": text})
			} else {
				s.pullInput()
			}
		case "output":
			s.pendingOutput = nil
			s.preferOutput = false
			if output.err == io.EOF {
				return nil, errors.New("Gradium WebSocket closed before end_of_stream")
			}
			if output.err != nil {
				return nil, output.err
			}
			frame, ok := output.value.(runtime.WebSocketText)
			if !ok {
				return nil, errors.New("Gradium returned a non-text WebSocket frame")
			}
			if len(frame) > s.limit {
				return nil, errors.New("Gradium message exceeds MaxMessageBytes")
			}
			kind, item, err := packet([]byte(frame), s.timed)
			if err != nil {
				return nil, err
			}
			if kind == "ready" {
				if s.ready {
					return nil, errors.New("Gradium returned duplicate ready")
				}
				s.ready = true
			} else {
				if !s.ready {
					return nil, errors.New("Gradium returned output before ready")
				}
				if kind == "end_of_stream" {
					if !s.inputDone {
						return nil, errors.New("Gradium completed before the input stream ended")
					}
					return nil, io.EOF
				}
			}
			s.pullOutput()
			if item != nil {
				return item, nil
			}
		}
	}
}
