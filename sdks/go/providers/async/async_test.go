package async

import (
	"bytes"
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

	schema "github.com/speechswitch/client/sdks/go/generated/async_"
	out "github.com/speechswitch/client/sdks/go/generated/async_output"
	"github.com/speechswitch/client/sdks/go/generated/auth"
	"github.com/speechswitch/client/sdks/go/runtime"
)

var credentials = auth.Auth{Async: runtime.Some(auth.AuthAsync{ApiKey: runtime.Some("test-key")})}

func wholeRequest(mode string) schema.TtsRequest {
	if mode == "timestamped" {
		return schema.TtsRequestAsFlashV15TextVoice7c30ce7a{Value: schema.TtsRequestFlashV15TextVoice7c30ce7a{Text: "Hello", Voice: "existing-voice-id", Output: schema.TtsRequestFlashV15TextVoice7c30ce7aOutputAsPcm{Value: schema.TtsRequestFlashV15StreamingTextVoiceOutputPcm{SampleRateHz: 24000}}}}
	}
	var output schema.TtsRequestFlashV15TextVoicee827622bOutput = schema.TtsRequestFlashV15TextVoicee827622bOutputAsPcm{Value: schema.TtsRequestFlashV15StreamingTextVoiceOutputPcm{SampleRateHz: 24000}}
	if mode == "plain" {
		output = schema.TtsRequestFlashV15TextVoicee827622bOutputAsWav{Value: schema.TtsRequestFlashV15TextVoicee827622bOutputWav{SampleRateHz: 24000}}
	}
	return schema.TtsRequestAsFlashV15TextVoicee827622b{Value: schema.TtsRequestFlashV15TextVoicee827622b{Text: "Hello", Voice: "existing-voice-id", Output: output}}
}

type testBody struct {
	chunks  [][]byte
	pending error
	stall   bool
	reading chan struct{}
	closed  chan struct{}
	once    sync.Once
	reads   atomic.Int32
	closes  atomic.Int32
}

func newBody(chunks ...[]byte) *testBody {
	return &testBody{chunks: chunks, closed: make(chan struct{}), reading: make(chan struct{}, 1)}
}
func (b *testBody) Read(p []byte) (int, error) {
	b.reads.Add(1)
	for len(b.chunks) > 0 {
		if len(b.chunks[0]) == 0 {
			b.chunks = b.chunks[1:]
			continue
		}
		n := copy(p, b.chunks[0])
		b.chunks[0] = b.chunks[0][n:]
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
func (b *testBody) Close() error { b.closes.Add(1); b.once.Do(func() { close(b.closed) }); return nil }

type testTransport func(*http.Request) (*http.Response, error)

func (f testTransport) Do(r *http.Request) (*http.Response, error) { return f(r) }
func bodyTransport(body *testBody, status int) runtime.HTTPTransport {
	return testTransport(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: status, Header: make(http.Header), Body: body}, nil
	})
}

