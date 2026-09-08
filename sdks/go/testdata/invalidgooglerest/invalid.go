package invalidgooglerest
import (
    wire "github.com/speechswitch/client/sdks/go/clients/google_rest"
    "github.com/speechswitch/client/sdks/go/runtime"
)
var _ = wire.AudioConfig{AudioEncoding: runtime.Some("FLAC")}
var _ = wire.AudioConfig{SampleRateHertz: runtime.Some(1.5)}
var _ = wire.SynthesizeSpeechRequest{Input: runtime.Some((*wire.SynthesisInput)(nil))}
var _ = wire.SynthesizeSpeechRequest{EnableTimePointing: nil}
