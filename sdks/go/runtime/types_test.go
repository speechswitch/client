package runtime_test

import (
    "context"
    "io"
    "slices"
    "testing"
    "github.com/speechswitch/client/sdks/go/generated/amazon"
    "github.com/speechswitch/client/sdks/go/generated/kugelaudio"
    "github.com/speechswitch/client/sdks/go/generated/lovo"
    "github.com/speechswitch/client/sdks/go/generated/microsoft"
    "github.com/speechswitch/client/sdks/go/generated/minimax"
    "github.com/speechswitch/client/sdks/go/generated/mistral"
    "github.com/speechswitch/client/sdks/go/generated/murf"
    "github.com/speechswitch/client/sdks/go/generated/xai"
    "github.com/speechswitch/client/sdks/go/runtime"
)

type once[T any] struct { value T; done bool }

func TestMurfGeneratedStreamRetainsVoiceUpdatesAndZeroBias(t *testing.T) {
    var update murf.TtsRequestStreamingTextVoiceTextItem = murf.TtsRequestStreamingTextVoiceTextItemAsUpdate{Value: murf.TtsRequestStreamingTextVoiceTextItemUpdate{
        Command: murf.TtsRequestStreamingTextVoiceTextItemUpdateCommand{}, Voice: runtime.Some("saved"), SpeedBias: runtime.Some(0.0), MaxBufferDelayMs: runtime.Some(0.0),
    }}
    request := murf.TtsRequestStreamingTextVoice{Voice: "Gordon", Text: &once[murf.TtsRequestStreamingTextVoiceTextItem]{value: update}}
    item, err := request.Text.Next(context.Background())
    if err != nil || item != update { t.Fatalf("unexpected update: %#v %v", item, err) }
    value := item.(murf.TtsRequestStreamingTextVoiceTextItemAsUpdate).Value
    if !value.SpeedBias.Present || value.SpeedBias.Value != 0 || !value.MaxBufferDelayMs.Present || value.MaxBufferDelayMs.Value != 0 || request.MaxBufferDelayMs.Present { t.Fatalf("lost zero/omission: %#v", value) }
    if err := request.Text.Close(); err != nil { t.Fatal(err) }
}

func TestMistralGeneratedReferenceBytesAndMetadata(t *testing.T) {
	request := mistral.TtsRequest{
		Text: "Hello", Voice: runtime.Some("saved-voice"), ReferenceAudio: runtime.Some([]byte{0, 255, 128}),
		Metadata: runtime.Some(map[string]runtime.JsonValue{"values": runtime.JsonArray{runtime.JsonNull{}, runtime.JsonBool(false), runtime.JsonNumber(0)}}),
	}
	if !request.ReferenceAudio.Present || len(request.ReferenceAudio.Value) != 3 || request.ReferenceAudio.Value[1] != 255 {
		t.Fatalf("lost audio bytes: %#v", request)
	}
	values, ok := request.Metadata.Value["values"].(runtime.JsonArray)
	if !ok || len(values) != 3 || values[0] != (runtime.JsonNull{}) || values[1] != runtime.JsonBool(false) || values[2] != runtime.JsonNumber(0) {
		t.Fatalf("lost JSON values: %#v", values)
	}
}

func TestMiniMaxGeneratedVoiceBlendAndCancelInput(t *testing.T) {
    var clear minimax.TtsRequestStreamingText73946d93TextItem = minimax.TtsRequestStreamingText73946d93TextItemAsClear{
        Value: minimax.TtsRequestStreamingText73946d93TextItemClear{Command: minimax.TtsRequestStreamingText73946d93TextItemClearCommand{}},
    }
    request := minimax.TtsRequestStreamingText73946d93{
        Model: minimax.TtsRequestText0cf09fc5ModelAsSpeech02Hd{},
        Text: &once[minimax.TtsRequestStreamingText73946d93TextItem]{value: clear},
        VoiceBlend: []minimax.TtsRequestText0cf09fc5VoiceBlendItem{{Voice: "saved-clone", Weight: 100}},
        VoiceTransform: minimax.TtsRequestText0cf09fc5VoiceTransform{Brightness: runtime.Some(0.0)},
        PitchBias: runtime.Some(0.0),
    }
    item, err := request.Text.Next(context.Background())
    if err != nil || item != clear { t.Fatalf("unexpected clear: %#v %v", item, err) }
    if request.VoiceBlend[0].Voice != "saved-clone" || !request.PitchBias.Present || request.PitchBias.Value != 0 { t.Fatalf("lost request values: %#v", request) }
    if err := request.Text.Close(); err != nil { t.Fatal(err) }
}

