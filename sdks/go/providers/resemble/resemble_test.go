package resemble

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/resemble"
	out "github.com/speechswitch/client/sdks/go/generated/resemble_output"
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
		item := &b.steps[0]
		n := copy(dst, item.data)
		item.data = item.data[n:]
		if len(item.data) != 0 {
			return n, nil
		}
		err := item.err
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
func authenticated() auth.Auth {
	return auth.Auth{Resemble: runtime.Some(auth.AuthResemble{Token: runtime.Some("fixture")})}
}
func baseRequest() schema.TtsRequestAsText {
	return schema.TtsRequestAsText{Value: schema.TtsRequestText{Text: "Hello"}}
}
func reply(data, contentType string, status int) *http.Response {
	return &http.Response{StatusCode: status, Header: http.Header{"CONTENT-Type": {contentType}, "Retry-After": {"7"}}, Body: newBody(step{data: []byte(data)})}
}

const submitted = `{"event_id":"event/?#雪"}`
const completion = "event: complete\ndata: [{\"path\":\"/tmp/gradio/file with?#雪.wav\"}]\n\n"

func transport(t *testing.T, replies ...*http.Response) (runtime.HTTPTransport, *[]*http.Request) {
	t.Helper()
	calls := []*http.Request{}
	return transportFunc(func(r *http.Request) (*http.Response, error) {
		calls = append(calls, r)
		if len(calls) > len(replies) {
			return nil, errors.New("unexpected request")
		}
		return replies[len(calls)-1], nil
	}), &calls
}
func collect(t *testing.T, audio runtime.Input[out.SynthesisItem]) ([]any, string) {
	t.Helper()
	defer audio.Close()
	result := []any{}
	for {
		item, err := audio.Next(context.Background())
		if err == io.EOF {
			return result, ""
		}
		if err != nil {
			return result, err.Error()
		}
		switch item := item.(type) {
		case out.SynthesisItemAsBytes:
			values := make([]any, len(item.Value))
			for i, b := range item.Value {
				values[i] = float64(b)
			}
			result = append(result, map[string]any{"audio": values})
		case out.SynthesisItemAsDone:
			result = append(result, map[string]any{"event": "done", "requestId": item.Value.RequestId})
		default:
			t.Fatalf("unexpected item %T", item)
		}
	}
}
func optional[T any](value *T) runtime.Optional[T] {
	if value != nil {
		return runtime.Some(*value)
	}
	return runtime.Optional[T]{}
}
func boolean(value *bool) runtime.Optional[schema.TtsRequestTextReferenceAudioTrimming] {
	if value == nil {
		return runtime.Optional[schema.TtsRequestTextReferenceAudioTrimming]{}
	}
	if *value {
		return runtime.Some(schema.TtsRequestTextReferenceAudioTrimming(schema.TtsRequestTextReferenceAudioTrimmingAsTrue{}))
	}
	return runtime.Some(schema.TtsRequestTextReferenceAudioTrimming(schema.TtsRequestTextReferenceAudioTrimmingAsFalse{}))
}
func fixtureRequest(t *testing.T, data json.RawMessage) schema.TtsRequest {
	t.Helper()
	var r struct {
		Model, Text, Language                                                                          string
		ReferenceAudio                                                                                 *[]byte
		Temperature, RandomSeed, StyleExaggeration, VoiceGuidance, MinP, TopP, TopK, RepetitionPenalty *float64
		ReferenceAudioTrimming, LoudnessNormalization                                                  *bool
		Output                                                                                         *struct{ Format string }
	}
	if err := json.Unmarshal(data, &r); err != nil {
		t.Fatal(err)
	}
	output := runtime.Optional[schema.TtsRequestTextOutput]{}
	if r.Output != nil {
		if r.Output.Format != "wav" {
			t.Fatal(r.Output.Format)
		}
		output = runtime.Some(schema.TtsRequestTextOutput{})
	}
	switch r.Model {
	case "", "chatterbox":
		return schema.TtsRequestAsText{Value: schema.TtsRequestText{Text: r.Text, ReferenceAudio: optional(r.ReferenceAudio), Output: output,
			Temperature: optional(r.Temperature), RandomSeed: optional(r.RandomSeed), StyleExaggeration: optional(r.StyleExaggeration), VoiceGuidance: optional(r.VoiceGuidance), ReferenceAudioTrimming: boolean(r.ReferenceAudioTrimming)}}
	case "chatterbox-multilingual":
		language := runtime.Optional[schema.TtsRequestChatterboxMultilingualTextLanguage]{}
		if r.Language != "" {
			if r.Language != "fr" {
				t.Fatal(r.Language)
			}
			language = runtime.Some(schema.TtsRequestChatterboxMultilingualTextLanguage(schema.TtsRequestChatterboxMultilingualTextLanguageAsFr{}))
		}
		return schema.TtsRequestAsChatterboxMultilingualText{Value: schema.TtsRequestChatterboxMultilingualText{Text: r.Text, ReferenceAudio: optional(r.ReferenceAudio), Output: output, Language: language,
			Temperature: optional(r.Temperature), RandomSeed: optional(r.RandomSeed), StyleExaggeration: optional(r.StyleExaggeration), VoiceGuidance: optional(r.VoiceGuidance)}}
	case "chatterbox-turbo":
		return schema.TtsRequestAsChatterboxTurboText{Value: schema.TtsRequestChatterboxTurboText{Text: r.Text, ReferenceAudio: optional(r.ReferenceAudio), Output: output,
			Temperature: optional(r.Temperature), RandomSeed: optional(r.RandomSeed), MinP: optional(r.MinP), TopP: optional(r.TopP), TopK: optional(r.TopK), RepetitionPenalty: optional(r.RepetitionPenalty), LoudnessNormalization: boolean(r.LoudnessNormalization)}}
	default:
		t.Fatalf("unknown fixture model %q", r.Model)
		return nil
	}
}

