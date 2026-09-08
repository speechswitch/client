package kugelaudio

import (
	"context"
	"errors"
	schema "github.com/speechswitch/client/sdks/go/generated/kugelaudio"
	out "github.com/speechswitch/client/sdks/go/generated/kugelaudio_output"
	"github.com/speechswitch/client/sdks/go/runtime"
	"io"
	"strings"
	"sync/atomic"
	"testing"
)

func TestSocketTurnsFlushAndUnsetTemperature(t *testing.T) {
	source := newSource([]Input{&schema.TtsRequestStreamingTextVoiceTextItemAsString{Value: "Hel"}, text(""), text("lo"), &schema.TtsRequestStreamingTextVoiceTextItemAsFlush{}, text("!")})
	ws := newSocket()
	stream, err := Synthesize(context.Background(), streaming(source), Options{WebSocket: ws})
	if err != nil {
		t.Fatal(err)
	}
	items, err := collect(stream)
	if err != nil {
		t.Fatal(err)
	}
	equal(t, items, []out.SynthesisItem{out.SynthesisItemAsBytes{Value: []byte{1, 2}}, out.SynthesisItemAsBytes{Value: []byte{1, 2}},
		out.SynthesisItemAsFlush{Value: out.KugelAudioTurnEvent{CorrelationId: "0", InputGroupId: "0"}}, out.SynthesisItemAsBytes{Value: []byte{1, 2}},
		out.SynthesisItemAsFlush{Value: out.KugelAudioTurnEvent{CorrelationId: "1", InputGroupId: "1"}}})
	equal(t, ws.messages(), []map[string]any{liveSettings(t), {"text": "Hel"}, {"text": "lo"}, {"flush": true}, {"text": "!"}, {"flush": true}, {"close_socket": true}})
	wait(t, ws.closed)
	wait(t, source.closed)
	equal(t, source.closes.Load(), int32(1))
}

