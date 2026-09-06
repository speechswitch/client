package deepgram

import (
	"context"
	"errors"
	schema "github.com/speechswitch/client/sdks/go/generated/deepgram"
	out "github.com/speechswitch/client/sdks/go/generated/deepgram_output"
	"github.com/speechswitch/client/sdks/go/runtime"
	"io"
	"testing"
	"time"
)

func TestProtocolFailuresAndLimits(t *testing.T) {
	for _, tc := range []struct {
		frame string
		want  string
	}{
		{`null`, "Deepgram returned an invalid WebSocket event"},
		{`{`, "Deepgram returned invalid JSON"},
		{`{"type":"Flushed","sequence_id":true}`, "Deepgram returned an invalid WebSocket event"},
		{`{"type":"Flushed","sequence_id":-1}`, "Deepgram returned an invalid WebSocket event"},
		{`{"type":"Cleared","sequence_id":0.5}`, "Deepgram returned an invalid WebSocket event"},
		{`{"type":"Flushed","sequence_id":9007199254740992}`, "Deepgram returned an invalid WebSocket event"},
		{`{"type":"Metadata","request_id":"\ud800"}`, "Deepgram returned invalid JSON"},
		{`{"type":"Warning","code":"limit","description":"wait"}`, "Deepgram Warning limit: wait"},
		{`{"type":"Error","code":1,"description":"wait"}`, "Deepgram returned an invalid error event"},
		{`{"type":"Flushed","sequence_id":0}`, "Unexpected Deepgram Flushed acknowledgement"},
		{`{"type":"Cleared","sequence_id":0}`, "Unexpected Deepgram Cleared acknowledgement"},
	} {
		source := newSource()
		source.stall = true
		socket := newSocket()
		socket.incoming <- socketResult{value: runtime.WebSocketText(tc.frame)}
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		s, err := Synthesize(ctx, live(source), Options{Auth: testAuth, WebSocket: socket})
		if err != nil {
			t.Fatal(err)
		}
		_, err = s.Next(context.Background())
		if err == nil || err.Error() != tc.want {
			t.Fatal(tc.frame, err)
		}
		if _, err = s.Next(context.Background()); err != io.EOF {
			t.Fatal(err)
		}
		if socket.closes.Load() != 1 || source.closes.Load() != 1 {
			t.Fatal("leaked resources")
		}
		cancel()
	}
	for _, outgoing := range []bool{false, true} {
		source := newSource()
		source.stall = true
		socket := newSocket()
		if outgoing {
			source.values = []Input{schema.TtsRequestAura1StreamingTextVoiceTextItemAsString{Value: "long"}}
		} else {
			socket.incoming <- socketResult{value: runtime.WebSocketBinary{1, 2, 3, 4, 5}}
		}
		s, err := Synthesize(context.Background(), live(source), Options{Auth: testAuth, WebSocket: socket, MaxMessageBytes: 4})
		if err != nil {
			t.Fatal(err)
		}
		_, err = s.Next(context.Background())
		if err == nil || err.Error() != "Deepgram message exceeds MaxMessageBytes" {
			t.Fatal(err)
		}
	}
}

func TestPendingWritesDoNotBlockAudioAndCancellationCloses(t *testing.T) {
	source := newSource(schema.TtsRequestAura1StreamingTextVoiceTextItemAsString{Value: "Hello"})
	source.stall = true
	socket := newSocket()
	sendDone := make(chan struct{})
	socket.onSend = func(ctx context.Context, _ map[string]string) error {
		defer close(sendDone)
		socket.incoming <- socketResult{value: runtime.WebSocketBinary{0, 255}}
		<-ctx.Done()
		return ctx.Err()
	}
	s, err := Synthesize(context.Background(), live(source), Options{Auth: testAuth, WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	v, err := s.Next(ctx)
	if err != nil {
		t.Fatal(err)
	}
	equalJSON(t, canonical(v), []int{0, 255})
	if source.pulls.Load() != 1 {
		t.Fatal("prefetched through pending send")
	}
	s.Close()
	wait(t, sendDone)
	if socket.closes.Load() != 1 || source.closes.Load() != 1 {
		t.Fatal("not closed")
	}
}

func TestUnreadIdleAndNextCancellation(t *testing.T) {
	for _, phase := range []string{"unread", "idle", "next"} {
		source := newSource()
		source.stall = true
		socket := newSocket()
		socket.incoming <- socketResult{value: runtime.WebSocketBinary{1}}
		operation, cancel := context.WithCancel(context.Background())
		s, err := Synthesize(operation, live(source), Options{Auth: testAuth, WebSocket: socket})
		if err != nil {
			t.Fatal(err)
		}
		if phase == "unread" {
			s.Close()
			if source.pulls.Load() != 0 {
				t.Fatal("eager input")
			}
		} else {
			if _, err = s.Next(context.Background()); err != nil {
				t.Fatal(err)
			}
			if phase == "idle" {
				cancel()
				_, err = s.Next(context.Background())
			} else {
				ctx, stop := context.WithCancel(context.Background())
				stop()
				_, err = s.Next(ctx)
			}
			if !errors.Is(err, context.Canceled) {
				t.Fatal(err)
			}
		}
		s.Close()
		cancel()
		if source.closes.Load() != 1 || socket.closes.Load() != 1 {
			t.Fatal("resources leaked")
		}
	}
}

func TestOriginalInputSendReceiveErrorsAndInvalidItems(t *testing.T) {
	original := errors.New("original")
	for _, phase := range []string{"input", "send", "receive", "close", "item"} {
		source := newSource()
		source.stall = true
		socket := newSocket()
		switch phase {
		case "input":
			source.failure = original
		case "send":
			source.values = []Input{schema.TtsRequestAura1StreamingTextVoiceTextItemAsString{Value: "Hello"}}
			socket.onSend = func(context.Context, map[string]string) error { return original }
		case "receive":
			socket.incoming <- socketResult{err: original}
		case "close":
			socket.incoming <- socketResult{err: io.EOF}
		case "item":
			var item *schema.TtsRequestAura1StreamingTextVoiceTextItemAsClear
			source.values = []Input{item}
		}
		s, err := Synthesize(context.Background(), live(source), Options{Auth: testAuth, WebSocket: socket})
		if err != nil {
			t.Fatal(err)
		}
		_, err = s.Next(context.Background())
		if phase == "close" {
			if err == nil || err.Error() != "Deepgram WebSocket closed before input or pending synthesis completed" {
				t.Fatal(err)
			}
		} else if phase == "item" {
			if err == nil || err.Error() != "Invalid deepgram TTS input item" {
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

func TestReturnedAudioDoesNotAliasInjectedFrames(t *testing.T) {
	bytes := runtime.WebSocketBinary{0, 255}
	source := newSource()
	source.stall = true
	socket := newSocket()
	socket.incoming <- socketResult{value: bytes}
	s, err := Synthesize(context.Background(), live(source), Options{Auth: testAuth, WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	item, err := s.Next(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	bytes[0] = 42
	if item.(out.SynthesisItemAsBytes).Value[0] != 0 {
		t.Fatal("aliased receive buffer")
	}
}
