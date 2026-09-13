package typecast

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"os"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/typecast"
	out "github.com/speechswitch/client/sdks/go/generated/typecast_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) Do(r *http.Request) (*http.Response, error) { return f(r) }

type step struct {
	data []byte
	err  error
}
type body struct {
	steps           []step
	stall           bool
	reading, closed chan struct{}
	once            sync.Once
	reads, closes   atomic.Int32
	closeError      error
}

func newBody(steps ...step) *body {
	return &body{steps: steps, reading: make(chan struct{}, 1), closed: make(chan struct{})}
}
func (b *body) Read(dst []byte) (int, error) {
	b.reads.Add(1)
	if len(b.steps) > 0 {
		s := &b.steps[0]
		n := copy(dst, s.data)
		s.data = s.data[n:]
		if len(s.data) > 0 {
			return n, nil
		}
		err := s.err
		b.steps = b.steps[1:]
		return n, err
	}
	if b.stall {
		select {
		case b.reading <- struct{}{}:
		default:
		}
		<-b.closed
	}
	return 0, io.EOF
}
func (b *body) Close() error {
	b.closes.Add(1)
	b.once.Do(func() { close(b.closed) })
	return b.closeError
}
func equal(t *testing.T, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v; want %#v", got, want)
	}
}
func authConfig() auth.Auth {
	a := auth.Auth{}
	a.Typecast.Present = true
	a.Typecast.Value.ApiKey = runtime.Some("fixture")
	return a
}
func request() schema.TtsRequestAsSsfmV30TextVoicec9d5257e {
	return schema.TtsRequestAsSsfmV30TextVoicec9d5257e{Value: schema.TtsRequestSsfmV30TextVoicec9d5257e{Text: "Hi", Voice: "uc_voice"}}
}
func timed() schema.TtsRequestAsSsfmV30TextVoiceda7d6fa9 {
	return schema.TtsRequestAsSsfmV30TextVoiceda7d6fa9{Value: schema.TtsRequestSsfmV30TextVoiceda7d6fa9{Text: "Hi", Voice: "uc_voice", TimestampGranularity: schema.TtsRequestSsfmV21TextVoicec8409957TimestampGranularityAsWord{}}}
}
func options(b *body, media string, status int) Options {
	return Options{Auth: authConfig(), Transport: transportFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: status, Header: http.Header{"cOnTeNt-TyPe": {media}}, Body: b}, nil
	})}
}
func collect(t *testing.T, stream runtime.Input[out.SynthesisItem]) ([]out.SynthesisItem, error) {
	t.Helper()
	defer stream.Close()
	items := []out.SynthesisItem{}
	for {
		item, err := stream.Next(context.Background())
		if err == io.EOF {
			return items, nil
		}
		if err != nil {
			return items, err
		}
		items = append(items, item)
	}
}

type fixtures struct {
	Requests []struct {
		Name, Path, Accept string
		Body               map[string]any
	}
	TimestampResponse json.RawMessage
	Timestamps        []struct {
		Kind, Value            string
		StartTimeMs, EndTimeMs float64
	}
}

