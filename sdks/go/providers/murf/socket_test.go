package murf

import (
	"context"
	"errors"
	schema "github.com/speechswitch/client/sdks/go/generated/murf"
	out "github.com/speechswitch/client/sdks/go/generated/murf_output"
	"github.com/speechswitch/client/sdks/go/runtime"
	"io"
	"strings"
	"testing"
	"time"
)

func TestSocketLiveUpdatesFlushAndNativeContextIdentity(t *testing.T) {
	socket := newSocket()
	input := newSource(text("Hello"), schema.TtsRequestStreamingTextVoiceTextItemAsUpdate{Value: schema.TtsRequestStreamingTextVoiceTextItemUpdate{
		Voice: runtime.Some("custom"), VoiceStyle: runtime.Some(""), Language: runtime.Some("en-US"), SpeedBias: runtime.Some(float64(0)), PitchBias: runtime.Some(float64(-5)), MaxBufferDelayMs: runtime.Some(float64(0)),
	}}, schema.TtsRequestStreamingTextVoiceTextItemAsFlush{}, text("Again"))
	stream, err := Synthesize(context.Background(), streaming(input), Options{WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	actual := collect(t, stream)
	sent := socket.messages()
	id := sent[1]["context_id"].(string)
	next := sent[5]["context_id"].(string)
	equal(t, sent, []map[string]any{
		{"min_buffer_size": float64(40), "max_buffer_delay_in_ms": float64(300)},
		{"context_id": id, "text": "Hello", "voice_config": map[string]any{"voice_id": "existing-voice", "rate": float64(0), "pitch": float64(0)}},
		{"context_id": id, "voice_config": map[string]any{"voice_id": "custom", "style": "", "locale": "en-US", "rate": float64(0), "pitch": float64(-5)}},
		{"max_buffer_delay_in_ms": float64(0)}, {"context_id": id, "text": "", "end": true},
		{"context_id": next, "text": "Again", "voice_config": map[string]any{"voice_id": "custom", "style": "", "locale": "en-US", "rate": float64(0), "pitch": float64(-5)}},
		{"context_id": next, "text": "", "end": true},
	})
	if id == next {
		t.Fatal("context reused")
	}
	equal(t, actual, []out.SynthesisItem{
		out.SynthesisItemAsOrderedOrTimeline{Value: out.MurfEnvelope{Correlation: out.MurfEnvelopeCorrelationAsOrdered{}, CorrelationId: runtime.Some(id), Audio: runtime.Some([]byte{0, 255, 128}), Timestamps: []out.MurfTimestamp{}}},
		out.SynthesisItemAsFlush{Value: out.FlushEvent{CorrelationId: id, InputGroupId: id}},
		out.SynthesisItemAsOrderedOrTimeline{Value: out.MurfEnvelope{Correlation: out.MurfEnvelopeCorrelationAsOrdered{}, CorrelationId: runtime.Some(next), Audio: runtime.Some([]byte{0, 255, 128}), Timestamps: []out.MurfTimestamp{}}},
		out.SynthesisItemAsDone{},
	})
	wait(t, input.closed)
	equal(t, input.closes.Load(), int32(1))
	equal(t, socket.closes.Load(), int32(1))
}
func TestClearEscapesPendingFlushAndDiscardsLateCanceledMessages(t *testing.T) {
	socket := newSocket()
	replacement := ""
	socket.hook = func(ctx context.Context, v map[string]any) error {
		if v["text"] == "replacement" {
			replacement = v["context_id"].(string)
			socket.packet(map[string]any{"context_id": replacement, "audio": "AP+A"})
		}
		if v["clear"] == true {
			socket.packet(map[string]any{"context_id": v["context_id"], "audio": "3q0=", "final": true})
		}
		if v["end"] == true && v["context_id"] == replacement {
			socket.packet(map[string]any{"context_id": replacement, "final": true})
		}
		return nil
	}
	input := newSource(text("old"), schema.TtsRequestStreamingTextVoiceTextItemAsFlush{}, schema.TtsRequestStreamingTextVoiceTextItemAsClear{}, text("replacement"))
	stream, err := Synthesize(context.Background(), streaming(input), Options{WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	actual := collect(t, stream)
	equal(t, actual, []out.SynthesisItem{out.SynthesisItemAsClear{}, out.SynthesisItemAsOrderedOrTimeline{Value: out.MurfEnvelope{Correlation: out.MurfEnvelopeCorrelationAsOrdered{}, CorrelationId: runtime.Some(replacement), Audio: runtime.Some([]byte{0, 255, 128}), Timestamps: []out.MurfTimestamp{}}}, out.SynthesisItemAsDone{}})
}
func TestInputErrorEscapesUnacknowledgedFlush(t *testing.T) {
	original := errors.New("producer failed")
	input := newSource(text("Hi"), schema.TtsRequestStreamingTextVoiceTextItemAsFlush{})
	input.failure = original
	socket := newSocket()
	socket.hook = func(context.Context, map[string]any) error { return nil }
	stream, err := Synthesize(context.Background(), streaming(input), Options{WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, err = stream.Next(ctx)
	equal(t, err, original)
	wait(t, input.closed)
	equal(t, socket.closes.Load(), int32(1))
}
func TestFinalCannotHideFailedEndWrite(t *testing.T) {
	original := errors.New("end failed")
	entered, release := make(chan struct{}), make(chan struct{})
	socket := newSocket()
	socket.hook = func(ctx context.Context, v map[string]any) error {
		if v["text"] == "Hi" {
			socket.packet(map[string]any{"context_id": v["context_id"], "audio": "AP+A"})
		}
		if v["end"] == true {
			socket.packet(map[string]any{"context_id": v["context_id"], "final": true})
			close(entered)
			select {
			case <-release:
				return original
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		return nil
	}
	stream, err := Synthesize(context.Background(), streaming(newSource(text("Hi"), schema.TtsRequestStreamingTextVoiceTextItemAsFlush{})), Options{WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	_, err = stream.Next(context.Background())
	equal(t, err, nil)
	result := make(chan error, 1)
	go func() { _, err := stream.Next(context.Background()); result <- err }()
	wait(t, entered)
	close(release)
	select {
	case err := <-result:
		equal(t, err, original)
	case <-time.After(time.Second):
		t.Fatal("end failure hidden")
	}
}
func TestClearEventPrecedesBlockedNativeClearWrite(t *testing.T) {
	entered := make(chan struct{})
	socket := newSocket()
	socket.hook = func(ctx context.Context, v map[string]any) error {
		if v["clear"] == true {
			close(entered)
			<-ctx.Done()
			return ctx.Err()
		}
		return nil
	}
	input := newSource(text("Hi"), schema.TtsRequestStreamingTextVoiceTextItemAsClear{})
	stream, err := Synthesize(context.Background(), streaming(input), Options{WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	value, err := stream.Next(context.Background())
	equal(t, err, nil)
	equal(t, value, out.SynthesisItemAsClear{})
	result := make(chan error, 1)
	go func() { _, err := stream.Next(context.Background()); result <- err }()
	wait(t, entered)
	stream.Close()
	select {
	case err := <-result:
		equal(t, err, io.EOF)
	case <-time.After(time.Second):
		t.Fatal("clear write held Next")
	}
	wait(t, input.closed)
}
func TestMalformedSocketResponsesAndContextCompletion(t *testing.T) {
	for _, tc := range []struct {
		value runtime.WebSocketMessage
		want  string
	}{
		{runtime.WebSocketBinary{0}, "Murf returned a non-text WebSocket message"},
		{runtime.WebSocketText("{"), "Murf returned invalid JSON"},
		{runtime.WebSocketText("[]"), "Murf returned an invalid response object"},
		{runtime.WebSocketText(`{"context_id":""}`), "Murf returned audio or completion without the requested context ID"},
		{runtime.WebSocketText(`{"context_id":"x","final":1}`), "Murf returned an invalid final flag"},
		{runtime.WebSocketText(`{"context_id":"x"}`), "Murf returned an unsupported WebSocket message"},
		{runtime.WebSocketText(`{"context_id":"x","audio":"!!!"}`), "Murf returned invalid base64 audio"},
		{runtime.WebSocketText(`{"context_id":"x","audio":"AQ=="}`), "Murf returned an unknown context ID"},
	} {
		socket := newSocket()
		socket.incoming <- socketMessage{value: tc.value}
		socket.hook = func(context.Context, map[string]any) error { return nil }
		stream, err := Synthesize(context.Background(), streaming(newSource(text("Hi"))), Options{WebSocket: socket})
		if err != nil {
			t.Fatal(err)
		}
		_, err = stream.Next(context.Background())
		errorText(t, err, tc.want)
		equal(t, socket.closes.Load(), int32(1))
	}
	for _, premature := range []bool{false, true} {
		input := newSource(text("Hi"))
		input.stall = premature
		socket := newSocket()
		socket.hook = func(ctx context.Context, v map[string]any) error {
			if (premature && v["text"] == "Hi") || (!premature && v["end"] == true) {
				socket.packet(map[string]any{"context_id": v["context_id"], "final": true})
			}
			return nil
		}
		stream, err := Synthesize(context.Background(), streaming(input), Options{WebSocket: socket})
		if err != nil {
			t.Fatal(err)
		}
		_, err = stream.Next(context.Background())
		want := "Murf completed a context without audio"
		if premature {
			want = "Murf completed a context before its text ended"
		}
		errorText(t, err, want)
	}
}

func TestOutOfOrderContextsRetainNativeAudioAssociation(t *testing.T) {
	socket := newSocket()
	ids := []string{}
	socket.hook = func(ctx context.Context, v map[string]any) error {
		if value, ok := v["text"].(string); ok && value != "" {
			ids = append(ids, v["context_id"].(string))
		}
		if v["end"] == true && len(ids) == 3 {
			for _, index := range []int{2, 0, 1} {
				socket.packet(map[string]any{"context_id": ids[index], "audio": "AQ==", "final": true})
			}
		}
		return nil
	}
	input := newSource(text("one"), schema.TtsRequestStreamingTextVoiceTextItemAsFlush{}, text("two"), schema.TtsRequestStreamingTextVoiceTextItemAsFlush{}, text("three"))
	stream, err := Synthesize(context.Background(), streaming(input), Options{WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	actual := collect(t, stream)
	audioIDs, flushIDs := []string{}, []string{}
	for _, item := range actual {
		switch v := item.(type) {
		case out.SynthesisItemAsOrderedOrTimeline:
			audioIDs = append(audioIDs, v.Value.CorrelationId.Value)
			equal(t, v.Value.Audio, runtime.Some([]byte{1}))
		case out.SynthesisItemAsFlush:
			flushIDs = append(flushIDs, v.Value.CorrelationId)
			equal(t, v.Value.InputGroupId, v.Value.CorrelationId)
		}
	}
	equal(t, audioIDs, []string{ids[2], ids[0], ids[1]})
	equal(t, flushIDs, []string{ids[0], ids[1]})
	equal(t, actual[len(actual)-1], out.SynthesisItemAsDone{})
}

func TestSocketMessageCapsApplyToInjectedReadsAndWrites(t *testing.T) {
	for _, incoming := range []bool{false, true} {
		socket := newSocket()
		socket.hook = func(context.Context, map[string]any) error { return nil }
		input := newSource(text("Hi"))
		limit := 60
		if incoming {
			input = newSource()
			input.stall = true
			socket.incoming <- socketMessage{value: runtime.WebSocketText(strings.Repeat("x", 61))}
		}
		stream, err := Synthesize(context.Background(), streaming(input), Options{WebSocket: socket, MaxMessageBytes: limit})
		if err != nil {
			t.Fatal(err)
		}
		_, err = stream.Next(context.Background())
		errorText(t, err, "Murf message exceeds MaxMessageBytes")
		equal(t, socket.closes.Load(), int32(1))
		wait(t, input.closed)
		if !incoming {
			equal(t, len(socket.messages()), 1)
		}
	}
}
