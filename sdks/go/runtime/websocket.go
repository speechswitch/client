package runtime

import (
	"context"
	"crypto/rand"
	"crypto/sha1"
	"crypto/tls"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"unicode/utf8"
)

type WebSocketMessage interface{ isWebSocketMessage() }
type WebSocketText string

func (WebSocketText) isWebSocketMessage() {}

type WebSocketBinary []byte

func (WebSocketBinary) isWebSocketMessage() {}

// WebSocketLike owns an already-connected socket. Methods must honor their
// context. Close is idempotent and unblocks pending sends/receives promptly.
type WebSocketLike interface {
	Send(context.Context, WebSocketMessage) error
	Receive(context.Context) (WebSocketMessage, error)
	Close() error
}

type WebSocketOptions struct {
	Header http.Header
	// Nil uses native net/http, verified TLS, HTTP/1.1, no redirects or proxies.
	// Overrides must preserve credential/cancellation ownership and return an
	// io.ReadWriteCloser body after upgrade. They own their raw header limits.
	Transport HTTPTransport
	// Zero selects 4 MiB per message and 64 KiB per native handshake.
	MaxMessageBytes int
	MaxHeaderBytes  int64
}

type WebSocketClosed struct {
	Code   int
	Reason string
}

func (e *WebSocketClosed) Error() string { return fmt.Sprintf("WebSocket closed (%d)", e.Code) }

