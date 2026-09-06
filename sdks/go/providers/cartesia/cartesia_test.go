package cartesia

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/cartesia"
	out "github.com/speechswitch/client/sdks/go/generated/cartesia_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

var testAuth = auth.Auth{Cartesia: runtime.Some(auth.AuthCartesia{ApiKey: runtime.Some("key")})}

func pcm() schema.TtsRequestTextVoicef0bb1766OutputPcm {
	return schema.TtsRequestTextVoicef0bb1766OutputPcm{SampleEncoding: schema.TtsRequestTextVoicef0bb1766OutputPcmSampleEncodingAsSignedInteger16{}, SampleRateHz: schema.TtsRequestTextVoicef0bb1766OutputPcmSampleRateHzAsNumber24000{}}
}
func static() schema.TtsRequestTextVoicef0bb1766 {
	return schema.TtsRequestTextVoicef0bb1766{Model: schema.TtsRequestTextVoicef0bb1766ModelAsSonic35{}, Voice: "saved-custom", Text: "Hello", Output: schema.TtsRequestTextVoicef0bb1766OutputAsPcm{Value: pcm()}}
}
func live(input runtime.Input[inputItem]) schema.TtsRequestStreamingTextVoice0bf53a99 {
	return schema.TtsRequestStreamingTextVoice0bf53a99{Model: schema.TtsRequestTextVoicef0bb1766ModelAsSonic35{}, Voice: "saved-custom", Text: input, Output: schema.TtsRequestStreamingTextVoice0bf53a99OutputAsPcm{Value: pcm()}}
}
func timed() schema.TtsRequest {
	return schema.TtsRequestAsTextVoicec75c718e{Value: schema.TtsRequestTextVoicec75c718e{Model: schema.TtsRequestTextVoicef0bb1766ModelAsSonic35{}, Voice: "saved-custom", Text: "Hello", Output: schema.TtsRequestStreamingTextVoice0bf53a99OutputAsPcm{Value: pcm()}, TimestampGranularity: schema.TtsRequestStreamingTextVoice12b0fd0cTimestampGranularityAsArray{Value: []schema.TtsRequestStreamingTextVoice12b0fd0cTimestampGranularityArrayItem{schema.TtsRequestStreamingTextVoice12b0fd0cTimestampGranularityArrayItemAsWord{}, schema.TtsRequestStreamingTextVoice12b0fd0cTimestampGranularityArrayItemAsPhoneme{}}}}}
}

type body struct {
	chunks        [][]byte
	reads, closes atomic.Int32
	failure       error
}

func (b *body) Read(target []byte) (int, error) {
	b.reads.Add(1)
	if len(b.chunks) == 0 {
		if b.failure != nil {
			return 0, b.failure
		}
		return 0, io.EOF
	}
	n := copy(target, b.chunks[0])
	b.chunks[0] = b.chunks[0][n:]
	if len(b.chunks[0]) == 0 {
		b.chunks = b.chunks[1:]
	}
	return n, nil
}
func (b *body) Close() error { b.closes.Add(1); return nil }

type transport struct {
	status   int
	body     io.ReadCloser
	requests []*http.Request
	payloads []map[string]any
}

