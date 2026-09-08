package microsoft

import (
	"context"
	"errors"
	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/microsoft"
	"github.com/speechswitch/client/sdks/go/runtime"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestCancellationOwnsPendingInputOutputAndSends(t *testing.T) {
	for _, phase := range []string{"input", "speech.config", "synthesis.context", "text.piece", "text.end", "receive"} {
		for _, mode := range []string{"parent", "next", "close"} {
			t.Run(phase+"/"+mode, func(t *testing.T) {
				socket := newSocket()
				input := newSource("Hi")
				input.stall = phase != "text.end"
				waiting, release := make(chan struct{}), make(chan struct{})
				var once sync.Once
				defer close(release)
				socket.hook = func(_ context.Context, f sentFrame) error {
					if f.path == phase {
						once.Do(func() { close(waiting) })
						<-release
					}
					return nil
				}
				parent, cancel := context.WithCancel(context.Background())
				defer cancel()
				next, cancelNext := context.WithCancel(context.Background())
				defer cancelNext()
				stream, err := Synthesize(parent, streaming(input), Options{WebSocket: socket})
				if err != nil {
					t.Fatal(err)
				}
				defer stream.Close()
				result := make(chan error, 1)
				go func() { _, err := stream.Next(next); result <- err }()
				if phase == "input" || phase == "receive" {
					wait(t, input.waiting)
				} else {
					wait(t, waiting)
				}
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
					t.Fatal("cancellation waited for a stuck producer or writer")
				}
				equal(t, socket.closes.Load(), int32(1))
				if phase == "input" || phase == "receive" {
					wait(t, input.closed)
				}
			})
		}
	}
}

type stubborn struct {
	*source
	release chan struct{}
}

func (s *stubborn) Next(context.Context) (string, error) {
	s.once.Do(func() { close(s.waiting) })
	<-s.release
	return "late", nil
}
func TestCancellationIgnoringInputCannotSendLateText(t *testing.T) {
	input := &stubborn{source: newSource(), release: make(chan struct{})}
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
	equal(t, <-result, io.EOF)
	equal(t, socket.closes.Load(), int32(1))
	close(input.release)
	wait(t, input.closed)
	paths := []string{}
	for _, f := range socket.frames() {
		paths = append(paths, f.path)
	}
	equal(t, paths, []string{"speech.config", "synthesis.context", "synthesis.control"})
}

func TestStalledStopIsBoundedAndUnreadInputIsNotAdvanced(t *testing.T) {
	for _, unread := range []bool{true, false} {
		socket := newSocket()
		socket.auto("")
		auto := socket.hook
		released := make(chan struct{})
		socket.hook = func(ctx context.Context, f sentFrame) error {
			if f.path == "synthesis.control" {
				<-released
				return nil
			}
			return auto(ctx, f)
		}
		input := newSource("Hi")
		input.stall = true
		stream, err := Synthesize(context.Background(), streaming(input), Options{WebSocket: socket})
		if err != nil {
			t.Fatal(err)
		}
		if !unread {
			if _, err = stream.Next(context.Background()); err != nil {
				t.Fatal(err)
			}
		}
		done := make(chan struct{})
		go func() { stream.Close(); close(done) }()
		wait(t, done)
		close(released)
		wait(t, input.closed)
		equal(t, socket.closes.Load(), int32(1))
		if unread {
			equal(t, input.reads.Load(), int32(0))
			equal(t, socket.frames(), []sentFrame{})
		}
	}
}

func TestProducerAndTransportErrorsPreserveIdentity(t *testing.T) {
	failure := errors.New("original failure")
	for _, phase := range []string{"input", "send", "receive"} {
		socket := newSocket()
		input := newSource()
		input.stall = true
		switch phase {
		case "input":
			input.failure = failure
		case "send":
			socket.hook = func(context.Context, sentFrame) error { return failure }
		case "receive":
			socket.incoming <- socketResult{err: failure}
		}
		stream, err := Synthesize(context.Background(), streaming(input), Options{WebSocket: socket})
		if err != nil {
			t.Fatal(err)
		}
		_, err = stream.Next(context.Background())
		equal(t, err, failure)
		wait(t, input.closed)
		equal(t, socket.closes.Load(), int32(1))
	}
}

