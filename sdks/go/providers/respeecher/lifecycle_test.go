package respeecher

import (
	"context"
	"errors"
	"io"
	"net/http"
	"sync"
	"testing"
	"time"

	schema "github.com/speechswitch/client/sdks/go/generated/respeecher"

	out "github.com/speechswitch/client/sdks/go/generated/respeecher_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func TestSocketCancellationByParentNextDeadlineAndClose(t *testing.T) {
	for _, mode := range []string{"parent", "next", "deadline", "close", "idle"} {
		t.Run(mode, func(t *testing.T) {
			socket, p := newSocket(), newProducer()
			parent, cancelParent := context.WithCancel(deadline(t))
			defer cancelParent()
			ctx, cancelNext := context.WithCancel(deadline(t))
			defer cancelNext()
			options := Options{Auth: authenticated(), WebSocket: socket}
			if mode == "deadline" {
				options.TimeoutMs = runtime.Some(int64(15))
			}
			input, err := Synthesize(parent, liveRequest(p), options)
			if err != nil {
				t.Fatal(err)
			}
			defer input.Close()
			pending := next(input, ctx)
			p.text("Hi")
			message := sent(t, socket)
			if mode == "idle" {
				socket.packet(map[string]any{"type": "chunk", "context_id": message["context_id"], "data": "AQ=="})
				take(t, pending)
				cancelParent()
				await(t, socket.closed)
				await(t, p.closed)
				return
			}
			switch mode {
			case "parent":
				cancelParent()
			case "next":
				cancelNext()
			case "close":
				input.Close()
			}
			select {
			case r := <-pending:
				want := context.Canceled
				if mode == "deadline" {
					want = context.DeadlineExceeded
				}
				if !errors.Is(r.err, want) {
					t.Fatal(r.err)
				}
			case <-time.After(time.Second):
				t.Fatal("cancellation held")
			}
			await(t, socket.closed)
			await(t, p.closed)
			equal(t, socket.closes.Load(), int32(1))
		})
	}
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
func TestHTTPCancellationAtHeadersAndBody(t *testing.T) {
	for _, stage := range []string{"headers", "body"} {
		for _, mode := range []string{"parent", "next", "deadline", "close"} {
			t.Run(stage+"/"+mode, func(t *testing.T) {
				parent, cancelParent := context.WithCancel(deadline(t))
				defer cancelParent()
				ctx, cancelNext := context.WithCancel(deadline(t))
				defer cancelNext()
				started, closed := make(chan struct{}), make(chan struct{})
				b := &stalledBody{reading: started, closed: closed}
				options := Options{Auth: authenticated(), Protocol: "http", Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
					if stage == "headers" {
						close(started)
						<-r.Context().Done()
						close(closed)
						return nil, r.Context().Err()
					}
					return &http.Response{StatusCode: 200, Body: b}, nil
				})}
				if mode == "deadline" {
					options.TimeoutMs = runtime.Some(int64(15))
				}
				input, err := Synthesize(parent, request(), options)
				if err != nil {
					t.Fatal(err)
				}
				defer input.Close()
				pending := next(input, ctx)
				await(t, started)
				switch mode {
				case "parent":
					cancelParent()
				case "next":
					cancelNext()
				case "close":
					input.Close()
				}
				select {
				case r := <-pending:
					want := context.Canceled
					if mode == "deadline" {
						want = context.DeadlineExceeded
					}
					if !errors.Is(r.err, want) {
						t.Fatal(r.err)
					}
				case <-time.After(time.Second):
					t.Fatal("cancellation held")
				}
				await(t, closed)
			})
		}
	}
}

type uncooperative struct{ started, release, closed chan struct{} }

func (p *uncooperative) Next(context.Context) (inputItem, error) {
	close(p.started)
	<-p.release
	return nil, io.EOF
}
func (p *uncooperative) Close() error { <-p.release; close(p.closed); return nil }
func TestUncooperativeProducerCannotHoldClose(t *testing.T) {
	p := &uncooperative{started: make(chan struct{}), release: make(chan struct{}), closed: make(chan struct{})}
	socket := newSocket()
	input, err := Synthesize(deadline(t), liveRequest(p), Options{Auth: authenticated(), WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	pending := next(input, deadline(t))
	await(t, p.started)
	finished := make(chan struct{})
	go func() { input.Close(); close(finished) }()
	await(t, finished)
	await(t, socket.closed)
	close(p.release)
	await(t, p.closed)
	r := <-pending
	if !errors.Is(r.err, context.Canceled) {
		t.Fatal(r.err)
	}
}

func TestHTTPFailureClosesWithoutExposingBodyAndPreservesReadError(t *testing.T) {
	failure := errors.New("read failed")
	for _, c := range []struct {
		status int
		header http.Header
		b      *body
		want   error
	}{
		{403, nil, &body{chunks: [][]byte{[]byte("secret")}}, &Error{StatusCode: 403, Message: "Respeecher returned HTTP 403"}},
		{200, http.Header{"Content-Type": {"text/html"}}, &body{chunks: [][]byte{[]byte("secret")}}, errors.New("Respeecher returned an unexpected content type")},
		{200, nil, &body{failure: failure}, failure},
		{200, nil, &body{chunks: [][]byte{[]byte("123456789")}}, errors.New("Respeecher line exceeds MaxMessageBytes")},
	} {
		input, err := Synthesize(deadline(t), request(), Options{Auth: authenticated(), Protocol: "http", MaxMessageBytes: 8, Transport: transportFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: c.status, Header: c.header, Body: c.b}, nil
		})})
		if err != nil {
			t.Fatal(err)
		}
		_, err = input.Next(deadline(t))
		if err == nil {
			t.Fatal("missing failure")
		}
		equal(t, err.Error(), c.want.Error())
		if c.want == failure {
			equal(t, err, failure)
		}
		input.Close()
		equal(t, c.b.closes.Load(), int32(1))
		if c.status == 403 {
			equal(t, c.b.reads.Load(), int32(0))
		}
	}
}

