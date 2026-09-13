package fish

import (
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	schema "github.com/speechswitch/client/sdks/go/generated/fish"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func clientFrame(reader io.Reader) (map[string]any, error) {
	var header [2]byte
	if _, err := io.ReadFull(reader, header[:]); err != nil {
		return nil, err
	}
	if header[0] != 0x82 || header[1]&128 == 0 {
		return nil, errors.New("expected masked binary frame")
	}
	size := int(header[1] & 127)
	if size == 127 {
		return nil, errors.New("unexpected large fixture frame")
	}
	if size == 126 {
		var extended [2]byte
		if _, err := io.ReadFull(reader, extended[:]); err != nil {
			return nil, err
		}
		size = int(binary.BigEndian.Uint16(extended[:]))
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
	value, err := runtime.DecodeMessagePack(data)
	if err != nil {
		return nil, err
	}
	fields, ok := value.(map[string]any)
	if !ok {
		return nil, errors.New("expected event map")
	}
	return fields, nil
}

func TestNativeSocketAuthModelsAndBinaryFrames(t *testing.T) {
	for _, model := range []string{"s1", "s2-pro", "s2.1-pro", "s2.1-pro-free"} {
		for _, override := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/%t", model, override), func(t *testing.T) {
				finished := make(chan error, 1)
				wire := loadFixtures(t).Defaults
				wire["text"] = ""
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					finished <- func() error {
						path := "/proxy%20path/v1/tts/live"
						if override {
							path = "/custom"
						}
						if r.Header.Get("Authorization") != "Bearer test-key" || r.Header.Get("Model") != model || r.URL.EscapedPath() != path || r.URL.RawQuery != "tenant=one" {
							return fmt.Errorf("unexpected upgrade %s", r.URL)
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
						for _, expected := range []map[string]any{{"event": "start", "request": wire}, {"event": "text", "text": "hello"}, {"event": "flush"}, {"event": "stop"}} {
							actual, err := clientFrame(buffer)
							if err != nil {
								return err
							}
							if !reflect.DeepEqual(actual, expected) {
								return fmt.Errorf("got %#v, want %#v", actual, expected)
							}
						}
						for _, packet := range []map[string]any{{"event": "audio", "audio": []byte{0, 255}}, {"event": "finish", "reason": "stop"}} {
							encoded, err := runtime.EncodeMessagePack(packet)
							if err != nil {
								return err
							}
							buffer.Write([]byte{0x82, byte(len(encoded))})
							buffer.Write(encoded)
						}
						if err := buffer.Flush(); err != nil {
							return err
						}
						_, err = io.Copy(io.Discard, buffer)
						return err
					}()
				}))
				defer server.Close()
				src := newSource(text("hello"), schema.TtsRequestS1StreamingTextTextItemAsFlush{})
				r := streaming(src)
				var request schema.TtsRequest = r
				switch model {
				case "s1":
					request = schema.TtsRequestAsS1StreamingTextVoice{Value: schema.TtsRequestS1StreamingTextVoice{Voice: r.Value.Voice, Text: src, Output: r.Value.Output}}
				case "s2.1-pro":
					r.Value.Model = schema.TtsRequestText486ba478ModelAsS21Pro{}
					request = r
				case "s2.1-pro-free":
					r.Value.Model = schema.TtsRequestText486ba478ModelAsS21ProFree{}
					request = r
				}
				options := Options{Auth: testAuth, BaseURL: server.URL + "/proxy%20path/?tenant=one"}
				if override {
					options.WebSocketURL = server.URL + "/custom?tenant=one"
				}
				stream, err := Synthesize(testContext(t), request, options)
				if err != nil {
					t.Fatal(err)
				}
				defer stream.Close()
				items, err := collect(testContext(t), stream)
				if err != nil {
					t.Fatal(err)
				}
				equal(t, items, []any{[]byte{0, 255}})
				if err := <-finished; err != nil {
					t.Fatal(err)
				}
			})
		}
	}
}

func TestNativeSetupCancellationDoesNotPollInput(t *testing.T) {
	received, disconnected := make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(received)
		<-r.Context().Done()
		close(disconnected)
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(testContext(t))
	defer cancel()
	src := newSource()
	finished := make(chan error, 1)
	go func() {
		_, err := Synthesize(ctx, streaming(src), Options{Auth: testAuth, BaseURL: server.URL})
		finished <- err
	}()
	wait(t, received)
	cancel()
	err := <-finished
	if !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	wait(t, disconnected)
	equal(t, src.reads.Load(), int32(0))
	equal(t, src.closes.Load(), int32(0))
}

func TestEndpointValidation(t *testing.T) {
	for _, url := range []string{"ftp://host", "https://user:pass@host", "https://host/#secret", "https://host:65536", "https://host/?bad=%zz", "https://host\\path", "https://host/white space", "not-a-url"} {
		_, err := endpoint(url, "", true, false)
		if err == nil {
			t.Fatalf("accepted %q", url)
		}
	}
}
