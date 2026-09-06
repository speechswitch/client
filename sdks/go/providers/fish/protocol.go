package fish

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"

	out "github.com/speechswitch/client/sdks/go/generated/fish_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type Error struct {
	StatusCode int
	Message    string
	Reason     runtime.Optional[string]
}

func (e *Error) Error() string { return fmt.Sprintf("Fish %d: %s", e.StatusCode, e.Message) }

func alignment(data []byte) (out.SynthesisItem, error) {
	var value map[string]any
	if !runtime.ValidUTF8JSON(data) || json.Unmarshal(data, &value) != nil {
		return nil, errors.New("Fish returned invalid timestamp JSON")
	}
	audio, audioOK := value["audio_base64"].(string)
	_, contentOK := value["content"].(string)
	seq, seqOK := value["chunk_seq"].(float64)
	offset, offsetOK := value["chunk_audio_offset_sec"].(float64)
	if !audioOK || !contentOK || !seqOK || seq < 0 || seq > 9007199254740991 || math.Trunc(seq) != seq || !offsetOK || offset < 0 || math.IsInf(offset*1000, 0) {
		return nil, errors.New("Fish returned an invalid timestamp event")
	}
	decoded, err := base64.StdEncoding.Strict().DecodeString(audio)
	if err != nil || strings.ContainsAny(audio, "\r\n") {
		return nil, errors.New("Fish returned invalid base64 audio")
	}
	result := out.TimelineOutput{Audio: decoded, CorrelationId: strconv.FormatUint(uint64(seq), 10), TimelineOffsetMs: offset * 1000, Timestamps: []out.SegmentTimestamp{}}
	snapshot, present := value["alignment"]
	if present && snapshot == nil {
		return out.SynthesisItemAsTimeline{Value: result}, nil
	}
	fields, ok := snapshot.(map[string]any)
	if !ok {
		return nil, errors.New("Fish returned an invalid alignment snapshot")
	}
	segments, segmentsOK := fields["segments"].([]any)
	duration, durationOK := fields["audio_duration"].(float64)
	if !segmentsOK || !durationOK || duration < 0 || math.IsInf(duration*1000, 0) {
		return nil, errors.New("Fish returned an invalid alignment snapshot")
	}
	for _, raw := range segments {
		segment, ok := raw.(map[string]any)
		if !ok {
			return nil, errors.New("Fish returned an invalid timing segment")
		}
		text, textOK := segment["text"].(string)
		start, startOK := segment["start"].(float64)
		end, endOK := segment["end"].(float64)
		if !textOK || !startOK || !endOK || start < 0 || end < start || math.IsInf(start*1000, 0) || math.IsInf(end*1000, 0) {
			return nil, errors.New("Fish returned an invalid timing segment")
		}
		result.Timestamps = append(result.Timestamps, out.SegmentTimestamp{Value: text, StartTimeMs: start * 1000, EndTimeMs: end * 1000})
	}
	result.TimestampUpdate = runtime.Some(out.TimelineOutputTimestampUpdate{})
	result.DurationMs = runtime.Some(duration * 1000)
	return out.SynthesisItemAsTimeline{Value: result}, nil
}

type packet struct {
	event, reason string
	audio         []byte
}

func decodePacket(message runtime.WebSocketMessage, limit int) (packet, error) {
	data, ok := message.(runtime.WebSocketBinary)
	if !ok {
		return packet{}, errors.New("Fish returned a non-binary WebSocket frame")
	}
	if len(data) > limit {
		return packet{}, errors.New("Fish message exceeds MaxMessageBytes")
	}
	raw, err := runtime.DecodeMessagePack(data)
	if err != nil {
		return packet{}, err
	}
	value, ok := raw.(map[string]any)
	if !ok {
		return packet{}, errors.New("Fish returned an invalid WebSocket event")
	}
	event, ok := value["event"].(string)
	if !ok {
		return packet{}, errors.New("Fish returned an invalid WebSocket event")
	}
	switch event {
	case "audio":
		audio, ok := value["audio"].([]byte)
		if !ok {
			return packet{}, errors.New("Fish returned an invalid WebSocket event")
		}
		return packet{event: event, audio: audio}, nil
	case "finish":
		reason, ok := value["reason"].(string)
		if !ok || (reason != "stop" && reason != "error") {
			return packet{}, errors.New("Fish returned an invalid WebSocket event")
		}
		return packet{event: event, reason: reason}, nil
	default:
		return packet{event: "ignored"}, nil // The protocol explicitly permits future event names.
	}
}