func shared(t *testing.T) fixtures {
	t.Helper()
	data, err := os.ReadFile("../../../fixtures/typecast.json")
	if err != nil {
		t.Fatal(err)
	}
	var f fixtures
	if err := json.Unmarshal(data, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

func TestSharedWireRequestsAndNativeOutput(t *testing.T) {
	f := shared(t)
	requests := fixtureRequests()
	equal(t, len(requests), len(f.Requests))
	for i, r := range requests {
		for _, pointer := range []bool{false, true} {
			t.Run(f.Requests[i].Name+"/"+map[bool]string{false: "value", true: "pointer"}[pointer], func(t *testing.T) {
				input := r
				if pointer {
					p := reflect.New(reflect.TypeOf(r))
					p.Elem().Set(reflect.ValueOf(r))
					input = p.Interface().(schema.TtsRequest)
				}
				fixture := f.Requests[i]
				data := []byte{0, 255}
				if fixture.Accept == "application/json" {
					data = f.TimestampResponse
				}
				b := newBody(step{data: data, err: io.EOF})
				o := Options{Auth: authConfig(), Transport: transportFunc(func(req *http.Request) (*http.Response, error) {
					encoded, err := io.ReadAll(req.Body)
					if err != nil {
						t.Fatal(err)
					}
					var wire map[string]any
					if err := json.Unmarshal(encoded, &wire); err != nil {
						t.Fatal(err)
					}
					equal(t, wire, fixture.Body)
					equal(t, req.URL.String(), "https://api.typecast.ai/v1/text-to-speech"+fixture.Path)
					equal(t, req.Method, "POST")
					equal(t, req.Header, http.Header{"X-Api-Key": {"fixture"}, "Content-Type": {"application/json"}, "Accept": {fixture.Accept}})
					if req.GetBody != nil {
						t.Fatal("Request must not expose a replay body")
					}
					return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {fixture.Accept}}, Body: b}, nil
				})}
				stream, err := Synthesize(context.Background(), input, o)
				if err != nil {
					t.Fatal(err)
				}
				items, err := collect(t, stream)
				if err != nil {
					t.Fatal(err)
				}
				var expected out.SynthesisItem = out.SynthesisItemAsBytes{Value: []byte{0, 255}}
				if fixture.Accept == "application/json" {
					envelope := out.TypecastEnvelope{Audio: []byte{0, 255}, DurationMs: 500, Timestamps: []out.TypecastEnvelopeTimestampsItem{}}
					for _, mark := range f.Timestamps {
						if strings.HasSuffix(fixture.Path, "=word") && mark.Kind != "word" || strings.HasSuffix(fixture.Path, "=char") && mark.Kind != "character" {
							continue
						}
						var kind out.TypecastEnvelopeTimestampsItemKind = out.TypecastEnvelopeTimestampsItemKindAsWord{}
						if mark.Kind == "character" {
							kind = out.TypecastEnvelopeTimestampsItemKindAsCharacter{}
						}
						envelope.Timestamps = append(envelope.Timestamps, out.TypecastEnvelopeTimestampsItem{Kind: kind, Value: mark.Value, StartTimeMs: mark.StartTimeMs, EndTimeMs: runtime.Some(mark.EndTimeMs)})
					}
					expected = out.SynthesisItemAsChunk{Value: envelope}
				}
				equal(t, items, []out.SynthesisItem{expected, out.SynthesisItemAsDone{}})
				equal(t, b.closes.Load(), int32(1))
			})
		}
	}
}

func TestTimestampJSONAtEveryByteSplit(t *testing.T) {
	f := shared(t)
	for split := 0; split <= len(f.TimestampResponse); split++ {
		b := newBody(step{data: f.TimestampResponse[:split]}, step{data: f.TimestampResponse[split:], err: io.EOF})
		o := options(b, "Application/JSON; charset=utf-8", 200)
		o.MaxTimestampResponseBytes = len(f.TimestampResponse)
		stream, err := Synthesize(context.Background(), timed(), o)
		if err != nil {
			t.Fatal(err)
		}
		item, err := stream.Next(context.Background())
		if err != nil {
			t.Fatal(split, err)
		}
		envelope := item.(out.SynthesisItemAsChunk).Value
		equal(t, envelope.Audio, []byte{0, 255})
		equal(t, envelope.DurationMs, 500.0)
		equal(t, len(envelope.Timestamps), 1)
		equal(t, envelope.Timestamps[0].Value, "안녕! ")
		equal(t, b.closes.Load(), int32(1))
		remaining, err := collect(t, stream)
		if err != nil {
			t.Fatal(err)
		}
		equal(t, remaining, []out.SynthesisItem{out.SynthesisItemAsDone{}})
	}
}

