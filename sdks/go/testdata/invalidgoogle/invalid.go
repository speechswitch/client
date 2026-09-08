package invalidgoogle
import (
 schema "github.com/speechswitch/client/sdks/go/generated/google"
 "github.com/speechswitch/client/sdks/go/runtime"
)
func chirpInstructions(r *schema.TtsRequestChirp3Hd174648a4) { r.Instructions = runtime.Some("warm") }
func cloneMP3(r *schema.TtsRequestChirp3InstantCustomVoiceTextVoiced9d056de) { r.Output = schema.TtsRequestChirp3HdTextVoiceffbf1cc1OutputAsMp3{} }
func liteDialogue(r *schema.TtsRequestTurns9a76562f) { r.Model = schema.TtsRequestTextVoiceModelAsGemini25FlashLitePreviewTts{} }
func streamingHTTPControl(r *schema.TtsRequestObjecta65cbd8a) { r.VolumeDb = runtime.Some(0.0) }
func streamingWAV(r *schema.TtsRequestObjecta65cbd8a) { r.Output = schema.TtsRequestChirp3HdTextVoiceffbf1cc1OutputAsWav{} }
func streamingText(r *schema.TtsRequestChirp3Hd174648a4, commands runtime.Input[int]) { r.Text = schema.TtsRequestChirp3Hd174648a4TextAsAsyncIterable{Value: commands} }
