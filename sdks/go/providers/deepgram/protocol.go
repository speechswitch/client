package deepgram

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/speechswitch/client/sdks/go/runtime"
	"math"
)

type message struct {
	kind     string
	audio    []byte
	sequence float64
	trace    string
}

func decode(frame runtime.WebSocketMessage, limit int) (message, error) {
	var data []byte
	switch v := frame.(type) {
	case runtime.WebSocketBinary:
		if len(v) > limit {
			return message{}, errors.New("Deepgram message exceeds MaxMessageBytes")
		}
		return message{kind: "audio", audio: bytes.Clone(v)}, nil
	case *runtime.WebSocketBinary:
		if v != nil {
			return decode(*v, limit)
		}
	case runtime.WebSocketText:
		data = []byte(v)
	case *runtime.WebSocketText:
		if v != nil {
			return decode(*v, limit)
		}
	}
	if data == nil {
		return message{}, errors.New("Deepgram returned an unsupported WebSocket frame")
	}
	if len(data) > limit {
		return message{}, errors.New("Deepgram message exceeds MaxMessageBytes")
	}
	if !runtime.ValidUTF8JSON(data) {
		return message{}, errors.New("Deepgram returned invalid JSON")
	}
	var value map[string]any
	if json.Unmarshal(data, &value) != nil || value == nil {
		return message{}, errors.New("Deepgram returned an invalid WebSocket event")
	}
	kind, _ := value["type"].(string)
	if kind == "Warning" || kind == "Error" {
		code, ok := value["code"].(string)
		description, valid := value["description"].(string)
		if !ok || !valid {
			return message{}, errors.New("Deepgram returned an invalid error event")
		}
		return message{}, fmt.Errorf("Deepgram %s %s: %s", kind, code, description)
	}
	if kind == "Metadata" {
		if trace, ok := value["request_id"].(string); ok {
			return message{kind: kind, trace: trace}, nil
		}
	}
	sequence, ok := value["sequence_id"].(float64)
	if (kind == "Flushed" || kind == "Cleared") && ok && sequence >= 0 && sequence <= 9007199254740991 && math.Trunc(sequence) == sequence {
		return message{kind: kind, sequence: sequence}, nil
	}
	return message{}, errors.New("Deepgram returned an invalid WebSocket event")
}
