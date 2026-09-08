// Package deepdub implements its HTTP protocol directly, not its partial OpenAPI.
package deepdub

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/deepdub"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type Options struct {
	Auth auth.Auth
	// Nil uses native HTTP with redirects disabled. Overrides must honor cancellation.
	Transport runtime.HTTPTransport
	BaseURL   string
	RequestID runtime.Optional[string]
	// Zero selects 1 MiB; negative limits fail before network access.
	MaxErrorBytes int
}

type Error struct {
	StatusCode   int
	GenerationID string
	Message      string
}

func (e *Error) Error() string {
	return fmt.Sprintf("Deepdub returned HTTP %d: %s", e.StatusCode, e.Message)
}

// Synthesize takes complete text and returns owned audio chunks. Always Close,
// including if unread. The context owns headers, reads and idle time between pulls.
func Synthesize(ctx context.Context, request schema.TtsRequest, options Options) (runtime.Input[[]byte], error) {
	if _, err := schema.ValidateRequest(request); err != nil {
		return nil, err
	}
	c, err := settings(request)
	if err != nil {
		return nil, err
	}
	if c.reference.Present && len(c.reference.Value) == 0 {
		return nil, errors.New("Deepdub referenceAudio must not be empty")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	limit := options.MaxErrorBytes
	if limit == 0 {
		limit = 1024 * 1024
	}
	if limit < 0 {
		return nil, errors.New("Deepdub MaxErrorBytes must be positive")
	}
	var key string
	if options.Auth.Deepdub.Present && options.Auth.Deepdub.Value.ApiKey.Present {
		key = options.Auth.Deepdub.Value.ApiKey.Value
	} else if value, present := os.LookupEnv("SPEECHSWITCH_DEEPDUB_API_KEY"); present {
		key = value
	} else {
		key = os.Getenv("DEEPDUB_API_KEY")
	}
	if key == "" {
		return nil, errors.New("Missing auth.deepdub.apiKey configuration")
	}
	base := options.BaseURL
	if base == "" {
		base = "https://restapi.deepdub.ai/api/v1"
	}
	target, err := url.Parse(base)
	if err != nil || target.Hostname() == "" || target.User != nil || target.Fragment != "" || (target.Scheme != "http" && target.Scheme != "https") {
		return nil, errors.New("Deepdub BaseURL must be an HTTP(S) URL without credentials or a fragment")
	}
	escaped := strings.TrimRight(target.EscapedPath(), "/") + "/tts"
	target.Path = strings.TrimRight(target.Path, "/") + "/tts"
	target.RawPath = escaped
	id := options.RequestID.Value
	if !options.RequestID.Present {
		var data [16]byte
		if _, err := rand.Read(data[:]); err != nil {
			return nil, err
		}
		data[6] = data[6]&15 | 64
		data[8] = data[8]&63 | 128
		id = fmt.Sprintf("%x-%x-%x-%x-%x", data[:4], data[4:6], data[6:8], data[8:10], data[10:])
	}
	encoded, err := json.Marshal(payload(c, id))
	if err != nil {
		return nil, err
	}
	operation, cancel := context.WithCancel(ctx)
	wire, err := http.NewRequestWithContext(operation, http.MethodPost, target.String(), bytes.NewReader(encoded))
	if err != nil {
		cancel()
		return nil, err
	}
	wire.Header.Set("x-api-key", key)
	wire.Header.Set("content-type", "application/json")
	transport := options.Transport
	if transport == nil {
		transport = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	response, err := runtime.OpenResponse(wire, transport)
	if err != nil {
		cancel()
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		defer cancel()
		defer response.Body.Close()
		return nil, responseError(operation, response, id, limit)
	}
	return &stream{ctx: operation, cancel: cancel, body: response.Body, verified: c.output.Format.LiteralValue() != "ogg_opus"}, nil
}

func responseError(ctx context.Context, response *runtime.HTTPResponse, id string, limit int) error {
	var data []byte
	for {
		chunk, err := response.Body.Next(ctx)
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if len(chunk) > limit-len(data) {
			return errors.New("Deepdub response exceeds MaxErrorBytes")
		}
		data = append(data, chunk...)
	}
	text := strings.TrimPrefix(strings.ToValidUTF8(string(data), "�"), "\ufeff")
	message := text
	var value struct {
		Message *string `json:"message"`
	}
	if json.Unmarshal([]byte(text), &value) == nil && value.Message != nil {
		message = *value.Message
	}
	if message == "" {
		message = http.StatusText(response.StatusCode)
	}
	for name, values := range response.Header {
		if strings.EqualFold(name, "x-generation-id") && len(values) != 0 {
			id = values[0]
			break
		}
	}
	return &Error{StatusCode: response.StatusCode, GenerationID: id, Message: message}
}