func TestSharedHTTPFixturesAtEveryByteSplit(t *testing.T) {
	data, err := os.ReadFile("../../../fixtures/async.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Name      string
		Mode      string
		Status    int
		BodyText  string
		BodyBytes []byte
		Audio     []byte
		Error     string
		Envelopes []struct {
			Correlation string
			Audio       []byte
			Timestamps  []struct {
				Kind        string
				Value       string
				StartTimeMs float64
				EndTimeMs   float64
			}
		}
	}
	if err := json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range fixtures {
		t.Run(fixture.Name, func(t *testing.T) {
			data := fixture.BodyBytes
			if data == nil {
				data = []byte(fixture.BodyText)
			}
			for split := 0; split <= len(data); split++ {
				body := newBody(data[:split], data[split:])
				stream, err := Synthesize(context.Background(), wholeRequest(fixture.Mode), Options{Auth: credentials, Transport: bodyTransport(body, fixture.Status)})
				if err != nil {
					t.Fatal(err)
				}
				audio := []byte{}
				envelopes := []out.TimestampedAudio{}
				message := ""
				for {
					item, err := stream.Next(context.Background())
					if err != nil {
						if err != io.EOF {
							message = err.Error()
						}
						break
					}
					switch item := item.(type) {
					case out.SynthesisItemAsBytes:
						audio = append(audio, item.Value...)
					case out.SynthesisItemAsChunk:
						envelopes = append(envelopes, item.Value)
					default:
						t.Fatalf("unexpected output %#v", item)
					}
				}
				stream.Close()
				expected := []out.TimestampedAudio{}
				for _, envelope := range fixture.Envelopes {
					if envelope.Correlation != "chunk" {
						t.Fatal("invalid fixture correlation")
					}
					value := out.TimestampedAudio{Audio: envelope.Audio, Timestamps: []out.WordTimestamp{}}
					for _, word := range envelope.Timestamps {
						if word.Kind != "word" {
							t.Fatal("invalid fixture timestamp kind")
						}
						value.Timestamps = append(value.Timestamps, out.WordTimestamp{Value: word.Value, StartTimeMs: word.StartTimeMs, EndTimeMs: word.EndTimeMs})
					}
					expected = append(expected, value)
				}
				if !bytes.Equal(audio, fixture.Audio) || !reflect.DeepEqual(envelopes, expected) || message != fixture.Error || body.closes.Load() != 1 {
					t.Fatalf("split %d: audio %v, envelopes %#v, error %q, closes %d; want %v, %#v, %q", split, audio, envelopes, message, body.closes.Load(), fixture.Audio, expected, fixture.Error)
				}
				if item, err := stream.Next(context.Background()); item != nil || err != io.EOF {
					t.Fatalf("terminal = %#v %v", item, err)
				}
			}
		})
	}
}

func TestHTTPNativeRoutesAndAuth(t *testing.T) {
	for _, mode := range []string{"plain", "streaming", "timestamped"} {
		t.Run(mode, func(t *testing.T) {
			requests := make(chan *http.Request, 1)
			payloads := make(chan map[string]any, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var payload map[string]any
				if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
					t.Error(err)
				}
				requests <- r
				payloads <- payload
				if mode == "timestamped" {
					io.WriteString(w, `{"audio_base64":"AP+A","alignment":{"words":[],"word_start_times_milliseconds":[],"word_end_times_milliseconds":[]}}`)
				} else {
					w.Write([]byte{0, 255, 128})
				}
			}))
			defer server.Close()
			stream, err := Synthesize(context.Background(), wholeRequest(mode), Options{Auth: credentials, BaseURL: server.URL + "/prefix%2Fvoice/?keep=1"})
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Close()
			request, payload := <-requests, <-payloads
			path := "/text_to_speech/streaming"
			container := "raw"
			if mode == "plain" {
				path = "/text_to_speech"
				container = "wav"
			} else if mode == "timestamped" {
				path = "/text_to_speech/with_timestamps"
			}
			if request.Method != "POST" || request.URL.RequestURI() != "/prefix%2Fvoice"+path+"?keep=1" || request.Header.Get("x-api-key") != "test-key" || request.Header.Get("version") != "v1" || request.Header.Get("content-type") != "application/json" {
				t.Fatalf("request = %s %s %#v", request.Method, request.URL.RequestURI(), request.Header)
			}
			want := map[string]any{"model_id": "async_flash_v1.5", "voice": map[string]any{"mode": "id", "id": "existing-voice-id"}, "output_format": map[string]any{"container": container, "sample_rate": float64(24000), "encoding": "pcm_s16le"}, "transcript": "Hello"}
			if !reflect.DeepEqual(payload, want) {
				t.Fatalf("payload = %#v; want %#v", payload, want)
			}
			item, err := stream.Next(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			if mode == "timestamped" {
				if !reflect.DeepEqual(item, out.SynthesisItemAsChunk{Value: out.TimestampedAudio{Audio: []byte{0, 255, 128}, Timestamps: []out.WordTimestamp{}}}) {
					t.Fatalf("output = %#v", item)
				}
			} else if !reflect.DeepEqual(item, out.SynthesisItemAsBytes{Value: []byte{0, 255, 128}}) {
				t.Fatalf("output = %#v", item)
			}
		})
	}
	var destinations atomic.Int32
	destination := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { destinations.Add(1) }))
	defer destination.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", destination.URL)
		w.WriteHeader(302)
		io.WriteString(w, "redirect")
	}))
	defer redirect.Close()
	stream, err := Synthesize(context.Background(), wholeRequest("plain"), Options{Auth: credentials, BaseURL: redirect.URL})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	if _, err := stream.Next(context.Background()); err == nil || err.Error() != "Async returned HTTP 302: redirect" || destinations.Load() != 0 {
		t.Fatalf("redirect = %v; destinations %d", err, destinations.Load())
	}
}

