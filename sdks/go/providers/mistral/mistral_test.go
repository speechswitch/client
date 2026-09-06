package mistral_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"time"
	"unicode"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/mistral"
	out "github.com/speechswitch/client/sdks/go/generated/mistral_output"
	"github.com/speechswitch/client/sdks/go/providers/mistral"
	"github.com/speechswitch/client/sdks/go/runtime"
)

const delta = "data: {\"type\":\"speech.audio.delta\",\"audio_data\":\"AP+A\"}\n\n"
const done = "data: {\"type\":\"speech.audio.done\",\"usage\":{}}\n\n"

var credentials = auth.Auth{Mistral: runtime.Some(auth.AuthAsync{ApiKey: runtime.Some("test")})}

type body struct {
	chunks  [][]byte
	pending error
	stall   bool
	reading chan struct{}
	closed  chan struct{}
	once    sync.Once
	reads   atomic.Int32
	closes  atomic.Int32
}

func newBody(chunks ...[]byte) *body {
	return &body{chunks: chunks, closed: make(chan struct{}), reading: make(chan struct{}, 1)}
}
func (b *body) Read(buffer []byte) (int, error) {
	b.reads.Add(1)
	if len(b.chunks) > 0 {
		n := copy(buffer, b.chunks[0])
		b.chunks[0] = b.chunks[0][n:]
		if len(b.chunks[0]) == 0 {
			b.chunks = b.chunks[1:]
		}
		return n, nil
	}
	if b.pending != nil {
		return 0, b.pending
	}
	if b.stall {
		select {
		case b.reading <- struct{}{}:
		default:
		}
		<-b.closed
		return 0, io.ErrClosedPipe
	}
	return 0, io.EOF
}
func (b *body) Close() error { b.closes.Add(1); b.once.Do(func() { close(b.closed) }); return nil }

type transport struct {
	response *http.Response
	requests []*http.Request
}

func (t *transport) Do(request *http.Request) (*http.Response, error) {
	t.requests = append(t.requests, request)
	return t.response, nil
}
func withBody(b *body, contentType string, status int) *transport {
	headers := make(http.Header)
	headers.Set("Content-Type", contentType)
	headers.Set("Retry-After", "7")
	return &transport{response: &http.Response{StatusCode: status, Header: headers, Body: b}}
}

// Only test comparison uses reflection: unwrap concrete generated values into
// their canonical field names without reusing the provider's decoding logic.
func normalized(value reflect.Value) any {
	if value.Kind() == reflect.Interface || value.Kind() == reflect.Pointer {
		return normalized(value.Elem())
	}
	switch literal := value.Interface().(type) {
	case interface{ Value() string }:
		return literal.Value()
	case interface{ Value() bool }:
		return literal.Value()
	case interface{ Value() float64 }:
		return literal.Value()
	case interface{ Value() struct{} }:
		return nil
	}
	switch value.Kind() {
	case reflect.Struct:
		if present := value.FieldByName("Present"); present.IsValid() {
			return normalized(value.FieldByName("Value"))
		}
		if value.NumField() == 1 && value.Type().Field(0).Name == "Value" {
			return normalized(value.Field(0))
		}
		result := map[string]any{}
		for index := 0; index < value.NumField(); index++ {
			field := value.Field(index)
			if field.Kind() == reflect.Struct {
				if present := field.FieldByName("Present"); present.IsValid() && !present.Bool() {
					continue
				}
			}
			name := []rune(value.Type().Field(index).Name)
			name[0] = unicode.ToLower(name[0])
			result[string(name)] = normalized(field)
		}
		return result
	case reflect.Slice:
		result := make([]any, value.Len())
		for index := range result {
			result[index] = normalized(value.Index(index))
		}
		return result
	case reflect.Uint8:
		return float64(value.Uint())
	default:
		return value.Interface()
	}
}

