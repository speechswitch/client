package elevenlabs

import (
	"context"
	"errors"
	schema "github.com/speechswitch/client/sdks/go/generated/elevenlabs"
	"github.com/speechswitch/client/sdks/go/runtime"
	"strconv"
)

type Input = schema.TtsRequestStreamingTextVoice194990a6TextItem
type DialogueInput = schema.TtsRequestElevenV3StreamingTextVoicef18e078fTextItem

// Internal input erasure preserves the original item for generated validation.
type inputSource[T any] struct{ runtime.Input[T] }

func (s inputSource[T]) Next(ctx context.Context) (any, error) { return s.Input.Next(ctx) }
func inputOf[T any](s runtime.Input[T]) runtime.Input[any]     { return inputSource[T]{s} }

type configuration struct {
	model, voice, text                        string
	input                                     runtime.Input[any]
	output                                    any
	language                                  runtime.Optional[string]
	seed, speed, stability, style, similarity runtime.Optional[float64]
	boost                                     runtime.Optional[bool]
	normalization, latency                    string
	languageNormalization                     bool
	before, after                             runtime.Optional[schema.TtsRequestTextVoice4a0120aeContextAfter]
	dictionaries                              runtime.Optional[[]map[string]any]
	schedule                                  runtime.Optional[[]float64]
	unbuffered, ssml, timed, normalized       bool
}

func boolOption(value runtime.Optional[schema.TtsRequestTextVoice4a0120aeLanguageTextNormalization]) runtime.Optional[bool] {
	if value.Present {
		return runtime.Some(value.Value.LiteralValue())
	}
	return runtime.Optional[bool]{}
}
func literal[T interface{ LiteralValue() string }](value runtime.Optional[T]) string {
	if value.Present {
		return value.Value.LiteralValue()
	}
	return ""
}
func normalization(value runtime.Optional[schema.TtsRequestTextVoice4a0120aeTextNormalization]) string {
	if !value.Present {
		return "auto"
	}
	switch value.Value.(type) {
	case schema.TtsRequestTextVoice4a0120aeTextNormalizationAsFalse, *schema.TtsRequestTextVoice4a0120aeTextNormalizationAsFalse:
		return "off"
	case schema.TtsRequestTextVoice4a0120aeTextNormalizationAsTrue, *schema.TtsRequestTextVoice4a0120aeTextNormalizationAsTrue:
		return "on"
	default:
		return "auto"
	}
}
func httpDictionaries(value runtime.Optional[[]schema.TtsRequestTextVoice4a0120aePronunciationDictionariesItem]) runtime.Optional[[]map[string]any] {
	if !value.Present {
		return runtime.Optional[[]map[string]any]{}
	}
	items := make([]map[string]any, 0, len(value.Value))
	for _, v := range value.Value {
		item := map[string]any{"pronunciation_dictionary_id": v.Id}
		if v.VersionId.Present {
			item["version_id"] = v.VersionId.Value
		}
		items = append(items, item)
	}
	return runtime.Some(items)
}
func liveDictionaries(value runtime.Optional[[]schema.TtsRequestStreamingTextVoice194990a6PronunciationDictionariesItem]) runtime.Optional[[]map[string]any] {
	if !value.Present {
		return runtime.Optional[[]map[string]any]{}
	}
	items := make([]map[string]any, 0, len(value.Value))
	for _, v := range value.Value {
		items = append(items, map[string]any{"pronunciation_dictionary_id": v.Id, "version_id": v.VersionId})
	}
	return runtime.Some(items)
}

