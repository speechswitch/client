package smallest_ai

import (
	"context"
	"encoding/json"
	"fmt"
	schema "github.com/speechswitch/client/sdks/go/generated/smallest_ai"
	out "github.com/speechswitch/client/sdks/go/generated/smallest_ai_output"
	"github.com/speechswitch/client/sdks/go/runtime"
	"io"
	"net/http"
	"reflect"
	"strings"
	"testing"
)

func allRequests() []struct {
	request schema.TtsRequest
	model   string
	timed   bool
	mode    string
} {
	text := newProducer("  hello  ")
	var command inputItem = schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbTextItemAsString{Value: "  hello  "}
	commands := newProducer(command)
	return []struct {
		request schema.TtsRequest
		model   string
		timed   bool
		mode    string
	}{
		{schema.TtsRequestAsLightningV31ProStreamingTextVoice8f1b36fb{Value: schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fb{Text: commands, Voice: "saved-voice", Continuation: schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbContinuation{Id: "context"}}}, "lightning_v3.1_pro", false, "continuation"},
		{schema.TtsRequestAsLightningV31ProStreamingTextVoiced206187f{Value: schema.TtsRequestLightningV31ProStreamingTextVoiced206187f{Text: text, Voice: "saved-voice"}}, "lightning_v3.1_pro", false, "stream"},
		{schema.TtsRequestAsLightningV31ProTextVoice74d06326{Value: schema.TtsRequestLightningV31ProTextVoice74d06326{Text: "  hello  ", Voice: "saved-voice"}}, "lightning_v3.1_pro", false, "whole"},
		{schema.TtsRequestAsLightningV31ProStreamingTextVoice4f8c2395{Value: schema.TtsRequestLightningV31ProStreamingTextVoice4f8c2395{Text: commands, Voice: schema.TtsRequestLightningV31ProStreamingTextVoice4f8c2395VoiceAsMeher{}, Continuation: schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbContinuation{Id: "context"}}}, "lightning_v3.1_pro", true, "continuation"},
		{schema.TtsRequestAsLightningV31ProStreamingTextVoice2da2f6d9{Value: schema.TtsRequestLightningV31ProStreamingTextVoice2da2f6d9{Text: text, Voice: schema.TtsRequestLightningV31ProStreamingTextVoice4f8c2395VoiceAsMeher{}}}, "lightning_v3.1_pro", true, "stream"},
		{schema.TtsRequestAsLightningV31ProTextVoice3c7c5185{Value: schema.TtsRequestLightningV31ProTextVoice3c7c5185{Text: "  hello  ", Voice: schema.TtsRequestLightningV31ProStreamingTextVoice4f8c2395VoiceAsMeher{}}}, "lightning_v3.1_pro", true, "whole"},
		{schema.TtsRequestAsLightningV31StreamingTextVoicebf9ab904{Value: schema.TtsRequestLightningV31StreamingTextVoicebf9ab904{Text: commands, Voice: "saved-voice", Continuation: schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbContinuation{Id: "context"}}}, "lightning_v3.1", false, "continuation"},
		{schema.TtsRequestAsLightningV31StreamingTextVoiced272850b{Value: schema.TtsRequestLightningV31StreamingTextVoiced272850b{Text: text, Voice: "saved-voice"}}, "lightning_v3.1", false, "stream"},
		{schema.TtsRequestAsLightningV31TextVoice5e2ae2e5{Value: schema.TtsRequestLightningV31TextVoice5e2ae2e5{Text: "  hello  ", Voice: "saved-voice"}}, "lightning_v3.1", false, "whole"},
		{schema.TtsRequestAsLightningV31StreamingTextVoice90b1878c{Value: schema.TtsRequestLightningV31StreamingTextVoice90b1878c{Text: commands, Voice: schema.TtsRequestLightningV31ProStreamingTextVoice4f8c2395VoiceAsMeher{}, Continuation: schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbContinuation{Id: "context"}}}, "lightning_v3.1", true, "continuation"},
		{schema.TtsRequestAsLightningV31StreamingTextVoicea9844e06{Value: schema.TtsRequestLightningV31StreamingTextVoicea9844e06{Text: text, Voice: schema.TtsRequestLightningV31ProStreamingTextVoice4f8c2395VoiceAsMeher{}}}, "lightning_v3.1", true, "stream"},
		{schema.TtsRequestAsLightningV31TextVoice727240a7{Value: schema.TtsRequestLightningV31TextVoice727240a7{Text: "  hello  ", Voice: schema.TtsRequestLightningV31ProStreamingTextVoice4f8c2395VoiceAsMeher{}}}, "lightning_v3.1", true, "whole"},
	}
}
func TestAllTwelveGeneratedVariantsAndPointerRepresentations(t *testing.T) {
	for _, test := range allRequests() {
		t.Run(fmt.Sprintf("%T", test.request), func(t *testing.T) {
			pointer := reflect.New(reflect.TypeOf(test.request))
			pointer.Elem().Set(reflect.ValueOf(test.request))
			for _, request := range []schema.TtsRequest{test.request, pointer.Interface().(schema.TtsRequest)} {
				request = trimRequest(request)
				validator, err := schema.ValidateRequest(request)
				if err != nil {
					t.Fatal(err)
				}
				values, err := resolve(request, validator)
				if err != nil {
					t.Fatal(err)
				}
				voice, language := "saved-voice", "auto"
				if test.timed {
					voice, language = "meher", "en"
				}
				want := map[string]any{"voice_id": voice, "model": test.model, "language": language, "sample_rate": float64(44100), "output_format": "pcm", "speed": float64(1), "math_notation": false}
				if test.timed {
					want["word_timestamps"] = true
				}
				equal(t, values.wire, want)
				equal(t, values.timed, test.timed)
				equal(t, values.input != nil, test.mode != "whole")
				equal(t, values.completionDelay, float64(4000))
				if test.mode == "continuation" {
					equal(t, values.contextID, "context")
					equal(t, values.bufferDelay, float64(3000))
				} else {
					equal(t, values.contextID, "")
					equal(t, values.bufferDelay, float64(0))
				}
				if test.mode == "whole" {
					equal(t, values.text, "hello")
				}
			}
		})
	}
}
func fixtureRequests() []schema.TtsRequest {
	first := request()
	first.Value.Voice = "custom_voice"
	first.Value.Text = "  Hello  "
	var ja schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbLanguage = schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbLanguageAsJa{}
	var hi schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbLanguage = schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbLanguageAsHi{}
	var no schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbFormulaReading = schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbFormulaReadingAsFalse{}
	var plain schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbFormulaReading = &schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbFormulaReadingAsPlainText{}
	second := schema.TtsRequestAsLightningV31ProTextVoice74d06326{Value: schema.TtsRequestLightningV31ProTextVoice74d06326{Voice: "cloned_voice", Text: "こんにちは", Language: runtime.Some(ja), FormulaReading: runtime.Some(no), PronunciationDictionaries: runtime.Some([]schema.TtsRequestLightningV31ProTextVoice74d06326PronunciationDictionariesItem{})}}
	third := second
	third.Value.Voice = "saved-voice"
	third.Value.Text = "3+2"
	third.Value.NumberPronunciationLanguage = runtime.Some(hi)
	third.Value.FormulaReading = runtime.Some(plain)
	third.Value.Speed = runtime.Some(.5)
	third.Value.ContentRetentionDays = runtime.Some(schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbContentRetentionDays{})
	third.Value.PronunciationDictionaries = runtime.Some([]schema.TtsRequestLightningV31ProTextVoice74d06326PronunciationDictionariesItem{{Id: "dict-1"}})
	third.Value.SessionId = runtime.Some("session.1")
	third.Value.RequestId = runtime.Some("request-1")
	var rate schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject1e4e72b8SampleRateHz = &schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject1e4e72b8SampleRateHzAsNumber8000{}
	var format schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutput = &schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputAsObject1e4e72b8{Value: schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject1e4e72b8{Format: schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject1e4e72b8FormatAsMulaw{}, SampleRateHz: runtime.Some(rate)}}
	third.Value.Output = runtime.Some(format)
	return []schema.TtsRequest{first, second, &third}
}
func TestSharedRequestsAndEverySSEByteSplit(t *testing.T) {
	fixture := shared(t)
	for i, r := range fixtureRequests() {
		for split := 0; split <= len(fixture.SSE); split++ {
			t.Run(fmt.Sprintf("%s/split-%d", fixture.Requests[i].Name, split), func(t *testing.T) {
				b := &body{chunks: [][]byte{[]byte(fixture.SSE[:split]), []byte(fixture.SSE[split:])}}
				input := start(t, r, Options{BaseURL: "https://proxy.test/path%2Fraw?tenant=a%2Bb", Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
					equal(t, r.Method, "POST")
					equal(t, r.URL.RequestURI(), "/path%2Fraw/waves/v1/tts/live?tenant=a%2Bb")
					equal(t, r.Header.Get("Authorization"), "Bearer fixture")
					equal(t, r.Header.Get("Accept"), "text/event-stream")
					retention := ""
					if i == 2 {
						retention = "true"
					}
					equal(t, r.Header.Get("x-expire-content"), retention)
					var wire any
					if err := json.NewDecoder(r.Body).Decode(&wire); err != nil {
						t.Fatal(err)
					}
					equal(t, wire, fixture.Requests[i].Body)
					return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"text/event-stream; charset=utf-8"}}, Body: b}, nil
				})})
				items, err := collect(deadline(t), input)
				if err != nil {
					t.Fatal(err)
				}
				equal(t, items, []out.SynthesisItem{out.SynthesisItemAsBytes{Value: []byte{0, 255, 128}}, out.SynthesisItemAsBytes{Value: []byte{1, 2}}, out.SynthesisItemAsDone{}})
				equal(t, b.closes.Load(), int32(1))
			})
		}
	}
}
func TestWholeTextECMAScriptTrimmingAndUnicodeLimit(t *testing.T) {
	for _, text := range []string{"\ufeff \rhello\u3000", "\u0085hello\u0085", "\x1chello\x1c", strings.Repeat("🚀", 8000)} {
		r := request()
		r.Value.Text = text
		values := trimRequest(&r).(schema.TtsRequestAsLightningV31TextVoice5e2ae2e5)
		want := text
		if text == "\ufeff \rhello\u3000" {
			want = "hello"
		}
		equal(t, values.Value.Text, want)
		equal(t, r.Value.Text, text)
		_, err := schema.ValidateRequest(values)
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, text := range []string{"\ufeff \u3000", strings.Repeat("🚀", 8001)} {
		r := request()
		r.Value.Text = text
		_, err := Synthesize(context.Background(), r, Options{Auth: authenticated()})
		if err == nil {
			t.Fatal("accepted invalid whole text")
		}
	}
}
func TestSharedInvalidWebSocketFrames(t *testing.T) {
	for _, fixture := range shared(t).InvalidFrames {
		t.Run(fixture.Wire, func(t *testing.T) {
			_, err := decode([]byte(fixture.Wire))
			if err == nil {
				t.Fatal("accepted invalid frame")
			}
			equal(t, err.Error(), fixture.Error)
		})
	}
}
func TestSSERejectsMalformedAndIncompleteStreams(t *testing.T) {
	for _, test := range []struct{ wire, want string }{
		{"data: {\"status\":\"206\",\"done\":false,\"audio\":\"AA==\"}\n\n", "Smallest.ai SSE ended before completion"},
		{"data: {\"status\":\"200\",\"done\":true,\"audio\":\"AA==\"}", "Smallest.ai SSE ended before completion"},
		{"data: {\"status\":200,\"done\":true}\n\n", "Invalid Smallest.ai SSE status"},
		{"data: {\"status\":\"200\",\"done\":false}\n\n", "Invalid Smallest.ai SSE status"},
		{"data: {\"status\":\"206\",\"done\":true}\n\n", "Invalid Smallest.ai SSE status"},
		{"data: {\"status\":\"206\",\"done\":false}\n\n", "Smallest.ai SSE chunk omitted audio"},
		{"data: {\"status\":\"200\",\"done\":true}\n\n", "Smallest.ai returned no audio"},
		{"data: {\"status\":\"200\",\"done\":true,\"audio\":\"AB==\"}\n\n", "Invalid Smallest.ai base64 audio"},
		{"event: error\ndata: {\"message\":\"secret\"}\n\n", "Smallest.ai SSE returned an error"},
		{"data: {\"error\":\"secret\"}\n\n", "Smallest.ai SSE returned an error"},
	} {
		t.Run(test.want+"/"+test.wire, func(t *testing.T) {
			b := &body{chunks: [][]byte{[]byte(test.wire)}}
			input := start(t, request(), Options{Transport: transportFunc(func(*http.Request) (*http.Response, error) { return &http.Response{StatusCode: 200, Body: b}, nil })})
			_, err := collect(deadline(t), input)
			if err == nil {
				t.Fatal("accepted invalid SSE")
			}
			equal(t, err.Error(), test.want)
			equal(t, b.closes.Load(), int32(1))
		})
	}
}
func TestHTTPStatusAndMediaErrorsDoNotReadBody(t *testing.T) {
	for _, test := range []struct {
		status      int
		media, want string
	}{
		{401, "text/plain", "Smallest.ai returned HTTP 401"}, {307, "text/plain", "Smallest.ai returned HTTP 307"}, {200, "application/json", "Smallest.ai returned an unexpected content type"},
	} {
		t.Run(test.want, func(t *testing.T) {
			b := &body{chunks: [][]byte{[]byte("secret")}}
			input := start(t, request(), Options{Transport: transportFunc(func(*http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: test.status, Header: http.Header{"Content-Type": {test.media}}, Body: b}, nil
			})})
			_, err := input.Next(deadline(t))
			if err == nil {
				t.Fatal("accepted invalid response")
			}
			equal(t, err.Error(), test.want)
			equal(t, b.reads.Load(), int32(0))
			equal(t, b.closes.Load(), int32(1))
			_, err = input.Next(deadline(t))
			equal(t, err, io.EOF)
		})
	}
}

