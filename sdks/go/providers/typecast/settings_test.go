package typecast

import (
	"context"
	"errors"
	"math"
	"net/http"
	"os"
	"reflect"
	"strings"
	"testing"

	schema "github.com/speechswitch/client/sdks/go/generated/typecast"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func TestGeneratedValidationBeforeNetwork(t *testing.T) {
	var nilRequest *schema.TtsRequestAsSsfmV30TextVoicec9d5257e
	badText := request()
	badText.Value.Text = ""
	longText := request()
	longText.Value.Text = strings.Repeat("😀", 2001)
	invalidUTF8 := request()
	invalidUTF8.Value.Text = string([]byte{255})
	pitch := request()
	pitch.Value.PitchSemitones = runtime.Some(.5)
	speed := request()
	speed.Value.Speed = runtime.Some(math.NaN())
	seed := request()
	seed.Value.RandomSeed = runtime.Some(4294967296.0)
	voice := request()
	voice.Value.Voice = "not-prefixed"
	output := request()
	output.Value.Output = runtime.Some(schema.TtsRequestSsfmV21TextVoicef82be0f4Output(nil))
	for _, r := range []schema.TtsRequest{nil, nilRequest, badText, longText, invalidUTF8, pitch, speed, seed, voice, output} {
		calls := 0
		o := Options{Auth: authConfig(), Transport: transportFunc(func(*http.Request) (*http.Response, error) { calls++; return nil, errors.New("unexpected network") })}
		_, err := Synthesize(context.Background(), r, o)
		if err == nil {
			t.Fatal(r)
		}
		equal(t, err.Error(), "Invalid typecast TTS request")
		equal(t, calls, 0)
	}
}

func TestCompositionCrossElementConstraints(t *testing.T) {
	speech := schema.TtsRequestObjectSegmentsItemAsSsfmV21TextVoice4e8a729e{Value: schema.TtsRequestObjectSegmentsItemSsfmV21TextVoice4e8a729e{Text: "Hi", Voice: "tc_voice"}}
	long := speech
	long.Value.Text = strings.Repeat("😀", 1001)
	other := speech
	other.Value.Text = strings.Repeat("x", 1000)
	pauses := []schema.TtsRequestObjectSegmentsItem{speech}
	for range 7 {
		pauses = append(pauses, schema.TtsRequestObjectSegmentsItemAsObject{Value: schema.TtsRequestObjectSegmentsItemObject{PauseMs: 10000}})
	}
	cases := [][]schema.TtsRequestObjectSegmentsItem{{schema.TtsRequestObjectSegmentsItemAsObject{Value: schema.TtsRequestObjectSegmentsItemObject{PauseMs: 1}}}, {long, other}, pauses}
	for _, segments := range cases {
		_, err := Synthesize(context.Background(), schema.TtsRequestAsObject{Value: schema.TtsRequestObject{Segments: segments}}, Options{Auth: authConfig()})
		equal(t, err.Error(), "Typecast composition requires speech, at most 2000 total text code points and at most 60000 ms total pauses")
	}
	r := schema.TtsRequestAsObject{Value: schema.TtsRequestObject{Segments: []schema.TtsRequestObjectSegmentsItem{speech, schema.TtsRequestObjectSegmentsItemAsObject{Value: schema.TtsRequestObjectSegmentsItemObject{PauseMs: math.SmallestNonzeroFloat64}}}}}
	_, err := Synthesize(context.Background(), r, Options{Auth: authConfig()})
	equal(t, err.Error(), "Typecast pause cannot be represented as positive seconds")
	long.Value.Text = strings.Repeat("😀", 1000)
	pauses = pauses[:7]
	pauses[0] = long
	pauses = append(pauses, other)
	b := newBody(step{data: []byte("audio")})
	stream, err := Synthesize(context.Background(), schema.TtsRequestAsObject{Value: schema.TtsRequestObject{Segments: pauses}}, options(b, "audio/wav", 200))
	if err != nil {
		t.Fatal(err)
	}
	_, err = collect(t, stream)
	equal(t, err, nil)
	for _, segments := range [][]schema.TtsRequestObjectSegmentsItem{{}, make([]schema.TtsRequestObjectSegmentsItem, 51), {speech, nil}} {
		_, err := Synthesize(context.Background(), schema.TtsRequestAsObject{Value: schema.TtsRequestObject{Segments: segments}}, Options{Auth: authConfig()})
		equal(t, err.Error(), "Invalid typecast TTS request")
	}
}

func TestPointerCompositionAndOutputRepresentations(t *testing.T) {
	r := fixtureRequests()[11].(schema.TtsRequestAsObject)
	expected, err := resolve(r)
	equal(t, err, nil)
	for i, s := range r.Value.Segments {
		p := reflect.New(reflect.TypeOf(s))
		p.Elem().Set(reflect.ValueOf(s))
		r.Value.Segments[i] = p.Interface().(schema.TtsRequestObjectSegmentsItem)
	}
	r.Value.Output = runtime.Some(schema.TtsRequestObjectOutput(&schema.TtsRequestObjectOutputAsMp3{}))
	if _, err := schema.ValidateRequest(r); err != nil {
		t.Fatal(err)
	}
	actual, err := resolve(r)
	equal(t, err, nil)
	equal(t, actual, expected)
}

func TestProtocolAndConfigurationChecks(t *testing.T) {
	lowRate := request()
	lowRate.Value.Output = runtime.Some(schema.TtsRequestSsfmV21TextVoicef82be0f4Output(schema.TtsRequestSsfmV21TextVoicef82be0f4OutputAsWav{Value: schema.TtsRequestSsfmV21TextVoicef82be0f4OutputWav{SampleRateHz: runtime.Some(schema.TtsRequestSsfmV21TextVoicef82be0f4OutputWavSampleRateHz(schema.TtsRequestSsfmV21TextVoicef82be0f4OutputWavSampleRateHzAsNumber32000{}))}}))
	for _, test := range []struct {
		request schema.TtsRequest
		options Options
		message string
	}{
		{request(), Options{Protocol: "websocket"}, "Typecast Protocol must be stream or http"},
		{lowRate, Options{Protocol: "http"}, "Typecast ordinary WAV uses 44100 Hz, not 32000 Hz"},
		{fixtureRequests()[9], Options{Protocol: "stream"}, "Typecast composition, timestamps, volume scaling and 44.1 kHz WAV require ordinary synthesis"},
		{fixtureRequests()[10], Options{Protocol: "stream"}, "Typecast composition, timestamps, volume scaling and 44.1 kHz WAV require ordinary synthesis"},
		{fixtureRequests()[11], Options{Protocol: "stream"}, "Typecast composition, timestamps, volume scaling and 44.1 kHz WAV require ordinary synthesis"},
		{request(), Options{TimeoutMs: runtime.Some(int64(-1))}, "Typecast TimeoutMs must be between 0 and 2147483647"},
		{request(), Options{TimeoutMs: runtime.Some(int64(2147483648))}, "Typecast TimeoutMs must be between 0 and 2147483647"},
		{request(), Options{MaxTimestampResponseBytes: -1}, "Typecast MaxTimestampResponseBytes must be a positive safe integer"},
	} {
		calls := 0
		o := test.options
		o.Auth = authConfig()
		o.Transport = transportFunc(func(*http.Request) (*http.Response, error) { calls++; return nil, errors.New("unexpected network") })
		_, err := Synthesize(context.Background(), test.request, o)
		if err == nil {
			t.Fatal(test)
		}
		equal(t, err.Error(), test.message)
		equal(t, calls, 0)
	}
	for _, base := range []string{"ftp://example.test", "https://u:p@example.test", "https://example.test/#fragment", "https://example.test/%xx", "https://example.test/?query=%xx", "https://example.test/ bad", "https://example.test:bad"} {
		_, err := Synthesize(context.Background(), request(), Options{Auth: authConfig(), BaseURL: base})
		equal(t, err.Error(), "Typecast endpoint must be HTTP(S) without credentials, fragments or invalid escapes")
	}
	_, err := Synthesize(context.Background(), request(), Options{Auth: authConfig(), BaseURL: "https://example.test:65536"})
	equal(t, err.Error(), "Typecast endpoint must use a valid TCP port")
	for _, key := range []string{"bad key", "a\nb", "é"} {
		a := authConfig()
		a.Typecast.Value.ApiKey = runtime.Some(key)
		_, err := Synthesize(context.Background(), request(), Options{Auth: a})
		equal(t, err.Error(), "Typecast API key must contain only visible ASCII characters")
	}
	_, err = Synthesize(context.Background(), request(), Options{Auth: authConfig(), TimeoutMs: runtime.Some(int64(0))})
	equal(t, err, context.DeadlineExceeded)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = Synthesize(ctx, request(), Options{Auth: authConfig()})
	equal(t, err, context.Canceled)
}

func TestEnvironmentAuthAndEmptyExplicitKey(t *testing.T) {
	t.Setenv("SPEECHSWITCH_TYPECAST_API_KEY", "scoped")
	t.Setenv("TYPECAST_API_KEY", "fallback")
	for _, mode := range []string{"explicit", "scoped", "fallback"} {
		o := Options{}
		if mode == "explicit" {
			o.Auth = authConfig()
		}
		if mode == "fallback" {
			if err := os.Unsetenv("SPEECHSWITCH_TYPECAST_API_KEY"); err != nil {
				t.Fatal(err)
			}
		}
		want := mode
		if mode == "explicit" {
			want = "fixture"
		}
		o.Transport = transportFunc(func(r *http.Request) (*http.Response, error) {
			equal(t, r.Header.Get("X-API-KEY"), want)
			return &http.Response{StatusCode: 200, Header: http.Header{}, Body: newBody(step{data: []byte("audio")})}, nil
		})
		stream, err := Synthesize(context.Background(), request(), o)
		if err != nil {
			t.Fatal(err)
		}
		_, err = collect(t, stream)
		equal(t, err, nil)
	}
	a := authConfig()
	a.Typecast.Value.ApiKey = runtime.Some("")
	_, err := Synthesize(context.Background(), request(), Options{Auth: a})
	equal(t, err.Error(), "Missing auth.typecast.apiKey configuration")
}
