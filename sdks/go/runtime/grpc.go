package runtime

import (
	"context"
	"crypto/tls"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"unicode/utf8"
)

// GRPCLike owns one call. Send and Receive may progress concurrently; Close
// unblocks both. A Send returning io.EOF means the peer stopped accepting input:
// keep receiving to obtain its final gRPC status, not a successful completion.
type GRPCLike interface {
	Send(context.Context, []byte) error
	End(context.Context) error
	Receive(context.Context) ([]byte, error)
	Close() error
}

type GRPCOptions struct {
	Header http.Header
	// Nil creates a dedicated native TLS/HTTP2 client with no redirects/proxies.
	// Overrides must speak HTTP2, honor context and HTTPTransport body ownership.
	// Plain HTTP prior-knowledge connections require such an override on Go1.23.
	Transport HTTPTransport
	// Zero selects 64 MiB per message and 64 KiB per header/trailer block.
	MaxMessageBytes int
	MaxHeaderBytes  int64
}

type GRPCError struct {
	StatusCode int
	Message    string
}

func (e *GRPCError) Error() string { return e.Message }

// ConnectGRPC starts the HTTP request without waiting for response headers: a
// server can wait for the first config message before sending those headers.
// Authentication and provider URLs are already resolved by the caller.
func ConnectGRPC(ctx context.Context, address string, options GRPCOptions) (GRPCLike, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	messageLimit, headerLimit := options.MaxMessageBytes, options.MaxHeaderBytes
	if messageLimit == 0 {
		messageLimit = 64 * 1024 * 1024
	}
	if headerLimit == 0 {
		headerLimit = 64 * 1024
	}
	if messageLimit < 0 || uint64(messageLimit) > math.MaxUint32 || headerLimit < 0 || headerLimit > math.MaxUint32 {
		return nil, errors.New("gRPC byte limits must be positive uint32 values")
	}
	target, err := url.Parse(address)
	if err != nil || target.Hostname() == "" || target.User != nil || target.Fragment != "" || target.Opaque != "" || (target.Scheme != "http" && target.Scheme != "https") || strings.ContainsAny(address, "\\\r\n\t ") {
		return nil, errors.New("gRPC URL must be HTTP(S) without credentials or a fragment")
	}
	if options.Transport == nil && target.Scheme != "https" {
		return nil, errors.New("Native gRPC requires HTTPS; inject an HTTP2 transport for prior-knowledge HTTP")
	}
	header := make(http.Header)
	for name, values := range options.Header {
		if name == "" {
			return nil, errors.New("Invalid gRPC request header")
		}
		for _, c := range strings.ToLower(name) {
			if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '_' || c == '-' || c == '.') {
				return nil, errors.New("Invalid gRPC request header")
			}
		}
		switch strings.ToLower(name) {
		case "host", "connection", "upgrade", "transfer-encoding", "content-length", "content-type", "te", "grpc-encoding", "grpc-accept-encoding", "grpc-status", "grpc-message", "grpc-status-details-bin":
			return nil, errors.New("Invalid gRPC request header")
		}
		for _, value := range values {
			for _, c := range value {
				if c < 32 || c > 126 {
					return nil, errors.New("Invalid gRPC request header")
				}
			}
			header.Add(name, value)
		}
	}
	header.Set("Content-Type", "application/grpc")
	header.Set("Te", "trailers")
	header.Set("Grpc-Accept-Encoding", "identity")
	if grpcHeaderSize(header)+int64(len(target.Host)+len(target.RequestURI())+len(target.Scheme)+len("POST")+4*32+len(":authority:path:scheme:method")) > headerLimit {
		return nil, errors.New("gRPC request headers exceed byte limit")
	}
	callCtx, cancel := context.WithCancelCause(ctx)
	reader, writer := io.Pipe()
	request, err := http.NewRequestWithContext(callCtx, http.MethodPost, target.String(), reader)
	if err != nil {
		cancel(err)
		reader.Close()
		writer.Close()
		return nil, err
	}
	request.Header = header
	stream := &grpcStream{ctx: callCtx, cancel: cancel, input: reader, output: writer, ready: make(chan struct{}), stopped: make(chan struct{}), maxMessage: messageLimit, maxHeader: headerLimit}
	transport := options.Transport
	if transport == nil {
		native := &http.Transport{ForceAttemptHTTP2: true, DisableCompression: true, DisableKeepAlives: true, MaxResponseHeaderBytes: headerLimit}
		native.DialTLSContext = func(ctx context.Context, network, address string) (net.Conn, error) {
			// net/http detaches dialing from a request's cancellation so other
			// requests can reuse it. This dedicated transport owns only this call.
			dialCtx, cancelDial := context.WithCancel(ctx)
			stop := context.AfterFunc(callCtx, cancelDial)
			defer stop()
			defer cancelDial()
			dialer := tls.Dialer{Config: &tls.Config{MinVersion: tls.VersionTLS12, NextProtos: []string{"h2"}}}
			conn, err := dialer.DialContext(dialCtx, network, address)
			if err != nil {
				return nil, err
			}
			if err := callCtx.Err(); err != nil {
				conn.Close()
				return nil, err
			}
			if conn.(*tls.Conn).ConnectionState().NegotiatedProtocol != "h2" {
				conn.Close()
				return nil, errors.New("gRPC requires negotiated HTTP2")
			}
			return conn, nil
		}
		stream.closeIdle = native.CloseIdleConnections
		transport = &http.Client{Transport: native, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	context.AfterFunc(callCtx, func() { stream.finish(context.Cause(callCtx)) })
	go stream.open(request, transport)
	return stream, nil
}

type grpcStream struct {
	ctx        context.Context
	cancel     context.CancelCauseFunc
	input      *io.PipeReader
	output     *io.PipeWriter
	ready      chan struct{}
	stopped    chan struct{}
	maxMessage int
	maxHeader  int64
	closeIdle  func()
	mu         sync.Mutex
	response   *http.Response
	terminal   error
	writeMu    sync.Mutex
	readMu     sync.Mutex
	ended      bool // protected by writeMu
}

func grpcHeaderSize(header http.Header) int64 {
	var size int64
	for key, values := range header {
		for _, value := range values {
			size += int64(len(key) + len(value) + 32)
		}
	}
	return size
}

func (s *grpcStream) finish(err error) {
	s.mu.Lock()
	if s.terminal != nil {
		s.mu.Unlock()
		<-s.stopped
		return
	}
	if cause := context.Cause(s.ctx); cause != nil {
		err = cause
	}
	s.terminal = err
	response := s.response
	s.mu.Unlock()
	defer close(s.stopped)
	s.cancel(err)
	s.input.CloseWithError(err)
	s.output.CloseWithError(err)
	if response != nil && response.Body != nil {
		response.Body.Close()
	}
	if s.closeIdle != nil {
		s.closeIdle()
	}
}

func (s *grpcStream) failure() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.terminal != nil {
		return s.terminal
	}
	return context.Cause(s.ctx)
}

