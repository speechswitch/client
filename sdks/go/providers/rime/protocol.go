package rime

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

	out "github.com/speechswitch/client/sdks/go/generated/rime_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type Error struct {
	Message string
	// Present for HTTP failures, absent for native WebSocket errors.
	Status runtime.Optional[int]
}

func (e *Error) Error() string { return e.Message }

type packet struct {
	kind       string
	context    runtime.Optional[string]
	audio      []byte
	timestamps []out.RimeEnvelopeTimestampsItem
}

func decode(data []byte) (packet, error) {
	var p packet
	if !utf8.Valid(data) || !json.Valid(data) {
		return p, errors.New("Rime returned invalid JSON")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return p, errors.New("Rime returned invalid JSON")
	}
	fields, ok := value.(map[string]any)
	if !ok {
		return p, errors.New("Invalid Rime response")
	}
	p.kind, _ = fields["type"].(string)
	if message, ok := fields["message"].(string); p.kind == "error" && ok {
		return p, &Error{Message: message}
	}
	rawContext, present := fields["contextId"]
	if !present {
		return p, errors.New("Invalid Rime context ID")
	}
	if rawContext != nil {
		context, ok := rawContext.(string)
		if !ok {
			return p, errors.New("Invalid Rime context ID")
		}
		p.context = runtime.Some(context)
	}
	switch p.kind {
	case "done":
		return p, nil
	case "chunk":
		data, ok := fields["data"].(string)
		if !ok {
			return p, errors.New("Invalid Rime audio response")
		}
		audio, err := base64.StdEncoding.Strict().DecodeString(data)
		if err != nil || base64.StdEncoding.EncodeToString(audio) != data {
			return p, errors.New("Invalid Rime audio response")
		}
		p.audio = audio
		return p, nil
	case "timestamps":
		marks, ok := fields["word_timestamps"].(map[string]any)
		if !ok {
			return p, errors.New("Invalid Rime response")
		}
		words, wordsOK := marks["words"].([]any)
		starts, startsOK := marks["start"].([]any)
		ends, endsOK := marks["end"].([]any)
		if !wordsOK || !startsOK || !endsOK || len(words) != len(starts) || len(words) != len(ends) {
			return p, errors.New("Invalid Rime timestamp arrays")
		}
		p.timestamps = make([]out.RimeEnvelopeTimestampsItem, len(words))
		for i, rawWord := range words {
			word, wordOK := rawWord.(string)
			startNumber, startOK := starts[i].(json.Number)
			endNumber, endOK := ends[i].(json.Number)
			start, startErr := startNumber.Float64()
			end, endErr := endNumber.Float64()
			start *= 1000
			end *= 1000
			if !wordOK || !startOK || !endOK || startErr != nil || endErr != nil || math.IsInf(start, 0) || math.IsInf(end, 0) || start < 0 || end < start {
				return p, errors.New("Invalid Rime timestamp interval")
			}
			p.timestamps[i] = out.RimeEnvelopeTimestampsItem{Value: word, StartTimeMs: start, EndTimeMs: runtime.Some(end)}
		}
		return p, nil
	default:
		return p, errors.New("Invalid Rime response")
	}
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
	request.Header.Set("Authorization", "Bearer "+s.config.key)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", map[string]string{"pcm": "audio/L16", "wav": "audio/wav", "mp3": "audio/mpeg", "mulaw": "audio/PCMU", "ogg_opus": "audio/ogg;codecs=opus", "webm_opus": "audio/webm;codecs=opus"}[s.config.format])
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
		return &Error{Status: runtime.Some(response.StatusCode), Message: fmt.Sprintf("Rime returned HTTP %d", response.StatusCode)}
	}
	contentType := strings.ToLower(strings.TrimSpace(strings.SplitN(response.Header.Get("Content-Type"), ";", 2)[0]))
	if contentType != "" && !strings.HasPrefix(contentType, "audio/") && contentType != "application/octet-stream" {
		return errors.New("Rime returned an unexpected content type")
	}
	received := false
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
			if err := s.emit(out.SynthesisItemAsBytes{Value: chunk}); err != nil {
				return err
			}
		}
	}
	if !received {
		return errors.New("Rime returned no audio")
	}
	return nil
}
