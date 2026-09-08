package google

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"reflect"
	"testing"

	schema "github.com/speechswitch/client/sdks/go/generated/google"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func TestSharedWireFixtures(t *testing.T) {
	var noNormalization schema.TtsRequestTextTextNormalization = schema.TtsRequestTextTextNormalizationAsFalse{}
	var ssml schema.TtsRequestChirp3HdTextVoiceffbf1cc1InputType = schema.TtsRequestChirp3HdTextVoiceffbf1cc1InputTypeAsSsml{}
	var markup schema.TtsRequestChirp3Hd174648a4InputType = schema.TtsRequestChirp3Hd174648a4InputTypeAsMarkup{}
	var alaw schema.TtsRequestChirp3HdTextVoiceffbf1cc1OutputWavSampleEncoding = schema.TtsRequestChirp3HdTextVoiceffbf1cc1OutputWavSampleEncodingAsAlaw{}
	typed := map[string]schema.TtsRequest{
		"gemini-http-controls": schema.TtsRequestAsTextVoice{Value: schema.TtsRequestTextVoice{
			Model: flash, Language: "en-US", Voice: kore, Text: "hello", Instructions: runtime.Some("Warmly"), TextNormalization: runtime.Some(noNormalization),
			Speed: runtime.Some(0.5), VolumeDb: runtime.Some(float64(0)), PitchSemitones: runtime.Some(float64(0)), EffectsProfiles: runtime.Some([]string{}),
			SafetySettings: runtime.Some([]schema.TtsRequestTextSafetySettingsItem{{Category: schema.TtsRequestTextSafetySettingsItemCategoryAsHarassment{}, Threshold: schema.TtsRequestTextSafetySettingsItemThresholdAsHigh{}}}),
			Output:         schema.TtsRequestChirp3HdTextVoiceffbf1cc1OutputAsWav{Value: schema.TtsRequestChirp3HdTextVoiceffbf1cc1OutputWav{SampleRateHz: runtime.Some(float64(24000))}},
		}},
		"chirp-http-ssml": schema.TtsRequestAsChirp3HdTextVoiceffbf1cc1{Value: schema.TtsRequestChirp3HdTextVoiceffbf1cc1{
			Language: enUS, Voice: kore, Text: "<speak>Acme</speak>", InputType: runtime.Some(ssml), Output: schema.TtsRequestChirp3HdTextVoiceffbf1cc1OutputAsPcm{},
			Replacements: runtime.Some([]schema.TtsRequestChirp3HdTextVoiceffbf1cc1ReplacementsItem{{Pattern: "Acme", Replacement: "ækmi", Alphabet: schema.TtsRequestChirp3HdTextVoiceffbf1cc1ReplacementsItemAlphabetAsIpa{}}}),
		}},
		"clone-beta-http": schema.TtsRequestAsChirp3InstantCustomVoiceTextVoiced9d056de{Value: schema.TtsRequestChirp3InstantCustomVoiceTextVoiced9d056de{
			Language: enUS, Voice: "existing-key", Text: "hello", InputType: runtime.Some(markup),
			Output: schema.TtsRequestChirp3InstantCustomVoiceTextVoiced9d056deOutputAsWav{Value: schema.TtsRequestChirp3HdTextVoiceffbf1cc1OutputWav{SampleEncoding: runtime.Some(alaw)}},
		}},
		"gemini-complete-native": schema.TtsRequestAsObjecta65cbd8a{Value: schema.TtsRequestObjecta65cbd8a{
			Model: schema.TtsRequestTextVoiceModelAsGemini25ProTts{}, Language: "es-419", Voice: kore, Text: schema.TtsRequestChirp3Hd174648a4TextAsString{Value: "hola"}, TextNormalization: runtime.Some(noNormalization),
			Output: schema.TtsRequestChirp3Hd174648a4OutputAsPcm{Value: schema.TtsRequestChirp3HdTextVoiceffbf1cc1OutputPcm{SampleRateHz: runtime.Some(float64(24000))}},
		}},
		"clone-beta-native": schema.TtsRequestAsChirp3InstantCustomVoice093d5f29{Value: schema.TtsRequestChirp3InstantCustomVoice093d5f29{
			Language: enUS, Voice: "existing-key", Text: schema.TtsRequestChirp3Hd174648a4TextAsString{Value: "hello"}, InputType: runtime.Some(markup), Speed: runtime.Some(1.5),
			Output:       schema.TtsRequestChirp3Hd174648a4OutputAsObject{Value: schema.TtsRequestChirp3Hd174648a4OutputObject{Format: schema.TtsRequestChirp3Hd174648a4OutputObjectFormatAsMulaw{}}},
			Replacements: runtime.Some([]schema.TtsRequestChirp3HdTextVoiceffbf1cc1ReplacementsItem{{Pattern: "Acme", Replacement: "akmi", Alphabet: schema.TtsRequestChirp3HdTextVoiceffbf1cc1ReplacementsItemAlphabetAsXSampa{}}}),
		}},
		"gemini-dialogue-http": schema.TtsRequestAsTurns5ba0ad7a{Value: schema.TtsRequestTurns5ba0ad7a{
			Model: schema.TtsRequestTextModelAsGemini31FlashTtsPreview{}, Language: "en-US", Speakers: speakers, Turns: []Turn{{Speaker: "Sam", Text: "Hi"}, {Speaker: "Bob", Text: "Hello"}},
			Output: schema.TtsRequestChirp3HdTextVoiceffbf1cc1OutputAsMp3{Value: schema.TtsRequestChirp3HdTextVoiceffbf1cc1OutputMp3{BitRateBps: runtime.Some(schema.TtsRequestChirp3HdTextVoiceffbf1cc1OutputMp3BitRateBps{})}},
		}},
		"gemini-dialogue-native": schema.TtsRequestAsTurns9a76562f{Value: schema.TtsRequestTurns9a76562f{
			Model: flashSpeakers, Language: "en-US", Speakers: speakers, Turns: []Turn{{Speaker: "Sam", Text: "Hi"}}, Instructions: runtime.Some("Conversational"), Output: schema.TtsRequestChirp3Hd174648a4OutputAsOggOpus{},
		}},
		"http-control-overrides-native-default": schema.TtsRequestAsTextVoice{Value: schema.TtsRequestTextVoice{
			Model: schema.TtsRequestTextVoiceModelAsGemini25FlashLitePreviewTts{}, Language: "cmn-tw", Voice: kore, Text: "hello", VolumeDb: runtime.Some(float64(0)), Output: schema.TtsRequestChirp3HdTextVoiceffbf1cc1OutputAsOggOpus{},
		}},
	}
	// Golden bytes independently produced by the TypeScript protobuf client from
	// the shared fixtures; no Go provider conversion supplies the expected value.
	golden := map[string][]string{
		"gemini-complete-native": {"0a390a220a0665732d34313912044b6f7265321267656d696e692d322e352d70726f2d747473220f080710c0bb0119000000000000f03f3a021000", "12060a04686f6c61"},
		"clone-beta-native":      {"0a380a170a05656e2d55532a0e0a0c6578697374696e672d6b6579220b080519000000000000f83f2a100a0e0a0441636d6510021a04616b6d69", "12072a0568656c6c6f"},
		"gemini-dialogue-native": {"0a4c0a390a05656e2d5553321467656d696e692d322e352d666c6173682d7474733a1a120b0a0353616d12044b6f7265120b0a03426f6212045075636b220b080319000000000000f03f3a021001", "121d3a0b0a090a0353616d12024869320e436f6e766572736174696f6e616c"},
	}
	data, err := os.ReadFile("../../../fixtures/google.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Name, Path string
		Body       map[string]any
	}
	if err := json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	if len(typed) != len(fixtures) {
		t.Fatalf("fixture count: %d want %d", len(typed), len(fixtures))
	}
	for _, fixture := range fixtures {
		t.Run(fixture.Name, func(t *testing.T) {
			grpc := newGRPC()
			calls := 0
			body := &testBody{Reader: bytes.NewBufferString(`{"audioContent":"YXVkaW8="}`)}
			transport := testTransport(func(r *http.Request) (*http.Response, error) {
				calls++
				if r.Method != "POST" || r.URL.String() != "https://proxy.invalid/google"+fixture.Path+"?tenant=one" {
					t.Fatalf("target: %s %s", r.Method, r.URL)
				}
				wantHeaders := http.Header{"Authorization": {"Bearer token"}, "X-Goog-Api-Key": {"key"}, "X-Goog-User-Project": {"quota"}, "Content-Type": {"application/json"}}
				if !reflect.DeepEqual(r.Header, wantHeaders) {
					t.Fatalf("headers: %v", r.Header)
				}
				data, err := io.ReadAll(r.Body)
				if err != nil {
					t.Fatal(err)
				}
				r.Body.Close()
				var got map[string]any
				if err := json.Unmarshal(data, &got); err != nil {
					t.Fatal(err)
				}
				if !reflect.DeepEqual(got, fixture.Body) {
					t.Fatalf("body: %s want %v", data, fixture.Body)
				}
				return &http.Response{StatusCode: 200, Body: body}, nil
			})
			stream, err := Synthesize(context.Background(), typed[fixture.Name], Options{Auth: testAuth, GRPC: grpc, Transport: transport, BaseURL: "https://proxy.invalid/google/?tenant=one"})
			if err != nil {
				t.Fatal(err)
			}
			if got := drain(t, stream); !reflect.DeepEqual(got, [][]byte{[]byte("audio")}) {
				t.Fatalf("audio: %q", got)
			}
			if fixture.Body != nil {
				if calls != 1 || body.closes.Load() != 1 || len(grpc.messages()) != 0 {
					t.Fatalf("HTTP ownership: %d %d %x", calls, body.closes.Load(), grpc.messages())
				}
			} else {
				var got []string
				for _, message := range grpc.messages() {
					got = append(got, hex.EncodeToString(message))
				}
				if !reflect.DeepEqual(got, golden[fixture.Name]) {
					t.Fatalf("messages: %v want %v", got, golden[fixture.Name])
				}
				if calls != 0 || grpc.ends.Load() != 1 || grpc.closes.Load() != 1 {
					t.Fatalf("gRPC lifecycle: %d %d %d", calls, grpc.ends.Load(), grpc.closes.Load())
				}
			}
		})
	}
}
