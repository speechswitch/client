package openai

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
	"sync"
	"sync/atomic"
	"testing"
	"time"

	wire "github.com/speechswitch/client/sdks/go/clients/openai"
	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/openai"
	out "github.com/speechswitch/client/sdks/go/generated/openai_output"
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
func (b *body) Close() error { b.closes.Add(1); b.once.Do(func() { close(b.closed) }); return nil }
func authenticated() auth.Auth {
	return auth.Auth{Openai: runtime.Some(auth.AuthAsync{ApiKey: runtime.Some("test")})}
}
func legacy() schema.TtsRequestAsTextVoice15a214fc {
	return schema.TtsRequestAsTextVoice15a214fc{Value: schema.TtsRequestTextVoice15a214fc{Text: "Hello", Voice: schema.TtsRequestTextVoice15a214fcVoiceAsAlloy{}}}
}
func mini() schema.TtsRequestAsTextVoicef51a0f7e {
	return schema.TtsRequestAsTextVoicef51a0f7e{Value: schema.TtsRequestTextVoicef51a0f7e{Text: "Hello", Voice: schema.TtsRequestTextVoicef51a0f7eVoiceAsCedar{}, Model: schema.TtsRequestTextVoicef51a0f7eModelAsGpt4oMiniTts{}, IncludeUsage: runtime.Some(schema.TtsRequestTextVoicef51a0f7eIncludeUsage(schema.TtsRequestTextVoicef51a0f7eIncludeUsageAsTrue{}))}}
}
func options(b *body, contentType string, status int) Options {
	return Options{Auth: authenticated(), Transport: transportFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": {contentType}, "X-Request-Id": {""}, "Retry-After": {"7"}}, Body: b}, nil
	})}
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
			done := map[string]any{"event": "done"}
			if item.Value.RequestId.Present {
				done["requestId"] = item.Value.RequestId.Value
			}
			if item.Value.Usage.Present {
				u := item.Value.Usage.Value
				done["usage"] = map[string]any{"inputTokens": u.InputTokens, "outputTokens": u.OutputTokens, "totalTokens": u.TotalTokens}
			}
			result = append(result, done)
		default:
			t.Fatalf("unexpected output %T", item)
		}
	}
}

const delta = "data: {\"type\":\"speech.audio.delta\",\"audio\":\"AP+A\"}\n\n"
const done = "data: {\"type\":\"speech.audio.done\",\"usage\":{\"input_tokens\":0,\"output_tokens\":1,\"total_tokens\":1}}\n\n"

func TestSharedStreamsEverySplit(t *testing.T) {
	data, err := os.ReadFile("../../../fixtures/openai.json")
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
				b := newBody(step{data: []byte(fixture.Body[:split])}, step{data: []byte(fixture.Body[split:])})
				audio, err := Synthesize(context.Background(), mini(), options(b, "text/event-stream", 200))
				if err != nil {
					t.Fatal(err)
				}
				result, failure := collect(t, audio)
				expected := ""
				if fixture.Error != nil {
					expected = *fixture.Error
				}
				if failure != expected || !reflect.DeepEqual(result, fixture.Output) {
					t.Fatalf("split %d: %#v %q", split, result, failure)
				}
				if b.closes.Load() != 1 {
					t.Fatal(b.closes.Load())
				}
			}
		})
	}
}

