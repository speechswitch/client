// Package elevenlabs implements the cataloged HTTP and input-stream protocols.
package elevenlabs

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/elevenlabs"
	out "github.com/speechswitch/client/sdks/go/generated/elevenlabs_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type Options struct {
	Auth auth.Auth
	// Nil uses native HTTP/WebSockets. Overrides must honor cancellation.
	Transport             runtime.HTTPTransport
	WebSocket             runtime.WebSocketLike
	BaseURL, WebSocketURL string
	RequestLogging        runtime.Optional[bool]
	// Zero selects 16 MiB per JSON record/body and 4 MiB per socket message.
	MaxJSONBytes, MaxMessageBytes int
}

// Synthesize always returns owned streaming items. Close even an unread stream.
// ctx owns setup, input, I/O and idle time; a Next context can cancel it too.
func Synthesize(ctx context.Context, request schema.TtsRequest, options Options) (runtime.Input[out.SynthesisItem], error) {
	validate, err := schema.ValidateRequest(request)
	if err != nil {
		return nil, err
	}
	c, err := settings(request)
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	jsonLimit, messageLimit := options.MaxJSONBytes, options.MaxMessageBytes
	if jsonLimit == 0 {
		jsonLimit = 16 * 1024 * 1024
	}
	if messageLimit == 0 {
		messageLimit = 4 * 1024 * 1024
	}
	if jsonLimit < 0 || messageLimit < 0 {
		return nil, errors.New("ElevenLabs byte limits must be positive")
	}
	var key string
	var token runtime.Optional[string]
	if options.Auth.Elevenlabs.Present {
		token = options.Auth.Elevenlabs.Value.SingleUseToken
	}
	if options.Auth.Elevenlabs.Present && options.Auth.Elevenlabs.Value.ApiKey.Present {
		key = options.Auth.Elevenlabs.Value.ApiKey.Value
	} else if value, present := os.LookupEnv("SPEECHSWITCH_ELEVENLABS_API_KEY"); present {
		key = value
	} else {
		key = os.Getenv("ELEVENLABS_API_KEY")
	}
	if c.input == nil && key == "" {
		return nil, errors.New("Missing auth.elevenlabs.apiKey configuration")
	}
	if c.input != nil && ((token.Present && token.Value == "") || (!token.Present && key == "")) {
		return nil, errors.New("Missing auth.elevenlabs.apiKey or singleUseToken configuration")
	}
	format, err := outputFormat(c.output)
	if err != nil {
		return nil, err
	}
	model := map[string]string{"flash-v2": "eleven_flash_v2", "flash-v2.5": "eleven_flash_v2_5", "multilingual-v2": "eleven_multilingual_v2", "eleven-v3": "eleven_v3"}[c.model]
	logging := true
	if options.RequestLogging.Present {
		logging = options.RequestLogging.Value
	}
	target, err := speechURL(c, options.BaseURL, options.WebSocketURL, format, model, token, logging)
	if err != nil {
		return nil, err
	}
	voice := map[string]any{}
	for _, field := range []struct {
		name  string
		value runtime.Optional[float64]
	}{
		{"stability", c.stability}, {"similarity_boost", c.similarity}, {"style", c.style}, {"speed", c.speed},
	} {
		if field.value.Present {
			voice[field.name] = field.value.Value
		}
	}
	if c.boost.Present {
		voice["use_speaker_boost"] = c.boost.Value
	}
	body := map[string]any{"voice_settings": voice}
	if c.dictionaries.Present {
		body["pronunciation_dictionary_locators"] = c.dictionaries.Value
	}
	if c.input != nil {
		dialogue := c.model == "eleven-v3"
		if !dialogue && !c.unbuffered {
			schedule := []float64{120, 160, 250, 290}
			if c.schedule.Present {
				schedule = append([]float64{}, c.schedule.Value...)
			}
			body["generation_config"] = map[string]any{"chunk_length_schedule": schedule}
		}
		operation, cancel := context.WithCancel(ctx)
		socket := options.WebSocket
		if socket == nil {
			header := http.Header{}
			if !token.Present {
				header.Set("xi-api-key", key)
			}
			socket, err = runtime.ConnectWebSocket(operation, target, runtime.WebSocketOptions{Header: header, MaxMessageBytes: messageLimit})
			if err != nil {
				cancel()
				return nil, err
			}
		} else if !token.Present {
			body["xi_api_key"] = key
		}
		s := &socketStream{parent: ctx, ctx: operation, cancel: cancel, socket: socket, input: c.input, validate: validate,
			voice: c.voice, dialogue: dialogue, timed: c.timed, normalized: c.normalized, settings: body, maxMessage: messageLimit,
			retired: map[string]bool{}, preferOutput: true, heartbeatInterval: 10 * time.Second}
		s.stop = context.AfterFunc(operation, func() { s.closeResources() })
		return s, nil
	}
	body["text"], body["model_id"] = c.text, model
	body["apply_text_normalization"], body["apply_language_text_normalization"] = c.normalization, c.languageNormalization
	if c.language.Present {
		body["language_code"] = c.language.Value
	}
	if c.seed.Present {
		body["seed"] = c.seed.Value
	}
	if c.before.Present {
		contextFields(c.before.Value, "previous", body)
	}
	if c.after.Present {
		contextFields(c.after.Value, "next", body)
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	wire, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(encoded))
	if err != nil {
		return nil, err
	}
	wire.Header.Set("xi-api-key", key)
	wire.Header.Set("content-type", "application/json")
	transport := options.Transport
	if transport == nil {
		transport = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	response, err := runtime.OpenResponse(wire, transport)
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		response.Body.Close()
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		defer response.Body.Close()
		data, err := readAll(ctx, response.Body, jsonLimit)
		if err != nil {
			return nil, err
		}
		payload, err := load(data)
		if err != nil {
			payload = strings.ToValidUTF8(string(data), "\ufffd")
		}
		failure := responseError(payload, float64(response.StatusCode))
		for key, values := range response.Header {
			if strings.EqualFold(key, "request-id") && len(values) > 0 {
				failure.RequestID = runtime.Some(values[0])
				break
			}
		}
		return nil, failure
	}
	return &httpStream{ctx: ctx, body: response.Body, timed: c.timed, wav: strings.HasPrefix(format, "wav_"), normalized: c.normalized, limit: jsonLimit, first: true}, nil
}

