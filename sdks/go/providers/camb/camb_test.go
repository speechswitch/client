package camb

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/camb"
	out "github.com/speechswitch/client/sdks/go/generated/camb_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

var testAuth = auth.Auth{Camb: runtime.Some(auth.AuthAsync{ApiKey: runtime.Some("test-key")})}

func staticRequest() schema.TtsRequestTextVoice {
	return schema.TtsRequestTextVoice{Voice: "00042", Language: schema.TtsRequestMars81FlashBetaStreamingTextVoiceLanguageAsEnUs{},
		Model: schema.TtsRequestTextVoiceModelAsMars81FlashBeta{}, Text: "Hello",
		Output: schema.TtsRequestTextVoiceOutputAsObject{Value: schema.TtsRequestMars81FlashBetaStreamingTextVoiceOutput{Format: schema.TtsRequestMars81FlashBetaStreamingTextVoiceOutputFormatAsMp3{}}}}
}
func liveRequest(input runtime.Input[string]) schema.TtsRequestMars81FlashBetaStreamingTextVoice {
	return schema.TtsRequestMars81FlashBetaStreamingTextVoice{Voice: "00042", Language: schema.TtsRequestMars81FlashBetaStreamingTextVoiceLanguageAsEnUs{}, Text: input,
		Output: schema.TtsRequestMars81FlashBetaStreamingTextVoiceOutput{Format: schema.TtsRequestMars81FlashBetaStreamingTextVoiceOutputFormatAsMp3{}}}
}

type body struct {
	reader        io.Reader
	reads, closes atomic.Int32
}

func (s *body) Read(data []byte) (int, error) { s.reads.Add(1); return s.reader.Read(data) }
func (s *body) Close() error                  { s.closes.Add(1); return nil }

type transport struct {
	status   int
	body     io.ReadCloser
	requests []*http.Request
	payloads []any
}

func (s *transport) Do(request *http.Request) (*http.Response, error) {
	s.requests = append(s.requests, request)
	var payload any
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		return nil, err
	}
	s.payloads = append(s.payloads, payload)
	return &http.Response{StatusCode: s.status, Header: http.Header{}, Body: s.body}, nil
}

type source struct {
	chunks        []string
	reads, closes atomic.Int32
	closed        chan struct{}
	once          sync.Once
	next          func(context.Context) (string, error)
}

