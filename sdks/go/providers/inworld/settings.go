package inworld

import (
	"errors"
	"strings"
	"unicode/utf16"

	schema "github.com/speechswitch/client/sdks/go/generated/inworld"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type Input = schema.TtsRequestStreamingTextVoiceTextItem

type configuration struct {
	body         map[string]any
	text         string
	input        runtime.Input[Input]
	format       string
	timed, chunk bool
}

// Generated validation runs first; this only converts concrete Go representations.
func settings(request schema.TtsRequest) (configuration, error) {
	var model, voice, text string
	var output any
	var input runtime.Input[Input]
	var speed, temperature, delay, threshold runtime.Optional[float64]
	var language, instruction runtime.Optional[string]
	var prior runtime.Optional[schema.TtsRequestTextVoiceContextBefore]
	var enhancement, auto runtime.Optional[schema.TtsRequestTextVoiceAudioEnhancement]
	var normalization runtime.Optional[schema.TtsRequestTextVoiceTextNormalization]
	var delivery runtime.Optional[schema.TtsRequestInworldTts2TextVoiceDeliveryMode]
	var timing runtime.Optional[schema.TtsRequestTextVoiceTimestampDelivery]
	var granularity runtime.Optional[schema.TtsRequestTextVoiceTimestampGranularity]
	switch r := request.(type) {
	case *schema.TtsRequestAsTextVoice:
		return settings(*r)
	case schema.TtsRequestAsTextVoice:
		v := r.Value
		model, voice, output, text = v.Model.LiteralValue(), v.Voice, v.Output, v.Text
		speed, language, normalization, timing, granularity = v.Speed, v.Language, v.TextNormalization, v.TimestampDelivery, v.TimestampGranularity
		temperature = v.Temperature
		prior, enhancement = v.ContextBefore, v.AudioEnhancement
	case *schema.TtsRequestAsStreamingTextVoice:
		return settings(*r)
	case schema.TtsRequestAsStreamingTextVoice:
		v := r.Value
		model, voice, output, input = v.Model.LiteralValue(), v.Voice, v.Output, v.Text
		speed, language, normalization, timing, granularity = v.Speed, v.Language, v.TextNormalization, v.TimestampDelivery, v.TimestampGranularity
		temperature = v.Temperature
		delay, threshold, auto = v.TextFlushDelayMs, v.TextBufferThreshold, v.AutomaticTextFlushing
	case *schema.TtsRequestAsInworldTts2TextVoice:
		return settings(*r)
	case schema.TtsRequestAsInworldTts2TextVoice:
		v := r.Value
		model, voice, output, text = v.Model.Value(), v.Voice, v.Output, v.Text
		speed, language, normalization, timing, granularity = v.Speed, v.Language, v.TextNormalization, v.TimestampDelivery, v.TimestampGranularity
		delivery = v.DeliveryMode
		prior, enhancement = v.ContextBefore, v.AudioEnhancement
		instruction = v.Instructions
	case *schema.TtsRequestAsInworldTts2StreamingTextVoice:
		return settings(*r)
	case schema.TtsRequestAsInworldTts2StreamingTextVoice:
		v := r.Value
		model, voice, output, input = v.Model.Value(), v.Voice, v.Output, v.Text
		speed, language, normalization, timing, granularity = v.Speed, v.Language, v.TextNormalization, v.TimestampDelivery, v.TimestampGranularity
		delivery = v.DeliveryMode
		delay, threshold, auto = v.TextFlushDelayMs, v.TextBufferThreshold, v.AutomaticTextFlushing
	}
	audio, format := audioSettings(output)
	speakingRate := float64(1)
	if speed.Present {
		speakingRate = speed.Value
	}
	audio["speakingRate"] = speakingRate
	body := map[string]any{"voiceId": voice, "modelId": model, "audioConfig": audio, "applyTextNormalization": "APPLY_TEXT_NORMALIZATION_UNSPECIFIED", "timestampType": "TIMESTAMP_TYPE_UNSPECIFIED"}
	if normalization.Present {
		switch normalization.Value.(type) {
		case schema.TtsRequestTextVoiceTextNormalizationAsTrue, *schema.TtsRequestTextVoiceTextNormalizationAsTrue:
			body["applyTextNormalization"] = "ON"
		case schema.TtsRequestTextVoiceTextNormalizationAsFalse, *schema.TtsRequestTextVoiceTextNormalizationAsFalse:
			body["applyTextNormalization"] = "OFF"
		}
	}
	if granularity.Present {
		body["timestampType"] = strings.ToUpper(granularity.Value.LiteralValue())
	}
	if language.Present {
		body["language"] = language.Value
	}
	if model == "inworld-tts-2" {
		mode := "balanced"
		if delivery.Present {
			mode = delivery.Value.LiteralValue()
		}
		body["deliveryMode"] = strings.ToUpper(mode)
	} else {
		value := float64(1)
		if temperature.Present && temperature.Value != 0 {
			value = temperature.Value
		}
		body["temperature"] = value
	}
	if input != nil {
		body["maxBufferDelayMs"] = float64(0)
		if delay.Present {
			body["maxBufferDelayMs"] = delay.Value
		}
		value := float64(1000)
		if threshold.Present && threshold.Value != 0 {
			value = threshold.Value
		}
		body["bufferCharThreshold"] = value
		body["autoMode"] = auto.Present && auto.Value.LiteralValue()
	} else {
		body["text"] = text
		body["enhanceGeneration"] = enhancement.Present && enhancement.Value.LiteralValue()
		if instruction.Present {
			body["instruction"] = instruction.Value
		}
		if prior.Present {
			texts, count := []map[string]string{}, 0
			for _, value := range prior.Value.Texts {
				count += len(utf16.Encode([]rune(value)))
				texts = append(texts, map[string]string{"text": value})
			}
			if count > 2000 {
				return configuration{}, errors.New("Inworld preceding context must not exceed 2000 characters")
			}
			body["synthesisContext"] = map[string]any{"previousRequests": texts}
		}
	}
	return configuration{body: body, text: text, input: input, format: format, timed: granularity.Present, chunk: timing.Present && timing.Value.LiteralValue() == "chunk"}, nil
}

func audioSettings(output any) (map[string]any, string) {
	var format string
	rate := float64(48000)
	var bitRate runtime.Optional[float64]
	switch v := output.(type) {
	case schema.TtsRequestTextVoiceOutputAsFlac:
		return audioSettings(v.Value)
	case *schema.TtsRequestTextVoiceOutputAsFlac:
		return audioSettings(v.Value)
	case schema.TtsRequestTextVoiceOutputAsMp3:
		return audioSettings(v.Value)
	case *schema.TtsRequestTextVoiceOutputAsMp3:
		return audioSettings(v.Value)
	case schema.TtsRequestTextVoiceOutputAsOggOpus:
		return audioSettings(v.Value)
	case *schema.TtsRequestTextVoiceOutputAsOggOpus:
		return audioSettings(v.Value)
	case schema.TtsRequestTextVoiceOutputAsPcm:
		return audioSettings(v.Value)
	case *schema.TtsRequestTextVoiceOutputAsPcm:
		return audioSettings(v.Value)
	case schema.TtsRequestTextVoiceOutputAsObject:
		return audioSettings(v.Value)
	case *schema.TtsRequestTextVoiceOutputAsObject:
		return audioSettings(v.Value)
	case schema.TtsRequestTextVoiceOutputAsWav:
		return audioSettings(v.Value)
	case *schema.TtsRequestTextVoiceOutputAsWav:
		return audioSettings(v.Value)
	case schema.TtsRequestStreamingTextVoiceOutputAsMp3:
		return audioSettings(v.Value)
	case *schema.TtsRequestStreamingTextVoiceOutputAsMp3:
		return audioSettings(v.Value)
	case schema.TtsRequestStreamingTextVoiceOutputAsOggOpus:
		return audioSettings(v.Value)
	case *schema.TtsRequestStreamingTextVoiceOutputAsOggOpus:
		return audioSettings(v.Value)
	case schema.TtsRequestStreamingTextVoiceOutputAsPcm:
		return audioSettings(v.Value)
	case *schema.TtsRequestStreamingTextVoiceOutputAsPcm:
		return audioSettings(v.Value)
	case schema.TtsRequestStreamingTextVoiceOutputAsObject:
		return audioSettings(v.Value)
	case *schema.TtsRequestStreamingTextVoiceOutputAsObject:
		return audioSettings(v.Value)
	case schema.TtsRequestStreamingTextVoiceOutputAsWav:
		return audioSettings(v.Value)
	case *schema.TtsRequestStreamingTextVoiceOutputAsWav:
		return audioSettings(v.Value)
	case schema.TtsRequestTextVoiceOutputFlac:
		format = v.Format.Value()
		if v.SampleRateHz.Present {
			rate = v.SampleRateHz.Value.LiteralValue()
		}
	case schema.TtsRequestTextVoiceOutputMp3:
		format = v.Format.Value()
		if v.SampleRateHz.Present {
			rate = v.SampleRateHz.Value.LiteralValue()
		}
		bitRate = v.BitRateBps
	case schema.TtsRequestTextVoiceOutputOggOpus:
		format = v.Format.Value()
		if v.SampleRateHz.Present {
			rate = v.SampleRateHz.Value.LiteralValue()
		}
		bitRate = v.BitRateBps
	case schema.TtsRequestTextVoiceOutputPcm:
		format = v.Format.Value()
		if v.SampleRateHz.Present {
			rate = v.SampleRateHz.Value.LiteralValue()
		}
	case schema.TtsRequestTextVoiceOutputObject:
		format = v.Format.LiteralValue()
		rate = 8000
	case schema.TtsRequestTextVoiceOutputWav:
		format = v.Format.Value()
		if v.SampleRateHz.Present {
			rate = v.SampleRateHz.Value.LiteralValue()
		}
	}
	audio := map[string]any{"audioEncoding": strings.ToUpper(format), "sampleRateHertz": rate}
	if format == "mp3" || format == "ogg_opus" {
		value := float64(128000)
		if bitRate.Present {
			value = bitRate.Value
		}
		audio["bitRate"] = value
	}
	return audio, format
}
