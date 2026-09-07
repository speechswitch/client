package respeecher

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
	"strings"
	"sync/atomic"
	"testing"

	schema "github.com/speechswitch/client/sdks/go/generated/respeecher"
	out "github.com/speechswitch/client/sdks/go/generated/respeecher_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func readFrame(reader *bufio.Reader) (byte, []byte, error) {
	header := make([]byte, 2)
	if _, err := io.ReadFull(reader, header); err != nil {
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

func TestNativeWebSocketHeaderAuthProxyPathAndCompletion(t *testing.T) {
	completed := make(chan struct{})
	handshake := make(chan *http.Request, 1)
	messages := make(chan map[string]any, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handshake <- r.Clone(context.Background())
		connection, rw, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		defer connection.Close()
		defer close(completed)
		digest := sha1.Sum([]byte(r.Header.Get("Sec-WebSocket-Key") + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
		fmt.Fprintf(rw, "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: %s\r\n\r\n", base64.StdEncoding.EncodeToString(digest[:]))
		rw.Flush()
		var id any
		for range 2 {
			kind, data, err := readFrame(rw.Reader)
			if err != nil {
				t.Error(err)
				return
			}
			if kind != 1 {
				t.Error("non-text request")
				return
			}
			var message map[string]any
			if err := json.Unmarshal(data, &message); err != nil {
				t.Error(err)
				return
			}
			messages <- message
			id = message["context_id"]
		}
		for _, message := range []map[string]any{{"type": "chunk", "context_id": id, "data": "AP8="}, {"type": "done", "context_id": id}} {
			data, _ := json.Marshal(message)
			if len(data) >= 126 {
				t.Error("oversized server fixture")
				return
			}
			rw.WriteByte(129)
			rw.WriteByte(byte(len(data)))
			rw.Write(data)
			rw.Flush()
		}
		io.Copy(io.Discard, rw)
	}))
	defer server.Close()
	input, err := Synthesize(deadline(t), request(), Options{Auth: authenticated(), BaseURL: server.URL + "/proxy%20path?route=uk&encoded=%2F"})
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	items, err := collect(deadline(t), input)
	if err != nil {
		t.Fatal(err)
	}
	r := <-handshake
	equal(t, r.Method, "GET")
	equal(t, r.URL.RequestURI(), "/proxy%20path/tts/websocket?route=uk&encoded=%2F")
	equal(t, r.Header.Get("X-API-Key"), "fixture")
	equal(t, r.Header.Get("Authorization"), "")
	first, final := <-messages, <-messages
	equal(t, first["transcript"], "Hello")
	equal(t, first["continue"], true)
	equal(t, final["continue"], false)
	equal(t, final["transcript"], "")
	equal(t, final["context_id"], first["context_id"])
	equal(t, items, []out.SynthesisItem{out.SynthesisItemAsOrdered{Value: out.AudioEnvelope{CorrelationId: first["context_id"].(string), Audio: []byte{0, 255}}}, out.SynthesisItemAsDone{}})
	await(t, completed)
}

func TestNativeHTTPStreamsBeforeEOFAndClosesOnConsumerExit(t *testing.T) {
	for _, wave := range []bool{false, true} {
		t.Run(fmt.Sprint(wave), func(t *testing.T) {
			closed := make(chan struct{})
			requests := make(chan *http.Request, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests <- r.Clone(context.Background())
				if wave {
					w.Header().Set("Content-Type", "audio/wav")
					w.Write([]byte{0, 255})
				} else {
					w.Header().Set("Content-Type", "text/event-stream")
					io.WriteString(w, "{\"type\":\"chunk\",\"data\":\"AP8=\"}\n")
				}
				w.(http.Flusher).Flush()
				<-r.Context().Done()
				close(closed)
			}))
			defer server.Close()
			var req schema.TtsRequest = request()
			path := "/tts/sse"
			if wave {
				req = schema.TtsRequestAsTextVoice{Value: schema.TtsRequestTextVoice{Text: "Hi", Voice: "v"}}
				path = "/tts/bytes"
			}
			input, err := Synthesize(deadline(t), req, Options{Auth: authenticated(), Protocol: "http", BaseURL: server.URL + "/proxy?x=1;2"})
			if err != nil {
				t.Fatal(err)
			}
			defer input.Close()
			value, err := input.Next(deadline(t))
			if err != nil {
				t.Fatal(err)
			}
			equal(t, value, out.SynthesisItemAsBytes{Value: []byte{0, 255}})
			r := <-requests
			equal(t, r.URL.RequestURI(), "/proxy"+path+"?x=1;2")
			equal(t, r.Header.Get("X-API-Key"), "fixture")
			select {
			case <-closed:
				t.Fatal("closed before consumer exit")
			default:
			}
			input.Close()
			await(t, closed)
		})
	}
}

func TestNativeRejectedHandshakeDoesNotAcquireInput(t *testing.T) {
	source := newProducer()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Error(w, "secret", 401) }))
	defer server.Close()
	input, err := Synthesize(deadline(t), liveRequest(source), Options{Auth: authenticated(), WebSocketURL: strings.Replace(server.URL, "http:", "ws:", 1)})
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	_, err = input.Next(deadline(t))
	if err == nil {
		t.Fatal("accepted rejection")
	}
	equal(t, err.Error(), "WebSocket handshake was not accepted")
	equal(t, source.reads.Load(), int32(0))
}

func TestNativeHTTPDoesNotFollowRedirects(t *testing.T) {
	var targetCalls atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { targetCalls.Add(1) }))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	input, err := Synthesize(deadline(t), request(), Options{Auth: authenticated(), Protocol: "http", BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	_, err = input.Next(deadline(t))
	if err == nil {
		t.Fatal("accepted redirect")
	}
	equal(t, err.Error(), "Respeecher returned HTTP 307")
	equal(t, targetCalls.Load(), int32(0))
}

var _ runtime.Input[out.SynthesisItem] = (*stream)(nil)
