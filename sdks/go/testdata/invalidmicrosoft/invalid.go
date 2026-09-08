package invalidmicrosoft
import (
 schema "github.com/speechswitch/client/sdks/go/generated/microsoft"
 out "github.com/speechswitch/client/sdks/go/generated/microsoft_output"
 "github.com/speechswitch/client/sdks/go/runtime"
)
func staticLexicon(r *schema.TtsRequestTextVoice4ff226b4) { r.LexiconUrl = runtime.Some("url") }
func staticLanguages(r *schema.TtsRequestTextVoice4ff226b4) { r.PreferredLanguages = runtime.Some([]string{"en-US"}) }
func hdProsody(r *schema.TtsRequestDragonHdTextVoice) { r.Speed = runtime.Some(1.0) }
func streamingSampling(r *schema.TtsRequestDragonHdOmniStreamingTextVoice) { r.TopK = runtime.Some(20.0) }
var wave = schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsWavbcb4c8a6{}
func commands(input runtime.Input[int]) { _ = schema.TtsRequestDragonHdStreamingTextVoice{Text:input} }
var clear = out.SynthesisItemAsClear{}
func reference(r *schema.TtsRequestTextVoice4ff226b4) { r.ReferenceAudio = []byte{1} }
func correlation(r *out.MicrosoftEnvelope) { r.Correlation = "chunk" }
