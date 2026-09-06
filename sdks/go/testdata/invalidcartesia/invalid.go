package invalidcartesia
import (
 "github.com/speechswitch/client/sdks/go/generated/cartesia"
 "github.com/speechswitch/client/sdks/go/generated/cartesia_output"
 "github.com/speechswitch/client/sdks/go/runtime"
)
func invalid(old *cartesia.TtsRequestTextVoicef0bb1766, live *cartesia.TtsRequestStreamingTextVoice0bf53a99, output *cartesia_output.TimelineOutput) {
 old.Language = runtime.Some("en-GB")
 live.Output = cartesia.TtsRequestTextVoicef0bb1766OutputAsMp3{}
 output.Correlation = "chunk"
}
