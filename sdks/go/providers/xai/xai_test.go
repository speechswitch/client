package xai

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
	schema "github.com/speechswitch/client/sdks/go/generated/xai"
	out "github.com/speechswitch/client/sdks/go/generated/xai_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func authenticated() auth.Auth {
	var a auth.Auth
	a.Xai.Present = true
	a.Xai.Value.ApiKey = runtime.Some("fixture")
	return a
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
	case <-time.After(2 * time.Second):
		t.Fatal("timed out")
	}
}
func request() schema.TtsRequestAsText {
	return schema.TtsRequestAsText{Value: schema.TtsRequestText{Text: "Hello"}}
}
func liveRequest(p runtime.Input[inputItem]) schema.TtsRequestAsStreamingText {
	return schema.TtsRequestAsStreamingText{Value: schema.TtsRequestStreamingText{Text: p}}
}
func collect(ctx context.Context, input runtime.Input[out.SynthesisItem]) ([]out.SynthesisItem, error) {
	var items []out.SynthesisItem
	for {
		item, err := input.Next(ctx)
		if err == io.EOF {
			return items, nil
		}
		if err != nil {
			return items, err
		}
		items = append(items, item)
	}
}

type collected struct {
	items []out.SynthesisItem
	err   error
}

func consume(t *testing.T, input runtime.Input[out.SynthesisItem]) <-chan collected {
	t.Helper()
	ch := make(chan collected, 1)
	ctx := deadline(t)
	go func() { items, err := collect(ctx, input); ch <- collected{items, err} }()
	return ch
}

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) Do(r *http.Request) (*http.Response, error) { return f(r) }

type body struct {
	chunks              [][]byte
	failure, closeError error
	closes, reads       atomic.Int32
}

