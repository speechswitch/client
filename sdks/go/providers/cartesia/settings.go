package cartesia

import (
	"errors"
	schema "github.com/speechswitch/client/sdks/go/generated/cartesia"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type inputItem = schema.TtsRequestStreamingTextVoice0bf53a99TextItem

type wireRequest struct {
	wire  map[string]any
	text  string
	input runtime.Input[inputItem]
	timed bool
}

type configuration struct {
	model, voice              string
	output                    any
	language, accent, lexicon runtime.Optional[string]
	emotion                   runtime.Optional[schema.TtsRequestTextVoicef0bb1766Emotion]
	speed, volume, buffer     runtime.Optional[float64]
	normalization             runtime.Optional[schema.TtsRequestTextVoicef0bb1766TextNormalization]
	timing                    schema.TtsRequestStreamingTextVoice12b0fd0cTimestampGranularity
	timestampText             runtime.Optional[schema.TtsRequestStreamingTextVoice12b0fd0cTimestampText]
}

func literal[T interface{ LiteralValue() string }](value runtime.Optional[T]) runtime.Optional[string] {
	if value.Present {
		return runtime.Some(value.Value.LiteralValue())
	}
	return runtime.Optional[string]{}
}

// Generated validation runs first. These branches convert representations,
// rather than repeat model capabilities, field bounds or forbidden properties.
func settings(request schema.TtsRequest) (wireRequest, error) {
	var c configuration
	var result wireRequest
	switch request := request.(type) {
	case *schema.TtsRequestAsTextVoicef0bb1766:
		return settings(*request)
	case *schema.TtsRequestAsStreamingTextVoice0bf53a99:
		return settings(*request)
	case *schema.TtsRequestAsStreamingTextVoice12b0fd0c:
		return settings(*request)
	case *schema.TtsRequestAsTextVoicec75c718e:
		return settings(*request)
	case *schema.TtsRequestAsSonic36TextVoice35faf3f2:
		return settings(*request)
	case *schema.TtsRequestAsSonic36StreamingTextVoice15b369c8:
		return settings(*request)
	case *schema.TtsRequestAsSonic36StreamingTextVoice9ed3706f:
		return settings(*request)
	case *schema.TtsRequestAsSonic36TextVoice448a171b:
		return settings(*request)
	case schema.TtsRequestAsTextVoicef0bb1766:
		v := request.Value
		c = configuration{model: v.Model.LiteralValue(), voice: v.Voice, output: v.Output, language: literal(v.Language), accent: v.Accent, lexicon: v.Lexicon, emotion: v.Emotion, speed: v.Speed, volume: v.VolumeScale, normalization: v.TextNormalization}
		result.text = v.Text
	case schema.TtsRequestAsStreamingTextVoice0bf53a99:
		v := request.Value
		c = configuration{model: v.Model.LiteralValue(), voice: v.Voice, output: v.Output, language: literal(v.Language), accent: v.Accent, lexicon: v.Lexicon, emotion: v.Emotion, speed: v.Speed, volume: v.VolumeScale, normalization: v.TextNormalization, buffer: v.MaxBufferDelayMs}
		result.input = v.Text
	case schema.TtsRequestAsStreamingTextVoice12b0fd0c:
		v := request.Value
		c = configuration{model: v.Model.LiteralValue(), voice: v.Voice, output: v.Output, language: literal(v.Language), accent: v.Accent, lexicon: v.Lexicon, emotion: v.Emotion, speed: v.Speed, volume: v.VolumeScale, normalization: v.TextNormalization, buffer: v.MaxBufferDelayMs, timing: v.TimestampGranularity, timestampText: v.TimestampText}
		result.input, result.timed = v.Text, true
	case schema.TtsRequestAsTextVoicec75c718e:
		v := request.Value
		c = configuration{model: v.Model.LiteralValue(), voice: v.Voice, output: v.Output, language: literal(v.Language), accent: v.Accent, lexicon: v.Lexicon, emotion: v.Emotion, speed: v.Speed, volume: v.VolumeScale, normalization: v.TextNormalization, timing: v.TimestampGranularity, timestampText: v.TimestampText}
		result.text, result.timed = v.Text, true
	case schema.TtsRequestAsSonic36TextVoice35faf3f2:
		v := request.Value
		c = configuration{model: v.Model.Value(), voice: v.Voice, output: v.Output, language: v.Language, accent: v.Accent, lexicon: v.Lexicon, emotion: v.Emotion, speed: v.Speed, volume: v.VolumeScale, normalization: v.TextNormalization}
		result.text = v.Text
	case schema.TtsRequestAsSonic36StreamingTextVoice15b369c8:
		v := request.Value
		c = configuration{model: v.Model.Value(), voice: v.Voice, output: v.Output, language: v.Language, accent: v.Accent, lexicon: v.Lexicon, emotion: v.Emotion, speed: v.Speed, volume: v.VolumeScale, normalization: v.TextNormalization, buffer: v.MaxBufferDelayMs}
		result.input = v.Text
	case schema.TtsRequestAsSonic36StreamingTextVoice9ed3706f:
		v := request.Value
		c = configuration{model: v.Model.Value(), voice: v.Voice, output: v.Output, language: v.Language, accent: v.Accent, lexicon: v.Lexicon, emotion: v.Emotion, speed: v.Speed, volume: v.VolumeScale, normalization: v.TextNormalization, buffer: v.MaxBufferDelayMs, timing: v.TimestampGranularity, timestampText: v.TimestampText}
		result.input, result.timed = v.Text, true
	case schema.TtsRequestAsSonic36TextVoice448a171b:
		v := request.Value
		c = configuration{model: v.Model.Value(), voice: v.Voice, output: v.Output, language: v.Language, accent: v.Accent, lexicon: v.Lexicon, emotion: v.Emotion, speed: v.Speed, volume: v.VolumeScale, normalization: v.TextNormalization, timing: v.TimestampGranularity, timestampText: v.TimestampText}
		result.text, result.timed = v.Text, true
	default:
		return result, errors.New("Unsupported generated Cartesia request representation")
	}
	output, err := outputFormat(c.output)
	if err != nil {
		return result, err
	}
	generation := map[string]any{}
	if c.speed.Present {
		generation["speed"] = c.speed.Value
	}
	if c.volume.Present {
		generation["volume"] = c.volume.Value
	}
	if c.emotion.Present {
		generation["emotion"] = c.emotion.Value.LiteralValue()
	}
	wire := map[string]any{"model_id": c.model, "voice": c.voice, "output_format": output, "generation_config": generation}
	if c.language.Present {
		field := "language"
		if c.model == "sonic-3.6" {
			field = "locale"
		}
		wire[field] = c.language.Value
	}
	if c.accent.Present {
		wire["accent"] = c.accent.Value
	}
	if c.lexicon.Present {
		wire["pronunciation_dict_id"] = c.lexicon.Value
	}
	if c.normalization.Present {
		value, err := normalization(c.normalization.Value)
		if err != nil {
			return result, err
		}
		wire["normalization"] = value
	}
	if result.timed || result.input != nil {
		word, phoneme, err := timing(c.timing)
		if err != nil {
			return result, err
		}
		wire["add_timestamps"], wire["add_phoneme_timestamps"] = word, phoneme
		wire["use_normalized_timestamps"] = c.timestampText.Present && c.timestampText.Value.LiteralValue() == "normalized"
	}
	if result.input != nil {
		delay := 3000.0
		if c.buffer.Present {
			delay = c.buffer.Value
		}
		wire["max_buffer_delay_ms"] = delay
	}
	result.wire = wire
	return result, nil
}

func outputFormat(value any) (map[string]any, error) {
	switch v := value.(type) {
	case schema.TtsRequestTextVoicef0bb1766OutputAsPcm:
		return outputFormat(v.Value)
	case *schema.TtsRequestTextVoicef0bb1766OutputAsPcm:
		return outputFormat(v.Value)
	case schema.TtsRequestTextVoicef0bb1766OutputAsObject:
		return outputFormat(v.Value)
	case *schema.TtsRequestTextVoicef0bb1766OutputAsObject:
		return outputFormat(v.Value)
	case schema.TtsRequestTextVoicef0bb1766OutputAsMp3:
		return outputFormat(v.Value)
	case *schema.TtsRequestTextVoicef0bb1766OutputAsMp3:
		return outputFormat(v.Value)
	case schema.TtsRequestTextVoicef0bb1766OutputAsWav:
		return outputFormat(v.Value)
	case *schema.TtsRequestTextVoicef0bb1766OutputAsWav:
		return outputFormat(v.Value)
	case schema.TtsRequestStreamingTextVoice0bf53a99OutputAsPcm:
		return outputFormat(v.Value)
	case *schema.TtsRequestStreamingTextVoice0bf53a99OutputAsPcm:
		return outputFormat(v.Value)
	case schema.TtsRequestStreamingTextVoice0bf53a99OutputAsObject:
		return outputFormat(v.Value)
	case *schema.TtsRequestStreamingTextVoice0bf53a99OutputAsObject:
		return outputFormat(v.Value)
	case schema.TtsRequestTextVoicef0bb1766OutputPcm:
		encoding := "pcm_s16le"
		if v.SampleEncoding.LiteralValue() == "float_32" {
			encoding = "pcm_f32le"
		}
		return map[string]any{"container": "raw", "sample_rate": v.SampleRateHz.LiteralValue(), "encoding": encoding}, nil
	case schema.TtsRequestTextVoicef0bb1766OutputObject:
		return map[string]any{"container": "raw", "sample_rate": v.SampleRateHz.LiteralValue(), "encoding": "pcm_" + v.Format.LiteralValue()}, nil
	case schema.TtsRequestTextVoicef0bb1766OutputMp3:
		return map[string]any{"container": "mp3", "sample_rate": v.SampleRateHz.LiteralValue(), "bit_rate": v.BitRateBps.LiteralValue()}, nil
	case schema.TtsRequestTextVoicef0bb1766OutputWav:
		encoding := "signed_integer_16"
		if v.SampleEncoding.Present {
			encoding = v.SampleEncoding.Value.LiteralValue()
		}
		return map[string]any{"container": "wav", "sample_rate": v.SampleRateHz.LiteralValue(), "encoding": map[string]string{"signed_integer_16": "pcm_s16le", "float_32": "pcm_f32le", "mulaw": "pcm_mulaw", "alaw": "pcm_alaw"}[encoding]}, nil
	default:
		return nil, errors.New("Unsupported generated Cartesia output representation")
	}
}

func normalization(value schema.TtsRequestTextVoicef0bb1766TextNormalization) (string, error) {
	switch v := value.(type) {
	case schema.TtsRequestTextVoicef0bb1766TextNormalizationAsFalse, *schema.TtsRequestTextVoicef0bb1766TextNormalizationAsFalse:
		return "off", nil
	case schema.TtsRequestTextVoicef0bb1766TextNormalizationAsTrue, *schema.TtsRequestTextVoicef0bb1766TextNormalizationAsTrue:
		return "auto", nil
	case schema.TtsRequestTextVoicef0bb1766TextNormalizationAsObject:
		return v.Value.Locale, nil
	case *schema.TtsRequestTextVoicef0bb1766TextNormalizationAsObject:
		return v.Value.Locale, nil
	default:
		return "", errors.New("Unsupported generated Cartesia normalization representation")
	}
}

func timing(value schema.TtsRequestStreamingTextVoice12b0fd0cTimestampGranularity) (bool, bool, error) {
	switch v := value.(type) {
	case nil:
		return false, false, nil
	case schema.TtsRequestStreamingTextVoice12b0fd0cTimestampGranularityAsWord, *schema.TtsRequestStreamingTextVoice12b0fd0cTimestampGranularityAsWord:
		return true, false, nil
	case schema.TtsRequestStreamingTextVoice12b0fd0cTimestampGranularityAsPhoneme, *schema.TtsRequestStreamingTextVoice12b0fd0cTimestampGranularityAsPhoneme:
		return false, true, nil
	case *schema.TtsRequestStreamingTextVoice12b0fd0cTimestampGranularityAsArray:
		return timing(*v)
	case schema.TtsRequestStreamingTextVoice12b0fd0cTimestampGranularityAsArray:
		word, phoneme := false, false
		for _, kind := range v.Value {
			word = word || kind.LiteralValue() == "word"
			phoneme = phoneme || kind.LiteralValue() == "phoneme"
		}
		return word, phoneme, nil
	default:
		return false, false, errors.New("Unsupported generated Cartesia timestamp representation")
	}
}
