package deepgram

import (
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/deepgram"
	"github.com/speechswitch/client/sdks/go/runtime"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestNativeHTTPStreamsBeforeCompletionAndCancelsIdle(t *testing.T) {
	disconnected := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.EscapedPath() != "/prefix%2Fpath/v1/speak" || r.Header.Get("Authorization") != "Token test-key" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL)
		}
		var wire any
		if err := json.NewDecoder(r.Body).Decode(&wire); err != nil {
			t.Error(err)
		}
		equalJSON(t, wire, map[string]string{"text": "Hello"})
		w.Header().Set("Content-Type", "audio/l16")
		w.Write([]byte{0, 255})
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(disconnected)
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s, err := Synthesize(ctx, request(), Options{Auth: testAuth, BaseURL: server.URL + "/prefix%2Fpath?keep=1"})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	v, err := s.Next(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	equalJSON(t, canonical(v), []int{0, 255})
	cancel()
	wait(t, disconnected)
	if _, err = s.Next(context.Background()); err != context.Canceled {
		t.Fatal(err)
	}
}

func TestNativeRedirectsAndPendingHeaders(t *testing.T) {
	var forwarded atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { forwarded.Add(1) }))
	defer target.Close()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, http.StatusFound) }))
	defer origin.Close()
	_, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, BaseURL: origin.URL})
	if err == nil || err.Error() != "Deepgram returned HTTP 302" || forwarded.Load() != 0 {
		t.Fatal(err, forwarded.Load())
	}
	for _, socket := range []bool{false, true} {
		entered, closed := make(chan struct{}), make(chan struct{})
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			io.Copy(io.Discard, r.Body)
			close(entered)
			<-r.Context().Done()
			close(closed)
		}))
		defer server.Close()
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		result := make(chan error, 1)
		source := newSource(schema.TtsRequestAura1StreamingTextVoiceTextItemAsString{Value: "Hello"})
		go func() {
			var err error
			if socket {
				_, err = Synthesize(ctx, live(source), Options{Auth: testAuth, WebSocketURL: strings.Replace(server.URL, "http", "ws", 1)})
			} else {
				_, err = Synthesize(ctx, request(), Options{Auth: testAuth, BaseURL: server.URL})
			}
			result <- err
		}()
		wait(t, entered)
		cancel()
		wait(t, closed)
		if err := <-result; !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
		if source.pulls.Load() != 0 {
			t.Fatal("input pulled before connection")
		}
		server.Close()
	}
}

