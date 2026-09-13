package smallest_ai

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	schema "github.com/speechswitch/client/sdks/go/generated/smallest_ai"
	out "github.com/speechswitch/client/sdks/go/generated/smallest_ai_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func TestLegacyStreamPreservesWhitespaceAndWaitsForFinalWrite(t *testing.T) {
	source := newProducer("  ")
	source.items <- production[string]{value: strings.Repeat("🚀", 8001)}
	source.end()
	socket := newSocket()
	socket.sendGate = make(chan error, 3)
	input := start(t, liveRequest(source), Options{WebSocket: socket})
	pending := next(input, deadline(t))
	first := sent(t, socket)
	equal(t, first, map[string]any{"voice_id": "custom-uuid", "model": "lightning_v3.1", "language": "auto", "sample_rate": float64(44100), "output_format": "pcm", "speed": float64(1), "math_notation": false, "text": "  ", "request_id": first["request_id"], "continue": true, "max_buffer_flush_ms": float64(0), "complete_backoff_ms": float64(4000)})
	equal(t, source.reads.Load(), int32(1))
	socket.packet(frame("chunk"))
	equal(t, take(t, pending), out.SynthesisItemAsBytes{Value: []byte{0, 255, 128}})
	equal(t, source.reads.Load(), int32(1))
	socket.sendGate <- nil
	second := sent(t, socket)
	equal(t, second["text"], strings.Repeat("🚀", 8001))
	equal(t, second["request_id"], first["request_id"])
	socket.sendGate <- nil
	final := sent(t, socket)
	want := first
	want["text"] = ""
	want["continue"] = false
	want["flush"] = true
	equal(t, final, want)
	socket.packet(frame("complete"))
	pending = next(input, deadline(t))
	select {
	case result := <-pending:
		t.Fatalf("completed before final write: %#v", result)
	default:
	}
	socket.sendGate <- nil
	equal(t, take(t, pending), out.SynthesisItemAsDone{})
	equal(t, socket.closes.Load(), int32(1))
	_, err := input.Next(deadline(t))
	equal(t, err, io.EOF)
	await(t, source.closed)
}

func TestCompletionCannotHideFailedFinalWrite(t *testing.T) {
	source := newProducer("hello")
	source.end()
	socket := newSocket()
	socket.sendGate = make(chan error, 2)
	input := start(t, liveRequest(source), Options{WebSocket: socket})
	pending := next(input, deadline(t))
	sent(t, socket)
	socket.packet(frame("chunk"))
	equal(t, take(t, pending), out.SynthesisItemAsBytes{Value: []byte{0, 255, 128}})
	socket.sendGate <- nil
	sent(t, socket)
	socket.packet(frame("complete"))
	failure := errors.New("final write failed")
	socket.sendGate <- failure
	_, err := input.Next(deadline(t))
	equal(t, err, failure)
	equal(t, socket.closes.Load(), int32(1))
}

func TestPrematureCompletionIsAnError(t *testing.T) {
	source := newProducer("hello")
	socket := newSocket()
	input := start(t, liveRequest(source), Options{WebSocket: socket})
	pending := next(input, deadline(t))
	sent(t, socket)
	socket.packet(frame("chunk"))
	equal(t, take(t, pending), out.SynthesisItemAsBytes{Value: []byte{0, 255, 128}})
	socket.packet(frame("complete"))
	_, err := input.Next(deadline(t))
	if err == nil {
		t.Fatal("accepted premature completion")
	}
	equal(t, err.Error(), "Smallest.ai completed before input ended")
	equal(t, socket.closes.Load(), int32(1))
}

