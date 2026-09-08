// Package deepgram implements Aura directly; its partial contracts are not wire-codegen input.
package deepgram

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"unicode"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/deepgram"
	out "github.com/speechswitch/client/sdks/go/generated/deepgram_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type Options struct {
	Auth auth.Auth
	// Nil selects native HTTP/WebSockets. Overrides must honor cancellation.
	Transport             runtime.HTTPTransport
	WebSocket             runtime.WebSocketLike
	BaseURL, WebSocketURL string
	// Zero selects 4 MiB; negative limits fail before network access.
	MaxMessageBytes int
}

// Synthesize returns owned audio/control items. Always Close, including if unread.
// The context owns headers, reads, writes and idle time. Each Next may cancel too.
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
	limit := options.MaxMessageBytes
	if limit == 0 {
		limit = 4 * 1024 * 1024
	}
	if limit < 0 {
		return nil, errors.New("Deepgram MaxMessageBytes must be positive")
	}
	var key string
	if options.Auth.Deepgram.Present && options.Auth.Deepgram.Value.ApiKey.Present {
		key = options.Auth.Deepgram.Value.ApiKey.Value
	} else if value, present := os.LookupEnv("SPEECHSWITCH_DEEPGRAM_API_KEY"); present {
		key = value
	} else {
		key = os.Getenv("DEEPGRAM_API_KEY")
	}
	if key == "" {
		return nil, errors.New("Missing auth.deepgram.apiKey configuration")
	}
	endpoint := options.BaseURL
	if endpoint == "" {
		endpoint = "https://api.deepgram.com"
	}
	if c.input != nil {
		endpoint = options.WebSocketURL
		if endpoint == "" {
			endpoint = "wss://api.deepgram.com/v1/speak"
		}
	}
	target, err := speechURL(c, endpoint)
	if err != nil {
		return nil, err
	}
	if c.input != nil {
		operation, cancel := context.WithCancel(ctx)
		socket := options.WebSocket
		if socket == nil {
			socket, err = runtime.ConnectWebSocket(operation, target, runtime.WebSocketOptions{Header: http.Header{"Authorization": {"Token " + key}}, MaxMessageBytes: limit})
			if err != nil {
				cancel()
				return nil, err
			}
		}
		s := &socketStream{ctx: operation, cancel: cancel, socket: socket, input: c.input, validate: validate, maxMessage: limit, preferOutput: true}
		s.stop = context.AfterFunc(operation, func() { s.closeResources() })
		return s, nil
	}
	encoded, err := json.Marshal(map[string]string{"text": c.text})
	if err != nil {
		return nil, err
	}
	wire, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(encoded))
	if err != nil {
		return nil, err
	}
	wire.Header.Set("authorization", "Token "+key)
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
		response.Body.Close()
		return nil, fmt.Errorf("Deepgram returned HTTP %d", response.StatusCode)
	}
	contentType := ""
	for name, values := range response.Header {
		if strings.EqualFold(name, "content-type") && len(values) != 0 {
			contentType = values[0]
			break
		}
	}
	contentType = strings.ToLower(strings.TrimSpace(strings.SplitN(contentType, ";", 2)[0]))
	if contentType != "" && !strings.HasPrefix(contentType, "audio/") && contentType != "application/octet-stream" {
		response.Body.Close()
		return nil, errors.New("Deepgram returned an unexpected audio content type")
	}
	return &httpStream{ctx: ctx, body: response.Body}, nil
}

func speechURL(c configuration, endpoint string) (string, error) {
	u, err := url.Parse(endpoint)
	streaming := c.input != nil
	if err != nil || u.Hostname() == "" || u.User != nil || u.Fragment != "" || strings.ContainsFunc(endpoint, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) || r == '\\' }) || (!streaming && u.Scheme != "http" && u.Scheme != "https") || (streaming && u.Scheme != "ws" && u.Scheme != "wss") {
		return "", errors.New("Invalid Deepgram endpoint URL")
	}
	if port := u.Port(); port != "" {
		if _, err := strconv.ParseUint(port, 10, 16); err != nil {
			return "", errors.New("Invalid Deepgram endpoint URL")
		}
	}
	query, err := url.ParseQuery(u.RawQuery)
	if err != nil {
		return "", errors.New("Invalid Deepgram endpoint query")
	}
	for _, name := range []string{"model", "encoding", "container", "sample_rate", "bit_rate", "speed", "mip_opt_out", "tag", "api_key", "access_token"} {
		query.Del(name)
	}
	output, err := outputQuery(c.output, streaming)
	if err != nil {
		return "", err
	}
	for key, values := range output {
		query[key] = values
	}
	model := c.model
	if model == "aura-1" {
		model = "aura"
	}
	query.Set("model", model+"-"+c.voice+"-"+c.language)
	if c.speed.Present {
		query.Set("speed", strconv.FormatFloat(c.speed.Value, 'f', -1, 64))
	}
	if c.mip.Present {
		query.Set("mip_opt_out", strconv.FormatBool(c.mip.Value.LiteralValue()))
	}
	if c.tags.Present {
		for _, tag := range c.tags.Value {
			query.Add("tag", tag)
		}
	}
	if !streaming {
		escaped := strings.TrimRight(u.EscapedPath(), "/") + "/v1/speak"
		u.Path = strings.TrimRight(u.Path, "/") + "/v1/speak"
		u.RawPath = escaped
	}
	u.RawQuery = query.Encode()
	return u.String(), nil
}

type httpStream struct {
	ctx      context.Context
	body     runtime.Input[[]byte]
	mutex    sync.Mutex
	closed   atomic.Bool
	received bool
}

func (s *httpStream) Close() error { s.closed.Store(true); return s.body.Close() }
func (s *httpStream) Next(ctx context.Context) (out.SynthesisItem, error) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	if s.closed.Load() {
		return nil, io.EOF
	}
	data, err := s.body.Next(ctx)
	if err == io.EOF && !s.received {
		err = errors.New("Deepgram returned no audio bytes")
	}
	if cause := ctx.Err(); cause != nil {
		err = cause
	} else if cause := s.ctx.Err(); cause != nil {
		err = cause
	}
	if err != nil {
		s.Close()
		return nil, err
	}
	s.received = true
	return out.SynthesisItemAsBytes{Value: data}, nil
}