func TestSharedRequestsAndExactMultipart(t *testing.T) {
	data, err := os.ReadFile("../../../fixtures/resemble.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures struct {
		Requests []struct {
			Name, Host, API string
			Request         json.RawMessage
			Wire            any
		}
	}
	if err := json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range fixtures.Requests {
		t.Run(fixture.Name, func(t *testing.T) {
			request := fixtureRequest(t, fixture.Request)
			for _, pointer := range []bool{false, true} {
				if pointer {
					switch value := request.(type) {
					case schema.TtsRequestAsText:
						request = &value
					case schema.TtsRequestAsChatterboxMultilingualText:
						request = &value
					case schema.TtsRequestAsChatterboxTurboText:
						request = &value
					}
				}
				input, err := settings(request)
				if err != nil {
					t.Fatal(err)
				}
				paths, methods := []string{}, []string{}
				bodies := []*body{}
				tr := transportFunc(func(r *http.Request) (*http.Response, error) {
					if r.URL.Host != fixture.Host || r.Header.Get("Authorization") != "Bearer fixture" {
						t.Errorf("request %s %#v", r.URL, r.Header)
					}
					paths = append(paths, r.URL.EscapedPath())
					methods = append(methods, r.Method)
					var res *http.Response
					switch r.URL.Path {
					case "/gradio_api/upload":
						typ, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
						if err != nil || typ != "multipart/form-data" {
							t.Fatal(typ, err)
						}
						parts := multipart.NewReader(r.Body, params["boundary"])
						part, err := parts.NextPart()
						if err != nil {
							t.Fatal(err)
						}
						audio, err := io.ReadAll(part)
						if err != nil {
							t.Fatal(err)
						}
						if part.FormName() != "files" || part.FileName() != "reference.audio" || part.Header.Get("Content-Type") != "application/octet-stream" || !bytes.Equal(audio, input.reference.Value) {
							t.Fatalf("multipart %#v %x", part.Header, audio)
						}
						if _, err := parts.NextPart(); err != io.EOF {
							t.Fatal(err)
						}
						res = reply(`["/uploaded/reference"]`, "application/json", 200)
					case "/gradio_api/info":
						res = reply(`{"named_endpoints":{"/generate":{"parameters":[null,{"parameter_name":"audio_prompt_path","parameter_default":{"path":"/current/cache/reference.wav","url":"https://wrong.example/generic.wav"}}]}}}`, "application/json", 200)
					default:
						if r.Method == "POST" {
							var got any
							if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
								t.Fatal(err)
							}
							if !reflect.DeepEqual(got, fixture.Wire) {
								t.Fatalf("wire %#v want %#v", got, fixture.Wire)
							}
							res = reply(submitted, "application/json", 200)
						} else if strings.HasPrefix(r.URL.Path, "/gradio_api/call/") {
							res = reply(completion, " Text/Event-Stream ; charset=utf-8", 200)
						} else {
							res = reply("\x00\xff\x80", "audio/wav", 200)
						}
					}
					bodies = append(bodies, res.Body.(*body))
					return res, nil
				})
				audio, err := Synthesize(context.Background(), request, Options{Auth: authenticated(), Transport: tr})
				if err != nil {
					t.Fatal(err)
				}
				result, failure := collect(t, audio)
				want := []any{map[string]any{"audio": []any{float64(0), float64(255), float64(128)}}, map[string]any{"event": "done", "requestId": "event/?#雪"}}
				if failure != "" || !reflect.DeepEqual(result, want) {
					t.Fatal(result, failure)
				}
				expected := []string{}
				verbs := []string{}
				if input.reference.Present {
					expected = append(expected, "/gradio_api/upload")
					verbs = append(verbs, "POST")
				} else if input.needsReference {
					expected = append(expected, "/gradio_api/info")
					verbs = append(verbs, "GET")
				}
				expected = append(expected, "/gradio_api/call/"+fixture.API, "/gradio_api/call/"+fixture.API+"/event%2F%3F%23%E9%9B%AA", "/gradio_api/file=%2Ftmp%2Fgradio%2Ffile%20with%3F%23%E9%9B%AA.wav")
				verbs = append(verbs, "POST", "GET", "GET")
				if !reflect.DeepEqual(paths, expected) || !reflect.DeepEqual(methods, verbs) {
					t.Fatal(paths, methods)
				}
				for _, b := range bodies {
					if b.closes.Load() != 1 {
						t.Fatal("close count", b.closes.Load())
					}
				}
			}
		})
	}
}