func TestHTTPBoundsOwnershipAndCancellation(t *testing.T) {
	for _, mode := range []string{"plain", "streaming", "timestamped"} {
		for _, operation := range []string{"cancel idle", "cancel reading", "close reading", "close unread"} {
			t.Run(mode+"/"+operation, func(t *testing.T) {
				body := newBody()
				body.stall = true
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				stream, err := Synthesize(ctx, wholeRequest(mode), Options{Auth: credentials, Transport: bodyTransport(body, 200)})
				if err != nil {
					t.Fatal(err)
				}
				defer stream.Close()
				done := make(chan error, 1)
				if operation == "cancel reading" || operation == "close reading" {
					go func() { _, err := stream.Next(context.Background()); done <- err }()
					select {
					case <-body.reading:
					case <-time.After(5 * time.Second):
						t.Fatal("read did not start")
					}
				}
				if operation == "close reading" || operation == "close unread" {
					stream.Close()
				} else {
					cancel()
				}
				if operation == "cancel idle" {
					go func() { _, err := stream.Next(context.Background()); done <- err }()
				}
				if operation != "close unread" {
					select {
					case err := <-done:
						if err != context.Canceled {
							t.Fatal(err)
						}
					case <-time.After(5 * time.Second):
						t.Fatal("I/O did not stop")
					}
				}
				stream.Close()
				if body.closes.Load() != 1 {
					t.Fatalf("closes = %d", body.closes.Load())
				}
				if operation == "close unread" && body.reads.Load() != 0 {
					t.Fatalf("unread reads = %d", body.reads.Load())
				}
			})
		}
	}
	for _, status := range []int{200, 400} {
		body := newBody([]byte("12345"))
		stream, err := Synthesize(context.Background(), wholeRequest("timestamped"), Options{Auth: credentials, Transport: bodyTransport(body, status), MaxJSONBytes: 4})
		if err != nil {
			t.Fatal(err)
		}
		_, err = stream.Next(context.Background())
		stream.Close()
		if err == nil || err.Error() != "Async response exceeds MaxJSONBytes" || body.closes.Load() != 1 {
			t.Fatalf("limit = %v; closes %d", err, body.closes.Load())
		}
	}
	sentinel := errors.New("body failed")
	body := newBody([]byte("audio"))
	body.pending = sentinel
	stream, err := Synthesize(context.Background(), wholeRequest("streaming"), Options{Auth: credentials, Transport: bodyTransport(body, 200)})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	item, err := stream.Next(context.Background())
	if err != nil || !reflect.DeepEqual(item, out.SynthesisItemAsBytes{Value: []byte("audio")}) {
		t.Fatalf("preceding audio = %#v %v", item, err)
	}
	if _, err := stream.Next(context.Background()); err != sentinel {
		t.Fatalf("error identity = %v", err)
	}
}

