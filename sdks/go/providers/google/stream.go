package google

import (
	"context"
	"errors"
	"io"
	"sync"
	"sync/atomic"

	"github.com/speechswitch/client/sdks/go/runtime"
)

type grpcResult struct {
	data []byte
	err  error
}
type grpcStream struct {
	ctx               context.Context
	cancel            context.CancelCauseFunc
	stop              func() bool
	connection        runtime.GRPCLike
	config            configuration
	opening           []byte
	validate          runtime.InputValidator
	limit             int
	once              sync.Once
	closeError        error
	inputEnded        atomic.Bool
	mutex             sync.Mutex
	started, terminal bool
	pending           <-chan grpcResult
}

func (s *grpcStream) closeResources(err error) error {
	s.once.Do(func() {
		s.cancel(err)
		s.closeError = s.connection.Close()
		// Producer cleanup can wait for a stalled Next; socket release cannot.
		if s.config.textInput != nil {
			go s.config.textInput.Close()
		}
		if s.config.turnInput != nil {
			go s.config.turnInput.Close()
		}
	})
	return s.closeError
}
func (s *grpcStream) Close() error { s.stop(); return s.closeResources(io.EOF) }

func (s *grpcStream) produce() {
	err := s.connection.Send(s.ctx, s.opening)
	first := true
	for err == nil {
		if err = s.ctx.Err(); err != nil {
			break
		}
		text, turns := s.config.text, s.config.turns
		if s.config.textInput != nil {
			text, err = s.config.textInput.Next(s.ctx)
			if err == nil {
				err = s.validate(text, "text")
			}
		} else if s.config.turnInput != nil {
			var turn Turn
			turn, err = s.config.turnInput.Next(s.ctx)
			if err == nil {
				err = s.validate(turn, "turns")
				turns = []Turn{turn}
			}
		} else if !first {
			err = io.EOF
		}
		if err == io.EOF {
			s.inputEnded.Store(true)
			err = s.connection.End(s.ctx)
			break
		}
		if err != nil {
			break
		}
		if err = s.ctx.Err(); err != nil {
			break
		}
		if s.config.dialogue {
			err = s.config.checkTurns(turns)
		} else {
			err = checkText(text, s.config.limit)
		}
		if err != nil {
			break
		}
		var message []byte
		message, err = s.config.encodeInput(text, turns, first)
		if err == nil && len(message) > s.limit {
			err = errors.New("Google gRPC message exceeds MaxMessageBytes")
		}
		if err == nil {
			err = s.connection.Send(s.ctx, message)
		}
		first = false
	}
	// Send's EOF means the peer closed input, not that synthesis succeeded. Drain
	// Receive for its final RPC error (or reject premature successful completion).
	if err != nil && err != io.EOF {
		s.closeResources(err)
	}
}

func (s *grpcStream) Next(ctx context.Context) ([]byte, error) {
	stop := context.AfterFunc(ctx, func() { s.closeResources(context.Cause(ctx)) })
	defer stop()
	s.mutex.Lock()
	defer s.mutex.Unlock()
	if s.terminal {
		return nil, io.EOF
	}
	data, err := s.next(ctx)
	if cause := ctx.Err(); cause != nil {
		data, err = nil, cause
	} else if cause := context.Cause(s.ctx); cause != nil {
		data, err = nil, cause
	}
	if err != nil {
		s.terminal = true
		s.closeResources(err)
	}
	return data, err
}
func (s *grpcStream) next(ctx context.Context) ([]byte, error) {
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if err := context.Cause(s.ctx); err != nil {
			return nil, err
		}
		if !s.started {
			s.started = true
			go s.produce()
		}
		if s.pending == nil {
			pending := make(chan grpcResult, 1)
			s.pending = pending
			go func() { data, err := s.connection.Receive(s.ctx); pending <- grpcResult{data, err} }()
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-s.ctx.Done():
			return nil, context.Cause(s.ctx)
		case result := <-s.pending:
			s.pending = nil
			if result.err != nil {
				if result.err == io.EOF && !s.inputEnded.Load() {
					return nil, errors.New("Google completed before the input stream ended")
				}
				return nil, result.err
			}
			if len(result.data) > s.limit {
				return nil, errors.New("Google gRPC message exceeds MaxMessageBytes")
			}
			audio, err := s.config.decodeAudio(result.data)
			if err != nil {
				return nil, err
			}
			if len(audio) != 0 {
				return audio, nil
			}
		}
	}
}
