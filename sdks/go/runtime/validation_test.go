package runtime_test

import (
	"context"
	"github.com/speechswitch/client/sdks/go/generated/amazon"
	"github.com/speechswitch/client/sdks/go/generated/xai"
	"github.com/speechswitch/client/sdks/go/runtime"
	"math"
	"testing"
)

type untouchedInput[T any] struct{}

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
	if err := check("unwrapped string"); err == nil || err.Error() != "Invalid xai TTS input item" {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, ok := request.Value.TextNormalization.Value.(xai.TtsRequestTextTextNormalizationAsFalse); !ok || !request.Value.TextNormalization.Present {
		t.Fatal("explicit false changed")
	}
	static, err := xai.ValidateRequest(xai.TtsRequestAsText{Value: xai.TtsRequestText{Text: "hello"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := static(clear); err == nil || err.Error() != "Invalid xai TTS input item" {
		t.Fatalf("unexpected static error: %v", err)
	}
	_, err = xai.ValidateRequest(xai.TtsRequestAsText{Value: xai.TtsRequestText{Text: string([]byte{255})}})
	if err == nil || err.Error() != "Invalid xai TTS request" {
		t.Fatalf("invalid UTF-8 accepted: %v", err)
	}
	var missing *untouchedInput[xai.TtsRequestStreamingTextTextItem]
	_, err = xai.ValidateRequest(xai.TtsRequestAsStreamingText{Value: xai.TtsRequestStreamingText{Text: missing}})
	if err == nil || err.Error() != "Invalid xai TTS request" {
		t.Fatalf("typed nil producer accepted: %v", err)
	}
	var missingRequest *xai.TtsRequestAsStreamingText
	_, err = xai.ValidateRequest(missingRequest)
	if err == nil || err.Error() != "Invalid xai TTS request" {
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
	if err := amazonCheck(clear); err == nil || err.Error() != "Invalid amazon TTS input item" {
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
