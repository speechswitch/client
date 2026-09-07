package vocu

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/vocu"
	out "github.com/speechswitch/client/sdks/go/generated/vocu_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) Do(r *http.Request) (*http.Response, error) { return f(r) }

type step struct {
	data []byte
	err  error
}
type body struct {
	steps           []step
	stall           bool
	reading, closed chan struct{}
	once            sync.Once
	reads, closes   atomic.Int32
	closeError      error
}

func newBody(steps ...step) *body {
	return &body{steps: steps, reading: make(chan struct{}, 1), closed: make(chan struct{})}
}
func (b *body) Read(dst []byte) (int, error) {
	b.reads.Add(1)
	if len(b.steps) > 0 {
		s := &b.steps[0]
		n := copy(dst, s.data)
		s.data = s.data[n:]
		if len(s.data) > 0 {
			return n, nil
		}
		err := s.err
		b.steps = b.steps[1:]
		return n, err
	}
	if b.stall {
		select {
		case b.reading <- struct{}{}:
		default:
		}
		<-b.closed
	}
	return 0, io.EOF
}
func (b *body) Close() error {
	b.closes.Add(1)
	b.once.Do(func() { close(b.closed) })
	return b.closeError
}
func equal(t *testing.T, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v; want %#v", got, want)
	}
}
func authConfig() auth.Auth {
	a := auth.Auth{}
	a.Vocu.Present = true
	a.Vocu.Value.ApiKey = runtime.Some("fixture")
	return a
}
func request() schema.TtsRequestAsTextVoice9c5ed44a {
	return schema.TtsRequestAsTextVoice9c5ed44a{Value: schema.TtsRequestTextVoice9c5ed44a{Voice: "market:owned", Text: "Hello"}}
}
func response(b *body) *http.Response {
	return &http.Response{StatusCode: 200, Header: http.Header{"cOnTeNt-TyPe": {"audio/mpeg"}}, Body: b}
}
func metadata(t *testing.T, value any) *http.Response {
	t.Helper()
	data, err := json.Marshal(map[string]any{"status": 200, "data": value})
	if err != nil {
		t.Fatal(err)
	}
	r := response(newBody(step{data: data}))
	r.Header = http.Header{}
	return r
}
func options(responses ...*http.Response) Options {
	index := 0
	return Options{Auth: authConfig(), Transport: transportFunc(func(*http.Request) (*http.Response, error) {
		if index == len(responses) {
			return nil, errors.New("unexpected request")
		}
		r := responses[index]
		index++
		return r, nil
	})}
}
func collect(t *testing.T, s runtime.Input[out.SynthesisItem]) ([]out.SynthesisItem, error) {
	t.Helper()
	defer s.Close()
	items := []out.SynthesisItem{}
	for {
		item, err := s.Next(context.Background())
		if err == io.EOF {
			return items, nil
		}
		if err != nil {
			return items, err
		}
		items = append(items, item)
	}
}

type fixtures struct {
	Requests []struct {
		Name, Mode string
		Wire       json.RawMessage
	}
	HTTPMetadata, GeneratedJob json.RawMessage
	Audio                      []byte
}

func shared(t *testing.T) fixtures {
	t.Helper()
	data, err := os.ReadFile("../../../fixtures/vocu.json")
	if err != nil {
		t.Fatal(err)
	}
	var f fixtures
	if err = json.Unmarshal(data, &f); err != nil {
		t.Fatal(err)
	}
	return f
}
func native(t *testing.T, data []byte) any {
	t.Helper()
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		t.Fatal(err)
	}
	return value
}

// Generated unions accept value and pointer wrappers, including nested controls.
func pointerWrappers(value reflect.Value) {
	switch value.Kind() {
	case reflect.Interface:
		if !value.IsNil() {
			child := reflect.New(value.Elem().Type())
			child.Elem().Set(value.Elem())
			pointerWrappers(child.Elem())
			value.Set(child)
		}
	case reflect.Struct:
		for index := 0; index < value.NumField(); index++ {
			pointerWrappers(value.Field(index))
		}
	case reflect.Slice:
		for index := 0; index < value.Len(); index++ {
			pointerWrappers(value.Index(index))
		}
	}
}