func TestEveryCodecAndIndependentSampleRateOverBinaryHTTP(t *testing.T) {
	rates := []schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject1e4e72b8SampleRateHz{
		schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject1e4e72b8SampleRateHzAsNumber8000{},
		schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject1e4e72b8SampleRateHzAsNumber16000{},
		schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject1e4e72b8SampleRateHzAsNumber24000{},
		schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject1e4e72b8SampleRateHzAsNumber44100{},
	}
	for _, rate := range rates {
		formats := []struct {
			output schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutput
			native string
		}{
			{schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputAsObject172ee74a{Value: schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject172ee74a{Format: schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject172ee74aFormatAsPcm{}, SampleRateHz: runtime.Some(rate)}}, "pcm"},
			{&schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputAsObject172ee74a{Value: schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject172ee74a{Format: schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject172ee74aFormatAsWav{}, SampleRateHz: runtime.Some(rate)}}, "wav"},
			{schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputAsObject1e4e72b8{Value: schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject1e4e72b8{Format: schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject1e4e72b8FormatAsMp3{}, SampleRateHz: runtime.Some(rate)}}, "mp3"},
			{schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputAsObject1e4e72b8{Value: schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject1e4e72b8{Format: schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject1e4e72b8FormatAsMulaw{}, SampleRateHz: runtime.Some(rate)}}, "ulaw"},
			{&schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputAsObject1e4e72b8{Value: schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject1e4e72b8{Format: schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject1e4e72b8FormatAsAlaw{}, SampleRateHz: runtime.Some(rate)}}, "alaw"},
		}
		for _, format := range formats {
			t.Run(fmt.Sprintf("%s/%g", format.native, rate.LiteralValue()), func(t *testing.T) {
				r := request()
				r.Value.Output = runtime.Some(format.output)
				b := &body{chunks: [][]byte{{0, 255}, {128}}}
				input := start(t, r, Options{Protocol: "http", Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
					equal(t, r.URL.Path, "/waves/v1/tts")
					equal(t, r.Header.Get("Accept"), "audio/wav")
					var wire map[string]any
					if err := json.NewDecoder(r.Body).Decode(&wire); err != nil {
						t.Fatal(err)
					}
					equal(t, wire["output_format"], format.native)
					equal(t, wire["sample_rate"], rate.LiteralValue())
					return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"application/octet-stream"}}, Body: b}, nil
				})})
				items, err := collect(deadline(t), input)
				if err != nil {
					t.Fatal(err)
				}
				equal(t, items, []out.SynthesisItem{out.SynthesisItemAsBytes{Value: []byte{0, 255}}, out.SynthesisItemAsBytes{Value: []byte{128}}, out.SynthesisItemAsDone{}})
				equal(t, b.closes.Load(), int32(1))
			})
		}
	}
}

func TestEmptyPronunciationListStillDisallowsWebSocket(t *testing.T) {
	r := fixtureRequests()[1]
	socket := newSocket()
	_, err := Synthesize(context.Background(), r, Options{Auth: authenticated(), WebSocket: socket})
	if err == nil {
		t.Fatal("accepted dictionaries over socket")
	}
	equal(t, err.Error(), "Smallest.ai pronunciation dictionaries are documented only for HTTP/SSE")
	equal(t, socket.closes.Load(), int32(1))
}