func TestSharedQueueAtEveryByteSplit(t *testing.T) {
	data, err := os.ReadFile("../../../fixtures/resemble.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures struct {
		Streams []struct {
			Name, Body string
			Output     []any
			Error      *string
		}
	}
	if err := json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range fixtures.Streams {
		t.Run(fixture.Name, func(t *testing.T) {
			for split := 0; split <= len(fixture.Body); split++ {
				queue := newBody(step{data: []byte(fixture.Body[:split])}, step{data: []byte(fixture.Body[split:])})
				download := reply("\x00\xff\x80", "audio/wav", 200)
				tr, calls := transport(t, reply(submitted, "application/json", 200), &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"text/event-stream"}}, Body: queue}, download)
				audio, err := Synthesize(context.Background(), baseRequest(), Options{Auth: authenticated(), Transport: tr})
				if err != nil {
					t.Fatal(err)
				}
				output, failure := collect(t, audio)
				expected := ""
				count := 3
				closed := int32(1)
				if fixture.Error != nil {
					expected = *fixture.Error
					count = 2
					closed = 0
				}
				if failure != expected || !reflect.DeepEqual(output, fixture.Output) {
					t.Fatalf("split %d %#v %q", split, output, failure)
				}
				if queue.closes.Load() != 1 || download.Body.(*body).closes.Load() != closed || len(*calls) != count {
					t.Fatal("ownership", split, len(*calls))
				}
			}
		})
	}
}

