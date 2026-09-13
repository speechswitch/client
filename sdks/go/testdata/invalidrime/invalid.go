package invalidrime
import schema "github.com/speechswitch/client/sdks/go/generated/rime"
func codaMarkup(r *schema.TtsRequestCodaTextVoicef75e9756) { r.TextMarkup = nil }
func spanishPhonemes(r *schema.TtsRequestMistV3StreamingTextVoice49f68e83TextMarkup) { r.Phonemes = true }
func frenchTimestamps(r *schema.TtsRequestCodaTextVoice50d85478) { r.TimestampGranularity = nil }
func legacyWav(r *schema.TtsRequestMistV2StreamingTextVoice03cc8904OutputPcm) { r.Format = "wav" }
func modernNormalization(r *schema.TtsRequestMistV3TextVoice2a5bc5c5) { r.TextNormalization = true }
func floatPCM(r *schema.TtsRequestCodaStreamingTextVoice84ec2db1OutputObjectb2df2f24) { r.SampleEncoding.Value = "float_32" }
func reference(r *schema.TtsRequestCodaTextVoicef75e9756) { r.ReferenceAudio = []byte{} }
func model(r *schema.TtsRequestCodaTextVoicef75e9756) { r.Model = "mist-v2" }