func TestSharedProtocolFixturesAtEveryByteSplit(t *testing.T) {
	encoded, err := os.ReadFile("../../../fixtures/mistral.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Name        string
		ContentType string
		Body        string
		Output      []any
		Error       string
	}
	if err := json.Unmarshal(encoded, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range fixtures {
		t.Run(fixture.Name, func(t *testing.T) {
			data := []byte(fixture.Body)
			for split := 0; split <= len(data); split++ {
				b := newBody(data[:split], data[split:])
				stream, err := mistral.Synthesize(context.Background(), schema.TtsRequest{Text: "Hello"}, mistral.Options{Auth: credentials, Transport: withBody(b, fixture.ContentType, 200)})
				if err != nil {
					t.Fatal(err)
				}
				output := []any{}
				failure := ""
				for {
					item, err := stream.Next(context.Background())
					if err == io.EOF {
						break
					}
					if err != nil {
						failure = err.Error()
						break
					}
					if audio, ok := item.(out.SynthesisItemAsBytes); ok {
						output = append(output, map[string]any{"audio": normalized(reflect.ValueOf(audio.Value))})
					} else {
						output = append(output, normalized(reflect.ValueOf(item)))
					}
				}
				stream.Close()
				if !reflect.DeepEqual(output, fixture.Output) || failure != fixture.Error {
					t.Fatalf("split %d: output %#v expected %#v; error %q expected %q", split, output, fixture.Output, failure, fixture.Error)
				}
				if b.closes.Load() != 1 {
					t.Fatalf("split %d closed %d times", split, b.closes.Load())
				}
			}
		})
	}
}

func TestRequestConversionPreservesVoiceReferenceAndMetadata(t *testing.T) {
	b := newBody([]byte(delta), []byte(done))
	b.stall = true
	tr := withBody(b, "text/event-stream", 200)
	text := runtime.JsonString("owned")
	request := schema.TtsRequest{Text: "Hello", Voice: runtime.Some("owned"), ReferenceAudio: runtime.Some([]byte{0, 255, 128}), PromptCacheKey: runtime.Some(""),
		Metadata: runtime.Some(map[string]runtime.JsonValue{"KeepCase": runtime.JsonArray{runtime.JsonNull{}, runtime.JsonBool(false), runtime.JsonNumber(0), &text}, "emptyArray": runtime.JsonArray(nil), "emptyObject": runtime.JsonObject(nil)}),
		Output:   runtime.Some(schema.TtsRequestOutput(&schema.TtsRequestOutputAsPcm{})),
	}
	stream, err := mistral.Synthesize(context.Background(), request, mistral.Options{Auth: credentials, Transport: tr, BaseURL: "https://proxy.test/prefix%20path/?a=1"})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	item, err := stream.Next(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(item, out.SynthesisItemAsBytes{Value: []byte{0, 255, 128}}) || b.reads.Load() != 1 {
		t.Fatalf("audio buffered or changed: %#v, reads %d", item, b.reads.Load())
	}
	item, err = stream.Next(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(item, out.SynthesisItemAsDone{Value: out.DoneEvent{Usage: runtime.Some(out.Usage{})}}) || b.closes.Load() != 1 {
		t.Fatalf("done/cleanup: %#v, closes %d", item, b.closes.Load())
	}
	wire := tr.requests[0]
	if wire.URL.String() != "https://proxy.test/prefix%20path/v1/audio/speech?a=1" || wire.Method != "POST" {
		t.Fatalf("wrong request: %s %s", wire.Method, wire.URL)
	}
	wantHeaders := http.Header{"Authorization": {"Bearer test"}, "Content-Type": {"application/json"}, "Accept": {"text/event-stream, application/json"}}
	if !reflect.DeepEqual(wire.Header, wantHeaders) {
		t.Fatalf("headers: %#v", wire.Header)
	}
	actual, err := io.ReadAll(wire.Body)
	if err != nil {
		t.Fatal(err)
	}
	expected, _ := json.Marshal(map[string]any{"model": "voxtral-mini-tts-2603", "input": "Hello", "stream": true, "response_format": "pcm", "voice_id": "owned", "ref_audio": "AP+A", "prompt_cache_key": "", "metadata": map[string]any{"KeepCase": []any{nil, false, 0, "owned"}, "emptyArray": []any{}, "emptyObject": map[string]any{}}})
	if string(actual) != string(expected) {
		t.Fatalf("body %s expected %s", actual, expected)
	}
}

func TestEncodedFormatsAndGeneratedRejection(t *testing.T) {
	for _, test := range []struct {
		format   schema.TtsRequestOutputObjectFormat
		expected string
	}{
		{schema.TtsRequestOutputObjectFormatAsFlac{}, "flac"}, {&schema.TtsRequestOutputObjectFormatAsMp3{}, "mp3"},
		{schema.TtsRequestOutputObjectFormatAsOpus{}, "opus"}, {&schema.TtsRequestOutputObjectFormatAsWav{}, "wav"},
	} {
		b := newBody()
		tr := withBody(b, "application/json", 200)
		request := schema.TtsRequest{Text: "Hello", Output: runtime.Some(schema.TtsRequestOutput(schema.TtsRequestOutputAsObject{Value: schema.TtsRequestOutputObject{Format: test.format}}))}
		stream, err := mistral.Synthesize(context.Background(), request, mistral.Options{Auth: credentials, Transport: tr})
		if err != nil {
			t.Fatal(err)
		}
		stream.Close()
		var payload map[string]any
		if err := json.NewDecoder(tr.requests[0].Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if payload["response_format"] != test.expected {
			t.Fatalf("format: %v expected %s", payload["response_format"], test.expected)
		}
	}
	metadata := runtime.JsonObject{}
	metadata["cycle"] = metadata
	for _, request := range []schema.TtsRequest{
		{Text: "Hello", Output: runtime.Some(schema.TtsRequestOutput(nil))},
		{Text: "Hello", Metadata: runtime.Some(map[string]runtime.JsonValue(metadata))},
		{Text: string([]byte{255})},
	} {
		tr := withBody(newBody(), "", 200)
		_, err := mistral.Synthesize(context.Background(), request, mistral.Options{Auth: credentials, Transport: tr})
		if err == nil || err.Error() != "Invalid mistral TTS request" || len(tr.requests) != 0 {
			t.Fatalf("invalid request reached transport: %v", err)
		}
	}
}

func TestEarlyCloseCancellationAndReaderError(t *testing.T) {
	for _, read := range []bool{false, true} {
		b := newBody([]byte(delta))
		b.stall = true
		stream, err := mistral.Synthesize(context.Background(), schema.TtsRequest{Text: "Hello"}, mistral.Options{Auth: credentials, Transport: withBody(b, "text/event-stream", 200)})
		if err != nil {
			t.Fatal(err)
		}
		if read {
			if _, err := stream.Next(context.Background()); err != nil {
				t.Fatal(err)
			}
		}
		stream.Close()
		stream.Close()
		expected := int32(0)
		if read {
			expected = 1
		}
		if b.reads.Load() != expected || b.closes.Load() != 1 {
			t.Fatalf("reads %d closes %d", b.reads.Load(), b.closes.Load())
		}
	}
	b := newBody()
	b.stall = true
	stream, err := mistral.Synthesize(context.Background(), schema.TtsRequest{Text: "Hello"}, mistral.Options{Auth: credentials, Transport: withBody(b, "text/event-stream", 200)})
	if err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() { _, err := stream.Next(context.Background()); result <- err }()
	<-b.reading
	stream.Close()
	if err := <-result; !errors.Is(err, context.Canceled) {
		t.Fatalf("close did not cancel read: %v", err)
	}
	failure := errors.New("reader failed")
	b = newBody()
	b.pending = failure
	stream, err = mistral.Synthesize(context.Background(), schema.TtsRequest{Text: "Hello"}, mistral.Options{Auth: credentials, Transport: withBody(b, "text/event-stream", 200)})
	if err != nil {
		t.Fatal(err)
	}
	_, err = stream.Next(context.Background())
	if err != failure || b.closes.Load() != 1 {
		t.Fatalf("read error changed: %v", err)
	}
}

func TestCanceledNextDoesNotEmitBufferedDone(t *testing.T) {
	b := newBody([]byte(delta + done))
	stream, err := mistral.Synthesize(context.Background(), schema.TtsRequest{Text: "Hello"}, mistral.Options{Auth: credentials, Transport: withBody(b, "text/event-stream", 200)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := stream.Next(context.Background()); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if item, err := stream.Next(ctx); !errors.Is(err, context.Canceled) || item != nil {
		t.Fatalf("emitted after cancellation: %#v %v", item, err)
	}
	if b.closes.Load() != 1 {
		t.Fatal("body not closed")
	}
}

func TestOpaqueErrorsAndLimits(t *testing.T) {
	b := newBody([]byte("private detail"))
	stream, err := mistral.Synthesize(context.Background(), schema.TtsRequest{Text: "Hello"}, mistral.Options{Auth: credentials, Transport: withBody(b, "application/json", 429)})
	if err != nil {
		t.Fatal(err)
	}
	_, err = stream.Next(context.Background())
	if expected := (&mistral.Error{StatusCode: 429, Body: "private detail", RetryAfter: runtime.Some("7")}); !reflect.DeepEqual(err, expected) || err.Error() != "Mistral synthesis failed (429)" {
		t.Fatalf("error: %#v", err)
	}
	for _, test := range []struct{ content, data, expected string }{
		{"text/event-stream", delta, "SSE event exceeds byte limit"},
		{"application/json", `{"audio_data":"AQ=="}`, "Mistral response exceeds MaxJSONBytes"},
	} {
		b := newBody([]byte(test.data))
		stream, err := mistral.Synthesize(context.Background(), schema.TtsRequest{Text: "Hello"}, mistral.Options{Auth: credentials, Transport: withBody(b, test.content, 200), MaxEventBytes: 8, MaxJSONBytes: 8})
		if err != nil {
			t.Fatal(err)
		}
		_, err = stream.Next(context.Background())
		if err == nil || err.Error() != test.expected || b.closes.Load() != 1 {
			t.Fatalf("limit result: %v closes %d", err, b.closes.Load())
		}
	}
}

func TestNativeHTTPReleasesOnDoneAndConsumerExit(t *testing.T) {
	for _, finish := range []bool{false, true} {
		disconnected := make(chan struct{})
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "Bearer test" || r.URL.Path != "/v1/audio/speech" {
				t.Error("wrong native request")
			}
			w.Header().Set("Content-Type", "text/event-stream")
			io.WriteString(w, delta)
			if finish {
				io.WriteString(w, done)
			}
			w.(http.Flusher).Flush()
			<-r.Context().Done()
			close(disconnected)
		}))
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		stream, err := mistral.Synthesize(ctx, schema.TtsRequest{Text: "Hello"}, mistral.Options{Auth: credentials, BaseURL: server.URL})
		if err != nil {
			cancel()
			server.Close()
			t.Fatal(err)
		}
		if _, err := stream.Next(ctx); err != nil {
			t.Fatal(err)
		}
		if finish {
			item, err := stream.Next(ctx)
			if _, ok := item.(out.SynthesisItemAsDone); err != nil || !ok {
				t.Fatalf("no native done: %#v %v", item, err)
			}
		} else {
			stream.Close()
		}
		select {
		case <-disconnected:
		case <-ctx.Done():
			t.Fatal("native HTTP stayed connected")
		}
		stream.Close()
		cancel()
		server.Close()
	}
}

func TestNativeDeadlineClosesResponseBetweenPulls(t *testing.T) {
	disconnected := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		io.WriteString(w, delta)
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(disconnected)
	}))
	defer server.Close()
	stream, err := mistral.Synthesize(context.Background(), schema.TtsRequest{Text: "Hello"}, mistral.Options{Auth: credentials, BaseURL: server.URL, Timeout: runtime.Some(time.Second)})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	if _, err := stream.Next(context.Background()); err != nil {
		t.Fatal(err)
	}
	select {
	case <-disconnected:
	case <-time.After(3 * time.Second):
		t.Fatal("deadline did not close idle response")
	}
	if _, err := stream.Next(context.Background()); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("deadline error: %v", err)
	}
}

