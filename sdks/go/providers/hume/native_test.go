package hume

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
	"net/url"
	"os"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	out "github.com/speechswitch/client/sdks/go/generated/hume_output"
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

func TestNativeSocketQueryAuthAndEarlyAudio(t *testing.T) {
	for _, token := range []bool{false, true} {
		for _, explicit := range []bool{false, true} {
			t.Run(fmt.Sprintf("token=%t/explicit=%t", token, explicit), func(t *testing.T) {
				finished := make(chan error, 1)
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					finished <- func() error {
						path := "/a%2Fb/v0/tts/stream/input"
						if explicit {
							path = "/custom%2Fendpoint"
						}
						if r.URL.EscapedPath() != path {
							return fmt.Errorf("path: %s", r.URL.EscapedPath())
						}
						query := url.Values{"tenant": {"one"}, "version": {"2"}, "format_type": {"pcm"}, "instant_mode": {"true"}, "no_binary": {"false"}, "strip_headers": {"true"}}
						if token {
							query.Set("access_token", "a +/?&世界")
						} else {
							query.Set("api_key", "test-key")
						}
						if !reflect.DeepEqual(r.URL.Query(), query) || r.Header.Get("Authorization") != "" || r.Header.Get("X-Hume-Api-Key") != "" {
							return errors.New("unexpected authentication or query settings")
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
						message, err := clientFrame(buffer)
						if err != nil {
							return err
						}
						expected := map[string]any{"text": "Hello", "speed": float64(1), "trailing_silence": float64(0), "voice": map[string]any{"id": "saved", "provider": "CUSTOM_VOICE"}}
						if !reflect.DeepEqual(message, expected) {
							return fmt.Errorf("utterance: %#v", message)
						}
						buffer.Write([]byte{0x82, 2, 0, 255})
						if err = buffer.Flush(); err != nil {
							return err
						}
						_, err = io.Copy(io.Discard, buffer)
						return err
					}()
				}))
				defer server.Close()
				src := newSource([]TextInput{text("Hello")})
				src.stall = true
				stale := "?tenant=one&api_key=stale&%61pi_key=duplicate&access_token=stale&version=1&no_binary=true&temperature=0.5&include_timestamp_types=word&context_generation_id=old"
				options := Options{Auth: testAuth, BaseURL: server.URL + "/a%2Fb/" + stale}
				if token {
					options.Auth = auth.Auth{Hume: runtime.Some(auth.AuthCartesia{ApiKey: runtime.Some("ignored"), AccessToken: runtime.Some("a +/?&世界")})}
				}
				if explicit {
					options.WebSocketURL = server.URL + "/custom%2Fendpoint" + stale
				}
				stream, err := Synthesize(context.Background(), streaming(src), options)
				if err != nil {
					t.Fatal(err)
				}
				defer stream.Close()
				item, err := stream.Next(context.Background())
				if err != nil {
					t.Fatal(err)
				}
				equal(t, item, out.SynthesisItemAsBytes{Value: []byte{0, 255}})
				pullDone := make(chan struct{})
				var pullError error
				go func() { defer close(pullDone); _, pullError = stream.Next(context.Background()) }()
				wait(t, src.waiting)
				if err = stream.Close(); err != nil {
					t.Fatal(err)
				}
				wait(t, src.closed)
				wait(t, pullDone)
				equal(t, pullError, io.EOF)
				select {
				case err = <-finished:
					if err != nil {
						t.Fatal(err)
					}
				case <-time.After(4 * time.Second):
					t.Fatal("native socket did not close")
				}
			})
		}
	}
}

func TestNativeHandshakeFailureDoesNotAcquireInput(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(401) }))
	defer server.Close()
	src := newSource([]TextInput{text("Hello")})
	_, err := Synthesize(context.Background(), streaming(src), Options{Auth: testAuth, BaseURL: server.URL})
	errorText(t, err, "WebSocket handshake was not accepted")
	equal(t, src.reads.Load(), int32(0))
	equal(t, src.closes.Load(), int32(0))
}

