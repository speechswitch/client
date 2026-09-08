package kugelaudio

import (
	"errors"
	schema "github.com/speechswitch/client/sdks/go/generated/kugelaudio"
	"github.com/speechswitch/client/sdks/go/runtime"
	"math"
	"strings"
)

type Input = schema.TtsRequestStreamingTextVoiceTextItem

type configuration struct {
	body                   map[string]any
	input                  runtime.Input[Input]
	rate                   float64
	encoding               string
	timed, socket, speaker bool
}

// Validation has already narrowed the request; these are wire conversions, not checks.
func settings(request schema.TtsRequest) (configuration, error) {
	var voice schema.TtsRequestTextVoiceVoice
	var output schema.TtsRequestTextVoiceOutput
	var model runtime.Optional[schema.TtsRequestTextVoiceModel]
	var language runtime.Optional[schema.TtsRequestTextVoiceLanguage]
	var speed, guidance, tokens, temperature, delay, threshold runtime.Optional[float64]
	var normalize, boost runtime.Optional[schema.TtsRequestTextVoiceTextNormalization]
	var dictionaries runtime.Optional[schema.TtsRequestTextVoicePronunciationDictionarySelection]
	c := configuration{body: map[string]any{}, speaker: true}
	switch r := request.(type) {
	case *schema.TtsRequestAsTextVoice:
		return settings(*r)
	case *schema.TtsRequestAsStreamingTextVoice:
		return settings(*r)
	case schema.TtsRequestAsTextVoice:
		v := r.Value
		voice, output, model, language = v.Voice, v.Output, v.Model, v.Language
		speed, guidance, tokens, temperature = v.Speed, v.VoiceGuidance, v.MaxAudioTokens, v.Temperature
		normalize, boost, dictionaries = v.TextNormalization, v.VoiceBoost, v.PronunciationDictionarySelection
		c.timed = v.TimestampGranularity.Present
		c.body["text"] = v.Text
	case schema.TtsRequestAsStreamingTextVoice:
		v := r.Value
		voice, output, model, language = v.Voice, v.Output, v.Model, v.Language
		speed, guidance, tokens, temperature = v.Speed, v.VoiceGuidance, v.MaxAudioTokens, v.Temperature
		normalize, boost, dictionaries = v.TextNormalization, v.VoiceBoost, v.PronunciationDictionarySelection
		c.timed, c.input = v.TimestampGranularity.Present, v.Text
		delay, threshold = v.TextFlushDelayMs, v.TextBufferThreshold
	}
	var id any
	switch v := voice.(type) {
	case schema.TtsRequestTextVoiceVoiceAsString:
		id = v.Value
	case *schema.TtsRequestTextVoiceVoiceAsString:
		id = v.Value
	case schema.TtsRequestTextVoiceVoiceAsNumber:
		id = v.Value
	case *schema.TtsRequestTextVoiceVoiceAsNumber:
		id = v.Value
	}
	switch v := id.(type) {
	case string:
		if strings.Trim(v, " \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff") == "" {
			return c, errors.New("KugelAudio voice must be a nonempty handle or an integer ID")
		}
	case float64:
		if math.Trunc(v) != v || math.Abs(v) > 9007199254740991 {
			return c, errors.New("KugelAudio voice must be a nonempty handle or an integer ID")
		}
	}
	c.body["voice_id"], c.body["model_id"] = id, "kugel-3"
	if model.Present {
		c.body["model_id"] = model.Value.LiteralValue()
	}
	c.body["cfg_scale"], c.body["max_new_tokens"], c.body["speed"], c.body["normalize"] = float64(2), float64(2048), float64(1), true
	if guidance.Present {
		c.body["cfg_scale"] = guidance.Value
	}
	if tokens.Present {
		c.body["max_new_tokens"] = tokens.Value
	}
	if speed.Present {
		c.body["speed"] = speed.Value
	}
	if normalize.Present {
		c.body["normalize"] = normalize.Value.LiteralValue()
	}
	if language.Present {
		c.body["language"] = language.Value.LiteralValue()
	}
	if temperature.Present {
		c.body["temperature"] = temperature.Value
	} else if c.input == nil {
		c.body["temperature"] = 0.4
	}
	if boost.Present {
		c.speaker = boost.Value.LiteralValue()
	}
	if dictionaries.Present {
		c.body["project_id"] = dictionaries.Value.Scope
		if dictionaries.Value.Ids.Present {
			ids := append([]float64{}, dictionaries.Value.Ids.Value...)
			c.body["dictionary_ids"] = ids
		}
	}
	c.rate, c.encoding = audioSettings(output)
	c.body["sample_rate"] = c.rate
	if c.encoding != "pcm_s16le" {
		c.body["output_format"] = "alaw_8000"
		if c.encoding == "mulaw" {
			c.body["output_format"] = "ulaw_8000"
		}
	}
	c.socket = c.input != nil || c.timed || boost.Present
	if c.input != nil {
		c.body["flush_timeout_ms"], c.body["max_buffer_length"] = float64(500), float64(10000)
		if delay.Present {
			c.body["flush_timeout_ms"] = delay.Value
		}
		if threshold.Present {
			c.body["max_buffer_length"] = threshold.Value
		}
	}
	return c, nil
}

