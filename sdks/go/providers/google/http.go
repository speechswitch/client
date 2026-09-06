package google

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/speechswitch/client/sdks/go/runtime"

	rest "github.com/speechswitch/client/sdks/go/clients/google_rest"
	beta "github.com/speechswitch/client/sdks/go/clients/google_rest_beta"
)

type httpStream struct {
	ctx        context.Context
	cancel     context.CancelCauseFunc
	stop       func() bool
	response   *http.Response
	limit      int
	beta       bool
	once       sync.Once
	closeError error
	mutex      sync.Mutex
	terminal   bool
}

func (s *httpStream) closeResources(err error) error {
	s.once.Do(func() { s.cancel(err); s.closeError = s.response.Body.Close() })
	return s.closeError
}
func (s *httpStream) Close() error { s.stop(); return s.closeResources(io.EOF) }
func (s *httpStream) Next(ctx context.Context) ([]byte, error) {
	stop := context.AfterFunc(ctx, func() { s.closeResources(context.Cause(ctx)) })
	defer stop()
	s.mutex.Lock()
	defer s.mutex.Unlock()
	if s.terminal {
		return nil, io.EOF
	}
	s.terminal = true
	data, err := s.read(ctx)
	if cause := ctx.Err(); cause != nil {
		data, err = nil, cause
	} else if cause := context.Cause(s.ctx); cause != nil {
		data, err = nil, cause
	}
	if err == nil {
		s.closeResources(io.EOF)
	} else {
		s.closeResources(err)
	}
	return data, err
}
func (s *httpStream) read(ctx context.Context) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := context.Cause(s.ctx); err != nil {
		return nil, err
	}
	data, err := io.ReadAll(io.LimitReader(s.response.Body, int64(s.limit)+1))
	if err != nil {
		return nil, err
	}
	if len(data) > s.limit {
		return nil, errors.New("Google response exceeds MaxJSONBytes")
	}
	if s.response.StatusCode < 200 || s.response.StatusCode >= 300 {
		message := runtime.DecodeUTF8(bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf}))
		var value struct{ Error struct{ Message *string } }
		if json.Unmarshal(data, &value) == nil && value.Error.Message != nil {
			message = *value.Error.Message
		}
		return nil, &Error{StatusCode: s.response.StatusCode, Message: message}
	}
	var encoded string
	var present bool
	if s.beta {
		packet, failure := beta.DecodeSynthesizeSpeechResponse(data)
		err, encoded, present = failure, packet.AudioContent.Value, packet.AudioContent.Present
	} else {
		packet, failure := rest.DecodeSynthesizeSpeechResponse(data)
		err, encoded, present = failure, packet.AudioContent.Value, packet.AudioContent.Present
	}
	if err != nil || !present {
		return nil, errors.New("Google returned an invalid synthesis response")
	}
	if strings.ContainsAny(encoded, "\r\n") {
		return nil, errors.New("Google returned an invalid synthesis response")
	}
	audio, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, errors.New("Google returned an invalid synthesis response")
	}
	return audio, nil
}
