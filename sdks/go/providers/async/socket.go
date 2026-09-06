package async

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"unicode/utf8"

	out "github.com/speechswitch/client/sdks/go/generated/async_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type textResult struct {
	value string
	err   error
}
type socketResult struct {
	value runtime.WebSocketMessage
	err   error
}

type socketStream struct {
	ctx            context.Context
	cancel         context.CancelFunc
	stop           func() bool
	socket         runtime.WebSocketLike
	wire           wireRequest
	validate       runtime.InputValidator
	maxMessage     int
	once           sync.Once
	closeError     error
	mutex          sync.Mutex
	initialized    bool
	terminal       bool
	finished       bool
	contextID      string
	contextStarted bool
	inputDone      bool
	pendingInput   <-chan textResult
	pendingOutput  <-chan socketResult
	pendingSend    <-chan error
	readyInput     *textResult
}

func (s *socketStream) closeResources() error {
	s.once.Do(func() {
		s.cancel()
		// Always release the network before waiting on cooperative input cleanup.
		s.closeError = errors.Join(s.socket.Close(), s.wire.input.Close())
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
	} else if cause := s.ctx.Err(); cause != nil {
		item, err = nil, cause
	}
	if err != nil || s.finished {
		s.terminal = true
		s.Close()
		s.readyInput = nil
	}
	return item, err
}

func (s *socketStream) send(value map[string]any) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if len(encoded) > s.maxMessage {
		return errors.New("Async message exceeds MaxMessageBytes")
	}
	return s.socket.Send(s.ctx, runtime.WebSocketText(encoded))
}

func (s *socketStream) pullInput() {
	pending := make(chan textResult, 1)
	s.pendingInput = pending
	// One outstanding pull, with a buffered result so canceled consumers cannot
	// strand a worker sending its terminal result. Input owns cooperative cleanup.
	go func() { value, err := s.wire.input.Next(s.ctx); pending <- textResult{value, err} }()
}
func (s *socketStream) pullOutput() {
	pending := make(chan socketResult, 1)
	s.pendingOutput = pending
	go func() { value, err := s.socket.Receive(s.ctx); pending <- socketResult{value, err} }()
}

func (s *socketStream) startSend(value map[string]any) {
	pending := make(chan error, 1)
	s.pendingSend = pending
	// Keep receiving while the write is backpressured. No next input is pulled
	// until this write completes, so the producer cannot build an unbounded queue.
	go func() { pending <- s.send(value) }()
}

func (s *socketStream) next(ctx context.Context) (out.SynthesisItem, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := s.ctx.Err(); err != nil {
		return nil, err
	}
	if !s.initialized {
		var id [16]byte
		if _, err := rand.Read(id[:]); err != nil {
			return nil, err
		}
		id[6], id[8] = id[6]&15|64, id[8]&63|128
		s.contextID = fmt.Sprintf("%x-%x-%x-%x-%x", id[:4], id[4:6], id[6:8], id[8:10], id[10:])
		if err := s.send(s.wire.settings); err != nil {
			return nil, err
		}
		s.initialized = true
		s.pullInput()
	}
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if err := s.ctx.Err(); err != nil {
			return nil, err
		}
		if s.pendingOutput == nil {
			s.pullOutput()
		}
		var output socketResult
		outputReady := false
		// Already-ready output wins over input, so a fast producer cannot starve
		// audio. A received input result stays buffered if output wins the race.
		select {
		case output = <-s.pendingOutput:
			outputReady = true
		default:
		}
		if !outputReady && s.readyInput == nil {
			select {
			case output = <-s.pendingOutput:
				outputReady = true
			case input := <-s.pendingInput:
				s.pendingInput = nil
				s.readyInput = &input
				select {
				case output = <-s.pendingOutput:
					outputReady = true
				default:
				}
			case err := <-s.pendingSend:
				s.pendingSend = nil
				if err != nil {
					return nil, err
				}
				if !s.inputDone {
					s.pullInput()
				}
				continue
			case <-s.ctx.Done():
				return nil, s.ctx.Err()
			}
		}
		if outputReady {
			s.pendingOutput = nil
			if output.err == io.EOF {
				return nil, errors.New("Async WebSocket closed before final output")
			}
			if output.err != nil {
				return nil, output.err
			}
			var text string
			switch value := output.value.(type) {
			case runtime.WebSocketText:
				text = string(value)
			case *runtime.WebSocketText:
				if value == nil {
					return nil, errors.New("Async returned a non-text WebSocket frame")
				}
				text = string(*value)
			default:
				return nil, errors.New("Async returned a non-text WebSocket frame")
			}
			if len(text) > s.maxMessage {
				return nil, errors.New("Async message exceeds MaxMessageBytes")
			}
			if !utf8.ValidString(text) {
				return nil, errors.New("Async returned an invalid WebSocket message")
			}
			audio, final, err := socketAudio(text, s.contextID, s.inputDone)
			if err != nil {
				return nil, err
			}
			s.finished = final
			if len(audio) > 0 {
				return out.SynthesisItemAsBytes{Value: audio}, nil
			}
			if final {
				return nil, io.EOF
			}
			continue
		}
		input := *s.readyInput
		s.readyInput = nil
		if input.err == io.EOF {
			s.inputDone = true
			if !s.contextStarted {
				s.finished = true
				return nil, io.EOF
			}
			s.startSend(map[string]any{"context_id": s.contextID, "transcript": "", "close_context": true})
		} else {
			if input.err != nil {
				return nil, input.err
			}
			if err := s.validate(input.value); err != nil {
				return nil, err
			}
			if input.value != "" {
				s.contextStarted = true
				s.startSend(map[string]any{"context_id": s.contextID, "transcript": strings.TrimRight(input.value, ecmaWhitespace) + " ", "force": s.wire.force})
			} else {
				s.pullInput()
			}
		}
	}
}
