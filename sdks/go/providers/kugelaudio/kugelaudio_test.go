package kugelaudio

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/kugelaudio"
	out "github.com/speechswitch/client/sdks/go/generated/kugelaudio_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

var testAuth = auth.Auth{Kugelaudio: runtime.Some(auth.AuthAsync{ApiKey: runtime.Some("test-key")})}

func equal(t *testing.T, actual, expected any) {
	t.Helper()
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("got %#v, want %#v", actual, expected)
	}
}
func errorText(t *testing.T, err error, expected string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected %q, got nil", expected)
	}
	equal(t, err.Error(), expected)
}
func wait(t *testing.T, done <-chan struct{}) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("operation did not settle")
	}
}
func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return data
}
func jsonValue(t *testing.T, value any) any {
	t.Helper()
	var result any
	if err := json.Unmarshal(mustJSON(t, value), &result); err != nil {
		t.Fatal(err)
	}
	return result
}
func decodeJSON(t *testing.T, data []byte) any {
	t.Helper()
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		t.Fatal(err)
	}
	return value
}

func loadFixtures(t *testing.T) map[string]any {
	t.Helper()
	data, err := os.ReadFile("../../../fixtures/kugelaudio.json")
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(data, &value); err != nil {
		t.Fatal(err)
	}
	return value
}

type source[T any] struct {
	items           []T
	failure         error
	stall           bool
	reads, closes   atomic.Int32
	waiting, closed chan struct{}
	waitingOnce     sync.Once
	nextFn          func(context.Context) (T, error)
	closeFn         func()
}

func newSource[T any](items []T) *source[T] {
	return &source[T]{items: items, waiting: make(chan struct{}), closed: make(chan struct{})}
}
func (s *source[T]) Next(ctx context.Context) (T, error) {
	s.reads.Add(1)
	if s.nextFn != nil {
		return s.nextFn(ctx)
	}
	if len(s.items) > 0 {
		v := s.items[0]
		s.items = s.items[1:]
		return v, nil
	}
	var zero T
	if s.failure != nil {
		return zero, s.failure
	}
	if s.stall {
		s.waitingOnce.Do(func() { close(s.waiting) })
		<-ctx.Done()
		return zero, ctx.Err()
	}
	return zero, io.EOF
}
func (s *source[T]) Close() error {
	if s.closes.Add(1) == 1 {
		if s.closeFn != nil {
			s.closeFn()
		}
		close(s.closed)
	}
	return nil
}

type transport func(*http.Request) (*http.Response, error)

type readerFunc func([]byte) (int, error)

func (f readerFunc) Read(data []byte) (int, error) { return f(data) }

func (f transport) Do(r *http.Request) (*http.Response, error) { return f(r) }

type body struct {
	io.Reader
	closes  atomic.Int32
	closeFn func() error
}

func (b *body) Close() error {
	if b.closes.Add(1) == 1 && b.closeFn != nil {
		return b.closeFn()
	}
	return nil
}
func responseTransport(b io.ReadCloser, status int) transport {
	return func(*http.Request) (*http.Response, error) { return &http.Response{StatusCode: status, Body: b}, nil }
}
func collect(stream runtime.Input[out.SynthesisItem]) ([]out.SynthesisItem, error) {
	defer stream.Close()
	values := []out.SynthesisItem{}
	for {
		v, err := stream.Next(context.Background())
		if err == io.EOF {
			return values, nil
		}
		if err != nil {
			return nil, err
		}
		values = append(values, v)
	}
}

type socket struct {
	mutex    sync.Mutex
	sent     []map[string]any
	incoming chan socketResult
	closed   chan struct{}
	once     sync.Once
	onSend   func(context.Context, map[string]any) error
}

func newSocket() *socket {
	return &socket{incoming: make(chan socketResult, 128), closed: make(chan struct{})}
}
func (s *socket) put(value any) {
	data, _ := json.Marshal(value)
	s.incoming <- socketResult{value: runtime.WebSocketText(data)}
}
func (s *socket) Send(ctx context.Context, message runtime.WebSocketMessage) error {
	frame, ok := message.(runtime.WebSocketText)
	if !ok {
		return errors.New("expected text frame")
	}
	var value map[string]any
	if err := json.Unmarshal([]byte(frame), &value); err != nil {
		return err
	}
	s.mutex.Lock()
	s.sent = append(s.sent, value)
	s.mutex.Unlock()
	if s.onSend != nil {
		return s.onSend(ctx, value)
	}
	if _, present := value["text"]; present {
		s.put(map[string]any{"audio": "AQI=", "enc": "pcm_s16le", "sr": 24000, "samples": 1, "idx": 0, "chunk_id": 0})
		if _, static := value["voice_id"]; static {
			s.put(map[string]any{"final": true})
		}
	}
	if value["flush"] == true {
		s.put(map[string]any{"final": true})
		s.put(map[string]any{"session_closed": true})
	}
	if value["cancel"] == true {
		s.put(map[string]any{"interrupted": true})
	}
	if update, ok := value["update_settings"]; ok {
		s.put(map[string]any{"settings_updated": true, "settings": update})
	}
	return nil
}
func (s *socket) Receive(ctx context.Context) (runtime.WebSocketMessage, error) {
	select {
	case v := <-s.incoming:
		return v.value, v.err
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-s.closed:
		return nil, io.EOF
	}
}
func (s *socket) Close() error { s.once.Do(func() { close(s.closed) }); return nil }
func (s *socket) messages() []map[string]any {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	return append([]map[string]any{}, s.sent...)
}

func request() schema.TtsRequestAsTextVoice {
	return schema.TtsRequestAsTextVoice{Value: schema.TtsRequestTextVoice{Text: "Hi", Voice: schema.TtsRequestTextVoiceVoiceAsString{Value: "existing-custom-voice"}, Output: schema.TtsRequestTextVoiceOutputAsPcm{}}}
}
func streaming(source runtime.Input[Input]) schema.TtsRequestAsStreamingTextVoice {
	return schema.TtsRequestAsStreamingTextVoice{Value: schema.TtsRequestStreamingTextVoice{Text: source, Voice: request().Value.Voice, Output: schema.TtsRequestTextVoiceOutputAsPcm{}}}
}
func text(value string) Input {
	return schema.TtsRequestStreamingTextVoiceTextItemAsString{Value: value}
}
func liveSettings(t *testing.T) map[string]any {
	settings := loadFixtures(t)["settings"].(map[string]any)
	settings["word_timestamps"], settings["speaker_prefix"], settings["flush_timeout_ms"], settings["max_buffer_length"] = false, true, float64(500), float64(10000)
	return settings
}