func (s *grpcStream) open(request *http.Request, transport HTTPTransport) {
	defer close(s.ready)
	response, err := transport.Do(request)
	if err != nil {
		if response != nil && response.Body != nil {
			response.Body.Close()
		}
		var wrapped *url.Error
		if errors.As(err, &wrapped) {
			err = wrapped.Err
		}
		s.finish(err)
		return
	}
	s.mu.Lock()
	if s.terminal != nil {
		s.mu.Unlock()
		if response != nil && response.Body != nil {
			response.Body.Close()
		}
		if s.closeIdle != nil {
			s.closeIdle()
		}
		return
	}
	s.response = response
	s.mu.Unlock()
	if response == nil || response.Body == nil {
		s.finish(errors.New("gRPC transport returned no response body"))
		return
	}
	if response.ProtoMajor != 2 {
		s.finish(errors.New("gRPC requires HTTP2"))
		return
	}
	if response.StatusCode != 200 {
		s.finish(fmt.Errorf("gRPC returned HTTP %d", response.StatusCode))
		return
	}
	if grpcHeaderSize(response.Header) > s.maxHeader {
		s.finish(errors.New("gRPC response headers exceed byte limit"))
		return
	}
	contentType := strings.TrimSpace(strings.Split(response.Header.Get("Content-Type"), ";")[0])
	if len(response.Header.Values("Content-Type")) != 1 || contentType != "application/grpc" && contentType != "application/grpc+proto" {
		s.finish(errors.New("gRPC returned an invalid content type"))
		return
	}
	if encoding := response.Header.Get("Grpc-Encoding"); encoding != "" && encoding != "identity" {
		s.finish(errors.New("Compressed gRPC messages are not supported"))
		return
	}
	if len(response.Header.Values("Grpc-Status")) != 0 {
		if err := grpcStatus(response.Header); err != io.EOF {
			s.finish(err)
		}
	}
}

