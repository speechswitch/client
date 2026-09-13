package voice_ai

import (
	"context"
	"errors"
	"strconv"

	schema "github.com/speechswitch/client/sdks/go/generated/voice_ai"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type inputItem = schema.TtsRequestObject1ec54d36TextAsyncIterableItem
type inputEvent struct{ kind, text string }
type commandSource struct {
	source   runtime.Input[inputItem]
	validate runtime.InputValidator
}

func (s *commandSource) Next(ctx context.Context) (inputEvent, error) {
	value, err := s.source.Next(ctx)
	if err != nil {
		return inputEvent{}, err
	}
	if err = s.validate(value); err != nil {
		return inputEvent{}, err
	}
	switch v := value.(type) {
	case schema.TtsRequestObject1ec54d36TextAsyncIterableItemAsString:
		return inputEvent{"text", v.Value}, nil
	case *schema.TtsRequestObject1ec54d36TextAsyncIterableItemAsString:
		return inputEvent{"text", v.Value}, nil
	case schema.TtsRequestObject1ec54d36TextAsyncIterableItemAsClear, *schema.TtsRequestObject1ec54d36TextAsyncIterableItemAsClear:
		return inputEvent{kind: "clear"}, nil
	case schema.TtsRequestObject1ec54d36TextAsyncIterableItemAsFlush, *schema.TtsRequestObject1ec54d36TextAsyncIterableItemAsFlush:
		return inputEvent{kind: "flush"}, nil
	default:
		return inputEvent{}, errors.New("Unsupported generated Voice.ai input representation")
	}
}
func (s *commandSource) Close() error { return s.source.Close() }

type settings struct {
	text          string
	input         runtime.Input[inputEvent]
	legacy, paced bool
	wire          map[string]any
}

// The generated validator owns all model/format combinations and bounds.
func resolve(request schema.TtsRequest, validate runtime.InputValidator) (settings, error) {
	var result settings
	var text schema.TtsRequestObject1ec54d36Text
	var output any
	var voice runtime.Optional[string]
	var dictionaries runtime.Optional[[]schema.TtsRequestObject1ec54d36PronunciationDictionariesItem]
	var temperature, topP runtime.Optional[float64]
	model, language := "auto", "en"
	switch r := request.(type) {
	case *schema.TtsRequestAsObject1ec54d36:
		return resolve(*r, validate)
	case *schema.TtsRequestAsObject4870017d:
		return resolve(*r, validate)
	case *schema.TtsRequestAsObject3dd4eb5b:
		return resolve(*r, validate)
	case *schema.TtsRequestAsObject50ac9774:
		return resolve(*r, validate)
	case *schema.TtsRequestAsObjectdd71553d:
		return resolve(*r, validate)
	case *schema.TtsRequestAsObjectdbc284be:
		return resolve(*r, validate)
	case *schema.TtsRequestAsObject239f4158:
		return resolve(*r, validate)
	case *schema.TtsRequestAsObjectcb749376:
		return resolve(*r, validate)
	case *schema.TtsRequestAsTextVoice:
		return resolve(*r, validate)
	case schema.TtsRequestAsObject1ec54d36:
		v := r.Value
		text, voice, dictionaries, temperature, topP = v.Text, v.Voice, v.PronunciationDictionaries, v.Temperature, v.TopP
		if v.Language.Present {
			language = v.Language.Value.LiteralValue()
		}
		if v.Output.Present {
			output = v.Output.Value
		}
	case schema.TtsRequestAsObject4870017d:
		v := r.Value
		text, voice, dictionaries, temperature, topP = v.Text, v.Voice, v.PronunciationDictionaries, v.Temperature, v.TopP
		if v.Language.Present {
			language = v.Language.Value.LiteralValue()
		}
		output, result.paced = v.Output, true
	case schema.TtsRequestAsObject3dd4eb5b:
		v := r.Value
		text, voice, dictionaries, temperature, topP = v.Text, v.Voice, v.PronunciationDictionaries, v.Temperature, v.TopP
		model = v.Model.LiteralValue()
		if v.Output.Present {
			output = v.Output.Value
		}
	case schema.TtsRequestAsObject50ac9774:
		v := r.Value
		text, voice, dictionaries, temperature, topP = v.Text, v.Voice, v.PronunciationDictionaries, v.Temperature, v.TopP
		model = v.Model.LiteralValue()
		output, result.paced = v.Output, true
	case schema.TtsRequestAsObjectdd71553d:
		v := r.Value
		text, voice, dictionaries, temperature, topP = v.Text, v.Voice, v.PronunciationDictionaries, v.Temperature, v.TopP
		model = v.Model.LiteralValue()
		if v.Output.Present {
			output = v.Output.Value
		}
	case schema.TtsRequestAsObjectdbc284be:
		v := r.Value
		text, voice, dictionaries, temperature, topP = v.Text, v.Voice, v.PronunciationDictionaries, v.Temperature, v.TopP
		model = v.Model.LiteralValue()
		output, result.paced = v.Output, true
	case schema.TtsRequestAsObject239f4158:
		v := r.Value
		text, voice, dictionaries, temperature, topP = v.Text, v.Voice, v.PronunciationDictionaries, v.Temperature, v.TopP
		model, language = v.Model.LiteralValue(), v.Language.LiteralValue()
		if v.Output.Present {
			output = v.Output.Value
		}
	case schema.TtsRequestAsObjectcb749376:
		v := r.Value
		text, voice, dictionaries, temperature, topP = v.Text, v.Voice, v.PronunciationDictionaries, v.Temperature, v.TopP
		model, language = v.Model.LiteralValue(), v.Language.LiteralValue()
		output, result.paced = v.Output, true
	case schema.TtsRequestAsTextVoice:
		v := r.Value
		format := "mp3"
		if v.Output.Present {
			format = v.Output.Value.Format.LiteralValue()
		}
		result.legacy, result.text = true, v.Text
		result.wire = map[string]any{"text": v.Text, "voice": v.Voice, "audio_format": format}
		if v.Temperature.Present {
			result.wire["temperature"] = v.Temperature.Value
		}
		if v.TopP.Present {
			result.wire["top_p"] = v.TopP.Value
		}
		return result, nil
	default:
		return settings{}, errors.New("Unsupported generated Voice.ai request representation")
	}
	switch v := text.(type) {
	case schema.TtsRequestObject1ec54d36TextAsString:
		result.text = v.Value
	case *schema.TtsRequestObject1ec54d36TextAsString:
		result.text = v.Value
	case schema.TtsRequestObject1ec54d36TextAsAsyncIterable:
		result.input = &commandSource{v.Value, validate}
	case *schema.TtsRequestObject1ec54d36TextAsAsyncIterable:
		result.input = &commandSource{v.Value, validate}
	default:
		return settings{}, errors.New("Unsupported generated Voice.ai text representation")
	}
	if model == "auto" {
		model = "voiceai-tts-v1-latest"
		if language != "en" {
			model = "voiceai-tts-multilingual-v1-latest"
		}
	}
	format, err := audioFormat(output)
	if err != nil {
		return settings{}, err
	}
	temp, top := 1.0, 0.8
	if temperature.Present {
		temp = temperature.Value
	}
	if topP.Present {
		top = topP.Value
	}
	result.wire = map[string]any{"model": model, "language": language, "audio_format": format, "temperature": temp, "top_p": top}
	if voice.Present {
		result.wire["voice_id"] = voice.Value
	}
	if dictionaries.Present {
		result.wire["dictionary_id"] = dictionaries.Value[0].Id
		if dictionaries.Value[0].Version.Present {
			result.wire["dictionary_version"] = dictionaries.Value[0].Version.Value
		}
	}
	return result, nil
}

func audioFormat(value any) (string, error) {
	switch v := value.(type) {
	case nil:
		return "mp3", nil
	case *schema.TtsRequestObject1ec54d36OutputAsMp3904ec5a3:
		return audioFormat(*v)
	case *schema.TtsRequestObject1ec54d36OutputAsMp39b9ac8e8:
		return audioFormat(*v)
	case *schema.TtsRequestObject1ec54d36OutputAsMp36dc1fbe1:
		return audioFormat(*v)
	case *schema.TtsRequestObject1ec54d36OutputAsMp3f58f8da7:
		return audioFormat(*v)
	case *schema.TtsRequestObject1ec54d36OutputAsOpus:
		return audioFormat(*v)
	case *schema.TtsRequestObject1ec54d36OutputAsPcm:
		return audioFormat(*v)
	case *schema.TtsRequestObject1ec54d36OutputAsObject:
		return audioFormat(*v)
	case *schema.TtsRequestObject1ec54d36OutputAsWav:
		return audioFormat(*v)
	case *schema.TtsRequestObject4870017dOutputAsPcm:
		return audioFormat(*v)
	case *schema.TtsRequestObject4870017dOutputAsObject:
		return audioFormat(*v)
	case schema.TtsRequestObject1ec54d36OutputAsMp3904ec5a3:
		return "mp3", nil
	case schema.TtsRequestObject1ec54d36OutputAsMp36dc1fbe1:
		return "mp3_22050_32", nil
	case schema.TtsRequestObject1ec54d36OutputAsMp3f58f8da7:
		return "mp3_24000_48", nil
	case schema.TtsRequestObject1ec54d36OutputAsMp39b9ac8e8:
		return "mp3_44100_" + strconv.FormatFloat(v.Value.BitRateBps.LiteralValue()/1000, 'f', -1, 64), nil
	case schema.TtsRequestObject1ec54d36OutputAsOpus:
		return "opus_48000_" + strconv.FormatFloat(v.Value.BitRateBps.LiteralValue()/1000, 'f', -1, 64), nil
	case schema.TtsRequestObject1ec54d36OutputAsPcm:
		return audioFormat(v.Value)
	case schema.TtsRequestObject4870017dOutputAsPcm:
		return audioFormat(v.Value)
	case schema.TtsRequestObject1ec54d36OutputAsObject:
		return audioFormat(v.Value)
	case schema.TtsRequestObject4870017dOutputAsObject:
		return audioFormat(v.Value)
	case schema.TtsRequestObject1ec54d36OutputPcm:
		rate := 32000.0
		if v.SampleRateHz.Present {
			rate = v.SampleRateHz.Value.LiteralValue()
		}
		return "pcm_" + strconv.FormatFloat(rate, 'f', -1, 64), nil
	case schema.TtsRequestObject1ec54d36OutputObject:
		if v.Format.LiteralValue() == "mulaw" {
			return "ulaw_8000", nil
		}
		return "alaw_8000", nil
	case schema.TtsRequestObject1ec54d36OutputAsWav:
		rate := 32000.0
		if v.Value.SampleRateHz.Present {
			rate = v.Value.SampleRateHz.Value.LiteralValue()
		}
		if rate == 32000 {
			return "wav", nil
		}
		return "wav_" + strconv.FormatFloat(rate, 'f', -1, 64), nil
	default:
		return "", errors.New("Unsupported generated Voice.ai output representation")
	}
}
