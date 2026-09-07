package inworld

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"strconv"
	"sync"
	"unicode/utf16"

	schema "github.com/speechswitch/client/sdks/go/generated/inworld"
	out "github.com/speechswitch/client/sdks/go/generated/inworld_output"
	"github.com/speechswitch/client/sdks/go/runtime"
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
	parent, ctx                                context.Context
	cancel                                     context.CancelFunc
	stop                                       func() bool
	socket                                     runtime.WebSocketLike
	input                                      runtime.Input[Input]
	timed, chunk                               bool
	create                                     map[string]any
	contextID                                  string
	created                                    bool
	flush                                      uint64
	wave                                       *waveStream
	validate                                   runtime.InputValidator
	limit                                      int
	once                                       sync.Once
	closeError                                 error
	mutex, lifecycle                           sync.Mutex
	inputIdle                                  <-chan struct{}
	started, terminal, inputDone, preferOutput bool
	pendingInput                               <-chan inputResult
	pendingOutput                              <-chan socketResult
	pendingSend                                <-chan error
}

func (s *socketStream) closeResources() error {
	s.once.Do(func() {
		s.lifecycle.Lock()
		s.cancel()
		idle := s.inputIdle
		s.lifecycle.Unlock()
		s.closeError = s.socket.Close()
		// The socket and caller never wait for an uncooperative Next/Close.
		go func() { <-idle; _ = s.input.Close() }()
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
	pending := make(chan inputResult, 1)
	idle := make(chan struct{})
	s.inputIdle, s.pendingInput = idle, pending
	go func() { value, err := s.input.Next(s.ctx); close(idle); pending <- inputResult{value, err} }()
}
func (s *socketStream) pullOutput() {
	pending := make(chan socketResult, 1)
	s.pendingOutput = pending
	go func() { value, err := s.socket.Receive(s.ctx); pending <- socketResult{value, err} }()
}
func (s *socketStream) send(value map[string]any) {
	value["contextId"] = s.contextID
	pending := make(chan error, 1)
	s.pendingSend = pending
	go func() {
		data, err := json.Marshal(value)
		if err == nil && len(data) > s.limit {
			err = errors.New("Inworld message exceeds MaxMessageBytes")
		}
		if err == nil {
			err = s.socket.Send(s.ctx, runtime.WebSocketText(data))
		}
		pending <- err
	}()
}
func (s *socketStream) next(ctx context.Context) (out.SynthesisItem, error) {
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if err := s.parent.Err(); err != nil {
			return nil, err
		}
		if s.ctx.Err() != nil {
			return nil, io.EOF
		}
		if !s.started {
			s.started = true
			s.send(map[string]any{"create": s.create})
			s.pullOutput()
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
		// Alternate ready lanes, maintaining one outstanding pull/send/receive.
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
			if !s.inputDone {
				s.pullInput()
			}
		case "input":
			s.pendingInput = nil
			s.preferOutput = true
			if input.err == io.EOF {
				// Normal close can arrive before the final write finishes draining.
				s.inputDone = true
				s.send(map[string]any{"close_context": map[string]any{}})
				continue
			}
			if input.err != nil {
				return nil, input.err
			}
			if err := s.validate(input.value); err != nil {
				return nil, err
			}
			var text string
			flush := false
			switch v := input.value.(type) {
			case schema.TtsRequestStreamingTextVoiceTextItemAsString:
				text = v.Value
			case *schema.TtsRequestStreamingTextVoiceTextItemAsString:
				text = v.Value
			case schema.TtsRequestStreamingTextVoiceTextItemAsFlush, *schema.TtsRequestStreamingTextVoiceTextItemAsFlush:
				flush = true
			}
			if flush {
				s.send(map[string]any{"flush_context": map[string]any{}})
			} else {
				if len(utf16.Encode([]rune(text))) > 2000 {
					return nil, errors.New("Inworld text chunks must not exceed 2000 characters")
				}
				if text == "" {
					s.pullInput()
				} else {
					s.send(map[string]any{"send_text": map[string]any{"text": text}})
				}
			}
		case "output":
			s.pendingOutput = nil
			s.preferOutput = false

			if output.err == io.EOF {
				return nil, errors.New("Inworld WebSocket closed before contextClosed")
			}
			if output.err != nil {
				return nil, output.err
			}
			frame, ok := output.value.(runtime.WebSocketText)
			if !ok {
				return nil, errors.New("Inworld returned a non-text WebSocket frame")
			}
			if len(frame) > s.limit {
				return nil, errors.New("Inworld message exceeds MaxMessageBytes")
			}
			packet, err := result([]byte(frame))
			if err != nil {
				return nil, err
			}
			if value, present := packet["status"]; present {
				fields, _ := value.(map[string]any)
				if err := status(fields); err != nil {
					return nil, err
				}
			}
			if packet["contextId"] != s.contextID {
				return nil, errors.New("Inworld returned an unexpected context ID")
			}
			kind, count := "", 0
			for _, name := range []string{"contextCreated", "audioChunk", "flushCompleted", "contextClosed"} {
				if _, present := packet[name]; present {
					kind = name
					count++
				}
			}
			if count != 1 {
				return nil, errors.New("Inworld returned an invalid context event")
			}
			fields, ok := packet[kind].(map[string]any)
			if !ok {
				return nil, errors.New("Inworld returned an invalid object")
			}
			var item out.SynthesisItem
			if kind == "contextCreated" {
				if s.created {
					return nil, errors.New("Inworld returned duplicate contextCreated")
				}
				s.created = true
			} else {
				if !s.created {
					return nil, errors.New("Inworld returned output before contextCreated")
				}
				ordinal := strconv.FormatUint(s.flush, 10)
				group := s.contextID + ":" + ordinal
				switch kind {
				case "audioChunk":
					item, err = audioOutput(fields, s.timed, s.chunk, runtime.Some(group), s.wave)
					if err != nil {
						return nil, err
					}
				case "flushCompleted":
					if s.wave != nil {
						if err := s.wave.boundary(); err != nil {
							return nil, err
						}
					}
					item = out.SynthesisItemAsFlush{Value: out.FlushEvent{CorrelationId: group, InputGroupId: runtime.Some(ordinal)}}
					s.flush++
				case "contextClosed":
					if !s.inputDone {
						return nil, errors.New("Inworld completed before the input stream ended")
					}
					if s.wave != nil {
						if err := s.wave.boundary(); err != nil {
							return nil, err
						}
					}
					return nil, io.EOF
				}
			}
			s.pullOutput()
			if item != nil {
				return item, nil
			}
		}
	}
}
