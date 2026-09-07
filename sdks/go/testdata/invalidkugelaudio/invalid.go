package invalidkugelaudio

import schema "github.com/speechswitch/client/sdks/go/generated/kugelaudio"
import out "github.com/speechswitch/client/sdks/go/generated/kugelaudio_output"

func format() schema.TtsRequestTextVoiceOutput { return schema.TtsRequestTextVoiceOutputAsMp3{} }
func rate(r *schema.TtsRequestTextVoiceOutputObject) { r.SampleRateHz = r.Format }
func buffering(r *schema.TtsRequestTextVoice) { r.TextFlushDelayMs = r.TextFlushDelayMs }
func voice(r *schema.TtsRequestTextVoice) { r.VoiceName = r.VoiceName }
func updateVoice(r *schema.TtsRequestStreamingTextVoiceTextItemUpdate) { r.Voice = r.Voice }
func replacements(r *schema.TtsRequestStreamingTextVoiceTextItemUpdate) { r.Replacements = r.Replacements }
func clearOutput(r *schema.TtsRequestStreamingTextVoiceTextItemClear) { r.Output = r.Output }
func correlation(r *out.KugelAudioEnvelope) { r.Correlation = "chunk" }
func model(r *schema.TtsRequestTextVoice) { r.Model = "unknown" }
func event() out.SynthesisItem { return out.SynthesisItemAsBatch{} }
