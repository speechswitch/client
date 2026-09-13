package rime

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	schema "github.com/speechswitch/client/sdks/go/generated/rime"
	out "github.com/speechswitch/client/sdks/go/generated/rime_output"

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
				socket.packet(map[string]any{"type": "chunk", "contextId": message["contextId"], "data": "AQ=="})
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
				options := Options{Auth: authenticated(), Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
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

func TestCancellationBeforeFirstPullDoesNotStartIO(t *testing.T) {
	for _, mode := range []string{"parent", "next", "close"} {
		t.Run(mode, func(t *testing.T) {
			parent, cancelParent := context.WithCancel(context.Background())
			defer cancelParent()
			ctx, cancelNext := context.WithCancel(context.Background())
			defer cancelNext()
			input, err := Synthesize(parent, request(), Options{Auth: authenticated(), Transport: transportFunc(func(*http.Request) (*http.Response, error) {
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
	for _, value := range []inputItem{nil, (*schema.TtsRequestCodaStreamingTextVoice84ec2db1TextItemAsString)(nil), (*schema.TtsRequestCodaStreamingTextVoice84ec2db1TextItemAsClear)(nil), (*schema.TtsRequestCodaStreamingTextVoice84ec2db1TextItemAsFlush)(nil)} {
		socket, p := newSocket(), newProducer()
		p.items <- inputResult{value: value}
		request := liveRequest(p)
		check, err := schema.ValidateRequest(request)
		if err != nil {
			t.Fatal(err)
		}
		expected := check(value)
		if expected == nil {
			t.Fatal("expected generated input validation failure")
		}
		input, err := Synthesize(deadline(t), request, Options{Auth: authenticated(), WebSocket: socket})
		if err != nil {
			t.Fatal(err)
		}
		_, err = input.Next(deadline(t))
		if err == nil {
			t.Fatal("accepted invalid input")
		}
		equal(t, err.Error(), expected.Error())
		equal(t, len(socket.sent), 0)
		input.Close()
		await(t, p.closed)
		await(t, socket.closed)
	}
}

func TestEarlyAndAbnormalCloseNeverSucceed(t *testing.T) {
	failure := &runtime.WebSocketClosed{Code: 1011, Reason: "native failure"}
	for _, closed := range []error{io.EOF, failure} {
		socket, p := newSocket(), newProducer()
		socket.received <- socketResult{err: closed}
		input, err := Synthesize(deadline(t), liveRequest(p), Options{Auth: authenticated(), WebSocket: socket})
		if err != nil {
			t.Fatal(err)
		}
		_, err = input.Next(deadline(t))
		if closed == io.EOF {
			if err == nil {
				t.Fatal("accepted premature close")
			}
			equal(t, err.Error(), "Rime WebSocket closed before clean end-of-stream")
		} else {
			equal(t, err, failure)
		}
		input.Close()
		await(t, socket.closed)
		await(t, p.closed)
	}
}

type eosFailure struct {
	*socket
	failure error
}

func (s *eosFailure) Send(ctx context.Context, value runtime.WebSocketMessage) error {
	if err := s.socket.Send(ctx, value); err != nil {
		return err
	}
	if value == runtime.WebSocketText(`{"operation":"eos"}`) {
		s.received <- socketResult{err: io.EOF}
		return s.failure
	}
	return nil
}
func TestCleanCloseDoesNotHideEOSSendFailure(t *testing.T) {
	failure := errors.New("eos failed")
	socket := &eosFailure{socket: newSocket(), failure: failure}
	input, err := Synthesize(deadline(t), request(), Options{Auth: authenticated(), WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	_, err = input.Next(deadline(t))
	equal(t, err, failure)
	await(t, socket.closed)
}

func TestHTTPFailuresCloseBodiesAndPreserveOriginalErrors(t *testing.T) {
	failure := errors.New("read failed")
	for _, c := range []struct {
		status  int
		header  http.Header
		b       *body
		message string
		reads   int32
	}{
		{403, nil, &body{chunks: [][]byte{[]byte("secret")}}, "Rime returned HTTP 403", 0},
		{200, http.Header{"Content-Type": {"application/json"}}, &body{chunks: [][]byte{[]byte("secret")}}, "Rime returned an unexpected content type", 0},
		{200, nil, &body{}, "Rime returned no audio", 1},
		{200, nil, &body{failure: failure}, "read failed", 1},
	} {
		input, err := Synthesize(deadline(t), request(), Options{Auth: authenticated(), Transport: transportFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: c.status, Header: c.header, Body: c.b}, nil
		})})
		if err != nil {
			t.Fatal(err)
		}
		_, err = input.Next(deadline(t))
		if err == nil {
			t.Fatal("accepted invalid response")
		}
		equal(t, err.Error(), c.message)
		if c.status == 403 {
			equal(t, err, &Error{Status: runtime.Some(403), Message: c.message})
		}
		if c.b.failure != nil {
			equal(t, err, failure)
		}
		input.Close()
		equal(t, c.b.reads.Load(), c.reads)
		equal(t, c.b.closes.Load(), int32(1))
	}
}

func TestFrameLimitsCountUnicodePerFrameNotConnection(t *testing.T) {
	p, socket := newProducer(), newSocket()
	input, err := Synthesize(deadline(t), liveRequest(p), Options{Auth: authenticated(), WebSocket: socket})
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	pending := next(input, deadline(t))
	p.text("")
	p.text(strings.Repeat("🚀", 1000))
	p.text(strings.Repeat("🚀", 1000))
	first, second := sent(t, socket), sent(t, socket)
	equal(t, first, second)
	equal(t, first["text"], strings.Repeat("🚀", 1000))
	socket.packet(map[string]any{"type": "timestamps", "contextId": nil, "word_timestamps": map[string]any{"words": []string{"hi"}, "start": []int{0}, "end": []int{1}}})
	socket.packet(map[string]any{"type": "chunk", "contextId": nil, "data": ""})
	socket.packet(map[string]any{"type": "chunk", "contextId": nil, "data": "AQ=="})
	equal(t, take(t, pending), out.SynthesisItemAsBytes{Value: []byte{1}})
	p.text(strings.Repeat("🚀", 1001))
	_, err = input.Next(deadline(t))
	if err == nil {
		t.Fatal("accepted oversized frame")
	}
	equal(t, err.Error(), "Rime WebSocket text frames are limited to 1000 code points")
}

func TestMessageLimitsAndBinaryRejection(t *testing.T) {
	for _, c := range []struct {
		message runtime.WebSocketMessage
		limit   int
		error   string
	}{
		{runtime.WebSocketText(strings.Repeat(" ", 100)), 99, "Rime message exceeds MaxMessageBytes"},
		{runtime.WebSocketBinary{1}, 100, "Rime returned a non-text WebSocket frame"},
		{nil, 1, "Rime message exceeds MaxMessageBytes"},
	} {
		socket := newSocket()
		if c.message != nil {
			socket.received <- socketResult{value: c.message}
		}
		input, err := Synthesize(deadline(t), request(), Options{Auth: authenticated(), WebSocket: socket, MaxMessageBytes: c.limit})
		if err != nil {
			t.Fatal(err)
		}
		_, err = input.Next(deadline(t))
		if err == nil {
			t.Fatal("accepted invalid message")
		}
		equal(t, err.Error(), c.error)
		input.Close()
		await(t, socket.closed)
	}
}
