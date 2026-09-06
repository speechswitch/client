package async

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	schema "github.com/speechswitch/client/sdks/go/generated/async_"
	out "github.com/speechswitch/client/sdks/go/generated/async_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type textSource struct {
	values  chan textResult
	started chan struct{}
	closed  chan struct{}
	once    sync.Once
	pulls   atomic.Int32
	closes  atomic.Int32
}

func newTextSource(values ...textResult) *textSource {
	source := &textSource{values: make(chan textResult, 10), started: make(chan struct{}, 10), closed: make(chan struct{})}
	for _, value := range values {
		source.values <- value
	}
	return source
}
func (s *textSource) Next(ctx context.Context) (string, error) {
	s.pulls.Add(1)
	select {
	case s.started <- struct{}{}:
	default:
	}
	select {
	case value := <-s.values:
		return value.value, value.err
	case <-ctx.Done():
		return "", ctx.Err()
	case <-s.closed:
		return "", io.ErrClosedPipe
	}
}
func (s *textSource) Close() error {
	s.closes.Add(1)
	s.once.Do(func() { close(s.closed) })
	return nil
}

type testSocket struct {
	onSend   func(context.Context, map[string]any) error
	values   chan socketResult
	closed   chan struct{}
	once     sync.Once
	mutex    sync.Mutex
	messages []map[string]any
	receives atomic.Int32
	closes   atomic.Int32
}

func newTestSocket() *testSocket {
	return &testSocket{values: make(chan socketResult, 10), closed: make(chan struct{})}
}
func (s *testSocket) Send(ctx context.Context, message runtime.WebSocketMessage) error {
	text, ok := message.(runtime.WebSocketText)
	if !ok {
		return errors.New("test expected text")
	}
	var value map[string]any
	if err := json.Unmarshal([]byte(text), &value); err != nil {
		return err
	}
	s.mutex.Lock()
	s.messages = append(s.messages, value)
	s.mutex.Unlock()
	if s.onSend != nil {
		return s.onSend(ctx, value)
	}
	return nil
}
func (s *testSocket) Receive(ctx context.Context) (runtime.WebSocketMessage, error) {
	s.receives.Add(1)
	select {
	case value := <-s.values:
		return value.value, value.err
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-s.closed:
		return nil, io.EOF
	}
}
func (s *testSocket) Close() error {
	s.closes.Add(1)
	s.once.Do(func() { close(s.closed) })
	return nil
}
func (s *testSocket) sent() []map[string]any {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	return append([]map[string]any{}, s.messages...)
}
func (s *testSocket) audio(id string, final bool, data []byte) {
	encoded, _ := json.Marshal(map[string]any{"context_id": id, "audio": base64.StdEncoding.EncodeToString(data), "final": final})
	s.values <- socketResult{value: runtime.WebSocketText(encoded)}
}

func incrementalRequest(source runtime.Input[string]) schema.TtsRequest {
	var segmentation schema.TtsRequestFlashV15StreamingTextVoiceSegmentation = schema.TtsRequestFlashV15StreamingTextVoiceSegmentationAsImmediate{}
	return schema.TtsRequestAsFlashV15StreamingTextVoice{Value: schema.TtsRequestFlashV15StreamingTextVoice{Text: source, Voice: "existing-voice-id", Output: schema.TtsRequestFlashV15StreamingTextVoiceOutputAsPcm{Value: schema.TtsRequestFlashV15StreamingTextVoiceOutputPcm{SampleRateHz: 24000}}, Segmentation: runtime.Some(segmentation)}}
}

