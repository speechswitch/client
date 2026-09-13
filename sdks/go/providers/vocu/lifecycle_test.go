package vocu

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	out "github.com/speechswitch/client/sdks/go/generated/vocu_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func TestEarlyCloseAndByteReadErrors(t *testing.T) {
	for _, read := range []bool{false, true} {
		b := newBody(step{data: []byte{0, 255}}, step{data: []byte("unread")})
		b.stall = true
		s, err := Synthesize(context.Background(), request(), options(response(b)))
		if err != nil {
			t.Fatal(err)
		}
		if read {
			item, err := s.Next(context.Background())
			equal(t, err, nil)
			equal(t, item, out.SynthesisItemAsBytes{Value: []byte{0, 255}})
		}
		equal(t, s.Close(), nil)
		equal(t, s.Close(), nil)
		equal(t, b.closes.Load(), int32(1))
		reads := int32(0)
		if read {
			reads = 1
		}
		equal(t, b.reads.Load(), reads)
		item, err := s.Next(context.Background())
		equal(t, item, nil)
		equal(t, err, io.EOF)
	}
	failure := errors.New("read failure")
	closeFailure := errors.New("close failure")
	for _, readError := range []error{failure, io.EOF} {
		b := newBody(step{data: []byte("first"), err: readError})
		b.closeError = closeFailure
		s, err := Synthesize(context.Background(), request(), options(response(b)))
		if err != nil {
			t.Fatal(err)
		}
		item, err := s.Next(context.Background())
		equal(t, err, nil)
		equal(t, item, out.SynthesisItemAsBytes{Value: []byte("first")})
		item, err = s.Next(context.Background())
		equal(t, item, nil)
		if readError == failure {
			equal(t, err, failure)
		} else {
			equal(t, err, closeFailure)
		}
		equal(t, b.closes.Load(), int32(1))
		s.Close()
		equal(t, b.closes.Load(), int32(1))
	}
}

func TestPendingReadCancellationAndConcurrentClose(t *testing.T) {
	for _, mode := range []string{"parent", "next", "close"} {
		t.Run(mode, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			parent, cancelParent := context.WithCancel(ctx)
			defer cancelParent()
			next, cancelNext := context.WithCancel(ctx)
			defer cancelNext()
			b := newBody()
			b.stall = true
			s, err := Synthesize(parent, request(), options(response(b)))
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			result := make(chan error, 1)
			go func() {
				item, err := s.Next(next)
				if item != nil {
					result <- errors.New("unexpected item")
				} else {
					result <- err
				}
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
				equal(t, s.Close(), nil)
			}
			select {
			case err := <-result:
				equal(t, err, context.Canceled)
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
			equal(t, b.closes.Load(), int32(1))
			_, err = s.Next(ctx)
			equal(t, err, io.EOF)
		})
	}
}

func TestCancellationAfterLastAudioSuppressesDone(t *testing.T) {
	for _, parent := range []bool{false, true} {
		ctx, cancel := context.WithCancel(context.Background())
		operation := context.Background()
		if parent {
			operation = ctx
		}
		b := newBody(step{data: []byte{1}, err: io.EOF})
		s, err := Synthesize(operation, request(), options(response(b)))
		if err != nil {
			t.Fatal(err)
		}
		item, err := s.Next(context.Background())
		equal(t, err, nil)
		equal(t, item, out.SynthesisItemAsBytes{Value: []byte{1}})
		cancel()
		next := context.Background()
		if !parent {
			next = ctx
		}
		item, err = s.Next(next)
		equal(t, item, nil)
		equal(t, err, context.Canceled)
		s.Close()
		equal(t, b.closes.Load(), int32(1))
	}
}

