package runtime_test

import (
    "bytes"
    "testing"
    "github.com/speechswitch/client/sdks/go/generated/resemble"
    "github.com/speechswitch/client/sdks/go/runtime"
)

func TestResemblePreservesStyleScaleAndReferenceAudio(t *testing.T) {
    request := resemble.TtsRequestText{
        Text: "Hello", StyleExaggeration: runtime.Some(2.0), Temperature: runtime.Some(5.0),
        ReferenceAudio: runtime.Some([]byte{0, 255, 128}), RandomSeed: runtime.Some(0.0),
    }
    if request.StyleExaggeration.Value != 2 || !bytes.Equal(request.ReferenceAudio.Value, []byte{0, 255, 128}) {
        t.Fatalf("lost native settings: %#v", request)
    }
    if !request.RandomSeed.Present || request.RandomSeed.Value != 0 { t.Fatal("lost explicit zero") }
    var normalized resemble.TtsRequest = resemble.TtsRequestAsText{Value: request}
    if _, ok := normalized.(resemble.TtsRequestAsText); !ok { t.Fatal("lost model branch") }
}