func TestMalformedTimestampResponses(t *testing.T) {
	f := shared(t)
	var base map[string]any
	if err := json.Unmarshal(f.TimestampResponse, &base); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		field   string
		value   any
		message string
	}{
		{"audio", "", "Invalid Typecast base64 audio"}, {"audio", "AP9=", "Invalid Typecast base64 audio"}, {"audio", "AP8=\n", "Invalid Typecast base64 audio"}, {"audio", true, "Invalid Typecast base64 audio"},
		{"audio_duration", true, "Invalid Typecast timestamp audio metadata"}, {"audio_duration", -1, "Invalid Typecast timestamp audio metadata"}, {"audio_duration", 1e308, "Invalid Typecast timestamp audio metadata"},
		{"audio_format", "mp3", "Invalid Typecast timestamp audio metadata"}, {"words", nil, "Typecast omitted words alignment"}, {"words", []any{nil}, "Invalid Typecast alignment segment"},
		{"characters", []any{map[string]any{"text": "bad", "start": true, "end": 1}}, "Invalid Typecast alignment interval"},
		{"characters", []any{map[string]any{"text": "bad", "start": 1, "end": 0}}, "Invalid Typecast alignment interval"},
		{"characters", []any{map[string]any{"text": "bad", "start": 0, "end": 1e308}}, "Invalid Typecast alignment interval"},
	}
	for _, test := range cases {
		value := map[string]any{}
		for key, item := range base {
			value[key] = item
		}
		value[test.field] = test.value
		data, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		b := newBody(step{data: data})
		stream, err := Synthesize(context.Background(), timed(), options(b, "application/json", 200))
		if err != nil {
			t.Fatal(err)
		}
		items, err := collect(t, stream)
		if err == nil {
			t.Fatal(test)
		}
		equal(t, err.Error(), test.message)
		equal(t, items, []out.SynthesisItem{})
		equal(t, b.closes.Load(), int32(1))
	}
	for _, data := range [][]byte{[]byte("{"), []byte("null"), []byte("[]"), []byte("NaN"), {255}, []byte(`{"audio":"\ud800"}`)} {
		_, err := decodeTimestamps(data, "wav", true, false)
		if err == nil {
			t.Fatal(string(data))
		}
		equal(t, err.Error(), "Invalid Typecast timestamp response")
	}
	delete(base, "characters")
	data, _ := json.Marshal(base)
	_, err := decodeTimestamps(data, "wav", true, false)
	equal(t, err.Error(), "Typecast omitted characters alignment")
	base["characters"] = nil
	data, _ = json.Marshal(base)
	_, err = decodeTimestamps(append([]byte{239, 187, 191}, data...), "wav", true, false)
	equal(t, err, nil)
}

func TestByteLimitAndStatusMediaErrors(t *testing.T) {
	f := shared(t)
	b := newBody(step{data: f.TimestampResponse}, step{data: []byte("unread")})
	o := options(b, "application/json", 200)
	o.MaxTimestampResponseBytes = len(f.TimestampResponse) - 1
	stream, err := Synthesize(context.Background(), timed(), o)
	if err != nil {
		t.Fatal(err)
	}
	items, err := collect(t, stream)
	equal(t, items, []out.SynthesisItem{})
	equal(t, err.Error(), "Typecast timestamp response exceeds MaxTimestampResponseBytes")
	equal(t, b.closes.Load(), int32(1))
	equal(t, b.reads.Load(), int32(1))
	for _, status := range []int{199, 301, 401, 429, 500} {
		b := newBody(step{data: []byte("private")})
		_, err := Synthesize(context.Background(), request(), options(b, "audio/wav", status))
		var native *Error
		if !errors.As(err, &native) {
			t.Fatal(err)
		}
		equal(t, native.Status, status)
		equal(t, b.reads.Load(), int32(0))
		equal(t, b.closes.Load(), int32(1))
	}
	for _, media := range []string{"audio/mpeg", "text/html", "application/json"} {
		b := newBody(step{data: []byte("unread")})
		_, err := Synthesize(context.Background(), request(), options(b, media, 200))
		equal(t, err.Error(), "Typecast returned an unexpected content type")
		equal(t, b.reads.Load(), int32(0))
		equal(t, b.closes.Load(), int32(1))
	}
}

func TestAbsentContextStorageAndRounding(t *testing.T) {
	r := schema.TtsRequestAsSsfmV30TextVoicebb79df90{Value: schema.TtsRequestSsfmV30TextVoicebb79df90{Text: "Hi", Voice: "uc_voice", ContextBefore: runtime.Optional[schema.TtsRequestObjectSegmentsItemSsfmV30TextVoice0e2e956cContextAfter]{Value: schema.TtsRequestObjectSegmentsItemSsfmV30TextVoice0e2e956cContextAfter{Text: "must not leak"}}}}
	settings, err := resolve(r)
	if err != nil {
		t.Fatal(err)
	}
	equal(t, settings.payload["prompt"], map[string]any{"emotion_type": "smart", "previous_text": "", "next_text": ""})
	for _, test := range []struct{ scale, percent float64 }{{0, 0}, {.005, 1}, {math.Nextafter(.005, 0), 0}, {.025, 3}, {2, 200}} {
		settings, err := resolve(schema.TtsRequestAsSsfmV30TextVoice2e7e5231{Value: schema.TtsRequestSsfmV30TextVoice2e7e5231{Text: "Hi", Voice: "tc_voice", VolumeScale: test.scale}})
		if err != nil {
			t.Fatal(err)
		}
		equal(t, settings.payload["output"].(map[string]any)["volume"], test.percent)
	}
}
