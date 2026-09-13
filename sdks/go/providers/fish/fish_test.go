package fish

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
	schema "github.com/speechswitch/client/sdks/go/generated/fish"
	out "github.com/speechswitch/client/sdks/go/generated/fish_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

var testAuth = auth.Auth{Fish: runtime.Some(auth.AuthAsync{ApiKey: runtime.Some("test-key")})}

func equal(t *testing.T, actual, expected any) {
	t.Helper()
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("got %#v, want %#v", actual, expected)
	}
}
func testContext(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	t.Cleanup(cancel)
	return ctx
}
func wait(t *testing.T, done <-chan struct{}) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("operation did not finish")
	}
}
func request() schema.TtsRequestAsTextVoice {
	return schema.TtsRequestAsTextVoice{Value: schema.TtsRequestTextVoice{Model: schema.TtsRequestText486ba478ModelAsS2Pro{}, Voice: "custom-voice", Text: "hello", Output: schema.TtsRequestS1TextOutputAsMp3{}}}
}
func streaming(source runtime.Input[Input]) schema.TtsRequestAsStreamingTextVoice {
	return schema.TtsRequestAsStreamingTextVoice{Value: schema.TtsRequestStreamingTextVoice{Model: schema.TtsRequestText486ba478ModelAsS2Pro{}, Voice: "custom-voice", Text: source, Output: schema.TtsRequestS1TextOutputAsMp3{}}}
}
func text(s string) Input { return schema.TtsRequestS1StreamingTextTextItemAsString{Value: s} }

type fixtures struct {
	Defaults map[string]any
	HTTP     []struct {
		Name    string
		Request map[string]any
		Wire    map[string]any
	}
	Timeline []struct {
		Packet map[string]any
		Item   map[string]any
	}
}

func hydrate(value any) any {
	switch v := value.(type) {
	case map[string]any:
		if values, ok := v["$bytes"].([]any); ok {
			data := make([]byte, len(values))
			for i, n := range values {
				data[i] = byte(n.(float64))
			}
			return data
		}
		for k, child := range v {
			v[k] = hydrate(child)
		}
	case []any:
		for i, child := range v {
			v[i] = hydrate(child)
		}
	}
	return value
}
func loadFixtures(t *testing.T) fixtures {
	t.Helper()
	data, err := os.ReadFile("../../../fixtures/fish.json")
	if err != nil {
		t.Fatal(err)
	}
	var f fixtures
	if err = json.Unmarshal(data, &f); err != nil {
		t.Fatal(err)
	}
	hydrate(f.Defaults)
	for i := range f.HTTP {
		hydrate(f.HTTP[i].Wire)
	}
	for i := range f.Timeline {
		hydrate(f.Timeline[i].Item)
	}
	return f
}
func normalized(v out.SynthesisItem) any {
	switch v := v.(type) {
	case out.SynthesisItemAsBytes:
		return v.Value
	case out.SynthesisItemAsTimeline:
		items := []any{}
		for _, timestamp := range v.Value.Timestamps {
			items = append(items, map[string]any{"kind": timestamp.Kind.Value(), "value": timestamp.Value, "startTimeMs": timestamp.StartTimeMs, "endTimeMs": timestamp.EndTimeMs})
		}
		result := map[string]any{"correlation": v.Value.Correlation.Value(), "correlationId": v.Value.CorrelationId, "timelineOffsetMs": v.Value.TimelineOffsetMs, "audio": v.Value.Audio, "timestamps": items}
		if v.Value.TimestampUpdate.Present {
			result["timestampUpdate"] = v.Value.TimestampUpdate.Value.Value()
		}
		if v.Value.DurationMs.Present {
			result["durationMs"] = v.Value.DurationMs.Value
		}
		return result
	}
	panic("unknown output")
}
func collect(ctx context.Context, stream runtime.Input[out.SynthesisItem]) ([]any, error) {
	values := []any{}
	for {
		item, err := stream.Next(ctx)
		if err == io.EOF {
			return values, nil
		}
		if err != nil {
			return nil, err
		}
		values = append(values, normalized(item))
	}
}

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) Do(r *http.Request) (*http.Response, error) { return f(r) }