func TestSocketClearInterruptsDrainingTurn(t *testing.T) {
	fixture := loadFixtures(t)
	ws := newSocket()
	canceled, release := make(chan struct{}), make(chan struct{})
	ws.onSend = func(ctx context.Context, v map[string]any) error {
		if v["cancel"] == true {
			for _, packet := range []any{fixture["audio"], fixture["word"], map[string]any{"final": true}, map[string]any{"session_closed": true}} {
				ws.put(packet)
			}
			close(canceled)
			select {
			case <-release:
				ws.put(map[string]any{"interrupted": true})
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		if v["text"] == "New" {
			ws.put(fixture["audio"])
		}
		if v["flush"] == true && len(ws.messages()) > 4 {
			ws.put(map[string]any{"final": true})
			ws.put(map[string]any{"session_closed": true})
		}
		return nil
	}
	source := newSource([]Input{text("Old"), schema.TtsRequestStreamingTextVoiceTextItemAsFlush{}, schema.TtsRequestStreamingTextVoiceTextItemAsClear{}, text("New")})
	r := streaming(source)
	r.Value.TimestampGranularity = runtime.Some(schema.TtsRequestTextVoiceTimestampGranularity{})
	stream, err := Synthesize(context.Background(), r, Options{WebSocket: ws})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	done := make(chan struct{})
	var first out.SynthesisItem
	var failure error
	go func() { defer close(done); first, failure = stream.Next(context.Background()) }()
	wait(t, canceled)
	settings := liveSettings(t)
	settings["word_timestamps"] = true
	equal(t, ws.messages(), []map[string]any{settings, {"text": "Old"}, {"flush": true}, {"cancel": true}})
	close(release)
	wait(t, done)
	if failure != nil {
		t.Fatal(failure)
	}
	equal(t, first, out.SynthesisItemAsClear{})
	items, err := collect(stream)
	if err != nil {
		t.Fatal(err)
	}
	equal(t, items, []out.SynthesisItem{
		out.SynthesisItemAsOrdered{Value: out.KugelAudioEnvelope{CorrelationId: "1:0", InputGroupId: "1", ChunkId: 0, Audio: runtime.Some([]byte{1, 2}), AudioTiming: runtime.Some(out.KugelAudioEnvelopeAudioTiming{EndTimeMs: 1.0 / 24}), Timestamps: []out.KugelAudioTimestamp{}}},
		out.SynthesisItemAsFlush{Value: out.KugelAudioTurnEvent{CorrelationId: "1", InputGroupId: "1"}},
	})
}

func TestSocketWaitsForTurnAndSettingsAcknowledgements(t *testing.T) {
	for _, update := range []bool{false, true} {
		ws := newSocket()
		sent, release := make(chan struct{}), make(chan struct{})
		var updates atomic.Int32
		ws.onSend = func(ctx context.Context, v map[string]any) error {
			if v["flush"] == true || v["update_settings"] != nil {
				first := updates.Add(1) == 1
				if !update {
					ws.put(map[string]any{"final": true})
				}
				if first {
					close(sent)
					select {
					case <-release:
					case <-ctx.Done():
						return ctx.Err()
					}
				}
				if update {
					ws.put(map[string]any{"settings_updated": true, "settings": v["update_settings"]})
				} else {
					ws.put(map[string]any{"session_closed": true})
				}
			}
			return nil
		}
		values := []Input{text("First"), schema.TtsRequestStreamingTextVoiceTextItemAsFlush{}, text("Next")}
		u := schema.TtsRequestStreamingTextVoiceTextItemUpdate{VoiceGuidance: runtime.Some(1.5), Temperature: runtime.Some(0.0), MaxAudioTokens: runtime.Some(3.0), Speed: runtime.Some(1.1),
			Language: runtime.Some(schema.TtsRequestTextVoiceLanguage(schema.TtsRequestTextVoiceLanguageAsDe{})), TextNormalization: runtime.Some(schema.TtsRequestTextVoiceTextNormalization(schema.TtsRequestTextVoiceTextNormalizationAsFalse{}))}
		if update {
			values = []Input{&schema.TtsRequestStreamingTextVoiceTextItemAsUpdate{Value: u}}
		}
		source := newSource(values)
		stream, err := Synthesize(context.Background(), streaming(source), Options{WebSocket: ws})
		if err != nil {
			t.Fatal(err)
		}
		defer stream.Close()
		done := make(chan struct{})
		var item out.SynthesisItem
		var failure error
		go func() { defer close(done); item, failure = stream.Next(context.Background()) }()
		wait(t, sent)
		if update {
			equal(t, ws.messages(), []map[string]any{liveSettings(t), {"update_settings": map[string]any{"cfg_scale": 1.5, "temperature": float64(0), "max_new_tokens": float64(3), "language": "de", "normalize": false, "speed": 1.1}}})
		} else {
			equal(t, ws.messages(), []map[string]any{liveSettings(t), {"text": "First"}, {"flush": true}})
		}
		close(release)
		wait(t, done)
		if failure != nil {
			t.Fatal(failure)
		}
		if update {
			equal(t, item, out.SynthesisItemAsUpdated{Value: out.SynthesisItemUpdated{VoiceGuidance: runtime.Some(1.5), Temperature: runtime.Some(0.0), MaxAudioTokens: runtime.Some(3.0), Language: runtime.Some("de"), Speed: runtime.Some(1.1), TextNormalization: runtime.Some(out.SynthesisItemUpdatedTextNormalization(out.SynthesisItemUpdatedTextNormalizationAsFalse{}))}})
		} else {
			equal(t, item, out.SynthesisItemAsFlush{Value: out.KugelAudioTurnEvent{CorrelationId: "0", InputGroupId: "0"}})
		}
		if _, err := collect(stream); err != nil {
			t.Fatal(err)
		}
		equal(t, ws.messages()[len(ws.messages())-1], map[string]any{"close_socket": true})
	}
}

func TestStaticSocketSharedTimestampAndBillingFixture(t *testing.T) {
	fixture := loadFixtures(t)
	ws := newSocket()
	ws.onSend = func(_ context.Context, v map[string]any) error {
		for _, packet := range []any{fixture["audio"], fixture["audio"], fixture["word"], map[string]any{"final": true, "usage": fixture["usage"]}} {
			ws.put(packet)
		}
		return nil
	}
	r := request()
	r.Value.TimestampGranularity = runtime.Some(schema.TtsRequestTextVoiceTimestampGranularity{})
	stream, err := Synthesize(context.Background(), &r, Options{WebSocket: ws})
	if err != nil {
		t.Fatal(err)
	}
	items, err := collect(stream)
	if err != nil {
		t.Fatal(err)
	}
	equal(t, len(items), 4)
	for i := 0; i < 2; i++ {
		equal(t, items[i], out.SynthesisItemAsOrdered{Value: out.KugelAudioEnvelope{CorrelationId: "0:0", InputGroupId: "0", Audio: runtime.Some([]byte{1, 2}), AudioTiming: runtime.Some(out.KugelAudioEnvelopeAudioTiming{StartTimeMs: float64(i) / 24000 * 1000, EndTimeMs: float64(i+1) / 24000 * 1000}), Timestamps: []out.KugelAudioTimestamp{}}})
	}
	mark := out.KugelAudioTimestamp{Value: "Hi", StartTimeMs: 0, EndTimeMs: runtime.Some(float64(10)), Source: runtime.Some(out.KugelAudioTimestampSource{Start: 0, End: 2}), Confidence: runtime.Some(float64(1))}
	equal(t, items[2], out.SynthesisItemAsOrdered{Value: out.KugelAudioEnvelope{CorrelationId: "0:0", InputGroupId: "0", Timestamps: []out.KugelAudioTimestamp{mark}}})
	equal(t, items[3], out.SynthesisItemAsDone{Value: out.KugelAudioDoneEvent{Usage: runtime.Some(out.KugelAudioUsage{AudioSeconds: 1, Characters: 2, CostCents: out.KugelAudioUsageCostCentsAsNumber{Value: 0.2}, Currency: runtime.Some(out.KugelAudioUsageCurrency{}), Model: runtime.Some("kugel-3")})}})
	settings := fixture["settings"].(map[string]any)
	settings["text"], settings["temperature"], settings["word_timestamps"], settings["speaker_prefix"] = "Hi", 0.4, true, true
	equal(t, ws.messages(), []map[string]any{settings})
}

func TestIdleControlsAndAutoEndedTurn(t *testing.T) {
	for _, values := range [][]Input{{}, {text("")}, {schema.TtsRequestStreamingTextVoiceTextItemAsFlush{}}, {schema.TtsRequestStreamingTextVoiceTextItemAsClear{}}} {
		ws := newSocket()
		stream, err := Synthesize(context.Background(), streaming(newSource(values)), Options{WebSocket: ws})
		if err != nil {
			t.Fatal(err)
		}
		items, err := collect(stream)
		if err != nil {
			t.Fatal(err)
		}
		expected := []out.SynthesisItem{}
		if len(values) > 0 {
			if _, ok := values[0].(schema.TtsRequestStreamingTextVoiceTextItemAsClear); ok {
				expected = append(expected, out.SynthesisItemAsClear{})
			}
		}
		equal(t, items, expected)
		equal(t, ws.messages()[len(ws.messages())-1], map[string]any{"close_socket": true})
	}
	ws := newSocket()
	source := newSource([]Input{text("First")})
	source.stall = true
	ws.onSend = func(_ context.Context, v map[string]any) error {
		if v["text"] != nil {
			ws.put(map[string]any{"warning": "idle"})
			ws.put(map[string]any{"final": true})
			ws.put(map[string]any{"session_closed": true, "usage": map[string]any{"audio_seconds": 1, "characters": 5, "cost_cents": nil, "cost_unavailable": true}})
		}
		return nil
	}
	warnings := []string{}
	stream, err := Synthesize(context.Background(), streaming(source), Options{WebSocket: ws, OnWarning: func(v string) { warnings = append(warnings, v) }})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	item, err := stream.Next(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	equal(t, item, out.SynthesisItemAsFlush{Value: out.KugelAudioTurnEvent{CorrelationId: "0", InputGroupId: "0", Usage: runtime.Some(out.KugelAudioUsage{AudioSeconds: 1, Characters: 5, CostCents: out.KugelAudioUsageCostCentsAsNull{}})}})
	equal(t, warnings, []string{"idle"})
}

func TestConcurrentInputWritesAndCancellation(t *testing.T) {
	for _, mode := range []string{"parent", "next", "close", "write"} {
		parent, cancel := context.WithCancel(context.Background())
		defer cancel()
		pull, cancelPull := context.WithCancel(context.Background())
		defer cancelPull()
		source := newSource([]Input{text("Hi"), text("Next")})
		source.stall = true
		ws := newSocket()
		blocked := make(chan struct{})
		ws.onSend = func(ctx context.Context, v map[string]any) error {
			if v["text"] == "Hi" {
				ws.put(loadFixtures(t)["audio"])
				if mode == "write" {
					close(blocked)
					<-ctx.Done()
					return ctx.Err()
				}
			}
			return nil
		}
		stream, err := Synthesize(parent, streaming(source), Options{WebSocket: ws})
		if err != nil {
			t.Fatal(err)
		}
		defer stream.Close()
		first, err := stream.Next(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		equal(t, first, out.SynthesisItemAsBytes{Value: []byte{1, 2}})
		if mode == "write" {
			wait(t, blocked)
			equal(t, source.reads.Load(), int32(1))
		}
		done := make(chan error, 1)
		go func() { _, err := stream.Next(pull); done <- err }()
		if mode != "write" {
			wait(t, source.waiting)
		}
		switch mode {
		case "parent":
			cancel()
		case "next", "write":
			cancelPull()
		default:
			stream.Close()
		}
		err = <-done
		if mode != "close" && err != context.Canceled {
			t.Fatalf("%s: %v", mode, err)
		}
		wait(t, ws.closed)
		wait(t, source.closed)
		equal(t, source.closes.Load(), int32(1))
	}
}

func TestProducerFailureIdentityAndUncooperativeClose(t *testing.T) {
	failure := errors.New("original")
	for _, lane := range []string{"input", "output", "write"} {
		source := newSource([]Input{text("Hi")})
		ws := newSocket()
		switch lane {
		case "input":
			source.failure = failure
		case "output":
			ws.incoming <- socketResult{err: failure}
		case "write":
			ws.onSend = func(context.Context, map[string]any) error { return failure }
		}
		stream, err := Synthesize(context.Background(), streaming(source), Options{WebSocket: ws})
		if err != nil {
			t.Fatal(err)
		}
		_, err = collect(stream)
		if err != failure {
			t.Fatalf("%s lost error %v", lane, err)
		}
		wait(t, source.closed)
		wait(t, ws.closed)
	}
	release, waiting := make(chan struct{}), make(chan struct{})
	source := newSource([]Input{})
	source.nextFn = func(context.Context) (Input, error) { close(waiting); <-release; return nil, io.EOF }
	ws := newSocket()
	stream, err := Synthesize(context.Background(), streaming(source), Options{WebSocket: ws})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	done := make(chan error, 1)
	go func() { _, err := stream.Next(context.Background()); done <- err }()
	wait(t, waiting)
	ws.incoming <- socketResult{err: failure}
	if err := <-done; err != failure {
		t.Fatal(err)
	}
	wait(t, ws.closed)
	equal(t, source.closes.Load(), int32(0))
	close(release)
	wait(t, source.closed)
}

func TestSocketValidationAndFrameFailures(t *testing.T) {
	for _, value := range []Input{nil, (*schema.TtsRequestStreamingTextVoiceTextItemAsClear)(nil), schema.TtsRequestStreamingTextVoiceTextItemAsUpdate{Value: schema.TtsRequestStreamingTextVoiceTextItemUpdate{MaxAudioTokens: runtime.Some(1.5)}}} {
		ws := newSocket()
		r := streaming(newSource([]Input{value}))
		validate, err := schema.ValidateRequest(r)
		if err != nil {
			t.Fatal(err)
		}
		expected := validate(value)
		if expected == nil {
			t.Fatal("invalid item fixture passed generated validation")
		}
		stream, err := Synthesize(context.Background(), r, Options{WebSocket: ws})
		if err != nil {
			t.Fatal(err)
		}
		_, err = collect(stream)
		errorText(t, err, expected.Error())
		equal(t, ws.messages(), []map[string]any{liveSettings(t)})
	}
	ws := newSocket()
	stream, err := Synthesize(context.Background(), streaming(newSource([]Input{text(strings.Repeat("😀", 5001))})), Options{WebSocket: ws})
	if err != nil {
		t.Fatal(err)
	}
	_, err = collect(stream)
	errorText(t, err, "KugelAudio text fragments must not exceed 10000 characters")
	for _, c := range []struct {
		value    runtime.WebSocketMessage
		err      error
		expected string
	}{
		{runtime.WebSocketBinary([]byte("a")), nil, "KugelAudio returned a non-text WebSocket frame"},
		{runtime.WebSocketText("NaN"), nil, "KugelAudio returned invalid JSON"},
		{runtime.WebSocketText(strings.Repeat("a", 513)), nil, "KugelAudio message exceeds MaxMessageBytes"},
		{nil, io.EOF, "KugelAudio WebSocket closed before synthesis completed"},
	} {
		ws := newSocket()
		ws.incoming <- socketResult{value: c.value, err: c.err}
		ws.onSend = func(context.Context, map[string]any) error { return nil }
		stream, err := Synthesize(context.Background(), request(), Options{WebSocket: ws, MaxMessageBytes: 512})
		if err != nil {
			t.Fatal(err)
		}
		_, err = collect(stream)
		errorText(t, err, c.expected)
		wait(t, ws.closed)
	}
}

func TestSocketFormatsKeepNativeChunkAssociation(t *testing.T) {
	for _, c := range []struct {
		output   schema.TtsRequestTextVoiceOutput
		encoding string
		rate     float64
		audio    string
		bytes    []byte
	}{
		{schema.TtsRequestTextVoiceOutputAsPcm{Value: schema.TtsRequestTextVoiceOutputPcm{SampleRateHz: runtime.Some(schema.TtsRequestTextVoiceOutputPcmSampleRateHz(schema.TtsRequestTextVoiceOutputPcmSampleRateHzAsNumber44100{}))}}, "pcm_s16le", 44100, "AQI=", []byte{1, 2}},
		{schema.TtsRequestTextVoiceOutputAsObject{Value: schema.TtsRequestTextVoiceOutputObject{Format: schema.TtsRequestTextVoiceOutputObjectFormatAsMulaw{}}}, "mulaw", 8000, "AQ==", []byte{1}},
		{schema.TtsRequestTextVoiceOutputAsObject{Value: schema.TtsRequestTextVoiceOutputObject{Format: schema.TtsRequestTextVoiceOutputObjectFormatAsAlaw{}}}, "alaw", 8000, "AQ==", []byte{1}},
	} {
		ws := newSocket()
		ws.onSend = func(_ context.Context, _ map[string]any) error {
			for _, id := range []int{3, 7, 3} {
				ws.put(map[string]any{"audio": c.audio, "enc": c.encoding, "sr": c.rate, "samples": 1, "idx": 0, "chunk_id": id})
			}
			ws.put(map[string]any{"word_timestamps": []any{map[string]any{"word": "Hi", "start_ms": 0, "end_ms": 10, "char_start": 0, "char_end": 2}}, "chunk_id": 7})
			ws.put(map[string]any{"final": true})
			return nil
		}
		r := request()
		r.Value.Output = c.output
		r.Value.TimestampGranularity = runtime.Some(schema.TtsRequestTextVoiceTimestampGranularity{})
		stream, err := Synthesize(context.Background(), r, Options{WebSocket: ws})
		if err != nil {
			t.Fatal(err)
		}
		items, err := collect(stream)
		if err != nil {
			t.Fatal(err)
		}
		equal(t, len(items), 5)
		for i, id := range []float64{3, 7, 3} {
			item := items[i].(out.SynthesisItemAsOrdered).Value
			start := float64(0)
			if i == 2 {
				start = 1
			}
			equal(t, item.ChunkId, id)
			equal(t, item.CorrelationId, []string{"0:3", "0:7", "0:3"}[i])
			equal(t, item.Audio, runtime.Some(c.bytes))
			equal(t, item.AudioTiming, runtime.Some(out.KugelAudioEnvelopeAudioTiming{StartTimeMs: start / c.rate * 1000, EndTimeMs: (start + 1) / c.rate * 1000}))
		}
		mark := items[3].(out.SynthesisItemAsOrdered).Value
		equal(t, mark.CorrelationId, "0:7")
		equal(t, mark.Audio.Present, false)
		equal(t, mark.Timestamps[0].Value, "Hi")
		config := ws.messages()[0]
		equal(t, config["sample_rate"], c.rate)
		if c.encoding == "pcm_s16le" {
			_, present := config["output_format"]
			equal(t, present, false)
		} else {
			expected := "alaw_8000"
			if c.encoding == "mulaw" {
				expected = "ulaw_8000"
			}
			equal(t, config["output_format"], expected)
		}
	}
}
