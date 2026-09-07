package gradium

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	schema "github.com/speechswitch/client/sdks/go/generated/gradium"
	out "github.com/speechswitch/client/sdks/go/generated/gradium_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func TestSharedSocketTimelinesAndReservedFlush(t *testing.T) {
	fixtures := loadFixtures(t)
	socket := newSocket()
	socket.onSend = func(_ context.Context, v map[string]any) error {
		if v["type"] == "setup" {
			socket.put(map[string]any{"type": "ready", "request_id": "req"})
			socket.put(map[string]any{"type": "flushed"})
			for _, c := range fixtures.Timeline {
				socket.put(c.Packet)
			}
		}
		if v["type"] == "end_of_stream" {
			socket.put(map[string]any{"type": "end_of_stream"})
		}
		return nil
	}
	r := request()
	r.TimestampGranularity = runtime.Some(schema.TtsRequestTimestampGranularity{})
	r.Lexicon = runtime.Some("dictionary")
	stream, err := Synthesize(context.Background(), r, Options{WebSocket: socket, SetupRetryMs: runtime.Some(int64(250))})
	if err != nil {
		t.Fatal(err)
	}
	items, err := collect(stream)
	if err != nil {
		t.Fatal(err)
	}
	equal(t, len(items), len(fixtures.Timeline))
	for i, item := range items {
		equal(t, fixtureItem(t, item), fixtures.Timeline[i].Item)
	}
	equal(t, socket.messages()[0]["pronunciation_id"], "dictionary")
	equal(t, socket.messages()[0]["retry_for_s"], 0.25)
}

func TestExactMalformedPackets(t *testing.T) {
	for _, c := range []struct {
		value    any
		expected string
	}{
		{nil, "Gradium returned an invalid event"}, {[]any{}, "Gradium returned an invalid event"},
		{map[string]any{"type": "ready"}, "Gradium returned an invalid event"},
		{map[string]any{"type": "mystery"}, "Gradium returned an invalid event"},
		{map[string]any{"type": "error", "message": "bad", "code": true}, "Gradium returned an invalid event"},
		{map[string]any{"type": "audio", "audio": "AA==", "client_req_id": nil}, "Gradium returned an unexpected multiplexed request ID"},
		{map[string]any{"type": "audio", "audio": "AA==", "stream_id": 1.5}, "Gradium returned an invalid stream ID"},
		{map[string]any{"type": "audio", "audio": "AA==", "stream_id": -1}, "Gradium returned an invalid stream ID"},
		{map[string]any{"type": "audio", "audio": "AA==", "start_s": 0}, "Gradium returned an invalid time range"},
		{map[string]any{"type": "text", "text": "Hi", "start_s": 1, "stop_s": 0}, "Gradium returned an invalid time range"},
		{map[string]any{"type": "text", "text": "Hi", "start_s": 0, "stop_s": 1e308}, "Gradium returned an invalid time range"},
		{map[string]any{"type": "audio", "audio": "AA\n=="}, "Gradium returned invalid base64 audio"},
		{map[string]any{"type": "audio", "audio": "%%"}, "Gradium returned invalid base64 audio"},
	} {
		_, _, err := packet(mustJSON(t, c.value), true)
		errorText(t, err, c.expected)
	}
	for _, data := range []string{"{", "{} trailing", "{\"text\":\"\\ud800\"}"} {
		_, _, err := packet([]byte(data), true)
		errorText(t, err, "Gradium returned invalid JSON")
	}
	_, _, err := packet([]byte(`{"type":"error","message":"denied","code":1008}`), false)
	equal(t, err, &Error{Message: "denied", Code: runtime.Some(int64(1008))})
	_, item, err := packet([]byte(`{"type":"audio","audio":"AA==","stream_id":-0}`), true)
	if err != nil {
		t.Fatal(err)
	}
	equal(t, item.(out.SynthesisItemAsTimeline).Value.CorrelationId, runtime.Some("0"))
}

