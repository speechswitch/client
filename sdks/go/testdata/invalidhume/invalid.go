package invalidhume
import (
    schema "github.com/speechswitch/client/sdks/go/generated/hume"
    out "github.com/speechswitch/client/sdks/go/generated/hume_output"
)
func acting(r *schema.TtsRequestOctave2TextVoice) { r.Instructions = "Whisper" }
func design(r *schema.TtsRequestOctave2TextVoice) { r.VoiceDescription = "Narrator" }
func timestamps(r *schema.TtsRequestOctave1TextVoice) { r.TimestampGranularity = "word" }
func rate(r *schema.TtsRequestOctave1TextOutput) { r.SampleRateHz = 24000 }
func voice(r *schema.TtsRequestOctave2TextVoice) { r.VoiceName = "Ava" }
var clear schema.TtsRequestOctave2StreamingTurnsTurnsItem = schema.TtsRequestOctave2StreamingTurnsTurnsItemAsClear{}
func turn(r *schema.TtsRequestOctave2TurnsContextBeforeTurnsTurnsItem) { r.Instructions = "Whisper" }
func association(r *out.HumeEnvelope) { r.Correlation = "chunk" }
var event out.SynthesisItem = out.SynthesisItemAsFlush{}
func split(r *schema.TtsRequestOctave2StreamingTextVoice) { r.SplitTurns = false }