func TestDeadlineCoversHeadersPollingReadsAndConsumerIdle(t *testing.T) {
	for _, phase := range []string{"headers", "poll", "read", "idle"} {
		t.Run(phase, func(t *testing.T) {
			b := newBody(step{data: []byte{1}})
			b.stall = true
			r := response(b)
			if phase == "poll" {
				r = metadata(t, map[string]any{"id": "job", "status": "pending"})
				b = r.Body.(*body)
			}
			o := options(r)
			o.TimeoutMs = runtime.Some(int64(100))
			if phase == "poll" {
				o.Mode = "async"
			}
			if phase == "headers" {
				o.Transport = transportFunc(func(r *http.Request) (*http.Response, error) { <-r.Context().Done(); return nil, r.Context().Err() })
			}
			s, err := Synthesize(context.Background(), request(), o)
			if phase == "headers" {
				equal(t, s, nil)
				equal(t, err, context.DeadlineExceeded)
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			if phase == "idle" {
				item, err := s.Next(context.Background())
				equal(t, err, nil)
				equal(t, item, out.SynthesisItemAsBytes{Value: []byte{1}})
				select {
				case <-b.closed:
				case <-time.After(3 * time.Second):
					t.Fatal("idle timeout did not close body")
				}
			}
			_, err = collect(t, s)
			equal(t, err, context.DeadlineExceeded)
			equal(t, b.closes.Load(), int32(1))
		})
	}
}

func TestCancellationDuringPollingDoesNotDeleteOrResubmit(t *testing.T) {
	for _, phase := range []string{"pause", "headers", "metadata", "download"} {
		t.Run(phase, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			initial := metadata(t, map[string]any{"id": "job_1", "status": "pending"})
			stalled := newBody()
			stalled.stall = true
			reached := make(chan struct{})
			var calls atomic.Int32
			o := options()
			o.Mode = "async"
			o.PollIntervalMs = runtime.Some(int64(0))
			if phase == "pause" {
				o.PollIntervalMs = runtime.Some(int64(2000))
			}
			o.Transport = transportFunc(func(r *http.Request) (*http.Response, error) {
				call := calls.Add(1)
				if call == 1 {
					return initial, nil
				}
				equal(t, r.Method, "GET")
				if phase == "headers" {
					close(reached)
					<-r.Context().Done()
					return nil, r.Context().Err()
				}
				if phase == "metadata" {
					close(reached)
					return response(stalled), nil
				}
				if phase == "download" && call == 2 {
					return metadata(t, native(t, shared(t).GeneratedJob)), nil
				}
				close(reached)
				equal(t, r.Header, http.Header{})
				<-r.Context().Done()
				return nil, r.Context().Err()
			})
			s, err := Synthesize(ctx, request(), o)
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			result := make(chan error, 1)
			go func() { _, err := s.Next(ctx); result <- err }()
			if phase == "pause" {
				select {
				case <-initial.Body.(*body).closed:
				case <-ctx.Done():
					t.Fatal(ctx.Err())
				}
			} else {
				select {
				case <-reached:
				case <-ctx.Done():
					t.Fatal(ctx.Err())
				}
			}
			equal(t, s.Close(), nil)
			select {
			case err := <-result:
				equal(t, err, context.Canceled)
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
			expected := int32(2)
			if phase == "pause" {
				expected = 1
			} else if phase == "download" {
				expected = 3
			}
			equal(t, calls.Load(), expected)
			equal(t, initial.Body.(*body).closes.Load(), int32(1))
			if phase == "metadata" {
				equal(t, stalled.closes.Load(), int32(1))
			}
		})
	}
}

func TestNativeHTTPStreamingEarlyDisconnectAndRedirectRejection(t *testing.T) {
	disconnected := make(chan struct{})
	received := make(chan *http.Request, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := io.ReadAll(r.Body)
		if err != nil {
			t.Error(err)
			return
		}
		equal(t, native(t, data), native(t, shared(t).Requests[0].Wire))
		received <- r.Clone(context.Background())
		w.Header().Set("Content-Type", "audio/mpeg")
		w.Write([]byte{0, 255, 128})
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(disconnected)
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	s, err := Synthesize(ctx, request(), Options{Auth: authConfig(), BaseURL: server.URL + "/proxy"})
	if err != nil {
		t.Fatal(err)
	}
	item, err := s.Next(ctx)
	equal(t, err, nil)
	equal(t, item, out.SynthesisItemAsBytes{Value: []byte{0, 255, 128}})
	equal(t, s.Close(), nil)
	select {
	case <-disconnected:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	r := <-received
	equal(t, r.Method, "POST")
	equal(t, r.URL.Path, "/proxy/api/tts/simple-generate")
	equal(t, r.Header.Get("Authorization"), "Bearer fixture")
	equal(t, r.URL.RawQuery, "")
	var followed atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { followed.Add(1) }))
	defer target.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, http.StatusFound) }))
	defer redirect.Close()
	s, err = Synthesize(ctx, request(), Options{Auth: authConfig(), BaseURL: redirect.URL})
	equal(t, s, nil)
	equal(t, err, &Error{Status: runtime.Some(302)})
	equal(t, followed.Load(), int32(0))
}

func TestLateResponseAfterCancellationIsReleased(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	b := newBody(step{data: []byte{1}})
	o := Options{Auth: authConfig(), Transport: transportFunc(func(*http.Request) (*http.Response, error) { cancel(); return response(b), nil })}
	s, err := Synthesize(ctx, request(), o)
	equal(t, s, nil)
	equal(t, err, context.Canceled)
	equal(t, b.closes.Load(), int32(1))
	equal(t, b.reads.Load(), int32(0))
}
