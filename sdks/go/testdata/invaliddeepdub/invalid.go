package invaliddeepdub
import (
 schema "github.com/speechswitch/client/sdks/go/generated/deepdub"
 "github.com/speechswitch/client/sdks/go/runtime"
)
func seed(r *schema.TtsRequestTextVoiceb776b412) { r.RandomSeed = 42 }
func duration(r *schema.TtsRequestTextVoice5ce3f477) { r.Speed = runtime.Some(1.0) }
func rate(r *schema.TtsRequestOg11Text188d3251Output) { r.SampleRateHz = runtime.Some(12000.0) }
