package microsoft

import (
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/microsoft"
	out "github.com/speechswitch/client/sdks/go/generated/microsoft_output"
	"github.com/speechswitch/client/sdks/go/runtime"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func clientFrame(reader io.Reader) (sentFrame, error) {
	var header [2]byte
	if _, err := io.ReadFull(reader, header[:]); err != nil {
		return sentFrame{}, err
	}
	if header[0] != 0x81 || header[1]&128 == 0 {
		return sentFrame{}, errors.New("expected masked text frame")
	}
	size := int(header[1] & 127)
	if size == 127 {
		return sentFrame{}, errors.New("unexpected large fixture frame")
	}
	if size == 126 {
		var n [2]byte
		if _, err := io.ReadFull(reader, n[:]); err != nil {
			return sentFrame{}, err
		}
		size = int(binary.BigEndian.Uint16(n[:]))
	}
	var mask [4]byte
	if _, err := io.ReadFull(reader, mask[:]); err != nil {
		return sentFrame{}, err
	}
	data := make([]byte, size)
	if _, err := io.ReadFull(reader, data); err != nil {
		return sentFrame{}, err
	}
	for i := range data {
		data[i] ^= mask[i%4]
	}
	return sent(runtime.WebSocketText(data))
}
func serverFrame(writer io.Writer, message runtime.WebSocketMessage) error {
	var opcode byte
	var data []byte
	switch v := message.(type) {
	case runtime.WebSocketText:
		opcode = 0x81
		data = []byte(v)
	case runtime.WebSocketBinary:
		opcode = 0x82
		data = []byte(v)
	}
	header := []byte{opcode, byte(len(data))}
	if len(data) >= 126 {
		header = []byte{opcode, 126, byte(len(data) >> 8), byte(len(data))}
	}
	_, err := writer.Write(append(header, data...))
	return err
}

func TestNativeSocketAuthenticationRoutesAndEarlyAudio(t *testing.T) {
	for _, live := range []bool{false, true} {
		for _, token := range []bool{false, true} {
			for _, explicit := range []bool{false, true} {
				t.Run(fmt.Sprintf("live=%v/token=%v/explicit=%v", live, token, explicit), func(t *testing.T) {
					completed := make(chan error, 1)
					server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						completed <- func() error {
							path := "/proxy%2Fpath/tts/cognitiveservices/websocket/v1"
							if live {
								path = "/proxy%2Fpath/cognitiveservices/websocket/v2"
							}
							if explicit {
								path = "/custom%2Fendpoint"
							}
							if r.URL.EscapedPath() != path || r.URL.RawQuery != "deploymentId=existing%2F1&tenant=one" || r.Header.Get("Sec-WebSocket-Protocol") != "" || len(r.Header.Get("X-ConnectionId")) != 32 {
								return errors.New("incorrect native endpoint or headers")
							}
							key, bearer := "test-key", ""
							if token {
								key, bearer = "", "Bearer test-token"
							}
							if r.Header.Get("Ocp-Apim-Subscription-Key") != key || r.Header.Get("Authorization") != bearer {
								return errors.New("incorrect native authentication")
							}
							conn, buffer, err := w.(http.Hijacker).Hijack()
							if err != nil {
								return err
							}
							defer conn.Close()
							conn.SetDeadline(time.Now().Add(3 * time.Second))
							hash := sha1.Sum([]byte(r.Header.Get("Sec-WebSocket-Key") + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
							fmt.Fprintf(buffer, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n", base64.StdEncoding.EncodeToString(hash[:]))
							if err = buffer.Flush(); err != nil {
								return err
							}
							for _, path := range []string{"speech.config", "synthesis.context"} {
								f, err := clientFrame(buffer)
								if err != nil {
									return err
								}
								if f.path != path {
									return errors.New("incorrect initialization ordering")
								}
							}
							f, err := clientFrame(buffer)
							if err != nil {
								return err
							}
							expected := "ssml"
							if live {
								expected = "text.piece"
							}
							if f.path != expected || len(f.id) != 32 || f.id == r.Header.Get("X-ConnectionId") {
								return errors.New("incorrect synthesis frame")
							}
							for _, message := range []runtime.WebSocketMessage{textFrame("response", f.id, `{"audio":{"streamId":"stream"}}`), audioFrame(f.id, "stream")} {
								if err = serverFrame(buffer, message); err != nil {
									return err
								}
							}
							if !live {
								if err = serverFrame(buffer, textFrame("turn.end", f.id, "{}")); err != nil {
									return err
								}
							}
							if err = buffer.Flush(); err != nil {
								return err
							}
							_, err = io.Copy(io.Discard, buffer)
							return err
						}()
					}))
					defer server.Close()
					input := newSource("Hi")
					input.stall = true
					var r schema.TtsRequest = request()
					if live {
						r = streaming(input)
					}
					options := Options{Auth: testAuth, BaseURL: server.URL + "/proxy%2Fpath/?tenant=one", DeploymentID: runtime.Some("existing/1")}
					if token {
						options.Auth = auth.Auth{Microsoft: runtime.Some(auth.AuthMicrosoft{AccessToken: runtime.Some("test-token"), ApiKey: runtime.Some("ignored")})}
					}
					if explicit {
						options.WebSocketURL = strings.Replace(server.URL, "http:", "ws:", 1) + "/custom%2Fendpoint?tenant=one"
					} else if !live {
						r = schema.TtsRequestAsTextVoicef6245d6f{Value: schema.TtsRequestTextVoicef6245d6f{Text: "Hi", Voice: "en-US-AvaNeural", TimestampGranularity: schema.TtsRequestStreamingTextVoicee86a65c0TimestampGranularityAsWord{}}}
					}
					stream, err := Synthesize(context.Background(), r, options)
					if err != nil {
						t.Fatal(err)
					}
					defer stream.Close()
					item, err := stream.Next(context.Background())
					if err != nil {
						t.Fatal(err)
					}
					if !live && !explicit {
						timeline, ok := item.(out.SynthesisItemAsTimeline)
						if !ok {
							t.Fatalf("unexpected output: %#v", item)
						}
						equal(t, timeline.Value.Audio, runtime.Some([]byte{0, 255, 128}))
					} else {
						equal(t, item, out.SynthesisItemAsBytes{Value: []byte{0, 255, 128}})
					}
					if live {
						wait(t, input.waiting)
						stream.Close()
						wait(t, input.closed)
					} else {
						done, err := stream.Next(context.Background())
						if err != nil {
							t.Fatal(err)
						}
						if _, ok := done.(out.SynthesisItemAsDone); !ok {
							t.Fatalf("expected done, got %#v", done)
						}
					}
					stream.Close()
					select {
					case err := <-completed:
						if err != nil {
							t.Fatal(err)
						}
					case <-time.After(3 * time.Second):
						t.Fatal("native socket did not disconnect")
					}
				})
			}
		}
	}
}

func TestNativeHandshakeFailureDoesNotAcquireInput(t *testing.T) {
	input := newSource("Hi")
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(401) }))
	defer server.Close()
	_, err := Synthesize(context.Background(), streaming(input), Options{Auth: testAuth, BaseURL: server.URL})
	errorText(t, err, "WebSocket handshake was not accepted")
	equal(t, calls.Load(), int32(1))
	equal(t, input.reads.Load(), int32(0))
	equal(t, input.closes.Load(), int32(0))
}

func TestNativeHTTPStreamsAndDoesNotReplayRedirects(t *testing.T) {
	finished := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(finished)
		w.Header().Set("Content-Type", "audio/pcm")
		w.Write([]byte{1})
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer server.Close()
	stream, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	value, err := stream.Next(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	equal(t, value, out.SynthesisItemAsBytes{Value: []byte{1}})
	stream.Close()
	wait(t, finished)
	var calls atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls.Add(1) }))
	defer target.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", target.URL)
		w.WriteHeader(307)
	}))
	defer redirect.Close()
	_, err = Synthesize(context.Background(), request(), Options{Auth: testAuth, BaseURL: redirect.URL})
	errorText(t, err, "Microsoft synthesis failed (307): ")
	equal(t, calls.Load(), int32(0))
}