func TestBoundaryValidationPrecedesIO(t *testing.T) {
	socket := newSocket()
	input := newSource("Hi")
	bad := schema.TtsRequestAsDragonHdOmniTextVoicea5a77562{Value: schema.TtsRequestDragonHdOmniTextVoicea5a77562{Text: "Hi", Voice: "en-US-Ava", TopK: runtime.Some(1.5)}}
	_, expected := schema.ValidateRequest(bad)
	if expected == nil {
		t.Fatal("expected generated validation failure")
	}
	_, err := Synthesize(context.Background(), bad, Options{WebSocket: socket})
	errorText(t, err, expected.Error())
	for _, locale := range []string{"en-US,zh-CN", "en\nUS", "en\rUS"} {
		r := streaming(input)
		r.Value.PreferredLanguages = runtime.Some([]string{locale})
		_, err = Synthesize(context.Background(), r, Options{WebSocket: socket})
		errorText(t, err, "Microsoft preferred languages cannot contain commas or line breaks")
	}
	for _, endpoint := range []string{"https://user:pass@example.com", "https://example.com/#fragment", "https://example.com:99999", "https://example.com/%zz", "https://example.com/?bad=%xx", "https://example.com\\path"} {
		_, err = Synthesize(context.Background(), streaming(input), Options{WebSocket: socket, BaseURL: endpoint})
		errorText(t, err, "Invalid Microsoft endpoint URL")
	}
	for _, options := range []Options{{WebSocket: socket, MaxJSONBytes: -1}, {WebSocket: socket, MaxMessageBytes: -1}} {
		_, err = Synthesize(context.Background(), streaming(input), options)
		if options.MaxJSONBytes < 0 {
			errorText(t, err, "Microsoft MaxJSONBytes must be a positive uint32 value")
		} else {
			errorText(t, err, "Microsoft MaxMessageBytes must be a positive uint32 value")
		}
	}
	equal(t, input.reads.Load(), int32(0))
	equal(t, socket.frames(), []sentFrame{})
}

func TestAuthPresenceEnvironmentRegionsAndEmptyControls(t *testing.T) {
	t.Setenv("SPEECHSWITCH_MICROSOFT_API_KEY", "scoped")
	t.Setenv("AZURE_SPEECH_KEY", "vendor")
	t.Setenv("SPEECHSWITCH_MICROSOFT_ACCESS_TOKEN", "")
	t.Setenv("SPEECHSWITCH_MICROSOFT_REGION", "chinaeast2")
	for _, row := range []struct {
		auth             auth.Auth
		host, key, token string
	}{
		{auth.Auth{}, "chinaeast2.tts.speech.azure.cn", "scoped", ""},
		{auth.Auth{Microsoft: runtime.Some(auth.AuthMicrosoft{AccessToken: runtime.Some("token"), ApiKey: runtime.Some("key"), Region: runtime.Some("usgovvirginia")})}, "usgovvirginia.tts.speech.azure.us", "", "Bearer token"},
	} {
		stream, err := Synthesize(context.Background(), request(), Options{Auth: row.auth, Transport: transport(func(r *http.Request) (*http.Response, error) {
			equal(t, r.URL.Host, row.host)
			equal(t, r.Header.Get("Ocp-Apim-Subscription-Key"), row.key)
			equal(t, r.Header.Get("Authorization"), row.token)
			return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader("audio"))}, nil
		})})
		if err != nil {
			t.Fatal(err)
		}
		stream.Close()
	}
	_, err := Synthesize(context.Background(), request(), Options{Auth: auth.Auth{Microsoft: runtime.Some(auth.AuthMicrosoft{AccessToken: runtime.Some(""), ApiKey: runtime.Optional[string]{Value: "absent-value"}})}})
	errorText(t, err, "Missing auth.microsoft.apiKey or auth.microsoft.accessToken configuration")
	r := streaming(newSource())
	r.Value.LexiconUrl = runtime.Some("")
	r.Value.PreferredLanguages = runtime.Some([]string{})
	c, err := settings(r)
	if err != nil {
		t.Fatal(err)
	}
	equal(t, c.native, map[string]any{"bidirectionalStreamingMode": true, "voiceName": "en-US-AvaNeural", "language": "en-US", "customLexiconUrl": "", "preferLocales": ""})
}
