package runtime_test

import (
    "testing"
    "github.com/speechswitch/client/sdks/go/generated/smallest_ai"
    "github.com/speechswitch/client/sdks/go/runtime"
)

func TestSmallestProPreservesJapaneseAndFalse(t *testing.T) {
    var language smallest_ai.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbLanguage = smallest_ai.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbLanguageAsJa{}
    var math smallest_ai.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbFormulaReading = smallest_ai.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbFormulaReadingAsFalse{}
    request := smallest_ai.TtsRequestLightningV31ProTextVoice74d06326{
        Text: "こんにちは", Voice: "saved-voice", Language: runtime.Some(language), FormulaReading: runtime.Some(math),
    }
    if request.Model.Value() != "lightning-v3.1-pro" || !request.Language.Present || !request.FormulaReading.Present { t.Fatalf("lost model or presence: %#v", request) }
    lang, ok := request.Language.Value.(smallest_ai.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbLanguageAsJa)
    if !ok || lang.Value.Value() != "ja" { t.Fatal("lost Japanese") }
    flag, ok := request.FormulaReading.Value.(smallest_ai.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbFormulaReadingAsFalse)
    if !ok || flag.Value.Value() { t.Fatal("lost false") }
}
