package hume

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
	schema "github.com/speechswitch/client/sdks/go/generated/hume"
	out "github.com/speechswitch/client/sdks/go/generated/hume_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

var testAuth = auth.Auth{Hume: runtime.Some(auth.AuthCartesia{ApiKey: runtime.Some("test-key")})}

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
	data, err := os.ReadFile("../../../fixtures/hume.json")
	if err != nil {
		t.Fatal(err)
	}
	var value fixtures
	if err = json.Unmarshal(data, &value); err != nil {
		t.Fatal(err)
	}
	return value
}
func pcm() schema.TtsRequestOctave1TextOutput {
	return schema.TtsRequestOctave1TextOutput{Format: schema.TtsRequestOctave1TextOutputFormatAsPcm{}}
}
func mp3() schema.TtsRequestOctave1TextOutput {
	return schema.TtsRequestOctave1TextOutput{Format: schema.TtsRequestOctave1TextOutputFormatAsMp3{}}
}
func wav() schema.TtsRequestOctave1TextOutput {
	return schema.TtsRequestOctave1TextOutput{Format: schema.TtsRequestOctave1TextOutputFormatAsWav{}}
}
func request() schema.TtsRequestAsOctave2TextVoice {
	return schema.TtsRequestAsOctave2TextVoice{Value: schema.TtsRequestOctave2TextVoice{Text: "Hello", Voice: "saved", Output: pcm()}}
}
func text(value string) TextInput {
	return schema.TtsRequestOctave1StreamingTextTextItemAsString{Value: value}
}
func streaming(src runtime.Input[TextInput]) schema.TtsRequestAsOctave2StreamingTextVoice {
	return schema.TtsRequestAsOctave2StreamingTextVoice{Value: schema.TtsRequestOctave2StreamingTextVoice{Text: src, Voice: "saved", Output: pcm()}}
}
func requests() []schema.TtsRequest {
	catalog := runtime.Some(schema.TtsRequestOctave1TurnsSpeakersItemObject9c8ccfabVoiceSource(schema.TtsRequestOctave1TurnsSpeakersItemObject9c8ccfabVoiceSourceAsCatalog{}))
	a := schema.TtsRequestAsOctave1TextVoice{Value: schema.TtsRequestOctave1TextVoice{Text: "Hi", Voice: "saved", Output: pcm()}}
	b := schema.TtsRequestAsOctave2TextVoiceName{Value: schema.TtsRequestOctave2TextVoiceName{Text: "Hi", VoiceName: "Ava", VoiceSource: catalog, Output: mp3()}}
	c := schema.TtsRequestAsOctave2Turns{Value: schema.TtsRequestOctave2Turns{Output: wav(), Speakers: []schema.TtsRequestOctave1TurnsSpeakersItem{schema.TtsRequestOctave1TurnsSpeakersItemAsObject9c8ccfab{Value: schema.TtsRequestOctave1TurnsSpeakersItemObject9c8ccfab{Alias: "a", Voice: "saved"}}}, Turns: []schema.TtsRequestOctave2TurnsContextBeforeTurnsTurnsItem{{Speaker: "a", Text: "Hi"}}}}
	d := request()
	e := schema.TtsRequestAsOctave1Text{Value: schema.TtsRequestOctave1Text{Text: "Hi", VoiceDescription: runtime.Some("A warm narrator"), Output: wav(), ContextBefore: runtime.Some(schema.TtsRequestOctave1TextContextBefore(schema.TtsRequestOctave1TextContextBeforeAsText{Value: schema.TtsRequestOctave1TextContextBeforeText{Text: "Before"}}))}}
	f := schema.TtsRequestAsOctave1TextVoiceName{Value: schema.TtsRequestOctave1TextVoiceName{Text: "Hi", VoiceName: "Ava", VoiceSource: catalog, Instructions: runtime.Some("Whisper"), Output: mp3(), Temperature: runtime.Some(0.1), Speed: runtime.Some(0.25), TrailingSilenceMs: runtime.Some(float64(5000)), SplitTurns: runtime.Some(schema.TtsRequestOctave1TextSplitTurns(schema.TtsRequestOctave1TextSplitTurnsAsFalse{})), LatencyOptimization: runtime.Some(schema.TtsRequestOctave1TurnsLatencyOptimization(schema.TtsRequestOctave1TurnsLatencyOptimizationAsNone{})), ContextBefore: runtime.Some(schema.TtsRequestOctave1TextContextBefore(schema.TtsRequestOctave1TextContextBeforeAsObject{Value: schema.TtsRequestOctave1TextContextBeforeObject{RequestIds: []string{"prior"}}}))}}
	g := schema.TtsRequestAsOctave1Turns{Value: schema.TtsRequestOctave1Turns{Output: mp3(), Speed: runtime.Some(1.2), Speakers: []schema.TtsRequestOctave1TurnsSpeakersItem{schema.TtsRequestOctave1TurnsSpeakersItemAsObject9c8ccfab{Value: schema.TtsRequestOctave1TurnsSpeakersItemObject9c8ccfab{Alias: "a", Voice: "private"}}, schema.TtsRequestOctave1TurnsSpeakersItemAsObjected4f427b{Value: schema.TtsRequestOctave1TurnsSpeakersItemObjected4f427b{Alias: "b", VoiceName: "Ava", VoiceSource: catalog}}}, Turns: []schema.TtsRequestOctave1TurnsContextBeforeTurnsTurnsItem{{Speaker: "a", Text: "Hello", Instructions: runtime.Some("Happy"), TrailingSilenceMs: runtime.Some(float64(250))}, {Speaker: "b", Text: "Hi", Speed: runtime.Some(0.9)}}, ContextBefore: runtime.Some(schema.TtsRequestOctave1TurnsContextBefore(schema.TtsRequestOctave1TurnsContextBeforeAsTurns{Value: schema.TtsRequestOctave1TurnsContextBeforeTurns{Turns: []schema.TtsRequestOctave1TurnsContextBeforeTurnsTurnsItem{{Speaker: "b", Text: "Before", Instructions: runtime.Some("Calm")}}}}))}}
	return []schema.TtsRequest{a, b, c, d, e, f, g}
}
func streamingRequests() []schema.TtsRequest {
	r := requests()
	a := r[0].(schema.TtsRequestAsOctave1TextVoice).Value
	b := r[1].(schema.TtsRequestAsOctave2TextVoiceName).Value
	c := r[2].(schema.TtsRequestAsOctave2Turns).Value
	d := r[3].(schema.TtsRequestAsOctave2TextVoice).Value
	e := r[4].(schema.TtsRequestAsOctave1Text).Value
	f := r[5].(schema.TtsRequestAsOctave1TextVoiceName).Value
	g := r[6].(schema.TtsRequestAsOctave1Turns).Value
	turns2 := []TurnInput{}
	for _, v := range c.Turns {
		turns2 = append(turns2, schema.TtsRequestOctave2StreamingTurnsTurnsItemAsText{Value: v})
	}
	turns1 := []DirectedTurnInput{}
	for _, v := range g.Turns {
		turns1 = append(turns1, schema.TtsRequestOctave1StreamingTurnsTurnsItemAsText{Value: v})
	}
	return []schema.TtsRequest{
		schema.TtsRequestAsOctave1StreamingTextVoice{Value: schema.TtsRequestOctave1StreamingTextVoice{Text: newSource([]TextInput{text(a.Text)}), Voice: a.Voice, Output: a.Output}},
		schema.TtsRequestAsOctave2StreamingTextVoiceName{Value: schema.TtsRequestOctave2StreamingTextVoiceName{Text: newSource([]TextInput{text(b.Text)}), VoiceName: b.VoiceName, VoiceSource: b.VoiceSource, Output: b.Output}},
		schema.TtsRequestAsOctave2StreamingTurns{Value: schema.TtsRequestOctave2StreamingTurns{Turns: newSource(turns2), Speakers: c.Speakers, Output: c.Output}},
		schema.TtsRequestAsOctave2StreamingTextVoice{Value: schema.TtsRequestOctave2StreamingTextVoice{Text: newSource([]TextInput{text(d.Text)}), Voice: d.Voice, Output: d.Output}},
		schema.TtsRequestAsOctave1StreamingText{Value: schema.TtsRequestOctave1StreamingText{Text: newSource([]TextInput{text(e.Text)}), VoiceDescription: e.VoiceDescription, Output: e.Output}},
		schema.TtsRequestAsOctave1StreamingTextVoiceName{Value: schema.TtsRequestOctave1StreamingTextVoiceName{Text: newSource([]TextInput{text(f.Text)}), VoiceName: f.VoiceName, VoiceSource: f.VoiceSource, Instructions: f.Instructions, Output: f.Output, Temperature: f.Temperature, Speed: f.Speed, TrailingSilenceMs: f.TrailingSilenceMs, LatencyOptimization: f.LatencyOptimization}},
		schema.TtsRequestAsOctave1StreamingTurns{Value: schema.TtsRequestOctave1StreamingTurns{Turns: newSource(turns1), Speakers: g.Speakers, Output: g.Output, Speed: g.Speed}},
	}
}
func pointer(value schema.TtsRequest) schema.TtsRequest {
	switch v := value.(type) {
	case schema.TtsRequestAsOctave1Text:
		return &v
	case schema.TtsRequestAsOctave1StreamingText:
		return &v
	case schema.TtsRequestAsOctave1Turns:
		return &v
	case schema.TtsRequestAsOctave1StreamingTurns:
		return &v
	case schema.TtsRequestAsOctave1TextVoice:
		return &v
	case schema.TtsRequestAsOctave1StreamingTextVoice:
		return &v
	case schema.TtsRequestAsOctave1TextVoiceName:
		return &v
	case schema.TtsRequestAsOctave1StreamingTextVoiceName:
		return &v
	case schema.TtsRequestAsOctave2Turns:
		return &v
	case schema.TtsRequestAsOctave2StreamingTurns:
		return &v
	case schema.TtsRequestAsOctave2TextVoice:
		return &v
	case schema.TtsRequestAsOctave2StreamingTextVoice:
		return &v
	case schema.TtsRequestAsOctave2TextVoiceName:
		return &v
	case schema.TtsRequestAsOctave2StreamingTextVoiceName:
		return &v
	}
	panic("unexpected request")
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
	if value["close"] == true {
		s.incoming <- socketResult{err: io.EOF}
	} else if _, present := value["text"]; present {
		s.incoming <- socketResult{value: runtime.WebSocketBinary{0, 255}}
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
func fixtureItem(t *testing.T, item out.SynthesisItem) any {
	t.Helper()
	v, ok := item.(out.SynthesisItemAsTimeline)
	if !ok {
		t.Fatalf("expected timeline, got %T", item)
	}
	e := v.Value
	timestamps := []map[string]any{}
	for _, mark := range e.Timestamps {
		value := map[string]any{"kind": mark.Kind.LiteralValue(), "value": mark.Value, "startTimeMs": mark.StartTimeMs}
		if mark.EndTimeMs.Present {
			value["endTimeMs"] = mark.EndTimeMs.Value
		}
		timestamps = append(timestamps, value)
	}
	result := map[string]any{"correlation": "timeline", "correlationId": e.CorrelationId, "generationId": e.GenerationId, "requestId": e.RequestId, "timestamps": timestamps}
	if e.Audio.Present {
		values := []int{}
		for _, v := range e.Audio.Value {
			values = append(values, int(v))
		}
		result["audio"] = map[string]any{"$bytes": values}
	}
	if e.ChunkIndex.Present {
		result["chunkIndex"] = e.ChunkIndex.Value
	}
	if e.IsLastChunk.Present {
		result["isLastChunk"] = e.IsLastChunk.Value.LiteralValue()
	}
	if e.InputGroupId.Present {
		result["inputGroupId"] = e.InputGroupId.Value
	}
	return jsonValue(t, result)
}
