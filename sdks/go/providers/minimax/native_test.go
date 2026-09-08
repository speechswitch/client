package minimax

import (
	"bufio"
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func clientFrame(reader io.Reader) (byte, []byte, error) {
	var header [2]byte
	if _, err := io.ReadFull(reader, header[:]); err != nil {
		return 0, nil, err
	}
	if header[0]&0x80 == 0 || header[1]&0x80 == 0 {
		return 0, nil, errors.New("expected complete masked frame")
	}
	n := uint64(header[1] & 127)
	if n == 126 {
		var b [2]byte
		if _, err := io.ReadFull(reader, b[:]); err != nil {
			return 0, nil, err
		}
		n = uint64(binary.BigEndian.Uint16(b[:]))
	}
	if n == 127 {
		var b [8]byte
		if _, err := io.ReadFull(reader, b[:]); err != nil {
			return 0, nil, err
		}
		n = binary.BigEndian.Uint64(b[:])
	}
	if n > 1024*1024 {
		return 0, nil, errors.New("test frame too large")
	}
	var mask [4]byte
	if _, err := io.ReadFull(reader, mask[:]); err != nil {
		return 0, nil, err
	}
	data := make([]byte, int(n))
	if _, err := io.ReadFull(reader, data); err != nil {
		return 0, nil, err
	}
	for i := range data {
		data[i] ^= mask[i%4]
	}
	return header[0] & 15, data, nil
}
func writePacket(writer *bufio.ReadWriter, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	header := []byte{0x81, byte(len(data))}
	if len(data) >= 126 {
		header = []byte{0x81, 126, byte(len(data) >> 8), byte(len(data))}
	}
	if _, err = writer.Write(header); err != nil {
		return err
	}
	if _, err = writer.Write(data); err != nil {
		return err
	}
	return writer.Flush()
}
func TestNativeSocketAuthAndBidirectionalPath(t *testing.T) {
	closed := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(closed)
		equal(t, r.RequestURI, "/proxy%2Fpath/ws/v1/t2a_v2_bidi?tenant=one")
		equal(t, r.Header.Get("Authorization"), "Bearer test-key")
		connection, buffer, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		defer connection.Close()
		digest := sha1.Sum([]byte(r.Header.Get("Sec-WebSocket-Key") + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
		_, _ = buffer.WriteString("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + base64.StdEncoding.EncodeToString(digest[:]) + "\r\n\r\n")
		_ = buffer.Flush()
		_ = writePacket(buffer, map[string]any{"event": "connected_success", "connect_id": "connection"})
		session := ""
		for {
			opcode, data, err := clientFrame(buffer)
			if err == io.EOF {
				return
			}
			if err != nil {
				t.Error(err)
				return
			}
			if opcode == 8 {
				return
			}
			equal(t, opcode, byte(1))
			var packet map[string]any
			if err = json.Unmarshal(data, &packet); err != nil {
				t.Error(err)
				return
			}
			switch packet["event"] {
			case "task_start":
				session = packet["session_id"].(string)
				_ = writePacket(buffer, map[string]any{"event": "task_started", "session_id": session})
			case "task_continue":
				_ = writePacket(buffer, map[string]any{"data": map[string]any{"audio": "00ff80"}, "session_id": session, "trace_id": "trace"})
			case "task_finish":
				_ = writePacket(buffer, map[string]any{"event": "task_finished", "session_id": session})
			}
		}
	}))
	defer server.Close()
	input := newSource(text("Hi"))
	stream, err := Synthesize(context.Background(), streaming(input), Options{Auth: testAuth, BaseURL: server.URL + "/proxy%2Fpath/?tenant=one"})
	if err != nil {
		t.Fatal(err)
	}
	actual := collect(t, stream)
	equal(t, len(actual), 2)
	wait(t, closed)
	wait(t, input.closed)
}
func TestNativeHandshakeRejectsBeforeInput(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(401) }))
	defer server.Close()
	input := newSource(text("Hi"))
	_, err := Synthesize(context.Background(), streaming(input), Options{Auth: testAuth, WebSocketURL: strings.Replace(server.URL, "http:", "ws:", 1) + "/custom/"})
	if err == nil {
		t.Fatal("expected rejection")
	}
	equal(t, input.reads.Load(), int32(0))
	equal(t, input.closes.Load(), int32(0))
}
func TestNativeHTTPByteStreamingAndRedirectIsolation(t *testing.T) {
	disconnected := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		equal(t, r.URL.Path, "/v1/t2a_v2")
		equal(t, r.Header.Get("Authorization"), "Bearer test-key")
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"data\":{\"status\":1,\"audio\":\"00ff\"}}\n\n")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(disconnected)
	}))
	defer server.Close()
	stream, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	_, err = stream.Next(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	stream.Close()
	wait(t, disconnected)
	var followed atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { followed.Add(1) }))
	defer target.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer redirect.Close()
	stream, err = Synthesize(context.Background(), request(), Options{Auth: testAuth, BaseURL: redirect.URL})
	if err != nil {
		t.Fatal(err)
	}
	_, err = stream.Next(context.Background())
	var native *Error
	if !errors.As(err, &native) {
		t.Fatal(err)
	}
	equal(t, native.StatusCode, 307)
	equal(t, followed.Load(), int32(0))
}
func TestNativeCancellationBeforeHTTPHeaders(t *testing.T) {
	waiting, disconnected := make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		close(waiting)
		<-r.Context().Done()
		close(disconnected)
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	go func() {
		_, err := Synthesize(ctx, request(), Options{Auth: testAuth, BaseURL: server.URL})
		result <- err
	}()
	wait(t, waiting)
	cancel()
	if err := <-result; !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	wait(t, disconnected)
}
