package murf

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
	} else if n == 127 {
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

func TestNativeSocketAuthenticatesHeaderAndPreservesProxyQuery(t *testing.T) {
	closed := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(closed)
		equal(t, r.RequestURI, "/proxy%2Fpath/v1/speech/stream-input?tenant=a%2Bb&tag=a;b&channel_type=MONO&format=PCM&model=falcon-2&sample_rate=24000")
		equal(t, r.Header.Get("api_key"), "test-key")
		equal(t, r.URL.Query().Get("api_key"), "")
		connection, buffer, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		defer connection.Close()
		digest := sha1.Sum([]byte(r.Header.Get("Sec-WebSocket-Key") + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
		_, _ = buffer.WriteString("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + base64.StdEncoding.EncodeToString(digest[:]) + "\r\n\r\n")
		_ = buffer.Flush()
		opcode, data, err := clientFrame(buffer)
		if err != nil {
			t.Error(err)
			return
		}
		equal(t, opcode, byte(1))
		equal(t, decode(t, data), map[string]any{"min_buffer_size": float64(40), "max_buffer_delay_in_ms": float64(300)})
		for {
			opcode, data, err := clientFrame(buffer)
			if err == io.EOF || opcode == 8 {
				return
			}
			if err != nil {
				t.Error(err)
				return
			}
			equal(t, opcode, byte(1))
			packet := decode(t, data).(map[string]any)
			if packet["text"] == "Hi" {
				_ = writePacket(buffer, map[string]any{"context_id": packet["context_id"], "audio": "AP+A"})
			}
			if packet["end"] == true {
				_ = writePacket(buffer, map[string]any{"context_id": packet["context_id"], "final": true})
			}
		}
	}))
	defer server.Close()
	input := newSource(text("Hi"))
	stream, err := Synthesize(context.Background(), streaming(input), Options{Auth: testAuth, BaseURL: server.URL + "/proxy%2Fpath/?tenant=a%2Bb&tag=a;b&api_key=discard&model=gen2"})
	if err != nil {
		t.Fatal(err)
	}
	equal(t, len(collect(t, stream)), 2)
	wait(t, closed)
	wait(t, input.closed)
}
func TestNativeHandshakeRejectsBeforeInputOwnership(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(401) }))
	defer server.Close()
	input := newSource(text("Hi"))
	_, err := Synthesize(context.Background(), streaming(input), Options{Auth: testAuth, WebSocketURL: strings.Replace(server.URL, "http:", "ws:", 1) + "/custom"})
	errorText(t, err, "WebSocket handshake was not accepted")
	equal(t, input.reads.Load(), int32(0))
	equal(t, input.closes.Load(), int32(0))
}
func TestNativeHTTPStreamsAndRejectsRedirects(t *testing.T) {
	disconnected := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		equal(t, r.URL.Path, "/v1/speech/stream")
		equal(t, r.Header.Get("api-key"), "test-key")
		w.Header().Set("Content-Type", "audio/pcm")
		_, _ = w.Write([]byte{0, 255, 128})
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
	equal(t, err, nil)
	stream.Close()
	wait(t, disconnected)
	var followed atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { followed.Add(1) }))
	defer target.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, 307) }))
	defer redirect.Close()
	stream, err = Synthesize(context.Background(), request(), Options{Auth: testAuth, BaseURL: redirect.URL})
	if err != nil {
		t.Fatal(err)
	}
	_, err = stream.Next(context.Background())
	errorText(t, err, "Murf synthesis failed (307)")
	equal(t, followed.Load(), int32(0))
	stream.Close()
}