func TestLazyAndEarlyExitLifecycle(t *testing.T) {
	tr, calls := transport(t)
	audio, err := Synthesize(context.Background(), baseRequest(), Options{Auth: authenticated(), Transport: tr})
	if err != nil {
		t.Fatal(err)
	}
	if err := audio.Close(); err != nil {
		t.Fatal(err)
	}
	if len(*calls) != 0 {
		t.Fatal("unread stream performed I/O")
	}
	if item, err := audio.Next(context.Background()); item != nil || err != io.EOF {
		t.Fatal(item, err)
	}
	queue := newBody(step{data: []byte(completion + "invalid tail")})
	queue.stall = true
	download := newBody(step{data: []byte("first")}, step{data: []byte("second")})
	download.stall = true
	tr, calls = transport(t, reply(submitted, "application/json", 200), &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"text/event-stream"}}, Body: queue}, &http.Response{StatusCode: 200, Header: http.Header{}, Body: download})
	audio, err = Synthesize(context.Background(), baseRequest(), Options{Auth: authenticated(), Transport: tr})
	if err != nil {
		t.Fatal(err)
	}
	item, err := audio.Next(context.Background())
	if err != nil || !reflect.DeepEqual(item, out.SynthesisItemAsBytes{Value: []byte("first")}) {
		t.Fatal(item, err)
	}
	if queue.reads.Load() != 1 || queue.closes.Load() != 1 || download.reads.Load() != 1 || download.closes.Load() != 0 {
		t.Fatal("not incremental")
	}
	audio.Close()
	audio.Close()
	if download.closes.Load() != 1 || len(*calls) != 3 {
		t.Fatal("close", download.closes.Load(), len(*calls))
	}
}

func TestAssetURLAuthAndProxyBoundaries(t *testing.T) {
	for _, tc := range []struct {
		target, want string
		auth         bool
	}{
		{"", "https://proxy.test/root/gradio_api/file=%2Ftmp%2Fa%20%3F%23%E9%9B%AA.wav?tenant=one;two&x=%2F", true},
		{"gradio_api/file=audio.wav?sig=one;two&x=%2F", "https://proxy.test/root/gradio_api/file=audio.wav?sig=one;two&x=%2F", true},
		{"https://PROXY.test:443/audio", "https://PROXY.test:443/audio", true},
		{"https://cdn.test/audio?sig=%2F", "https://cdn.test/audio?sig=%2F", false},
		{"//cdn.test/audio", "https://cdn.test/audio", false},
		{"https://proxy.test:0/audio", "https://proxy.test:0/audio", false},
	} {
		t.Run(tc.target, func(t *testing.T) {
			file, _ := json.Marshal([]any{map[string]any{"path": "/tmp/a ?#雪.wav", "url": tc.target}})
			tr, calls := transport(t, reply(submitted, "application/json", 200), reply("event: complete\ndata: "+string(file)+"\n\n", "text/event-stream", 200), reply("audio", "audio/wav", 200))
			audio, err := Synthesize(context.Background(), baseRequest(), Options{Auth: authenticated(), Transport: tr, BaseURL: "https://proxy.test/root?tenant=one;two&x=%2F"})
			if err != nil {
				t.Fatal(err)
			}
			_, failure := collect(t, audio)
			if failure != "" {
				t.Fatal(failure)
			}
			expected := []string{"https://proxy.test/root/gradio_api/call/generate_tts_audio?tenant=one;two&x=%2F", "https://proxy.test/root/gradio_api/call/generate_tts_audio/event%2F%3F%23%E9%9B%AA?tenant=one;two&x=%2F", tc.want}
			got := []string{}
			for _, r := range *calls {
				got = append(got, r.URL.String())
			}
			if !reflect.DeepEqual(got, expected) {
				t.Fatal(got)
			}
			headers := http.Header{}
			if tc.auth {
				headers.Set("Authorization", "Bearer fixture")
			}
			if !reflect.DeepEqual((*calls)[2].Header, headers) {
				t.Fatal((*calls)[2].Header)
			}
		})
	}
	for _, target := range []string{"file:///tmp/a.wav", "http://cdn.test/audio", "https://user:pass@cdn.test/audio", "https://cdn.test/%wrong", "https://cdn.test/audio#fragment", "\\\\cdn.test\\audio", "\nhttps://cdn.test/audio"} {
		file, _ := json.Marshal([]any{map[string]any{"path": "a", "url": target}})
		tr, calls := transport(t, reply(submitted, "application/json", 200), reply("event: complete\ndata: "+string(file)+"\n\n", "text/event-stream", 200))
		audio, err := Synthesize(context.Background(), baseRequest(), Options{Auth: authenticated(), Transport: tr})
		if err != nil {
			t.Fatal(err)
		}
		_, failure := collect(t, audio)
		want := "Invalid Resemble deployment or audio URL"
		if target == "http://cdn.test/audio" {
			want = "Resemble returned an unsafe audio URL"
		}
		if failure != want || len(*calls) != 2 {
			t.Fatal(target, failure, len(*calls))
		}
	}
}

