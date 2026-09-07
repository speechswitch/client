package lovo

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"os"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/lovo"
	out "github.com/speechswitch/client/sdks/go/generated/lovo_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type transport func(*http.Request) (*http.Response, error)

func (f transport) Do(r *http.Request) (*http.Response, error) { return f(r) }

type body struct {
	io.Reader
	closes  atomic.Int32
	closeFn func() error
}

func (b *body) Close() error {
	b.closes.Add(1)
	if b.closeFn != nil {
		return b.closeFn()
	}
	return nil
}
func equal(t *testing.T, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}
func errorText(t *testing.T, err error, want string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected %q, got nil", want)
	}
	equal(t, err.Error(), want)
}
func fixture(t *testing.T) map[string]any {
	t.Helper()
	data, err := os.ReadFile("../../../fixtures/lovo.json")
	if err != nil {
		t.Fatal(err)
	}
	return decode(t, data)
}
func decode(t *testing.T, data []byte) map[string]any {
	t.Helper()
	var v map[string]any
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatal(err)
	}
	return v
}
func encode(t *testing.T, v any) string {
	t.Helper()
	data, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}
func job(t *testing.T) map[string]any {
	f := fixture(t)
	j := f["job"].(map[string]any)
	j["data"] = []any{f["output"]}
	j["callbackUrls"] = []any{}
	return j
}
func request() schema.TtsRequest {
	return schema.TtsRequest{Text: "Hello", Voice: "existing-speaker", VoiceStyle: runtime.Some("style"), Speed: runtime.Some(0.5)}
}

var testAuth = auth.Auth{Lovo: runtime.Some(auth.AuthAsync{ApiKey: runtime.Some("test-key")})}

