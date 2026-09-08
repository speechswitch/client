package elevenlabs

import (
	"bytes"
	"context"
	"errors"
	"io"
	"sync"

	out "github.com/speechswitch/client/sdks/go/generated/elevenlabs_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func readAll(ctx context.Context, body runtime.Input[[]byte], limit int) ([]byte, error) {
	var data []byte
	for {
		chunk, err := body.Next(ctx)
		if err == io.EOF {
			return bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf}), nil
		}
		if err != nil {
			return nil, err
		}
		if len(chunk) > limit-len(data) {
			return nil, errors.New("ElevenLabs response exceeds MaxJSONBytes")
		}
		data = append(data, chunk...)
	}
}

type httpStream struct {
	ctx                                               context.Context
	body                                              runtime.Input[[]byte]
	timed, wav, normalized, terminal, received, first bool
	limit                                             int
	pending, record                                   []byte
	mutex                                             sync.Mutex
}

func (s *httpStream) Close() error {
	err := s.body.Close()
	s.mutex.Lock()
	defer s.mutex.Unlock()
	s.terminal, s.pending, s.record = true, nil, nil
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
		s.terminal, s.pending, s.record = true, nil, nil
		s.body.Close()
	}
	return item, err
}
func (s *httpStream) line() (out.SynthesisItem, error) {
	data := s.record
	s.record = nil
	if s.first {
		data = bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf})
		s.first = false
	}
	if len(bytes.TrimSpace(data)) == 0 {
		return nil, nil
	}
	value, err := load(data)
	if err != nil {
		return nil, err
	}
	item, err := timestamped(value, s.normalized)
	if err == nil {
		s.received = true
	}
	return item, err
}
func (s *httpStream) next(ctx context.Context) (out.SynthesisItem, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := s.ctx.Err(); err != nil {
		return nil, err
	}
	if s.timed && s.wav {
		data, err := readAll(ctx, s.body, s.limit)
		if err != nil {
			return nil, err
		}
		s.terminal = true
		value, err := load(data)
		if err != nil {
			return nil, err
		}
		return timestamped(value, s.normalized)
	}
	for {
		if len(s.pending) == 0 {
			chunk, err := s.body.Next(ctx)
			if err == io.EOF {
				if s.timed && len(s.record) > 0 {
					item, err := s.line()
					if item != nil || err != nil {
						return item, err
					}
				}
				if !s.received {
					if s.timed {
						return nil, errors.New("ElevenLabs returned no timestamped audio chunks")
					}
					return nil, errors.New("ElevenLabs returned no audio bytes")
				}
				return nil, io.EOF
			}
			if err != nil {
				return nil, err
			}
			if !s.timed {
				s.received = true
				return out.SynthesisItemAsBytes{Value: chunk}, nil
			}
			s.pending = chunk
		}
		end := bytes.IndexByte(s.pending, '\n')
		stop := end
		if end < 0 {
			stop = len(s.pending)
		}
		if stop > s.limit-len(s.record) {
			return nil, errors.New("ElevenLabs response exceeds MaxJSONBytes")
		}
		s.record = append(s.record, s.pending[:stop]...)
		s.pending = s.pending[stop:]
		if end >= 0 {
			s.pending = s.pending[1:]
			item, err := s.line()
			if item != nil || err != nil {
				return item, err
			}
		}
	}
}
