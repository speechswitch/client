package runtime_test

import (
    "testing"
    "github.com/speechswitch/client/sdks/go/generated/vocu"
    "github.com/speechswitch/client/sdks/go/runtime"
)

func TestVocuMarkupPreservesVoiceAndZeroSeed(t *testing.T) {
    var vivid vocu.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeLongTextMode = vocu.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeLongTextModeAsFalse{}
    request := vocu.TtsRequestTextVoicee296d426{
        Text: "{{happy}}Hello", Voice: "market:owned", VoiceStyle: runtime.Some("existing-style"), RandomSeed: runtime.Some(0.0),
        VividExpression: runtime.Some(vivid),
    }
    if request.InputType.Value() != "markup" || request.Voice != "market:owned" { t.Fatal("lost markup or voice") }
    if !request.VoiceStyle.Present || request.VoiceStyle.Value != "existing-style" { t.Fatal("lost style") }
    if !request.RandomSeed.Present || request.RandomSeed.Value != 0 { t.Fatal("lost zero seed") }
    if !request.VividExpression.Present { t.Fatal("lost present false") }
    if _, ok := request.VividExpression.Value.(vocu.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeLongTextModeAsFalse); !ok { t.Fatal("lost false value") }
}
