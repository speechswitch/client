package kugelaudio

import (
	"context"
	"errors"
	"github.com/speechswitch/client/sdks/go/generated/auth"
	schema "github.com/speechswitch/client/sdks/go/generated/kugelaudio"
	out "github.com/speechswitch/client/sdks/go/generated/kugelaudio_output"
	"github.com/speechswitch/client/sdks/go/runtime"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestHTTPSharedDefaultsAndEarlyBytes(t *testing.T) {
	fixture := loadFixtures(t)
	expected := fixture["settings"].(map[string]any)
	expected["text"], expected["temperature"] = "Hi", 0.4
	reader, writer := io.Pipe()
	defer writer.Close()
	b := &body{Reader: reader, closeFn: reader.Close}
	stream, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, BaseURL: "https://proxy.invalid/a%2Fb/?tenant=one", Transport: transport(func(r *http.Request) (*http.Response, error) {
		equal(t, r.URL.String(), "https://proxy.invalid/a%2Fb/v1/tts/generate?tenant=one")
		equal(t, r.Method, "POST")
		equal(t, r.Header, http.Header{"Authorization": {"Bearer test-key"}, "Content-Type": {"application/json"}})
		data, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		equal(t, decodeJSON(t, data), expected)
		return &http.Response{StatusCode: 200, Body: b}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	wrote := make(chan struct{})
	go func() { defer close(wrote); _, _ = writer.Write([]byte{1, 2}) }()
	item, err := stream.Next(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	equal(t, item, out.SynthesisItemAsBytes{Value: []byte{1, 2}})
	wait(t, wrote)
	equal(t, b.closes.Load(), int32(0))
	stream.Close()
	equal(t, b.closes.Load(), int32(1))
}

func TestHTTPAllModelsFormatsAndPresentZero(t *testing.T) {
	models := []schema.TtsRequestTextVoiceModel{schema.TtsRequestTextVoiceModelAsKugel1{}, schema.TtsRequestTextVoiceModelAsKugel1Turbo{}, schema.TtsRequestTextVoiceModelAsKugel2{}, schema.TtsRequestTextVoiceModelAsKugel2Turbo{}, schema.TtsRequestTextVoiceModelAsKugel25{}, schema.TtsRequestTextVoiceModelAsKugel3{}}
	outputs := []schema.TtsRequestTextVoiceOutput{}
	for _, rate := range []schema.TtsRequestTextVoiceOutputPcmSampleRateHz{schema.TtsRequestTextVoiceOutputPcmSampleRateHzAsNumber8000{}, schema.TtsRequestTextVoiceOutputPcmSampleRateHzAsNumber16000{}, schema.TtsRequestTextVoiceOutputPcmSampleRateHzAsNumber22050{}, schema.TtsRequestTextVoiceOutputPcmSampleRateHzAsNumber24000{}, schema.TtsRequestTextVoiceOutputPcmSampleRateHzAsNumber44100{}} {
		outputs = append(outputs, &schema.TtsRequestTextVoiceOutputAsPcm{Value: schema.TtsRequestTextVoiceOutputPcm{SampleRateHz: runtime.Some(rate)}})
	}
	outputs = append(outputs, schema.TtsRequestTextVoiceOutputAsObject{Value: schema.TtsRequestTextVoiceOutputObject{Format: schema.TtsRequestTextVoiceOutputObjectFormatAsMulaw{}}}, &schema.TtsRequestTextVoiceOutputAsObject{Value: schema.TtsRequestTextVoiceOutputObject{Format: schema.TtsRequestTextVoiceOutputObjectFormatAsAlaw{}}})
	for _, model := range models {
		for i, output := range outputs {
			r := request()
			r.Value.Model, r.Value.Output = runtime.Some(model), output
			r.Value.Voice = &schema.TtsRequestTextVoiceVoiceAsNumber{Value: 42}
			r.Value.Temperature, r.Value.VoiceGuidance, r.Value.Speed, r.Value.MaxAudioTokens = runtime.Some(0.0), runtime.Some(1.5), runtime.Some(1.1), runtime.Some(3.0)
			r.Value.TextNormalization = runtime.Some(schema.TtsRequestTextVoiceTextNormalization(schema.TtsRequestTextVoiceTextNormalizationAsFalse{}))
			r.Value.Language = runtime.Some(schema.TtsRequestTextVoiceLanguage(schema.TtsRequestTextVoiceLanguageAsDe{}))
			r.Value.PronunciationDictionarySelection = runtime.Some(schema.TtsRequestTextVoicePronunciationDictionarySelection{Scope: 10, Ids: runtime.Some([]float64{7, 9})})
			expected := map[string]any{"text": "Hi", "voice_id": 42, "model_id": model.LiteralValue(), "cfg_scale": 1.5, "temperature": 0, "speed": 1.1, "max_new_tokens": 3, "normalize": false, "language": "de", "project_id": 10, "dictionary_ids": []int{7, 9}, "sample_rate": []int{8000, 16000, 22050, 24000, 44100, 8000, 8000}[i]}
			if i >= 5 {
				expected["output_format"] = []string{"ulaw_8000", "alaw_8000"}[i-5]
			}
			b := &body{Reader: strings.NewReader("ab")}
			stream, err := Synthesize(context.Background(), &r, Options{Auth: testAuth, Transport: transport(func(r *http.Request) (*http.Response, error) {
				data, err := io.ReadAll(r.Body)
				if err != nil {
					t.Fatal(err)
				}
				equal(t, decodeJSON(t, data), jsonValue(t, expected))
				return &http.Response{StatusCode: 200, Body: b}, nil
			})})
			if err != nil {
				t.Fatal(err)
			}
			items, err := collect(stream)
			if err != nil {
				t.Fatal(err)
			}
			equal(t, items, []out.SynthesisItem{out.SynthesisItemAsBytes{Value: []byte("ab")}})
			equal(t, b.closes.Load(), int32(1))
		}
	}
}

func TestOptionalStoredValuesDoNotInventSettings(t *testing.T) {
	r := request()
	r.Value.Temperature = runtime.Optional[float64]{Value: 0.8}
	r.Value.VoiceBoost = runtime.Optional[schema.TtsRequestTextVoiceTextNormalization]{Value: schema.TtsRequestTextVoiceTextNormalizationAsFalse{}}
	r.Value.Model = runtime.Optional[schema.TtsRequestTextVoiceModel]{Value: schema.TtsRequestTextVoiceModelAsKugel1{}}
	r.Value.TextNormalization = runtime.Optional[schema.TtsRequestTextVoiceTextNormalization]{Value: schema.TtsRequestTextVoiceTextNormalizationAsFalse{}}
	for _, ids := range []runtime.Optional[[]float64]{{Value: []float64{9}}, runtime.Some([]float64(nil)), runtime.Some([]float64{7})} {
		r.Value.PronunciationDictionarySelection = runtime.Some(schema.TtsRequestTextVoicePronunciationDictionarySelection{Scope: 10, Ids: ids})
		expected := loadFixtures(t)["settings"].(map[string]any)
		expected["text"], expected["temperature"], expected["project_id"] = "Hi", 0.4, float64(10)
		if ids.Present {
			expected["dictionary_ids"] = append([]float64{}, ids.Value...)
		}
		stream, err := Synthesize(context.Background(), r, Options{Auth: testAuth, Transport: transport(func(r *http.Request) (*http.Response, error) {
			data, _ := io.ReadAll(r.Body)
			equal(t, decodeJSON(t, data), jsonValue(t, expected))
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(""))}, nil
		})})
		if err != nil {
			t.Fatal(err)
		}
		stream.Close()
	}
}

func TestHTTPFailureBoundsAndReadErrorIdentity(t *testing.T) {
	for _, raw := range []string{`{"error":"quota","error_code":"QUOTA"}`, "plain failure"} {
		b := &body{Reader: strings.NewReader(raw)}
		_, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: transport(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 429, Header: http.Header{"Retry-After": {"3"}}, Body: b}, nil
		})})
		var failure *Error
		if !errors.As(err, &failure) {
			t.Fatalf("unexpected %v", err)
		}
		message, code := "quota", runtime.Some("QUOTA")
		if raw == "plain failure" {
			message, code = raw, runtime.Optional[string]{}
		}
		equal(t, failure, &Error{Message: message, StatusCode: runtime.Some(429), Code: code, RetryAfter: runtime.Some("3")})
		equal(t, b.closes.Load(), int32(1))
	}
	b := &body{Reader: strings.NewReader("abcd")}
	_, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: responseTransport(b, 500), MaxJSONBytes: 3})
	errorText(t, err, "KugelAudio response exceeds MaxJSONBytes")
	equal(t, b.closes.Load(), int32(1))
	failure := errors.New("original")
	for _, status := range []int{200, 500} {
		b := &body{Reader: readerFunc(func([]byte) (int, error) { return 0, failure })}
		stream, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: responseTransport(b, status)})
		if status == 200 {
			if err != nil {
				t.Fatal(err)
			}
			_, err = stream.Next(context.Background())
			stream.Close()
		}
		if err != failure {
			t.Fatalf("lost error: %v", err)
		}
		equal(t, b.closes.Load(), int32(1))
	}
	for _, headers := range []http.Header{{"X-Sample-Rate": {"8000"}}, {"X-Sample-Rate": {"NaN"}}, {"X-Audio-Format": {"mp3"}}} {
		b := &body{Reader: strings.NewReader("a")}
		_, err := Synthesize(context.Background(), request(), Options{Auth: testAuth, Transport: transport(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 200, Header: headers, Body: b}, nil
		})})
		errorText(t, err, "KugelAudio returned an unexpected audio format")
		equal(t, b.closes.Load(), int32(1))
	}
}

