package minimax

import (
	"context"
	"encoding/json"
	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/minimax"
	out "github.com/speechswitch/client/sdks/go/generated/minimax_output"
	"github.com/speechswitch/client/sdks/go/runtime"
	"io"
	"net/http"
	"os"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

var testAuth = auth.Auth{Minimax: runtime.Some(auth.AuthAsync{ApiKey: runtime.Some("test-key")})}

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
func request() schema.TtsRequestAsTextVoice9b47fc40 {
	return schema.TtsRequestAsTextVoice9b47fc40{Value: schema.TtsRequestTextVoice9b47fc40{Text: "Hello", Voice: "existing-voice"}}
}
func streaming(input runtime.Input[Input]) schema.TtsRequestAsStreamingTextVoice9e2e17ce {
	return schema.TtsRequestAsStreamingTextVoice9e2e17ce{Value: schema.TtsRequestStreamingTextVoice9e2e17ce{Text: input, Voice: "existing-voice"}}
}
func text(value string) Input {
	return schema.TtsRequestStreamingText12421ea0TextItemAsString{Value: value}
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
func fixture(t *testing.T) map[string]json.RawMessage {
	t.Helper()
	data, err := os.ReadFile("../../../fixtures/minimax.json")
	if err != nil {
		t.Fatal(err)
	}
	var result map[string]json.RawMessage
	if err = json.Unmarshal(data, &result); err != nil {
		t.Fatal(err)
	}
	return result
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
	result := []out.SynthesisItem{}
	for {
		v, err := stream.Next(context.Background())
		if err == io.EOF {
			return result
		}
		if err != nil {
			t.Fatal(err)
		}
		result = append(result, v)
	}
}

type socketMessage struct {
	value runtime.WebSocketMessage
	err   error
}
type socket struct {
	mutex    sync.Mutex
	sent     []map[string]any
	session  string
	incoming chan socketMessage
	closed   chan struct{}
	closes   atomic.Int32
	hook     func(context.Context, map[string]any) error
}

func newSocket() *socket {
	s := &socket{incoming: make(chan socketMessage, 64), closed: make(chan struct{})}
	s.incoming <- socketMessage{value: runtime.WebSocketText(`{"event":"connected_success","connect_id":"connection"}`)}
	return s
}
func (s *socket) Send(ctx context.Context, message runtime.WebSocketMessage) error {
	var value map[string]any
	if err := json.Unmarshal([]byte(message.(runtime.WebSocketText)), &value); err != nil {
		return err
	}
	s.mutex.Lock()
	s.sent = append(s.sent, value)
	if value["event"] == "task_start" {
		s.session = value["session_id"].(string)
	}
	s.mutex.Unlock()
	if value["event"] == "task_start" {
		s.reply(map[string]any{"event": "task_started"})
	}
	if s.hook != nil {
		return s.hook(ctx, value)
	}
	switch value["event"] {
	case "task_continue":
		s.reply(map[string]any{"data": map[string]any{"audio": "00ff80"}, "is_final": true, "trace_id": "native"})
	case "task_finish":
		s.reply(map[string]any{"event": "task_finished"})
	case "task_cancel":
		s.reply(map[string]any{"event": "task_canceled"})
	case "task_flush":
		s.reply(map[string]any{"event": "task_flushed", "trace_id": "flush"})
	}
	return nil
}
func (s *socket) Receive(ctx context.Context) (runtime.WebSocketMessage, error) {
	select {
	case value := <-s.incoming:
		return value.value, value.err
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
func (s *socket) reply(value map[string]any) {
	s.mutex.Lock()
	session := s.session
	s.mutex.Unlock()
	packet := map[string]any{"session_id": session, "connect_id": "connection"}
	for k, v := range value {
		packet[k] = v
	}
	data, _ := json.Marshal(packet)
	s.incoming <- socketMessage{value: runtime.WebSocketText(data)}
}
func (s *socket) frames() []map[string]any {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	return append([]map[string]any{}, s.sent...)
}
func (s *socket) id() string { s.mutex.Lock(); defer s.mutex.Unlock(); return s.session }

func TestSharedHTTPConfigurationAndNativeBytes(t *testing.T) {
	b := &body{Reader: strings.NewReader(`{"data":{"status":2,"audio":"00ff80"},"trace_id":"trace"}`)}
	calls := 0
	httpTransport := transport(func(r *http.Request) (*http.Response, error) {
		calls++
		equal(t, r.Method, "POST")
		equal(t, r.URL.String(), "https://proxy.invalid/a%2Fb/v1/t2a_v2?tenant=one")
		equal(t, r.Header, http.Header{"Authorization": {"Bearer test-key"}, "Content-Type": {"application/json"}})
		wire, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		want := decode(t, fixture(t)["configuration"]).(map[string]any)
		want["text"], want["stream"], want["output_format"], want["subtitle_enable"] = "Hello", true, "hex", false
		want["stream_options"] = map[string]any{"exclude_aggregated_audio": true}
		equal(t, decode(t, wire), want)
		return &http.Response{StatusCode: 200, Body: b}, nil
	})
	stream, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: httpTransport, BaseURL: "https://proxy.invalid/a%2Fb/?tenant=one"})
	if err != nil {
		t.Fatal(err)
	}
	equal(t, collect(t, stream), []out.SynthesisItem{out.SynthesisItemAsBytes{Value: []byte{0, 255, 128}}, out.SynthesisItemAsDone{Value: out.MiniMaxDoneEvent{TraceId: runtime.Some("trace")}}})
	equal(t, calls, 1)
	equal(t, b.closes.Load(), int32(1))
}

func TestClearFlushSuppressStaleAudioAndResume(t *testing.T) {
	s := newSocket()
	s.hook = func(_ context.Context, v map[string]any) error {
		switch v["event"] {
		case "task_continue":
			if v["text"] == "New" {
				s.reply(map[string]any{"event": "sentence_start", "trace_id": "request"})
				s.reply(map[string]any{"data": map[string]any{"audio": "01"}, "trace_id": "request", "is_final": true})
				s.reply(map[string]any{"event": "sentence_end", "trace_id": "request"})
			}
		case "task_cancel":
			s.reply(map[string]any{"data": map[string]any{"audio": "dead"}})
			s.reply(map[string]any{"event": "task_flushed"})
			s.reply(map[string]any{"event": "task_canceled"})
		case "task_finish":
			s.reply(map[string]any{"event": "task_finished"})
		}
		return nil
	}
	input := newSource(text("Old"), schema.TtsRequestStreamingText12421ea0TextItemAsFlush{}, schema.TtsRequestStreamingText12421ea0TextItemAsClear{}, text("New"))
	stream, err := Synthesize(context.Background(), streaming(input), Options{WebSocket: s})
	if err != nil {
		t.Fatal(err)
	}
	actual := collect(t, stream)
	equal(t, len(actual), 5)
	equal(t, actual[0], out.SynthesisItemAsClear{})
	for i, boundary := range []string{"start", "", "end"} {
		env := actual[i+1].(out.SynthesisItemAsOrderedOrTimeline).Value
		equal(t, env.Correlation.LiteralValue(), "ordered")
		equal(t, env.InputGroupId, runtime.Some(s.id()))
		equal(t, env.CorrelationId, runtime.Some("request"))
		equal(t, env.TraceId, runtime.Some("request"))
		equal(t, env.Timestamps, []out.MiniMaxTimestamp{})
		if boundary != "" {
			equal(t, env.SentenceBoundary.Value.LiteralValue(), boundary)
			equal(t, env.Audio.Present, false)
		} else {
			equal(t, env.Audio, runtime.Some([]byte{1}))
			equal(t, env.RequestComplete.Value.LiteralValue(), true)
		}
	}
	equal(t, actual[4], out.SynthesisItemAsDone{})
	equal(t, s.frames()[1:], []map[string]any{{"event": "task_continue", "text": "Old"}, {"event": "task_flush"}, {"event": "task_cancel"}, {"event": "task_continue", "text": "New"}, {"event": "task_finish"}})
	wait(t, input.closed)
	equal(t, input.closes.Load(), int32(1))
	equal(t, s.closes.Load(), int32(1))
}

func TestWhitespaceAndFlushIdentity(t *testing.T) {
	s := newSocket()
	input := newSource(text("Hello"), text(" "), text("\n"), text("world"), text(" "), schema.TtsRequestStreamingText12421ea0TextItemAsFlush{})
	stream, err := Synthesize(context.Background(), streaming(input), Options{WebSocket: s})
	if err != nil {
		t.Fatal(err)
	}
	actual := collect(t, stream)
	equal(t, s.frames()[1:], []map[string]any{{"event": "task_continue", "text": "Hello"}, {"event": "task_continue", "text": " \nworld"}, {"event": "task_flush"}, {"event": "task_finish"}})
	equal(t, actual[len(actual)-2], out.SynthesisItemAsFlush{Value: out.FlushEvent{CorrelationId: "flush", InputGroupId: runtime.Some(s.id())}})
	wait(t, input.closed)
}
