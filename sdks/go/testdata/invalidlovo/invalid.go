package invalidlovo
import (
 schema "github.com/speechswitch/client/sdks/go/generated/lovo"
 out "github.com/speechswitch/client/sdks/go/generated/lovo_output"
)
func model(r *schema.TtsRequest) { r.Model = "pro" }
func language(r *schema.TtsRequest) { r.Language = "en" }
func format(r *schema.TtsRequest) { r.Output = "mp3" }
func streaming(r *schema.TtsRequest) { r.Text = []string{"Hi"} }
func voice(r *schema.TtsRequest) { r.Voice = 1 }
func reference(r *schema.TtsRequest) { r.ReferenceAudio = []byte{1} }
func correlation(r *out.SynthesisItem) { r.Correlation = "chunk" }
func timestamps(r *out.SynthesisItem) { r.Timestamps = [1]struct{}{{}} }