func TestSharedRequests(t *testing.T) {
	hd := legacy()
	hd.Value.Model = runtime.Some(schema.TtsRequestTextVoice15a214fcModel(schema.TtsRequestTextVoice15a214fcModelAsTts1Hd{}))
	hd.Value.Voice = schema.TtsRequestTextVoice15a214fcVoiceAsNova{}
	hd.Value.Speed = runtime.Some(4.0)
	hd.Value.Output = runtime.Some(schema.TtsRequestTextVoice15a214fcOutput(schema.TtsRequestTextVoice15a214fcOutputAsObject{Value: schema.TtsRequestTextVoice15a214fcOutputObject{Format: schema.TtsRequestTextVoice15a214fcOutputObjectFormatAsMp3{}}}))
	modern := mini()
	modern.Value.Instructions = runtime.Some("")
	custom := schema.TtsRequestAsTextVoicef3ee42bf{Value: schema.TtsRequestTextVoicef3ee42bf{Text: "Hello", Voice: "alloy", Model: schema.TtsRequestTextVoicef51a0f7eModelAsGpt4oMiniTts20251215{}, Speed: runtime.Some(.25), IncludeUsage: runtime.Some(schema.TtsRequestTextVoicef51a0f7eIncludeUsage(schema.TtsRequestTextVoicef51a0f7eIncludeUsageAsFalse{})), Output: runtime.Some(schema.TtsRequestTextVoice15a214fcOutput(schema.TtsRequestTextVoice15a214fcOutputAsObject{Value: schema.TtsRequestTextVoice15a214fcOutputObject{Format: schema.TtsRequestTextVoice15a214fcOutputObjectFormatAsWav{}}}))}}
	march := mini()
	march.Value.Model = schema.TtsRequestTextVoicef51a0f7eModelAsGpt4oMiniTts20250320{}
	march.Value.Voice = schema.TtsRequestTextVoicef51a0f7eVoiceAsMarin{}
	march.Value.IncludeUsage = runtime.Optional[schema.TtsRequestTextVoicef51a0f7eIncludeUsage]{}
	march.Value.Instructions = runtime.Some("Whisper")
	march.Value.Output = runtime.Some(schema.TtsRequestTextVoice15a214fcOutput(schema.TtsRequestTextVoice15a214fcOutputAsObject{Value: schema.TtsRequestTextVoice15a214fcOutputObject{Format: schema.TtsRequestTextVoice15a214fcOutputObjectFormatAsOpus{}}}))
	data, err := os.ReadFile("../../../fixtures/openai.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures struct {
		Requests []struct{ Wire map[string]any }
	}
	if err := json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	requests := []schema.TtsRequest{legacy(), hd, modern, custom, march}
	for index, request := range requests {
		for _, pointer := range []bool{false, true} {
			if pointer {
				switch value := request.(type) {
				case schema.TtsRequestAsTextVoice15a214fc:
					request = &value
				case schema.TtsRequestAsTextVoicef51a0f7e:
					request = &value
				case schema.TtsRequestAsTextVoicef3ee42bf:
					request = &value
				}
			}
			b := newBody()
			opts := options(b, "audio/pcm", 200)
			opts.BaseURL = "https://proxy.test/prefix%2Fv1/?tenant=one;two&x=%2F"
			opts.Transport = transportFunc(func(r *http.Request) (*http.Response, error) {
				body, err := io.ReadAll(r.Body)
				if err != nil {
					t.Fatal(err)
				}
				var value map[string]any
				if err := json.Unmarshal(body, &value); err != nil {
					t.Fatal(err)
				}
				if !reflect.DeepEqual(value, fixtures.Requests[index].Wire) {
					t.Fatal(value, fixtures.Requests[index].Wire)
				}
				if r.Method != "POST" || r.URL.String() != "https://proxy.test/prefix%2Fv1/audio/speech?tenant=one;two&x=%2F" {
					t.Fatal(r.Method, r.URL)
				}
				expected := http.Header{"Authorization": {"Bearer test"}, "Content-Type": {"application/json"}, "Accept": {"application/octet-stream, text/event-stream"}}
				if !reflect.DeepEqual(r.Header, expected) {
					t.Fatal(r.Header)
				}
				return &http.Response{StatusCode: 200, Body: b}, nil
			})
			audio, err := Synthesize(context.Background(), request, opts)
			if err != nil {
				t.Fatal(err)
			}
			audio.Close()
			if b.reads.Load() != 0 || b.closes.Load() != 1 {
				t.Fatal(b.reads.Load(), b.closes.Load())
			}
		}
	}
}

