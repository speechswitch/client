package deepdub

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/deepdub"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func TestNativeHTTPStreamsAndCancellationClosesIdleConnection(t *testing.T) {
	disconnected := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.String() != "/proxy%2Fpath/tts?tenant=1" || r.Header.Get("x-api-key") != "test-key" {
			t.Errorf("unexpected native request: %s %s %v", r.Method, r.URL, r.Header)
		}
		var wire map[string]any
		if err := json.NewDecoder(r.Body).Decode(&wire); err != nil {
			t.Error(err)
			return
		}
		equalJSON(t, wire, json.RawMessage(`{"generationId":"trace","model":"dd-etts-3.2","voicePromptId":"custom","targetText":"Hello","locale":"en-US","format":"mp3","sampleRate":48000,"cleanAudio":false,"autoGain":true}`))
		w.Header().Set("Content-Type", "audio/mpeg")
		w.Write([]byte{0, 255})
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(disconnected)
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	audio, err := Synthesize(ctx, request(), Options{Auth: testAuth, BaseURL: server.URL + "/proxy%2Fpath?tenant=1", RequestID: runtime.Some("trace")})
	if err != nil {
		t.Fatal(err)
	}
	defer audio.Close()
	got, err := audio.Next(context.Background())
	if err != nil || !bytes.Equal(got, []byte{0, 255}) {
		t.Fatal(got, err)
	}
	cancel()
	wait(t, disconnected)
	if _, err = audio.Next(context.Background()); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}

func TestNativeRedirectsNeverForwardCredentials(t *testing.T) {
	var calls atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.Write([]byte("unexpected")) }))
	defer target.Close()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", target.URL)
		w.WriteHeader(http.StatusFound)
	}))
	defer origin.Close()
	_, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, BaseURL: origin.URL, RequestID: runtime.Some("")})
	var failure *Error
	if !errors.As(err, &failure) || failure.StatusCode != 302 || failure.GenerationID != "" || failure.Message != "Found" {
		t.Fatal(err)
	}
	if calls.Load() != 0 {
		t.Fatal("redirect followed")
	}
}

func TestGeneratedValidationAndLimitsPrecedeHTTP(t *testing.T) {
	cases := []schema.TtsRequest{nil, (*schema.TtsRequestAsTextVoiceb776b412)(nil)}
	for _, speed := range []float64{-0.1, 2.1, math.NaN()} {
		r := request()
		r.Value.Speed = runtime.Some(speed)
		cases = append(cases, r)
	}
	r := request()
	r.Value.Output.Format = nil
	cases = append(cases, r)
	r = request()
	r.Value.Model = nil
	cases = append(cases, r)
	r = request()
	r.Value.Voice = ""
	cases = append(cases, r)
	r = request()
	r.Value.AudioEnhancement = runtime.Some(schema.TtsRequestOg11Text188d3251AudioEnhancement(nil))
	cases = append(cases, r)
	cases = append(cases,
		schema.TtsRequestAsOg11TextVoice7f540c02{Value: schema.TtsRequestOg11TextVoice7f540c02{Voice: "custom", Text: "Hello", Language: "en-US", Output: output("mp3", 0), RandomSeed: 1.5}},
		schema.TtsRequestAsOg11TextVoice7f540c02{Value: schema.TtsRequestOg11TextVoice7f540c02{Voice: "custom", Text: "Hello", Language: "en-US", Output: output("mp3", 0), RandomSeed: 9007199254740992}},
		schema.TtsRequestAsTextVoice5ce3f477{Value: schema.TtsRequestTextVoice5ce3f477{Model: schema.TtsRequestTextee721c85ModelAsLightning25{}, Voice: "custom", Text: "Hello", Language: "en-US", Output: output("mp3", 0), TargetDurationMs: 0}},
	)
	calls := 0
	tr := transportFunc(func(*http.Request) (*http.Response, error) { calls++; return nil, errors.New("unexpected HTTP") })
	for _, r := range cases {
		_, expected := schema.ValidateRequest(r)
		if expected == nil {
			t.Fatal("invalid fixture passed generated validation")
		}
		_, err := Synthesize(context.Background(), r, Options{Auth: testAuth, Transport: tr})
		if err == nil || err.Error() != expected.Error() {
			t.Fatal(err)
		}
	}
	r = request()
	r.Value.ReferenceAudio = runtime.Some([]byte{})
	if _, err := Synthesize(context.Background(), r, Options{Auth: testAuth, Transport: tr}); err == nil || err.Error() != "Deepdub referenceAudio must not be empty" {
		t.Fatal(err)
	}
	for _, base := range []string{"ftp://example.test", "https://user:key@example.test", "https://example.test/#fragment", "https://%zz"} {
		if _, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: tr, BaseURL: base}); err == nil || err.Error() != "Deepdub BaseURL must be an HTTP(S) URL without credentials or a fragment" {
			t.Fatal(err)
		}
	}
	if _, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: tr, MaxErrorBytes: -1}); err == nil || err.Error() != "Deepdub MaxErrorBytes must be positive" {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Synthesize(ctx, request(), Options{Auth: testAuth, Transport: tr}); err != context.Canceled {
		t.Fatal(err)
	}
	if calls != 0 {
		t.Fatal(calls)
	}
}

