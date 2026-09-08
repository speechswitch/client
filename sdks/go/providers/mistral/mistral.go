// Package mistral implements the documented Voxtral protocol directly. The
// cataloged OpenAPI contracts are incomplete and are not generation sources.
package mistral

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/mistral"
	out "github.com/speechswitch/client/sdks/go/generated/mistral_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type Options struct {
	Auth auth.Auth
	// Nil uses net/http with redirects disabled. Overrides must honor cancellation
	// and must not forward credentials across origins on redirects.
	Transport runtime.HTTPTransport
	BaseURL   string
	// Omission has no deadline; an explicit zero expires before network access.
	Timeout runtime.Optional[time.Duration]
	// Zero selects the defaults: 4 MiB per SSE event, 16 MiB per JSON/error body.
	MaxEventBytes int
	MaxJSONBytes  int
}

// Synthesize always returns a pull-based stream. Defer Close after opening it.
// Context/deadline cancellation releases the response even between Next calls.
func Synthesize(ctx context.Context, request schema.TtsRequest, options Options) (runtime.Input[out.SynthesisItem], error) {
	if _, err := schema.ValidateRequest(request); err != nil {
		return nil, err
	}
	var key string
	if options.Auth.Mistral.Present && options.Auth.Mistral.Value.ApiKey.Present {
		key = options.Auth.Mistral.Value.ApiKey.Value
	} else if scoped, present := os.LookupEnv("SPEECHSWITCH_MISTRAL_API_KEY"); present {
		key = scoped
	} else {
		key = os.Getenv("MISTRAL_API_KEY")
	}
	if key == "" {
		return nil, errors.New("Missing auth.mistral.apiKey configuration")
	}
	if options.Timeout.Present && options.Timeout.Value < 0 {
		return nil, errors.New("Mistral Timeout must not be negative")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if options.Timeout.Present && options.Timeout.Value == 0 {
		return nil, context.DeadlineExceeded
	}
	maxEventBytes, maxJSONBytes := options.MaxEventBytes, options.MaxJSONBytes
	if maxEventBytes == 0 {
		maxEventBytes = 4 * 1024 * 1024
	}
	if maxJSONBytes == 0 {
		maxJSONBytes = 16 * 1024 * 1024
	}
	if maxEventBytes < 0 || maxJSONBytes < 0 {
		return nil, errors.New("Mistral response byte limits must be positive")
	}
	baseURL := options.BaseURL
	if baseURL == "" {
		baseURL = "https://api.mistral.ai"
	}
	target, err := url.Parse(baseURL)
	if err != nil || target.Hostname() == "" || target.User != nil || target.Fragment != "" || (target.Scheme != "https" && target.Scheme != "http") {
		return nil, errors.New("Mistral BaseURL must be an HTTP(S) URL without credentials or a fragment")
	}
	escapedPath := strings.TrimRight(target.EscapedPath(), "/") + "/v1/audio/speech"
	target.Path = strings.TrimRight(target.Path, "/") + "/v1/audio/speech"
	target.RawPath = escapedPath
	format := "pcm"
	if request.Output.Present {
		format, err = outputFormat(request.Output.Value)
		if err != nil {
			return nil, err
		}
	}
	payload := map[string]any{"model": request.Model.Value.Value(), "input": request.Text, "stream": true, "response_format": format}
	if request.Voice.Present {
		payload["voice_id"] = request.Voice.Value
	}
	if request.ReferenceAudio.Present {
		payload["ref_audio"] = base64.StdEncoding.EncodeToString(request.ReferenceAudio.Value)
	}
	if request.PromptCacheKey.Present {
		payload["prompt_cache_key"] = request.PromptCacheKey.Value
	}
	if request.Metadata.Present {
		payload["metadata"], err = jsonValue(runtime.JsonObject(request.Metadata.Value))
		if err != nil {
			return nil, err
		}
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	var cancel context.CancelFunc
	if options.Timeout.Present {
		ctx, cancel = context.WithTimeout(ctx, options.Timeout.Value)
	} else {
		ctx, cancel = context.WithCancel(ctx)
	}
	wire, err := http.NewRequestWithContext(ctx, http.MethodPost, target.String(), bytes.NewReader(encoded))
	if err != nil {
		cancel()
		return nil, err
	}
	wire.Header.Set("Authorization", "Bearer "+key)
	wire.Header.Set("Content-Type", "application/json")
	wire.Header.Set("Accept", "text/event-stream, application/json")
	transport := options.Transport
	if transport == nil {
		transport = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	response, err := runtime.OpenResponse(wire, transport)
	if err != nil {
		cancel()
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		cancel()
		response.Body.Close()
		return nil, err
	}
	decoder, err := runtime.NewSSEDecoder(maxEventBytes)
	if err != nil {
		cancel()
		response.Body.Close()
		return nil, err
	}
	return &stream{ctx: ctx, cancel: cancel, response: response, decoder: decoder, maxJSONBytes: maxJSONBytes,
		contentType: strings.ToLower(strings.TrimSpace(strings.SplitN(response.Header.Get("Content-Type"), ";", 2)[0]))}, nil
}

type stream struct {
	ctx           context.Context
	cancel        context.CancelFunc
	response      *runtime.HTTPResponse
	decoder       *runtime.SSEDecoder
	contentType   string
	maxJSONBytes  int
	once          sync.Once
	closeError    error
	mutex         sync.Mutex
	buffer        []byte
	receivedAudio bool
	terminal      bool
	jsonDone      bool
}

func (s *stream) closeBody() error {
	s.once.Do(func() { s.cancel(); s.closeError = s.response.Body.Close() })
	return s.closeError
}

func (s *stream) Close() error {
	err := s.closeBody()
	s.mutex.Lock()
	s.buffer = nil
	s.decoder.Finish()
	s.mutex.Unlock()
	return err
}

func (s *stream) Next(ctx context.Context) (out.SynthesisItem, error) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	if s.terminal {
		return nil, io.EOF
	}
	item, err := s.next(ctx)
	if err == nil {
		err = ctx.Err()
		if err == nil {
			err = s.ctx.Err()
		}
		if err != nil {
			item = nil
		}
	}
	_, done := item.(out.SynthesisItemAsDone)
	if err != nil || done {
		s.terminal = true
		s.closeBody()
		s.buffer = nil
		s.decoder.Finish()
	}
	return item, err
}

func (s *stream) next(ctx context.Context) (out.SynthesisItem, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := s.ctx.Err(); err != nil {
		return nil, err
	}
	if s.jsonDone {
		return out.SynthesisItemAsDone{}, nil
	}
	if s.response.StatusCode < 200 || s.response.StatusCode >= 300 || s.contentType == "application/json" {
		var data []byte
		for {
			chunk, err := s.response.Body.Next(ctx)
			if err != nil && err != io.EOF {
				return nil, err
			}
			if len(chunk) > s.maxJSONBytes-len(data) {
				return nil, errors.New("Mistral response exceeds MaxJSONBytes")
			}
			data = append(data, chunk...)
			if err == io.EOF {
				break
			}
		}
		if s.response.StatusCode < 200 || s.response.StatusCode >= 300 {
			retry := runtime.Optional[string]{}
			if values, present := s.response.Header["Retry-After"]; present && len(values) > 0 {
				retry = runtime.Some(values[0])
			}
			return nil, &Error{StatusCode: s.response.StatusCode, Body: runtime.DecodeUTF8(data), RetryAfter: retry}
		}
		value, err := object(data)
		if err != nil {
			return nil, err
		}
		audio, err := audioData(value["audio_data"])
		if err != nil {
			return nil, err
		}
		if len(audio) == 0 {
			return nil, errors.New("Mistral returned no audio")
		}
		s.jsonDone = true
		return out.SynthesisItemAsBytes{Value: audio}, nil
	}
	if s.contentType != "text/event-stream" {
		return nil, errors.New("Mistral returned an unsupported response content type")
	}
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if err := s.ctx.Err(); err != nil {
			return nil, err
		}
		if len(s.buffer) == 0 {
			chunk, err := s.response.Body.Next(ctx)
			if err == io.EOF {
				return nil, errors.New("Mistral speech stream ended before speech.audio.done")
			}
			if err != nil {
				return nil, err
			}
			s.buffer = chunk
		}
		for len(s.buffer) > 0 {
			message, err := s.decoder.Push(s.buffer[0])
			s.buffer = s.buffer[1:]
			if err != nil {
				return nil, err
			}
			if message == nil {
				continue
			}
			item, err := decodeEvent(*message)
			if err != nil {
				return nil, err
			}
			if audio, ok := item.(out.SynthesisItemAsBytes); ok {
				if len(audio.Value) == 0 {
					continue
				}
				s.receivedAudio = true
			} else if !s.receivedAudio {
				return nil, errors.New("Mistral returned no audio")
			}
			return item, nil
		}
	}
}

func outputFormat(value schema.TtsRequestOutput) (string, error) {
	switch value := value.(type) {
	case schema.TtsRequestOutputAsPcm:
		return value.Value.Format.Value(), nil
	case *schema.TtsRequestOutputAsPcm:
		return value.Value.Format.Value(), nil
	case schema.TtsRequestOutputAsObject:
		return encodedFormat(value.Value.Format)
	case *schema.TtsRequestOutputAsObject:
		return encodedFormat(value.Value.Format)
	default:
		return "", errors.New("Unsupported generated Mistral output representation")
	}
}

func encodedFormat(value schema.TtsRequestOutputObjectFormat) (string, error) {
	switch value := value.(type) {
	case schema.TtsRequestOutputObjectFormatAsFlac:
		return value.Value.Value(), nil
	case *schema.TtsRequestOutputObjectFormatAsFlac:
		return value.Value.Value(), nil
	case schema.TtsRequestOutputObjectFormatAsMp3:
		return value.Value.Value(), nil
	case *schema.TtsRequestOutputObjectFormatAsMp3:
		return value.Value.Value(), nil
	case schema.TtsRequestOutputObjectFormatAsOpus:
		return value.Value.Value(), nil
	case *schema.TtsRequestOutputObjectFormatAsOpus:
		return value.Value.Value(), nil
	case schema.TtsRequestOutputObjectFormatAsWav:
		return value.Value.Value(), nil
	case *schema.TtsRequestOutputObjectFormatAsWav:
		return value.Value.Value(), nil
	default:
		return "", errors.New("Unsupported generated Mistral format representation")
	}
}

// Called only after generated validation: convert the closed JSON algebra to
// encoding/json values, including nil collections as empty rather than null.
func jsonValue(value runtime.JsonValue) (any, error) {
	switch value := value.(type) {
	case runtime.JsonNull, *runtime.JsonNull:
		return nil, nil
	case runtime.JsonBool:
		return bool(value), nil
	case *runtime.JsonBool:
		return bool(*value), nil
	case runtime.JsonNumber:
		return float64(value), nil
	case *runtime.JsonNumber:
		return float64(*value), nil
	case runtime.JsonString:
		return string(value), nil
	case *runtime.JsonString:
		return string(*value), nil
	case *runtime.JsonArray:
		return jsonValue(*value)
	case *runtime.JsonObject:
		return jsonValue(*value)
	case runtime.JsonArray:
		result := make([]any, len(value))
		for index, child := range value {
			converted, err := jsonValue(child)
			if err != nil {
				return nil, err
			}
			result[index] = converted
		}
		return result, nil
	case runtime.JsonObject:
		result := make(map[string]any, len(value))
		for key, child := range value {
			converted, err := jsonValue(child)
			if err != nil {
				return nil, err
			}
			result[key] = converted
		}
		return result, nil
	default:
		return nil, errors.New("Unsupported generated JSON representation")
	}
}
