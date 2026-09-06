package cartesia

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"testing"

	schema "github.com/speechswitch/client/sdks/go/generated/cartesia"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func TestAllLiveAndTimedRequestRepresentations(t *testing.T) {
	input := newSource()
	raw := schema.TtsRequestStreamingTextVoice0bf53a99OutputAsPcm{Value: pcm()}
	model := schema.TtsRequestTextVoicef0bb1766ModelAsSonic35{}
	detail := schema.TtsRequestStreamingTextVoice12b0fd0cTimestampGranularityAsPhoneme{}
	var normalization schema.TtsRequestTextVoicef0bb1766TextNormalization = schema.TtsRequestTextVoicef0bb1766TextNormalizationAsFalse{}
	requests := []struct {
		request               schema.TtsRequest
		live, timed, regional bool
	}{
		{schema.TtsRequestAsStreamingTextVoice0bf53a99{Value: schema.TtsRequestStreamingTextVoice0bf53a99{Text: input, Voice: "saved", Model: model, Output: raw, MaxBufferDelayMs: runtime.Some(0.0), TextNormalization: runtime.Some(normalization)}}, true, false, false},
		{schema.TtsRequestAsStreamingTextVoice12b0fd0c{Value: schema.TtsRequestStreamingTextVoice12b0fd0c{Text: input, Voice: "saved", Model: model, Output: raw, MaxBufferDelayMs: runtime.Some(0.0), TextNormalization: runtime.Some(normalization), TimestampGranularity: detail}}, true, true, false},
		{schema.TtsRequestAsTextVoicec75c718e{Value: schema.TtsRequestTextVoicec75c718e{Text: "hello", Voice: "saved", Model: model, Output: raw, TextNormalization: runtime.Some(normalization), TimestampGranularity: detail}}, false, true, false},
		{schema.TtsRequestAsSonic36StreamingTextVoice15b369c8{Value: schema.TtsRequestSonic36StreamingTextVoice15b369c8{Text: input, Voice: "saved", Output: raw, MaxBufferDelayMs: runtime.Some(0.0), TextNormalization: runtime.Some(normalization), Language: runtime.Some("en-GB")}}, true, false, true},
		{schema.TtsRequestAsSonic36StreamingTextVoice9ed3706f{Value: schema.TtsRequestSonic36StreamingTextVoice9ed3706f{Text: input, Voice: "saved", Output: raw, MaxBufferDelayMs: runtime.Some(0.0), TextNormalization: runtime.Some(normalization), Language: runtime.Some("en-GB"), TimestampGranularity: detail}}, true, true, true},
		{schema.TtsRequestAsSonic36TextVoice448a171b{Value: schema.TtsRequestSonic36TextVoice448a171b{Text: "hello", Voice: "saved", Output: raw, TextNormalization: runtime.Some(normalization), Language: runtime.Some("en-GB"), TimestampGranularity: detail}}, false, true, true},
	}
	for _, test := range requests {
		if _, err := schema.ValidateRequest(test.request); err != nil {
			t.Fatal(err)
		}
		result, err := settings(test.request)
		if err != nil {
			t.Fatal(err)
		}
		expected := map[string]any{"model_id": "sonic-3.5", "voice": "saved", "output_format": map[string]any{"container": "raw", "encoding": "pcm_s16le", "sample_rate": 24000}, "generation_config": map[string]any{}, "normalization": "off", "add_timestamps": false, "add_phoneme_timestamps": test.timed, "use_normalized_timestamps": false}
		if test.live {
			expected["max_buffer_delay_ms"] = 0
		}
		if test.regional {
			expected["model_id"] = "sonic-3.6"
			expected["locale"] = "en-GB"
		}
		checkJSON(t, result.wire, expected)
		if result.timed != test.timed || (result.input != nil) != test.live {
			t.Fatalf("routing = %#v", result)
		}
	}
	if input.reads.Load() != 0 || input.closes.Load() != 0 {
		t.Fatal("conversion consumed input")
	}
}

func TestObservedDoneRotatesAndRetiresNativeContext(t *testing.T) {
	for _, finished := range []bool{false, true} {
		input, sock := newSource(), newSocket()
		stream, err := Synthesize(testContext(t), schema.TtsRequestAsStreamingTextVoice0bf53a99{Value: live(input)}, Options{WebSocket: sock})
		if err != nil {
			t.Fatal(err)
		}
		defer stream.Close()
		s := stream.(*socketStream)
		s.started, s.used, s.inputDone = true, true, finished
		old := s.contextID
		ready := make(chan socketResult, 1)
		encoded, _ := json.Marshal(map[string]any{"type": "done", "done": true, "status_code": 200, "context_id": old})
		ready <- socketResult{value: runtime.WebSocketText(encoded)}
		s.pendingOutput = ready
		sock.frames(old, map[string]any{"type": "chunk", "data": "AQ=="}, map[string]any{"type": "error", "status_code": 500, "message": "retired error"})
		original := errors.New("transport finished")
		sock.incoming <- socketResult{err: original}
		_, err = stream.Next(testContext(t))
		if finished {
			if err != io.EOF || s.contextID != old {
				t.Fatalf("completed context = %s, %v", s.contextID, err)
			}
		} else if err != original || s.contextID == old || !s.retired[old] || s.used {
			t.Fatalf("rotation = %s, %v", s.contextID, err)
		}
		if input.closes.Load() != 1 || sock.closes.Load() != 1 {
			t.Fatal("completion leaked")
		}
	}
}

func TestEmptyInputCommandsAndGeneratedInputChecks(t *testing.T) {
	for _, invalid := range []bool{false, true} {
		values := []inputResult{text(""), {value: schema.TtsRequestStreamingTextVoice0bf53a99TextItemAsFlush{}}, {value: schema.TtsRequestStreamingTextVoice0bf53a99TextItemAsClear{}}, {err: io.EOF}}
		if invalid {
			values = []inputResult{{value: nil}}
		}
		input, sock := newSource(values...), newSocket()
		stream, err := Synthesize(testContext(t), schema.TtsRequestAsStreamingTextVoice0bf53a99{Value: live(input)}, Options{WebSocket: sock})
		if err != nil {
			t.Fatal(err)
		}
		defer stream.Close()
		items, err := collect(testContext(t), stream)
		if invalid {
			if err == nil || err.Error() != "Invalid cartesia TTS input item" {
				t.Fatalf("input error = %v", err)
			}
		} else {
			if err != nil {
				t.Fatal(err)
			}
			checkJSON(t, items, []any{map[string]any{"event": "clear"}})
		}
		sock.mutex.Lock()
		count := len(sock.sent)
		sock.mutex.Unlock()
		if count != 0 || input.closes.Load() != 1 || sock.closes.Load() != 1 {
			t.Fatal("empty/invalid input reached wire or leaked resources")
		}
	}
	input, sock := newSource(text("too large")), newSocket()
	stream, err := Synthesize(context.Background(), schema.TtsRequestAsStreamingTextVoice0bf53a99{Value: live(input)}, Options{WebSocket: sock, MaxMessageBytes: 10})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	if _, err := stream.Next(testContext(t)); err == nil || err.Error() != "Cartesia message exceeds MaxMessageBytes" {
		t.Fatalf("send limit = %v", err)
	}
	if len(sock.sent) != 0 {
		t.Fatal("oversized request sent")
	}
}