func TestContinuationClearAndIndependentTimestampEnvelopes(t *testing.T) {
	var text inputItem = schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbTextItemAsString{Value: "first"}
	source := newProducer(text)
	request := schema.TtsRequestAsLightningV31StreamingTextVoice90b1878c{Value: schema.TtsRequestLightningV31StreamingTextVoice90b1878c{Text: source, Voice: schema.TtsRequestLightningV31ProStreamingTextVoice4f8c2395VoiceAsMeher{}, Continuation: schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbContinuation{Id: "context"}}}
	socket := newSocket()
	input := start(t, request, Options{WebSocket: socket})
	pending := next(input, deadline(t))
	first := sent(t, socket)
	equal(t, first, map[string]any{"voice_id": "meher", "model": "lightning_v3.1", "language": "en", "sample_rate": float64(44100), "output_format": "pcm", "speed": float64(1), "math_notation": false, "word_timestamps": true, "text": "first", "context_id": "context", "continue": true, "max_buffer_delay_ms": float64(3000), "request_id": first["request_id"]})
	socket.packet(map[string]any{"status": "word_timestamp", "request_id": "word-segment", "data": map[string]any{"id": 2, "word": " first ", "start": .1, "end": .25}})
	equal(t, take(t, pending), out.SynthesisItemAsOrdered{Value: out.SmallestEnvelope{CorrelationId: "word-segment", Timestamps: []out.SmallestEnvelopeTimestampsItem{{Value: " first ", StartTimeMs: 100, EndTimeMs: runtime.Some(250.0)}}, WordIndex: runtime.Some(2.0)}})
	source.items <- production[inputItem]{value: &schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbTextItemAsClear{}}
	pending = next(input, deadline(t))
	equal(t, take(t, pending), out.SynthesisItemAsClear{})
	equal(t, sent(t, socket), map[string]any{"context_id": "context", "cancel_request": true})
	source.items <- production[inputItem]{value: &schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbTextItemAsString{Value: "second"}}
	pending = next(input, deadline(t))
	second := sent(t, socket)
	if second["request_id"] == first["request_id"] {
		t.Fatal("clear did not rotate external request identity")
	}
	old := frame("chunk")
	old["external_request_id"] = first["request_id"]
	socket.packet(old)
	old = frame("complete")
	old["external_request_id"] = first["request_id"]
	socket.packet(old)
	fresh := frame("chunk")
	fresh["external_request_id"] = second["request_id"]
	fresh["request_id"] = "audio-segment"
	socket.packet(fresh)
	equal(t, take(t, pending), out.SynthesisItemAsOrdered{Value: out.SmallestEnvelope{CorrelationId: "audio-segment", Audio: runtime.Some([]byte{0, 255, 128}), Timestamps: []out.SmallestEnvelopeTimestampsItem{}}})
	source.end()
	pending = next(input, deadline(t))
	equal(t, sent(t, socket), map[string]any{"context_id": "context", "voice_id": "meher", "continue": false})
	complete := frame("complete")
	complete["external_request_id"] = second["request_id"]
	complete["request_id"] = "batch-segment"
	socket.packet(complete)
	equal(t, take(t, pending), out.SynthesisItemAsBatch{Value: out.SmallestBatchEvent{RequestId: "batch-segment"}})
	pending = next(input, deadline(t))
	equal(t, socket.closes.Load(), int32(0))
	input.Close()
	equal(t, takeResult(t, pending).err, context.Canceled)
	await(t, source.closed)
}

func TestClearRejectsAmbiguousIdentityButNeverMasksNativeErrors(t *testing.T) {
	for _, test := range []struct {
		packet map[string]any
		want   error
	}{
		{frame("chunk"), errors.New("Smallest.ai omitted external request identity after clear")},
		{map[string]any{"status": "chunk", "request_id": "r", "external_request_id": "unknown", "data": map[string]any{"audio": "AA=="}}, errors.New("Smallest.ai returned an unknown external request identity after clear")},
		{map[string]any{"status": "error", "error": map[string]any{"message": "failure", "code": "native"}}, &Error{Message: "failure", Code: runtime.Some("native")}},
	} {
		t.Run(test.want.Error(), func(t *testing.T) {
			var clear inputItem = schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbTextItemAsClear{}
			source := newProducer(clear)
			socket := newSocket()
			input := start(t, continuationRequest(source), Options{WebSocket: socket})
			pending := next(input, deadline(t))
			equal(t, take(t, pending), out.SynthesisItemAsClear{})
			sent(t, socket)
			socket.packet(test.packet)
			_, err := input.Next(deadline(t))
			if err == nil {
				t.Fatal("accepted ambiguous packet")
			}
			equal(t, err.Error(), test.want.Error())
			if _, ok := test.want.(*Error); ok {
				equal(t, err, test.want)
			}
		})
	}
}

