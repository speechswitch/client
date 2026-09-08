package google

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/google"
	"github.com/speechswitch/client/sdks/go/runtime"
)

var testAuth = auth.Auth{Google: runtime.Some(auth.AuthGoogle{ApiKey: runtime.Some("key"), AccessToken: runtime.Some("token"), QuotaProject: runtime.Some("quota")})}
var kore schema.TtsRequestChirp3HdTextVoiceffbf1cc1Voice = schema.TtsRequestChirp3HdTextVoiceffbf1cc1VoiceAsKore{}
var puck schema.TtsRequestChirp3HdTextVoiceffbf1cc1Voice = schema.TtsRequestChirp3HdTextVoiceffbf1cc1VoiceAsPuck{}
var enUS schema.TtsRequestChirp3HdTextVoiceffbf1cc1Language = schema.TtsRequestChirp3HdTextVoiceffbf1cc1LanguageAsEnUS{}
var bnIN schema.TtsRequestChirp3HdTextVoice3fb16684Language = schema.TtsRequestChirp3HdTextVoice3fb16684LanguageAsBnIN{}
var bgBG schema.TtsRequestChirp3HdTextVoice0df9de22Language = schema.TtsRequestChirp3HdTextVoice0df9de22LanguageAsBgBG{}
var cloneBnIN schema.TtsRequestChirp3InstantCustomVoiceTextVoice16ed8d8aLanguage = schema.TtsRequestChirp3InstantCustomVoiceTextVoice16ed8d8aLanguageAsBnIN{}
var flash schema.TtsRequestTextVoiceModel = schema.TtsRequestTextVoiceModelAsGemini25FlashTts{}
var flashSpeakers schema.TtsRequestTextModel = schema.TtsRequestTextModelAsGemini25FlashTts{}
var pcm schema.TtsRequestChirp3Hd174648a4Output = schema.TtsRequestChirp3Hd174648a4OutputAsPcm{}
var wav schema.TtsRequestChirp3HdTextVoiceffbf1cc1Output = schema.TtsRequestChirp3HdTextVoiceffbf1cc1OutputAsWav{}
var cloneWav schema.TtsRequestChirp3InstantCustomVoiceTextVoiced9d056deOutput = schema.TtsRequestChirp3InstantCustomVoiceTextVoiced9d056deOutputAsWav{}
var speakers = []schema.TtsRequestTextSpeakersItem{{Alias: "Sam", Voice: kore}, {Alias: "Bob", Voice: puck}}

func testRequest() schema.TtsRequestObjecta65cbd8a {
	return schema.TtsRequestObjecta65cbd8a{Model: flash, Language: "en-US", Voice: kore, Text: schema.TtsRequestChirp3Hd174648a4TextAsString{Value: "hello"}, Output: pcm}
}

type testSource[T any] struct {
	values          []T
	pulls, closes   atomic.Int32
	pending, closed chan struct{}
	closeGate       <-chan struct{}
	failure         error
	stall           bool
}

func (s *testSource[T]) Next(ctx context.Context) (T, error) {
	var zero T
	index := int(s.pulls.Add(1)) - 1
	if index < len(s.values) {
		return s.values[index], nil
	}
	if s.pending != nil {
		close(s.pending)
	}
	if s.stall {
		<-ctx.Done()
		return zero, ctx.Err()
	}
	if s.failure != nil {
		return zero, s.failure
	}
	return zero, io.EOF
}
func (s *testSource[T]) Close() error {
	s.closes.Add(1)
	if s.closed != nil {
		close(s.closed)
	}
	if s.closeGate != nil {
		<-s.closeGate
	}
	return nil
}

type testGRPC struct {
	mu           sync.Mutex
	sent         [][]byte
	output       chan grpcResult
	closed       chan struct{}
	closes, ends atomic.Int32
	onSend       func(context.Context, int, []byte) error
}

func newGRPC() *testGRPC {
	return &testGRPC{output: make(chan grpcResult, 16), closed: make(chan struct{})}
}
func (s *testGRPC) Send(ctx context.Context, data []byte) error {
	s.mu.Lock()
	s.sent = append(s.sent, bytes.Clone(data))
	count := len(s.sent)
	s.mu.Unlock()
	if s.onSend != nil {
		return s.onSend(ctx, count, data)
	}
	if count > 1 {
		s.output <- grpcResult{data: []byte{10, 5, 'a', 'u', 'd', 'i', 'o'}}
	}
	return nil
}
func (s *testGRPC) End(context.Context) error {
	s.ends.Add(1)
	s.output <- grpcResult{err: io.EOF}
	return nil
}
func (s *testGRPC) Receive(ctx context.Context) ([]byte, error) {
	select {
	case item := <-s.output:
		return item.data, item.err
	case <-s.closed:
		return nil, io.EOF
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}
func (s *testGRPC) Close() error {
	if s.closes.Add(1) == 1 {
		close(s.closed)
	}
	return nil
}
func (s *testGRPC) messages() [][]byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([][]byte{}, s.sent...)
}

