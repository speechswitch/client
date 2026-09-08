package deepdub

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/deepdub"
	"github.com/speechswitch/client/sdks/go/runtime"
)

var testAuth = auth.Auth{Deepdub: runtime.Some(auth.AuthAsync{ApiKey: runtime.Some("test-key")})}

func output(format string, rate float64) schema.TtsRequestOg11Text188d3251Output {
	formats := map[string]schema.TtsRequestOg11Text188d3251OutputFormat{"mp3": schema.TtsRequestOg11Text188d3251OutputFormatAsMp3{}, "mulaw": schema.TtsRequestOg11Text188d3251OutputFormatAsMulaw{}, "ogg_opus": schema.TtsRequestOg11Text188d3251OutputFormatAsOggOpus{}}
	rates := map[float64]schema.TtsRequestOg11Text188d3251OutputSampleRateHz{8000: schema.TtsRequestOg11Text188d3251OutputSampleRateHzAsNumber8000{}, 16000: schema.TtsRequestOg11Text188d3251OutputSampleRateHzAsNumber16000{}, 22050: schema.TtsRequestOg11Text188d3251OutputSampleRateHzAsNumber22050{}, 24000: schema.TtsRequestOg11Text188d3251OutputSampleRateHzAsNumber24000{}, 32000: schema.TtsRequestOg11Text188d3251OutputSampleRateHzAsNumber32000{}, 36000: schema.TtsRequestOg11Text188d3251OutputSampleRateHzAsNumber36000{}, 44100: schema.TtsRequestOg11Text188d3251OutputSampleRateHzAsNumber44100{}, 48000: schema.TtsRequestOg11Text188d3251OutputSampleRateHzAsNumber48000{}}
	result := schema.TtsRequestOg11Text188d3251Output{Format: formats[format]}
	if rate != 0 {
		result.SampleRateHz = runtime.Some(rates[rate])
	}
	return result
}
func flag(value bool) runtime.Optional[schema.TtsRequestOg11Text188d3251AudioEnhancement] {
	var result schema.TtsRequestOg11Text188d3251AudioEnhancement = schema.TtsRequestOg11Text188d3251AudioEnhancementAsFalse{}
	if value {
		result = schema.TtsRequestOg11Text188d3251AudioEnhancementAsTrue{}
	}
	return runtime.Some(result)
}
func request() schema.TtsRequestAsTextVoiceb776b412 {
	return schema.TtsRequestAsTextVoiceb776b412{Value: schema.TtsRequestTextVoiceb776b412{Model: schema.TtsRequestTextee721c85ModelAsPhantomX32{}, Voice: "custom", Text: "Hello", Language: "en-US", Output: output("mp3", 0)}}
}
func fixtureRequests() []schema.TtsRequest {
	first := request()
	first.Value.Output = output("mp3", 32000)
	first.Value.Speed = runtime.Some(0.0)
	first.Value.Temperature, first.Value.DeliveryVariance = runtime.Some(0.0), runtime.Some(0.0)
	first.Value.VoiceBoost, first.Value.DurationStretching, first.Value.AudioEnhancement, first.Value.AutomaticGainControl = flag(false), flag(false), flag(false), flag(false)
	var standard schema.TtsRequestOg11Text188d3251ProcessingPriority = schema.TtsRequestOg11Text188d3251ProcessingPriorityAsStandard{}
	var realtime schema.TtsRequestOg11Text188d3251ProcessingPriority = schema.TtsRequestOg11Text188d3251ProcessingPriorityAsRealtime{}
	var female schema.TtsRequestOg11Text188d3251SpeakerGender = schema.TtsRequestOg11Text188d3251SpeakerGenderAsFemale{}
	var male schema.TtsRequestOg11Text188d3251SpeakerGender = schema.TtsRequestOg11Text188d3251SpeakerGenderAsMale{}
	first.Value.ProcessingPriority, first.Value.SpeakerGender = runtime.Some(standard), runtime.Some(female)
	first.Value.AccentBlend = runtime.Some(schema.TtsRequestOg11Text188d3251AccentBlend{BaseLocale: "en-US", TargetLocale: "fr-FR"})
	first.Value.DeliveryReference = runtime.Some("performance")
	return []schema.TtsRequest{
		first,
		schema.TtsRequestAsTextVoice5ce3f477{Value: schema.TtsRequestTextVoice5ce3f477{Model: schema.TtsRequestTextee721c85ModelAsLightning25{}, Voice: "custom", Text: "Hello", Language: "en-US", Output: output("mulaw", 0), TargetDurationMs: 1500}},
		schema.TtsRequestAsText8086f935{Value: schema.TtsRequestText8086f935{Model: schema.TtsRequestTextee721c85ModelAsPhantomX32{}, ReferenceAudio: []byte{0, 255}, Text: "Hello", Language: "en-US", Output: output("mp3", 0), Speed: runtime.Some(2.0), Temperature: runtime.Some(1.0), DeliveryVariance: runtime.Some(1.0), VoiceBoost: flag(true), DurationStretching: flag(true), AudioEnhancement: flag(true), AutomaticGainControl: flag(true), ProcessingPriority: runtime.Some(realtime), SpeakerGender: runtime.Some(male), AccentBlend: runtime.Some(schema.TtsRequestOg11Text188d3251AccentBlend{BaseLocale: "en-US", TargetLocale: "fr-FR", Ratio: 1})}},
		schema.TtsRequestAsTextee721c85{Value: schema.TtsRequestTextee721c85{Model: schema.TtsRequestTextee721c85ModelAsOg11{}, ReferenceAudio: []byte{0, 255}, Text: "Hello", Language: "en-US", Output: output("mp3", 36000), TargetDurationMs: 250}},
		schema.TtsRequestAsOg11TextVoice7f540c02{Value: schema.TtsRequestOg11TextVoice7f540c02{Voice: "custom", ReferenceAudio: runtime.Some([]byte{0, 255}), Text: "Hello", Language: "en-US", Output: output("mp3", 0), RandomSeed: 0, Speed: runtime.Some(0.25)}},
		schema.TtsRequestAsOg11TextVoiceafafd490{Value: schema.TtsRequestOg11TextVoiceafafd490{Voice: "custom", Text: "Hello", Language: "en-US", Output: output("mulaw", 16000), RandomSeed: 9007199254740991, TargetDurationMs: 2000}},
		schema.TtsRequestAsOg11Text63cdfcb0{Value: schema.TtsRequestOg11Text63cdfcb0{ReferenceAudio: []byte{0, 255}, Text: "Hello", Language: "en-US", Output: output("mp3", 0), RandomSeed: -9007199254740991, Speed: runtime.Some(1.0)}},
		schema.TtsRequestAsOg11Text188d3251{Value: schema.TtsRequestOg11Text188d3251{ReferenceAudio: []byte{0, 255}, Text: "Hello", Language: "en-US", Output: output("mp3", 22050), RandomSeed: 42, TargetDurationMs: 1250}},
	}
}

