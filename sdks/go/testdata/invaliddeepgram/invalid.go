package invaliddeepgram
import (
 schema "github.com/speechswitch/client/sdks/go/generated/deepgram"
 "github.com/speechswitch/client/sdks/go/runtime"
)
func tags(r *schema.TtsRequestAura1StreamingTextVoice) { r.Tags = runtime.Some([]string{"tag"}) }
func format(r *schema.TtsRequestAura1StreamingTextVoice) { r.Output = schema.TtsRequestAura1TextVoiceOutputAsMp3{} }
func language(r *schema.TtsRequestAura1TextVoice) { r.Language = "es" }
