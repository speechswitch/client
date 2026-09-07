package inworld

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	schema "github.com/speechswitch/client/sdks/go/generated/inworld"
	out "github.com/speechswitch/client/sdks/go/generated/inworld_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func TestHTTPPendingReadsCancelAndReleaseOnce(t *testing.T) {
	for _, mode := range []string{"parent", "pull", "close"} {
		t.Run(mode, func(t *testing.T) {
			reader, writer := io.Pipe()
			defer writer.Close()
			reading := make(chan struct{})
			reads := 0
			b := &body{Reader: readerFunc(func(data []byte) (int, error) {
				reads++
				if reads == 2 {
					close(reading)
				}
				return reader.Read(data)
			}), closeFn: reader.Close}
			parent, cancelParent := context.WithCancel(context.Background())
			defer cancelParent()
			stream, err := Synthesize(parent, request(), Options{Auth: testAuth, Transport: responseTransport(b, 200)})
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Close()
			written := make(chan struct{})
			go func() {
				defer close(written)
				_, _ = writer.Write([]byte("{\"result\":{\"audioContent\":\"AQI=\"}}\n"))
			}()
			first, err := stream.Next(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			equal(t, first, out.SynthesisItemAsBytes{Value: []byte{1, 2}})
			wait(t, written)
			pull, cancelPull := context.WithCancel(context.Background())
			defer cancelPull()
			finished := make(chan struct{})
			var failure error
			go func() { defer close(finished); _, failure = stream.Next(pull) }()
			wait(t, reading)
			switch mode {
			case "parent":
				cancelParent()
			case "pull":
				cancelPull()
			case "close":
				if err := stream.Close(); err != nil {
					t.Fatal(err)
				}
			}
			wait(t, finished)
			equal(t, failure, context.Canceled)
			equal(t, b.closes.Load(), int32(1))
		})
	}
}

