package deepgram

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/deepgram"
	out "github.com/speechswitch/client/sdks/go/generated/deepgram_output"
	"github.com/speechswitch/client/sdks/go/runtime"
	"io"
	"net/http"
	"net/url"
	"os"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

var testAuth = auth.Auth{Deepgram: runtime.Some(auth.AuthAsync{ApiKey: runtime.Some("test-key")})}

type fixtureRequest struct {
	Model, Language, Voice, Text string
	Output                       struct {
		Format, SampleEncoding   string
		SampleRateHz, BitRateBps *float64
	}
	Speed                  *float64
	ModelImprovementOptOut *bool
	Tags                   []string
}
type fixtureStep struct {
	Send    map[string]string
	Receive []json.RawMessage
}
type fixtures struct {
	HTTP []struct {
		Name    string
		Request fixtureRequest
		Query   url.Values
	}
	Stream []struct {
		Name  string
		Input []json.RawMessage
		Steps []fixtureStep
		Items json.RawMessage
	}
}

func loadFixtures(t *testing.T) fixtures {
	t.Helper()
	data, err := os.ReadFile("../../../fixtures/deepgram.json")
	if err != nil {
		t.Fatal(err)
	}
	var v fixtures
	if err = json.Unmarshal(data, &v); err != nil {
		t.Fatal(err)
	}
	return v
}
func rate(n float64) schema.TtsRequestAura1TextVoiceOutputPcmSampleRateHz {
	switch n {
	case 8000:
		return schema.TtsRequestAura1TextVoiceOutputPcmSampleRateHzAsNumber8000{}
	case 16000:
		return schema.TtsRequestAura1TextVoiceOutputPcmSampleRateHzAsNumber16000{}
	case 24000:
		return schema.TtsRequestAura1TextVoiceOutputPcmSampleRateHzAsNumber24000{}
	case 32000:
		return schema.TtsRequestAura1TextVoiceOutputPcmSampleRateHzAsNumber32000{}
	case 48000:
		return schema.TtsRequestAura1TextVoiceOutputPcmSampleRateHzAsNumber48000{}
	}
	panic("unknown test sample rate")
}
func pcm() schema.TtsRequestAura1TextVoiceOutputPcm {
	return schema.TtsRequestAura1TextVoiceOutputPcm{SampleRateHz: runtime.Some(rate(24000))}
}
func build(t *testing.T, f fixtureRequest, input runtime.Input[Input], pointer bool) schema.TtsRequest {
	t.Helper()
	var output schema.TtsRequestAura1TextVoiceOutput
	var sample runtime.Optional[schema.TtsRequestAura1TextVoiceOutputPcmSampleRateHz]
	if f.Output.SampleRateHz != nil && (f.Output.Format == "pcm" || f.Output.Format == "wav") && f.Output.SampleEncoding == "" {
		sample = runtime.Some(rate(*f.Output.SampleRateHz))
	}
	g711rate := runtime.Optional[schema.TtsRequestAura1TextVoiceOutputObjectSampleRateHz]{}
	if f.Output.SampleRateHz != nil {
		if *f.Output.SampleRateHz == 8000 {
			var rate schema.TtsRequestAura1TextVoiceOutputObjectSampleRateHz = schema.TtsRequestAura1TextVoiceOutputObjectSampleRateHzAsNumber8000{}
			g711rate = runtime.Some(rate)
		} else if *f.Output.SampleRateHz == 16000 {
			var rate schema.TtsRequestAura1TextVoiceOutputObjectSampleRateHz = schema.TtsRequestAura1TextVoiceOutputObjectSampleRateHzAsNumber16000{}
			g711rate = runtime.Some(rate)
		}
	}
	var g711 schema.TtsRequestAura1TextVoiceOutputObjectFormat = schema.TtsRequestAura1TextVoiceOutputObjectFormatAsMulaw{}
	if f.Output.Format == "alaw" || f.Output.SampleEncoding == "alaw" {
		g711 = schema.TtsRequestAura1TextVoiceOutputObjectFormatAsAlaw{}
	}
	switch f.Output.Format {
	case "pcm":
		output = schema.TtsRequestAura1TextVoiceOutputAsPcm{Value: schema.TtsRequestAura1TextVoiceOutputPcm{SampleRateHz: sample}}
	case "mulaw", "alaw":
		output = schema.TtsRequestAura1TextVoiceOutputAsObject{Value: schema.TtsRequestAura1TextVoiceOutputObject{Format: g711, SampleRateHz: g711rate}}
	case "wav":
		if f.Output.SampleEncoding == "" {
			output = schema.TtsRequestAura1TextVoiceOutputAsWavb8f00cbb{Value: schema.TtsRequestAura1TextVoiceOutputWavb8f00cbb{SampleRateHz: sample}}
		} else {
			output = schema.TtsRequestAura1TextVoiceOutputAsWav669a6d8a{Value: schema.TtsRequestAura1TextVoiceOutputWav669a6d8a{SampleEncoding: g711, SampleRateHz: g711rate}}
		}
	case "mp3":
		var bitrate schema.TtsRequestAura1TextVoiceOutputMp3BitRateBps = schema.TtsRequestAura1TextVoiceOutputMp3BitRateBpsAsNumber32000{}
		output = schema.TtsRequestAura1TextVoiceOutputAsMp3{Value: schema.TtsRequestAura1TextVoiceOutputMp3{SampleRateHz: runtime.Some(schema.TtsRequestAura1TextVoiceOutputMp3SampleRateHz{}), BitRateBps: runtime.Some(bitrate)}}
	case "ogg_opus":
		output = schema.TtsRequestAura1TextVoiceOutputAsOggOpus{Value: schema.TtsRequestAura1TextVoiceOutputOggOpus{SampleRateHz: runtime.Some(schema.TtsRequestAura1TextVoiceOutputPcmSampleRateHzNumber48000{}), BitRateBps: runtime.Some(*f.Output.BitRateBps)}}
	case "flac":
		var flacRate schema.TtsRequestAura1TextVoiceOutputFlacSampleRateHz = schema.TtsRequestAura1TextVoiceOutputFlacSampleRateHzAsNumber22050{}
		output = schema.TtsRequestAura1TextVoiceOutputAsFlac{Value: schema.TtsRequestAura1TextVoiceOutputFlac{SampleRateHz: runtime.Some(flacRate)}}
	case "aac":
		output = schema.TtsRequestAura1TextVoiceOutputAsAac{Value: schema.TtsRequestAura1TextVoiceOutputAac{SampleRateHz: runtime.Some(schema.TtsRequestAura1TextVoiceOutputMp3SampleRateHz{}), BitRateBps: runtime.Some(*f.Output.BitRateBps)}}
	default:
		t.Fatal("unknown fixture output")
	}
	speed := runtime.Optional[float64]{}
	if f.Speed != nil {
		speed = runtime.Some(*f.Speed)
	}
	mip := runtime.Optional[schema.TtsRequestAura1TextVoiceModelImprovementOptOut]{}
	if f.ModelImprovementOptOut != nil {
		var flag schema.TtsRequestAura1TextVoiceModelImprovementOptOut = schema.TtsRequestAura1TextVoiceModelImprovementOptOutAsFalse{}
		if *f.ModelImprovementOptOut {
			flag = schema.TtsRequestAura1TextVoiceModelImprovementOptOutAsTrue{}
		}
		mip = runtime.Some(flag)
	}
	tags := runtime.Optional[[]string]{}
	if f.Tags != nil {
		tags = runtime.Some(f.Tags)
	}
	switch f.Model + "/" + f.Language {
	case "aura-1/en":
		if input != nil {
			v := schema.TtsRequestAsAura1StreamingTextVoice{Value: schema.TtsRequestAura1StreamingTextVoice{Text: input, Voice: schema.TtsRequestAura1TextVoiceVoiceAsAsteria{}, Output: schema.TtsRequestAura1StreamingTextVoiceOutputAsPcm{Value: pcm()}, Speed: speed, ModelImprovementOptOut: mip}}
			if pointer {
				return &v
			}
			return v
		}
		v := schema.TtsRequestAsAura1TextVoice{Value: schema.TtsRequestAura1TextVoice{Text: f.Text, Voice: schema.TtsRequestAura1TextVoiceVoiceAsAsteria{}, Output: output, Speed: speed, ModelImprovementOptOut: mip, Tags: tags}}
		if pointer {
			return &v
		}
		return v
	case "aura-2/en":
		if input != nil {
			v := schema.TtsRequestAsAura2StreamingTextVoice9a9ab9cb{Value: schema.TtsRequestAura2StreamingTextVoice9a9ab9cb{Text: input, Voice: schema.TtsRequestAura2TextVoicecfca101cVoiceAsThalia{}, Output: schema.TtsRequestAura1StreamingTextVoiceOutputAsPcm{Value: pcm()}, Speed: speed, ModelImprovementOptOut: mip}}
			if pointer {
				return &v
			}
			return v
		}
		v := schema.TtsRequestAsAura2TextVoicecfca101c{Value: schema.TtsRequestAura2TextVoicecfca101c{Text: f.Text, Voice: schema.TtsRequestAura2TextVoicecfca101cVoiceAsThalia{}, Output: output, Speed: speed, ModelImprovementOptOut: mip, Tags: tags}}
		if pointer {
			return &v
		}
		return v
	case "aura-2/es":
		if input != nil {
			v := schema.TtsRequestAsAura2StreamingTextVoiceb9577a7c{Value: schema.TtsRequestAura2StreamingTextVoiceb9577a7c{Text: input, Voice: schema.TtsRequestAura2TextVoice2ee322adVoiceAsAgustina{}, Output: schema.TtsRequestAura1StreamingTextVoiceOutputAsPcm{Value: pcm()}, Speed: speed, ModelImprovementOptOut: mip}}
			if pointer {
				return &v
			}
			return v
		}
		v := schema.TtsRequestAsAura2TextVoice2ee322ad{Value: schema.TtsRequestAura2TextVoice2ee322ad{Text: f.Text, Voice: schema.TtsRequestAura2TextVoice2ee322adVoiceAsAgustina{}, Output: output, Speed: speed, ModelImprovementOptOut: mip, Tags: tags}}
		if pointer {
			return &v
		}
		return v
	case "aura-2/de":
		if input != nil {
			v := schema.TtsRequestAsAura2StreamingTextVoicec96c6915{Value: schema.TtsRequestAura2StreamingTextVoicec96c6915{Text: input, Voice: schema.TtsRequestAura2TextVoice977d4f43VoiceAsAurelia{}, Output: schema.TtsRequestAura1StreamingTextVoiceOutputAsPcm{Value: pcm()}, Speed: speed, ModelImprovementOptOut: mip}}
			if pointer {
				return &v
			}
			return v
		}
		v := schema.TtsRequestAsAura2TextVoice977d4f43{Value: schema.TtsRequestAura2TextVoice977d4f43{Text: f.Text, Voice: schema.TtsRequestAura2TextVoice977d4f43VoiceAsAurelia{}, Output: output, Speed: speed, ModelImprovementOptOut: mip, Tags: tags}}
		if pointer {
			return &v
		}
		return v
	case "aura-2/fr":
		if input != nil {
			v := schema.TtsRequestAsAura2StreamingTextVoice3b7bc554{Value: schema.TtsRequestAura2StreamingTextVoice3b7bc554{Text: input, Voice: schema.TtsRequestAura2TextVoice0e5dc20cVoiceAsAgathe{}, Output: schema.TtsRequestAura1StreamingTextVoiceOutputAsPcm{Value: pcm()}, Speed: speed, ModelImprovementOptOut: mip}}
			if pointer {
				return &v
			}
			return v
		}
		v := schema.TtsRequestAsAura2TextVoice0e5dc20c{Value: schema.TtsRequestAura2TextVoice0e5dc20c{Text: f.Text, Voice: schema.TtsRequestAura2TextVoice0e5dc20cVoiceAsAgathe{}, Output: output, Speed: speed, ModelImprovementOptOut: mip, Tags: tags}}
		if pointer {
			return &v
		}
		return v
	case "aura-2/it":
		if input != nil {
			v := schema.TtsRequestAsAura2StreamingTextVoice141a5c9a{Value: schema.TtsRequestAura2StreamingTextVoice141a5c9a{Text: input, Voice: schema.TtsRequestAura2TextVoice76db964cVoiceAsCesare{}, Output: schema.TtsRequestAura1StreamingTextVoiceOutputAsPcm{Value: pcm()}, Speed: speed, ModelImprovementOptOut: mip}}
			if pointer {
				return &v
			}
			return v
		}
		v := schema.TtsRequestAsAura2TextVoice76db964c{Value: schema.TtsRequestAura2TextVoice76db964c{Text: f.Text, Voice: schema.TtsRequestAura2TextVoice76db964cVoiceAsCesare{}, Output: output, Speed: speed, ModelImprovementOptOut: mip, Tags: tags}}
		if pointer {
			return &v
		}
		return v
	case "aura-2/ja":
		if input != nil {
			v := schema.TtsRequestAsAura2StreamingTextVoicec5cb87b8{Value: schema.TtsRequestAura2StreamingTextVoicec5cb87b8{Text: input, Voice: schema.TtsRequestAura2TextVoicefa928059VoiceAsAma{}, Output: schema.TtsRequestAura1StreamingTextVoiceOutputAsPcm{Value: pcm()}, Speed: speed, ModelImprovementOptOut: mip}}
			if pointer {
				return &v
			}
			return v
		}
		v := schema.TtsRequestAsAura2TextVoicefa928059{Value: schema.TtsRequestAura2TextVoicefa928059{Text: f.Text, Voice: schema.TtsRequestAura2TextVoicefa928059VoiceAsAma{}, Output: output, Speed: speed, ModelImprovementOptOut: mip, Tags: tags}}
		if pointer {
			return &v
		}
		return v
	case "aura-2/nl":
		if input != nil {
			v := schema.TtsRequestAsAura2StreamingTextVoice8f696e76{Value: schema.TtsRequestAura2StreamingTextVoice8f696e76{Text: input, Voice: schema.TtsRequestAura2TextVoiceaf63b261VoiceAsBeatrix{}, Output: schema.TtsRequestAura1StreamingTextVoiceOutputAsPcm{Value: pcm()}, Speed: speed, ModelImprovementOptOut: mip}}
			if pointer {
				return &v
			}
			return v
		}
		v := schema.TtsRequestAsAura2TextVoiceaf63b261{Value: schema.TtsRequestAura2TextVoiceaf63b261{Text: f.Text, Voice: schema.TtsRequestAura2TextVoiceaf63b261VoiceAsBeatrix{}, Output: output, Speed: speed, ModelImprovementOptOut: mip, Tags: tags}}
		if pointer {
			return &v
		}
		return v
	}
	t.Fatal("unknown fixture model")
	return nil
}
func request() schema.TtsRequest {
	return schema.TtsRequestAsAura1TextVoice{Value: schema.TtsRequestAura1TextVoice{Text: "Hello", Voice: schema.TtsRequestAura1TextVoiceVoiceAsAsteria{}, Output: schema.TtsRequestAura1TextVoiceOutputAsPcm{Value: pcm()}}}
}
func live(source runtime.Input[Input]) schema.TtsRequest {
	return schema.TtsRequestAsAura1StreamingTextVoice{Value: schema.TtsRequestAura1StreamingTextVoice{Text: source, Voice: schema.TtsRequestAura1TextVoiceVoiceAsAsteria{}, Output: schema.TtsRequestAura1StreamingTextVoiceOutputAsPcm{Value: pcm()}}}
}