func TestNativeCancellationBeforeResponseHeaders(t *testing.T) {
	started, disconnected := make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.Copy(io.Discard, r.Body)
		close(started)
		<-r.Context().Done()
		close(disconnected)
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	result := make(chan error, 1)
	go func() {
		stream, err := mistral.Synthesize(ctx, schema.TtsRequest{Text: "Hello"}, mistral.Options{Auth: credentials, BaseURL: server.URL})
		if stream != nil {
			stream.Close()
		}
		result <- err
	}()
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("native request did not reach server")
	}
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancellation before headers: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("canceled send did not return")
	}
	select {
	case <-disconnected:
	case <-time.After(3 * time.Second):
		t.Fatal("canceled send stayed connected")
	}
}

func TestAuthDefaultsZeroDeadlineAndRedirectPolicy(t *testing.T) {
	t.Setenv("MISTRAL_API_KEY", "native")
	t.Setenv("SPEECHSWITCH_MISTRAL_API_KEY", "scoped")
	for _, test := range []struct {
		auth     auth.Auth
		expected string
	}{{credentials, "test"}, {auth.Auth{}, "scoped"}} {
		tr := withBody(newBody(), "", 200)
		stream, err := mistral.Synthesize(context.Background(), schema.TtsRequest{Text: "Hello"}, mistral.Options{Auth: test.auth, Transport: tr})
		if err != nil {
			t.Fatal(err)
		}
		stream.Close()
		if tr.requests[0].Header.Get("Authorization") != "Bearer "+test.expected {
			t.Fatal("wrong auth precedence")
		}
	}
	tr := withBody(newBody(), "", 200)
	_, err := mistral.Synthesize(context.Background(), schema.TtsRequest{Text: "Hello"}, mistral.Options{Auth: credentials, Transport: tr, Timeout: runtime.Some(time.Duration(0))})
	if !errors.Is(err, context.DeadlineExceeded) || len(tr.requests) != 0 {
		t.Fatalf("zero deadline: %v", err)
	}
	_, err = mistral.Synthesize(context.Background(), schema.TtsRequest{Text: "Hello"}, mistral.Options{Auth: auth.Auth{Mistral: runtime.Some(auth.AuthAsync{ApiKey: runtime.Some("")})}, Transport: tr})
	if err == nil || err.Error() != "Missing auth.mistral.apiKey configuration" || len(tr.requests) != 0 {
		t.Fatalf("empty key: %v", err)
	}
	var forwarded atomic.Int32
	destination := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { forwarded.Add(1) }))
	defer destination.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", destination.URL)
		w.WriteHeader(http.StatusTemporaryRedirect)
		io.WriteString(w, "moved")
	}))
	defer redirect.Close()
	stream, err := mistral.Synthesize(context.Background(), schema.TtsRequest{Text: "Hello"}, mistral.Options{Auth: credentials, BaseURL: redirect.URL})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	_, err = stream.Next(context.Background())
	var status *mistral.Error
	if !errors.As(err, &status) || status.StatusCode != 307 || forwarded.Load() != 0 || status.Body != "moved" {
		t.Fatalf("redirect result %#v forwarded %d", err, forwarded.Load())
	}
}
