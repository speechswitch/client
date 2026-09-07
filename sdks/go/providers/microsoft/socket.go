package microsoft

import (
	"context"
	"encoding/json"
	"errors"
	out "github.com/speechswitch/client/sdks/go/generated/microsoft_output"
	"github.com/speechswitch/client/sdks/go/runtime"
	"io"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type socketResult struct {
	message runtime.WebSocketMessage
	err     error
}
type socketStream struct {
	parent, ctx              context.Context
	cancel                   context.CancelFunc
	stop                     func() bool
	socket                   runtime.WebSocketLike
	config                   configuration
	id                       string
	limit                    int
	validate                 runtime.InputValidator
	once                     sync.Once
	closeError               error
	mutex, lifecycle         sync.Mutex
	started, done, inputDone atomic.Bool
	producerIdle             <-chan struct{}
	producerResult           <-chan error
	pending                  <-chan socketResult
	terminal                 bool
	streamID                 runtime.Optional[string]
	duration                 runtime.Optional[float64]
}

func (s *socketStream) closeResources() error {
	s.once.Do(func() {
		s.lifecycle.Lock()
		s.cancel()
		idle := s.producerIdle
		started := s.started.Load()
		s.lifecycle.Unlock()
		if started && !s.done.Load() {
			// Stop is best effort and must not hold cancellation hostage to a stuck writer.
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
			sent := make(chan struct{})
			go func() { _ = s.socket.Send(ctx, encode("synthesis.control", s.id, `{"action":"stop"}`)); close(sent) }()
			select {
			case <-sent:
			case <-ctx.Done():
			}
			cancel()
		}
		s.closeError = s.socket.Close()
		if s.config.input != nil {
			go func() { <-idle; _ = s.config.input.Close() }()
		}
	})
	return s.closeError
}
func (s *socketStream) Close() error { s.stop(); return s.closeResources() }

func (s *socketStream) produce() error {
	send := func(path, body string) error {
		if err := s.ctx.Err(); err != nil {
			return err
		}
		return s.socket.Send(s.ctx, encode(path, s.id, body))
	}
	if err := send("speech.config", `{"context":{"system":{"name":"speechswitch","version":"0.0.0","build":"Go"}}}`); err != nil {
		return err
	}
	c := s.config
	synthesis := map[string]any{"audio": map[string]any{"outputFormat": c.format, "metadataOptions": map[string]bool{
		"wordBoundaryEnabled": c.tracks["word"], "sentenceBoundaryEnabled": c.tracks["sentence"], "punctuationBoundaryEnabled": false,
		"bookmarkEnabled": c.tracks["ssml"], "visemeEnabled": c.tracks["viseme"], "sessionEndEnabled": true,
	}}, "language": map[string]bool{"autoDetection": false}}
	if c.input != nil {
		synthesis["input"] = c.native
	}
	data, err := json.Marshal(map[string]any{"synthesis": synthesis})
	if err != nil {
		return err
	}
	if err = send("synthesis.context", string(data)); err != nil {
		return err
	}
	if c.input == nil {
		s.inputDone.Store(true)
		return send("ssml", c.markup)
	}
	for {
		if err = s.ctx.Err(); err != nil {
			return err
		}
		value, err := c.input.Next(s.ctx)
		if cause := s.ctx.Err(); cause != nil {
			return cause
		}
		if err == io.EOF {
			s.inputDone.Store(true)
			return send("text.end", "")
		}
		if err != nil {
			return err
		}
		if err = s.validate(value); err != nil {
			return err
		}
		if err = send("text.piece", value); err != nil {
			return err
		}
	}
}

func (s *socketStream) start() {
	s.lifecycle.Lock()
	defer s.lifecycle.Unlock()
	if s.ctx.Err() != nil || s.started.Load() {
		return
	}
	s.started.Store(true)
	idle := make(chan struct{})
	result := make(chan error, 1)
	s.producerIdle, s.producerResult = idle, result
	go func() { err := s.produce(); close(idle); result <- err }()
}

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

func (s *socketStream) next(ctx context.Context) (out.SynthesisItem, error) {
	if s.done.Load() {
		return nil, io.EOF
	}
	s.start()
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if s.ctx.Err() != nil {
			return nil, io.EOF
		}
		if s.pending == nil {
			pending := make(chan socketResult, 1)
			s.pending = pending
			go func() { message, err := s.socket.Receive(s.ctx); pending <- socketResult{message, err} }()
		}
		var received socketResult
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
		case received = <-s.pending:
			s.pending = nil
		}
		if received.err == io.EOF {
			return nil, errors.New("Microsoft WebSocket closed before turn.end")
		}
		if received.err != nil {
			return nil, received.err
		}
		f, err := decode(received.message, s.limit)
		if err != nil {
			return nil, err
		}
		if !strings.EqualFold(f.requestID, s.id) {
			return nil, errors.New("Microsoft returned an unexpected synthesis request ID")
		}
		switch f.path {
		case "turn.start", "turn.end":
			if f.binary {
				return nil, errors.New("Microsoft turn event must be a text frame")
			}
			if f.path == "turn.end" {
				if !s.inputDone.Load() {
					return nil, errors.New("Microsoft ended synthesis before text.end")
				}
				// An acknowledgement can race the final write; retain its failure if it fails.
				if s.producerResult != nil {
					select {
					case <-ctx.Done():
						return nil, ctx.Err()
					case <-s.ctx.Done():
						return nil, io.EOF
					case err := <-s.producerResult:
						if err != nil {
							return nil, err
						}
					}
					s.producerResult = nil
				}
				s.done.Store(true)
				s.Close()
				return out.SynthesisItemAsDone{Value: out.MicrosoftDoneEvent{RequestId: s.id, DurationMs: s.duration}}, nil
			}
		case "audio":
			if !f.binary || f.streamID.Value == "" {
				return nil, errors.New("Microsoft audio frame is missing binary audio or X-StreamId")
			}
			if !s.streamID.Present || !strings.EqualFold(f.streamID.Value, s.streamID.Value) {
				return nil, errors.New("Microsoft returned audio for an unexpected stream")
			}
			if len(f.body) > 0 {
				audio := append([]byte{}, f.body...)
				if !s.config.timed {
					return out.SynthesisItemAsBytes{Value: audio}, nil
				}
				return out.SynthesisItemAsTimeline{Value: out.MicrosoftEnvelope{CorrelationId: s.id, StreamId: s.streamID, Audio: runtime.Some(audio), Timestamps: []out.MicrosoftTimestamp{}}}, nil
			}
		case "response", "audio.metadata":
			if f.binary {
				return nil, errors.New("Microsoft synthesis metadata must be a text frame")
			}
			body, err := object(f.body)
			if err != nil {
				return nil, err
			}
			if f.path == "response" {
				audio, err := object(body["audio"])
				if err != nil {
					return nil, err
				}
				id, ok := stringValue(audio["streamId"])
				if !ok || id == "" {
					return nil, errors.New("Microsoft synthesis response is missing audio.streamId")
				}
				if s.streamID.Present && s.streamID.Value != id {
					return nil, errors.New("Microsoft changed the audio stream within a synthesis turn")
				}
				s.streamID = runtime.Some(id)
			} else {
				if f.streamID.Present && (!s.streamID.Present || !strings.EqualFold(f.streamID.Value, s.streamID.Value)) {
					return nil, errors.New("Microsoft returned metadata for an unexpected stream")
				}
				marks, duration, err := metadata(body)
				if err != nil {
					return nil, err
				}
				if duration.Present {
					s.duration = duration
				}
				filtered := []out.MicrosoftTimestamp{}
				for _, mark := range marks {
					if s.config.tracks[mark.Kind.LiteralValue()] {
						filtered = append(filtered, mark)
					}
				}
				if s.config.timed && (len(filtered) > 0 || duration.Present) {
					return out.SynthesisItemAsTimeline{Value: out.MicrosoftEnvelope{CorrelationId: s.id, StreamId: s.streamID, Timestamps: filtered, DurationMs: duration}}, nil
				}
			}
		}
	}
}