func TestSharedFixturesMatchNativePayloadsAndCompletion(t *testing.T) {
	fixtures := shared(t)
	for index, input := range fixtureRequests() {
		fixture := fixtures.Requests[index]
		for _, pointer := range []bool{false, true} {
			t.Run(fixture.Name+map[bool]string{false: " value", true: " pointer"}[pointer], func(t *testing.T) {
				if pointer {
					pointerWrappers(reflect.ValueOf(&input).Elem())
				}
				audio := newBody(step{data: fixtures.Audio[:1]}, step{data: fixtures.Audio[1:], err: io.EOF})
				var bodies []*body
				var requests []struct {
					Method, URL string
					Headers     http.Header
					Body        any
				}
				o := Options{Auth: authConfig(), BaseURL: "https://proxy.test/base%2Fescaped", Mode: fixture.Mode, Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
					var payload any
					if r.Method == "POST" {
						data, err := io.ReadAll(r.Body)
						if err != nil {
							t.Fatal(err)
						}
						payload = native(t, data)
					}
					requests = append(requests, struct {
						Method, URL string
						Headers     http.Header
						Body        any
					}{r.Method, r.URL.String(), r.Header.Clone(), payload})
					if len(requests) == 1 && fixture.Mode != "stream" {
						value := fixtures.HTTPMetadata
						if fixture.Mode == "async" {
							value = fixtures.GeneratedJob
						}
						result := metadata(t, native(t, value))
						bodies = append(bodies, result.Body.(*body))
						return result, nil
					}
					return response(audio), nil
				})}
				s, err := Synthesize(context.Background(), input, o)
				if err != nil {
					t.Fatal(err)
				}
				items, err := collect(t, s)
				equal(t, err, nil)
				path := "simple-generate"
				if fixture.Mode == "async" {
					path = "generate"
				}
				equal(t, requests[0].URL, "https://proxy.test/base%2Fescaped/api/tts/"+path)
				equal(t, requests[0].Method, "POST")
				equal(t, requests[0].Headers, http.Header{"Authorization": {"Bearer fixture"}, "Content-Type": {"application/json"}})
				equal(t, requests[0].Body, native(t, fixture.Wire))
				var completion out.VocuDoneEventCompletion = out.VocuDoneEventCompletionAsTransport{}
				if fixture.Mode == "async" {
					completion = out.VocuDoneEventCompletionAsGenerated{}
				}
				done := out.VocuDoneEvent{Completion: completion}
				if fixture.Mode != "stream" {
					value := fixtures.HTTPMetadata
					address := "https://storage.vocu.ai/generate/stream.mp3?auth=fixture"
					if fixture.Mode == "async" {
						value = fixtures.GeneratedJob
						address = "https://storage.vocu.ai/generate/merged.mp3"
					}
					decoded, err := decodeObject(value)
					equal(t, err, nil)
					var m out.VocuDoneEventMetadata = out.VocuDoneEventMetadataAsRecord{Value: decoded}
					done.Metadata = runtime.Some(m)
					equal(t, len(requests), 2)
					equal(t, requests[1].URL, address)
					equal(t, requests[1].Method, "GET")
					equal(t, requests[1].Headers, http.Header{})
					equal(t, requests[1].Body, nil)
				} else {
					equal(t, len(requests), 1)
				}
				equal(t, items, []out.SynthesisItem{out.SynthesisItemAsBytes{Value: fixtures.Audio[:1]}, out.SynthesisItemAsBytes{Value: fixtures.Audio[1:]}, out.SynthesisItemAsDone{Value: done}})
				for _, b := range append(bodies, audio) {
					equal(t, b.closes.Load(), int32(1))
				}
			})
		}
	}
}

func TestAsyncPollingPreservesIdentityAndTracing(t *testing.T) {
	f := shared(t)
	audio := newBody(step{data: f.Audio})
	replies := []*http.Response{metadata(t, map[string]any{"id": "job_1", "status": "pending", "metadata": map[string]any{"audio": "https://evil.test/early"}}), metadata(t, map[string]any{"id": "job_1", "status": "processing"}), metadata(t, native(t, f.GeneratedJob)), response(audio)}
	replies[0].Header.Set("X-Vocu-App-Request-Id", "submit")
	replies[2].Header.Set("X-Vocu-App-Request-Id", "poll")
	replies[3].Header.Set("X-Vocu-App-Request-Id", "asset")
	var paths []string
	o := options()
	o.PollIntervalMs = runtime.Some(int64(0))
	o.Auth.Vocu.Value.ApiKey = runtime.Optional[string]{}
	o.Auth.Vocu.Value.AccessToken = runtime.Some("session")
	o.Transport = transportFunc(func(r *http.Request) (*http.Response, error) {
		index := len(paths)
		paths = append(paths, r.URL.String())
		if index < 3 {
			equal(t, r.Header.Get("Authorization"), "Bearer session")
		} else {
			equal(t, r.Header, http.Header{})
		}
		if index > 0 {
			equal(t, r.Method, "GET")
		}
		return replies[index], nil
	})
	s, err := Synthesize(context.Background(), fixtureRequests()[4], o)
	if err != nil {
		t.Fatal(err)
	}
	items, err := collect(t, s)
	equal(t, err, nil)
	equal(t, paths, []string{"https://v1.vocu.ai/api/tts/generate", "https://v1.vocu.ai/api/tts/generate/job_1", "https://v1.vocu.ai/api/tts/generate/job_1", "https://storage.vocu.ai/generate/merged.mp3"})
	equal(t, items[len(items)-1].(out.SynthesisItemAsDone).Value.RequestId, runtime.Some("poll"))
	for _, r := range replies {
		equal(t, r.Body.(*body).closes.Load(), int32(1))
	}
}

