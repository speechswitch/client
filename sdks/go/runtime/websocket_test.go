package runtime

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func serverFrame(opcode byte, final bool, data []byte) []byte {
	header := []byte{opcode}
	if final {
		header[0] |= 128
	}
	switch {
	case len(data) < 126:
		header = append(header, byte(len(data)))
	case len(data) < 65536:
		header = binary.BigEndian.AppendUint16(append(header, 126), uint16(len(data)))
	default:
		header = binary.BigEndian.AppendUint64(append(header, 127), uint64(len(data)))
	}
	return append(header, data...)
}

func clientFrame(reader io.Reader) (byte, []byte, error) {
	var header [2]byte
	if _, err := io.ReadFull(reader, header[:]); err != nil {
		return 0, nil, err
	}
	if header[0]&0x80 == 0 || header[0]&0x70 != 0 || header[1]&0x80 == 0 {
		return 0, nil, fmt.Errorf("invalid client frame header: %x", header)
	}
	length := uint64(header[1] & 127)
	if length == 126 {
		var ext [2]byte
		if _, err := io.ReadFull(reader, ext[:]); err != nil {
			return 0, nil, err
		}
		length = uint64(binary.BigEndian.Uint16(ext[:]))
	} else if length == 127 {
		var ext [8]byte
		if _, err := io.ReadFull(reader, ext[:]); err != nil {
			return 0, nil, err
		}
		length = binary.BigEndian.Uint64(ext[:])
	}
	if length > 1024*1024 {
		return 0, nil, errors.New("unexpected test frame size")
	}
	var mask [4]byte
	if _, err := io.ReadFull(reader, mask[:]); err != nil {
		return 0, nil, err
	}
	data := make([]byte, int(length))
	if _, err := io.ReadFull(reader, data); err != nil {
		return 0, nil, err
	}
	for index := range data {
		data[index] ^= mask[index%4]
	}
	return header[0] & 15, data, nil
}