type body struct {
	chunks        [][]byte
	reads, closes atomic.Int32
	failure       error
}

func (b *body) Read(p []byte) (int, error) {
	b.reads.Add(1)
	if len(b.chunks) == 0 {
		if b.failure != nil {
			return 0, b.failure
		}
		return 0, io.EOF
	}
	n := copy(p, b.chunks[0])
	b.chunks[0] = b.chunks[0][n:]
	if len(b.chunks[0]) == 0 {
		b.chunks = b.chunks[1:]
	}
	return n, nil
}
func (b *body) Close() error { b.closes.Add(1); return nil }

type transport struct {
	status   int
	content  string
	body     io.ReadCloser
	requests []*http.Request
	payloads []any
}

func (t *transport) Do(r *http.Request) (*http.Response, error) {
	t.requests = append(t.requests, r)
	var v any
	if err := json.NewDecoder(r.Body).Decode(&v); err != nil {
		return nil, err
	}
	t.payloads = append(t.payloads, v)
	return &http.Response{StatusCode: t.status, Header: http.Header{"content-type": {t.content}}, Body: t.body}, nil
}
func equalJSON(t *testing.T, actual, expected any) {
	t.Helper()
	a, err := json.Marshal(actual)
	if err != nil {
		t.Fatal(err)
	}
	b, err := json.Marshal(expected)
	if err != nil {
		t.Fatal(err)
	}
	var x, y any
	if json.Unmarshal(a, &x) != nil || json.Unmarshal(b, &y) != nil {
		t.Fatal("invalid JSON comparison")
	}
	if !reflect.DeepEqual(x, y) {
		t.Fatalf("got %s; want %s", a, b)
	}
}
func canonical(v out.SynthesisItem) any {
	switch v := v.(type) {
	case out.SynthesisItemAsBytes:
		a := []int{}
		for _, b := range v.Value {
			a = append(a, int(b))
		}
		return a
	case out.SynthesisItemAsClear:
		return map[string]any{"event": "clear", "sequenceId": v.Value.SequenceId}
	case out.SynthesisItemAsDone:
		m := map[string]any{"event": "done", "sequenceId": v.Value.SequenceId}
		if v.Value.TraceId.Present {
			m["traceId"] = v.Value.TraceId.Value
		}
		return m
	}
	panic("unknown output")
}
func collect(t *testing.T, s runtime.Input[out.SynthesisItem]) []any {
	t.Helper()
	result := []any{}
	for {
		v, err := s.Next(context.Background())
		if err == io.EOF {
			return result
		}
		if err != nil {
			t.Fatal(err)
		}
		result = append(result, canonical(v))
	}
}
func wait(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out")
	}
}

