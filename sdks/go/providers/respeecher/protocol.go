package respeecher

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"unicode/utf8"

	out "github.com/speechswitch/client/sdks/go/generated/respeecher_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type Error struct {
	StatusCode int
	ContextID  runtime.Optional[string]
	Message    string
}

func (e *Error) Error() string { return e.Message }

type packet struct {
	kind    string
	context runtime.Optional[string]
	audio   []byte
	failure error
}

func decode(data []byte, socket bool) (packet, error) {
	var p packet
	if !utf8.Valid(data) || !json.Valid(data) {
		return p, errors.New("Respeecher returned invalid JSON")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return p, errors.New("Respeecher returned invalid JSON")
	}
	fields, ok := value.(map[string]any)
	if !ok {
		return p, errors.New("Invalid Respeecher response")
	}
	if raw, present := fields["context_id"]; present {
		context, ok := raw.(string)
		if !ok {
			return p, errors.New("Invalid Respeecher context ID")
		}
		p.context = runtime.Some(context)
	}
	p.kind, _ = fields["type"].(string)
	if p.kind == "error" {
		message, messageOK := fields["error"].(string)
		number, numberOK := fields["status_code"].(json.Number)
		status, err := number.Float64()
		if !messageOK || !numberOK || err != nil || math.IsNaN(status) || math.IsInf(status, 0) || math.Trunc(status) != status || math.Abs(status) > 9007199254740991 {
			return p, errors.New("Invalid Respeecher error response")
		}
		p.failure = &Error{StatusCode: int(status), ContextID: p.context, Message: message}
		return p, nil
	}
	if socket && !p.context.Present {
		return p, errors.New("Respeecher omitted the native context ID")
	}
	if socket && p.kind == "done" {
		return p, nil
	}
	dataString, ok := fields["data"].(string)
	if p.kind != "chunk" || !ok {
		return p, errors.New("Invalid Respeecher audio response")
	}
	audio, err := base64.StdEncoding.Strict().DecodeString(dataString)
	if err != nil || base64.StdEncoding.EncodeToString(audio) != dataString {
		return p, errors.New("Invalid Respeecher audio response")
	}
	p.audio = audio
	return p, nil
}

func (s *stream) runHTTP() error {
	wire := map[string]any{"transcript": s.config.text, "voice": s.config.wire["voice"], "output_format": s.config.wire["output_format"]}
	encoded, err := json.Marshal(wire)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(s.ctx, "POST", s.config.httpURL, bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	request.Header.Set("X-API-Key", s.config.key)
	request.Header.Set("Content-Type", "application/json")
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
		return &Error{StatusCode: response.StatusCode, Message: fmt.Sprintf("Respeecher returned HTTP %d", response.StatusCode)}
	}
	contentType := strings.ToLower(strings.TrimSpace(strings.SplitN(response.Header.Get("Content-Type"), ";", 2)[0]))
	if contentType != "" {
		valid := strings.HasPrefix(contentType, "audio/") || contentType == "application/octet-stream"
		if !s.config.wave {
			valid = contentType == "text/event-stream" || contentType == "application/x-ndjson" || contentType == "application/jsonl" || contentType == "application/json"
		}
		if !valid {
			return errors.New("Respeecher returned an unexpected content type")
		}
	}
	received, first := false, true
	var pending []byte
	line := func() error {
		data := pending
		pending = nil
		if first {
			data = bytes.TrimPrefix(data, []byte{239, 187, 191})
			first = false
		}
		if len(bytes.TrimSpace(data)) == 0 {
			return nil
		}
		p, err := decode(data, false)
		if err != nil {
			return err
		}
		if p.failure != nil {
			return p.failure
		}
		if len(p.audio) > 0 {
			received = true
			return s.emit(out.SynthesisItemAsBytes{Value: p.audio})
		}
		return nil
	}
	for {
		chunk, err := response.Body.Next(s.ctx)
		if err == io.EOF {
			if len(pending) > 0 {
				if err := line(); err != nil {
					return err
				}
			}
			break
		}
		if err != nil {
			return err
		}
		if s.config.wave {
			received = true
			if err := s.emit(out.SynthesisItemAsBytes{Value: chunk}); err != nil {
				return err
			}
			continue
		}
		for index, b := range chunk {
			if index%8192 == 0 {
				if err := s.ctx.Err(); err != nil {
					return err
				}
			}
			if b == 10 {
				if err := line(); err != nil {
					return err
				}
			} else {
				if len(pending) == s.config.limit {
					return errors.New("Respeecher line exceeds MaxMessageBytes")
				}
				pending = append(pending, b)
			}
		}
	}
	if !received {
		return errors.New("Respeecher returned no audio")
	}
	return nil
}