type body struct {
	chunks        [][]byte
	err           error
	reads, closes atomic.Int32
}

func (b *body) Read(p []byte) (int, error) {
	b.reads.Add(1)
	if len(b.chunks) == 0 {
		if b.err != nil {
			return 0, b.err
		}
		return 0, io.EOF
	}
	n := copy(p, b.chunks[0])
	b.chunks[0] = b.chunks[0][n:]
	if len(b.chunks[0]) == 0 {
		b.chunks = b.chunks[1:]
	}
	return n, nil
}
func (b *body) Close() error { b.closes.Add(1); return nil }
func response(b io.ReadCloser, status int) transportFunc {
	return func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: status, Header: http.Header{}, Body: b}, nil
	}
}

type trace struct {
	mutex  sync.Mutex
	events []string
}

func (t *trace) add(event string) {
	if t != nil {
		t.mutex.Lock()
		defer t.mutex.Unlock()
		t.events = append(t.events, event)
	}
}
func (t *trace) values() []string {
	t.mutex.Lock()
	defer t.mutex.Unlock()
	return append([]string{}, t.events...)
}

type source struct {
	values        []Input
	err           error
	stall         bool
	reads, closes atomic.Int32
	done          chan struct{}
	waiting       chan struct{}
	once          sync.Once
	trace         *trace
}

func newSource(values ...Input) *source {
	return &source{values: values, done: make(chan struct{}), waiting: make(chan struct{}, 1)}
}
func (s *source) Next(ctx context.Context) (Input, error) {
	s.reads.Add(1)
	if len(s.values) > 0 {
		v := s.values[0]
		s.values = s.values[1:]
		return v, nil
	}
	if s.err != nil {
		return nil, s.err
	}
	if s.stall {
		select {
		case s.waiting <- struct{}{}:
		default:
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-s.done:
			return nil, io.EOF
		}
	}
	return nil, io.EOF
}
func (s *source) Close() error {
	s.once.Do(func() { s.closes.Add(1); s.trace.add("input"); close(s.done) })
	return nil
}

type socketResultTest struct {
	message runtime.WebSocketMessage
	err     error
}
type socket struct {
	mutex      sync.Mutex
	sent       []map[string]any
	incoming   chan socketResultTest
	done       chan struct{}
	once       sync.Once
	closes     atomic.Int32
	trace      *trace
	onSend     func(context.Context, map[string]any) error
	closeError error
}

func newSocket() *socket {
	return &socket{incoming: make(chan socketResultTest, 32), done: make(chan struct{})}
}
func (s *socket) emit(value map[string]any) {
	encoded, err := runtime.EncodeMessagePack(value)
	if err != nil {
		panic(err)
	}
	s.incoming <- socketResultTest{message: runtime.WebSocketBinary(encoded)}
}
func (s *socket) Send(ctx context.Context, message runtime.WebSocketMessage) error {
	encoded, ok := message.(runtime.WebSocketBinary)
	if !ok {
		return errors.New("non-binary write")
	}
	value, err := runtime.DecodeMessagePack(encoded)
	if err != nil {
		return err
	}
	fields := value.(map[string]any)
	s.mutex.Lock()
	s.sent = append(s.sent, fields)
	s.mutex.Unlock()
	if s.onSend != nil {
		return s.onSend(ctx, fields)
	}
	switch fields["event"] {
	case "text":
		s.emit(map[string]any{"event": "audio", "audio": []byte{0, 255}})
	case "stop":
		s.emit(map[string]any{"event": "finish", "reason": "stop"})
	}
	return nil
}
func (s *socket) Receive(ctx context.Context) (runtime.WebSocketMessage, error) {
	select {
	case value := <-s.incoming:
		return value.message, value.err
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-s.done:
		return nil, io.EOF
	}
}
func (s *socket) Close() error {
	s.once.Do(func() { s.closes.Add(1); s.trace.add("socket"); close(s.done) })
	return s.closeError
}
func (s *socket) messages() []map[string]any {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	return append([]map[string]any{}, s.sent...)
}
