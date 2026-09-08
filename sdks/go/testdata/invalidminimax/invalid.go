package invalidminimax
import (
 schema "github.com/speechswitch/client/sdks/go/generated/minimax"
 out "github.com/speechswitch/client/sdks/go/generated/minimax_output"
 "github.com/speechswitch/client/sdks/go/runtime"
)
func legacyLanguage(r *schema.TtsRequestTextVoice9d11e112) { r.Language = runtime.Some[schema.TtsRequestText77d171beLanguage](schema.TtsRequestTexte253c939LanguageAsFa{}) }
func modernEmotion(r *schema.TtsRequestTextVoice9b47fc40) { r.Emotion = runtime.Some[schema.TtsRequestText77d171beEmotion](schema.TtsRequestTexte253c939EmotionAsWhisper{}) }
func socketNormalization(r *schema.TtsRequestStreamingTextVoice9e2e17ce) { r.TextNormalization = true }
func socketTimestamps(r *schema.TtsRequestStreamingTextVoice9e2e17ce) { r.TimestampGranularity = "word" }
func olderSegmentation(r *schema.TtsRequestStreamingTextVoicee206c70a) { r.SplitTurns = true }
func voiceBlend(r *schema.TtsRequestTextVoice9b47fc40) { r.VoiceBlend = []string{"voice"} }
func reference(r *schema.TtsRequestTextVoice9b47fc40) { r.ReferenceAudio = []byte{1} }
var wave schema.TtsRequestStreamingTextaa771f19Output = schema.TtsRequestTextf2dcc77eOutputAsWava066cb88{}
var update = schema.TtsRequestStreamingText12421ea0TextItemAsUpdate{}
func correlation(r *out.MiniMaxEnvelope) { r.Correlation = "chunk" }
func flush(r *out.FlushEvent) { r.CorrelationId = 1 }
