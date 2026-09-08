package lovo

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/speechswitch/client/sdks/go/runtime"
)

func wait(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out")
	}
}

func TestCancellationOwnsEveryPhase(t *testing.T) {
	for _, phase := range []string{"headers", "metadata", "poll delay", "poll headers", "asset headers", "audio"} {
		for _, mode := range []string{"parent", "next", "close"} {
			t.Run(phase+"/"+mode, func(t *testing.T) {
				parent, cancel := context.WithCancel(context.Background())
				defer cancel()
				next, cancelNext := context.WithCancel(context.Background())
				defer cancelNext()
				waiting := make(chan struct{})
				reader, writer := io.Pipe()
				defer writer.Close()
				b := &body{Reader: readerFunc(func(p []byte) (int, error) { close(waiting); return reader.Read(p) }), closeFn: reader.Close}
				initial := job(t)
				if phase == "poll delay" || phase == "poll headers" {
					initial["status"] = "in_progress"
				}
				raw := encode(t, initial)
				var calls atomic.Int32
				interval := 0
				if phase == "poll delay" {
					interval = 60000
				}
				s, err := Synthesize(parent, request(), Options{Auth: testAuth, PollIntervalMs: runtime.Some(interval), Transport: transport(func(r *http.Request) (*http.Response, error) {
					n := calls.Add(1)
					if phase == "headers" || (n == 2 && (phase == "poll headers" || phase == "asset headers")) {
						close(waiting)
						<-r.Context().Done()
						return nil, r.Context().Err()
					}
					if phase == "metadata" || (n == 2 && phase == "audio") {
						return response(map[bool]int{true: 201, false: 200}[n == 1], b), nil
					}
					metadata := &body{Reader: strings.NewReader(raw)}
					if phase == "poll delay" {
						metadata.closeFn = func() error { close(waiting); return nil }
					}
					return response(201, metadata), nil
				})})
				if err != nil {
					t.Fatal(err)
				}
				defer s.Close()
				done := make(chan struct{})
				var result error
				go func() { defer close(done); _, result = s.Next(next) }()
				wait(t, waiting)
				switch mode {
				case "parent":
					cancel()
				case "next":
					cancelNext()
				case "close":
					s.Close()
				}
				wait(t, done)
				equal(t, result, context.Canceled)
				expected := int32(1)
				if phase == "poll headers" || phase == "asset headers" || phase == "audio" {
					expected = 2
				}
				equal(t, calls.Load(), expected)
				if phase == "metadata" || phase == "audio" {
					equal(t, b.closes.Load(), int32(1))
				}
				_, err = s.Next(context.Background())
				equal(t, err, io.EOF)
			})
		}
	}
}

func TestUnreadAndPreCanceledStreamsDoNotSubmit(t *testing.T) {
	calls := 0
	options := Options{Auth: testAuth, Transport: transport(func(*http.Request) (*http.Response, error) { calls++; return nil, nil })}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := Synthesize(ctx, request(), options)
	equal(t, err, context.Canceled)
	s := start(t, options)
	_, err = s.Next(ctx)
	equal(t, err, context.Canceled)
	s = start(t, options)
	s.Close()
	_, err = s.Next(context.Background())
	equal(t, err, io.EOF)
	equal(t, calls, 0)
}

func TestPollIdentityAndNativeFailure(t *testing.T) {
	for _, tc := range []struct{ mode, status, change, message string }{
		{"sync", "in_progress", "id", "LOVO returned a different job ID while polling"},
		{"async", "done", "status", "LOVO returned an inconsistent completed job"},
		{"sync", "in_progress", "error", "quota"},
	} {
		initial := job(t)
		initial["status"] = tc.status
		final := job(t)
		switch tc.change {
		case "id":
			final["id"] = "other"
		case "status":
			final["status"] = "in_progress"
		case "error":
			final["error"] = map[string]any{"message": "quota", "code": "QUOTA"}
		}
		calls := 0
		s := start(t, Options{Auth: testAuth, Mode: runtime.Some(tc.mode), PollIntervalMs: runtime.Some(0), Transport: transport(func(*http.Request) (*http.Response, error) {
			calls++
			if calls == 1 {
				return response(201, io.NopCloser(strings.NewReader(encode(t, initial)))), nil
			}
			return response(200, io.NopCloser(strings.NewReader(encode(t, final)))), nil
		})})
		_, err := s.Next(context.Background())
		errorText(t, err, tc.message)
		equal(t, calls, 2)
		if tc.change == "error" {
			equal(t, err, &Error{Message: "quota", Code: runtime.Some("QUOTA"), JobID: runtime.Some("job/1")})
		}
	}
}

