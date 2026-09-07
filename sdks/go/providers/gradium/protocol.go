package gradium

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"math"
	"strconv"
	"strings"

	out "github.com/speechswitch/client/sdks/go/generated/gradium_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func packet(data []byte, timed bool) (string, out.SynthesisItem, error) {
	if !runtime.ValidUTF8JSON(data) {
		return "", nil, errors.New("Gradium returned invalid JSON")
	}
	var value map[string]any
	if json.Unmarshal(data, &value) != nil || value == nil {
		return "", nil, errors.New("Gradium returned an invalid event")
	}
	if _, present := value["client_req_id"]; present {
		return "", nil, errors.New("Gradium returned an unexpected multiplexed request ID")
	}
	invalid := errors.New("Gradium returned an invalid event")
	kind, _ := value["type"].(string)
	switch kind {
	case "ready":
		if _, ok := value["request_id"].(string); !ok {
			return "", nil, invalid
		}
		return kind, nil, nil
	case "end_of_stream", "flushed":
		return kind, nil, nil
	case "error":
		message, ok := value["message"].(string)
		if !ok {
			return "", nil, invalid
		}
		code := runtime.Optional[int64]{}
		if raw, present := value["code"]; present {
			n, ok := raw.(float64)
			if !ok || math.Trunc(n) != n || math.Abs(n) > 9007199254740991 {
				return "", nil, invalid
			}
			code = runtime.Some(int64(n))
		}
		return "", nil, &Error{Message: message, Code: code}
	case "audio", "text":
	default:
		return "", nil, invalid
	}
	payload, ok := value[kind].(string)
	if !ok {
		return "", nil, invalid
	}
	envelope := out.TimelineOutput{Timestamps: []out.SegmentTimestamp{}}
	if raw, present := value["stream_id"]; present {
		id, ok := raw.(float64)
		if !ok || id < 0 || id > 9007199254740991 || math.Trunc(id) != id {
			return "", nil, errors.New("Gradium returned an invalid stream ID")
		}
		envelope.CorrelationId = runtime.Some(strconv.FormatInt(int64(id), 10))
	}
	_, startPresent := value["start_s"]
	_, stopPresent := value["stop_s"]
	hasRange := kind == "text" || startPresent || stopPresent
	start, startOK := value["start_s"].(float64)
	stop, stopOK := value["stop_s"].(float64)
	if hasRange && (!startOK || !stopOK || start < 0 || stop < start || math.IsInf(start*1000, 0) || math.IsInf(stop*1000, 0)) {
		return "", nil, errors.New("Gradium returned an invalid time range")
	}
	if kind == "audio" {
		audio, err := base64.StdEncoding.Strict().DecodeString(payload)
		if err != nil || strings.ContainsAny(payload, "\r\n") {
			return "", nil, errors.New("Gradium returned invalid base64 audio")
		}
		if !timed {
			return kind, out.SynthesisItemAsBytes{Value: audio}, nil
		}
		envelope.Audio = runtime.Some(audio)
		if hasRange {
			envelope.AudioTiming = runtime.Some(out.TimelineOutputAudioTiming{StartTimeMs: start * 1000, EndTimeMs: stop * 1000})
		}
	} else {
		if !timed {
			return kind, nil, nil
		}
		envelope.Timestamps = []out.SegmentTimestamp{{Value: payload, StartTimeMs: start * 1000, EndTimeMs: stop * 1000}}
	}
	return kind, out.SynthesisItemAsTimeline{Value: envelope}, nil
}

// ECMAScript whitespace: Go's unicode.IsSpace also includes U+0085 and omits BOM.
const space = "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"

type textBuffer struct {
	pending string
	limit   int
}

func (b *textBuffer) push(text string) (string, error) {
	if len(text) > b.limit-len(b.pending) {
		return "", errors.New("Gradium text buffer exceeds MaxMessageBytes")
	}
	b.pending += text
	inTag, boundary := false, -1
	for i, c := range b.pending {
		if c == '<' {
			inTag = true
		} else if c == '>' {
			inTag = false
			if strings.HasSuffix(b.pending[:i+1], "<flush>") {
				boundary = i + 1
			}
		} else if !inTag && strings.ContainsRune(space, c) {
			boundary = i + len(string(c))
		}
	}
	if boundary < 0 {
		return "", nil
	}
	complete := strings.TrimRight(b.pending[:boundary], space)
	b.pending = b.pending[boundary:]
	return complete, nil
}
