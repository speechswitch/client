package respeecher

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"maps"
	"strconv"
	"strings"

	out "github.com/speechswitch/client/sdks/go/generated/respeecher_output"
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
type synthesisContext struct{ ended, flush, audio bool }

func (s *stream) runSocket() error {
	s.resourceMutex.Lock()
	socket := s.socket
	closed := s.closed
	s.resourceMutex.Unlock()
	if closed {
		return s.ctx.Err()
	}
	if socket == nil {
		var err error
		socket, err = s.config.connectSocket(s.ctx)
		if err != nil {
			return err
		}
		s.resourceMutex.Lock()
		closed = s.closed
		if !closed {
			s.socket = socket
		}
		s.resourceMutex.Unlock()
		if closed {
			socket.Close()
			return s.ctx.Err()
		}
	}
	s.resourceMutex.Lock()
	if s.closed {
		s.resourceMutex.Unlock()
		return s.ctx.Err()
	}
	s.inputStarted = true
	s.resourceMutex.Unlock()
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		return err
	}
	prefix := hex.EncodeToString(random[:]) + ":"
	sequence, cleared := int64(0), int64(-1)
	contexts := map[string]*synthesisContext{}
	current := ""
	inputDone, wholeRead, preferOutput := false, false, false
	var pendingInput <-chan inputResult
	var pendingOutput <-chan socketResult
	var pendingSend <-chan error
	pullInput := func() {
		ch := make(chan inputResult, 1)
		pendingInput = ch
		if s.config.input == nil {
			if wholeRead {
				ch <- inputResult{err: io.EOF}
			} else {
				wholeRead = true
				ch <- inputResult{value: nil}
			}
			return
		}
		go func() { value, err := s.config.input.Next(s.ctx); ch <- inputResult{value: value, err: err} }()
	}
	pullOutput := func() {
		ch := make(chan socketResult, 1)
		pendingOutput = ch
		go func() { value, err := socket.Receive(s.ctx); ch <- socketResult{value: value, err: err} }()
	}
	send := func(messages []map[string]any) error {
		encoded := make([]runtime.WebSocketMessage, 0, len(messages))
		for _, message := range messages {
			data, err := json.Marshal(message)
			if err != nil {
				return err
			}
			if len(data) > s.config.limit {
				return errors.New("Respeecher message exceeds MaxMessageBytes")
			}
			encoded = append(encoded, runtime.WebSocketText(data))
		}
		ch := make(chan error, 1)
		pendingSend = ch
		go func() {
			for _, data := range encoded {
				if err := socket.Send(s.ctx, data); err != nil {
					ch <- err
					return
				}
			}
			ch <- nil
		}()
		return nil
	}
	generation := func(id, text string, continued bool) map[string]any {
		wire := maps.Clone(s.config.wire)
		wire["context_id"], wire["transcript"], wire["continue"] = id, text, continued
		return wire
	}
	pullInput()
	pullOutput()
	for !inputDone || len(contexts) > 0 || pendingSend != nil {
		if err := s.ctx.Err(); err != nil {
			return err
		}
		var input inputResult
		var received socketResult
		var sent error
		kind := 0
		// Alternate ready lanes without letting backpressured writes block audio.
		if preferOutput {
			select {
			case received = <-pendingOutput:
				kind = 1
			default:
			}
		} else {
			select {
			case sent = <-pendingSend:
				kind = 2
			default:
			}
			if kind == 0 {
				select {
				case input = <-pendingInput:
					kind = 3
				default:
				}
			}
		}
		if kind == 0 {
			select {
			case received = <-pendingOutput:
				kind = 1
			case sent = <-pendingSend:
				kind = 2
			case input = <-pendingInput:
				kind = 3
			case <-s.ctx.Done():
				return s.ctx.Err()
			}
		}
		preferOutput = kind != 1
		switch kind {
		case 1:
			pendingOutput = nil
			if received.err == io.EOF {
				return errors.New("Respeecher WebSocket closed before synthesis completed")
			}
			if received.err != nil {
				return received.err
			}
			var text string
			switch value := received.value.(type) {
			case runtime.WebSocketText:
				text = string(value)
			case *runtime.WebSocketText:
				if value == nil {
					return errors.New("Respeecher returned a non-text WebSocket frame")
				}
				text = string(*value)
			default:
				return errors.New("Respeecher returned a non-text WebSocket frame")
			}
			if len(text) > s.config.limit {
				return errors.New("Respeecher message exceeds MaxMessageBytes")
			}
			p, err := decode([]byte(text), true)
			if err != nil {
				return err
			}
			pullOutput()
			id := p.context.Value
			if strings.HasPrefix(id, prefix) {
				ordinal, err := strconv.ParseInt(strings.TrimPrefix(id, prefix), 10, 64)
				if err == nil && ordinal >= 0 && ordinal <= cleared && id == prefix+strconv.FormatInt(ordinal, 10) {
					continue
				}
			}
			if p.failure != nil {
				return p.failure
			}
			context := contexts[id]
			if context == nil {
				return errors.New("Respeecher returned an unknown context ID")
			}
			if p.kind == "chunk" {
				if len(p.audio) > 0 {
					context.audio = true
					if err := s.emit(out.SynthesisItemAsOrdered{Value: out.AudioEnvelope{CorrelationId: id, Audio: p.audio}}); err != nil {
						return err
					}
				}
			} else {
				if !context.ended {
					return errors.New("Respeecher completed a context before its text ended")
				}
				if !context.audio {
					return errors.New("Respeecher completed a context without audio")
				}
				delete(contexts, id)
				if context.flush {
					if err := s.emit(out.SynthesisItemAsFlush{Value: out.FlushEvent{CorrelationId: id, InputGroupId: id}}); err != nil {
						return err
					}
				}
			}
		case 2:
			pendingSend = nil
			if sent != nil {
				return sent
			}
			if !inputDone {
				pullInput()
			}
		case 3:
			pendingInput = nil
			text, command := "", ""
			if input.err == io.EOF {
				inputDone = true
				command = "flush"
			} else if input.err != nil {
				return input.err
			} else if s.config.input == nil {
				text = s.config.text
			} else {
				if err := s.config.validate(input.value); err != nil {
					return err
				}
				var err error
				text, command, err = inputValue(input.value)
				if err != nil {
					return err
				}
			}
			messages := []map[string]any{}
			switch command {
			case "":
				if text != "" {
					if current == "" {
						current = prefix + strconv.FormatInt(sequence, 10)
						sequence++
						contexts[current] = &synthesisContext{}
					}
					messages = append(messages, generation(current, text, true))
				}
			case "clear":
				for id := range contexts {
					messages = append(messages, map[string]any{"context_id": id, "cancel": true})
				}
				cleared = sequence - 1
				contexts = map[string]*synthesisContext{}
				current = ""
			case "flush":
				if current != "" {
					contexts[current].ended = true
					contexts[current].flush = !inputDone
					messages = append(messages, generation(current, "", false))
					current = ""
				}
			}
			if len(messages) > 0 {
				if err := send(messages); err != nil {
					return err
				}
			} else if !inputDone {
				pullInput()
			}
			if command == "clear" {
				if err := s.emit(out.SynthesisItemAsClear{}); err != nil {
					return err
				}
			}
		}
	}
	return nil
}
