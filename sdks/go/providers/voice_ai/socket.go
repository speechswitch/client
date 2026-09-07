package voice_ai

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"maps"
	"strconv"
	"strings"
	"sync"

	out "github.com/speechswitch/client/sdks/go/generated/voice_ai_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type inputResult struct {
	value inputEvent
	err   error
}
type socketResult struct {
	value packet
	err   error
}
type nativeContext struct{ flushing, cleared, audio, finished bool }

func (s *stream) runSocket() error {
	ctx, cancel := context.WithCancel(s.ctx)
	defer cancel()
	s.resourceMutex.Lock()
	socket, closed := s.socket, s.closed
	s.resourceMutex.Unlock()
	if closed {
		return s.ctx.Err()
	}
	if socket == nil {
		var err error
		socket, err = s.config.connectSocket(ctx)
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
	var entropy [16]byte
	if _, err := rand.Read(entropy[:]); err != nil {
		return err
	}
	prefix := hex.EncodeToString(entropy[:]) + ":"
	s.resourceMutex.Lock()
	if s.closed {
		s.resourceMutex.Unlock()
		return s.ctx.Err()
	}
	s.inputStarted = true
	s.resourceMutex.Unlock()
	contexts := map[string]*nativeContext{}
	var stateMutex sync.Mutex
	var retiredThrough uint64
	var clears []map[string]bool
	var current string
	var sequence uint64
	inputDone, wholeRead, preferOutput := false, false, true
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
				ch <- inputResult{value: inputEvent{"text", s.config.text}}
			}
			return
		}
		go func() { value, err := s.config.input.Next(ctx); ch <- inputResult{value, err} }()
	}
	receive := func() (packet, error) {
		frame, err := socket.Receive(ctx)
		if err == io.EOF {
			return packet{}, errors.New("Voice.ai closed before input and contexts completed")
		}
		if err != nil {
			return packet{}, err
		}
		// Snapshot protocol state at receipt. Later input or consumer backpressure
		// cannot turn premature audio/completion into a valid flush.
		stateMutex.Lock()
		defer stateMutex.Unlock()
		p, err := decode(frame, s.config.limit)
		if err != nil {
			return packet{}, err
		}
		context := contexts[p.id]
		if context == nil {
			if strings.HasPrefix(p.id, prefix) {
				suffix := strings.TrimPrefix(p.id, prefix)
				ordinal, err := strconv.ParseUint(suffix, 10, 64)
				if err == nil && strconv.FormatUint(ordinal, 10) == suffix && ordinal > 0 && ordinal <= retiredThrough && ordinal <= 9007199254740991 {
					return p, nil
				}
			}
			return packet{}, errors.New("Voice.ai returned an unknown or completed context")
		}
		if !context.cleared {
			switch p.kind {
			case "audio":
				if !context.flushing || context.finished {
					return packet{}, errors.New("Voice.ai audio arrived outside an active flush")
				}
				context.audio = context.audio || len(p.audio) > 0
			case "flush":
				if !context.flushing || context.finished || !context.audio {
					return packet{}, errors.New("Voice.ai returned an unexpected or empty flush completion")
				}
				context.finished = true
			case "closed":
				if !context.finished {
					return packet{}, errors.New("Voice.ai context closed before flush completion")
				}
			}
		}
		return p, nil
	}
	pullOutput := func() {
		ch := make(chan socketResult, 1)
		pendingOutput = ch
		go func() { value, err := receive(); ch <- socketResult{value, err} }()
	}
	send := func(messages []map[string]any) error {
		encoded := make([]runtime.WebSocketText, 0, len(messages))
		for _, message := range messages {
			data, err := json.Marshal(message)
			if err != nil {
				return err
			}
			if len(data) > s.config.limit {
				return errors.New("Voice.ai message exceeds MaxMessageBytes")
			}
			encoded = append(encoded, runtime.WebSocketText(data))
		}
		ch := make(chan error, 1)
		pendingSend = ch
		go func() {
			for _, frame := range encoded {
				if err := socket.Send(ctx, frame); err != nil {
					ch <- err
					return
				}
			}
			ch <- nil
		}()
		return nil
	}
	pullInput()
	pullOutput()
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		for len(clears) > 0 && len(clears[0]) == 0 {
			clears[0] = nil
			clears = clears[1:]
			if err := s.emit(out.SynthesisItemAsClear{}); err != nil {
				return err
			}
		}
		stateMutex.Lock()
		empty := len(contexts) == 0
		stateMutex.Unlock()
		if inputDone && empty && pendingSend == nil {
			return nil
		}
		var input inputResult
		var received socketResult
		var sent error
		kind := 0
		// Writes have priority so a buffered acknowledgment never hides a send error.
		select {
		case sent = <-pendingSend:
			kind = 2
		default:
		}
		if kind == 0 && preferOutput {
			select {
			case received = <-pendingOutput:
				kind = 1
			default:
			}
		}
		if kind == 0 && !preferOutput {
			select {
			case input = <-pendingInput:
				kind = 3
			default:
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
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		preferOutput = kind != 1
		switch kind {
		case 1:
			pendingOutput = nil
			if received.err != nil {
				return received.err
			}
			p := received.value
			stateMutex.Lock()
			context := contexts[p.id]
			var item out.SynthesisItem
			if context != nil {
				if p.kind == "closed" {
					delete(contexts, p.id)
					for _, pending := range clears {
						delete(pending, p.id)
					}
				} else if !context.cleared {
					if p.kind == "audio" && len(p.audio) > 0 {
						item = out.SynthesisItemAsOrdered{Value: out.VoiceAiEnvelope{CorrelationId: p.id, Audio: p.audio}}
					} else if p.kind == "flush" {
						item = out.SynthesisItemAsFlush{Value: out.FlushEvent{CorrelationId: p.id}}
					}
				}
			}
			stateMutex.Unlock()
			if item != nil {
				if err := s.emit(item); err != nil {
					return err
				}
			}
			pullOutput()
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
			if input.err == io.EOF {
				inputDone = true
				input.value = inputEvent{kind: "flush"}
			} else if input.err != nil {
				return input.err
			}
			var messages []map[string]any
			stateMutex.Lock()
			switch input.value.kind {
			case "text":
				if input.value.text != "" {
					if current == "" {
						sequence++
						current = prefix + strconv.FormatUint(sequence, 10)
						contexts[current] = &nativeContext{}
						message := maps.Clone(s.config.wire)
						message["context_id"], message["text"] = current, input.value.text
						messages = append(messages, message)
					} else {
						messages = append(messages, map[string]any{"context_id": current, "text": input.value.text})
					}
				}
			case "flush":
				if current != "" {
					contexts[current].flushing = true
					messages = append(messages, map[string]any{"context_id": current, "text": "", "flush": true, "auto_close": true})
					current = ""
				}
			case "clear":
				retiredThrough = sequence
				pending := map[string]bool{}
				for id, context := range contexts {
					pending[id] = true
					if !context.cleared {
						context.cleared = true
						if !context.flushing {
							messages = append(messages, map[string]any{"context_id": id, "close_context": true})
						}
					}
				}
				clears = append(clears, pending)
				current = ""
			}
			stateMutex.Unlock()
			if len(messages) > 0 {
				if err := send(messages); err != nil {
					return err
				}
			} else if !inputDone {
				pullInput()
			}
		}
	}
}
