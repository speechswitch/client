package voice_ai

import (
	"context"
	"fmt"
	"math"
	"reflect"
	"testing"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/voice_ai"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func TestEveryFormatAndPointerRepresentation(t *testing.T) {
	cases := []struct {
		value schema.TtsRequestObject1ec54d36Output
		want  string
	}{
		{schema.TtsRequestObject1ec54d36OutputAsMp3904ec5a3{}, "mp3"},
		{schema.TtsRequestObject1ec54d36OutputAsMp36dc1fbe1{}, "mp3_22050_32"},
		{schema.TtsRequestObject1ec54d36OutputAsMp3f58f8da7{}, "mp3_24000_48"},
		{schema.TtsRequestObject1ec54d36OutputAsPcm{}, "pcm_32000"},
		{schema.TtsRequestObject1ec54d36OutputAsWav{}, "wav"},
		{schema.TtsRequestObject1ec54d36OutputAsObject{Value: schema.TtsRequestObject1ec54d36OutputObject{Format: schema.TtsRequestObject1ec54d36OutputObjectFormatAsMulaw{}}}, "ulaw_8000"},
		{schema.TtsRequestObject1ec54d36OutputAsObject{Value: schema.TtsRequestObject1ec54d36OutputObject{Format: schema.TtsRequestObject1ec54d36OutputObjectFormatAsAlaw{}}}, "alaw_8000"},
	}
	for _, bitrate := range []schema.TtsRequestObject1ec54d36OutputMp39b9ac8e8BitRateBps{schema.TtsRequestObject1ec54d36OutputMp39b9ac8e8BitRateBpsAsNumber32000{}, schema.TtsRequestObject1ec54d36OutputMp39b9ac8e8BitRateBpsAsNumber64000{}, schema.TtsRequestObject1ec54d36OutputMp39b9ac8e8BitRateBpsAsNumber96000{}, schema.TtsRequestObject1ec54d36OutputMp39b9ac8e8BitRateBpsAsNumber128000{}, schema.TtsRequestObject1ec54d36OutputMp39b9ac8e8BitRateBpsAsNumber192000{}} {
		cases = append(cases, struct {
			value schema.TtsRequestObject1ec54d36Output
			want  string
		}{schema.TtsRequestObject1ec54d36OutputAsMp39b9ac8e8{Value: schema.TtsRequestObject1ec54d36OutputMp39b9ac8e8{BitRateBps: bitrate}}, fmt.Sprintf("mp3_44100_%.0f", bitrate.LiteralValue()/1000)}, struct {
			value schema.TtsRequestObject1ec54d36Output
			want  string
		}{schema.TtsRequestObject1ec54d36OutputAsOpus{Value: schema.TtsRequestObject1ec54d36OutputOpus{BitRateBps: bitrate}}, fmt.Sprintf("opus_48000_%.0f", bitrate.LiteralValue()/1000)})
	}
	for _, rate := range []schema.TtsRequestObject1ec54d36OutputPcmSampleRateHz{schema.TtsRequestObject1ec54d36OutputPcmSampleRateHzAsNumber8000{}, schema.TtsRequestObject1ec54d36OutputPcmSampleRateHzAsNumber16000{}, schema.TtsRequestObject1ec54d36OutputPcmSampleRateHzAsNumber22050{}, schema.TtsRequestObject1ec54d36OutputPcmSampleRateHzAsNumber24000{}, schema.TtsRequestObject1ec54d36OutputPcmSampleRateHzAsNumber32000{}, schema.TtsRequestObject1ec54d36OutputPcmSampleRateHzAsNumber44100{}, schema.TtsRequestObject1ec54d36OutputPcmSampleRateHzAsNumber48000{}} {
		cases = append(cases, struct {
			value schema.TtsRequestObject1ec54d36Output
			want  string
		}{schema.TtsRequestObject1ec54d36OutputAsPcm{Value: schema.TtsRequestObject1ec54d36OutputPcm{SampleRateHz: runtime.Some(rate)}}, fmt.Sprintf("pcm_%.0f", rate.LiteralValue())})
	}
	for _, rate := range []schema.TtsRequestObject1ec54d36OutputWavSampleRateHz{schema.TtsRequestObject1ec54d36OutputWavSampleRateHzAsNumber16000{}, schema.TtsRequestObject1ec54d36OutputWavSampleRateHzAsNumber22050{}, schema.TtsRequestObject1ec54d36OutputWavSampleRateHzAsNumber24000{}, schema.TtsRequestObject1ec54d36OutputWavSampleRateHzAsNumber32000{}} {
		want := fmt.Sprintf("wav_%.0f", rate.LiteralValue())
		if rate.LiteralValue() == 32000 {
			want = "wav"
		}
		cases = append(cases, struct {
			value schema.TtsRequestObject1ec54d36Output
			want  string
		}{schema.TtsRequestObject1ec54d36OutputAsWav{Value: schema.TtsRequestObject1ec54d36OutputWav{SampleRateHz: runtime.Some(rate)}}, want})
	}
	for _, c := range cases {
		t.Run(c.want, func(t *testing.T) {
			pointer := reflect.New(reflect.TypeOf(c.value))
			pointer.Elem().Set(reflect.ValueOf(c.value))
			for _, value := range []schema.TtsRequestObject1ec54d36Output{c.value, pointer.Interface().(schema.TtsRequestObject1ec54d36Output)} {
				r := request()
				r.Value.Output = runtime.Some(value)
				validate, err := schema.ValidateRequest(r)
				if err != nil {
					t.Fatal(err)
				}
				resolved, err := resolve(r, validate)
				if err != nil {
					t.Fatal(err)
				}
				equal(t, resolved.wire["audio_format"], c.want)
			}
		})
	}
}

