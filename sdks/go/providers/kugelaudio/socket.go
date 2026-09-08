package kugelaudio

import (
	"context"
	"encoding/json"
	"errors"
	out "github.com/speechswitch/client/sdks/go/generated/kugelaudio_output"
	"github.com/speechswitch/client/sdks/go/runtime"
	"io"
	"sync"
	"unicode/utf16"
)

type inputResult struct {
	value Input
	err   error
}
type socketResult struct {
	value runtime.WebSocketMessage
	err   error
}
type heldInput struct {
	kind    string
	message map[string]any
}
type socketStream struct {
	parent, ctx                                                              context.Context
	cancel                                                                   context.CancelFunc
	stop                                                                     func() bool
	socket                                                                   runtime.WebSocketLike
	input                                                                    runtime.Input[Input]
	config                                                                   map[string]any
	rate                                                                     float64
	encoding                                                                 string
	live, timed                                                              bool
	limit                                                                    int
	warning                                                                  func(string)
	validate                                                                 runtime.InputValidator
	once                                                                     sync.Once
	closeError                                                               error
	mutex, lifecycle                                                         sync.Mutex
	inputIdle                                                                <-chan struct{}
	started, terminal, inputDone, preferOutput, finalSeen, finished, closing bool
	state                                                                    string
	updates, turn                                                            uint64
	samples                                                                  map[int64]int64
	held                                                                     *heldInput
	pendingInput                                                             <-chan inputResult
	pendingOutput                                                            <-chan socketResult
	pendingSend                                                              <-chan error
}

func (s *socketStream) closeResources() error {
	s.once.Do(func() {
		s.lifecycle.Lock()
		s.cancel()
		idle := s.inputIdle
		s.lifecycle.Unlock()
		s.closeError = s.socket.Close()
		// Network cleanup cannot depend on a user's blocked Next or Close.
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
			err = errors.New("KugelAudio message exceeds MaxMessageBytes")
		}
		if err == nil {
			err = s.socket.Send(s.ctx, runtime.WebSocketText(data))
		}
		pending <- err
	}()
}
func (s *socketStream) takeInput() error {
	held := s.held
	s.held = nil
	message := held.message
	switch held.kind {
	case "end":
		s.inputDone = true
		if s.state == "active" {
			message = map[string]any{"flush": true}
			s.state = "flushing"
		}
	case "text":
		text := message["text"].(string)
		if len(utf16.Encode([]rune(text))) > 10000 {
			return errors.New("KugelAudio text fragments must not exceed 10000 characters")
		}
		if text == "" {
			message = nil
		} else {
			s.state = "active"
		}
	case "clear":
		s.state = "clearing"
	case "flush":
		if s.state == "active" {
			s.state = "flushing"
		} else {
			message = nil
		}
	case "update":
		s.updates++
	}
	if message != nil {
		s.send(message)
	} else if !s.inputDone {
		s.pullInput()
	}
	return nil
}
func (s *socketStream) next(ctx context.Context) (out.SynthesisItem, error) {
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if err := s.parent.Err(); err != nil {
			return nil, err
		}
		if s.ctx.Err() != nil || s.finished {
			return nil, io.EOF
		}
		if !s.started {
			s.started = true
			s.send(s.config)
			s.pullOutput()
		}
		if s.pendingSend == nil {
			if s.live && s.inputDone && s.state == "idle" && s.updates == 0 {
				if s.closing {
					return nil, io.EOF
				}
				s.closing = true
				s.send(map[string]any{"close_socket": true})
			} else if s.held != nil && (s.held.kind == "end" || s.state == "idle" || s.state == "active" || (s.state != "clearing" && s.held.kind != "text" && s.held.kind != "flush")) {
				if err := s.takeInput(); err != nil {
					return nil, err
				}
				if s.inputDone && s.state == "idle" && s.updates == 0 {
					continue
				}
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
		// Alternate input/output when both are ready, with one pull/send/receive each.
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
			if s.closing {
				return nil, io.EOF
			}
			if !s.inputDone {
				s.pullInput()
			}
		case "input":
			s.pendingInput = nil
			s.preferOutput = true
			if input.err == io.EOF {
				s.held = &heldInput{kind: "end"}
				continue
			}
			if input.err != nil {
				return nil, input.err
			}
			if err := s.validate(input.value); err != nil {
				return nil, err
			}
			kind, message := command(input.value)
			s.held = &heldInput{kind: kind, message: message}
		case "output":
			s.pendingOutput = nil
			s.preferOutput = false
			if output.err == io.EOF {
				if s.closing {
					continue
				}
				return nil, errors.New("KugelAudio WebSocket closed before synthesis completed")
			}
			if output.err != nil {
				return nil, output.err
			}
			frame, ok := output.value.(runtime.WebSocketText)
			if !ok {
				return nil, errors.New("KugelAudio returned a non-text WebSocket frame")
			}
			if len(frame) > s.limit {
				return nil, errors.New("KugelAudio message exceeds MaxMessageBytes")
			}
			packet, err := decode([]byte(frame))
			if err != nil {
				return nil, err
			}
			item, err := s.output(packet)
			if err != nil {
				return nil, err
			}
			if !s.finished {
				s.pullOutput()
			}
			if item != nil {
				return item, nil
			}
		}
	}
}
