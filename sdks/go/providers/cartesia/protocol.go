package cartesia

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"

	out "github.com/speechswitch/client/sdks/go/generated/cartesia_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type Error struct {
	StatusCode                   float64
	ErrorCode                    *string
	RequestID, DocURL, ContextID runtime.Optional[string]
	title, message               string
}

func (e *Error) Error() string {
	return fmt.Sprintf("Cartesia %s: %s: %s", strconv.FormatFloat(e.StatusCode, 'f', -1, 64), e.title, e.message)
}

func responseError(value any, status float64) *Error {
	result := &Error{StatusCode: status, title: "Request failed", message: "Invalid error response"}
	if text, ok := value.(string); ok {
		result.message = text
	}
	if fields, ok := value.(map[string]any); ok {
		if title, ok := fields["title"].(string); ok {
			result.title = title
		}
		if message, ok := fields["message"].(string); ok {
			result.message = message
		}
		if code, ok := fields["error_code"].(string); ok {
			result.ErrorCode = &code
		}
		if request, ok := fields["request_id"].(string); ok {
			result.RequestID = runtime.Some(request)
		}
		if doc, ok := fields["doc_url"].(string); ok {
			result.DocURL = runtime.Some(doc)
		}
		if context, ok := fields["context_id"].(string); ok {
			result.ContextID = runtime.Some(context)
		}
	}
	return result
}

func load(data []byte) (any, error) {
	if !runtime.ValidUTF8JSON(data) {
		return nil, errors.New("Cartesia returned invalid JSON")
	}
	var value any
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil {
		return nil, errors.New("Cartesia returned invalid JSON")
	}
	return value, nil
}

func number(value any) (float64, bool) {
	raw, ok := value.(json.Number)
	if !ok {
		return 0, false
	}
	valueNumber, err := strconv.ParseFloat(string(raw), 64)
	return valueNumber, err == nil
}

type packet struct {
	kind           string
	context, group runtime.Optional[string]
	data           string
	timestamps     []out.Timestamp
	failure        *Error
}

func decode(data []byte, websocket bool) (packet, error) {
	result := packet{}
	parsed, err := load(data)
	if err != nil {
		return result, err
	}
	value, ok := parsed.(map[string]any)
	if !ok {
		return result, errors.New("Cartesia returned an invalid frame")
	}
	status, ok := number(value["status_code"])
	if !ok || math.Trunc(status) != status {
		return result, errors.New("Cartesia returned an invalid status_code")
	}
	if context := value["context_id"]; context != nil {
		text, ok := context.(string)
		if !ok {
			return result, errors.New("Cartesia returned an invalid context ID")
		}
		result.context = runtime.Some(text)
	}
	if raw, present := value["flush_id"]; present {
		group, ok := number(raw)
		if !ok || group < 0 || group > 9007199254740991 || math.Trunc(group) != group {
			return result, errors.New("Cartesia returned an invalid flush ID")
		}
		if group == 0 {
			group = 0
		} // Normalize negative zero to the native integer ID.
		result.group = runtime.Some(strconv.FormatFloat(group, 'f', -1, 64))
	}
	result.kind, _ = value["type"].(string)
	if result.kind == "error" {
		result.failure = responseError(value, status)
		return result, nil
	}
	if websocket && !result.context.Present {
		return result, errors.New("Cartesia WebSocket output lacks its context ID")
	}
	done, ok := value["done"].(bool)
	if !ok {
		return result, errors.New("Cartesia returned an invalid completion flag")
	}
	switch result.kind {
	case "done":
		if done {
			return result, nil
		}
	case "flush_done":
		if websocket && value["flush_done"] == true && result.group.Present {
			return result, nil
		}
	case "chunk":
		if text, ok := value["data"].(string); ok {
			result.data = text
			return result, nil
		}
	case "timestamps", "phoneme_timestamps":
		field, labels := "word_timestamps", "words"
		var kind out.TimestampKind = out.TimestampKindAsWord{}
		if result.kind == "phoneme_timestamps" {
			field, labels, kind = "phoneme_timestamps", "phonemes", out.TimestampKindAsPhoneme{}
		}
		raw, present := value[field]
		result.timestamps = []out.Timestamp{}
		if !present && websocket {
			return result, nil
		}
		timing, ok := raw.(map[string]any)
		if !ok {
			return result, errors.New("Cartesia returned incomplete timestamps")
		}
		words, wordsOK := timing[labels].([]any)
		starts, startsOK := timing["start"].([]any)
		ends, endsOK := timing["end"].([]any)
		if !wordsOK || !startsOK || !endsOK || len(words) != len(starts) || len(words) != len(ends) {
			return result, errors.New("Cartesia returned mismatched timestamp arrays")
		}
		for index, value := range words {
			label, labelOK := value.(string)
			start, startOK := number(starts[index])
			end, endOK := number(ends[index])
			if !labelOK || !startOK || !endOK || start < 0 || end < start || math.IsInf(start*1000, 0) || math.IsInf(end*1000, 0) {
				return result, errors.New("Cartesia returned an invalid timestamp")
			}
			result.timestamps = append(result.timestamps, out.Timestamp{Kind: kind, Value: label, StartTimeMs: start * 1000, EndTimeMs: end * 1000})
		}
		return result, nil
	}
	name := fmt.Sprint(value["type"])
	if value["type"] == nil {
		name = "null"
		if _, present := value["type"]; !present {
			name = "undefined"
		}
	}
	return result, fmt.Errorf("Unknown Cartesia event: %s", name)
}

func output(value packet, context string, timed bool) (out.SynthesisItem, error) {
	if value.failure != nil {
		return nil, value.failure
	}
	if value.kind == "done" {
		return nil, nil
	}
	if value.kind == "flush_done" {
		return out.SynthesisItemAsFlush{Value: out.SynthesisItemFlush{CorrelationId: context, InputGroupId: value.group}}, nil
	}
	envelope := out.TimelineOutput{CorrelationId: context, InputGroupId: value.group, Timestamps: value.timestamps}
	if value.kind == "chunk" {
		if strings.ContainsAny(value.data, "\r\n") {
			return nil, errors.New("Cartesia returned invalid base64 audio")
		}
		audio, err := base64.StdEncoding.DecodeString(value.data)
		if err != nil {
			return nil, errors.New("Cartesia returned invalid base64 audio")
		}
		if !timed && !value.group.Present {
			return out.SynthesisItemAsBytes{Value: audio}, nil
		}
		envelope.Audio, envelope.Timestamps = runtime.Some(audio), []out.Timestamp{}
	}
	return out.SynthesisItemAsTimeline{Value: envelope}, nil
}