func TestMicrosoftGeneratedModelPreservesStreamingAndZeroTemperature(t *testing.T) {
    request := microsoft.TtsRequestDragonHdStreamingTextVoice{
        Model: microsoft.TtsRequestDragonHdTextVoiceModel{}, Voice: "en-US-Ava",
        Text: &once[string]{value: "Hello"}, Temperature: runtime.Some(0.0),
        LexiconUrl: runtime.Some(""), PreferredLanguages: runtime.Some([]string{"en-US", "zh-CN"}),
    }
    if request.Model.Value() != "dragon-hd" || !request.Temperature.Present || request.Temperature.Value != 0 { t.Fatal("lost model or zero temperature") }
    if !request.LexiconUrl.Present || request.LexiconUrl.Value != "" { t.Fatalf("lost empty lexicon URL: %#v", request.LexiconUrl) }
    if !request.PreferredLanguages.Present || !slices.Equal(request.PreferredLanguages.Value, []string{"en-US", "zh-CN"}) { t.Fatalf("lost locale preferences: %#v", request.PreferredLanguages) }
    text, err := request.Text.Next(context.Background())
    if err != nil || text != "Hello" { t.Fatalf("incorrect incremental input: %q %v", text, err) }
    if err := request.Text.Close(); err != nil { t.Fatal(err) }
}

func TestLovoGeneratedRequestPreservesSavedStyle(t *testing.T) {
    request := lovo.TtsRequest{Text: "Hello", Voice: "speaker", VoiceStyle: runtime.Some("saved-style")}
    if !request.VoiceStyle.Present || request.VoiceStyle.Value != "saved-style" || request.Speed.Present { t.Fatalf("lost optional fields: %#v", request) }
}
func (input *once[T]) Next(ctx context.Context) (T, error) {
    var zero T
    if err := ctx.Err(); err != nil { return zero, err }
    if input.done { return zero, io.EOF }
    input.done = true
    return input.value, nil
}
func (input *once[T]) Close() error { input.done = true; return nil }

func TestTypedStreamsAndLiteralValues(t *testing.T) {
    clear := xai.TtsRequestStreamingTextTextItemClear{Command: xai.TtsRequestStreamingTextTextItemClearCommand{}}
    if clear.Command.Value() != "clear" { t.Fatal("incorrect command literal") }
    var command xai.TtsRequestStreamingTextTextItem = xai.TtsRequestStreamingTextTextItemAsClear{Value: clear}
    var commands runtime.Input[xai.TtsRequestStreamingTextTextItem] = &once[xai.TtsRequestStreamingTextTextItem]{value: command}
    item, err := commands.Next(context.Background())
    if err != nil || item != command { t.Fatalf("unexpected item: %#v %v", item, err) }
    if err := commands.Close(); err != nil { t.Fatal(err) }
    if _, err := commands.Next(context.Background()); err != io.EOF { t.Fatalf("expected EOF, got %v", err) }
    var request amazon.TtsRequest = amazon.TtsRequestAsGenerativeStreamingTextVoice{Value: amazon.TtsRequestGenerativeStreamingTextVoice{
        Model: amazon.TtsRequestTextVoiceModelGenerative{}, Text: &once[string]{value: "Hello"}, Voice: "Joanna",
        Output: amazon.TtsRequestTextVoiceOutputAsPcm{Value: amazon.TtsRequestTextVoiceOutputPcm{Format: amazon.TtsRequestTextVoiceOutputPcmFormat{}}},
    }}
    if request == nil { t.Fatal("missing request") }
}

func TestKugelAudioGeneratedUpdatesPreserveZeroFalseAndOmission(t *testing.T) {
    var normalization kugelaudio.TtsRequestTextVoiceTextNormalization = kugelaudio.TtsRequestTextVoiceTextNormalizationAsFalse{}
    update := kugelaudio.TtsRequestStreamingTextVoiceTextItemUpdate{
        Command: kugelaudio.TtsRequestStreamingTextVoiceTextItemUpdateCommand{},
        Temperature: runtime.Some(0.0), TextNormalization: runtime.Some(normalization),
    }
    var command kugelaudio.TtsRequestStreamingTextVoiceTextItem = kugelaudio.TtsRequestStreamingTextVoiceTextItemAsUpdate{Value: update}
    var stream runtime.Input[kugelaudio.TtsRequestStreamingTextVoiceTextItem] = &once[kugelaudio.TtsRequestStreamingTextVoiceTextItem]{value: command}
    item, err := stream.Next(context.Background())
    if err != nil { t.Fatal(err) }
    actual, ok := item.(kugelaudio.TtsRequestStreamingTextVoiceTextItemAsUpdate)
    if !ok { t.Fatalf("expected update, got %#v", item) }
    if actual.Value.Command.Value() != "update" || !actual.Value.Temperature.Present || actual.Value.Temperature.Value != 0 || actual.Value.Speed.Present { t.Fatalf("lost update fields: %#v", actual) }
    if !actual.Value.TextNormalization.Present { t.Fatal("lost explicit normalization") }
    flag, ok := actual.Value.TextNormalization.Value.(kugelaudio.TtsRequestTextVoiceTextNormalizationAsFalse)
    if !ok || flag.Value.Value() { t.Fatal("lost explicit false") }
    defaults := kugelaudio.TtsRequestTextVoicePronunciationDictionarySelection{Scope: 10}
    disabled := kugelaudio.TtsRequestTextVoicePronunciationDictionarySelection{Scope: 10, Ids: runtime.Some([]float64{})}
    if defaults.Ids.Present || !disabled.Ids.Present || len(disabled.Ids.Value) != 0 { t.Fatal("lost dictionary omission") }
}
