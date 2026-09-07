package microsoft

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/microsoft"
	out "github.com/speechswitch/client/sdks/go/generated/microsoft_output"
	"github.com/speechswitch/client/sdks/go/runtime"
	"io"
	"net/http"
	"os"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

var testAuth = auth.Auth{Microsoft: runtime.Some(auth.AuthMicrosoft{ApiKey: runtime.Some("test-key"), Region: runtime.Some("eastus")})}

func equal(t *testing.T, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v; want %#v", got, want)
	}
}
func errorText(t *testing.T, err error, want string) {
	t.Helper()
	if err == nil || err.Error() != want {
		t.Fatalf("got %v; want %q", err, want)
	}
}
func wait(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(3 * time.Second):
		t.Fatal("timed out")
	}
}
func request() schema.TtsRequestAsTextVoice4ff226b4 {
	return schema.TtsRequestAsTextVoice4ff226b4{Value: schema.TtsRequestTextVoice4ff226b4{Text: "Hi", Voice: "en-US-AvaNeural"}}
}
func streaming(input runtime.Input[string]) schema.TtsRequestAsStreamingTextVoicee86a65c0 {
	return schema.TtsRequestAsStreamingTextVoicee86a65c0{Value: schema.TtsRequestStreamingTextVoicee86a65c0{Text: input, Voice: "en-US-AvaNeural"}}
}

type source struct {
	values          []string
	stall           bool
	failure         error
	reads, closes   atomic.Int32
	waiting, closed chan struct{}
	once            sync.Once
}

func newSource(values ...string) *source {
	return &source{values: values, waiting: make(chan struct{}), closed: make(chan struct{})}
}
func (s *source) Next(ctx context.Context) (string, error) {
	s.reads.Add(1)
	if len(s.values) > 0 {
		v := s.values[0]
		s.values = s.values[1:]
		return v, nil
	}
	if s.failure != nil {
		return "", s.failure
	}
	if s.stall {
		s.once.Do(func() { close(s.waiting) })
		<-ctx.Done()
		return "", ctx.Err()
	}
	return "", io.EOF
}
func (s *source) Close() error {
	if s.closes.Add(1) == 1 {
		close(s.closed)
	}
	return nil
}

type transport func(*http.Request) (*http.Response, error)

func (f transport) Do(r *http.Request) (*http.Response, error) { return f(r) }

type body struct {
	io.Reader
	closes  atomic.Int32
	closeFn func() error
}

