package voice_ai

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/speechswitch/client/sdks/go/runtime"
)

type Error struct {
	Status    runtime.Optional[int]
	ContextID runtime.Optional[string]
}

func (e *Error) Error() string {
	if e.Status.Present {
		return fmt.Sprintf("Voice.ai returned HTTP %d", e.Status.Value)
	}
	return "Voice.ai reported a synthesis error"
}

type packet struct {
	kind, id string
	audio    []byte
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
		return packet{}, errors.New("Voice.ai expected a JSON text frame")
	}
	if len(data) > limit {
		return packet{}, errors.New("Voice.ai message exceeds MaxMessageBytes")
	}
	if !runtime.ValidUTF8JSON(data) {
		return packet{}, errors.New("Invalid Voice.ai JSON")
	}
	var object map[string]json.RawMessage
	if json.Unmarshal(data, &object) != nil || object == nil {
		return packet{}, errors.New("Invalid Voice.ai message")
	}
	var kind string
	for _, key := range []string{"audio", "is_last", "context_closed", "error"} {
		if _, ok := object[key]; ok {
			if kind != "" {
				return packet{}, errors.New("Invalid Voice.ai message variant")
			}
			kind = key
		}
	}
	if kind == "" {
		return packet{}, errors.New("Invalid Voice.ai message variant")
	}
	var id string
	idValue, hasID := object["context_id"]
	idString := hasID && len(bytes.TrimSpace(idValue)) > 0 && bytes.TrimSpace(idValue)[0] == '"' && json.Unmarshal(idValue, &id) == nil
	if kind == "error" {
		var message string
		raw := bytes.TrimSpace(object[kind])
		if len(raw) == 0 || raw[0] != '"' || json.Unmarshal(raw, &message) != nil || hasID && !bytes.Equal(bytes.TrimSpace(idValue), []byte("null")) && !idString {
			return packet{}, errors.New("Invalid Voice.ai error message")
		}
		failure := &Error{}
		if idString {
			failure.ContextID = runtime.Some(id)
		}
		return packet{}, failure
	}
	if !idString || id == "" {
		return packet{}, errors.New("Voice.ai omitted context_id")
	}
	if kind == "audio" {
		var encoded string
		raw := bytes.TrimSpace(object[kind])
		if len(raw) == 0 || raw[0] != '"' || json.Unmarshal(raw, &encoded) != nil {
			return packet{}, errors.New("Invalid Voice.ai base64 audio")
		}
		audio, err := base64.StdEncoding.Strict().DecodeString(encoded)
		if err != nil || base64.StdEncoding.EncodeToString(audio) != encoded {
			return packet{}, errors.New("Invalid Voice.ai base64 audio")
		}
		return packet{kind: "audio", id: id, audio: audio}, nil
	}
	if !bytes.Equal(bytes.TrimSpace(object[kind]), []byte("true")) {
		return packet{}, errors.New("Invalid Voice.ai completion flag")
	}
	if kind == "is_last" {
		return packet{kind: "flush", id: id}, nil
	}
	return packet{kind: "closed", id: id}, nil
}
