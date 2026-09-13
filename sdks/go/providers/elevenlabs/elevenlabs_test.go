package elevenlabs

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/elevenlabs"
	out "github.com/speechswitch/client/sdks/go/generated/elevenlabs_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

var testAuth = auth.Auth{Elevenlabs: runtime.Some(auth.AuthElevenlabs{ApiKey: runtime.Some("test-key")})}

func testContext(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	t.Cleanup(cancel)
	return ctx
}
func equal(t *testing.T, actual, expected any) {
	t.Helper()
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("got %#v, want %#v", actual, expected)
	}
}
func equalJSON(t *testing.T, actual, expected any) {
	t.Helper()
	a, err := json.Marshal(actual)
	if err != nil {
		t.Fatal(err)
	}
	b, err := json.Marshal(expected)
	if err != nil {
		t.Fatal(err)
	}
	var av, bv any
	if err = json.Unmarshal(a, &av); err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(b, &bv); err != nil {
		t.Fatal(err)
	}
	equal(t, av, bv)
}
func wait(t *testing.T, ready <-chan struct{}) {
	t.Helper()
	select {
	case <-ready:
	case <-time.After(3 * time.Second):
		t.Fatal("operation did not finish")
	}
}
func collect(ctx context.Context, s runtime.Input[out.SynthesisItem]) ([]out.SynthesisItem, error) {
	values := []out.SynthesisItem{}
	for {
		value, err := s.Next(ctx)
		if err == io.EOF {
			return values, nil
		}
		if err != nil {
			return nil, err
		}
		values = append(values, value)
	}
}

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) Do(r *http.Request) (*http.Response, error) { return f(r) }

type body struct {
	chunks [][]byte
	err    error
	closes atomic.Int32
	reads  atomic.Int32
}