type testTransport func(*http.Request) (*http.Response, error)

func (f testTransport) Do(r *http.Request) (*http.Response, error) { return f(r) }

type testBody struct {
	io.Reader
	closes atomic.Int32
}

func (b *testBody) Close() error {
	b.closes.Add(1)
	if closer, ok := b.Reader.(io.Closer); ok {
		return closer.Close()
	}
	return nil
}

func drain(t *testing.T, stream runtime.Input[[]byte]) [][]byte {
	t.Helper()
	defer stream.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var chunks [][]byte
	for {
		data, err := stream.Next(ctx)
		if err == io.EOF {
			return chunks
		}
		if err != nil {
			t.Fatal(err)
		}
		chunks = append(chunks, data)
	}
}

func TestAllCanonicalRequestBranches(t *testing.T) {
	text := func() schema.TtsRequestChirp3Hd174648a4Text {
		return schema.TtsRequestChirp3Hd174648a4TextAsAsyncIterable{Value: &testSource[string]{values: []string{"hello"}}}
	}
	requests := []schema.TtsRequest{
		schema.TtsRequestAsChirp3HdTextVoiceffbf1cc1{Value: schema.TtsRequestChirp3HdTextVoiceffbf1cc1{Language: enUS, Voice: kore, Text: "hello", Output: wav}},
		schema.TtsRequestAsChirp3Hd174648a4{Value: schema.TtsRequestChirp3Hd174648a4{Language: enUS, Voice: kore, Text: text(), Output: pcm}},
		schema.TtsRequestAsChirp3HdTextVoice3fb16684{Value: schema.TtsRequestChirp3HdTextVoice3fb16684{Language: bnIN, Voice: kore, Text: "hello", Output: wav}},
		schema.TtsRequestAsChirp3Hd140fecab{Value: schema.TtsRequestChirp3Hd140fecab{Language: bnIN, Voice: kore, Text: text(), Output: pcm}},
		schema.TtsRequestAsChirp3HdTextVoice0df9de22{Value: schema.TtsRequestChirp3HdTextVoice0df9de22{Language: bgBG, Voice: kore, Text: "hello", Output: wav}},
		schema.TtsRequestAsChirp3Hd69e36cb2{Value: schema.TtsRequestChirp3Hd69e36cb2{Language: bgBG, Voice: kore, Text: text(), Output: pcm}},
		schema.TtsRequestAsChirp3InstantCustomVoiceTextVoiced9d056de{Value: schema.TtsRequestChirp3InstantCustomVoiceTextVoiced9d056de{Language: enUS, Voice: "existing-key", Text: "hello", Output: cloneWav}},
		schema.TtsRequestAsChirp3InstantCustomVoice093d5f29{Value: schema.TtsRequestChirp3InstantCustomVoice093d5f29{Language: enUS, Voice: "existing-key", Text: text(), Output: pcm}},
		schema.TtsRequestAsChirp3InstantCustomVoiceTextVoice16ed8d8a{Value: schema.TtsRequestChirp3InstantCustomVoiceTextVoice16ed8d8a{Language: cloneBnIN, Voice: "existing-key", Text: "hello", Output: cloneWav}},
		schema.TtsRequestAsChirp3InstantCustomVoicebd483c3d{Value: schema.TtsRequestChirp3InstantCustomVoicebd483c3d{Language: cloneBnIN, Voice: "existing-key", Text: text(), Output: pcm}},
		schema.TtsRequestAsText{Value: schema.TtsRequestText{Model: flashSpeakers, Language: "en-US", Speakers: speakers, Text: "Sam: hello", Output: wav}},
		schema.TtsRequestAsObject551db176{Value: schema.TtsRequestObject551db176{Model: flashSpeakers, Language: "en-US", Speakers: speakers, Text: text(), Output: pcm}},
		schema.TtsRequestAsTextVoice{Value: schema.TtsRequestTextVoice{Model: flash, Language: "en-US", Voice: kore, Text: "hello", Output: wav}},
		schema.TtsRequestAsObjecta65cbd8a{Value: testRequest()},
		schema.TtsRequestAsTurns5ba0ad7a{Value: schema.TtsRequestTurns5ba0ad7a{Model: flashSpeakers, Language: "en-US", Speakers: speakers, Turns: []Turn{{Speaker: "Sam", Text: "hello"}}, Output: wav}},
		schema.TtsRequestAsTurns9a76562f{Value: schema.TtsRequestTurns9a76562f{Model: flashSpeakers, Language: "en-US", Speakers: speakers, Turns: []Turn{{Speaker: "Sam", Text: "hello"}}, Output: pcm}},
		schema.TtsRequestAsStreamingTurns{Value: schema.TtsRequestStreamingTurns{Model: flashSpeakers, Language: "en-US", Speakers: speakers, Turns: &testSource[Turn]{values: []Turn{{Speaker: "Sam", Text: "hello"}}}, Output: pcm}},
	}
	for _, request := range requests {
		t.Run(reflect.TypeOf(request).Name(), func(t *testing.T) {
			grpc := newGRPC()
			body := &testBody{Reader: bytes.NewBufferString(`{"audioContent":"YXVkaW8="}`)}
			stream, err := Synthesize(context.Background(), request, Options{Auth: testAuth, GRPC: grpc, Transport: testTransport(func(*http.Request) (*http.Response, error) { return &http.Response{StatusCode: 200, Body: body}, nil })})
			if err != nil {
				t.Fatal(err)
			}
			if got := drain(t, stream); !reflect.DeepEqual(got, [][]byte{[]byte("audio")}) {
				t.Fatalf("audio: %q", got)
			}
			if body.closes.Load()+grpc.closes.Load() != 1 {
				t.Fatalf("ownership: HTTP=%d gRPC=%d", body.closes.Load(), grpc.closes.Load())
			}
		})
	}
}

