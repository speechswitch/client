package voice_ai

import (
	"bufio"
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	out "github.com/speechswitch/client/sdks/go/generated/voice_ai_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func readFrame(reader *bufio.Reader) (byte, []byte, error) {
	var header [2]byte
	if _, err := io.ReadFull(reader, header[:]); err != nil {
		return 0, nil, err
	}
	if header[0]&128 == 0 || header[1]&128 == 0 {
		return 0, nil, fmt.Errorf("unmasked or fragmented client frame")
	}
	size := uint64(header[1] & 127)
	if size == 126 {
		var b [2]byte
		if _, err := io.ReadFull(reader, b[:]); err != nil {
			return 0, nil, err
		}
		size = uint64(binary.BigEndian.Uint16(b[:]))
	} else if size == 127 {
		var b [8]byte
		if _, err := io.ReadFull(reader, b[:]); err != nil {
			return 0, nil, err
		}
		size = binary.BigEndian.Uint64(b[:])
	}
	if size > 4096 {
		return 0, nil, fmt.Errorf("oversized fixture frame")
	}
	var mask [4]byte
	if _, err := io.ReadFull(reader, mask[:]); err != nil {
		return 0, nil, err
	}
	data := make([]byte, size)
	if _, err := io.ReadFull(reader, data); err != nil {
		return 0, nil, err
	}
	for i := range data {
		data[i] ^= mask[i%4]
	}
	return header[0] & 15, data, nil
}

func TestNativeWebSocketUpgradeAuthAndFragmentedAudio(t *testing.T) {
	done := make(chan error, 1)
	handshakes := make(chan *http.Request, 1)
	messages := make(chan map[string]any, 2)
	expires, _ := deadline(t).Deadline()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		err := func() error {
			handshakes <- r.Clone(context.Background())
			conn, rw, err := w.(http.Hijacker).Hijack()
			if err != nil {
				return err
			}
			defer conn.Close()
			if err := conn.SetDeadline(expires); err != nil {
				return err
			}
			digest := sha1.Sum([]byte(r.Header.Get("Sec-WebSocket-Key") + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
			if _, err := fmt.Fprintf(rw, "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: %s\r\n\r\n", base64.StdEncoding.EncodeToString(digest[:])); err != nil {
				return err
			}
			if err := rw.Flush(); err != nil {
				return err
			}
			var id any
			for i := 0; i < 2; i++ {
				kind, data, err := readFrame(rw.Reader)
				if err != nil {
					return err
				}
				if kind != 1 {
					return fmt.Errorf("expected text frame, got %d", kind)
				}
				var message map[string]any
				if err := json.Unmarshal(data, &message); err != nil {
					return err
				}
				messages <- message
				if i == 0 {
					id = message["context_id"]
				}
			}
			for _, message := range []map[string]any{{"context_id": id, "audio": "AP+A"}, {"context_id": id, "is_last": true}, {"context_id": id, "context_closed": true}} {
				data, err := json.Marshal(message)
				if err != nil {
					return err
				}
				middle := len(data) / 2
				for i, part := range [][]byte{data[:middle], data[middle:]} {
					if len(part) >= 126 {
						return fmt.Errorf("oversized fixture fragment")
					}
					opcode := byte(1)
					if i == 1 {
						opcode = 128
					}
					if _, err := rw.Write(append([]byte{opcode, byte(len(part))}, part...)); err != nil {
						return err
					}
					if err := rw.Flush(); err != nil {
						return err
					}
				}
			}
			// Keep the socket open until the adapter consumes both distinct completion messages.
			kind, _, err := readFrame(rw.Reader)
			if err == io.EOF {
				return nil
			}
			if err != nil {
				return err
			}
			if kind != 8 {
				return fmt.Errorf("expected close frame, got %d", kind)
			}
			return nil
		}()
		done <- err
	}))
	defer server.Close()
	input, err := Synthesize(deadline(t), request(), Options{Auth: authenticated(), Protocol: "websocket", BaseURL: server.URL + "/proxy%2Fraw"})
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	items, err := collect(deadline(t), input)
	if err != nil {
		t.Fatal(err)
	}
	r := <-handshakes
	equal(t, r.Method, "GET")
	equal(t, r.URL.RequestURI(), "/proxy%2Fraw/api/v1/tts/multi-stream")
	equal(t, r.Header.Get("Authorization"), "Bearer fixture")
	equal(t, r.Header.Get("Sec-WebSocket-Protocol"), "")
	first, last := <-messages, <-messages
	id := first["context_id"].(string)
	equal(t, first, map[string]any{"context_id": id, "text": "Hello", "model": "voiceai-tts-v1-latest", "language": "en", "audio_format": "mp3", "temperature": float64(1), "top_p": .8, "delivery_mode": "raw"})
	equal(t, last, map[string]any{"context_id": id, "text": "", "flush": true, "auto_close": true})
	equal(t, items, []out.SynthesisItem{out.SynthesisItemAsOrdered{Value: out.VoiceAiEnvelope{Audio: []byte{0, 255, 128}, CorrelationId: id}}, out.SynthesisItemAsFlush{Value: out.FlushEvent{CorrelationId: id}}, out.SynthesisItemAsDone{}})
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestNativeHTTPStreamsAtHeadersAndClosesOnConsumerExit(t *testing.T) {
	closed := make(chan struct{})
	requests := make(chan *http.Request, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests <- r.Clone(context.Background())
		w.Header().Set("Content-Type", "audio/mpeg")
		w.Write([]byte{0, 255})
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(closed)
	}))
	defer server.Close()
	input, err := Synthesize(deadline(t), request(), Options{Auth: authenticated(), BaseURL: server.URL + "/proxy%2Fraw/"})
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	item, err := input.Next(deadline(t))
	if err != nil {
		t.Fatal(err)
	}
	equal(t, item, out.SynthesisItemAsBytes{Value: []byte{0, 255}})
	r := <-requests
	equal(t, r.URL.RequestURI(), "/proxy%2Fraw/api/v1/tts/speech/stream")
	equal(t, r.Header.Get("Authorization"), "Bearer fixture")
	equal(t, r.Header.Get("Accept"), "audio/*, application/octet-stream")
	select {
	case <-closed:
		t.Fatal("closed before consumer exit")
	default:
	}
	input.Close()
	await(t, closed)
}

func TestNativeRejectsRedirectsAndHandshakeBeforeInput(t *testing.T) {
	var redirected atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { redirected.Add(1) }))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	input, err := Synthesize(deadline(t), request(), Options{Auth: authenticated(), BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	_, err = input.Next(deadline(t))
	equal(t, err, &Error{Status: runtime.Some(307)})
	equal(t, redirected.Load(), int32(0))
	p := newProducer()
	input, err = Synthesize(deadline(t), liveRequest(p), Options{Auth: authenticated(), BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	_, err = input.Next(deadline(t))
	if err == nil {
		t.Fatal("accepted rejected upgrade")
	}
	equal(t, err.Error(), "WebSocket handshake was not accepted")
	equal(t, p.reads.Load(), int32(0))
	equal(t, p.closes.Load(), int32(0))
	equal(t, redirected.Load(), int32(0))
}
