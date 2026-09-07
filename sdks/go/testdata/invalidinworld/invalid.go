package invalidinworld

import schema "github.com/speechswitch/client/sdks/go/generated/inworld"
import out "github.com/speechswitch/client/sdks/go/generated/inworld_output"

func temperature(r *schema.TtsRequestInworldTts2TextVoice) { r.Temperature = r.Temperature }
func delivery(r *schema.TtsRequestTextVoice) { r.DeliveryMode = r.DeliveryMode }
func instructions(r *schema.TtsRequestTextVoice) { r.Instructions = r.Instructions }
func acting(r *schema.TtsRequestInworldTts2StreamingTextVoice) { r.Instructions = r.Instructions }
func voice(r *schema.TtsRequestInworldTts2TextVoice) { r.VoiceName = r.VoiceName }
func flac() schema.TtsRequestStreamingTextVoiceOutput { return schema.TtsRequestStreamingTextVoiceOutputAsFlac{} }
func clear() schema.TtsRequestStreamingTextVoiceTextItem { return schema.TtsRequestStreamingTextVoiceTextItemAsClear{} }
func event() out.SynthesisItem { return out.SynthesisItemAsClear{} }
func correlation(r *out.InworldTimelineEnvelope) { r.Correlation = "chunk" }
func timing(r *schema.TtsRequestStreamingTextVoice) { r.ContextBefore = r.ContextBefore }
