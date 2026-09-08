package runtime_test

import (
    "testing"
    "github.com/speechswitch/client/sdks/go/generated/typecast"
    "github.com/speechswitch/client/sdks/go/runtime"
)

func TestTypecastSmartEmotionPreservesEmptyContextAndZeroLoudness(t *testing.T) {
    request := typecast.TtsRequestSsfmV30TextVoicebb79df90{
        Text: "Hello", Voice: "uc_voice",
        ContextBefore: runtime.Some(typecast.TtsRequestObjectSegmentsItemSsfmV30TextVoice0e2e956cContextAfter{Text: ""}),
        RandomSeed: runtime.Some(0.0), TargetLoudnessLufs: runtime.Some(0.0),
    }
    if request.Model.Value() != "ssfm-v30" || request.Emotion.Value() != "auto" { t.Fatal("lost model or smart emotion") }
    if !request.ContextBefore.Present || request.ContextBefore.Value.Text != "" { t.Fatal("lost present empty context") }
    if !request.RandomSeed.Present || request.RandomSeed.Value != 0 || !request.TargetLoudnessLufs.Present || request.TargetLoudnessLufs.Value != 0 { t.Fatal("lost explicit zero") }
}
