package invalidgoogleprotobuf
import (
    wire "github.com/speechswitch/client/sdks/go/clients/google_grpc"
    "github.com/speechswitch/client/sdks/go/runtime"
)
var _ wire.AudioEncoding = "PCM"
var _ wire.StreamingSynthesisInputInputSource = wire.StreamingSynthesizeRequest_Input{}
var _ = wire.StreamingAudioConfig{SampleRateHertz: runtime.Some(24000.5)}
var _ = wire.StreamingSynthesisInput{Prompt: runtime.Some((*string)(nil))}
var _ = wire.StreamingSynthesizeRequest{StreamingRequest: wire.StreamingSynthesizeRequest_Input{}, StreamingRequest: wire.StreamingSynthesizeRequest_StreamingConfig{}}
var _ = wire.AudioEncoding_MP3_64_KBPS{}
