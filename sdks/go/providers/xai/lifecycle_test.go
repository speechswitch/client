package xai

import (
	"context"
	"errors"
	"io"
	"net/http"
	"sync"
	"testing"

	schema "github.com/speechswitch/client/sdks/go/generated/xai"
	out "github.com/speechswitch/client/sdks/go/generated/xai_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

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

func TestHTTPHeadersAndBodyCancellation(t *testing.T) {
	for _, stage := range []string{"headers", "body"} {
		for _, mode := range []string{"parent", "next", "close"} {
			t.Run(stage+"/"+mode, func(t *testing.T) {
				ctx, cancel := context.WithCancel(deadline(t))
				defer cancel()
				nextCtx, cancelNext := context.WithCancel(deadline(t))
				defer cancelNext()
				started, closed := make(chan struct{}), make(chan struct{})
				b := &stalledBody{reading: started, closed: closed}
				input, err := Synthesize(ctx, request(), Options{Auth: authenticated(), Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
					if stage == "headers" {
						close(started)
						<-r.Context().Done()
						close(closed)
						return nil, r.Context().Err()
					}
					return &http.Response{StatusCode: 200, Body: b}, nil
				})})
				if err != nil {
					t.Fatal(err)
				}
				defer input.Close()
				ch := make(chan result, 1)
				go func() { item, err := input.Next(nextCtx); ch <- result{item, err} }()
				await(t, started)
				switch mode {
				case "parent":
					cancel()
				case "next":
					cancelNext()
				case "close":
					input.Close()
				}
				got := <-ch
				equal(t, got.err, context.Canceled)
				equal(t, got.item, nil)
				await(t, closed)
			})
		}
	}
}
func TestSocketCancellationAndIdleDeadlines(t *testing.T) {
	for _, mode := range []string{"next", "close", "unread deadline", "idle deadline"} {
		t.Run(mode, func(t *testing.T) {
			p, socket := newProducer(), newSocket()
			options := Options{Auth: authenticated(), WebSocket: socket}
			if mode == "unread deadline" || mode == "idle deadline" {
				options.TimeoutMs = runtime.Some(int64(100))
			}
			input, err := Synthesize(deadline(t), liveRequest(p), options)
			if err != nil {
				t.Fatal(err)
			}
			defer input.Close()
			if mode == "unread deadline" {
				await(t, socket.closed)
				_, err = input.Next(deadline(t))
				equal(t, err, context.DeadlineExceeded)
				equal(t, p.reads.Load(), int32(0))
				return
			}
			p.values <- sourceResult{item: schema.TtsRequestStreamingTextTextItemAsString{Value: "hello"}}
			ctx, cancel := context.WithCancel(deadline(t))
			defer cancel()
			ch := make(chan result, 1)
			go func() { item, err := input.Next(ctx); ch <- result{item, err} }()
			equal(t, socket.message(t), map[string]any{"type": "text.delta", "delta": "hello"})
			if mode == "idle deadline" {
				socket.push(map[string]any{"type": "audio.delta", "delta": "AQ=="})
				got := <-ch
				equal(t, got.err, nil)
				equal(t, got.item, out.SynthesisItemAsBytes{Value: []byte{1}})
				await(t, socket.closed)
				_, err = input.Next(deadline(t))
				equal(t, err, context.DeadlineExceeded)
			} else {
				if mode == "next" {
					cancel()
				} else {
					input.Close()
				}
				got := <-ch
				equal(t, got.err, context.Canceled)
				await(t, socket.closed)
			}
			await(t, p.closed)
			equal(t, socket.closes.Load(), int32(1))
		})
	}
}
func TestLateTransportAcquisitionClosesWithoutStartingInput(t *testing.T) {
	for _, socketMode := range []bool{false, true} {
		t.Run(map[bool]string{false: "HTTP", true: "WebSocket"}[socketMode], func(t *testing.T) {
			started, release, returned := make(chan struct{}), make(chan struct{}), make(chan struct{})
			p, socket := newProducer(), newSocket()
			b := &stalledBody{reading: make(chan struct{}), closed: make(chan struct{})}
			options := Options{Auth: authenticated(), Transport: transportFunc(func(*http.Request) (*http.Response, error) {
				close(started)
				<-release
				close(returned)
				return &http.Response{StatusCode: 200, Body: b}, nil
			})}
			var r schema.TtsRequest = request()
			if socketMode {
				r = liveRequest(p)
			}
			input, err := Synthesize(deadline(t), r, options)
			if err != nil {
				t.Fatal(err)
			}
			defer input.Close()
			if socketMode {
				input.(*stream).config.connectSocket = func(context.Context) (runtime.WebSocketLike, error) {
					close(started)
					<-release
					close(returned)
					return socket, nil
				}
			}
			ch := consume(t, input)
			await(t, started)
			input.Close()
			got := <-ch
			equal(t, got.err, context.Canceled)
			close(release)
			await(t, returned)
			if socketMode {
				await(t, socket.closed)
				equal(t, p.reads.Load(), int32(0))
			} else {
				await(t, b.closed)
			}
		})
	}
}

type blockedProducer struct {
	started, release, closed chan struct{}
	once                     sync.Once
}

func (p *blockedProducer) Next(context.Context) (inputItem, error) {
	close(p.started)
	<-p.release
	return nil, io.EOF
}
func (p *blockedProducer) Close() error {
	p.once.Do(func() { close(p.closed) })
	<-p.release
	return nil
}
func TestUncooperativeProducerCannotHoldSocketCleanup(t *testing.T) {
	p := &blockedProducer{started: make(chan struct{}), release: make(chan struct{}), closed: make(chan struct{})}
	defer close(p.release)
	socket := newSocket()
	input, err := Synthesize(deadline(t), liveRequest(p), Options{Auth: authenticated(), WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	result := consume(t, input)
	await(t, p.started)
	socket.push(map[string]any{"type": "error", "message": "private"})
	got := <-result
	equal(t, got.err, &Error{})
	await(t, socket.closed)
	await(t, p.closed)
	equal(t, socket.closes.Load(), int32(1))
}
func TestProducerFailureAndEmptyAudioNeverBecomeSuccess(t *testing.T) {
	failure := errors.New("input failed")
	p, socket := newProducer(), newSocket()
	p.values <- sourceResult{err: failure}
	input, err := Synthesize(deadline(t), liveRequest(p), Options{Auth: authenticated(), WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	_, err = input.Next(deadline(t))
	equal(t, err, failure)
	await(t, p.closed)
	for _, failure := range []error{nil, errors.New("body failed")} {
		b := &body{failure: failure, closeError: errors.New("cleanup failed")}
		input, err := Synthesize(deadline(t), request(), Options{Auth: authenticated(), Transport: transportFunc(func(*http.Request) (*http.Response, error) { return &http.Response{StatusCode: 200, Body: b}, nil })})
		if err != nil {
			t.Fatal(err)
		}
		defer input.Close()
		got, err := input.Next(deadline(t))
		equal(t, got, nil)
		if failure != nil {
			equal(t, err, failure)
		} else {
			equal(t, err.Error(), "xAI returned no audio bytes")
		}
		equal(t, b.closes.Load(), int32(1))
	}
}
