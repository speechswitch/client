package resemble

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"strings"

	"github.com/speechswitch/client/sdks/go/runtime"
)

func (s *stream) send(method, target string, headers http.Header, payload []byte) (*runtime.HTTPResponse, error) {
	request, err := http.NewRequestWithContext(s.ctx, method, target, bytes.NewReader(payload))
	if err != nil {
		return nil, errors.New("Invalid Resemble deployment or audio URL")
	}
	request.Header = headers.Clone()
	response, err := runtime.OpenResponse(request, s.config.transport)
	if err != nil {
		return nil, err
	}
	s.body = response.Body
	if err := s.ctx.Err(); err != nil {
		s.release()
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		data, err := s.read()
		if err != nil {
			return nil, err
		}
		retry := runtime.Optional[string]{}
		for name, values := range response.Header {
			if strings.EqualFold(name, "retry-after") && len(values) > 0 {
				retry = runtime.Some(values[0])
			}
		}
		return nil, &Error{StatusCode: runtime.Some(response.StatusCode), Body: string(data), RequestID: s.requestID, RetryAfter: retry}
	}
	return response, nil
}
func (s *stream) read() ([]byte, error) {
	defer s.release()
	var data []byte
	for {
		chunk, err := s.body.Next(s.ctx)
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		if len(chunk) > s.config.jsonLimit-len(data) {
			return nil, errors.New("Resemble response exceeds MaxJSONBytes")
		}
		data = append(data, chunk...)
	}
	return []byte(strings.TrimPrefix(runtime.DecodeUTF8(data), "\ufeff")), nil
}
func decode(data []byte) (any, error) {
	var value any
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if !json.Valid(data) {
		return nil, errors.New("Resemble returned invalid JSON")
	}
	if err := decoder.Decode(&value); err != nil {
		return nil, errors.New("Resemble returned invalid JSON")
	}
	return value, nil
}
func (s *stream) metadata(method, target string, headers http.Header, payload []byte) (any, error) {
	if _, err := s.send(method, target, headers, payload); err != nil {
		return nil, err
	}
	data, err := s.read()
	if err != nil {
		return nil, err
	}
	return decode(data)
}

type fileData struct{ path, url string }

