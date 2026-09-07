package smallest_ai

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/smallest_ai"
	out "github.com/speechswitch/client/sdks/go/generated/smallest_ai_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func authenticated() auth.Auth {
	var a auth.Auth
	a.SmallestAi.Present = true
	a.SmallestAi.Value.ApiKey = runtime.Some("fixture")
	return a
}
func request() schema.TtsRequestAsLightningV31TextVoice5e2ae2e5 {
	return schema.TtsRequestAsLightningV31TextVoice5e2ae2e5{Value: schema.TtsRequestLightningV31TextVoice5e2ae2e5{Text: "Hello", Voice: "custom-uuid"}}
}
func equal(t *testing.T, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v; want %#v", got, want)
	}
}
func deadline(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	t.Cleanup(cancel)
	return ctx
}
func await(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(time.Second):
		t.Fatal("timed out")
	}
}

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) Do(r *http.Request) (*http.Response, error) { return f(r) }

type body struct {
	chunks  [][]byte
	failure error
	closes  atomic.Int32
	reads   atomic.Int32
}

func (b *body) Read(p []byte) (int, error) {
	b.reads.Add(1)
	if len(b.chunks) == 0 {
		if b.failure != nil {
			return 0, b.failure
		}
		return 0, io.EOF
	}
	chunk := b.chunks[0]
	n := copy(p, chunk)
	if n == len(chunk) {
		b.chunks = b.chunks[1:]
	} else {
		b.chunks[0] = chunk[n:]
	}
	return n, nil
}
func (b *body) Close() error { b.closes.Add(1); return nil }
func collect(ctx context.Context, input runtime.Input[out.SynthesisItem]) ([]out.SynthesisItem, error) {
	var items []out.SynthesisItem
	for {
		value, err := input.Next(ctx)
		if err == io.EOF {
			return items, nil
		}
		if err != nil {
			return items, err
		}
		items = append(items, value)
	}
}

type socket struct {
	sent      chan map[string]any
	received  chan frameResult
	closed    chan struct{}
	once      sync.Once
	closes    atomic.Int32
	blockSend bool
	sendGate  chan error
}

func newSocket() *socket {
	return &socket{sent: make(chan map[string]any, 16), received: make(chan frameResult, 16), closed: make(chan struct{})}
}
func (s *socket) Send(ctx context.Context, value runtime.WebSocketMessage) error {
	var message map[string]any
	if err := json.Unmarshal([]byte(value.(runtime.WebSocketText)), &message); err != nil {
		return err
	}
	select {
	case s.sent <- message:
	case <-ctx.Done():
		return ctx.Err()
	case <-s.closed:
		return io.EOF
	}
	if s.blockSend {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-s.closed:
			return io.EOF
		}
	}
	if s.sendGate != nil {
		select {
		case err := <-s.sendGate:
			return err
		case <-ctx.Done():
			return ctx.Err()
		case <-s.closed:
			return io.EOF
		}
	}
	return nil
}
func (s *socket) Receive(ctx context.Context) (runtime.WebSocketMessage, error) {
	select {
	case value := <-s.received:
		return value.value, value.err
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-s.closed:
		return nil, io.EOF
	}
}
func (s *socket) Close() error { s.once.Do(func() { s.closes.Add(1); close(s.closed) }); return nil }
func (s *socket) packet(value any) {
	data, _ := json.Marshal(value)
	s.received <- frameResult{value: runtime.WebSocketText(data)}
}
func sent(t *testing.T, s *socket) map[string]any {
	t.Helper()
	select {
	case v := <-s.sent:
		return v
	case <-time.After(time.Second):
		t.Fatal("send timeout")
		return nil
	}
}

type frameResult struct {
	value runtime.WebSocketMessage
	err   error
}
type production[T any] struct {
	value T
	err   error
}
type producer[T any] struct {
	items  chan production[T]
	closed chan struct{}
	once   sync.Once
	reads  atomic.Int32
}

func newProducer[T any](initial ...T) *producer[T] {
	p := &producer[T]{items: make(chan production[T], 16), closed: make(chan struct{})}
	for _, value := range initial {
		p.items <- production[T]{value: value}
	}
	return p
}
func (p *producer[T]) Next(ctx context.Context) (T, error) {
	p.reads.Add(1)
	select {
	case v := <-p.items:
		return v.value, v.err
	case <-ctx.Done():
		var zero T
		return zero, ctx.Err()
	case <-p.closed:
		var zero T
		return zero, io.EOF
	}
}
func (p *producer[T]) Close() error { p.once.Do(func() { close(p.closed) }); return nil }
func (p *producer[T]) end()         { p.items <- production[T]{err: io.EOF} }
func liveRequest(p runtime.Input[string]) schema.TtsRequestAsLightningV31StreamingTextVoiced272850b {
	return schema.TtsRequestAsLightningV31StreamingTextVoiced272850b{Value: schema.TtsRequestLightningV31StreamingTextVoiced272850b{Text: p, Voice: "custom-uuid"}}
}
func continuationRequest(p runtime.Input[inputItem]) schema.TtsRequestAsLightningV31StreamingTextVoicebf9ab904 {
	return schema.TtsRequestAsLightningV31StreamingTextVoicebf9ab904{Value: schema.TtsRequestLightningV31StreamingTextVoicebf9ab904{Text: p, Voice: "custom-uuid", Continuation: schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbContinuation{Id: "context"}}}
}
func next(input runtime.Input[out.SynthesisItem], ctx context.Context) <-chan result {
	ch := make(chan result, 1)
	go func() { v, e := input.Next(ctx); ch <- result{item: v, err: e} }()
	return ch
}
func takeResult(t *testing.T, ch <-chan result) result {
	t.Helper()
	select {
	case r := <-ch:
		return r
	case <-time.After(time.Second):
		t.Fatal("next timeout")
		return result{}
	}
}
func take(t *testing.T, ch <-chan result) out.SynthesisItem {
	t.Helper()
	r := takeResult(t, ch)
	if r.err != nil {
		t.Fatal(r.err)
	}
	return r.item
}

type fixtures struct {
	Requests []struct {
		Name string
		Body any
	}
	InvalidFrames []struct{ Wire, Error string }
	SSE           string
}

func shared(t *testing.T) fixtures {
	t.Helper()
	data, err := os.ReadFile("../../../fixtures/smallest.json")
	if err != nil {
		t.Fatal(err)
	}
	var f fixtures
	if err = json.Unmarshal(data, &f); err != nil {
		t.Fatal(err)
	}
	return f
}
func start(t *testing.T, request schema.TtsRequest, options Options) runtime.Input[out.SynthesisItem] {
	t.Helper()
	options.Auth = authenticated()
	input, err := Synthesize(deadline(t), request, options)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { input.Close() })
	return input
}
func frame(status string) map[string]any {
	p := map[string]any{"status": status, "request_id": "native"}
	if status == "chunk" {
		p["data"] = map[string]any{"audio": "AP+A"}
	}
	return p
}