func TestSocketCompletionErrors(t *testing.T) {
	for _, ended := range []bool{false, true} {
		socket, p := newSocket(), newProducer()
		input, err := Synthesize(deadline(t), liveRequest(p), Options{Auth: authenticated(), WebSocket: socket})
		if err != nil {
			t.Fatal(err)
		}
		pending := next(input, deadline(t))
		p.text("Hi")
		message := sent(t, socket)
		if ended {
			p.items <- inputResult{err: io.EOF}
			sent(t, socket)
		}
		socket.packet(map[string]any{"type": "done", "context_id": message["context_id"]})
		r := <-pending
		want := "Respeecher completed a context before its text ended"
		if ended {
			want = "Respeecher completed a context without audio"
		}
		if r.err == nil {
			t.Fatal(r.item)
		}
		equal(t, r.err.Error(), want)
		input.Close()
		await(t, p.closed)
	}
}

func TestInputFailurePreservesIdentity(t *testing.T) {
	failure := errors.New("producer failure")
	p := newProducer()
	p.items <- inputResult{err: failure}
	socket := newSocket()
	input, err := Synthesize(deadline(t), liveRequest(p), Options{Auth: authenticated(), WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	_, err = input.Next(deadline(t))
	equal(t, err, failure)
	await(t, socket.closed)
	await(t, p.closed)
}

func TestDoneClosesSocketBeforeConsumerRequestsEOF(t *testing.T) {
	socket := newSocket()
	input, err := Synthesize(deadline(t), request(), Options{Auth: authenticated(), WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	pending := next(input, deadline(t))
	message := sent(t, socket)
	sent(t, socket)
	socket.packet(map[string]any{"type": "chunk", "context_id": message["context_id"], "data": "AQ=="})
	take(t, pending)
	socket.packet(map[string]any{"type": "done", "context_id": message["context_id"]})
	equal(t, take(t, next(input, deadline(t))), out.SynthesisItemAsDone{})
	await(t, socket.closed)
}

func TestCancellationBeforeFirstPullDoesNotStartIO(t *testing.T) {
	for _, mode := range []string{"parent", "next", "close"} {
		t.Run(mode, func(t *testing.T) {
			parent, cancelParent := context.WithCancel(context.Background())
			defer cancelParent()
			ctx, cancelNext := context.WithCancel(context.Background())
			defer cancelNext()
			input, err := Synthesize(parent, request(), Options{Auth: authenticated(), Protocol: "http", Transport: transportFunc(func(*http.Request) (*http.Response, error) {
				t.Error("I/O after pre-cancellation")
				return nil, errors.New("unexpected I/O")
			})})
			if err != nil {
				t.Fatal(err)
			}
			switch mode {
			case "parent":
				cancelParent()
			case "next":
				cancelNext()
			case "close":
				input.Close()
			}
			_, err = input.Next(ctx)
			equal(t, err, context.Canceled)
			_, err = input.Next(context.Background())
			equal(t, err, io.EOF)
			input.Close()
		})
	}
}

type failedSend struct {
	*socket
	failure error
}

func (s *failedSend) Send(context.Context, runtime.WebSocketMessage) error { return s.failure }
func TestSocketSendFailurePreservesIdentity(t *testing.T) {
	failure := errors.New("send failed")
	socket := &failedSend{socket: newSocket(), failure: failure}
	input, err := Synthesize(deadline(t), request(), Options{Auth: authenticated(), WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	_, err = input.Next(deadline(t))
	equal(t, err, failure)
	await(t, socket.closed)
}

func TestGeneratedInputChecksRejectNilVariantsBeforeSending(t *testing.T) {
	for _, value := range []inputItem{nil, (*schema.TtsRequestObjectTextAsyncIterableItemAsString)(nil), (*schema.TtsRequestObjectTextAsyncIterableItemAsClear)(nil), (*schema.TtsRequestObjectTextAsyncIterableItemAsFlush)(nil)} {
		socket, p := newSocket(), newProducer()
		p.items <- inputResult{value: value}
		input, err := Synthesize(deadline(t), liveRequest(p), Options{Auth: authenticated(), WebSocket: socket})
		if err != nil {
			t.Fatal(err)
		}
		_, err = input.Next(deadline(t))
		if err == nil {
			t.Fatal("accepted invalid input")
		}
		equal(t, err.Error(), "Invalid respeecher TTS input item")
		equal(t, len(socket.sent), 0)
		input.Close()
		await(t, p.closed)
		await(t, socket.closed)
	}
}
