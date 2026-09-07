package gradium

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	schema "github.com/speechswitch/client/sdks/go/generated/gradium"
	out "github.com/speechswitch/client/sdks/go/generated/gradium_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func fixtureItem(t *testing.T, item out.SynthesisItem) any {
	t.Helper()
	v, ok := item.(out.SynthesisItemAsTimeline)
	if !ok {
		t.Fatalf("expected timeline, got %T", item)
	}
	envelope := v.Value
	timestamps := []map[string]any{}
	for _, stamp := range envelope.Timestamps {
		timestamps = append(timestamps, map[string]any{"kind": stamp.Kind.Value(), "value": stamp.Value, "startTimeMs": stamp.StartTimeMs, "endTimeMs": stamp.EndTimeMs})
	}
	result := map[string]any{"correlation": envelope.Correlation.Value(), "timestamps": timestamps}
	if envelope.CorrelationId.Present {
		result["correlationId"] = envelope.CorrelationId.Value
	}
	if envelope.Audio.Present {
		values := []int{}
		for _, b := range envelope.Audio.Value {
			values = append(values, int(b))
		}
		result["audio"] = map[string]any{"$bytes": values}
	}
	if envelope.AudioTiming.Present {
		result["audioTiming"] = map[string]any{"startTimeMs": envelope.AudioTiming.Value.StartTimeMs, "endTimeMs": envelope.AudioTiming.Value.EndTimeMs}
	}
	return jsonValue(t, result)
}

func TestSharedTimelineEveryUTF8SplitAndEOFModes(t *testing.T) {
	fixtures := loadFixtures(t)
	for _, eos := range []bool{false, true} {
		data := []byte("\xef\xbb\xbf\r\n")
		for i, c := range fixtures.Timeline {
			if i > 0 {
				data = append(data, '\r', '\n')
			}
			data = append(data, mustJSON(t, c.Packet)...)
		}
		if eos {
			data = append(data, []byte("\n{\"type\":\"end_of_stream\"}\nignored")...)
		}
		for cut := 0; cut <= len(data); cut++ {
			b := &body{Reader: io.MultiReader(bytes.NewReader(data[:cut]), bytes.NewReader(data[cut:]))}
			r := request()
			r.TimestampGranularity = runtime.Some(schema.TtsRequestTimestampGranularity{})
			stream, err := Synthesize(context.Background(), r, Options{Auth: testAuth, Transport: transport(func(req *http.Request) (*http.Response, error) {
				var wire map[string]any
				if err := json.NewDecoder(req.Body).Decode(&wire); err != nil {
					t.Fatal(err)
				}
				equal(t, wire["only_audio"], false)
				return &http.Response{StatusCode: 200, Body: b}, nil
			})})
			if err != nil {
				t.Fatal(err)
			}
			items, err := collect(stream)
			if err != nil {
				t.Fatalf("cut %d eos %t: %v", cut, eos, err)
			}
			equal(t, len(items), len(fixtures.Timeline))
			for i, item := range items {
				equal(t, fixtureItem(t, item), fixtures.Timeline[i].Item)
			}
			equal(t, b.closes.Load(), int32(1))
		}
	}
}

type readerFunc func([]byte) (int, error)

func (f readerFunc) Read(p []byte) (int, error) { return f(p) }