func (t *transport) Do(r *http.Request) (*http.Response, error) {
	t.requests = append(t.requests, r)
	var value map[string]any
	if err := json.NewDecoder(r.Body).Decode(&value); err != nil {
		return nil, err
	}
	t.payloads = append(t.payloads, value)
	return &http.Response{StatusCode: t.status, Header: http.Header{}, Body: t.body}, nil
}
func checkJSON(t *testing.T, actual, expected any) {
	t.Helper()
	encoded, err := json.Marshal(actual)
	if err != nil {
		t.Fatal(err)
	}
	var normalized any
	if err := json.Unmarshal(encoded, &normalized); err != nil {
		t.Fatal(err)
	}
	encoded, err = json.Marshal(expected)
	if err != nil {
		t.Fatal(err)
	}
	var want any
	if err := json.Unmarshal(encoded, &want); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(normalized, want) {
		t.Fatalf("got %#v\nwant %#v", normalized, want)
	}
}
func canonical(value out.SynthesisItem) any {
	switch v := value.(type) {
	case out.SynthesisItemAsBytes:
		audio := []int{}
		for _, b := range v.Value {
			audio = append(audio, int(b))
		}
		return audio
	case out.SynthesisItemAsClear:
		return map[string]any{"event": "clear"}
	case out.SynthesisItemAsFlush:
		result := map[string]any{"event": "flush", "correlationId": v.Value.CorrelationId}
		if v.Value.InputGroupId.Present {
			result["inputGroupId"] = v.Value.InputGroupId.Value
		}
		return result
	case out.SynthesisItemAsTimeline:
		timestamps := []any{}
		for _, stamp := range v.Value.Timestamps {
			timestamps = append(timestamps, map[string]any{"kind": stamp.Kind.LiteralValue(), "value": stamp.Value, "startTimeMs": stamp.StartTimeMs, "endTimeMs": stamp.EndTimeMs})
		}
		result := map[string]any{"correlation": "timeline", "correlationId": v.Value.CorrelationId, "timestamps": timestamps}
		if v.Value.InputGroupId.Present {
			result["inputGroupId"] = v.Value.InputGroupId.Value
		}
		if v.Value.Audio.Present {
			result["audio"] = canonical(out.SynthesisItemAsBytes{Value: v.Value.Audio.Value})
		}
		return result
	default:
		panic("unexpected output representation")
	}
}
func collect(ctx context.Context, stream runtime.Input[out.SynthesisItem]) ([]any, error) {
	items := []any{}
	for {
		item, err := stream.Next(ctx)
		if err == io.EOF {
			return items, nil
		}
		if err != nil {
			return items, err
		}
		items = append(items, canonical(item))
	}
}

func TestSharedSSEFixturesEveryByteSplit(t *testing.T) {
	var fixtures []struct {
		Name   string
		Frames []map[string]any
		Items  []any
		Error  string
	}
	data, err := os.ReadFile("../../../fixtures/cartesia.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range fixtures {
		t.Run(fixture.Name, func(t *testing.T) {
			var events bytes.Buffer
			for _, frame := range fixture.Frames {
				encoded, err := json.Marshal(frame)
				if err != nil {
					t.Fatal(err)
				}
				events.WriteString("data: ")
				events.Write(encoded)
				events.WriteString("\n\n")
			}
			for split := 0; split <= events.Len(); split++ {
				response := &body{chunks: [][]byte{events.Bytes()[:split], events.Bytes()[split:]}}
				transport := &transport{status: 200, body: response}
				stream, err := Synthesize(context.Background(), timed(), Options{Auth: testAuth, Transport: transport})
				if err != nil {
					t.Fatal(err)
				}
				items, failure := collect(context.Background(), stream)
				stream.Close()
				message := ""
				if failure != nil {
					message = failure.Error()
				}
				if message != fixture.Error {
					t.Fatalf("split %d error = %q, want %q", split, message, fixture.Error)
				}
				for _, item := range items {
					envelope := item.(map[string]any)
					if envelope["correlationId"] != transport.payloads[0]["context_id"] {
						t.Fatal("native context lost")
					}
					envelope["correlationId"] = "context"
				}
				checkJSON(t, items, fixture.Items)
				if response.closes.Load() != 1 {
					t.Fatalf("body closes = %d", response.closes.Load())
				}
			}
		})
	}
}

