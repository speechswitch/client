package kugelaudio

import (
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/kugelaudio"
	out "github.com/speechswitch/client/sdks/go/generated/kugelaudio_output"
	"github.com/speechswitch/client/sdks/go/runtime"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync/atomic"
	"testing"
	"time"
)

func clientFrame(reader io.Reader) (map[string]any, error) {
	var header [2]byte
	if _, err := io.ReadFull(reader, header[:]); err != nil {
		return nil, err
	}
	if header[0] != 0x81 || header[1]&128 == 0 {
		return nil, errors.New("expected masked text frame")
	}
	size := int(header[1] & 127)
	if size == 127 {
		return nil, errors.New("unexpected large fixture frame")
	}
	if size == 126 {
		var n [2]byte
		if _, err := io.ReadFull(reader, n[:]); err != nil {
			return nil, err
		}
		size = int(binary.BigEndian.Uint16(n[:]))
	}
	var mask [4]byte
	if _, err := io.ReadFull(reader, mask[:]); err != nil {
		return nil, err
	}
	data := make([]byte, size)
	if _, err := io.ReadFull(reader, data); err != nil {
		return nil, err
	}
	for i := range data {
		data[i] ^= mask[i%4]
	}
	var value map[string]any
	err := json.Unmarshal(data, &value)
	return value, err
}

func TestNativeSocketAuthRoutesAndCancellation(t *testing.T) {
	for _, static := range []bool{false, true} {
		for _, explicit := range []bool{false, true} {
			done := make(chan error, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				done <- func() error {
					path := "/a%2Fb/ws/tts"
					if !static {
						path += "/stream"
					}
					if explicit {
						path = "/custom%2Fendpoint"
					}
					if r.URL.EscapedPath() != path || r.URL.RawQuery != "tenant=one" || r.Header.Get("Authorization") != "Bearer test-key" || r.Header.Get("Sec-WebSocket-Protocol") != "" {
						return errors.New("unexpected endpoint or auth")
					}
					conn, buffer, err := w.(http.Hijacker).Hijack()
					if err != nil {
						return err
					}
					defer conn.Close()
					conn.SetDeadline(time.Now().Add(3 * time.Second))
					hash := sha1.Sum([]byte(r.Header.Get("Sec-WebSocket-Key") + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
					fmt.Fprintf(buffer, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n", base64.StdEncoding.EncodeToString(hash[:]))
					if err := buffer.Flush(); err != nil {
						return err
					}
					config, err := clientFrame(buffer)
					if err != nil {
						return err
					}
					if config["voice_id"] != "existing-custom-voice" || config["word_timestamps"] != false || config["speaker_prefix"] != !static {
						return errors.New("invalid native configuration")
					}
					if static {
						if config["text"] != "Hi" || config["temperature"] != 0.4 {
							return errors.New("invalid static defaults")
						}
					} else {
						if _, present := config["temperature"]; present {
							return errors.New("invented live temperature")
						}
						value, err := clientFrame(buffer)
						if err != nil {
							return err
						}
						if !reflect.DeepEqual(value, map[string]any{"text": "Hi"}) {
							return errors.New("invalid incremental text")
						}
					}
					packets := []string{`{"audio":"AQI=","enc":"pcm_s16le","sr":24000,"samples":1,"idx":0,"chunk_id":0}`}
					if static {
						packets = append(packets, `{"final":true}`)
					}
					for _, packet := range packets {
						buffer.Write([]byte{0x81, byte(len(packet))})
						buffer.WriteString(packet)
					}
					if err := buffer.Flush(); err != nil {
						return err
					}
					_, err = io.Copy(io.Discard, buffer)
					return err
				}()
			}))
			source := newSource([]Input{text("Hi")})
			source.stall = true
			var r schema.TtsRequest = streaming(source)
			if static {
				v := request()
				v.Value.VoiceBoost = runtime.Some(schema.TtsRequestTextVoiceTextNormalization(schema.TtsRequestTextVoiceTextNormalizationAsFalse{}))
				r = v
			}
			options := Options{Auth: auth.Auth{Kugelaudio: runtime.Some(auth.AuthAsync{ApiKey: runtime.Some("eu-test-key")})}, BaseURL: server.URL + "/a%2Fb/?tenant=one"}
			if explicit {
				options.WebSocketURL = server.URL + "/custom%2Fendpoint?tenant=one"
			}
			stream, err := Synthesize(context.Background(), r, options)
			if err != nil {
				server.Close()
				t.Fatal(err)
			}
			first, err := stream.Next(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			equal(t, first, out.SynthesisItemAsBytes{Value: []byte{1, 2}})
			if static {
				next, err := stream.Next(context.Background())
				if err != nil {
					t.Fatal(err)
				}
				equal(t, next, out.SynthesisItemAsDone{})
			} else {
				ctx, cancel := context.WithCancel(context.Background())
				failed := make(chan error, 1)
				go func() { _, err := stream.Next(ctx); failed <- err }()
				wait(t, source.waiting)
				cancel()
				equal(t, <-failed, context.Canceled)
				wait(t, source.closed)
			}
			stream.Close()
			select {
			case err := <-done:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("native socket did not disconnect")
			}
			server.Close()
		}
	}
}

func TestNativeRejectionDoesNotAcquireInput(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(403) }))
	defer server.Close()
	source := newSource([]Input{text("never")})
	_, err := Synthesize(context.Background(), streaming(source), Options{Auth: testAuth, BaseURL: server.URL})
	errorText(t, err, "WebSocket handshake was not accepted")
	equal(t, calls.Load(), int32(1))
	equal(t, source.reads.Load(), int32(0))
	equal(t, source.closes.Load(), int32(0))
}

func TestNativeHTTPStreamsAndDisconnects(t *testing.T) {
	finished := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(finished)
		if r.URL.Path != "/v1/tts/generate" || r.Header.Get("Authorization") != "Bearer test-key" {
			t.Error("unexpected native request")
		}
		io.Copy(io.Discard, r.Body)
		w.Header().Set("X-Audio-Format", "pcm_s16le")
		w.Header().Set("X-Sample-Rate", "24000")
		w.Write([]byte{1, 2})
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stream, err := Synthesize(ctx, request(), Options{Auth: testAuth, BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	first, err := stream.Next(ctx)
	if err != nil {
		t.Fatal(err)
	}
	equal(t, first, out.SynthesisItemAsBytes{Value: []byte{1, 2}})
	cancel()
	wait(t, finished)
}

func TestNativeHTTPDoesNotReplayRedirects(t *testing.T) {
	var calls atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls.Add(1) }))
	defer target.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", target.URL)
		w.WriteHeader(307)
	}))
	defer redirect.Close()
	_, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, BaseURL: redirect.URL})
	var failure *Error
	if !errors.As(err, &failure) {
		t.Fatal(err)
	}
	equal(t, failure.StatusCode, runtime.Some(307))
	equal(t, calls.Load(), int32(0))
}
