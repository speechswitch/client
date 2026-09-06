package google

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"

	schema "github.com/speechswitch/client/sdks/go/generated/google"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func TestHTTPResponseErrorsAndOwnership(t *testing.T) {
	for _, test := range []struct {
		name, data, message string
		status, limit       int
	}{
		{"missing audio", `{}`, "Google returned an invalid synthesis response", 200, 0},
		{"null audio", `{"audioContent":null}`, "Google returned an invalid synthesis response", 200, 0},
		{"bad json", `{`, "Google returned an invalid synthesis response", 200, 0},
		{"bad base64", `{"audioContent":"%%%"}`, "Google returned an invalid synthesis response", 200, 0},
		{"base64 line break", `{"audioContent":"YXVkaW8=\n"}`, "Google returned an invalid synthesis response", 200, 0},
		{"limit", `{"audioContent":"YXVkaW8="}`, "Google response exceeds MaxJSONBytes", 200, 10},
		{"provider error", `{"error":{"message":"denied"}}`, "Google 403: denied", 403, 0},
		{"nonjson error", "\xef\xbb\xbfunavailable", "Google 503: unavailable", 503, 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			body := &testBody{Reader: strings.NewReader(test.data)}
			r := schema.TtsRequestTextVoice{Model: flash, Language: "en-US", Voice: kore, Text: "hello", Output: wav}
			stream, err := Synthesize(context.Background(), schema.TtsRequestAsTextVoice{Value: r}, Options{Auth: testAuth, MaxJSONBytes: test.limit, Transport: testTransport(func(*http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: test.status, Body: body}, nil
			})})
			if err != nil {
				t.Fatal(err)
			}
			data, err := stream.Next(context.Background())
			stream.Close()
			if data != nil || err == nil || err.Error() != test.message || body.closes.Load() != 1 {
				t.Fatalf("result: %q %v closes=%d", data, err, body.closes.Load())
			}
			if test.status != 200 {
				var googleError *Error
				if !errors.As(err, &googleError) || googleError.StatusCode != test.status {
					t.Fatalf("error type: %v", err)
				}
			}
			if data, err := stream.Next(context.Background()); data != nil || err != io.EOF {
				t.Fatalf("terminal: %q %v", data, err)
			}
		})
	}
}

func TestHTTPUnreadCloseAndPendingReadCancellation(t *testing.T) {
	for _, phase := range []string{"unread", "reading", "idle context"} {
		t.Run(phase, func(t *testing.T) {
			reader, writer := io.Pipe()
			defer writer.Close()
			body := &testBody{Reader: reader}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			stream, err := Synthesize(ctx, schema.TtsRequestAsTextVoice{Value: schema.TtsRequestTextVoice{Model: flash, Language: "en-US", Voice: kore, Text: "hello", Output: wav}}, Options{Auth: testAuth, Transport: testTransport(func(*http.Request) (*http.Response, error) { return &http.Response{StatusCode: 200, Body: body}, nil })})
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Close()
			if phase == "reading" {
				reading := make(chan error, 1)
				nextCtx, nextCancel := context.WithCancel(context.Background())
				go func() { _, err := stream.Next(nextCtx); reading <- err }()
				nextCancel()
				select {
				case err := <-reading:
					if err != context.Canceled {
						t.Fatalf("read: %v", err)
					}
				case <-time.After(5 * time.Second):
					t.Fatal("read leaked")
				}
			} else if phase == "idle context" {
				cancel()
				if _, err := stream.Next(context.Background()); err != context.Canceled {
					t.Fatalf("idle cancellation: %v", err)
				}
			}
			stream.Close()
			if body.closes.Load() != 1 {
				t.Fatalf("close: %d", body.closes.Load())
			}
		})
	}
}

