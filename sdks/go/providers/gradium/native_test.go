package gradium

import (
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/gradium"
	out "github.com/speechswitch/client/sdks/go/generated/gradium_output"
	"github.com/speechswitch/client/sdks/go/runtime"
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

func TestNativeSocketAuthAndEarlyAudio(t *testing.T) {
	for _, token := range []bool{false, true} {
		for _, explicit := range []bool{false, true} {
			t.Run(fmt.Sprintf("token=%t/explicit=%t", token, explicit), func(t *testing.T) {
				finished := make(chan error, 1)
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					finished <- func() error {
						path := "/a%2Fb/api/speech/tts"
						if explicit {
							path = "/custom%2Fendpoint"
						}
						if r.URL.EscapedPath() != path || r.URL.Query().Get("tenant") != "one" {
							return fmt.Errorf("unexpected URL %s", r.URL)
						}
						if token {
							if r.Header.Get("X-Api-Key") != "" || r.URL.Query().Get("token") != "a +/?&" {
								return errors.New("unexpected token auth")
							}
						} else if r.Header.Get("X-Api-Key") != "test-key" || r.URL.Query().Has("token") {
							return errors.New("unexpected header auth")
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
						setup, err := clientFrame(buffer)
						if err != nil {
							return err
						}
						expected := map[string]any{"type": "setup", "model_name": "default", "voice_id": "existing-custom", "output_format": "pcm_48000", "json_config": map[string]any{"temp": 0.7, "cfg_coef": float64(2), "padding_bonus": float64(0)}, "close_ws_on_eos": true, "retry_for_s": float64(0)}
						if !reflect.DeepEqual(setup, expected) {
							return fmt.Errorf("setup: %#v", setup)
						}
						text, err := clientFrame(buffer)
						if err != nil {
							return err
						}
						if !reflect.DeepEqual(text, map[string]any{"type": "text", "text": "Hello"}) {
							return fmt.Errorf("text: %#v", text)
						}
						for _, packet := range []string{`{"type":"ready","request_id":"req"}`, `{"type":"audio","audio":"AP8="}`} {
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
				defer server.Close()
				src := newSource(text("Hello "))
				src.stall = true
				r := request()
				r.Text = schema.TtsRequestTextAsAsyncIterable{Value: src}
				options := Options{Auth: testAuth, BaseURL: server.URL + "/a%2Fb/api/?tenant=one"}
				if token {
					options.Auth = auth.Auth{Gradium: runtime.Some(auth.AuthElevenlabs{SingleUseToken: runtime.Some("a +/?&")})}
				}
				if explicit {
					options.WebSocketURL = server.URL + "/custom%2Fendpoint?tenant=one"
					if token {
						options.WebSocketURL += "&token=stale&token=duplicate"
					}
				}
				ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
				defer cancel()
				stream, err := Synthesize(ctx, r, options)
				if err != nil {
					t.Fatal(err)
				}
				item, err := stream.Next(ctx)
				if err != nil {
					t.Fatal(err)
				}
				equal(t, item, out.SynthesisItemAsBytes{Value: []byte{0, 255}})
				stream.Close()
				wait(t, src.closed)
				select {
				case err := <-finished:
					if err != nil {
						t.Fatal(err)
					}
				case <-ctx.Done():
					t.Fatal(ctx.Err())
				}
			})
		}
	}
}

func TestNativeSocketRejectsAuthBeforeInput(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		equal(t, r.Header.Get("X-Api-Key"), "test-key")
		w.WriteHeader(403)
	}))
	defer server.Close()
	src := newSource(text("Hello"))
	r := request()
	r.Text = schema.TtsRequestTextAsAsyncIterable{Value: src}
	_, err := Synthesize(context.Background(), r, Options{Auth: testAuth, BaseURL: server.URL + "/api"})
	errorText(t, err, "WebSocket handshake was not accepted")
	equal(t, src.reads.Load(), int32(0))
	equal(t, src.closes.Load(), int32(0))
}

func TestNativeHTTPEarlyAudioAndRedirectIsolation(t *testing.T) {
	t.Setenv("SPEECHSWITCH_GRADIUM_API_KEY", "test-key")
	closed := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		equal(t, r.URL.EscapedPath(), "/proxy%2Fpath/api/post/speech/tts")
		equal(t, r.URL.RawQuery, "tenant=one")
		equal(t, r.Header.Get("X-Api-Key"), "test-key")
		w.Header().Set("Content-Type", "audio/pcm")
		w.Write([]byte{0, 255})
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(closed)
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	stream, err := Synthesize(ctx, request(), Options{BaseURL: server.URL + "/proxy%2Fpath/api/?tenant=one"})
	if err != nil {
		t.Fatal(err)
	}
	item, err := stream.Next(ctx)
	if err != nil {
		t.Fatal(err)
	}
	equal(t, item, out.SynthesisItemAsBytes{Value: []byte{0, 255}})
	stream.Close()
	wait(t, closed)
	var replays atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { replays.Add(1); w.WriteHeader(200) }))
	defer target.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", target.URL)
		w.WriteHeader(307)
	}))
	defer redirect.Close()
	_, err = Synthesize(ctx, request(), Options{BaseURL: redirect.URL})
	equal(t, err, &Error{StatusCode: runtime.Some(307)})
	equal(t, replays.Load(), int32(0))
}

