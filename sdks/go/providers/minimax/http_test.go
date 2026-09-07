package minimax

import (
	"context"
	"encoding/json"
	"errors"
	schema "github.com/speechswitch/client/sdks/go/generated/minimax"
	out "github.com/speechswitch/client/sdks/go/generated/minimax_output"
	"github.com/speechswitch/client/sdks/go/runtime"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestSubtitleReadCancellationClosesBothResponses(t *testing.T) {
	for _, mode := range []string{"parent", "next", "close"} {
		t.Run(mode, func(t *testing.T) {
			parent, cancel := context.WithCancel(context.Background())
			defer cancel()
			next, cancelNext := context.WithCancel(context.Background())
			defer cancelNext()
			waiting, closed := make(chan struct{}), make(chan struct{})
			original := &body{Reader: strings.NewReader(`{"data":{"status":2,"audio":"00","subtitle_file":"https://files.invalid/marks"}}`)}
			subtitle := &body{Reader: readerFunc(func([]byte) (int, error) {
				close(waiting)
				<-closed
				return 0, io.ErrClosedPipe
			}), closeFn: func() error { close(closed); return nil }}
			tr := transport(func(r *http.Request) (*http.Response, error) {
				b := original
				if r.Method == http.MethodGet {
					b = subtitle
				}
				return &http.Response{StatusCode: 200, Body: b}, nil
			})
			r := request()
			var kind schema.TtsRequestText77d171beTimestampGranularity = schema.TtsRequestText77d171beTimestampGranularityAsWord{}
			r.Value.TimestampGranularity = runtime.Some(kind)
			stream, err := Synthesize(parent, r, Options{Auth: testAuth, Transport: tr})
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Close()
			if _, err = stream.Next(context.Background()); err != nil {
				t.Fatal(err)
			}
			result := make(chan error, 1)
			go func() { _, err := stream.Next(next); result <- err }()
			wait(t, waiting)
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
				t.Fatal("subtitle cancellation did not unblock Next")
			}
			equal(t, original.closes.Load(), int32(1))
			equal(t, subtitle.closes.Load(), int32(1))
		})
	}
}