func TestProtocolErrorsAndHTTPFailures(t *testing.T) {
	for _, stage := range []string{"upload", "info", "submit", "queue", "download"} {
		for _, status := range []int{302, 401, 429, 503} {
			request := schema.TtsRequest(baseRequest())
			replies := []*http.Response{}
			if stage == "upload" {
				r := baseRequest()
				r.Value.ReferenceAudio = runtime.Some([]byte("audio"))
				request = r
			}
			if stage == "info" {
				request = schema.TtsRequestAsChatterboxTurboText{Value: schema.TtsRequestChatterboxTurboText{Text: "Hello"}}
			}
			if stage == "queue" || stage == "download" {
				replies = append(replies, reply(submitted, "application/json", 200))
			}
			if stage == "download" {
				replies = append(replies, reply(completion, "text/event-stream", 200))
			}
			failure := reply("quota \xff", "text/plain", status)
			replies = append(replies, failure)
			tr, calls := transport(t, replies...)
			audio, err := Synthesize(context.Background(), request, Options{Auth: authenticated(), Transport: tr})
			if err != nil {
				t.Fatal(err)
			}
			_, err = audio.Next(context.Background())
			audio.Close()
			want := &Error{StatusCode: runtime.Some(status), Body: "quota �", RetryAfter: runtime.Some("7")}
			if stage == "queue" || stage == "download" {
				want.RequestID = runtime.Some("event/?#雪")
			}
			if !reflect.DeepEqual(err, want) || len(*calls) != len(replies) || failure.Body.(*body).closes.Load() != 1 {
				t.Fatal(stage, err, want, len(*calls))
			}
		}
	}
	queue := reply("event: error\ndata: \"GPU quota exhausted\"\n\n", "text/event-stream", 200)
	tr, _ := transport(t, reply(submitted, "application/json", 200), queue)
	audio, err := Synthesize(context.Background(), baseRequest(), Options{Auth: authenticated(), Transport: tr})
	if err != nil {
		t.Fatal(err)
	}
	_, err = audio.Next(context.Background())
	audio.Close()
	if !reflect.DeepEqual(err, &Error{Body: `"GPU quota exhausted"`, RequestID: runtime.Some("event/?#雪")}) {
		t.Fatal(err)
	}
	if queue.Body.(*body).closes.Load() != 1 {
		t.Fatal("queue leaked")
	}
}

func TestGeneratedValidationBeforeIO(t *testing.T) {
	invalid := []schema.TtsRequest{nil, (*schema.TtsRequestAsText)(nil), (*schema.TtsRequestAsChatterboxTurboText)(nil), (*schema.TtsRequestAsChatterboxMultilingualText)(nil)}
	for _, temperature := range []float64{0, 5.1, math.NaN(), math.Inf(1)} {
		r := baseRequest()
		r.Value.Temperature = runtime.Some(temperature)
		invalid = append(invalid, r)
	}
	r := baseRequest()
	r.Value.Text = strings.Repeat("😀", 301)
	invalid = append(invalid, r)
	r = baseRequest()
	r.Value.ReferenceAudioTrimming = runtime.Some(schema.TtsRequestTextReferenceAudioTrimming(nil))
	invalid = append(invalid, r)
	invalid = append(invalid, schema.TtsRequestAsChatterboxTurboText{Value: schema.TtsRequestChatterboxTurboText{Text: "Hello", Temperature: runtime.Some(5.0)}}, schema.TtsRequestAsChatterboxMultilingualText{Value: schema.TtsRequestChatterboxMultilingualText{Text: "Hello", Language: runtime.Some(schema.TtsRequestChatterboxMultilingualTextLanguage((*schema.TtsRequestChatterboxMultilingualTextLanguageAsFr)(nil)))}})
	tr, calls := transport(t)
	for _, request := range invalid {
		_, expected := schema.ValidateRequest(request)
		if expected == nil {
			t.Fatal("expected generated validation failure")
		}
		audio, err := Synthesize(context.Background(), request, Options{Transport: tr})
		if audio != nil || err == nil || err.Error() != expected.Error() {
			t.Fatal(audio, err)
		}
	}
	if len(*calls) != 0 {
		t.Fatal("validation performed I/O")
	}
	r = baseRequest()
	r.Value.Text = strings.Repeat("😀", 300)
	audio, err := Synthesize(context.Background(), r, Options{Transport: tr})
	if err != nil {
		t.Fatal(err)
	}
	audio.Close()
}

