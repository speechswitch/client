package runtime_test

import (
    "context"
    "io"
    "testing"
    "github.com/speechswitch/client/sdks/go/generated/amazon"
    "github.com/speechswitch/client/sdks/go/generated/kugelaudio"
    "github.com/speechswitch/client/sdks/go/generated/lovo"
    "github.com/speechswitch/client/sdks/go/generated/xai"
    "github.com/speechswitch/client/sdks/go/runtime"
)

type once[T any] struct { value T; done bool }

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