func TestCredentialsURLsAndExplicitSocketSelection(t *testing.T) {
	t.Setenv("GRADIUM_API_KEY", "fallback")
	t.Setenv("SPEECHSWITCH_GRADIUM_API_KEY", "scoped")
	for _, c := range []struct {
		auth auth.Auth
		key  string
	}{{testAuth, "test-key"}, {auth.Auth{}, "scoped"}} {
		b := &body{Reader: strings.NewReader("")}
		stream, err := Synthesize(context.Background(), request(), Options{Auth: c.auth, Transport: transport(func(r *http.Request) (*http.Response, error) {
			equal(t, r.Header.Get("X-Api-Key"), c.key)
			return &http.Response{StatusCode: 200, Body: b}, nil
		})})
		if err != nil {
			t.Fatal(err)
		}
		stream.Close()
	}
	_, err := Synthesize(context.Background(), request(), Options{Auth: auth.Auth{Gradium: runtime.Some(auth.AuthElevenlabs{ApiKey: runtime.Some("")})}})
	errorText(t, err, "Missing auth.gradium.apiKey configuration")
	_, err = Synthesize(context.Background(), request(), Options{Auth: auth.Auth{Gradium: runtime.Some(auth.AuthElevenlabs{ApiKey: runtime.Some("bad\nkey")})}})
	errorText(t, err, "Invalid Gradium authentication header")
	if err := os.Unsetenv("SPEECHSWITCH_GRADIUM_API_KEY"); err != nil {
		t.Fatal(err)
	}
	b := &body{Reader: strings.NewReader("")}
	stream, err := Synthesize(context.Background(), request(), Options{Transport: transport(func(r *http.Request) (*http.Response, error) {
		equal(t, r.Header.Get("X-Api-Key"), "fallback")
		return &http.Response{StatusCode: 200, Body: b}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	stream.Close()
	t.Setenv("SPEECHSWITCH_GRADIUM_API_KEY", "")
	_, err = Synthesize(context.Background(), request(), Options{})
	errorText(t, err, "Missing auth.gradium.apiKey configuration")
	ignored := testAuth
	ignored.Gradium.Value.SingleUseToken = runtime.Optional[string]{Value: "ignored"}
	stream, err = Synthesize(context.Background(), request(), Options{Auth: ignored, Transport: responseTransport(&body{Reader: strings.NewReader("")}, 200)})
	if err != nil {
		t.Fatal(err)
	}
	stream.Close()
	for _, url := range []string{"https://user:secret@host", "https://host/#fragment", "https://host:99999", "https://host/%xx", "https://host/?q=%xx", "ftp://host", "https://host/space here"} {
		_, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, BaseURL: url})
		errorText(t, err, "Invalid Gradium endpoint URL")
	}
	for _, r := range []schema.TtsRequest{request(), func() schema.TtsRequest { r := request(); r.Lexicon = runtime.Some("dictionary"); return r }()} {
		socket := newSocket()
		stream, err := Synthesize(context.Background(), r, Options{WebSocket: socket, SetupRetryMs: runtime.Some(int64(0))})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := collect(stream); err != nil {
			t.Fatal(err)
		}
		equal(t, socket.messages()[0]["retry_for_s"], float64(0))
	}
}