func TestFormatsAndGeneratedBounds(t *testing.T) {
	for _, format := range []schema.TtsRequestTextVoice15a214fcOutputObjectFormat{schema.TtsRequestTextVoice15a214fcOutputObjectFormatAsAac{}, schema.TtsRequestTextVoice15a214fcOutputObjectFormatAsFlac{}, schema.TtsRequestTextVoice15a214fcOutputObjectFormatAsMp3{}, schema.TtsRequestTextVoice15a214fcOutputObjectFormatAsOpus{}, schema.TtsRequestTextVoice15a214fcOutputObjectFormatAsWav{}} {
		request := legacy()
		request.Value.Output = runtime.Some(schema.TtsRequestTextVoice15a214fcOutput(&schema.TtsRequestTextVoice15a214fcOutputAsObject{Value: schema.TtsRequestTextVoice15a214fcOutputObject{Format: format}}))
		if _, err := schema.ValidateRequest(request); err != nil {
			t.Fatal(err)
		}
		input, _, err := settings(request)
		if err != nil || input.ResponseFormat.Value != format.LiteralValue() {
			t.Fatal(input, err)
		}
	}
	request := legacy()
	request.Value.Output = runtime.Some(schema.TtsRequestTextVoice15a214fcOutput(&schema.TtsRequestTextVoice15a214fcOutputAsPcm{}))
	input, _, err := settings(request)
	if err != nil || input.ResponseFormat.Value != "pcm" {
		t.Fatal(input, err)
	}
	for _, mutate := range []func(*schema.TtsRequestTextVoice15a214fc){
		func(v *schema.TtsRequestTextVoice15a214fc) { v.Voice = nil },
		func(v *schema.TtsRequestTextVoice15a214fc) {
			v.Voice = (*schema.TtsRequestTextVoice15a214fcVoiceAsAlloy)(nil)
		},
		func(v *schema.TtsRequestTextVoice15a214fc) {
			v.Model = runtime.Some(schema.TtsRequestTextVoice15a214fcModel(nil))
		},
		func(v *schema.TtsRequestTextVoice15a214fc) { v.Speed = runtime.Some(math.NaN()) },
		func(v *schema.TtsRequestTextVoice15a214fc) { v.Speed = runtime.Some(.24) },
		func(v *schema.TtsRequestTextVoice15a214fc) { v.Speed = runtime.Some(4.01) },
		func(v *schema.TtsRequestTextVoice15a214fc) { v.Text = strings.Repeat("😀", 4097) },
		func(v *schema.TtsRequestTextVoice15a214fc) {
			v.Output = runtime.Some(schema.TtsRequestTextVoice15a214fcOutput(nil))
		},
	} {
		request := legacy()
		mutate(&request.Value)
		_, expected := schema.ValidateRequest(request)
		if expected == nil {
			t.Fatal("expected generated validation failure")
		}
		_, err := Synthesize(context.Background(), request, Options{})
		if err == nil || err.Error() != expected.Error() {
			t.Fatal(err)
		}
	}
	request = legacy()
	request.Value.Text = strings.Repeat("😀", 4096)
	audio, err := Synthesize(context.Background(), request, options(newBody(), "", 200))
	if err != nil {
		t.Fatal(err)
	}
	audio.Close()
}

