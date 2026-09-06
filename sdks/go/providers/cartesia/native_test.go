package cartesia

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
	schema "github.com/speechswitch/client/sdks/go/generated/cartesia"
	out "github.com/speechswitch/client/sdks/go/generated/cartesia_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func TestNativeWebSocketAuthAndTokenExchange(t *testing.T) {
	for _, exchange := range []bool{true, false} {
		t.Run(fmt.Sprint(exchange), func(t *testing.T) {
			finished := make(chan error, 1)
			var exchanges atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/prefix/access-token" {
					exchanges.Add(1)
					if r.Method != "POST" || r.Header.Get("Authorization") != "Bearer key" || r.Header.Get("Cartesia-Version") != version || r.URL.RawQuery != "tenant=1" {
						t.Errorf("token request = %s %s %v", r.Method, r.URL, r.Header)
					}
					var payload any
					if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
						t.Error(err)
					}
					checkJSON(t, payload, map[string]any{"grants": map[string]any{"tts": true}, "expires_in": 60})
					io.WriteString(w, `{"token":"short + token"}`)
					return
				}
				failure := func() error {
					expected := map[string][]string{"keep": {"1"}, "cartesia_version": {version}, "access_token": {"short + token"}}
					if r.URL.Path != "/live" || !reflect.DeepEqual(map[string][]string(r.URL.Query()), expected) || r.Header.Get("Authorization") != "" {
						return fmt.Errorf("unexpected handshake path/auth")
					}
					connection, buffered, err := w.(http.Hijacker).Hijack()
					if err != nil {
						return err
					}
					defer connection.Close()
					connection.SetDeadline(time.Now().Add(2 * time.Second))
					hash := sha1.Sum([]byte(r.Header.Get("Sec-WebSocket-Key") + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
					fmt.Fprintf(buffered, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n", base64.StdEncoding.EncodeToString(hash[:]))
					if err := buffered.Flush(); err != nil {
						return err
					}
					read := func() (map[string]any, error) {
						header := make([]byte, 2)
						if _, err := io.ReadFull(buffered, header); err != nil {
							return nil, err
						}
						if header[0] != 0x81 || header[1]&128 == 0 {
							return nil, errors.New("unmasked/non-text client frame")
						}
						size := int(header[1] & 127)
						if size == 127 {
							return nil, errors.New("unexpected large client frame")
						}
						if size == 126 {
							if _, err := io.ReadFull(buffered, header); err != nil {
								return nil, err
							}
							size = int(binary.BigEndian.Uint16(header))
						}
						if size > 4096 {
							return nil, errors.New("oversized fixture frame")
						}
						mask := make([]byte, 4)
						if _, err := io.ReadFull(buffered, mask); err != nil {
							return nil, err
						}
						data := make([]byte, size)
						if _, err := io.ReadFull(buffered, data); err != nil {
							return nil, err
						}
						for i := range data {
							data[i] ^= mask[i%4]
						}
						var value map[string]any
						err := json.Unmarshal(data, &value)
						return value, err
					}
					first, err := read()
					if err != nil {
						return err
					}
					last, err := read()
					if err != nil {
						return err
					}
					if first["transcript"] != "Hello " || first["continue"] != true || last["transcript"] != "" || last["continue"] != false || first["context_id"] != last["context_id"] {
						return fmt.Errorf("generation messages = %#v %#v", first, last)
					}
					data, err := json.Marshal(map[string]any{"type": "done", "done": true, "status_code": 200, "context_id": last["context_id"]})
					if err != nil {
						return err
					}
					if len(data) >= 126 {
						return errors.New("fixture response too large")
					}
					if _, err := buffered.Write(append([]byte{0x81, byte(len(data))}, data...)); err != nil {
						return err
					}
					return buffered.Flush()
				}()
				finished <- failure
			}))
			defer server.Close()
			credentials := testAuth
			if !exchange {
				credentials = auth.Auth{Cartesia: runtime.Some(auth.AuthCartesia{AccessToken: runtime.Some("short + token")})}
			}
			input := newSource(text("Hello "), inputResult{err: io.EOF})
			stream, err := Synthesize(testContext(t), schema.TtsRequestAsStreamingTextVoice0bf53a99{Value: live(input)}, Options{Auth: credentials, BaseURL: server.URL + "/prefix/?tenant=1", WebSocketURL: "ws" + strings.TrimPrefix(server.URL, "http") + "/live?keep=1&api_key=stale&%61pi_key=other&access_token=old&cartesia_version=old"})
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Close()
			items, err := collect(testContext(t), stream)
			if err != nil {
				t.Fatal(err)
			}
			checkJSON(t, items, []any{})
			if err := <-finished; err != nil {
				t.Fatal(err)
			}
			expected := int32(0)
			if exchange {
				expected = 1
			}
			if exchanges.Load() != expected || input.closes.Load() != 1 {
				t.Fatal("token/input ownership mismatch")
			}
		})
	}
}

