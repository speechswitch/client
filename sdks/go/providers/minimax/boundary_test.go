package minimax

import (
	"context"
	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/minimax"
	"github.com/speechswitch/client/sdks/go/runtime"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestBoundaryAuthPresenceAndValidationPrecedeIO(t *testing.T) {
	t.Setenv("SPEECHSWITCH_MINIMAX_API_KEY", "scoped")
	t.Setenv("MINIMAX_API_KEY", "legacy")
	for _, test := range []struct {
		auth auth.Auth
		key  string
	}{
		{auth.Auth{}, "scoped"}, {testAuth, "test-key"},
		{auth.Auth{Minimax: runtime.Optional[auth.AuthAsync]{Value: auth.AuthAsync{ApiKey: runtime.Some("ignored")}}}, "scoped"},
		{auth.Auth{Minimax: runtime.Some(auth.AuthAsync{ApiKey: runtime.Optional[string]{Value: "ignored"}})}, "scoped"},
	} {
		tr := transport(func(r *http.Request) (*http.Response, error) {
			equal(t, r.Header.Get("Authorization"), "Bearer "+test.key)
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"data":{"status":2,"audio":"00"}}`))}, nil
		})
		stream, err := Synthesize(context.Background(), request(), Options{Auth: test.auth, Transport: tr})
		if err != nil {
			t.Fatal(err)
		}
		collect(t, stream)
	}
	_, err := Synthesize(context.Background(), request(), Options{Auth: auth.Auth{Minimax: runtime.Some(auth.AuthAsync{ApiKey: runtime.Some("")})}})
	errorText(t, err, "Missing auth.minimax.apiKey configuration")
	r := request()
	r.Value.VolumeScale = runtime.Some(0.0)
	_, expected := schema.ValidateRequest(r)
	if expected == nil {
		t.Fatal("expected generated validation error")
	}
	_, err = Synthesize(context.Background(), r, Options{})
	errorText(t, err, expected.Error())
	r = request()
	r.Value.PitchBias = runtime.Some(0.5)
	_, expected = schema.ValidateRequest(r)
	if expected == nil {
		t.Fatal("expected generated validation error")
	}
	_, err = Synthesize(context.Background(), r, Options{})
	errorText(t, err, expected.Error())
	socket := newSocket()
	_, err = Synthesize(context.Background(), request(), Options{WebSocket: socket})
	errorText(t, err, "MiniMax WebSocket overrides require streaming input")
	equal(t, len(socket.frames()), 0)
	equal(t, socket.closes.Load(), int32(0))
	for _, options := range []Options{
		{BaseURL: "https://user:password@host.invalid"}, {BaseURL: "https://host.invalid:65536"}, {BaseURL: "https://host.invalid/a?bad=%xx"},
		{BaseURL: "file:///tmp/audio"}, {BaseURL: "https://host.invalid/#"}, {BaseURL: "https://host.invalid/\n"},
	} {
		_, err = Synthesize(context.Background(), request(), options)
		errorText(t, err, "Invalid MiniMax endpoint URL")
	}
	for _, options := range []Options{{MaxJSONBytes: -1}, {MaxMessageBytes: -1}} {
		_, err = Synthesize(context.Background(), request(), options)
		name := "MaxJSONBytes"
		if options.MaxMessageBytes < 0 {
			name = "MaxMessageBytes"
		}
		errorText(t, err, "MiniMax "+name+" must be a positive uint32 value")
	}
}
func TestFormatsAndOptionalControlsMatchNativeSettings(t *testing.T) {
	for _, test := range []struct {
		output    schema.TtsRequestTextf2dcc77eOutput
		format    string
		rate      float64
		streaming bool
	}{
		{schema.TtsRequestTextf2dcc77eOutputAsMp3{}, "mp3", 32000, true},
		{schema.TtsRequestTextf2dcc77eOutputAsObject{Value: schema.TtsRequestTextf2dcc77eOutputObject{Format: schema.TtsRequestTextf2dcc77eOutputObjectFormatAsPcm{}}}, "pcm", 32000, true},
		{schema.TtsRequestTextf2dcc77eOutputAsObject{Value: schema.TtsRequestTextf2dcc77eOutputObject{Format: schema.TtsRequestTextf2dcc77eOutputObjectFormatAsFlac{}}}, "flac", 32000, true},
		{schema.TtsRequestTextf2dcc77eOutputAsWava066cb88{}, "wav", 32000, false},
		{schema.TtsRequestTextf2dcc77eOutputAsMulaw{}, "pcmu_raw", 8000, true},
		{schema.TtsRequestTextf2dcc77eOutputAsWav6dd8e06a{}, "pcmu_wav", 8000, true},
		{schema.TtsRequestTextf2dcc77eOutputAsOggOpus{}, "opus", 24000, true},
	} {
		r := request()
		r.Value.Output = runtime.Some(test.output)
		if _, err := schema.ValidateRequest(r); err != nil {
			t.Fatal(err)
		}
		c, err := settings(r)
		if err != nil {
			t.Fatal(err)
		}
		output := c.wire["audio_setting"].(map[string]any)
		equal(t, output["format"], test.format)
		equal(t, output["sample_rate"], test.rate)
		equal(t, c.streaming, test.streaming)
	}
	r := schema.TtsRequestAsTextVoice6862a939{Value: schema.TtsRequestTextVoice6862a939{
		Text: "$$1+1$$", Voice: "existing",
		VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{Brightness: runtime.Some(0.0), Softness: runtime.Some(-100.0), Crispness: runtime.Some(100.0)},
	}}
	var effect schema.TtsRequestText77d171beVoiceTransformEffect = schema.TtsRequestText77d171beVoiceTransformEffectAsTelephone{}
	r.Value.VoiceTransform.Effect = runtime.Some(effect)
	var output schema.TtsRequestText77d171beOutput = schema.TtsRequestText77d171beOutputAsFlac{}
	r.Value.Output = runtime.Some(output)
	if _, err := schema.ValidateRequest(r); err != nil {
		t.Fatal(err)
	}
	c, err := settings(r)
	if err != nil {
		t.Fatal(err)
	}
	equal(t, c.streaming, false)
	equal(t, c.wire["language_boost"], "Chinese")
	equal(t, c.wire["voice_modify"], map[string]any{"pitch": 0.0, "intensity": -100.0, "timbre": 100.0, "sound_effects": "lofi_telephone"})
}
