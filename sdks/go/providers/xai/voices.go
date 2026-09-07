package xai

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	out "github.com/speechswitch/client/sdks/go/generated/xai_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type VoiceOptions struct {
	Auth auth.Auth
	// Nil uses native HTTP; overrides must honor cancellation and reject redirects/retries/ambient credentials.
	Transport runtime.HTTPTransport
	BaseURL   string
	TimeoutMs runtime.Optional[int64]
	// Zero selects 4 MiB.
	MaxResponseBytes int
}

// Voices lists built-in voices. Existing custom IDs can be sent directly to Synthesize.
func Voices(ctx context.Context, options VoiceOptions) ([]out.Voice, error) {
	value, err := discovery(ctx, "/v1/tts/voices", options)
	if err != nil {
		return nil, err
	}
	object, ok := value.(map[string]any)
	if !ok {
		return nil, errors.New("Invalid xAI voice list")
	}
	items, ok := object["voices"].([]any)
	if !ok {
		return nil, errors.New("Invalid xAI voice list")
	}
	voices := make([]out.Voice, len(items))
	for i, item := range items {
		voices[i], err = decodeVoice(item)
		if err != nil {
			return nil, err
		}
	}
	return voices, nil
}
func Voice(ctx context.Context, id string, options VoiceOptions) (out.Voice, error) {
	if id == "" || !utf8.ValidString(id) {
		return out.Voice{}, errors.New("xAI voice ID must be a nonempty UTF-8 string")
	}
	// Keep arbitrary IDs, including dot segments and reserved characters, in one path component.
	encoded := strings.ReplaceAll(url.QueryEscape(id), "+", "%20")
	encoded = strings.ReplaceAll(encoded, ".", "%2E")
	value, err := discovery(ctx, "/v1/tts/voices/"+encoded, options)
	if err != nil {
		return out.Voice{}, err
	}
	return decodeVoice(value)
}
func decodeVoice(value any) (out.Voice, error) {
	result := out.Voice{}
	object, ok := value.(map[string]any)
	if !ok {
		return result, errors.New("Invalid xAI voice")
	}
	id, idOK := object["voice_id"].(string)
	name, nameOK := object["name"].(string)
	if !idOK || !nameOK {
		return result, errors.New("Invalid xAI voice")
	}
	result.VoiceId, result.Name = id, name
	if language, present := object["language"]; present {
		var value out.VoiceLanguage
		if language == nil {
			value = out.VoiceLanguageAsNull{}
		} else {
			text, ok := language.(string)
			if !ok {
				return result, errors.New("Invalid xAI voice language")
			}
			value = out.VoiceLanguageAsString{Value: text}
		}
		result.Language = runtime.Some(value)
	}
	return result, nil
}
func discovery(ctx context.Context, path string, options VoiceOptions) (value any, err error) {
	key, err := apiKey(options.Auth)
	if err != nil {
		return nil, err
	}
	limit := options.MaxResponseBytes
	if limit == 0 {
		limit = 4 * 1024 * 1024
	}
	if limit < 0 || uint64(limit) > 9007199254740991 {
		return nil, errors.New("xAI MaxResponseBytes must be a positive safe integer")
	}
	base := options.BaseURL
	if base == "" {
		base = "https://api.x.ai"
	}
	address, err := endpoint(base, path, false)
	if err != nil {
		return nil, err
	}
	operation, cancel, err := operationContext(ctx, options.TimeoutMs)
	if err != nil {
		return nil, err
	}
	defer cancel()
	request, err := http.NewRequestWithContext(operation, "GET", address, nil)
	if err != nil {
		return nil, err
	}
	request.Header = http.Header{"Authorization": {"Bearer " + key}, "Accept": {"application/json"}}
	transport := options.Transport
	if transport == nil {
		transport = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	response, err := runtime.OpenResponse(request, transport)
	if err != nil {
		return nil, err
	}
	defer func() {
		closeErr := response.Body.Close()
		if err == nil {
			err = closeErr
		}
	}()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, &Error{Status: runtime.Some(response.StatusCode)}
	}
	if err := contentType(response.Header, true); err != nil {
		return nil, err
	}
	return readJSON(operation, response.Body, limit)
}
