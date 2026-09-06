package deepdub

import (
	"context"
	"errors"
	"github.com/speechswitch/client/sdks/go/runtime"
	"io"
	"sync"
)

type stream struct {
	ctx                context.Context
	cancel             context.CancelFunc
	body               runtime.Input[[]byte]
	mu                 sync.Mutex
	terminal, verified bool
	prefix             []byte
	pending            [][]byte
}

func (s *stream) Close() error {
	// Unblock an active read before waiting for the consumer lock.
	s.cancel()
	err := s.body.Close()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.terminal, s.pending, s.prefix = true, nil, nil
	return err
}

func (s *stream) Next(ctx context.Context) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.terminal {
		return nil, io.EOF
	}
	stop := context.AfterFunc(ctx, s.cancel)
	defer stop()
	audio, err := s.next(ctx)
	if cause := ctx.Err(); cause != nil {
		audio, err = nil, cause
	} else if cause := s.ctx.Err(); cause != nil {
		audio, err = nil, cause
	}
	if err != nil {
		s.terminal, s.pending, s.prefix = true, nil, nil
		s.cancel()
		s.body.Close()
	}
	return audio, err
}

func (s *stream) next(ctx context.Context) ([]byte, error) {
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if err := s.ctx.Err(); err != nil {
			return nil, err
		}
		if s.verified && len(s.pending) != 0 {
			chunk := s.pending[0]
			s.pending[0] = nil
			s.pending = s.pending[1:]
			return chunk, nil
		}
		chunk, err := s.body.Next(ctx)
		if err != nil {
			if err == io.EOF && !s.verified {
				return nil, errors.New("Deepdub returned a truncated Ogg Opus header")
			}
			return nil, err
		}
		if s.verified {
			return chunk, nil
		}
		s.pending = append(s.pending, chunk)
		s.prefix = append(s.prefix, chunk[:min(len(chunk), 290-len(s.prefix))]...)
		if len(s.prefix) < 27 {
			continue
		}
		if string(s.prefix[:5]) != "OggS\x00" || s.prefix[26] == 0 {
			return nil, errors.New("Deepdub did not return an Ogg Opus stream")
		}
		start := 27 + int(s.prefix[26])
		if len(s.prefix) < start+8 {
			continue
		}
		if string(s.prefix[start:start+8]) != "OpusHead" {
			return nil, errors.New("Deepdub returned a different Ogg codec (the trial API has returned Vorbis) for requested Opus audio")
		}
		s.verified, s.prefix = true, nil
	}
}