func TestJobFailuresDoNotDownloadOrFabricateCompletion(t *testing.T) {
	for _, test := range []struct {
		jobs    []any
		message string
	}{
		{[]any{map[string]any{"id": "../other", "status": "pending"}}, "Invalid Vocu job ID"},
		{[]any{map[string]any{"id": "job\n", "status": "pending"}}, "Invalid Vocu job ID"},
		{[]any{map[string]any{"id": "job", "status": "unknown"}}, "Invalid Vocu job status"},
		{[]any{map[string]any{"id": "job", "status": "pending"}, map[string]any{"id": "other", "status": "generated"}}, "Vocu returned a different job ID while polling"},
		{[]any{map[string]any{"id": "job", "status": "failed", "reason": "private"}}, "Vocu generation failed"},
		{[]any{map[string]any{"id": "job", "status": "generated", "metadata": map[string]any{}}}, "Vocu returned no audio URL"},
		{[]any{map[string]any{"id": "job", "status": "generated", "metadata": []any{}}}, "Invalid Vocu response object"},
	} {
		t.Run(test.message, func(t *testing.T) {
			replies := []*http.Response{}
			for _, job := range test.jobs {
				replies = append(replies, metadata(t, job))
			}
			o := options(replies...)
			o.Mode = "async"
			o.PollIntervalMs = runtime.Some(int64(0))
			s, err := Synthesize(context.Background(), request(), o)
			if err != nil {
				t.Fatal(err)
			}
			items, err := collect(t, s)
			equal(t, items, []out.SynthesisItem{})
			if err == nil {
				t.Fatal("missing failure")
			}
			equal(t, err.Error(), test.message)
			if e, ok := err.(*Error); ok {
				equal(t, e, &Error{JobID: runtime.Some("job")})
			}
			for _, r := range replies {
				equal(t, r.Body.(*body).closes.Load(), int32(1))
			}
		})
	}
}

func TestMetadataAndAudioValidation(t *testing.T) {
	for _, test := range []struct{ data, message string }{
		{"{", "Invalid Vocu metadata"}, {"\xff", "Invalid Vocu metadata"}, {`{"status":200,"data":{"x":1e999}}`, "Invalid Vocu metadata"}, {`{"status":200,"data":{"x":NaN}}`, "Invalid Vocu metadata"}, {`{"status":200,"data":{"x":"\ud800"}}`, "Invalid Vocu metadata"},
		{"[]", "Invalid Vocu response object"}, {`{"status":200,"data":[]}`, "Invalid Vocu response object"}, {`{"status":201,"data":{}}`, "Invalid Vocu response status"},
	} {
		b := newBody(step{data: []byte(test.data)})
		o := options(response(b))
		o.Mode = "http"
		s, err := Synthesize(context.Background(), request(), o)
		if err != nil {
			t.Fatal(err)
		}
		_, err = collect(t, s)
		if err == nil {
			t.Fatal("accepted invalid metadata")
		}
		equal(t, err.Error(), test.message)
		equal(t, b.closes.Load(), int32(1))
	}
	for _, header := range []bool{false, true} {
		b := newBody(step{data: []byte("12345")})
		r := response(b)
		o := options(r)
		o.MaxMetadataBytes = 4
		if header {
			r.Header.Set("X-Reecho-Response-Data", `{"x":1}`)
		} else {
			o.Mode = "http"
		}
		s, err := Synthesize(context.Background(), request(), o)
		if err != nil {
			t.Fatal(err)
		}
		_, err = collect(t, s)
		equal(t, err.Error(), "Vocu metadata exceeds MaxMetadataBytes")
		equal(t, b.closes.Load(), int32(1))
		reads := int32(1)
		if header {
			reads = 0
		}
		equal(t, b.reads.Load(), reads)
	}
	b := newBody(step{data: []byte("unbounded audio")})
	o := options(response(b))
	o.MaxMetadataBytes = 1
	s, err := Synthesize(context.Background(), request(), o)
	if err != nil {
		t.Fatal(err)
	}
	items, err := collect(t, s)
	equal(t, err, nil)
	equal(t, items[0], out.SynthesisItemAsBytes{Value: []byte("unbounded audio")})
	for _, media := range []string{"audio/mpeg", "application/json"} {
		b := newBody()
		r := response(b)
		r.Header = http.Header{"Content-Type": {media}}
		s, err := Synthesize(context.Background(), request(), options(r))
		if err != nil {
			t.Fatal(err)
		}
		_, err = collect(t, s)
		message := "Vocu returned no audio"
		if media == "application/json" {
			message = "Vocu returned an unexpected audio content type"
		}
		equal(t, err.Error(), message)
		equal(t, b.closes.Load(), int32(1))
	}
}

