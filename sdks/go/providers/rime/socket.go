package rime

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"strconv"
	"strings"
	"sync/atomic"
	"unicode/utf8"

	out "github.com/speechswitch/client/sdks/go/generated/rime_output"
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

func (s *stream) runSocket() error {
	s.resourceMutex.Lock()
	socket, closed := s.socket, s.closed
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
	prefix, generation := hex.EncodeToString(random[:])+":", int64(0)
	inputDone, wholeRead, preferOutput := false, false, false
	var eosStarted atomic.Bool
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
				ch <- inputResult{}
			}
			return
		}
		go func() { value, err := s.config.input.Next(s.ctx); ch <- inputResult{value: value, err: err} }()
	}
	pullOutput := func() {
		ch := make(chan socketResult, 1)
		pendingOutput = ch
		go func() {
			value, err := socket.Receive(s.ctx)
			// Record closure ordering here, not when a backpressured consumer reads it.
			if err == io.EOF && !eosStarted.Load() {
				err = errors.New("Rime WebSocket closed before clean end-of-stream")
			}
			ch <- socketResult{value: value, err: err}
		}()
	}
	send := func(message map[string]any) error {
		data, err := json.Marshal(message)
		if err != nil {
			return err
		}
		if len(data) > s.config.limit {
			return errors.New("Rime message exceeds MaxMessageBytes")
		}
		ch := make(chan error, 1)
		pendingSend = ch
		go func() {
			if message["operation"] == "eos" {
				eosStarted.Store(true)
			}
			ch <- socket.Send(s.ctx, runtime.WebSocketText(data))
		}()
		return nil
	}
	pullInput()
	pullOutput()
	for {
		if err := s.ctx.Err(); err != nil {
			return err
		}
		var input inputResult
		var received socketResult
		var sent error
		kind := 0
		// Alternate ready lanes; socket writes never block incoming audio reads.
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
				// A clean close cannot hide a failing or still-pending EOS write.
				if pendingSend != nil {
					select {
					case err := <-pendingSend:
						return err
					case <-s.ctx.Done():
						return s.ctx.Err()
					}
				}
				return nil
			}
			if received.err != nil {
				return received.err
			}
			var data []byte
			switch value := received.value.(type) {
			case runtime.WebSocketText:
				data = []byte(value)
			case *runtime.WebSocketText:
				if value == nil {
					return errors.New("Rime returned a non-text WebSocket frame")
				}
				data = []byte(*value)
			default:
				return errors.New("Rime returned a non-text WebSocket frame")
			}
			if len(data) > s.config.limit {
				return errors.New("Rime message exceeds MaxMessageBytes")
			}
			p, err := decode(data)
			if err != nil {
				return err
			}
			pullOutput()
			id := p.context.Value
			if strings.HasPrefix(id, prefix) {
				ordinal, err := strconv.ParseInt(strings.TrimPrefix(id, prefix), 10, 64)
				if err == nil && ordinal >= 0 && ordinal < generation && id == prefix+strconv.FormatInt(ordinal, 10) {
					continue
				}
			}
			if generation > 0 && !p.context.Present {
				return errors.New("Rime omitted context identity after clear; stale audio cannot be distinguished")
			}
			var item out.SynthesisItem
			if p.kind == "done" {
				item = out.SynthesisItemAsBatch{Value: out.RimeBatchEvent{InputGroupId: p.context}}
			} else if !s.config.timed {
				if p.kind == "chunk" && len(p.audio) > 0 {
					item = out.SynthesisItemAsBytes{Value: p.audio}
				}
			} else if p.kind == "timestamps" || len(p.audio) > 0 {
				envelope := out.RimeEnvelope{InputGroupId: p.context, Timestamps: p.timestamps}
				if p.kind == "chunk" {
					envelope.Audio = runtime.Some(p.audio)
					envelope.Timestamps = []out.RimeEnvelopeTimestampsItem{}
				}
				item = out.SynthesisItemAsOrdered{Value: envelope}
			}
			if item != nil {
				if err := s.emit(item); err != nil {
					return err
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
				command = "eos"
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
			var message map[string]any
			if command == "" {
				if utf8.RuneCountInString(text) > 1000 {
					return errors.New("Rime WebSocket text frames are limited to 1000 code points")
				}
				if text != "" {
					message = map[string]any{"text": text, "contextId": prefix + strconv.FormatInt(generation, 10)}
				}
			} else {
				message = map[string]any{"operation": command}
				if command == "clear" {
					generation++
				}
			}
			if message != nil {
				if err := send(message); err != nil {
					return err
				}
			} else if !inputDone {
				pullInput()
			}
			if command == "clear" {
				// Local playback invalidation; native clear only discards buffered text.
				if err := s.emit(out.SynthesisItemAsClear{}); err != nil {
					return err
				}
			}
		}
	}
}
