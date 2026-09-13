package invalidresemble
import "github.com/speechswitch/client/sdks/go/generated/resemble"
func language(r *resemble.TtsRequestText) { r.Language = "en" }
func guidance(r *resemble.TtsRequestChatterboxTurboText) { r.VoiceGuidance = 0.5 }
func sampling(r *resemble.TtsRequestChatterboxMultilingualText) { r.TopP = 0.5 }
func streaming(r *resemble.TtsRequestText, text <-chan string) { r.Text = text }
func voice(r *resemble.TtsRequestText) { r.Voice = "saved" }
func output(r *resemble.TtsRequestTextOutput) { r.SampleRateHz = 24000 }
