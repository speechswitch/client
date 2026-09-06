package invalidgoogle
import (
 schema "github.com/speechswitch/client/sdks/go/generated/google"
 "github.com/speechswitch/client/sdks/go/runtime"
)
func chirpInstructions(r *schema.TtsRequestChirp3Hda92b414c) { r.Instructions = runtime.Some("warm") }
func cloneMP3(r *schema.TtsRequestChirp3InstantCustomVoiceTextVoicedb488368) { r.Output = schema.TtsRequestChirp3HdTextVoicebb77af5cOutputAsMp3{} }
func liteDialogue(r *schema.TtsRequestObject8dbffa0c) { r.Model = schema.TtsRequestTextVoiceModelAsGemini25FlashLitePreviewTts{} }
func streamingHTTPControl(r *schema.TtsRequestObject7d956f3d) { r.VolumeDb = runtime.Some(0.0) }
func streamingWAV(r *schema.TtsRequestObject7d956f3d) { r.Output = schema.TtsRequestChirp3HdTextVoicebb77af5cOutputAsWav{} }
func streamingText(r *schema.TtsRequestChirp3Hda92b414c, commands runtime.Input[int]) { r.Text = schema.TtsRequestChirp3Hda92b414cTextAsAsyncIterable{Value: commands} }
