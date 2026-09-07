package rime

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
	schema "github.com/speechswitch/client/sdks/go/generated/rime"
	out "github.com/speechswitch/client/sdks/go/generated/rime_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func authenticated() auth.Auth {
	var a auth.Auth
	a.Rime.Present = true
	a.Rime.Value.ApiKey = runtime.Some("fixture")
	return a
}
func request() schema.TtsRequestAsCodaTextVoicef75e9756 {
	return schema.TtsRequestAsCodaTextVoicef75e9756{Value: schema.TtsRequestCodaTextVoicef75e9756{Text: "Hello", Voice: "custom-uuid"}}
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
	p.items <- inputResult{value: schema.TtsRequestCodaStreamingTextVoice84ec2db1TextItemAsString{Value: text}}
}
func liveRequest(p runtime.Input[inputItem]) schema.TtsRequestAsCodaStreamingTextVoice33f4bd25 {
	return schema.TtsRequestAsCodaStreamingTextVoice33f4bd25{Value: schema.TtsRequestCodaStreamingTextVoice33f4bd25{Text: p, Voice: "custom-uuid"}}
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

type fixtures struct {
	Requests []struct {
		Name, Accept string
		Body         any
	}
	InvalidFrames []struct{ Wire, Error string }
}

func shared(t *testing.T) fixtures {
	t.Helper()
	data, err := os.ReadFile("../../../fixtures/rime.json")
	if err != nil {
		t.Fatal(err)
	}
	var f fixtures
	if err := json.Unmarshal(data, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

func fixtureRequests() []schema.TtsRequest {
	var webm schema.TtsRequestCodaStreamingTextVoice84ec2db1OutputObject60a95a19Format = &schema.TtsRequestCodaStreamingTextVoice84ec2db1OutputObject60a95a19FormatAsWebmOpus{}
	var codaOutput schema.TtsRequestCodaStreamingTextVoice84ec2db1Output = &schema.TtsRequestCodaStreamingTextVoice84ec2db1OutputAsObject60a95a19{Value: schema.TtsRequestCodaStreamingTextVoice84ec2db1OutputObject60a95a19{Format: webm, SampleRateHz: runtime.Some(48000.0)}}
	arabic := schema.TtsRequestAsCodaTextVoice50d85478{Value: schema.TtsRequestCodaTextVoice50d85478{Voice: "custom-uuid", Text: "مرحبا", Language: &schema.TtsRequestCodaStreamingTextVoice84ec2db1LanguageAsAr{}, Speed: runtime.Some(2.5), Output: runtime.Some(codaOutput)}}
	var yes schema.TtsRequestMistV2StreamingTextVoice03cc8904TextMarkupPauses = &schema.TtsRequestMistV2StreamingTextVoice03cc8904TextMarkupPausesAsTrue{}
	var no schema.TtsRequestMistV2StreamingTextVoice03cc8904TextMarkupPauses = schema.TtsRequestMistV2StreamingTextVoice03cc8904TextMarkupPausesAsFalse{}
	var wav schema.TtsRequestCodaStreamingTextVoice84ec2db1OutputObjectb2df2f24Format = &schema.TtsRequestCodaStreamingTextVoice84ec2db1OutputObjectb2df2f24FormatAsWav{}
	var waveOutput schema.TtsRequestCodaStreamingTextVoice84ec2db1Output = &schema.TtsRequestCodaStreamingTextVoice84ec2db1OutputAsObjectb2df2f24{Value: schema.TtsRequestCodaStreamingTextVoice84ec2db1OutputObjectb2df2f24{Format: wav}}
	english := schema.TtsRequestAsMistV3TextVoice2a5bc5c5{Value: schema.TtsRequestMistV3TextVoice2a5bc5c5{Voice: "cove", Text: "[Hi] <200> {k1Ast0xm}", Speed: runtime.Some(2.0), Output: runtime.Some(waveOutput), TextMarkup: runtime.Some(schema.TtsRequestMistV2StreamingTextVoice03cc8904TextMarkup{Pauses: runtime.Some(yes), Phonemes: runtime.Some(yes), Speeds: runtime.Some([]float64{2, .5})})}}
	var ogg schema.TtsRequestCodaStreamingTextVoice84ec2db1OutputObject60a95a19Format = schema.TtsRequestCodaStreamingTextVoice84ec2db1OutputObject60a95a19FormatAsOggOpus{}
	var oggOutput schema.TtsRequestCodaStreamingTextVoice84ec2db1Output = schema.TtsRequestCodaStreamingTextVoice84ec2db1OutputAsObject60a95a19{Value: schema.TtsRequestCodaStreamingTextVoice84ec2db1OutputObject60a95a19{Format: ogg}}
	spanish := schema.TtsRequestAsMistV3TextVoice3fb6eaa2{Value: schema.TtsRequestMistV3TextVoice3fb6eaa2{Voice: "custom-uuid", Text: "Hola", Output: runtime.Some(oggOutput)}}
	german := schema.TtsRequestAsMistV2TextVoice20785ce4{Value: schema.TtsRequestMistV2TextVoice20785ce4{Voice: "custom-uuid", Text: "Hallo", Language: &schema.TtsRequestMistV2StreamingTextVoice03cc8904LanguageAsDe{}}}
	var es schema.TtsRequestCodaStreamingTextVoice33f4bd25Language = &schema.TtsRequestCodaStreamingTextVoice33f4bd25LanguageAsEs{}
	var mp3 schema.TtsRequestMistV2StreamingTextVoice03cc8904Output = &schema.TtsRequestMistV2StreamingTextVoice03cc8904OutputAsMp3{}
	legacySpanish := schema.TtsRequestAsMistV2TextVoiceae274411{Value: schema.TtsRequestMistV2TextVoiceae274411{Voice: "custom-uuid", Text: "Hola", Language: runtime.Some(es), Speed: runtime.Some(2.0), Output: runtime.Some(mp3), TextNormalization: runtime.Some(no), TextMarkup: runtime.Some(schema.TtsRequestMistV2StreamingTextVoice03cc8904TextMarkup{Phonemes: runtime.Some(yes)})}}
	var mulaw schema.TtsRequestMistV2StreamingTextVoice03cc8904Output = &schema.TtsRequestMistV2StreamingTextVoice03cc8904OutputAsMulaw{}
	french := schema.TtsRequestAsMistV2TextVoice20785ce4{Value: schema.TtsRequestMistV2TextVoice20785ce4{Voice: "custom-uuid", Text: "Bonjour", Language: schema.TtsRequestMistV2StreamingTextVoice03cc8904LanguageAsFr{}, Output: runtime.Some(mulaw)}}
	return []schema.TtsRequest{request(), &arabic, english, &spanish, german, &legacySpanish, french}
}

func TestSharedRequestConversionsAndPointerRepresentations(t *testing.T) {
	cases, fixtures := fixtureRequests(), shared(t)
	equal(t, len(cases), len(fixtures.Requests))
	for i, f := range fixtures.Requests {
		t.Run(f.Name, func(t *testing.T) {
			b := &body{chunks: [][]byte{{0, 255}, {128}}}
			var calls atomic.Int32
			transport := transportFunc(func(r *http.Request) (*http.Response, error) {
				calls.Add(1)
				equal(t, r.Method, "POST")
				equal(t, r.URL.String(), "https://example.test/proxy%2Fraw/v1/rime-tts?tenant=a%2Bb")
				equal(t, r.Header, http.Header{"Authorization": {"Bearer fixture"}, "Content-Type": {"application/json"}, "Accept": {f.Accept}})
				var got any
				if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
					return nil, err
				}
				equal(t, got, f.Body)
				return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {f.Accept}}, Body: b}, nil
			})
			input, err := Synthesize(deadline(t), cases[i], Options{Auth: authenticated(), Transport: transport, BaseURL: "https://example.test/proxy%2Fraw/?tenant=a%2Bb"})
			if err != nil {
				t.Fatal(err)
			}
			defer input.Close()
			equal(t, calls.Load(), int32(0))
			items, err := collect(deadline(t), input)
			if err != nil {
				t.Fatal(err)
			}
			equal(t, items, []out.SynthesisItem{out.SynthesisItemAsBytes{Value: []byte{0, 255}}, out.SynthesisItemAsBytes{Value: []byte{128}}, out.SynthesisItemAsDone{}})
			equal(t, b.closes.Load(), int32(1))
		})
	}
}