func TestValidationAndAuthPrecedence(t *testing.T) {
	t.Setenv("SPEECHSWITCH_ASYNC_API_KEY", "scoped")
	t.Setenv("ASYNC_API_KEY", "native")
	calls := 0
	keys := []string{}
	transport := testTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		keys = append(keys, r.Header.Get("x-api-key"))
		return &http.Response{StatusCode: 200, Body: newBody()}, nil
	})
	for _, config := range []auth.Auth{credentials, {}} {
		stream, err := Synthesize(context.Background(), wholeRequest("plain"), Options{Auth: config, Transport: transport})
		if err != nil {
			t.Fatal(err)
		}
		stream.Close()
	}
	if err := os.Unsetenv("SPEECHSWITCH_ASYNC_API_KEY"); err != nil {
		t.Fatal(err)
	}
	stream, err := Synthesize(context.Background(), wholeRequest("plain"), Options{Transport: transport})
	if err != nil {
		t.Fatal(err)
	}
	stream.Close()
	if !reflect.DeepEqual(keys, []string{"test-key", "scoped", "native"}) {
		t.Fatalf("keys = %#v", keys)
	}
	for _, config := range []auth.Auth{{Async: runtime.Some(auth.AuthAsync{ApiKey: runtime.Some("")})}, {}} {
		t.Setenv("SPEECHSWITCH_ASYNC_API_KEY", "")
		_, err := Synthesize(context.Background(), wholeRequest("plain"), Options{Auth: config, Transport: transport})
		if err == nil || err.Error() != "Missing auth.async.apiKey configuration" {
			t.Fatalf("empty auth = %v", err)
		}
	}
	invalid := wholeRequest("plain").(schema.TtsRequestAsFlashV15TextVoicee827622b)
	invalid.Value.Output = schema.TtsRequestFlashV15TextVoicee827622bOutputAsPcm{Value: schema.TtsRequestFlashV15StreamingTextVoiceOutputPcm{SampleRateHz: 4000}}
	_, expected := schema.ValidateRequest(invalid)
	if expected == nil {
		t.Fatal("invalid fixture passed generated validation")
	}
	_, err = Synthesize(context.Background(), invalid, Options{Transport: transport})
	if err == nil || err.Error() != expected.Error() {
		t.Fatalf("validation = %v", err)
	}
	var nilRequest *schema.TtsRequestAsFlashV15TextVoicee827622b
	_, expected = schema.ValidateRequest(nilRequest)
	if expected == nil {
		t.Fatal("nil fixture passed generated validation")
	}
	_, err = Synthesize(context.Background(), nilRequest, Options{Transport: transport})
	if err == nil || err.Error() != expected.Error() {
		t.Fatalf("nil request = %v", err)
	}
	if calls != 3 {
		t.Fatalf("network calls = %d", calls)
	}
}

