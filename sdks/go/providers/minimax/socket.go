package minimax

import (
	"context"
	"encoding/json"
	"errors"
	schema "github.com/speechswitch/client/sdks/go/generated/minimax"
	out "github.com/speechswitch/client/sdks/go/generated/minimax_output"
	"github.com/speechswitch/client/sdks/go/runtime"
	"io"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf16"
)

type socketResult struct {
	packet packet
	err    error
}
type socketStream struct {
	parent, ctx                        context.Context
	cancel                             context.CancelFunc
	stop                               func() bool
	socket                             runtime.WebSocketLike
	config                             configuration
	validate                           runtime.InputValidator
	limit                              int
	session                            string
	connection                         runtime.Optional[string]
	once                               sync.Once
	mutex, lifecycle                   sync.Mutex
	closeError                         error
	started, done, finishing, clearing atomic.Bool
	producerIdle                       <-chan struct{}
	handshakeResult                    <-chan socketResult
	producerResult                     <-chan error
	pending                            <-chan socketResult
	resume                             chan struct{}
	initialized, ready, terminal       bool
}

func (s *socketStream) closeResources() error {
	s.once.Do(func() {
		s.lifecycle.Lock()
		s.cancel()
		idle := s.producerIdle
		s.lifecycle.Unlock()
		if s.started.Load() && !s.done.Load() {
			// Cancellation must not wait indefinitely for a blocked writer.
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
			sent := make(chan struct{})
			go func() { _ = s.send(ctx, map[string]any{"event": "task_cancel"}); close(sent) }()
			select {
			case <-sent:
			case <-ctx.Done():
			}
			cancel()
		}
		s.closeError = s.socket.Close()
		go func() { <-idle; _ = s.config.input.Close() }()
	})
	return s.closeError
}
func (s *socketStream) Close() error { s.stop(); return s.closeResources() }
func (s *socketStream) send(ctx context.Context, value map[string]any) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return s.socket.Send(ctx, runtime.WebSocketText(data))
}
func (s *socketStream) receive() (packet, error) {
	message, err := s.socket.Receive(s.ctx)
	if err == io.EOF {
		return packet{}, errors.New("MiniMax WebSocket closed before task_finished")
	}
	if err != nil {
		return packet{}, err
	}
	text, ok := message.(runtime.WebSocketText)
	if !ok {
		return packet{}, errors.New("MiniMax WebSocket messages must be JSON text")
	}
	if len(text) > s.limit {
		return packet{}, errors.New("MiniMax message exceeds MaxMessageBytes")
	}
	p, err := decodePacket([]byte(text))
	if err != nil {
		return p, err
	}
	if p.code != 0 {
		return p, &Error{Message: p.message, Code: runtime.Some(p.code)}
	}
	return p, nil
}
func (s *socketStream) handshake() (packet, error) {
	connected, err := s.receive()
	if err != nil {
		return packet{}, err
	}
	if !connected.event.Present || connected.event.Value != "connected_success" {
		return packet{}, errors.New("MiniMax did not acknowledge the connection")
	}
	config := map[string]any{}
	for k, v := range s.config.wire {
		config[k] = v
	}
	config["event"], config["session_id"], config["subtitle_enable"] = "task_start", s.session, false
	s.started.Store(true)
	if err = s.send(s.ctx, config); err != nil {
		return packet{}, err
	}
	started, err := s.receive()
	if err != nil {
		return packet{}, err
	}
	if !started.event.Present || started.event.Value != "task_started" {
		return packet{}, errors.New("MiniMax did not acknowledge task_start")
	}
	if started.session.Present && started.session.Value != s.session {
		return packet{}, errors.New("MiniMax returned an unexpected session ID")
	}
	connection := connected.connection
	if !connection.Present {
		connection = connected.session
	}
	if connection.Present && started.connection.Present && connection.Value != started.connection.Value {
		return packet{}, errors.New("MiniMax returned an unexpected connection ID")
	}
	return packet{connection: connection}, nil
}
func (s *socketStream) start() {
	s.lifecycle.Lock()
	defer s.lifecycle.Unlock()
	if s.ctx.Err() != nil || s.initialized {
		return
	}
	s.initialized = true
	idle, result := make(chan struct{}), make(chan socketResult, 1)
	s.producerIdle, s.handshakeResult = idle, result
	go func() { p, err := s.handshake(); close(idle); result <- socketResult{p, err} }()
}