func TestAuthEnvironmentAndInvalidTokens(t *testing.T) {
	for _, name := range []string{"CARTESIA_API_KEY", "SPEECHSWITCH_CARTESIA_API_KEY", "CARTESIA_ACCESS_TOKEN", "SPEECHSWITCH_CARTESIA_ACCESS_TOKEN"} {
		previous, present := os.LookupEnv(name)
		os.Unsetenv(name)
		t.Cleanup(func() {
			if present {
				os.Setenv(name, previous)
			} else {
				os.Unsetenv(name)
			}
		})
	}
	for _, test := range []struct {
		env  map[string]string
		auth auth.Auth
		want string
	}{
		{map[string]string{"CARTESIA_API_KEY": "native"}, auth.Auth{}, "native"},
		{map[string]string{"CARTESIA_API_KEY": "native", "SPEECHSWITCH_CARTESIA_API_KEY": "scoped"}, auth.Auth{}, "scoped"},
		{map[string]string{"SPEECHSWITCH_CARTESIA_API_KEY": "env"}, testAuth, "key"},
		{map[string]string{"CARTESIA_ACCESS_TOKEN": "native"}, auth.Auth{}, "native"},
		{map[string]string{"CARTESIA_ACCESS_TOKEN": "native", "SPEECHSWITCH_CARTESIA_ACCESS_TOKEN": "scoped"}, auth.Auth{}, "scoped"},
		{map[string]string{"CARTESIA_API_KEY": "native"}, auth.Auth{Cartesia: runtime.Some(auth.AuthCartesia{ApiKey: runtime.Some("")})}, ""},
		{map[string]string{"CARTESIA_API_KEY": "native", "SPEECHSWITCH_CARTESIA_API_KEY": ""}, auth.Auth{}, ""},
	} {
		t.Run(test.want, func(t *testing.T) {
			for name, value := range test.env {
				t.Setenv(name, value)
			}
			response := &body{chunks: [][]byte{{1}}}
			transport := &transport{status: 200, body: response}
			stream, err := Synthesize(context.Background(), schema.TtsRequestAsTextVoicef0bb1766{Value: static()}, Options{Auth: test.auth, Transport: transport})
			if test.want == "" {
				if err == nil || err.Error() != "Missing auth.cartesia.apiKey or auth.cartesia.accessToken configuration" || len(transport.requests) != 0 {
					t.Fatalf("auth failure = %v", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			stream.Close()
			if transport.requests[0].Header.Get("Authorization") != "Bearer "+test.want {
				t.Fatal("wrong auth precedence")
			}
		})
	}
	for _, value := range []string{`{}`, `[]`, `{"token":""}`, `{"token":null}`, `{"token":1}`} {
		input := newSource(text("unread"))
		response := &body{chunks: [][]byte{[]byte(value)}}
		_, err := Synthesize(context.Background(), schema.TtsRequestAsStreamingTextVoice0bf53a99{Value: live(input)}, Options{Auth: testAuth, Transport: &transport{status: 200, body: response}})
		if err == nil || err.Error() != "Cartesia returned an invalid access token" {
			t.Fatalf("token error = %v", err)
		}
		if response.closes.Load() != 1 || input.reads.Load() != 0 || input.closes.Load() != 0 {
			t.Fatal("token failure took input ownership")
		}
	}
}

func TestNativeHTTPDeadlineAndCancellationBetweenPulls(t *testing.T) {
	for _, token := range []bool{false, true} {
		arrived, disconnected := make(chan struct{}), make(chan struct{})
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			io.Copy(io.Discard, r.Body)
			close(arrived)
			if !token {
				w.Write([]byte{1})
				w.(http.Flusher).Flush()
			}
			<-r.Context().Done()
			close(disconnected)
		}))
		t.Cleanup(server.Close)
		t.Cleanup(server.CloseClientConnections)
		ctx, cancel := context.WithCancel(testContext(t))
		input := newSource(text("unread"))
		if token {
			finished := make(chan error, 1)
			go func() {
				_, err := Synthesize(ctx, schema.TtsRequestAsStreamingTextVoice0bf53a99{Value: live(input)}, Options{Auth: testAuth, BaseURL: server.URL})
				finished <- err
			}()
			<-arrived
			cancel()
			if err := <-finished; !errors.Is(err, context.Canceled) {
				t.Fatalf("token cancellation = %v", err)
			}
			if input.reads.Load() != 0 || input.closes.Load() != 0 {
				t.Fatal("canceled exchange took input")
			}
		} else {
			stream, err := Synthesize(ctx, schema.TtsRequestAsTextVoicef0bb1766{Value: static()}, Options{Auth: testAuth, BaseURL: server.URL})
			if err != nil {
				t.Fatal(err)
			}
			item, err := stream.Next(ctx)
			if err != nil {
				t.Fatal(err)
			}
			checkJSON(t, canonical(item), []int{1})
			cancel() // No second Next is needed to close the native response.
			select {
			case <-disconnected:
			case <-time.After(time.Second):
				t.Fatal("idle consumer retained response")
			}
			_, err = stream.Next(context.Background())
			if err != context.Canceled {
				t.Fatalf("between-pull cancellation = %v", err)
			}
			stream.Close()
		}
		cancel()
		server.Close()
	}
}