func requests() []schema.TtsRequest {
	a := request()
	b := schema.TtsRequestAsTextVoice{Value: schema.TtsRequestTextVoice{Model: schema.TtsRequestTextVoiceModelAsInworldTts2Flash{}, Text: "Hello", Voice: "custom-voice", Output: schema.TtsRequestTextVoiceOutputAsMp3{}}}
	c := b
	c.Value.Model = schema.TtsRequestTextVoiceModelAsInworldTts15Max{}
	c.Value.Output = schema.TtsRequestTextVoiceOutputAsOggOpus{Value: schema.TtsRequestTextVoiceOutputOggOpus{SampleRateHz: runtime.Some(schema.TtsRequestTextVoiceOutputFlacSampleRateHz(schema.TtsRequestTextVoiceOutputFlacSampleRateHzAsNumber24000{})), BitRateBps: runtime.Some(float64(64000))}}
	d := b
	d.Value.Model = schema.TtsRequestTextVoiceModelAsInworldTts15Mini{}
	d.Value.Output = schema.TtsRequestTextVoiceOutputAsWav{}
	e := a
	e.Value.Output = schema.TtsRequestTextVoiceOutputAsFlac{}
	e.Value.DeliveryMode = runtime.Some(schema.TtsRequestInworldTts2TextVoiceDeliveryMode(schema.TtsRequestInworldTts2TextVoiceDeliveryModeAsCreative{}))
	e.Value.Instructions = runtime.Some("Quietly")
	e.Value.Language = runtime.Some("en")
	e.Value.Speed = runtime.Some(1.2)
	e.Value.TextNormalization = runtime.Some(schema.TtsRequestTextVoiceTextNormalization(schema.TtsRequestTextVoiceTextNormalizationAsFalse{}))
	e.Value.TimestampGranularity = runtime.Some(schema.TtsRequestTextVoiceTimestampGranularity(schema.TtsRequestTextVoiceTimestampGranularityAsWord{}))
	e.Value.TimestampDelivery = runtime.Some(schema.TtsRequestTextVoiceTimestampDelivery(schema.TtsRequestTextVoiceTimestampDeliveryAsChunk{}))
	e.Value.AudioEnhancement = runtime.Some(schema.TtsRequestTextVoiceAudioEnhancement(schema.TtsRequestTextVoiceAudioEnhancementAsTrue{}))
	e.Value.ContextBefore = runtime.Some(schema.TtsRequestTextVoiceContextBefore{Texts: []string{"Earlier"}})
	f := b
	f.Value.Output = schema.TtsRequestTextVoiceOutputAsObject{Value: schema.TtsRequestTextVoiceOutputObject{Format: schema.TtsRequestTextVoiceOutputObjectFormatAsMulaw{}}}
	f.Value.Temperature = runtime.Some(float64(0))
	g := a
	g.Value.Output = schema.TtsRequestTextVoiceOutputAsObject{Value: schema.TtsRequestTextVoiceOutputObject{Format: schema.TtsRequestTextVoiceOutputObjectFormatAsAlaw{}}}
	g.Value.DeliveryMode = runtime.Some(schema.TtsRequestInworldTts2TextVoiceDeliveryMode(schema.TtsRequestInworldTts2TextVoiceDeliveryModeAsStable{}))
	return []schema.TtsRequest{a, b, c, d, e, f, g}
}
func TestSharedHTTPModelsFormatsAndDefaults(t *testing.T) {
	f := loadFixtures(t)
	for i, r := range requests() {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			b := &body{Reader: strings.NewReader("{\"result\":{\"audioContent\":\"AP8=\"}}\n")}
			tr := transport(func(r *http.Request) (*http.Response, error) {
				equal(t, r.Method, "POST")
				equal(t, r.URL.String(), "https://proxy.test/a%2Fb/tts/v1/voice:stream?tenant=one")
				equal(t, r.Header, http.Header{"Authorization": {"Basic test-key"}, "Content-Type": {"application/json"}})
				data, err := io.ReadAll(r.Body)
				if err != nil {
					t.Fatal(err)
				}
				equal(t, decodeJSON(t, data), f.HTTP[i].Body)
				return &http.Response{StatusCode: 200, Body: b}, nil
			})
			stream, err := Synthesize(context.Background(), r, Options{Auth: testAuth, Transport: tr, BaseURL: "https://proxy.test/a%2Fb/?tenant=one"})
			if err != nil {
				t.Fatal(err)
			}
			items, err := collect(stream)
			if err != nil {
				t.Fatal(err)
			}
			if i == 4 {
				equal(t, items, []out.SynthesisItem{out.SynthesisItemAsChunk{Value: out.InworldChunkEnvelope{Audio: []byte{0, 255}, Timestamps: []out.InworldTimestamp{}}}})
			} else {
				equal(t, items, []out.SynthesisItem{out.SynthesisItemAsBytes{Value: []byte{0, 255}}})
			}
			equal(t, b.closes.Load(), int32(1))
		})
	}
}
func TestSharedTimelineEveryUTF8Split(t *testing.T) {
	f := loadFixtures(t)
	data := []byte("\xef\xbb\xbf\r\n")
	for _, v := range f.Timeline {
		data = append(data, mustJSON(t, v.Packet)...)
		data = append(data, '\r', '\n')
	}
	data = data[:len(data)-2]
	for split := 0; split <= len(data); split++ {
		r := request()
		r.Value.TimestampGranularity = runtime.Some(schema.TtsRequestTextVoiceTimestampGranularity(schema.TtsRequestTextVoiceTimestampGranularityAsWord{}))
		b := &body{Reader: io.MultiReader(bytes.NewReader(data[:split]), bytes.NewReader(data[split:]))}
		stream, err := Synthesize(context.Background(), r, Options{Auth: testAuth, Transport: responseTransport(b, 200)})
		if err != nil {
			t.Fatal(err)
		}
		items, err := collect(stream)
		if err != nil {
			t.Fatalf("split %d: %v", split, err)
		}
		equal(t, len(items), len(f.Timeline))
		for i, item := range items {
			equal(t, fixtureItem(t, item), f.Timeline[i].Item)
		}
		equal(t, b.closes.Load(), int32(1))
	}
}
func TestSingleResponseAndNativeErrors(t *testing.T) {
	r := request()
	r.Value.TimestampGranularity = runtime.Some(schema.TtsRequestTextVoiceTimestampGranularity(schema.TtsRequestTextVoiceTimestampGranularityAsWord{}))
	b := &body{Reader: strings.NewReader(`{"audioContent":"AP8="}`)}
	stream, err := Synthesize(context.Background(), r, Options{Auth: testAuth, HTTPMode: runtime.Some("single"), Transport: transport(func(r *http.Request) (*http.Response, error) {
		equal(t, r.URL.Path, "/tts/v1/voice")
		data, _ := io.ReadAll(r.Body)
		var wire map[string]any
		_ = json.Unmarshal(data, &wire)
		_, present := wire["timestampTransportStrategy"]
		equal(t, present, false)
		return &http.Response{StatusCode: 200, Body: b}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	equal(t, b.closes.Load(), int32(1))
	items, err := collect(stream)
	if err != nil {
		t.Fatal(err)
	}
	equal(t, items, []out.SynthesisItem{out.SynthesisItemAsChunk{Value: out.InworldChunkEnvelope{Audio: []byte{0, 255}, Timestamps: []out.InworldTimestamp{}}}})
	for _, v := range []struct {
		status        int
		data, message string
		code          int64
	}{
		{403, `{"code":7,"message":"denied"}`, "denied", 7},
		{200, `{"error":{"code":8,"message":"quota"}}`, "quota", 8},
		{200, `{"result":{"audioContent":"","status":{"code":3,"message":"bad"}}}`, "bad", 3},
	} {
		b := &body{Reader: strings.NewReader(v.data)}
		stream, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: responseTransport(b, v.status)})
		if err == nil {
			_, err = collect(stream)
		}
		native, ok := err.(*Error)
		if !ok {
			t.Fatalf("expected native error, got %v", err)
		}
		equal(t, native.Message, v.message)
		equal(t, native.Code, runtime.Some(v.code))
		equal(t, native.StatusCode.Present, v.status != 200)
		equal(t, b.closes.Load(), int32(1))
	}
}
func TestHTTPValidationLimitsAndReadIdentity(t *testing.T) {
	r := request()
	r.Value.ContextBefore = runtime.Some(schema.TtsRequestTextVoiceContextBefore{Texts: []string{strings.Repeat("🙂", 600), strings.Repeat("🙂", 401)}})
	_, err := Synthesize(context.Background(), r, Options{Auth: testAuth})
	errorText(t, err, "Inworld preceding context must not exceed 2000 characters")
	r = request()
	r.Value.Text = strings.Repeat("🙂", 1001)
	_, err = Synthesize(context.Background(), r, Options{Auth: testAuth, HTTPMode: runtime.Some("single")})
	errorText(t, err, "Inworld single-response text must not exceed 2000 characters")
	for _, v := range []struct {
		mode    string
		status  int
		message string
	}{{"stream", 200, "Inworld JSON line exceeds MaxJSONBytes"}, {"single", 200, "Inworld response exceeds MaxJSONBytes"}, {"stream", 403, "Inworld response exceeds MaxJSONBytes"}} {
		b := &body{Reader: strings.NewReader("12345")}
		stream, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: responseTransport(b, v.status), HTTPMode: runtime.Some(v.mode), MaxJSONBytes: 4})
		if err == nil {
			_, err = collect(stream)
		}
		errorText(t, err, v.message)
		equal(t, b.closes.Load(), int32(1))
	}
	original := fmt.Errorf("read failed")
	b := &body{Reader: readerFunc(func([]byte) (int, error) { return 0, original })}
	stream, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: responseTransport(b, 200)})
	if err != nil {
		t.Fatal(err)
	}
	_, err = collect(stream)
	equal(t, err, original)
	equal(t, b.closes.Load(), int32(1))
	b = &body{Reader: strings.NewReader("unread")}
	stream, err = Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: responseTransport(b, 200)})
	if err != nil {
		t.Fatal(err)
	}
	stream.Close()
	equal(t, b.closes.Load(), int32(1))
}
