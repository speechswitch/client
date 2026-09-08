package microsoft

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	out "github.com/speechswitch/client/sdks/go/generated/microsoft_output"
	"github.com/speechswitch/client/sdks/go/runtime"
	"math"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

type frame struct {
	path, requestID string
	streamID        runtime.Optional[string]
	body            []byte
	binary          bool
}

func encode(path, id, body string) runtime.WebSocketText {
	contentType := "application/json"
	if path == "ssml" {
		contentType = "application/ssml+xml"
	} else if path == "text.piece" || path == "text.end" {
		contentType = "text/plain"
	}
	return runtime.WebSocketText("Path: " + path + "\r\nX-RequestId: " + id + "\r\nX-Timestamp: " + time.Now().UTC().Format("2006-01-02T15:04:05.000Z") + "\r\nContent-Type: " + contentType + "\r\n\r\n" + body)
}

func decode(message runtime.WebSocketMessage, limit int) (frame, error) {
	f := frame{}
	var headers string
	switch v := message.(type) {
	case runtime.WebSocketText:
		if len(v) > limit {
			return f, errors.New("Microsoft message exceeds MaxMessageBytes")
		}
		head, body, found := strings.Cut(string(v), "\r\n\r\n")
		if !found {
			return f, errors.New("Microsoft text frame is missing its header separator")
		}
		headers, f.body = head, []byte(body)
	case runtime.WebSocketBinary:
		if len(v) > limit {
			return f, errors.New("Microsoft message exceeds MaxMessageBytes")
		}
		if len(v) < 2 {
			return f, errors.New("Microsoft binary frame is missing its header length")
		}
		size := int(binary.BigEndian.Uint16(v))
		if size > len(v)-2 {
			return f, errors.New("Microsoft binary frame has a truncated header")
		}
		if !utf8.Valid(v[2 : 2+size]) {
			return f, errors.New("Microsoft binary frame has invalid UTF-8 headers")
		}
		headers, f.body, f.binary = string(v[2:2+size]), v[2+size:], true
	default:
		return f, errors.New("Unsupported Microsoft WebSocket message data")
	}
	fields := map[string]string{}
	for _, line := range strings.Split(headers, "\r\n") {
		if line == "" {
			continue
		}
		name, value, found := strings.Cut(line, ":")
		name, value = strings.ToLower(strings.TrimSpace(name)), strings.TrimSpace(value)
		if !found || name == "" || strings.ContainsAny(value, "\r\n") || strings.Trim(name, "abcdefghijklmnopqrstuvwxyz0123456789-") != "" {
			return f, errors.New("Microsoft frame contains an invalid header")
		}
		if _, present := fields[name]; present {
			return f, errors.New("Microsoft frame repeats header " + name)
		}
		fields[name] = value
	}
	if fields["path"] == "" || fields["x-requestid"] == "" {
		return f, errors.New("Microsoft frame is missing Path or X-RequestId")
	}
	f.path, f.requestID = strings.ToLower(fields["path"]), fields["x-requestid"]
	if id, ok := fields["x-streamid"]; ok {
		f.streamID = runtime.Some(id)
	}
	return f, nil
}

func object(data []byte) (map[string]json.RawMessage, error) {
	if !runtime.ValidUTF8JSON(data) {
		return nil, errors.New("Microsoft returned invalid JSON")
	}
	var result map[string]json.RawMessage
	if err := json.Unmarshal(data, &result); err != nil || result == nil {
		return nil, errors.New("Microsoft returned an invalid synthesis object")
	}
	return result, nil
}

func stringValue(data json.RawMessage) (string, bool) {
	var value string
	if len(data) == 0 || data[0] != '"' {
		return "", false
	}
	err := json.Unmarshal(data, &value)
	return value, err == nil
}

func ticks(data json.RawMessage, name string) (float64, error) {
	var n float64
	if len(data) == 0 || string(data) == "null" {
		return 0, errors.New("Microsoft returned invalid " + name)
	}
	if err := json.Unmarshal(data, &n); err != nil || n < 0 || n > 9007199254740991 || math.Trunc(n) != n {
		return 0, errors.New("Microsoft returned invalid " + name)
	}
	return n, nil
}

