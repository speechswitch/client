package inworld

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
	schema "github.com/speechswitch/client/sdks/go/generated/inworld"
	out "github.com/speechswitch/client/sdks/go/generated/inworld_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

var testAuth = auth.Auth{Inworld: runtime.Some(auth.AuthCartesia{ApiKey: runtime.Some("test-key")})}

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

type fixtures struct {
	HTTP     []struct{ Request, Body map[string]any }
	Timeline []struct{ Packet, Item map[string]any }
}

func loadFixtures(t *testing.T) fixtures {
	t.Helper()
	data, err := os.ReadFile("../../../fixtures/inworld.json")
	if err != nil {
		t.Fatal(err)
	}
	var value fixtures
	if err = json.Unmarshal(data, &value); err != nil {
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
	switch {
	case value["create"] != nil:
		s.event("contextCreated", map[string]any{})
	case value["send_text"] != nil:
		s.event("audioChunk", map[string]any{"audioContent": "AP8="})
	case value["flush_context"] != nil:
		s.event("flushCompleted", map[string]any{})
	case value["close_context"] != nil:
		s.event("contextClosed", map[string]any{})
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

func (s *socket) event(kind string, value any) {
	s.put(map[string]any{"result": map[string]any{"contextId": "ctx", kind: value}})
}
func request() schema.TtsRequestAsInworldTts2TextVoice {
	return schema.TtsRequestAsInworldTts2TextVoice{Value: schema.TtsRequestInworldTts2TextVoice{Text: "Hello", Voice: "custom-voice", Output: schema.TtsRequestTextVoiceOutputAsPcm{}}}
}
func streaming(source runtime.Input[Input]) schema.TtsRequestAsInworldTts2StreamingTextVoice {
	return schema.TtsRequestAsInworldTts2StreamingTextVoice{Value: schema.TtsRequestInworldTts2StreamingTextVoice{Text: source, Voice: "custom-voice", Output: schema.TtsRequestStreamingTextVoiceOutputAsPcm{}}}
}
func text(value string) Input {
	return schema.TtsRequestStreamingTextVoiceTextItemAsString{Value: value}
}
func fixtureItem(t *testing.T, item out.SynthesisItem) any {
	t.Helper()
	result := map[string]any{}
	var marks []out.InworldTimestamp
	var audio runtime.Optional[[]byte]
	var id runtime.Optional[string]
	switch v := item.(type) {
	case out.SynthesisItemAsBytes:
		audio = runtime.Some(v.Value)
	case out.SynthesisItemAsTimeline:
		result["correlation"] = "timeline"
		marks = v.Value.Timestamps
		audio = v.Value.Audio
		id = v.Value.CorrelationId
	case out.SynthesisItemAsChunk:
		result["correlation"] = "chunk"
		marks = v.Value.Timestamps
		audio = runtime.Some(v.Value.Audio)
		id = v.Value.CorrelationId
	case out.SynthesisItemAsFlush:
		return jsonValue(t, map[string]any{"event": "flush", "correlationId": v.Value.CorrelationId, "inputGroupId": v.Value.InputGroupId.Value})
	default:
		t.Fatalf("unexpected output %T", item)
	}
	if id.Present {
		result["correlationId"] = id.Value
	}
	if _, present := result["correlation"]; present {
		times := []map[string]any{}
		for _, m := range marks {
			entry := map[string]any{"kind": m.Kind.LiteralValue(), "value": m.Value, "startTimeMs": m.StartTimeMs}
			if m.EndTimeMs.Present {
				entry["endTimeMs"] = m.EndTimeMs.Value
			}
			if m.WordIndex.Present {
				entry["wordIndex"] = m.WordIndex.Value
			}
			times = append(times, entry)
		}
		result["timestamps"] = times
	}
	if audio.Present {
		data := []int{}
		for _, v := range audio.Value {
			data = append(data, int(v))
		}
		result["audio"] = map[string]any{"$bytes": data}
	}
	return jsonValue(t, result)
}
