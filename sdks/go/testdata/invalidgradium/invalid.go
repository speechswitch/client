package invalidgradium

import schema "github.com/speechswitch/client/sdks/go/generated/gradium"
import out "github.com/speechswitch/client/sdks/go/generated/gradium_output"

func speed(r *schema.TtsRequest) { _ = r.Speed }
func opusRate(r *schema.TtsRequestOutputOggOpus) { _ = r.SampleRateHz }
func normalization(r *schema.TtsRequestTextNormalizationObjecte21202a8) { _ = r.Rules }
func clear() schema.TtsRequestTextAsyncIterableItem { return schema.TtsRequestTextAsyncIterableItemAsClear{} }
func correlation(o *out.TimelineOutput) { o.Correlation = "chunk" }
func event() out.SynthesisItem { return out.SynthesisItemAsClear{} }
