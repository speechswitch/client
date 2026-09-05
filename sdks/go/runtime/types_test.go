package runtime_test

import (
    "context"
    "io"
    "testing"
    "github.com/speechswitch/client/sdks/go/generated/amazon"
    "github.com/speechswitch/client/sdks/go/generated/xai"
    "github.com/speechswitch/client/sdks/go/runtime"
)

type once[T any] struct { value T; done bool }
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
