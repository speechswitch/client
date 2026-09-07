package hume

import (
	"bytes"
	"context"
	"errors"
	"io"
	"sync"
	"unicode/utf8"

	out "github.com/speechswitch/client/sdks/go/generated/hume_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type httpStream struct {
	ctx                              context.Context
	body                             runtime.Input[[]byte]
	metadata, first, terminal, ended bool
	limit                            int
	pending, chunk                   []byte
	mutex                            sync.Mutex
}

func (s *httpStream) Close() error {
	err := s.body.Close()
	s.mutex.Lock()
	defer s.mutex.Unlock()
	s.terminal = true
	s.pending, s.chunk = nil, nil
	return err
}
func (s *httpStream) Next(ctx context.Context) (out.SynthesisItem, error) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	if s.terminal {
		return nil, io.EOF
	}
	stop := context.AfterFunc(ctx, func() { s.body.Close() })
	defer stop()
	item, err := s.next(ctx)
	if cause := ctx.Err(); cause != nil {
		item, err = nil, cause
	} else if cause := s.ctx.Err(); cause != nil {
		item, err = nil, cause
	}
	if err != nil {
		s.terminal = true
		s.pending, s.chunk = nil, nil
		s.body.Close()
	}
	return item, err
}
func (s *httpStream) next(ctx context.Context) (out.SynthesisItem, error) {
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if err := s.ctx.Err(); err != nil {
			return nil, err
		}
		if !s.metadata {
			chunk, err := s.body.Next(ctx)
			if err != nil {
				return nil, err
			}
			return out.SynthesisItemAsBytes{Value: chunk}, nil
		}
		if len(s.chunk) == 0 && !s.ended {
			chunk, err := s.body.Next(ctx)
			if err == io.EOF {
				s.ended = true
			} else if err != nil {
				return nil, err
			}
			s.chunk = chunk
		}
		if s.ended && len(s.pending) == 0 {
			return nil, io.EOF
		}
		index := bytes.IndexByte(s.chunk, '\n')
		end := index
		if end < 0 {
			end = len(s.chunk)
		}
		if end > s.limit-len(s.pending) {
			return nil, errors.New("Hume JSON line exceeds MaxJSONBytes")
		}
		s.pending = append(s.pending, s.chunk[:end]...)
		s.chunk = s.chunk[end:]
		if index < 0 && !s.ended {
			continue
		}
		if index >= 0 {
			s.chunk = s.chunk[1:]
		}
		line := s.pending
		s.pending = nil
		if s.first {
			line = bytes.TrimPrefix(line, []byte("\xef\xbb\xbf"))
			s.first = false
		}
		if !utf8.Valid(line) {
			return nil, errors.New("Hume returned invalid UTF-8")
		}
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		item, err := packet(line, true)
		if err != nil {
			return nil, err
		}
		if item != nil {
			return item, nil
		}
	}
}
