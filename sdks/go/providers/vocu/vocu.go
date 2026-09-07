// Package vocu implements Vocu's incomplete wire contract directly.
package vocu

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
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/vocu"
	out "github.com/speechswitch/client/sdks/go/generated/vocu_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type Options struct {
	Auth auth.Auth
	// Nil uses native HTTP without redirects, cookies or implicit credentials.
	// Overrides must honor cancellation and reject redirects and submission retries.
	Transport runtime.HTTPTransport
	BaseURL   string
	// Empty selects async for batches/splitters and stream otherwise.
	Mode string
	// Omission has no deadline. Explicit zero expires before network access.
	TimeoutMs runtime.Optional[int64]
	// Omission selects 1000 ms; explicit zero polls cooperatively without delay.
	PollIntervalMs runtime.Optional[int64]
	// Zero selects 4 MiB. This never bounds or buffers native audio.
	MaxMetadataBytes int
	// Additional exact trusted HTTP(S) origins. Downloads never receive API auth.
	AudioOrigins []string
}

type Error struct {
	Status                       runtime.Optional[int]
	JobID, RequestID, RetryAfter runtime.Optional[string]
}

func (e *Error) Error() string {
	if !e.Status.Present {
		return "Vocu generation failed"
	}
	return fmt.Sprintf("Vocu returned HTTP %d", e.Status.Value)
}