func TestHTTPPendingReadCancellation(t *testing.T) {
	for _, mode := range []string{"parent", "next", "close"} {
		parent, cancel := context.WithCancel(context.Background())
		defer cancel()
		next, cancelNext := context.WithCancel(context.Background())
		defer cancelNext()
		reader, writer := io.Pipe()
		defer writer.Close()
		waiting := make(chan struct{})
		b := &body{Reader: readerFunc(func(p []byte) (int, error) { close(waiting); return reader.Read(p) }), closeFn: reader.Close}
		stream, err := Synthesize(parent, request(), Options{Auth: testAuth, Transport: responseTransport(b, 200)})
		if err != nil {
			t.Fatal(err)
		}
		defer stream.Close()
		done := make(chan error, 1)
		go func() { _, err := stream.Next(next); done <- err }()
		wait(t, waiting)
		switch mode {
		case "parent":
			cancel()
		case "next":
			cancelNext()
		default:
			stream.Close()
		}
		err = <-done
		if mode != "close" && err != context.Canceled {
			t.Fatalf("%s: %v", mode, err)
		}
		equal(t, b.closes.Load(), int32(1))
	}
}

func TestRegionAndEnvironmentResolution(t *testing.T) {
	t.Setenv("KUGELAUDIO_API_KEY", "native")
	t.Setenv("SPEECHSWITCH_KUGELAUDIO_API_KEY", "eu-scoped")
	for _, c := range []struct{ key, region, base, target, header string }{
		{"", "", "", "https://api.eu.kugelaudio.com", "Bearer scoped"},
		{"eu-test", "", "", "https://api.eu.kugelaudio.com", "Bearer test"},
		{"eu-test", "global", "", "https://api.kugelaudio.com", "Bearer test"},
		{"test", "eu", "", "https://api.eu.kugelaudio.com", "Bearer test"},
		{"eu-test", "eu", "https://proxy.invalid", "https://proxy.invalid", "Bearer test"},
	} {
		options := Options{Region: c.region, BaseURL: c.base, Transport: transport(func(r *http.Request) (*http.Response, error) {
			equal(t, r.URL.String(), c.target+"/v1/tts/generate")
			equal(t, r.Header.Get("Authorization"), c.header)
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(""))}, nil
		})}
		if c.key != "" {
			options.Auth = auth.Auth{Kugelaudio: runtime.Some(auth.AuthAsync{ApiKey: runtime.Some(c.key)})}
		}
		stream, err := Synthesize(context.Background(), request(), options)
		if err != nil {
			t.Fatal(err)
		}
		stream.Close()
	}
	_, err := Synthesize(context.Background(), request(), Options{Auth: auth.Auth{Kugelaudio: runtime.Some(auth.AuthAsync{ApiKey: runtime.Some("")})}})
	errorText(t, err, "Missing auth.kugelaudio.apiKey configuration")
}
