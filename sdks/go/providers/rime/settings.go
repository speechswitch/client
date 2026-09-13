package rime

import (
	"errors"
	"math"
	"strconv"
	"strings"

	schema "github.com/speechswitch/client/sdks/go/generated/rime"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type inputItem = schema.TtsRequestCodaStreamingTextVoice84ec2db1TextItem
type settings struct {
	text, format, segment       string
	input                       runtime.Input[inputItem]
	timed, explicitSegmentation bool
	wire                        map[string]any
}

// Conversion only; generated validation owns model/language unions and bounds.
func resolve(request schema.TtsRequest) (settings, error) {
	var result settings
	var voice, model string
	language := "en"
	var speed runtime.Optional[float64]
	var segmentation runtime.Optional[schema.TtsRequestCodaStreamingTextVoice84ec2db1Segmentation]
	var modernOutput runtime.Optional[schema.TtsRequestCodaStreamingTextVoice84ec2db1Output]
	var legacyOutput runtime.Optional[schema.TtsRequestMistV2StreamingTextVoice03cc8904Output]
	var markup runtime.Optional[schema.TtsRequestMistV2StreamingTextVoice03cc8904TextMarkup]
	var simpleMarkup runtime.Optional[schema.TtsRequestMistV3StreamingTextVoice49f68e83TextMarkup]
	var normalization runtime.Optional[schema.TtsRequestMistV2StreamingTextVoice03cc8904TextMarkupPauses]
	switch r := request.(type) {
	case *schema.TtsRequestAsCodaStreamingTextVoice84ec2db1:
		return resolve(*r)
	case *schema.TtsRequestAsCodaTextVoice50d85478:
		return resolve(*r)
	case *schema.TtsRequestAsCodaStreamingTextVoice33f4bd25:
		return resolve(*r)
	case *schema.TtsRequestAsCodaTextVoicef75e9756:
		return resolve(*r)
	case *schema.TtsRequestAsMistV2StreamingTextVoice03cc8904:
		return resolve(*r)
	case *schema.TtsRequestAsMistV2TextVoice20785ce4:
		return resolve(*r)
	case *schema.TtsRequestAsMistV2StreamingTextVoicec0dcaaf1:
		return resolve(*r)
	case *schema.TtsRequestAsMistV2TextVoiceae274411:
		return resolve(*r)
	case *schema.TtsRequestAsMistV3StreamingTextVoice88a01d24:
		return resolve(*r)
	case *schema.TtsRequestAsMistV3TextVoice2a5bc5c5:
		return resolve(*r)
	case *schema.TtsRequestAsMistV3StreamingTextVoice49f68e83:
		return resolve(*r)
	case *schema.TtsRequestAsMistV3TextVoice7d020de1:
		return resolve(*r)
	case *schema.TtsRequestAsMistV3StreamingTextVoice3acf8862:
		return resolve(*r)
	case *schema.TtsRequestAsMistV3TextVoice3fb6eaa2:
		return resolve(*r)
	case schema.TtsRequestAsCodaStreamingTextVoice84ec2db1:
		v := r.Value
		voice, model, language, speed, segmentation, modernOutput, result.input = v.Voice, "coda", v.Language.LiteralValue(), v.Speed, v.Segmentation, v.Output, v.Text
	case schema.TtsRequestAsCodaTextVoice50d85478:
		v := r.Value
		voice, model, language, speed, segmentation, modernOutput, result.text = v.Voice, "coda", v.Language.LiteralValue(), v.Speed, v.Segmentation, v.Output, v.Text
	case schema.TtsRequestAsCodaStreamingTextVoice33f4bd25:
		v := r.Value
		voice, model, speed, segmentation, modernOutput, result.input, result.timed = v.Voice, "coda", v.Speed, v.Segmentation, v.Output, v.Text, v.TimestampGranularity.Present
		if v.Language.Present {
			language = v.Language.Value.LiteralValue()
		}
	case schema.TtsRequestAsCodaTextVoicef75e9756:
		v := r.Value
		voice, model, speed, segmentation, modernOutput, result.text, result.timed = v.Voice, "coda", v.Speed, v.Segmentation, v.Output, v.Text, v.TimestampGranularity.Present
		if v.Language.Present {
			language = v.Language.Value.LiteralValue()
		}
	case schema.TtsRequestAsMistV2StreamingTextVoice03cc8904:
		v := r.Value
		voice, model, language, speed, segmentation, legacyOutput, result.input = v.Voice, "mistv2", v.Language.LiteralValue(), v.Speed, v.Segmentation, v.Output, v.Text
		markup, normalization = v.TextMarkup, v.TextNormalization
	case schema.TtsRequestAsMistV2TextVoice20785ce4:
		v := r.Value
		voice, model, language, speed, segmentation, legacyOutput, result.text = v.Voice, "mistv2", v.Language.LiteralValue(), v.Speed, v.Segmentation, v.Output, v.Text
		markup, normalization = v.TextMarkup, v.TextNormalization
	case schema.TtsRequestAsMistV2StreamingTextVoicec0dcaaf1:
		v := r.Value
		voice, model, speed, segmentation, legacyOutput, result.input, result.timed = v.Voice, "mistv2", v.Speed, v.Segmentation, v.Output, v.Text, v.TimestampGranularity.Present
		markup, normalization = v.TextMarkup, v.TextNormalization
		if v.Language.Present {
			language = v.Language.Value.LiteralValue()
		}
	case schema.TtsRequestAsMistV2TextVoiceae274411:
		v := r.Value
		voice, model, speed, segmentation, legacyOutput, result.text, result.timed = v.Voice, "mistv2", v.Speed, v.Segmentation, v.Output, v.Text, v.TimestampGranularity.Present
		markup, normalization = v.TextMarkup, v.TextNormalization
		if v.Language.Present {
			language = v.Language.Value.LiteralValue()
		}
	case schema.TtsRequestAsMistV3StreamingTextVoice88a01d24:
		v := r.Value
		voice, model, speed, segmentation, modernOutput, result.input, result.timed = v.Voice, "mistv3", v.Speed, v.Segmentation, v.Output, v.Text, v.TimestampGranularity.Present
		markup = v.TextMarkup
	case schema.TtsRequestAsMistV3TextVoice2a5bc5c5:
		v := r.Value
		voice, model, speed, segmentation, modernOutput, result.text, result.timed = v.Voice, "mistv3", v.Speed, v.Segmentation, v.Output, v.Text, v.TimestampGranularity.Present
		markup = v.TextMarkup
	case schema.TtsRequestAsMistV3StreamingTextVoice49f68e83:
		v := r.Value
		voice, model, language, speed, segmentation, modernOutput, result.input = v.Voice, "mistv3", v.Language.LiteralValue(), v.Speed, v.Segmentation, v.Output, v.Text
		simpleMarkup = v.TextMarkup
	case schema.TtsRequestAsMistV3TextVoice7d020de1:
		v := r.Value
		voice, model, language, speed, segmentation, modernOutput, result.text = v.Voice, "mistv3", v.Language.LiteralValue(), v.Speed, v.Segmentation, v.Output, v.Text
		simpleMarkup = v.TextMarkup
	case schema.TtsRequestAsMistV3StreamingTextVoice3acf8862:
		v := r.Value
		voice, model, language, speed, segmentation, modernOutput, result.input, result.timed = v.Voice, "mistv3", "es", v.Speed, v.Segmentation, v.Output, v.Text, v.TimestampGranularity.Present
		simpleMarkup = v.TextMarkup
	case schema.TtsRequestAsMistV3TextVoice3fb6eaa2:
		v := r.Value
		voice, model, language, speed, segmentation, modernOutput, result.text, result.timed = v.Voice, "mistv3", "es", v.Speed, v.Segmentation, v.Output, v.Text, v.TimestampGranularity.Present
		simpleMarkup = v.TextMarkup
	default:
		return result, errors.New("Unsupported generated Rime request representation")
	}
	result.segment = "bySentence"
	result.explicitSegmentation = segmentation.Present
	if segmentation.Present {
		result.segment = map[string]string{"sentence": "bySentence", "immediate": "immediate", "manual": "never"}[segmentation.Value.LiteralValue()]
	}
	result.format = "pcm"
	var rate runtime.Optional[float64]
	if modernOutput.Present {
		output := modernOutput.Value
		switch p := output.(type) {
		case *schema.TtsRequestCodaStreamingTextVoice84ec2db1OutputAsObject60a95a19:
			output = *p
		case *schema.TtsRequestCodaStreamingTextVoice84ec2db1OutputAsObjectb2df2f24:
			output = *p
		}
		switch p := output.(type) {
		case schema.TtsRequestCodaStreamingTextVoice84ec2db1OutputAsObject60a95a19:
			result.format, rate = p.Value.Format.LiteralValue(), p.Value.SampleRateHz
		case schema.TtsRequestCodaStreamingTextVoice84ec2db1OutputAsObjectb2df2f24:
			result.format, rate = p.Value.Format.LiteralValue(), p.Value.SampleRateHz
		default:
			return result, errors.New("Unsupported generated Rime output representation")
		}
	}
	if legacyOutput.Present {
		output := legacyOutput.Value
		switch p := output.(type) {
		case *schema.TtsRequestMistV2StreamingTextVoice03cc8904OutputAsPcm:
			output = *p
		case *schema.TtsRequestMistV2StreamingTextVoice03cc8904OutputAsMp3:
			output = *p
		case *schema.TtsRequestMistV2StreamingTextVoice03cc8904OutputAsMulaw:
			output = *p
		}
		switch p := output.(type) {
		case schema.TtsRequestMistV2StreamingTextVoice03cc8904OutputAsPcm:
			result.format, rate = "pcm", p.Value.SampleRateHz
		case schema.TtsRequestMistV2StreamingTextVoice03cc8904OutputAsMp3:
			result.format, rate = "mp3", p.Value.SampleRateHz
		case schema.TtsRequestMistV2StreamingTextVoice03cc8904OutputAsMulaw:
			result.format, rate = "mulaw", p.Value.SampleRateHz
		default:
			return result, errors.New("Unsupported generated Rime output representation")
		}
	}
	sampleRate := 24000.0
	if model == "mistv2" {
		sampleRate = map[string]float64{"pcm": 16000, "mp3": 22050, "mulaw": 8000}[result.format]
	}
	if rate.Present {
		sampleRate = rate.Value
	}
	scale := 1.0
	if speed.Present {
		scale = 1 / speed.Value
	}
	if math.IsInf(scale, 0) {
		return result, errors.New("Rime speed cannot be represented as a finite time scale")
	}
	result.wire = map[string]any{"speaker": voice, "modelId": model, "lang": language, "samplingRate": sampleRate}
	if model == "mistv2" {
		result.wire["lang"] = map[string]string{"en": "eng", "es": "spa", "fr": "fra", "de": "ger"}[language]
		result.wire["speedAlpha"] = scale
		result.wire["noTextNormalization"] = normalization.Present && !normalization.Value.LiteralValue()
	} else {
		result.wire["timeScaleFactor"] = scale
	}
	var pauses, phonemes bool
	var speeds runtime.Optional[[]float64]
	if markup.Present {
		pauses = markup.Value.Pauses.Present && markup.Value.Pauses.Value.LiteralValue()
		phonemes = markup.Value.Phonemes.Present && markup.Value.Phonemes.Value.LiteralValue()
		speeds = markup.Value.Speeds
	} else if simpleMarkup.Present {
		pauses = simpleMarkup.Value.Pauses.Present && simpleMarkup.Value.Pauses.Value.LiteralValue()
		speeds = simpleMarkup.Value.Speeds
	}
	if model != "coda" {
		result.wire["pauseBetweenBrackets"] = pauses
	}
	if model == "mistv2" || model == "mistv3" && language == "en" {
		result.wire["phonemizeBetweenBrackets"] = phonemes
	}
	if speeds.Present {
		parts := make([]string, len(speeds.Value))
		for i, speed := range speeds.Value {
			// Numeric item annotations cannot express a strictly positive finite reciprocal.
			scale := 1 / speed
			if speed <= 0 || math.IsInf(scale, 0) {
				return result, errors.New("Rime inline speeds must have a positive finite reciprocal")
			}
			parts[i] = strconv.FormatFloat(scale, 'f', -1, 64)
		}
		result.wire["inlineSpeedAlpha"] = strings.Join(parts, ",")
	}
	return result, nil
}

func inputValue(value inputItem) (string, string, error) {
	switch v := value.(type) {
	case schema.TtsRequestCodaStreamingTextVoice84ec2db1TextItemAsString:
		return v.Value, "", nil
	case *schema.TtsRequestCodaStreamingTextVoice84ec2db1TextItemAsString:
		return v.Value, "", nil
	case schema.TtsRequestCodaStreamingTextVoice84ec2db1TextItemAsClear, *schema.TtsRequestCodaStreamingTextVoice84ec2db1TextItemAsClear:
		return "", "clear", nil
	case schema.TtsRequestCodaStreamingTextVoice84ec2db1TextItemAsFlush, *schema.TtsRequestCodaStreamingTextVoice84ec2db1TextItemAsFlush:
		return "", "flush", nil
	default:
		return "", "", errors.New("Unsupported generated Rime input representation")
	}
}
