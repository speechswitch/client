package xai

import (
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"

	schema "github.com/speechswitch/client/sdks/go/generated/xai"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type inputItem = schema.TtsRequestStreamingTextTextItem
type settings struct {
	text    string
	input   runtime.Input[inputItem]
	timed   bool
	wire    map[string]any
	initial runtime.Optional[map[string]string]
}
type inputEvent struct {
	kind, text   string
	replacements map[string]string
}

// Generated validation owns request variants, literal choices and schema bounds.
func resolve(request schema.TtsRequest) (settings, error) {
	var result settings
	var language runtime.Optional[schema.TtsRequestTextLanguage]
	var latency runtime.Optional[schema.TtsRequestTextLatencyOptimization]
	var output runtime.Optional[schema.TtsRequestTextOutput]
	var replacements runtime.Optional[[]schema.TtsRequestTextReplacementsItem]
	var speed runtime.Optional[float64]
	var normalization runtime.Optional[schema.TtsRequestTextTextNormalization]
	var voice runtime.Optional[string]
	switch r := request.(type) {
	case *schema.TtsRequestAsText:
		return resolve(*r)
	case *schema.TtsRequestAsStreamingText:
		return resolve(*r)
	case schema.TtsRequestAsText:
		v := r.Value
		result.text, result.timed = v.Text, v.TimestampGranularity.Present
		language, latency, output, replacements, speed, normalization, voice = v.Language, v.LatencyOptimization, v.Output, v.Replacements, v.Speed, v.TextNormalization, v.Voice
	case schema.TtsRequestAsStreamingText:
		v := r.Value
		result.input, result.timed = v.Text, v.TimestampGranularity.Present
		language, latency, output, replacements, speed, normalization, voice = v.Language, v.LatencyOptimization, v.Output, v.Replacements, v.Speed, v.TextNormalization, v.Voice
	default:
		return result, errors.New("Unsupported generated xAI request representation")
	}
	result.wire = map[string]any{"language": "auto"}
	if language.Present {
		result.wire["language"] = language.Value.LiteralValue()
	}
	if voice.Present {
		result.wire["voice_id"] = voice.Value
	}
	if speed.Present {
		result.wire["speed"] = speed.Value
	}
	if normalization.Present {
		result.wire["text_normalization"] = normalization.Value.LiteralValue()
	}
	if latency.Present {
		result.wire["optimize_streaming_latency"] = map[string]int{"none": 0, "moderate": 1, "aggressive": 2}[latency.Value.LiteralValue()]
	}
	if result.timed {
		result.wire["with_timestamps"] = true
	}
	if replacements.Present {
		values, err := replacementMap(replacements.Value)
		if err != nil {
			return result, err
		}
		result.initial = runtime.Some(values)
		result.wire["replace"] = values
	}
	if output.Present {
		value := output.Value
		switch p := value.(type) {
		case *schema.TtsRequestTextOutputAsMp3:
			value = *p
		case *schema.TtsRequestTextOutputAsObject:
			value = *p
		}
		native := map[string]any{}
		var rate runtime.Optional[schema.TtsRequestTextOutputMp3SampleRateHz]
		switch p := value.(type) {
		case schema.TtsRequestTextOutputAsMp3:
			native["codec"], rate = "mp3", p.Value.SampleRateHz
			if p.Value.BitRateBps.Present {
				native["bit_rate"] = p.Value.BitRateBps.Value.LiteralValue()
			}
		case schema.TtsRequestTextOutputAsObject:
			native["codec"], rate = p.Value.Format.LiteralValue(), p.Value.SampleRateHz
		default:
			return result, errors.New("Unsupported generated xAI output representation")
		}
		if rate.Present {
			native["sample_rate"] = rate.Value.LiteralValue()
		}
		result.wire["output_format"] = native
	}
	return result, nil
}

func replacementMap(items []schema.TtsRequestTextReplacementsItem) (map[string]string, error) {
	result, phrases := make(map[string]string, len(items)), make(map[string]bool, len(items))
	for _, item := range items {
		// Go's simple Unicode lowercasing can merge phrases that full lowercasing
		// keeps distinct (such as dotted I). Leave non-ASCII case equivalence to xAI.
		phrase := strings.Map(func(r rune) rune {
			if r >= 'A' && r <= 'Z' {
				return r + ('a' - 'A')
			}
			return r
		}, strings.Join(strings.FieldsFunc(item.Pattern, func(r rune) bool {
			return r == '\ufeff' || r != '\u0085' && unicode.IsSpace(r)
		}), " "))
		if phrases[phrase] {
			return nil, errors.New("Duplicate xAI replacement phrase: " + item.Pattern)
		}
		phrases[phrase], result[item.Pattern] = true, item.Replacement
	}
	return result, nil
}

func inputValue(value inputItem, validate runtime.InputValidator) (inputEvent, error) {
	if err := validate(value); err != nil {
		return inputEvent{}, err
	}
	switch p := value.(type) {
	case *schema.TtsRequestStreamingTextTextItemAsString:
		value = *p
	case *schema.TtsRequestStreamingTextTextItemAsClear:
		value = *p
	case *schema.TtsRequestStreamingTextTextItemAsFlush:
		value = *p
	case *schema.TtsRequestStreamingTextTextItemAsUpdate:
		value = *p
	}
	switch p := value.(type) {
	case schema.TtsRequestStreamingTextTextItemAsString:
		// The native frame limit does not constrain total async input length.
		if utf8.RuneCountInString(p.Value) > 15000 {
			return inputEvent{}, errors.New("xAI text.delta exceeds 15000 characters")
		}
		return inputEvent{kind: "text", text: p.Value}, nil
	case schema.TtsRequestStreamingTextTextItemAsClear:
		return inputEvent{kind: "clear"}, nil
	case schema.TtsRequestStreamingTextTextItemAsFlush:
		return inputEvent{kind: "flush"}, nil
	case schema.TtsRequestStreamingTextTextItemAsUpdate:
		replacements, err := replacementMap(p.Value.Replacements)
		return inputEvent{kind: "update", replacements: replacements}, err
	default:
		return inputEvent{}, errors.New("Unsupported generated xAI input representation")
	}
}
