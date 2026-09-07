package lovo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	wire "github.com/speechswitch/client/sdks/go/clients/lovo"
	out "github.com/speechswitch/client/sdks/go/generated/lovo_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func (s *stream) Next(ctx context.Context) (out.SynthesisItem, error) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	if s.terminal || s.closed.Load() {
		return out.SynthesisItem{}, io.EOF
	}
	stop := context.AfterFunc(ctx, s.cancel)
	defer stop()
	item, err := s.next(ctx)
	if cause := ctx.Err(); cause != nil {
		item, err = out.SynthesisItem{}, cause
	} else if cause := s.ctx.Err(); cause != nil {
		item, err = out.SynthesisItem{}, cause
	}
	if err != nil {
		s.terminal = true
		s.assets = nil
		s.Close()
	}
	return item, err
}
func (s *stream) next(ctx context.Context) (out.SynthesisItem, error) {
	if err := ctx.Err(); err != nil {
		return out.SynthesisItem{}, err
	}
	if err := s.ctx.Err(); err != nil {
		return out.SynthesisItem{}, err
	}
	if !s.started {
		s.started = true
		if err := s.prepare(); err != nil {
			return out.SynthesisItem{}, err
		}
	}
	for s.index < len(s.assets) {
		if err := s.ctx.Err(); err != nil {
			return out.SynthesisItem{}, err
		}
		asset := s.assets[s.index]
		s.resources.Lock()
		body := s.body
		s.resources.Unlock()
		if body == nil {
			request, err := http.NewRequestWithContext(s.ctx, http.MethodGet, asset.url, nil)
			if err != nil {
				return out.SynthesisItem{}, errors.New("Invalid LOVO asset URL")
			}
			// A provider URL never receives API credentials or browser cookies.
			response, err := runtime.OpenResponse(request, s.config.transport)
			if err != nil {
				return out.SynthesisItem{}, err
			}
			if err := s.bind(response.Body); err != nil {
				return out.SynthesisItem{}, err
			}
			if response.StatusCode < 200 || response.StatusCode >= 300 {
				data, err := s.read(response)
				if err != nil {
					return out.SynthesisItem{}, err
				}
				message := string(data)
				if message == "" {
					message = fmt.Sprintf("LOVO audio download returned HTTP %d", response.StatusCode)
				}
				return out.SynthesisItem{}, &Error{Message: message, StatusCode: runtime.Some(response.StatusCode),
					JobID: runtime.Some(s.jobID), RetryAfter: retryAfter(response.Header)}
			}
			body = response.Body
		}
		audio, err := body.Next(s.ctx)
		if err == io.EOF {
			s.release()
			s.index++
			continue
		}
		if err != nil {
			return out.SynthesisItem{}, err
		}
		if len(audio) == 0 {
			continue
		}
		return out.SynthesisItem{CorrelationId: asset.correlationID, InputGroupId: asset.inputGroupID, Audio: audio}, nil
	}
	return out.SynthesisItem{}, io.EOF
}

