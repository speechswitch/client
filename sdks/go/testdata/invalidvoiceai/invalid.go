package invalidvoiceai

import (
	"context"
	"github.com/speechswitch/client/sdks/go/generated/voice_ai"
	out "github.com/speechswitch/client/sdks/go/generated/voice_ai_output"
	provider "github.com/speechswitch/client/sdks/go/providers/voice_ai"
)

func invalid(request *voice_ai.TtsRequestObjectdd71553d) {
	request.Language.Value = voice_ai.TtsRequestObject1ec54d36LanguageEs{}
}

var paced = voice_ai.TtsRequestObject4870017d{Output: voice_ai.TtsRequestObject1ec54d36OutputAsMp3904ec5a3{}}
var legacy = voice_ai.TtsRequestTextVoice{Text: voice_ai.TtsRequestObject1ec54d36TextAsAsyncIterable{}}
var dictionary = voice_ai.TtsRequestObject1ec54d36PronunciationDictionariesItem{Id: "id", VersionId: "revision"}
var timing = out.VoiceAiEnvelope{Timestamps: [1]struct{}{{}}}

func wrongRequest() {
	provider.Synthesize(context.Background(), voice_ai.TtsRequestObject1ec54d36{}, provider.Options{})
}
