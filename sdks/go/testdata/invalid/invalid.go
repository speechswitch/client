package invalid

import (
    "github.com/speechswitch/client/sdks/go/generated/hume"
    "github.com/speechswitch/client/sdks/go/generated/xai"
    "github.com/speechswitch/client/sdks/go/runtime"
)

func wrongModel(request *hume.TtsRequestOctave2TextVoice) {
    request.Instructions = "Whisper"
}
var wrongLiteral xai.TtsRequestStreamingTextTextItemClearCommand = "cancel"
func wrongStream(input runtime.Input[xai.TtsRequestStreamingTextTextItem]) runtime.Input[string] {
    return input
}
