package smallest_ai

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"math"
	"net/http"
	"strings"
	"unicode/utf8"

	out "github.com/speechswitch/client/sdks/go/generated/smallest_ai_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type Error struct {
	Message string
	Status  runtime.Optional[int]
	Code    runtime.Optional[string]
}

func (e *Error) Error() string { return e.Message }

type packet struct {
	kind, requestID string
	externalID      runtime.Optional[string]
	audio           []byte
	timestamps      []out.SmallestEnvelopeTimestampsItem
	wordIndex       float64
}

func object(data []byte) (map[string]any, error) {
	if !utf8.Valid(data) || !json.Valid(data) {
		return nil, errors.New("Smallest.ai returned invalid JSON")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, errors.New("Smallest.ai returned invalid JSON")
	}
	fields, ok := value.(map[string]any)
	if !ok {
		return nil, errors.New("Invalid Smallest.ai response object")
	}
	return fields, nil
}
func audio(value any) ([]byte, error) {
	encoded, ok := value.(string)
	if !ok {
		return nil, errors.New("Invalid Smallest.ai base64 audio")
	}
	data, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil || base64.StdEncoding.EncodeToString(data) != encoded {
		return nil, errors.New("Invalid Smallest.ai base64 audio")
	}
	return data, nil
}
func decode(data []byte) (packet, error) {
	var p packet
	fields, err := object(data)
	if err != nil {
		return p, err
	}
	p.kind, _ = fields["status"].(string)
	if p.kind == "error" {
		errorFields := fields
		if nested, present := fields["error"]; present {
			var ok bool
			errorFields, ok = nested.(map[string]any)
			if !ok {
				return p, errors.New("Invalid Smallest.ai error response")
			}
		}
		message, ok := errorFields["message"].(string)
		if !ok {
			return p, errors.New("Invalid Smallest.ai error response")
		}
		failure := &Error{Message: message}
		if raw, present := errorFields["code"]; present {
			code, ok := raw.(string)
			if !ok {
				return p, errors.New("Invalid Smallest.ai error response")
			}
			failure.Code = runtime.Some(code)
		}
		return p, failure
	}
	p.requestID, _ = fields["request_id"].(string)
	if p.requestID == "" {
		return p, errors.New("Invalid Smallest.ai request identity")
	}
	if value, present := fields["external_request_id"]; present {
		external, ok := value.(string)
		if !ok {
			return p, errors.New("Invalid Smallest.ai request identity")
		}
		p.externalID = runtime.Some(external)
	}
	if p.kind == "complete" {
		return p, nil
	}
	payload, ok := fields["data"].(map[string]any)
	if !ok {
		return p, errors.New("Invalid Smallest.ai response object")
	}
	if p.kind == "chunk" {
		p.audio, err = audio(payload["audio"])
		return p, err
	}
	if p.kind != "word_timestamp" {
		return p, errors.New("Unknown Smallest.ai WebSocket status")
	}
	word, wordOK := payload["word"].(string)
	rawIndex, indexOK := payload["id"].(json.Number)
	rawStart, startOK := payload["start"].(json.Number)
	rawEnd, endOK := payload["end"].(json.Number)
	index, indexErr := rawIndex.Float64()
	start, startErr := rawStart.Float64()
	end, endErr := rawEnd.Float64()
	start *= 1000
	end *= 1000
	if !wordOK || !indexOK || !startOK || !endOK || indexErr != nil || startErr != nil || endErr != nil || index < 0 || index > 9007199254740991 || index != math.Trunc(index) || math.IsInf(start, 0) || math.IsInf(end, 0) || start < 0 || end < start {
		return p, errors.New("Invalid Smallest.ai word timestamp")
	}
	p.wordIndex = index
	p.timestamps = []out.SmallestEnvelopeTimestampsItem{{Value: word, StartTimeMs: start, EndTimeMs: runtime.Some(end)}}
	return p, nil
}

func (s *stream) runHTTP() error {
	wire := maps.Clone(s.config.wire)
	wire["text"] = s.config.text
	encoded, err := json.Marshal(wire)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(s.ctx, "POST", s.config.httpURL, bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	request.Header = s.config.headers.Clone()
	request.Header.Set("Content-Type", "application/json")
	accept := "text/event-stream"
	if s.config.protocol == "http" {
		accept = "audio/wav"
	}
	request.Header.Set("Accept", accept)
	response, err := runtime.OpenResponse(request, s.config.transport)
	if err != nil {
		return err
	}
	s.resourceMutex.Lock()
	closed := s.closed
	if !closed {
		s.body = response.Body
	}
	s.resourceMutex.Unlock()
	if closed {
		response.Body.Close()
		return s.ctx.Err()
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return &Error{Status: runtime.Some(response.StatusCode), Message: fmt.Sprintf("Smallest.ai returned HTTP %d", response.StatusCode)}
	}
	media := strings.ToLower(strings.TrimSpace(strings.SplitN(response.Header.Get("Content-Type"), ";", 2)[0]))
	if media != "" && ((s.config.protocol == "http" && !strings.HasPrefix(media, "audio/") && media != "application/octet-stream") || (s.config.protocol == "sse" && media != "text/event-stream")) {
		return errors.New("Smallest.ai returned an unexpected content type")
	}
	received := false
	if s.config.protocol == "sse" {
		received, err = s.readSSE(response.Body)
		if err != nil {
			return err
		}
	} else {
		for {
			chunk, err := response.Body.Next(s.ctx)
			if err == io.EOF {
				break
			}
			if err != nil {
				return err
			}
			if len(chunk) > 0 {
				received = true
				if err = s.emit(out.SynthesisItemAsBytes{Value: chunk}); err != nil {
					return err
				}
			}
		}
	}
	if !received {
		return errors.New("Smallest.ai returned no audio")
	}
	return nil
}
func (s *stream) readSSE(body runtime.Input[[]byte]) (bool, error) {
	decoder, err := runtime.NewSSEDecoder(s.config.limit)
	if err != nil {
		return false, err
	}
	defer decoder.Finish()
	received := false
	for {
		chunk, err := body.Next(s.ctx)
		if err == io.EOF {
			return received, errors.New("Smallest.ai SSE ended before completion")
		}
		if err != nil {
			return received, err
		}
		for i, b := range chunk {
			if i%8192 == 0 {
				if err := s.ctx.Err(); err != nil {
					return received, err
				}
			}
			event, err := decoder.Push(b)
			if err != nil {
				return received, err
			}
			if event == nil {
				continue
			}
			fields, err := object([]byte(event.Data))
			if err != nil {
				return received, err
			}
			_, hasError := fields["error"]
			if event.Event == "error" || fields["status"] == "error" || hasError {
				return received, &Error{Message: "Smallest.ai SSE returned an error"}
			}
			done, ok := fields["done"].(bool)
			if !ok || (fields["status"] != "206" && fields["status"] != "200") || done != (fields["status"] == "200") {
				return received, errors.New("Invalid Smallest.ai SSE status")
			}
			if raw, present := fields["audio"]; present {
				data, err := audio(raw)
				if err != nil {
					return received, err
				}
				if len(data) > 0 {
					received = true
					if err = s.emit(out.SynthesisItemAsBytes{Value: data}); err != nil {
						return received, err
					}
				}
			} else if !done {
				return received, errors.New("Smallest.ai SSE chunk omitted audio")
			}
			if done {
				return received, nil
			}
		}
	}
}
