package cartesia

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"maps"
	"sync"

	schema "github.com/speechswitch/client/sdks/go/generated/cartesia"
	out "github.com/speechswitch/client/sdks/go/generated/cartesia_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type inputResult struct {
	value inputItem
	err   error
}
type socketResult struct {
	value runtime.WebSocketMessage
	err   error
}

type socketStream struct {
	ctx                                              context.Context
	cancel                                           context.CancelFunc
	stop                                             func() bool
	socket                                           runtime.WebSocketLike
	wire                                             wireRequest
	validate                                         runtime.InputValidator
	maxMessage                                       int
	once                                             sync.Once
	closeError                                       error
	mutex                                            sync.Mutex
	started, terminal, used, inputDone, preferOutput bool
	contextID                                        string
	retired                                          map[string]bool
	pendingInput                                     <-chan inputResult
	pendingOutput                                    <-chan socketResult
	pendingSend                                      <-chan error
}

func (s *socketStream) closeResources() error {
	s.once.Do(func() {
		s.cancel()
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
	if err != nil {
		s.terminal = true
		s.Close()
	}
	return item, err
}

func (s *socketStream) pullInput() {
	pending := make(chan inputResult, 1)
	s.pendingInput = pending
	go func() { value, err := s.wire.input.Next(s.ctx); pending <- inputResult{value, err} }()
}
func (s *socketStream) pullOutput() {
	pending := make(chan socketResult, 1)
	s.pendingOutput = pending
	go func() { value, err := s.socket.Receive(s.ctx); pending <- socketResult{value, err} }()
}
func (s *socketStream) send(wire map[string]any) error {
	encoded, err := json.Marshal(wire)
	if err != nil {
		return err
	}
	if len(encoded) > s.maxMessage {
		return errors.New("Cartesia message exceeds MaxMessageBytes")
	}
	pending := make(chan error, 1)
	s.pendingSend = pending
	go func() { pending <- s.socket.Send(s.ctx, runtime.WebSocketText(encoded)) }()
	return nil
}
func (s *socketStream) generation(text string, continued, flush bool) map[string]any {
	wire := maps.Clone(s.wire.wire)
	wire["context_id"], wire["transcript"], wire["continue"], wire["flush"] = s.contextID, text, continued, flush
	return wire
}
func (s *socketStream) rotate() error {
	id, err := contextID()
	if err != nil {
		return err
	}
	s.retired[s.contextID] = true
	s.contextID, s.used = id, false
	return nil
}

func (s *socketStream) next(ctx context.Context) (out.SynthesisItem, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := s.ctx.Err(); err != nil {
		return nil, err
	}
	if !s.started {
		s.started = true
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
		var input inputResult
		var received socketResult
		var sent error
		kind := 0
		// Alternate ready I/O lanes: continuous output must not starve barge-in,
		// and a backpressured send must not block audio or prefetch more input.
		if s.preferOutput {
			select {
			case received = <-s.pendingOutput:
				kind = 1
			default:
			}
		} else {
			select {
			case sent = <-s.pendingSend:
				kind = 2
			default:
			}
			if kind == 0 {
				select {
				case input = <-s.pendingInput:
					kind = 3
				default:
				}
			}
		}
		if kind == 0 {
			select {
			case received = <-s.pendingOutput:
				kind = 1
			case sent = <-s.pendingSend:
				kind = 2
			case input = <-s.pendingInput:
				kind = 3
			case <-s.ctx.Done():
				return nil, s.ctx.Err()
			}
		}
		s.preferOutput = kind != 1
		switch kind {
		case 1:
			s.pendingOutput = nil
			if received.err == io.EOF {
				return nil, errors.New("Cartesia WebSocket closed before context completion (idle connections expire after five minutes)")
			}
			if received.err != nil {
				return nil, received.err
			}
			var text string
			switch value := received.value.(type) {
			case runtime.WebSocketText:
				text = string(value)
			case *runtime.WebSocketText:
				if value == nil {
					return nil, errors.New("Cartesia returned a non-text frame")
				}
				text = string(*value)
			default:
				return nil, errors.New("Cartesia returned a non-text frame")
			}
			if len(text) > s.maxMessage {
				return nil, errors.New("Cartesia message exceeds MaxMessageBytes")
			}
			value, err := decode([]byte(text), true)
			if err != nil {
				return nil, err
			}
			if value.context.Present && s.retired[value.context.Value] {
				continue
			}
			if value.context.Present && value.context.Value != s.contextID {
				return nil, errors.New("Cartesia returned output for an unexpected context")
			}
			if value.kind == "done" {
				if s.inputDone {
					return nil, io.EOF
				}
				if err := s.rotate(); err != nil {
					return nil, err
				}
				continue
			}
			return output(value, s.contextID, s.wire.timed)
		case 2:
			s.pendingSend = nil
			if sent != nil {
				return nil, sent
			}
			if !s.inputDone {
				s.pullInput()
			}
		case 3:
			s.pendingInput = nil
			if input.err == io.EOF {
				s.inputDone = true
				if !s.used {
					return nil, io.EOF
				}
				if err := s.send(s.generation("", false, false)); err != nil {
					return nil, err
				}
				continue
			}
			if input.err != nil {
				return nil, input.err
			}
			if err := s.validate(input.value); err != nil {
				return nil, err
			}
			text, command, err := inputValue(input.value)
			if err != nil {
				return nil, err
			}
			switch command {
			case "":
				if text != "" {
					s.used = true
					if err := s.send(s.generation(text, true, false)); err != nil {
						return nil, err
					}
				}
			case "flush":
				if s.used {
					if err := s.send(s.generation("", true, true)); err != nil {
						return nil, err
					}
				}
			case "clear":
				if s.used {
					if err := s.send(map[string]any{"context_id": s.contextID, "cancel": true}); err != nil {
						return nil, err
					}
				}
				if err := s.rotate(); err != nil {
					return nil, err
				}
			}
			if s.pendingSend == nil {
				s.pullInput()
			}
			if command == "clear" {
				return out.SynthesisItemAsClear{}, nil
			}
		}
	}
}

func inputValue(value inputItem) (string, string, error) {
	switch v := value.(type) {
	case schema.TtsRequestStreamingTextVoice0bf53a99TextItemAsString:
		return v.Value, "", nil
	case *schema.TtsRequestStreamingTextVoice0bf53a99TextItemAsString:
		return v.Value, "", nil
	case schema.TtsRequestStreamingTextVoice0bf53a99TextItemAsClear, *schema.TtsRequestStreamingTextVoice0bf53a99TextItemAsClear:
		return "", "clear", nil
	case schema.TtsRequestStreamingTextVoice0bf53a99TextItemAsFlush, *schema.TtsRequestStreamingTextVoice0bf53a99TextItemAsFlush:
		return "", "flush", nil
	default:
		return "", "", errors.New("Unsupported generated Cartesia input representation")
	}
}