func speechURL(c configuration, base, override, format, model string, token runtime.Optional[string], logging bool) (string, error) {
	streaming := c.input != nil
	endpoint := base
	if endpoint == "" {
		endpoint = "https://api.elevenlabs.io"
	}
	if streaming && override != "" {
		endpoint = override
	}
	u, err := url.Parse(endpoint)
	if err != nil || u.Hostname() == "" || u.User != nil || u.Fragment != "" || u.Opaque != "" ||
		strings.ContainsFunc(endpoint, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) || r == '\\' }) ||
		(!streaming && u.Scheme != "http" && u.Scheme != "https") ||
		(streaming && u.Scheme != "http" && u.Scheme != "https" && u.Scheme != "ws" && u.Scheme != "wss") {
		return "", errors.New("Invalid ElevenLabs endpoint URL")
	}
	if port := u.Port(); port != "" {
		if _, err := strconv.ParseUint(port, 10, 16); err != nil {
			return "", errors.New("Invalid ElevenLabs endpoint URL")
		}
	}
	query, err := url.ParseQuery(u.RawQuery)
	if err != nil {
		return "", errors.New("Invalid ElevenLabs endpoint query")
	}
	for _, name := range []string{"output_format", "enable_logging", "optimize_streaming_latency", "model_id", "sync_alignment", "apply_text_normalization", "language_code", "seed", "single_use_token", "authorization", "xi-api-key", "xi_api_key", "api_key", "inactivity_timeout", "auto_mode", "enable_ssml_parsing"} {
		query.Del(name)
	}
	query.Set("output_format", format)
	query.Set("enable_logging", strconv.FormatBool(logging))
	path := u.EscapedPath()
	if streaming {
		if override == "" {
			suffix := "/v1/text-to-speech/" + url.PathEscape(c.voice) + "/multi-stream-input"
			if c.model == "eleven-v3" {
				suffix = "/v1/text-to-dialogue/stream-input"
			}
			path = strings.TrimRight(path, "/") + suffix
		}
		query.Set("model_id", model)
		query.Set("sync_alignment", strconv.FormatBool(c.timed))
		query.Set("apply_text_normalization", c.normalization)
		if c.language.Present {
			query.Set("language_code", c.language.Value)
		}
		if c.seed.Present {
			query.Set("seed", strconv.FormatFloat(c.seed.Value, 'f', -1, 64))
		}
		if token.Present {
			query.Set("single_use_token", token.Value)
		}
		if c.model != "eleven-v3" {
			query.Set("inactivity_timeout", "20")
			query.Set("auto_mode", strconv.FormatBool(c.unbuffered))
			query.Set("enable_ssml_parsing", strconv.FormatBool(c.ssml))
		}
		if u.Scheme == "https" {
			u.Scheme = "wss"
		} else if u.Scheme == "http" {
			u.Scheme = "ws"
		}
	} else {
		path = strings.TrimRight(path, "/") + "/v1/text-to-speech/" + url.PathEscape(c.voice)
		if !strings.HasPrefix(format, "wav_") {
			path += "/stream"
		}
		if c.timed {
			path += "/with-timestamps"
		}
		if c.latency != "" {
			query.Set("optimize_streaming_latency", map[string]string{"none": "0", "moderate": "1", "strong": "2", "aggressive": "3", "maximum": "4"}[c.latency])
		}
	}
	u.Path, err = url.PathUnescape(path)
	if err != nil {
		return "", errors.New("Invalid ElevenLabs endpoint path")
	}
	u.RawPath, u.RawQuery = path, query.Encode()
	return u.String(), nil
}
