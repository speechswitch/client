package invalidsmallest
import "github.com/speechswitch/client/sdks/go/generated/smallest_ai"
import "github.com/speechswitch/client/sdks/go/runtime"
import output "github.com/speechswitch/client/sdks/go/generated/smallest_ai_output"
var _ = smallest_ai.TtsRequestLightningV31StreamingTextVoicebf9ab904LanguageAsJa{}
var _ = smallest_ai.TtsRequestAsLightningV2{}
var _ = smallest_ai.TtsRequestLightningV31ProTextVoice3c7c5185{Voice: "custom-voice"}
var _ = smallest_ai.TtsRequestLightningV31ProStreamingTextVoice4f8c2395LanguageAsJa{}
var _ = smallest_ai.TtsRequestLightningV31StreamingTextVoicebf9ab904{CompletionDelayMs: runtime.Some(1.0)}
var _ = smallest_ai.TtsRequestLightningV31StreamingTextVoiced272850b{PronunciationDictionaries: nil}
var _ = smallest_ai.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject1e4e72b8{SampleEncoding: nil}
var _ = output.SmallestEnvelope{Audio: []byte{1}}
func invalidCommands(commands runtime.Input[smallest_ai.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbTextItem]) {
    _ = smallest_ai.TtsRequestLightningV31StreamingTextVoiced272850b{Text: commands}
}