func TestHTTPNativeErrorsAndBoundedResponses(t *testing.T) {
	for _, c := range []struct {
		data, message string
		code          runtime.Optional[int64]
	}{
		{"\ufefferror from server 1008: refusé\nnext", "refusé\nnext", runtime.Some(int64(1008))},
		{"error from server 9007199254740992: denied", "denied", runtime.Optional[int64]{}},
		{"error from server 000000000000000001008: denied", "denied", runtime.Some(int64(1008))},
		{"error from server 0: zero", "zero", runtime.Some(int64(0))},
		{"proxy \xff\xff\xe2\x82", "proxy ���", runtime.Optional[int64]{}},
	} {
		b := &body{Reader: strings.NewReader(c.data)}
		_, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: responseTransport(b, 403)})
		equal(t, err, &Error{Message: c.message, StatusCode: runtime.Some(403), Code: c.code})
		equal(t, b.closes.Load(), int32(1))
	}
	original := errors.New("original read failure")
	b := &body{Reader: readerFunc(func([]byte) (int, error) { return 0, original }), closeFn: func() error { return errors.New("close failed") }}
	_, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: responseTransport(b, 500)})
	if err != original {
		t.Fatalf("read error identity changed: got %v, want original %v", err, original)
	}
	equal(t, b.closes.Load(), int32(1))
	b = &body{Reader: strings.NewReader("long")}
	_, err = Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: responseTransport(b, 500), MaxJSONBytes: 3})
	errorText(t, err, "Gradium response exceeds MaxJSONBytes")
	equal(t, b.closes.Load(), int32(1))
	for _, c := range []struct {
		data, expected string
		limit          int
	}{{"xxx", "Gradium JSON line exceeds MaxJSONBytes", 2}, {"\xff", "Gradium returned invalid UTF-8", 100}, {"{\"a\":NaN}", "Gradium returned invalid JSON", 100}, {"{} trailing", "Gradium returned invalid JSON", 100}} {
		r := request()
		r.TimestampGranularity = runtime.Some(schema.TtsRequestTimestampGranularity{})
		b := &body{Reader: strings.NewReader(c.data)}
		stream, err := Synthesize(context.Background(), r, Options{Auth: testAuth, Transport: responseTransport(b, 200), MaxJSONBytes: c.limit})
		if err != nil {
			t.Fatal(err)
		}
		_, err = collect(stream)
		errorText(t, err, c.expected)
		equal(t, b.closes.Load(), int32(1))
	}
}

func TestHTTPCancellationAndUnreadOwnership(t *testing.T) {
	for _, status := range []int{200, 500} {
		ctx, cancel := context.WithCancel(context.Background())
		reading, closed := make(chan struct{}), make(chan struct{})
		b := &body{Reader: readerFunc(func([]byte) (int, error) { close(reading); <-closed; return 0, io.EOF }), closeFn: func() error { close(closed); return nil }}
		result := make(chan error, 1)
		go func() {
			stream, err := Synthesize(ctx, request(), Options{Auth: testAuth, Transport: responseTransport(b, status)})
			if err == nil {
				_, err = collect(stream)
			}
			result <- err
		}()
		wait(t, reading)
		cancel()
		select {
		case err := <-result:
			equal(t, err, context.Canceled)
		case <-time.After(time.Second):
			t.Fatal("cancellation stalled")
		}
		wait(t, closed)
		equal(t, b.closes.Load(), int32(1))
	}
	for _, cancelIdle := range []bool{false, true} {
		ctx, cancel := context.WithCancel(context.Background())
		closed := make(chan struct{})
		b := &body{Reader: strings.NewReader("unread"), closeFn: func() error { close(closed); return nil }}
		stream, err := Synthesize(ctx, request(), Options{Auth: testAuth, Transport: responseTransport(b, 200)})
		if err != nil {
			t.Fatal(err)
		}
		if cancelIdle {
			cancel()
		} else {
			if err := stream.Close(); err != nil {
				t.Fatal(err)
			}
		}
		wait(t, closed)
		stream.Close()
		cancel()
		equal(t, b.closes.Load(), int32(1))
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := Synthesize(ctx, request(), Options{Auth: testAuth, Transport: transport(func(*http.Request) (*http.Response, error) { t.Error("unexpected IO"); return nil, nil })})
	equal(t, err, context.Canceled)
}

func TestHTTPFinalBytesPrecedeReadError(t *testing.T) {
	original := errors.New("last read failed")
	for _, last := range []error{io.EOF, original} {
		b := &body{Reader: readerFunc(func(p []byte) (int, error) { return copy(p, []byte{0, 255}), last })}
		stream, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: responseTransport(b, 200)})
		if err != nil {
			t.Fatal(err)
		}
		item, err := stream.Next(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		equal(t, item, out.SynthesisItemAsBytes{Value: []byte{0, 255}})
		_, err = stream.Next(context.Background())
		if err != last {
			t.Fatalf("terminal error identity changed: got %v, want original %v", err, last)
		}
		stream.Close()
		equal(t, b.closes.Load(), int32(1))
	}
}