func TestTimestampAndSocketMessageValidation(t *testing.T) {
	for _, test := range []struct{ body, want string }{
		{`null`, "Async returned an invalid timestamp response"},
		{`{}`, "Async returned incomplete timestamped audio"},
		{`{"audio_base64":null,"alignment":{}}`, "Async returned incomplete timestamped audio"},
		{`{"audio_base64":"","alignment":{"words":null,"word_start_times_milliseconds":[],"word_end_times_milliseconds":[]}}`, "Async returned mismatched word timestamp arrays"},
		{`{"audio_base64":"","alignment":{"words":[null],"word_start_times_milliseconds":[0],"word_end_times_milliseconds":[1]}}`, "Async returned an invalid word timestamp"},
		{`{"audio_base64":"","alignment":{"words":["a"],"word_start_times_milliseconds":[true],"word_end_times_milliseconds":[1]}}`, "Async returned an invalid word timestamp"},
		{`{"audio_base64":"","alignment":{"words":["a"],"word_start_times_milliseconds":[null],"word_end_times_milliseconds":[1]}}`, "Async returned an invalid word timestamp"},
		{`{"audio_base64":"","alignment":{"words":["a"],"word_start_times_milliseconds":[-1],"word_end_times_milliseconds":[1]}}`, "Async returned an invalid word timestamp"},
		{`{"audio_base64":"","alignment":{"words":["a"],"word_start_times_milliseconds":[2],"word_end_times_milliseconds":[1]}}`, "Async returned an invalid word timestamp"},
		{`{"audio_base64":"","alignment":{"words":["a"],"word_start_times_milliseconds":[0],"word_end_times_milliseconds":[1e400]}}`, "Async returned an invalid word timestamp"},
		{`{"audio_base64":"!","alignment":{"words":[],"word_start_times_milliseconds":[],"word_end_times_milliseconds":[]}}`, "Async returned invalid base64 audio"},
	} {
		_, err := timestamped([]byte(test.body))
		if err == nil || err.Error() != test.want {
			t.Fatalf("timestamp %s: %v; want %q", test.body, err, test.want)
		}
	}
	for _, value := range []string{"!", "A", "AA", "AA=", "AA===", "AA==\n", "A A="} {
		if _, err := audioData(value); err == nil || err.Error() != "Async returned invalid base64 audio" {
			t.Fatalf("base64 %q: %v", value, err)
		}
	}
	for _, test := range []struct{ body, want string }{
		{`[]`, "Async returned an invalid WebSocket message"},
		{`{}`, "Async returned an unknown WebSocket message"},
		{`{"context_id":"id","audio":"","final":null}`, "Async returned an unknown WebSocket message"},
		{`{"context_id":"other","audio":"","final":false}`, "Async returned output for an unexpected context"},
		{`{"context_id":"id","audio":"","final":true}`, "Async finalized the context before input completed"},
		{`{"error_code":"quota","message":"no credits"}`, "Async synthesis failed (quota): no credits"},
	} {
		_, _, err := socketAudio(test.body, "id", false)
		if err == nil || err.Error() != test.want {
			t.Fatalf("socket %s: %v; want %q", test.body, err, test.want)
		}
	}
	// BOM handling is only at the HTTP text-decoding boundary; audio is untouched.
	body := newBody([]byte("\ufeff\ufeff error \ufeff"))
	stream, err := Synthesize(context.Background(), wholeRequest("plain"), Options{Auth: credentials, Transport: bodyTransport(body, 400)})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	if _, err := stream.Next(context.Background()); err == nil || err.Error() != "Async returned HTTP 400: error" {
		t.Fatalf("HTTP trim = %v", err)
	}
}