func (b *body) Read(p []byte) (int, error) {
	b.reads.Add(1)
	if len(b.chunks) == 0 {
		if b.err != nil {
			return 0, b.err
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
func response(b io.ReadCloser) transportFunc {
	return func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: b}, nil
	}
}
func request() schema.TtsRequestAsTextVoice814840b5 {
	return schema.TtsRequestAsTextVoice814840b5{Value: schema.TtsRequestTextVoice814840b5{Model: schema.TtsRequestTextVoice814840b5ModelAsFlashV25{}, Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice814840b5OutputAsMp356cad1fb{}}}
}

type fixtures struct {
	HTTP []struct {
		Name    string
		Request map[string]any
		Path    string
		Query   url.Values
		Body    map[string]any
	}
	Timing []struct {
		Protocol   string
		Alignment  map[string]any
		Timestamps []map[string]any
	}
}

func loadFixtures(t *testing.T) fixtures {
	t.Helper()
	data, err := os.ReadFile("../../../fixtures/elevenlabs.json")
	if err != nil {
		t.Fatal(err)
	}
	var f fixtures
	if err = json.Unmarshal(data, &f); err != nil {
		t.Fatal(err)
	}
	return f
}
func fixtureRequests() []schema.TtsRequest {
	defaults := request()
	controls := request()
	v := &controls.Value
	v.Model = schema.TtsRequestTextVoice814840b5ModelAsFlashV2{}
	v.Text = "雪\n\"hi\""
	v.Language = runtime.Some("ja")
	v.Output = schema.TtsRequestTextVoice814840b5OutputAsPcm{Value: schema.TtsRequestTextVoice814840b5OutputPcm{SampleRateHz: schema.TtsRequestTextVoice814840b5OutputPcmSampleRateHzAsNumber24000{}}}
	v.Stability = runtime.Some(0.0)
	v.VoiceSimilarity = runtime.Some(0.2)
	v.StyleExaggeration = runtime.Some(0.3)
	v.Speed = runtime.Some(0.7)
	v.RandomSeed = runtime.Some(4294967295.0)
	var off schema.TtsRequestTextVoice814840b5LanguageTextNormalization = schema.TtsRequestTextVoice814840b5LanguageTextNormalizationAsFalse{}
	var on schema.TtsRequestTextVoice814840b5LanguageTextNormalization = schema.TtsRequestTextVoice814840b5LanguageTextNormalizationAsTrue{}
	var normOff schema.TtsRequestTextVoice814840b5TextNormalization = schema.TtsRequestTextVoice814840b5TextNormalizationAsFalse{}
	var normOn schema.TtsRequestTextVoice814840b5TextNormalization = schema.TtsRequestTextVoice814840b5TextNormalizationAsTrue{}
	v.VoiceBoost = runtime.Some(off)
	v.LanguageTextNormalization = runtime.Some(on)
	v.TextNormalization = runtime.Some(normOff)
	v.PronunciationDictionaries = runtime.Some([]schema.TtsRequestTextVoice814840b5PronunciationDictionariesItem{{Id: "lex"}, {Id: "lex2", VersionId: runtime.Some("v2")}})
	var before schema.TtsRequestTextVoice814840b5ContextAfter = schema.TtsRequestTextVoice814840b5ContextAfterAsText{}
	var after schema.TtsRequestTextVoice814840b5ContextAfter = schema.TtsRequestTextVoice814840b5ContextAfterAsObject{Value: schema.TtsRequestTextVoice814840b5ContextAfterObject{RequestIds: []string{"next"}}}
	v.ContextBefore = runtime.Some(before)
	v.ContextAfter = runtime.Some(after)
	before = schema.TtsRequestTextVoice814840b5ContextAfterAsObject{Value: schema.TtsRequestTextVoice814840b5ContextAfterObject{RequestIds: []string{"1", "2", "3"}}}
	after = schema.TtsRequestTextVoice814840b5ContextAfterAsText{Value: schema.TtsRequestTextVoice814840b5ContextAfterText{Text: "after"}}
	maximum := schema.TtsRequestAsMultilingualV2TextVoice2ee6cad1{Value: schema.TtsRequestMultilingualV2TextVoice2ee6cad1{Voice: "v", Text: "Hello", Output: schema.TtsRequestTextVoice814840b5OutputAsWav{Value: schema.TtsRequestTextVoice814840b5OutputWav{SampleRateHz: schema.TtsRequestTextVoice814840b5OutputPcmSampleRateHzAsNumber48000{}}}, ContextBefore: runtime.Some(before), ContextAfter: runtime.Some(after), PronunciationDictionaries: runtime.Some([]schema.TtsRequestTextVoice814840b5PronunciationDictionariesItem{})}}
	v3 := schema.TtsRequestAsElevenV3TextVoicec3eabebc{Value: schema.TtsRequestElevenV3TextVoicec3eabebc{Voice: "v", Text: "Hello", Language: runtime.Some("en"), Output: schema.TtsRequestTextVoice814840b5OutputAsMp31de777c9{}, Stability: runtime.Some(0.5), RandomSeed: runtime.Some(0.0), TextNormalization: runtime.Some(normOn)}}
	paired, opus, mulaw, alaw := request(), request(), request(), request()
	paired.Value.Voice, opus.Value.Voice, mulaw.Value.Voice, alaw.Value.Voice = "v", "v", "v", "v"
	paired.Value.Output = schema.TtsRequestTextVoice814840b5OutputAsMp34def27fa{}
	opus.Value.Output = schema.TtsRequestTextVoice814840b5OutputAsOggOpus{}
	mulaw.Value.Output = schema.TtsRequestTextVoice814840b5OutputAsObject{Value: schema.TtsRequestTextVoice814840b5OutputObject{Format: schema.TtsRequestTextVoice814840b5OutputObjectFormatAsMulaw{}}}
	alaw.Value.Output = schema.TtsRequestTextVoice814840b5OutputAsObject{Value: schema.TtsRequestTextVoice814840b5OutputObject{Format: schema.TtsRequestTextVoice814840b5OutputObjectFormatAsAlaw{}, SampleRateHz: runtime.Some(schema.TtsRequestTextVoice814840b5OutputPcmSampleRateHzNumber8000{})}}
	var latency schema.TtsRequestTextVoice814840b5LatencyOptimization = schema.TtsRequestTextVoice814840b5LatencyOptimizationAsModerate{}
	paired.Value.LatencyOptimization = runtime.Some(latency)
	latency = schema.TtsRequestTextVoice814840b5LatencyOptimizationAsStrong{}
	opus.Value.LatencyOptimization = runtime.Some(latency)
	latency = schema.TtsRequestTextVoice814840b5LatencyOptimizationAsAggressive{}
	mulaw.Value.LatencyOptimization = runtime.Some(latency)
	latency = schema.TtsRequestTextVoice814840b5LatencyOptimizationAsNone{}
	alaw.Value.LatencyOptimization = runtime.Some(latency)
	var normalized schema.TtsRequestTextVoice1aa1b026TimestampText = schema.TtsRequestTextVoice1aa1b026TimestampTextAsNormalized{}
	timed := schema.TtsRequestAsTextVoice6596490e{Value: schema.TtsRequestTextVoice6596490e{Model: defaults.Value.Model, Voice: "v", Text: "Hello", Output: defaults.Value.Output, TimestampText: runtime.Some(normalized)}}
	wav := schema.TtsRequestAsElevenV3TextVoicede803f4c{Value: schema.TtsRequestElevenV3TextVoicede803f4c{Voice: "v", Text: "Hello", Output: schema.TtsRequestTextVoice814840b5OutputAsWav{Value: schema.TtsRequestTextVoice814840b5OutputWav{SampleRateHz: schema.TtsRequestTextVoice814840b5OutputPcmSampleRateHzAsNumber16000{}}}}}
	return []schema.TtsRequest{defaults, controls, maximum, v3, paired, opus, mulaw, alaw, timed, wav}
}
func TestSharedHTTPFixtures(t *testing.T) {
	f := loadFixtures(t)
	requests := fixtureRequests()
	equal(t, len(requests), len(f.HTTP))
	for i, fixture := range f.HTTP {
		t.Run(fixture.Name, func(t *testing.T) {
			timed := fixture.Request["timestampGranularity"] != nil
			data := []byte{0, 255}
			if timed {
				data, _ = json.Marshal(map[string]any{"audio_base64": "AP8=", "alignment": f.Timing[0].Alignment, "normalized_alignment": f.Timing[0].Alignment})
			}
			b := &body{chunks: [][]byte{data[:1], {}, data[1:]}}
			transport := transportFunc(func(r *http.Request) (*http.Response, error) {
				equal(t, r.Method, "POST")
				equal(t, r.URL.EscapedPath(), "/p%20x"+fixture.Path)
				expected := url.Values{"trace": {"1"}}
				for key, values := range fixture.Query {
					expected[key] = values
				}
				equal(t, r.URL.Query(), expected)
				equal(t, r.Header.Get("xi-api-key"), "test-key")
				equal(t, r.Header.Get("content-type"), "application/json")
				var wire any
				if err := json.NewDecoder(r.Body).Decode(&wire); err != nil {
					t.Fatal(err)
				}
				equalJSON(t, wire, fixture.Body)
				return &http.Response{StatusCode: 200, Header: http.Header{}, Body: b}, nil
			})
			s, err := Synthesize(testContext(t), requests[i], Options{Auth: testAuth, Transport: transport, BaseURL: "https://proxy.invalid/p%20x?trace=1&seed=42&single_use_token=stale&api_key=stale&output_format=wav_8000&optimize_streaming_latency=4"})
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			equal(t, b.reads.Load(), int32(0))
			values, err := collect(testContext(t), s)
			if err != nil {
				t.Fatal(err)
			}
			if !timed {
				equal(t, values, []out.SynthesisItem{out.SynthesisItemAsBytes{Value: []byte{0}}, out.SynthesisItemAsBytes{Value: []byte{255}}})
			} else {
				equal(t, values, []out.SynthesisItem{out.SynthesisItemAsChunk{Value: out.TimestampedAudio{Audio: []byte{0, 255}, Timestamps: []out.CharacterTimestamp{{Value: "雪", StartTimeMs: 0, EndTimeMs: 20}, {Value: "!", StartTimeMs: 20, EndTimeMs: 40}}}}})
			}
			equal(t, b.closes.Load(), int32(1))
		})
	}
}
func TestNDJSONEveryUTF8Split(t *testing.T) {
	f := loadFixtures(t)
	line, _ := json.Marshal(map[string]any{"audio_base64": "AQ==", "alignment": f.Timing[0].Alignment, "normalized_alignment": f.Timing[0].Alignment})
	data := append([]byte("\xef\xbb\xbf\r\n"), line...)
	data = append(data, []byte("\r\n\n")...)
	data = append(data, line...)
	for split := 0; split <= len(data); split++ {
		b := &body{chunks: [][]byte{data[:split], data[split:]}}
		s, err := Synthesize(testContext(t), fixtureRequests()[8], Options{Auth: testAuth, Transport: response(b), MaxJSONBytes: len(line) + 1})
		if err != nil {
			t.Fatal(err)
		}
		values, err := collect(testContext(t), s)
		s.Close()
		if err != nil {
			t.Fatalf("split %d: %v", split, err)
		}
		equal(t, len(values), 2)
		equal(t, values[0], values[1])
		equal(t, b.closes.Load(), int32(1))
	}
}
func TestErrorsLimitsAndValidation(t *testing.T) {
	for _, tc := range []struct {
		data  string
		limit int
		timed bool
		want  string
	}{
		{"", 128, false, "ElevenLabs returned no audio bytes"}, {"\n", 128, true, "ElevenLabs returned no timestamped audio chunks"},
		{strings.Repeat("x", 33), 32, true, "ElevenLabs response exceeds MaxJSONBytes"}, {"{\"audio_base64\":\"!\"}", 128, true, "ElevenLabs returned invalid base64 audio"},
		{"{\"audio_base64\":\"AQ==\",\"normalized_alignment\":{\"characters\":[\"x\"],\"character_start_times_seconds\":[1e308],\"character_end_times_seconds\":[1e308]}}", 1024, true, "ElevenLabs returned invalid character timing"},
	} {
		b := &body{chunks: [][]byte{[]byte(tc.data)}}
		var r schema.TtsRequest = request()
		if tc.timed {
			r = fixtureRequests()[8]
		}
		s, err := Synthesize(testContext(t), r, Options{Auth: testAuth, Transport: response(b), MaxJSONBytes: tc.limit})
		if err != nil {
			t.Fatal(err)
		}
		_, err = collect(testContext(t), s)
		s.Close()
		if err == nil {
			t.Fatal("expected error")
		}
		equal(t, err.Error(), tc.want)
		equal(t, b.closes.Load(), int32(1))
	}
	b := &body{chunks: [][]byte{[]byte(`{"detail":{"status":"quota_exceeded","message":"No quota"}}`)}}
	_, err := Synthesize(testContext(t), request(), Options{Auth: testAuth, Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 429, Header: http.Header{"Request-Id": {"trace"}}, Body: b}, nil
	})})
	var failure *Error
	if !errors.As(err, &failure) {
		t.Fatal(err)
	}
	equal(t, failure.Error(), "ElevenLabs 429: No quota")
	equal(t, failure.ErrorCode, runtime.Some("quota_exceeded"))
	equal(t, failure.RequestID, runtime.Some("trace"))
	equal(t, b.closes.Load(), int32(1))
	for _, seed := range []float64{0.5, math.NaN(), math.Inf(1), 4294967296} {
		r := request()
		r.Value.RandomSeed = runtime.Some(seed)
		_, expected := schema.ValidateRequest(r)
		if expected == nil {
			t.Fatal("generated validator accepted invalid seed")
		}
		_, err := Synthesize(testContext(t), r, Options{Auth: testAuth, Transport: transportFunc(func(*http.Request) (*http.Response, error) {
			t.Fatal("invalid request reached transport")
			return nil, nil
		})})
		if err == nil {
			t.Fatal("invalid seed accepted")
		}
		equal(t, err.Error(), expected.Error())
	}
	for _, endpoint := range []string{"file:///tmp/audio", "https://user:pass@host", "https://host:65536", "https://host/#fragment", "https://host/ a"} {
		_, err := Synthesize(testContext(t), request(), Options{Auth: testAuth, BaseURL: endpoint})
		if err == nil {
			t.Fatal("invalid URL accepted")
		}
		equal(t, err.Error(), "Invalid ElevenLabs endpoint URL")
	}
}
func TestUnreadAndOriginalBodyErrors(t *testing.T) {
	original := errors.New("read failure")
	for _, read := range []bool{false, true} {
		b := &body{err: original}
		s, err := Synthesize(testContext(t), request(), Options{Auth: testAuth, Transport: response(b)})
		if err != nil {
			t.Fatal(err)
		}
		if read {
			_, err = s.Next(testContext(t))
			equal(t, err, original)
		}
		s.Close()
		equal(t, b.closes.Load(), int32(1))
		equal(t, b.reads.Load(), int32(map[bool]int{false: 0, true: 1}[read]))
	}
}