func TestNativeHTTPAuthenticationAndRedirectIsolation(t *testing.T) {
	for _, token := range []bool{false, true} {
		seen := make(chan http.Header, 1)
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { seen <- r.Header.Clone(); w.Write([]byte{3}) }))
		options := Options{Auth: testAuth, BaseURL: server.URL}
		if token {
			options.Auth = auth.Auth{Hume: runtime.Some(auth.AuthCartesia{AccessToken: runtime.Some("test-token"), ApiKey: runtime.Some("ignored")})}
		}
		stream, err := Synthesize(context.Background(), request(), options)
		if err != nil {
			server.Close()
			t.Fatal(err)
		}
		items, err := collect(stream)
		server.Close()
		if err != nil {
			t.Fatal(err)
		}
		equal(t, items, []out.SynthesisItem{out.SynthesisItemAsBytes{Value: []byte{3}}})
		headers := <-seen
		if token {
			equal(t, headers.Get("Authorization"), "Bearer test-token")
			equal(t, headers.Get("X-Hume-Api-Key"), "")
		} else {
			equal(t, headers.Get("Authorization"), "")
			equal(t, headers.Get("X-Hume-Api-Key"), "test-key")
		}
	}
	var replayed atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { replayed.Add(1) }))
	defer target.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", target.URL)
		w.WriteHeader(307)
		w.Write([]byte("redirect refused"))
	}))
	defer redirect.Close()
	_, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, BaseURL: redirect.URL})
	equal(t, err, &Error{Message: "redirect refused", StatusCode: runtime.Some(307)})
	equal(t, replayed.Load(), int32(0))
}

func TestEnvironmentPrecedenceAndAbsentPayloads(t *testing.T) {
	t.Setenv("HUME_API_KEY", "native-key")
	t.Setenv("SPEECHSWITCH_HUME_API_KEY", "scoped-key")
	for _, tc := range []struct {
		a                   auth.Auth
		key, token, message string
	}{
		{auth.Auth{}, "scoped-key", "", ""},
		{auth.Auth{Hume: runtime.Optional[auth.AuthCartesia]{Value: auth.AuthCartesia{ApiKey: runtime.Some("hidden"), AccessToken: runtime.Some("hidden-token")}}}, "scoped-key", "", ""},
		{testAuth, "test-key", "", ""},
		{auth.Auth{Hume: runtime.Some(auth.AuthCartesia{ApiKey: runtime.Some("")})}, "", "", "Missing auth.hume.apiKey configuration"},
		{auth.Auth{Hume: runtime.Some(auth.AuthCartesia{AccessToken: runtime.Some("token")})}, "", "Bearer token", ""},
		{auth.Auth{Hume: runtime.Some(auth.AuthCartesia{AccessToken: runtime.Some("")})}, "scoped-key", "", ""},
	} {
		called := false
		stream, err := Synthesize(context.Background(), request(), Options{Auth: tc.a, Transport: transport(func(r *http.Request) (*http.Response, error) {
			called = true
			equal(t, r.Header.Get("X-Hume-Api-Key"), tc.key)
			equal(t, r.Header.Get("Authorization"), tc.token)
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(""))}, nil
		})})
		if tc.message != "" {
			errorText(t, err, tc.message)
			equal(t, called, false)
		} else {
			if err != nil {
				t.Fatal(err)
			}
			stream.Close()
			equal(t, called, true)
		}
	}
	if err := os.Unsetenv("SPEECHSWITCH_HUME_API_KEY"); err != nil {
		t.Fatal(err)
	}
	stream, err := Synthesize(context.Background(), request(), Options{Transport: transport(func(r *http.Request) (*http.Response, error) {
		equal(t, r.Header.Get("X-Hume-Api-Key"), "native-key")
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(""))}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	stream.Close()
}

func TestInvalidURLsAndAuthentication(t *testing.T) {
	for _, endpoint := range []string{"https://user:secret@example.test", "https://example.test/#fragment", "https://example.test:70000", "file:///tmp/key", "https://example.test/?q=%XX", "https://example.test/a b", "https://example.test\\path"} {
		_, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, BaseURL: endpoint})
		errorText(t, err, "Invalid Hume endpoint URL")
	}
	for _, tc := range []struct{ key, message string }{
		{"a\r\nb", "Invalid Hume authentication header"},
		{"世界", "Invalid Hume authentication header"},
		{"\xff", "Invalid Hume authentication credential"},
	} {
		_, err := Synthesize(context.Background(), request(), Options{Auth: auth.Auth{Hume: runtime.Some(auth.AuthCartesia{ApiKey: runtime.Some(tc.key)})}})
		errorText(t, err, tc.message)
	}
}
