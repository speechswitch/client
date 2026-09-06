package runtime

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"sync"
	"sync/atomic"
)

// HTTPTransport follows http.Client.Do's ownership and cancellation contract.
// Return at headers, without buffering the body. A response body must support
// concurrent Read/Close, with Close unblocking Read. Credential-bearing requests
// must not follow cross-origin redirects that forward those credentials.
type HTTPTransport interface {
	Do(*http.Request) (*http.Response, error)
}

type HTTPStatusError struct{ StatusCode int }

func (e *HTTPStatusError) Error() string {
	return fmt.Sprintf("HTTP request failed with status %d", e.StatusCode)
}

// HTTPResponse retains headers/status for provider framing while Body owns the
// response and cancellation. Do not read the transport's original body directly.
type HTTPResponse struct {
	StatusCode int
	Header     http.Header
	Body       Input[[]byte]
}

// OpenAudio opens byte-native audio. Provider codecs must handle framed responses.
// The request's context owns the whole stream; each Next context may cancel it too.
// Call Close when abandoning the stream. Error bodies are closed without being read.
func OpenAudio(request *http.Request, transport HTTPTransport) (Input[[]byte], error) {
	response, err := OpenResponse(request, transport)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		response.Body.Close()
		return nil, &HTTPStatusError{StatusCode: response.StatusCode}
	}
	return response.Body, nil
}

// OpenResponse opens an owned byte stream without interpreting status or content
// type. Providers can decode bounded error bodies, JSON or SSE using the headers.
func OpenResponse(request *http.Request, transport HTTPTransport) (*HTTPResponse, error) {
	ctx, cancel := context.WithCancel(request.Context())
	response, err := transport.Do(request.Clone(ctx))
	if err != nil {
		cancel()
		return nil, err
	}
	if response == nil || response.Body == nil {
		cancel()
		return nil, fmt.Errorf("HTTP transport returned no response body")
	}
	stream := &audioStream{body: response.Body, cancel: cancel, requestContext: ctx}
	// The callback touches no fields initialized after registration: a canceled
	// context may run it before AfterFunc returns.
	stream.stop = context.AfterFunc(ctx, func() { stream.closeBody() })
	return &HTTPResponse{StatusCode: response.StatusCode, Header: response.Header.Clone(), Body: stream}, nil
}

type audioStream struct {
	body           io.ReadCloser
	requestContext context.Context
	cancel         context.CancelFunc
	stop           func() bool
	once           sync.Once
	closed         atomic.Bool
	closeError     error
	nextMutex      sync.Mutex
	pending        error
}

func (s *audioStream) closeBody() error {
	s.once.Do(func() {
		s.closed.Store(true)
		s.closeError = s.body.Close()
	})
	return s.closeError
}

func (s *audioStream) Close() error {
	s.stop()
	s.cancel()
	return s.closeBody()
}

func (s *audioStream) Next(ctx context.Context) ([]byte, error) {
	s.nextMutex.Lock()
	defer s.nextMutex.Unlock()
	if s.pending != nil {
		err := s.pending
		s.pending = io.EOF
		return nil, err
	}
	if s.closed.Load() {
		if err := s.requestContext.Err(); err != nil {
			return nil, err
		}
		return nil, io.EOF
	}
	if err := ctx.Err(); err != nil {
		s.Close()
		s.pending = io.EOF
		return nil, err
	}
	stop := context.AfterFunc(ctx, func() { s.Close() })
	defer stop()
	buffer := make([]byte, 32*1024)
	for empty := 0; empty < 100; empty++ {
		n, err := s.body.Read(buffer)
		if cause := ctx.Err(); cause != nil {
			s.Close()
			s.pending = io.EOF
			return nil, cause
		}
		if cause := s.requestContext.Err(); cause != nil {
			s.Close()
			s.pending = io.EOF
			return nil, cause
		}
		if err != nil {
			s.pending = err
			s.Close()
			if n == 0 {
				s.pending = io.EOF
				return nil, err
			}
		}
		// A Reader can return final bytes together with EOF or an error. Deliver
		// those bytes first and retain the terminal result for the next pull.
		if n > 0 {
			return buffer[:n], nil
		}
	}
	s.Close()
	s.pending = io.EOF
	return nil, io.ErrNoProgress
}