func (s *stream) read(response *runtime.HTTPResponse) ([]byte, error) {
	defer s.release()
	var data []byte
	for {
		chunk, err := response.Body.Next(s.ctx)
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		if len(chunk) > s.config.limit-len(data) {
			return nil, errors.New("LOVO response exceeds MaxJSONBytes")
		}
		data = append(data, chunk...)
	}
	return []byte(strings.TrimPrefix(runtime.DecodeUTF8(data), "\ufeff")), nil
}
func (s *stream) metadata(response *runtime.HTTPResponse, status int) ([]byte, error) {
	if err := s.bind(response.Body); err != nil {
		return nil, err
	}
	data, err := s.read(response)
	if err != nil {
		return nil, err
	}
	if response.StatusCode != status {
		message := string(data)
		if message == "" {
			message = fmt.Sprintf("LOVO returned HTTP %d; expected %d", response.StatusCode, status)
		}
		return nil, &Error{Message: message, StatusCode: runtime.Some(response.StatusCode), RetryAfter: retryAfter(response.Header)}
	}
	if !json.Valid(data) {
		return nil, errors.New("LOVO returned invalid JSON")
	}
	return data, nil
}
func retryAfter(header http.Header) runtime.Optional[string] {
	for key, values := range header {
		if strings.EqualFold(key, "retry-after") {
			return runtime.Some(strings.Join(values, ", "))
		}
	}
	return runtime.Optional[string]{}
}
func (s *stream) poll(id string) (wire.GetSpeechJobResponse, error) {
	response, err := wire.GetSpeechJob(s.ctx, wire.GetSpeechJobInput{JobId: id}, s.config.key, s.config.baseURL, s.config.transport)
	if err != nil {
		return wire.GetSpeechJobResponse{}, err
	}
	data, err := s.metadata(response, wire.GetSpeechJobStatus)
	if err != nil {
		return wire.GetSpeechJobResponse{}, err
	}
	return wire.DecodeGetSpeechJob(data)
}
func (s *stream) prepare() error {
	c := &s.config
	var id, kind, status string
	var failure runtime.Optional[wire.JobErrorResponse]
	var outputs []wire.TextToSpeechOutput
	completed := !c.async
	if c.async {
		response, err := wire.CreateSpeechJob(s.ctx, wire.CreateSpeechJobInput{Text: c.input.Text, Speaker: c.input.Speaker, SpeakerStyle: c.input.SpeakerStyle, Speed: c.input.Speed}, c.key, c.baseURL, c.transport)
		if err != nil {
			return err
		}
		data, err := s.metadata(response, wire.CreateSpeechJobStatus)
		if err != nil {
			return err
		}
		job, err := wire.DecodeCreateSpeechJob(data)
		if err != nil {
			return err
		}
		id, kind, status, failure = job.Id, job.Type, job.Status, job.Error
	} else {
		response, err := wire.CreateSpeech(s.ctx, c.input, c.key, c.baseURL, c.transport)
		if err != nil {
			return err
		}
		data, err := s.metadata(response, wire.CreateSpeechStatus)
		if err != nil {
			return err
		}
		job, err := wire.DecodeCreateSpeech(data)
		if err != nil {
			return err
		}
		id, kind, status, failure, outputs = job.Id, job.Type, job.Status, job.Error, job.Data
	}
	if id == "" || id == "." || id == ".." {
		return errors.New("LOVO returned an invalid job ID")
	}
	for {
		if kind != "tts" && kind != "simple_tts" {
			return errors.New("LOVO returned a non-TTS job")
		}
		if failure.Present {
			return &Error{Message: failure.Value.Message, Code: runtime.Some(failure.Value.Code), JobID: runtime.Some(id)}
		}
		if status == "done" {
			if !completed {
				job, err := s.poll(id)
				if err != nil {
					return err
				}
				if job.Id != id || job.Status != "done" || (job.Type != "tts" && job.Type != "simple_tts") {
					return errors.New("LOVO returned an inconsistent completed job")
				}
				if job.Error.Present {
					return &Error{Message: job.Error.Value.Message, Code: runtime.Some(job.Error.Value.Code), JobID: runtime.Some(id)}
				}
				outputs = job.Data
			}
			break
		}
		timer := time.NewTimer(c.interval)
		select {
		case <-timer.C:
		case <-s.ctx.Done():
			timer.Stop()
			return s.ctx.Err()
		}
		job, err := s.poll(id)
		if err != nil {
			return err
		}
		if job.Id != id {
			return errors.New("LOVO returned a different job ID while polling")
		}
		kind, status, failure, outputs, completed = job.Type, job.Status, job.Error, job.Data, true
	}
	if len(outputs) == 0 {
		return errors.New("LOVO completed without audio outputs")
	}
	for outputIndex, output := range outputs {
		if output.Error.Present {
			return &Error{Message: output.Error.Value.Message, Code: runtime.Some(output.Error.Value.Code), JobID: runtime.Some(id)}
		}
		if output.Status == "failed" {
			return &Error{Message: "LOVO speech output failed", JobID: runtime.Some(id)}
		}
		if output.Status != "succeeded" || !output.Urls.Present || len(output.Urls.Value) == 0 {
			return errors.New("LOVO completed without usable audio URLs")
		}
		for index, value := range output.Urls.Value {
			u, err := endpoint(value)
			if err != nil {
				return err
			}
			if u.Scheme != "https" && origin(u) != c.origin {
				return errors.New("LOVO returned an unsafe audio URL")
			}
			s.assets = append(s.assets, asset{url: u.String(), correlationID: fmt.Sprintf("%s:%d:%d", id, outputIndex, index), inputGroupID: fmt.Sprintf("%s:%d", id, outputIndex)})
		}
	}
	s.jobID = id
	return nil
}
