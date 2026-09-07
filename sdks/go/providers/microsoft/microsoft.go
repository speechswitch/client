// Package microsoft implements Azure Speech's SSML HTTP and byte-native socket protocols.
package microsoft

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/microsoft"
	out "github.com/speechswitch/client/sdks/go/generated/microsoft_output"
	"github.com/speechswitch/client/sdks/go/runtime"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"unicode"
)

type Options struct {
	Auth auth.Auth
	// Nil uses native HTTP/WebSockets; an injected socket is exclusively owned.
	Transport             runtime.HTTPTransport
	WebSocket             runtime.WebSocketLike
	BaseURL, WebSocketURL string
	DeploymentID          runtime.Optional[string]
	// Zero selects 16 MiB for error bodies and 4 MiB per incoming socket message.
	MaxJSONBytes, MaxMessageBytes int
}
type Error struct {
	Message    string
	StatusCode int
	RetryAfter runtime.Optional[string]
}

func (e *Error) Error() string { return e.Message }

// Synthesize returns one owned audio stream. Always Close it, including when unread.
// The parent context covers connection, input, output and idle time between Next calls.
func Synthesize(ctx context.Context, request schema.TtsRequest, options Options) (runtime.Input[out.SynthesisItem], error) {
	validate, err := schema.ValidateRequest(request)
	if err != nil {
		return nil, err
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	c, err := settings(request)
	if err != nil {
		return nil, err
	}
	socketMode := c.input != nil || c.timed || options.WebSocket != nil || options.WebSocketURL != ""
	if socketMode && c.wave {
		return nil, errors.New("Microsoft WAV output requires the REST transport")
	}
	jsonLimit, messageLimit := options.MaxJSONBytes, options.MaxMessageBytes
	if jsonLimit == 0 {
		jsonLimit = 16 * 1024 * 1024
	}
	if messageLimit == 0 {
		messageLimit = 4 * 1024 * 1024
	}
	if jsonLimit < 0 || uint64(jsonLimit) > 4294967295 {
		return nil, errors.New("Microsoft MaxJSONBytes must be a positive uint32 value")
	}
	if messageLimit < 0 || uint64(messageLimit) > 4294967295 {
		return nil, errors.New("Microsoft MaxMessageBytes must be a positive uint32 value")
	}
	var key, token, region string
	entry := options.Auth.Microsoft
	if entry.Present && (entry.Value.ApiKey.Present || entry.Value.AccessToken.Present) {
		if entry.Value.ApiKey.Present {
			key = entry.Value.ApiKey.Value
		}
		if entry.Value.AccessToken.Present {
			token = entry.Value.AccessToken.Value
		}
	} else {
		var present bool
		key, present = os.LookupEnv("SPEECHSWITCH_MICROSOFT_API_KEY")
		if !present {
			key = os.Getenv("AZURE_SPEECH_KEY")
		}
		token = os.Getenv("SPEECHSWITCH_MICROSOFT_ACCESS_TOKEN")
	}
	if entry.Present && entry.Value.Region.Present {
		region = entry.Value.Region.Value
	} else {
		var present bool
		region, present = os.LookupEnv("SPEECHSWITCH_MICROSOFT_REGION")
		if !present {
			region = os.Getenv("AZURE_SPEECH_REGION")
		}
	}
	if key == "" && token == "" && options.WebSocket == nil {
		return nil, errors.New("Missing auth.microsoft.apiKey or auth.microsoft.accessToken configuration")
	}
	if region == "" && options.BaseURL == "" && options.WebSocketURL == "" && options.WebSocket == nil {
		return nil, errors.New("Missing auth.microsoft.region configuration")
	}
	if strings.Trim(region, "abcdefghijklmnopqrstuvwxyz0123456789-") != "" {
		return nil, errors.New("Invalid Microsoft Speech region")
	}
	headers := http.Header{}
	if token != "" {
		headers.Set("Authorization", "Bearer "+token)
	} else if key != "" {
		headers.Set("Ocp-Apim-Subscription-Key", key)
	}
	for _, values := range headers {
		for _, value := range values {
			for _, r := range value {
				if r < 32 || r > 126 {
					return nil, errors.New("Invalid Microsoft authentication header")
				}
			}
		}
	}
	base := options.BaseURL
	if base == "" {
		service, domain := "tts", "microsoft.com"
		if options.DeploymentID.Present && options.DeploymentID.Value != "" {
			service = "voice"
		}
		if strings.HasPrefix(region, "china") {
			domain = "azure.cn"
		} else if strings.HasPrefix(region, "usgov") {
			domain = "azure.us"
		}
		if region == "" {
			region = "unused"
		}
		base = "https://" + region + "." + service + ".speech." + domain
	}
	suffix := "/cognitiveservices/v1"
	explicit := socketMode && options.WebSocketURL != ""
	if explicit {
		base = options.WebSocketURL
		suffix = ""
	} else if socketMode {
		suffix = "/tts/cognitiveservices/websocket/v1"
		if c.input != nil {
			suffix = "/cognitiveservices/websocket/v2"
		}
	}
	target, err := endpoint(base, suffix, options.DeploymentID, socketMode, explicit)
	if err != nil {
		return nil, err
	}
	if socketMode {
		nonce := make([]byte, 32)
		if _, err = rand.Read(nonce); err != nil {
			return nil, err
		}
		headers.Set("X-ConnectionId", hex.EncodeToString(nonce[:16]))
		operation, cancel := context.WithCancel(ctx)
		socket := options.WebSocket
		if socket == nil {
			socket, err = runtime.ConnectWebSocket(operation, target, runtime.WebSocketOptions{Header: headers, MaxMessageBytes: messageLimit})
			if err != nil {
				cancel()
				return nil, err
			}
		}
		idle := make(chan struct{})
		close(idle)
		stream := &socketStream{parent: ctx, ctx: operation, cancel: cancel, socket: socket, config: c, id: hex.EncodeToString(nonce[16:]), limit: messageLimit, validate: validate, producerIdle: idle}
		stream.stop = context.AfterFunc(operation, func() { stream.closeResources() })
		return stream, nil
	}
	native, err := http.NewRequestWithContext(ctx, http.MethodPost, target, strings.NewReader(c.markup))
	if err != nil {
		return nil, err
	}
	native.Header = headers
	native.Header.Set("Content-Type", "application/ssml+xml")
	native.Header.Set("X-Microsoft-OutputFormat", c.format)
	native.Header.Set("User-Agent", "speechswitch")
	transport := options.Transport
	if transport == nil {
		transport = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	response, err := runtime.OpenResponse(native, transport)
	if err != nil {
		return nil, err
	}
	if err = ctx.Err(); err != nil {
		response.Body.Close()
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		defer response.Body.Close()
		var data []byte
		for {
			chunk, err := response.Body.Next(ctx)
			if err == io.EOF {
				break
			}
			if err != nil {
				return nil, err
			}
			if len(chunk) > jsonLimit-len(data) {
				return nil, errors.New("Microsoft response exceeds MaxJSONBytes")
			}
			data = append(data, chunk...)
		}
		retry := runtime.Optional[string]{}
		if values, ok := response.Header["Retry-After"]; ok && len(values) > 0 {
			retry = runtime.Some(values[0])
		}
		return nil, &Error{Message: fmt.Sprintf("Microsoft synthesis failed (%d): %s", response.StatusCode, strings.TrimPrefix(runtime.DecodeUTF8(data), "\ufeff")), StatusCode: response.StatusCode, RetryAfter: retry}
	}
	contentType := strings.ToLower(strings.TrimSpace(strings.SplitN(response.Header.Get("Content-Type"), ";", 2)[0]))
	if contentType != "" && !strings.HasPrefix(contentType, "audio/") && contentType != "application/octet-stream" {
		response.Body.Close()
		return nil, errors.New("Microsoft returned a non-audio response")
	}
	return &httpStream{body: response.Body}, nil
}

type httpStream struct{ body runtime.Input[[]byte] }

func (s *httpStream) Close() error { return s.body.Close() }
func (s *httpStream) Next(ctx context.Context) (out.SynthesisItem, error) {
	data, err := s.body.Next(ctx)
	if err != nil {
		return nil, err
	}
	return out.SynthesisItemAsBytes{Value: data}, nil
}

func endpoint(base, path string, deployment runtime.Optional[string], socket, explicit bool) (string, error) {
	invalid := errors.New("Invalid Microsoft endpoint URL")
	u, err := url.Parse(base)
	if err != nil || u.Hostname() == "" || u.User != nil || u.Fragment != "" || u.Opaque != "" || strings.ContainsFunc(base, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) || r == '\\' }) {
		return "", invalid
	}
	if explicit {
		if u.Scheme != "ws" && u.Scheme != "wss" {
			return "", invalid
		}
	} else if u.Scheme != "http" && u.Scheme != "https" {
		return "", invalid
	}
	if port := u.Port(); port != "" {
		n, err := strconv.Atoi(port)
		if err != nil || n > 65535 {
			return "", invalid
		}
	}
	if _, err = url.QueryUnescape(u.RawQuery); err != nil {
		return "", invalid
	}
	escaped := strings.TrimRight(u.EscapedPath(), "/") + path
	u.Path, err = url.PathUnescape(escaped)
	if err != nil {
		return "", invalid
	}
	u.RawPath = escaped
	if deployment.Present {
		query, err := url.ParseQuery(u.RawQuery)
		if err != nil {
			return "", invalid
		}
		query.Set("deploymentId", deployment.Value)
		u.RawQuery = query.Encode()
	}
	if socket && !explicit {
		if u.Scheme == "https" {
			u.Scheme = "wss"
		} else {
			u.Scheme = "ws"
		}
	}
	return u.String(), nil
}
