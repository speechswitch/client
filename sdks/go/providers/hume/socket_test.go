package hume

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"testing"

	schema "github.com/speechswitch/client/sdks/go/generated/hume"
	out "github.com/speechswitch/client/sdks/go/generated/hume_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func TestSocketModelsMatchSharedUtterances(t *testing.T) {
	f := loadFixtures(t)
	for _, pointers := range []bool{false, true} {
		for i, r := range streamingRequests() {
			t.Run(fmt.Sprintf("%d/pointer=%t", i, pointers), func(t *testing.T) {
				if pointers {
					r = pointer(r)
				}
				ws := newSocket()
				stream, err := Synthesize(context.Background(), r, Options{WebSocket: ws})
				if err != nil {
					t.Fatal(err)
				}
				items, err := collect(stream)
				if err != nil {
					t.Fatal(err)
				}
				utterances := f.HTTP[i].Body["utterances"].([]any)
				expected := append(append([]any{}, utterances...), map[string]any{"close": true})
				equal(t, jsonValue(t, ws.messages()), expected)
				equal(t, len(items), len(utterances))
				for _, item := range items {
					equal(t, item, out.SynthesisItemAsBytes{Value: []byte{0, 255}})
				}
				wait(t, ws.closed)
			})
		}
	}
}

func TestSocketPointerItemsAndFlush(t *testing.T) {
	r := streamingRequests()
	x := r[3].(schema.TtsRequestAsOctave2StreamingTextVoice)
	x.Value.Text = newSource([]TextInput{&schema.TtsRequestOctave1StreamingTextTextItemAsString{Value: "Hello"}, &schema.TtsRequestOctave1StreamingTextTextItemAsFlush{}})
	y := r[2].(schema.TtsRequestAsOctave2StreamingTurns)
	y.Value.Turns = newSource([]TurnInput{&schema.TtsRequestOctave2StreamingTurnsTurnsItemAsText{Value: schema.TtsRequestOctave2TurnsContextBeforeTurnsTurnsItem{Speaker: "a", Text: "Hi"}}, &schema.TtsRequestOctave2StreamingTurnsTurnsItemAsFlush{}})
	z := r[6].(schema.TtsRequestAsOctave1StreamingTurns)
	z.Value.Turns = newSource([]DirectedTurnInput{&schema.TtsRequestOctave1StreamingTurnsTurnsItemAsText{Value: schema.TtsRequestOctave1TurnsContextBeforeTurnsTurnsItem{Speaker: "a", Text: "Hello", Instructions: runtime.Some("Happy"), TrailingSilenceMs: runtime.Some(float64(250))}}, &schema.TtsRequestOctave1StreamingTurnsTurnsItemAsFlush{}})
	f := loadFixtures(t)
	for i, r := range []schema.TtsRequest{x, y, z} {
		ws := newSocket()
		stream, err := Synthesize(context.Background(), r, Options{WebSocket: ws})
		if err != nil {
			t.Fatal(err)
		}
		items, err := collect(stream)
		if err != nil {
			t.Fatal(err)
		}
		equal(t, len(items), 1)
		fixture := []int{3, 2, 6}[i]
		equal(t, jsonValue(t, ws.messages()), []any{f.HTTP[fixture].Body["utterances"].([]any)[0], map[string]any{"flush": true}, map[string]any{"close": true}})
	}
}

func TestSocketTimelinesAndBinaryMetadata(t *testing.T) {
	f := loadFixtures(t)
	for _, metadata := range []bool{false, true} {
		ws := newSocket()
		ws.onSend = func(_ context.Context, v map[string]any) error {
			if v["close"] == true {
				ws.incoming <- socketResult{err: io.EOF}
				return nil
			}
			for _, entry := range f.Timeline {
				ws.put(entry.Packet)
			}
			if !metadata {
				ws.incoming <- socketResult{value: runtime.WebSocketBinary{1, 2}}
			}
			return nil
		}
		stream, err := Synthesize(context.Background(), streaming(newSource([]TextInput{text("Hello")})), Options{WebSocket: ws, IncludeMetadata: metadata})
		if err != nil {
			t.Fatal(err)
		}
		items, err := collect(stream)
		if err != nil {
			t.Fatal(err)
		}
		if !metadata {
			equal(t, items, []out.SynthesisItem{out.SynthesisItemAsBytes{Value: []byte{1, 2}}})
			continue
		}
		equal(t, len(items), len(f.Timeline))
		for i, item := range items {
			equal(t, fixtureItem(t, item), f.Timeline[i].Item)
		}
	}
}