func TestSettingsAllModelsAndModes(t *testing.T) {
	input := newTextSource()
	streamOutput := schema.TtsRequestFlashV15StreamingTextVoiceOutputAsPcm{Value: schema.TtsRequestFlashV15StreamingTextVoiceOutputPcm{SampleRateHz: 24000}}
	staticOutput := schema.TtsRequestFlashV15TextVoicee827622bOutputAsPcm{Value: streamOutput.Value}
	timedOutput := schema.TtsRequestFlashV15TextVoice7c30ce7aOutputAsPcm{Value: streamOutput.Value}
	for _, test := range []struct {
		request                  schema.TtsRequest
		model                    string
		streaming, timed, legacy bool
	}{
		{schema.TtsRequestAsFlashV15StreamingTextVoice{Value: schema.TtsRequestFlashV15StreamingTextVoice{Text: input, Voice: "voice", Output: streamOutput}}, "async_flash_v1.5", true, false, false},
		{schema.TtsRequestAsFlashV15TextVoicee827622b{Value: schema.TtsRequestFlashV15TextVoicee827622b{Text: "hi", Voice: "voice", Output: staticOutput}}, "async_flash_v1.5", false, false, false},
		{schema.TtsRequestAsFlashV15TextVoice7c30ce7a{Value: schema.TtsRequestFlashV15TextVoice7c30ce7a{Text: "hi", Voice: "voice", Output: timedOutput}}, "async_flash_v1.5", false, true, false},
		{schema.TtsRequestAsCastleflow10StreamingTextVoice{Value: schema.TtsRequestCastleflow10StreamingTextVoice{Text: input, Voice: "voice", Output: streamOutput, Speed: runtime.Some(0.7), Stability: runtime.Some(0.005)}}, "async_flash_v1.0", true, false, true},
		{schema.TtsRequestAsCastleflow10TextVoice8e858d00{Value: schema.TtsRequestCastleflow10TextVoice8e858d00{Text: "hi", Voice: "voice", Output: staticOutput, Speed: runtime.Some(0.7), Stability: runtime.Some(0.005)}}, "async_flash_v1.0", false, false, true},
		{schema.TtsRequestAsCastleflow10TextVoice09f4eeb0{Value: schema.TtsRequestCastleflow10TextVoice09f4eeb0{Text: "hi", Voice: "voice", Output: timedOutput, Speed: runtime.Some(0.7), Stability: runtime.Some(0.005)}}, "async_flash_v1.0", false, true, true},
		{schema.TtsRequestAsProV10StreamingTextVoice{Value: schema.TtsRequestProV10StreamingTextVoice{Text: input, Voice: "voice", Output: streamOutput}}, "async_pro_v1.0", true, false, false},
		{schema.TtsRequestAsProV10TextVoice54fc4ea5{Value: schema.TtsRequestProV10TextVoice54fc4ea5{Text: "hi", Voice: "voice", Output: staticOutput}}, "async_pro_v1.0", false, false, false},
		{schema.TtsRequestAsProV10TextVoice96f74303{Value: schema.TtsRequestProV10TextVoice96f74303{Text: "hi", Voice: "voice", Output: timedOutput}}, "async_pro_v1.0", false, true, false},
	} {
		// Go method sets permit both forms; all generated wrapper pointers must
		// follow the same conversion path. Reflection constructs only test inputs.
		pointer := reflect.New(reflect.TypeOf(test.request))
		pointer.Elem().Set(reflect.ValueOf(test.request))
		for _, request := range []schema.TtsRequest{test.request, pointer.Interface().(schema.TtsRequest)} {
			if _, err := schema.ValidateRequest(request); err != nil {
				t.Fatal(err)
			}
			wire, err := settings(request)
			if err != nil {
				t.Fatal(err)
			}
			want := map[string]any{"model_id": test.model, "voice": map[string]any{"mode": "id", "id": "voice"}, "output_format": map[string]any{"container": "raw", "encoding": "pcm_s16le", "sample_rate": float64(24000)}}
			if test.legacy {
				want["speed_control"] = 0.7
				want["stability"] = float64(1)
			}
			if !reflect.DeepEqual(wire.settings, want) || wire.timed != test.timed || (wire.input != nil) != test.streaming || wire.force || wire.format != "raw" {
				t.Fatalf("%T settings = %#v; want %#v", request, wire, want)
			}
			if !test.streaming && wire.text != "hi" {
				t.Fatalf("text = %q", wire.text)
			}
		}
	}
}