func newSource(chunks ...string) *source { return &source{chunks: chunks, closed: make(chan struct{})} }
func (s *source) Next(ctx context.Context) (string, error) {
	s.reads.Add(1)
	if s.next != nil {
		return s.next(ctx)
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if len(s.chunks) == 0 {
		return "", io.EOF
	}
	value := s.chunks[0]
	s.chunks = s.chunks[1:]
	return value, nil
}
func (s *source) Close() error { s.once.Do(func() { s.closes.Add(1); close(s.closed) }); return nil }

type socket struct {
	incoming       chan socketResult
	closed         chan struct{}
	closes         atomic.Int32
	once           sync.Once
	mutex          sync.Mutex
	sent           []map[string]any
	ready, respond bool
	send           func(context.Context, map[string]any) error
}

func newSocket() *socket {
	return &socket{incoming: make(chan socketResult, 64), closed: make(chan struct{}), ready: true, respond: true}
}
func (s *socket) put(value any) {
	encoded, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	s.incoming <- socketResult{value: runtime.WebSocketText(encoded)}
}
func (s *socket) Send(ctx context.Context, value runtime.WebSocketMessage) error {
	var message map[string]any
	if err := json.Unmarshal([]byte(value.(runtime.WebSocketText)), &message); err != nil {
		return err
	}
	s.mutex.Lock()
	s.sent = append(s.sent, message)
	s.mutex.Unlock()
	switch message["type"] {
	case "session.start":
		if s.ready {
			s.put(map[string]any{"type": "session.ready", "session_id": "session", "run_id": 1, "config": map[string]any{}})
		}
	case "text.chunk":
		if s.respond {
			s.put(map[string]any{"type": "segment.start", "segment_id": message["index"], "text": message["text"], "word_timestamps": []any{map[string]any{"word": message["text"], "start": 0.125, "end": 0.25}}})
			s.incoming <- socketResult{value: runtime.WebSocketBinary{0, 255}}
			s.put(map[string]any{"type": "segment.done", "segment_id": message["index"]})
		}
	case "text.done":
		if s.respond {
			s.put(map[string]any{"type": "session.done"})
		}
	}
	if s.send != nil {
		return s.send(ctx, message)
	}
	return nil
}
func (s *socket) Receive(ctx context.Context) (runtime.WebSocketMessage, error) {
	select {
	case result := <-s.incoming:
		return result.value, result.err
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-s.closed:
		return nil, io.EOF
	}
}
func (s *socket) Close() error { s.once.Do(func() { s.closes.Add(1); close(s.closed) }); return nil }
func (s *socket) messages() []map[string]any {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	return append([]map[string]any(nil), s.sent...)
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
		switch value := item.(type) {
		case out.SynthesisItemAsBytes:
			data := []int{}
			for _, b := range value.Value {
				data = append(data, int(b))
			}
			items = append(items, data)
		case out.SynthesisItemAsOrdered:
			timestamps := []any{}
			for _, stamp := range value.Value.Timestamps {
				timestamps = append(timestamps, map[string]any{"kind": stamp.Kind.Value(), "value": stamp.Value, "startTimeMs": stamp.StartTimeMs, "endTimeMs": stamp.EndTimeMs})
			}
			object := map[string]any{"correlation": value.Value.Correlation.Value(), "correlationId": value.Value.CorrelationId, "timestamps": timestamps}
			if value.Value.Audio.Present {
				data := []int{}
				for _, b := range value.Value.Audio.Value {
					data = append(data, int(b))
				}
				object["audio"] = data
			}
			items = append(items, object)
		default:
			return items, errors.New("unexpected output representation")
		}
	}
}

