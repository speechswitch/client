package invalidfish

import schema "github.com/speechswitch/client/sdks/go/generated/fish"

func speakers(r *schema.TtsRequestS1TextVoice) { _ = r.Speakers }
func loudness(r *schema.TtsRequestS1TextVoice) { _ = r.LoudnessNormalization }
func bitrate(r *schema.TtsRequestS1TextOutputObject) { _ = r.BitRateBps }
func timestamps(r *schema.TtsRequestStreamingTextVoice) { _ = r.TimestampGranularity }
