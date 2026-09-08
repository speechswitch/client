package elevenlabs

import (
	"context"
	"errors"
	schema "github.com/speechswitch/client/sdks/go/generated/elevenlabs"
	"github.com/speechswitch/client/sdks/go/runtime"
	"strconv"
)

type Input = schema.TtsRequestStreamingTextVoice5024de38TextItem
type DialogueInput = schema.TtsRequestElevenV3StreamingTextVoice145c0c5aTextItem

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
	before, after                             runtime.Optional[schema.TtsRequestTextVoice814840b5ContextAfter]
	dictionaries                              runtime.Optional[[]map[string]any]
	schedule                                  runtime.Optional[[]float64]
	unbuffered, ssml, timed, normalized       bool
}

func boolOption(value runtime.Optional[schema.TtsRequestTextVoice814840b5LanguageTextNormalization]) runtime.Optional[bool] {
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
func normalization(value runtime.Optional[schema.TtsRequestTextVoice814840b5TextNormalization]) string {
	if !value.Present {
		return "auto"
	}
	switch value.Value.(type) {
	case schema.TtsRequestTextVoice814840b5TextNormalizationAsFalse, *schema.TtsRequestTextVoice814840b5TextNormalizationAsFalse:
		return "off"
	case schema.TtsRequestTextVoice814840b5TextNormalizationAsTrue, *schema.TtsRequestTextVoice814840b5TextNormalizationAsTrue:
		return "on"
	default:
		return "auto"
	}
}
func httpDictionaries(value runtime.Optional[[]schema.TtsRequestTextVoice814840b5PronunciationDictionariesItem]) runtime.Optional[[]map[string]any] {
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
func liveDictionaries(value runtime.Optional[[]schema.TtsRequestStreamingTextVoice5024de38PronunciationDictionariesItem]) runtime.Optional[[]map[string]any] {
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
	case *schema.TtsRequestAsTextVoice814840b5:
		return settings(*request)
	case *schema.TtsRequestAsTextVoiceeabc9ca0:
		return settings(*request)
	case *schema.TtsRequestAsTextVoice1aa1b026:
		return settings(*request)
	case *schema.TtsRequestAsStreamingTextVoice5024de38:
		return settings(*request)
	case *schema.TtsRequestAsTextVoice6596490e:
		return settings(*request)
	case *schema.TtsRequestAsStreamingTextVoiceb9af60c3:
		return settings(*request)
	case *schema.TtsRequestAsStreamingTextVoice732994d4:
		return settings(*request)
	case *schema.TtsRequestAsStreamingTextVoicebc33fdb4:
		return settings(*request)
	case *schema.TtsRequestAsMultilingualV2TextVoiceae5db0bf:
		return settings(*request)
	case *schema.TtsRequestAsMultilingualV2TextVoice2ee6cad1:
		return settings(*request)
	case *schema.TtsRequestAsMultilingualV2TextVoice4ed687d7:
		return settings(*request)
	case *schema.TtsRequestAsMultilingualV2StreamingTextVoice729ee226:
		return settings(*request)
	case *schema.TtsRequestAsMultilingualV2TextVoice11f62a92:
		return settings(*request)
	case *schema.TtsRequestAsMultilingualV2StreamingTextVoice3f7db298:
		return settings(*request)
	case *schema.TtsRequestAsMultilingualV2StreamingTextVoiceac3750e0:
		return settings(*request)
	case *schema.TtsRequestAsMultilingualV2StreamingTextVoiceb51c2303:
		return settings(*request)
	case *schema.TtsRequestAsElevenV3TextVoicec3eabebc:
		return settings(*request)
	case *schema.TtsRequestAsElevenV3TextVoicefade944d:
		return settings(*request)
	case *schema.TtsRequestAsElevenV3TextVoicebb26fac2:
		return settings(*request)
	case *schema.TtsRequestAsElevenV3StreamingTextVoice145c0c5a:
		return settings(*request)
	case *schema.TtsRequestAsElevenV3TextVoicede803f4c:
		return settings(*request)
	case *schema.TtsRequestAsElevenV3StreamingTextVoicec1dc022a:
		return settings(*request)
	case schema.TtsRequestAsTextVoice814840b5:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.LiteralValue(), language: v.Language, seed: v.RandomSeed, speed: v.Speed, stability: v.Stability, style: v.StyleExaggeration, similarity: v.VoiceSimilarity, boost: boolOption(v.VoiceBoost), before: v.ContextBefore, after: v.ContextAfter, languageNormalization: boolOption(v.LanguageTextNormalization).Value, text: v.Text, normalization: normalization(v.TextNormalization), latency: literal(v.LatencyOptimization), dictionaries: httpDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsTextVoiceeabc9ca0:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.LiteralValue(), language: v.Language, seed: v.RandomSeed, speed: v.Speed, stability: v.Stability, style: v.StyleExaggeration, similarity: v.VoiceSimilarity, boost: boolOption(v.VoiceBoost), before: v.ContextBefore, after: v.ContextAfter, languageNormalization: boolOption(v.LanguageTextNormalization).Value, text: v.Text, normalization: "off", latency: v.LatencyOptimization.Value(), dictionaries: httpDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsTextVoice1aa1b026:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.LiteralValue(), language: v.Language, seed: v.RandomSeed, speed: v.Speed, stability: v.Stability, style: v.StyleExaggeration, similarity: v.VoiceSimilarity, boost: boolOption(v.VoiceBoost), before: v.ContextBefore, after: v.ContextAfter, timed: true, languageNormalization: boolOption(v.LanguageTextNormalization).Value, text: v.Text, normalization: "off", latency: v.LatencyOptimization.Value(), normalized: literal(v.TimestampText) == "normalized", dictionaries: httpDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsStreamingTextVoice5024de38:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.LiteralValue(), language: v.Language, seed: v.RandomSeed, speed: v.Speed, stability: v.Stability, style: v.StyleExaggeration, similarity: v.VoiceSimilarity, boost: boolOption(v.VoiceBoost), ssml: literal(v.InputType) == "ssml", schedule: v.TextBufferThresholds, input: inputOf(v.Text), normalization: normalization(v.TextNormalization), dictionaries: liveDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsTextVoice6596490e:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.LiteralValue(), language: v.Language, seed: v.RandomSeed, speed: v.Speed, stability: v.Stability, style: v.StyleExaggeration, similarity: v.VoiceSimilarity, boost: boolOption(v.VoiceBoost), before: v.ContextBefore, after: v.ContextAfter, timed: true, languageNormalization: boolOption(v.LanguageTextNormalization).Value, text: v.Text, normalization: normalization(v.TextNormalization), latency: literal(v.LatencyOptimization), normalized: literal(v.TimestampText) == "normalized", dictionaries: httpDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsStreamingTextVoiceb9af60c3:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.LiteralValue(), language: v.Language, seed: v.RandomSeed, speed: v.Speed, stability: v.Stability, style: v.StyleExaggeration, similarity: v.VoiceSimilarity, boost: boolOption(v.VoiceBoost), ssml: literal(v.InputType) == "ssml", schedule: v.TextBufferThresholds, timed: true, input: inputOf(v.Text), normalization: normalization(v.TextNormalization), normalized: literal(v.TimestampText) == "normalized", dictionaries: liveDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsStreamingTextVoice732994d4:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.LiteralValue(), language: v.Language, seed: v.RandomSeed, speed: v.Speed, stability: v.Stability, style: v.StyleExaggeration, similarity: v.VoiceSimilarity, boost: boolOption(v.VoiceBoost), ssml: literal(v.InputType) == "ssml", input: inputOf(v.Text), normalization: normalization(v.TextNormalization), unbuffered: true, dictionaries: liveDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsStreamingTextVoicebc33fdb4:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.LiteralValue(), language: v.Language, seed: v.RandomSeed, speed: v.Speed, stability: v.Stability, style: v.StyleExaggeration, similarity: v.VoiceSimilarity, boost: boolOption(v.VoiceBoost), ssml: literal(v.InputType) == "ssml", timed: true, input: inputOf(v.Text), normalization: normalization(v.TextNormalization), normalized: literal(v.TimestampText) == "normalized", unbuffered: true, dictionaries: liveDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsMultilingualV2TextVoiceae5db0bf:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.Value(), seed: v.RandomSeed, speed: v.Speed, stability: v.Stability, style: v.StyleExaggeration, similarity: v.VoiceSimilarity, boost: boolOption(v.VoiceBoost), before: v.ContextBefore, after: v.ContextAfter, languageNormalization: boolOption(v.LanguageTextNormalization).Value, text: v.Text, normalization: normalization(v.TextNormalization), latency: literal(v.LatencyOptimization), dictionaries: httpDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsMultilingualV2TextVoice2ee6cad1:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.Value(), seed: v.RandomSeed, speed: v.Speed, stability: v.Stability, style: v.StyleExaggeration, similarity: v.VoiceSimilarity, boost: boolOption(v.VoiceBoost), before: v.ContextBefore, after: v.ContextAfter, languageNormalization: boolOption(v.LanguageTextNormalization).Value, text: v.Text, normalization: "off", latency: v.LatencyOptimization.Value(), dictionaries: httpDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsMultilingualV2TextVoice4ed687d7:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.Value(), seed: v.RandomSeed, speed: v.Speed, stability: v.Stability, style: v.StyleExaggeration, similarity: v.VoiceSimilarity, boost: boolOption(v.VoiceBoost), before: v.ContextBefore, after: v.ContextAfter, timed: true, languageNormalization: boolOption(v.LanguageTextNormalization).Value, text: v.Text, normalization: "off", latency: v.LatencyOptimization.Value(), normalized: literal(v.TimestampText) == "normalized", dictionaries: httpDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsMultilingualV2StreamingTextVoice729ee226:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.Value(), seed: v.RandomSeed, speed: v.Speed, stability: v.Stability, style: v.StyleExaggeration, similarity: v.VoiceSimilarity, boost: boolOption(v.VoiceBoost), ssml: literal(v.InputType) == "ssml", schedule: v.TextBufferThresholds, input: inputOf(v.Text), normalization: normalization(v.TextNormalization), dictionaries: liveDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsMultilingualV2TextVoice11f62a92:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.Value(), seed: v.RandomSeed, speed: v.Speed, stability: v.Stability, style: v.StyleExaggeration, similarity: v.VoiceSimilarity, boost: boolOption(v.VoiceBoost), before: v.ContextBefore, after: v.ContextAfter, timed: true, languageNormalization: boolOption(v.LanguageTextNormalization).Value, text: v.Text, normalization: normalization(v.TextNormalization), latency: literal(v.LatencyOptimization), normalized: literal(v.TimestampText) == "normalized", dictionaries: httpDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsMultilingualV2StreamingTextVoice3f7db298:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.Value(), seed: v.RandomSeed, speed: v.Speed, stability: v.Stability, style: v.StyleExaggeration, similarity: v.VoiceSimilarity, boost: boolOption(v.VoiceBoost), ssml: literal(v.InputType) == "ssml", schedule: v.TextBufferThresholds, timed: true, input: inputOf(v.Text), normalization: normalization(v.TextNormalization), normalized: literal(v.TimestampText) == "normalized", dictionaries: liveDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsMultilingualV2StreamingTextVoiceac3750e0:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.Value(), seed: v.RandomSeed, speed: v.Speed, stability: v.Stability, style: v.StyleExaggeration, similarity: v.VoiceSimilarity, boost: boolOption(v.VoiceBoost), ssml: literal(v.InputType) == "ssml", input: inputOf(v.Text), normalization: normalization(v.TextNormalization), unbuffered: true, dictionaries: liveDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsMultilingualV2StreamingTextVoiceb51c2303:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.Value(), seed: v.RandomSeed, speed: v.Speed, stability: v.Stability, style: v.StyleExaggeration, similarity: v.VoiceSimilarity, boost: boolOption(v.VoiceBoost), ssml: literal(v.InputType) == "ssml", timed: true, input: inputOf(v.Text), normalization: normalization(v.TextNormalization), normalized: literal(v.TimestampText) == "normalized", unbuffered: true, dictionaries: liveDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsElevenV3TextVoicec3eabebc:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.Value(), language: v.Language, seed: v.RandomSeed, stability: v.Stability, before: v.ContextBefore, after: v.ContextAfter, languageNormalization: boolOption(v.LanguageTextNormalization).Value, text: v.Text, normalization: normalization(v.TextNormalization), latency: literal(v.LatencyOptimization), dictionaries: httpDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsElevenV3TextVoicefade944d:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.Value(), language: v.Language, seed: v.RandomSeed, stability: v.Stability, before: v.ContextBefore, after: v.ContextAfter, languageNormalization: boolOption(v.LanguageTextNormalization).Value, text: v.Text, normalization: "off", latency: v.LatencyOptimization.Value(), dictionaries: httpDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsElevenV3TextVoicebb26fac2:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.Value(), language: v.Language, seed: v.RandomSeed, stability: v.Stability, before: v.ContextBefore, after: v.ContextAfter, timed: true, languageNormalization: boolOption(v.LanguageTextNormalization).Value, text: v.Text, normalization: "off", latency: v.LatencyOptimization.Value(), normalized: literal(v.TimestampText) == "normalized", dictionaries: httpDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsElevenV3StreamingTextVoice145c0c5a:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.Value(), language: v.Language, seed: v.RandomSeed, stability: v.Stability, input: inputOf(v.Text), normalization: normalization(v.TextNormalization), dictionaries: liveDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsElevenV3TextVoicede803f4c:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.Value(), language: v.Language, seed: v.RandomSeed, stability: v.Stability, before: v.ContextBefore, after: v.ContextAfter, timed: true, languageNormalization: boolOption(v.LanguageTextNormalization).Value, text: v.Text, normalization: normalization(v.TextNormalization), latency: literal(v.LatencyOptimization), normalized: literal(v.TimestampText) == "normalized", dictionaries: httpDictionaries(v.PronunciationDictionaries)}, nil
	case schema.TtsRequestAsElevenV3StreamingTextVoicec1dc022a:
		v := request.Value
		return configuration{voice: v.Voice, output: v.Output, model: v.Model.Value(), language: v.Language, seed: v.RandomSeed, stability: v.Stability, timed: true, input: inputOf(v.Text), normalization: normalization(v.TextNormalization), dictionaries: liveDictionaries(v.PronunciationDictionaries)}, nil
	default:
		return configuration{}, errors.New("Unsupported generated ElevenLabs request representation")
	}
}
func outputFormat(value any) (string, error) {
	switch v := value.(type) {
	case schema.TtsRequestTextVoice814840b5OutputAsMp31de777c9:
		return outputFormat(v.Value)
	case *schema.TtsRequestTextVoice814840b5OutputAsMp31de777c9:
		return outputFormat(v.Value)
	case schema.TtsRequestTextVoice814840b5OutputAsMp34def27fa:
		return outputFormat(v.Value)
	case *schema.TtsRequestTextVoice814840b5OutputAsMp34def27fa:
		return outputFormat(v.Value)
	case schema.TtsRequestTextVoice814840b5OutputAsMp356cad1fb:
		return outputFormat(v.Value)
	case *schema.TtsRequestTextVoice814840b5OutputAsMp356cad1fb:
		return outputFormat(v.Value)
	case schema.TtsRequestTextVoice814840b5OutputAsOggOpus:
		return outputFormat(v.Value)
	case *schema.TtsRequestTextVoice814840b5OutputAsOggOpus:
		return outputFormat(v.Value)
	case schema.TtsRequestTextVoice814840b5OutputAsPcm:
		return outputFormat(v.Value)
	case *schema.TtsRequestTextVoice814840b5OutputAsPcm:
		return outputFormat(v.Value)
	case schema.TtsRequestTextVoice814840b5OutputAsObject:
		return outputFormat(v.Value)
	case *schema.TtsRequestTextVoice814840b5OutputAsObject:
		return outputFormat(v.Value)
	case schema.TtsRequestTextVoice814840b5OutputAsWav:
		return outputFormat(v.Value)
	case *schema.TtsRequestTextVoice814840b5OutputAsWav:
		return outputFormat(v.Value)
	case schema.TtsRequestStreamingTextVoice5024de38OutputAsMp31de777c9:
		return outputFormat(v.Value)
	case *schema.TtsRequestStreamingTextVoice5024de38OutputAsMp31de777c9:
		return outputFormat(v.Value)
	case schema.TtsRequestStreamingTextVoice5024de38OutputAsMp34def27fa:
		return outputFormat(v.Value)
	case *schema.TtsRequestStreamingTextVoice5024de38OutputAsMp34def27fa:
		return outputFormat(v.Value)
	case schema.TtsRequestStreamingTextVoice5024de38OutputAsMp356cad1fb:
		return outputFormat(v.Value)
	case *schema.TtsRequestStreamingTextVoice5024de38OutputAsMp356cad1fb:
		return outputFormat(v.Value)
	case schema.TtsRequestStreamingTextVoice5024de38OutputAsOggOpus:
		return outputFormat(v.Value)
	case *schema.TtsRequestStreamingTextVoice5024de38OutputAsOggOpus:
		return outputFormat(v.Value)
	case schema.TtsRequestStreamingTextVoice5024de38OutputAsPcm:
		return outputFormat(v.Value)
	case *schema.TtsRequestStreamingTextVoice5024de38OutputAsPcm:
		return outputFormat(v.Value)
	case schema.TtsRequestStreamingTextVoice5024de38OutputAsObject:
		return outputFormat(v.Value)
	case *schema.TtsRequestStreamingTextVoice5024de38OutputAsObject:
		return outputFormat(v.Value)
	case schema.TtsRequestTextVoice814840b5OutputMp31de777c9:
		return "mp3_22050_32", nil
	case schema.TtsRequestTextVoice814840b5OutputMp34def27fa:
		return "mp3_24000_48", nil
	case schema.TtsRequestTextVoice814840b5OutputMp356cad1fb:
		bitrate := 128000.0
		if v.BitRateBps.Present {
			bitrate = v.BitRateBps.Value.LiteralValue()
		}
		return "mp3_44100_" + strconv.FormatFloat(bitrate/1000, 'f', -1, 64), nil
	case schema.TtsRequestTextVoice814840b5OutputOggOpus:
		bitrate := 128000.0
		if v.BitRateBps.Present {
			bitrate = v.BitRateBps.Value.LiteralValue()
		}
		return "opus_48000_" + strconv.FormatFloat(bitrate/1000, 'f', -1, 64), nil
	case schema.TtsRequestTextVoice814840b5OutputPcm:
		rate := v.SampleRateHz.LiteralValue()
		return "pcm_" + strconv.FormatFloat(rate, 'f', -1, 64), nil
	case schema.TtsRequestTextVoice814840b5OutputWav:
		rate := v.SampleRateHz.LiteralValue()
		return "wav_" + strconv.FormatFloat(rate, 'f', -1, 64), nil
	case schema.TtsRequestTextVoice814840b5OutputObject:
		format := v.Format.LiteralValue()
		if format == "mulaw" {
			format = "ulaw"
		}
		return format + "_8000", nil
	default:
		return "", errors.New("Unsupported generated ElevenLabs output representation")
	}
}
func contextFields(value schema.TtsRequestTextVoice814840b5ContextAfter, prefix string, body map[string]any) {
	switch v := value.(type) {
	case *schema.TtsRequestTextVoice814840b5ContextAfterAsText:
		contextFields(*v, prefix, body)
	case *schema.TtsRequestTextVoice814840b5ContextAfterAsObject:
		contextFields(*v, prefix, body)
	case schema.TtsRequestTextVoice814840b5ContextAfterAsText:
		body[prefix+"_text"] = v.Value.Text
	case schema.TtsRequestTextVoice814840b5ContextAfterAsObject:
		body[prefix+"_request_ids"] = append([]string{}, v.Value.RequestIds...)
	}
}
func inputValue(value any) (string, string, error) {
	switch v := value.(type) {
	case schema.TtsRequestStreamingTextVoice5024de38TextItemAsString:
		return v.Value, "", nil
	case *schema.TtsRequestStreamingTextVoice5024de38TextItemAsString:
		return v.Value, "", nil
	case schema.TtsRequestElevenV3StreamingTextVoice145c0c5aTextItemAsString:
		return v.Value, "", nil
	case *schema.TtsRequestElevenV3StreamingTextVoice145c0c5aTextItemAsString:
		return v.Value, "", nil
	case schema.TtsRequestStreamingTextVoice5024de38TextItemAsClear, *schema.TtsRequestStreamingTextVoice5024de38TextItemAsClear:
		return "", "clear", nil
	case schema.TtsRequestStreamingTextVoice5024de38TextItemAsFlush, *schema.TtsRequestStreamingTextVoice5024de38TextItemAsFlush,
		schema.TtsRequestElevenV3StreamingTextVoice145c0c5aTextItemAsFlush, *schema.TtsRequestElevenV3StreamingTextVoice145c0c5aTextItemAsFlush:
		return "", "flush", nil
	default:
		return "", "", errors.New("Unsupported generated ElevenLabs input representation")
	}
}
