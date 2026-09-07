package murf

import (
	"bytes"
	"context"
	"encoding/json"
	schema "github.com/speechswitch/client/sdks/go/generated/murf"
	out "github.com/speechswitch/client/sdks/go/generated/murf_output"
	"github.com/speechswitch/client/sdks/go/runtime"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestFalconStreamsBeforeEOFWithExactFixture(t *testing.T) {
	f := fixture(t)
	reader, writer := io.Pipe()
	defer writer.Close()
	b := &body{Reader: reader, closeFn: reader.Close}
	tr := transport(func(r *http.Request) (*http.Response, error) {
		equal(t, r.URL.String(), "https://proxy.invalid/a%2Fb/v1/speech/stream?tenant=one")
		equal(t, r.Header, http.Header{"Api-Key": {"test-key"}, "Content-Type": {"application/json"}, "Accept": {"audio/*, application/octet-stream"}})
		data, _ := io.ReadAll(r.Body)
		equal(t, decode(t, data), decode(t, f["falcon"]))
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"audio/pcm"}}, Body: b}, nil
	})
	stream, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: tr, BaseURL: "https://proxy.invalid/a%2Fb/?tenant=one"})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	go func() { _, _ = writer.Write([]byte{0, 255, 128}) }()
	value, err := stream.Next(context.Background())
	equal(t, err, nil)
	equal(t, value, out.SynthesisItemAsBytes{Value: []byte{0, 255, 128}})
	stream.Close()
	equal(t, b.closes.Load(), int32(1))
}
func TestGen2ExactDownloadInlineAndIndependentTimeline(t *testing.T) {
	f := fixture(t)
	for _, inline := range []bool{false, true} {
		calls := 0
		original := &body{Reader: bytes.NewReader(f["generation"])}
		asset := &body{Reader: bytes.NewReader([]byte{0, 255, 128})}
		tr := transport(func(r *http.Request) (*http.Response, error) {
			calls++
			if calls == 1 {
				equal(t, r.URL.String(), "https://api.murf.ai/v1/speech/generate")
				data, _ := io.ReadAll(r.Body)
				expected := decode(t, f["gen2"]).(map[string]any)
				expected["encodeAsBase64"] = inline
				equal(t, decode(t, data), expected)
				return &http.Response{StatusCode: 200, Body: original}, nil
			}
			equal(t, r.Method, "GET")
			equal(t, r.URL.String(), "https://files.invalid/audio/?signed=one")
			equal(t, len(r.Header), 0)
			equal(t, original.closes.Load(), int32(1))
			return &http.Response{StatusCode: 200, Body: asset}, nil
		})
		r := schema.TtsRequestAsGen2TextVoiceca621e19{Value: schema.TtsRequestGen2TextVoiceca621e19{Text: "Hello", Voice: "existing-voice", TimestampGranularity: runtime.Some(schema.TtsRequestGen2TextVoiceca621e19TimestampGranularity{})}}
		if inline {
			var retention schema.TtsRequestGen2TextVoiceca621e19AudioRetention = schema.TtsRequestGen2TextVoiceca621e19AudioRetentionAsFalse{}
			r.Value.AudioRetention = runtime.Some(retention)
		}
		stream, err := Synthesize(context.Background(), r, Options{Auth: testAuth, Transport: tr})
		if err != nil {
			t.Fatal(err)
		}
		equal(t, collect(t, stream), []out.SynthesisItem{
			out.SynthesisItemAsOrderedOrTimeline{Value: out.MurfEnvelope{Correlation: out.MurfEnvelopeCorrelationAsTimeline{}, Audio: runtime.Some([]byte{0, 255, 128}), Timestamps: []out.MurfTimestamp{}}},
			out.SynthesisItemAsOrderedOrTimeline{Value: out.MurfEnvelope{Correlation: out.MurfEnvelopeCorrelationAsTimeline{}, DurationMs: runtime.Some(float64(500)), Timestamps: []out.MurfTimestamp{{Value: "Hello", StartTimeMs: 0, EndTimeMs: 500}}}},
			out.SynthesisItemAsDone{Value: out.DoneEvent{RemainingCharacters: runtime.Some(float64(0)), Warning: runtime.Some("")}},
		})
		if inline {
			equal(t, calls, 1)
		} else {
			equal(t, calls, 2)
			equal(t, asset.closes.Load(), int32(1))
		}
		equal(t, original.closes.Load(), int32(1))
	}
}
func TestHTTPFailuresAndLimitsReleaseBody(t *testing.T) {
	for _, tc := range []struct {
		status              int
		content, data, want string
		gen2                bool
		limit               int
	}{
		{200, "application/json", "{}", "Murf returned a non-audio streaming response", false, 100},
		{200, "", "", "Murf returned no audio", false, 100},
		{200, "", "xxxxxxxxxx", "Murf response exceeds MaxJSONBytes", true, 4},
		{429, "", "quota", "Murf synthesis failed (429)", false, 100},
	} {
		b := &body{Reader: strings.NewReader(tc.data)}
		tr := transport(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: tc.status, Header: http.Header{"Content-Type": {tc.content}, "Retry-After": {"2"}}, Body: b}, nil
		})
		var r schema.TtsRequest = request()
		if tc.gen2 {
			r = schema.TtsRequestAsGen2TextVoiceca621e19{Value: schema.TtsRequestGen2TextVoiceca621e19{Text: "Hi", Voice: "v"}}
		}
		stream, err := Synthesize(context.Background(), r, Options{Auth: testAuth, Transport: tr, MaxJSONBytes: tc.limit})
		if err != nil {
			t.Fatal(err)
		}
		_, err = stream.Next(context.Background())
		errorText(t, err, tc.want)
		if tc.status == 429 {
			equal(t, err, &Error{StatusCode: runtime.Some(429), Body: "quota", RetryAfter: runtime.Some("2")})
		}
		equal(t, b.closes.Load(), int32(1))
		stream.Close()
	}
}
func TestGen2UnsafeURLNeverReceivesCredentials(t *testing.T) {
	for _, tc := range []struct{ url, want string }{
		{"http://files.invalid/audio", "Murf returned an unsafe audio file URL"},
		{"https://user:secret@files.invalid/audio", "Invalid Murf endpoint URL"},
	} {
		value := decode(t, fixture(t)["generation"]).(map[string]any)
		value["audioFile"] = tc.url
		data, _ := json.Marshal(value)
		calls := 0
		b := &body{Reader: bytes.NewReader(data)}
		tr := transport(func(*http.Request) (*http.Response, error) {
			calls++
			return &http.Response{StatusCode: 200, Body: b}, nil
		})
		r := schema.TtsRequestAsGen2TextVoiceca621e19{Value: schema.TtsRequestGen2TextVoiceca621e19{Text: "Hi", Voice: "v"}}
		stream, err := Synthesize(context.Background(), r, Options{Auth: testAuth, Transport: tr})
		if err != nil {
			t.Fatal(err)
		}
		_, err = stream.Next(context.Background())
		errorText(t, err, tc.want)
		equal(t, calls, 1)
		equal(t, b.closes.Load(), int32(1))
	}
}