func metadata(body map[string]json.RawMessage) ([]out.MicrosoftTimestamp, runtime.Optional[float64], error) {
	marks := []out.MicrosoftTimestamp{}
	duration := runtime.Optional[float64]{}
	var rows []json.RawMessage
	if err := json.Unmarshal(body["Metadata"], &rows); err != nil || rows == nil {
		return nil, duration, errors.New("Microsoft returned invalid synthesis Metadata")
	}
	for _, raw := range rows {
		row, err := object(raw)
		if err != nil {
			return nil, duration, err
		}
		kind, ok := stringValue(row["Type"])
		if !ok {
			return nil, duration, errors.New("Microsoft returned an invalid metadata type")
		}
		if kind != "WordBoundary" && kind != "SentenceBoundary" && kind != "Bookmark" && kind != "Viseme" && kind != "SessionEnd" {
			continue
		}
		data, err := object(row["Data"])
		if err != nil {
			return nil, duration, err
		}
		offset, err := ticks(data["Offset"], "metadata Offset")
		if err != nil {
			return nil, duration, err
		}
		if kind == "SessionEnd" {
			if duration.Present {
				return nil, duration, errors.New("Microsoft returned duplicate SessionEnd metadata")
			}
			duration = runtime.Some(offset / 10000)
			continue
		}
		mark := out.MicrosoftTimestamp{StartTimeMs: offset / 10000}
		switch kind {
		case "WordBoundary", "SentenceBoundary":
			text, err := object(data["text"])
			if err != nil {
				return nil, duration, err
			}
			value, ok := stringValue(text["Text"])
			if !ok {
				return nil, duration, errors.New("Microsoft returned invalid boundary text")
			}
			if raw, present := text["BoundaryType"]; present {
				v, ok := stringValue(raw)
				if !ok {
					return nil, duration, errors.New("Microsoft returned invalid boundary text")
				}
				mark.BoundaryType = runtime.Some(v)
			}
			length, err := ticks(data["Duration"], "metadata Duration")
			if err != nil {
				return nil, duration, err
			}
			if offset+length > 9007199254740991 {
				return nil, duration, errors.New("Microsoft metadata timing overflow")
			}
			mark.Kind = out.MicrosoftTimestampKindAsWord{}
			if kind == "SentenceBoundary" {
				mark.Kind = out.MicrosoftTimestampKindAsSentence{}
			}
			mark.Value, mark.EndTimeMs = value, runtime.Some(offset/10000+length/10000)
		case "Bookmark":
			value, ok := stringValue(data["Bookmark"])
			if !ok {
				return nil, duration, errors.New("Microsoft returned an invalid bookmark")
			}
			mark.Kind, mark.Value = out.MicrosoftTimestampKindAsSsml{}, value
		case "Viseme":
			id, err := ticks(data["VisemeId"], "viseme metadata")
			if err != nil {
				return nil, duration, err
			}
			mark.Kind, mark.Value = out.MicrosoftTimestampKindAsViseme{}, strconv.FormatFloat(id, 'f', 0, 64)
			if raw, present := data["AnimationChunk"]; present {
				v, ok := stringValue(raw)
				if !ok {
					return nil, duration, errors.New("Microsoft returned invalid viseme metadata")
				}
				mark.AnimationChunk = runtime.Some(v)
			}
			if raw, present := data["IsLastAnimation"]; present {
				var v out.MicrosoftTimestampIsLastAnimation
				switch string(raw) {
				case "true":
					v = out.MicrosoftTimestampIsLastAnimationAsTrue{}
				case "false":
					v = out.MicrosoftTimestampIsLastAnimationAsFalse{}
				default:
					return nil, duration, errors.New("Microsoft returned invalid viseme metadata")
				}
				mark.IsLastAnimation = runtime.Some(v)
			}
		}
		marks = append(marks, mark)
	}
	return marks, duration, nil
}
