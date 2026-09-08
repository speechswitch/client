package runtime_test

import (
	"context"
	"github.com/speechswitch/client/sdks/go/generated/amazon"
	"github.com/speechswitch/client/sdks/go/generated/microsoft"
	"github.com/speechswitch/client/sdks/go/generated/xai"
	"github.com/speechswitch/client/sdks/go/runtime"
	"math"
	"os"
	"strings"
	"testing"
)

type untouchedInput[T any] struct{}

func TestMicrosoftCandidateCountUsesGeneratedIntegerConstraint(t *testing.T) {
	fixture, err := os.ReadFile("../../fixtures/microsoft-invalid-top-k.txt")
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range []struct {
		topK   float64
		detail string
	}{{1, ""}, {22, ""}, {50, ""}, {1.5, "expected safe integer"}, {0, "expected number >= 1"}, {51, "expected number <= 50"}, {math.NaN(), "expected finite number"}} {
		request := microsoft.TtsRequestAsDragonHdOmniTextVoicea5a77562{Value: microsoft.TtsRequestDragonHdOmniTextVoicea5a77562{
			Model: microsoft.TtsRequestDragonHdOmniTextVoicea5a77562Model{}, Text: "Hello", Voice: "en-US-Ava", TopK: runtime.Some(row.topK),
		}}
		_, err := microsoft.ValidateRequest(request)
		if row.detail == "" {
			if err != nil {
				t.Fatalf("topK %v: %v", row.topK, err)
			}
		} else if err == nil || err.Error() != strings.ReplaceAll(strings.TrimSuffix(string(fixture), "\n"), "{{constraint}}", row.detail) {
			t.Fatalf("topK %v: expected exact request validation error, got %v", row.topK, err)
		}
	}
}

func (*untouchedInput[T]) Next(context.Context) (T, error) { panic("input advanced") }
func (*untouchedInput[T]) Close() error                    { panic("input closed") }

func TestGeneratedGoInputValidationKeepsProviderNarrowing(t *testing.T) {
	input := &untouchedInput[xai.TtsRequestStreamingTextTextItem]{}
	request := xai.TtsRequestAsStreamingText{Value: xai.TtsRequestStreamingText{Text: input, TextNormalization: runtime.Some(xai.TtsRequestTextTextNormalization(xai.TtsRequestTextTextNormalizationAsFalse{}))}}
	check, err := xai.ValidateRequest(request)
	if err != nil {
		t.Fatal(err)
	}
	clear := xai.TtsRequestStreamingTextTextItemAsClear{}
	if err := check(clear); err != nil {
		t.Fatal(err)
	}
	if err := check(xai.TtsRequestStreamingTextTextItemAsUpdate{}); err != nil {
		t.Fatal(err)
	}
	if err := check("unwrapped string"); err == nil || err.Error() != "Invalid xai TTS input item:\ntext item: expected generated input representation" {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, ok := request.Value.TextNormalization.Value.(xai.TtsRequestTextTextNormalizationAsFalse); !ok || !request.Value.TextNormalization.Present {
		t.Fatal("explicit false changed")
	}
	static, err := xai.ValidateRequest(xai.TtsRequestAsText{Value: xai.TtsRequestText{Text: "hello"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := static(clear); err == nil || err.Error() != "Invalid xai TTS input item:\ntext item: streaming input is not supported by this request" {
		t.Fatalf("unexpected static error: %v", err)
	}
	_, err = xai.ValidateRequest(xai.TtsRequestAsText{Value: xai.TtsRequestText{Text: string([]byte{255})}})
	if err == nil || err.Error() != "Invalid xai TTS request:\nrequest[\"text\"]: expected string\nrequest[\"text\"]: expected AsyncIterable" {
		t.Fatalf("invalid UTF-8 accepted: %v", err)
	}
	var missing *untouchedInput[xai.TtsRequestStreamingTextTextItem]
	_, err = xai.ValidateRequest(xai.TtsRequestAsStreamingText{Value: xai.TtsRequestStreamingText{Text: missing}})
	if err == nil || err.Error() != "Invalid xai TTS request:\nrequest[\"text\"]: expected string\nrequest[\"text\"]: expected AsyncIterable" {
		t.Fatalf("typed nil producer accepted: %v", err)
	}
	var missingRequest *xai.TtsRequestAsStreamingText
	_, err = xai.ValidateRequest(missingRequest)
	if err == nil || err.Error() != "Invalid xai TTS request:\nrequest: expected object\nrequest: expected object" {
		t.Fatalf("typed nil request accepted: %v", err)
	}
	amazonRequest := amazon.TtsRequestAsGenerativeStreamingTextVoice{Value: amazon.TtsRequestGenerativeStreamingTextVoice{
		Voice: "voice", Text: &untouchedInput[string]{},
		Output: amazon.TtsRequestTextVoiceOutputAsPcm{Value: amazon.TtsRequestTextVoiceOutputPcm{}},
	}}
	amazonCheck, err := amazon.ValidateRequest(amazonRequest)
	if err != nil {
		t.Fatal(err)
	}
	if err := amazonCheck("text"); err != nil {
		t.Fatal(err)
	}
	if err := amazonCheck(clear); err == nil || err.Error() != "Invalid amazon TTS input item:\ntext item: expected string" {
		t.Fatalf("unexpected Amazon error: %v", err)
	}
}

func TestJSONValidationRejectsCyclesButPreservesSharingAndEmptyCollections(t *testing.T) {
	shared := runtime.JsonObject{"values": runtime.JsonArray{runtime.JsonNull{}, runtime.JsonBool(false), runtime.JsonNumber(0)}}
	if !runtime.IsJSONValue(runtime.JsonArray{shared, shared}) {
		t.Fatal("shared references rejected")
	}
	array := runtime.JsonArray{nil}
	array[0] = array
	object := runtime.JsonObject{}
	object["self"] = object
	var typedNil *runtime.JsonString
	for _, value := range []runtime.JsonValue{nil, typedNil, array, object, runtime.JsonNumber(math.NaN()), runtime.JsonNumber(math.Inf(1)), runtime.JsonString(string([]byte{255})), runtime.JsonObject{string([]byte{255}): runtime.JsonNull{}}} {
		if runtime.IsJSONValue(value) {
			t.Fatal("invalid JSON accepted")
		}
	}
	var emptyArray runtime.JsonArray
	var emptyObject runtime.JsonObject
	if !runtime.IsJSONValue(emptyArray) || !runtime.IsJSONValue(emptyObject) {
		t.Fatal("empty collections rejected")
	}
	var deep runtime.JsonValue = runtime.JsonNull{}
	for index := 0; index < 2000; index++ {
		deep = runtime.JsonArray{deep}
	}
	if !runtime.IsJSONValue(deep) {
		t.Fatal("deep acyclic JSON rejected")
	}
}