func TestEmptyInputsHaveDifferentCompletionSemantics(t *testing.T) {
	t.Run("ordinary", func(t *testing.T) {
		source := newProducer[string]()
		source.end()
		socket := newSocket()
		input := start(t, liveRequest(source), Options{WebSocket: socket})
		items, err := collect(deadline(t), input)
		if err != nil {
			t.Fatal(err)
		}
		equal(t, items, []out.SynthesisItem{out.SynthesisItemAsDone{}})
		equal(t, len(socket.sent), 0)
		equal(t, socket.closes.Load(), int32(1))
	})
	t.Run("continuation", func(t *testing.T) {
		source := newProducer[inputItem]()
		source.end()
		socket := newSocket()
		input := start(t, continuationRequest(source), Options{WebSocket: socket})
		pending := next(input, deadline(t))
		equal(t, sent(t, socket), map[string]any{"context_id": "context", "voice_id": "custom-uuid", "continue": false})
		socket.received <- frameResult{err: io.EOF}
		err := takeResult(t, pending).err
		if err == nil {
			t.Fatal("accepted unproven context completion")
		}
		equal(t, err.Error(), "Smallest.ai continuation closed without a context-complete marker")
	})
}

func TestSocketErrorsRetainIdentityAndClose(t *testing.T) {
	failure := errors.New("receive failed")
	for _, test := range []struct {
		value frameResult
		want  error
	}{
		{frameResult{err: failure}, failure},
		{frameResult{err: io.EOF}, errors.New("Smallest.ai WebSocket closed before completion")},
		{frameResult{value: runtime.WebSocketBinary{0}}, errors.New("Smallest.ai returned a non-text WebSocket frame")},
		{frameResult{value: runtime.WebSocketText("invalid")}, errors.New("Smallest.ai returned invalid JSON")},
	} {
		t.Run(test.want.Error(), func(t *testing.T) {
			socket := newSocket()
			input := start(t, request(), Options{WebSocket: socket})
			pending := next(input, deadline(t))
			sent(t, socket)
			socket.received <- test.value
			err := takeResult(t, pending).err
			if err == nil {
				t.Fatal("accepted failed socket")
			}
			equal(t, err.Error(), test.want.Error())
			if test.want == failure {
				equal(t, err, failure)
			}
			equal(t, socket.closes.Load(), int32(1))
		})
	}
}

func TestCancellationInterruptsBlockedSendAndInput(t *testing.T) {
	source := newProducer("hello")
	socket := newSocket()
	socket.blockSend = true
	input := start(t, liveRequest(source), Options{WebSocket: socket})
	ctx, cancel := context.WithCancel(deadline(t))
	pending := next(input, ctx)
	sent(t, socket)
	equal(t, source.reads.Load(), int32(1))
	cancel()
	equal(t, takeResult(t, pending).err, context.Canceled)
	equal(t, socket.closes.Load(), int32(1))
	await(t, source.closed)
}

func TestDeadlineDuringPendingHeadersAndUnreadSocket(t *testing.T) {
	started := make(chan struct{})
	input := start(t, request(), Options{TimeoutMs: runtime.Some(int64(20)), Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
		close(started)
		<-r.Context().Done()
		return nil, r.Context().Err()
	})})
	_, err := input.Next(deadline(t))
	equal(t, err, context.DeadlineExceeded)
	await(t, started)
	socket := newSocket()
	unread := start(t, request(), Options{WebSocket: socket, TimeoutMs: runtime.Some(int64(20))})
	await(t, socket.closed)
	equal(t, len(socket.sent), 0)
	_, err = unread.Next(deadline(t))
	equal(t, err, context.DeadlineExceeded)
}

