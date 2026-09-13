package respeecher

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
	schema "github.com/speechswitch/client/sdks/go/generated/respeecher"
	out "github.com/speechswitch/client/sdks/go/generated/respeecher_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func authenticated() auth.Auth {
	var a auth.Auth
	a.Respeecher.Present = true
	a.Respeecher.Value.ApiKey = runtime.Some("fixture")
	return a
}
func request() schema.TtsRequestAsObject {
	return schema.TtsRequestAsObject{Value: schema.TtsRequestObject{Text: schema.TtsRequestObjectTextAsString{Value: "Hello"}, Voice: "custom-voice"}}
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

type fixtures struct {
	Requests []struct {
		Name string
		Path string
		Body any
	}
	JSONL []struct {
		Name, Wire string
		Audio      [][]int
		Error      *string
	}
}

func shared(t *testing.T) fixtures {
	t.Helper()
	data, err := os.ReadFile("../../../fixtures/respeecher.json")
	if err != nil {
		t.Fatal(err)
	}
	var f fixtures
	if err := json.Unmarshal(data, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

func TestSharedRequestsAndPointerRepresentations(t *testing.T) {
	defaults := request()
	ukrainian := request()
	ukrainian.Value.Text = &schema.TtsRequestObjectTextAsString{Value: "Приві́т!"}
	var language schema.TtsRequestObjectLanguage = &schema.TtsRequestObjectLanguageAsUk{}
	ukrainian.Value.Language = runtime.Some(language)
	ukrainian.Value.Temperature = runtime.Some(0.0)
	ukrainian.Value.TopK = runtime.Some(0.0)
	ukrainian.Value.TopP = runtime.Some(.9)
	ukrainian.Value.MinP = runtime.Some(0.0)
	ukrainian.Value.PresencePenalty = runtime.Some(2.0)
	ukrainian.Value.FrequencyPenalty = runtime.Some(0.0)
	ukrainian.Value.RepetitionPenalty = runtime.Some(1.0)
	ukrainian.Value.RandomSeed = runtime.Some(-7.0)
	var pcm schema.TtsRequestObjectOutput = &schema.TtsRequestObjectOutputAsPcm{Value: schema.TtsRequestObjectOutputPcm{SampleRateHz: runtime.Some(44100.0)}}
	p := pcm.(*schema.TtsRequestObjectOutputAsPcm)
	var encoding schema.TtsRequestObjectOutputPcmSampleEncoding = &schema.TtsRequestObjectOutputPcmSampleEncodingAsSignedInteger16{}
	p.Value.SampleEncoding = runtime.Some(encoding)
	ukrainian.Value.Output = runtime.Some(pcm)
	mulaw := request()
	mulaw.Value.Text = schema.TtsRequestObjectTextAsString{Value: "Hi"}
	mulaw.Value.Voice = "voice"
	mulaw.Value.TopK = runtime.Some(12.0)
	var mu schema.TtsRequestObjectOutput = &schema.TtsRequestObjectOutputAsMulaw{Value: schema.TtsRequestObjectOutputMulaw{SampleRateHz: runtime.Some(24000.0)}}
	mulaw.Value.Output = runtime.Some(mu)
	wave := schema.TtsRequestAsTextVoice{Value: schema.TtsRequestTextVoice{Text: "Hi", Voice: "voice", Output: schema.TtsRequestTextVoiceOutput{SampleRateHz: runtime.Some(48000.0)}}}
	cases := []schema.TtsRequest{defaults, &ukrainian, mulaw, &wave}
	for index, f := range shared(t).Requests {
		t.Run(f.Name, func(t *testing.T) {
			ctx := deadline(t)
			b := &body{chunks: [][]byte{[]byte("{\"type\":\"chunk\",\"data\":\"AP8=\"}\n")}}
			if f.Name == "wav" {
				b.chunks = [][]byte{{0, 255}}
			}
			var calls atomic.Int32
			transport := transportFunc(func(r *http.Request) (*http.Response, error) {
				calls.Add(1)
				equal(t, r.Method, "POST")
				equal(t, r.URL.String(), "https://api.respeecher.com/v1/public/tts"+f.Path)
				equal(t, r.Header, http.Header{"X-Api-Key": {"fixture"}, "Content-Type": {"application/json"}})
				var got any
				if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
					return nil, err
				}
				equal(t, got, f.Body)
				return &http.Response{StatusCode: 200, Body: b}, nil
			})
			input, err := Synthesize(ctx, cases[index], Options{Auth: authenticated(), Protocol: "http", Transport: transport})
			if err != nil {
				t.Fatal(err)
			}
			defer input.Close()
			equal(t, calls.Load(), int32(0))
			items, err := collect(ctx, input)
			if err != nil {
				t.Fatal(err)
			}
			equal(t, items, []out.SynthesisItem{out.SynthesisItemAsBytes{Value: []byte{0, 255}}, out.SynthesisItemAsDone{}})
			equal(t, b.closes.Load(), int32(1))
			equal(t, calls.Load(), int32(1))
		})
	}
}

func TestSharedJSONLEveryByteSplit(t *testing.T) {
	for _, f := range shared(t).JSONL {
		t.Run(f.Name, func(t *testing.T) {
			for split := 0; split <= len(f.Wire); split++ {
				ctx := deadline(t)
				b := &body{chunks: [][]byte{[]byte(f.Wire[:split]), []byte(f.Wire[split:])}}
				input, err := Synthesize(ctx, request(), Options{Auth: authenticated(), Protocol: "http", Transport: transportFunc(func(*http.Request) (*http.Response, error) { return &http.Response{StatusCode: 200, Body: b}, nil })})
				if err != nil {
					t.Fatal(err)
				}
				items, err := collect(ctx, input)
				input.Close()
				var want []out.SynthesisItem
				for _, values := range f.Audio {
					audio := make([]byte, len(values))
					for i, value := range values {
						audio[i] = byte(value)
					}
					want = append(want, out.SynthesisItemAsBytes{Value: audio})
				}
				if f.Error == nil {
					want = append(want, out.SynthesisItemAsDone{})
					equal(t, err, nil)
				} else {
					if err == nil {
						t.Fatal("missing error")
					}
					equal(t, err.Error(), *f.Error)
				}
				equal(t, items, want)
				equal(t, b.closes.Load(), int32(1))
				if f.Name == "native-error" {
					var native *Error
					if !errors.As(err, &native) {
						t.Fatal(err)
					}
					equal(t, native.StatusCode, 429)
					equal(t, native.ContextID, runtime.Some("native"))
				}
			}
		})
	}
}

type socket struct {
	sent      chan map[string]any
	received  chan socketResult
	closed    chan struct{}
	once      sync.Once
	closes    atomic.Int32
	blockSend bool
}

func newSocket() *socket {
	return &socket{sent: make(chan map[string]any, 16), received: make(chan socketResult, 16), closed: make(chan struct{})}
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
	s.received <- socketResult{value: runtime.WebSocketText(data)}
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

type producer struct {
	items  chan inputResult
	closed chan struct{}
	once   sync.Once
	reads  atomic.Int32
}

func newProducer() *producer {
	return &producer{items: make(chan inputResult, 16), closed: make(chan struct{})}
}
func (p *producer) Next(ctx context.Context) (inputItem, error) {
	p.reads.Add(1)
	select {
	case v := <-p.items:
		return v.value, v.err
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-p.closed:
		return nil, io.EOF
	}
}
func (p *producer) Close() error { p.once.Do(func() { close(p.closed) }); return nil }
func (p *producer) text(text string) {
	p.items <- inputResult{value: schema.TtsRequestObjectTextAsyncIterableItemAsString{Value: text}}
}
func liveRequest(p runtime.Input[inputItem]) schema.TtsRequestAsObject {
	r := request()
	r.Value.Text = schema.TtsRequestObjectTextAsAsyncIterable{Value: p}
	return r
}
func next(input runtime.Input[out.SynthesisItem], ctx context.Context) <-chan result {
	ch := make(chan result, 1)
	go func() { value, err := input.Next(ctx); ch <- result{item: value, err: err} }()
	return ch
}
func take(t *testing.T, ch <-chan result) out.SynthesisItem {
	t.Helper()
	select {
	case r := <-ch:
		if r.err != nil {
			t.Fatal(r.err)
		}
		return r.item
	case <-time.After(time.Second):
		t.Fatal("next timeout")
		return nil
	}
}

func TestOverlappingContextsClearFlushAndLateOutput(t *testing.T) {
	ctx := deadline(t)
	socket, p := newSocket(), newProducer()
	input, err := Synthesize(ctx, liveRequest(p), Options{Auth: authenticated(), WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	pending := next(input, ctx)
	p.text("First")
	first := sent(t, socket)
	one := first["context_id"].(string)
	equal(t, first["continue"], true)
	p.items <- inputResult{value: &schema.TtsRequestObjectTextAsyncIterableItemAsFlush{}}
	final := sent(t, socket)
	equal(t, final["transcript"], "")
	equal(t, final["continue"], false)
	equal(t, final["context_id"], one)
	p.text("Second")
	two := sent(t, socket)["context_id"].(string)
	if one == two {
		t.Fatal("reused context")
	}
	socket.packet(map[string]any{"type": "chunk", "context_id": one, "data": "AQ=="})
	equal(t, take(t, pending), out.SynthesisItemAsOrdered{Value: out.AudioEnvelope{CorrelationId: one, Audio: []byte{1}}})
	pending = next(input, ctx)
	p.items <- inputResult{value: &schema.TtsRequestObjectTextAsyncIterableItemAsClear{}}
	equal(t, take(t, pending), out.SynthesisItemAsClear{})
	cancels := map[string]any{}
	for range 2 {
		message := sent(t, socket)
		cancels[message["context_id"].(string)] = message
	}
	equal(t, cancels, map[string]any{one: map[string]any{"context_id": one, "cancel": true}, two: map[string]any{"context_id": two, "cancel": true}})
	socket.packet(map[string]any{"type": "error", "context_id": one, "status_code": 499, "error": "canceled"})
	socket.packet(map[string]any{"type": "chunk", "context_id": two, "data": "AP8="})
	socket.packet(map[string]any{"type": "done", "context_id": one})
	pending = next(input, ctx)
	p.text("Third")
	three := sent(t, socket)["context_id"].(string)
	p.items <- inputResult{value: schema.TtsRequestObjectTextAsyncIterableItemAsFlush{}}
	sent(t, socket)
	socket.packet(map[string]any{"type": "chunk", "context_id": three, "data": "Ag=="})
	equal(t, take(t, pending), out.SynthesisItemAsOrdered{Value: out.AudioEnvelope{CorrelationId: three, Audio: []byte{2}}})
	socket.packet(map[string]any{"type": "done", "context_id": three})
	equal(t, take(t, next(input, ctx)), out.SynthesisItemAsFlush{Value: out.FlushEvent{CorrelationId: three, InputGroupId: three}})
	p.items <- inputResult{err: io.EOF}
	equal(t, take(t, next(input, ctx)), out.SynthesisItemAsDone{})
	_, err = input.Next(ctx)
	equal(t, err, io.EOF)
	equal(t, socket.closes.Load(), int32(1))
	await(t, p.closed)
}

func TestBackpressuredSendStillReceivesAudio(t *testing.T) {
	ctx := deadline(t)
	socket := newSocket()
	socket.blockSend = true
	input, err := Synthesize(ctx, request(), Options{Auth: authenticated(), WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	pending := next(input, ctx)
	id := sent(t, socket)["context_id"].(string)
	socket.packet(map[string]any{"type": "chunk", "context_id": id, "data": "AQ=="})
	equal(t, take(t, pending), out.SynthesisItemAsOrdered{Value: out.AudioEnvelope{CorrelationId: id, Audio: []byte{1}}})
	input.Close()
	await(t, socket.closed)
}

func TestDecodeErrorsExact(t *testing.T) {
	for _, c := range []struct{ wire, want string }{
		{`[]`, "Invalid Respeecher response"}, {`{"type":"chunk","data":"AQ=="}`, "Respeecher omitted the native context ID"},
		{`{"type":"chunk","context_id":null,"data":"AQ=="}`, "Invalid Respeecher context ID"},
		{`{"type":"error","status_code":true,"error":"secret"}`, "Invalid Respeecher error response"},
		{`{"type":"error","status_code":429.5,"error":"secret"}`, "Invalid Respeecher error response"},
		{`{"type":"chunk","context_id":"id","data":"AB=="}`, "Invalid Respeecher audio response"},
		{`{"type":"chunk","context_id":"id","data":"AQ==\n"}`, "Invalid Respeecher audio response"},
		{`{"type":"chunk","context_id":"id","data":"AQ=="} trailing`, "Respeecher returned invalid JSON"},
	} {
		_, err := decode([]byte(c.wire), true)
		if err == nil {
			t.Fatal(c.wire)
		}
		equal(t, err.Error(), c.want)
	}
}

func TestBoundaryValidationAuthAndUnreadOwnership(t *testing.T) {
	t.Setenv("SPEECHSWITCH_RESPEECHER_API_KEY", "scoped")
	t.Setenv("RESPEECHER_API_KEY", "legacy")
	for _, c := range []struct {
		auth auth.Auth
		want string
	}{{authenticated(), "fixture"}, {auth.Auth{}, "scoped"}} {
		socket := newSocket()
		input, err := Synthesize(deadline(t), request(), Options{Auth: c.auth, WebSocket: socket})
		if err != nil {
			t.Fatal(err)
		}
		equal(t, input.(*stream).config.key, c.want)
		input.Close()
		equal(t, socket.closes.Load(), int32(1))
		equal(t, len(socket.sent), 0)
	}
	empty := authenticated()
	empty.Respeecher.Value.ApiKey = runtime.Some("")
	_, err := Synthesize(context.Background(), request(), Options{Auth: empty})
	equal(t, err.Error(), "Missing auth.respeecher.apiKey configuration")
	for _, r := range []schema.TtsRequest{nil, (*schema.TtsRequestAsObject)(nil), schema.TtsRequestAsObject{Value: schema.TtsRequestObject{Voice: "v", Text: schema.TtsRequestObjectTextAsString{Value: "hi"}, TopP: runtime.Some(0.0)}}} {
		if _, err := Synthesize(context.Background(), r, Options{Auth: authenticated()}); err == nil {
			t.Fatal("invalid request accepted")
		}
	}
	_, err = Synthesize(context.Background(), request(), Options{Auth: authenticated(), TimeoutMs: runtime.Some(int64(0))})
	equal(t, err, context.DeadlineExceeded)
	_, err = Synthesize(context.Background(), request(), Options{Auth: authenticated(), BaseURL: "https://user:secret@example.test"})
	equal(t, err.Error(), "Invalid Respeecher endpoint URL")
}