func TestSocketAudioWhileInputOrWritesStall(t *testing.T) {
	for _, lane := range []string{"input", "send", "close"} {
		t.Run(lane, func(t *testing.T) {
			src := newSource([]TextInput{text("Hello")})
			src.stall = lane == "input"
			ws := newSocket()
			blocked := make(chan struct{})
			ws.onSend = func(ctx context.Context, v map[string]any) error {
				if lane == "input" {
					go func() {
						select {
						case <-src.waiting:
							ws.incoming <- socketResult{value: runtime.WebSocketBinary{7}}
						case <-ctx.Done():
						}
					}()
					return nil
				}
				if lane == "close" && v["close"] != true {
					return nil
				}
				ws.incoming <- socketResult{value: runtime.WebSocketBinary{7}}
				close(blocked)
				<-ctx.Done()
				return ctx.Err()
			}
			stream, err := Synthesize(context.Background(), streaming(src), Options{WebSocket: ws})
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Close()
			item, err := stream.Next(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			equal(t, item, out.SynthesisItemAsBytes{Value: []byte{7}})
			if lane == "input" {
				wait(t, src.waiting)
			} else {
				wait(t, blocked)
			}
			if err = stream.Close(); err != nil {
				t.Fatal(err)
			}
			wait(t, ws.closed)
			wait(t, src.closed)
			equal(t, src.closes.Load(), int32(1))
		})
	}
}

func TestSocketCancellationDoesNotWaitForProducer(t *testing.T) {
	for _, mode := range []string{"parent", "pull", "close"} {
		t.Run(mode, func(t *testing.T) {
			entered, release := make(chan struct{}), make(chan struct{})
			cleanup, releaseCleanup := make(chan struct{}), make(chan struct{})
			releaseInput := sync.OnceFunc(func() { close(release) })
			finishCleanup := sync.OnceFunc(func() { close(releaseCleanup) })
			defer finishCleanup()
			defer releaseInput()
			src := newSource([]TextInput{})
			src.nextFn = func(context.Context) (TextInput, error) { close(entered); <-release; return text("late"), nil }
			src.closeFn = func() { close(cleanup); <-releaseCleanup }
			ws := newSocket()
			parent, cancelParent := context.WithCancel(context.Background())
			defer cancelParent()
			pull, cancelPull := context.WithCancel(context.Background())
			defer cancelPull()
			stream, err := Synthesize(parent, streaming(src), Options{WebSocket: ws})
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Close()
			finished := make(chan struct{})
			var failure error
			go func() { defer close(finished); _, failure = stream.Next(pull) }()
			wait(t, entered)
			switch mode {
			case "parent":
				cancelParent()
			case "pull":
				cancelPull()
			case "close":
				if err = stream.Close(); err != nil {
					t.Fatal(err)
				}
			}
			wait(t, ws.closed)
			wait(t, finished)
			if mode == "close" {
				equal(t, failure, io.EOF)
			} else {
				equal(t, failure, context.Canceled)
			}
			equal(t, src.reads.Load(), int32(1))
			equal(t, src.closes.Load(), int32(0))
			equal(t, ws.messages(), []map[string]any{})
			// Next still owns the source. Cleanup cannot race it, and neither blocks socket closure.
			select {
			case <-cleanup:
				t.Fatal("cleanup raced Next")
			default:
			}
			releaseInput()
			wait(t, cleanup)
			closeDone := make(chan struct{})
			go func() { defer close(closeDone); _ = stream.Close() }()
			wait(t, closeDone)
			finishCleanup()
			wait(t, src.closed)
			equal(t, src.closes.Load(), int32(1))
			equal(t, ws.messages(), []map[string]any{})
		})
	}
}

func TestSocketUnreadOwnershipAndIdleCancellation(t *testing.T) {
	for _, cancel := range []bool{false, true} {
		src := newSource([]TextInput{text("unused")})
		ws := newSocket()
		ctx, stop := context.WithCancel(context.Background())
		stream, err := Synthesize(ctx, streaming(src), Options{WebSocket: ws})
		if err != nil {
			stop()
			t.Fatal(err)
		}
		if cancel {
			stop()
		} else {
			if err = stream.Close(); err != nil {
				t.Fatal(err)
			}
		}
		wait(t, ws.closed)
		wait(t, src.closed)
		equal(t, src.reads.Load(), int32(0))
		equal(t, src.closes.Load(), int32(1))
		equal(t, ws.messages(), []map[string]any{})
		stream.Close()
		stop()
	}
}

func TestSocketFailuresCloseBothSides(t *testing.T) {
	original := errors.New("original failure")
	for _, tc := range []struct {
		name     string
		result   socketResult
		metadata bool
		limit    int
		expected error
	}{
		{"early close", socketResult{err: io.EOF}, false, 0, errors.New("Hume WebSocket closed before the input stream ended")},
		{"abnormal close", socketResult{err: original}, false, 0, original},
		{"binary JSON", socketResult{value: runtime.WebSocketBinary{1}}, true, 0, errors.New("Hume returned binary audio in JSON mode")},
		{"limit", socketResult{value: runtime.WebSocketBinary{1, 2}}, false, 1, errors.New("Hume message exceeds MaxMessageBytes")},
		{"invalid frame", socketResult{}, false, 0, errors.New("Hume returned an invalid WebSocket frame")},
		{"provider error", socketResult{value: runtime.WebSocketText(`{"type":"error","message":"denied","code":"permission"}`)}, false, 0, &Error{Message: "denied", Code: runtime.Some("permission")}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			src := newSource([]TextInput{})
			src.stall = true
			ws := newSocket()
			ws.incoming <- tc.result
			stream, err := Synthesize(context.Background(), streaming(src), Options{WebSocket: ws, IncludeMetadata: tc.metadata, MaxMessageBytes: tc.limit})
			if err != nil {
				t.Fatal(err)
			}
			_, err = collect(stream)
			equal(t, err, tc.expected)
			if tc.expected == original && err != original {
				t.Fatal("lost original error identity")
			}
			wait(t, ws.closed)
			wait(t, src.closed)
		})
	}
	for _, lane := range []string{"input", "send"} {
		src := newSource([]TextInput{text("Hello")})
		ws := newSocket()
		if lane == "input" {
			src.items = nil
			src.failure = original
		} else {
			ws.onSend = func(context.Context, map[string]any) error { return original }
		}
		stream, err := Synthesize(context.Background(), streaming(src), Options{WebSocket: ws})
		if err != nil {
			t.Fatal(err)
		}
		_, err = collect(stream)
		if err != original {
			t.Fatalf("lost %s error identity: %v", lane, err)
		}
		wait(t, ws.closed)
		wait(t, src.closed)
	}
}

