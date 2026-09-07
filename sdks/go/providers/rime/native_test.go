package rime

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
	"net/url"
	"strings"
	"sync/atomic"
	"testing"

	schema "github.com/speechswitch/client/sdks/go/generated/rime"
	out "github.com/speechswitch/client/sdks/go/generated/rime_output"
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

func TestNativeWebSocketHeaderAuthAndModelSpecificQuery(t *testing.T) {
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
		for i := 0; i < 2; i++ {
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
			if i == 0 {
				id = message["contextId"]
			}
		}
		for _, message := range []map[string]any{{"type": "chunk", "contextId": id, "data": "AP8="}, {"type": "done", "contextId": id}} {
			data, _ := json.Marshal(message)
			if len(data) >= 126 {
				t.Error("oversized fixture")
				return
			}
			for _, b := range append([]byte{129, byte(len(data))}, data...) {
				rw.WriteByte(b)
				rw.Flush()
			}
		}
		rw.Write([]byte{136, 2, 3, 232})
		rw.Flush()
		kind, data, err := readFrame(rw.Reader)
		if err != nil {
			t.Error(err)
			return
		}
		if kind != 8 || string(data) != string([]byte{3, 232}) {
			t.Errorf("unexpected close: %d %v", kind, data)
		}
	}))
	defer server.Close()
	r := fixtureRequests()[3].(*schema.TtsRequestAsMistV3TextVoice3fb6eaa2).Value
	r.Text = "Hola 🚀"
	r.Speed = runtime.Some(2.0)
	var segment schema.TtsRequestCodaStreamingTextVoice84ec2db1Segmentation = schema.TtsRequestCodaStreamingTextVoice84ec2db1SegmentationAsManual{}
	r.Segmentation = runtime.Some(segment)
	var yes schema.TtsRequestMistV2StreamingTextVoice03cc8904TextMarkupPauses = schema.TtsRequestMistV2StreamingTextVoice03cc8904TextMarkupPausesAsTrue{}
	r.TextMarkup = runtime.Some(schema.TtsRequestMistV3StreamingTextVoice49f68e83TextMarkup{Pauses: runtime.Some(yes), Speeds: runtime.Some([]float64{2, .5})})
	input, err := Synthesize(deadline(t), schema.TtsRequestAsMistV3TextVoice3fb6eaa2{Value: r}, Options{Auth: authenticated(), WebSocketURL: strings.Replace(server.URL, "http:", "ws:", 1) + "/proxy%2Fraw/ws3?tenant=a%2Bb&modelId=bad&modelId=also-bad"})
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	items, err := collect(deadline(t), input)
	if err != nil {
		t.Fatal(err)
	}
	received := <-handshake
	equal(t, received.Method, "GET")
	equal(t, received.URL.EscapedPath(), "/proxy%2Fraw/ws3")
	equal(t, received.URL.Query(), url.Values{"tenant": {"a+b"}, "speaker": {"custom-uuid"}, "modelId": {"mistv3"}, "lang": {"es"}, "samplingRate": {"24000"}, "timeScaleFactor": {"0.5"}, "pauseBetweenBrackets": {"true"}, "inlineSpeedAlpha": {"0.5,2"}, "audioFormat": {"ogg"}, "segment": {"never"}})
	equal(t, received.Header.Get("Authorization"), "Bearer fixture")
	equal(t, received.Header.Get("Sec-WebSocket-Protocol"), "")
	first, final := <-messages, <-messages
	equal(t, first, map[string]any{"text": "Hola 🚀", "contextId": first["contextId"]})
	equal(t, final, map[string]any{"operation": "eos"})
	equal(t, items, []out.SynthesisItem{out.SynthesisItemAsBytes{Value: []byte{0, 255}}, out.SynthesisItemAsBatch{Value: out.RimeBatchEvent{InputGroupId: runtime.Some(first["contextId"].(string))}}, out.SynthesisItemAsDone{}})
	await(t, completed)
}

func TestNativeHTTPStreamsBeforeEOFAndClosesOnConsumerExit(t *testing.T) {
	closed := make(chan struct{})
	requests := make(chan *http.Request, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests <- r.Clone(context.Background())
		w.Header().Set("Content-Type", "audio/L16")
		w.Write([]byte{0, 255})
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(closed)
	}))
	defer server.Close()
	input, err := Synthesize(deadline(t), request(), Options{Auth: authenticated(), BaseURL: server.URL + "/proxy?x=1;2"})
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
	equal(t, r.URL.RequestURI(), "/proxy/v1/rime-tts?x=1;2")
	equal(t, r.Header.Get("Authorization"), "Bearer fixture")
	equal(t, r.Header.Get("Accept"), "audio/L16")
	select {
	case <-closed:
		t.Fatal("closed before consumer exit")
	default:
	}
	input.Close()
	await(t, closed)
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
	var calls atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1) }))
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
	equal(t, err, &Error{Status: runtime.Some(307), Message: "Rime returned HTTP 307"})
	equal(t, calls.Load(), int32(0))
}
