package respeecher

import (
	"errors"
	schema "github.com/speechswitch/client/sdks/go/generated/respeecher"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type inputItem = schema.TtsRequestObjectTextAsyncIterableItem
type settings struct {
	text, language string
	input          runtime.Input[inputItem]
	wave           bool
	wire           map[string]any
}

// Conversion only: generated validation owns the request union and all bounds.
func resolve(request schema.TtsRequest) (settings, error) {
	switch r := request.(type) {
	case *schema.TtsRequestAsObject:
		return resolve(*r)
	case *schema.TtsRequestAsTextVoice:
		return resolve(*r)
	case schema.TtsRequestAsTextVoice:
		v := r.Value
		result, err := resolve(schema.TtsRequestAsObject{Value: schema.TtsRequestObject{
			Text: schema.TtsRequestObjectTextAsString{Value: v.Text}, Voice: v.Voice, Language: v.Language,
			Temperature: v.Temperature, TopK: v.TopK, TopP: v.TopP, MinP: v.MinP,
			RandomSeed: v.RandomSeed, PresencePenalty: v.PresencePenalty, FrequencyPenalty: v.FrequencyPenalty, RepetitionPenalty: v.RepetitionPenalty,
		}})
		if err != nil {
			return result, err
		}
		rate := 22050.0
		if v.Output.SampleRateHz.Present {
			rate = v.Output.SampleRateHz.Value
		}
		result.wave = true
		result.wire["output_format"] = map[string]any{"sample_rate": rate}
		return result, nil
	case schema.TtsRequestAsObject:
		v := r.Value
		result := settings{language: "en"}
		if v.Language.Present {
			result.language = v.Language.Value.LiteralValue()
		}
		switch text := v.Text.(type) {
		case schema.TtsRequestObjectTextAsString:
			result.text = text.Value
		case *schema.TtsRequestObjectTextAsString:
			result.text = text.Value
		case schema.TtsRequestObjectTextAsAsyncIterable:
			result.input = text.Value
		case *schema.TtsRequestObjectTextAsAsyncIterable:
			result.input = text.Value
		default:
			return result, errors.New("Unsupported generated Respeecher text representation")
		}
		sampling := map[string]any{}
		for name, value := range map[string]runtime.Optional[float64]{"seed": v.RandomSeed, "temperature": v.Temperature, "top_k": v.TopK, "top_p": v.TopP, "min_p": v.MinP, "presence_penalty": v.PresencePenalty, "frequency_penalty": v.FrequencyPenalty, "repetition_penalty": v.RepetitionPenalty} {
			if value.Present {
				number := value.Value
				if name == "top_k" && number == 0 {
					number = -1
				}
				sampling[name] = number
			}
		}
		rate, encoding := 22050.0, "pcm_f32le"
		if v.Output.Present {
			output := v.Output.Value
			switch p := output.(type) {
			case *schema.TtsRequestObjectOutputAsPcm:
				output = *p
			case *schema.TtsRequestObjectOutputAsMulaw:
				output = *p
			}
			switch p := output.(type) {
			case schema.TtsRequestObjectOutputAsPcm:
				if p.Value.SampleRateHz.Present {
					rate = p.Value.SampleRateHz.Value
				}
				if p.Value.SampleEncoding.Present && p.Value.SampleEncoding.Value.LiteralValue() == "signed_integer_16" {
					encoding = "pcm_s16le"
				}
			case schema.TtsRequestObjectOutputAsMulaw:
				encoding = "pcm_mulaw"
				if p.Value.SampleRateHz.Present {
					rate = p.Value.SampleRateHz.Value
				}
			default:
				return result, errors.New("Unsupported generated Respeecher output representation")
			}
		}
		result.wire = map[string]any{"voice": map[string]any{"id": v.Voice, "sampling_params": sampling}, "output_format": map[string]any{"sample_rate": rate, "encoding": encoding}}
		return result, nil
	default:
		return settings{}, errors.New("Unsupported generated Respeecher request representation")
	}
}

func inputValue(value inputItem) (string, string, error) {
	switch v := value.(type) {
	case schema.TtsRequestObjectTextAsyncIterableItemAsString:
		return v.Value, "", nil
	case *schema.TtsRequestObjectTextAsyncIterableItemAsString:
		return v.Value, "", nil
	case schema.TtsRequestObjectTextAsyncIterableItemAsClear, *schema.TtsRequestObjectTextAsyncIterableItemAsClear:
		return "", "clear", nil
	case schema.TtsRequestObjectTextAsyncIterableItemAsFlush, *schema.TtsRequestObjectTextAsyncIterableItemAsFlush:
		return "", "flush", nil
	default:
		return "", "", errors.New("Unsupported generated Respeecher input representation")
	}
}
