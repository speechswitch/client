package async

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"

	out "github.com/speechswitch/client/sdks/go/generated/async_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type httpStream struct {
	ctx          context.Context
	cancel       context.CancelFunc
	response     *runtime.HTTPResponse
	timed        bool
	checkQuota   bool
	maxJSON      int
	once         sync.Once
	closeError   error
	mutex        sync.Mutex
	terminal     bool
	pending      []byte
	pendingError error
	finished     bool
}

func (s *httpStream) closeBody() error {
	s.once.Do(func() { s.cancel(); s.closeError = s.response.Body.Close() })
	return s.closeError
}
func (s *httpStream) Close() error {
	// Release the transport before locking the parser: Next may be reading it.
	err := s.closeBody()
	s.mutex.Lock()
	s.pending = nil
	s.mutex.Unlock()
	return err
}
func (s *httpStream) Next(ctx context.Context) (out.SynthesisItem, error) {
	stop := context.AfterFunc(ctx, func() { s.closeBody() })
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
	if err != nil || s.finished {
		s.terminal = true
		s.closeBody()
		s.pending = nil
	}
	return item, err
}

var quotaMarker = []byte("--ERROR:QUOTA_EXCEEDED--")

func (s *httpStream) next(ctx context.Context) (out.SynthesisItem, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := s.ctx.Err(); err != nil {
		return nil, err
	}
	if s.pendingError != nil {
		return nil, s.pendingError
	}
	if s.response.StatusCode < 200 || s.response.StatusCode >= 300 || s.timed {
		var data []byte
		for {
			chunk, err := s.response.Body.Next(ctx)
			if err != nil && err != io.EOF {
				return nil, err
			}
			if len(chunk) > s.maxJSON-len(data) {
				return nil, errors.New("Async response exceeds MaxJSONBytes")
			}
			data = append(data, chunk...)
			if err == io.EOF {
				break
			}
		}
		text := strings.TrimPrefix(runtime.DecodeUTF8(data), "\ufeff")
		if s.response.StatusCode < 200 || s.response.StatusCode >= 300 {
			return nil, fmt.Errorf("Async returned HTTP %d: %s", s.response.StatusCode, strings.Trim(text, ecmaWhitespace))
		}
		value, err := timestamped([]byte(text))
		if err != nil {
			return nil, err
		}
		s.finished = true
		return out.SynthesisItemAsChunk{Value: value}, nil
	}
	for {
		chunk, err := s.response.Body.Next(ctx)
		if err != nil {
			if err == io.EOF && len(s.pending) != 0 {
				s.finished = true
				return out.SynthesisItemAsBytes{Value: s.pending}, nil
			}
			return nil, err
		}
		if len(chunk) == 0 {
			continue
		}
		if !s.checkQuota {
			return out.SynthesisItemAsBytes{Value: chunk}, nil
		}
		data := append(s.pending, chunk...)
		s.pending = nil
		if index := bytes.Index(data, quotaMarker); index >= 0 {
			s.pendingError = errors.New("Async streaming quota exceeded")
			if index > 0 {
				return out.SynthesisItemAsBytes{Value: data[:index]}, nil
			}
			return nil, s.pendingError
		}
		retained := min(len(data), len(quotaMarker)-1)
		for retained > 0 && !bytes.Equal(data[len(data)-retained:], quotaMarker[:retained]) {
			retained--
		}
		safe := len(data) - retained
		// Copy the tiny retained prefix; future reads cannot mutate yielded audio
		// or keep an arbitrarily large chunk alive just for a marker prefix.
		s.pending = bytes.Clone(data[safe:])
		if safe > 0 {
			return out.SynthesisItemAsBytes{Value: data[:safe]}, nil
		}
	}
}
