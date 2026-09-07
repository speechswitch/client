package invalidvocu
import ("context"; "github.com/speechswitch/client/sdks/go/generated/vocu"; out "github.com/speechswitch/client/sdks/go/generated/vocu_output"; provider "github.com/speechswitch/client/sdks/go/providers/vocu"; "github.com/speechswitch/client/sdks/go/runtime")
func markup(request *vocu.TtsRequestTextVoicee296d426) {
    request.SubtitleFormat = vocu.TtsRequestObject9cd7c2eeSubtitleFormat{}
}
func model() { _ = vocu.TtsRequestTextVoice9c5ed44a{Model: "v3.5"} }
func reference() { _ = vocu.TtsRequestTextVoice9c5ed44a{ReferenceEmphasis: vocu.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasisAsExpressive{}} }
func splitter() { _ = vocu.TtsRequestText8f38e545{Voice: "owned"} }
func clear() { _ = out.SynthesisItemAsClear{} }
func streaming() { _ = vocu.TtsRequestTextVoice9c5ed44a{Text: runtime.Input[string](nil)} }
func wrongRequest(ctx context.Context) { _, _ = provider.Synthesize(ctx, out.SynthesisItemAsDone{}, provider.Options{}) }
