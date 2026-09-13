package xai

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"sync"

	out "github.com/speechswitch/client/sdks/go/generated/xai_output"
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
type sessionState struct {
	hasText, flushing, clearing bool
	updates                     uint64
}

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
	s.resourceMutex.Lock()
	if s.closed || ctx.Err() != nil {
		s.resourceMutex.Unlock()
		return ctx.Err()
	}
	s.inputStarted = true
	s.resourceMutex.Unlock()
	var state sessionState
	var stateMutex sync.Mutex
	var pendingInput <-chan inputResult
	var pendingOutput <-chan socketResult
	var pendingSend <-chan error
	var held *inputResult
	var waitingDone *packet
	inputDone, preferOutput := false, true
	pullInput := func() {
		ch := make(chan inputResult, 1)
		pendingInput = ch
		go func() {
			value, err := s.config.input.Next(ctx)
			if err != nil {
				ch <- inputResult{err: err}
				return
			}
			item, err := inputValue(value, s.config.validate)
			ch <- inputResult{value: item, err: err}
		}()
	}
	receive := func() (packet, error) {
		frame, err := socket.Receive(ctx)
		if err == io.EOF {
			return packet{}, errors.New("xAI WebSocket closed before pending synthesis or acknowledgements completed")
		}
		if err != nil {
			return packet{}, err
		}
		p, err := decode(frame, s.config.messageLimit)
		if err != nil {
			return p, err
		}
		// Check at receipt, before later input or consumer backpressure changes state.
		stateMutex.Lock()
		defer stateMutex.Unlock()
		switch p.kind {
		case "audio.delta":
			if !state.clearing && !state.hasText && !state.flushing {
				return p, errors.New("xAI audio arrived outside an active utterance")
			}
		case "audio.clear":
			if !state.clearing {
				return p, errors.New("Unexpected xAI audio.clear acknowledgement")
			}
		case "audio.done":
			if !state.clearing && !state.flushing {
				return p, errors.New("Unexpected xAI audio.done acknowledgement")
			}
		case "session.updated":
			if state.updates == 0 {
				return p, errors.New("Unexpected xAI session.updated acknowledgement")
			}
		}
		return p, nil
	}
	pullOutput := func() {
		ch := make(chan socketResult, 1)
		pendingOutput = ch
		go func() { value, err := receive(); ch <- socketResult{value: value, err: err} }()
	}
	send := func(message map[string]any) error {
		data, err := json.Marshal(message)
		if err != nil {
			return err
		}
		if len(data) > s.config.messageLimit {
			return errors.New("xAI message exceeds MaxMessageBytes")
		}
		ch := make(chan error, 1)
		pendingSend = ch
		go func() { ch <- socket.Send(ctx, runtime.WebSocketText(data)) }()
		return nil
	}
	if s.config.initial.Present {
		state.updates++
		if err := send(map[string]any{"type": "session.update", "replace": s.config.initial.Value}); err != nil {
			return err
		}
	} else {
		pullInput()
	}
	pullOutput()
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		if waitingDone != nil && pendingSend == nil {
			if err := s.emit(waitingDone.item); err != nil {
				return err
			}
			waitingDone = nil
			pullOutput()
		}
		stateMutex.Lock()
		complete := inputDone && !state.hasText && !state.flushing && !state.clearing && state.updates == 0 && pendingSend == nil
		available := held != nil && !state.flushing && !state.clearing && pendingSend == nil
		stateMutex.Unlock()
		if complete {
			return nil
		}
		var input inputResult
		var received socketResult
		var sent error
		kind := 0
		// A queued ACK cannot mask a failed write; otherwise alternate input/output.
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
		if kind == 0 && available {
			input, held, kind = *held, nil, 3
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
			var item out.SynthesisItem
			stateMutex.Lock()
			switch p.kind {
			case "audio.delta":
				if !state.clearing {
					item = p.item
					if !s.config.timed {
						item = out.SynthesisItemAsBytes{Value: p.item.(out.SynthesisItemAsChunk).Value.Audio}
					}
				}
			case "audio.clear":
				state.clearing, state.flushing, item = false, false, p.item
			case "audio.done":
				if !state.clearing {
					state.flushing = false
					if pendingSend != nil {
						waitingDone = &p
					} else {
						item = p.item
					}
				}
			case "session.updated":
				state.updates--
				item = p.item
			}
			stateMutex.Unlock()
			if item != nil {
				if err := s.emit(item); err != nil {
					return err
				}
			}
			if waitingDone == nil {
				pullOutput()
			}
		case 2:
			pendingSend = nil
			if sent != nil {
				return sent
			}
			if !inputDone && held == nil {
				pullInput()
			}
		case 3:
			pendingInput = nil
			if input.err != nil && input.err != io.EOF {
				return input.err
			}
			eof := input.err == io.EOF
			stateMutex.Lock()
			if state.clearing || state.flushing && (eof || input.value.kind == "text" || input.value.kind == "flush") {
				held = &input
				stateMutex.Unlock()
				continue
			}
			var message map[string]any
			if eof {
				inputDone = true
				if state.hasText {
					state.hasText, state.flushing = false, true
					message = map[string]any{"type": "text.done"}
				}
			} else {
				switch input.value.kind {
				case "text":
					if input.value.text != "" {
						state.hasText = true
						message = map[string]any{"type": "text.delta", "delta": input.value.text}
					}
				case "clear":
					state.clearing, state.hasText = true, false
					message = map[string]any{"type": "text.clear"}
				case "update":
					state.updates++
					message = map[string]any{"type": "session.update", "replace": input.value.replacements}
				case "flush":
					if state.hasText {
						state.hasText, state.flushing = false, true
						message = map[string]any{"type": "text.done"}
					}
				}
			}
			stateMutex.Unlock()
			if message != nil {
				if err := send(message); err != nil {
					return err
				}
			} else if !inputDone {
				pullInput()
			}
		}
	}
}
