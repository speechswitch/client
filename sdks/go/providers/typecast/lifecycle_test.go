package typecast

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	out "github.com/speechswitch/client/sdks/go/generated/typecast_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func TestEarlyExitAndFirstUnbufferedBytes(t *testing.T) {
	for _, read := range []bool{false, true} {
		b := newBody(step{data: []byte("RIFF")}, step{data: []byte("unread")})
		b.stall = true
		o := options(b, "audio/wav", 200)
		o.MaxTimestampResponseBytes = 1
		stream, err := Synthesize(context.Background(), request(), o)
		if err != nil {
			t.Fatal(err)
		}
		if read {
			item, err := stream.Next(context.Background())
			equal(t, err, nil)
			equal(t, item, out.SynthesisItemAsBytes{Value: []byte("RIFF")})
		}
		equal(t, b.closes.Load(), int32(0))
		equal(t, stream.Close(), nil)
		equal(t, stream.Close(), nil)
		equal(t, b.closes.Load(), int32(1))
		if read {
			equal(t, b.reads.Load(), int32(1))
		} else {
			equal(t, b.reads.Load(), int32(0))
		}
		item, err := stream.Next(context.Background())
		equal(t, item, nil)
		equal(t, err, io.EOF)
	}
}

func TestReadAndCloseErrorsRetainPrecedence(t *testing.T) {
	failure := errors.New("read failure")
	closeFailure := errors.New("close failure")
	for _, readError := range []error{failure, io.EOF} {
		b := newBody(step{data: []byte("first"), err: readError})
		b.closeError = closeFailure
		stream, err := Synthesize(context.Background(), request(), options(b, "audio/wav", 200))
		if err != nil {
			t.Fatal(err)
		}
		item, err := stream.Next(context.Background())
		equal(t, err, nil)
		equal(t, item, out.SynthesisItemAsBytes{Value: []byte("first")})
		item, err = stream.Next(context.Background())
		equal(t, item, nil)
		if readError == failure {
			equal(t, err, failure)
		} else {
			equal(t, err, closeFailure)
		}
		equal(t, b.closes.Load(), int32(1))
		equal(t, stream.Close(), closeFailure)
	}
	b := newBody()
	stream, err := Synthesize(context.Background(), request(), options(b, "", 200))
	if err != nil {
		t.Fatal(err)
	}
	items, err := collect(t, stream)
	equal(t, items, []out.SynthesisItem{})
	equal(t, err.Error(), "Typecast returned no audio")
	equal(t, b.closes.Load(), int32(1))
}