func TestNativeHTTPAndTLSStreaming(t *testing.T) {
	for _, tls := range []bool{false, true} {
		t.Run(map[bool]string{false: "HTTP", true: "TLS"}[tls], func(t *testing.T) {
			var server *httptest.Server
			var mutex sync.Mutex
			var calls []string
			first := make(chan struct{})
			release := make(chan struct{})
			j := job(t)
			initial := job(t)
			initial["status"] = "in_progress"
			handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				mutex.Lock()
				calls = append(calls, r.Method+" "+r.URL.EscapedPath())
				mutex.Unlock()
				if r.URL.Path == "/audio" {
					equal(t, r.Header.Get("X-API-KEY"), "")
					equal(t, r.Header.Get("Cookie"), "")
					equal(t, r.Header.Get("Authorization"), "")
					w.Write([]byte{1, 2})
					w.(http.Flusher).Flush()
					close(first)
					select {
					case <-release:
					case <-r.Context().Done():
					}
					return
				}
				equal(t, r.Header.Get("X-API-KEY"), "test-key")
				w.Header().Set("Set-Cookie", "private=1")
				if r.Method == "POST" {
					w.WriteHeader(201)
					io.WriteString(w, encode(t, initial))
					return
				}
				io.WriteString(w, encode(t, j))
			})
			if tls {
				server = httptest.NewTLSServer(handler)
			} else {
				server = httptest.NewServer(handler)
			}
			defer server.Close()
			defer close(release)
			j["data"].([]any)[0].(map[string]any)["urls"] = []string{server.URL + "/audio"}
			options := Options{Auth: testAuth, BaseURL: server.URL, PollIntervalMs: runtime.Some(0)}
			if tls {
				client := server.Client()
				client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
				options.Transport = client
			}
			s := start(t, options)
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			item, err := s.Next(ctx)
			if err != nil {
				t.Fatal(err)
			}
			equal(t, item.Audio, []byte{1, 2})
			wait(t, first)
			s.Close()
			mutex.Lock()
			defer mutex.Unlock()
			equal(t, calls, []string{"POST /api/v1/tts/sync", "GET /api/v1/tts/job%2F1", "GET /audio"})
		})
	}
}

func TestNativeRedirectsNeverForwardCredentials(t *testing.T) {
	var reached atomic.Int32
	destination := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { reached.Add(1) }))
	defer destination.Close()
	for _, phase := range []string{"submit", "asset"} {
		var server *httptest.Server
		j := job(t)
		server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if phase == "submit" || r.URL.Path == "/audio" {
				w.Header().Set("Location", destination.URL)
				w.WriteHeader(307)
				return
			}
			w.WriteHeader(201)
			io.WriteString(w, encode(t, j))
		}))
		j["data"].([]any)[0].(map[string]any)["urls"] = []string{server.URL + "/audio"}
		s := start(t, Options{Auth: testAuth, BaseURL: server.URL})
		_, err := s.Next(context.Background())
		expected := &Error{Message: "LOVO returned HTTP 307; expected 201", StatusCode: runtime.Some(307)}
		if phase == "asset" {
			expected.Message = "LOVO audio download returned HTTP 307"
			expected.JobID = runtime.Some("job/1")
		}
		equal(t, err, expected)
		s.Close()
		server.Close()
	}
	equal(t, reached.Load(), int32(0))
}

func TestBOMAndAssetFailureBounds(t *testing.T) {
	for _, limit := range []int{0, 1024} {
		calls := 0
		asset := &body{Reader: strings.NewReader("denied")}
		s := start(t, Options{Auth: testAuth, MaxJSONBytes: limit, Transport: transport(func(*http.Request) (*http.Response, error) {
			calls++
			if calls == 1 {
				return response(201, io.NopCloser(strings.NewReader("\ufeff"+encode(t, job(t))))), nil
			}
			r := response(403, asset)
			r.Header = http.Header{"Retry-After": {""}}
			return r, nil
		})})
		_, err := s.Next(context.Background())
		equal(t, err, &Error{Message: "denied", StatusCode: runtime.Some(403), JobID: runtime.Some("job/1"), RetryAfter: runtime.Some("")})
		equal(t, asset.closes.Load(), int32(1))
	}
	calls := 0
	asset := &body{Reader: strings.NewReader(strings.Repeat("x", 1025))}
	s := start(t, Options{Auth: testAuth, MaxJSONBytes: 1024, Transport: transport(func(*http.Request) (*http.Response, error) {
		calls++
		if calls == 1 {
			return response(201, io.NopCloser(strings.NewReader(encode(t, job(t))))), nil
		}
		return response(500, asset), nil
	})})
	_, err := s.Next(context.Background())
	errorText(t, err, "LOVO response exceeds MaxJSONBytes")
	equal(t, calls, 2)
	equal(t, asset.closes.Load(), int32(1))
}
