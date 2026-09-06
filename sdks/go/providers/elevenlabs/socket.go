package elevenlabs

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"sync"
	"time"

	out "github.com/speechswitch/client/sdks/go/generated/elevenlabs_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type inputResult struct {
	value any
	err   error
}
type socketResult struct {
	value runtime.WebSocketMessage
	err   error
}
type socketStream struct {
	parent, ctx                           context.Context
	cancel                                context.CancelFunc
	stop                                  func() bool
	socket                                runtime.WebSocketLike
	input                                 runtime.Input[any]
	validate                              runtime.InputValidator
	voice                                 string
	dialogue, timed, normalized           bool
	settings                              map[string]any
	maxMessage                            int
	once                                  sync.Once
	closeError                            error
	mutex                                 sync.Mutex
	started, terminal, used, preferOutput bool
	end                                   error
	retired                               map[string]bool
	pendingInput                          <-chan inputResult
	pendingOutput                         <-chan socketResult
	pendingSend                           <-chan error
	writing                               sync.Mutex
	state                                 sync.Mutex
	contextID                             string
	initialized, inputDone                bool
	heartbeatError                        error
	heartbeatInterval                     time.Duration
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
	s.state.Lock()
	failure := s.heartbeatError
	s.state.Unlock()
	if failure != nil {
		item, err = nil, failure
	}
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
func (s *socketStream) sendOne(message map[string]any) error {
	data, err := json.Marshal(message)
	if err != nil {
		return err
	}
	if len(data) > s.maxMessage {
		return errors.New("ElevenLabs message exceeds MaxMessageBytes")
	}
	return s.socket.Send(s.ctx, runtime.WebSocketText(data))
}
func (s *socketStream) send(messages []map[string]any, readyContext string) {
	previous := s.pendingSend
	pending := make(chan error, 1)
	s.pendingSend = pending
	go func() {
		if previous != nil {
			select {
			case err := <-previous:
				if err != nil {
					pending <- err
					return
				}
			case <-s.ctx.Done():
				pending <- s.ctx.Err()
				return
			}
		}
		s.writing.Lock()
		defer s.writing.Unlock()
		for _, message := range messages {
			if err := s.sendOne(message); err != nil {
				pending <- err
				return
			}
		}
		s.state.Lock()
		if readyContext != "" && readyContext == s.contextID {
			s.initialized = true
		}
		s.state.Unlock()
		pending <- nil
	}()
}
func (s *socketStream) rotate() (string, map[string]any) {
	id := make([]byte, 16)
	rand.Read(id)
	id[6], id[8] = (id[6]&15)|64, (id[8]&63)|128
	raw := hex.EncodeToString(id)
	identifier := raw[:8] + "-" + raw[8:12] + "-" + raw[12:16] + "-" + raw[16:20] + "-" + raw[20:]
	s.state.Lock()
	old := s.contextID
	s.contextID, s.initialized = identifier, false
	s.state.Unlock()
	message := map[string]any{}
	for key, value := range s.settings {
		message[key] = value
	}
	if s.dialogue {
		message["voices"] = []string{s.voice}
	} else {
		message["text"], message["context_id"] = " ", identifier
	}
	return old, message
}
func (s *socketStream) keepAlive() {
	ticker := time.NewTicker(s.heartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
		}
		s.writing.Lock()
		s.state.Lock()
		id, initialized, done := s.contextID, s.initialized, s.inputDone
		s.state.Unlock()
		if done {
			s.writing.Unlock()
			return
		}
		var err error
		if initialized {
			message := map[string]any{"context_id": id, "text": ""}
			if s.dialogue {
				message = map[string]any{"keep_alive": true}
			}
			err = s.sendOne(message)
		}
		s.writing.Unlock()
		if err != nil && s.ctx.Err() == nil {
			s.state.Lock()
			s.heartbeatError = err
			s.state.Unlock()
			s.closeResources()
			return
		}
	}
}
func (s *socketStream) next(ctx context.Context) (out.SynthesisItem, error) {
	if s.end != nil {
		return nil, s.end
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := s.ctx.Err(); err != nil {
		return nil, err
	}
	if !s.started {
		s.started = true
		_, initial := s.rotate()
		s.send([]map[string]any{initial}, s.contextID)
		go s.keepAlive()
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
		if s.pendingInput == nil && s.pendingSend == nil && !s.inputDone {
			s.pullInput()
		}
		inputLane := s.pendingInput
		if s.pendingSend != nil {
			inputLane = nil
		}
		var input inputResult
		var received socketResult
		var sent error
		kind := 0
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
				case input = <-inputLane:
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
			case input = <-inputLane:
				kind = 3
			case <-s.ctx.Done():
				return nil, s.ctx.Err()
			}
		}
		s.preferOutput = kind != 1
		switch kind {
		case 2:
			s.pendingSend = nil
			if sent != nil {
				return nil, sent
			}
		case 3:
			s.pendingInput = nil
			if input.err == io.EOF {
				s.state.Lock()
				s.inputDone = true
				s.state.Unlock()
				if !s.used {
					return nil, io.EOF
				}
				messages := []map[string]any{}
				if !s.dialogue {
					messages = append(messages, map[string]any{"context_id": s.contextID, "text": " ", "flush": true})
				}
				messages = append(messages, map[string]any{"close_socket": true})
				s.send(messages, "")
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
			if command == "clear" {
				old, initial := s.rotate()
				s.retired[old], s.used = true, false
				s.send([]map[string]any{{"context_id": old, "close_context": true}, initial}, s.contextID)
				return out.SynthesisItemAsClear{}, nil
			}
			if command == "flush" {
				if s.used {
					message := map[string]any{"context_id": s.contextID, "text": " ", "flush": true}
					if s.dialogue {
						message = map[string]any{"flush": true}
					}
					s.send([]map[string]any{message}, "")
				}
			} else if text != "" {
				s.used = true
				message := map[string]any{"context_id": s.contextID, "text": text}
				if s.dialogue {
					message = map[string]any{"inputs": []map[string]any{{"text": text, "voice_id": s.voice}}}
				}
				s.send([]map[string]any{message}, "")
			}
		case 1:
			s.pendingOutput = nil
			if received.err == io.EOF {
				return nil, errors.New("ElevenLabs WebSocket closed before final output")
			}
			if received.err != nil {
				return nil, received.err
			}
			packet, err := decode(received.value, s.dialogue, s.normalized, s.maxMessage)
			if err != nil {
				return nil, err
			}
			if packet.context.Present && s.retired[packet.context.Value] {
				continue
			}
			if packet.failure != nil {
				return nil, packet.failure
			}
			if !s.dialogue && packet.context.Value != s.contextID {
				return nil, errors.New("ElevenLabs returned an unexpected context identifier")
			}
			if packet.final {
				if s.inputDone || s.dialogue {
					s.end = io.EOF
					if !s.inputDone {
						s.end = errors.New("ElevenLabs dialogue ended before input completed")
					}
					s.closeResources()
				} else {
					old, initial := s.rotate()
					s.retired[old], s.used = true, false
					// Chain reinitialization before yielding audio, including during a pending write.
					s.send([]map[string]any{initial}, s.contextID)
				}
			}
			if packet.audio.Present {
				data, err := audio(packet.audio.Value)
				if err != nil {
					return nil, err
				}
				if !s.timed {
					return out.SynthesisItemAsBytes{Value: data}, nil
				}
				protocol := "tts"
				if s.dialogue {
					protocol = "dialogue"
				}
				times, err := timestamps(packet.alignment, protocol)
				if err != nil {
					return nil, err
				}
				return out.SynthesisItemAsChunk{Value: out.TimestampedAudio{Audio: data, Timestamps: times}}, nil
			}
			if s.end != nil {
				return nil, s.end
			}
		}
	}
}
