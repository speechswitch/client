package inworld

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
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	out "github.com/speechswitch/client/sdks/go/generated/inworld_output"
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

func TestNativeSocketHeaderAuthPipeliningAndCancellation(t *testing.T) {
	for _, token := range []bool{false, true} {
		for _, explicit := range []bool{false, true} {
			t.Run(fmt.Sprintf("token=%t/explicit=%t", token, explicit), func(t *testing.T) {
				finished := make(chan error, 1)
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					finished <- func() error {
						path := "/a%2Fb/tts/v1/voice:streamBidirectional"
						if explicit {
							path = "/custom%2Fendpoint"
						}
						authorization := "Basic test-key"
						if token {
							authorization = "Bearer once"
						}
						if r.URL.EscapedPath() != path || r.URL.RawQuery != "tenant=one" || r.Header.Get("Authorization") != authorization || r.Header.Get("Sec-WebSocket-Protocol") != "" {
							return errors.New("unexpected endpoint or authentication")
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
						create, err := clientFrame(buffer)
						if err != nil {
							return err
						}
						if create["contextId"] != "ctx" || create["create"] == nil {
							return fmt.Errorf("create: %#v", create)
						}
						message, err := clientFrame(buffer)
						if err != nil {
							return err
						}
						if !reflect.DeepEqual(message, map[string]any{"contextId": "ctx", "send_text": map[string]any{"text": "Hello"}}) {
							return fmt.Errorf("text: %#v", message)
						}
						// Send the acknowledgement only after text, exercising native pipelining.
						for _, raw := range []string{`{"result":{"contextId":"ctx","contextCreated":{}}}`, `{"result":{"contextId":"ctx","audioChunk":{"audioContent":"AP8="}}}`} {
							buffer.Write([]byte{0x81, byte(len(raw))})
							buffer.WriteString(raw)
						}
						if err := buffer.Flush(); err != nil {
							return err
						}
						_, err = io.Copy(io.Discard, buffer)
						return err
					}()
				}))
				defer server.Close()
				source := newSource([]Input{text("Hello")})
				source.stall = true
				options := Options{Auth: testAuth, BaseURL: server.URL + "/a%2Fb/?tenant=one", ContextID: runtime.Some("ctx")}
				if token {
					options.Auth = auth.Auth{Inworld: runtime.Some(auth.AuthCartesia{ApiKey: runtime.Some("ignored"), AccessToken: runtime.Some("once")})}
				}
				if explicit {
					options.WebSocketURL = server.URL + "/custom%2Fendpoint?tenant=one"
				}
				stream, err := Synthesize(context.Background(), streaming(source), options)
				if err != nil {
					t.Fatal(err)
				}
				defer stream.Close()
				item, err := stream.Next(context.Background())
				if err != nil {
					t.Fatal(err)
				}
				equal(t, item, out.SynthesisItemAsBytes{Value: []byte{0, 255}})
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				result := make(chan error, 1)
				go func() { _, err := stream.Next(ctx); result <- err }()
				wait(t, source.waiting)
				cancel()
				equal(t, <-result, context.Canceled)
				wait(t, source.closed)
				select {
				case err := <-finished:
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

func TestNativeHandshakeRejectionDoesNotAcquireOrReplayInput(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(403) }))
	defer server.Close()
	source := newSource([]Input{text("never")})
	_, err := Synthesize(context.Background(), streaming(source), Options{Auth: auth.Auth{Inworld: runtime.Some(auth.AuthCartesia{AccessToken: runtime.Some("once")})}, BaseURL: server.URL})
	errorText(t, err, "WebSocket handshake was not accepted")
	equal(t, source.reads.Load(), int32(0))
	equal(t, source.closes.Load(), int32(0))
	equal(t, calls.Load(), int32(1))
}

func TestNativeHTTPEarlyAudioAndCancellation(t *testing.T) {
	disconnected := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(disconnected)
		if r.URL.Path != "/tts/v1/voice:stream" || r.Header.Get("Authorization") != "Basic test-key" {
			t.Error("unexpected native request")
		}
		w.Write([]byte("{\"result\":{\"audioContent\":\"AP8=\"}}\n"))
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
	item, err := stream.Next(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	equal(t, item, out.SynthesisItemAsBytes{Value: []byte{0, 255}})
	cancel()
	wait(t, disconnected)
}

func TestNativeHTTPRejectsRedirectsInsteadOfReplayingTokens(t *testing.T) {
	var replayed atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { replayed.Add(1) }))
	defer target.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", target.URL)
		w.WriteHeader(307)
		w.Write([]byte("redirect refused"))
	}))
	defer redirect.Close()
	for _, mode := range []string{"stream", "single"} {
		_, err := Synthesize(context.Background(), request(), Options{Auth: auth.Auth{Inworld: runtime.Some(auth.AuthCartesia{AccessToken: runtime.Some("once")})}, BaseURL: redirect.URL, HTTPMode: runtime.Some(mode)})
		equal(t, err, &Error{Message: "redirect refused", StatusCode: runtime.Some(307)})
	}
	equal(t, replayed.Load(), int32(0))
}