func TestHTTPModelFormatsAndIndependentControls(t *testing.T) {
	rate := schema.TtsRequestTextVoicef0bb1766OutputPcmSampleRateHzAsNumber24000{}
	formats := []struct {
		output schema.TtsRequestTextVoicef0bb1766Output
		wire   map[string]any
	}{
		{schema.TtsRequestTextVoicef0bb1766OutputAsPcm{Value: pcm()}, map[string]any{"container": "raw", "sample_rate": 24000, "encoding": "pcm_s16le"}},
		{schema.TtsRequestTextVoicef0bb1766OutputAsMp3{Value: schema.TtsRequestTextVoicef0bb1766OutputMp3{SampleRateHz: rate, BitRateBps: schema.TtsRequestTextVoicef0bb1766OutputMp3BitRateBpsAsNumber128000{}}}, map[string]any{"container": "mp3", "sample_rate": 24000, "bit_rate": 128000}},
	}
	floating := pcm()
	floating.SampleEncoding = schema.TtsRequestTextVoicef0bb1766OutputPcmSampleEncodingAsFloat32{}
	formats = append(formats, struct {
		output schema.TtsRequestTextVoicef0bb1766Output
		wire   map[string]any
	}{schema.TtsRequestTextVoicef0bb1766OutputAsPcm{Value: floating}, map[string]any{"container": "raw", "sample_rate": 24000, "encoding": "pcm_f32le"}})
	for _, kind := range []schema.TtsRequestTextVoicef0bb1766OutputObjectFormat{schema.TtsRequestTextVoicef0bb1766OutputObjectFormatAsAlaw{}, schema.TtsRequestTextVoicef0bb1766OutputObjectFormatAsMulaw{}} {
		formats = append(formats, struct {
			output schema.TtsRequestTextVoicef0bb1766Output
			wire   map[string]any
		}{schema.TtsRequestTextVoicef0bb1766OutputAsObject{Value: schema.TtsRequestTextVoicef0bb1766OutputObject{Format: kind, SampleRateHz: rate}}, map[string]any{"container": "raw", "sample_rate": 24000, "encoding": "pcm_" + kind.LiteralValue()}})
	}
	for _, encoding := range []schema.TtsRequestTextVoicef0bb1766OutputWavSampleEncoding{schema.TtsRequestTextVoicef0bb1766OutputWavSampleEncodingAsSignedInteger16{}, schema.TtsRequestTextVoicef0bb1766OutputWavSampleEncodingAsFloat32{}, schema.TtsRequestTextVoicef0bb1766OutputWavSampleEncodingAsAlaw{}, schema.TtsRequestTextVoicef0bb1766OutputWavSampleEncodingAsMulaw{}} {
		formats = append(formats, struct {
			output schema.TtsRequestTextVoicef0bb1766Output
			wire   map[string]any
		}{schema.TtsRequestTextVoicef0bb1766OutputAsWav{Value: schema.TtsRequestTextVoicef0bb1766OutputWav{SampleRateHz: rate, SampleEncoding: runtime.Some(encoding)}}, map[string]any{"container": "wav", "sample_rate": 24000, "encoding": map[string]string{"signed_integer_16": "pcm_s16le", "float_32": "pcm_f32le", "alaw": "pcm_alaw", "mulaw": "pcm_mulaw"}[encoding.LiteralValue()]}})
	}
	for _, model := range []string{"sonic-3", "sonic-3.5", "sonic-3.6"} {
		for _, format := range formats {
			v := static()
			v.Output = format.output
			if model == "sonic-3" {
				v.Model = schema.TtsRequestTextVoicef0bb1766ModelAsSonic3{}
			}
			var languageChoice schema.TtsRequestTextVoicef0bb1766Language = schema.TtsRequestTextVoicef0bb1766LanguageAsEn{}
			v.Language = runtime.Some(languageChoice)
			v.Speed, v.VolumeScale = runtime.Some(0.6), runtime.Some(0.5)
			v.Accent, v.Lexicon = runtime.Some("fr"), runtime.Some("dictionary")
			var emotion schema.TtsRequestTextVoicef0bb1766Emotion = schema.TtsRequestTextVoicef0bb1766EmotionAsNostalgic{}
			var normalization schema.TtsRequestTextVoicef0bb1766TextNormalization = schema.TtsRequestTextVoicef0bb1766TextNormalizationAsObject{Value: schema.TtsRequestTextVoicef0bb1766TextNormalizationObject{Locale: "en-IN"}}
			v.Emotion, v.TextNormalization = runtime.Some(emotion), runtime.Some(normalization)
			var request schema.TtsRequest = schema.TtsRequestAsTextVoicef0bb1766{Value: v}
			language, languageField := "en", "language"
			if model == "sonic-3.6" {
				language, languageField = "en-GB", "locale"
				request = schema.TtsRequestAsSonic36TextVoice35faf3f2{Value: schema.TtsRequestSonic36TextVoice35faf3f2{Voice: v.Voice, Text: v.Text, Output: v.Output, Language: runtime.Some(language), Speed: v.Speed, VolumeScale: v.VolumeScale, Accent: v.Accent, Lexicon: v.Lexicon, Emotion: v.Emotion, TextNormalization: v.TextNormalization}}
			}
			response := &body{chunks: [][]byte{{0, 255}, []byte("later")}}
			transport := &transport{status: 200, body: response}
			stream, err := Synthesize(context.Background(), request, Options{Auth: testAuth, Transport: transport, BaseURL: "https://proxy.test/prefix%20path/?keep=1"})
			if err != nil {
				t.Fatal(err)
			}
			if response.reads.Load() != 0 {
				t.Fatal("buffered before consumption")
			}
			item, err := stream.Next(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			checkJSON(t, canonical(item), []int{0, 255})
			stream.Close()
			if response.reads.Load() != 1 || response.closes.Load() != 1 {
				t.Fatal("body ownership failed")
			}
			r := transport.requests[0]
			if r.Method != "POST" || r.URL.String() != "https://proxy.test/prefix%20path/tts/bytes?keep=1" {
				t.Fatalf("request = %s %s", r.Method, r.URL)
			}
			checkJSON(t, r.Header, http.Header{"Authorization": {"Bearer key"}, "Cartesia-Version": {version}, "Content-Type": {"application/json"}})
			checkJSON(t, transport.payloads[0], map[string]any{"model_id": model, "voice": "saved-custom", "transcript": "Hello", "output_format": format.wire, languageField: language, "accent": "fr", "pronunciation_dict_id": "dictionary", "normalization": "en-IN", "generation_config": map[string]any{"speed": 0.6, "volume": 0.5, "emotion": "nostalgic"}})
		}
	}
}

func TestHTTPErrorsAndOwnership(t *testing.T) {
	for _, code := range []any{nil, "future_code"} {
		encoded, _ := json.Marshal(map[string]any{"title": "Quota", "message": "exhausted", "error_code": code, "request_id": "req", "doc_url": "docs"})
		response := &body{chunks: [][]byte{encoded}}
		stream, err := Synthesize(context.Background(), schema.TtsRequestAsTextVoicef0bb1766{Value: static()}, Options{Auth: testAuth, Transport: &transport{status: 429, body: response}})
		failure, ok := err.(*Error)
		if !ok || stream != nil {
			t.Fatalf("error = %v", err)
		}
		if failure.Error() != "Cartesia 429: Quota: exhausted" || failure.StatusCode != 429 || failure.RequestID != runtime.Some("req") || failure.DocURL != runtime.Some("docs") || failure.ContextID.Present {
			t.Fatalf("error metadata = %#v", failure)
		}
		if code == nil && failure.ErrorCode != nil || code != nil && (failure.ErrorCode == nil || *failure.ErrorCode != code) {
			t.Fatalf("error code = %v", failure.ErrorCode)
		}
		if response.closes.Load() != 1 {
			t.Fatal("error body leaked")
		}
	}
	for _, test := range []struct {
		data  string
		limit int
		want  string
	}{{"unavailable", 100, "Cartesia 502: Request failed: unavailable"}, {"large", 4, "Cartesia response exceeds MaxJSONBytes"}} {
		response := &body{chunks: [][]byte{[]byte(test.data)}}
		_, err := Synthesize(context.Background(), schema.TtsRequestAsTextVoicef0bb1766{Value: static()}, Options{Auth: testAuth, Transport: &transport{status: 502, body: response}, MaxJSONBytes: test.limit})
		if err == nil || err.Error() != test.want || response.closes.Load() != 1 {
			t.Fatalf("error = %v, closes = %d", err, response.closes.Load())
		}
	}
	failure := errors.New("body read failed")
	response := &body{chunks: [][]byte{{1}}, failure: failure}
	stream, err := Synthesize(context.Background(), schema.TtsRequestAsTextVoicef0bb1766{Value: static()}, Options{Auth: testAuth, Transport: &transport{status: 200, body: response}})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	if _, err := stream.Next(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := stream.Next(context.Background()); err != failure {
		t.Fatalf("identity lost: %v", err)
	}
	if _, err := stream.Next(context.Background()); err != io.EOF {
		t.Fatalf("not terminal: %v", err)
	}
}

type source struct {
	values        chan inputResult
	started       chan struct{}
	closed        chan struct{}
	once          sync.Once
	reads, closes atomic.Int32
}

func newSource(values ...inputResult) *source {
	s := &source{values: make(chan inputResult, 100), started: make(chan struct{}, 100), closed: make(chan struct{})}
	for _, value := range values {
		s.values <- value
	}
	return s
}
func (s *source) Next(ctx context.Context) (inputItem, error) {
	s.reads.Add(1)
	s.started <- struct{}{}
	select {
	case v := <-s.values:
		return v.value, v.err
	case <-s.closed:
		return nil, io.ErrClosedPipe
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}
func (s *source) Close() error { s.once.Do(func() { s.closes.Add(1); close(s.closed) }); return nil }

type socket struct {
	incoming chan socketResult
	closed   chan struct{}
	once     sync.Once
	closes   atomic.Int32
	mutex    sync.Mutex
	sent     []map[string]any
	onSend   func(context.Context, map[string]any) error
}

func newSocket() *socket {
	return &socket{incoming: make(chan socketResult, 100), closed: make(chan struct{})}
}
func (s *socket) Send(ctx context.Context, message runtime.WebSocketMessage) error {
	var wire map[string]any
	if err := json.Unmarshal([]byte(message.(runtime.WebSocketText)), &wire); err != nil {
		return err
	}
	s.mutex.Lock()
	s.sent = append(s.sent, wire)
	s.mutex.Unlock()
	if s.onSend != nil {
		return s.onSend(ctx, wire)
	}
	return nil
}
func (s *socket) Receive(ctx context.Context) (runtime.WebSocketMessage, error) {
	select {
	case v := <-s.incoming:
		return v.value, v.err
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-s.closed:
		return nil, io.EOF
	}
}
func (s *socket) Close() error { s.once.Do(func() { s.closes.Add(1); close(s.closed) }); return nil }
func (s *socket) frames(context any, values ...map[string]any) {
	for _, value := range values {
		wire := map[string]any{"status_code": 200, "done": false, "context_id": context}
		for k, v := range value {
			wire[k] = v
		}
		encoded, _ := json.Marshal(wire)
		s.incoming <- socketResult{value: runtime.WebSocketText(encoded)}
	}
}
func text(value string) inputResult {
	return inputResult{value: schema.TtsRequestStreamingTextVoice0bf53a99TextItemAsString{Value: value}}
}
func testContext(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	t.Cleanup(cancel)
	return ctx
}

func TestLiveClearFlushAndLateRetiredFrames(t *testing.T) {
	ctx := testContext(t)
	input, sock := newSource(text("before ")), newSocket()
	sock.onSend = func(_ context.Context, wire map[string]any) error {
		id := wire["context_id"]
		if wire["cancel"] == true {
			sock.frames(id, map[string]any{"type": "chunk", "data": "////"}, map[string]any{"type": "timestamps"}, map[string]any{"type": "error", "status_code": 500, "message": "late"}, map[string]any{"type": "done", "done": true})
		} else if wire["flush"] == true {
			sock.frames(id, map[string]any{"type": "flush_done", "flush_done": true, "flush_id": 1})
		} else if wire["continue"] == false {
			sock.frames(id, map[string]any{"type": "done", "done": true})
		} else {
			sock.frames(id, map[string]any{"type": "chunk", "data": "AQ==", "flush_id": 1})
		}
		return nil
	}
	stream, err := Synthesize(ctx, schema.TtsRequestAsStreamingTextVoice0bf53a99{Value: live(input)}, Options{WebSocket: sock})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	item, err := stream.Next(ctx)
	if err != nil {
		t.Fatal(err)
	}
	first := item.(out.SynthesisItemAsTimeline).Value.CorrelationId
	checkJSON(t, canonical(item), map[string]any{"correlation": "timeline", "correlationId": first, "inputGroupId": "1", "audio": []int{1}, "timestamps": []any{}})
	input.values <- inputResult{value: schema.TtsRequestStreamingTextVoice0bf53a99TextItemAsFlush{}}
	item, err = stream.Next(ctx)
	if err != nil {
		t.Fatal(err)
	}
	checkJSON(t, canonical(item), map[string]any{"event": "flush", "correlationId": first, "inputGroupId": "1"})
	input.values <- inputResult{value: schema.TtsRequestStreamingTextVoice0bf53a99TextItemAsClear{}}
	item, err = stream.Next(ctx)
	if err != nil {
		t.Fatal(err)
	}
	checkJSON(t, canonical(item), map[string]any{"event": "clear"})
	input.values <- text(" after")
	item, err = stream.Next(ctx)
	if err != nil {
		t.Fatal(err)
	}
	second := item.(out.SynthesisItemAsTimeline).Value.CorrelationId
	if first == second {
		t.Fatal("clear reused context")
	}
	checkJSON(t, canonical(item), map[string]any{"correlation": "timeline", "correlationId": second, "inputGroupId": "1", "audio": []int{1}, "timestamps": []any{}})
	input.values <- inputResult{err: io.EOF}
	if _, err := stream.Next(ctx); err != io.EOF {
		t.Fatalf("completion = %v", err)
	}
	sock.mutex.Lock()
	defer sock.mutex.Unlock()
	checkJSON(t, sock.sent[2], map[string]any{"context_id": first, "cancel": true})
	var transcripts []any
	for _, wire := range sock.sent {
		transcripts = append(transcripts, wire["transcript"])
	}
	checkJSON(t, transcripts, []any{"before ", "", nil, " after", ""})
	if input.closes.Load() != 1 || sock.closes.Load() != 1 {
		t.Fatal("live resources leaked")
	}
}

func TestBackpressuredWriteAllowsAudioWithoutPrefetch(t *testing.T) {
	ctx := testContext(t)
	input, sock := newSource(text("first"), text("later")), newSocket()
	finished := make(chan struct{})
	sock.onSend = func(ctx context.Context, wire map[string]any) error {
		defer close(finished)
		sock.frames(wire["context_id"], map[string]any{"type": "chunk", "data": "AQ=="}, map[string]any{"type": "chunk", "data": "Ag=="})
		<-ctx.Done()
		return ctx.Err()
	}
	stream, err := Synthesize(ctx, schema.TtsRequestAsStreamingTextVoice0bf53a99{Value: live(input)}, Options{WebSocket: sock})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	for _, wanted := range []int{1, 2} {
		item, err := stream.Next(ctx)
		if err != nil {
			t.Fatal(err)
		}
		checkJSON(t, canonical(item), []int{wanted})
	}
	if input.reads.Load() != 1 {
		t.Fatalf("prefetched %d inputs", input.reads.Load())
	}
	stream.Close()
	select {
	case <-finished:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	if input.closes.Load() != 1 || sock.closes.Load() != 1 {
		t.Fatal("backpressure cleanup leaked")
	}
}

func TestInputFailureUnreadCloseAndCancellation(t *testing.T) {
	for _, mode := range []string{"input-error", "unread", "operation", "pull"} {
		t.Run(mode, func(t *testing.T) {
			original := errors.New("producer failure")
			input, sock := newSource(), newSocket()
			ctx, cancel := context.WithCancel(testContext(t))
			defer cancel()
			stream, err := Synthesize(ctx, schema.TtsRequestAsStreamingTextVoice0bf53a99{Value: live(input)}, Options{WebSocket: sock})
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Close()
			if mode == "unread" {
				stream.Close()
				if input.reads.Load() != 0 {
					t.Fatal("unread stream polled input")
				}
			} else {
				nextCtx, stop := context.WithCancel(ctx)
				defer stop()
				done := make(chan error, 1)
				go func() { _, err := stream.Next(nextCtx); done <- err }()
				<-input.started
				want := original
				switch mode {
				case "input-error":
					input.values <- inputResult{err: original}
				case "operation":
					cancel()
					want = context.Canceled
				case "pull":
					stop()
					want = context.Canceled
				}
				if err := <-done; err != want {
					t.Fatalf("error identity = %v, want %v", err, want)
				}
				if _, err := stream.Next(context.Background()); err != io.EOF {
					t.Fatalf("not terminal: %v", err)
				}
			}
			if input.closes.Load() != 1 || sock.closes.Load() != 1 {
				t.Fatal("cleanup leaked")
			}
		})
	}
}

func TestSchemaAndMessageFailures(t *testing.T) {
	input, sock := newSource(text("unread")), newSocket()
	invalid := live(input)
	invalid.Speed = runtime.Some(0.5)
	if _, err := Synthesize(context.Background(), schema.TtsRequestAsStreamingTextVoice0bf53a99{Value: invalid}, Options{WebSocket: sock}); err == nil || err.Error() != "Invalid cartesia TTS request" {
		t.Fatalf("schema error = %v", err)
	}
	if input.reads.Load() != 0 || input.closes.Load() != 0 || sock.closes.Load() != 0 {
		t.Fatal("validation touched input/socket")
	}
	for _, test := range []struct {
		frame runtime.WebSocketMessage
		want  string
	}{
		{runtime.WebSocketBinary{1}, "Cartesia returned a non-text frame"},
		{runtime.WebSocketText(`[]`), "Cartesia returned an invalid frame"},
		{runtime.WebSocketText(`{"status_code":true}`), "Cartesia returned an invalid status_code"},
		{runtime.WebSocketText(`{"status_code":200,"done":false,"type":"chunk","data":"AA=="}`), "Cartesia WebSocket output lacks its context ID"},
		{runtime.WebSocketText(`{"status_code":200,"done":false,"type":"chunk","data":"AA==","context_id":"wrong"}`), "Cartesia returned output for an unexpected context"},
		{runtime.WebSocketText(strings.Repeat("x", 4097)), "Cartesia message exceeds MaxMessageBytes"},
	} {
		input, sock := newSource(), newSocket()
		sock.incoming <- socketResult{value: test.frame}
		stream, err := Synthesize(testContext(t), schema.TtsRequestAsStreamingTextVoice0bf53a99{Value: live(input)}, Options{WebSocket: sock, MaxMessageBytes: 4096})
		if err != nil {
			t.Fatal(err)
		}
		_, err = stream.Next(testContext(t))
		stream.Close()
		if err == nil || err.Error() != test.want {
			t.Fatalf("error = %v, want %s", err, test.want)
		}
		if input.closes.Load() != 1 || sock.closes.Load() != 1 {
			t.Fatal("protocol failure leaked")
		}
	}
}