func TestGRPCIdleCloseAndBlockedSendCancellation(t *testing.T) {
	for _, phase := range []string{"unread", "blocked send", "idle context"} {
		t.Run(phase, func(t *testing.T) {
			source := &testSource[string]{values: []string{"hello"}, closed: make(chan struct{})}
			r := testRequest()
			r.Text = schema.TtsRequestChirp3Hda92b414cTextAsAsyncIterable{Value: source}
			grpc := newGRPC()
			entered := make(chan struct{})
			grpc.onSend = func(ctx context.Context, _ int, _ []byte) error { close(entered); <-ctx.Done(); return ctx.Err() }
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			stream, err := Synthesize(ctx, schema.TtsRequestAsObject7d956f3d{Value: r}, Options{Auth: testAuth, GRPC: grpc})
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Close()
			if phase == "blocked send" {
				reading := make(chan error, 1)
				nextCtx, nextCancel := context.WithCancel(context.Background())
				go func() { _, err := stream.Next(nextCtx); reading <- err }()
				select {
				case <-entered:
				case <-time.After(5 * time.Second):
					t.Fatal("send missing")
				}
				nextCancel()
				select {
				case err := <-reading:
					if err != context.Canceled {
						t.Fatalf("read: %v", err)
					}
				case <-time.After(5 * time.Second):
					t.Fatal("send/receive leaked")
				}
			} else if phase == "idle context" {
				cancel()
			}
			stream.Close()
			select {
			case <-source.closed:
			case <-time.After(5 * time.Second):
				t.Fatal("source leaked")
			}
			if grpc.closes.Load() != 1 || source.pulls.Load() != 0 || source.closes.Load() != 1 {
				t.Fatalf("ownership: %d %d %d", grpc.closes.Load(), source.pulls.Load(), source.closes.Load())
			}
		})
	}
}

func TestInvalidRequestsFailBeforeIO(t *testing.T) {
	requests := []schema.TtsRequest{nil, (*schema.TtsRequestAsObject7d956f3d)(nil)}
	r := testRequest()
	r.Speed = runtime.Some(3.0)
	requests = append(requests, schema.TtsRequestAsObject7d956f3d{Value: r})
	r = testRequest()
	r.Output = schema.TtsRequestChirp3Hda92b414cOutputAsPcm{Value: schema.TtsRequestChirp3HdTextVoicebb77af5cOutputPcm{SampleRateHz: runtime.Some(24000.5)}}
	requests = append(requests, schema.TtsRequestAsObject7d956f3d{Value: r})
	r = testRequest()
	r.Output = schema.TtsRequestChirp3Hda92b414cOutputAsPcm{Value: schema.TtsRequestChirp3HdTextVoicebb77af5cOutputPcm{SampleRateHz: runtime.Some(float64(2147483648))}}
	requests = append(requests, schema.TtsRequestAsObject7d956f3d{Value: r})
	r = testRequest()
	r.Text = schema.TtsRequestChirp3Hda92b414cTextAsAsyncIterable{Value: (*testSource[string])(nil)}
	requests = append(requests, schema.TtsRequestAsObject7d956f3d{Value: r})
	for _, request := range requests {
		_, want := schema.ValidateRequest(request)
		if want == nil {
			t.Fatal("invalid fixture passed generated validation")
		}
		grpc := newGRPC()
		stream, err := Synthesize(context.Background(), request, Options{Auth: testAuth, GRPC: grpc, Transport: testTransport(func(*http.Request) (*http.Response, error) { t.Fatal("unexpected IO"); return nil, nil })})
		if stream != nil || err == nil || err.Error() != want.Error() || len(grpc.messages()) != 0 || grpc.closes.Load() != 0 {
			t.Fatalf("boundary: %v %v", stream, err)
		}
	}
}

