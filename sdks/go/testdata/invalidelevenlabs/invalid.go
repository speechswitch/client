package invalidelevenlabs

import schema "github.com/speechswitch/client/sdks/go/generated/elevenlabs"

func speed(r *schema.TtsRequestElevenV3TextVoicec3eabebc) { r.Speed = 1 }
func buffering(r *schema.TtsRequestStreamingTextVoice732994d4) { r.TextBufferThresholds = nil }
func output(r *schema.TtsRequestStreamingTextVoice5024de38) { r.Output = schema.TtsRequestTextVoice814840b5OutputAsWav{} }
func clear() schema.TtsRequestElevenV3StreamingTextVoice145c0c5aTextItem { return schema.TtsRequestStreamingTextVoice5024de38TextItemAsClear{} }
