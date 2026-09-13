package invalidelevenlabs

import schema "github.com/speechswitch/client/sdks/go/generated/elevenlabs"

func speed(r *schema.TtsRequestElevenV3TextVoiceedc22df3) { r.Speed = 1 }
func buffering(r *schema.TtsRequestStreamingTextVoicef49cfea8) { r.TextBufferThresholds = nil }
func output(r *schema.TtsRequestStreamingTextVoice194990a6) { r.Output = schema.TtsRequestTextVoice4a0120aeOutputAsWav{} }
func clear() schema.TtsRequestElevenV3StreamingTextVoicef18e078fTextItem { return schema.TtsRequestStreamingTextVoice194990a6TextItemAsClear{} }
