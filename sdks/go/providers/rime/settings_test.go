package rime

import (
	"context"
	"math"
	"os"
	"reflect"
	"testing"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/rime"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func TestEveryGeneratedRequestVariantAndPointerResolvesItsOwnCapabilities(t *testing.T) {
	p := newProducer()
	word := runtime.Some(schema.TtsRequestCodaStreamingTextVoice33f4bd25TimestampGranularity{})
	var es schema.TtsRequestCodaStreamingTextVoice33f4bd25Language = schema.TtsRequestCodaStreamingTextVoice33f4bd25LanguageAsEs{}
	fr := schema.TtsRequestCodaStreamingTextVoice84ec2db1LanguageAsFr{}
	de := schema.TtsRequestMistV2StreamingTextVoice03cc8904LanguageAsDe{}
	cases := []struct {
		request       schema.TtsRequest
		model, lang   string
		stream, timed bool
	}{
		{schema.TtsRequestAsCodaStreamingTextVoice84ec2db1{Value: schema.TtsRequestCodaStreamingTextVoice84ec2db1{Voice: "v", Text: p, Language: fr}}, "coda", "fr", true, false},
		{schema.TtsRequestAsCodaTextVoice50d85478{Value: schema.TtsRequestCodaTextVoice50d85478{Voice: "v", Text: "x", Language: fr}}, "coda", "fr", false, false},
		{schema.TtsRequestAsCodaStreamingTextVoice33f4bd25{Value: schema.TtsRequestCodaStreamingTextVoice33f4bd25{Voice: "v", Text: p, Language: runtime.Some(es), TimestampGranularity: word}}, "coda", "es", true, true},
		{schema.TtsRequestAsCodaTextVoicef75e9756{Value: schema.TtsRequestCodaTextVoicef75e9756{Voice: "v", Text: "x", TimestampGranularity: word}}, "coda", "en", false, true},
		{schema.TtsRequestAsMistV2StreamingTextVoice03cc8904{Value: schema.TtsRequestMistV2StreamingTextVoice03cc8904{Voice: "v", Text: p, Language: de}}, "mistv2", "ger", true, false},
		{schema.TtsRequestAsMistV2TextVoice20785ce4{Value: schema.TtsRequestMistV2TextVoice20785ce4{Voice: "v", Text: "x", Language: de}}, "mistv2", "ger", false, false},
		{schema.TtsRequestAsMistV2StreamingTextVoicec0dcaaf1{Value: schema.TtsRequestMistV2StreamingTextVoicec0dcaaf1{Voice: "v", Text: p, Language: runtime.Some(es), TimestampGranularity: word}}, "mistv2", "spa", true, true},
		{schema.TtsRequestAsMistV2TextVoiceae274411{Value: schema.TtsRequestMistV2TextVoiceae274411{Voice: "v", Text: "x", TimestampGranularity: word}}, "mistv2", "eng", false, true},
		{schema.TtsRequestAsMistV3StreamingTextVoice88a01d24{Value: schema.TtsRequestMistV3StreamingTextVoice88a01d24{Voice: "v", Text: p, TimestampGranularity: word}}, "mistv3", "en", true, true},
		{schema.TtsRequestAsMistV3TextVoice2a5bc5c5{Value: schema.TtsRequestMistV3TextVoice2a5bc5c5{Voice: "v", Text: "x", TimestampGranularity: word}}, "mistv3", "en", false, true},
		{schema.TtsRequestAsMistV3StreamingTextVoice49f68e83{Value: schema.TtsRequestMistV3StreamingTextVoice49f68e83{Voice: "v", Text: p, Language: de}}, "mistv3", "de", true, false},
		{schema.TtsRequestAsMistV3TextVoice7d020de1{Value: schema.TtsRequestMistV3TextVoice7d020de1{Voice: "v", Text: "x", Language: de}}, "mistv3", "de", false, false},
		{schema.TtsRequestAsMistV3StreamingTextVoice3acf8862{Value: schema.TtsRequestMistV3StreamingTextVoice3acf8862{Voice: "v", Text: p, TimestampGranularity: word}}, "mistv3", "es", true, true},
		{schema.TtsRequestAsMistV3TextVoice3fb6eaa2{Value: schema.TtsRequestMistV3TextVoice3fb6eaa2{Voice: "v", Text: "x", TimestampGranularity: word}}, "mistv3", "es", false, true},
	}
	for _, c := range cases {
		t.Run(reflect.TypeOf(c.request).String(), func(t *testing.T) {
			pointer := reflect.New(reflect.TypeOf(c.request))
			pointer.Elem().Set(reflect.ValueOf(c.request))
			for _, request := range []schema.TtsRequest{c.request, pointer.Interface().(schema.TtsRequest)} {
				socket := newSocket()
				input, err := Synthesize(deadline(t), request, Options{Auth: authenticated(), WebSocket: socket})
				if err != nil {
					t.Fatal(err)
				}
				config := input.(*stream).config
				wire := map[string]any{"speaker": "v", "modelId": c.model, "lang": c.lang, "samplingRate": 24000.0}
				if c.model == "mistv2" {
					wire["samplingRate"] = 16000.0
					wire["speedAlpha"] = 1.0
					wire["noTextNormalization"] = false
				} else {
					wire["timeScaleFactor"] = 1.0
				}
				if c.model != "coda" {
					wire["pauseBetweenBrackets"] = false
				}
				if c.model == "mistv2" || c.model == "mistv3" && c.lang == "en" {
					wire["phonemizeBetweenBrackets"] = false
				}
				equal(t, config.wire, wire)
				equal(t, config.timed, c.timed)
				equal(t, config.format, "pcm")
				equal(t, config.segment, "bySentence")
				equal(t, config.explicitSegmentation, false)
				if c.stream {
					equal(t, config.input, p)
					equal(t, config.text, "")
				} else {
					equal(t, config.input, nil)
					equal(t, config.text, "x")
				}
				equal(t, p.reads.Load(), int32(0))
				input.Close()
				equal(t, socket.closes.Load(), int32(1))
			}
		})
	}
}

