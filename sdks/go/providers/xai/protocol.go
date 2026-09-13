package xai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"

	out "github.com/speechswitch/client/sdks/go/generated/xai_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type Error struct{ Status runtime.Optional[int] }

func (e *Error) Error() string {
	if e.Status.Present {
		return fmt.Sprintf("xAI returned HTTP %d", e.Status.Value)
	}
	return "xAI reported a synthesis error"
}

type packet struct {
	kind string
	item out.SynthesisItem
}

func parseJSON(data []byte) (any, error) {
	if !runtime.ValidUTF8JSON(data) {
		return nil, errors.New("Invalid xAI JSON")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var value any
	if decoder.Decode(&value) != nil {
		return nil, errors.New("Invalid xAI JSON")
	}
	return value, nil
}
func milliseconds(value any, message string) (float64, error) {
	number, ok := value.(json.Number)
	result, err := number.Float64()
	result *= 1000
	if !ok || err != nil || result < 0 || math.IsNaN(result) || math.IsInf(result, 0) {
		return 0, errors.New(message)
	}
	return result, nil
}
func audio(value map[string]any, key, duration string) (out.TimestampedAudio, error) {
	result := out.TimestampedAudio{Timestamps: []out.CharacterTimestamp{}}
	encoded, ok := value[key].(string)
	data, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if !ok || err != nil || base64.StdEncoding.EncodeToString(data) != encoded {
		return result, errors.New("Invalid xAI base64 audio")
	}
	result.Audio = data
	if raw, present := value["audio_timestamps"]; present {
		marks, ok := raw.(map[string]any)
		if !ok {
			return result, errors.New("Invalid xAI character timestamps")
		}
		chars, charsOK := marks["graph_chars"].([]any)
		times, timesOK := marks["graph_times"].([]any)
		if !charsOK || !timesOK || len(chars) != len(times) {
			return result, errors.New("xAI returned incomplete or mismatched character timestamps")
		}
		for i, char := range chars {
			text, textOK := char.(string)
			interval, intervalOK := times[i].([]any)
			if !textOK || !intervalOK || len(interval) != 2 {
				return result, errors.New("Invalid xAI character timestamp interval")
			}
			start, startErr := milliseconds(interval[0], "Invalid xAI character timestamp interval")
			end, endErr := milliseconds(interval[1], "Invalid xAI character timestamp interval")
			if startErr != nil || endErr != nil || end < start {
				return result, errors.New("Invalid xAI character timestamp interval")
			}
			result.Timestamps = append(result.Timestamps, out.CharacterTimestamp{Value: text, StartTimeMs: start, EndTimeMs: end})
		}
	}
	if raw, present := value[duration]; present {
		value, err := milliseconds(raw, "Invalid xAI audio duration")
		if err != nil {
			return result, err
		}
		result.DurationMs = runtime.Some(value)
	}
	return result, nil
}

func decode(frame runtime.WebSocketMessage, limit int) (packet, error) {
	var data []byte
	switch v := frame.(type) {
	case runtime.WebSocketText:
		data = []byte(v)
	case *runtime.WebSocketText:
		if v != nil {
			data = []byte(*v)
		}
	}
	if data == nil {
		return packet{}, errors.New("xAI returned a non-text WebSocket message")
	}
	if len(data) > limit {
		return packet{}, errors.New("xAI message exceeds MaxMessageBytes")
	}
	value, err := parseJSON(data)
	if err != nil {
		return packet{}, err
	}
	event, ok := value.(map[string]any)
	if !ok {
		return packet{}, errors.New("xAI returned an invalid WebSocket event")
	}
	kind, _ := event["type"].(string)
	switch kind {
	case "audio.delta":
		audio, err := audio(event, "delta", "audio_duration")
		return packet{kind: kind, item: out.SynthesisItemAsChunk{Value: audio}}, err
	case "audio.done":
		result := out.DoneEvent{}
		if raw, present := event["trace_id"]; present {
			trace, ok := raw.(string)
			if !ok {
				return packet{}, errors.New("Invalid xAI trace identifier")
			}
			result.TraceId = runtime.Some(trace)
		}
		return packet{kind: kind, item: out.SynthesisItemAsDone{Value: result}}, nil
	case "audio.clear":
		return packet{kind: kind, item: out.SynthesisItemAsClear{}}, nil
	case "session.updated":
		if _, ok := event["replace"].(map[string]any); !ok {
			return packet{}, errors.New("xAI session.updated event has no valid replacement map")
		}
		// Decode this object in wire order; Go map iteration must not scramble the echo.
		var raw map[string]json.RawMessage
		_ = json.Unmarshal(data, &raw)
		decoder := json.NewDecoder(bytes.NewReader(raw["replace"]))
		_, _ = decoder.Token()
		items := []out.UpdatedEventReplacementsItem{}
		for decoder.More() {
			key, _ := decoder.Token()
			var value any
			if decoder.Decode(&value) != nil {
				return packet{}, errors.New("xAI session.updated event has no valid replacement map")
			}
			replacement, ok := value.(string)
			if !ok {
				return packet{}, errors.New("xAI session.updated event has no valid replacement map")
			}
			items = append(items, out.UpdatedEventReplacementsItem{Pattern: key.(string), Replacement: replacement})
		}
		return packet{kind: kind, item: out.SynthesisItemAsUpdated{Value: out.UpdatedEvent{Replacements: items}}}, nil
	case "error":
		if _, ok := event["message"].(string); !ok {
			return packet{}, errors.New("xAI error event has no message")
		}
		return packet{}, &Error{}
	default:
		return packet{}, errors.New("xAI returned an unknown WebSocket event")
	}
}

func readJSON(ctx context.Context, body runtime.Input[[]byte], limit int) (any, error) {
	var data []byte
	for {
		chunk, err := body.Next(ctx)
		if err == io.EOF {
			return parseJSON(bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf}))
		}
		if err != nil {
			return nil, err
		}
		if len(chunk) > limit-len(data) {
			return nil, errors.New("xAI response exceeds MaxResponseBytes")
		}
		data = append(data, chunk...)
	}
}