func TestNativeWebSocketHeadersAndMaskedFrames(t *testing.T) {
	finished := make(chan error, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		finished <- func() error {
			if r.URL.Path != "/v1/speak" || r.Header.Get("Authorization") != "Token test-key" || !reflect.DeepEqual(map[string][]string(r.URL.Query()), map[string][]string{"keep": {"1"}, "model": {"aura-asteria-en"}, "encoding": {"linear16"}, "sample_rate": {"24000"}}) {
				return fmt.Errorf("unexpected upgrade %s %v", r.URL, r.Header)
			}
			connection, buffer, err := w.(http.Hijacker).Hijack()
			if err != nil {
				return err
			}
			defer connection.Close()
			connection.SetDeadline(time.Now().Add(2 * time.Second))
			hash := sha1.Sum([]byte(r.Header.Get("Sec-WebSocket-Key") + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
			fmt.Fprintf(buffer, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n", base64.StdEncoding.EncodeToString(hash[:]))
			if err := buffer.Flush(); err != nil {
				return err
			}
			for _, expected := range []map[string]string{{"type": "Speak", "text": "Hello"}, {"type": "Flush"}, {"type": "Close"}} {
				var header [2]byte
				if _, err := io.ReadFull(buffer, header[:]); err != nil {
					return err
				}
				if header[0] != 0x81 || header[1]&128 == 0 || header[1]&127 >= 126 {
					return errors.New("invalid client frame")
				}
				var mask [4]byte
				if _, err := io.ReadFull(buffer, mask[:]); err != nil {
					return err
				}
				data := make([]byte, int(header[1]&127))
				if _, err := io.ReadFull(buffer, data); err != nil {
					return err
				}
				for i := range data {
					data[i] ^= mask[i%4]
				}
				var actual map[string]string
				if err := json.Unmarshal(data, &actual); err != nil {
					return err
				}
				if !reflect.DeepEqual(actual, expected) {
					return fmt.Errorf("unexpected message %s", data)
				}
				if expected["type"] == "Speak" {
					buffer.Write([]byte{0x82, 2, 0, 255})
				}
				if expected["type"] == "Flush" {
					data := []byte(`{"type":"Flushed","sequence_id":0}`)
					buffer.Write([]byte{0x81, byte(len(data))})
					buffer.Write(data)
				}
				if err := buffer.Flush(); err != nil {
					return err
				}
			}
			_, err = io.Copy(io.Discard, buffer)
			return err
		}()
	}))
	defer server.Close()
	source := newSource(schema.TtsRequestAura1StreamingTextVoiceTextItemAsString{Value: "Hello"})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	s, err := Synthesize(ctx, live(source), Options{Auth: testAuth, WebSocketURL: strings.Replace(server.URL, "http", "ws", 1) + "/v1/speak?keep=1&api_key=stale&container=bad"})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	equalJSON(t, collect(t, s), []any{[]int{0, 255}, map[string]any{"event": "done", "sequenceId": 0}})
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
}

func TestAuthAndValidationAtBoundary(t *testing.T) {
	for _, name := range []string{"SPEECHSWITCH_DEEPGRAM_API_KEY", "DEEPGRAM_API_KEY"} {
		t.Setenv(name, "")
	}
	t.Setenv("DEEPGRAM_API_KEY", "native")
	if err := os.Unsetenv("SPEECHSWITCH_DEEPGRAM_API_KEY"); err != nil {
		t.Fatal(err)
	}
	native := &transport{status: 200, body: &body{}}
	s, err := Synthesize(context.Background(), request(), Options{Transport: native})
	if err != nil {
		t.Fatal(err)
	}
	s.Close()
	if native.requests[0].Header.Get("Authorization") != "Token native" {
		t.Fatal("native environment key ignored")
	}
	for _, tc := range []struct {
		scoped string
		auth   auth.Auth
		key    string
	}{{"scoped", auth.Auth{}, "scoped"}, {"scoped", testAuth, "test-key"}, {"", auth.Auth{}, ""}, {"scoped", auth.Auth{Deepgram: runtime.Some(auth.AuthAsync{ApiKey: runtime.Some("")})}, ""}} {
		t.Setenv("SPEECHSWITCH_DEEPGRAM_API_KEY", tc.scoped)
		transport := &transport{status: 200, body: &body{}}
		s, err := Synthesize(context.Background(), request(), Options{Auth: tc.auth, Transport: transport})
		if tc.key == "" {
			if err == nil || err.Error() != "Missing auth.deepgram.apiKey configuration" || len(transport.requests) != 0 {
				t.Fatal(err)
			}
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		s.Close()
		if transport.requests[0].Header.Get("Authorization") != "Token "+tc.key {
			t.Fatal("wrong auth")
		}
	}
	for _, speed := range []float64{0.6, 1.6, math.NaN(), math.Inf(1)} {
		r := request().(schema.TtsRequestAsAura1TextVoice)
		r.Value.Speed = runtime.Some(speed)
		_, err := Synthesize(context.Background(), r, Options{Auth: testAuth})
		if err == nil || err.Error() != "Invalid deepgram TTS request" {
			t.Fatal(err)
		}
	}
	for _, endpoint := range []string{"ftp://host", "https://user:key@host", "https://host:bad", "https://host:99999", "https://host/#fragment", "https://host/ space"} {
		_, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, BaseURL: endpoint})
		if err == nil || err.Error() != "Invalid Deepgram endpoint URL" {
			t.Fatal(endpoint, err)
		}
	}
	_, err = Synthesize(context.Background(), request(), Options{Auth: testAuth, MaxMessageBytes: -1})
	if err == nil || err.Error() != "Deepgram MaxMessageBytes must be positive" {
		t.Fatal(err)
	}
	var nilRequest *schema.TtsRequestAsAura1TextVoice
	_, err = Synthesize(context.Background(), nilRequest, Options{Auth: testAuth})
	if err == nil || err.Error() != "Invalid deepgram TTS request" {
		t.Fatal(err)
	}
}