// Match ECMAScript trim and UTF-16 limits so token boundaries survive across SDKs.
const whitespace = " \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"

func (s *socketStream) produce() error {
	pendingSpace := ""
	awaitingCancel := false
	for {
		if err := s.ctx.Err(); err != nil {
			return err
		}
		item, err := s.config.input.Next(s.ctx)
		if cause := s.ctx.Err(); cause != nil {
			return cause
		}
		if err != nil && err != io.EOF {
			return err
		}
		if err == nil {
			if err = s.validate(item); err != nil {
				return err
			}
		}
		if awaitingCancel {
			select {
			case <-s.resume:
			case <-s.ctx.Done():
				return s.ctx.Err()
			}
			awaitingCancel = false
		}
		if err == io.EOF {
			s.finishing.Store(true)
			return s.send(s.ctx, map[string]any{"event": "task_finish"})
		}
		switch v := item.(type) {
		case *schema.TtsRequestStreamingText12421ea0TextItemAsString:
			item = *v
		case *schema.TtsRequestStreamingText12421ea0TextItemAsClear:
			item = *v
		case *schema.TtsRequestStreamingText12421ea0TextItemAsFlush:
			item = *v
		}
		switch v := item.(type) {
		case schema.TtsRequestStreamingText12421ea0TextItemAsString:
			if len(utf16.Encode([]rune(v.Value))) >= 10000 {
				return errors.New("MiniMax text pieces must contain fewer than 10000 UTF-16 code units")
			}
			text := pendingSpace + v.Value
			pendingSpace = ""
			if strings.Trim(text, whitespace) == "" {
				if len(utf16.Encode([]rune(text))) >= 10000 {
					return errors.New("MiniMax pending whitespace exceeds a native message")
				}
				pendingSpace = text
			} else {
				for text != "" {
					end, units := 0, 0
					for i, r := range text {
						width := 1
						if r > 0xffff {
							width = 2
						}
						if units+width > 9999 {
							break
						}
						units += width
						end = i + len(string(r))
					}
					piece := text[:end]
					text = text[end:]
					if strings.Trim(piece, whitespace) != "" {
						if err = s.send(s.ctx, map[string]any{"event": "task_continue", "text": piece}); err != nil {
							return err
						}
					} else if text != "" {
						return errors.New("MiniMax pending whitespace exceeds a native message")
					} else {
						pendingSpace = piece
					}
				}
			}
		case schema.TtsRequestStreamingText12421ea0TextItemAsClear:
			pendingSpace = ""
			s.clearing.Store(true)
			awaitingCancel = true
			if err = s.send(s.ctx, map[string]any{"event": "task_cancel"}); err != nil {
				return err
			}
		case schema.TtsRequestStreamingText12421ea0TextItemAsFlush:
			pendingSpace = ""
			if err = s.send(s.ctx, map[string]any{"event": "task_flush"}); err != nil {
				return err
			}
		}
	}
}
func (s *socketStream) startProducer() {
	s.lifecycle.Lock()
	defer s.lifecycle.Unlock()
	if s.ctx.Err() != nil {
		return
	}
	idle, result := make(chan struct{}), make(chan error, 1)
	s.producerIdle, s.producerResult = idle, result
	go func() { err := s.produce(); close(idle); result <- err }()
}
func (s *socketStream) Next(ctx context.Context) (out.SynthesisItem, error) {
	stop := context.AfterFunc(ctx, func() { s.closeResources() })
	defer stop()
	s.mutex.Lock()
	defer s.mutex.Unlock()
	if s.terminal || s.done.Load() {
		return nil, io.EOF
	}
	item, err := s.next(ctx)
	if cause := ctx.Err(); cause != nil {
		item, err = nil, cause
	} else if cause := s.parent.Err(); cause != nil {
		item, err = nil, cause
	} else if s.ctx.Err() != nil && !s.done.Load() {
		item, err = nil, io.EOF
	}
	if err != nil {
		s.terminal = true
		s.Close()
	}
	return item, err
}
func (s *socketStream) next(ctx context.Context) (out.SynthesisItem, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if s.ctx.Err() != nil {
		return nil, io.EOF
	}
	s.start()
	if !s.ready {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-s.ctx.Done():
			return nil, io.EOF
		case result := <-s.handshakeResult:
			if result.err != nil {
				return nil, result.err
			}
			s.connection = result.packet.connection
			s.ready = true
			s.startProducer()
		}
	}
	for {
		if s.pending == nil {
			result := make(chan socketResult, 1)
			s.pending = result
			go func() { p, err := s.receive(); result <- socketResult{p, err} }()
		}
		var result socketResult
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-s.ctx.Done():
			return nil, io.EOF
		case err := <-s.producerResult:
			s.producerResult = nil
			if err != nil {
				return nil, err
			}
			continue
		case result = <-s.pending:
			s.pending = nil
		}
		if result.err != nil {
			return nil, result.err
		}
		p := result.packet
		if p.session.Present && p.session.Value != s.session {
			return nil, errors.New("MiniMax returned an unexpected session ID")
		}
		if s.connection.Present && p.connection.Present && p.connection.Value != s.connection.Value {
			return nil, errors.New("MiniMax returned an unexpected connection ID")
		}
		event := p.event.Value
		if !p.event.Present && (p.audioPresent || p.final.Present) {
			event = "task_continued"
		}
		if event == "task_failed" {
			message := p.message
			if message == "" {
				message = "MiniMax synthesis task failed"
			}
			return nil, &Error{Message: message, Code: runtime.Some(p.code)}
		}
		if event == "task_finished" && s.clearing.Load() {
			return nil, errors.New("MiniMax ended the session before acknowledging cancellation")
		}
		if event == "task_canceled" {
			if !s.clearing.Swap(false) {
				return nil, errors.New("MiniMax returned an unsolicited cancel acknowledgement")
			}
			s.resume <- struct{}{}
			return out.SynthesisItemAsClear{}, nil
		}
		if s.clearing.Load() {
			continue
		}
		switch event {
		case "task_finished":
			if !s.finishing.Load() {
				return nil, errors.New("MiniMax ended the session before task_finish")
			}
			if s.producerResult != nil {
				select {
				case <-ctx.Done():
					return nil, ctx.Err()
				case <-s.ctx.Done():
					return nil, io.EOF
				case err := <-s.producerResult:
					s.producerResult = nil
					if err != nil {
						return nil, err
					}
				}
			}
			s.done.Store(true)
			s.Close()
			return out.SynthesisItemAsDone{Value: out.MiniMaxDoneEvent{TraceId: p.trace, Usage: p.usage}}, nil
		case "task_flushed":
			id := s.session
			if p.trace.Present {
				id = p.trace.Value
			}
			return out.SynthesisItemAsFlush{Value: out.FlushEvent{CorrelationId: id, InputGroupId: runtime.Some(s.session)}}, nil
		case "sentence_start", "sentence_end", "task_continued":
			envelope := out.MiniMaxEnvelope{Correlation: out.MiniMaxEnvelopeCorrelationAsOrdered{}, InputGroupId: runtime.Some(s.session), CorrelationId: p.trace, TraceId: p.trace, Timestamps: []out.MiniMaxTimestamp{}}
			if event == "sentence_start" {
				var boundary out.MiniMaxEnvelopeSentenceBoundary = out.MiniMaxEnvelopeSentenceBoundaryAsStart{}
				envelope.SentenceBoundary = runtime.Some(boundary)
			} else if event == "sentence_end" {
				var boundary out.MiniMaxEnvelopeSentenceBoundary = out.MiniMaxEnvelopeSentenceBoundaryAsEnd{}
				envelope.SentenceBoundary = runtime.Some(boundary)
			} else {
				if len(p.audio) == 0 && !p.final.Value && !p.usage.Present {
					continue
				}
				if len(p.audio) > 0 {
					envelope.Audio = runtime.Some(p.audio)
				}
				if p.final.Value {
					var complete out.MiniMaxEnvelopeRequestComplete = out.MiniMaxEnvelopeRequestCompleteAsTrue{}
					envelope.RequestComplete = runtime.Some(complete)
				}
				envelope.Usage = p.usage
			}
			return out.SynthesisItemAsOrderedOrTimeline{Value: envelope}, nil
		}
	}
}
