package google_grpc_test

import (
	"bytes"
	"encoding/hex"
	"math"
	"testing"

	wire "github.com/speechswitch/client/sdks/go/clients/google_grpc"
	beta "github.com/speechswitch/client/sdks/go/clients/google_grpc_beta"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func TestProtobufPresenceAndOneofs(t *testing.T) {
	for _, input := range []wire.StreamingSynthesizeRequestStreamingRequest{
		wire.StreamingSynthesizeRequest_Input{Value: wire.StreamingSynthesisInput{InputSource: wire.StreamingSynthesisInput_Text{Value: ""}, Prompt: runtime.Some("")}},
		&wire.StreamingSynthesizeRequest_Input{Value: wire.StreamingSynthesisInput{InputSource: &wire.StreamingSynthesisInput_Text{Value: ""}, Prompt: runtime.Some("")}},
	} {
		data, err := wire.EncodeStreamingRequest(wire.StreamingSynthesizeRequest{StreamingRequest: input})
		if err != nil || hex.EncodeToString(data) != "12040a003200" {
			t.Fatalf("present empty oneof/prompt: %x, %v", data, err)
		}
	}
	data, err := wire.EncodeStreamingRequest(wire.StreamingSynthesizeRequest{})
	if err != nil || len(data) != 0 {
		t.Fatalf("absent oneof: %x, %v", data, err)
	}
	for _, encoding := range []wire.AudioEncoding{wire.AudioEncoding_AUDIO_ENCODING_UNSPECIFIED{}, &wire.AudioEncoding_AUDIO_ENCODING_UNSPECIFIED{}} {
		data, err := wire.EncodeStreamingAudioConfig(wire.StreamingAudioConfig{AudioEncoding: encoding, SampleRateHertz: runtime.Some(int32(0)), SpeakingRate: runtime.Some(float64(0))})
		if err != nil || hex.EncodeToString(data) != "08001000190000000000000000" {
			t.Fatalf("present zero: %x, %v", data, err)
		}
	}
	data, err = wire.EncodeAdvancedVoiceOptions(wire.AdvancedVoiceOptions{EnableTextnorm: runtime.Some(false)})
	if err != nil || hex.EncodeToString(data) != "1000" {
		t.Fatalf("present false: %x, %v", data, err)
	}
	data, err = wire.EncodeMultiSpeakerMarkup(wire.MultiSpeakerMarkup{Turns: []wire.MultiSpeakerMarkupTurn{}})
	if err != nil || len(data) != 0 {
		t.Fatalf("present empty repeated field: %x, %v", data, err)
	}
}

func TestProtobufInvalidPresenceAndTypedNil(t *testing.T) {
	for _, test := range []struct {
		encode func() ([]byte, error)
		error  string
	}{
		{func() ([]byte, error) { return wire.EncodeStreamingAudioConfig(wire.StreamingAudioConfig{}) }, "Invalid protobuf AudioEncoding"},
		{func() ([]byte, error) {
			return wire.EncodeStreamingAudioConfig(wire.StreamingAudioConfig{AudioEncoding: (*wire.AudioEncoding_PCM)(nil)})
		}, "Invalid protobuf AudioEncoding"},
		{func() ([]byte, error) {
			return wire.EncodeStreamingRequest(wire.StreamingSynthesizeRequest{StreamingRequest: (*wire.StreamingSynthesizeRequest_Input)(nil)})
		}, "Invalid protobuf StreamingSynthesizeRequest.streamingRequest"},
		{func() ([]byte, error) {
			return wire.EncodeStreamingSynthesisInput(wire.StreamingSynthesisInput{InputSource: (*wire.StreamingSynthesisInput_Text)(nil)})
		}, "Invalid protobuf StreamingSynthesisInput.inputSource"},
		{func() ([]byte, error) { return wire.EncodeMultiSpeakerMarkup(wire.MultiSpeakerMarkup{}) }, "Missing MultiSpeakerMarkup.turns"},
		{func() ([]byte, error) {
			return wire.EncodeStreamingAudioConfig(wire.StreamingAudioConfig{AudioEncoding: wire.AudioEncoding_PCM{}, SpeakingRate: runtime.Some(math.NaN())})
		}, "Invalid protobuf double"},
	} {
		data, err := test.encode()
		if data != nil || err == nil || err.Error() != test.error {
			t.Fatalf("%s: %x, %v", test.error, data, err)
		}
	}
}

func TestProtobufResponsesAndBeta(t *testing.T) {
	encoded, encodeError := beta.EncodeStreamingAudioConfig(beta.StreamingAudioConfig{AudioEncoding: beta.AudioEncoding_MP3_64_KBPS{}})
	if encodeError != nil || hex.EncodeToString(encoded) != "0804" {
		t.Fatalf("beta-only wire enum: %x, %v", encoded, encodeError)
	}
	if wire.StreamingSynthesizePath != "/google.cloud.texttospeech.v1.TextToSpeech/StreamingSynthesize" || beta.StreamingSynthesizePath != "/google.cloud.texttospeech.v1beta1.TextToSpeech/StreamingSynthesize" {
		t.Fatal("wrong RPC path")
	}
	data, err := beta.EncodeStreamingRequest(beta.StreamingSynthesizeRequest{StreamingRequest: beta.StreamingSynthesizeRequest_Input{Value: beta.StreamingSynthesisInput{InputSource: beta.StreamingSynthesisInput_Text{Value: "hello"}}}})
	if err != nil || hex.EncodeToString(data) != "12070a0568656c6c6f" {
		t.Fatalf("beta input: %x, %v", data, err)
	}
	for _, test := range []struct {
		hex     string
		present bool
		audio   []byte
		error   string
	}{
		{"", false, nil, ""}, {"0a00", true, []byte{}, ""}, {"10012a0201020a0200ff", true, []byte{0, 255}, ""}, {"0a0300ff010a00", true, []byte{}, ""},
		{"00", false, nil, "Invalid protobuf field number"}, {"0801", false, nil, "Invalid protobuf wire type for StreamingSynthesizeResponse.audioContent"},
		{"0a0401", false, nil, "Truncated protobuf message"}, {"13", false, nil, "Unsupported protobuf wire type: 3"}, {"ffffffffffffffffff02", false, nil, "Invalid protobuf varint"},
	} {
		data, err := hex.DecodeString(test.hex)
		if err != nil {
			t.Fatal(err)
		}
		stableResponse, stableError := wire.DecodeStreamingResponse(data)
		betaResponse, betaError := beta.DecodeStreamingResponse(data)
		for _, result := range []struct {
			audio runtime.Optional[[]byte]
			err   error
		}{{stableResponse.AudioContent, stableError}, {betaResponse.AudioContent, betaError}} {
			message := ""
			if result.err != nil {
				message = result.err.Error()
			}
			if message != test.error || result.audio.Present != test.present || !bytes.Equal(result.audio.Value, test.audio) {
				t.Fatalf("%s: audio=%v error=%v", test.hex, result.audio, result.err)
			}
		}
	}
	data = []byte{10, 2, 1, 2}
	response, err := wire.DecodeStreamingResponse(data)
	data[2] = 99
	if err != nil || !bytes.Equal(response.AudioContent.Value, []byte{1, 2}) {
		t.Fatalf("borrowed response: %v, %v", response, err)
	}
}
