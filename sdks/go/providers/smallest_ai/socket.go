package smallest_ai

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"maps"
	"sync"
	"sync/atomic"
	"time"

	out "github.com/speechswitch/client/sdks/go/generated/smallest_ai_output"
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

func externalID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes[:]), nil
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
	if s.closed {
		s.resourceMutex.Unlock()
		return s.ctx.Err()
	}
	s.inputStarted = true
	s.resourceMutex.Unlock()
	id, _ := s.config.wire["request_id"].(string)
	if id == "" {
		var err error
		id, err = externalID()
		if err != nil {
			return err
		}
	}
	stale := map[string]bool{}
	inputDone, wholeRead, sentText, receivedAudio, preferOutput := false, false, false, false, true
	var ended atomic.Bool
	var writing sync.Mutex
	heartbeatContext, stopHeartbeat := context.WithCancel(ctx)
	defer stopHeartbeat()
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
				ch <- inputResult{value: inputEvent{text: s.config.text}}
			}
			return
		}
		go func() { value, err := s.config.input.Next(ctx); ch <- inputResult{value, err} }()
	}
	pullOutput := func() {
		ch := make(chan socketResult, 1)
		pendingOutput = ch
		go func() {
			for {
				value, err := socket.Receive(ctx)
				// Capture before decoding or waiting for the consumer: later input EOF
				// must not relabel a premature native completion as success.
				endedAtReceipt := ended.Load()
				if err == io.EOF {
					if s.config.contextID != "" {
						err = errors.New("Smallest.ai continuation closed without a context-complete marker")
					} else {
						err = errors.New("Smallest.ai WebSocket closed before completion")
					}
				}
				if err != nil {
					stopHeartbeat()
					ch <- socketResult{err: err}
					return
				}
				var data []byte
				switch v := value.(type) {
				case runtime.WebSocketText:
					data = []byte(v)
				case *runtime.WebSocketText:
					if v != nil {
						data = []byte(*v)
					}
				}
				if data == nil {
					stopHeartbeat()
					ch <- socketResult{err: errors.New("Smallest.ai returned a non-text WebSocket frame")}
					return
				}
				if len(data) > s.config.limit {
					stopHeartbeat()
					ch <- socketResult{err: errors.New("Smallest.ai message exceeds MaxMessageBytes")}
					return
				}
				p, err := decode(data)
				if err == nil && p.kind == "pong" {
					if ctx.Err() != nil {
						return
					}
					continue
				}
				if err != nil || p.kind == "complete" && s.config.contextID == "" {
					stopHeartbeat()
				}
				if err == nil && p.kind == "complete" && s.config.contextID == "" && !endedAtReceipt {
					err = errors.New("Smallest.ai completed before input ended")
				}
				ch <- socketResult{p, err}
				return
			}
		}()
	}
	send := func(message map[string]any, final bool) error {
		data, err := json.Marshal(message)
		if err != nil {
			return err
		}
		if len(data) > s.config.limit {
			return errors.New("Smallest.ai message exceeds MaxMessageBytes")
		}
		ch := make(chan error, 1)
		pendingSend = ch
		go func() {
			writing.Lock()
			defer writing.Unlock()
			if final {
				ended.Store(true)
			}
			ch <- socket.Send(ctx, runtime.WebSocketText(data))
		}()
		return nil
	}
	go func() {
		ticker := time.NewTicker(s.config.heartbeatInterval)
		defer ticker.Stop()
		for {
			select {
			case <-heartbeatContext.Done():
				return
			case <-ticker.C:
			}
			writing.Lock()
			if heartbeatContext.Err() != nil {
				writing.Unlock()
				return
			}
			var err error
			ping := runtime.WebSocketText(`{"type":"ping"}`)
			if len(ping) > s.config.limit {
				err = errors.New("Smallest.ai message exceeds MaxMessageBytes")
			} else {
				err = socket.Send(heartbeatContext, ping)
			}
			writing.Unlock()
			if err != nil {
				if heartbeatContext.Err() == nil {
					s.fail(err)
					s.closeResources()
				}
				return
			}
		}
	}()
	pullInput()
	pullOutput()
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		var input inputResult
		var received socketResult
		var sent error
		kind := 0
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
			if len(stale) > 0 {
				if !p.externalID.Present || p.externalID.Value == "" {
					return errors.New("Smallest.ai omitted external request identity after clear")
				}
				if stale[p.externalID.Value] {
					pullOutput()
					continue
				}
				if p.externalID.Value != id {
					return errors.New("Smallest.ai returned an unknown external request identity after clear")
				}
			}
			if p.kind == "complete" && s.config.contextID == "" {
				// Completion cannot hide a failed or still-pending final write.
				if pendingSend != nil {
					select {
					case err := <-pendingSend:
						if err != nil {
							return err
						}
					case <-ctx.Done():
						return ctx.Err()
					}
				}
				if !receivedAudio {
					return errors.New("Smallest.ai returned no audio")
				}
				return nil
			}
			pullOutput()
			var item out.SynthesisItem
			if p.kind == "complete" {
				item = out.SynthesisItemAsBatch{Value: out.SmallestBatchEvent{RequestId: p.requestID}}
			} else if p.kind == "chunk" {
				if len(p.audio) > 0 {
					receivedAudio = true
					if s.config.timed {
						item = out.SynthesisItemAsOrdered{Value: out.SmallestEnvelope{CorrelationId: p.requestID, Audio: runtime.Some(p.audio), Timestamps: []out.SmallestEnvelopeTimestampsItem{}}}
					} else {
						item = out.SynthesisItemAsBytes{Value: p.audio}
					}
				}
			} else if s.config.timed {
				item = out.SynthesisItemAsOrdered{Value: out.SmallestEnvelope{CorrelationId: p.requestID, Timestamps: p.timestamps, WordIndex: runtime.Some(p.wordIndex)}}
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
			var message map[string]any
			final := false
			if input.err == io.EOF {
				inputDone = true
				if !sentText && s.config.contextID == "" {
					return nil
				}
				if s.config.input != nil {
					final = true
					if s.config.contextID != "" {
						message = map[string]any{"context_id": s.config.contextID, "voice_id": s.config.voice, "continue": false}
					} else {
						message = maps.Clone(s.config.wire)
						message["text"] = ""
						message["request_id"] = id
						message["continue"] = false
						message["flush"] = true
						message["max_buffer_flush_ms"] = s.config.bufferDelay
						message["complete_backoff_ms"] = s.config.completionDelay
					}
				}
			} else if input.err != nil {
				return input.err
			} else if input.value.clear {
				message = map[string]any{"context_id": s.config.contextID, "cancel_request": true}
				stale[id] = true
				var err error
				id, err = externalID()
				if err != nil {
					return err
				}
			} else if input.value.text != "" {
				sentText = true
				message = maps.Clone(s.config.wire)
				message["text"] = input.value.text
				message["request_id"] = id
				if s.config.contextID != "" {
					message["context_id"] = s.config.contextID
					message["continue"] = true
					message["max_buffer_delay_ms"] = s.config.bufferDelay
				} else if s.config.input != nil {
					message["continue"] = true
					message["max_buffer_flush_ms"] = s.config.bufferDelay
					message["complete_backoff_ms"] = s.config.completionDelay
				} else {
					final = true
				}
			}
			if message != nil {
				if err := send(message, final); err != nil {
					return err
				}
			} else if !inputDone {
				pullInput()
			}
			if input.value.clear {
				if err := s.emit(out.SynthesisItemAsClear{}); err != nil {
					return err
				}
			}
		}
	}
}
