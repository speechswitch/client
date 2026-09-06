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
	var ssml schema.TtsRequestChirp3HdTextVoicebb77af5cInputType = schema.TtsRequestChirp3HdTextVoicebb77af5cInputTypeAsSsml{}
	var markup schema.TtsRequestChirp3Hda92b414cInputType = schema.TtsRequestChirp3Hda92b414cInputTypeAsMarkup{}
	var alaw schema.TtsRequestChirp3HdTextVoicebb77af5cOutputWavSampleEncoding = schema.TtsRequestChirp3HdTextVoicebb77af5cOutputWavSampleEncodingAsAlaw{}
	typed := map[string]schema.TtsRequest{
		"gemini-http-controls": schema.TtsRequestAsTextVoice{Value: schema.TtsRequestTextVoice{
			Model: flash, Language: "en-US", Voice: kore, Text: "hello", Instructions: runtime.Some("Warmly"), TextNormalization: runtime.Some(noNormalization),
			Speed: runtime.Some(0.5), VolumeDb: runtime.Some(float64(0)), PitchSemitones: runtime.Some(float64(0)), EffectsProfiles: runtime.Some([]string{}),
			SafetySettings: runtime.Some([]schema.TtsRequestTextSafetySettingsItem{{Category: schema.TtsRequestTextSafetySettingsItemCategoryAsHarassment{}, Threshold: schema.TtsRequestTextSafetySettingsItemThresholdAsHigh{}}}),
			Output:         schema.TtsRequestChirp3HdTextVoicebb77af5cOutputAsWav{Value: schema.TtsRequestChirp3HdTextVoicebb77af5cOutputWav{SampleRateHz: runtime.Some(float64(24000))}},
		}},
		"chirp-http-ssml": schema.TtsRequestAsChirp3HdTextVoicebb77af5c{Value: schema.TtsRequestChirp3HdTextVoicebb77af5c{
			Language: enUS, Voice: kore, Text: "<speak>Acme</speak>", InputType: runtime.Some(ssml), Output: schema.TtsRequestChirp3HdTextVoicebb77af5cOutputAsPcm{},
			Replacements: runtime.Some([]schema.TtsRequestChirp3HdTextVoicebb77af5cReplacementsItem{{Pattern: "Acme", Replacement: "ækmi", Alphabet: schema.TtsRequestChirp3HdTextVoicebb77af5cReplacementsItemAlphabetAsIpa{}}}),
		}},
		"clone-beta-http": schema.TtsRequestAsChirp3InstantCustomVoiceTextVoicedb488368{Value: schema.TtsRequestChirp3InstantCustomVoiceTextVoicedb488368{
			Language: enUS, Voice: "existing-key", Text: "hello", InputType: runtime.Some(markup),
			Output: schema.TtsRequestChirp3InstantCustomVoiceTextVoicedb488368OutputAsWav{Value: schema.TtsRequestChirp3HdTextVoicebb77af5cOutputWav{SampleEncoding: runtime.Some(alaw)}},
		}},
		"gemini-complete-native": schema.TtsRequestAsObject7d956f3d{Value: schema.TtsRequestObject7d956f3d{
			Model: schema.TtsRequestTextVoiceModelAsGemini25ProTts{}, Language: "es-419", Voice: kore, Text: schema.TtsRequestChirp3Hda92b414cTextAsString{Value: "hola"}, TextNormalization: runtime.Some(noNormalization),
			Output: schema.TtsRequestChirp3Hda92b414cOutputAsPcm{Value: schema.TtsRequestChirp3HdTextVoicebb77af5cOutputPcm{SampleRateHz: runtime.Some(float64(24000))}},
		}},
		"clone-beta-native": schema.TtsRequestAsChirp3InstantCustomVoicefa2d40ff{Value: schema.TtsRequestChirp3InstantCustomVoicefa2d40ff{
			Language: enUS, Voice: "existing-key", Text: schema.TtsRequestChirp3Hda92b414cTextAsString{Value: "hello"}, InputType: runtime.Some(markup), Speed: runtime.Some(1.5),
			Output:       schema.TtsRequestChirp3Hda92b414cOutputAsObject{Value: schema.TtsRequestChirp3Hda92b414cOutputObject{Format: schema.TtsRequestChirp3Hda92b414cOutputObjectFormatAsMulaw{}}},
			Replacements: runtime.Some([]schema.TtsRequestChirp3HdTextVoicebb77af5cReplacementsItem{{Pattern: "Acme", Replacement: "akmi", Alphabet: schema.TtsRequestChirp3HdTextVoicebb77af5cReplacementsItemAlphabetAsXSampa{}}}),
		}},
		"gemini-dialogue-http": schema.TtsRequestAsTurns{Value: schema.TtsRequestTurns{
			Model: schema.TtsRequestTextModelAsGemini31FlashTtsPreview{}, Language: "en-US", Speakers: speakers, Turns: []Turn{{Speaker: "Sam", Text: "Hi"}, {Speaker: "Bob", Text: "Hello"}},
			Output: schema.TtsRequestChirp3HdTextVoicebb77af5cOutputAsMp3{Value: schema.TtsRequestChirp3HdTextVoicebb77af5cOutputMp3{BitRateBps: runtime.Some(schema.TtsRequestChirp3HdTextVoicebb77af5cOutputMp3BitRateBps{})}},
		}},
		"gemini-dialogue-native": schema.TtsRequestAsObject8dbffa0c{Value: schema.TtsRequestObject8dbffa0c{
			Model: flashSpeakers, Language: "en-US", Speakers: speakers, Turns: schema.TtsRequestObject8dbffa0cTurnsAsArray{Value: []Turn{{Speaker: "Sam", Text: "Hi"}}}, Instructions: runtime.Some("Conversational"), Output: schema.TtsRequestChirp3Hda92b414cOutputAsOggOpus{},
		}},
		"http-control-overrides-native-default": schema.TtsRequestAsTextVoice{Value: schema.TtsRequestTextVoice{
			Model: schema.TtsRequestTextVoiceModelAsGemini25FlashLitePreviewTts{}, Language: "cmn-tw", Voice: kore, Text: "hello", VolumeDb: runtime.Some(float64(0)), Output: schema.TtsRequestChirp3HdTextVoicebb77af5cOutputAsOggOpus{},
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