func TestStreamingFirstPromptAndStalledCleanup(t *testing.T) {
	gate := make(chan struct{})
	defer close(gate)
	source := &testSource[string]{values: []string{"one", "two"}, stall: true, pending: make(chan struct{}), closed: make(chan struct{}), closeGate: gate}
	r := testRequest()
	r.Text = schema.TtsRequestChirp3Hd174648a4TextAsAsyncIterable{Value: source}
	r.Instructions = runtime.Some("warm")
	grpc := newGRPC()
	stream, err := Synthesize(context.Background(), schema.TtsRequestAsObjecta65cbd8a{Value: r}, Options{Auth: testAuth, GRPC: grpc})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for range 2 {
		if data, err := stream.Next(ctx); err != nil || string(data) != "audio" {
			t.Fatalf("audio: %s %v", data, err)
		}
	}
	select {
	case <-source.pending:
	case <-ctx.Done():
		t.Fatal("input never stalled")
	}
	if err := stream.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-source.closed:
	case <-ctx.Done():
		t.Fatal("input cleanup missing")
	}
	want := [][]byte{{18, 11, 10, 3, 'o', 'n', 'e', 50, 4, 'w', 'a', 'r', 'm'}, {18, 5, 10, 3, 't', 'w', 'o'}}
	if got := grpc.messages()[1:]; !reflect.DeepEqual(got, want) {
		t.Fatalf("input frames: %x want %x", got, want)
	}
	if grpc.closes.Load() != 1 || grpc.ends.Load() != 0 || source.closes.Load() != 1 {
		t.Fatalf("lifecycle: %d %d %d", grpc.closes.Load(), grpc.ends.Load(), source.closes.Load())
	}
}

func TestSendEOFDrainsFinalStatus(t *testing.T) {
	for _, failure := range []error{&runtime.GRPCError{StatusCode: 16, Message: "denied"}, io.EOF} {
		grpc := newGRPC()
		grpc.onSend = func(context.Context, int, []byte) error { grpc.output <- grpcResult{err: failure}; return io.EOF }
		stream, err := Synthesize(context.Background(), schema.TtsRequestAsObjecta65cbd8a{Value: testRequest()}, Options{Auth: testAuth, GRPC: grpc})
		if err != nil {
			t.Fatal(err)
		}
		_, err = stream.Next(context.Background())
		stream.Close()
		if failure == io.EOF {
			if err == nil || err.Error() != "Google completed before the input stream ended" {
				t.Fatalf("premature success: %v", err)
			}
		} else if err != failure {
			t.Fatalf("lost RPC error: %v", err)
		}
		if grpc.closes.Load() != 1 {
			t.Fatalf("close: %d", grpc.closes.Load())
		}
	}
}

func TestOriginalProducerError(t *testing.T) {
	failure := errors.New("original producer failure")
	source := &testSource[string]{failure: failure, closed: make(chan struct{})}
	r := testRequest()
	r.Text = schema.TtsRequestChirp3Hd174648a4TextAsAsyncIterable{Value: source}
	grpc := newGRPC()
	stream, err := Synthesize(context.Background(), schema.TtsRequestAsObjecta65cbd8a{Value: r}, Options{Auth: testAuth, GRPC: grpc})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	if _, err := stream.Next(context.Background()); err != failure {
		t.Fatalf("producer error: %v", err)
	}
	select {
	case <-source.closed:
	case <-time.After(5 * time.Second):
		t.Fatal("source leaked")
	}
}
