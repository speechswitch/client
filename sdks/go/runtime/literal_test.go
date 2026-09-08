package runtime_test

import (
	"github.com/speechswitch/client/sdks/go/generated/camb"
	"github.com/speechswitch/client/sdks/go/generated/murf"
	"testing"
)

func TestGeneratedScalarUnionAccessors(t *testing.T) {
	value := camb.TtsRequestMars81FlashBetaStreamingTextVoiceLanguageAsEnUs{}
	for _, language := range []camb.TtsRequestMars81FlashBetaStreamingTextVoiceLanguage{value, &value} {
		if language.LiteralValue() != "en-us" {
			t.Fatalf("language = %q", language.LiteralValue())
		}
	}
	var flag camb.TtsRequestMars81FlashBetaStreamingTextVoiceAccentPreservation = camb.TtsRequestMars81FlashBetaStreamingTextVoiceAccentPreservationAsFalse{}
	if flag.LiteralValue() {
		t.Fatal("false flag lost")
	}
	var rate murf.TtsRequestStreamingTextVoiceOutputSampleRateHz = murf.TtsRequestStreamingTextVoiceOutputSampleRateHzAsNumber24000{}
	if rate.LiteralValue() != 24000 {
		t.Fatalf("rate = %v", rate.LiteralValue())
	}
}