// ConnectWebSocket opens RFC 6455 ws/wss without extensions or subprotocols.
// The provider constructs authentication at this boundary. Close aborts TCP;
// it never waits for a peer's graceful close handshake or a blocked writer.
func ConnectWebSocket(ctx context.Context, address string, options WebSocketOptions) (WebSocketLike, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	maxMessage, maxHeader := options.MaxMessageBytes, options.MaxHeaderBytes
	if maxMessage == 0 {
		maxMessage = 4 * 1024 * 1024
	}
	if maxHeader == 0 {
		maxHeader = 64 * 1024
	}
	if maxMessage < 0 || maxHeader < 0 {
		return nil, errors.New("WebSocket byte limits must be positive")
	}
	target, err := url.Parse(address)
	if err != nil || target.Hostname() == "" || target.User != nil || target.Fragment != "" || target.Opaque != "" || (target.Scheme != "ws" && target.Scheme != "wss") || strings.ContainsAny(address, "\\\r\n\t ") {
		return nil, errors.New("WebSocket URL must be ws/wss without credentials or a fragment")
	}
	if target.Scheme == "ws" {
		target.Scheme = "http"
	} else {
		target.Scheme = "https"
	}
	header := make(http.Header)
	for name, values := range options.Header {
		if name == "" {
			return nil, errors.New("Invalid WebSocket request header")
		}
		for _, character := range name {
			if !(character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z' || character >= '0' && character <= '9' || strings.ContainsRune("!#$%&'*+-.^_`|~", character)) {
				return nil, errors.New("Invalid WebSocket request header")
			}
		}
		switch strings.ToLower(name) {
		case "host", "upgrade", "connection", "content-length", "transfer-encoding", "sec-websocket-key", "sec-websocket-version", "sec-websocket-protocol", "sec-websocket-extensions":
			return nil, errors.New("Invalid WebSocket request header")
		}
		for _, value := range values {
			for _, character := range value {
				if character < 32 || character > 126 {
					return nil, errors.New("Invalid WebSocket request header")
				}
			}
			header.Add(name, value)
		}
	}
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	key := base64.StdEncoding.EncodeToString(nonce)
	header.Set("Upgrade", "websocket")
	header.Set("Connection", "Upgrade")
	header.Set("Sec-WebSocket-Key", key)
	header.Set("Sec-WebSocket-Version", "13")
	ctx, cancel := context.WithCancel(ctx)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		cancel()
		return nil, errors.New("Invalid WebSocket request URL")
	}
	request.Header = header
	transport := options.Transport
	if transport == nil {
		native := &http.Transport{MaxResponseHeaderBytes: maxHeader, DisableCompression: true, TLSNextProto: map[string]func(string, *tls.Conn) http.RoundTripper{}}
		defer native.CloseIdleConnections()
		transport = &http.Client{Transport: native, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	response, err := transport.Do(request)
	if err != nil {
		cancel()
		// net/http wraps errors with the request URL, which can contain API keys.
		var wrapped *url.Error
		if errors.As(err, &wrapped) {
			return nil, wrapped.Err
		}
		return nil, err
	}
	fail := func(message string) (WebSocketLike, error) {
		cancel()
		if response != nil && response.Body != nil {
			response.Body.Close()
		}
		return nil, errors.New(message)
	}
	if response == nil || response.Body == nil || response.StatusCode != http.StatusSwitchingProtocols {
		return fail("WebSocket handshake was not accepted")
	}
	upgrade := strings.ToLower(strings.TrimSpace(strings.Join(response.Header.Values("Upgrade"), ",")))
	connection := false
	for _, value := range response.Header.Values("Connection") {
		for _, token := range strings.Split(value, ",") {
			if strings.EqualFold(strings.TrimSpace(token), "upgrade") {
				connection = true
			}
		}
	}
	digest := sha1.Sum([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	accepted := response.Header.Values("Sec-WebSocket-Accept")
	if upgrade != "websocket" || !connection || len(accepted) != 1 || strings.TrimSpace(accepted[0]) != base64.StdEncoding.EncodeToString(digest[:]) || len(response.Header.Values("Sec-WebSocket-Extensions")) != 0 || len(response.Header.Values("Sec-WebSocket-Protocol")) != 0 {
		return fail("Invalid WebSocket upgrade response")
	}
	body, ok := response.Body.(io.ReadWriteCloser)
	if !ok {
		return fail("WebSocket transport did not return a duplex body")
	}
	socket := &webSocket{body: body, ctx: ctx, cancel: cancel, maxMessage: maxMessage}
	socket.stop = context.AfterFunc(ctx, func() { socket.closeBody() })
	if err := ctx.Err(); err != nil {
		socket.Close()
		return nil, err
	}
	return socket, nil
}

type webSocket struct {
	body        io.ReadWriteCloser
	ctx         context.Context
	cancel      context.CancelFunc
	stop        func() bool
	maxMessage  int
	once        sync.Once
	closed      atomic.Bool
	closeError  error
	readMutex   sync.Mutex
	receiveDone bool
	writeMutex  sync.Mutex
}

func (s *webSocket) closeBody() error {
	s.once.Do(func() { s.closed.Store(true); s.closeError = s.body.Close() })
	return s.closeError
}
func (s *webSocket) Close() error { s.stop(); s.cancel(); return s.closeBody() }

func (s *webSocket) Send(ctx context.Context, message WebSocketMessage) error {
	var data []byte
	opcode := byte(1)
	switch value := message.(type) {
	case WebSocketText:
		data = []byte(value)
	case *WebSocketText:
		if value != nil {
			data = []byte(*value)
		} else {
			return errors.New("Invalid WebSocket message")
		}
	case WebSocketBinary:
		data = []byte(value)
		opcode = 2
	case *WebSocketBinary:
		if value != nil {
			data = []byte(*value)
			opcode = 2
		} else {
			return errors.New("Invalid WebSocket message")
		}
	default:
		return errors.New("Invalid WebSocket message")
	}
	if len(data) > s.maxMessage {
		return errors.New("WebSocket message exceeds byte limit")
	}
	if opcode == 1 && !utf8.Valid(data) {
		return errors.New("Invalid WebSocket UTF-8")
	}
	return s.sendFrame(ctx, opcode, data)
}
func (s *webSocket) sendFrame(ctx context.Context, opcode byte, data []byte) error {
	stop := context.AfterFunc(ctx, func() { s.Close() })
	defer stop()
	s.writeMutex.Lock()
	defer s.writeMutex.Unlock()
	if err := ctx.Err(); err != nil {
		s.Close()
		return err
	}
	if err := s.ctx.Err(); err != nil {
		return err
	}
	header := []byte{0x80 | opcode}
	switch {
	case len(data) < 126:
		header = append(header, 0x80|byte(len(data)))
	case len(data) < 65536:
		header = binary.BigEndian.AppendUint16(append(header, 0xfe), uint16(len(data)))
	default:
		header = binary.BigEndian.AppendUint64(append(header, 0xff), uint64(len(data)))
	}
	mask := make([]byte, 4)
	if _, err := rand.Read(mask); err != nil {
		return err
	}
	frame := make([]byte, len(header)+4+len(data))
	copy(frame, header)
	copy(frame[len(header):], mask)
	for index, value := range data {
		frame[len(header)+4+index] = value ^ mask[index%4]
	}
	n, err := s.body.Write(frame)
	if cause := ctx.Err(); cause != nil {
		s.Close()
		return cause
	}
	if cause := s.ctx.Err(); cause != nil {
		return cause
	}
	if err == nil && n != len(frame) {
		err = io.ErrShortWrite
	}
	if err != nil {
		s.Close()
	}
	return err
}
func (s *webSocket) Receive(ctx context.Context) (WebSocketMessage, error) {
	stop := context.AfterFunc(ctx, func() { s.Close() })
	defer stop()
	s.readMutex.Lock()
	defer s.readMutex.Unlock()
	if s.receiveDone {
		return nil, io.EOF
	}
	if err := ctx.Err(); err != nil {
		s.receiveDone = true
		s.Close()
		return nil, err
	}
	if err := s.ctx.Err(); err != nil {
		s.receiveDone = true
		s.Close()
		return nil, err
	}
	if s.closed.Load() {
		s.receiveDone = true
		return nil, io.EOF
	}
	message, err := s.receive(ctx)
	if cause := ctx.Err(); cause != nil {
		message, err = nil, cause
	} else if cause := s.ctx.Err(); cause != nil {
		message, err = nil, cause
	}
	if err != nil {
		s.receiveDone = true
		s.Close()
	}
	return message, err
}

func (s *webSocket) readFull(buffer []byte) error {
	_, err := io.ReadFull(s.body, buffer)
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return &WebSocketClosed{Code: 1006}
	}
	return err
}

func (s *webSocket) receive(ctx context.Context) (WebSocketMessage, error) {
	data := []byte{}
	messageOpcode := byte(0)
	for {
		var header [2]byte
		if err := s.readFull(header[:]); err != nil {
			return nil, err
		}
		final, opcode := header[0]&0x80 != 0, header[0]&15
		if header[0]&0x70 != 0 || header[1]&0x80 != 0 || (opcode > 2 && opcode != 8 && opcode != 9 && opcode != 10) {
			return nil, errors.New("Invalid WebSocket frame header")
		}
		length := uint64(header[1] & 127)
		if opcode >= 8 && (!final || length > 125) {
			return nil, errors.New("Invalid WebSocket control frame")
		}
		switch length {
		case 126:
			var extended [2]byte
			if err := s.readFull(extended[:]); err != nil {
				return nil, err
			}
			length = uint64(binary.BigEndian.Uint16(extended[:]))
			if length < 126 {
				return nil, errors.New("Nonminimal WebSocket frame length")
			}
		case 127:
			var extended [8]byte
			if err := s.readFull(extended[:]); err != nil {
				return nil, err
			}
			length = binary.BigEndian.Uint64(extended[:])
			if length < 65536 || length >= 1<<63 {
				return nil, errors.New("Invalid WebSocket frame length")
			}
		}
		if opcode < 8 {
			if (opcode == 0) != (messageOpcode != 0) {
				return nil, errors.New("Invalid WebSocket fragmentation")
			}
			if length > uint64(s.maxMessage-len(data)) {
				return nil, errors.New("WebSocket message exceeds byte limit")
			}
		}
		payload := make([]byte, int(length))
		if err := s.readFull(payload); err != nil {
			return nil, err
		}
		switch opcode {
		case 8:
			if len(payload) == 1 {
				return nil, errors.New("Invalid WebSocket close payload")
			}
			code := 1005
			reason := ""
			if len(payload) >= 2 {
				code = int(binary.BigEndian.Uint16(payload))
				reason = string(payload[2:])
				if !((code >= 1000 && code <= 1003) || (code >= 1007 && code <= 1014) || (code >= 3000 && code <= 4999)) {
					return nil, errors.New("Invalid WebSocket close code")
				}
				if !utf8.ValidString(reason) {
					return nil, errors.New("Invalid WebSocket UTF-8")
				}
			}
			if err := s.sendFrame(ctx, 8, payload); err != nil {
				return nil, err
			}
			if code == 1000 || code == 1005 {
				return nil, io.EOF
			}
			return nil, &WebSocketClosed{Code: code, Reason: reason}
		case 9:
			if err := s.sendFrame(ctx, 10, payload); err != nil {
				return nil, err
			}
			continue
		case 10:
			continue
		}
		if opcode != 0 {
			messageOpcode = opcode
		}
		data = append(data, payload...)
		if final {
			if messageOpcode == 2 {
				return WebSocketBinary(data), nil
			}
			if !utf8.Valid(data) {
				return nil, errors.New("Invalid WebSocket UTF-8")
			}
			return WebSocketText(data), nil
		}
	}
}
