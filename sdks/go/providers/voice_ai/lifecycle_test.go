package voice_ai

import (
	"context"
	"io"
	"net/http"
	"sync"
	"testing"

	out "github.com/speechswitch/client/sdks/go/generated/voice_ai_output"
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

func TestHTTPAcquisitionAndBodyCancellation(t *testing.T) {
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

func TestSocketNextCancellationAndIdleDeadline(t *testing.T) {
	for _, mode := range []string{"next", "close", "unread deadline", "idle deadline"} {
		t.Run(mode, func(t *testing.T) {
			s := newSocket()
			options := Options{Auth: authenticated(), WebSocket: s}
			if mode == "unread deadline" || mode == "idle deadline" {
				options.TimeoutMs = runtime.Some(int64(100))
			}
			input, err := Synthesize(deadline(t), request(), options)
			if err != nil {
				t.Fatal(err)
			}
			defer input.Close()
			if mode == "unread deadline" {
				await(t, s.closed)
				_, err = input.Next(deadline(t))
				equal(t, err, context.DeadlineExceeded)
				equal(t, s.sends.Load(), int32(0))
				return
			}
			ctx, cancel := context.WithCancel(deadline(t))
			defer cancel()
			ch := make(chan result, 1)
			go func() { item, err := input.Next(ctx); ch <- result{item, err} }()
			id := s.message(t)["context_id"].(string)
			s.message(t)
			if mode == "idle deadline" {
				s.push(map[string]any{"context_id": id, "audio": "AA=="})
				got := <-ch
				equal(t, got.err, nil)
				equal(t, got.item, out.SynthesisItemAsOrdered{Value: out.VoiceAiEnvelope{Audio: []byte{0}, CorrelationId: id}})
				await(t, s.closed)
				_, err = input.Next(deadline(t))
				equal(t, err, context.DeadlineExceeded)
				return
			}
			if mode == "next" {
				cancel()
			} else {
				input.Close()
			}
			got := <-ch
			equal(t, got.err, context.Canceled)
			await(t, s.closed)
		})
	}
}

func TestLateTransportAcquisitionStillClosesOwnedResource(t *testing.T) {
	for _, socketMode := range []bool{false, true} {
		t.Run(map[bool]string{false: "HTTP", true: "WebSocket"}[socketMode], func(t *testing.T) {
			started, release, returned := make(chan struct{}), make(chan struct{}), make(chan struct{})
			s := newSocket()
			b := &stalledBody{reading: make(chan struct{}), closed: make(chan struct{})}
			p := newProducer()
			options := Options{Auth: authenticated(), Transport: transportFunc(func(*http.Request) (*http.Response, error) {
				close(started)
				<-release
				close(returned)
				return &http.Response{StatusCode: 200, Body: b}, nil
			})}
			if socketMode {
				options.Protocol = "websocket"
			}
			req := request()
			if socketMode {
				req = liveRequest(p)
			}
			input, err := Synthesize(deadline(t), req, options)
			if err != nil {
				t.Fatal(err)
			}
			defer input.Close()
			if socketMode {
				// An injected handshake that settles after cancellation must transfer its
				// late socket into cleanup, never start the input producer.
				input.(*stream).config.connectSocket = func(context.Context) (runtime.WebSocketLike, error) {
					close(started)
					<-release
					close(returned)
					return s, nil
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
				await(t, s.closed)
				equal(t, s.closes.Load(), int32(1))
				equal(t, p.reads.Load(), int32(0))
				equal(t, p.closes.Load(), int32(0))
			} else {
				await(t, b.closed)
			}
		})
	}
}

func TestOutgoingMessageLimitFailsBeforeSend(t *testing.T) {
	s := newSocket()
	input, err := Synthesize(deadline(t), request(), Options{Auth: authenticated(), WebSocket: s, MaxMessageBytes: 20})
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	_, err = input.Next(deadline(t))
	equal(t, err.Error(), "Voice.ai message exceeds MaxMessageBytes")
	equal(t, s.sends.Load(), int32(0))
	equal(t, s.closes.Load(), int32(1))
}