func TestEarlySSEAndIndependentSubtitleDownload(t *testing.T) {
	f := fixture(t)
	reader, writer := io.Pipe()
	b := &body{Reader: reader, closeFn: reader.Close}
	subtitleBody := &body{Reader: strings.NewReader(string(f["subtitles"]))}
	calls := 0
	transport := transport(func(r *http.Request) (*http.Response, error) {
		calls++
		if calls == 1 {
			return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"text/event-stream; charset=utf-8"}}, Body: b}, nil
		}
		equal(t, r.Method, "GET")
		equal(t, r.URL.String(), "https://files.invalid/subtitles/?signed=one")
		equal(t, len(r.Header), 0)
		return &http.Response{StatusCode: 200, Body: subtitleBody}, nil
	})
	r := request()
	var kind schema.TtsRequestText77d171beTimestampGranularity = schema.TtsRequestText77d171beTimestampGranularityAsWord{}
	r.Value.TimestampGranularity = runtime.Some(kind)
	stream, err := Synthesize(context.Background(), r, Options{Auth: testAuth, Transport: transport})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	advance, written := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(written)
		defer writer.Close()
		_, _ = io.WriteString(writer, "data: {\"data\":{\"status\":1,\"audio\":\"00ff\"}}\r\n\r\n")
		<-advance
		final, _ := json.Marshal(map[string]any{"data": map[string]any{"status": 2, "subtitle_file": "https://files.invalid/subtitles/?signed=one"}, "trace_id": "trace", "extra_info": f["usage"]})
		_, _ = io.WriteString(writer, "data: "+string(final)+"\r\n\r\n")
	}()
	first, err := stream.Next(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	equal(t, first, out.SynthesisItemAsOrderedOrTimeline{Value: out.MiniMaxEnvelope{Correlation: out.MiniMaxEnvelopeCorrelationAsTimeline{}, Audio: runtime.Some([]byte{0, 255}), Timestamps: []out.MiniMaxTimestamp{}}})
	equal(t, calls, 1)
	close(advance)
	second, err := stream.Next(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	env := second.(out.SynthesisItemAsOrderedOrTimeline).Value
	actual := []map[string]any{}
	for _, v := range env.Timestamps {
		equal(t, v.Source.Present, false)
		actual = append(actual, map[string]any{"kind": v.Kind.LiteralValue(), "value": v.Value, "startTimeMs": v.StartTimeMs, "endTimeMs": v.EndTimeMs.Value})
	}
	data, _ := json.Marshal(actual)
	equal(t, decode(t, data), decode(t, f["timestamps"]))
	equal(t, env.TraceId, runtime.Some("trace"))
	equal(t, env.Audio.Present, false)
	third, err := stream.Next(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	done := third.(out.SynthesisItemAsDone).Value
	u := done.Usage.Value
	usage := map[string]any{"durationMs": u.DurationMs.Value, "sampleRateHz": u.SampleRateHz.Value, "byteLength": u.ByteLength.Value, "bitRateBps": u.BitRateBps.Value,
		"channelCount": u.ChannelCount.Value, "billedCharacters": u.BilledCharacters.Value, "wordCount": u.WordCount.Value, "invalidCharacterRatio": u.InvalidCharacterRatio.Value, "format": u.Format.Value}
	equal(t, usage, decode(t, f["normalizedUsage"]))
	equal(t, u.BilledCharacters.Present, true)
	equal(t, u.InvalidCharacterRatio.Present, true)
	_, err = stream.Next(context.Background())
	equal(t, err, io.EOF)
	wait(t, written)
	equal(t, b.closes.Load(), int32(1))
	equal(t, subtitleBody.closes.Load(), int32(1))
}

func TestHTTPStatusLimitsAndReadErrors(t *testing.T) {
	for _, status := range []int{307, 429} {
		b := &body{Reader: strings.NewReader("<html>gateway</html>")}
		tr := transport(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: status, Header: http.Header{"Retry-After": {"2"}}, Body: b}, nil
		})
		stream, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: tr})
		if err != nil {
			t.Fatal(err)
		}
		_, err = stream.Next(context.Background())
		var native *Error
		if !errors.As(err, &native) {
			t.Fatal(err)
		}
		equal(t, native.StatusCode, status)
		equal(t, native.Code.Present, false)
		equal(t, native.RetryAfter, runtime.Some("2"))
		equal(t, b.closes.Load(), int32(1))
	}
	for _, data := range []string{"{}", strings.Repeat("x", 10)} {
		b := &body{Reader: strings.NewReader(data)}
		tr := transport(func(*http.Request) (*http.Response, error) { return &http.Response{StatusCode: 200, Body: b}, nil })
		stream, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: tr, MaxJSONBytes: 4})
		if err != nil {
			t.Fatal(err)
		}
		_, err = stream.Next(context.Background())
		expected := "MiniMax JSON synthesis did not report completion"
		if len(data) > 4 {
			expected = "MiniMax response exceeds MaxJSONBytes"
		}
		errorText(t, err, expected)
		equal(t, b.closes.Load(), int32(1))
	}
	original := errors.New("read failure")
	b := &body{Reader: readerFunc(func([]byte) (int, error) { return 0, original })}
	stream, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: transport(func(*http.Request) (*http.Response, error) { return &http.Response{StatusCode: 200, Body: b}, nil })})
	if err != nil {
		t.Fatal(err)
	}
	_, err = stream.Next(context.Background())
	equal(t, err, original)
	equal(t, b.closes.Load(), int32(1))
}

type readerFunc func([]byte) (int, error)

func (f readerFunc) Read(b []byte) (int, error) { return f(b) }

func TestHTTPCompletionAndSubtitleBoundaries(t *testing.T) {
	for _, data := range []string{"", "data: [DONE]\n\n", "data: {\"data\":{\"status\":1,\"audio\":\"00\"}}\n\n"} {
		tr := transport(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(data))}, nil
		})
		stream, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: tr})
		if err != nil {
			t.Fatal(err)
		}
		for err == nil {
			_, err = stream.Next(context.Background())
		}
		errorText(t, err, "MiniMax HTTP stream ended before completion")
	}
	for _, target := range []string{"ftp://files.invalid/a", "https://user:pass@files.invalid/a", "https://files.invalid/%xx", "https://files.invalid/a#fragment"} {
		calls := 0
		tr := transport(func(*http.Request) (*http.Response, error) {
			calls++
			data, _ := json.Marshal(map[string]any{"data": map[string]any{"status": 2, "audio": "00", "subtitle_file": target}})
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(data)))}, nil
		})
		r := request()
		var kind schema.TtsRequestText77d171beTimestampGranularity = schema.TtsRequestText77d171beTimestampGranularityAsSentence{}
		r.Value.TimestampGranularity = runtime.Some(kind)
		stream, err := Synthesize(context.Background(), r, Options{Auth: testAuth, Transport: tr})
		if err != nil {
			t.Fatal(err)
		}
		for err == nil {
			_, err = stream.Next(context.Background())
		}
		errorText(t, err, "Invalid MiniMax endpoint URL")
		equal(t, calls, 1)
	}
}