func audioSettings(output schema.TtsRequestTextVoiceOutput) (float64, string) {
	switch v := output.(type) {
	case *schema.TtsRequestTextVoiceOutputAsPcm:
		return audioSettings(*v)
	case *schema.TtsRequestTextVoiceOutputAsObject:
		return audioSettings(*v)
	case schema.TtsRequestTextVoiceOutputAsPcm:
		rate := float64(24000)
		if v.Value.SampleRateHz.Present {
			rate = v.Value.SampleRateHz.Value.LiteralValue()
		}
		return rate, "pcm_s16le"
	case schema.TtsRequestTextVoiceOutputAsObject:
		return 8000, v.Value.Format.LiteralValue()
	}
	panic("validated KugelAudio output has no representation")
}

func command(value Input) (string, map[string]any) {
	switch v := value.(type) {
	case *schema.TtsRequestStreamingTextVoiceTextItemAsString:
		return command(*v)
	case *schema.TtsRequestStreamingTextVoiceTextItemAsClear:
		return command(*v)
	case *schema.TtsRequestStreamingTextVoiceTextItemAsFlush:
		return command(*v)
	case *schema.TtsRequestStreamingTextVoiceTextItemAsUpdate:
		return command(*v)
	case schema.TtsRequestStreamingTextVoiceTextItemAsString:
		return "text", map[string]any{"text": v.Value}
	case schema.TtsRequestStreamingTextVoiceTextItemAsClear:
		return "clear", map[string]any{"cancel": true}
	case schema.TtsRequestStreamingTextVoiceTextItemAsFlush:
		return "flush", map[string]any{"flush": true}
	case schema.TtsRequestStreamingTextVoiceTextItemAsUpdate:
		u := v.Value
		settings := map[string]any{}
		if u.VoiceGuidance.Present {
			settings["cfg_scale"] = u.VoiceGuidance.Value
		}
		if u.Temperature.Present {
			settings["temperature"] = u.Temperature.Value
		}
		if u.MaxAudioTokens.Present {
			settings["max_new_tokens"] = u.MaxAudioTokens.Value
		}
		if u.Language.Present {
			settings["language"] = u.Language.Value.LiteralValue()
		}
		if u.TextNormalization.Present {
			settings["normalize"] = u.TextNormalization.Value.LiteralValue()
		}
		if u.Speed.Present {
			settings["speed"] = u.Speed.Value
		}
		return "update", map[string]any{"update_settings": settings}
	}
	panic("validated KugelAudio input has no representation")
}
