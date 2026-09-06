package invalidstream
import "github.com/speechswitch/client/sdks/go/generated/stream"
var invalidAudio = stream.SynthesisEnvelopeChunk{Audio: "base64"}
var invalidEvent = stream.ClearEvent{Event: "cancel"}
var bareAudio stream.TimestampStreamItem = stream.AudioStreamItemAsBytes{Value: []byte{1}}
