package minimax

import (
	"context"
	schema "github.com/speechswitch/client/sdks/go/generated/minimax"
	"github.com/speechswitch/client/sdks/go/runtime"
	"testing"
)

func TestEveryGeneratedRequestVariantAndPointer(t *testing.T) {
	cases := []struct {
		request                       schema.TtsRequest
		model                         string
		live, blend, effects, formula bool
	}{
		{schema.TtsRequestAsText77d171be{Value: schema.TtsRequestText77d171be{Text: "Hi", Model: schema.TtsRequestText77d171beModelAsSpeech02Hd{}, VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}}}, "speech-02-hd", false, true, true, false},
		{&schema.TtsRequestAsText77d171be{Value: schema.TtsRequestText77d171be{Text: "Hi", Model: schema.TtsRequestText77d171beModelAsSpeech02Hd{}, VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}}}, "speech-02-hd", false, true, true, false},
		{schema.TtsRequestAsText8a99d813{Value: schema.TtsRequestText8a99d813{Text: "Hi", Model: schema.TtsRequestText77d171beModelAsSpeech02Hd{}, VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-02-hd", false, true, true, true},
		{&schema.TtsRequestAsText8a99d813{Value: schema.TtsRequestText8a99d813{Text: "Hi", Model: schema.TtsRequestText77d171beModelAsSpeech02Hd{}, VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-02-hd", false, true, true, true},
		{schema.TtsRequestAsTextf2dcc77e{Value: schema.TtsRequestTextf2dcc77e{Text: "Hi", Model: schema.TtsRequestText77d171beModelAsSpeech02Hd{}, VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-02-hd", false, true, false, true},
		{&schema.TtsRequestAsTextf2dcc77e{Value: schema.TtsRequestTextf2dcc77e{Text: "Hi", Model: schema.TtsRequestText77d171beModelAsSpeech02Hd{}, VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-02-hd", false, true, false, true},
		{schema.TtsRequestAsTextbc3e8901{Value: schema.TtsRequestTextbc3e8901{Text: "Hi", Model: schema.TtsRequestText77d171beModelAsSpeech02Hd{}, VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}}}, "speech-02-hd", false, true, false, false},
		{&schema.TtsRequestAsTextbc3e8901{Value: schema.TtsRequestTextbc3e8901{Text: "Hi", Model: schema.TtsRequestText77d171beModelAsSpeech02Hd{}, VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}}}, "speech-02-hd", false, true, false, false},
		{schema.TtsRequestAsTextVoice9d11e112{Value: schema.TtsRequestTextVoice9d11e112{Text: "Hi", Model: schema.TtsRequestText77d171beModelAsSpeech02Hd{}, Voice: "existing-voice", VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}}}, "speech-02-hd", false, false, true, false},
		{&schema.TtsRequestAsTextVoice9d11e112{Value: schema.TtsRequestTextVoice9d11e112{Text: "Hi", Model: schema.TtsRequestText77d171beModelAsSpeech02Hd{}, Voice: "existing-voice", VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}}}, "speech-02-hd", false, false, true, false},
		{schema.TtsRequestAsTextVoicec9541dfe{Value: schema.TtsRequestTextVoicec9541dfe{Text: "Hi", Model: schema.TtsRequestText77d171beModelAsSpeech02Hd{}, Voice: "existing-voice", VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-02-hd", false, false, true, true},
		{&schema.TtsRequestAsTextVoicec9541dfe{Value: schema.TtsRequestTextVoicec9541dfe{Text: "Hi", Model: schema.TtsRequestText77d171beModelAsSpeech02Hd{}, Voice: "existing-voice", VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-02-hd", false, false, true, true},
		{schema.TtsRequestAsTextVoice579df7d3{Value: schema.TtsRequestTextVoice579df7d3{Text: "Hi", Model: schema.TtsRequestText77d171beModelAsSpeech02Hd{}, Voice: "existing-voice", FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-02-hd", false, false, false, true},
		{&schema.TtsRequestAsTextVoice579df7d3{Value: schema.TtsRequestTextVoice579df7d3{Text: "Hi", Model: schema.TtsRequestText77d171beModelAsSpeech02Hd{}, Voice: "existing-voice", FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-02-hd", false, false, false, true},
		{schema.TtsRequestAsTextVoiceab653629{Value: schema.TtsRequestTextVoiceab653629{Text: "Hi", Model: schema.TtsRequestText77d171beModelAsSpeech02Hd{}, Voice: "existing-voice"}}, "speech-02-hd", false, false, false, false},
		{&schema.TtsRequestAsTextVoiceab653629{Value: schema.TtsRequestTextVoiceab653629{Text: "Hi", Model: schema.TtsRequestText77d171beModelAsSpeech02Hd{}, Voice: "existing-voice"}}, "speech-02-hd", false, false, false, false},
		{schema.TtsRequestAsStreamingText12421ea0{Value: schema.TtsRequestStreamingText12421ea0{Text: newSource(text("Hi")), Model: schema.TtsRequestText77d171beModelAsSpeech02Hd{}, VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}}}, "speech-02-hd", true, true, true, false},
		{&schema.TtsRequestAsStreamingText12421ea0{Value: schema.TtsRequestStreamingText12421ea0{Text: newSource(text("Hi")), Model: schema.TtsRequestText77d171beModelAsSpeech02Hd{}, VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}}}, "speech-02-hd", true, true, true, false},
		{schema.TtsRequestAsStreamingText3a58293c{Value: schema.TtsRequestStreamingText3a58293c{Text: newSource(text("Hi")), Model: schema.TtsRequestText77d171beModelAsSpeech02Hd{}, VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-02-hd", true, true, true, true},
		{&schema.TtsRequestAsStreamingText3a58293c{Value: schema.TtsRequestStreamingText3a58293c{Text: newSource(text("Hi")), Model: schema.TtsRequestText77d171beModelAsSpeech02Hd{}, VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-02-hd", true, true, true, true},
		{schema.TtsRequestAsStreamingTextaa771f19{Value: schema.TtsRequestStreamingTextaa771f19{Text: newSource(text("Hi")), Model: schema.TtsRequestText77d171beModelAsSpeech02Hd{}, VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-02-hd", true, true, false, true},
		{&schema.TtsRequestAsStreamingTextaa771f19{Value: schema.TtsRequestStreamingTextaa771f19{Text: newSource(text("Hi")), Model: schema.TtsRequestText77d171beModelAsSpeech02Hd{}, VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-02-hd", true, true, false, true},
		{schema.TtsRequestAsStreamingText62be105a{Value: schema.TtsRequestStreamingText62be105a{Text: newSource(text("Hi")), Model: schema.TtsRequestText77d171beModelAsSpeech02Hd{}, VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}}}, "speech-02-hd", true, true, false, false},
		{&schema.TtsRequestAsStreamingText62be105a{Value: schema.TtsRequestStreamingText62be105a{Text: newSource(text("Hi")), Model: schema.TtsRequestText77d171beModelAsSpeech02Hd{}, VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}}}, "speech-02-hd", true, true, false, false},
		{schema.TtsRequestAsStreamingTextVoice6d21fc54{Value: schema.TtsRequestStreamingTextVoice6d21fc54{Text: newSource(text("Hi")), Model: schema.TtsRequestText77d171beModelAsSpeech02Hd{}, Voice: "existing-voice", VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}}}, "speech-02-hd", true, false, true, false},
		{&schema.TtsRequestAsStreamingTextVoice6d21fc54{Value: schema.TtsRequestStreamingTextVoice6d21fc54{Text: newSource(text("Hi")), Model: schema.TtsRequestText77d171beModelAsSpeech02Hd{}, Voice: "existing-voice", VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}}}, "speech-02-hd", true, false, true, false},
		{schema.TtsRequestAsStreamingTextVoice80c0de17{Value: schema.TtsRequestStreamingTextVoice80c0de17{Text: newSource(text("Hi")), Model: schema.TtsRequestText77d171beModelAsSpeech02Hd{}, Voice: "existing-voice", VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-02-hd", true, false, true, true},
		{&schema.TtsRequestAsStreamingTextVoice80c0de17{Value: schema.TtsRequestStreamingTextVoice80c0de17{Text: newSource(text("Hi")), Model: schema.TtsRequestText77d171beModelAsSpeech02Hd{}, Voice: "existing-voice", VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-02-hd", true, false, true, true},
		{schema.TtsRequestAsStreamingTextVoiceb9340145{Value: schema.TtsRequestStreamingTextVoiceb9340145{Text: newSource(text("Hi")), Model: schema.TtsRequestText77d171beModelAsSpeech02Hd{}, Voice: "existing-voice", FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-02-hd", true, false, false, true},
		{&schema.TtsRequestAsStreamingTextVoiceb9340145{Value: schema.TtsRequestStreamingTextVoiceb9340145{Text: newSource(text("Hi")), Model: schema.TtsRequestText77d171beModelAsSpeech02Hd{}, Voice: "existing-voice", FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-02-hd", true, false, false, true},
		{schema.TtsRequestAsStreamingTextVoice40504229{Value: schema.TtsRequestStreamingTextVoice40504229{Text: newSource(text("Hi")), Model: schema.TtsRequestText77d171beModelAsSpeech02Hd{}, Voice: "existing-voice"}}, "speech-02-hd", true, false, false, false},
		{&schema.TtsRequestAsStreamingTextVoice40504229{Value: schema.TtsRequestStreamingTextVoice40504229{Text: newSource(text("Hi")), Model: schema.TtsRequestText77d171beModelAsSpeech02Hd{}, Voice: "existing-voice"}}, "speech-02-hd", true, false, false, false},
		{schema.TtsRequestAsTexte253c939{Value: schema.TtsRequestTexte253c939{Text: "Hi", Model: schema.TtsRequestTexte253c939ModelAsSpeech26Hd{}, VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}}}, "speech-2.6-hd", false, true, true, false},
		{&schema.TtsRequestAsTexte253c939{Value: schema.TtsRequestTexte253c939{Text: "Hi", Model: schema.TtsRequestTexte253c939ModelAsSpeech26Hd{}, VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}}}, "speech-2.6-hd", false, true, true, false},
		{schema.TtsRequestAsText75fe6b00{Value: schema.TtsRequestText75fe6b00{Text: "Hi", Model: schema.TtsRequestTexte253c939ModelAsSpeech26Hd{}, VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-2.6-hd", false, true, true, true},
		{&schema.TtsRequestAsText75fe6b00{Value: schema.TtsRequestText75fe6b00{Text: "Hi", Model: schema.TtsRequestTexte253c939ModelAsSpeech26Hd{}, VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-2.6-hd", false, true, true, true},
		{schema.TtsRequestAsText1ddad1c5{Value: schema.TtsRequestText1ddad1c5{Text: "Hi", Model: schema.TtsRequestTexte253c939ModelAsSpeech26Hd{}, VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-2.6-hd", false, true, false, true},
		{&schema.TtsRequestAsText1ddad1c5{Value: schema.TtsRequestText1ddad1c5{Text: "Hi", Model: schema.TtsRequestTexte253c939ModelAsSpeech26Hd{}, VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-2.6-hd", false, true, false, true},
		{schema.TtsRequestAsText7c0eb1eb{Value: schema.TtsRequestText7c0eb1eb{Text: "Hi", Model: schema.TtsRequestTexte253c939ModelAsSpeech26Hd{}, VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}}}, "speech-2.6-hd", false, true, false, false},
		{&schema.TtsRequestAsText7c0eb1eb{Value: schema.TtsRequestText7c0eb1eb{Text: "Hi", Model: schema.TtsRequestTexte253c939ModelAsSpeech26Hd{}, VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}}}, "speech-2.6-hd", false, true, false, false},
		{schema.TtsRequestAsTextVoicedd885701{Value: schema.TtsRequestTextVoicedd885701{Text: "Hi", Model: schema.TtsRequestTexte253c939ModelAsSpeech26Hd{}, Voice: "existing-voice", VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}}}, "speech-2.6-hd", false, false, true, false},
		{&schema.TtsRequestAsTextVoicedd885701{Value: schema.TtsRequestTextVoicedd885701{Text: "Hi", Model: schema.TtsRequestTexte253c939ModelAsSpeech26Hd{}, Voice: "existing-voice", VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}}}, "speech-2.6-hd", false, false, true, false},
		{schema.TtsRequestAsTextVoice36766bcb{Value: schema.TtsRequestTextVoice36766bcb{Text: "Hi", Model: schema.TtsRequestTexte253c939ModelAsSpeech26Hd{}, Voice: "existing-voice", VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-2.6-hd", false, false, true, true},
		{&schema.TtsRequestAsTextVoice36766bcb{Value: schema.TtsRequestTextVoice36766bcb{Text: "Hi", Model: schema.TtsRequestTexte253c939ModelAsSpeech26Hd{}, Voice: "existing-voice", VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-2.6-hd", false, false, true, true},
		{schema.TtsRequestAsTextVoicea492ec5e{Value: schema.TtsRequestTextVoicea492ec5e{Text: "Hi", Model: schema.TtsRequestTexte253c939ModelAsSpeech26Hd{}, Voice: "existing-voice", FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-2.6-hd", false, false, false, true},
		{&schema.TtsRequestAsTextVoicea492ec5e{Value: schema.TtsRequestTextVoicea492ec5e{Text: "Hi", Model: schema.TtsRequestTexte253c939ModelAsSpeech26Hd{}, Voice: "existing-voice", FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-2.6-hd", false, false, false, true},
		{schema.TtsRequestAsTextVoicecbe3fac7{Value: schema.TtsRequestTextVoicecbe3fac7{Text: "Hi", Model: schema.TtsRequestTexte253c939ModelAsSpeech26Hd{}, Voice: "existing-voice"}}, "speech-2.6-hd", false, false, false, false},
		{&schema.TtsRequestAsTextVoicecbe3fac7{Value: schema.TtsRequestTextVoicecbe3fac7{Text: "Hi", Model: schema.TtsRequestTexte253c939ModelAsSpeech26Hd{}, Voice: "existing-voice"}}, "speech-2.6-hd", false, false, false, false},
		{schema.TtsRequestAsStreamingText81902e1a{Value: schema.TtsRequestStreamingText81902e1a{Text: newSource(text("Hi")), Model: schema.TtsRequestTexte253c939ModelAsSpeech26Hd{}, VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}}}, "speech-2.6-hd", true, true, true, false},
		{&schema.TtsRequestAsStreamingText81902e1a{Value: schema.TtsRequestStreamingText81902e1a{Text: newSource(text("Hi")), Model: schema.TtsRequestTexte253c939ModelAsSpeech26Hd{}, VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}}}, "speech-2.6-hd", true, true, true, false},
		{schema.TtsRequestAsStreamingText909fab39{Value: schema.TtsRequestStreamingText909fab39{Text: newSource(text("Hi")), Model: schema.TtsRequestTexte253c939ModelAsSpeech26Hd{}, VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-2.6-hd", true, true, true, true},
		{&schema.TtsRequestAsStreamingText909fab39{Value: schema.TtsRequestStreamingText909fab39{Text: newSource(text("Hi")), Model: schema.TtsRequestTexte253c939ModelAsSpeech26Hd{}, VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-2.6-hd", true, true, true, true},
		{schema.TtsRequestAsStreamingText67fca2f3{Value: schema.TtsRequestStreamingText67fca2f3{Text: newSource(text("Hi")), Model: schema.TtsRequestTexte253c939ModelAsSpeech26Hd{}, VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-2.6-hd", true, true, false, true},
		{&schema.TtsRequestAsStreamingText67fca2f3{Value: schema.TtsRequestStreamingText67fca2f3{Text: newSource(text("Hi")), Model: schema.TtsRequestTexte253c939ModelAsSpeech26Hd{}, VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-2.6-hd", true, true, false, true},
		{schema.TtsRequestAsStreamingText5ae80cbf{Value: schema.TtsRequestStreamingText5ae80cbf{Text: newSource(text("Hi")), Model: schema.TtsRequestTexte253c939ModelAsSpeech26Hd{}, VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}}}, "speech-2.6-hd", true, true, false, false},
		{&schema.TtsRequestAsStreamingText5ae80cbf{Value: schema.TtsRequestStreamingText5ae80cbf{Text: newSource(text("Hi")), Model: schema.TtsRequestTexte253c939ModelAsSpeech26Hd{}, VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}}}, "speech-2.6-hd", true, true, false, false},
		{schema.TtsRequestAsStreamingTextVoicee206c70a{Value: schema.TtsRequestStreamingTextVoicee206c70a{Text: newSource(text("Hi")), Model: schema.TtsRequestTexte253c939ModelAsSpeech26Hd{}, Voice: "existing-voice", VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}}}, "speech-2.6-hd", true, false, true, false},
		{&schema.TtsRequestAsStreamingTextVoicee206c70a{Value: schema.TtsRequestStreamingTextVoicee206c70a{Text: newSource(text("Hi")), Model: schema.TtsRequestTexte253c939ModelAsSpeech26Hd{}, Voice: "existing-voice", VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}}}, "speech-2.6-hd", true, false, true, false},
		{schema.TtsRequestAsStreamingTextVoiceeb83b1ec{Value: schema.TtsRequestStreamingTextVoiceeb83b1ec{Text: newSource(text("Hi")), Model: schema.TtsRequestTexte253c939ModelAsSpeech26Hd{}, Voice: "existing-voice", VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-2.6-hd", true, false, true, true},
		{&schema.TtsRequestAsStreamingTextVoiceeb83b1ec{Value: schema.TtsRequestStreamingTextVoiceeb83b1ec{Text: newSource(text("Hi")), Model: schema.TtsRequestTexte253c939ModelAsSpeech26Hd{}, Voice: "existing-voice", VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-2.6-hd", true, false, true, true},
		{schema.TtsRequestAsStreamingTextVoice96bca430{Value: schema.TtsRequestStreamingTextVoice96bca430{Text: newSource(text("Hi")), Model: schema.TtsRequestTexte253c939ModelAsSpeech26Hd{}, Voice: "existing-voice", FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-2.6-hd", true, false, false, true},
		{&schema.TtsRequestAsStreamingTextVoice96bca430{Value: schema.TtsRequestStreamingTextVoice96bca430{Text: newSource(text("Hi")), Model: schema.TtsRequestTexte253c939ModelAsSpeech26Hd{}, Voice: "existing-voice", FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-2.6-hd", true, false, false, true},
		{schema.TtsRequestAsStreamingTextVoice21264c0c{Value: schema.TtsRequestStreamingTextVoice21264c0c{Text: newSource(text("Hi")), Model: schema.TtsRequestTexte253c939ModelAsSpeech26Hd{}, Voice: "existing-voice"}}, "speech-2.6-hd", true, false, false, false},
		{&schema.TtsRequestAsStreamingTextVoice21264c0c{Value: schema.TtsRequestStreamingTextVoice21264c0c{Text: newSource(text("Hi")), Model: schema.TtsRequestTexte253c939ModelAsSpeech26Hd{}, Voice: "existing-voice"}}, "speech-2.6-hd", true, false, false, false},
		{schema.TtsRequestAsText21d6f721{Value: schema.TtsRequestText21d6f721{Text: "Hi", VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}}}, "speech-2.8-hd", false, true, true, false},
		{&schema.TtsRequestAsText21d6f721{Value: schema.TtsRequestText21d6f721{Text: "Hi", VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}}}, "speech-2.8-hd", false, true, true, false},
		{schema.TtsRequestAsText5b5ff955{Value: schema.TtsRequestText5b5ff955{Text: "Hi", VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-2.8-hd", false, true, true, true},
		{&schema.TtsRequestAsText5b5ff955{Value: schema.TtsRequestText5b5ff955{Text: "Hi", VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-2.8-hd", false, true, true, true},
		{schema.TtsRequestAsText6f172e70{Value: schema.TtsRequestText6f172e70{Text: "Hi", VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-2.8-hd", false, true, false, true},
		{&schema.TtsRequestAsText6f172e70{Value: schema.TtsRequestText6f172e70{Text: "Hi", VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-2.8-hd", false, true, false, true},
		{schema.TtsRequestAsTexta20d3295{Value: schema.TtsRequestTexta20d3295{Text: "Hi", VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}}}, "speech-2.8-hd", false, true, false, false},
		{&schema.TtsRequestAsTexta20d3295{Value: schema.TtsRequestTexta20d3295{Text: "Hi", VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}}}, "speech-2.8-hd", false, true, false, false},
		{schema.TtsRequestAsTextVoice472a8ec3{Value: schema.TtsRequestTextVoice472a8ec3{Text: "Hi", Voice: "existing-voice", VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}}}, "speech-2.8-hd", false, false, true, false},
		{&schema.TtsRequestAsTextVoice472a8ec3{Value: schema.TtsRequestTextVoice472a8ec3{Text: "Hi", Voice: "existing-voice", VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}}}, "speech-2.8-hd", false, false, true, false},
		{schema.TtsRequestAsTextVoice6862a939{Value: schema.TtsRequestTextVoice6862a939{Text: "Hi", Voice: "existing-voice", VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-2.8-hd", false, false, true, true},
		{&schema.TtsRequestAsTextVoice6862a939{Value: schema.TtsRequestTextVoice6862a939{Text: "Hi", Voice: "existing-voice", VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-2.8-hd", false, false, true, true},
		{schema.TtsRequestAsTextVoice7c08f303{Value: schema.TtsRequestTextVoice7c08f303{Text: "Hi", Voice: "existing-voice", FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-2.8-hd", false, false, false, true},
		{&schema.TtsRequestAsTextVoice7c08f303{Value: schema.TtsRequestTextVoice7c08f303{Text: "Hi", Voice: "existing-voice", FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-2.8-hd", false, false, false, true},
		{schema.TtsRequestAsTextVoice9b47fc40{Value: schema.TtsRequestTextVoice9b47fc40{Text: "Hi", Voice: "existing-voice"}}, "speech-2.8-hd", false, false, false, false},
		{&schema.TtsRequestAsTextVoice9b47fc40{Value: schema.TtsRequestTextVoice9b47fc40{Text: "Hi", Voice: "existing-voice"}}, "speech-2.8-hd", false, false, false, false},
		{schema.TtsRequestAsStreamingText1aae4cf9{Value: schema.TtsRequestStreamingText1aae4cf9{Text: newSource(text("Hi")), VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}}}, "speech-2.8-hd", true, true, true, false},
		{&schema.TtsRequestAsStreamingText1aae4cf9{Value: schema.TtsRequestStreamingText1aae4cf9{Text: newSource(text("Hi")), VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}}}, "speech-2.8-hd", true, true, true, false},
		{schema.TtsRequestAsStreamingText09035640{Value: schema.TtsRequestStreamingText09035640{Text: newSource(text("Hi")), VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-2.8-hd", true, true, true, true},
		{&schema.TtsRequestAsStreamingText09035640{Value: schema.TtsRequestStreamingText09035640{Text: newSource(text("Hi")), VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-2.8-hd", true, true, true, true},
		{schema.TtsRequestAsStreamingTexte79a87b2{Value: schema.TtsRequestStreamingTexte79a87b2{Text: newSource(text("Hi")), VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-2.8-hd", true, true, false, true},
		{&schema.TtsRequestAsStreamingTexte79a87b2{Value: schema.TtsRequestStreamingTexte79a87b2{Text: newSource(text("Hi")), VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-2.8-hd", true, true, false, true},
		{schema.TtsRequestAsStreamingTextb71a212f{Value: schema.TtsRequestStreamingTextb71a212f{Text: newSource(text("Hi")), VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}}}, "speech-2.8-hd", true, true, false, false},
		{&schema.TtsRequestAsStreamingTextb71a212f{Value: schema.TtsRequestStreamingTextb71a212f{Text: newSource(text("Hi")), VoiceBlend: []schema.TtsRequestText77d171beVoiceBlendItem{{Voice: "existing-voice", Weight: 100}}}}, "speech-2.8-hd", true, true, false, false},
		{schema.TtsRequestAsStreamingTextVoice84ca6717{Value: schema.TtsRequestStreamingTextVoice84ca6717{Text: newSource(text("Hi")), Voice: "existing-voice", VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}}}, "speech-2.8-hd", true, false, true, false},
		{&schema.TtsRequestAsStreamingTextVoice84ca6717{Value: schema.TtsRequestStreamingTextVoice84ca6717{Text: newSource(text("Hi")), Voice: "existing-voice", VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}}}, "speech-2.8-hd", true, false, true, false},
		{schema.TtsRequestAsStreamingTextVoicee1061835{Value: schema.TtsRequestStreamingTextVoicee1061835{Text: newSource(text("Hi")), Voice: "existing-voice", VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-2.8-hd", true, false, true, true},
		{&schema.TtsRequestAsStreamingTextVoicee1061835{Value: schema.TtsRequestStreamingTextVoicee1061835{Text: newSource(text("Hi")), Voice: "existing-voice", VoiceTransform: schema.TtsRequestText77d171beVoiceTransform{}, FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-2.8-hd", true, false, true, true},
		{schema.TtsRequestAsStreamingTextVoice94f805c2{Value: schema.TtsRequestStreamingTextVoice94f805c2{Text: newSource(text("Hi")), Voice: "existing-voice", FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-2.8-hd", true, false, false, true},
		{&schema.TtsRequestAsStreamingTextVoice94f805c2{Value: schema.TtsRequestStreamingTextVoice94f805c2{Text: newSource(text("Hi")), Voice: "existing-voice", FormulaReading: schema.TtsRequestText8a99d813FormulaReading{}}}, "speech-2.8-hd", true, false, false, true},
		{schema.TtsRequestAsStreamingTextVoice9e2e17ce{Value: schema.TtsRequestStreamingTextVoice9e2e17ce{Text: newSource(text("Hi")), Voice: "existing-voice"}}, "speech-2.8-hd", true, false, false, false},
		{&schema.TtsRequestAsStreamingTextVoice9e2e17ce{Value: schema.TtsRequestStreamingTextVoice9e2e17ce{Text: newSource(text("Hi")), Voice: "existing-voice"}}, "speech-2.8-hd", true, false, false, false},
	}
	equal(t, len(cases), 96)
	for _, test := range cases {
		check, err := schema.ValidateRequest(test.request)
		if err != nil {
			t.Fatal(err)
		}
		if test.live {
			if err = check(text("Hi")); err != nil {
				t.Fatal(err)
			}
		}
		c, err := settings(test.request)
		if err != nil {
			t.Fatal(err)
		}
		equal(t, c.wire["model"], test.model)
		equal(t, c.input != nil, test.live)
		language := "auto"
		if test.formula {
			language = "Chinese"
		}
		equal(t, c.wire["language_boost"], language)
		voice := c.wire["voice_setting"].(map[string]any)
		equal(t, voice["latex_read"], test.formula)
		id := "existing-voice"
		if test.blend {
			id = ""
		}
		equal(t, voice["voice_id"], id)
		_, blended := c.wire["timbre_weights"]
		equal(t, blended, test.blend)
		_, effects := c.wire["voice_modify"]
		equal(t, effects, test.effects)
		_, continuous := c.wire["continuous_sound"]
		equal(t, continuous, test.live && test.model == "speech-2.8-hd")
	}
}
func TestAbsentOptionValuesDoNotLeakIntoConfiguration(t *testing.T) {
	r := request()
	r.Value.Output = runtime.Optional[schema.TtsRequestTextf2dcc77eOutput]{Value: schema.TtsRequestTextf2dcc77eOutputAsWava066cb88{}}
	r.Value.Model = runtime.Optional[schema.TtsRequestText21d6f721Model]{Value: schema.TtsRequestText21d6f721ModelAsSpeech28Turbo{}}
	r.Value.VolumeScale = runtime.Optional[float64]{Value: -1}
	c, err := settings(r)
	if err != nil {
		t.Fatal(err)
	}
	equal(t, c.wire["model"], "speech-2.8-hd")
	equal(t, c.wire["voice_setting"].(map[string]any)["vol"], float64(1))
	equal(t, c.wire["audio_setting"].(map[string]any)["format"], "mp3")
	s := newSocket()
	r2 := streaming(newSource())
	r2.Value.SplitTurns = runtime.Optional[schema.TtsRequestText77d171beOutputMp3ConstantBitRate]{Value: schema.TtsRequestText77d171beOutputMp3ConstantBitRateAsFalse{}}
	stream, err := Synthesize(context.Background(), r2, Options{WebSocket: s})
	if err != nil {
		t.Fatal(err)
	}
	collect(t, stream)
	equal(t, s.frames()[0]["continuous_sound"], false)
}
