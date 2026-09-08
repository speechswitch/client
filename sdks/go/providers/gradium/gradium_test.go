package gradium

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"os"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/gradium"
	out "github.com/speechswitch/client/sdks/go/generated/gradium_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

var testAuth = auth.Auth{Gradium: runtime.Some(auth.AuthElevenlabs{ApiKey: runtime.Some("test-key")})}

func request() schema.TtsRequest {
	return schema.TtsRequest{Voice: "existing-custom", Text: schema.TtsRequestTextAsString{Value: "Hello"}, Output: schema.TtsRequestOutputAsPcm{}}
}
func text(s string) Input { return schema.TtsRequestTextAsyncIterableItemAsString{Value: s} }
func equal(t *testing.T, actual, expected any) {
	t.Helper()
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("got %#v, want %#v", actual, expected)
	}
}
func wait(t *testing.T, done <-chan struct{}) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("operation did not settle")
	}
}
func errorText(t *testing.T, err error, expected string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected %q, got nil", expected)
	}
	equal(t, err.Error(), expected)
}
func jsonValue(t *testing.T, value any) any {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var result any
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatal(err)
	}
	return result
}

type fixtures struct {
	HTTP []struct {
		Request  map[string]any
		Settings map[string]any
	}
	Text struct {
		Input    []any
		Messages []map[string]any
	}
	Timeline []struct {
		Packet map[string]any
		Item   map[string]any
	}
}

func loadFixtures(t *testing.T) fixtures {
	t.Helper()
	data, err := os.ReadFile("../../../fixtures/gradium.json")
	if err != nil {
		t.Fatal(err)
	}
	var v fixtures
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatal(err)
	}
	return v
}
func requests() []schema.TtsRequest {
	a, b, c, d := request(), request(), request(), request()
	b.Model = runtime.Some(schema.TtsRequestModel(schema.TtsRequestModelAsGradiumTtsBeta{}))
	b.Output = schema.TtsRequestOutputAsObject{Value: schema.TtsRequestOutputObject{Format: schema.TtsRequestOutputObjectFormatAsMulaw{}, SampleRateHz: runtime.Some(schema.TtsRequestOutputPcmSampleRateHzNumber8000{})}}
	b.Temperature, b.VoiceGuidance, b.PacingBias = runtime.Some(float64(0)), runtime.Some(float64(10)), runtime.Some(float64(-5))
	b.TextNormalization = runtime.Some(schema.TtsRequestTextNormalization(schema.TtsRequestTextNormalizationAsFalse{}))
	c.Output = schema.TtsRequestOutputAsOggOpus{}
	c.TextNormalization = runtime.Some(schema.TtsRequestTextNormalization(schema.TtsRequestTextNormalizationAsObjecte21202a8{Value: schema.TtsRequestTextNormalizationObjecte21202a8{Locale: schema.TtsRequestTextNormalizationObjecte21202a8LocaleAsFrCh{}}}))
	d.Output = schema.TtsRequestOutputAsWav{}
	d.Temperature, d.PacingBias = runtime.Some(1.5), runtime.Some(float64(5))
	d.TextNormalization = runtime.Some(schema.TtsRequestTextNormalization(schema.TtsRequestTextNormalizationAsObject81d1078f{Value: schema.TtsRequestTextNormalizationObject81d1078f{Rules: []schema.TtsRequestTextNormalizationObject81d1078fRulesItem{schema.TtsRequestTextNormalizationObject81d1078fRulesItemAsCurrencyFrCh{}, schema.TtsRequestTextNormalizationObject81d1078fRulesItemAsUrlFr{}, schema.TtsRequestTextNormalizationObject81d1078fRulesItemAsAlNum{}}}}))
	return []schema.TtsRequest{a, b, c, d}
}

type source struct {
	items           []Input
	failure         error
	stall           bool
	reads           atomic.Int32
	closes          atomic.Int32
	waiting, closed chan struct{}
	waitingOnce     sync.Once
	closeFn         func()
	nextFn          func(context.Context) (Input, error)
}