func response(status int, b io.ReadCloser) *http.Response {
	return &http.Response{StatusCode: status, Body: b}
}
func start(t *testing.T, options Options) runtime.Input[out.SynthesisItem] {
	t.Helper()
	s, err := Synthesize(context.Background(), request(), options)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestSharedFixtureEarlyBytesAndFileIdentity(t *testing.T) {
	f := fixture(t)
	j := job(t)
	first := j["data"].([]any)[0].(map[string]any)
	first["urls"] = []string{"https://audio.invalid/a", "https://audio.invalid/b"}
	j["data"] = append(j["data"].([]any), f["output"])
	reader, writer := io.Pipe()
	defer writer.Close()
	audio := &body{Reader: reader, closeFn: reader.Close}
	metadata := &body{Reader: strings.NewReader(encode(t, j))}
	var calls []string
	s := start(t, Options{Auth: testAuth, BaseURL: "https://proxy.invalid/a%2Fb/?tenant=one", Transport: transport(func(r *http.Request) (*http.Response, error) {
		calls = append(calls, r.URL.String())
		if len(calls) == 1 {
			equal(t, r.Method, "POST")
			equal(t, r.Header, http.Header{"X-Api-Key": {"test-key"}, "Content-Type": {"application/json"}})
			data, err := io.ReadAll(r.Body)
			if err != nil {
				t.Fatal(err)
			}
			equal(t, decode(t, data), f["wire"])
			return response(201, metadata), nil
		}
		equal(t, r.Method, "GET")
		equal(t, r.Header, http.Header{})
		if len(calls) == 2 {
			return response(200, audio), nil
		}
		return response(200, io.NopCloser(strings.NewReader("b"))), nil
	})})
	equal(t, len(calls), 0)
	wrote := make(chan struct{})
	go func() { defer close(wrote); writer.Write([]byte{1, 2}) }()
	item, err := s.Next(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	equal(t, item, out.SynthesisItem{Audio: []byte{1, 2}, CorrelationId: "job/1:0:0", InputGroupId: "job/1:0"})
	equal(t, item.Correlation.Value(), f["envelope"].(map[string]any)["correlation"])
	equal(t, item.Timestamps, [0]struct{}{})
	equal(t, metadata.closes.Load(), int32(1))
	equal(t, audio.closes.Load(), int32(0))
	<-wrote
	writer.Close()
	for _, expected := range []out.SynthesisItem{
		{Audio: []byte("b"), CorrelationId: "job/1:0:1", InputGroupId: "job/1:0"},
		{Audio: []byte("b"), CorrelationId: "job/1:1:0", InputGroupId: "job/1:1"},
	} {
		item, err = s.Next(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		equal(t, item, expected)
	}
	for range 2 {
		_, err = s.Next(context.Background())
		equal(t, err, io.EOF)
	}
	equal(t, audio.closes.Load(), int32(1))
	equal(t, calls, []string{"https://proxy.invalid/a%2Fb/api/v1/tts/sync?tenant=one", "https://audio.invalid/a", "https://audio.invalid/b", "https://audio.invalid/result.wav"})
}

func TestModesPollingAndDoneAsyncRetrieval(t *testing.T) {
	for _, mode := range []string{"sync", "async"} {
		for _, status := range []string{"done", "in_progress"} {
			t.Run(mode+"/"+status, func(t *testing.T) {
				initial := job(t)
				initial["status"] = status
				if mode == "async" {
					initial["data"] = "untrusted creation extension"
				}
				calls := []string{}
				s := start(t, Options{Auth: testAuth, Mode: runtime.Some(mode), PollIntervalMs: runtime.Some(0), Transport: transport(func(r *http.Request) (*http.Response, error) {
					calls = append(calls, r.Method+" "+r.URL.EscapedPath())
					if len(calls) == 1 {
						return response(201, io.NopCloser(strings.NewReader(encode(t, initial)))), nil
					}
					if r.URL.Host == "audio.invalid" {
						equal(t, r.Header, http.Header{})
						return response(200, io.NopCloser(strings.NewReader("a"))), nil
					}
					equal(t, r.Header, http.Header{"X-Api-Key": {"test-key"}})
					return response(200, io.NopCloser(strings.NewReader(encode(t, job(t))))), nil
				})})
				_, err := s.Next(context.Background())
				if err != nil {
					t.Fatal(err)
				}
				expected := []string{"POST /api/v1/tts"}
				if mode == "sync" {
					expected[0] += "/sync"
				}
				if mode == "async" || status == "in_progress" {
					expected = append(expected, "GET /api/v1/tts/job%2F1")
				}
				expected = append(expected, "GET /result.wav")
				equal(t, calls, expected)
			})
		}
	}
}

func TestGeneratedValidationBeforeAuthOrIO(t *testing.T) {
	for _, r := range []schema.TtsRequest{
		{Text: "", Voice: "v"}, {Text: "Hi", Voice: ""}, {Text: strings.Repeat("😀", 501), Voice: "v"},
		{Text: "Hi", Voice: "v", Speed: runtime.Some(0.0)}, {Text: "Hi", Voice: "v", Speed: runtime.Some(3.01)},
		{Text: "Hi", Voice: "v", Speed: runtime.Some(math.NaN())}, {Text: "Hi", Voice: "v", Speed: runtime.Some(math.Inf(1))},
	} {
		_, err := Synthesize(context.Background(), r, Options{Transport: transport(func(*http.Request) (*http.Response, error) { t.Fatal("unexpected network"); return nil, nil })})
		errorText(t, err, "Invalid lovo TTS request")
	}
	for _, speed := range []float64{0.05, 3} {
		s, err := Synthesize(context.Background(), schema.TtsRequest{Text: strings.Repeat("😀", 500), Voice: "v", Speed: runtime.Some(speed)}, Options{Auth: testAuth})
		if err != nil {
			t.Fatal(err)
		}
		s.Close()
		_, err = s.Next(context.Background())
		equal(t, err, io.EOF)
	}
}

func TestBoundaryOptionsAndAuthentication(t *testing.T) {
	t.Setenv("LOVO_API_KEY", "native")
	t.Setenv("SPEECHSWITCH_LOVO_API_KEY", "scoped")
	for _, a := range []auth.Auth{testAuth, {}, {Lovo: runtime.Optional[auth.AuthAsync]{Value: auth.AuthAsync{ApiKey: runtime.Some("ignored")}}}} {
		expectedKey := "scoped"
		if a.Lovo.Present {
			expectedKey = "test-key"
		}
		calls := 0
		s, err := Synthesize(context.Background(), schema.TtsRequest{Text: "Hi", Voice: "v", Speed: runtime.Optional[float64]{Value: math.NaN()}, VoiceStyle: runtime.Optional[string]{Value: "ignored"}}, Options{
			Auth: a, Mode: runtime.Optional[string]{Value: "invalid"}, PollIntervalMs: runtime.Optional[int]{Value: -1}, Transport: transport(func(r *http.Request) (*http.Response, error) {
				calls++
				equal(t, r.Header.Get("X-API-KEY"), expectedKey)
				equal(t, r.URL.Path, "/api/v1/tts/sync")
				data, _ := io.ReadAll(r.Body)
				equal(t, decode(t, data), map[string]any{"text": "Hi", "speaker": "v", "speed": float64(1)})
				return response(401, io.NopCloser(strings.NewReader("denied"))), nil
			}),
		})
		if err != nil {
			t.Fatal(err)
		}
		_, err = s.Next(context.Background())
		errorText(t, err, "denied")
		s.Close()
		equal(t, calls, 1)
	}
	for _, tc := range []struct {
		o       Options
		message string
	}{
		{Options{Mode: runtime.Some("")}, "Invalid LOVO mode"},
		{Options{PollIntervalMs: runtime.Some(-1)}, "LOVO polling interval must be an integer between 0 and 2147483647"},
		{Options{MaxJSONBytes: -1}, "LOVO MaxJSONBytes must be a positive uint32 value"},
		{Options{Auth: auth.Auth{Lovo: runtime.Some(auth.AuthAsync{ApiKey: runtime.Some("")})}}, "Missing auth.lovo.apiKey configuration"},
		{Options{Auth: auth.Auth{Lovo: runtime.Some(auth.AuthAsync{ApiKey: runtime.Some("key\n")})}}, "Invalid LOVO authentication header"},
	} {
		_, err := Synthesize(context.Background(), request(), tc.o)
		errorText(t, err, tc.message)
	}
	os.Unsetenv("SPEECHSWITCH_LOVO_API_KEY")
	s, err := Synthesize(context.Background(), request(), Options{})
	if err != nil {
		t.Fatal(err)
	}
	equal(t, s.(*stream).config.key, "native")
	s.Close()
	t.Setenv("SPEECHSWITCH_LOVO_API_KEY", "")
	_, err = Synthesize(context.Background(), request(), Options{})
	errorText(t, err, "Missing auth.lovo.apiKey configuration")
}

func TestProtocolFailuresBeforeAnyDownload(t *testing.T) {
	for _, tc := range []struct {
		name    string
		change  func(map[string]any)
		message string
	}{
		{"id", func(j map[string]any) { j["id"] = ".." }, "LOVO returned an invalid job ID"},
		{"kind", func(j map[string]any) { j["type"] = "other" }, "Invalid LOVO sync-tts response"},
		{"non TTS", func(j map[string]any) { j["type"] = "dubbing" }, "LOVO returned a non-TTS job"},
		{"late failed output", func(j map[string]any) {
			later := fixture(t)["output"].(map[string]any)
			later["status"] = "failed"
			j["data"] = append(j["data"].([]any), later)
		}, "LOVO speech output failed"},
		{"empty", func(j map[string]any) { j["data"] = []any{} }, "LOVO completed without audio outputs"},
		{"missing urls", func(j map[string]any) { delete(j["data"].([]any)[0].(map[string]any), "urls") }, "LOVO completed without usable audio URLs"},
		{"failed", func(j map[string]any) { j["data"].([]any)[0].(map[string]any)["status"] = "failed" }, "LOVO speech output failed"},
		{"unsafe second asset", func(j map[string]any) {
			j["data"].([]any)[0].(map[string]any)["urls"] = []string{"https://audio.invalid/a", "http://other.invalid/b"}
		}, "LOVO returned an unsafe audio URL"},
		{"native error", func(j map[string]any) { j["error"] = map[string]any{"code": "QUOTA", "message": "quota"} }, "quota"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			j := job(t)
			tc.change(j)
			calls := 0
			b := &body{Reader: strings.NewReader(encode(t, j))}
			s := start(t, Options{Auth: testAuth, Transport: transport(func(*http.Request) (*http.Response, error) { calls++; return response(201, b), nil })})
			_, err := s.Next(context.Background())
			errorText(t, err, tc.message)
			if tc.name == "native error" {
				equal(t, err, &Error{Message: "quota", Code: runtime.Some("QUOTA"), JobID: runtime.Some("job/1")})
			}
			equal(t, calls, 1)
			equal(t, b.closes.Load(), int32(1))
			_, err = s.Next(context.Background())
			equal(t, err, io.EOF)
		})
	}
}

func TestMetadataAndHTTPFailures(t *testing.T) {
	for _, tc := range []struct {
		status, limit int
		data, message string
	}{
		{200, 0, "", "LOVO returned HTTP 200; expected 201"},
		{201, 0, "{", "LOVO returned invalid JSON"},
		{201, 0, "{}", "Invalid LOVO sync-tts response"},
		{429, 0, "quota", "quota"}, {500, 3, "abcd", "LOVO response exceeds MaxJSONBytes"},
	} {
		b := &body{Reader: strings.NewReader(tc.data)}
		s := start(t, Options{Auth: testAuth, MaxJSONBytes: tc.limit, Transport: transport(func(*http.Request) (*http.Response, error) {
			r := response(tc.status, b)
			r.Header = http.Header{"retry-after": {"3"}}
			return r, nil
		})})
		_, err := s.Next(context.Background())
		errorText(t, err, tc.message)
		equal(t, b.closes.Load(), int32(1))
		if tc.status == 429 {
			equal(t, err, &Error{Message: "quota", StatusCode: runtime.Some(429), RetryAfter: runtime.Some("3")})
		}
	}
	original := errors.New("original read failure")
	b := &body{Reader: readerFunc(func([]byte) (int, error) { return 0, original })}
	s := start(t, Options{Auth: testAuth, Transport: transport(func(*http.Request) (*http.Response, error) { return response(201, b), nil })})
	_, err := s.Next(context.Background())
	equal(t, err, original)
	equal(t, b.closes.Load(), int32(1))
}

type readerFunc func([]byte) (int, error)

func (f readerFunc) Read(b []byte) (int, error) { return f(b) }

func TestURLValidation(t *testing.T) {
	for _, value := range []string{"ftp://api.invalid", "https://u:p@api.invalid", "https://api.invalid/#x", "https://api.invalid/%xy", "https://api.invalid/?x=%xy", "https://api.invalid:65536", "https://api.invalid/a b", "https://api.invalid/\\x", "https://api.invalid/\x7f"} {
		_, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, BaseURL: value})
		errorText(t, err, "LOVO URL must be HTTP(S) without credentials, fragments or invalid escapes")
	}
	for _, tc := range []struct{ url, origin string }{{"https://API.invalid:00443/a", "https://api.invalid:443"}, {"http://api.invalid:0", "http://api.invalid:0"}} {
		u, err := endpoint(tc.url)
		if err != nil {
			t.Fatal(err)
		}
		equal(t, origin(u), tc.origin)
	}
}
