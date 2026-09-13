package invalidrespeecher
import r "github.com/speechswitch/client/sdks/go/generated/respeecher"
func stream(v *r.TtsRequestTextVoice, text <-chan string) { v.Text = text }
func encoding(v *r.TtsRequestObjectOutputMulaw) { v.SampleEncoding = "float_32" }
func reference(v *r.TtsRequestObject) { v.ReferenceAudio = []byte{} }
func timestamps(v *r.TtsRequestObject) { v.TimestampGranularity = "word" }
func format(v *r.TtsRequestTextVoiceOutput) { v.Format = "mp3" }
func model(v *r.TtsRequestObject) { v.Model = "marketplace" }