func TestIncrementalSettingsTextAndFinal(t *testing.T) {
	source := newTextSource(textResult{value: "Hello\ufeff\n"}, textResult{value: ""}, textResult{value: "\u0085"}, textResult{err: io.EOF})
	socket := newTestSocket()
	socket.onSend = func(_ context.Context, value map[string]any) error {
		if _, settings := value["model_id"]; settings {
			if source.pulls.Load() != 0 {
				return errors.New("input pulled before settings")
			}
			return nil
		}
		if value["close_context"] == true {
			socket.audio(value["context_id"].(string), true, []byte{0, 255, 128})
		}
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	stream, err := Synthesize(ctx, incrementalRequest(source), Options{Auth: credentials, WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	if source.pulls.Load() != 0 || len(socket.sent()) != 0 {
		t.Fatal("unread stream started synthesis")
	}
	item, err := stream.Next(ctx)
	if err != nil || !reflect.DeepEqual(item, out.SynthesisItemAsBytes{Value: []byte{0, 255, 128}}) {
		t.Fatalf("final audio = %#v %v", item, err)
	}
	if socket.closes.Load() != 1 || source.closes.Load() != 1 {
		t.Fatalf("final resources: socket %d input %d", socket.closes.Load(), source.closes.Load())
	}
	if item, err := stream.Next(ctx); item != nil || err != io.EOF {
		t.Fatalf("terminal = %#v %v", item, err)
	}
	messages := socket.sent()
	if len(messages) != 4 {
		t.Fatalf("messages = %#v", messages)
	}
	id, ok := messages[1]["context_id"].(string)
	if !ok || !regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`).MatchString(id) {
		t.Fatalf("context id = %q", id)
	}
	want := []map[string]any{
		{"model_id": "async_flash_v1.5", "voice": map[string]any{"mode": "id", "id": "existing-voice-id"}, "output_format": map[string]any{"container": "raw", "sample_rate": float64(24000), "encoding": "pcm_s16le"}},
		{"context_id": id, "transcript": "Hello ", "force": true},
		{"context_id": id, "transcript": "\u0085 ", "force": true},
		{"context_id": id, "transcript": "", "close_context": true},
	}
	if !reflect.DeepEqual(messages, want) {
		t.Fatalf("messages = %#v; want %#v", messages, want)
	}
	if source.pulls.Load() != 4 || socket.receives.Load() != 1 {
		t.Fatalf("pulls = %d; receives = %d", source.pulls.Load(), socket.receives.Load())
	}
}

func TestIncrementalBackpressureAndEarlyClose(t *testing.T) {
	source := newTextSource(textResult{value: "hello"})
	socket := newTestSocket()
	socket.onSend = func(_ context.Context, value map[string]any) error {
		if id, ok := value["context_id"].(string); ok {
			socket.audio(id, false, []byte{1})
			socket.audio(id, false, []byte{2})
		}
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	stream, err := Synthesize(ctx, incrementalRequest(source), Options{Auth: credentials, WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	for _, audio := range []byte{1, 2} {
		item, err := stream.Next(ctx)
		if err != nil || !reflect.DeepEqual(item, out.SynthesisItemAsBytes{Value: []byte{audio}}) {
			t.Fatalf("audio = %#v %v", item, err)
		}
		if socket.receives.Load() != int32(audio) {
			t.Fatalf("socket prefetched: %d receives", socket.receives.Load())
		}
	}
	// A completed write may not yet have been processed when output wins. Allow
	// the one lookahead pull, but never a second one while the consumer is paused.
	if source.pulls.Load() > 2 {
		t.Fatalf("input prefetched: %d pulls", source.pulls.Load())
	}
	if err := stream.Close(); err != nil {
		t.Fatal(err)
	}
	if source.closes.Load() != 1 || socket.closes.Load() != 1 {
		t.Fatalf("close counts = %d %d", source.closes.Load(), socket.closes.Load())
	}
}

func TestIncrementalAudioWhileTextWriteIsBlocked(t *testing.T) {
	source := newTextSource(textResult{value: "hello"}, textResult{value: "must not prefetch"})
	socket := newTestSocket()
	writeDone := make(chan struct{})
	socket.onSend = func(ctx context.Context, value map[string]any) error {
		if id, ok := value["context_id"].(string); ok {
			socket.audio(id, false, []byte{1})
			<-ctx.Done()
			close(writeDone)
			return ctx.Err()
		}
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	stream, err := Synthesize(ctx, incrementalRequest(source), Options{Auth: credentials, WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	item, err := stream.Next(ctx)
	if err != nil || !reflect.DeepEqual(item, out.SynthesisItemAsBytes{Value: []byte{1}}) {
		t.Fatalf("audio during write = %#v %v", item, err)
	}
	if source.pulls.Load() != 1 {
		t.Fatalf("input pulled during blocked write: %d", source.pulls.Load())
	}
	stream.Close()
	select {
	case <-writeDone:
	case <-ctx.Done():
		t.Fatal("Close did not release blocked writer")
	}
}

func TestIncrementalCancellationAndUnreadOwnership(t *testing.T) {
	for _, mode := range []string{"unread close", "idle cancel", "pending cancel", "pending Next cancel", "blocked settings send"} {
		t.Run(mode, func(t *testing.T) {
			source := newTextSource()
			socket := newTestSocket()
			sending := make(chan struct{}, 1)
			if mode == "blocked settings send" {
				socket.onSend = func(ctx context.Context, _ map[string]any) error {
					sending <- struct{}{}
					<-ctx.Done()
					return ctx.Err()
				}
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			stream, err := Synthesize(ctx, incrementalRequest(source), Options{Auth: credentials, WebSocket: socket})
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Close()
			if mode == "unread close" {
				stream.Close()
				if source.pulls.Load() != 0 || socket.receives.Load() != 0 || len(socket.sent()) != 0 {
					t.Fatal("unread stream accessed producer or socket")
				}
			} else if mode == "idle cancel" {
				cancel()
			} else {
				nextCtx, nextCancel := context.WithCancel(context.Background())
				defer nextCancel()
				done := make(chan error, 1)
				go func() { _, err := stream.Next(nextCtx); done <- err }()
				started := source.started
				if mode == "blocked settings send" {
					started = sending
				}
				select {
				case <-started:
				case <-time.After(5 * time.Second):
					t.Fatal("operation did not start")
				}
				if mode == "pending Next cancel" {
					nextCancel()
				} else {
					cancel()
				}
				select {
				case err := <-done:
					if err != context.Canceled {
						t.Fatal(err)
					}
				case <-time.After(5 * time.Second):
					t.Fatal("cancellation did not finish")
				}
			}
			select {
			case <-socket.closed:
			case <-time.After(5 * time.Second):
				t.Fatal("socket not released")
			}
			select {
			case <-source.closed:
			case <-time.After(5 * time.Second):
				t.Fatal("input not released")
			}
			stream.Close()
			if source.closes.Load() != 1 || socket.closes.Load() != 1 {
				t.Fatalf("close counts = %d %d", source.closes.Load(), socket.closes.Load())
			}
		})
	}
}

func TestIncrementalFailuresReleaseBothResources(t *testing.T) {
	inputFailure := errors.New("input failed")
	socketFailure := errors.New("socket failed")
	for _, test := range []struct {
		name     string
		input    textResult
		output   socketResult
		want     string
		identity error
	}{
		{"input", textResult{err: inputFailure}, socketResult{}, "", inputFailure},
		{"invalid input", textResult{value: string([]byte{255})}, socketResult{}, "Invalid async TTS input item", nil},
		{"socket", textResult{}, socketResult{err: socketFailure}, "", socketFailure},
		{"socket eof", textResult{}, socketResult{err: io.EOF}, "Async WebSocket closed before final output", nil},
		{"binary", textResult{}, socketResult{value: runtime.WebSocketBinary{1}}, "Async returned a non-text WebSocket frame", nil},
		{"unknown", textResult{}, socketResult{value: runtime.WebSocketText(`{}`)}, "Async returned an unknown WebSocket message", nil},
		{"provider", textResult{}, socketResult{value: runtime.WebSocketText(`{"error_code":"quota","message":"no credits"}`)}, "Async synthesis failed (quota): no credits", nil},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := newTextSource()
			socket := newTestSocket()
			if test.input.err != nil || test.input.value != "" {
				source.values <- test.input
			} else {
				socket.values <- test.output
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			request := incrementalRequest(source)
			stream, err := Synthesize(ctx, request, Options{Auth: credentials, WebSocket: socket})
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Close()
			_, err = stream.Next(ctx)
			if test.identity != nil {
				if err != test.identity {
					t.Fatalf("error identity = %v", err)
				}
			} else if err == nil || err.Error() != test.want {
				t.Fatalf("error = %v; want %q", err, test.want)
			}
			if source.closes.Load() != 1 || socket.closes.Load() != 1 {
				t.Fatalf("close counts = %d %d", source.closes.Load(), socket.closes.Load())
			}
		})
	}
	for _, mode := range []string{"unexpected context", "premature final"} {
		source := newTextSource(textResult{value: "hello"})
		socket := newTestSocket()
		socket.onSend = func(_ context.Context, value map[string]any) error {
			if id, ok := value["context_id"].(string); ok {
				if mode == "unexpected context" {
					id = "other"
				}
				socket.audio(id, mode == "premature final", nil)
			}
			return nil
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		stream, err := Synthesize(ctx, incrementalRequest(source), Options{Auth: credentials, WebSocket: socket})
		if err != nil {
			cancel()
			t.Fatal(err)
		}
		_, err = stream.Next(ctx)
		stream.Close()
		cancel()
		want := "Async returned output for an unexpected context"
		if mode == "premature final" {
			want = "Async finalized the context before input completed"
		}
		if err == nil || err.Error() != want {
			t.Fatalf("%s: %v", mode, err)
		}
	}
}

func TestIncrementalEmptyInputLimitsAndFailedInitialization(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	source := newTextSource(textResult{value: ""}, textResult{err: io.EOF})
	socket := newTestSocket()
	stream, err := Synthesize(ctx, incrementalRequest(source), Options{Auth: credentials, WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	if item, err := stream.Next(ctx); item != nil || err != io.EOF {
		t.Fatalf("empty = %#v %v", item, err)
	}
	stream.Close()
	if len(socket.sent()) != 1 || source.closes.Load() != 1 || socket.closes.Load() != 1 {
		t.Fatalf("empty state: messages %#v, closes %d %d", socket.sent(), source.closes.Load(), socket.closes.Load())
	}
	for _, mode := range []string{"settings", "input", "output"} {
		source := newTextSource()
		socket := newTestSocket()
		limit := 200
		if mode == "settings" {
			limit = 1
		} else if mode == "input" {
			source.values <- textResult{value: strings.Repeat("x", 201)}
		} else {
			socket.values <- socketResult{value: runtime.WebSocketText(strings.Repeat("x", 201))}
		}
		stream, err := Synthesize(ctx, incrementalRequest(source), Options{Auth: credentials, WebSocket: socket, MaxMessageBytes: limit})
		if err != nil {
			t.Fatal(err)
		}
		_, err = stream.Next(ctx)
		stream.Close()
		if err == nil || err.Error() != "Async message exceeds MaxMessageBytes" {
			t.Fatalf("%s limit = %v", mode, err)
		}
		if source.closes.Load() != 1 || socket.closes.Load() != 1 {
			t.Fatal("limit leaked resources")
		}
		if mode == "settings" && (source.pulls.Load() != 0 || len(socket.sent()) != 0) {
			t.Fatal("oversize settings accessed input or socket")
		}
	}
	for _, mode := range []string{"auth", "validation", "handshake", "canceled"} {
		source := newTextSource()
		socket := newTestSocket()
		request := incrementalRequest(source)
		options := Options{Auth: credentials, WebSocket: socket}
		requestCtx := ctx
		t.Setenv("SPEECHSWITCH_ASYNC_API_KEY", "")
		sentinel := errors.New("handshake failed")
		switch mode {
		case "auth":
			options.Auth.Async.Value.ApiKey.Value = ""
		case "validation":
			invalid := request.(schema.TtsRequestAsFlashV15StreamingTextVoice)
			invalid.Value.Output = nil
			request = invalid
		case "handshake":
			options.WebSocket = nil
			options.Transport = testTransport(func(*http.Request) (*http.Response, error) { return nil, sentinel })
		case "canceled":
			canceled, stop := context.WithCancel(ctx)
			stop()
			requestCtx = canceled
		}
		_, err := Synthesize(requestCtx, request, options)
		if err == nil {
			t.Fatalf("%s unexpectedly initialized", mode)
		}
		if mode == "handshake" && err != sentinel {
			t.Fatalf("handshake identity = %v", err)
		}
		if source.pulls.Load() != 0 || source.closes.Load() != 0 || socket.closes.Load() != 0 || len(socket.sent()) != 0 {
			t.Fatalf("failed %s consumed external resources", mode)
		}
	}
}

func readClientJSON(reader io.Reader) (map[string]any, error) {
	var header [2]byte
	if _, err := io.ReadFull(reader, header[:]); err != nil {
		return nil, err
	}
	if header[0] != 0x81 || header[1]&128 == 0 {
		return nil, fmt.Errorf("unexpected client header %x", header)
	}
	length := int(header[1] & 127)
	if length == 126 {
		var extended [2]byte
		if _, err := io.ReadFull(reader, extended[:]); err != nil {
			return nil, err
		}
		length = int(binary.BigEndian.Uint16(extended[:]))
	} else if length == 127 {
		return nil, errors.New("unexpected large request")
	}
	var mask [4]byte
	if _, err := io.ReadFull(reader, mask[:]); err != nil {
		return nil, err
	}
	data := make([]byte, length)
	if _, err := io.ReadFull(reader, data); err != nil {
		return nil, err
	}
	for index := range data {
		data[index] ^= mask[index%4]
	}
	var value map[string]any
	err := json.Unmarshal(data, &value)
	return value, err
}
func writeServerJSON(conn net.Conn, value map[string]any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	frame := []byte{0x81}
	if len(data) < 126 {
		frame = append(frame, byte(len(data)))
	} else {
		frame = binary.BigEndian.AppendUint16(append(frame, 126), uint16(len(data)))
	}
	_, err = conn.Write(append(frame, data...))
	return err
}

func TestNativeIncrementalAuthAndContextFlow(t *testing.T) {
	done := make(chan error, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		done <- func() error {
			if r.URL.EscapedPath() != "/socket%2Fvoice" || !reflect.DeepEqual(r.URL.Query(), mapValues("api_key", "test-key", "version", "v1", "keep", "1")) {
				return fmt.Errorf("unexpected auth URL %s", r.URL.RequestURI())
			}
			conn, buffer, err := w.(http.Hijacker).Hijack()
			if err != nil {
				return err
			}
			defer conn.Close()
			conn.SetDeadline(time.Now().Add(5 * time.Second))
			digest := sha1.Sum([]byte(r.Header.Get("Sec-WebSocket-Key") + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
			fmt.Fprintf(buffer, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n", base64.StdEncoding.EncodeToString(digest[:]))
			if err := buffer.Flush(); err != nil {
				return err
			}
			settings, err := readClientJSON(buffer)
			if err != nil {
				return err
			}
			wantSettings := map[string]any{"model_id": "async_flash_v1.5", "voice": map[string]any{"mode": "id", "id": "existing-voice-id"}, "output_format": map[string]any{"container": "raw", "sample_rate": float64(24000), "encoding": "pcm_s16le"}}
			if !reflect.DeepEqual(settings, wantSettings) {
				return fmt.Errorf("settings %#v", settings)
			}
			text, err := readClientJSON(buffer)
			if err != nil {
				return err
			}
			id, ok := text["context_id"].(string)
			if !ok {
				return errors.New("missing context")
			}
			if !reflect.DeepEqual(text, map[string]any{"context_id": id, "transcript": "Hello ", "force": true}) {
				return fmt.Errorf("text %#v", text)
			}
			if err := writeServerJSON(conn, map[string]any{"context_id": id, "audio": "AP+A", "final": false}); err != nil {
				return err
			}
			close, err := readClientJSON(buffer)
			if err != nil {
				return err
			}
			if !reflect.DeepEqual(close, map[string]any{"context_id": id, "transcript": "", "close_context": true}) {
				return fmt.Errorf("close %#v", close)
			}
			return writeServerJSON(conn, map[string]any{"context_id": id, "audio": "AQ==", "final": true})
		}()
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	source := newTextSource(textResult{value: "Hello\n"}, textResult{err: io.EOF})
	stream, err := Synthesize(ctx, incrementalRequest(source), Options{Auth: credentials, WebSocketURL: "ws" + strings.TrimPrefix(server.URL, "http") + "/socket%2Fvoice?api_key=old&api_key=duplicate&version=old&keep=1"})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	audio := []byte{}
	for {
		item, err := stream.Next(ctx)
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		audio = append(audio, item.(out.SynthesisItemAsBytes).Value...)
	}
	if !bytes.Equal(audio, []byte{0, 255, 128, 1}) || source.closes.Load() != 1 {
		t.Fatalf("native output = %v; input closes %d", audio, source.closes.Load())
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func mapValues(pairs ...string) url.Values {
	result := url.Values{}
	for index := 0; index < len(pairs); index += 2 {
		result[pairs[index]] = []string{pairs[index+1]}
	}
	return result
}
