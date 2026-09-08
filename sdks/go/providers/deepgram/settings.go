package deepgram

import (
	"errors"
	schema "github.com/speechswitch/client/sdks/go/generated/deepgram"
	"github.com/speechswitch/client/sdks/go/runtime"
	"net/url"
	"strconv"
)

type Input = schema.TtsRequestAura1StreamingTextVoiceTextItem
type configuration struct {
	model, language, voice, text string
	input                        runtime.Input[Input]
	output                       any
	speed                        runtime.Optional[float64]
	mip                          runtime.Optional[schema.TtsRequestAura1TextVoiceModelImprovementOptOut]
	tags                         runtime.Optional[[]string]
}

// Convert generated representations after validation, without repeating capabilities.
func settings(request schema.TtsRequest) (configuration, error) {
	switch request := request.(type) {
	case *schema.TtsRequestAsAura1TextVoice:
		return settings(*request)
	case *schema.TtsRequestAsAura1StreamingTextVoice:
		return settings(*request)
	case *schema.TtsRequestAsAura2TextVoice977d4f43:
		return settings(*request)
	case *schema.TtsRequestAsAura2StreamingTextVoicec96c6915:
		return settings(*request)
	case *schema.TtsRequestAsAura2TextVoicecfca101c:
		return settings(*request)
	case *schema.TtsRequestAsAura2StreamingTextVoice9a9ab9cb:
		return settings(*request)
	case *schema.TtsRequestAsAura2TextVoice2ee322ad:
		return settings(*request)
	case *schema.TtsRequestAsAura2StreamingTextVoiceb9577a7c:
		return settings(*request)
	case *schema.TtsRequestAsAura2TextVoice0e5dc20c:
		return settings(*request)
	case *schema.TtsRequestAsAura2StreamingTextVoice3b7bc554:
		return settings(*request)
	case *schema.TtsRequestAsAura2TextVoice76db964c:
		return settings(*request)
	case *schema.TtsRequestAsAura2StreamingTextVoice141a5c9a:
		return settings(*request)
	case *schema.TtsRequestAsAura2TextVoicefa928059:
		return settings(*request)
	case *schema.TtsRequestAsAura2StreamingTextVoicec5cb87b8:
		return settings(*request)
	case *schema.TtsRequestAsAura2TextVoiceaf63b261:
		return settings(*request)
	case *schema.TtsRequestAsAura2StreamingTextVoice8f696e76:
		return settings(*request)
	case schema.TtsRequestAsAura1TextVoice:
		v := request.Value
		return configuration{model: v.Model.Value(), language: v.Language.Value(), voice: v.Voice.LiteralValue(), output: v.Output, speed: v.Speed, mip: v.ModelImprovementOptOut, text: v.Text, tags: v.Tags}, nil
	case schema.TtsRequestAsAura1StreamingTextVoice:
		v := request.Value
		return configuration{model: v.Model.Value(), language: v.Language.Value(), voice: v.Voice.LiteralValue(), output: v.Output, speed: v.Speed, mip: v.ModelImprovementOptOut, input: v.Text}, nil
	case schema.TtsRequestAsAura2TextVoice977d4f43:
		v := request.Value
		return configuration{model: v.Model.Value(), language: v.Language.Value(), voice: v.Voice.LiteralValue(), output: v.Output, speed: v.Speed, mip: v.ModelImprovementOptOut, text: v.Text, tags: v.Tags}, nil
	case schema.TtsRequestAsAura2StreamingTextVoicec96c6915:
		v := request.Value
		return configuration{model: v.Model.Value(), language: v.Language.Value(), voice: v.Voice.LiteralValue(), output: v.Output, speed: v.Speed, mip: v.ModelImprovementOptOut, input: v.Text}, nil
	case schema.TtsRequestAsAura2TextVoicecfca101c:
		v := request.Value
		return configuration{model: v.Model.Value(), language: v.Language.Value(), voice: v.Voice.LiteralValue(), output: v.Output, speed: v.Speed, mip: v.ModelImprovementOptOut, text: v.Text, tags: v.Tags}, nil
	case schema.TtsRequestAsAura2StreamingTextVoice9a9ab9cb:
		v := request.Value
		return configuration{model: v.Model.Value(), language: v.Language.Value(), voice: v.Voice.LiteralValue(), output: v.Output, speed: v.Speed, mip: v.ModelImprovementOptOut, input: v.Text}, nil
	case schema.TtsRequestAsAura2TextVoice2ee322ad:
		v := request.Value
		return configuration{model: v.Model.Value(), language: v.Language.Value(), voice: v.Voice.LiteralValue(), output: v.Output, speed: v.Speed, mip: v.ModelImprovementOptOut, text: v.Text, tags: v.Tags}, nil
	case schema.TtsRequestAsAura2StreamingTextVoiceb9577a7c:
		v := request.Value
		return configuration{model: v.Model.Value(), language: v.Language.Value(), voice: v.Voice.LiteralValue(), output: v.Output, speed: v.Speed, mip: v.ModelImprovementOptOut, input: v.Text}, nil
	case schema.TtsRequestAsAura2TextVoice0e5dc20c:
		v := request.Value
		return configuration{model: v.Model.Value(), language: v.Language.Value(), voice: v.Voice.LiteralValue(), output: v.Output, speed: v.Speed, mip: v.ModelImprovementOptOut, text: v.Text, tags: v.Tags}, nil
	case schema.TtsRequestAsAura2StreamingTextVoice3b7bc554:
		v := request.Value
		return configuration{model: v.Model.Value(), language: v.Language.Value(), voice: v.Voice.LiteralValue(), output: v.Output, speed: v.Speed, mip: v.ModelImprovementOptOut, input: v.Text}, nil
	case schema.TtsRequestAsAura2TextVoice76db964c:
		v := request.Value
		return configuration{model: v.Model.Value(), language: v.Language.Value(), voice: v.Voice.LiteralValue(), output: v.Output, speed: v.Speed, mip: v.ModelImprovementOptOut, text: v.Text, tags: v.Tags}, nil
	case schema.TtsRequestAsAura2StreamingTextVoice141a5c9a:
		v := request.Value
		return configuration{model: v.Model.Value(), language: v.Language.Value(), voice: v.Voice.LiteralValue(), output: v.Output, speed: v.Speed, mip: v.ModelImprovementOptOut, input: v.Text}, nil
	case schema.TtsRequestAsAura2TextVoicefa928059:
		v := request.Value
		return configuration{model: v.Model.Value(), language: v.Language.Value(), voice: v.Voice.LiteralValue(), output: v.Output, speed: v.Speed, mip: v.ModelImprovementOptOut, text: v.Text, tags: v.Tags}, nil
	case schema.TtsRequestAsAura2StreamingTextVoicec5cb87b8:
		v := request.Value
		return configuration{model: v.Model.Value(), language: v.Language.Value(), voice: v.Voice.LiteralValue(), output: v.Output, speed: v.Speed, mip: v.ModelImprovementOptOut, input: v.Text}, nil
	case schema.TtsRequestAsAura2TextVoiceaf63b261:
		v := request.Value
		return configuration{model: v.Model.Value(), language: v.Language.Value(), voice: v.Voice.LiteralValue(), output: v.Output, speed: v.Speed, mip: v.ModelImprovementOptOut, text: v.Text, tags: v.Tags}, nil
	case schema.TtsRequestAsAura2StreamingTextVoice8f696e76:
		v := request.Value
		return configuration{model: v.Model.Value(), language: v.Language.Value(), voice: v.Voice.LiteralValue(), output: v.Output, speed: v.Speed, mip: v.ModelImprovementOptOut, input: v.Text}, nil
	default:
		return configuration{}, errors.New("Unsupported generated Deepgram request representation")
	}
}
func number[T interface{ LiteralValue() float64 }](value runtime.Optional[T]) runtime.Optional[float64] {
	if value.Present {
		return runtime.Some(value.Value.LiteralValue())
	}
	return runtime.Optional[float64]{}
}
func outputQuery(value any, streaming bool) (url.Values, error) {
	var encoding, container string
	var rate, bitrate runtime.Optional[float64]
	switch v := value.(type) {
	case schema.TtsRequestAura1TextVoiceOutputAsPcm:
		return outputQuery(v.Value, streaming)
	case *schema.TtsRequestAura1TextVoiceOutputAsPcm:
		return outputQuery(v.Value, streaming)
	case schema.TtsRequestAura1TextVoiceOutputAsObject:
		return outputQuery(v.Value, streaming)
	case *schema.TtsRequestAura1TextVoiceOutputAsObject:
		return outputQuery(v.Value, streaming)
	case schema.TtsRequestAura1TextVoiceOutputAsWavb8f00cbb:
		return outputQuery(v.Value, streaming)
	case *schema.TtsRequestAura1TextVoiceOutputAsWavb8f00cbb:
		return outputQuery(v.Value, streaming)
	case schema.TtsRequestAura1TextVoiceOutputAsWav669a6d8a:
		return outputQuery(v.Value, streaming)
	case *schema.TtsRequestAura1TextVoiceOutputAsWav669a6d8a:
		return outputQuery(v.Value, streaming)
	case schema.TtsRequestAura1TextVoiceOutputAsMp3:
		return outputQuery(v.Value, streaming)
	case *schema.TtsRequestAura1TextVoiceOutputAsMp3:
		return outputQuery(v.Value, streaming)
	case schema.TtsRequestAura1TextVoiceOutputAsOggOpus:
		return outputQuery(v.Value, streaming)
	case *schema.TtsRequestAura1TextVoiceOutputAsOggOpus:
		return outputQuery(v.Value, streaming)
	case schema.TtsRequestAura1TextVoiceOutputAsFlac:
		return outputQuery(v.Value, streaming)
	case *schema.TtsRequestAura1TextVoiceOutputAsFlac:
		return outputQuery(v.Value, streaming)
	case schema.TtsRequestAura1TextVoiceOutputAsAac:
		return outputQuery(v.Value, streaming)
	case *schema.TtsRequestAura1TextVoiceOutputAsAac:
		return outputQuery(v.Value, streaming)
	case schema.TtsRequestAura1StreamingTextVoiceOutputAsPcm:
		return outputQuery(v.Value, streaming)
	case *schema.TtsRequestAura1StreamingTextVoiceOutputAsPcm:
		return outputQuery(v.Value, streaming)
	case schema.TtsRequestAura1StreamingTextVoiceOutputAsObject:
		return outputQuery(v.Value, streaming)
	case *schema.TtsRequestAura1StreamingTextVoiceOutputAsObject:
		return outputQuery(v.Value, streaming)
	case schema.TtsRequestAura1TextVoiceOutputPcm:
		encoding, container, rate = "linear16", "none", number(v.SampleRateHz)
	case schema.TtsRequestAura1TextVoiceOutputObject:
		encoding, container, rate = v.Format.LiteralValue(), "none", number(v.SampleRateHz)
	case schema.TtsRequestAura1TextVoiceOutputWavb8f00cbb:
		encoding, container, rate = "linear16", "wav", number(v.SampleRateHz)
	case schema.TtsRequestAura1TextVoiceOutputWav669a6d8a:
		encoding, container, rate = v.SampleEncoding.LiteralValue(), "wav", number(v.SampleRateHz)
	case schema.TtsRequestAura1TextVoiceOutputMp3:
		encoding, bitrate = "mp3", number(v.BitRateBps)
	case schema.TtsRequestAura1TextVoiceOutputOggOpus:
		encoding, container, bitrate = "opus", "ogg", v.BitRateBps
	case schema.TtsRequestAura1TextVoiceOutputFlac:
		encoding, rate = "flac", number(v.SampleRateHz)
	case schema.TtsRequestAura1TextVoiceOutputAac:
		encoding, bitrate = "aac", v.BitRateBps
	default:
		return nil, errors.New("Unsupported generated Deepgram output representation")
	}
	query := url.Values{"encoding": {encoding}}
	if !streaming && container != "" {
		query.Set("container", container)
	}
	// Fixed codec rates are represented by schema literals, not configurable queries.
	if rate.Present {
		query.Set("sample_rate", strconv.FormatFloat(rate.Value, 'f', -1, 64))
	}
	if bitrate.Present {
		query.Set("bit_rate", strconv.FormatFloat(bitrate.Value, 'f', -1, 64))
	}
	return query, nil
}