func TestAudioOriginsAndCredentialIsolation(t *testing.T) {
	for _, address := range []string{"https://evil.test/audio", "http://127.0.0.1/secret", "https://storage.vocu.ai.evil.test/audio", "https://key:secret@storage.vocu.ai/audio", "https://storage.vocu.ai/audio#fragment", "https://storage.vocu.ai/\nsecret", "https://storage.vocu.ai/%zz", "//evil.test/audio"} {
		r := metadata(t, map[string]any{"audio": address})
		o := options(r)
		o.Mode = "http"
		s, err := Synthesize(context.Background(), request(), o)
		if err != nil {
			t.Fatal(err)
		}
		_, err = collect(t, s)
		equal(t, err.Error(), "Vocu returned an untrusted audio URL")
		equal(t, r.Body.(*body).closes.Load(), int32(1))
	}
	for _, test := range []struct{ address, base, origin, want string }{
		{"relative.mp3", "https://v1.vocu.ai/base", "", "https://v1.vocu.ai/relative.mp3"},
		{"/audio.mp3", "https://proxy.test/base", "https://proxy.test", "https://proxy.test/audio.mp3"},
		{"http://127.0.0.1:8181/audio?token=fixture", "https://v1.vocu.ai", "http://127.0.0.1:8181", "http://127.0.0.1:8181/audio?token=fixture"},
	} {
		calls := 0
		o := Options{Auth: authConfig(), Mode: "http", BaseURL: test.base, Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
			calls++
			if calls == 1 {
				return metadata(t, map[string]any{"audio": test.address}), nil
			}
			equal(t, r.URL.String(), test.want)
			equal(t, r.Header, http.Header{})
			equal(t, r.Method, "GET")
			return response(newBody(step{data: []byte{1}})), nil
		})}
		if test.origin != "" {
			o.AudioOrigins = []string{test.origin}
		}
		s, err := Synthesize(context.Background(), request(), o)
		if err != nil {
			t.Fatal(err)
		}
		_, err = collect(t, s)
		equal(t, err, nil)
		equal(t, calls, 2)
	}
}

func TestHeaderMetadataPreservesNativeShape(t *testing.T) {
	header := `{"credit_used":0,"srt":[null,true,{"native_key":"你好😀"}]}`
	b := newBody(step{data: []byte{0, 255}})
	r := response(b)
	r.Header.Set("X-Reecho-Response-Data", header)
	r.Header.Set("X-Vocu-App-Request-Id", "trace")
	s, err := Synthesize(context.Background(), request(), options(r))
	if err != nil {
		t.Fatal(err)
	}
	items, err := collect(t, s)
	equal(t, err, nil)
	var m out.VocuDoneEventMetadata = out.VocuDoneEventMetadataAsRecord{Value: map[string]runtime.JsonValue{
		"credit_used": runtime.JsonNumber(0),
		"srt":         runtime.JsonArray{runtime.JsonNull{}, runtime.JsonBool(true), runtime.JsonObject{"native_key": runtime.JsonString("你好😀")}},
	}}
	equal(t, items[1], out.SynthesisItemAsDone{Value: out.VocuDoneEvent{Completion: out.VocuDoneEventCompletionAsTransport{}, Metadata: runtime.Some(m), RequestId: runtime.Some("trace")}})
}

func TestHTTPErrorBodiesAreUnreadAndNotRetried(t *testing.T) {
	for _, status := range []int{302, 401, 429, 500} {
		b := newBody(step{data: []byte("private")})
		b.closeError = errors.New("cleanup")
		r := response(b)
		r.StatusCode = status
		r.Header.Set("Retry-After", "7")
		r.Header.Set("X-Vocu-App-Request-Id", "trace")
		s, err := Synthesize(context.Background(), request(), options(r))
		equal(t, s, nil)
		equal(t, err, &Error{Status: runtime.Some(status), RequestID: runtime.Some("trace"), RetryAfter: runtime.Some("7")})
		equal(t, b.reads.Load(), int32(0))
		equal(t, b.closes.Load(), int32(1))
		equal(t, err.Error(), fmt.Sprintf("Vocu returned HTTP %d", status))
	}
}