func upgradeSocket(w http.ResponseWriter, r *http.Request) (net.Conn, *bufio.ReadWriter, error) {
	conn, buffer, err := w.(http.Hijacker).Hijack()
	if err != nil {
		return nil, nil, err
	}
	conn.SetDeadline(time.Now().Add(5 * time.Second))
	digest := sha1.Sum([]byte(r.Header.Get("Sec-WebSocket-Key") + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	_, err = fmt.Fprintf(buffer, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: keep-alive, Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n", base64.StdEncoding.EncodeToString(digest[:]))
	if err == nil {
		err = buffer.Flush()
	}
	if err != nil {
		conn.Close()
		return nil, nil, err
	}
	return conn, buffer, nil
}

func TestNativeWebSocketRoundTrip(t *testing.T) {
	done := make(chan error, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		err := func() error {
			if r.Method != "GET" || r.URL.RequestURI() != "/socket%2Fvoice?keep=1" || r.Header.Get("Authorization") != "Bearer native-key" || r.Header.Get("Sec-WebSocket-Version") != "13" {
				return fmt.Errorf("unexpected upgrade: %s %s %#v", r.Method, r.URL.RequestURI(), r.Header)
			}
			conn, buffer, err := upgradeSocket(w, r)
			if err != nil {
				return err
			}
			defer conn.Close()
			for _, size := range []int{1, 126, 65536} {
				opcode, data, err := clientFrame(buffer)
				if err != nil {
					return err
				}
				if opcode != 2 || !bytes.Equal(data, bytes.Repeat([]byte{0xff}, size)) {
					return fmt.Errorf("unexpected outbound frame: opcode %d, size %d", opcode, len(data))
				}
			}
			if _, err := conn.Write(append(serverFrame(1, false, []byte{0xe2}), serverFrame(9, true, []byte("ping"))...)); err != nil {
				return err
			}
			opcode, data, err := clientFrame(buffer)
			if err != nil {
				return err
			}
			if opcode != 10 || string(data) != "ping" {
				return fmt.Errorf("unexpected pong: %d %q", opcode, data)
			}
			packets := append(serverFrame(0, true, []byte{0x82, 0xac}), serverFrame(2, true, []byte{0, 255, 128})...)
			packets = append(packets, serverFrame(8, true, []byte{3, 232})...)
			if _, err := conn.Write(packets); err != nil {
				return err
			}
			opcode, data, err = clientFrame(buffer)
			if err != nil {
				return err
			}
			if opcode != 8 || !bytes.Equal(data, []byte{3, 232}) {
				return fmt.Errorf("unexpected close reply: %d %x", opcode, data)
			}
			return nil
		}()
		done <- err
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	socket, err := ConnectWebSocket(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+"/socket%2Fvoice?keep=1", WebSocketOptions{Header: http.Header{"Authorization": {"Bearer native-key"}}})
	if err != nil {
		t.Fatal(err)
	}
	defer socket.Close()
	for _, size := range []int{1, 126, 65536} {
		if err := socket.Send(ctx, WebSocketBinary(bytes.Repeat([]byte{255}, size))); err != nil {
			t.Fatal(err)
		}
	}
	for _, expected := range []WebSocketMessage{WebSocketText("€"), WebSocketBinary{0, 255, 128}} {
		got, err := socket.Receive(ctx)
		if err != nil || !reflect.DeepEqual(got, expected) {
			t.Fatalf("Receive = %#v, %v; want %#v", got, err, expected)
		}
	}
	for range 2 {
		if got, err := socket.Receive(ctx); got != nil || err != io.EOF {
			t.Fatalf("terminal Receive = %#v, %v", got, err)
		}
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

type memorySocketBody struct {
	reader io.Reader
	writes bytes.Buffer
	closes atomic.Int32
}

func (b *memorySocketBody) Read(p []byte) (int, error)  { return b.reader.Read(p) }
func (b *memorySocketBody) Write(p []byte) (int, error) { return b.writes.Write(p) }
func (b *memorySocketBody) Close() error                { b.closes.Add(1); return nil }

func testSocket(t *testing.T, body io.ReadWriteCloser, limit int) *webSocket {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	s := &webSocket{body: body, ctx: ctx, cancel: cancel, maxMessage: limit}
	s.stop = context.AfterFunc(ctx, func() { s.closeBody() })
	t.Cleanup(func() { s.Close() })
	return s
}

func TestWebSocketMalformedFrames(t *testing.T) {
	for _, test := range []struct {
		name string
		data []byte
		want string
	}{
		{"rsv", []byte{0xc1, 0}, "Invalid WebSocket frame header"},
		{"masked server", []byte{0x81, 0x80}, "Invalid WebSocket frame header"},
		{"opcode", []byte{0x83, 0}, "Invalid WebSocket frame header"},
		{"fragmented ping", []byte{9, 0}, "Invalid WebSocket control frame"},
		{"oversized ping", []byte{0x89, 126}, "Invalid WebSocket control frame"},
		{"short extended length", []byte{0x82, 126, 0, 1}, "Nonminimal WebSocket frame length"},
		{"short wide length", []byte{0x82, 127, 0, 0, 0, 0, 0, 0, 0, 126}, "Invalid WebSocket frame length"},
		{"high bit", []byte{0x82, 127, 128, 0, 0, 0, 0, 0, 0, 0}, "Invalid WebSocket frame length"},
		{"message limit before payload", []byte{0x82, 126, 0, 126}, "WebSocket message exceeds byte limit"},
		{"continuation without start", []byte{0x80, 0}, "Invalid WebSocket fragmentation"},
		{"new message during fragment", []byte{1, 0, 0x81, 0}, "Invalid WebSocket fragmentation"},
		{"aggregate message limit", append(serverFrame(2, false, bytes.Repeat([]byte{1}, 80)), serverFrame(0, true, bytes.Repeat([]byte{2}, 21))...), "WebSocket message exceeds byte limit"},
		{"invalid utf8", []byte{0x81, 1, 255}, "Invalid WebSocket UTF-8"},
		{"incomplete utf8", []byte{1, 1, 0xe2, 0x80, 0}, "Invalid WebSocket UTF-8"},
		{"one byte close", []byte{0x88, 1, 0}, "Invalid WebSocket close payload"},
		{"reserved close code", []byte{0x88, 2, 3, 237}, "Invalid WebSocket close code"},
		{"invalid close utf8", []byte{0x88, 3, 3, 232, 255}, "Invalid WebSocket UTF-8"},
	} {
		t.Run(test.name, func(t *testing.T) {
			body := &memorySocketBody{reader: bytes.NewReader(test.data)}
			socket := testSocket(t, body, 100)
			got, err := socket.Receive(context.Background())
			if got != nil || err == nil || err.Error() != test.want {
				t.Fatalf("Receive = %#v, %v; want %q", got, err, test.want)
			}
			if body.closes.Load() != 1 {
				t.Fatalf("Close count = %d", body.closes.Load())
			}
			if got, err := socket.Receive(context.Background()); got != nil || err != io.EOF {
				t.Fatalf("terminal = %#v, %v", got, err)
			}
		})
	}
}

type socketErrorReader struct{ err error }

func (r socketErrorReader) Read([]byte) (int, error) { return 0, r.err }

func TestWebSocketFrameReadErrorsAndClose(t *testing.T) {
	sentinel := errors.New("reader failed")
	for _, prefix := range [][]byte{nil, {0x82, 126}, {0x82, 127}, {0x82, 1}} {
		for _, ending := range []error{sentinel, io.EOF} {
			body := &memorySocketBody{reader: io.MultiReader(bytes.NewReader(prefix), socketErrorReader{ending})}
			socket := testSocket(t, body, 100000)
			_, err := socket.Receive(context.Background())
			if ending == sentinel {
				if err != sentinel {
					t.Fatalf("error identity = %v", err)
				}
			} else {
				var closed *WebSocketClosed
				if !errors.As(err, &closed) || !reflect.DeepEqual(*closed, WebSocketClosed{Code: 1006}) {
					t.Fatalf("abnormal EOF = %#v", err)
				}
			}
		}
	}
	for _, code := range []int{1000, 1008, 4000} {
		payload := append(binary.BigEndian.AppendUint16(nil, uint16(code)), []byte("reason")...)
		body := &memorySocketBody{reader: bytes.NewReader(serverFrame(8, true, payload))}
		socket := testSocket(t, body, 100)
		_, err := socket.Receive(context.Background())
		if code == 1000 {
			if err != io.EOF {
				t.Fatal(err)
			}
		} else {
			var closed *WebSocketClosed
			if !errors.As(err, &closed) || !reflect.DeepEqual(*closed, WebSocketClosed{Code: code, Reason: "reason"}) {
				t.Fatalf("close = %#v", err)
			}
		}
		opcode, data, err := clientFrame(&body.writes)
		if err != nil || opcode != 8 || !bytes.Equal(data, payload) {
			t.Fatalf("close reply = %d %x %v", opcode, data, err)
		}
	}
}

type socketTransport func(*http.Request) (*http.Response, error)

func (f socketTransport) Do(r *http.Request) (*http.Response, error) { return f(r) }

func TestWebSocketHandshakeFailures(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func(*http.Response)
		want   string
	}{
		{"status", func(r *http.Response) { r.StatusCode = 302 }, "WebSocket handshake was not accepted"},
		{"accept", func(r *http.Response) { r.Header.Set("Sec-WebSocket-Accept", "wrong") }, "Invalid WebSocket upgrade response"},
		{"duplicate accept", func(r *http.Response) { r.Header.Add("Sec-WebSocket-Accept", r.Header.Get("Sec-WebSocket-Accept")) }, "Invalid WebSocket upgrade response"},
		{"upgrade", func(r *http.Response) { r.Header.Del("Upgrade") }, "Invalid WebSocket upgrade response"},
		{"connection", func(r *http.Response) { r.Header.Set("Connection", "close") }, "Invalid WebSocket upgrade response"},
		{"extensions", func(r *http.Response) { r.Header.Set("Sec-WebSocket-Extensions", "permessage-deflate") }, "Invalid WebSocket upgrade response"},
		{"protocol", func(r *http.Response) { r.Header.Set("Sec-WebSocket-Protocol", "unexpected") }, "Invalid WebSocket upgrade response"},
	} {
		t.Run(test.name, func(t *testing.T) {
			body := &memorySocketBody{reader: strings.NewReader("")}
			transport := socketTransport(func(r *http.Request) (*http.Response, error) {
				digest := sha1.Sum([]byte(r.Header.Get("Sec-WebSocket-Key") + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
				response := &http.Response{StatusCode: 101, Body: body, Header: http.Header{"Upgrade": {"websocket"}, "Connection": {"Upgrade"}, "Sec-Websocket-Accept": {base64.StdEncoding.EncodeToString(digest[:])}}}
				test.mutate(response)
				return response, nil
			})
			socket, err := ConnectWebSocket(context.Background(), "wss://example.test?api_key=secret", WebSocketOptions{Transport: transport})
			if socket != nil || err == nil || err.Error() != test.want || body.closes.Load() != 1 {
				t.Fatalf("handshake = %#v, %v, closes %d", socket, err, body.closes.Load())
			}
		})
	}
	sentinel := errors.New("transport failed")
	_, err := ConnectWebSocket(context.Background(), "wss://example.test?api_key=secret", WebSocketOptions{Transport: socketTransport(func(r *http.Request) (*http.Response, error) {
		return nil, &url.Error{Op: "Get", URL: r.URL.String(), Err: sentinel}
	})})
	if err != sentinel {
		t.Fatalf("transport error = %v", err)
	}
	calls := 0
	transport := socketTransport(func(*http.Request) (*http.Response, error) { calls++; return nil, sentinel })
	for _, address := range []string{"https://example.test", "ws://user:secret@example.test", "ws://example.test#fragment", "ws://example.test/a b", "ws:///path", "ws://example.test\\path"} {
		_, err := ConnectWebSocket(context.Background(), address, WebSocketOptions{Transport: transport})
		if err == nil || err.Error() != "WebSocket URL must be ws/wss without credentials or a fragment" {
			t.Fatalf("URL %q error = %v", address, err)
		}
	}
	for _, header := range []http.Header{{"Authorization": {"value\r\nInjected: secret"}}, {"Upgrade": {"other"}}, {"Invalid Name": {"value"}}, {"Authorization": {"é"}}} {
		_, err := ConnectWebSocket(context.Background(), "ws://example.test", WebSocketOptions{Transport: transport, Header: header})
		if err == nil || err.Error() != "Invalid WebSocket request header" {
			t.Fatalf("header error = %v", err)
		}
	}
	if calls != 0 {
		t.Fatalf("invalid request reached transport %d times", calls)
	}
}

func TestNativeWebSocketTLSAndRedirects(t *testing.T) {
	done := make(chan error, 1)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, _, err := upgradeSocket(w, r)
		if err == nil {
			_, err = conn.Write(serverFrame(1, true, []byte("secure")))
			conn.Close()
		}
		done <- err
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	// The override trusts only this test server's certificate, not arbitrary TLS.
	socket, err := ConnectWebSocket(ctx, "wss"+strings.TrimPrefix(server.URL, "https"), WebSocketOptions{Transport: server.Client()})
	if err != nil {
		t.Fatal(err)
	}
	defer socket.Close()
	if value, err := socket.Receive(ctx); err != nil || value != WebSocketText("secure") {
		t.Fatalf("TLS = %#v %v", value, err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	var destinations atomic.Int32
	destination := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { destinations.Add(1) }))
	defer destination.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, destination.URL, 302) }))
	defer redirect.Close()
	_, err = ConnectWebSocket(ctx, "ws"+strings.TrimPrefix(redirect.URL, "http")+"?api_key=secret", WebSocketOptions{})
	if err == nil || err.Error() != "WebSocket handshake was not accepted" || destinations.Load() != 0 {
		t.Fatalf("redirect = %v; destinations %d", err, destinations.Load())
	}
}

func TestWebSocketCancellationAndBlockedIO(t *testing.T) {
	for _, mode := range []string{"receive", "send", "queued send", "idle"} {
		t.Run(mode, func(t *testing.T) {
			client, peer := net.Pipe()
			defer peer.Close()
			socket := testSocket(t, client, 1024)
			ctx, cancel := context.WithCancel(context.Background())
			result := make(chan error, 2)
			if mode == "queued send" {
				go func() { result <- socket.Send(context.Background(), WebSocketText("blocked")) }()
				// Reading one header byte proves the first writer holds writeMutex.
				var one [1]byte
				peer.SetReadDeadline(time.Now().Add(5 * time.Second))
				if _, err := peer.Read(one[:]); err != nil {
					t.Fatal(err)
				}
			}
			switch mode {
			case "receive":
				go func() { _, err := socket.Receive(ctx); result <- err }()
			case "send", "queued send":
				go func() { result <- socket.Send(ctx, WebSocketText("blocked")) }()
			case "idle":
				socket.cancel()
				go func() { _, err := socket.Receive(ctx); result <- err }()
			}
			cancel()
			count := 1
			if mode == "queued send" {
				count = 2
			}
			for range count {
				select {
				case err := <-result:
					if err != context.Canceled {
						t.Fatalf("cancel = %v", err)
					}
				case <-time.After(5 * time.Second):
					t.Fatal("cancellation did not unblock I/O")
				}
			}
		})
	}
	client, peer := net.Pipe()
	defer peer.Close()
	socket := testSocket(t, client, 100)
	done := make(chan error, 1)
	go func() { _, err := socket.Receive(context.Background()); done <- err }()
	socket.Close()
	select {
	case err := <-done:
		if err != context.Canceled {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Close did not unblock read")
	}
}

func TestNativeWebSocketHandshakeCancellationAndHeaderLimit(t *testing.T) {
	started := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/large" {
			w.Header().Set("X-Large", strings.Repeat("x", 4096))
			w.WriteHeader(400)
			return
		}
		started <- struct{}{}
		<-r.Context().Done()
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, err := ConnectWebSocket(ctx, "ws"+strings.TrimPrefix(server.URL, "http"), WebSocketOptions{})
		done <- err
	}()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("handshake did not start")
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("handshake did not cancel")
	}
	ctx, cancel = context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err := ConnectWebSocket(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+"/large", WebSocketOptions{MaxHeaderBytes: 1024})
	if err == nil || err.Error() != "net/http: HTTP/1.x transport connection broken: net/http: server response headers exceeded 1024 bytes; aborted" {
		t.Fatalf("header limit error = %v", err)
	}
	canceled, stop := context.WithCancel(ctx)
	stop()
	calls := 0
	_, err = ConnectWebSocket(canceled, "ws://example.test", WebSocketOptions{Transport: socketTransport(func(*http.Request) (*http.Response, error) { calls++; return nil, errors.New("must not call") })})
	if err != context.Canceled || calls != 0 {
		t.Fatalf("pre-canceled: %v, calls %d", err, calls)
	}
}

type readOnlySocketBody struct {
	io.Reader
	closes atomic.Int32
}

func (b *readOnlySocketBody) Close() error { b.closes.Add(1); return nil }

type shortSocketBody struct {
	*memorySocketBody
	err error
}

func (b *shortSocketBody) Write(data []byte) (int, error) { return len(data) - 1, b.err }

func TestWebSocketDuplexAndSendValidation(t *testing.T) {
	body := &readOnlySocketBody{Reader: strings.NewReader("")}
	transport := socketTransport(func(r *http.Request) (*http.Response, error) {
		digest := sha1.Sum([]byte(r.Header.Get("Sec-WebSocket-Key") + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
		return &http.Response{StatusCode: 101, Body: body, Header: http.Header{"Upgrade": {"websocket"}, "Connection": {"Upgrade"}, "Sec-Websocket-Accept": {base64.StdEncoding.EncodeToString(digest[:])}}}, nil
	})
	_, err := ConnectWebSocket(context.Background(), "ws://example.test", WebSocketOptions{Transport: transport})
	if err == nil || err.Error() != "WebSocket transport did not return a duplex body" || body.closes.Load() != 1 {
		t.Fatalf("duplex error: %v, closes %d", err, body.closes.Load())
	}
	for _, test := range []struct {
		message WebSocketMessage
		want    string
	}{
		{nil, "Invalid WebSocket message"},
		{(*WebSocketText)(nil), "Invalid WebSocket message"},
		{(*WebSocketBinary)(nil), "Invalid WebSocket message"},
		{WebSocketText(string([]byte{255})), "Invalid WebSocket UTF-8"},
		{WebSocketBinary{1, 2, 3, 4}, "WebSocket message exceeds byte limit"},
	} {
		body := &memorySocketBody{reader: strings.NewReader("")}
		socket := testSocket(t, body, 3)
		if err := socket.Send(context.Background(), test.message); err == nil || err.Error() != test.want {
			t.Fatalf("Send = %v; want %q", err, test.want)
		}
		if body.writes.Len() != 0 {
			t.Fatalf("invalid Send wrote %d bytes", body.writes.Len())
		}
	}
	sentinel := errors.New("write failed")
	for _, ending := range []error{nil, sentinel} {
		body := &shortSocketBody{memorySocketBody: &memorySocketBody{reader: strings.NewReader("")}, err: ending}
		socket := testSocket(t, body, 3)
		want := ending
		if want == nil {
			want = io.ErrShortWrite
		}
		if err := socket.Send(context.Background(), WebSocketText("hi")); err != want || body.closes.Load() != 1 {
			t.Fatalf("write error: %v, closes %d", err, body.closes.Load())
		}
	}
	// Value and pointer forms permitted by Go method sets share the same codec.
	text, binary := WebSocketText("hi"), WebSocketBinary{255}
	for _, message := range []WebSocketMessage{text, &text, binary, &binary} {
		body := &memorySocketBody{reader: strings.NewReader("")}
		socket := testSocket(t, body, 3)
		if err := socket.Send(context.Background(), message); err != nil {
			t.Fatal(err)
		}
		opcode, data, err := clientFrame(&body.writes)
		if err != nil {
			t.Fatal(err)
		}
		if opcode == 1 {
			if string(data) != "hi" {
				t.Fatalf("text = %q", data)
			}
		} else if opcode != 2 || !bytes.Equal(data, []byte{255}) {
			t.Fatalf("binary = %d %v", opcode, data)
		}
	}
}