func TestNativeCancellationBeforeHeadersAndIdleDeadline(t *testing.T) {
	for _, headers := range []bool{false, true} {
		entered, disconnected := make(chan struct{}), make(chan struct{})
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer close(disconnected)
			io.Copy(io.Discard, r.Body)
			if headers {
				w.WriteHeader(200)
				w.(http.Flusher).Flush()
			}
			close(entered)
			<-r.Context().Done()
		}))
		ctx, cancel := context.WithCancel(context.Background())
		result := make(chan error, 1)
		go func() {
			stream, err := Synthesize(ctx, request(), Options{Auth: testAuth, BaseURL: server.URL})
			if err == nil {
				defer stream.Close()
				<-ctx.Done()
				_, err = stream.Next(context.Background())
			}
			result <- err
		}()
		wait(t, entered)
		cancel()
		err := <-result
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancellation: %v", err)
		}
		wait(t, disconnected)
		server.Close()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	ws := newSocket()
	source := newSource([]Input{text("unread")})
	stream, err := Synthesize(ctx, streaming(source), Options{WebSocket: ws, ContextID: runtime.Some("ctx")})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	wait(t, ws.closed)
	wait(t, source.closed)
	equal(t, source.reads.Load(), int32(0))
}

func TestEnvironmentAndURLSafety(t *testing.T) {
	t.Setenv("INWORLD_API_KEY", "native")
	t.Setenv("SPEECHSWITCH_INWORLD_API_KEY", "scoped")
	for _, c := range []struct {
		auth            auth.Auth
		header, message string
	}{
		{auth.Auth{}, "Basic scoped", ""}, {testAuth, "Basic test-key", ""},
		{auth.Auth{Inworld: runtime.Some(auth.AuthCartesia{ApiKey: runtime.Some("")})}, "", "Missing auth.inworld.apiKey configuration"},
		{auth.Auth{Inworld: runtime.Some(auth.AuthCartesia{AccessToken: runtime.Some("once")})}, "Bearer once", ""},
	} {
		stream, err := Synthesize(context.Background(), request(), Options{Auth: c.auth, Transport: transport(func(r *http.Request) (*http.Response, error) {
			equal(t, r.Header.Get("Authorization"), c.header)
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(""))}, nil
		})})
		if c.message != "" {
			errorText(t, err, c.message)
		} else {
			if err != nil {
				t.Fatal(err)
			}
			stream.Close()
		}
	}
	for _, endpoint := range []string{"https://user:secret@host", "https://host:99999", "https://host/%xx", "https://host/?q=%xx", "https://host/#fragment", "https://host/space here"} {
		_, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, BaseURL: endpoint})
		errorText(t, err, "Invalid Inworld endpoint URL")
	}
}
