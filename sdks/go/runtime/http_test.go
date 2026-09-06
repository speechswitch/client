package runtime

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync/atomic"
	"testing"
	"time"
)

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) Do(request *http.Request) (*http.Response, error) { return f(request) }

type countedBody struct {
	reader io.Reader
	reads  atomic.Int32
	closes atomic.Int32
}

func (b *countedBody) Read(p []byte) (int, error) { b.reads.Add(1); return b.reader.Read(p) }
func (b *countedBody) Close() error               { b.closes.Add(1); return nil }

func audioRequest(t *testing.T, ctx context.Context, url string) *http.Request {
	t.Helper()
	request, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader([]byte{0, 255}))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "test credential")
	return request
}

func openTestAudio(t *testing.T, body io.ReadCloser) Input[[]byte] {
	t.Helper()
	audio, err := OpenAudio(audioRequest(t, context.Background(), "https://example.invalid/tts"), transportFunc(func(request *http.Request) (*http.Response, error) {
		sent, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatal(err)
		}
		request.Body.Close()
		if request.Method != "POST" || request.URL.String() != "https://example.invalid/tts" || request.Header.Get("Authorization") != "test credential" || !bytes.Equal(sent, []byte{0, 255}) {
			t.Fatalf("Wrong request: method=%s url=%s body=%v", request.Method, request.URL, sent)
		}
		return &http.Response{StatusCode: 200, Body: body}, nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	return audio
}

func TestHTTPAudioIsPulledAndEOFClosesOnce(t *testing.T) {
	body := &countedBody{reader: io.MultiReader(bytes.NewReader([]byte{0, 255}), bytes.NewReader([]byte{1, 2}))}
	audio := openTestAudio(t, body)
	defer audio.Close()
	if got := body.reads.Load(); got != 0 {
		t.Fatalf("Read before first pull: %d", got)
	}
	first, err := audio.Next(context.Background())
	if err != nil || !bytes.Equal(first, []byte{0, 255}) {
		t.Fatalf("First pull: %v, %v", first, err)
	}
	if got := body.reads.Load(); got != 1 {
		t.Fatalf("Read ahead: %d", got)
	}
	second, err := audio.Next(context.Background())
	if err != nil || !bytes.Equal(second, []byte{1, 2}) {
		t.Fatalf("Second pull: %v, %v", second, err)
	}
	if !bytes.Equal(first, []byte{0, 255}) {
		t.Fatalf("Reused consumer-owned bytes: %v", first)
	}
	for range 2 {
		data, err := audio.Next(context.Background())
		if data != nil || err != io.EOF {
			t.Fatalf("Completion: %v, %v", data, err)
		}
	}
	audio.Close()
	if got := body.closes.Load(); got != 1 {
		t.Fatalf("Close count: %d", got)
	}
	if got := body.reads.Load(); got != 3 {
		t.Fatalf("Read count: %d", got)
	}
}

func TestHTTPEarlyCloseAndUnreadResponse(t *testing.T) {
	for _, readFirst := range []bool{false, true} {
		body := &countedBody{reader: bytes.NewReader([]byte{0, 255})}
		audio := openTestAudio(t, body)
		wantReads := int32(0)
		if readFirst {
			if _, err := audio.Next(context.Background()); err != nil {
				t.Fatal(err)
			}
			wantReads = 1
		}
		audio.Close()
		audio.Close()
		if body.reads.Load() != wantReads || body.closes.Load() != 1 {
			t.Fatalf("Reads/closes: %d/%d", body.reads.Load(), body.closes.Load())
		}
	}
}

func TestHTTPStatusErrorDoesNotReadPrivateBody(t *testing.T) {
	for _, status := range []int{199, 300, 401, 429, 500} {
		body := &countedBody{reader: bytes.NewBufferString("private error body")}
		stream, err := OpenAudio(audioRequest(t, context.Background(), "https://example.invalid/tts"), transportFunc(func(request *http.Request) (*http.Response, error) {
			request.Body.Close()
			return &http.Response{StatusCode: status, Body: body}, nil
		}))
		if stream != nil || !reflect.DeepEqual(err, &HTTPStatusError{StatusCode: status}) {
			t.Fatalf("Status result: %v, %v", stream, err)
		}
		if body.reads.Load() != 0 || body.closes.Load() != 1 {
			t.Fatalf("Reads/closes: %d/%d", body.reads.Load(), body.closes.Load())
		}
	}
}

type finalReader struct{ err error }

func (r finalReader) Read(p []byte) (int, error) { return copy(p, []byte{0, 255}), r.err }

func TestHTTPFinalBytesSurviveSimultaneousError(t *testing.T) {
	failure := errors.New("broken stream")
	for _, terminal := range []error{io.EOF, failure} {
		body := &countedBody{reader: finalReader{terminal}}
		audio := openTestAudio(t, body)
		first, err := audio.Next(context.Background())
		if err != nil || !bytes.Equal(first, []byte{0, 255}) {
			t.Fatalf("Final bytes: %v, %v", first, err)
		}
		if body.closes.Load() != 1 {
			t.Fatalf("Unreleased failed body: %d", body.closes.Load())
		}
		if next, err := audio.Next(context.Background()); next != nil || err != terminal {
			t.Fatalf("Terminal result: %v, %v", next, err)
		}
		if next, err := audio.Next(context.Background()); next != nil || err != io.EOF {
			t.Fatalf("Repeated error: %v, %v", next, err)
		}
		if body.reads.Load() != 1 {
			t.Fatalf("Read after failure: %d", body.reads.Load())
		}
	}
}

type emptyReader struct{}

func (emptyReader) Read([]byte) (int, error) { return 0, nil }

func TestHTTPStalledReaderDoesNotSpinForever(t *testing.T) {
	body := &countedBody{reader: emptyReader{}}
	audio := openTestAudio(t, body)
	data, err := audio.Next(context.Background())
	if data != nil || err != io.ErrNoProgress {
		t.Fatalf("No-progress result: %v, %v", data, err)
	}
	if body.reads.Load() != 100 || body.closes.Load() != 1 {
		t.Fatalf("Reads/closes: %d/%d", body.reads.Load(), body.closes.Load())
	}
}

func awaitSignal(t *testing.T, signal <-chan struct{}) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(3 * time.Second):
		t.Fatal("Timed out waiting for lifecycle signal")
	}
}