func TestSocketOrderAndOriginalFailures(t *testing.T) {
	ready := map[string]any{"type": "ready", "request_id": "req"}
	for _, c := range []struct {
		events   []any
		expected string
	}{
		{[]any{map[string]any{"type": "audio", "audio": "AA=="}}, "Gradium returned output before ready"},
		{[]any{ready, ready}, "Gradium returned duplicate ready"},
		{[]any{ready, map[string]any{"type": "end_of_stream"}}, "Gradium completed before the input stream ended"},
	} {
		src := newSource()
		src.stall = true
		r := request()
		r.Text = schema.TtsRequestTextAsAsyncIterable{Value: src}
		socket := newSocket()
		socket.onSend = func(context.Context, map[string]any) error {
			for _, v := range c.events {
				socket.put(v)
			}
			return nil
		}
		stream, err := Synthesize(context.Background(), r, Options{WebSocket: socket})
		if err != nil {
			t.Fatal(err)
		}
		_, err = collect(stream)
		errorText(t, err, c.expected)
		wait(t, socket.closed)
		wait(t, src.closed)
	}
	for _, stage := range []string{"input", "send", "receive", "close", "binary"} {
		original := errors.New("original " + stage)
		src := newSource()
		src.stall = true
		r := request()
		r.Text = schema.TtsRequestTextAsAsyncIterable{Value: src}
		socket := newSocket()
		switch stage {
		case "input":
			src.failure = original
		case "send":
			socket.onSend = func(context.Context, map[string]any) error { return original }
		case "receive":
			socket.incoming <- socketResult{err: original}
		case "close":
			socket.incoming <- socketResult{err: io.EOF}
		case "binary":
			socket.incoming <- socketResult{value: runtime.WebSocketBinary{1}}
		}
		stream, err := Synthesize(context.Background(), r, Options{WebSocket: socket})
		if err != nil {
			t.Fatal(err)
		}
		_, err = collect(stream)
		switch stage {
		case "close":
			errorText(t, err, "Gradium WebSocket closed before end_of_stream")
		case "binary":
			errorText(t, err, "Gradium returned a non-text WebSocket frame")
		default:
			if err != original {
				t.Fatalf("%s error identity changed: got %v, want original %v", stage, err, original)
			}
		}
		wait(t, socket.closed)
		wait(t, src.closed)
	}
}

func TestSocketEarlyAudioWithStalledInputOrWrite(t *testing.T) {
	for _, write := range []bool{false, true} {
		src := newSource(text("Hello "))
		src.stall = true
		r := request()
		r.Text = schema.TtsRequestTextAsAsyncIterable{Value: src}
		socket := newSocket()
		socket.onSend = func(ctx context.Context, v map[string]any) error {
			if v["type"] == "setup" {
				socket.put(map[string]any{"type": "ready", "request_id": "req"})
			}
			if v["type"] == "text" {
				socket.put(map[string]any{"type": "audio", "audio": "AP8="})
				if write {
					<-ctx.Done()
					return ctx.Err()
				}
			}
			return nil
		}
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		stream, err := Synthesize(ctx, r, Options{WebSocket: socket})
		if err != nil {
			t.Fatal(err)
		}
		item, err := stream.Next(ctx)
		if err != nil {
			t.Fatal(err)
		}
		equal(t, item, out.SynthesisItemAsBytes{Value: []byte{0, 255}})
		if err := stream.Close(); err != nil {
			t.Fatal(err)
		}
		wait(t, socket.closed)
		wait(t, src.closed)
		cancel()
	}
}