func TestProtocolConstraints(t *testing.T) {
	for _, test := range []struct {
		name, message string
		request       schema.TtsRequest
	}{
		{"bytes", "Google input exceeds 4000 UTF-8 bytes", schema.TtsRequestAsObject7d956f3d{Value: schema.TtsRequestObject7d956f3d{Model: flash, Language: "en-US", Voice: kore, Text: schema.TtsRequestChirp3Hda92b414cTextAsString{Value: strings.Repeat("😀", 1001)}, Output: pcm}}},
		{"prompt bytes", "Google input exceeds 4000 UTF-8 bytes", schema.TtsRequestAsObject7d956f3d{Value: schema.TtsRequestObject7d956f3d{Model: flash, Language: "en-US", Voice: kore, Text: schema.TtsRequestChirp3Hda92b414cTextAsString{Value: "hello"}, Instructions: runtime.Some(strings.Repeat("😀", 1001)), Output: pcm}}},
		{"empty turns", "Google dialogue turns must not be empty", schema.TtsRequestAsObject8dbffa0c{Value: schema.TtsRequestObject8dbffa0c{Model: flashSpeakers, Language: "en-US", Speakers: speakers, Turns: schema.TtsRequestObject8dbffa0cTurnsAsArray{Value: []Turn{}}, Output: pcm}}},
		{"unknown alias", "Google dialogue references an unknown speaker: Eve", schema.TtsRequestAsObject8dbffa0c{Value: schema.TtsRequestObject8dbffa0c{Model: flashSpeakers, Language: "en-US", Speakers: speakers, Turns: schema.TtsRequestObject8dbffa0cTurnsAsArray{Value: []Turn{{Speaker: "Eve", Text: "hi"}}}, Output: pcm}}},
		{"duplicate aliases", "Google dialogue requires exactly two distinct speaker aliases", schema.TtsRequestAsObjectd20064bc{Value: schema.TtsRequestObjectd20064bc{Model: flashSpeakers, Language: "en-US", Speakers: []schema.TtsRequestTextSpeakersItem{{Alias: "Sam", Voice: kore}, {Alias: "Sam", Voice: puck}}, Text: schema.TtsRequestChirp3Hda92b414cTextAsString{Value: "hi"}, Output: pcm}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			grpc := newGRPC()
			stream, err := Synthesize(context.Background(), test.request, Options{Auth: testAuth, GRPC: grpc})
			if stream != nil || err == nil || err.Error() != test.message || grpc.closes.Load() != 0 || len(grpc.messages()) != 0 {
				t.Fatalf("constraint: %v %v", stream, err)
			}
		})
	}
}

func TestIncrementalValidationAndFinalAudioError(t *testing.T) {
	for _, value := range []string{string([]byte{255}), strings.Repeat("😀", 1001)} {
		r := testRequest()
		r.Text = schema.TtsRequestChirp3Hda92b414cTextAsAsyncIterable{Value: &testSource[string]{values: []string{value}}}
		grpc := newGRPC()
		stream, err := Synthesize(context.Background(), schema.TtsRequestAsObject7d956f3d{Value: r}, Options{Auth: testAuth, GRPC: grpc})
		if err != nil {
			t.Fatal(err)
		}
		_, err = stream.Next(context.Background())
		stream.Close()
		var want error
		if len(value) > 4000 {
			want = checkText(value, 4000)
		} else {
			validate, _ := schema.ValidateRequest(schema.TtsRequestAsObject7d956f3d{Value: r})
			want = validate(value, "text")
		}
		if err == nil || want == nil || err.Error() != want.Error() || len(grpc.messages()) != 1 {
			t.Fatalf("input validation: %v want %v", err, want)
		}
	}
	grpc := newGRPC()
	failure := &runtime.GRPCError{StatusCode: 8, Message: "quota"}
	grpc.onSend = func(_ context.Context, count int, _ []byte) error {
		if count == 2 {
			grpc.output <- grpcResult{data: []byte{10, 2, 0, 255}}
			grpc.output <- grpcResult{err: failure}
		}
		return nil
	}
	stream, err := Synthesize(context.Background(), schema.TtsRequestAsObject7d956f3d{Value: testRequest()}, Options{Auth: testAuth, GRPC: grpc})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	if data, err := stream.Next(context.Background()); err != nil || !bytes.Equal(data, []byte{0, 255}) {
		t.Fatalf("audio: %x %v", data, err)
	}
	if _, err := stream.Next(context.Background()); err != failure {
		t.Fatalf("final error: %v", err)
	}
	if !reflect.DeepEqual(grpc.messages()[1:], [][]byte{{18, 7, 10, 5, 'h', 'e', 'l', 'l', 'o'}}) {
		t.Fatalf("input: %x", grpc.messages())
	}
}