func TestSocketValidatesEachInputBeforeSending(t *testing.T) {
	for _, tc := range []struct {
		value   TextInput
		message string
	}{
		{nil, "Invalid hume TTS input item:\ntext item: expected string\ntext item: expected object"},
		{text(strings.Repeat("😀", 2501)), "Hume text must not exceed 5000 characters per utterance"},
	} {
		src := newSource([]TextInput{tc.value})
		ws := newSocket()
		stream, err := Synthesize(context.Background(), streaming(src), Options{WebSocket: ws})
		if err != nil {
			t.Fatal(err)
		}
		_, err = collect(stream)
		errorText(t, err, tc.message)
		equal(t, ws.messages(), []map[string]any{})
		wait(t, src.closed)
	}
	src := newSource([]TextInput{text(strings.Repeat("😀", 2500))})
	ws := newSocket()
	stream, err := Synthesize(context.Background(), streaming(src), Options{WebSocket: ws})
	if err != nil {
		t.Fatal(err)
	}
	items, err := collect(stream)
	if err != nil {
		t.Fatal(err)
	}
	equal(t, len(items), 1)
}

func TestSocketNormalCloseBeforeWriteDrains(t *testing.T) {
	ws := newSocket()
	ws.onSend = func(ctx context.Context, v map[string]any) error {
		if v["close"] == true {
			ws.incoming <- socketResult{err: io.EOF}
			<-ctx.Done()
			return ctx.Err()
		}
		return nil
	}
	src := newSource([]TextInput{})
	stream, err := Synthesize(context.Background(), streaming(src), Options{WebSocket: ws})
	if err != nil {
		t.Fatal(err)
	}
	items, err := collect(stream)
	if err != nil {
		t.Fatal(err)
	}
	equal(t, items, []out.SynthesisItem{})
	wait(t, src.closed)
	wait(t, ws.closed)
}

func TestSocketReadyInputOutputOrdering(t *testing.T) {
	for _, preferOutput := range []bool{false, true} {
		inputError, outputError := errors.New("input"), errors.New("output")
		input, output := make(chan inputResult, 1), make(chan socketResult, 1)
		input <- inputResult{err: inputError}
		output <- socketResult{err: outputError}
		ctx := context.Background()
		stream := socketStream{ctx: ctx, parent: ctx, started: true, preferOutput: preferOutput, pendingInput: input, pendingOutput: output}
		_, err := stream.next(ctx)
		if preferOutput {
			if err != outputError {
				t.Fatalf("lost output error identity: %v", err)
			}
			equal(t, len(input), 1)
			equal(t, len(output), 0)
		} else {
			if err != inputError {
				t.Fatalf("lost input error identity: %v", err)
			}
			equal(t, len(input), 0)
			equal(t, len(output), 1)
		}
	}
}
