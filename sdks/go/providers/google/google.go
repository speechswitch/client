// Package google adapts canonical requests to Google's generated wire clients.
package google

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"unicode"

	proto "github.com/speechswitch/client/sdks/go/clients/google_grpc"
	beta "github.com/speechswitch/client/sdks/go/clients/google_grpc_beta"
	rest "github.com/speechswitch/client/sdks/go/clients/google_rest"
	restbeta "github.com/speechswitch/client/sdks/go/clients/google_rest_beta"
	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/google"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type Options struct {
	Auth auth.Auth
	// Nil selects native HTTP/TLS+HTTP2. Overrides must honor context cancellation.
	Transport runtime.HTTPTransport
	// Already authenticated, preconnected override, owned by this synthesis call.
	GRPC             runtime.GRPCLike
	BaseURL, GRPCURL string
	// Zero selects 16 MiB per JSON response and 64 MiB per gRPC message.
	MaxJSONBytes, MaxMessageBytes int
}

type Error struct {
	StatusCode int
	Message    string
}

func (e *Error) Error() string { return fmt.Sprintf("Google %d: %s", e.StatusCode, e.Message) }

// Synthesize returns owned streaming audio. Close even an unread stream.
// ctx owns setup, input, output and idle time; use its deadline for a timeout.
func Synthesize(ctx context.Context, request schema.TtsRequest, options Options) (runtime.Input[[]byte], error) {
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
		messageLimit = 64 * 1024 * 1024
	}
	if jsonLimit < 0 || messageLimit < 0 || uint64(jsonLimit) > math.MaxUint32 || uint64(messageLimit) > math.MaxUint32 {
		return nil, errors.New("Google byte limits must be positive uint32 values")
	}
	var entry auth.AuthGoogle
	if options.Auth.Google.Present {
		entry = options.Auth.Google.Value
	}
	key := credential(entry.ApiKey, "SPEECHSWITCH_GOOGLE_API_KEY", "GOOGLE_API_KEY")
	token := credential(entry.AccessToken, "SPEECHSWITCH_GOOGLE_ACCESS_TOKEN", "GOOGLE_OAUTH_ACCESS_TOKEN")
	quota := credential(entry.QuotaProject, "SPEECHSWITCH_GOOGLE_QUOTA_PROJECT", "GOOGLE_CLOUD_QUOTA_PROJECT")
	if key == "" && token == "" {
		return nil, errors.New("Missing auth.google.apiKey or auth.google.accessToken configuration")
	}
	headers := make(http.Header)
	if key != "" {
		headers.Set("X-Goog-Api-Key", key)
	}
	if token != "" {
		headers.Set("Authorization", "Bearer "+token)
	}
	if quota != "" {
		headers.Set("X-Goog-User-Project", quota)
	}
	for _, values := range headers {
		for _, value := range values {
			for _, char := range value {
				if char < 32 || char > 126 {
					return nil, errors.New("Invalid Google authentication header")
				}
			}
		}
	}
	useHTTP := c.format == "wav" || c.format == "mp3" || c.inputType == "ssml" || c.VolumeDb.Present || c.PitchSemitones.Present || c.EffectsProfiles.Present
	target := options.GRPCURL
	if useHTTP {
		target = options.BaseURL
	}
	if target == "" {
		target = rest.DefaultBaseURL
	}
	endpoint, err := url.Parse(target)
	if err != nil || endpoint.Hostname() == "" || endpoint.User != nil || endpoint.Fragment != "" || endpoint.Opaque != "" || (endpoint.Scheme != "http" && endpoint.Scheme != "https") || strings.IndexFunc(target, func(c rune) bool { return unicode.IsSpace(c) || unicode.IsControl(c) || c == '\\' }) >= 0 {
		return nil, errors.New("Invalid Google endpoint URL")
	}
	if port := endpoint.Port(); port != "" {
		if _, err := strconv.ParseUint(port, 10, 16); err != nil {
			return nil, errors.New("Invalid Google endpoint URL")
		}
	}
	if _, err := url.ParseQuery(endpoint.RawQuery); err != nil {
		return nil, errors.New("Invalid Google endpoint query")
	}
	operation, cancel := context.WithCancelCause(ctx)
	if useHTTP {
		transport := options.Transport
		if transport == nil {
			transport = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		}
		var response *http.Response
		if c.model == "chirp-3-instant-custom-voice" {
			response, err = restbeta.SynthesizeSpeech(operation, c.betaRestRequest(), restbeta.ClientOptions{BaseURL: target, Headers: headers, Transport: transport})
		} else {
			response, err = rest.SynthesizeSpeech(operation, c.restRequest(), rest.ClientOptions{BaseURL: target, Headers: headers, Transport: transport})
		}
		if err != nil || response == nil || response.Body == nil {
			if err == nil {
				err = errors.New("Google HTTP transport returned no response body")
			}
			cancel(err)
			if response != nil && response.Body != nil {
				response.Body.Close()
			}
			return nil, err
		}
		s := &httpStream{ctx: operation, cancel: cancel, response: response, limit: jsonLimit, beta: c.model == "chirp-3-instant-custom-voice"}
		s.stop = context.AfterFunc(operation, func() { s.closeResources(context.Cause(operation)) })
		return s, nil
	}
	opening, err := c.opening()
	if err == nil && len(opening) > messageLimit {
		err = errors.New("Google gRPC message exceeds MaxMessageBytes")
	}
	if err != nil {
		cancel(err)
		return nil, err
	}
	path := proto.StreamingSynthesizePath
	if c.model == "chirp-3-instant-custom-voice" {
		path = beta.StreamingSynthesizePath
	}
	endpoint.RawPath = strings.TrimSuffix(endpoint.EscapedPath(), "/") + path
	endpoint.Path = strings.TrimSuffix(endpoint.Path, "/") + path
	connection := options.GRPC
	if connection == nil {
		connection, err = runtime.ConnectGRPC(operation, endpoint.String(), runtime.GRPCOptions{Header: headers, Transport: options.Transport, MaxMessageBytes: messageLimit})
		if err != nil {
			cancel(err)
			return nil, err
		}
	}
	s := &grpcStream{ctx: operation, cancel: cancel, connection: connection, config: c, opening: opening, validate: validate, limit: messageLimit}
	s.stop = context.AfterFunc(operation, func() { s.closeResources(context.Cause(operation)) })
	return s, nil
}

func credential(value runtime.Optional[string], scoped, fallback string) string {
	if value.Present {
		return value.Value
	}
	if value, present := os.LookupEnv(scoped); present {
		return value
	}
	return os.Getenv(fallback)
}