func TestOutputAndLiteralConversions(t *testing.T) {
	var floating schema.TtsRequestFlashV15StreamingTextVoiceOutputPcmSampleEncoding = &schema.TtsRequestFlashV15StreamingTextVoiceOutputPcmSampleEncodingAsFloat32{}
	for _, test := range []struct {
		output any
		want   map[string]any
	}{
		{schema.TtsRequestFlashV15StreamingTextVoiceOutputAsMp3{Value: schema.TtsRequestFlashV15StreamingTextVoiceOutputMp3{SampleRateHz: 48000}}, map[string]any{"container": "mp3", "sample_rate": float64(48000), "bit_rate": float64(192000)}},
		{&schema.TtsRequestFlashV15TextVoicee827622bOutputAsMp3{Value: schema.TtsRequestFlashV15StreamingTextVoiceOutputMp3{SampleRateHz: 44100, BitRateBps: runtime.Some(32000.0)}}, map[string]any{"container": "mp3", "sample_rate": float64(44100), "bit_rate": float64(32000)}},
		{&schema.TtsRequestFlashV15TextVoicee827622bOutputAsMulaw{Value: schema.TtsRequestFlashV15StreamingTextVoiceOutputMulaw{SampleRateHz: 8000}}, map[string]any{"container": "raw", "sample_rate": float64(8000), "encoding": "pcm_mulaw"}},
		{&schema.TtsRequestFlashV15TextVoice7c30ce7aOutputAsWav{Value: schema.TtsRequestFlashV15TextVoicee827622bOutputWav{SampleRateHz: 24000, SampleEncoding: runtime.Some(floating)}}, map[string]any{"container": "wav", "sample_rate": float64(24000), "encoding": "pcm_f32le"}},
	} {
		value, err := outputFormat(test.output)
		if err != nil || !reflect.DeepEqual(value, test.want) {
			t.Fatalf("format %T = %#v %v; want %#v", test.output, value, err, test.want)
		}
	}
	for _, test := range []struct {
		value any
		want  string
	}{
		{schema.TtsRequestFlashV15StreamingTextVoiceLanguageAsDe{}, "de"}, {&schema.TtsRequestFlashV15StreamingTextVoiceLanguageAsEn{}, "en"},
		{schema.TtsRequestFlashV15StreamingTextVoiceLanguageAsEs{}, "es"}, {schema.TtsRequestFlashV15StreamingTextVoiceLanguageAsFr{}, "fr"},
		{schema.TtsRequestFlashV15StreamingTextVoiceLanguageAsIt{}, "it"}, {schema.TtsRequestFlashV15StreamingTextVoiceLanguageAsPt{}, "pt"},
		{schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsAr{}, "ar"}, {schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsDe{}, "de"},
		{schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsEn{}, "en"}, {schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsEs{}, "es"},
		{schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsFr{}, "fr"}, {schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsHe{}, "he"},
		{schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsHi{}, "hi"}, {schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsHy{}, "hy"},
		{schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsIt{}, "it"}, {schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsJa{}, "ja"},
		{schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsPt{}, "pt"}, {schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsRo{}, "ro"},
		{schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsRu{}, "ru"}, {schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsTr{}, "tr"},
		{schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsZh{}, "zh"}, {schema.TtsRequestFlashV15StreamingTextVoiceLanguageEn{}, "en"},
		{schema.TtsRequestFlashV15StreamingTextVoiceSegmentationAsImmediate{}, "immediate"}, {schema.TtsRequestFlashV15StreamingTextVoiceSegmentationAsSentence{}, "sentence"},
		{schema.TtsRequestFlashV15StreamingTextVoiceOutputPcmSampleEncodingAsSignedInteger16{}, "signed_integer_16"},
	} {
		pointer := reflect.New(reflect.TypeOf(test.value))
		pointer.Elem().Set(reflect.ValueOf(test.value))
		values := []any{test.value}
		if reflect.TypeOf(test.value).Kind() != reflect.Pointer {
			values = append(values, pointer.Interface())
		}
		for _, value := range values {
			got, err := literal(value)
			if err != nil || got != test.want {
				t.Fatalf("literal %T = %q %v; want %q", value, got, err, test.want)
			}
		}
	}
	var language schema.TtsRequestCastleflow10StreamingTextVoiceLanguage = &schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsHy{}
	request := schema.TtsRequestAsCastleflow10TextVoice8e858d00{Value: schema.TtsRequestCastleflow10TextVoice8e858d00{Text: "hi", Voice: "voice", Output: schema.TtsRequestFlashV15TextVoicee827622bOutputAsPcm{Value: schema.TtsRequestFlashV15StreamingTextVoiceOutputPcm{SampleRateHz: 24000}}, Language: runtime.Some(language), Stability: runtime.Some(0.0)}}
	if _, err := schema.ValidateRequest(request); err != nil {
		t.Fatal(err)
	}
	wire, err := settings(request)
	if err != nil {
		t.Fatal(err)
	}
	if wire.settings["language"] != "hy" || wire.settings["stability"] != float64(0) {
		t.Fatalf("optional values = %#v", wire.settings)
	}
}
