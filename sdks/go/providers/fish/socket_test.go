package fish

import (
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"testing"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/fish"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func TestSocketProtocolAndUnknownEvents(t *testing.T) {
	src := newSource(text("hello"), schema.TtsRequestS1StreamingTextTextItemAsFlush{}, text("world"))
	ws := newSocket()
	ws.emit(map[string]any{"event": "future-event", "payload": true})
	stream, err := Synthesize(testContext(t), streaming(src), Options{WebSocket: ws})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	equal(t, src.reads.Load(), int32(0))
	equal(t, len(ws.messages()), 0)
	items, err := collect(testContext(t), stream)
	if err != nil {
		t.Fatal(err)
	}
	equal(t, items, []any{[]byte{0, 255}, []byte{0, 255}})
	wire := loadFixtures(t).Defaults
	wire["text"] = ""
	equal(t, ws.messages(), []map[string]any{{"event": "start", "request": wire}, {"event": "text", "text": "hello"}, {"event": "flush"}, {"event": "text", "text": "world"}, {"event": "stop"}})
	equal(t, src.closes.Load(), int32(1))
	equal(t, ws.closes.Load(), int32(1))
}

func TestSocketBlockedWriteDoesNotBlockAudioOrPrefetchInput(t *testing.T) {
	src := newSource(text("hello"), text("must not be pulled"))
	ws := newSocket()
	sent := make(chan struct{})
	released := make(chan struct{})
	ws.onSend = func(ctx context.Context, fields map[string]any) error {
		if fields["event"] == "text" {
			close(sent)
			ws.emit(map[string]any{"event": "audio", "audio": []byte{7}})
			<-ctx.Done()
			close(released)
			return ctx.Err()
		}
		return nil
	}
	stream, err := Synthesize(testContext(t), streaming(src), Options{WebSocket: ws})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	item, err := stream.Next(testContext(t))
	if err != nil {
		t.Fatal(err)
	}
	wait(t, sent)
	equal(t, normalized(item), []byte{7})
	equal(t, src.reads.Load(), int32(1))
	stream.Close()
	wait(t, released)
}

func TestSocketCancellationAndUnreadClose(t *testing.T) {
	for _, mode := range []string{"unread", "parent", "next", "idle"} {
		t.Run(mode, func(t *testing.T) {
			ctx, cancel := context.WithCancel(testContext(t))
			defer cancel()
			src := newSource()
			src.stall = true
			ws := newSocket()
			events := &trace{}
			src.trace = events
			ws.trace = events
			stream, err := Synthesize(ctx, streaming(src), Options{WebSocket: ws})
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Close()
			if mode == "unread" {
				stream.Close()
				equal(t, src.reads.Load(), int32(0))
				equal(t, len(ws.messages()), 0)
			} else if mode == "idle" {
				cancel()
				wait(t, src.done)
			} else {
				next, cancelNext := context.WithCancel(testContext(t))
				defer cancelNext()
				finished := make(chan error, 1)
				go func() { _, err := stream.Next(next); finished <- err }()
				wait(t, src.waiting)
				if mode == "parent" {
					cancel()
				} else {
					cancelNext()
				}
				equal(t, <-finished, context.Canceled)
			}
			equal(t, events.values(), []string{"socket", "input"})
			equal(t, ws.closes.Load(), int32(1))
			equal(t, src.closes.Load(), int32(1))
		})
	}
}

type slowCloseInput struct {
	*source
	closing, release chan struct{}
}

func (s *slowCloseInput) Close() error { close(s.closing); <-s.release; return s.source.Close() }
func TestSocketClosesBeforeSlowProducerCleanup(t *testing.T) {
	src := &slowCloseInput{source: newSource(), closing: make(chan struct{}), release: make(chan struct{})}
	ws := newSocket()
	stream, err := Synthesize(testContext(t), streaming(src), Options{WebSocket: ws})
	if err != nil {
		t.Fatal(err)
	}
	finished := make(chan struct{})
	go func() { stream.Close(); close(finished) }()
	wait(t, src.closing)
	equal(t, ws.closes.Load(), int32(1))
	close(src.release)
	wait(t, finished)
}

func TestSocketFailuresKeepOriginalError(t *testing.T) {
	sentinel := errors.New("original operation failed")
	for _, mode := range []string{"producer", "send", "receive", "invalid-input", "early-finish", "transport-eof", "provider"} {
		t.Run(mode, func(t *testing.T) {
			src := newSource()
			src.stall = true
			ws := newSocket()
			ws.closeError = errors.New("cleanup failed")
			want := sentinel.Error()
			switch mode {
			case "producer":
				src.err = sentinel
			case "send":
				ws.onSend = func(context.Context, map[string]any) error { return sentinel }
			case "receive":
				ws.incoming <- socketResultTest{err: sentinel}
			case "invalid-input":
				src.values = []Input{nil}
				want = "Invalid fish TTS input item"
			case "early-finish":
				ws.emit(map[string]any{"event": "finish", "reason": "stop"})
				want = "Fish finished before the input stream ended"
			case "transport-eof":
				ws.incoming <- socketResultTest{err: io.EOF}
				want = "Fish WebSocket closed before session completion"
			case "provider":
				ws.emit(map[string]any{"event": "finish", "reason": "error"})
				want = "Fish 0: Streaming synthesis failed"
			}
			stream, err := Synthesize(testContext(t), streaming(src), Options{WebSocket: ws})
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Close()
			_, err = stream.Next(testContext(t))
			if err == nil {
				t.Fatal("expected failure")
			}
			equal(t, err.Error(), want)
			if mode == "producer" || mode == "send" || mode == "receive" {
				equal(t, err, sentinel)
			}
			equal(t, ws.closes.Load(), int32(1))
			equal(t, src.closes.Load(), int32(1))
		})
	}
}