func file(value any) (fileData, error) {
	invalid := errors.New("Resemble returned an invalid audio file")
	object, ok := value.(map[string]any)
	if !ok {
		return fileData{}, invalid
	}
	path, ok := object["path"].(string)
	if !ok || path == "" {
		return fileData{}, invalid
	}
	var target string
	if value := object["url"]; value != nil {
		target, ok = value.(string)
		if !ok {
			return fileData{}, invalid
		}
	}
	if value, exists := object["is_stream"]; exists && value != false {
		return fileData{}, invalid
	}
	if value, exists := object["meta"]; exists {
		meta, ok := value.(map[string]any)
		if !ok || meta["_type"] != "gradio.FileData" {
			return fileData{}, invalid
		}
	}
	return fileData{path: path, url: target}, nil
}
func defaultReference(value any) (string, error) {
	root, _ := value.(map[string]any)
	endpoints, _ := root["named_endpoints"].(map[string]any)
	generate, _ := endpoints["/generate"].(map[string]any)
	parameters, _ := generate["parameters"].([]any)
	if len(parameters) > 1 {
		parameter, _ := parameters[1].(map[string]any)
		if parameter["parameter_name"] == "audio_prompt_path" {
			if value, exists := parameter["parameter_default"]; exists {
				sample, err := file(value)
				return sample.path, err
			}
		}
	}
	return "", errors.New("Resemble returned no default reference recording")
}
func (s *stream) completedFile() (fileData, error) {
	defer s.release()
	defer s.decoder.Finish()
	for {
		chunk, err := s.body.Next(s.ctx)
		if err == io.EOF {
			return fileData{}, errors.New("Resemble event stream ended before completion")
		}
		if err != nil {
			return fileData{}, err
		}
		for _, b := range chunk {
			if err := s.ctx.Err(); err != nil {
				return fileData{}, err
			}
			message, err := s.decoder.Push(b)
			if err != nil {
				return fileData{}, err
			}
			if message == nil || message.Event == "heartbeat" {
				continue
			}
			if message.Event == "error" {
				return fileData{}, &Error{Body: message.Data, RequestID: s.requestID}
			}
			if message.Event != "complete" {
				return fileData{}, errors.New("Unexpected Resemble event: " + message.Event)
			}
			value, err := decode([]byte(message.Data))
			if err != nil {
				return fileData{}, err
			}
			outputs, ok := value.([]any)
			if !ok || len(outputs) != 1 {
				return fileData{}, errors.New("Resemble returned an invalid output list")
			}
			return file(outputs[0])
		}
	}
}
func contentType(headers http.Header) string {
	for name, values := range headers {
		if strings.EqualFold(name, "content-type") && len(values) > 0 {
			return strings.ToLower(strings.TrimSpace(strings.SplitN(values[0], ";", 2)[0]))
		}
	}
	return ""
}
func (s *stream) prepare() error {
	c := &s.config
	reference := ""
	if c.input.reference.Present {
		var payload bytes.Buffer
		writer := multipart.NewWriter(&payload)
		// Empty or non-WAV bytes remain exactly the supplied encoded reference.
		boundary := writer.Boundary()
		for bytes.Contains(c.input.reference.Value, []byte(boundary)) {
			boundary += "-"
		}
		if err := writer.SetBoundary(boundary); err != nil {
			return err
		}
		part, err := writer.CreatePart(textproto.MIMEHeader{"Content-Disposition": {`form-data; name="files"; filename="reference.audio"`}, "Content-Type": {"application/octet-stream"}})
		if err != nil {
			return err
		}
		if _, err := part.Write(c.input.reference.Value); err != nil {
			return err
		}
		if err := writer.Close(); err != nil {
			return err
		}
		headers := c.headers.Clone()
		headers.Set("Content-Type", writer.FormDataContentType())
		value, err := s.metadata("POST", endpoint(c.base, "upload"), headers, payload.Bytes())
		if err != nil {
			return err
		}
		paths, ok := value.([]any)
		if !ok || len(paths) != 1 {
			return errors.New("Resemble returned an invalid upload path")
		}
		reference, ok = paths[0].(string)
		if !ok || reference == "" {
			return errors.New("Resemble returned an invalid upload path")
		}
	} else if c.input.needsReference {
		value, err := s.metadata("GET", endpoint(c.base, "info"), c.headers, nil)
		if err != nil {
			return err
		}
		reference, err = defaultReference(value)
		if err != nil {
			return err
		}
	}
	if reference != "" {
		c.input.data[1] = map[string]any{"path": reference, "meta": map[string]any{"_type": "gradio.FileData"}}
	}
	payload, err := json.Marshal(map[string]any{"data": c.input.data})
	if err != nil {
		return err
	}
	headers := c.headers.Clone()
	headers.Set("Content-Type", "application/json")
	value, err := s.metadata("POST", endpoint(c.base, "call/"+c.input.api), headers, payload)
	if err != nil {
		return err
	}
	submitted, _ := value.(map[string]any)
	id, ok := submitted["event_id"].(string)
	if !ok || id == "" || id == "." || id == ".." {
		return errors.New("Resemble returned an invalid event ID")
	}
	s.requestID = runtime.Some(id)
	response, err := s.send("GET", endpoint(c.base, "call/"+c.input.api+"/"+component(id)), c.headers, nil)
	if err != nil {
		return err
	}
	if contentType(response.Header) != "text/event-stream" {
		return errors.New("Resemble returned no event stream")
	}
	file, err := s.completedFile()
	if err != nil {
		return err
	}
	target := endpoint(c.base, "file="+component(file.path))
	if file.url != "" {
		for _, r := range file.url {
			if r <= 32 || r == 127 || r == '\\' {
				return errors.New("Invalid Resemble deployment or audio URL")
			}
		}
		relative, err := url.Parse(file.url)
		if err != nil {
			return errors.New("Invalid Resemble deployment or audio URL")
		}
		target = c.base.ResolveReference(relative).String()
	}
	asset, err := parseURL(target)
	if err != nil {
		return err
	}
	sameOrigin := origin(asset) == origin(c.base)
	if asset.Scheme != "https" && !sameOrigin {
		return errors.New("Resemble returned an unsafe audio URL")
	}
	headers = http.Header{}
	if sameOrigin {
		headers = c.headers
	}
	response, err = s.send("GET", asset.String(), headers, nil)
	if err != nil {
		return err
	}
	mime := contentType(response.Header)
	if mime != "" && mime != "application/octet-stream" && !strings.HasPrefix(mime, "audio/") {
		return errors.New("Resemble returned no audio stream")
	}
	return nil
}