// These helpers are also used by socket/native lifecycle tests.
type source[T any] struct {
	values        []T
	stall         bool
	pulls, closes atomic.Int32
	closed        chan struct{}
	once          sync.Once
	waiting       chan struct{}
}

func newSource[T any](values ...T) *source[T] {
	return &source[T]{values: values, closed: make(chan struct{}), waiting: make(chan struct{}, 1)}
}
func (s *source[T]) Next(ctx context.Context) (T, error) {
	s.pulls.Add(1)
	var zero T
	if len(s.values) > 0 {
		value := s.values[0]
		s.values = s.values[1:]
		return value, nil
	}
	if s.stall {
		select {
		case s.waiting <- struct{}{}:
		default:
		}
		select {
		case <-ctx.Done():
			return zero, ctx.Err()
		case <-s.closed:
			return zero, io.EOF
		}
	}
	return zero, io.EOF
}
func (s *source[T]) Close() error { s.once.Do(func() { s.closes.Add(1); close(s.closed) }); return nil }
func live(input runtime.Input[Input]) schema.TtsRequestAsStreamingTextVoice5024de38 {
	return schema.TtsRequestAsStreamingTextVoice5024de38{Value: schema.TtsRequestStreamingTextVoice5024de38{Model: schema.TtsRequestTextVoice814840b5ModelAsFlashV25{}, Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice5024de38OutputAsMp356cad1fb{}}}
}
func dialogue(input runtime.Input[DialogueInput]) schema.TtsRequestAsElevenV3StreamingTextVoice145c0c5a {
	return schema.TtsRequestAsElevenV3StreamingTextVoice145c0c5a{Value: schema.TtsRequestElevenV3StreamingTextVoice145c0c5a{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice5024de38OutputAsMp356cad1fb{}}}
}
func text(value string) Input {
	return schema.TtsRequestStreamingTextVoice5024de38TextItemAsString{Value: value}
}
func dialogueText(value string) DialogueInput {
	return schema.TtsRequestElevenV3StreamingTextVoice145c0c5aTextItemAsString{Value: value}
}

