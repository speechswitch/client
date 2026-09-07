package openai

import (
	"errors"
	wire "github.com/speechswitch/client/sdks/go/clients/openai"
	schema "github.com/speechswitch/client/sdks/go/generated/openai"
	"github.com/speechswitch/client/sdks/go/runtime"
)

// Only called after generated validation; this is conversion, not a second schema.
func settings(request schema.TtsRequest) (wire.SpeechRequest, bool, error) {
	var text, voice, model string
	var custom, usage bool
	var instructions runtime.Optional[string]
	var speed runtime.Optional[float64]
	var output runtime.Optional[schema.TtsRequestTextVoice15a214fcOutput]
	switch value := request.(type) {
	case *schema.TtsRequestAsTextVoice15a214fc:
		return settings(*value)
	case *schema.TtsRequestAsTextVoicef51a0f7e:
		return settings(*value)
	case *schema.TtsRequestAsTextVoicef3ee42bf:
		return settings(*value)
	case schema.TtsRequestAsTextVoice15a214fc:
		r := value.Value
		text, voice, model = r.Text, r.Voice.LiteralValue(), "tts-1"
		if r.Model.Present {
			model = r.Model.Value.LiteralValue()
		}
		speed, output = r.Speed, r.Output
	case schema.TtsRequestAsTextVoicef51a0f7e:
		r := value.Value
		text, voice, model = r.Text, r.Voice.LiteralValue(), r.Model.LiteralValue()
		instructions, speed, output = r.Instructions, r.Speed, r.Output
		if r.IncludeUsage.Present {
			usage = r.IncludeUsage.Value.LiteralValue()
		}
	case schema.TtsRequestAsTextVoicef3ee42bf:
		r := value.Value
		text, voice, model, custom = r.Text, r.Voice, r.Model.LiteralValue(), true
		instructions, speed, output = r.Instructions, r.Speed, r.Output
		if r.IncludeUsage.Present {
			usage = r.IncludeUsage.Value.LiteralValue()
		}
	default:
		return wire.SpeechRequest{}, false, errors.New("Unsupported generated OpenAI request representation")
	}
	input := wire.SpeechRequest{
		Input: text, Model: wire.CreateSpeechRequestModelAsVariant0{Value: model},
		Voice: wire.VoiceIdsOrCustomVoiceAsVariant0{Value: wire.VoiceIdsSharedAsVariant0{Value: voice}},
		Speed: runtime.Some(1.0), ResponseFormat: runtime.Some("pcm"), StreamFormat: runtime.Some("audio"), Instructions: instructions,
	}
	if custom {
		input.Voice = wire.VoiceIdsOrCustomVoiceAsVariant1{Value: wire.VoiceIdsOrCustomVoiceVariant1{Id: voice}}
	}
	if usage {
		input.StreamFormat = runtime.Some("sse")
	}
	if speed.Present {
		input.Speed = speed
	}
	if output.Present {
		format, err := outputFormat(output.Value)
		if err != nil {
			return wire.SpeechRequest{}, false, err
		}
		input.ResponseFormat = runtime.Some(format)
	}
	return input, usage, nil
}

func outputFormat(output schema.TtsRequestTextVoice15a214fcOutput) (string, error) {
	switch value := output.(type) {
	case schema.TtsRequestTextVoice15a214fcOutputAsPcm:
		return value.Value.Format.Value(), nil
	case *schema.TtsRequestTextVoice15a214fcOutputAsPcm:
		return value.Value.Format.Value(), nil
	case schema.TtsRequestTextVoice15a214fcOutputAsObject:
		return value.Value.Format.LiteralValue(), nil
	case *schema.TtsRequestTextVoice15a214fcOutputAsObject:
		return value.Value.Format.LiteralValue(), nil
	default:
		return "", errors.New("Unsupported generated OpenAI output representation")
	}
}