type source struct {
	values        []Input
	index         int
	stall         bool
	pulls, closes atomic.Int32
	closed        chan struct{}
	once          sync.Once
	failure       error
}

func newSource(values ...Input) *source { return &source{values: values, closed: make(chan struct{})} }
func (s *source) Next(ctx context.Context) (Input, error) {
	s.pulls.Add(1)
	if s.index < len(s.values) {
		v := s.values[s.index]
		s.index++
		return v, nil
	}
	if s.failure != nil {
		return nil, s.failure
	}
	if s.stall {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-s.closed:
			return nil, io.EOF
		}
	}
	return nil, io.EOF
}
func (s *source) Close() error { s.once.Do(func() { s.closes.Add(1); close(s.closed) }); return nil }

type socket struct {
	incoming chan socketResult
	closed   chan struct{}
	once     sync.Once
	closes   atomic.Int32
	mutex    sync.Mutex
	sent     []map[string]string
	onSend   func(context.Context, map[string]string) error
}

func newSocket() *socket {
	return &socket{incoming: make(chan socketResult, 100), closed: make(chan struct{})}
}
func (s *socket) Send(ctx context.Context, message runtime.WebSocketMessage) error {
	var wire map[string]string
	if err := json.Unmarshal([]byte(message.(runtime.WebSocketText)), &wire); err != nil {
		return err
	}
	s.mutex.Lock()
	s.sent = append(s.sent, wire)
	s.mutex.Unlock()
	if s.onSend != nil {
		return s.onSend(ctx, wire)
	}
	switch wire["type"] {
	case "Speak":
		s.incoming <- socketResult{value: runtime.WebSocketBinary{0, 255}}
	case "Flush":
		s.incoming <- socketResult{value: runtime.WebSocketText(`{"type":"Flushed","sequence_id":1}`)}
	case "Clear":
		s.incoming <- socketResult{value: runtime.WebSocketText(`{"type":"Cleared","sequence_id":2}`)}
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

func TestSharedHTTPFixtures(t *testing.T) {
	for _, f := range loadFixtures(t).HTTP {
		for _, pointer := range []bool{false, true} {
			t.Run(f.Name, func(t *testing.T) {
				b := &body{chunks: [][]byte{{0, 255}, []byte("later")}}
				transport := &transport{status: 200, body: b}
				s, err := Synthesize(context.Background(), build(t, f.Request, nil, pointer), Options{Auth: testAuth, Transport: transport, BaseURL: "https://proxy.test/prefix%20path/?keep=value&sample_rate=12000&container=bad&tag=old&api_key=stale&access_token=stale&speed=9"})
				if err != nil {
					t.Fatal(err)
				}
				defer s.Close()
				if b.reads.Load() != 0 {
					t.Fatal("eager read")
				}
				equalJSON(t, collect(t, s), []any{[]int{0, 255}, []int{108, 97, 116, 101, 114}})
				sent := transport.requests[0]
				if sent.Method != "POST" || sent.URL.EscapedPath() != "/prefix%20path/v1/speak" || sent.Header.Get("authorization") != "Token test-key" {
					t.Fatal(sent)
				}
				expected := f.Query
				expected.Set("keep", "value")
				if !reflect.DeepEqual(sent.URL.Query(), expected) {
					t.Fatal(sent.URL.Query(), expected)
				}
				equalJSON(t, transport.payloads[0], map[string]string{"text": f.Request.Text})
				if b.closes.Load() != 1 {
					t.Fatal(b.closes.Load())
				}
			})
		}
	}
}
func TestSharedSocketFixturesAllModelVariants(t *testing.T) {
	for _, model := range loadFixtures(t).HTTP[:8] {
		for _, pointer := range []bool{false, true} {
			for _, f := range loadFixtures(t).Stream {
				t.Run(model.Name+"/"+f.Name, func(t *testing.T) {
					input := newSource()
					for _, v := range f.Input {
						var text string
						if json.Unmarshal(v, &text) == nil {
							input.values = append(input.values, schema.TtsRequestAura1StreamingTextVoiceTextItemAsString{Value: text})
						} else {
							var command struct{ Command string }
							if err := json.Unmarshal(v, &command); err != nil {
								t.Fatal(err)
							}
							if command.Command == "clear" {
								input.values = append(input.values, schema.TtsRequestAura1StreamingTextVoiceTextItemAsClear{})
							} else {
								input.values = append(input.values, schema.TtsRequestAura1StreamingTextVoiceTextItemAsFlush{})
							}
						}
					}
					socket := newSocket()
					step := 0
					socket.onSend = func(_ context.Context, wire map[string]string) error {
						if step >= len(f.Steps) {
							return errors.New("extra send")
						}
						expected := f.Steps[step]
						step++
						if !reflect.DeepEqual(wire, expected.Send) {
							return errors.New("unexpected send")
						}
						for _, frame := range expected.Receive {
							var data []byte
							if len(frame) > 0 && frame[0] == '[' {
								if err := json.Unmarshal(frame, &data); err != nil {
									return err
								}
								socket.incoming <- socketResult{value: runtime.WebSocketBinary(data)}
							} else {
								socket.incoming <- socketResult{value: runtime.WebSocketText(frame)}
							}
						}
						return nil
					}
					ctx, cancel := context.WithTimeout(context.Background(), time.Second)
					defer cancel()
					s, err := Synthesize(ctx, build(t, model.Request, input, pointer), Options{Auth: testAuth, WebSocket: socket})
					if err != nil {
						t.Fatal(err)
					}
					defer s.Close()
					equalJSON(t, collect(t, s), f.Items)
					if input.closes.Load() != 1 || socket.closes.Load() != 1 {
						t.Fatal("resources leaked")
					}
					socket.mutex.Lock()
					sent := len(socket.sent)
					socket.mutex.Unlock()
					if sent != len(f.Steps) {
						t.Fatal(sent)
					}
				})
			}
		}
	}
}
func TestHTTPFailuresAndEarlyClose(t *testing.T) {
	for _, tc := range []struct {
		status        int
		content, want string
	}{{429, "audio/mpeg", "Deepgram returned HTTP 429"}, {302, "", "Deepgram returned HTTP 302"}, {200, "application/json", "Deepgram returned an unexpected audio content type"}} {
		b := &body{chunks: [][]byte{[]byte("private")}}
		_, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: &transport{status: tc.status, content: tc.content, body: b}})
		if err == nil || err.Error() != tc.want || b.reads.Load() != 0 || b.closes.Load() != 1 {
			t.Fatal(err, b.reads.Load(), b.closes.Load())
		}
	}
	for _, read := range []bool{false, true} {
		b := &body{chunks: [][]byte{{1}, {2}}}
		s, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: &transport{status: 200, body: b}})
		if err != nil {
			t.Fatal(err)
		}
		if read {
			if _, err = s.Next(context.Background()); err != nil {
				t.Fatal(err)
			}
		}
		s.Close()
		if b.closes.Load() != 1 {
			t.Fatal("not closed")
		}
		if _, err = s.Next(context.Background()); err != io.EOF {
			t.Fatal(err)
		}
	}
	original := errors.New("original")
	for _, failure := range []error{nil, original} {
		b := &body{failure: failure}
		s, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: &transport{status: 200, body: b}})
		if err != nil {
			t.Fatal(err)
		}
		_, err = s.Next(context.Background())
		if failure == nil {
			if err == nil || err.Error() != "Deepgram returned no audio bytes" {
				t.Fatal(err)
			}
		} else if err != original {
			t.Fatal(err)
		}
		if _, err = s.Next(context.Background()); err != io.EOF {
			t.Fatal(err)
		}
	}
}