type body struct {
	chunks              [][]byte
	reads, closes       atomic.Int32
	failure, closeError error
	stall               bool
	waiting, closed     chan struct{}
	readOnce, closeOnce sync.Once
}

func newBody(chunks ...[]byte) *body {
	return &body{chunks: chunks, waiting: make(chan struct{}), closed: make(chan struct{})}
}
func (b *body) Read(target []byte) (int, error) {
	b.reads.Add(1)
	for len(b.chunks) > 0 {
		value := b.chunks[0]
		if len(value) == 0 {
			b.chunks = b.chunks[1:]
			continue
		}
		n := copy(target, value)
		b.chunks[0] = value[n:]
		return n, nil
	}
	if b.failure != nil {
		return 0, b.failure
	}
	if b.stall {
		b.readOnce.Do(func() { close(b.waiting) })
		<-b.closed
		return 0, io.ErrClosedPipe
	}
	return 0, io.EOF
}
func (b *body) Close() error {
	b.closes.Add(1)
	b.closeOnce.Do(func() { close(b.closed) })
	return b.closeError
}

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) Do(r *http.Request) (*http.Response, error) { return f(r) }
func transport(b io.ReadCloser, status int) transportFunc {
	return func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: status, Header: make(http.Header), Body: b}, nil
	}
}
func equalJSON(t *testing.T, actual any, expected json.RawMessage) {
	t.Helper()
	data, err := json.Marshal(actual)
	if err != nil {
		t.Fatal(err)
	}
	var a, b any
	if err = json.Unmarshal(data, &a); err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(expected, &b); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(a, b) {
		t.Fatalf("got %s; want %s", data, expected)
	}
}
func wait(t *testing.T, signal <-chan struct{}) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(time.Second):
		t.Fatal("operation did not complete")
	}
}