func TestPreflightAuthAndOverrideOwnership(t *testing.T) {
	t.Setenv("SMALLEST_API_KEY", "fallback")
	t.Setenv("SPEECHSWITCH_SMALLEST_API_KEY", "scoped")
	for _, test := range []struct {
		options Options
		want    string
	}{
		{Options{Protocol: "invalid"}, "Invalid Smallest.ai protocol"},
		{Options{IdleTimeoutSeconds: runtime.Some(int64(0))}, "Smallest.ai IdleTimeoutSeconds must be a positive safe integer"},
		{Options{MaxMessageBytes: -1}, "Smallest.ai MaxMessageBytes must be positive"},
		{Options{TimeoutMs: runtime.Some(int64(-1))}, "Smallest.ai TimeoutMs must be between 0 and 2147483647"},
		{Options{BaseURL: "https://user:pass@host"}, "Invalid Smallest.ai endpoint URL"},
		{Options{WebSocketURL: "https://host"}, "Invalid Smallest.ai endpoint URL"},
	} {
		t.Run(test.want, func(t *testing.T) {
			socket := newSocket()
			test.options.WebSocket = socket
			_, err := Synthesize(context.Background(), request(), test.options)
			if err == nil {
				t.Fatal("accepted invalid options")
			}
			equal(t, err.Error(), test.want)
			equal(t, socket.closes.Load(), int32(1))
		})
	}
	for _, key := range []string{"", "bad\nkey"} {
		a := authenticated()
		a.SmallestAi.Value.ApiKey = runtime.Some(key)
		socket := newSocket()
		_, err := Synthesize(context.Background(), request(), Options{Auth: a, WebSocket: socket})
		want := "Missing auth.smallest.ai.apiKey configuration"
		if key != "" {
			want = "Smallest.ai API key must be a printable ASCII header value"
		}
		if err == nil {
			t.Fatal("accepted invalid auth")
		}
		equal(t, err.Error(), want)
		equal(t, socket.closes.Load(), int32(1))
	}
	socket := newSocket()
	unread, err := Synthesize(context.Background(), request(), Options{WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	unread.Close()
	equal(t, socket.closes.Load(), int32(1))
	equal(t, len(socket.sent), 0)
}

func TestGeneratedInputValidationRejectsTypedNilBeforeSend(t *testing.T) {
	var invalid *schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbTextItemAsString
	var item inputItem = invalid
	source := newProducer(item)
	socket := newSocket()
	request := continuationRequest(source)
	validate, err := schema.ValidateRequest(request)
	if err != nil {
		t.Fatal(err)
	}
	expected := validate(item)
	if expected == nil {
		t.Fatal("expected generated input validation failure")
	}
	input := start(t, request, Options{WebSocket: socket})
	_, err = input.Next(deadline(t))
	if err == nil {
		t.Fatal("accepted typed-nil input")
	}
	equal(t, err.Error(), expected.Error())
	equal(t, len(socket.sent), 0)
	equal(t, socket.closes.Load(), int32(1))
}

func TestBufferedCompletionCannotBeRelabeledByLaterInputEOF(t *testing.T) {
	source := newProducer("hello")
	socket := newSocket()
	input := start(t, liveRequest(source), Options{WebSocket: socket})
	pending := next(input, deadline(t))
	sent(t, socket)
	socket.packet(frame("chunk"))
	take(t, pending)
	// The second audio envelope holds the processing loop while its independent
	// receive worker observes completion. Input EOF is intentionally supplied later.
	socket.packet(frame("chunk"))
	socket.packet(frame("complete"))
	time.Sleep(10 * time.Millisecond)
	source.end()
	take(t, next(input, deadline(t)))
	_, err := input.Next(deadline(t))
	if err == nil {
		t.Fatal("relabeled premature completion")
	}
	equal(t, err.Error(), "Smallest.ai completed before input ended")
}

type stalledBody struct {
	reading, closed chan struct{}
	once            sync.Once
}

func (b *stalledBody) Read([]byte) (int, error) {
	close(b.reading)
	<-b.closed
	return 0, io.ErrClosedPipe
}
func (b *stalledBody) Close() error { b.once.Do(func() { close(b.closed) }); return nil }

func TestBodyReadCancellationAndConsumerClose(t *testing.T) {
	for _, mode := range []string{"parent", "next", "close", "deadline"} {
		t.Run(mode, func(t *testing.T) {
			parent, cancelParent := context.WithCancel(deadline(t))
			defer cancelParent()
			nextContext, cancelNext := context.WithCancel(deadline(t))
			defer cancelNext()
			b := &stalledBody{reading: make(chan struct{}), closed: make(chan struct{})}
			options := Options{Auth: authenticated(), Transport: transportFunc(func(*http.Request) (*http.Response, error) { return &http.Response{StatusCode: 200, Body: b}, nil })}
			if mode == "deadline" {
				options.TimeoutMs = runtime.Some(int64(20))
			}
			input, err := Synthesize(parent, request(), options)
			if err != nil {
				t.Fatal(err)
			}
			defer input.Close()
			pending := next(input, nextContext)
			await(t, b.reading)
			switch mode {
			case "parent":
				cancelParent()
			case "next":
				cancelNext()
			case "close":
				input.Close()
			}
			want := context.Canceled
			if mode == "deadline" {
				want = context.DeadlineExceeded
			}
			equal(t, takeResult(t, pending).err, want)
			await(t, b.closed)
		})
	}
}

type uncooperative struct{ started, release, closed chan struct{} }

func (p *uncooperative) Next(context.Context) (string, error) {
	close(p.started)
	<-p.release
	return "", io.EOF
}
func (p *uncooperative) Close() error { <-p.release; close(p.closed); return nil }

func TestUncooperativeProducerCannotHoldTransportClose(t *testing.T) {
	source := &uncooperative{started: make(chan struct{}), release: make(chan struct{}), closed: make(chan struct{})}
	socket := newSocket()
	input := start(t, liveRequest(source), Options{WebSocket: socket})
	pending := next(input, deadline(t))
	await(t, source.started)
	finished := make(chan struct{})
	go func() { input.Close(); close(finished) }()
	await(t, finished)
	await(t, socket.closed)
	equal(t, takeResult(t, pending).err, context.Canceled)
	close(source.release)
	await(t, source.closed)
}

func TestInputAndHTTPFailuresPreserveIdentity(t *testing.T) {
	failure := errors.New("original failure")
	source := newProducer[string]()
	source.items <- production[string]{err: failure}
	socket := newSocket()
	input := start(t, liveRequest(source), Options{WebSocket: socket})
	_, err := input.Next(deadline(t))
	equal(t, err, failure)
	equal(t, len(socket.sent), 0)
	input = start(t, request(), Options{Transport: transportFunc(func(*http.Request) (*http.Response, error) { return nil, failure })})
	_, err = input.Next(deadline(t))
	equal(t, err, failure)
	b := &body{chunks: [][]byte{{1, 2}}, failure: failure}
	input = start(t, request(), Options{Protocol: "http", Transport: transportFunc(func(*http.Request) (*http.Response, error) { return &http.Response{StatusCode: 200, Body: b}, nil })})
	items, err := collect(deadline(t), input)
	equal(t, err, failure)
	equal(t, items, []out.SynthesisItem{out.SynthesisItemAsBytes{Value: []byte{1, 2}}})
	equal(t, b.closes.Load(), int32(1))
}

func TestScopedAndExplicitAuthPrecedence(t *testing.T) {
	t.Setenv("SMALLEST_API_KEY", "legacy")
	t.Setenv("SPEECHSWITCH_SMALLEST_API_KEY", "scoped")
	for _, explicit := range []bool{false, true} {
		t.Run(fmt.Sprint(explicit), func(t *testing.T) {
			options := Options{Protocol: "http", Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
				want := "Bearer scoped"
				if explicit {
					want = "Bearer fixture"
				}
				equal(t, r.Header.Get("Authorization"), want)
				return &http.Response{StatusCode: 200, Body: &body{chunks: [][]byte{{1}}}}, nil
			})}
			if explicit {
				options.Auth = authenticated()
			}
			input, err := Synthesize(deadline(t), request(), options)
			if err != nil {
				t.Fatal(err)
			}
			defer input.Close()
			_, err = collect(deadline(t), input)
			if err != nil {
				t.Fatal(err)
			}
		})
	}
}
