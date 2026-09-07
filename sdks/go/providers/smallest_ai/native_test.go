package smallest_ai

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

	schema "github.com/speechswitch/client/sdks/go/generated/smallest_ai"
	out "github.com/speechswitch/client/sdks/go/generated/smallest_ai_output"
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

func TestNativeWebSocketHeaderAuthAndBothModels(t *testing.T) {
	for _, pro := range []bool{false, true} {
		t.Run(fmt.Sprint(pro), func(t *testing.T) {
			completed := make(chan struct{})
			handshake := make(chan *http.Request, 1)
			messages := make(chan map[string]any, 1)
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
				if err = json.Unmarshal(data, &message); err != nil {
					t.Error(err)
					return
				}
				messages <- message
				for _, packet := range []map[string]any{frame("chunk"), frame("complete")} {
					data, _ := json.Marshal(packet)
					// Fragment a text message, with every network byte flushed independently.
					split := len(data) / 2
					for _, part := range []struct {
						opcode byte
						data   []byte
					}{{1, data[:split]}, {128, data[split:]}} {
						for _, b := range append([]byte{part.opcode, byte(len(part.data))}, part.data...) {
							rw.WriteByte(b)
							rw.Flush()
						}
					}
				}
				// Native completion ends ordinary synthesis without waiting for the
				// server to close the connection. The owned transport is released.
				_, err = rw.ReadByte()
				if err != io.EOF {
					t.Errorf("expected transport EOF after completion, got %v", err)
				}
			}))
			defer server.Close()
			var request schema.TtsRequest
			if pro {
				request = schema.TtsRequestAsLightningV31ProTextVoice74d06326{Value: schema.TtsRequestLightningV31ProTextVoice74d06326{Text: "こんにちは", Voice: "saved-voice", ContentRetentionDays: runtime.Some(schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbContentRetentionDays{})}}
			} else {
				request = schema.TtsRequestAsLightningV31TextVoice5e2ae2e5{Value: schema.TtsRequestLightningV31TextVoice5e2ae2e5{Text: "こんにちは", Voice: "saved-voice", ContentRetentionDays: runtime.Some(schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbContentRetentionDays{})}}
			}
			options := Options{IdleTimeoutSeconds: runtime.Some(int64(120))}
			if pro {
				options.WebSocketURL = strings.Replace(server.URL, "http:", "ws:", 1) + "/proxy%2Fraw/socket?tenant=a%2Bb&timeout=1&timeout=2"
			} else {
				options.Protocol = "websocket"
				options.BaseURL = server.URL + "/proxy%2Fraw?tenant=a%2Bb&timeout=1&timeout=2"
			}
			input := start(t, request, options)
			defer input.Close()
			items, err := collect(deadline(t), input)
			if err != nil {
				t.Fatal(err)
			}
			received := <-handshake
			equal(t, received.Method, "GET")
			path := "/proxy%2Fraw/waves/v1/tts/live"
			model := "lightning_v3.1"
			if pro {
				path = "/proxy%2Fraw/socket"
				model = "lightning_v3.1_pro"
			}
			equal(t, received.URL.EscapedPath(), path)
			equal(t, received.URL.Query(), url.Values{"tenant": {"a+b"}, "timeout": {"120"}})
			equal(t, received.Header.Get("Authorization"), "Bearer fixture")
			equal(t, received.Header.Get("X-Expire-Content"), "true")
			equal(t, received.Header.Get("Sec-WebSocket-Protocol"), "")
			wire := <-messages
			equal(t, wire, map[string]any{"text": "こんにちは", "voice_id": "saved-voice", "model": model, "language": "auto", "sample_rate": float64(44100), "output_format": "pcm", "speed": float64(1), "math_notation": false, "request_id": wire["request_id"]})
			equal(t, items, []out.SynthesisItem{out.SynthesisItemAsBytes{Value: []byte{0, 255, 128}}, out.SynthesisItemAsDone{}})
			await(t, completed)
		})
	}
}
func TestNativeHTTPAndSSEStreamBeforeEOFAndCloseOnConsumerExit(t *testing.T) {
	for _, protocol := range []string{"http", "sse"} {
		t.Run(protocol, func(t *testing.T) {
			closed := make(chan struct{})
			requests := make(chan *http.Request, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests <- r.Clone(context.Background())
				if protocol == "http" {
					w.Header().Set("Content-Type", "audio/L16")
					w.Write([]byte{0, 255, 128})
				} else {
					w.Header().Set("Content-Type", "text/event-stream")
					io.WriteString(w, "data: {\"status\":\"206\",\"done\":false,\"audio\":\"AP+A\"}\n\n")
				}
				w.(http.Flusher).Flush()
				<-r.Context().Done()
				close(closed)
			}))
			defer server.Close()
			input := start(t, request(), Options{Protocol: protocol, BaseURL: server.URL + "/proxy?x=1;2"})
			defer input.Close()
			value, err := input.Next(deadline(t))
			if err != nil {
				t.Fatal(err)
			}
			equal(t, value, out.SynthesisItemAsBytes{Value: []byte{0, 255, 128}})
			r := <-requests
			path, accept := "/proxy/waves/v1/tts?x=1;2", "audio/wav"
			if protocol == "sse" {
				path = "/proxy/waves/v1/tts/live?x=1;2"
				accept = "text/event-stream"
			}
			equal(t, r.URL.RequestURI(), path)
			equal(t, r.Header.Get("Authorization"), "Bearer fixture")
			equal(t, r.Header.Get("Accept"), accept)
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
	source := newProducer("hello")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Error(w, "secret", 401) }))
	defer server.Close()
	input := start(t, liveRequest(source), Options{BaseURL: server.URL})
	defer input.Close()
	_, err := input.Next(deadline(t))
	if err == nil {
		t.Fatal("accepted handshake rejection")
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
	input := start(t, request(), Options{BaseURL: server.URL})
	defer input.Close()
	_, err := input.Next(deadline(t))
	equal(t, err, &Error{Status: runtime.Some(307), Message: "Smallest.ai returned HTTP 307"})
	equal(t, calls.Load(), int32(0))
}