func TestPendingReadCancellationAndConcurrentClose(t *testing.T) {
	for _, mode := range []string{"parent", "next", "close"} {
		t.Run(mode, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			parent, cancelParent := context.WithCancel(ctx)
			defer cancelParent()
			next, cancelNext := context.WithCancel(ctx)
			defer cancelNext()
			b := newBody()
			b.stall = true
			stream, err := Synthesize(parent, request(), options(b, "audio/wav", 200))
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Close()
			result := make(chan error, 1)
			go func() {
				item, err := stream.Next(next)
				if item != nil {
					result <- errors.New("unexpected audio")
					return
				}
				result <- err
			}()
			select {
			case <-b.reading:
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
			switch mode {
			case "parent":
				cancelParent()
			case "next":
				cancelNext()
			case "close":
				equal(t, stream.Close(), nil)
			}
			select {
			case err := <-result:
				equal(t, err, context.Canceled)
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
			equal(t, b.closes.Load(), int32(1))
			_, err = stream.Next(ctx)
			equal(t, err, io.EOF)
		})
	}
}

func TestCancellationAfterEnvelopeSuppressesDone(t *testing.T) {
	for _, parent := range []bool{false, true} {
		ctx, cancel := context.WithCancel(context.Background())
		b := newBody(step{data: shared(t).TimestampResponse})
		operation := context.Background()
		if parent {
			operation = ctx
		}
		stream, err := Synthesize(operation, timed(), options(b, "application/json", 200))
		if err != nil {
			t.Fatal(err)
		}
		item, err := stream.Next(context.Background())
		equal(t, err, nil)
		if _, ok := item.(out.SynthesisItemAsChunk); !ok {
			t.Fatal(item)
		}
		equal(t, b.closes.Load(), int32(1))
		cancel()
		next := context.Background()
		if !parent {
			next = ctx
		}
		item, err = stream.Next(next)
		equal(t, item, nil)
		equal(t, err, context.Canceled)
		equal(t, b.closes.Load(), int32(1))
		stream.Close()
	}
}

func TestDeadlineOwnsHeaderReadAndIdleTime(t *testing.T) {
	o := Options{Auth: authConfig(), TimeoutMs: runtime.Some(int64(20)), Transport: transportFunc(func(r *http.Request) (*http.Response, error) { <-r.Context().Done(); return nil, r.Context().Err() })}
	_, err := Synthesize(context.Background(), request(), o)
	equal(t, err, context.DeadlineExceeded)
	for _, idle := range []bool{false, true} {
		b := newBody(step{data: []byte("first")})
		b.stall = true
		o := options(b, "audio/wav", 200)
		o.TimeoutMs = runtime.Some(int64(20))
		stream, err := Synthesize(context.Background(), request(), o)
		if err != nil {
			t.Fatal(err)
		}
		defer stream.Close()
		item, err := stream.Next(context.Background())
		equal(t, err, nil)
		equal(t, item, out.SynthesisItemAsBytes{Value: []byte("first")})
		if idle {
			select {
			case <-b.closed:
			case <-time.After(2 * time.Second):
				t.Fatal("Deadline did not close idle response")
			}
		}
		item, err = stream.Next(context.Background())
		equal(t, item, nil)
		equal(t, err, context.DeadlineExceeded)
		equal(t, b.closes.Load(), int32(1))
	}
}

func TestCanceledLateResponseIsClosed(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	b := newBody(step{data: []byte("unread")})
	o := options(b, "audio/wav", 200)
	o.Transport = transportFunc(func(r *http.Request) (*http.Response, error) {
		cancel()
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: b}, nil
	})
	stream, err := Synthesize(ctx, request(), o)
	equal(t, stream, nil)
	equal(t, err, context.Canceled)
	equal(t, b.closes.Load(), int32(1))
	equal(t, b.reads.Load(), int32(0))
}

func TestNativeHTTPAuthProxyFirstByteAndDisconnect(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	observed := make(chan *http.Request, 1)
	disconnected := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		observed <- r.Clone(context.Background())
		if _, err := io.Copy(io.Discard, r.Body); err != nil {
			t.Error(err)
			return
		}
		w.Header().Set("Content-Type", "audio/wav")
		w.Write([]byte("RIFF"))
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(disconnected)
	}))
	defer server.Close()
	stream, err := Synthesize(ctx, request(), Options{Auth: authConfig(), BaseURL: server.URL + "/proxy%2Ftenant?tenant=one&granularity=stale"})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	item, err := stream.Next(ctx)
	equal(t, err, nil)
	equal(t, item, out.SynthesisItemAsBytes{Value: []byte("RIFF")})
	req := <-observed
	equal(t, req.RequestURI, "/proxy%2Ftenant/v1/text-to-speech/stream?tenant=one")
	equal(t, req.Header.Get("X-API-KEY"), "fixture")
	equal(t, req.Header.Get("Accept"), "audio/wav")
	equal(t, stream.Close(), nil)
	select {
	case <-disconnected:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
}

func TestNativeRedirectNeverReplaysCredentials(t *testing.T) {
	var calls atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.Write([]byte("wrong")) }))
	defer target.Close()
	original := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, 307) }))
	defer original.Close()
	_, err := Synthesize(context.Background(), request(), Options{Auth: authConfig(), BaseURL: original.URL})
	var native *Error
	if !errors.As(err, &native) {
		t.Fatal(err)
	}
	equal(t, native.Status, 307)
	equal(t, calls.Load(), int32(0))
}