type socket struct {
	incoming chan socketResult
	closed   chan struct{}
	once     sync.Once
	closes   atomic.Int32
	mutex    sync.Mutex
	sent     []map[string]any
	onSend   func(context.Context, map[string]any) error
}

func newSocket() *socket {
	return &socket{incoming: make(chan socketResult, 32), closed: make(chan struct{})}
}
func (s *socket) Send(ctx context.Context, message runtime.WebSocketMessage) error {
	var v map[string]any
	if err := json.Unmarshal([]byte(message.(runtime.WebSocketText)), &v); err != nil {
		return err
	}
	s.mutex.Lock()
	s.sent = append(s.sent, v)
	s.mutex.Unlock()
	if s.onSend != nil {
		return s.onSend(ctx, v)
	}
	return nil
}
func (s *socket) Receive(ctx context.Context) (runtime.WebSocketMessage, error) {
	select {
	case result := <-s.incoming:
		return result.value, result.err
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-s.closed:
		return nil, io.EOF
	}
}
func (s *socket) Close() error { s.once.Do(func() { s.closes.Add(1); close(s.closed) }); return nil }
func (s *socket) receive(value any) {
	data, _ := json.Marshal(value)
	s.incoming <- socketResult{value: runtime.WebSocketText(data)}
}
func (s *socket) messages() []map[string]any {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	return append([]map[string]any{}, s.sent...)
}