func TestSharedFixturesAndPointerRepresentations(t *testing.T) {
	data, err := os.ReadFile("../../../fixtures/deepdub.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Name string
		Wire json.RawMessage
	}
	if err = json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	requests := fixtureRequests()
	if len(fixtures) != len(requests) {
		t.Fatal("fixture count mismatch")
	}
	for index, fixture := range fixtures {
		t.Run(fixture.Name, func(t *testing.T) {
			for _, pointer := range []bool{false, true} {
				req := requests[index]
				if pointer {
					value := reflect.ValueOf(req)
					ptr := reflect.New(value.Type())
					ptr.Elem().Set(value)
					req = ptr.Interface().(schema.TtsRequest)
				}
				b := newBody([]byte{0, 255}, []byte("later"))
				calls := 0
				tr := transportFunc(func(r *http.Request) (*http.Response, error) {
					calls++
					if r.Method != "POST" || r.URL.String() != "https://proxy.test/prefix%20path/tts?tenant=1" {
						t.Fatal(r.Method, r.URL)
					}
					if !reflect.DeepEqual(r.Header, http.Header{"X-Api-Key": {"test-key"}, "Content-Type": {"application/json"}}) {
						t.Fatal(r.Header)
					}
					var payload any
					if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
						t.Fatal(err)
					}
					equalJSON(t, payload, fixture.Wire)
					return &http.Response{StatusCode: 200, Header: make(http.Header), Body: b}, nil
				})
				audio, err := Synthesize(context.Background(), req, Options{Auth: testAuth, Transport: tr, BaseURL: "https://proxy.test/prefix%20path/?tenant=1", RequestID: runtime.Some("trace")})
				if err != nil {
					t.Fatal(err)
				}
				if b.reads.Load() != 0 {
					t.Fatal("eager read")
				}
				for _, want := range [][]byte{{0, 255}, []byte("later")} {
					got, err := audio.Next(context.Background())
					if err != nil || !bytes.Equal(got, want) {
						t.Fatal(got, err)
					}
				}
				for range 2 {
					if _, err = audio.Next(context.Background()); err != io.EOF {
						t.Fatal(err)
					}
				}
				audio.Close()
				if b.closes.Load() != 1 || calls != 1 {
					t.Fatal(b.closes.Load(), calls)
				}
			}
		})
	}
}

func ogg(segments int, signature string) []byte {
	header := make([]byte, 27+segments+8)
	copy(header, "OggS")
	header[26] = byte(segments)
	header[27] = 8
	copy(header[27+segments:], signature)
	return header
}
func TestFormatsRatesAndEveryCodecSplit(t *testing.T) {
	for _, format := range []string{"mp3", "mulaw", "ogg_opus"} {
		for _, rate := range []float64{8000, 16000, 22050, 24000, 32000, 36000, 44100, 48000} {
			req := request()
			req.Value.Output = output(format, rate)
			chunk := []byte("audio")
			if format == "ogg_opus" {
				chunk = ogg(1, "OpusHead")
			}
			b := newBody(chunk)
			tr := transportFunc(func(r *http.Request) (*http.Response, error) {
				var p map[string]any
				if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
					t.Fatal(err)
				}
				native := format
				if native == "ogg_opus" {
					native = "opus"
				}
				if p["format"] != native || p["sampleRate"] != rate {
					t.Fatal(p)
				}
				id := p["generationId"].(string)
				if len(id) != 36 || id[14] != '4' {
					t.Fatal(id)
				}
				return &http.Response{StatusCode: 200, Body: b}, nil
			})
			audio, err := Synthesize(context.Background(), req, Options{Auth: testAuth, Transport: tr})
			if err != nil {
				t.Fatal(err)
			}
			got, err := audio.Next(context.Background())
			if err != nil || !bytes.Equal(got, chunk) {
				t.Fatal(got, err)
			}
			audio.Close()
		}
	}
	for _, segments := range []int{1, 255} {
		header := ogg(segments, "OpusHead")
		for split := 0; split <= len(header); split++ {
			req := request()
			req.Value.Output = output("ogg_opus", 0)
			b := newBody(header[:split], header[split:])
			b.stall = true
			audio, err := Synthesize(context.Background(), req, Options{Auth: testAuth, Transport: transport(b, 200)})
			if err != nil {
				t.Fatal(err)
			}
			for _, want := range [][]byte{header[:split], header[split:]} {
				if len(want) == 0 {
					continue
				}
				got, err := audio.Next(context.Background())
				if err != nil || !bytes.Equal(got, want) {
					t.Fatal(split, got, err)
				}
			}
			select {
			case <-b.waiting:
				t.Fatal("buffered beyond codec header")
			default:
			}
			audio.Close()
			if b.closes.Load() != 1 {
				t.Fatal(b.closes.Load())
			}
		}
	}
}