// Generated validation runs before these representation conversions.
func settings(request schema.TtsRequest) (configuration, error) {
	switch request := request.(type) {
	case *schema.TtsRequestAsTextVoice4a0120ae:
		return settings(*request)
	case *schema.TtsRequestAsTextVoice68b36b42:
		return settings(*request)
	case *schema.TtsRequestAsTextVoice9cb211ad:
		return settings(*request)
	case *schema.TtsRequestAsStreamingTextVoice194990a6:
		return settings(*request)
	case *schema.TtsRequestAsTextVoiceac5e804b:
		return settings(*request)
	case *schema.TtsRequestAsStreamingTextVoice04078405:
		return settings(*request)
	case *schema.TtsRequestAsStreamingTextVoicef49cfea8:
		return settings(*request)
	case *schema.TtsRequestAsStreamingTextVoice282de2db:
		return settings(*request)
	case *schema.TtsRequestAsMultilingualV2TextVoiceb7dcb211:
		return settings(*request)
	case *schema.TtsRequestAsMultilingualV2TextVoice6b4236de:
		return settings(*request)
	case *schema.TtsRequestAsMultilingualV2TextVoiceca4ba9c1:
		return settings(*request)
	case *schema.TtsRequestAsMultilingualV2StreamingTextVoice90f3837b:
		return settings(*request)
	case *schema.TtsRequestAsMultilingualV2TextVoice51150c25:
		return settings(*request)
	case *schema.TtsRequestAsMultilingualV2StreamingTextVoice7bc2227c:
		return settings(*request)
	case *schema.TtsRequestAsMultilingualV2StreamingTextVoice388d65c0:
		return settings(*request)
	case *schema.TtsRequestAsMultilingualV2StreamingTextVoice1e73ed4e:
		return settings(*request)
	case *schema.TtsRequestAsElevenV3TextVoiceedc22df3:
		return settings(*request)
	case *schema.TtsRequestAsElevenV3TextVoicea067d696:
		return settings(*request)
	case *schema.TtsRequestAsElevenV3TextVoiceb4b74c48:
		return settings(*request)
	case *schema.TtsRequestAsElevenV3StreamingTextVoicef18e078f:
		return settings(*request)
	case *schema.TtsRequestAsElevenV3TextVoicef41607cd:
		return settings(*request)
	case *schema.TtsRequestAsElevenV3StreamingTextVoicec9aef256:
		return settings(*request)
	case schema.TtsRequestAsTextVoice4a0120ae:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.LiteralValue(), language: v.Language, seed: v.RandomSeed, speed: v.Speed, stability: v.Stability, style: v.StyleExaggeration, similarity: v.VoiceSimilarity, boost: boolOption(v.VoiceBoost), before: v.ContextBefore, after: v.ContextAfter, languageNormalization: boolOption(v.LanguageTextNormalization).Value, text: v.Text, normalization: normalization(v.TextNormalization), latency: literal(v.LatencyOptimization), dictionaries: httpDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsTextVoice68b36b42:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.LiteralValue(), language: v.Language, seed: v.RandomSeed, speed: v.Speed, stability: v.Stability, style: v.StyleExaggeration, similarity: v.VoiceSimilarity, boost: boolOption(v.VoiceBoost), before: v.ContextBefore, after: v.ContextAfter, languageNormalization: boolOption(v.LanguageTextNormalization).Value, text: v.Text, normalization: "off", latency: v.LatencyOptimization.Value(), dictionaries: httpDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsTextVoice9cb211ad:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.LiteralValue(), language: v.Language, seed: v.RandomSeed, speed: v.Speed, stability: v.Stability, style: v.StyleExaggeration, similarity: v.VoiceSimilarity, boost: boolOption(v.VoiceBoost), before: v.ContextBefore, after: v.ContextAfter, timed: true, languageNormalization: boolOption(v.LanguageTextNormalization).Value, text: v.Text, normalization: "off", latency: v.LatencyOptimization.Value(), normalized: literal(v.TimestampText) == "normalized", dictionaries: httpDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsStreamingTextVoice194990a6:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.LiteralValue(), language: v.Language, seed: v.RandomSeed, speed: v.Speed, stability: v.Stability, style: v.StyleExaggeration, similarity: v.VoiceSimilarity, boost: boolOption(v.VoiceBoost), ssml: literal(v.InputType) == "ssml", schedule: v.TextBufferThresholds, input: inputOf(v.Text), normalization: normalization(v.TextNormalization), dictionaries: liveDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsTextVoiceac5e804b:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.LiteralValue(), language: v.Language, seed: v.RandomSeed, speed: v.Speed, stability: v.Stability, style: v.StyleExaggeration, similarity: v.VoiceSimilarity, boost: boolOption(v.VoiceBoost), before: v.ContextBefore, after: v.ContextAfter, timed: true, languageNormalization: boolOption(v.LanguageTextNormalization).Value, text: v.Text, normalization: normalization(v.TextNormalization), latency: literal(v.LatencyOptimization), normalized: literal(v.TimestampText) == "normalized", dictionaries: httpDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsStreamingTextVoice04078405:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.LiteralValue(), language: v.Language, seed: v.RandomSeed, speed: v.Speed, stability: v.Stability, style: v.StyleExaggeration, similarity: v.VoiceSimilarity, boost: boolOption(v.VoiceBoost), ssml: literal(v.InputType) == "ssml", schedule: v.TextBufferThresholds, timed: true, input: inputOf(v.Text), normalization: normalization(v.TextNormalization), normalized: literal(v.TimestampText) == "normalized", dictionaries: liveDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsStreamingTextVoicef49cfea8:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.LiteralValue(), language: v.Language, seed: v.RandomSeed, speed: v.Speed, stability: v.Stability, style: v.StyleExaggeration, similarity: v.VoiceSimilarity, boost: boolOption(v.VoiceBoost), ssml: literal(v.InputType) == "ssml", input: inputOf(v.Text), normalization: normalization(v.TextNormalization), unbuffered: true, dictionaries: liveDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsStreamingTextVoice282de2db:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.LiteralValue(), language: v.Language, seed: v.RandomSeed, speed: v.Speed, stability: v.Stability, style: v.StyleExaggeration, similarity: v.VoiceSimilarity, boost: boolOption(v.VoiceBoost), ssml: literal(v.InputType) == "ssml", timed: true, input: inputOf(v.Text), normalization: normalization(v.TextNormalization), normalized: literal(v.TimestampText) == "normalized", unbuffered: true, dictionaries: liveDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsMultilingualV2TextVoiceb7dcb211:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.Value(), seed: v.RandomSeed, speed: v.Speed, stability: v.Stability, style: v.StyleExaggeration, similarity: v.VoiceSimilarity, boost: boolOption(v.VoiceBoost), before: v.ContextBefore, after: v.ContextAfter, languageNormalization: boolOption(v.LanguageTextNormalization).Value, text: v.Text, normalization: normalization(v.TextNormalization), latency: literal(v.LatencyOptimization), dictionaries: httpDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsMultilingualV2TextVoice6b4236de:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.Value(), seed: v.RandomSeed, speed: v.Speed, stability: v.Stability, style: v.StyleExaggeration, similarity: v.VoiceSimilarity, boost: boolOption(v.VoiceBoost), before: v.ContextBefore, after: v.ContextAfter, languageNormalization: boolOption(v.LanguageTextNormalization).Value, text: v.Text, normalization: "off", latency: v.LatencyOptimization.Value(), dictionaries: httpDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsMultilingualV2TextVoiceca4ba9c1:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.Value(), seed: v.RandomSeed, speed: v.Speed, stability: v.Stability, style: v.StyleExaggeration, similarity: v.VoiceSimilarity, boost: boolOption(v.VoiceBoost), before: v.ContextBefore, after: v.ContextAfter, timed: true, languageNormalization: boolOption(v.LanguageTextNormalization).Value, text: v.Text, normalization: "off", latency: v.LatencyOptimization.Value(), normalized: literal(v.TimestampText) == "normalized", dictionaries: httpDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsMultilingualV2StreamingTextVoice90f3837b:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.Value(), seed: v.RandomSeed, speed: v.Speed, stability: v.Stability, style: v.StyleExaggeration, similarity: v.VoiceSimilarity, boost: boolOption(v.VoiceBoost), ssml: literal(v.InputType) == "ssml", schedule: v.TextBufferThresholds, input: inputOf(v.Text), normalization: normalization(v.TextNormalization), dictionaries: liveDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsMultilingualV2TextVoice51150c25:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.Value(), seed: v.RandomSeed, speed: v.Speed, stability: v.Stability, style: v.StyleExaggeration, similarity: v.VoiceSimilarity, boost: boolOption(v.VoiceBoost), before: v.ContextBefore, after: v.ContextAfter, timed: true, languageNormalization: boolOption(v.LanguageTextNormalization).Value, text: v.Text, normalization: normalization(v.TextNormalization), latency: literal(v.LatencyOptimization), normalized: literal(v.TimestampText) == "normalized", dictionaries: httpDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsMultilingualV2StreamingTextVoice7bc2227c:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.Value(), seed: v.RandomSeed, speed: v.Speed, stability: v.Stability, style: v.StyleExaggeration, similarity: v.VoiceSimilarity, boost: boolOption(v.VoiceBoost), ssml: literal(v.InputType) == "ssml", schedule: v.TextBufferThresholds, timed: true, input: inputOf(v.Text), normalization: normalization(v.TextNormalization), normalized: literal(v.TimestampText) == "normalized", dictionaries: liveDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsMultilingualV2StreamingTextVoice388d65c0:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.Value(), seed: v.RandomSeed, speed: v.Speed, stability: v.Stability, style: v.StyleExaggeration, similarity: v.VoiceSimilarity, boost: boolOption(v.VoiceBoost), ssml: literal(v.InputType) == "ssml", input: inputOf(v.Text), normalization: normalization(v.TextNormalization), unbuffered: true, dictionaries: liveDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsMultilingualV2StreamingTextVoice1e73ed4e:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.Value(), seed: v.RandomSeed, speed: v.Speed, stability: v.Stability, style: v.StyleExaggeration, similarity: v.VoiceSimilarity, boost: boolOption(v.VoiceBoost), ssml: literal(v.InputType) == "ssml", timed: true, input: inputOf(v.Text), normalization: normalization(v.TextNormalization), normalized: literal(v.TimestampText) == "normalized", unbuffered: true, dictionaries: liveDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsElevenV3TextVoiceedc22df3:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.Value(), language: v.Language, seed: v.RandomSeed, stability: v.Stability, before: v.ContextBefore, after: v.ContextAfter, languageNormalization: boolOption(v.LanguageTextNormalization).Value, text: v.Text, normalization: normalization(v.TextNormalization), latency: literal(v.LatencyOptimization), dictionaries: httpDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsElevenV3TextVoicea067d696:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.Value(), language: v.Language, seed: v.RandomSeed, stability: v.Stability, before: v.ContextBefore, after: v.ContextAfter, languageNormalization: boolOption(v.LanguageTextNormalization).Value, text: v.Text, normalization: "off", latency: v.LatencyOptimization.Value(), dictionaries: httpDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsElevenV3TextVoiceb4b74c48:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.Value(), language: v.Language, seed: v.RandomSeed, stability: v.Stability, before: v.ContextBefore, after: v.ContextAfter, timed: true, languageNormalization: boolOption(v.LanguageTextNormalization).Value, text: v.Text, normalization: "off", latency: v.LatencyOptimization.Value(), normalized: literal(v.TimestampText) == "normalized", dictionaries: httpDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsElevenV3StreamingTextVoicef18e078f:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.Value(), language: v.Language, seed: v.RandomSeed, stability: v.Stability, input: inputOf(v.Text), normalization: normalization(v.TextNormalization), dictionaries: liveDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsElevenV3TextVoicef41607cd:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.Value(), language: v.Language, seed: v.RandomSeed, stability: v.Stability, before: v.ContextBefore, after: v.ContextAfter, timed: true, languageNormalization: boolOption(v.LanguageTextNormalization).Value, text: v.Text, normalization: normalization(v.TextNormalization), latency: literal(v.LatencyOptimization), normalized: literal(v.TimestampText) == "normalized", dictionaries: httpDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsElevenV3StreamingTextVoicec9aef256:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.Value(), language: v.Language, seed: v.RandomSeed, stability: v.Stability, timed: true, input: inputOf(v.Text), normalization: normalization(v.TextNormalization), dictionaries: liveDictionaries(v.PronunciationDictionaries)}, nil
	default:
		return configuration{}, errors.New("Unsupported generated ElevenLabs request representation")
	}
}
func outputFormat(value any) (string, error) {
	switch v := value.(type) {
	case schema.TtsRequestTextVoice4a0120aeOutputAsMp31de777c9:
		return outputFormat(v.Value)
	case *schema.TtsRequestTextVoice4a0120aeOutputAsMp31de777c9:
		return outputFormat(v.Value)
	case schema.TtsRequestTextVoice4a0120aeOutputAsMp34def27fa:
		return outputFormat(v.Value)
	case *schema.TtsRequestTextVoice4a0120aeOutputAsMp34def27fa:
		return outputFormat(v.Value)
	case schema.TtsRequestTextVoice4a0120aeOutputAsMp356cad1fb:
		return outputFormat(v.Value)
	case *schema.TtsRequestTextVoice4a0120aeOutputAsMp356cad1fb:
		return outputFormat(v.Value)
	case schema.TtsRequestTextVoice4a0120aeOutputAsOggOpus:
		return outputFormat(v.Value)
	case *schema.TtsRequestTextVoice4a0120aeOutputAsOggOpus:
		return outputFormat(v.Value)
	case schema.TtsRequestTextVoice4a0120aeOutputAsPcm:
		return outputFormat(v.Value)
	case *schema.TtsRequestTextVoice4a0120aeOutputAsPcm:
		return outputFormat(v.Value)
	case schema.TtsRequestTextVoice4a0120aeOutputAsObject:
		return outputFormat(v.Value)
	case *schema.TtsRequestTextVoice4a0120aeOutputAsObject:
		return outputFormat(v.Value)
	case schema.TtsRequestTextVoice4a0120aeOutputAsWav:
		return outputFormat(v.Value)
	case *schema.TtsRequestTextVoice4a0120aeOutputAsWav:
		return outputFormat(v.Value)
	case schema.TtsRequestStreamingTextVoice194990a6OutputAsMp31de777c9:
		return outputFormat(v.Value)
	case *schema.TtsRequestStreamingTextVoice194990a6OutputAsMp31de777c9:
		return outputFormat(v.Value)
	case schema.TtsRequestStreamingTextVoice194990a6OutputAsMp34def27fa:
		return outputFormat(v.Value)
	case *schema.TtsRequestStreamingTextVoice194990a6OutputAsMp34def27fa:
		return outputFormat(v.Value)
	case schema.TtsRequestStreamingTextVoice194990a6OutputAsMp356cad1fb:
		return outputFormat(v.Value)
	case *schema.TtsRequestStreamingTextVoice194990a6OutputAsMp356cad1fb:
		return outputFormat(v.Value)
	case schema.TtsRequestStreamingTextVoice194990a6OutputAsOggOpus:
		return outputFormat(v.Value)
	case *schema.TtsRequestStreamingTextVoice194990a6OutputAsOggOpus:
		return outputFormat(v.Value)
	case schema.TtsRequestStreamingTextVoice194990a6OutputAsPcm:
		return outputFormat(v.Value)
	case *schema.TtsRequestStreamingTextVoice194990a6OutputAsPcm:
		return outputFormat(v.Value)
	case schema.TtsRequestStreamingTextVoice194990a6OutputAsObject:
		return outputFormat(v.Value)
	case *schema.TtsRequestStreamingTextVoice194990a6OutputAsObject:
		return outputFormat(v.Value)
	case schema.TtsRequestTextVoice4a0120aeOutputMp31de777c9:
		return "mp3_22050_32", nil
	case schema.TtsRequestTextVoice4a0120aeOutputMp34def27fa:
		return "mp3_24000_48", nil
	case schema.TtsRequestTextVoice4a0120aeOutputMp356cad1fb:
		bitrate := 128000.0
		if v.BitRateBps.Present {
			bitrate = v.BitRateBps.Value.LiteralValue()
		}
		return "mp3_44100_" + strconv.FormatFloat(bitrate/1000, 'f', -1, 64), nil
	case schema.TtsRequestTextVoice4a0120aeOutputOggOpus:
		bitrate := 128000.0
		if v.BitRateBps.Present {
			bitrate = v.BitRateBps.Value.LiteralValue()
		}
		return "opus_48000_" + strconv.FormatFloat(bitrate/1000, 'f', -1, 64), nil
	case schema.TtsRequestTextVoice4a0120aeOutputPcm:
		rate := v.SampleRateHz.LiteralValue()
		return "pcm_" + strconv.FormatFloat(rate, 'f', -1, 64), nil
	case schema.TtsRequestTextVoice4a0120aeOutputWav:
		rate := v.SampleRateHz.LiteralValue()
		return "wav_" + strconv.FormatFloat(rate, 'f', -1, 64), nil
	case schema.TtsRequestTextVoice4a0120aeOutputObject:
		format := v.Format.LiteralValue()
		if format == "mulaw" {
			format = "ulaw"
		}
		return format + "_8000", nil
	default:
		return "", errors.New("Unsupported generated ElevenLabs output representation")
	}
}
func contextFields(value schema.TtsRequestTextVoice4a0120aeContextAfter, prefix string, body map[string]any) {
	switch v := value.(type) {
	case *schema.TtsRequestTextVoice4a0120aeContextAfterAsText:
		contextFields(*v, prefix, body)
	case *schema.TtsRequestTextVoice4a0120aeContextAfterAsObject:
		contextFields(*v, prefix, body)
	case schema.TtsRequestTextVoice4a0120aeContextAfterAsText:
		body[prefix+"_text"] = v.Value.Text
	case schema.TtsRequestTextVoice4a0120aeContextAfterAsObject:
		body[prefix+"_request_ids"] = append([]string{}, v.Value.RequestIds...)
	}
}
func inputValue(value any) (string, string, error) {
	switch v := value.(type) {
	case schema.TtsRequestStreamingTextVoice194990a6TextItemAsString:
		return v.Value, "", nil
	case *schema.TtsRequestStreamingTextVoice194990a6TextItemAsString:
		return v.Value, "", nil
	case schema.TtsRequestElevenV3StreamingTextVoicef18e078fTextItemAsString:
		return v.Value, "", nil
	case *schema.TtsRequestElevenV3StreamingTextVoicef18e078fTextItemAsString:
		return v.Value, "", nil
	case schema.TtsRequestStreamingTextVoice194990a6TextItemAsClear, *schema.TtsRequestStreamingTextVoice194990a6TextItemAsClear:
		return "", "clear", nil
	case schema.TtsRequestStreamingTextVoice194990a6TextItemAsFlush, *schema.TtsRequestStreamingTextVoice194990a6TextItemAsFlush,
		schema.TtsRequestElevenV3StreamingTextVoicef18e078fTextItemAsFlush, *schema.TtsRequestElevenV3StreamingTextVoicef18e078fTextItemAsFlush:
		return "", "flush", nil
	default:
		return "", "", errors.New("Unsupported generated ElevenLabs input representation")
	}
}
