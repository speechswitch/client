package minimax

import (
	"context"
	"errors"
	schema "github.com/speechswitch/client/sdks/go/generated/minimax"
	"io"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestUnreadCloseDoesNotStartOrConsumeInput(t *testing.T) {
	input := newSource(text("unread"))
	socket := newSocket()
	stream, err := Synthesize(context.Background(), streaming(input), Options{WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	stream.Close()
	stream.Close()
	wait(t, input.closed)
	equal(t, input.reads.Load(), int32(0))
	equal(t, input.closes.Load(), int32(1))
	equal(t, socket.closes.Load(), int32(1))
	equal(t, len(socket.frames()), 0)
	_, err = stream.Next(context.Background())
	equal(t, err, io.EOF)
}

func TestPendingInputWritesAndReceivesCanAlwaysBeCanceled(t *testing.T) {
	for _, phase := range []string{"input", "task_start", "task_continue", "task_finish", "task_cancel"} {
		for _, mode := range []string{"parent", "next", "close"} {
			t.Run(phase+"/"+mode, func(t *testing.T) {
				socket := newSocket()
				input := newSource()
				input.stall = phase != "task_finish"
				if phase == "task_continue" {
					input.values = []Input{text("Hi")}
				}
				if phase == "task_cancel" {
					input.values = []Input{schema.TtsRequestStreamingText12421ea0TextItemAsClear{}}
				}
				waiting, release := make(chan struct{}), make(chan struct{})
				var once sync.Once
				defer close(release)
				socket.hook = func(_ context.Context, v map[string]any) error {
					if v["event"] == phase {
						once.Do(func() { close(waiting) })
						<-release
					}
					return nil
				}
				parent, cancel := context.WithCancel(context.Background())
				defer cancel()
				next, cancelNext := context.WithCancel(context.Background())
				defer cancelNext()
				stream, err := Synthesize(parent, streaming(input), Options{WebSocket: socket})
				if err != nil {
					t.Fatal(err)
				}
				defer stream.Close()
				result := make(chan error, 1)
				go func() { _, err := stream.Next(next); result <- err }()
				if phase == "input" {
					wait(t, input.waiting)
				} else {
					wait(t, waiting)
				}
				switch mode {
				case "parent":
					cancel()
				case "next":
					cancelNext()
				case "close":
					stream.Close()
				}
				select {
				case err := <-result:
					if mode == "close" {
						equal(t, err, io.EOF)
					} else {
						equal(t, err, context.Canceled)
					}
				case <-time.After(time.Second):
					t.Fatal("cancellation waited for a stuck writer or producer")
				}
				equal(t, socket.closes.Load(), int32(1))
			})
		}
	}
}

type stubborn struct {
	*source
	release chan struct{}
}

func (s *stubborn) Next(context.Context) (Input, error) {
	s.once.Do(func() { close(s.waiting) })
	<-s.release
	return text("late"), nil
}
func TestStubbornInputCannotSendLateText(t *testing.T) {
	input := &stubborn{source: newSource(), release: make(chan struct{})}
	socket := newSocket()
	stream, err := Synthesize(context.Background(), streaming(input), Options{WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() { _, err := stream.Next(context.Background()); result <- err }()
	wait(t, input.waiting)
	stream.Close()
	equal(t, <-result, io.EOF)
	close(input.release)
	wait(t, input.closed)
	equal(t, len(socket.frames()), 2)
	equal(t, socket.frames()[1]["event"], "task_cancel")
	equal(t, input.closes.Load(), int32(1))
}
func TestProducerErrorsInterruptCancelAndFinalAcknowledgement(t *testing.T) {
	original := errors.New("producer failure")
	input := newSource(schema.TtsRequestStreamingText12421ea0TextItemAsClear{})
	input.failure = original
	socket := newSocket()
	socket.hook = func(context.Context, map[string]any) error { return nil }
	stream, err := Synthesize(context.Background(), streaming(input), Options{WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	_, err = stream.Next(context.Background())
	equal(t, err, original)
	wait(t, input.closed)
	socket = newSocket()
	socket.hook = func(_ context.Context, v map[string]any) error {
		if v["event"] == "task_finish" {
			socket.reply(map[string]any{"event": "task_finished"})
			time.Sleep(time.Millisecond)
			return original
		}
		return nil
	}
	stream, err = Synthesize(context.Background(), streaming(newSource()), Options{WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	_, err = stream.Next(context.Background())
	equal(t, err, original)
	equal(t, socket.closes.Load(), int32(1))
}
func TestNativeTextLimitsAndUnicodeSplitting(t *testing.T) {
	for _, parts := range [][]Input{{text(strings.Repeat("x", 10000))}, {text(strings.Repeat("😀", 5000))}, {text(strings.Repeat(" ", 9999)), text(" x")}} {
		socket := newSocket()
		input := newSource(parts...)
		stream, err := Synthesize(context.Background(), streaming(input), Options{WebSocket: socket})
		if err != nil {
			t.Fatal(err)
		}
		_, err = stream.Next(context.Background())
		expected := "MiniMax text pieces must contain fewer than 10000 UTF-16 code units"
		if len(parts) == 2 {
			expected = "MiniMax pending whitespace exceeds a native message"
		}
		errorText(t, err, expected)
		wait(t, input.closed)
	}
	socket := newSocket()
	stream, err := Synthesize(context.Background(), streaming(newSource(text(" "), text(strings.Repeat("x", 9997)+"😀"))), Options{WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	collect(t, stream)
	equal(t, socket.frames()[1:], []map[string]any{{"event": "task_continue", "text": " " + strings.Repeat("x", 9997)}, {"event": "task_continue", "text": "😀"}, {"event": "task_finish"}})
}