func TestAuthPresenceAndErrorBodyLimits(t *testing.T) {
	for _, test := range []struct {
		scoped, native, explicit string
		explicitPresent          bool
		expected                 string
	}{
		{"absent", "native", "", false, "native"}, {"scoped", "native", "", false, "scoped"}, {"scoped", "native", "explicit", true, "explicit"}, {"", "native", "", false, ""}, {"scoped", "native", "", true, ""}, {"absent", "absent", "", false, ""},
	} {
		t.Run(test.expected, func(t *testing.T) {
			for key, value := range map[string]string{"SPEECHSWITCH_DEEPDUB_API_KEY": test.scoped, "DEEPDUB_API_KEY": test.native} {
				t.Setenv(key, value)
				if value == "absent" {
					if err := os.Unsetenv(key); err != nil {
						t.Fatal(err)
					}
				}
			}
			options := Options{RequestID: runtime.Some("")}
			if test.explicitPresent {
				options.Auth = auth.Auth{Deepdub: runtime.Some(auth.AuthAsync{ApiKey: runtime.Some(test.explicit)})}
			}
			calls := 0
			b := newBody()
			options.Transport = transportFunc(func(r *http.Request) (*http.Response, error) {
				calls++
				if r.Header.Get("x-api-key") != test.expected {
					t.Fatal(r.Header)
				}
				var wire map[string]any
				if err := json.NewDecoder(r.Body).Decode(&wire); err != nil {
					t.Fatal(err)
				}
				if wire["generationId"] != "" {
					t.Fatal(wire)
				}
				return &http.Response{StatusCode: 200, Body: b}, nil
			})
			audio, err := Synthesize(context.Background(), request(), options)
			if test.expected == "" {
				if err == nil || err.Error() != "Missing auth.deepdub.apiKey configuration" || calls != 0 {
					t.Fatal(err, calls)
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				audio.Close()
				if calls != 1 || b.closes.Load() != 1 {
					t.Fatal(calls, b.closes.Load())
				}
			}
		})
	}
	b := newBody([]byte("too"), []byte("long"))
	_, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: transport(b, 400), MaxErrorBytes: 3})
	if err == nil || err.Error() != "Deepdub response exceeds MaxErrorBytes" || b.closes.Load() != 1 {
		t.Fatal(err, b.closes.Load())
	}
	for _, test := range []struct{ body, message string }{{"oops", "oops"}, {"", "Bad Gateway"}, {`{"message":2}`, `{"message":2}`}, {`{"message":""}`, "Bad Gateway"}} {
		_, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: transport(newBody([]byte(test.body)), 502)})
		var failure *Error
		if !errors.As(err, &failure) || failure.Message != test.message {
			t.Fatal(err)
		}
	}
	original := errors.New("original send error")
	_, err = Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: transportFunc(func(*http.Request) (*http.Response, error) { return nil, original })})
	if err != original {
		t.Fatal(err)
	}
}

func TestNextDeadlineIsTerminal(t *testing.T) {
	b := newBody()
	b.stall = true
	audio, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: transport(b, 200)})
	if err != nil {
		t.Fatal(err)
	}
	defer audio.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	if _, err = audio.Next(ctx); err != context.DeadlineExceeded {
		t.Fatal(err)
	}
	if b.closes.Load() != 1 {
		t.Fatal(b.closes.Load())
	}
	if _, err = audio.Next(context.Background()); err != io.EOF {
		t.Fatal(err)
	}
}

type finalBody struct {
	*body
	data     []byte
	terminal error
}

func (b *finalBody) Read(target []byte) (int, error) {
	n := copy(target, b.data)
	b.data = b.data[n:]
	if len(b.data) == 0 {
		return n, b.terminal
	}
	return n, nil
}

func TestBytesWithTerminalReadError(t *testing.T) {
	original := errors.New("final read failure")
	for _, kind := range []string{"mp3", "opus", "incomplete"} {
		req := request()
		data := []byte("audio")
		if kind != "mp3" {
			req.Value.Output = output("ogg_opus", 0)
			data = ogg(1, "OpusHead")
		}
		if kind == "incomplete" {
			data = data[:3]
		}
		b := &finalBody{body: newBody(), data: data, terminal: original}
		audio, err := Synthesize(context.Background(), req, Options{Auth: testAuth, Transport: transport(b, 200)})
		if err != nil {
			t.Fatal(err)
		}
		if kind != "incomplete" {
			got, err := audio.Next(context.Background())
			if err != nil || !bytes.Equal(got, data) {
				t.Fatal(got, err)
			}
		}
		if got, err := audio.Next(context.Background()); len(got) != 0 || err != original {
			t.Fatal(got, err)
		}
		if _, err = audio.Next(context.Background()); err != io.EOF {
			t.Fatal(err)
		}
		audio.Close()
		if b.closes.Load() != 1 {
			t.Fatal(b.closes.Load())
		}
	}
}