func TestPendingSetupAndEOSDrain(t *testing.T) {
	src := newSource(text("Hello "))
	r := request()
	r.Text = schema.TtsRequestTextAsAsyncIterable{Value: src}
	socket := newSocket()
	writeClosed := make(chan struct{})
	socket.onSend = func(ctx context.Context, _ map[string]any) error {
		socket.put(map[string]any{"type": "error", "message": "unavailable", "code": 1013})
		<-ctx.Done()
		close(writeClosed)
		return ctx.Err()
	}
	stream, err := Synthesize(context.Background(), r, Options{WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	_, err = collect(stream)
	equal(t, err, &Error{Message: "unavailable", Code: runtime.Some(int64(1013))})
	equal(t, src.reads.Load(), int32(0))
	wait(t, writeClosed)
	wait(t, src.closed)
	socket = newSocket()
	socket.onSend = func(ctx context.Context, v map[string]any) error {
		if v["type"] == "setup" {
			socket.put(map[string]any{"type": "ready", "request_id": "req"})
		}
		if v["type"] == "end_of_stream" {
			socket.put(map[string]any{"type": "end_of_stream"})
			<-ctx.Done()
			return ctx.Err()
		}
		return nil
	}
	stream, err = Synthesize(context.Background(), request(), Options{WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	_, err = collect(stream)
	if err != nil {
		t.Fatal(err)
	}
	wait(t, socket.closed)
}

func TestUncooperativeInputAndCleanupNeverDelayClose(t *testing.T) {
	for _, blockedNext := range []bool{false, true} {
		entered, release := make(chan struct{}), make(chan struct{})
		src := newSource(text("Hello "))
		src.stall = true
		if blockedNext {
			src.nextFn = func(context.Context) (Input, error) { close(entered); <-release; return nil, io.EOF }
		} else {
			src.closeFn = func() { close(entered); <-release }
		}
		r := request()
		r.Text = schema.TtsRequestTextAsAsyncIterable{Value: src}
		socket := newSocket()
		stream, err := Synthesize(context.Background(), r, Options{WebSocket: socket})
		if err != nil {
			t.Fatal(err)
		}
		next := make(chan error, 1)
		go func() { _, err := stream.Next(context.Background()); next <- err }()
		if blockedNext {
			wait(t, entered)
		} else {
			select {
			case err := <-next:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(time.Second):
				t.Fatal("no audio")
			}
		}
		closed := make(chan struct{})
		go func() { stream.Close(); close(closed) }()
		wait(t, closed)
		wait(t, socket.closed)
		if !blockedNext {
			wait(t, entered)
		}
		close(release)
		wait(t, src.closed)
		equal(t, src.closes.Load(), int32(1))
		if blockedNext {
			select {
			case err := <-next:
				equal(t, err, io.EOF)
			case <-time.After(time.Second):
				t.Fatal("Next did not end")
			}
		}
	}
}

func TestSocketCancellationAndUnreadClose(t *testing.T) {
	for _, parent := range []bool{false, true} {
		ctx, cancel := context.WithCancel(context.Background())
		requestCtx := context.Background()
		nextCtx := ctx
		if parent {
			requestCtx = ctx
			nextCtx = context.Background()
		}
		src := newSource()
		src.stall = true
		r := request()
		r.Text = schema.TtsRequestTextAsAsyncIterable{Value: src}
		socket := newSocket()
		stream, err := Synthesize(requestCtx, r, Options{WebSocket: socket})
		if err != nil {
			t.Fatal(err)
		}
		next := make(chan error, 1)
		go func() { _, err := stream.Next(nextCtx); next <- err }()
		wait(t, src.waiting)
		cancel()
		select {
		case err := <-next:
			equal(t, err, context.Canceled)
		case <-time.After(time.Second):
			t.Fatal("cancel stalled")
		}
		wait(t, socket.closed)
		wait(t, src.closed)
	}
	src := newSource()
	r := request()
	r.Text = schema.TtsRequestTextAsAsyncIterable{Value: src}
	socket := newSocket()
	stream, err := Synthesize(context.Background(), r, Options{WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	stream.Close()
	wait(t, src.closed)
	equal(t, src.reads.Load(), int32(0))
	equal(t, len(socket.messages()), 0)
	ctx, cancel := context.WithCancel(context.Background())
	socket = newSocket()
	stream, err = Synthesize(ctx, request(), Options{WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	cancel()
	wait(t, socket.closed)
	stream.Close()
}

func TestSocketBoundsAndFairInput(t *testing.T) {
	for _, c := range []struct {
		text     string
		limit    int
		expected string
	}{{"Hello ", 1, "Gradium message exceeds MaxMessageBytes"}, {strings.Repeat("x", 1025), 1024, "Gradium text buffer exceeds MaxMessageBytes"}, {strings.Repeat("\x00", 200) + " ", 1024, "Gradium message exceeds MaxMessageBytes"}} {
		src := newSource(text(c.text))
		r := request()
		r.Text = schema.TtsRequestTextAsAsyncIterable{Value: src}
		socket := newSocket()
		stream, err := Synthesize(context.Background(), r, Options{WebSocket: socket, MaxMessageBytes: c.limit})
		if err != nil {
			t.Fatal(err)
		}
		_, err = collect(stream)
		errorText(t, err, c.expected)
		wait(t, src.closed)
	}
	socket := newSocket()
	socket.incoming <- socketResult{value: runtime.WebSocketText(strings.Repeat("é", 513))}
	stream, err := Synthesize(context.Background(), request(), Options{WebSocket: socket, MaxMessageBytes: 1024})
	if err != nil {
		t.Fatal(err)
	}
	_, err = collect(stream)
	errorText(t, err, "Gradium message exceeds MaxMessageBytes")
	src := newSource()
	src.nextFn = func(context.Context) (Input, error) { return text("Hello "), nil }
	r := request()
	r.Text = schema.TtsRequestTextAsAsyncIterable{Value: src}
	socket = newSocket()
	socket.onSend = func(_ context.Context, v map[string]any) error {
		if v["type"] == "setup" {
			socket.put(map[string]any{"type": "ready", "request_id": "req"})
		}
		if v["type"] == "text" {
			socket.put(map[string]any{"type": "error", "message": "stop", "code": 1008})
		}
		return nil
	}
	stream, err = Synthesize(context.Background(), r, Options{WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	_, err = collect(stream)
	equal(t, err, &Error{Message: "stop", Code: runtime.Some(int64(1008))})
	if src.reads.Load() > 20 {
		t.Fatalf("producer starved receive: %d", src.reads.Load())
	}
	wait(t, src.closed)
}
