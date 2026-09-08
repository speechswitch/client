package cartesia

import (
	"context"
	"errors"
	out "github.com/speechswitch/client/sdks/go/generated/cartesia_output"
	"github.com/speechswitch/client/sdks/go/runtime"
	"io"
	"sync"
)

type httpStream struct {
	ctx             context.Context
	body            runtime.Input[[]byte]
	decoder         *runtime.SSEDecoder
	contextID       string
	timed, terminal bool
	pending         []byte
	mutex           sync.Mutex
}

func (s *httpStream) Close() error {
	err := s.body.Close() // Unblock a pending read before waiting for its mutex.
	s.mutex.Lock()
	defer s.mutex.Unlock()
	s.terminal, s.pending = true, nil
	s.decoder.Finish()
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
		s.terminal, s.pending = true, nil
		s.decoder.Finish()
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
				if err == io.EOF && s.timed {
					return nil, errors.New("Cartesia SSE ended before the done event")
				}
				return nil, err
			}
			if !s.timed {
				return out.SynthesisItemAsBytes{Value: chunk}, nil
			}
			s.pending = chunk
		}
		for len(s.pending) > 0 {
			message, err := s.decoder.Push(s.pending[0])
			s.pending = s.pending[1:]
			if err != nil {
				return nil, err
			}
			if message == nil {
				continue
			}
			value, err := decode([]byte(message.Data), false)
			if err != nil {
				return nil, err
			}
			if value.context.Present && value.context.Value != s.contextID {
				return nil, errors.New("Cartesia SSE returned an unexpected context")
			}
			if value.kind == "done" {
				return nil, io.EOF
			}
			return output(value, s.contextID, true)
		}
	}
}