func TestAuthPrecedenceAndUnreadOverrideOwnership(t *testing.T) {
	scoped, empty := "scoped", ""
	for _, c := range []struct {
		explicit     bool
		scoped       *string
		legacy, want string
	}{
		{true, nil, "legacy", "fixture"},
		{false, &scoped, "legacy", "scoped"},
		{false, nil, "legacy", "legacy"},
		{false, &empty, "legacy", ""},
	} {
		t.Run(c.want, func(t *testing.T) {
			t.Setenv("SPEECHSWITCH_RIME_API_KEY", "")
			os.Unsetenv("SPEECHSWITCH_RIME_API_KEY")
			t.Setenv("RIME_API_KEY", c.legacy)
			if c.scoped != nil {
				t.Setenv("SPEECHSWITCH_RIME_API_KEY", *c.scoped)
			}
			var a auth.Auth
			if c.explicit {
				a = authenticated()
			}
			socket := newSocket()
			input, err := Synthesize(deadline(t), request(), Options{Auth: a, WebSocket: socket})
			if c.want == "" {
				equal(t, input, nil)
				if err == nil {
					t.Fatal("accepted empty scoped key")
				}
				equal(t, err.Error(), "Missing auth.rime.apiKey configuration")
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			equal(t, input.(*stream).config.key, c.want)
			equal(t, len(socket.sent), 0)
			input.Close()
			equal(t, socket.closes.Load(), int32(1))
		})
	}
	t.Setenv("SPEECHSWITCH_RIME_API_KEY", "fallback")
	a := authenticated()
	a.Rime.Value.ApiKey = runtime.Some("")
	_, err := Synthesize(deadline(t), request(), Options{Auth: a})
	if err == nil {
		t.Fatal("accepted empty explicit key")
	}
	equal(t, err.Error(), "Missing auth.rime.apiKey configuration")
}

func TestGeneratedPreflightAndProtocolReciprocals(t *testing.T) {
	var nilOutput schema.TtsRequestCodaStreamingTextVoice84ec2db1Output = (*schema.TtsRequestCodaStreamingTextVoice84ec2db1OutputAsObjectb2df2f24)(nil)
	invalid := request()
	invalid.Value.Output = runtime.Some(nilOutput)
	for _, request := range []schema.TtsRequest{nil, (*schema.TtsRequestAsCodaTextVoicef75e9756)(nil), liveRequest(nil), invalid} {
		_, expected := schema.ValidateRequest(request)
		if expected == nil {
			t.Fatal("expected generated request validation failure")
		}
		input, err := Synthesize(deadline(t), request, Options{Auth: authenticated()})
		equal(t, input, nil)
		if err == nil {
			t.Fatal("accepted invalid request")
		}
		equal(t, err.Error(), expected.Error())
	}
	for _, speed := range []float64{0, -1, math.SmallestNonzeroFloat64} {
		r := schema.TtsRequestAsMistV3TextVoice2a5bc5c5{Value: schema.TtsRequestMistV3TextVoice2a5bc5c5{Voice: "v", Text: "x", TextMarkup: runtime.Some(schema.TtsRequestMistV2StreamingTextVoice03cc8904TextMarkup{Speeds: runtime.Some([]float64{speed})})}}
		input, err := Synthesize(deadline(t), r, Options{Auth: authenticated()})
		equal(t, input, nil)
		if err == nil {
			t.Fatal("accepted invalid reciprocal")
		}
		equal(t, err.Error(), "Rime inline speeds must have a positive finite reciprocal")
	}
	r := schema.TtsRequestAsMistV2TextVoiceae274411{Value: schema.TtsRequestMistV2TextVoiceae274411{Voice: "v", Text: "x", Speed: runtime.Some(math.SmallestNonzeroFloat64)}}
	_, err := Synthesize(deadline(t), r, Options{Auth: authenticated()})
	if err == nil {
		t.Fatal("accepted infinite speed scale")
	}
	equal(t, err.Error(), "Rime speed cannot be represented as a finite time scale")
	_, err = Synthesize(deadline(t), request(), Options{Auth: authenticated(), TimeoutMs: runtime.Some(int64(0))})
	equal(t, err, context.DeadlineExceeded)
}
