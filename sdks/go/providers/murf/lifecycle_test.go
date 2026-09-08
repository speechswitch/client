package murf

import (
	"bytes"
	"context"
	schema "github.com/speechswitch/client/sdks/go/generated/murf"
	"io"
	"net/http"
	"testing"
	"time"
)

func TestSocketCancellationDuringInputSetupAndRead(t *testing.T) {
	for _, stage := range []string{"input", "setup", "read"} {
		for _, mode := range []string{"parent", "next", "close"} {
			t.Run(stage+"/"+mode, func(t *testing.T) {
				parent, cancel := context.WithCancel(context.Background())
				defer cancel()
				next, cancelNext := context.WithCancel(context.Background())
				defer cancelNext()
				input := newSource()
				input.stall = stage == "input"
				socket := newSocket()
				entered := input.waiting
				if stage == "setup" {
					entered = make(chan struct{})
					socket.hook = func(ctx context.Context, v map[string]any) error { close(entered); <-ctx.Done(); return ctx.Err() }
				}
				if stage == "read" {
					input = newSource(text("Hi"))
					entered = make(chan struct{})
					socket.hook = func(ctx context.Context, v map[string]any) error {
						if v["end"] == true {
							close(entered)
						}
						return nil
					}
				}
				stream, err := Synthesize(parent, streaming(input), Options{WebSocket: socket})
				if err != nil {
					t.Fatal(err)
				}
				defer stream.Close()
				result := make(chan error, 1)
				go func() { _, err := stream.Next(next); result <- err }()
				wait(t, entered)
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
					t.Fatal("socket cancellation held Next")
				}
				wait(t, input.closed)
				equal(t, input.closes.Load(), int32(1))
				equal(t, socket.closes.Load(), int32(1))
			})
		}
	}
}
func TestUnreadSocketClosesOwnedInputWithoutAdvancing(t *testing.T) {
	input := newSource(text("Hi"))
	socket := newSocket()
	stream, err := Synthesize(context.Background(), streaming(input), Options{WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	stream.Close()
	wait(t, input.closed)
	equal(t, input.reads.Load(), int32(0))
	equal(t, len(socket.messages()), 0)
	equal(t, socket.closes.Load(), int32(1))
}
func TestHTTPReadCancellationAtAudioMetadataAndDownload(t *testing.T) {
	for _, stage := range []string{"audio", "metadata", "download"} {
		for _, mode := range []string{"parent", "next", "close"} {
			t.Run(stage+"/"+mode, func(t *testing.T) {
				parent, cancel := context.WithCancel(context.Background())
				defer cancel()
				next, cancelNext := context.WithCancel(context.Background())
				defer cancelNext()
				reader, writer := io.Pipe()
				defer writer.Close()
				pending := &body{Reader: reader, closeFn: reader.Close}
				original := &body{Reader: bytes.NewReader(fixture(t)["generation"])}
				entered := make(chan struct{})
				signal := &signalReader{reader: reader, entered: entered}
				pending.Reader = signal
				tr := transport(func(r *http.Request) (*http.Response, error) {
					b := pending
					if stage == "download" && r.Method == "POST" {
						b = original
					}
					return &http.Response{StatusCode: 200, Body: b}, nil
				})
				var streamRequest schema.TtsRequest = request()
				if stage != "audio" {
					streamRequest = schema.TtsRequestAsGen2TextVoiceca621e19{Value: schema.TtsRequestGen2TextVoiceca621e19{Text: "Hi", Voice: "v"}}
				}
				stream, err := Synthesize(parent, streamRequest, Options{Auth: testAuth, Transport: tr})
				if err != nil {
					t.Fatal(err)
				}
				defer stream.Close()
				result := make(chan error, 1)
				go func() { _, err := stream.Next(next); result <- err }()
				wait(t, entered)
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
					t.Fatal("HTTP cancellation held Next")
				}
				equal(t, pending.closes.Load(), int32(1))
				if stage == "download" {
					equal(t, original.closes.Load(), int32(1))
				}
			})
		}
	}
}

type signalReader struct {
	reader  io.Reader
	entered chan struct{}
	started bool
}

func (s *signalReader) Read(data []byte) (int, error) {
	if !s.started {
		s.started = true
		close(s.entered)
	}
	return s.reader.Read(data)
}
func TestCancellationBeforeHTTPHeadersReclaimsRacingResponse(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	entered := make(chan struct{})
	closed := make(chan struct{})
	b := &body{Reader: bytes.NewReader(nil), closeFn: func() error { close(closed); return nil }}
	tr := transport(func(r *http.Request) (*http.Response, error) {
		close(entered)
		<-r.Context().Done()
		return &http.Response{StatusCode: 200, Body: b}, nil
	})
	result := make(chan error, 1)
	go func() { _, err := Synthesize(ctx, request(), Options{Auth: testAuth, Transport: tr}); result <- err }()
	wait(t, entered)
	cancel()
	select {
	case err := <-result:
		equal(t, err, context.Canceled)
	case <-time.After(time.Second):
		t.Fatal("header cancellation held Synthesize")
	}
	wait(t, closed)
	equal(t, b.closes.Load(), int32(1))
}

type stubbornSource struct {
	*source
	release, ignored chan struct{}
}

func (s *stubbornSource) Next(ctx context.Context) (Input, error) {
	close(s.waiting)
	<-ctx.Done()
	close(s.ignored)
	<-s.release
	return text("late text"), nil
}
func TestUncooperativeInputCannotHoldSocketOrWriteLateText(t *testing.T) {
	input := &stubbornSource{source: newSource(), release: make(chan struct{}), ignored: make(chan struct{})}
	defer func() {
		select {
		case <-input.release:
		default:
			close(input.release)
		}
	}()
	socket := newSocket()
	stream, err := Synthesize(context.Background(), streaming(input), Options{WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	result := make(chan error, 1)
	go func() { _, err := stream.Next(context.Background()); result <- err }()
	wait(t, input.waiting)
	stream.Close()
	wait(t, input.ignored)
	select {
	case err := <-result:
		equal(t, err, io.EOF)
	case <-time.After(time.Second):
		t.Fatal("producer held socket open")
	}
	equal(t, input.closes.Load(), int32(0))
	close(input.release)
	wait(t, input.closed)
	equal(t, input.closes.Load(), int32(1))
	equal(t, socket.closes.Load(), int32(1))
	equal(t, len(socket.messages()), 1)
}