func TestSocketEmptyInputAndMessageBounds(t *testing.T) {
	src := newSource()
	ws := newSocket()
	stream, err := Synthesize(testContext(t), streaming(src), Options{WebSocket: ws})
	if err != nil {
		t.Fatal(err)
	}
	items, err := collect(testContext(t), stream)
	stream.Close()
	if err != nil {
		t.Fatal(err)
	}
	equal(t, items, []any{})
	equal(t, len(ws.messages()), 2)
	src = newSource()
	ws = newSocket()
	stream, err = Synthesize(testContext(t), streaming(src), Options{WebSocket: ws, MaxMessageBytes: 1})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	_, err = stream.Next(testContext(t))
	equal(t, err.Error(), "Fish message exceeds MaxMessageBytes")
	equal(t, len(ws.messages()), 0)
	equal(t, src.reads.Load(), int32(0))
}

func TestSocketPacketValidation(t *testing.T) {
	for _, value := range []any{nil, map[string]any{}, map[string]any{"event": "audio", "audio": "base64"}, map[string]any{"event": "finish", "reason": "unknown"}} {
		encoded, err := runtime.EncodeMessagePack(value)
		if err != nil {
			t.Fatal(err)
		}
		_, err = decodePacket(runtime.WebSocketBinary(encoded), 4096)
		if err == nil {
			t.Fatalf("accepted %#v", value)
		}
		equal(t, err.Error(), "Fish returned an invalid WebSocket event")
	}
	_, err := decodePacket(runtime.WebSocketText("{}"), 4096)
	equal(t, err.Error(), "Fish returned a non-binary WebSocket frame")
	_, err = decodePacket(runtime.WebSocketBinary{0x80}, 0)
	equal(t, err.Error(), "Fish message exceeds MaxMessageBytes")
}

func TestRequestValidationAndSnapshotsBeforeIO(t *testing.T) {
	ws := newSocket()
	src := newSource()
	for _, r := range []schema.TtsRequest{nil, (*schema.TtsRequestAsTextVoice)(nil), schema.TtsRequestAsTextVoice{}} {
		_, err := Synthesize(testContext(t), r, Options{WebSocket: ws})
		if err == nil {
			t.Fatal("accepted invalid request")
		}
		equal(t, err.Error(), "Invalid fish TTS request")
	}
	r := streaming(src)
	r.Value.TextChunkLength = runtime.Some(100.5)
	_, err := Synthesize(testContext(t), r, Options{WebSocket: ws})
	equal(t, err.Error(), "Invalid fish TTS request")
	r = streaming(src)
	r.Value.ReferenceSamples = runtime.Some([]schema.TtsRequestS1TextReferenceSamplesItem{{Audio: []byte{}, Text: "voice"}})
	_, err = Synthesize(testContext(t), r, Options{WebSocket: ws})
	equal(t, err.Error(), "Fish reference audio must not be empty")
	equal(t, src.closes.Load(), int32(0))
	equal(t, len(ws.messages()), 0)
	audio := []byte{1, 2}
	features := []string{"original"}
	samples := []schema.TtsRequestS1TextReferenceSamplesItem{{Audio: audio, Text: "original"}}
	r.Value.ReferenceSamples = runtime.Some(samples)
	r.Value.Features = runtime.Some(features)
	stream, err := Synthesize(testContext(t), r, Options{WebSocket: ws})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	audio[0] = 9
	samples[0].Text = "changed"
	features[0] = "changed"
	_, err = collect(testContext(t), stream)
	if err != nil {
		t.Fatal(err)
	}
	wire := ws.messages()[0]["request"].(map[string]any)
	equal(t, wire["references"], []any{map[string]any{"audio": []byte{1, 2}, "text": "original"}})
	equal(t, wire["features"], []any{"original"})
}

func TestConfigurationResolvesBeforeIO(t *testing.T) {
	t.Setenv("FISH_API_KEY", "fallback")
	t.Setenv("SPEECHSWITCH_FISH_API_KEY", "scoped")
	for _, test := range []struct {
		name        string
		auth        auth.Auth
		scoped, key string
	}{
		{"explicit", testAuth, "scoped", "test-key"},
		{"scoped", auth.Auth{}, "scoped", "scoped"},
		{"fallback", auth.Auth{}, "absent", "fallback"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if test.scoped == "absent" {
				if err := os.Unsetenv("SPEECHSWITCH_FISH_API_KEY"); err != nil {
					t.Fatal(err)
				}
			}
			b := &body{}
			stream, err := Synthesize(testContext(t), request(), Options{Auth: test.auth, Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
				equal(t, r.Header.Get("Authorization"), "Bearer "+test.key)
				return &http.Response{StatusCode: 200, Body: b}, nil
			})})
			if err != nil {
				t.Fatal(err)
			}
			stream.Close()
		})
	}
	t.Setenv("SPEECHSWITCH_FISH_API_KEY", "")
	_, err := Synthesize(testContext(t), request(), Options{})
	equal(t, err.Error(), "Missing auth.fish.apiKey configuration")
	for _, options := range []Options{{Auth: testAuth, MaxJSONBytes: -1}, {Auth: testAuth, MaxMessageBytes: -1}} {
		_, err := Synthesize(testContext(t), request(), options)
		equal(t, err.Error(), "Fish byte limits must be positive")
	}
}