func newSource(items ...Input) *source {
	return &source{items: items, waiting: make(chan struct{}), closed: make(chan struct{})}
}
func (s *source) Next(ctx context.Context) (Input, error) {
	s.reads.Add(1)
	if s.nextFn != nil {
		return s.nextFn(ctx)
	}
	if len(s.items) != 0 {
		v := s.items[0]
		s.items = s.items[1:]
		return v, nil
	}
	if s.failure != nil {
		return nil, s.failure
	}
	if s.stall {
		s.waitingOnce.Do(func() { close(s.waiting) })
		<-ctx.Done()
		return nil, ctx.Err()
	}
	return nil, io.EOF
}
func (s *source) Close() error {
	if s.closes.Add(1) == 1 {
		if s.closeFn != nil {
			s.closeFn()
		}
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
	sends    atomic.Int32
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
	s.sends.Add(1)
	if s.onSend != nil {
		return s.onSend(ctx, value)
	}
	switch value["type"] {
	case "setup":
		s.put(map[string]any{"type": "ready", "request_id": "req"})
	case "text":
		s.put(map[string]any{"type": "audio", "audio": "AP8="})
	case "end_of_stream":
		s.put(map[string]any{"type": "end_of_stream"})
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

func TestSharedSettingsOnHTTPAndSocket(t *testing.T) {
	fixtures := loadFixtures(t)
	cases := requests()
	equal(t, len(cases), len(fixtures.HTTP))
	for i, r := range cases {
		b := &body{Reader: bytes.NewReader([]byte{0, 255})}
		stream, err := Synthesize(context.Background(), r, Options{Auth: testAuth, BaseURL: "https://proxy.invalid/a%2Fb/api/?tenant=one", Transport: transport(func(req *http.Request) (*http.Response, error) {
			equal(t, req.URL.String(), "https://proxy.invalid/a%2Fb/api/post/speech/tts?tenant=one")
			equal(t, req.Method, "POST")
			equal(t, req.Header, http.Header{"Content-Type": {"application/json"}, "X-Api-Key": {"test-key"}})
			var actual map[string]any
			if err := json.NewDecoder(req.Body).Decode(&actual); err != nil {
				t.Fatal(err)
			}
			equal(t, actual["text"], "Hello")
			equal(t, actual["only_audio"], true)
			var config any
			if err := json.Unmarshal([]byte(actual["json_config"].(string)), &config); err != nil {
				t.Fatal(err)
			}
			actual["json_config"] = config
			delete(actual, "text")
			delete(actual, "only_audio")
			equal(t, actual, fixtures.HTTP[i].Settings)
			return &http.Response{StatusCode: 200, Body: b}, nil
		})})
		if err != nil {
			t.Fatal(err)
		}
		values, err := collect(stream)
		if err != nil {
			t.Fatal(err)
		}
		equal(t, values, []out.SynthesisItem{out.SynthesisItemAsBytes{Value: []byte{0, 255}}})
		equal(t, b.closes.Load(), int32(1))
		socket := newSocket()
		stream, err = Synthesize(context.Background(), r, Options{WebSocket: socket})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := collect(stream); err != nil {
			t.Fatal(err)
		}
		setup := socket.messages()[0]
		equal(t, setup["type"], "setup")
		equal(t, setup["close_ws_on_eos"], true)
		equal(t, setup["retry_for_s"], float64(0))
		delete(setup, "type")
		delete(setup, "close_ws_on_eos")
		delete(setup, "retry_for_s")
		equal(t, setup, fixtures.HTTP[i].Settings)
	}
}

func TestSharedBufferedTextAndFlush(t *testing.T) {
	fixtures := loadFixtures(t)
	items := []Input{}
	for _, item := range fixtures.Text.Input {
		if v, ok := item.(string); ok {
			items = append(items, text(v))
		} else {
			items = append(items, schema.TtsRequestTextAsyncIterableItemAsFlush{})
		}
	}
	src := newSource(items...)
	socket := newSocket()
	r := request()
	r.Text = schema.TtsRequestTextAsAsyncIterable{Value: src}
	stream, err := Synthesize(context.Background(), r, Options{WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := collect(stream); err != nil {
		t.Fatal(err)
	}
	equal(t, socket.messages()[1:], fixtures.Text.Messages)
	wait(t, src.closed)
	equal(t, src.closes.Load(), int32(1))
	for _, items := range [][]Input{nil, {text(""), text(" "), text("\ufeff")}, {text("abc<flush>")}, {text("word\u0085next ")}} {
		src := newSource(items...)
		socket := newSocket()
		r.Text = schema.TtsRequestTextAsAsyncIterable{Value: src}
		stream, err := Synthesize(context.Background(), r, Options{WebSocket: socket})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := collect(stream); err != nil {
			t.Fatal(err)
		}
		messages := socket.messages()
		equal(t, messages[len(messages)-1], map[string]any{"type": "end_of_stream"})
		if len(items) == 0 || len(items) == 3 {
			equal(t, len(messages), 2)
		}
		if len(items) == 1 {
			equal(t, messages[1]["text"], strings.TrimRight(items[0].(schema.TtsRequestTextAsyncIterableItemAsString).Value, space))
		}
	}
}

func TestAllFormatsAndPointerRepresentations(t *testing.T) {
	rates := []schema.TtsRequestOutputPcmSampleRateHz{schema.TtsRequestOutputPcmSampleRateHzAsNumber8000{}, schema.TtsRequestOutputPcmSampleRateHzAsNumber16000{}, schema.TtsRequestOutputPcmSampleRateHzAsNumber22050{}, schema.TtsRequestOutputPcmSampleRateHzAsNumber24000{}, schema.TtsRequestOutputPcmSampleRateHzAsNumber44100{}, schema.TtsRequestOutputPcmSampleRateHzAsNumber48000{}}
	for _, rate := range rates {
		r := request()
		r.Output = &schema.TtsRequestOutputAsPcm{Value: schema.TtsRequestOutputPcm{SampleRateHz: runtime.Some(rate)}}
		if _, err := schema.ValidateRequest(r); err != nil {
			t.Fatal(err)
		}
		wire, _, _ := settings(r)
		equal(t, wire["output_format"], "pcm_"+strconv.FormatFloat(rate.LiteralValue(), 'f', 0, 64))
	}
	for i, r := range requests() {
		original, _, _ := settings(r)
		switch v := r.Output.(type) {
		case schema.TtsRequestOutputAsPcm:
			r.Output = &v
		case schema.TtsRequestOutputAsObject:
			r.Output = &v
		case schema.TtsRequestOutputAsOggOpus:
			r.Output = &v
		case schema.TtsRequestOutputAsWav:
			r.Output = &v
		}
		switch v := r.TextNormalization.Value.(type) {
		case schema.TtsRequestTextNormalizationAsFalse:
			r.TextNormalization.Value = &v
		case schema.TtsRequestTextNormalizationAsObjecte21202a8:
			r.TextNormalization.Value = &v
		case schema.TtsRequestTextNormalizationAsObject81d1078f:
			r.TextNormalization.Value = &v
		}
		r.Text = &schema.TtsRequestTextAsString{Value: "Hello"}
		if _, err := schema.ValidateRequest(r); err != nil {
			t.Fatal(err)
		}
		wire, complete, input := settings(r)
		equal(t, wire, original)
		equal(t, complete, "Hello")
		equal(t, input, nil)
		if i == 0 {
			r.TextNormalization = runtime.Optional[schema.TtsRequestTextNormalization]{Value: (*schema.TtsRequestTextNormalizationAsFalse)(nil)}
			wire, _, _ = settings(r)
			equal(t, wire, original)
		}
	}
	r := request()
	r.Output = schema.TtsRequestOutputAsObject{Value: schema.TtsRequestOutputObject{Format: schema.TtsRequestOutputObjectFormatAsAlaw{}}}
	wire, _, _ := settings(r)
	equal(t, wire["output_format"], "alaw_8000")
}
func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestGeneratedValidationAndPublicOptionsBeforeIO(t *testing.T) {
	cases := []schema.TtsRequest{}
	for _, n := range []float64{-0.1, 1.51, math.NaN(), math.Inf(1)} {
		r := request()
		r.Temperature = runtime.Some(n)
		cases = append(cases, r)
	}
	r := request()
	r.Voice = ""
	cases = append(cases, r)
	r = request()
	r.TextNormalization = runtime.Some(schema.TtsRequestTextNormalization(schema.TtsRequestTextNormalizationAsObject81d1078f{}))
	cases = append(cases, r)
	r = request()
	r.Output = (*schema.TtsRequestOutputAsPcm)(nil)
	cases = append(cases, r)
	r = request()
	r.Model = runtime.Some(schema.TtsRequestModel(nil))
	cases = append(cases, r)
	for _, r := range cases {
		socket := newSocket()
		_, expected := schema.ValidateRequest(r)
		if expected == nil {
			t.Fatal("invalid fixture passed generated validation")
		}
		_, err := Synthesize(context.Background(), r, Options{WebSocket: socket})
		errorText(t, err, expected.Error())
		equal(t, socket.sends.Load(), int32(0))
	}
	for _, item := range []Input{nil, (*schema.TtsRequestTextAsyncIterableItemAsString)(nil)} {
		src := newSource(item)
		r := request()
		r.Text = schema.TtsRequestTextAsAsyncIterable{Value: src}
		validate, err := schema.ValidateRequest(r)
		if err != nil {
			t.Fatal(err)
		}
		expected := validate(item)
		if expected == nil {
			t.Fatal("invalid input fixture passed generated validation")
		}
		socket := newSocket()
		stream, err := Synthesize(context.Background(), r, Options{WebSocket: socket})
		if err != nil {
			t.Fatal(err)
		}
		_, err = collect(stream)
		errorText(t, err, expected.Error())
		equal(t, len(socket.messages()), 1)
		wait(t, src.closed)
	}
	for _, c := range []struct {
		options Options
		message string
	}{{Options{MaxJSONBytes: -1}, "Gradium MaxJSONBytes must be a positive uint32 value"}, {Options{MaxMessageBytes: -1}, "Gradium MaxMessageBytes must be a positive uint32 value"}, {Options{SetupRetryMs: runtime.Some(int64(-1))}, "Gradium SetupRetryMs must be a non-negative safe integer"}, {Options{SetupRetryMs: runtime.Some(int64(9007199254740992))}, "Gradium SetupRetryMs must be a non-negative safe integer"}} {
		_, err := Synthesize(context.Background(), request(), c.options)
		errorText(t, err, c.message)
	}
}