func TestReadyOutputCannotStarveClearOrWriteFailure(t *testing.T) {
	for _, failed := range []bool{false, true} {
		input, sock := newSource(), newSocket()
		stream, err := Synthesize(testContext(t), schema.TtsRequestAsStreamingTextVoice0bf53a99{Value: live(input)}, Options{WebSocket: sock})
		if err != nil {
			t.Fatal(err)
		}
		defer stream.Close()
		s := stream.(*socketStream)
		s.started, s.used = true, true
		output := make(chan socketResult, 100)
		encoded, _ := json.Marshal(map[string]any{"type": "chunk", "status_code": 200, "done": false, "context_id": s.contextID, "data": "AQ=="})
		for range 100 {
			output <- socketResult{value: runtime.WebSocketText(encoded)}
		}
		s.pendingOutput = output
		original := errors.New("write failed")
		if failed {
			sent := make(chan error, 1)
			sent <- original
			s.pendingSend = sent
		} else {
			ready := make(chan inputResult, 1)
			ready <- inputResult{value: schema.TtsRequestStreamingTextVoice0bf53a99TextItemAsClear{}}
			s.pendingInput = ready
		}
		item, err := stream.Next(testContext(t))
		if err != nil {
			t.Fatal(err)
		}
		checkJSON(t, canonical(item), []int{1})
		// Refill the ready receive lane after its first yield, without timing races.
		s.pendingOutput = output
		item, err = stream.Next(testContext(t))
		if failed {
			if err != original {
				t.Fatalf("write identity = %v", err)
			}
		} else {
			if err != nil {
				t.Fatal(err)
			}
			if _, ok := item.(out.SynthesisItemAsClear); !ok {
				t.Fatalf("clear starved: %T", item)
			}
		}
	}
}
