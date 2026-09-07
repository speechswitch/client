package murf

import (
	"context"
	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/murf"
	"github.com/speechswitch/client/sdks/go/runtime"
	"io"
	"math"
	"net/http"
	"os"
	"strings"
	"testing"
)

func TestEveryFormatAndBothModelDefaults(t *testing.T) {
	formats := []schema.TtsRequestStreamingTextVoiceOutputFormat{
		schema.TtsRequestStreamingTextVoiceOutputFormatAsPcm{}, schema.TtsRequestStreamingTextVoiceOutputFormatAsWav{}, schema.TtsRequestStreamingTextVoiceOutputFormatAsMp3{}, schema.TtsRequestStreamingTextVoiceOutputFormatAsFlac{}, schema.TtsRequestStreamingTextVoiceOutputFormatAsAlaw{}, schema.TtsRequestStreamingTextVoiceOutputFormatAsMulaw{}, schema.TtsRequestStreamingTextVoiceOutputFormatAsOgg{},
	}
	for i, format := range formats {
		for _, gen2 := range []bool{false, true} {
			var r schema.TtsRequest
			if gen2 {
				r = schema.TtsRequestAsGen2TextVoiceca621e19{Value: schema.TtsRequestGen2TextVoiceca621e19{Text: "Hi", Voice: "custom", Output: runtime.Some(schema.TtsRequestGen2TextVoiceca621e19Output{Format: format})}}
			} else {
				r = schema.TtsRequestAsTextVoice{Value: schema.TtsRequestTextVoice{Text: "Hi", Voice: "custom", Output: runtime.Some(schema.TtsRequestStreamingTextVoiceOutput{Format: format})}}
			}
			_, err := schema.ValidateRequest(r)
			equal(t, err, nil)
			c := settings(r)
			equal(t, c.format, []string{"PCM", "WAV", "MP3", "FLAC", "ALAW", "ULAW", "OGG"}[i])
			equal(t, c.channel, "MONO")
			rate := float64(24000)
			if gen2 {
				rate = 44100
			}
			equal(t, c.rate, rate)
			equal(t, c.wire["voiceId"], "custom")
		}
	}
}
func TestDiscreteVariationOriginalTimingAndPresentZero(t *testing.T) {
	variants := []schema.TtsRequestGen2TextVoiceca621e19DeliveryVariance{
		schema.TtsRequestGen2TextVoiceca621e19DeliveryVarianceAsNumber0{}, schema.TtsRequestGen2TextVoiceca621e19DeliveryVarianceAsNumber0Point2{}, schema.TtsRequestGen2TextVoiceca621e19DeliveryVarianceAsNumber0Point4{}, schema.TtsRequestGen2TextVoiceca621e19DeliveryVarianceAsNumber0Point6{}, schema.TtsRequestGen2TextVoiceca621e19DeliveryVarianceAsNumber0Point8{}, schema.TtsRequestGen2TextVoiceca621e19DeliveryVarianceAsNumber1{},
	}
	for i, variance := range variants {
		var retention schema.TtsRequestGen2TextVoiceca621e19AudioRetention = schema.TtsRequestGen2TextVoiceca621e19AudioRetentionAsFalse{}
		r := schema.TtsRequestAsGen2TextVoice13ad89db{Value: schema.TtsRequestGen2TextVoice13ad89db{Text: "Hi", Voice: "v", Language: "en-US", TargetDurationMs: runtime.Some(float64(0)), DeliveryVariance: runtime.Some(variance), AudioRetention: runtime.Some(retention), VoiceStyle: runtime.Some("")}}
		_, err := schema.ValidateRequest(&r)
		equal(t, err, nil)
		c := settings(&r)
		equal(t, c.wire, map[string]any{"text": "Hi", "voiceId": "v", "rate": float64(0), "pitch": float64(0), "format": "PCM", "sampleRate": float64(44100), "channelType": "MONO", "locale": "en-US", "style": "", "modelVersion": "GEN2", "variation": float64(i), "encodeAsBase64": true, "wordDurationsAsOriginalText": true, "audioDuration": float64(0)})
		equal(t, c.timed, true)
		equal(t, c.inline, true)
	}
}
func TestGeneratedBoundsRejectBeforeIO(t *testing.T) {
	for _, value := range []float64{0.5, 51, -51, math.NaN(), math.Inf(1)} {
		r := request()
		r.Value.PitchBias = runtime.Some(value)
		_, err := Synthesize(context.Background(), r, Options{})
		errorText(t, err, "Invalid murf TTS request")
	}
	for _, value := range []string{strings.Repeat("x", 3000), strings.Repeat("🚀", 1500), strings.Repeat("line\n", 600)} {
		r := request()
		r.Value.Text = value
		_, err := schema.ValidateRequest(r)
		equal(t, err, nil)
	}
	for _, value := range []string{strings.Repeat("x", 3001), strings.Repeat("🚀", 1501)} {
		r := request()
		r.Value.Text = value
		_, err := Synthesize(context.Background(), r, Options{})
		errorText(t, err, "Invalid murf TTS request")
	}
	for _, item := range []Input{text(strings.Repeat("🚀", 1501)), schema.TtsRequestStreamingTextVoiceTextItemAsUpdate{Value: schema.TtsRequestStreamingTextVoiceTextItemUpdate{PitchBias: runtime.Some(0.5)}}} {
		socket := newSocket()
		stream, err := Synthesize(context.Background(), streaming(newSource(item)), Options{WebSocket: socket})
		if err != nil {
			t.Fatal(err)
		}
		_, err = stream.Next(context.Background())
		want := "Invalid murf TTS input item"
		if _, ok := item.(schema.TtsRequestStreamingTextVoiceTextItemAsString); ok {
			want = "Murf text messages must not exceed 3000 characters"
		}
		errorText(t, err, want)
		equal(t, len(socket.messages()), 1)
	}
}
func TestBoundaryAuthEndpointsAndLimits(t *testing.T) {
	t.Setenv("SPEECHSWITCH_MURF_API_KEY", "scoped")
	t.Setenv("MURF_API_KEY", "legacy")
	for _, endpoint := range []string{"https://user:pass@proxy.invalid", "https://proxy.invalid#", "https://proxy.invalid/%zz", "https://proxy.invalid:99999", "https://proxy.invalid/ bad"} {
		_, err := Synthesize(context.Background(), request(), Options{BaseURL: endpoint})
		errorText(t, err, "Invalid Murf endpoint URL")
	}
	_, err := Synthesize(context.Background(), request(), Options{Auth: auth.Auth{Murf: runtime.Some(auth.AuthAsync{ApiKey: runtime.Some("")})}})
	errorText(t, err, "Missing auth.murf.apiKey configuration")
	_, err = Synthesize(context.Background(), request(), Options{Auth: auth.Auth{Murf: runtime.Some(auth.AuthAsync{ApiKey: runtime.Some("bad\nkey")})}})
	errorText(t, err, "Invalid Murf authentication header")
	_, err = Synthesize(context.Background(), request(), Options{MaxJSONBytes: -1})
	errorText(t, err, "Murf MaxJSONBytes must be a positive uint32 value")
	_, err = Synthesize(context.Background(), request(), Options{MaxMessageBytes: -1})
	errorText(t, err, "Murf MaxMessageBytes must be a positive uint32 value")
	socket := newSocket()
	_, err = Synthesize(context.Background(), request(), Options{WebSocket: socket})
	errorText(t, err, "Murf WebSocket overrides require streaming input")
	equal(t, socket.closes.Load(), int32(0))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = Synthesize(ctx, request(), Options{})
	equal(t, err, context.Canceled)
}

func TestCredentialPrecedenceAndLegacyFallback(t *testing.T) {
	for _, tc := range []struct {
		auth   auth.Auth
		scoped bool
		want   string
	}{{testAuth, true, "test-key"}, {auth.Auth{}, true, "scoped"}, {auth.Auth{}, false, "legacy"}} {
		t.Setenv("SPEECHSWITCH_MURF_API_KEY", "scoped")
		t.Setenv("MURF_API_KEY", "legacy")
		if !tc.scoped {
			if err := os.Unsetenv("SPEECHSWITCH_MURF_API_KEY"); err != nil {
				t.Fatal(err)
			}
		}
		tr := transport(func(r *http.Request) (*http.Response, error) {
			equal(t, r.Header.Get("api-key"), tc.want)
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("a"))}, nil
		})
		stream, err := Synthesize(context.Background(), request(), Options{Auth: tc.auth, Transport: tr})
		if err != nil {
			t.Fatal(err)
		}
		equal(t, len(collect(t, stream)), 2)
	}
}