func TestHTTPNativeTransportStreamsBeforeServerCompletesAndClosesOnEarlyExit(t *testing.T) {
	canceled := make(chan struct{})
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.Copy(io.Discard, r.Body)
		w.Write([]byte{0, 255})
		w.(http.Flusher).Flush()
		select {
		case <-r.Context().Done():
			close(canceled)
		case <-release:
		}
	}))
	defer server.Close()
	defer close(release)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	audio, err := OpenAudio(audioRequest(t, ctx, server.URL), server.Client())
	if err != nil {
		t.Fatal(err)
	}
	defer audio.Close()
	chunk, err := audio.Next(ctx)
	if err != nil || !bytes.Equal(chunk, []byte{0, 255}) {
		t.Fatalf("Incremental audio: %v, %v", chunk, err)
	}
	audio.Close()
	awaitSignal(t, canceled)
}

func TestHTTPNativeTransportCancellationDuringRead(t *testing.T) {
	for _, cancelRequest := range []bool{false, true} {
		canceled := make(chan struct{})
		release := make(chan struct{})
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			io.Copy(io.Discard, r.Body)
			w.WriteHeader(http.StatusOK)
			w.(http.Flusher).Flush()
			select {
			case <-r.Context().Done():
				close(canceled)
			case <-release:
			}
		}))
		func() {
			defer server.Close()
			defer close(release)
			requestCtx, cancelRequestCtx := context.WithCancel(context.Background())
			defer cancelRequestCtx()
			nextCtx, cancelNextCtx := context.WithCancel(context.Background())
			defer cancelNextCtx()
			audio, err := OpenAudio(audioRequest(t, requestCtx, server.URL), server.Client())
			if err != nil {
				t.Fatal(err)
			}
			defer audio.Close()
			result := make(chan error, 1)
			go func() { _, err := audio.Next(nextCtx); result <- err }()
			if cancelRequest {
				cancelRequestCtx()
			} else {
				cancelNextCtx()
			}
			select {
			case err := <-result:
				if err != context.Canceled {
					t.Fatalf("Cancellation result: %v", err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("Read did not stop")
			}
			awaitSignal(t, canceled)
		}()
	}
}

func TestHTTPCancellationBeforeHeadersReachesNativeTransport(t *testing.T) {
	started, canceled, release := make(chan struct{}), make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Drain the request so net/http can observe peer disconnects while
		// this handler deliberately withholds the response headers.
		io.Copy(io.Discard, r.Body)
		close(started)
		select {
		case <-r.Context().Done():
			close(canceled)
		case <-release:
		}
	}))
	defer server.Close()
	defer close(release)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	request := audioRequest(t, ctx, server.URL)
	result := make(chan error, 1)
	go func() { _, err := OpenAudio(request, server.Client()); result <- err }()
	awaitSignal(t, started)
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("Cancellation result: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Send did not stop")
	}
	awaitSignal(t, canceled)
}

func TestHTTPTransportFailureReleasesDerivedContext(t *testing.T) {
	failure := errors.New("connection failed")
	var sentContext context.Context
	request := audioRequest(t, context.Background(), "https://example.invalid/tts")
	stream, err := OpenAudio(request, transportFunc(func(sent *http.Request) (*http.Response, error) {
		sentContext = sent.Context()
		sent.Body.Close()
		return nil, failure
	}))
	if stream != nil || err != failure {
		t.Fatalf("Send failure: %v, %v", stream, err)
	}
	if sentContext.Err() != context.Canceled {
		t.Fatalf("Derived context: %v", sentContext.Err())
	}
	if request.Context().Err() != nil {
		t.Fatalf("Mutated caller context: %v", request.Context().Err())
	}
}
