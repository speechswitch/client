// Package typecast implements Typecast's partial wire contract directly.
package typecast

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/typecast"
	out "github.com/speechswitch/client/sdks/go/generated/typecast_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type Options struct {
	Auth auth.Auth
	// Nil uses native HTTP with redirects disabled. Overrides must honor cancellation
	// and reject redirects, implicit retries and ambient credentials.
	Transport runtime.HTTPTransport
	BaseURL   string
	// Empty selects the lowest-latency operation compatible with the request.
	Protocol string
	// Omission has no deadline; explicit zero expires before network access.
	TimeoutMs runtime.Optional[int64]
	// Zero selects 128 MiB. Raw audio remains unbuffered and uncapped.
	MaxTimestampResponseBytes int
}

type Error struct{ Status int }

func (e *Error) Error() string { return fmt.Sprintf("Typecast returned HTTP %d", e.Status) }

// Synthesize returns at response headers. Always Close the stream, including on
// early exit. Both the operation context and each Next context cancel body I/O.
func Synthesize(ctx context.Context, request schema.TtsRequest, options Options) (runtime.Input[out.SynthesisItem], error) {
	if _, err := schema.ValidateRequest(request); err != nil {
		return nil, err
	}
	values, err := resolve(request)
	if err != nil {
		return nil, err
	}
	var key string
	if options.Auth.Typecast.Present && options.Auth.Typecast.Value.ApiKey.Present {
		key = options.Auth.Typecast.Value.ApiKey.Value
	} else if scoped, present := os.LookupEnv("SPEECHSWITCH_TYPECAST_API_KEY"); present {
		key = scoped
	} else {
		key = os.Getenv("TYPECAST_API_KEY")
	}
	if key == "" {
		return nil, errors.New("Missing auth.typecast.apiKey configuration")
	}
	for _, r := range key {
		if r < 33 || r > 126 {
			return nil, errors.New("Typecast API key must contain only visible ASCII characters")
		}
	}
	mode := options.Protocol
	if mode == "" {
		if values.full {
			mode = "http"
		} else {
			mode = "stream"
		}
	}
	if mode != "http" && mode != "stream" {
		return nil, errors.New("Typecast Protocol must be stream or http")
	}
	if mode == "stream" && values.full {
		return nil, errors.New("Typecast composition, timestamps, volume scaling and 44.1 kHz WAV require ordinary synthesis")
	}
	if mode == "http" && values.format == "wav" && values.rate == 32000 {
		return nil, errors.New("Typecast ordinary WAV uses 44100 Hz, not 32000 Hz")
	}
	if options.TimeoutMs.Present && (options.TimeoutMs.Value < 0 || options.TimeoutMs.Value > 2147483647) {
		return nil, errors.New("Typecast TimeoutMs must be between 0 and 2147483647")
	}
	limit := options.MaxTimestampResponseBytes
	if limit == 0 {
		limit = 128 * 1024 * 1024
	}
	if limit < 0 || uint64(limit) > 9007199254740991 {
		return nil, errors.New("Typecast MaxTimestampResponseBytes must be a positive safe integer")
	}
	base := options.BaseURL
	if base == "" {
		base = "https://api.typecast.ai"
	}
	endpoint, err := url.Parse(base)
	if err != nil || endpoint == nil || (endpoint.Scheme != "http" && endpoint.Scheme != "https") || endpoint.Hostname() == "" || endpoint.User != nil || endpoint.Fragment != "" || strings.IndexFunc(base, func(r rune) bool { return unicode.IsSpace(r) || r < 32 || r == 127 || r == '\\' }) >= 0 {
		return nil, errors.New("Typecast endpoint must be HTTP(S) without credentials, fragments or invalid escapes")
	}
	query, err := url.ParseQuery(endpoint.RawQuery)
	if err != nil {
		return nil, errors.New("Typecast endpoint must be HTTP(S) without credentials, fragments or invalid escapes")
	}
	if port := endpoint.Port(); port != "" {
		value, err := strconv.Atoi(port)
		if err != nil || value < 1 || value > 65535 {
			return nil, errors.New("Typecast endpoint must use a valid TCP port")
		}
	}
	operation := ""
	if mode == "stream" {
		operation = "/stream"
	}
	if values.words || values.characters {
		operation = "/with-timestamps"
	}
	if values.composed {
		operation = "/compose"
	}
	endpoint.RawPath = strings.TrimRight(endpoint.EscapedPath(), "/") + "/v1/text-to-speech" + operation
	endpoint.Path, _ = url.PathUnescape(endpoint.RawPath)
	query.Del("granularity")
	if values.words != values.characters {
		if values.words {
			query.Set("granularity", "word")
		} else {
			query.Set("granularity", "char")
		}
	}
	endpoint.RawQuery = query.Encode()
	encoded, err := json.Marshal(values.payload)
	if err != nil {
		return nil, err
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
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(encoded))
	if err != nil {
		cancel()
		return nil, err
	}
	req.GetBody = nil
	req.Header.Set("X-API-KEY", key)
	req.Header.Set("Content-Type", "application/json")
	media := "audio/wav"
	if values.format == "mp3" {
		media = "audio/mpeg"
	}
	if values.words || values.characters {
		media = "application/json"
	}
	req.Header.Set("Accept", media)
	transport := options.Transport
	if transport == nil {
		transport = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	response, err := runtime.OpenResponse(req, transport)
	if err != nil {
		cancel()
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		cancel()
		response.Body.Close()
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		cancel()
		response.Body.Close()
		return nil, &Error{Status: response.StatusCode}
	}
	contentType := ""
	for name, values := range response.Header {
		if strings.EqualFold(name, "content-type") && len(values) != 0 {
			contentType = strings.ToLower(strings.TrimSpace(strings.SplitN(values[0], ";", 2)[0]))
		}
	}
	if contentType != "" && contentType != media && (media == "application/json" || contentType != "application/octet-stream") {
		cancel()
		response.Body.Close()
		return nil, errors.New("Typecast returned an unexpected content type")
	}
	return &stream{ctx: ctx, cancel: cancel, body: response.Body, format: values.format, words: values.words, characters: values.characters, limit: limit}, nil
}

type stream struct {
	ctx                          context.Context
	cancel                       context.CancelFunc
	body                         runtime.Input[[]byte]
	format                       string
	words, characters            bool
	limit                        int
	mutex                        sync.Mutex
	closed                       atomic.Bool
	once                         sync.Once
	closeError                   error
	terminal, received, envelope bool
}

func (s *stream) closeBody() error {
	s.once.Do(func() { s.closeError = s.body.Close() })
	return s.closeError
}
func (s *stream) Close() error {
	s.closed.Store(true)
	s.cancel()
	return s.closeBody()
}
func (s *stream) Next(ctx context.Context) (out.SynthesisItem, error) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	if s.terminal {
		return nil, io.EOF
	}
	if s.closed.Load() {
		s.terminal = true
		return nil, io.EOF
	}
	stop := context.AfterFunc(ctx, func() { s.cancel(); s.closeBody() })
	defer stop()
	item, err := s.next(ctx)
	if err == nil {
		if err = ctx.Err(); err == nil {
			err = s.ctx.Err()
		}
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
	if s.envelope {
		return out.SynthesisItemAsDone{}, nil
	}
	if s.words || s.characters {
		var data []byte
		for {
			chunk, err := s.body.Next(ctx)
			if err != nil && err != io.EOF {
				return nil, err
			}
			if len(chunk) > s.limit-len(data) {
				return nil, errors.New("Typecast timestamp response exceeds MaxTimestampResponseBytes")
			}
			data = append(data, chunk...)
			if err == io.EOF {
				break
			}
		}
		if err := s.closeBody(); err != nil {
			return nil, err
		}
		value, err := decodeTimestamps(data, s.format, s.words, s.characters)
		if err != nil {
			return nil, err
		}
		s.envelope = true
		return out.SynthesisItemAsChunk{Value: value}, nil
	}
	audio, err := s.body.Next(ctx)
	if err == io.EOF {
		if !s.received {
			return nil, errors.New("Typecast returned no audio")
		}
		return out.SynthesisItemAsDone{}, nil
	}
	if err != nil {
		return nil, err
	}
	s.received = true
	return out.SynthesisItemAsBytes{Value: audio}, nil
}

func seconds(value any, message string) (float64, error) {
	number, ok := value.(float64)
	if !ok || math.IsNaN(number) || math.IsInf(number*1000, 0) || number < 0 {
		return 0, errors.New(message)
	}
	return number, nil
}
func decodeTimestamps(data []byte, format string, words, characters bool) (out.TypecastEnvelope, error) {
	var result out.TypecastEnvelope
	data = bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf})
	var value map[string]any
	if !runtime.ValidUTF8JSON(data) || json.Unmarshal(data, &value) != nil || value == nil {
		return result, errors.New("Invalid Typecast timestamp response")
	}
	duration, err := seconds(value["audio_duration"], "Invalid Typecast timestamp audio metadata")
	if err != nil {
		return result, err
	}
	if value["audio_format"] != format {
		return result, errors.New("Invalid Typecast timestamp audio metadata")
	}
	encoded, ok := value["audio"].(string)
	if !ok {
		return result, errors.New("Invalid Typecast base64 audio")
	}
	audio, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil || len(audio) == 0 || base64.StdEncoding.EncodeToString(audio) != encoded {
		return result, errors.New("Invalid Typecast base64 audio")
	}
	result.Audio, result.DurationMs = audio, duration*1000
	result.Timestamps = []out.TypecastEnvelopeTimestampsItem{}
	for _, track := range []struct {
		key      string
		kind     out.TypecastEnvelopeTimestampsItemKind
		required bool
	}{
		{"words", out.TypecastEnvelopeTimestampsItemKindAsWord{}, words}, {"characters", out.TypecastEnvelopeTimestampsItemKindAsCharacter{}, characters},
	} {
		entries, present := value[track.key]
		if present && entries == nil && !track.required {
			continue
		}
		array, ok := entries.([]any)
		if !ok {
			return result, fmt.Errorf("Typecast omitted %s alignment", track.key)
		}
		for _, item := range array {
			entry, ok := item.(map[string]any)
			if !ok || entry == nil {
				return result, errors.New("Invalid Typecast alignment segment")
			}
			text, ok := entry["text"].(string)
			if !ok {
				return result, errors.New("Invalid Typecast alignment interval")
			}
			start, err := seconds(entry["start"], "Invalid Typecast alignment interval")
			if err != nil {
				return result, err
			}
			end, err := seconds(entry["end"], "Invalid Typecast alignment interval")
			if err != nil {
				return result, err
			}
			if end < start {
				return result, errors.New("Invalid Typecast alignment interval")
			}
			if track.required {
				result.Timestamps = append(result.Timestamps, out.TypecastEnvelopeTimestampsItem{Kind: track.kind, Value: text, StartTimeMs: start * 1000, EndTimeMs: runtime.Some(end * 1000)})
			}
		}
	}
	return result, nil
}