func TestSharedProtocolFixtures(t *testing.T) {
	contents, err := os.ReadFile("../../../fixtures/camb.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Name   string
		Frames []struct {
			JSON  json.RawMessage
			Audio *[]int
		}
		Items json.RawMessage
		Error string
	}
	if err := json.Unmarshal(contents, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range fixtures {
		t.Run(fixture.Name, func(t *testing.T) {
			sock := newSocket()
			sock.respond = false
			sock.send = func(_ context.Context, message map[string]any) error {
				if message["type"] == "text.done" {
					for _, frame := range fixture.Frames {
						if frame.Audio != nil {
							data := []byte{}
							for _, b := range *frame.Audio {
								data = append(data, byte(b))
							}
							sock.incoming <- socketResult{value: runtime.WebSocketBinary(data)}
						} else {
							sock.incoming <- socketResult{value: runtime.WebSocketText(frame.JSON)}
						}
					}
					sock.put(map[string]any{"type": "session.done"})
				}
				return nil
			}
			value := schema.TtsRequestMars81FlashBetaTextVoice{Text: "Hello", Voice: "42", Language: schema.TtsRequestMars81FlashBetaStreamingTextVoiceLanguageAsEnUs{},
				Output: schema.TtsRequestMars81FlashBetaStreamingTextVoiceOutput{Format: schema.TtsRequestMars81FlashBetaStreamingTextVoiceOutputFormatAsMp3{}}}
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			stream, err := Synthesize(ctx, schema.TtsRequestAsMars81FlashBetaTextVoice{Value: value}, Options{Auth: testAuth, WebSocket: sock})
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Close()
			items, err := collect(ctx, stream)
			failure := ""
			if err != nil {
				failure = err.Error()
			}
			if failure != fixture.Error {
				t.Fatalf("error = %q, want %q", failure, fixture.Error)
			}
			encoded, err := json.Marshal(items)
			if err != nil {
				t.Fatal(err)
			}
			var actual, expected any
			if err := json.Unmarshal(encoded, &actual); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(fixture.Items, &expected); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(actual, expected) {
				t.Fatalf("items = %#v, want %#v", actual, expected)
			}
			if sock.closes.Load() != 1 {
				t.Fatal("socket not released")
			}
		})
	}
}

func TestHTTPModelsFormatsAndOwnership(t *testing.T) {
	models := []struct {
		value schema.TtsRequestTextVoiceModel
		wire  string
	}{
		{schema.TtsRequestTextVoiceModelAsMars8Flash{}, "mars-flash"}, {schema.TtsRequestTextVoiceModelAsMars8Instruct{}, "mars-instruct"},
		{schema.TtsRequestTextVoiceModelAsMars8Pro{}, "mars-pro"}, {schema.TtsRequestTextVoiceModelAsMars81FlashBeta{}, "mars-8.1-flash-beta"}, {schema.TtsRequestTextVoiceModelAsMars81ProBeta{}, "mars-8.1-pro-beta"},
	}
	outputs := []struct {
		value schema.TtsRequestTextVoiceOutput
		wire  string
	}{}
	for _, format := range []schema.TtsRequestMars81FlashBetaStreamingTextVoiceOutputFormat{schema.TtsRequestMars81FlashBetaStreamingTextVoiceOutputFormatAsMp3{}, schema.TtsRequestMars81FlashBetaStreamingTextVoiceOutputFormatAsWav{}, schema.TtsRequestMars81FlashBetaStreamingTextVoiceOutputFormatAsFlac{}, schema.TtsRequestMars81FlashBetaStreamingTextVoiceOutputFormatAsAac{}} {
		native := format.LiteralValue()
		if native == "aac" {
			native = "adts"
		}
		outputs = append(outputs, struct {
			value schema.TtsRequestTextVoiceOutput
			wire  string
		}{schema.TtsRequestTextVoiceOutputAsObject{Value: schema.TtsRequestMars81FlashBetaStreamingTextVoiceOutput{Format: format, SampleRateHz: runtime.Some(24000.0)}}, native})
	}
	for _, encoding := range []struct {
		value schema.TtsRequestTextVoiceOutputPcmSampleEncoding
		wire  string
	}{{schema.TtsRequestTextVoiceOutputPcmSampleEncodingAsFloat32{}, "f32"}, {schema.TtsRequestTextVoiceOutputPcmSampleEncodingAsSignedInteger16{}, "s16"}, {schema.TtsRequestTextVoiceOutputPcmSampleEncodingAsSignedInteger32{}, "s32"}} {
		for _, order := range []struct {
			value schema.TtsRequestTextVoiceOutputPcmByteOrder
			wire  string
		}{{schema.TtsRequestTextVoiceOutputPcmByteOrderAsBigEndian{}, "be"}, {schema.TtsRequestTextVoiceOutputPcmByteOrderAsLittleEndian{}, "le"}} {
			outputs = append(outputs, struct {
				value schema.TtsRequestTextVoiceOutput
				wire  string
			}{schema.TtsRequestTextVoiceOutputAsPcm{Value: schema.TtsRequestTextVoiceOutputPcm{SampleEncoding: encoding.value, ByteOrder: order.value, SampleRateHz: runtime.Some(24000.0)}}, "pcm_" + encoding.wire + order.wire})
		}
	}
	for _, model := range models {
		for _, output := range outputs {
			value := staticRequest()
			value.Model, value.Output = model.value, output.value
			value.Speed = runtime.Some(1.5)
			disabled := schema.TtsRequestMars81FlashBetaStreamingTextVoiceAccentPreservation(schema.TtsRequestMars81FlashBetaStreamingTextVoiceAccentPreservationAsFalse{})
			value.AudioEnhancement, value.ReferenceAudioEnhancement, value.NamedEntityPronunciationEnhancement = runtime.Some(disabled), runtime.Some(disabled), runtime.Some(disabled)
			body := &body{reader: bytes.NewReader([]byte{0, 255})}
			client := &transport{status: 200, body: body}
			stream, err := Synthesize(context.Background(), schema.TtsRequestAsTextVoice{Value: value}, Options{Auth: testAuth, Transport: client, BaseURL: "https://proxy.invalid/a%20b/?trace=1"})
			if err != nil {
				t.Fatal(err)
			}
			if body.reads.Load() != 0 {
				t.Fatal("body prefetched")
			}
			item, err := stream.Next(context.Background())
			if err != nil || !reflect.DeepEqual(item, out.SynthesisItemAsBytes{Value: []byte{0, 255}}) {
				t.Fatalf("audio = %#v %v", item, err)
			}
			stream.Close()
			if body.closes.Load() != 1 {
				t.Fatal("body not closed")
			}
			sent := client.requests[0]
			if sent.Method != "POST" || sent.URL.String() != "https://proxy.invalid/a%20b/tts-stream?trace=1" || !reflect.DeepEqual(sent.Header, http.Header{"X-Api-Key": {"test-key"}, "Content-Type": {"application/json"}}) {
				t.Fatalf("request = %#v", sent)
			}
			expected := map[string]any{"text": "Hello", "voice_id": float64(42), "language": "en-us", "speech_model": model.wire, "enhance_named_entities_pronunciation": false,
				"output_configuration": map[string]any{"format": output.wire, "sample_rate": float64(24000), "apply_enhancement": false}, "voice_settings": map[string]any{"speaking_rate": 1.5, "enhance_reference_audio_quality": false}}
			if !reflect.DeepEqual(client.payloads[0], expected) {
				t.Fatalf("wire = %#v, want %#v", client.payloads[0], expected)
			}
		}
	}
}

func TestStreamingIndexAndBackpressure(t *testing.T) {
	input, sock := newSource("Hello", ""), newSocket()
	value := liveRequest(input)
	value.TimestampGranularity = runtime.Some(schema.TtsRequestMars81FlashBetaStreamingTextVoiceTimestampGranularity{})
	value.TextFlushDelayMs = runtime.Some(0.0)
	value.InferenceSteps = runtime.Some(10.0)
	stream, err := Synthesize(context.Background(), schema.TtsRequestAsMars81FlashBetaStreamingTextVoice{Value: value}, Options{Auth: testAuth, WebSocket: sock})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	items, err := collect(context.Background(), stream)
	if err != nil || len(items) != 4 {
		t.Fatalf("items = %#v, error = %v", items, err)
	}
	messages := sock.messages()
	expected := []map[string]any{
		{"type": "session.start", "voice_id": float64(42), "language": "en-us", "output_format": "mp3", "word_timestamps": true, "idle_timeout": float64(0), "inference_steps": float64(10), "enhance_named_entities_pronunciation": false, "enhance_reference_audio_quality": false, "maintain_source_accent": false},
		{"type": "text.chunk", "text": "Hello", "index": float64(0)}, {"type": "text.chunk", "text": "", "index": float64(1)}, {"type": "text.done"},
	}
	if !reflect.DeepEqual(messages, expected) {
		t.Fatalf("messages = %#v", messages)
	}
	if input.closes.Load() != 1 || sock.closes.Load() != 1 {
		t.Fatal("resources not closed")
	}

	input, sock = newSource("Hello", "not pulled"), newSocket()
	writing := make(chan struct{})
	sock.send = func(ctx context.Context, message map[string]any) error {
		if message["type"] == "text.chunk" {
			close(writing)
			<-ctx.Done()
			return ctx.Err()
		}
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	stream, err = Synthesize(ctx, schema.TtsRequestAsMars81FlashBetaStreamingTextVoice{Value: liveRequest(input)}, Options{Auth: testAuth, WebSocket: sock})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	item, err := stream.Next(ctx)
	if err != nil || !reflect.DeepEqual(item, out.SynthesisItemAsBytes{Value: []byte{0, 255}}) {
		t.Fatalf("audio while writing = %#v %v", item, err)
	}
	<-writing
	if input.reads.Load() != 1 {
		t.Fatal("input prefetched during a blocked write")
	}
	stream.Close()
	if input.closes.Load() != 1 || sock.closes.Load() != 1 {
		t.Fatal("backpressured stream not released")
	}
}

func TestCancellationGatesInputAndOwnsUnreadStream(t *testing.T) {
	for _, read := range []bool{false, true} {
		input, sock := newSource("Hello"), newSocket()
		sock.ready = false
		ctx, cancel := context.WithCancel(context.Background())
		stream, err := Synthesize(ctx, schema.TtsRequestAsMars81FlashBetaStreamingTextVoice{Value: liveRequest(input)}, Options{Auth: testAuth, WebSocket: sock})
		if err != nil {
			t.Fatal(err)
		}
		if read {
			started := make(chan struct{})
			sock.send = func(context.Context, map[string]any) error { close(started); return nil }
			done := make(chan error, 1)
			go func() { _, err := stream.Next(context.Background()); done <- err }()
			<-started
			if input.reads.Load() != 0 {
				t.Fatal("input read before session.ready")
			}
			cancel()
			if err := <-done; !errors.Is(err, context.Canceled) {
				t.Fatalf("cancellation = %v", err)
			}
		} else {
			cancel()
		}
		stream.Close()
		if input.reads.Load() != 0 || input.closes.Load() != 1 || sock.closes.Load() != 1 {
			t.Fatal("unread/handshake resources not released")
		}
	}
}

func TestNativeHTTPAndAuthFallback(t *testing.T) {
	t.Setenv("SPEECHSWITCH_CAMB_API_KEY", "scoped")
	t.Setenv("CAMB_API_KEY", "native")
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls.Add(1)
		if request.URL.Path != "/tts-stream" || request.Header.Get("x-api-key") != "scoped" {
			t.Errorf("unexpected request: %#v", request)
		}
		writer.Write([]byte{0, 255})
	}))
	defer server.Close()
	stream, err := Synthesize(context.Background(), schema.TtsRequestAsTextVoice{Value: staticRequest()}, Options{BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	items, err := collect(context.Background(), stream)
	if err != nil || !reflect.DeepEqual(items, []any{[]int{0, 255}}) {
		t.Fatalf("native = %#v %v", items, err)
	}
	_, err = Synthesize(context.Background(), schema.TtsRequestAsTextVoice{Value: staticRequest()}, Options{BaseURL: server.URL, Auth: auth.Auth{Camb: runtime.Some(auth.AuthAsync{ApiKey: runtime.Some("")})}})
	if err == nil || err.Error() != "Missing auth.camb.apiKey configuration" || calls.Load() != 1 {
		t.Fatalf("empty auth = %v, calls = %d", err, calls.Load())
	}
}

func TestHTTPErrorsAndGeneratedConstraints(t *testing.T) {
	for _, limit := range []int{1024, 3} {
		body := &body{reader: strings.NewReader(" quota ")}
		_, err := Synthesize(context.Background(), schema.TtsRequestAsTextVoice{Value: staticRequest()}, Options{Auth: testAuth, Transport: &transport{status: 429, body: body}, MaxErrorBytes: limit})
		expected := "CAMB returned HTTP 429: quota"
		if limit == 3 {
			expected = "CAMB response exceeds MaxErrorBytes"
		}
		if err == nil || err.Error() != expected || body.closes.Load() != 1 {
			t.Fatalf("status = %v, closes = %d", err, body.closes.Load())
		}
	}
	input, sock := newSource("Hello"), newSocket()
	value := liveRequest(input)
	value.InferenceSteps = runtime.Some(1.5)
	request := schema.TtsRequestAsMars81FlashBetaStreamingTextVoice{Value: value}
	_, expected := schema.ValidateRequest(request)
	if expected == nil {
		t.Fatal("invalid fixture passed generated validation")
	}
	_, err := Synthesize(context.Background(), request, Options{Auth: testAuth, WebSocket: sock})
	if err == nil || err.Error() != expected.Error() || input.reads.Load() != 0 || len(sock.messages()) != 0 {
		t.Fatalf("constraint = %v", err)
	}
}

func TestNativeWebSocketHeaderAuth(t *testing.T) {
	finished := make(chan error, 1)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		failure := func() error {
			if request.URL.RequestURI() != "/live?trace=1" || request.Header.Get("x-api-key") != "test-key" {
				return fmt.Errorf("handshake = %s, auth = %q", request.URL.RequestURI(), request.Header.Get("x-api-key"))
			}
			connection, buffered, err := writer.(http.Hijacker).Hijack()
			if err != nil {
				return err
			}
			defer connection.Close()
			connection.SetDeadline(time.Now().Add(2 * time.Second))
			hash := sha1.Sum([]byte(request.Header.Get("Sec-WebSocket-Key") + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
			fmt.Fprintf(buffered, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n", base64.StdEncoding.EncodeToString(hash[:]))
			if err := buffered.Flush(); err != nil {
				return err
			}
			read := func() (map[string]any, error) {
				header := make([]byte, 2)
				if _, err := io.ReadFull(buffered, header); err != nil {
					return nil, err
				}
				if header[0] != 0x81 || header[1]&128 == 0 {
					return nil, fmt.Errorf("client frame header = %v", header)
				}
				length := int(header[1] & 127)
				if length == 126 {
					if _, err := io.ReadFull(buffered, header); err != nil {
						return nil, err
					}
					length = int(binary.BigEndian.Uint16(header))
				}
				if length > 4096 || length == 127 {
					return nil, errors.New("unexpected client frame length")
				}
				mask := make([]byte, 4)
				if _, err := io.ReadFull(buffered, mask); err != nil {
					return nil, err
				}
				data := make([]byte, length)
				if _, err := io.ReadFull(buffered, data); err != nil {
					return nil, err
				}
				for index := range data {
					data[index] ^= mask[index%4]
				}
				var value map[string]any
				err := json.Unmarshal(data, &value)
				return value, err
			}
			send := func(value any) error {
				data, err := json.Marshal(value)
				if err != nil {
					return err
				}
				if len(data) >= 126 {
					return errors.New("fixture frame too large")
				}
				if _, err := buffered.Write(append([]byte{0x81, byte(len(data))}, data...)); err != nil {
					return err
				}
				return buffered.Flush()
			}
			start, err := read()
			if err != nil {
				return err
			}
			expected := map[string]any{"type": "session.start", "voice_id": float64(42), "language": "en-us", "output_format": "mp3", "word_timestamps": false, "idle_timeout": float64(1), "enhance_named_entities_pronunciation": false, "enhance_reference_audio_quality": false, "maintain_source_accent": false}
			if !reflect.DeepEqual(start, expected) {
				return fmt.Errorf("session.start = %#v", start)
			}
			if err := send(map[string]any{"type": "session.ready", "session_id": "session", "run_id": 1, "config": map[string]any{}}); err != nil {
				return err
			}
			chunk, err := read()
			if err != nil {
				return err
			}
			if !reflect.DeepEqual(chunk, map[string]any{"type": "text.chunk", "text": "Hello", "index": float64(0)}) {
				return fmt.Errorf("text.chunk = %#v", chunk)
			}
			if err := send(map[string]any{"type": "segment.start", "segment_id": 7, "text": "Hello"}); err != nil {
				return err
			}
			if _, err := buffered.Write([]byte{0x82, 2, 0, 255}); err != nil {
				return err
			}
			if err := send(map[string]any{"type": "segment.done", "segment_id": 7}); err != nil {
				return err
			}
			done, err := read()
			if err != nil {
				return err
			}
			if !reflect.DeepEqual(done, map[string]any{"type": "text.done"}) {
				return fmt.Errorf("text.done = %#v", done)
			}
			return send(map[string]any{"type": "session.done"})
		}()
		finished <- failure
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	input := newSource("Hello")
	stream, err := Synthesize(ctx, schema.TtsRequestAsMars81FlashBetaStreamingTextVoice{Value: liveRequest(input)}, Options{Auth: testAuth, WebSocketURL: "ws" + strings.TrimPrefix(server.URL, "http") + "/live?api_key=stale&trace=1"})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	items, err := collect(ctx, stream)
	if failure := <-finished; failure != nil {
		t.Fatal(failure)
	}
	if err != nil || !reflect.DeepEqual(items, []any{[]int{0, 255}}) {
		t.Fatalf("native output = %#v, %v", items, err)
	}
	if input.closes.Load() != 1 {
		t.Fatal("native input not closed")
	}
}

func TestProtocolFailuresAndLimits(t *testing.T) {
	for _, test := range []struct {
		frames []socketResult
		ready  bool
		error  string
	}{
		{[]socketResult{{err: io.EOF}}, false, "CAMB closed before session.ready"},
		{[]socketResult{{value: runtime.WebSocketText(`{"type":"session.error","error":"auth"}`)}}, false, "CAMB rejected session: auth"},
		{[]socketResult{{value: runtime.WebSocketBinary{1}}}, false, "CAMB did not acknowledge the session before sending output"},
		{[]socketResult{{value: runtime.WebSocketText(strings.Repeat("x", 1001))}}, false, "CAMB message exceeds MaxMessageBytes"},
		{[]socketResult{{err: io.EOF}}, true, "CAMB closed before session.done"},
		{[]socketResult{{value: runtime.WebSocketText(`{"type":"segment.done","segment_id":8}`)}}, true, "CAMB completed an unexpected segment"},
		{[]socketResult{{value: runtime.WebSocketText(`{"type":"session.error","error":"quota"}`)}}, true, "CAMB synthesis failed: quota"},
		{[]socketResult{{value: runtime.WebSocketText(`{"type":"segment.start","segment_id":true,"text":"Hi"}`)}}, true, "Invalid CAMB WebSocket message"},
		{[]socketResult{{value: runtime.WebSocketBinary(make([]byte, 1001))}}, true, "CAMB message exceeds MaxMessageBytes"},
	} {
		t.Run(test.error, func(t *testing.T) {
			input, sock := newSource("Hello"), newSocket()
			sock.ready, sock.respond = test.ready, false
			sock.send = func(_ context.Context, message map[string]any) error {
				if message["type"] == "session.start" {
					for _, frame := range test.frames {
						sock.incoming <- frame
					}
				}
				return nil
			}
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			stream, err := Synthesize(ctx, schema.TtsRequestAsMars81FlashBetaStreamingTextVoice{Value: liveRequest(input)}, Options{Auth: testAuth, WebSocket: sock, MaxMessageBytes: 1000})
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Close()
			_, err = collect(ctx, stream)
			if err == nil || err.Error() != test.error {
				t.Fatalf("error = %v, want %s", err, test.error)
			}
			if input.closes.Load() != 1 || sock.closes.Load() != 1 {
				t.Fatal("failed session not closed")
			}
			if !test.ready && input.reads.Load() != 0 {
				t.Fatal("failed handshake read input")
			}
		})
	}
	input, sock := newSource(strings.Repeat("x", 1001)), newSocket()
	stream, err := Synthesize(context.Background(), schema.TtsRequestAsMars81FlashBetaStreamingTextVoice{Value: liveRequest(input)}, Options{Auth: testAuth, WebSocket: sock, MaxMessageBytes: 1000})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	_, err = stream.Next(context.Background())
	if err == nil || err.Error() != "CAMB message exceeds MaxMessageBytes" {
		t.Fatalf("outgoing limit = %v", err)
	}
	if len(sock.messages()) != 1 {
		t.Fatal("oversized text transmitted")
	}
}

func TestSourceErrorAndPerReadCancellation(t *testing.T) {
	failure := errors.New("producer failed")
	for _, fail := range []bool{false, true} {
		input, sock := newSource(), newSocket()
		sock.respond = false
		reading := make(chan struct{})
		input.next = func(ctx context.Context) (string, error) {
			close(reading)
			if fail {
				return "", failure
			}
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			case <-input.closed:
				return "", io.EOF
			}
		}
		stream, err := Synthesize(context.Background(), schema.TtsRequestAsMars81FlashBetaStreamingTextVoice{Value: liveRequest(input)}, Options{Auth: testAuth, WebSocket: sock})
		if err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithCancel(context.Background())
		done := make(chan error, 1)
		go func() { _, err := stream.Next(ctx); done <- err }()
		<-reading
		expected := failure
		if !fail {
			expected = context.Canceled
			cancel()
		}
		if err := <-done; err != expected {
			t.Fatalf("error = %v, want %v", err, expected)
		}
		cancel()
		stream.Close()
		if input.closes.Load() != 1 || sock.closes.Load() != 1 {
			t.Fatal("source failure/cancellation leaked resources")
		}
	}
}