func (b *body) Read(p []byte) (int, error) {
	b.reads.Add(1)
	if len(b.chunks) == 0 {
		if b.failure != nil {
			return 0, b.failure
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
func (b *body) Close() error { b.closes.Add(1); return b.closeError }

type frameResult struct {
	frame runtime.WebSocketMessage
	err   error
}
type socket struct {
	sent                 chan map[string]any
	received             chan frameResult
	closed               chan struct{}
	once                 sync.Once
	closes, sends, reads atomic.Int32
	write                func(context.Context, map[string]any) error
}

func newSocket() *socket {
	return &socket{sent: make(chan map[string]any, 32), received: make(chan frameResult, 32), closed: make(chan struct{})}
}
func (s *socket) Send(ctx context.Context, frame runtime.WebSocketMessage) error {
	s.sends.Add(1)
	var message map[string]any
	if err := json.Unmarshal([]byte(frame.(runtime.WebSocketText)), &message); err != nil {
		return err
	}
	select {
	case s.sent <- message:
	case <-ctx.Done():
		return ctx.Err()
	case <-s.closed:
		return io.EOF
	}
	if s.write != nil {
		return s.write(ctx, message)
	}
	return nil
}
func (s *socket) Receive(ctx context.Context) (runtime.WebSocketMessage, error) {
	s.reads.Add(1)
	select {
	case r := <-s.received:
		return r.frame, r.err
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-s.closed:
		return nil, io.EOF
	}
}
func (s *socket) Close() error { s.closes.Add(1); s.once.Do(func() { close(s.closed) }); return nil }
func (s *socket) push(value any) {
	data, _ := json.Marshal(value)
	s.received <- frameResult{frame: runtime.WebSocketText(data)}
}
func (s *socket) message(t *testing.T) map[string]any {
	t.Helper()
	select {
	case m := <-s.sent:
		return m
	case <-time.After(2 * time.Second):
		t.Fatal("missing socket write")
		return nil
	}
}
func autoSocket() *socket {
	s := newSocket()
	s.write = func(ctx context.Context, m map[string]any) error {
		switch m["type"] {
		case "session.update":
			s.push(map[string]any{"type": "session.updated", "replace": m["replace"]})
		case "text.clear":
			s.push(map[string]any{"type": "audio.clear"})
		case "text.done":
			s.push(map[string]any{"type": "audio.delta", "delta": "AP+A"})
			s.push(map[string]any{"type": "audio.done", "trace_id": "native"})
		}
		return nil
	}
	return s
}

type sourceResult struct {
	item inputItem
	err  error
}
type producer struct {
	values        chan sourceResult
	closed        chan struct{}
	once          sync.Once
	reads, closes atomic.Int32
}

func newProducer() *producer {
	return &producer{values: make(chan sourceResult, 32), closed: make(chan struct{})}
}
func (p *producer) Next(ctx context.Context) (inputItem, error) {
	p.reads.Add(1)
	select {
	case v := <-p.values:
		return v.item, v.err
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-p.closed:
		return nil, io.EOF
	}
}
func (p *producer) Close() error { p.closes.Add(1); p.once.Do(func() { close(p.closed) }); return nil }

type fixture struct {
	Requests []struct {
		Name string
		Body map[string]any
	}
	Timestamped struct {
		Wire   json.RawMessage
		Output struct {
			Correlation string
			Audio       []int
			DurationMs  float64
			Timestamps  []struct {
				Kind, Value            string
				StartTimeMs, EndTimeMs float64
			}
		}
	}
	InvalidFrames []struct{ Wire, Error string }
}

func loadFixture(t *testing.T) fixture {
	t.Helper()
	data, err := os.ReadFile("../../../fixtures/xai.json")
	if err != nil {
		t.Fatal(err)
	}
	var f fixture
	if err := json.Unmarshal(data, &f); err != nil {
		t.Fatal(err)
	}
	return f
}
func requests() []schema.TtsRequestAsText {
	simple := request()
	custom := request()
	custom.Value.Text, custom.Value.Voice, custom.Value.Model = "Acme Mobile 😀", runtime.Some("existing-custom-voice"), runtime.Some(schema.TtsRequestTextModel{})
	custom.Value.Speed = runtime.Some(0.7)
	custom.Value.TextNormalization.Present, custom.Value.TextNormalization.Value = true, schema.TtsRequestTextTextNormalizationAsFalse{}
	custom.Value.LatencyOptimization.Present, custom.Value.LatencyOptimization.Value = true, schema.TtsRequestTextLatencyOptimizationAsAggressive{}
	custom.Value.Replacements = runtime.Some([]schema.TtsRequestTextReplacementsItem{{Pattern: "Acme Mobile", Replacement: "Acme Mobull"}})
	mp3 := schema.TtsRequestTextOutputMp3{}
	mp3.SampleRateHz.Present, mp3.SampleRateHz.Value = true, schema.TtsRequestTextOutputMp3SampleRateHzAsNumber24000{}
	mp3.BitRateBps.Present, mp3.BitRateBps.Value = true, schema.TtsRequestTextOutputMp3BitRateBpsAsNumber128000{}
	custom.Value.Output.Present, custom.Value.Output.Value = true, schema.TtsRequestTextOutputAsMp3{Value: mp3}
	phone := request()
	phone.Value.Text = "Bonjour"
	phone.Value.Language.Present, phone.Value.Language.Value = true, schema.TtsRequestTextLanguageAsFr{}
	phone.Value.LatencyOptimization.Present, phone.Value.LatencyOptimization.Value = true, schema.TtsRequestTextLatencyOptimizationAsNone{}
	phone.Value.Replacements = runtime.Some([]schema.TtsRequestTextReplacementsItem{})
	mulaw := schema.TtsRequestTextOutputObject{Format: schema.TtsRequestTextOutputObjectFormatAsMulaw{}}
	mulaw.SampleRateHz.Present, mulaw.SampleRateHz.Value = true, schema.TtsRequestTextOutputMp3SampleRateHzAsNumber8000{}
	phone.Value.Output.Present, phone.Value.Output.Value = true, schema.TtsRequestTextOutputAsObject{Value: mulaw}
	timed := request()
	timed.Value.Text, timed.Value.TimestampGranularity = "Acme", runtime.Some(schema.TtsRequestTextTimestampGranularity{})
	timed.Value.LatencyOptimization.Present, timed.Value.LatencyOptimization.Value = true, schema.TtsRequestTextLatencyOptimizationAsModerate{}
	timed.Value.TextNormalization.Present, timed.Value.TextNormalization.Value = true, schema.TtsRequestTextTextNormalizationAsTrue{}
	pcm := schema.TtsRequestTextOutputObject{Format: schema.TtsRequestTextOutputObjectFormatAsPcm{}}
	pcm.SampleRateHz.Present, pcm.SampleRateHz.Value = true, schema.TtsRequestTextOutputMp3SampleRateHzAsNumber48000{}
	timed.Value.Output.Present, timed.Value.Output.Value = true, schema.TtsRequestTextOutputAsObject{Value: pcm}
	return []schema.TtsRequestAsText{simple, custom, phone, timed}
}

func TestSharedRequestsAndNativeChunkTiming(t *testing.T) {
	f, bindings := loadFixture(t), requests()
	equal(t, len(bindings), len(f.Requests))
	for i, fixture := range f.Requests {
		t.Run(fixture.Name, func(t *testing.T) {
			r := bindings[i]
			timed := r.Value.TimestampGranularity.Present
			b := &body{chunks: [][]byte{{0, 255}, {128}}}
			media, accept := "Audio/Mpeg; charset=binary", "audio/*, application/octet-stream"
			if timed {
				b.chunks, media, accept = [][]byte{f.Timestamped.Wire}, "application/json", "application/json"
			}
			var called atomic.Int32
			backend := transportFunc(func(req *http.Request) (*http.Response, error) {
				called.Add(1)
				equal(t, req.Method, "POST")
				equal(t, req.URL.String(), "https://proxy.test/native%2Fpath/v1/tts?tenant=a%2Bb")
				equal(t, req.Header, http.Header{"Authorization": {"Bearer fixture"}, "Content-Type": {"application/json"}, "Accept": {accept}})
				var payload map[string]any
				if err := json.NewDecoder(req.Body).Decode(&payload); err != nil {
					return nil, err
				}
				equal(t, payload, fixture.Body)
				return &http.Response{StatusCode: 200, Header: http.Header{"Content-TYPE": {media}}, Body: b}, nil
			})
			input, err := Synthesize(deadline(t), r, Options{Auth: authenticated(), Transport: backend, BaseURL: "https://proxy.test/native%2Fpath/?tenant=a%2Bb"})
			if err != nil {
				t.Fatal(err)
			}
			defer input.Close()
			equal(t, called.Load(), int32(0))
			got, err := collect(deadline(t), input)
			if err != nil {
				t.Fatal(err)
			}
			expected := []out.SynthesisItem{out.SynthesisItemAsBytes{Value: []byte{0, 255}}, out.SynthesisItemAsBytes{Value: []byte{128}}}
			if timed {
				value := f.Timestamped.Output
				equal(t, value.Correlation, "chunk")
				audio := make([]byte, len(value.Audio))
				for i, b := range value.Audio {
					audio[i] = byte(b)
				}
				marks := make([]out.CharacterTimestamp, len(value.Timestamps))
				for i, mark := range value.Timestamps {
					equal(t, mark.Kind, "character")
					marks[i] = out.CharacterTimestamp{Value: mark.Value, StartTimeMs: mark.StartTimeMs, EndTimeMs: mark.EndTimeMs}
				}
				expected = []out.SynthesisItem{out.SynthesisItemAsChunk{Value: out.TimestampedAudio{Audio: audio, DurationMs: runtime.Some(value.DurationMs), Timestamps: marks}}}
			}
			equal(t, got, expected)
			equal(t, b.closes.Load(), int32(1))
		})
	}
}
