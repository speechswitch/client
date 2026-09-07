package voice_ai

import (
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
	schema "github.com/speechswitch/client/sdks/go/generated/voice_ai"
	out "github.com/speechswitch/client/sdks/go/generated/voice_ai_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func authenticated() auth.Auth {
	var a auth.Auth
	a.VoiceAi.Present = true
	a.VoiceAi.Value.ApiKey = runtime.Some("fixture")
	return a
}
func request() schema.TtsRequestAsObject1ec54d36 {
	return schema.TtsRequestAsObject1ec54d36{Value: schema.TtsRequestObject1ec54d36{Text: schema.TtsRequestObject1ec54d36TextAsString{Value: "Hello"}}}
}
func equal(t *testing.T, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v; want %#v", got, want)
	}
}
func deadline(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	t.Cleanup(cancel)
	return ctx
}
func await(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out")
	}
}
func collect(ctx context.Context, input runtime.Input[out.SynthesisItem]) ([]out.SynthesisItem, error) {
	var items []out.SynthesisItem
	for {
		item, err := input.Next(ctx)
		if err == io.EOF {
			return items, nil
		}
		if err != nil {
			return items, err
		}
		items = append(items, item)
	}
}

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) Do(r *http.Request) (*http.Response, error) { return f(r) }

type body struct {
	chunks        [][]byte
	failure       error
	closes, reads atomic.Int32
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

type frameResult struct {
	frame runtime.WebSocketMessage
	err   error
}
type socket struct {
	sent                 chan map[string]any
	received             chan frameResult
	closed               chan struct{}
	once                 sync.Once
	closes, sends, reads atomic.Int32
	write                func(context.Context, map[string]any) error
}

func newSocket() *socket {
	return &socket{sent: make(chan map[string]any, 32), received: make(chan frameResult, 32), closed: make(chan struct{})}
}
func (s *socket) Send(ctx context.Context, frame runtime.WebSocketMessage) error {
	s.sends.Add(1)
	var message map[string]any
	if err := json.Unmarshal([]byte(frame.(runtime.WebSocketText)), &message); err != nil {
		return err
	}
	select {
	case s.sent <- message:
	case <-ctx.Done():
		return ctx.Err()
	case <-s.closed:
		return io.EOF
	}
	if s.write != nil {
		return s.write(ctx, message)
	}
	return nil
}
func (s *socket) Receive(ctx context.Context) (runtime.WebSocketMessage, error) {
	s.reads.Add(1)
	select {
	case r := <-s.received:
		return r.frame, r.err
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-s.closed:
		return nil, io.EOF
	}
}
func (s *socket) Close() error { s.closes.Add(1); s.once.Do(func() { close(s.closed) }); return nil }
func (s *socket) push(value any) {
	data, _ := json.Marshal(value)
	s.received <- frameResult{frame: runtime.WebSocketText(data)}
}
func (s *socket) message(t *testing.T) map[string]any {
	t.Helper()
	select {
	case m := <-s.sent:
		return m
	case <-time.After(2 * time.Second):
		t.Fatal("missing socket write")
		return nil
	}
}

type sourceResult struct {
	item inputItem
	err  error
}
type producer struct {
	values        chan sourceResult
	closed        chan struct{}
	once          sync.Once
	reads, closes atomic.Int32
	cleanup       func()
}

func newProducer() *producer {
	return &producer{values: make(chan sourceResult, 32), closed: make(chan struct{})}
}
func (p *producer) Next(ctx context.Context) (inputItem, error) {
	p.reads.Add(1)
	select {
	case v := <-p.values:
		return v.item, v.err
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-p.closed:
		return nil, io.EOF
	}
}
func (p *producer) Close() error {
	p.closes.Add(1)
	p.once.Do(func() { close(p.closed) })
	if p.cleanup != nil {
		p.cleanup()
	}
	return nil
}
func liveRequest(p runtime.Input[inputItem]) schema.TtsRequestAsObject1ec54d36 {
	r := request()
	r.Value.Text = schema.TtsRequestObject1ec54d36TextAsAsyncIterable{Value: p}
	return r
}

type collected struct {
	items []out.SynthesisItem
	err   error
}

func consume(t *testing.T, input runtime.Input[out.SynthesisItem]) <-chan collected {
	t.Helper()
	ch := make(chan collected, 1)
	ctx := deadline(t)
	go func() { items, err := collect(ctx, input); ch <- collected{items, err} }()
	return ch
}
func finishContext(s *socket, id string) {
	s.push(map[string]any{"context_id": id, "audio": "AP+A"})
	s.push(map[string]any{"context_id": id, "is_last": true})
	s.push(map[string]any{"context_id": id, "context_closed": true})
}

type fixture struct {
	Audio    []byte
	Requests []struct {
		Name, Protocol, Path string
		Body                 map[string]any
	}
	InvalidFrames []struct{ Wire, Error string }
}

func loadFixture(t *testing.T) fixture {
	t.Helper()
	data, err := os.ReadFile("../../../fixtures/voice_ai.json")
	if err != nil {
		t.Fatal(err)
	}
	var f fixture
	if err := json.Unmarshal(data, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

func fixtureRequests() []schema.TtsRequest {
	var spanish schema.TtsRequestObject1ec54d36Language = schema.TtsRequestObject1ec54d36LanguageAsEs{}
	var high schema.TtsRequestObject1ec54d36Output = schema.TtsRequestObject1ec54d36OutputAsMp39b9ac8e8{Value: schema.TtsRequestObject1ec54d36OutputMp39b9ac8e8{BitRateBps: schema.TtsRequestObject1ec54d36OutputMp39b9ac8e8BitRateBpsAsNumber192000{}}}
	var opus schema.TtsRequestObject1ec54d36Output = schema.TtsRequestObject1ec54d36OutputAsOpus{Value: schema.TtsRequestObject1ec54d36OutputOpus{BitRateBps: schema.TtsRequestObject1ec54d36OutputMp39b9ac8e8BitRateBpsAsNumber96000{}}}
	var rate schema.TtsRequestObject1ec54d36OutputPcmSampleRateHz = schema.TtsRequestObject1ec54d36OutputPcmSampleRateHzAsNumber48000{}
	var wavRate schema.TtsRequestObject1ec54d36OutputWavSampleRateHz = schema.TtsRequestObject1ec54d36OutputWavSampleRateHzAsNumber22050{}
	var wav schema.TtsRequestObject1ec54d36Output = schema.TtsRequestObject1ec54d36OutputAsWav{Value: schema.TtsRequestObject1ec54d36OutputWav{SampleRateHz: runtime.Some(wavRate)}}
	text := schema.TtsRequestObject1ec54d36TextAsString{Value: "Hello"}
	french := schema.TtsRequestObject1ec54d36TextAsString{Value: "Bonjour"}
	return []schema.TtsRequest{
		&schema.TtsRequestAsObject1ec54d36{Value: schema.TtsRequestObject1ec54d36{Text: &schema.TtsRequestObject1ec54d36TextAsString{Value: "Hola 😀"}, Model: runtime.Some(schema.TtsRequestObject1ec54d36Model{}), Language: runtime.Some(spanish), Voice: runtime.Some("owned-voice"), PronunciationDictionaries: runtime.Some([]schema.TtsRequestObject1ec54d36PronunciationDictionariesItem{{Id: "dictionary", Version: runtime.Some(2.0)}}), Temperature: runtime.Some(0.0), TopP: runtime.Some(0.0)}},
		&schema.TtsRequestAsObject4870017d{Value: schema.TtsRequestObject4870017d{Text: text, Output: &schema.TtsRequestObject4870017dOutputAsPcm{}}},
		&schema.TtsRequestAsObject3dd4eb5b{Value: schema.TtsRequestObject3dd4eb5b{Text: text, Model: schema.TtsRequestObject3dd4eb5bModelAsVoiceaiTtsV120260210{}, Output: runtime.Some(high)}},
		&schema.TtsRequestAsObject50ac9774{Value: schema.TtsRequestObject50ac9774{Text: text, Model: schema.TtsRequestObject3dd4eb5bModelAsVoiceaiTtsV1Latest{}, Output: &schema.TtsRequestObject4870017dOutputAsObject{Value: schema.TtsRequestObject1ec54d36OutputObject{Format: schema.TtsRequestObject1ec54d36OutputObjectFormatAsMulaw{}}}}},
		&schema.TtsRequestAsObjectdd71553d{Value: schema.TtsRequestObjectdd71553d{Text: text, Model: schema.TtsRequestObjectdd71553dModelAsVoiceaiTtsLiteV120260415{}, Output: runtime.Some(opus), PronunciationDictionaries: runtime.Some([]schema.TtsRequestObject1ec54d36PronunciationDictionariesItem{{Id: "latest"}})}},
		&schema.TtsRequestAsObjectdbc284be{Value: schema.TtsRequestObjectdbc284be{Text: text, Model: schema.TtsRequestObjectdd71553dModelAsVoiceaiTtsLiteV1Latest{}, Output: schema.TtsRequestObject4870017dOutputAsPcm{Value: schema.TtsRequestObject1ec54d36OutputPcm{SampleRateHz: runtime.Some(rate), SampleEncoding: runtime.Some(schema.TtsRequestObject1ec54d36OutputPcmSampleEncoding{}), ByteOrder: runtime.Some(schema.TtsRequestObject1ec54d36OutputPcmByteOrder{}), ChannelCount: runtime.Some(schema.TtsRequestObject1ec54d36OutputPcmChannelCount{})}}}},
		&schema.TtsRequestAsObject239f4158{Value: schema.TtsRequestObject239f4158{Text: french, Model: schema.TtsRequestObject239f4158ModelAsVoiceaiTtsMultilingualV120260210{}, Language: schema.TtsRequestObject239f4158LanguageAsFr{}, Output: runtime.Some(wav)}},
		&schema.TtsRequestAsObjectcb749376{Value: schema.TtsRequestObjectcb749376{Text: french, Model: schema.TtsRequestObject239f4158ModelAsVoiceaiTtsMultilingualV1Latest{}, Language: schema.TtsRequestObject239f4158LanguageAsFr{}, Output: schema.TtsRequestObject4870017dOutputAsObject{Value: schema.TtsRequestObject1ec54d36OutputObject{Format: schema.TtsRequestObject1ec54d36OutputObjectFormatAsAlaw{}}}}},
		&schema.TtsRequestAsTextVoice{Value: schema.TtsRequestTextVoice{Text: "Hello", Voice: "existing-clone", Output: runtime.Some(schema.TtsRequestTextVoiceOutput{Format: schema.TtsRequestTextVoiceOutputFormatAsPcm{}}), Temperature: runtime.Some(.8), TopP: runtime.Some(.4)}},
	}
}

func TestSharedRequests(t *testing.T) {
	f := loadFixture(t)
	requests := fixtureRequests()
	equal(t, len(requests), len(f.Requests))
	for i, c := range f.Requests {
		t.Run(c.Name, func(t *testing.T) {
			sock := newSocket()
			b := &body{chunks: [][]byte{f.Audio}}
			o := Options{Auth: authenticated(), Protocol: c.Protocol}
			if c.Protocol == "websocket" {
				o.WebSocket = sock
			} else {
				o.Transport = transportFunc(func(r *http.Request) (*http.Response, error) {
					equal(t, r.URL.Path, c.Path)
					equal(t, r.Method, "POST")
					equal(t, r.Header.Get("Authorization"), "Bearer fixture")
					var wire map[string]any
					if err := json.NewDecoder(r.Body).Decode(&wire); err != nil {
						return nil, err
					}
					equal(t, wire, c.Body)
					return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"audio/mpeg"}}, Body: b}, nil
				})
			}
			input, err := Synthesize(deadline(t), requests[i], o)
			if err != nil {
				t.Fatal(err)
			}
			defer input.Close()
			ch := consume(t, input)
			var expected []out.SynthesisItem
			if c.Protocol == "websocket" {
				first := sock.message(t)
				id := first["context_id"].(string)
				delete(first, "context_id")
				equal(t, first, c.Body)
				equal(t, sock.message(t), map[string]any{"context_id": id, "text": "", "flush": true, "auto_close": true})
				finishContext(sock, id)
				expected = []out.SynthesisItem{out.SynthesisItemAsOrdered{Value: out.VoiceAiEnvelope{Audio: f.Audio, CorrelationId: id}}, out.SynthesisItemAsFlush{Value: out.FlushEvent{CorrelationId: id}}, out.SynthesisItemAsDone{}}
			} else {
				expected = []out.SynthesisItem{out.SynthesisItemAsBytes{Value: f.Audio}, out.SynthesisItemAsDone{}}
			}
			got := <-ch
			if got.err != nil {
				t.Fatal(got.err)
			}
			equal(t, got.items, expected)
			if c.Protocol == "websocket" {
				equal(t, sock.closes.Load(), int32(1))
			} else {
				equal(t, b.closes.Load(), int32(1))
			}
		})
	}
}

