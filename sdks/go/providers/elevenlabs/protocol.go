package elevenlabs

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"

	out "github.com/speechswitch/client/sdks/go/generated/elevenlabs_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type Error struct {
	StatusCode           float64
	ErrorCode, RequestID runtime.Optional[string]
	message              string
}

func (e *Error) Error() string {
	return fmt.Sprintf("ElevenLabs %s: %s", strconv.FormatFloat(e.StatusCode, 'f', -1, 64), e.message)
}
func responseError(value any, status float64) *Error {
	result := &Error{StatusCode: status}
	encoded, _ := json.Marshal(value)
	result.message = string(encoded)
	if text, ok := value.(string); ok {
		result.message = text
	}
	if root, ok := value.(map[string]any); ok {
		fields := root
		if detail, ok := root["detail"].(map[string]any); ok {
			fields = detail
		}
		if message, ok := fields["message"].(string); ok {
			result.message = message
		} else if detail, ok := root["detail"].(string); ok {
			result.message = detail
		}
		if code, ok := fields["status"].(string); ok {
			result.ErrorCode = runtime.Some(code)
		} else if code, ok := root["error"].(string); ok {
			result.ErrorCode = runtime.Some(code)
		}
	}
	return result
}
func load(data []byte) (any, error) {
	if !runtime.ValidUTF8JSON(data) {
		return nil, errors.New("ElevenLabs returned invalid JSON")
	}
	var value any
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil {
		return nil, errors.New("ElevenLabs returned invalid JSON")
	}
	return value, nil
}
func number(value any) (float64, bool) {
	raw, ok := value.(json.Number)
	if !ok {
		return 0, false
	}
	n, err := strconv.ParseFloat(string(raw), 64)
	return n, err == nil && !math.IsNaN(n) && !math.IsInf(n, 0)
}
func audio(value string) ([]byte, error) {
	// StdEncoding otherwise silently accepts CR/LF inside an audio value.
	if strings.ContainsAny(value, "\r\n") {
		return nil, errors.New("ElevenLabs returned invalid base64 audio")
	}
	data, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return nil, errors.New("ElevenLabs returned invalid base64 audio")
	}
	return data, nil
}
func timestamps(value any, protocol string) ([]out.CharacterTimestamp, error) {
	result := []out.CharacterTimestamp{}
	if value == nil {
		return result, nil
	}
	fields, ok := value.(map[string]any)
	if !ok {
		return nil, errors.New("Invalid ElevenLabs alignment")
	}
	charsKey, startsKey, durationsKey := "chars", "charStartTimesMs", "charDurationsMs"
	if protocol == "http" {
		charsKey, startsKey, durationsKey = "characters", "character_start_times_seconds", "character_end_times_seconds"
	} else if protocol == "dialogue" {
		startsKey, durationsKey = "char_start_times_ms", "char_durations_ms"
	}
	chars, cok := fields[charsKey].([]any)
	starts, sok := fields[startsKey].([]any)
	durations, dok := fields[durationsKey].([]any)
	if !cok || !sok || !dok || len(chars) != len(starts) || len(chars) != len(durations) {
		return nil, errors.New("ElevenLabs returned incomplete or mismatched alignment arrays")
	}
	for index, char := range chars {
		text, ok := char.(string)
		start, sok := number(starts[index])
		duration, dok := number(durations[index])
		if !ok || !sok || !dok || start < 0 || duration < 0 || (protocol == "http" && duration < start) {
			return nil, errors.New("ElevenLabs returned invalid character timing")
		}
		startMs, endMs := start, start+duration
		if protocol == "http" {
			startMs, endMs = start*1000, duration*1000
		}
		if math.IsInf(startMs, 0) || math.IsInf(endMs, 0) {
			return nil, errors.New("ElevenLabs returned invalid character timing")
		}
		result = append(result, out.CharacterTimestamp{Value: text, StartTimeMs: startMs, EndTimeMs: endMs})
	}
	return result, nil
}
func timestamped(value any, normalized bool) (out.SynthesisItem, error) {
	fields, ok := value.(map[string]any)
	if !ok {
		return nil, errors.New("Invalid ElevenLabs timestamped audio chunk")
	}
	raw, ok := fields["audio_base64"].(string)
	if !ok {
		return nil, errors.New("Invalid ElevenLabs timestamped audio chunk")
	}
	data, err := audio(raw)
	if err != nil {
		return nil, err
	}
	key := "alignment"
	if normalized {
		key = "normalized_alignment"
	}
	times, err := timestamps(fields[key], "http")
	if err != nil {
		return nil, err
	}
	return out.SynthesisItemAsChunk{Value: out.TimestampedAudio{Audio: data, Timestamps: times}}, nil
}

type packet struct {
	context, audio runtime.Optional[string]
	alignment      any
	final          bool
	failure        *Error
}

func decode(frame runtime.WebSocketMessage, dialogue, normalized bool, limit int) (packet, error) {
	result := packet{}
	text, ok := frame.(runtime.WebSocketText)
	if !ok {
		return result, errors.New("ElevenLabs returned a non-text WebSocket frame")
	}
	if len(text) > limit {
		return result, errors.New("ElevenLabs message exceeds MaxMessageBytes")
	}
	raw, err := load([]byte(text))
	if err != nil {
		return result, err
	}
	fields, ok := raw.(map[string]any)
	if !ok {
		return result, errors.New("Invalid ElevenLabs WebSocket frame")
	}
	for _, key := range []string{"contextId", "context_id"} {
		if raw := fields[key]; raw != nil {
			value, ok := raw.(string)
			if !ok {
				return result, errors.New("Invalid ElevenLabs context identifier")
			}
			if result.context.Present && value != result.context.Value {
				return result, errors.New("Conflicting ElevenLabs context identifiers")
			}
			result.context = runtime.Some(value)
		}
	}
	if snake, present := fields["context_id"]; present {
		if camel, present := fields["contextId"]; present && (snake == nil) != (camel == nil) {
			return result, errors.New("Conflicting ElevenLabs context identifiers")
		}
	}
	_, hasError := fields["error"]
	_, hasDetail := fields["detail"]
	if hasError || hasDetail {
		code, _ := number(fields["code"])
		result.failure = responseError(fields, code)
		return result, nil
	}
	seenFinal := false
	for _, key := range []string{"isFinal", "is_final"} {
		if raw, present := fields[key]; present {
			value, ok := raw.(bool)
			if !ok {
				return result, errors.New("Invalid ElevenLabs final flag")
			}
			if seenFinal && value != result.final {
				return result, errors.New("Conflicting ElevenLabs final flags")
			}
			result.final, seenFinal = value, true
		}
	}
	if raw := fields["audio"]; raw != nil {
		value, ok := raw.(string)
		if !ok {
			return result, errors.New("Invalid ElevenLabs audio payload")
		}
		result.audio = runtime.Some(value)
	}
	turnFinal := false
	if raw, present := fields["is_final_audio_for_turn"]; dialogue && present {
		turnFinal, ok = raw.(bool)
		if !ok {
			return result, errors.New("Invalid ElevenLabs turn-final flag")
		}
	}
	if !result.audio.Present && !result.final && !turnFinal {
		return result, errors.New("Unknown ElevenLabs WebSocket message")
	}
	if !dialogue && !result.context.Present {
		return result, errors.New("ElevenLabs multi-context output lacks its context identifier")
	}
	key := "alignment"
	if normalized {
		key = "normalizedAlignment"
		if dialogue {
			key = "normalized_alignment"
		}
	}
	result.alignment = fields[key]
	return result, nil
}