func TestGeneratedValidationRunsBeforeAuthIOOrInput(t *testing.T) {
	r := request()
	r.Value.Temperature = runtime.Some(math.NaN())
	nilText := request()
	nilText.Value.Text = (*schema.TtsRequestObject1ec54d36TextAsString)(nil)
	nilOutput := request()
	var output schema.TtsRequestObject1ec54d36Output = (*schema.TtsRequestObject1ec54d36OutputAsPcm)(nil)
	nilOutput.Value.Output = runtime.Some(output)
	emptyDictionary := request()
	emptyDictionary.Value.PronunciationDictionaries = runtime.Some([]schema.TtsRequestObject1ec54d36PronunciationDictionariesItem{})
	badVersion := request()
	badVersion.Value.PronunciationDictionaries = runtime.Some([]schema.TtsRequestObject1ec54d36PronunciationDictionariesItem{{Id: "id", Version: runtime.Some(1.5)}})
	for _, r := range []schema.TtsRequest{nil, (*schema.TtsRequestAsObject1ec54d36)(nil), nilText, nilOutput, emptyDictionary, badVersion, r, liveRequest((*producer)(nil))} {
		s := newSocket()
		_, want := schema.ValidateRequest(r)
		if want == nil {
			t.Fatal("fixture unexpectedly valid")
		}
		_, err := Synthesize(context.Background(), r, Options{WebSocket: s})
		equal(t, err, want)
		equal(t, s.closes.Load(), int32(1))
		equal(t, s.sends.Load(), int32(0))
		equal(t, s.reads.Load(), int32(0))
	}
}

func TestBoundaryDefaultsOverridesAndOwnership(t *testing.T) {
	t.Setenv("VOICE_AI_API_KEY", "native")
	t.Setenv("SPEECHSWITCH_VOICE_AI_API_KEY", "scoped")
	for _, c := range []struct {
		auth auth.Auth
		want string
	}{{auth.Auth{}, "Bearer scoped"}, {authenticated(), "Bearer fixture"}} {
		input, err := Synthesize(deadline(t), request(), Options{Auth: c.auth})
		if err != nil {
			t.Fatal(err)
		}
		s := input.(*stream)
		equal(t, s.config.headers.Get("Authorization"), c.want)
		equal(t, s.config.url, "https://dev.voice.ai/api/v1/tts/speech/stream")
		equal(t, s.config.wire, map[string]any{"text": "Hello", "model": "voiceai-tts-v1-latest", "language": "en", "audio_format": "mp3", "temperature": float64(1), "top_p": .8})
		input.Close()
	}
	badAuth := authenticated()
	badAuth.VoiceAi.Value.ApiKey = runtime.Some("")
	_, err := Synthesize(deadline(t), request(), Options{Auth: badAuth})
	equal(t, err.Error(), "Missing auth.voice.ai.apiKey configuration")
	p := newProducer()
	s := newSocket()
	input, err := Synthesize(deadline(t), liveRequest(p), Options{Auth: authenticated(), WebSocket: s})
	if err != nil {
		t.Fatal(err)
	}
	input.Close()
	input.Close()
	equal(t, s.closes.Load(), int32(1))
	equal(t, p.reads.Load(), int32(0))
	equal(t, p.closes.Load(), int32(0))
	for _, c := range []struct {
		options Options
		request schema.TtsRequest
		want    string
	}{
		{Options{Protocol: "wrong"}, request(), "Invalid Voice.ai protocol"},
		{Options{Protocol: "http"}, liveRequest(p), "Voice.ai incremental input and paced delivery require WebSocket"},
		{Options{Protocol: "http", WebSocket: newSocket()}, request(), "Voice.ai WebSocket override requires WebSocket transport"},
		{Options{Protocol: "websocket"}, fixtureRequests()[8], "Voice.ai legacy API does not document WebSocket synthesis"},
		{Options{TimeoutMs: runtime.Some(int64(-1))}, request(), "Voice.ai TimeoutMs must be between 0 and 2147483647"},
		{Options{TimeoutMs: runtime.Some(int64(2147483648))}, request(), "Voice.ai TimeoutMs must be between 0 and 2147483647"},
		{Options{TimeoutMs: runtime.Some(int64(0))}, request(), "context deadline exceeded"},
		{Options{MaxMessageBytes: -1}, request(), "Voice.ai MaxMessageBytes must be a positive safe integer"},
	} {
		c.options.Auth = authenticated()
		_, err := Synthesize(deadline(t), c.request, c.options)
		if err == nil {
			t.Fatal("accepted invalid options")
		}
		equal(t, err.Error(), c.want)
		if s, ok := c.options.WebSocket.(*socket); ok {
			equal(t, s.closes.Load(), int32(1))
		}
	}
}

func TestBaseURLPreservesEscapesAndRejectsAmbiguousAddresses(t *testing.T) {
	for _, base := range []string{"file:///tmp/test", "https://user:pass@example.com", "https://example.com?", "https://example.com#", "https://example.com\\evil", "https://example.com/\n", "https://example.com:65536", "https://[not-an-ip]", "https://example.com:"} {
		_, err := endpoint(base, "/api", true)
		if err == nil {
			t.Fatalf("accepted %q", base)
		}
		equal(t, err.Error(), "Voice.ai BaseURL must be an HTTP or WebSocket base without credentials, query or fragment")
	}
	address, err := endpoint("https://example.com/proxy%2Fpath///", "/api", true)
	equal(t, err, nil)
	equal(t, address, "wss://example.com/proxy%2Fpath/api")
	address, err = endpoint("ws://[::1]:1234/proxy", "/api", false)
	equal(t, err, nil)
	equal(t, address, "http://[::1]:1234/proxy/api")
}
