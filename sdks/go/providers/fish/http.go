package fish

import (
	"context"
	"io"
	"sync"

	out "github.com/speechswitch/client/sdks/go/generated/fish_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type httpStream struct {
	ctx      context.Context
	body     runtime.Input[[]byte]
	decoder  *runtime.SSEDecoder
	pending  []byte
	terminal bool
	mutex    sync.Mutex
}

func (s *httpStream) Close() error {
	err := s.body.Close() // Unblock a pending read before waiting for its consumer.
	s.mutex.Lock()
	defer s.mutex.Unlock()
	s.finish()
	return err
}
func (s *httpStream) finish() {
	s.terminal = true
	s.pending = nil
	if s.decoder != nil {
		s.decoder.Finish()
	}
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
		s.finish()
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
		if len(s.pending) == 0 {
			chunk, err := s.body.Next(ctx)
			if err != nil {
				return nil, err
			}
			if s.decoder == nil {
				return out.SynthesisItemAsBytes{Value: chunk}, nil
			}
			s.pending = chunk
		}
		for index := 0; index < 4096 && len(s.pending) > 0; index++ {
			message, err := s.decoder.Push(s.pending[0])
			s.pending = s.pending[1:]
			if err != nil {
				return nil, err
			}
			if message != nil {
				return alignment([]byte(message.Data))
			}
		}
	}
}
