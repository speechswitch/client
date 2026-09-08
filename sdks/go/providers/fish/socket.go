package fish

import (
	"context"
	"errors"
	"io"
	"sync"

	schema "github.com/speechswitch/client/sdks/go/generated/fish"
	out "github.com/speechswitch/client/sdks/go/generated/fish_output"
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
	parent, ctx                                context.Context
	cancel                                     context.CancelFunc
	stop                                       func() bool
	socket                                     runtime.WebSocketLike
	input                                      runtime.Input[Input]
	validate                                   runtime.InputValidator
	wire                                       map[string]any
	limit                                      int
	once                                       sync.Once
	closeError                                 error
	mutex                                      sync.Mutex
	started, terminal, inputDone, preferOutput bool
	pendingInput                               <-chan inputResult
	pendingOutput                              <-chan socketResult
	pendingSend                                <-chan error
}

func (s *socketStream) closeResources() error {
	s.once.Do(func() {
		s.cancel()
		socketError := s.socket.Close()
		inputError := s.input.Close()
		s.closeError = errors.Join(socketError, inputError)
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
	pending := make(chan inputResult, 1)
	s.pendingInput = pending
	go func() { value, err := s.input.Next(s.ctx); pending <- inputResult{value, err} }()
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
		bytes, err := runtime.EncodeMessagePack(value)
		if err == nil && len(bytes) > s.limit {
			err = errors.New("Fish message exceeds MaxMessageBytes")
		}
		if err == nil {
			err = s.socket.Send(s.ctx, runtime.WebSocketBinary(bytes))
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
			s.send(map[string]any{"event": "start", "request": s.wire})
			s.pullOutput()
		}
		var kind string
		var input inputResult
		var output socketResult
		var sendError error
		// Only one write is pending. Alternating ready input/output prevents an
		// always-ready producer or an unknown-event stream from starving its peer.
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
				s.inputDone = true
				s.send(map[string]any{"event": "stop"})
				continue
			}
			if input.err != nil {
				return nil, input.err
			}
			if err := s.validate(input.value); err != nil {
				return nil, err
			}
			switch v := input.value.(type) {
			case schema.TtsRequestS1StreamingTextTextItemAsString:
				s.send(map[string]any{"event": "text", "text": v.Value})
			case *schema.TtsRequestS1StreamingTextTextItemAsString:
				s.send(map[string]any{"event": "text", "text": v.Value})
			case schema.TtsRequestS1StreamingTextTextItemAsFlush, *schema.TtsRequestS1StreamingTextTextItemAsFlush:
				s.send(map[string]any{"event": "flush"})
			}
		case "output":
			s.pendingOutput = nil
			s.preferOutput = false
			if output.err == io.EOF {
				return nil, errors.New("Fish WebSocket closed before session completion")
			}
			if output.err != nil {
				return nil, output.err
			}
			packet, err := decodePacket(output.value, s.limit)
			if err != nil {
				return nil, err
			}
			if packet.event == "finish" {
				if packet.reason == "error" {
					return nil, &Error{Message: "Streaming synthesis failed", Reason: runtime.Some("error")}
				}
				if !s.inputDone {
					return nil, errors.New("Fish finished before the input stream ended")
				}
				return nil, io.EOF
			}
			s.pullOutput()
			if packet.event == "audio" {
				return out.SynthesisItemAsBytes{Value: packet.audio}, nil
			}
		}
	}
}
