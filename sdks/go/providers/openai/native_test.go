package openai

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"sync/atomic"
	"testing"
	"time"

	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/openai"
	out "github.com/speechswitch/client/sdks/go/generated/openai_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func TestNativeHTTPDeliversEarlyAndReleasesOnCloseOrDone(t *testing.T) {
	for _, usage := range []bool{false, true} {
		func() {
			disconnected := make(chan struct{})
			release := make(chan struct{})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "POST" || r.RequestURI != "/proxy/v1/audio/speech?tenant=one" || r.Header.Get("Authorization") != "Bearer test" {
					t.Errorf("unexpected request: %s %s %v", r.Method, r.RequestURI, r.Header)
				}
				io.Copy(io.Discard, r.Body)
				r.Body.Close()
				w.Header().Set("X-Request-ID", "native")
				if usage {
					w.Header().Set("Content-Type", "text/event-stream")
					io.WriteString(w, delta+done)
				} else {
					w.Header().Set("Content-Type", "audio/pcm")
					w.Write([]byte{0, 255, 128})
				}
				w.(http.Flusher).Flush()
				select {
				case <-r.Context().Done():
					close(disconnected)
				case <-release:
				}
			}))
			defer server.Close()
			defer close(release)
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			request := schema.TtsRequest(legacy())
			if usage {
				request = mini()
			}
			audio, err := Synthesize(ctx, request, Options{Auth: authenticated(), BaseURL: server.URL + "/proxy/v1/?tenant=one"})
			if err != nil {
				t.Fatal(err)
			}
			defer audio.Close()
			item, err := audio.Next(ctx)
			if err != nil || !reflect.DeepEqual(item, out.SynthesisItemAsBytes{Value: []byte{0, 255, 128}}) {
				t.Fatal(item, err)
			}
			if usage {
				item, err = audio.Next(ctx)
				if err != nil || !reflect.DeepEqual(item, out.SynthesisItemAsDone{Value: out.DoneEvent{RequestId: runtime.Some("native"), Usage: runtime.Some(out.Usage{OutputTokens: 1, TotalTokens: 1})}}) {
					t.Fatal(item, err)
				}
			} else {
				audio.Close()
			}
			select {
			case <-disconnected:
			case <-time.After(time.Second):
				t.Fatal("native connection retained")
			}
		}()
	}
}

func TestNativeRedirectDoesNotReplayCredentials(t *testing.T) {
	var calls atomic.Int32
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.Write([]byte("audio")) }))
	defer destination.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", destination.URL)
		w.WriteHeader(307)
	}))
	defer source.Close()
	audio, err := Synthesize(context.Background(), legacy(), Options{Auth: authenticated(), BaseURL: source.URL})
	if err != nil {
		t.Fatal(err)
	}
	defer audio.Close()
	_, err = audio.Next(context.Background())
	var failure *Error
	if !errors.As(err, &failure) || failure.StatusCode != 307 || calls.Load() != 0 {
		t.Fatal(err, calls.Load())
	}
}

func TestAuthEnvironmentPrecedence(t *testing.T) {
	scoped, vendor, empty := "scoped", "vendor", ""
	for _, c := range []struct {
		explicit       auth.Auth
		scoped, vendor *string
		expected       string
	}{
		{authenticated(), &scoped, &vendor, "test"},
		{auth.Auth{}, &scoped, &vendor, "scoped"},
		{auth.Auth{}, nil, &vendor, "vendor"},
		{auth.Auth{Openai: runtime.Some(auth.AuthAsync{ApiKey: runtime.Some("")})}, &scoped, &vendor, ""},
		{auth.Auth{}, &empty, &vendor, ""},
		{auth.Auth{}, nil, nil, ""},
	} {
		func() {
			t.Setenv("SPEECHSWITCH_OPENAI_API_KEY", "")
			t.Setenv("OPENAI_API_KEY", "")
			if c.scoped == nil {
				os.Unsetenv("SPEECHSWITCH_OPENAI_API_KEY")
			} else {
				t.Setenv("SPEECHSWITCH_OPENAI_API_KEY", *c.scoped)
			}
			if c.vendor == nil {
				os.Unsetenv("OPENAI_API_KEY")
			} else {
				t.Setenv("OPENAI_API_KEY", *c.vendor)
			}
			calls := 0
			b := newBody()
			opts := Options{Auth: c.explicit, Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
				calls++
				if r.Header.Get("Authorization") != "Bearer "+c.expected {
					t.Fatal(r.Header)
				}
				return &http.Response{StatusCode: 200, Body: b}, nil
			})}
			audio, err := Synthesize(context.Background(), legacy(), opts)
			if c.expected == "" {
				if err == nil || err.Error() != "Missing auth.openai.apiKey configuration" || calls != 0 {
					t.Fatal(err, calls)
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				audio.Close()
				if calls != 1 || b.reads.Load() != 0 || b.closes.Load() != 1 {
					t.Fatal(calls, b.reads.Load(), b.closes.Load())
				}
			}
		}()
	}
}

func TestLowercaseHeadersAndAbsentIdentity(t *testing.T) {
	b := newBody(step{data: []byte(delta + done)})
	opts := Options{Auth: authenticated(), Transport: transportFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Header: http.Header{"content-type": {"Text/Event-Stream; charset=utf-8"}}, Body: b}, nil
	})}
	audio, err := Synthesize(context.Background(), mini(), opts)
	if err != nil {
		t.Fatal(err)
	}
	defer audio.Close()
	if _, err := audio.Next(context.Background()); err != nil {
		t.Fatal(err)
	}
	item, err := audio.Next(context.Background())
	expected := out.SynthesisItemAsDone{Value: out.DoneEvent{Usage: runtime.Some(out.Usage{OutputTokens: 1, TotalTokens: 1})}}
	if err != nil || !reflect.DeepEqual(item, expected) {
		t.Fatal(item, err)
	}
}

func TestExpiredParentAndTransportFailures(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	opts := Options{Auth: authenticated(), Transport: transportFunc(func(*http.Request) (*http.Response, error) {
		t.Fatal("canceled parent reached transport")
		return nil, nil
	})}
	if _, err := Synthesize(ctx, legacy(), opts); err != context.Canceled {
		t.Fatal(err)
	}
	failure := errors.New("failed headers")
	opts.Transport = transportFunc(func(*http.Request) (*http.Response, error) { return nil, failure })
	if _, err := Synthesize(context.Background(), legacy(), opts); err != failure {
		t.Fatal(err)
	}
	opts.Transport = transportFunc(func(*http.Request) (*http.Response, error) { return &http.Response{StatusCode: 200}, nil })
	if _, err := Synthesize(context.Background(), legacy(), opts); err == nil || err.Error() != "HTTP transport returned no response body" {
		t.Fatal(err)
	}
	for _, request := range []schema.TtsRequest{nil, (*schema.TtsRequestAsTextVoice15a214fc)(nil)} {
		_, expected := schema.ValidateRequest(request)
		if expected == nil {
			t.Fatal("expected generated validation failure")
		}
		if _, err := Synthesize(context.Background(), request, opts); err == nil || err.Error() != expected.Error() {
			t.Fatal(err)
		}
	}
}
