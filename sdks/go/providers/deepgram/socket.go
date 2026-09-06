package deepgram

import (
	"context"
	"encoding/json"
	"errors"
	schema "github.com/speechswitch/client/sdks/go/generated/deepgram"
	out "github.com/speechswitch/client/sdks/go/generated/deepgram_output"
	"github.com/speechswitch/client/sdks/go/runtime"
	"io"
	"sync"
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
	ctx                                                                              context.Context
	cancel                                                                           context.CancelFunc
	stop                                                                             func() bool
	socket                                                                           runtime.WebSocketLike
	input                                                                            runtime.Input[Input]
	validate                                                                         runtime.InputValidator
	maxMessage                                                                       int
	once                                                                             sync.Once
	closeError                                                                       error
	mutex                                                                            sync.Mutex
	started, terminal, inputDone, hasText, flushing, clearing, closing, preferOutput bool
	trace                                                                            runtime.Optional[string]
	held                                                                             *inputResult
	pendingInput                                                                     <-chan inputResult
	pendingOutput                                                                    <-chan socketResult
	pendingSend                                                                      <-chan error
}

func (s *socketStream) closeResources() error {
	s.once.Do(func() { s.cancel(); s.closeError = errors.Join(s.socket.Close(), s.input.Close()) })
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
	go func() { value, err := s.input.Next(s.ctx); pending <- inputResult{value, err} }()
}
func (s *socketStream) pullOutput() {
	pending := make(chan socketResult, 1)
	s.pendingOutput = pending
	go func() { value, err := s.socket.Receive(s.ctx); pending <- socketResult{value, err} }()
}
func (s *socketStream) send(message map[string]string) error {
	data, err := json.Marshal(message)
	if err != nil {
		return err
	}
	if len(data) > s.maxMessage {
		return errors.New("Deepgram message exceeds MaxMessageBytes")
	}
	pending := make(chan error, 1)
	s.pendingSend = pending
	go func() { pending <- s.socket.Send(s.ctx, runtime.WebSocketText(data)) }()
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
		if s.inputDone && !s.hasText && !s.flushing && !s.clearing && s.pendingSend == nil {
			s.closing = true
			if err := s.send(map[string]string{"type": "Close"}); err != nil {
				return nil, err
			}
		}
		if s.held != nil && !s.flushing && !s.clearing && s.pendingSend == nil {
			pending := make(chan inputResult, 1)
			pending <- *s.held
			s.pendingInput = pending
			s.held = nil
		}
		if s.pendingOutput == nil {
			s.pullOutput()
		}
		var input inputResult
		var received socketResult
		var sent error
		kind := 0
		// Alternate ready lanes without allowing a pending write to hold up audio.
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
				if s.closing {
					return nil, io.EOF
				}
				return nil, errors.New("Deepgram WebSocket closed before input or pending synthesis completed")
			}
			if received.err != nil {
				return nil, received.err
			}
			message, err := decode(received.value, s.maxMessage)
			if err != nil {
				return nil, err
			}
			switch message.kind {
			case "audio":
				if !s.clearing && len(message.audio) != 0 {
					return out.SynthesisItemAsBytes{Value: message.audio}, nil
				}
			case "Metadata":
				s.trace = runtime.Some(message.trace)
			case "Cleared":
				if !s.clearing {
					return nil, errors.New("Unexpected Deepgram Cleared acknowledgement")
				}
				s.clearing, s.flushing = false, false
				return out.SynthesisItemAsClear{Value: out.ClearEvent{SequenceId: message.sequence}}, nil
			case "Flushed":
				if s.clearing {
					continue
				}
				if !s.flushing {
					return nil, errors.New("Unexpected Deepgram Flushed acknowledgement")
				}
				s.flushing = false
				return out.SynthesisItemAsDone{Value: out.DoneEvent{SequenceId: message.sequence, TraceId: s.trace}}, nil
			}
		case 2:
			s.pendingSend = nil
			if sent != nil {
				return nil, sent
			}
			if s.closing {
				return nil, io.EOF
			}
			if !s.inputDone && s.held == nil {
				s.pullInput()
			}
		case 3:
			s.pendingInput = nil
			if input.err != nil && input.err != io.EOF {
				return nil, input.err
			}
			text, command := "", ""
			if input.err == nil {
				if err := s.validate(input.value); err != nil {
					return nil, err
				}
				var err error
				text, command, err = inputValue(input.value)
				if err != nil {
					return nil, err
				}
			}
			// New text waits for acknowledgement. Clear can interrupt a pending flush.
			if s.clearing || (s.flushing && (input.err == io.EOF || command != "clear")) {
				s.held = &input
				continue
			}
			if input.err == io.EOF {
				s.inputDone = true
				if s.hasText {
					s.hasText, s.flushing = false, true
					if err := s.send(map[string]string{"type": "Flush"}); err != nil {
						return nil, err
					}
				}
			} else {
				switch command {
				case "":
					if text != "" {
						s.hasText = true
						if err := s.send(map[string]string{"type": "Speak", "text": text}); err != nil {
							return nil, err
						}
					}
				case "clear":
					s.hasText, s.clearing = false, true
					if err := s.send(map[string]string{"type": "Clear"}); err != nil {
						return nil, err
					}
				case "flush":
					if s.hasText {
						s.hasText, s.flushing = false, true
						if err := s.send(map[string]string{"type": "Flush"}); err != nil {
							return nil, err
						}
					}
				}
				if s.pendingSend == nil {
					s.pullInput()
				}
			}
		}
	}
}
func inputValue(value Input) (string, string, error) {
	switch v := value.(type) {
	case schema.TtsRequestAura1StreamingTextVoiceTextItemAsString:
		return v.Value, "", nil
	case *schema.TtsRequestAura1StreamingTextVoiceTextItemAsString:
		return v.Value, "", nil
	case schema.TtsRequestAura1StreamingTextVoiceTextItemAsClear, *schema.TtsRequestAura1StreamingTextVoiceTextItemAsClear:
		return "", "clear", nil
	case schema.TtsRequestAura1StreamingTextVoiceTextItemAsFlush, *schema.TtsRequestAura1StreamingTextVoiceTextItemAsFlush:
		return "", "flush", nil
	default:
		return "", "", errors.New("Unsupported generated Deepgram input representation")
	}
}