func TestSharedInvalidFrames(t *testing.T) {
	for _, f := range shared(t).InvalidFrames {
		t.Run(f.Wire, func(t *testing.T) {
			socket := newSocket()
			socket.received <- socketResult{value: runtime.WebSocketText(f.Wire)}
			input, err := Synthesize(deadline(t), request(), Options{Auth: authenticated(), WebSocket: socket})
			if err != nil {
				t.Fatal(err)
			}
			defer input.Close()
			_, err = input.Next(deadline(t))
			if err == nil {
				t.Fatal("accepted malformed frame")
			}
			equal(t, err.Error(), f.Error)
			await(t, socket.closed)
		})
	}
}

func TestClearFiltersStaleLabelsAndPreservesIndependentSynthesisOrigins(t *testing.T) {
	p, socket := newProducer(), newSocket()
	r := liveRequest(p)
	r.Value.TimestampGranularity = runtime.Some(schema.TtsRequestCodaStreamingTextVoice33f4bd25TimestampGranularity{})
	input, err := Synthesize(deadline(t), r, Options{Auth: authenticated(), WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	pending := next(input, deadline(t))
	p.text("Hello")
	first := sent(t, socket)
	id := first["contextId"].(string)
	equal(t, first, map[string]any{"text": "Hello", "contextId": id})
	for range 2 {
		p.items <- inputResult{value: &schema.TtsRequestCodaStreamingTextVoice84ec2db1TextItemAsFlush{}}
		equal(t, sent(t, socket), map[string]any{"operation": "flush"})
	}
	p.items <- inputResult{value: &schema.TtsRequestCodaStreamingTextVoice84ec2db1TextItemAsClear{}}
	equal(t, take(t, pending), out.SynthesisItemAsClear{})
	equal(t, sent(t, socket), map[string]any{"operation": "clear"})
	pending = next(input, deadline(t))
	p.text("Again")
	fresh := id[:len(id)-1] + "1"
	equal(t, sent(t, socket), map[string]any{"text": "Again", "contextId": fresh})
	for _, packet := range []map[string]any{
		{"type": "chunk", "contextId": id, "data": "AQ=="},
		{"type": "timestamps", "contextId": id, "word_timestamps": map[string]any{"words": []string{"stale"}, "start": []float64{0}, "end": []float64{1}}},
		{"type": "done", "contextId": id},
		{"type": "chunk", "contextId": fresh, "data": "AP8="},
	} {
		socket.packet(packet)
	}
	equal(t, take(t, pending), out.SynthesisItemAsOrdered{Value: out.RimeEnvelope{InputGroupId: runtime.Some(fresh), Audio: runtime.Some([]byte{0, 255}), Timestamps: []out.RimeEnvelopeTimestampsItem{}}})
	for _, word := range []string{"Again", "Next"} {
		socket.packet(map[string]any{"type": "timestamps", "contextId": fresh, "word_timestamps": map[string]any{"words": []string{word}, "start": []float64{0}, "end": []float64{.125}}})
		equal(t, take(t, next(input, deadline(t))), out.SynthesisItemAsOrdered{Value: out.RimeEnvelope{InputGroupId: runtime.Some(fresh), Timestamps: []out.RimeEnvelopeTimestampsItem{{Value: word, StartTimeMs: 0, EndTimeMs: runtime.Some(125.0)}}}})
	}
	for _, group := range []string{fresh, "native-label"} {
		socket.packet(map[string]any{"type": "done", "contextId": group})
		equal(t, take(t, next(input, deadline(t))), out.SynthesisItemAsBatch{Value: out.RimeBatchEvent{InputGroupId: runtime.Some(group)}})
	}
	p.items <- inputResult{err: io.EOF}
	pending = next(input, deadline(t))
	equal(t, sent(t, socket), map[string]any{"operation": "eos"})
	socket.received <- socketResult{err: io.EOF}
	equal(t, take(t, pending), out.SynthesisItemAsDone{})
	await(t, socket.closed)
	_, err = input.Next(deadline(t))
	equal(t, err, io.EOF)
}

func TestNullAfterClearFailsAndNativeErrorsRemainGlobal(t *testing.T) {
	for _, c := range []struct {
		packet  any
		message string
	}{
		{map[string]any{"type": "chunk", "contextId": nil, "data": "AQ=="}, "Rime omitted context identity after clear; stale audio cannot be distinguished"},
		{map[string]any{"type": "error", "message": "native failure"}, "native failure"},
	} {
		socket, p := newSocket(), newProducer()
		p.items <- inputResult{value: schema.TtsRequestCodaStreamingTextVoice84ec2db1TextItemAsClear{}}
		input, err := Synthesize(deadline(t), liveRequest(p), Options{Auth: authenticated(), WebSocket: socket})
		if err != nil {
			t.Fatal(err)
		}
		equal(t, take(t, next(input, deadline(t))), out.SynthesisItemAsClear{})
		socket.packet(c.packet)
		_, err = input.Next(deadline(t))
		if err == nil {
			t.Fatal("accepted failure")
		}
		equal(t, err.Error(), c.message)
		input.Close()
	}
}

func TestEmptyEOSAndNativeDoneOnlyBatch(t *testing.T) {
	for _, batch := range []bool{false, true} {
		socket, p := newSocket(), newProducer()
		p.items <- inputResult{err: io.EOF}
		input, err := Synthesize(deadline(t), liveRequest(p), Options{Auth: authenticated(), WebSocket: socket})
		if err != nil {
			t.Fatal(err)
		}
		pending := next(input, deadline(t))
		equal(t, sent(t, socket), map[string]any{"operation": "eos"})
		if batch {
			socket.packet(map[string]any{"type": "done", "contextId": nil})
			equal(t, take(t, pending), out.SynthesisItemAsBatch{})
			pending = next(input, deadline(t))
		}
		socket.received <- socketResult{err: io.EOF}
		equal(t, take(t, pending), out.SynthesisItemAsDone{})
		await(t, socket.closed)
		input.Close()
	}
}

func TestBackpressuredSendStillReceivesAudio(t *testing.T) {
	socket, p := newSocket(), newProducer()
	socket.blockSend = true
	input, err := Synthesize(deadline(t), liveRequest(p), Options{Auth: authenticated(), WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	pending := next(input, deadline(t))
	p.text("hello")
	sent(t, socket)
	socket.packet(map[string]any{"type": "chunk", "contextId": nil, "data": "AQ=="})
	equal(t, take(t, pending), out.SynthesisItemAsBytes{Value: []byte{1}})
	equal(t, p.reads.Load(), int32(1))
	input.Close()
	await(t, socket.closed)
	await(t, p.closed)
}