func TestErrorsAndMalformedCodecAreTerminal(t *testing.T) {
	for _, status := range []int{400, 401, 402, 403, 404, 429, 500, 599} {
		for _, id := range []string{"missing", "server", ""} {
			b := newBody([]byte(`{"message":"denied"}`))
			tr := transportFunc(func(*http.Request) (*http.Response, error) {
				header := http.Header{}
				if id != "missing" {
					header["x-generation-id"] = []string{id}
				}
				return &http.Response{StatusCode: status, Header: header, Body: b}, nil
			})
			_, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: tr, RequestID: runtime.Some("trace")})
			var failure *Error
			if !errors.As(err, &failure) {
				t.Fatal(err)
			}
			expected := id
			if id == "missing" {
				expected = "trace"
			}
			if failure.StatusCode != status || failure.GenerationID != expected || failure.Message != "denied" {
				t.Fatal(failure)
			}
			if b.closes.Load() != 1 {
				t.Fatal(b.closes.Load())
			}
		}
	}
	for _, test := range []struct {
		data    []byte
		message string
	}{
		{ogg(1, "\x01vorbis"), "Deepdub returned a different Ogg codec (the trial API has returned Vorbis) for requested Opus audio"},
		{make([]byte, 40), "Deepdub did not return an Ogg Opus stream"},
		{[]byte("Ogg"), "Deepdub returned a truncated Ogg Opus header"},
		{nil, "Deepdub returned a truncated Ogg Opus header"},
	} {
		for split := 0; split <= len(test.data); split++ {
			b := newBody(test.data[:split], test.data[split:])
			b.closeError = errors.New("secondary cleanup")
			req := request()
			req.Value.Output = output("ogg_opus", 0)
			audio, err := Synthesize(context.Background(), req, Options{Auth: testAuth, Transport: transport(b, 200)})
			if err != nil {
				t.Fatal(err)
			}
			got, err := audio.Next(context.Background())
			if len(got) != 0 || err == nil || err.Error() != test.message {
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
	original := errors.New("original read failure")
	b := newBody()
	b.failure = original
	b.closeError = errors.New("secondary cleanup")
	audio, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: transport(b, 200)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = audio.Next(context.Background()); err != original {
		t.Fatal(err)
	}
	if _, err = audio.Next(context.Background()); err != io.EOF {
		t.Fatal(err)
	}
}

func TestCancellationAndCloseCoverHeadersReadsIdleAndBufferedPrefix(t *testing.T) {
	for _, phase := range []string{"headers", "read", "idle", "prefix", "buffered", "next", "close", "error"} {
		t.Run(phase, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			b := newBody()
			b.stall = true
			req := request()
			status := 200
			if phase == "prefix" {
				b.chunks = [][]byte{[]byte("Ogg")}
				req.Value.Output = output("ogg_opus", 0)
			}
			if phase == "buffered" {
				h := ogg(1, "OpusHead")
				b.chunks = [][]byte{h[:2], h[2:]}
				req.Value.Output = output("ogg_opus", 0)
			}
			if phase == "error" {
				status = 400
			}
			tr := transport(b, status)
			entered := make(chan struct{})
			if phase == "headers" {
				tr = func(r *http.Request) (*http.Response, error) {
					close(entered)
					<-r.Context().Done()
					return nil, r.Context().Err()
				}
			}
			if phase == "headers" || phase == "error" {
				done := make(chan error, 1)
				go func() { _, err := Synthesize(ctx, req, Options{Auth: testAuth, Transport: tr}); done <- err }()
				if phase == "headers" {
					wait(t, entered)
				} else {
					wait(t, b.waiting)
				}
				cancel()
				select {
				case err := <-done:
					if !errors.Is(err, context.Canceled) {
						t.Fatal(err)
					}
				case <-time.After(time.Second):
					t.Fatal("blocked init")
				}
				return
			}
			audio, err := Synthesize(ctx, req, Options{Auth: testAuth, Transport: tr})
			if err != nil {
				t.Fatal(err)
			}
			defer audio.Close()
			if phase == "buffered" {
				if _, err = audio.Next(context.Background()); err != nil {
					t.Fatal(err)
				}
			}
			if phase == "idle" || phase == "buffered" {
				cancel()
				wait(t, b.closed)
				if data, err := audio.Next(context.Background()); len(data) != 0 || !errors.Is(err, context.Canceled) {
					t.Fatal(data, err)
				}
				return
			}
			pull, pullCancel := context.WithCancel(context.Background())
			defer pullCancel()
			done := make(chan error, 1)
			go func() { _, err := audio.Next(pull); done <- err }()
			wait(t, b.waiting)
			if phase == "next" {
				pullCancel()
			} else if phase == "close" {
				audio.Close()
			} else {
				cancel()
			}
			select {
			case err := <-done:
				if !errors.Is(err, context.Canceled) {
					t.Fatal(err)
				}
			case <-time.After(time.Second):
				t.Fatal("blocked read")
			}
			if b.closes.Load() != 1 {
				t.Fatal(b.closes.Load())
			}
		})
	}
}
