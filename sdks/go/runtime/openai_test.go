package runtime_test

import (
    "testing"
    "github.com/speechswitch/client/sdks/go/generated/openai"
    "github.com/speechswitch/client/sdks/go/runtime"
)

func TestOpenaiCustomVoiceRetainsModernModelAndExplicitFalse(t *testing.T) {
    var usage openai.TtsRequestTextVoicef51a0f7eIncludeUsage = openai.TtsRequestTextVoicef51a0f7eIncludeUsageAsFalse{}
    request := openai.TtsRequestTextVoicef3ee42bf{
        Model: openai.TtsRequestTextVoicef51a0f7eModelAsGpt4oMiniTts{}, Text: "Hello", Voice: "saved-voice",
        VoiceSource: openai.TtsRequestTextVoicef3ee42bfVoiceSource{}, Instructions: runtime.Some("Whisper"), IncludeUsage: runtime.Some(usage),
    }
    if request.VoiceSource.Value() != "custom" || request.Instructions.Value != "Whisper" || !request.IncludeUsage.Present {
        t.Fatalf("lost custom voice or presence: %#v", request)
    }
    flag, ok := request.IncludeUsage.Value.(openai.TtsRequestTextVoicef51a0f7eIncludeUsageAsFalse)
    if !ok || flag.Value.Value() { t.Fatal("lost explicit false") }
    var normalized openai.TtsRequest = openai.TtsRequestAsTextVoicef3ee42bf{Value: request}
    if _, ok := normalized.(openai.TtsRequestAsTextVoicef3ee42bf); !ok { t.Fatal("lost custom branch") }
}
