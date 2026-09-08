package runtime_test

import (
	"github.com/speechswitch/client/sdks/go/generated/stream"
	"github.com/speechswitch/client/sdks/go/generated/voice_ai"
	"github.com/speechswitch/client/sdks/go/runtime"
	"testing"
)

func TestVoiceAiPreservesZeroAndNumberedDictionary(t *testing.T) {
	request := voice_ai.TtsRequestObjectdd71553d{
		Text:  voice_ai.TtsRequestObject1ec54d36TextAsString{Value: "Hello"},
		Model: voice_ai.TtsRequestObjectdd71553dModelAsVoiceaiTtsLiteV1Latest{},
		Voice: runtime.Some("cloned"), Temperature: runtime.Some(0.0),
		PronunciationDictionaries: runtime.Some([]voice_ai.TtsRequestObject1ec54d36PronunciationDictionariesItem{{Id: "owned-dictionary", Version: runtime.Some(2.0)}}),
	}
	if request.Temperature != runtime.Some(0.0) || request.Voice != runtime.Some("cloned") || request.PronunciationDictionaries.Value[0].Version != runtime.Some(2.0) {
		t.Fatal("lost request values")
	}
	flush := stream.FlushEvent{CorrelationId: "context"}
	if flush.InputGroupId.Present {
		t.Fatal("invented input group")
	}
}
