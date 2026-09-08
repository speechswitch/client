package camb

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"strconv"
	"sync"

	wire "github.com/speechswitch/client/sdks/go/clients/camb"
	out "github.com/speechswitch/client/sdks/go/generated/camb_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type textResult struct {
	value string
	err   error
}
type socketResult struct {
	value runtime.WebSocketMessage
	err   error
}

type socketStream struct {
	ctx                                          context.Context
	cancel                                       context.CancelFunc
	stop                                         func() bool
	socket                                       runtime.WebSocketLike
	input                                        runtime.Input[string]
	first                                        runtime.WebSocketText
	validate                                     runtime.InputValidator
	timed, checkInput                            bool
	maxMessage                                   int
	once                                         sync.Once
	closeError                                   error
	mutex                                        sync.Mutex
	initialized, terminal, inputDone, hasSegment bool
	segment                                      float64
	index                                        float64
	seen                                         map[float64]bool
	pendingInput                                 <-chan textResult
	pendingOutput                                <-chan socketResult
	pendingSend                                  <-chan error
	readyInput                                   *textResult
}

func (s *socketStream) closeResources() error {
	s.once.Do(func() {
		s.cancel()
		// Network ownership is released before cooperative producer cleanup.
		s.closeError = errors.Join(s.socket.Close(), s.input.Close())
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
	} else if cause := s.ctx.Err(); cause != nil {
		item, err = nil, cause
	}
	if err != nil {
		s.terminal = true
		s.Close()
		s.readyInput = nil
	}
	return item, err
}

func (s *socketStream) decode(message runtime.WebSocketMessage) (wire.ServerMessage, error) {
	size := 0
	switch value := message.(type) {
	case runtime.WebSocketText:
		size = len(value)
	case *runtime.WebSocketText:
		if value != nil {
			size = len(*value)
		}
	case runtime.WebSocketBinary:
		size = len(value)
	case *runtime.WebSocketBinary:
		if value != nil {
			size = len(*value)
		}
	}
	if size > s.maxMessage {
		return nil, errors.New("CAMB message exceeds MaxMessageBytes")
	}
	return wire.DecodeMessage(message)
}

func (s *socketStream) pullInput() {
	pending := make(chan textResult, 1)
	s.pendingInput = pending
	go func() { value, err := s.input.Next(s.ctx); pending <- textResult{value, err} }()
}
func (s *socketStream) pullOutput() {
	pending := make(chan socketResult, 1)
	s.pendingOutput = pending
	go func() { value, err := s.socket.Receive(s.ctx); pending <- socketResult{value, err} }()
}
func (s *socketStream) startSend(message wire.ClientMessage) {
	pending := make(chan error, 1)
	s.pendingSend = pending
	// One pending write may coexist with receiving audio. Do not prefetch input
	// until it completes; buffered result channels cannot strand canceled workers.
	go func() {
		encoded, err := wire.EncodeMessage(message)
		if err == nil && len(encoded) > s.maxMessage {
			err = errors.New("CAMB message exceeds MaxMessageBytes")
		}
		if err == nil {
			err = s.socket.Send(s.ctx, encoded)
		}
		pending <- err
	}()
}

func (s *socketStream) next(ctx context.Context) (out.SynthesisItem, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := s.ctx.Err(); err != nil {
		return nil, err
	}
	if !s.initialized {
		if err := s.socket.Send(s.ctx, s.first); err != nil {
			return nil, err
		}
		frame, err := s.socket.Receive(s.ctx)
		if err == io.EOF {
			return nil, errors.New("CAMB closed before session.ready")
		}
		if err != nil {
			return nil, err
		}
		ready, err := s.decode(frame)
		if err != nil {
			return nil, err
		}
		switch message := ready.(type) {
		case wire.SessionReady:
		case wire.SessionError:
			return nil, fmt.Errorf("CAMB rejected session: %s", message.Error)
		default:
			return nil, errors.New("CAMB did not acknowledge the session before sending output")
		}
		s.initialized = true
		s.pullInput()
	}
	for {
		if err := s.ctx.Err(); err != nil {
			return nil, err
		}
		if s.pendingOutput == nil {
			s.pullOutput()
		}
		var output socketResult
		outputReady := false
		select {
		case output = <-s.pendingOutput:
			outputReady = true
		default:
		}
		if !outputReady && s.readyInput == nil {
			select {
			case output = <-s.pendingOutput:
				outputReady = true
			case input := <-s.pendingInput:
				s.pendingInput = nil
				s.readyInput = &input
				select {
				case output = <-s.pendingOutput:
					outputReady = true
				default:
				}
			case err := <-s.pendingSend:
				s.pendingSend = nil
				if err != nil {
					return nil, err
				}
				if !s.inputDone {
					s.pullInput()
				}
				continue
			case <-s.ctx.Done():
				return nil, s.ctx.Err()
			}
		}
		if outputReady {
			s.pendingOutput = nil
			if output.err == io.EOF {
				return nil, errors.New("CAMB closed before session.done")
			}
			if output.err != nil {
				return nil, output.err
			}
			message, err := s.decode(output.value)
			if err != nil {
				return nil, err
			}
			switch message := message.(type) {
			case wire.AudioChunk:
				if !s.hasSegment {
					return nil, errors.New("CAMB returned audio outside a segment")
				}
				if !s.timed {
					return out.SynthesisItemAsBytes{Value: []byte(message)}, nil
				}
				id := strconv.FormatFloat(s.segment, 'f', 0, 64)
				if s.segment == 0 {
					id = "0"
				}
				return out.SynthesisItemAsOrdered{Value: out.SegmentOutput{CorrelationId: id, Audio: runtime.Some([]byte(message)), Timestamps: []out.WordTimestamp{}}}, nil
			case wire.SegmentStart:
				if math.Abs(message.SegmentId) > 9007199254740991 {
					return nil, errors.New("CAMB returned an unsafe segment ID")
				}
				if s.hasSegment || s.seen[message.SegmentId] {
					return nil, errors.New("CAMB returned an overlapping or reused segment")
				}
				s.segment, s.hasSegment = message.SegmentId, true
				s.seen[s.segment] = true
				if s.timed {
					timestamps := []out.WordTimestamp{}
					if message.WordTimestamps.Present && message.WordTimestamps.Value != nil {
						for _, word := range *message.WordTimestamps.Value {
							start, end := word.Start*1000, word.End*1000
							if start < 0 || end < start || math.IsInf(start, 0) || math.IsInf(end, 0) {
								return nil, errors.New("CAMB returned invalid word timing")
							}
							timestamps = append(timestamps, out.WordTimestamp{Value: word.Word, StartTimeMs: start, EndTimeMs: end})
						}
					}
					id := strconv.FormatFloat(s.segment, 'f', 0, 64)
					if s.segment == 0 {
						id = "0"
					}
					return out.SynthesisItemAsOrdered{Value: out.SegmentOutput{CorrelationId: id, Timestamps: timestamps}}, nil
				}
			case wire.SegmentDone:
				if !s.hasSegment || message.SegmentId != s.segment {
					return nil, errors.New("CAMB completed an unexpected segment")
				}
				s.hasSegment = false
			case wire.SegmentSkipped:
				return nil, fmt.Errorf("CAMB skipped segment %s: %s", strconv.FormatFloat(message.SegmentId, 'f', 0, 64), message.Text)
			case wire.SessionError:
				return nil, fmt.Errorf("CAMB synthesis failed: %s", message.Error)
			case wire.SessionDone:
				if !s.inputDone || s.hasSegment {
					return nil, errors.New("CAMB ended an incomplete session")
				}
				return nil, io.EOF
			case wire.SessionReady:
				return nil, errors.New("Unexpected CAMB event: session.ready")
			default:
				return nil, errors.New("Unexpected CAMB event")
			}
			continue
		}
		input := *s.readyInput
		s.readyInput = nil
		if input.err == io.EOF {
			s.inputDone = true
			s.startSend(wire.TextDone{Type: "text.done"})
		} else if input.err != nil {
			return nil, input.err
		} else {
			if s.checkInput {
				if err := s.validate(input.value); err != nil {
					return nil, err
				}
			}
			index := s.index
			s.startSend(wire.TextChunk{Type: "text.chunk", Text: input.value, Index: runtime.Some(&index)})
			// The outgoing message owns its index; do not alias the mutable state.
			next := s.index + 1
			s.index = next
		}
	}
}