func (b *body) Close() error {
	b.closes.Add(1)
	if b.closeFn != nil {
		return b.closeFn()
	}
	return nil
}
func fixture(t *testing.T) map[string]json.RawMessage {
	t.Helper()
	data, err := os.ReadFile("../../../fixtures/microsoft.json")
	if err != nil {
		t.Fatal(err)
	}
	var v map[string]json.RawMessage
	if err = json.Unmarshal(data, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

type sentFrame struct{ path, id, body string }

func sent(message runtime.WebSocketMessage) (sentFrame, error) {
	v, ok := message.(runtime.WebSocketText)
	if !ok {
		return sentFrame{}, errors.New("expected outgoing text")
	}
	head, body, ok := strings.Cut(string(v), "\r\n\r\n")
	if !ok {
		return sentFrame{}, errors.New("missing outgoing separator")
	}
	fields := map[string]string{}
	for _, line := range strings.Split(head, "\r\n") {
		name, value, ok := strings.Cut(line, ": ")
		if !ok {
			return sentFrame{}, errors.New("invalid outgoing header")
		}
		fields[name] = value
	}
	return sentFrame{fields["Path"], fields["X-RequestId"], body}, nil
}
func textFrame(path, id, body string) runtime.WebSocketText {
	return runtime.WebSocketText("Path: " + path + "\r\nX-RequestId: " + id + "\r\n\r\n" + body)
}
func audioFrame(id, stream string) runtime.WebSocketBinary {
	header := []byte("Path: audio\r\nX-RequestId: " + id + "\r\nX-StreamId: " + stream + "\r\n")
	data := make([]byte, 2)
	binary.BigEndian.PutUint16(data, uint16(len(header)))
	return append(append(data, header...), 0, 255, 128)
}

type socket struct {
	mutex    sync.Mutex
	sent     []sentFrame
	incoming chan socketResult
	closed   chan struct{}
	closes   atomic.Int32
	hook     func(context.Context, sentFrame) error
}

func newSocket() *socket {
	return &socket{incoming: make(chan socketResult, 32), closed: make(chan struct{})}
}
func (s *socket) Send(ctx context.Context, message runtime.WebSocketMessage) error {
	f, err := sent(message)
	if err != nil {
		return err
	}
	s.mutex.Lock()
	s.sent = append(s.sent, f)
	s.mutex.Unlock()
	if s.hook != nil {
		return s.hook(ctx, f)
	}
	return nil
}
func (s *socket) Receive(ctx context.Context) (runtime.WebSocketMessage, error) {
	select {
	case r := <-s.incoming:
		return r.message, r.err
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-s.closed:
		return nil, io.EOF
	}
}
func (s *socket) Close() error {
	if s.closes.Add(1) == 1 {
		close(s.closed)
	}
	return nil
}
func (s *socket) frames() []sentFrame {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	return append([]sentFrame{}, s.sent...)
}
func (s *socket) reply(message runtime.WebSocketMessage) {
	s.incoming <- socketResult{message: message}
}
func (s *socket) auto(metadata string) {
	responded := false
	s.hook = func(_ context.Context, f sentFrame) error {
		if (f.path == "ssml" || f.path == "text.piece") && !responded {
			responded = true
			s.reply(textFrame("response", f.id, `{"audio":{"streamId":"stream"}}`))
			if metadata != "" {
				s.reply(textFrame("audio.metadata", f.id, metadata))
			}
			s.reply(audioFrame(f.id, "stream"))
		}
		if f.path == "ssml" || f.path == "text.end" {
			s.reply(textFrame("turn.end", f.id, `{}`))
		}
		return nil
	}
}

func TestHTTPSharedSSMLAndEarlyBytes(t *testing.T) {
	f := fixture(t)
	var expected string
	json.Unmarshal(f["ssml"], &expected)
	r := request()
	r.Value.Text = `A & <B> "C"`
	r.Value.Speed = runtime.Some(1.5)
	r.Value.PitchSemitones = runtime.Some(-2.0)
	r.Value.VolumeScale = runtime.Some(0.0)
	r.Value.Emotion = runtime.Some(`calm"`)
	reader, writer := io.Pipe()
	defer writer.Close()
	b := &body{Reader: reader, closeFn: reader.Close}
	stream, err := Synthesize(context.Background(), r, Options{Auth: testAuth, BaseURL: "https://proxy.invalid/a%2Fb/?tenant=one", DeploymentID: runtime.Some("custom/1"), Transport: transport(func(r *http.Request) (*http.Response, error) {
		equal(t, r.URL.String(), "https://proxy.invalid/a%2Fb/cognitiveservices/v1?deploymentId=custom%2F1&tenant=one")
		equal(t, r.Method, "POST")
		data, _ := io.ReadAll(r.Body)
		equal(t, string(data), expected)
		equal(t, r.Header, http.Header{"Ocp-Apim-Subscription-Key": []string{"test-key"}, "Content-Type": []string{"application/ssml+xml"}, "X-Microsoft-Outputformat": []string{"raw-24khz-16bit-mono-pcm"}, "User-Agent": []string{"speechswitch"}})
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: b}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	go func() { writer.Write([]byte{1}) }()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	item, err := stream.Next(ctx)
	if err != nil {
		t.Fatal(err)
	}
	equal(t, item, out.SynthesisItemAsBytes{Value: []byte{1}})
	stream.Close()
	equal(t, b.closes.Load(), int32(1))
}

func TestStreamingControlsTimelineAndEarlyClose(t *testing.T) {
	f := fixture(t)
	socket := newSocket()
	socket.auto(string(f["metadata"]))
	input := newSource("Hi")
	input.stall = true
	r := streaming(input)
	r.Value.LexiconUrl = runtime.Some("https://example.com/lexicon")
	r.Value.PreferredLanguages = runtime.Some([]string{"en-US", "zh-CN"})
	r.Value.TimestampGranularity = runtime.Some(schema.TtsRequestStreamingTextVoicee86a65c0TimestampGranularity(schema.TtsRequestStreamingTextVoicee86a65c0TimestampGranularityAsArray{Value: []schema.TtsRequestStreamingTextVoicee86a65c0TimestampGranularityArrayItem{schema.TtsRequestStreamingTextVoicee86a65c0TimestampGranularityArrayItemAsWord{}, schema.TtsRequestStreamingTextVoicee86a65c0TimestampGranularityArrayItemAsSentence{}}}))
	stream, err := Synthesize(context.Background(), r, Options{WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	marks, err := stream.Next(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	audio, err := stream.Next(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	frames := socket.frames()
	id := frames[0].id
	equal(t, marks, out.SynthesisItemAsTimeline{Value: out.MicrosoftEnvelope{CorrelationId: id, StreamId: runtime.Some("stream"), DurationMs: runtime.Some(10.0), Timestamps: []out.MicrosoftTimestamp{
		{Kind: out.MicrosoftTimestampKindAsWord{}, Value: "😀 hi", StartTimeMs: 1, EndTimeMs: runtime.Some(3.0), BoundaryType: runtime.Some("Word")},
		{Kind: out.MicrosoftTimestampKindAsSentence{}, Value: "😀 hi.", StartTimeMs: 0, EndTimeMs: runtime.Some(10.0)},
	}}})
	equal(t, audio, out.SynthesisItemAsTimeline{Value: out.MicrosoftEnvelope{CorrelationId: id, StreamId: runtime.Some("stream"), Timestamps: []out.MicrosoftTimestamp{}, Audio: runtime.Some([]byte{0, 255, 128})}})
	var packet struct {
		Synthesis struct{ Input map[string]any }
	}
	json.Unmarshal([]byte(frames[1].body), &packet)
	var expected map[string]any
	json.Unmarshal(f["streamingInput"], &expected)
	equal(t, packet.Synthesis.Input, expected)
	stream.Close()
	wait(t, input.closed)
	equal(t, socket.closes.Load(), int32(1))
	frames = socket.frames()
	equal(t, frames[len(frames)-1], sentFrame{"synthesis.control", id, `{"action":"stop"}`})
}

func TestRawSSMLAllMetadataAndDone(t *testing.T) {
	socket := newSocket()
	socket.auto(string(fixture(t)["metadata"]))
	r := schema.TtsRequestAsText686f0afb{Value: schema.TtsRequestText686f0afb{Text: "<speak/>", TimestampGranularity: schema.TtsRequestText686f0afbTimestampGranularityAsArray{Value: []schema.TtsRequestText686f0afbTimestampGranularityArrayItem{schema.TtsRequestText686f0afbTimestampGranularityArrayItemAsWord{}, schema.TtsRequestText686f0afbTimestampGranularityArrayItemAsSentence{}, schema.TtsRequestText686f0afbTimestampGranularityArrayItemAsSsml{}, schema.TtsRequestText686f0afbTimestampGranularityArrayItemAsViseme{}}}}}
	stream, err := Synthesize(context.Background(), r, Options{WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	marks, err := stream.Next(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	actual := marks.(out.SynthesisItemAsTimeline).Value.Timestamps
	equal(t, actual[2], out.MicrosoftTimestamp{Kind: out.MicrosoftTimestampKindAsSsml{}, Value: "bookmark", StartTimeMs: 3})
	equal(t, actual[3], out.MicrosoftTimestamp{Kind: out.MicrosoftTimestampKindAsViseme{}, Value: "2", StartTimeMs: 4, AnimationChunk: runtime.Some("opaque animation"), IsLastAnimation: runtime.Some(out.MicrosoftTimestampIsLastAnimation(out.MicrosoftTimestampIsLastAnimationAsFalse{}))})
	_, err = stream.Next(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	done, err := stream.Next(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	equal(t, done, out.SynthesisItemAsDone{Value: out.MicrosoftDoneEvent{RequestId: socket.frames()[0].id, DurationMs: runtime.Some(10.0)}})
	_, err = stream.Next(context.Background())
	equal(t, err, io.EOF)
	equal(t, socket.closes.Load(), int32(1))
	equal(t, socket.frames()[2].body, "<speak/>")
}

func TestHTTPFailuresPreserveBoundsStatusAndOwnership(t *testing.T) {
	for _, row := range []struct {
		status  int
		data    string
		limit   int
		message string
	}{{429, "quota", 100, "Microsoft synthesis failed (429): quota"}, {307, "", 100, "Microsoft synthesis failed (307): "}, {500, "abcd", 3, "Microsoft response exceeds MaxJSONBytes"}} {
		b := &body{Reader: strings.NewReader(row.data)}
		_, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, MaxJSONBytes: row.limit, Transport: transport(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: row.status, Header: http.Header{"Retry-After": []string{"3"}}, Body: b}, nil
		})})
		errorText(t, err, row.message)
		equal(t, b.closes.Load(), int32(1))
		if e, ok := err.(*Error); ok {
			equal(t, e.StatusCode, row.status)
			equal(t, e.RetryAfter, runtime.Some("3"))
		}
	}
	b := &body{Reader: strings.NewReader("{}")}
	_, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: transport(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: b}, nil
	})})
	errorText(t, err, "Microsoft returned a non-audio response")
	equal(t, b.closes.Load(), int32(1))
}

func TestProtocolRejectionsAreExact(t *testing.T) {
	cases := []struct {
		packet  func(string) runtime.WebSocketMessage
		message string
	}{
		{func(string) runtime.WebSocketMessage { return runtime.WebSocketBinary{0} }, "Microsoft binary frame is missing its header length"},
		{func(string) runtime.WebSocketMessage { return runtime.WebSocketBinary{0, 3, 1} }, "Microsoft binary frame has a truncated header"},
		{func(string) runtime.WebSocketMessage { return runtime.WebSocketBinary{0, 1, 255} }, "Microsoft binary frame has invalid UTF-8 headers"},
		{func(string) runtime.WebSocketMessage { return runtime.WebSocketText("invalid") }, "Microsoft text frame is missing its header separator"},
		{func(id string) runtime.WebSocketMessage { return textFrame("turn.end", "wrong", "{}") }, "Microsoft returned an unexpected synthesis request ID"},
		{func(id string) runtime.WebSocketMessage { return audioFrame(id, "stream") }, "Microsoft returned audio for an unexpected stream"},
		{func(id string) runtime.WebSocketMessage { return textFrame("response", id, `{"audio":{}}`) }, "Microsoft synthesis response is missing audio.streamId"},
		{func(id string) runtime.WebSocketMessage {
			return textFrame("audio.metadata", id, `{"Metadata":[{"Type":"WordBoundary","Data":{"Offset":true}}]}`)
		}, "Microsoft returned invalid metadata Offset"},
		{func(id string) runtime.WebSocketMessage { return textFrame("response", id, `[]`) }, "Microsoft returned an invalid synthesis object"},
	}
	for i, row := range cases {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			socket := newSocket()
			socket.hook = func(_ context.Context, f sentFrame) error {
				if f.path == "ssml" {
					socket.reply(row.packet(f.id))
				}
				return nil
			}
			stream, err := Synthesize(context.Background(), request(), Options{WebSocket: socket})
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Close()
			_, err = stream.Next(context.Background())
			errorText(t, err, row.message)
			equal(t, socket.closes.Load(), int32(1))
		})
	}
}