func TestSharedInvalidFramesAndSanitizedErrors(t *testing.T) {
	for _, c := range loadFixture(t).InvalidFrames {
		t.Run(c.Wire, func(t *testing.T) {
			_, err := decode(runtime.WebSocketText(c.Wire), 4096)
			if err == nil {
				t.Fatal("accepted invalid frame")
			}
			equal(t, err.Error(), c.Error)
		})
	}
	for _, raw := range []string{`{"audio":"AA==","context_id":"\ud800"}`, string([]byte{'{', '"', 255, '"', ':', '1', '}'})} {
		_, err := decode(runtime.WebSocketText(raw), 4096)
		equal(t, err.Error(), "Invalid Voice.ai JSON")
	}
	_, err := decode(runtime.WebSocketBinary{0}, 4096)
	equal(t, err.Error(), "Voice.ai expected a JSON text frame")
	_, err = decode(runtime.WebSocketText(`{"audio":"AA==","context_id":"x"}`), 3)
	equal(t, err.Error(), "Voice.ai message exceeds MaxMessageBytes")
	_, err = decode(runtime.WebSocketText(`{"error":"SECRET","context_id":"ctx"}`), 4096)
	equal(t, err, &Error{ContextID: runtime.Some("ctx")})
	equal(t, err.Error(), "Voice.ai reported a synthesis error")
	_, err = decode(runtime.WebSocketText(`{"error":"SECRET","context_id":null}`), 4096)
	equal(t, err, &Error{})
}

