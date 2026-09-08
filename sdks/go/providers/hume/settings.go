package hume

import (
	"context"
	"errors"
	"fmt"
	"unicode/utf16"

	schema "github.com/speechswitch/client/sdks/go/generated/hume"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type TextInput = schema.TtsRequestOctave1StreamingTextTextItem
type DirectedTurnInput = schema.TtsRequestOctave1StreamingTurnsTurnsItem
type TurnInput = schema.TtsRequestOctave2StreamingTurnsTurnsItem

type configuration struct {
	body                     map[string]any
	input                    runtime.Input[map[string]any]
	version, format, priorID string
	instant, metadata        bool
	kinds                    []string
	temperature              runtime.Optional[float64]
}
type delivery struct {
	speed, silence float64
	voice          map[string]string
	description    runtime.Optional[string]
	speakers       map[string]map[string]string
}

func optionalValue[T any](value runtime.Optional[T]) any {
	if value.Present {
		return value.Value
	}
	return nil
}

// Generated validation precedes these explicit Go representation conversions.
func settings(request schema.TtsRequest, validate runtime.InputValidator) (configuration, error) {
	var model string
	var output schema.TtsRequestOctave1TextOutput
	var speed, silence, temperature runtime.Optional[float64]
	var latency runtime.Optional[schema.TtsRequestOctave1TurnsLatencyOptimization]
	var split runtime.Optional[schema.TtsRequestOctave1TextSplitTurns]
	var source runtime.Optional[schema.TtsRequestOctave1TurnsSpeakersItemObject9c8ccfabVoiceSource]
	var id, name, description runtime.Optional[string]
	var speakers []schema.TtsRequestOctave1TurnsSpeakersItem
	var timestamps runtime.Optional[schema.TtsRequestOctave2TurnsTimestampGranularity]
	var input, contextValue any
	switch r := request.(type) {
	case *schema.TtsRequestAsOctave1Text:
		return settings(*r, validate)
	case *schema.TtsRequestAsOctave1StreamingText:
		return settings(*r, validate)
	case *schema.TtsRequestAsOctave1Turns:
		return settings(*r, validate)
	case *schema.TtsRequestAsOctave1StreamingTurns:
		return settings(*r, validate)
	case *schema.TtsRequestAsOctave1TextVoice:
		return settings(*r, validate)
	case *schema.TtsRequestAsOctave1StreamingTextVoice:
		return settings(*r, validate)
	case *schema.TtsRequestAsOctave1TextVoiceName:
		return settings(*r, validate)
	case *schema.TtsRequestAsOctave1StreamingTextVoiceName:
		return settings(*r, validate)
	case *schema.TtsRequestAsOctave2Turns:
		return settings(*r, validate)
	case *schema.TtsRequestAsOctave2StreamingTurns:
		return settings(*r, validate)
	case *schema.TtsRequestAsOctave2TextVoice:
		return settings(*r, validate)
	case *schema.TtsRequestAsOctave2StreamingTextVoice:
		return settings(*r, validate)
	case *schema.TtsRequestAsOctave2TextVoiceName:
		return settings(*r, validate)
	case *schema.TtsRequestAsOctave2StreamingTextVoiceName:
		return settings(*r, validate)
	case schema.TtsRequestAsOctave1Text:
		v := r.Value
		model, output, speed, silence, temperature, input = v.Model.Value(), v.Output, v.Speed, v.TrailingSilenceMs, v.Temperature, v.Text
		contextValue, split, description = optionalValue(v.ContextBefore), v.SplitTurns, v.VoiceDescription
	case schema.TtsRequestAsOctave1StreamingText:
		v := r.Value
		model, output, speed, silence, temperature, input = v.Model.Value(), v.Output, v.Speed, v.TrailingSilenceMs, v.Temperature, v.Text
		contextValue, description = optionalValue(v.ContextBefore), v.VoiceDescription
	case schema.TtsRequestAsOctave1Turns:
		v := r.Value
		model, output, speed, silence, temperature, input = v.Model.Value(), v.Output, v.Speed, v.TrailingSilenceMs, v.Temperature, v.Turns
		contextValue, split, latency, speakers = optionalValue(v.ContextBefore), v.SplitTurns, v.LatencyOptimization, v.Speakers
	case schema.TtsRequestAsOctave1StreamingTurns:
		v := r.Value
		model, output, speed, silence, temperature, input = v.Model.Value(), v.Output, v.Speed, v.TrailingSilenceMs, v.Temperature, v.Turns
		contextValue, latency, speakers = optionalValue(v.ContextBefore), v.LatencyOptimization, v.Speakers
	case schema.TtsRequestAsOctave1TextVoice:
		v := r.Value
		model, output, speed, silence, temperature, input = v.Model.Value(), v.Output, v.Speed, v.TrailingSilenceMs, v.Temperature, v.Text
		contextValue, split, latency, id, source, description = optionalValue(v.ContextBefore), v.SplitTurns, v.LatencyOptimization, runtime.Some(v.Voice), v.VoiceSource, v.Instructions
	case schema.TtsRequestAsOctave1StreamingTextVoice:
		v := r.Value
		model, output, speed, silence, temperature, input = v.Model.Value(), v.Output, v.Speed, v.TrailingSilenceMs, v.Temperature, v.Text
		contextValue, latency, id, source, description = optionalValue(v.ContextBefore), v.LatencyOptimization, runtime.Some(v.Voice), v.VoiceSource, v.Instructions
	case schema.TtsRequestAsOctave1TextVoiceName:
		v := r.Value
		model, output, speed, silence, temperature, input = v.Model.Value(), v.Output, v.Speed, v.TrailingSilenceMs, v.Temperature, v.Text
		contextValue, split, latency, name, source, description = optionalValue(v.ContextBefore), v.SplitTurns, v.LatencyOptimization, runtime.Some(v.VoiceName), v.VoiceSource, v.Instructions
	case schema.TtsRequestAsOctave1StreamingTextVoiceName:
		v := r.Value
		model, output, speed, silence, temperature, input = v.Model.Value(), v.Output, v.Speed, v.TrailingSilenceMs, v.Temperature, v.Text
		contextValue, latency, name, source, description = optionalValue(v.ContextBefore), v.LatencyOptimization, runtime.Some(v.VoiceName), v.VoiceSource, v.Instructions
	case schema.TtsRequestAsOctave2Turns:
		v := r.Value
		model, output, speed, silence, temperature, input = v.Model.Value(), v.Output, v.Speed, v.TrailingSilenceMs, v.Temperature, v.Turns
		contextValue, split, latency, speakers, timestamps = optionalValue(v.ContextBefore), v.SplitTurns, v.LatencyOptimization, v.Speakers, v.TimestampGranularity
	case schema.TtsRequestAsOctave2StreamingTurns:
		v := r.Value
		model, output, speed, silence, temperature, input = v.Model.Value(), v.Output, v.Speed, v.TrailingSilenceMs, v.Temperature, v.Turns
		contextValue, latency, speakers, timestamps = optionalValue(v.ContextBefore), v.LatencyOptimization, v.Speakers, v.TimestampGranularity
	case schema.TtsRequestAsOctave2TextVoice:
		v := r.Value
		model, output, speed, silence, temperature, input = v.Model.Value(), v.Output, v.Speed, v.TrailingSilenceMs, v.Temperature, v.Text
		contextValue, split, latency, id, source, timestamps = optionalValue(v.ContextBefore), v.SplitTurns, v.LatencyOptimization, runtime.Some(v.Voice), v.VoiceSource, v.TimestampGranularity
	case schema.TtsRequestAsOctave2StreamingTextVoice:
		v := r.Value
		model, output, speed, silence, temperature, input = v.Model.Value(), v.Output, v.Speed, v.TrailingSilenceMs, v.Temperature, v.Text
		contextValue, latency, id, source, timestamps = optionalValue(v.ContextBefore), v.LatencyOptimization, runtime.Some(v.Voice), v.VoiceSource, v.TimestampGranularity
	case schema.TtsRequestAsOctave2TextVoiceName:
		v := r.Value
		model, output, speed, silence, temperature, input = v.Model.Value(), v.Output, v.Speed, v.TrailingSilenceMs, v.Temperature, v.Text
		contextValue, split, latency, name, source, timestamps = optionalValue(v.ContextBefore), v.SplitTurns, v.LatencyOptimization, runtime.Some(v.VoiceName), v.VoiceSource, v.TimestampGranularity
	case schema.TtsRequestAsOctave2StreamingTextVoiceName:
		v := r.Value
		model, output, speed, silence, temperature, input = v.Model.Value(), v.Output, v.Speed, v.TrailingSilenceMs, v.Temperature, v.Text
		contextValue, latency, name, source, timestamps = optionalValue(v.ContextBefore), v.LatencyOptimization, runtime.Some(v.VoiceName), v.VoiceSource, v.TimestampGranularity
	}
	c := configuration{version: "1", format: output.Format.LiteralValue(), metadata: timestamps.Present, kinds: []string{}, temperature: temperature}
	if model == "octave-2" {
		c.version = "2"
	}
	d := &delivery{speed: 1, silence: 0, description: description, speakers: map[string]map[string]string{}}
	if speed.Present {
		d.speed = speed.Value
	}
	if silence.Present {
		d.silence = silence.Value / 1000
	}
	if id.Present {
		d.voice = voice("id", id.Value, source)
	} else if name.Present {
		d.voice = voice("name", name.Value, source)
	}
	for _, speaker := range speakers {
		switch v := speaker.(type) {
		case *schema.TtsRequestOctave1TurnsSpeakersItemAsObject9c8ccfab:
			speaker = *v
		case *schema.TtsRequestOctave1TurnsSpeakersItemAsObjected4f427b:
			speaker = *v
		}
		var alias string
		var selected map[string]string
		switch v := speaker.(type) {
		case schema.TtsRequestOctave1TurnsSpeakersItemAsObject9c8ccfab:
			alias = v.Value.Alias
			selected = voice("id", v.Value.Voice, v.Value.VoiceSource)
		case schema.TtsRequestOctave1TurnsSpeakersItemAsObjected4f427b:
			alias = v.Value.Alias
			selected = voice("name", v.Value.VoiceName, v.Value.VoiceSource)
		}
		if _, present := d.speakers[alias]; present {
			return c, errors.New("Hume speaker aliases must be unique")
		}
		d.speakers[alias] = selected
	}
	c.instant = (d.voice != nil || len(speakers) > 0) && !(latency.Present && latency.Value.LiteralValue() == "none")
	if timestamps.Present {
		value := timestamps.Value
		switch v := value.(type) {
		case *schema.TtsRequestOctave2TurnsTimestampGranularityAsPhoneme:
			value = *v
		case *schema.TtsRequestOctave2TurnsTimestampGranularityAsWord:
			value = *v
		case *schema.TtsRequestOctave2TurnsTimestampGranularityAsArray:
			value = *v
		}
		switch v := value.(type) {
		case schema.TtsRequestOctave2TurnsTimestampGranularityAsPhoneme:
			c.kinds = []string{"phoneme"}
		case schema.TtsRequestOctave2TurnsTimestampGranularityAsWord:
			c.kinds = []string{"word"}
		case schema.TtsRequestOctave2TurnsTimestampGranularityAsArray:
			for _, kind := range v.Value {
				c.kinds = append(c.kinds, kind.LiteralValue())
			}
		}
	}
	c.body = map[string]any{"version": c.version, "format": map[string]any{"type": c.format}, "include_timestamp_types": c.kinds, "num_generations": 1, "split_utterances": true, "strip_headers": true, "instant_mode": c.instant}
	if split.Present {
		c.body["split_utterances"] = split.Value.LiteralValue()
	}
	if temperature.Present {
		c.body["temperature"] = temperature.Value
	}
	switch v := input.(type) {
	case runtime.Input[TextInput]:
		c.input = &mappedInput[TextInput]{source: v, validate: validate, field: "text", convert: d.textMessage}
	case runtime.Input[DirectedTurnInput]:
		c.input = &mappedInput[DirectedTurnInput]{source: v, validate: validate, field: "turns", convert: d.directedMessage}
	case runtime.Input[TurnInput]:
		c.input = &mappedInput[TurnInput]{source: v, validate: validate, field: "turns", convert: d.turnMessage}
	default:
		utterances, err := d.utterances(input)
		if err != nil {
			return c, err
		}
		c.body["utterances"] = utterances
	}
	contextValue = unwrapContext(contextValue)
	if prior, ok := contextValue.(schema.TtsRequestOctave1TextContextBeforeObject); ok {
		if prior.RequestIds[0] == "" {
			return c, errors.New("Hume continuation requires a non-empty generation ID")
		}
		c.priorID = prior.RequestIds[0]
		c.body["context"] = map[string]any{"generation_id": c.priorID}
	} else if contextValue != nil {
		utterances, err := d.utterances(contextValue)
		if err != nil {
			return c, err
		}
		c.body["context"] = map[string]any{"utterances": utterances}
	}
	return c, nil
}

func voice(key, value string, source runtime.Optional[schema.TtsRequestOctave1TurnsSpeakersItemObject9c8ccfabVoiceSource]) map[string]string {
	provider := "CUSTOM_VOICE"
	if source.Present && source.Value.LiteralValue() == "catalog" {
		provider = "HUME_AI"
	}
	return map[string]string{key: value, "provider": provider}
}
func unwrapContext(value any) any {
	switch v := value.(type) {
	case *schema.TtsRequestOctave1TextContextBeforeAsObject:
		return v.Value
	case schema.TtsRequestOctave1TextContextBeforeAsObject:
		return v.Value
	case *schema.TtsRequestOctave1TextContextBeforeAsText:
		return v.Value.Text
	case schema.TtsRequestOctave1TextContextBeforeAsText:
		return v.Value.Text
	case *schema.TtsRequestOctave1TurnsContextBeforeAsObject:
		return v.Value
	case schema.TtsRequestOctave1TurnsContextBeforeAsObject:
		return v.Value
	case *schema.TtsRequestOctave1TurnsContextBeforeAsTurns:
		return v.Value.Turns
	case schema.TtsRequestOctave1TurnsContextBeforeAsTurns:
		return v.Value.Turns
	case *schema.TtsRequestOctave2TurnsContextBeforeAsObject:
		return v.Value
	case schema.TtsRequestOctave2TurnsContextBeforeAsObject:
		return v.Value
	case *schema.TtsRequestOctave2TurnsContextBeforeAsTurns:
		return v.Value.Turns
	case schema.TtsRequestOctave2TurnsContextBeforeAsTurns:
		return v.Value.Turns
	}
	return value
}
func (d *delivery) utterance(text string, voice map[string]string, description runtime.Optional[string], speed, silence runtime.Optional[float64]) map[string]any {
	rate, pause := d.speed, d.silence
	if speed.Present {
		rate = speed.Value
	}
	if silence.Present {
		pause = silence.Value / 1000
	}
	result := map[string]any{"text": text, "speed": rate, "trailing_silence": pause}
	if voice != nil {
		result["voice"] = voice
	}
	if description.Present {
		result["description"] = description.Value
	}
	return result
}
func (d *delivery) directed(v schema.TtsRequestOctave1TurnsContextBeforeTurnsTurnsItem) (map[string]any, error) {
	voice, ok := d.speakers[v.Speaker]
	if !ok {
		return nil, fmt.Errorf("Unknown Hume speaker: %s", v.Speaker)
	}
	return d.utterance(v.Text, voice, v.Instructions, v.Speed, v.TrailingSilenceMs), nil
}
func (d *delivery) turn(v schema.TtsRequestOctave2TurnsContextBeforeTurnsTurnsItem) (map[string]any, error) {
	voice, ok := d.speakers[v.Speaker]
	if !ok {
		return nil, fmt.Errorf("Unknown Hume speaker: %s", v.Speaker)
	}
	return d.utterance(v.Text, voice, runtime.Optional[string]{}, v.Speed, v.TrailingSilenceMs), nil
}
func (d *delivery) utterances(value any) ([]map[string]any, error) {
	result := []map[string]any{}
	switch v := value.(type) {
	case string:
		result = append(result, d.utterance(v, d.voice, d.description, runtime.Optional[float64]{}, runtime.Optional[float64]{}))
	case []schema.TtsRequestOctave1TurnsContextBeforeTurnsTurnsItem:
		for _, v := range v {
			item, err := d.directed(v)
			if err != nil {
				return nil, err
			}
			result = append(result, item)
		}
	case []schema.TtsRequestOctave2TurnsContextBeforeTurnsTurnsItem:
		for _, v := range v {
			item, err := d.turn(v)
			if err != nil {
				return nil, err
			}
			result = append(result, item)
		}
	default:
		return nil, errors.New("Unsupported Hume input representation")
	}
	return result, nil
}

type mappedInput[T any] struct {
	source   runtime.Input[T]
	validate runtime.InputValidator
	field    string
	convert  func(T) (map[string]any, error)
}

func (m *mappedInput[T]) Next(ctx context.Context) (map[string]any, error) {
	value, err := m.source.Next(ctx)
	if err != nil {
		return nil, err
	}
	if err = m.validate(value, m.field); err != nil {
		return nil, err
	}
	return m.convert(value)
}
func (m *mappedInput[T]) Close() error { return m.source.Close() }
func (d *delivery) textMessage(value TextInput) (map[string]any, error) {
	switch v := value.(type) {
	case *schema.TtsRequestOctave1StreamingTextTextItemAsString:
		value = *v
	case *schema.TtsRequestOctave1StreamingTextTextItemAsFlush:
		value = *v
	}
	if v, ok := value.(schema.TtsRequestOctave1StreamingTextTextItemAsString); ok {
		// Bare async strings cannot yet carry schema annotations; match TS UTF-16 length.
		length := 0
		for _, r := range v.Value {
			length += utf16.RuneLen(r)
		}
		if length > 5000 {
			return nil, errors.New("Hume text must not exceed 5000 characters per utterance")
		}
		return d.utterance(v.Value, d.voice, d.description, runtime.Optional[float64]{}, runtime.Optional[float64]{}), nil
	}
	return map[string]any{"flush": true}, nil
}
func (d *delivery) directedMessage(value DirectedTurnInput) (map[string]any, error) {
	switch v := value.(type) {
	case *schema.TtsRequestOctave1StreamingTurnsTurnsItemAsText:
		value = *v
	case *schema.TtsRequestOctave1StreamingTurnsTurnsItemAsFlush:
		value = *v
	}
	if v, ok := value.(schema.TtsRequestOctave1StreamingTurnsTurnsItemAsText); ok {
		return d.directed(v.Value)
	}
	return map[string]any{"flush": true}, nil
}
func (d *delivery) turnMessage(value TurnInput) (map[string]any, error) {
	switch v := value.(type) {
	case *schema.TtsRequestOctave2StreamingTurnsTurnsItemAsText:
		value = *v
	case *schema.TtsRequestOctave2StreamingTurnsTurnsItemAsFlush:
		value = *v
	}
	if v, ok := value.(schema.TtsRequestOctave2StreamingTurnsTurnsItemAsText); ok {
		return d.turn(v.Value)
	}
	return map[string]any{"flush": true}, nil
}
