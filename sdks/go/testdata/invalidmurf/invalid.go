package invalidmurf
import (
 schema "github.com/speechswitch/client/sdks/go/generated/murf"
 out "github.com/speechswitch/client/sdks/go/generated/murf_output"
 "github.com/speechswitch/client/sdks/go/runtime"
)
func duration(r *schema.TtsRequestTextVoice) { r.TargetDurationMs = runtime.Some(float64(0)) }
func timestamps(r *schema.TtsRequestTextVoice) { r.TimestampGranularity = "word" }
func retention(r *schema.TtsRequestStreamingTextVoice) { r.AudioRetention = false }
func reference(r *schema.TtsRequestTextVoice) { r.ReferenceAudio = []byte{0} }
func update(r *schema.TtsRequestStreamingTextVoiceTextItemUpdate) { r.Replacements = []string{} }
func stream(r *schema.TtsRequestGen2TextVoiceca621e19, input runtime.Input[string]) { r.Text = input }
var rate schema.TtsRequestGen2TextVoiceca621e19OutputSampleRateHz = schema.TtsRequestStreamingTextVoiceOutputSampleRateHzAsNumber16000{}
func chunk(r *out.MurfEnvelope) { r.Correlation = "chunk" }
var updated out.SynthesisItemAsUpdated
func flush(r *out.FlushEvent) { r.InputGroupId = 1 }