func (s *grpcStream) Send(ctx context.Context, message []byte) error {
	if len(message) > s.maxMessage {
		return errors.New("gRPC message exceeds byte limit")
	}
	stop := context.AfterFunc(ctx, func() { s.finish(context.Cause(ctx)) })
	defer stop()
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	if err := ctx.Err(); err != nil {
		s.finish(err)
		return err
	}
	if err := s.failure(); err != nil {
		return err
	}
	if s.ended {
		return errors.New("gRPC input is closed")
	}
	var prefix [5]byte
	binary.BigEndian.PutUint32(prefix[1:], uint32(len(message)))
	_, err := s.output.Write(prefix[:])
	if err == nil && len(message) != 0 {
		_, err = s.output.Write(message)
	}
	if cause := s.failure(); cause != nil {
		return cause
	}
	if err == io.ErrClosedPipe {
		return io.EOF
	}
	if err != nil {
		s.finish(err)
	}
	return err
}

func (s *grpcStream) End(ctx context.Context) error {
	stop := context.AfterFunc(ctx, func() { s.finish(context.Cause(ctx)) })
	defer stop()
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	if err := ctx.Err(); err != nil {
		s.finish(err)
		return err
	}
	if err := s.failure(); err != nil {
		return err
	}
	if s.ended {
		return nil
	}
	s.ended = true
	return s.output.Close()
}

func grpcStatus(header http.Header) error {
	values := header.Values("Grpc-Status")
	if len(values) != 1 {
		return errors.New("gRPC response lacks a valid final status")
	}
	status, err := strconv.Atoi(values[0])
	if err != nil || status < 0 || status > 16 || strconv.Itoa(status) != values[0] {
		return errors.New("gRPC response lacks a valid final status")
	}
	if status == 0 {
		return io.EOF
	}
	message := header.Get("Grpc-Message")
	if len(header.Values("Grpc-Message")) == 0 {
		message = fmt.Sprintf("gRPC failed with status %d", status)
	}
	if decoded, err := url.PathUnescape(message); err == nil && utf8.ValidString(decoded) {
		message = decoded
	}
	return &GRPCError{StatusCode: status, Message: message}
}

func (s *grpcStream) Receive(ctx context.Context) ([]byte, error) {
	if !s.readMu.TryLock() {
		return nil, errors.New("gRPC permits one reader at a time")
	}
	defer s.readMu.Unlock()
	stop := context.AfterFunc(ctx, func() { s.finish(context.Cause(ctx)) })
	defer stop()
	if err := ctx.Err(); err != nil {
		s.finish(err)
		return nil, err
	}
	select {
	case <-s.ready:
	case <-s.ctx.Done():
	}
	if err := s.failure(); err != nil {
		return nil, err
	}
	s.mu.Lock()
	response := s.response
	s.mu.Unlock()
	var prefix [5]byte
	n, err := io.ReadFull(response.Body, prefix[:])
	if cause := s.failure(); cause != nil {
		return nil, cause
	}
	if err == io.EOF && n == 0 {
		status := response.Trailer
		if len(response.Header.Values("Grpc-Status")) != 0 {
			if len(status.Values("Grpc-Status")) != 0 {
				err = errors.New("gRPC returned multiple final status blocks")
			} else {
				status = response.Header
			}
		}
		if grpcHeaderSize(status) > s.maxHeader {
			err = errors.New("gRPC trailers exceed byte limit")
		} else if err == io.EOF {
			err = grpcStatus(status)
		}
		s.finish(err)
		return nil, err
	}
	if err == io.EOF || err == io.ErrUnexpectedEOF {
		err = errors.New("Truncated gRPC message")
	}
	if err == nil && len(response.Header.Values("Grpc-Status")) != 0 {
		err = errors.New("gRPC trailers-only response contained data")
	}
	if err == nil && prefix[0] != 0 {
		err = errors.New("Compressed gRPC messages are not supported")
	}
	size := binary.BigEndian.Uint32(prefix[1:])
	if err == nil && uint64(size) > uint64(s.maxMessage) {
		err = errors.New("gRPC message exceeds byte limit")
	}
	if err != nil {
		s.finish(err)
		return nil, err
	}
	message := make([]byte, int(size))
	_, err = io.ReadFull(response.Body, message)
	if cause := s.failure(); cause != nil {
		return nil, cause
	}
	if err == io.EOF || err == io.ErrUnexpectedEOF {
		err = errors.New("Truncated gRPC message")
	}
	if err != nil {
		s.finish(err)
		return nil, err
	}
	return message, nil
}

func (s *grpcStream) Close() error { s.finish(io.EOF); return nil }