// Synthesize submits one request and returns at its headers. Always Close the
// returned stream. Async jobs are polled by Next; cancellation does not cancel
// accepted server jobs or their billing. There is no implicit queue timeout.
func Synthesize(ctx context.Context, request schema.TtsRequest, options Options) (runtime.Input[out.SynthesisItem], error) {
	if _, err := schema.ValidateRequest(request); err != nil {
		return nil, err
	}
	values, err := resolve(request, options.Mode)
	if err != nil {
		return nil, err
	}
	mode := options.Mode
	if mode == "" {
		if values.async {
			mode = "async"
		} else {
			mode = "stream"
		}
	}
	var apiKey, explicitKey, explicitToken runtime.Optional[string]
	if options.Auth.Vocu.Present {
		explicitKey, explicitToken = options.Auth.Vocu.Value.ApiKey, options.Auth.Vocu.Value.AccessToken
	}
	apiKey = explicitKey
	if !apiKey.Present {
		if value, present := os.LookupEnv("SPEECHSWITCH_VOCU_API_KEY"); present {
			apiKey = runtime.Some(value)
		} else if value, present := os.LookupEnv("VOCU_API_KEY"); present {
			apiKey = runtime.Some(value)
		}
	}
	token := apiKey
	if mode == "async" {
		if explicitKey.Present {
			token = explicitKey
		} else if explicitToken.Present {
			token = explicitToken
		}
		if !token.Present {
			if value, present := os.LookupEnv("SPEECHSWITCH_VOCU_ACCESS_TOKEN"); present {
				token = runtime.Some(value)
			} else if value, present := os.LookupEnv("VOCU_ACCESS_TOKEN"); present {
				token = runtime.Some(value)
			}
		}
	}
	if !token.Present || token.Value == "" {
		if mode == "async" {
			return nil, errors.New("Missing auth.vocu.apiKey or auth.vocu.accessToken configuration")
		}
		return nil, errors.New("Missing auth.vocu.apiKey configuration")
	}
	for _, r := range token.Value {
		if r < 33 || r > 126 {
			return nil, errors.New("Vocu credential must contain only visible ASCII characters")
		}
	}
	baseAddress := options.BaseURL
	if baseAddress == "" {
		baseAddress = "https://v1.vocu.ai"
	}
	base, _, err := parseURL(baseAddress)
	if err != nil {
		return nil, err
	}
	if base.RawQuery != "" || base.ForceQuery {
		return nil, errors.New("Vocu base URL must not contain a query")
	}
	poll := int64(1000)
	if options.PollIntervalMs.Present {
		poll = options.PollIntervalMs.Value
	}
	if poll < 0 || poll > 2147483647 || options.TimeoutMs.Present && (options.TimeoutMs.Value < 0 || options.TimeoutMs.Value > 2147483647) {
		return nil, errors.New("Vocu polling interval and timeout must be integers between 0 and 2147483647")
	}
	limit := options.MaxMetadataBytes
	if limit == 0 {
		limit = 4 * 1024 * 1024
	}
	if limit < 0 || uint64(limit) > 9007199254740991 {
		return nil, errors.New("Vocu MaxMetadataBytes must be a positive safe integer")
	}
	origins := map[string]bool{"https://storage.vocu.ai": true, "https://storage.vocu.studio": true, "https://v1.vocu.ai": true, "https://v1.vocu.studio": true}
	for _, address := range options.AudioOrigins {
		_, origin, err := parseURL(address)
		if err != nil {
			return nil, err
		}
		if address != origin {
			return nil, errors.New("Vocu AudioOrigins must contain HTTP(S) origins only")
		}
		origins[origin] = true
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if options.TimeoutMs.Present && options.TimeoutMs.Value == 0 {
		return nil, context.DeadlineExceeded
	}
	var cancel context.CancelFunc
	if options.TimeoutMs.Present {
		ctx, cancel = context.WithTimeout(ctx, time.Duration(options.TimeoutMs.Value)*time.Millisecond)
	} else {
		ctx, cancel = context.WithCancel(ctx)
	}
	transport := options.Transport
	if transport == nil {
		transport = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	s := &stream{ctx: ctx, cancel: cancel, transport: transport, base: base, endpoint: strings.TrimRight(base.String(), "/") + "/api/tts/", token: token.Value, mode: mode, limit: limit, poll: time.Duration(poll) * time.Millisecond, origins: origins}
	path := "simple-generate"
	if mode == "async" {
		path = "generate"
	}
	response, err := s.send(s.endpoint+path, values.payload, true)
	if err != nil {
		s.Close()
		return nil, err
	}
	s.headers = response.Header
	return s, nil
}

func parseURL(address string) (*url.URL, string, error) {
	invalid := errors.New("Vocu URLs must be HTTP(S) without credentials, fragments or invalid escapes")
	for _, r := range address {
		if unicode.IsSpace(r) || r < 32 || r == 127 || r == '\\' {
			return nil, "", invalid
		}
	}
	u, err := url.Parse(address)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || u.Opaque != "" || strings.Contains(address, "#") {
		return nil, "", invalid
	}
	host := strings.ToLower(u.Hostname())
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	if port := u.Port(); port != "" {
		number, err := strconv.Atoi(port)
		if err != nil || number < 0 || number > 65535 {
			return nil, "", invalid
		}
		if !(u.Scheme == "http" && number == 80 || u.Scheme == "https" && number == 443) {
			host += ":" + strconv.Itoa(number)
		}
	}
	return u, u.Scheme + "://" + host, nil
}

type stream struct {
	ctx                          context.Context
	cancel                       context.CancelFunc
	transport                    runtime.HTTPTransport
	base                         *url.URL
	endpoint, token, mode        string
	limit                        int
	poll                         time.Duration
	origins                      map[string]bool
	headers                      http.Header
	metadata                     runtime.JsonObject
	jobID, requestID             runtime.Optional[string]
	mutex, bodyMutex             sync.Mutex
	body                         runtime.Input[[]byte]
	closed                       atomic.Bool
	once                         sync.Once
	closeError                   error
	prepared, received, terminal bool
}

func (s *stream) closeBody() error {
	s.bodyMutex.Lock()
	body := s.body
	s.body = nil
	s.bodyMutex.Unlock()
	if body != nil {
		return body.Close()
	}
	return nil
}
func (s *stream) Close() error {
	s.closed.Store(true)
	s.cancel()
	s.once.Do(func() { s.closeError = s.closeBody() })
	return s.closeError
}
func (s *stream) send(address string, payload map[string]any, authenticated bool) (*runtime.HTTPResponse, error) {
	if err := s.ctx.Err(); err != nil {
		return nil, err
	}
	method := "GET"
	var data []byte
	var err error
	if payload != nil {
		method = "POST"
		data, err = json.Marshal(payload)
		if err != nil {
			return nil, err
		}
	}
	request, err := http.NewRequestWithContext(s.ctx, method, address, bytes.NewReader(data))
	if err != nil {
		return nil, errors.New("Invalid Vocu request URL")
	}
	if authenticated {
		request.Header.Set("Authorization", "Bearer "+s.token)
	}
	if payload != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := runtime.OpenResponse(request, s.transport)
	if err != nil {
		return nil, err
	}
	if err := s.ctx.Err(); err != nil {
		response.Body.Close()
		return nil, err
	}
	headers := http.Header{}
	for key, values := range response.Header {
		for _, value := range values {
			headers.Add(key, value)
		}
	}
	response.Header = headers
	trace, retry := runtime.Optional[string]{}, runtime.Optional[string]{}
	if values, ok := headers["X-Vocu-App-Request-Id"]; ok && len(values) > 0 {
		trace = runtime.Some(values[0])
	}
	if values, ok := headers["Retry-After"]; ok && len(values) > 0 {
		retry = runtime.Some(values[0])
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		response.Body.Close()
		return nil, &Error{Status: runtime.Some(response.StatusCode), JobID: s.jobID, RequestID: trace, RetryAfter: retry}
	}
	if authenticated && trace.Present {
		s.requestID = trace
	}
	s.bodyMutex.Lock()
	if s.closed.Load() {
		s.bodyMutex.Unlock()
		response.Body.Close()
		return nil, context.Canceled
	}
	s.body = response.Body
	s.bodyMutex.Unlock()
	return response, nil
}

func (s *stream) Next(ctx context.Context) (out.SynthesisItem, error) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	if s.terminal || s.closed.Load() {
		return nil, io.EOF
	}
	stop := context.AfterFunc(ctx, func() { s.cancel(); s.closeBody() })
	defer stop()
	item, err := s.next(ctx)
	if cause := ctx.Err(); cause != nil {
		err = cause
	} else if cause := s.ctx.Err(); cause != nil {
		err = cause
	}
	if err != nil {
		s.terminal = true
		s.Close()
		return nil, err
	}
	if _, done := item.(out.SynthesisItemAsDone); done {
		s.terminal = true
		if err := s.Close(); err != nil {
			return nil, err
		}
	}
	return item, nil
}
func (s *stream) next(ctx context.Context) (out.SynthesisItem, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := s.ctx.Err(); err != nil {
		return nil, err
	}
	if !s.prepared {
		if err := s.prepare(ctx); err != nil {
			return nil, err
		}
		s.prepared = true
	}
	s.bodyMutex.Lock()
	body := s.body
	s.bodyMutex.Unlock()
	if body == nil {
		return nil, context.Canceled
	}
	audio, err := body.Next(ctx)
	if err != nil && err != io.EOF {
		return nil, err
	}
	if err == nil {
		s.received = true
		return out.SynthesisItemAsBytes{Value: audio}, nil
	}
	if !s.received {
		return nil, errors.New("Vocu returned no audio")
	}
	if err := s.closeBody(); err != nil {
		return nil, err
	}
	var completion out.VocuDoneEventCompletion = out.VocuDoneEventCompletionAsTransport{}
	if s.mode == "async" {
		completion = out.VocuDoneEventCompletionAsGenerated{}
	}
	done := out.VocuDoneEvent{Completion: completion, RequestId: s.requestID}
	if s.metadata != nil {
		var metadata out.VocuDoneEventMetadata = out.VocuDoneEventMetadataAsRecord{Value: s.metadata}
		done.Metadata = runtime.Some(metadata)
	}
	return out.SynthesisItemAsDone{Value: done}, nil
}

var jobIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

func (s *stream) prepare(ctx context.Context) error {
	if s.mode == "stream" {
		if values, ok := s.headers["X-Reecho-Response-Data"]; ok && len(values) > 0 {
			if len(values[0]) > s.limit {
				return errors.New("Vocu metadata exceeds MaxMetadataBytes")
			}
			value, err := decodeObject([]byte(values[0]))
			if err != nil {
				return err
			}
			s.metadata = value
		}
	} else {
		value, err := s.readMetadata(ctx)
		if err != nil {
			return err
		}
		s.metadata = value
		if s.mode == "async" {
			id, ok := value["id"].(runtime.JsonString)
			if !ok || !jobIDPattern.MatchString(string(id)) {
				return errors.New("Invalid Vocu job ID")
			}
			s.jobID = runtime.Some(string(id))
			for {
				if value["id"] != id {
					return errors.New("Vocu returned a different job ID while polling")
				}
				status, ok := value["status"].(runtime.JsonString)
				if !ok {
					return errors.New("Invalid Vocu job status")
				}
				if status == "failed" {
					return &Error{JobID: s.jobID, RequestID: s.requestID}
				}
				if status == "generated" {
					break
				}
				if status != "pending" && status != "processing" {
					return errors.New("Invalid Vocu job status")
				}
				timer := time.NewTimer(s.poll)
				select {
				case <-timer.C:
				case <-s.ctx.Done():
					timer.Stop()
					return s.ctx.Err()
				}
				if _, err := s.send(s.endpoint+"generate/"+string(id), nil, true); err != nil {
					return err
				}
				value, err = s.readMetadata(ctx)
				if err != nil {
					return err
				}
			}
			s.metadata = value
		}
		var address runtime.JsonValue
		if s.mode == "async" {
			native, ok := s.metadata["metadata"].(runtime.JsonObject)
			if !ok {
				return errors.New("Invalid Vocu response object")
			}
			address = native["audio"]
		} else {
			address = s.metadata["streamUrl"]
			if _, isNull := address.(runtime.JsonNull); address == nil || isNull {
				address = s.metadata["audio"]
			}
		}
		location, ok := address.(runtime.JsonString)
		if !ok || strings.TrimSpace(string(location)) == "" {
			return errors.New("Vocu returned no audio URL")
		}
		for _, r := range location {
			if unicode.IsSpace(r) || r < 32 || r == 127 || r == '\\' {
				return errors.New("Vocu returned an untrusted audio URL")
			}
		}
		relative, err := url.Parse(string(location))
		if err != nil || strings.Contains(string(location), "#") {
			return errors.New("Vocu returned an untrusted audio URL")
		}
		addressURL, origin, err := parseURL(s.base.ResolveReference(relative).String())
		if err != nil || !s.origins[origin] {
			return errors.New("Vocu returned an untrusted audio URL")
		}
		response, err := s.send(addressURL.String(), nil, false)
		if err != nil {
			return err
		}
		s.headers = response.Header
	}
	media := strings.ToLower(strings.TrimSpace(strings.SplitN(s.headers.Get("Content-Type"), ";", 2)[0]))
	if media != "" && media != "audio/mpeg" && media != "application/octet-stream" {
		return errors.New("Vocu returned an unexpected audio content type")
	}
	return nil
}

func (s *stream) readMetadata(ctx context.Context) (runtime.JsonObject, error) {
	s.bodyMutex.Lock()
	body := s.body
	s.bodyMutex.Unlock()
	if body == nil {
		return nil, context.Canceled
	}
	var data []byte
	for {
		chunk, err := body.Next(ctx)
		if err != nil && err != io.EOF {
			return nil, err
		}
		if len(chunk) > s.limit-len(data) {
			return nil, errors.New("Vocu metadata exceeds MaxMetadataBytes")
		}
		data = append(data, chunk...)
		if err == io.EOF {
			break
		}
	}
	value, err := decodeObject(bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf}))
	closeErr := s.closeBody()
	if err != nil {
		return nil, err
	}
	if value["status"] != runtime.JsonNumber(200) {
		return nil, errors.New("Invalid Vocu response status")
	}
	result, ok := value["data"].(runtime.JsonObject)
	if !ok {
		return nil, errors.New("Invalid Vocu response object")
	}
	return result, closeErr
}

func decodeObject(data []byte) (runtime.JsonObject, error) {
	if !runtime.ValidUTF8JSON(data) {
		return nil, errors.New("Invalid Vocu metadata")
	}
	var value any
	if json.Unmarshal(data, &value) != nil {
		return nil, errors.New("Invalid Vocu metadata")
	}
	object, ok := value.(map[string]any)
	if !ok {
		return nil, errors.New("Invalid Vocu response object")
	}
	result := runtime.JsonObject{}
	for key, value := range object {
		result[key] = jsonValue(value)
	}
	return result, nil
}
func jsonValue(value any) runtime.JsonValue {
	// encoding/json has already rejected invalid syntax and nonfinite numbers.
	switch v := value.(type) {
	case nil:
		return runtime.JsonNull{}
	case bool:
		return runtime.JsonBool(v)
	case float64:
		return runtime.JsonNumber(v)
	case string:
		return runtime.JsonString(v)
	case []any:
		result := make(runtime.JsonArray, len(v))
		for i, child := range v {
			result[i] = jsonValue(child)
		}
		return result
	case map[string]any:
		result := runtime.JsonObject{}
		for key, child := range v {
			result[key] = jsonValue(child)
		}
		return result
	default:
		panic("unreachable decoded JSON type")
	}
}
