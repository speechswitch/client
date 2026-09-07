package murf

import (
	"context"
	"encoding/json"
	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/murf"
	out "github.com/speechswitch/client/sdks/go/generated/murf_output"
	"github.com/speechswitch/client/sdks/go/runtime"
	"io"
	"net/http"
	"os"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

var testAuth = auth.Auth{Murf: runtime.Some(auth.AuthAsync{ApiKey: runtime.Some("test-key")})}

func equal(t *testing.T, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v; want %#v", got, want)
	}
}
func errorText(t *testing.T, err error, want string) {
	t.Helper()
	if err == nil || err.Error() != want {
		t.Fatalf("got %v; want %q", err, want)
	}
}
func wait(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(3 * time.Second):
		t.Fatal("timed out")
	}
}
func request() schema.TtsRequestAsTextVoice {
	return schema.TtsRequestAsTextVoice{Value: schema.TtsRequestTextVoice{Text: "Hello", Voice: "existing-voice"}}
}
func streaming(input runtime.Input[Input]) schema.TtsRequestAsStreamingTextVoice {
	return schema.TtsRequestAsStreamingTextVoice{Value: schema.TtsRequestStreamingTextVoice{Text: input, Voice: "existing-voice"}}
}
func text(value string) Input {
	return schema.TtsRequestStreamingTextVoiceTextItemAsString{Value: value}
}
func fixture(t *testing.T) map[string]json.RawMessage {
	t.Helper()
	data, err := os.ReadFile("../../../fixtures/murf.json")
	if err != nil {
		t.Fatal(err)
	}
	var f map[string]json.RawMessage
	if err = json.Unmarshal(data, &f); err != nil {
		t.Fatal(err)
	}
	return f
}
func decode(t *testing.T, data []byte) any {
	t.Helper()
	var v any
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatal(err)
	}
	return v
}
func collect(t *testing.T, stream runtime.Input[out.SynthesisItem]) []out.SynthesisItem {
	t.Helper()
	defer stream.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	result := []out.SynthesisItem{}
	for {
		v, err := stream.Next(ctx)
		if err == io.EOF {
			return result
		}
		if err != nil {
			t.Fatal(err)
		}
		result = append(result, v)
	}
}

type transport func(*http.Request) (*http.Response, error)

func (f transport) Do(r *http.Request) (*http.Response, error) { return f(r) }

type body struct {
	io.Reader
	closes  atomic.Int32
	closeFn func() error
}

func (b *body) Close() error {
	b.closes.Add(1)
	if b.closeFn != nil {
		return b.closeFn()
	}
	return nil
}

type source struct {
	values          []Input
	stall           bool
	failure         error
	reads, closes   atomic.Int32
	waiting, closed chan struct{}
	once            sync.Once
}

func newSource(values ...Input) *source {
	return &source{values: values, waiting: make(chan struct{}), closed: make(chan struct{})}
}
func (s *source) Next(ctx context.Context) (Input, error) {
	s.reads.Add(1)
	if len(s.values) > 0 {
		v := s.values[0]
		s.values = s.values[1:]
		return v, nil
	}
	if s.failure != nil {
		return nil, s.failure
	}
	if s.stall {
		s.once.Do(func() { close(s.waiting) })
		<-ctx.Done()
		return nil, ctx.Err()
	}
	return nil, io.EOF
}
func (s *source) Close() error {
	if s.closes.Add(1) == 1 {
		close(s.closed)
	}
	return nil
}

type socketMessage struct {
	value runtime.WebSocketMessage
	err   error
}
type socket struct {
	mutex    sync.Mutex
	sent     []map[string]any
	incoming chan socketMessage
	closed   chan struct{}
	closes   atomic.Int32
	hook     func(context.Context, map[string]any) error
}

func newSocket() *socket {
	return &socket{incoming: make(chan socketMessage, 32), closed: make(chan struct{})}
}
func (s *socket) packet(value any) {
	data, _ := json.Marshal(value)
	s.incoming <- socketMessage{value: runtime.WebSocketText(data)}
}
func (s *socket) Send(ctx context.Context, message runtime.WebSocketMessage) error {
	var v map[string]any
	if err := json.Unmarshal([]byte(message.(runtime.WebSocketText)), &v); err != nil {
		return err
	}
	s.mutex.Lock()
	s.sent = append(s.sent, v)
	s.mutex.Unlock()
	if s.hook != nil {
		return s.hook(ctx, v)
	}
	if value, ok := v["text"].(string); ok && value != "" {
		s.packet(map[string]any{"context_id": v["context_id"], "audio": "AP+A"})
	}
	if v["end"] == true {
		s.packet(map[string]any{"context_id": v["context_id"], "final": true})
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
func (s *socket) Close() error {
	if s.closes.Add(1) == 1 {
		close(s.closed)
	}
	return nil
}
func (s *socket) messages() []map[string]any {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	return append([]map[string]any{}, s.sent...)
}
