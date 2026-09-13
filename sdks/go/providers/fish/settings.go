package fish

import (
	"errors"
	"strconv"

	schema "github.com/speechswitch/client/sdks/go/generated/fish"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type Input = schema.TtsRequestS1StreamingTextTextItem
type parameters struct {
	ConditionOnPreviousChunks runtime.Optional[schema.TtsRequestS1TextConditionOnPreviousChunks]
	TextNormalization         runtime.Optional[schema.TtsRequestS1TextConditionOnPreviousChunks]
	LoudnessNormalization     runtime.Optional[schema.TtsRequestS1TextConditionOnPreviousChunks]
	EarlyStopThreshold        runtime.Optional[float64]
	MaxAudioTokens            runtime.Optional[float64]
	MinTextChunkLength        runtime.Optional[float64]
	RepetitionPenalty         runtime.Optional[float64]
	Speed                     runtime.Optional[float64]
	Temperature               runtime.Optional[float64]
	TextChunkLength           runtime.Optional[float64]
	TopP                      runtime.Optional[float64]
	VolumeDb                  runtime.Optional[float64]
	Features                  runtime.Optional[[]string]
	LatencyOptimization       runtime.Optional[schema.TtsRequestS1TextLatencyOptimization]
}
type configuration struct {
	model, text string
	voice       runtime.Optional[string]
	references  []schema.TtsRequestS1TextReferenceSamplesItem
	speakers    schema.TtsRequestTextfd2d056aSpeakers
	input       runtime.Input[Input]
	output      schema.TtsRequestS1TextOutput
	timed       bool
	parameters
}

func choose[T any](value runtime.Optional[T], fallback T) T {
	if value.Present {
		return value.Value
	}
	return fallback
}
func boolean(value runtime.Optional[schema.TtsRequestS1TextConditionOnPreviousChunks], fallback bool) bool {
	if value.Present {
		return value.Value.LiteralValue()
	}
	return fallback
}

// Generated validation precedes these explicit representation conversions.
func settings(request schema.TtsRequest) (configuration, error) {
	switch r := request.(type) {
	case *schema.TtsRequestAsS1Text:
		return settings(*r)
	case *schema.TtsRequestAsS1StreamingText:
		return settings(*r)
	case *schema.TtsRequestAsS1TextVoice:
		return settings(*r)
	case *schema.TtsRequestAsS1StreamingTextVoice:
		return settings(*r)
	case *schema.TtsRequestAsTextfd2d056a:
		return settings(*r)
	case *schema.TtsRequestAsStreamingTexta6bb52c3:
		return settings(*r)
	case *schema.TtsRequestAsText698033d1:
		return settings(*r)
	case *schema.TtsRequestAsStreamingText327a2fba:
		return settings(*r)
	case *schema.TtsRequestAsTextVoice:
		return settings(*r)
	case *schema.TtsRequestAsStreamingTextVoice:
		return settings(*r)
	case schema.TtsRequestAsS1Text:
		v := r.Value
		return configuration{
			model:      v.Model.Value(),
			output:     v.Output,
			text:       v.Text,
			timed:      v.TimestampGranularity.Present,
			voice:      v.Voice,
			references: v.ReferenceSamples,
			parameters: parameters{
				ConditionOnPreviousChunks: v.ConditionOnPreviousChunks,
				EarlyStopThreshold:        v.EarlyStopThreshold,
				Features:                  v.Features,
				LatencyOptimization:       v.LatencyOptimization,
				MaxAudioTokens:            v.MaxAudioTokens,
				MinTextChunkLength:        v.MinTextChunkLength,
				RepetitionPenalty:         v.RepetitionPenalty,
				Speed:                     v.Speed,
				Temperature:               v.Temperature,
				TextChunkLength:           v.TextChunkLength,
				TextNormalization:         v.TextNormalization,
				TopP:                      v.TopP,
				VolumeDb:                  v.VolumeDb,
			},
		}, nil
	case schema.TtsRequestAsS1StreamingText:
		v := r.Value
		return configuration{
			model:      v.Model.Value(),
			output:     v.Output,
			input:      v.Text,
			voice:      v.Voice,
			references: v.ReferenceSamples,
			parameters: parameters{
				ConditionOnPreviousChunks: v.ConditionOnPreviousChunks,
				EarlyStopThreshold:        v.EarlyStopThreshold,
				Features:                  v.Features,
				LatencyOptimization:       v.LatencyOptimization,
				MaxAudioTokens:            v.MaxAudioTokens,
				MinTextChunkLength:        v.MinTextChunkLength,
				RepetitionPenalty:         v.RepetitionPenalty,
				Speed:                     v.Speed,
				Temperature:               v.Temperature,
				TextChunkLength:           v.TextChunkLength,
				TextNormalization:         v.TextNormalization,
				TopP:                      v.TopP,
				VolumeDb:                  v.VolumeDb,
			},
		}, nil
	case schema.TtsRequestAsS1TextVoice:
		v := r.Value
		return configuration{
			model:      v.Model.Value(),
			output:     v.Output,
			text:       v.Text,
			timed:      v.TimestampGranularity.Present,
			voice:      runtime.Some(v.Voice),
			references: choose(v.ReferenceSamples, []schema.TtsRequestS1TextReferenceSamplesItem(nil)),
			parameters: parameters{
				ConditionOnPreviousChunks: v.ConditionOnPreviousChunks,
				EarlyStopThreshold:        v.EarlyStopThreshold,
				Features:                  v.Features,
				LatencyOptimization:       v.LatencyOptimization,
				MaxAudioTokens:            v.MaxAudioTokens,
				MinTextChunkLength:        v.MinTextChunkLength,
				RepetitionPenalty:         v.RepetitionPenalty,
				Speed:                     v.Speed,
				Temperature:               v.Temperature,
				TextChunkLength:           v.TextChunkLength,
				TextNormalization:         v.TextNormalization,
				TopP:                      v.TopP,
				VolumeDb:                  v.VolumeDb,
			},
		}, nil
	case schema.TtsRequestAsS1StreamingTextVoice:
		v := r.Value
		return configuration{
			model:      v.Model.Value(),
			output:     v.Output,
			input:      v.Text,
			voice:      runtime.Some(v.Voice),
			references: choose(v.ReferenceSamples, []schema.TtsRequestS1TextReferenceSamplesItem(nil)),
			parameters: parameters{
				ConditionOnPreviousChunks: v.ConditionOnPreviousChunks,
				EarlyStopThreshold:        v.EarlyStopThreshold,
				Features:                  v.Features,
				LatencyOptimization:       v.LatencyOptimization,
				MaxAudioTokens:            v.MaxAudioTokens,
				MinTextChunkLength:        v.MinTextChunkLength,
				RepetitionPenalty:         v.RepetitionPenalty,
				Speed:                     v.Speed,
				Temperature:               v.Temperature,
				TextChunkLength:           v.TextChunkLength,
				TextNormalization:         v.TextNormalization,
				TopP:                      v.TopP,
				VolumeDb:                  v.VolumeDb,
			},
		}, nil
	case schema.TtsRequestAsTextfd2d056a:
		v := r.Value
		return configuration{
			model:    v.Model.LiteralValue(),
			output:   v.Output,
			text:     v.Text,
			timed:    v.TimestampGranularity.Present,
			speakers: v.Speakers,
			parameters: parameters{
				ConditionOnPreviousChunks: v.ConditionOnPreviousChunks,
				EarlyStopThreshold:        v.EarlyStopThreshold,
				Features:                  v.Features,
				LatencyOptimization:       v.LatencyOptimization,
				MaxAudioTokens:            v.MaxAudioTokens,
				MinTextChunkLength:        v.MinTextChunkLength,
				RepetitionPenalty:         v.RepetitionPenalty,
				Speed:                     v.Speed,
				Temperature:               v.Temperature,
				TextChunkLength:           v.TextChunkLength,
				TextNormalization:         v.TextNormalization,
				TopP:                      v.TopP,
				VolumeDb:                  v.VolumeDb,
				LoudnessNormalization:     v.LoudnessNormalization,
			},
		}, nil
	case schema.TtsRequestAsStreamingTexta6bb52c3:
		v := r.Value
		return configuration{
			model:    v.Model.LiteralValue(),
			output:   v.Output,
			input:    v.Text,
			speakers: v.Speakers,
			parameters: parameters{
				ConditionOnPreviousChunks: v.ConditionOnPreviousChunks,
				EarlyStopThreshold:        v.EarlyStopThreshold,
				Features:                  v.Features,
				LatencyOptimization:       v.LatencyOptimization,
				MaxAudioTokens:            v.MaxAudioTokens,
				MinTextChunkLength:        v.MinTextChunkLength,
				RepetitionPenalty:         v.RepetitionPenalty,
				Speed:                     v.Speed,
				Temperature:               v.Temperature,
				TextChunkLength:           v.TextChunkLength,
				TextNormalization:         v.TextNormalization,
				TopP:                      v.TopP,
				VolumeDb:                  v.VolumeDb,
				LoudnessNormalization:     v.LoudnessNormalization,
			},
		}, nil
	case schema.TtsRequestAsText698033d1:
		v := r.Value
		return configuration{
			model:      v.Model.LiteralValue(),
			output:     v.Output,
			text:       v.Text,
			timed:      v.TimestampGranularity.Present,
			voice:      v.Voice,
			references: v.ReferenceSamples,
			parameters: parameters{
				ConditionOnPreviousChunks: v.ConditionOnPreviousChunks,
				EarlyStopThreshold:        v.EarlyStopThreshold,
				Features:                  v.Features,
				LatencyOptimization:       v.LatencyOptimization,
				MaxAudioTokens:            v.MaxAudioTokens,
				MinTextChunkLength:        v.MinTextChunkLength,
				RepetitionPenalty:         v.RepetitionPenalty,
				Speed:                     v.Speed,
				Temperature:               v.Temperature,
				TextChunkLength:           v.TextChunkLength,
				TextNormalization:         v.TextNormalization,
				TopP:                      v.TopP,
				VolumeDb:                  v.VolumeDb,
				LoudnessNormalization:     v.LoudnessNormalization,
			},
		}, nil
	case schema.TtsRequestAsStreamingText327a2fba:
		v := r.Value
		return configuration{
			model:      v.Model.LiteralValue(),
			output:     v.Output,
			input:      v.Text,
			voice:      v.Voice,
			references: v.ReferenceSamples,
			parameters: parameters{
				ConditionOnPreviousChunks: v.ConditionOnPreviousChunks,
				EarlyStopThreshold:        v.EarlyStopThreshold,
				Features:                  v.Features,
				LatencyOptimization:       v.LatencyOptimization,
				MaxAudioTokens:            v.MaxAudioTokens,
				MinTextChunkLength:        v.MinTextChunkLength,
				RepetitionPenalty:         v.RepetitionPenalty,
				Speed:                     v.Speed,
				Temperature:               v.Temperature,
				TextChunkLength:           v.TextChunkLength,
				TextNormalization:         v.TextNormalization,
				TopP:                      v.TopP,
				VolumeDb:                  v.VolumeDb,
				LoudnessNormalization:     v.LoudnessNormalization,
			},
		}, nil
	case schema.TtsRequestAsTextVoice:
		v := r.Value
		return configuration{
			model:      v.Model.LiteralValue(),
			output:     v.Output,
			text:       v.Text,
			timed:      v.TimestampGranularity.Present,
			voice:      runtime.Some(v.Voice),
			references: choose(v.ReferenceSamples, []schema.TtsRequestS1TextReferenceSamplesItem(nil)),
			parameters: parameters{
				ConditionOnPreviousChunks: v.ConditionOnPreviousChunks,
				EarlyStopThreshold:        v.EarlyStopThreshold,
				Features:                  v.Features,
				LatencyOptimization:       v.LatencyOptimization,
				MaxAudioTokens:            v.MaxAudioTokens,
				MinTextChunkLength:        v.MinTextChunkLength,
				RepetitionPenalty:         v.RepetitionPenalty,
				Speed:                     v.Speed,
				Temperature:               v.Temperature,
				TextChunkLength:           v.TextChunkLength,
				TextNormalization:         v.TextNormalization,
				TopP:                      v.TopP,
				VolumeDb:                  v.VolumeDb,
				LoudnessNormalization:     v.LoudnessNormalization,
			},
		}, nil
	case schema.TtsRequestAsStreamingTextVoice:
		v := r.Value
		return configuration{
			model:      v.Model.LiteralValue(),
			output:     v.Output,
			input:      v.Text,
			voice:      runtime.Some(v.Voice),
			references: choose(v.ReferenceSamples, []schema.TtsRequestS1TextReferenceSamplesItem(nil)),
			parameters: parameters{
				ConditionOnPreviousChunks: v.ConditionOnPreviousChunks,
				EarlyStopThreshold:        v.EarlyStopThreshold,
				Features:                  v.Features,
				LatencyOptimization:       v.LatencyOptimization,
				MaxAudioTokens:            v.MaxAudioTokens,
				MinTextChunkLength:        v.MinTextChunkLength,
				RepetitionPenalty:         v.RepetitionPenalty,
				Speed:                     v.Speed,
				Temperature:               v.Temperature,
				TextChunkLength:           v.TextChunkLength,
				TextNormalization:         v.TextNormalization,
				TopP:                      v.TopP,
				VolumeDb:                  v.VolumeDb,
				LoudnessNormalization:     v.LoudnessNormalization,
			},
		}, nil
	default:
		return configuration{}, errors.New("Invalid Fish request representation")
	}
}
func references(samples []schema.TtsRequestS1TextReferenceSamplesItem) ([]any, error) {
	result := make([]any, 0, len(samples))
	for _, sample := range samples {
		// Byte-buffer bounds are not represented by the schema annotations.
		if len(sample.Audio) == 0 {
			return nil, errors.New("Fish reference audio must not be empty")
		}
		result = append(result, map[string]any{"audio": append([]byte{}, sample.Audio...), "text": sample.Text})
	}
	return result, nil
}
func speakerFields(value schema.TtsRequestTextfd2d056aSpeakers) ([]any, any, error) {
	switch v := value.(type) {
	case *schema.TtsRequestTextfd2d056aSpeakersAsArraybc859dfb:
		return speakerFields(*v)
	case *schema.TtsRequestTextfd2d056aSpeakersAsArray66345558:
		return speakerFields(*v)
	case schema.TtsRequestTextfd2d056aSpeakersAsArraybc859dfb:
		ids := make([]any, 0, len(v.Value))
		for _, speaker := range v.Value {
			ids = append(ids, speaker.Voice)
		}
		return ids, nil, nil
	case schema.TtsRequestTextfd2d056aSpeakersAsArray66345558:
		ids, groups := make([]any, 0, len(v.Value)), make([]any, 0, len(v.Value))
		for index, speaker := range v.Value {
			group, err := references(speaker.ReferenceSamples)
			if err != nil {
				return nil, nil, err
			}
			ids = append(ids, strconv.Itoa(index))
			groups = append(groups, group)
		}
		return ids, groups, nil
	default:
		return nil, nil, errors.New("Invalid Fish speaker representation")
	}
}
func outputFields(output schema.TtsRequestS1TextOutput) (string, float64, float64, float64, error) {
	switch v := output.(type) {
	case *schema.TtsRequestS1TextOutputAsMp3:
		return outputFields(*v)
	case *schema.TtsRequestS1TextOutputAsOggOpus:
		return outputFields(*v)
	case *schema.TtsRequestS1TextOutputAsObject:
		return outputFields(*v)
	case schema.TtsRequestS1TextOutputAsMp3:
		bitrate := float64(128)
		if v.Value.BitRateBps.Present {
			bitrate = v.Value.BitRateBps.Value.LiteralValue() / 1000
		}
		return "mp3", choose(v.Value.SampleRateHz, 44100), bitrate, -1000, nil
	case schema.TtsRequestS1TextOutputAsOggOpus:
		bitrate := float64(-1000)
		if v.Value.BitRateBps.Present {
			bitrate = v.Value.BitRateBps.Value.LiteralValue()
		}
		return "opus", choose(v.Value.SampleRateHz, 48000), 128, bitrate, nil
	case schema.TtsRequestS1TextOutputAsObject:
		return v.Value.Format.LiteralValue(), choose(v.Value.SampleRateHz, 44100), 128, -1000, nil
	default:
		return "", 0, 0, 0, errors.New("Invalid Fish output representation")
	}
}
func wireSettings(c configuration) (map[string]any, error) {
	format, rate, mp3, opus, err := outputFields(c.output)
	if err != nil {
		return nil, err
	}
	var ids, refs any
	if c.speakers != nil {
		ids, refs, err = speakerFields(c.speakers)
	} else {
		if c.voice.Present {
			ids = c.voice.Value
		}
		if c.references != nil {
			refs, err = references(c.references)
		}
	}
	if err != nil {
		return nil, err
	}
	latency := "normal"
	if c.LatencyOptimization.Present {
		latency = map[string]string{"none": "normal", "moderate": "balanced", "aggressive": "low"}[c.LatencyOptimization.Value.LiteralValue()]
	}
	features := []any{}
	if c.Features.Present {
		for _, feature := range c.Features.Value {
			features = append(features, feature)
		}
	}
	return map[string]any{
		"text": c.text, "reference_id": ids, "references": refs, "format": format, "sample_rate": rate, "mp3_bitrate": mp3, "opus_bitrate": opus,
		"prosody":     map[string]any{"speed": choose(c.Speed, 1), "volume": choose(c.VolumeDb, 0), "normalize_loudness": boolean(c.LoudnessNormalization, true)},
		"temperature": choose(c.Temperature, 0.7), "top_p": choose(c.TopP, 0.7), "chunk_length": choose(c.TextChunkLength, 300),
		"min_chunk_length": choose(c.MinTextChunkLength, 50), "max_new_tokens": choose(c.MaxAudioTokens, 1024), "repetition_penalty": choose(c.RepetitionPenalty, 1.2),
		"condition_on_previous_chunks": boolean(c.ConditionOnPreviousChunks, true), "early_stop_threshold": choose(c.EarlyStopThreshold, 1),
		"normalize": boolean(c.TextNormalization, true), "latency": latency, "features": features,
	}, nil
}