func TestHTTPFailuresReleaseUnreadBodies(t *testing.T) {
	failure := errors.New("read failure")
	for _, c := range []struct {
		name    string
		status  int
		media   string
		chunks  [][]byte
		failure error
		want    error
		reads   int32
	}{
		{"status", 401, "application/json", nil, nil, &Error{Status: runtime.Some(401)}, 0},
		{"content type", 200, "application/json", nil, nil, errors.New("Voice.ai returned an unexpected audio content type"), 0},
		{"empty", 200, "audio/wav", nil, nil, errors.New("Voice.ai returned no audio bytes"), 1},
		{"read failure", 200, "audio/wav", nil, failure, failure, 1},
	} {
		t.Run(c.name, func(t *testing.T) {
			b := &body{chunks: c.chunks, failure: c.failure}
			input, err := Synthesize(deadline(t), request(), Options{Auth: authenticated(), Transport: transportFunc(func(*http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: c.status, Header: http.Header{"content-type": {c.media}}, Body: b}, nil
			})})
			if err != nil {
				t.Fatal(err)
			}
			defer input.Close()
			items, err := collect(deadline(t), input)
			equal(t, items, []out.SynthesisItem(nil))
			equal(t, err.Error(), c.want.Error())
			if c.failure != nil && err != c.failure {
				t.Fatal("lost error identity")
			}
			equal(t, b.reads.Load(), c.reads)
			equal(t, b.closes.Load(), int32(1))
		})
	}
}