func TestAuthAndBoundaryOptions(t *testing.T) {
	for _, tc := range []struct {
		auth auth.Auth
		env  map[string]string
		want string
	}{
		{authenticated(), map[string]string{"SPEECHSWITCH_RESEMBLE_TOKEN": "scoped", "HF_TOKEN": "vendor"}, "Bearer fixture"},
		{auth.Auth{}, map[string]string{"SPEECHSWITCH_RESEMBLE_TOKEN": "scoped", "HF_TOKEN": "vendor"}, "Bearer scoped"},
		{auth.Auth{}, map[string]string{"HF_TOKEN": "vendor"}, "Bearer vendor"},
		{auth.Auth{Resemble: runtime.Some(auth.AuthResemble{Token: runtime.Some("")})}, map[string]string{"HF_TOKEN": "vendor"}, ""},
		{auth.Auth{}, map[string]string{"SPEECHSWITCH_RESEMBLE_TOKEN": "", "HF_TOKEN": "vendor"}, ""},
		{auth.Auth{}, map[string]string{}, ""},
	} {
		t.Run(tc.want, func(t *testing.T) {
			for _, name := range []string{"SPEECHSWITCH_RESEMBLE_TOKEN", "HF_TOKEN"} {
				t.Setenv(name, "")
				if value, ok := tc.env[name]; ok {
					os.Setenv(name, value)
				} else {
					os.Unsetenv(name)
				}
			}
			tr, calls := transport(t, reply(submitted, "application/json", 200), reply(completion, "text/event-stream", 200), reply("audio", "audio/wav", 200))
			audio, err := Synthesize(context.Background(), baseRequest(), Options{Auth: tc.auth, Transport: tr})
			if err != nil {
				t.Fatal(err)
			}
			_, failure := collect(t, audio)
			if failure != "" {
				t.Fatal(failure)
			}
			for _, r := range *calls {
				if r.Header.Get("Authorization") != tc.want {
					t.Fatal(r.Header)
				}
			}
		})
	}
	tr, calls := transport(t)
	for _, target := range []string{"ws://api.test", "https://user:pass@api.test", "https://api.test/#fragment", "relative/path", "https://", "https://api.test:99999", "https://api.test/%bad%", "\nhttps://api.test"} {
		audio, err := Synthesize(context.Background(), baseRequest(), Options{Auth: authenticated(), Transport: tr, BaseURL: target})
		if audio != nil || err == nil || err.Error() != "Invalid Resemble deployment or audio URL" {
			t.Fatal(target, audio, err)
		}
	}
	for _, token := range []string{"a\rb", "a\nb", "雪", "a\x00b", "a\x7fb"} {
		audio, err := Synthesize(context.Background(), baseRequest(), Options{Transport: tr, Auth: auth.Auth{Resemble: runtime.Some(auth.AuthResemble{Token: runtime.Some(token)})}})
		if audio != nil || err == nil || err.Error() != "Invalid Resemble token" {
			t.Fatal(audio, err)
		}
	}
	for _, tc := range []struct {
		options Options
		want    string
	}{
		{Options{Transport: tr, Timeout: runtime.Some(-time.Second)}, "Resemble Timeout must not be negative"},
		{Options{Transport: tr, Timeout: runtime.Some(time.Duration(0))}, context.DeadlineExceeded.Error()},
		{Options{Transport: tr, MaxEventBytes: -1}, "Resemble response byte limits must be positive"},
		{Options{Transport: tr, MaxJSONBytes: -1}, "Resemble response byte limits must be positive"},
	} {
		audio, err := Synthesize(context.Background(), baseRequest(), tc.options)
		if audio != nil || err == nil || err.Error() != tc.want {
			t.Fatal(audio, err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	audio, err := Synthesize(ctx, baseRequest(), Options{Transport: tr})
	if audio != nil || err != context.Canceled {
		t.Fatal(audio, err)
	}
	if len(*calls) != 0 {
		t.Fatal("invalid options performed I/O")
	}
}