func TestBinaryAndSSETerminalLifetime(t *testing.T) {
	for _, usage := range []bool{false, true} {
		b := newBody(step{data: []byte("audio")})
		b.stall = true
		request := schema.TtsRequest(legacy())
		contentType := "audio/pcm"
		if usage {
			request = mini()
			contentType = "text/event-stream"
			b.steps = []step{{data: []byte(delta + done + "broken tail")}}
		}
		audio, err := Synthesize(context.Background(), request, options(b, contentType, 200))
		if err != nil {
			t.Fatal(err)
		}
		item, err := audio.Next(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		expected := []byte("audio")
		if usage {
			expected = []byte{0, 255, 128}
		}
		if !reflect.DeepEqual(item, out.SynthesisItemAsBytes{Value: expected}) || b.reads.Load() != 1 || b.closes.Load() != 0 {
			t.Fatal(item, b.reads.Load(), b.closes.Load())
		}
		if usage {
			item, err = audio.Next(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(item, out.SynthesisItemAsDone{Value: out.DoneEvent{RequestId: runtime.Some(""), Usage: runtime.Some(out.Usage{OutputTokens: 1, TotalTokens: 1})}}) {
				t.Fatal(item)
			}
			if _, err := audio.Next(context.Background()); err != io.EOF {
				t.Fatal(err)
			}
		}
		audio.Close()
		audio.Close()
		if b.closes.Load() != 1 {
			t.Fatal(b.closes.Load())
		}
	}
}

func TestFinalBytesAndReadError(t *testing.T) {
	failure := errors.New("read failed")
	for _, terminal := range []error{io.EOF, failure} {
		b := newBody(step{data: []byte("last"), err: terminal})
		audio, err := Synthesize(context.Background(), legacy(), options(b, "", 200))
		if err != nil {
			t.Fatal(err)
		}
		defer audio.Close()
		item, err := audio.Next(context.Background())
		if err != nil || !reflect.DeepEqual(item, out.SynthesisItemAsBytes{Value: []byte("last")}) {
			t.Fatal(item, err)
		}
		item, err = audio.Next(context.Background())
		if terminal == io.EOF {
			if _, ok := item.(out.SynthesisItemAsDone); !ok || err != nil {
				t.Fatal(item, err)
			}
		} else if err != failure {
			t.Fatal(err)
		}
		if b.closes.Load() != 1 {
			t.Fatal(b.closes.Load())
		}
	}
}

func TestErrorsAndLimits(t *testing.T) {
	for _, status := range []int{201, 302, 401, 429, 500} {
		b := newBody(step{data: []byte("native\xfferror")})
		audio, err := Synthesize(context.Background(), legacy(), options(b, "application/json", status))
		if err != nil {
			t.Fatal(err)
		}
		_, err = audio.Next(context.Background())
		audio.Close()
		expected := &Error{StatusCode: status, Body: "native�error", RequestID: runtime.Some(""), RetryAfter: runtime.Some("7")}
		if !reflect.DeepEqual(err, expected) || b.closes.Load() != 1 {
			t.Fatal(err, b.closes.Load())
		}
	}
	for _, c := range []struct {
		request                       schema.TtsRequest
		contentType, body, failure    string
		status, eventLimit, jsonLimit int
	}{
		{legacy(), "application/json", "{}", "OpenAI returned a non-audio response", 200, 0, 0},
		{legacy(), "audio/pcm", "", "OpenAI returned no audio", 200, 0, 0},
		{mini(), "audio/pcm", "audio", "OpenAI returned no SSE usage stream", 200, 0, 0},
		{mini(), "text/event-stream", ":123456789", "SSE event exceeds byte limit", 200, 4, 0},
		{legacy(), "text/plain", "12345", "OpenAI response exceeds MaxJSONBytes", 400, 0, 4},
		{mini(), "text/event-stream", "data: null\n\n", "Invalid OpenAI speech event", 200, 0, 0},
		{mini(), "text/event-stream", "data: {broken}\n\n", "Invalid OpenAI speech event", 200, 0, 0},
		{mini(), "text/event-stream", "data: {\"type\":\"speech.audio.delta\",\"audio\":\"AA\\n==\"}\n\n", "OpenAI returned invalid base64 audio", 200, 0, 0},
	} {
		b := newBody(step{data: []byte(c.body)})
		opts := options(b, c.contentType, c.status)
		opts.MaxEventBytes = c.eventLimit
		opts.MaxJSONBytes = c.jsonLimit
		audio, err := Synthesize(context.Background(), c.request, opts)
		if err != nil {
			t.Fatal(err)
		}
		_, err = audio.Next(context.Background())
		audio.Close()
		if err == nil || err.Error() != c.failure || b.closes.Load() != 1 {
			t.Fatal(err, b.closes.Load())
		}
	}
	for _, count := range []string{"true", "null", "0.5", "1e100", "9007199254740992"} {
		if _, err := wire.DecodeSpeechEvent([]byte(`{"type":"speech.audio.done","usage":{"input_tokens":` + count + `,"output_tokens":1,"total_tokens":1}}`)); err == nil || err.Error() != "Invalid OpenAI speech event" {
			t.Fatal(err)
		}
	}
}

func TestCancellationAtHeadersAndReads(t *testing.T) {
	for _, mode := range []string{"headers", "binary", "sse", "error"} {
		for _, cancelKind := range []string{"parent", "next", "close", "deadline"} {
			if mode == "headers" && (cancelKind == "next" || cancelKind == "close") {
				continue
			}
			t.Run(mode+"/"+cancelKind, func(t *testing.T) {
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				b := newBody()
				b.stall = true
				opts := options(b, "audio/pcm", 200)
				request := schema.TtsRequest(legacy())
				if mode == "sse" {
					opts = options(b, "text/event-stream", 200)
					request = mini()
				}
				if mode == "error" {
					opts = options(b, "application/json", 429)
				}
				if cancelKind == "deadline" {
					opts.Timeout = runtime.Some(20 * time.Millisecond)
				}
				started := b.reading
				if mode == "headers" {
					opts.Transport = transportFunc(func(r *http.Request) (*http.Response, error) {
						started <- struct{}{}
						<-r.Context().Done()
						return nil, r.Context().Err()
					})
				}
				result := make(chan error, 1)
				if mode == "headers" {
					go func() { _, err := Synthesize(ctx, request, opts); result <- err }()
					<-started
					if cancelKind == "parent" {
						cancel()
					}
				} else {
					audio, err := Synthesize(ctx, request, opts)
					if err != nil {
						t.Fatal(err)
					}
					defer audio.Close()
					next, stop := context.WithCancel(context.Background())
					defer stop()
					go func() { _, err := audio.Next(next); result <- err }()
					<-started
					switch cancelKind {
					case "parent":
						cancel()
					case "next":
						stop()
					case "close":
						audio.Close()
					}
				}
				expected := context.Canceled
				if cancelKind == "deadline" {
					expected = context.DeadlineExceeded
				}
				select {
				case err := <-result:
					if !errors.Is(err, expected) {
						t.Fatal(err)
					}
				case <-time.After(time.Second):
					t.Fatal("cancellation stalled")
				}
				if mode != "headers" && b.closes.Load() != 1 {
					t.Fatal(b.closes.Load())
				}
			})
		}
	}
}

func TestUnreadCancellationAndBoundaryErrors(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	b := newBody()
	audio, err := Synthesize(ctx, legacy(), options(b, "", 200))
	if err != nil {
		t.Fatal(err)
	}
	cancel()
	select {
	case <-b.closed:
	case <-time.After(time.Second):
		t.Fatal("unread body retained")
	}
	audio.Close()
	if b.reads.Load() != 0 || b.closes.Load() != 1 {
		t.Fatal(b.reads.Load(), b.closes.Load())
	}
	for _, c := range []struct {
		mutate  func(*Options)
		failure string
	}{
		{func(o *Options) { o.Timeout = runtime.Some(time.Duration(0)) }, context.DeadlineExceeded.Error()},
		{func(o *Options) { o.Timeout = runtime.Some(-time.Second) }, "OpenAI Timeout must not be negative"},
		{func(o *Options) { o.MaxJSONBytes = -1 }, "OpenAI response byte limits must be positive"},
		{func(o *Options) { o.MaxEventBytes = -1 }, "OpenAI response byte limits must be positive"},
		{func(o *Options) { o.BaseURL = "https://user:pass@api.test" }, "Invalid OpenAI BaseURL"},
		{func(o *Options) { o.BaseURL = "ws://api.test" }, "Invalid OpenAI BaseURL"},
		{func(o *Options) { o.BaseURL = "https://api.test/#x" }, "Invalid OpenAI BaseURL"},
		{func(o *Options) { o.Auth.Openai.Value.ApiKey = runtime.Some("test\r\nheader") }, "Invalid OpenAI authentication header"},
	} {
		opts := Options{Auth: authenticated(), Transport: transportFunc(func(*http.Request) (*http.Response, error) {
			t.Fatal("invalid input reached transport")
			return nil, nil
		})}
		c.mutate(&opts)
		if _, err := Synthesize(context.Background(), legacy(), opts); err == nil || err.Error() != c.failure {
			t.Fatal(err)
		}
	}
}
