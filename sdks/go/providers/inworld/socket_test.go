package inworld

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"testing"

	schema "github.com/speechswitch/client/sdks/go/generated/inworld"
	out "github.com/speechswitch/client/sdks/go/generated/inworld_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func TestSocketPipelinesEveryModelAndPreservesFlushGroups(t *testing.T) {
	for _, model := range []schema.TtsRequestTextVoiceModel{nil, schema.TtsRequestTextVoiceModelAsInworldTts2Flash{}, schema.TtsRequestTextVoiceModelAsInworldTts15Max{}, schema.TtsRequestTextVoiceModelAsInworldTts15Mini{}} {
		source := newSource([]Input{&schema.TtsRequestStreamingTextVoiceTextItemAsString{Value: "Hel"}, text(""), &schema.TtsRequestStreamingTextVoiceTextItemAsFlush{}, text("lo")})
		r := streaming(source)
		r.Value.TimestampGranularity = runtime.Some(schema.TtsRequestTextVoiceTimestampGranularity(schema.TtsRequestTextVoiceTimestampGranularityAsWord{}))
		r.Value.TextBufferThreshold = runtime.Some(float64(0))
		var request schema.TtsRequest = &r
		modelName := "inworld-tts-2"
		if model != nil {
			modelName = model.LiteralValue()
			request = &schema.TtsRequestAsStreamingTextVoice{Value: schema.TtsRequestStreamingTextVoice{Text: source, Voice: r.Value.Voice, Output: r.Value.Output, Model: model, TimestampGranularity: r.Value.TimestampGranularity, TextBufferThreshold: r.Value.TextBufferThreshold, Temperature: runtime.Some(float64(0))}}
		}
		ws := newSocket()
		ws.onSend = func(_ context.Context, value map[string]any) error {
			// A server can wait for text before acknowledging create; do not add a round trip.
			if packet, ok := value["send_text"].(map[string]any); ok {
				if packet["text"] == "Hel" {
					ws.event("contextCreated", map[string]any{})
				}
				ws.event("audioChunk", map[string]any{"audioContent": "AP8="})
			}
			if value["flush_context"] != nil {
				ws.event("flushCompleted", map[string]any{})
			}
			if value["close_context"] != nil {
				ws.event("contextClosed", map[string]any{})
			}
			return nil
		}
		stream, err := Synthesize(context.Background(), request, Options{WebSocket: ws, ContextID: runtime.Some("ctx")})
		if err != nil {
			t.Fatal(err)
		}
		items, err := collect(stream)
		if err != nil {
			t.Fatal(err)
		}
		equal(t, len(items), 3)
		equal(t, fixtureItem(t, items[0]), jsonValue(t, map[string]any{"correlation": "timeline", "correlationId": "ctx:0", "audio": map[string]any{"$bytes": []int{0, 255}}, "timestamps": []any{}}))
		equal(t, fixtureItem(t, items[1]), jsonValue(t, map[string]any{"event": "flush", "correlationId": "ctx:0", "inputGroupId": "0"}))
		equal(t, fixtureItem(t, items[2]), jsonValue(t, map[string]any{"correlation": "timeline", "correlationId": "ctx:1", "audio": map[string]any{"$bytes": []int{0, 255}}, "timestamps": []any{}}))
		create := map[string]any{"voiceId": "custom-voice", "modelId": modelName, "audioConfig": map[string]any{"audioEncoding": "PCM", "sampleRateHertz": 48000, "speakingRate": 1}, "applyTextNormalization": "APPLY_TEXT_NORMALIZATION_UNSPECIFIED", "timestampType": "WORD", "timestampTransportStrategy": "ASYNC", "maxBufferDelayMs": 0, "bufferCharThreshold": 1000, "autoMode": false}
		if model == nil {
			create["deliveryMode"] = "BALANCED"
		} else {
			create["temperature"] = 1
		}
		equal(t, jsonValue(t, ws.messages()), jsonValue(t, []map[string]any{{"create": create, "contextId": "ctx"}, {"send_text": map[string]any{"text": "Hel"}, "contextId": "ctx"}, {"flush_context": map[string]any{}, "contextId": "ctx"}, {"send_text": map[string]any{"text": "lo"}, "contextId": "ctx"}, {"close_context": map[string]any{}, "contextId": "ctx"}}))
		wait(t, source.closed)
		equal(t, source.closes.Load(), int32(1))
		wait(t, ws.closed)
	}
}

func TestSocketAudioWhileInputWritesAndCloseStall(t *testing.T) {
	for _, lane := range []string{"input", "text", "close"} {
		t.Run(lane, func(t *testing.T) {
			source := newSource([]Input{text("Hi")})
			source.stall = lane == "input"
			ws := newSocket()
			ws.onSend = func(ctx context.Context, v map[string]any) error {
				if v["create"] != nil {
					ws.event("contextCreated", map[string]any{})
				}
				if v["send_text"] != nil {
					ws.event("audioChunk", map[string]any{"audioContent": "AP8="})
					if lane == "text" {
						<-ctx.Done()
						return ctx.Err()
					}
				}
				if v["close_context"] != nil {
					ws.event("contextClosed", map[string]any{})
					if lane == "close" {
						<-ctx.Done()
						return ctx.Err()
					}
				}
				return nil
			}
			stream, err := Synthesize(context.Background(), streaming(source), Options{WebSocket: ws, ContextID: runtime.Some("ctx")})
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Close()
			item, err := stream.Next(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			equal(t, item, out.SynthesisItemAsBytes{Value: []byte{0, 255}})
			if lane == "close" {
				_, err = stream.Next(context.Background())
				equal(t, err, io.EOF)
			}
			stream.Close()
			wait(t, ws.closed)
			wait(t, source.closed)
		})
	}
}

func TestSocketCancellationDoesNotWaitForProducerOrCleanup(t *testing.T) {
	for _, mode := range []string{"parent", "pull", "close"} {
		t.Run(mode, func(t *testing.T) {
			entered, release := make(chan struct{}), make(chan struct{})
			cleanup, finish := make(chan struct{}), make(chan struct{})
			releaseInput := sync.OnceFunc(func() { close(release) })
			defer releaseInput()
			finishCleanup := sync.OnceFunc(func() { close(finish) })
			defer finishCleanup()
			source := newSource([]Input{})
			source.nextFn = func(context.Context) (Input, error) { close(entered); <-release; return text("late"), nil }
			source.closeFn = func() { close(cleanup); <-finish }
			ws := newSocket()
			parent, cancelParent := context.WithCancel(context.Background())
			defer cancelParent()
			pull, cancelPull := context.WithCancel(context.Background())
			defer cancelPull()
			stream, err := Synthesize(parent, streaming(source), Options{WebSocket: ws, ContextID: runtime.Some("ctx")})
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Close()
			result := make(chan error, 1)
			go func() { _, err := stream.Next(pull); result <- err }()
			wait(t, entered)
			switch mode {
			case "parent":
				cancelParent()
			case "pull":
				cancelPull()
			case "close":
				stream.Close()
			}
			wait(t, ws.closed)
			if mode == "close" {
				equal(t, <-result, io.EOF)
			} else {
				equal(t, <-result, context.Canceled)
			}
			equal(t, source.closes.Load(), int32(0))
			releaseInput()
			wait(t, cleanup)
			finishCleanup()
			wait(t, source.closed)
			equal(t, len(ws.messages()), 1)
		})
	}
}

func TestSocketProtocolFailuresAndGeneratedInputValidation(t *testing.T) {
	cases := []struct {
		frames  []any
		message string
	}{
		{[]any{map[string]any{"audioChunk": map[string]any{"audioContent": "AP8="}}}, "Inworld returned output before contextCreated"},
		{[]any{map[string]any{"contextCreated": map[string]any{}}, map[string]any{"contextCreated": map[string]any{}}}, "Inworld returned duplicate contextCreated"},
		{[]any{map[string]any{"contextId": "other", "contextCreated": map[string]any{}}}, "Inworld returned an unexpected context ID"},
		{[]any{map[string]any{"contextCreated": map[string]any{}, "audioChunk": map[string]any{}}}, "Inworld returned an invalid context event"},
		{[]any{map[string]any{"contextCreated": []any{}}}, "Inworld returned an invalid object"},
		{[]any{map[string]any{"contextCreated": map[string]any{}}, map[string]any{"contextClosed": map[string]any{}}}, "Inworld completed before the input stream ended"},
	}
	for i, c := range cases {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			ws := newSocket()
			ws.onSend = func(context.Context, map[string]any) error { return nil }
			for _, raw := range c.frames {
				value := raw.(map[string]any)
				if _, ok := value["contextId"]; !ok {
					value["contextId"] = "ctx"
				}
				ws.put(map[string]any{"result": value})
			}
			source := newSource([]Input{})
			source.stall = true
			stream, err := Synthesize(context.Background(), streaming(source), Options{WebSocket: ws, ContextID: runtime.Some("ctx")})
			if err != nil {
				t.Fatal(err)
			}
			_, err = collect(stream)
			errorText(t, err, c.message)
			wait(t, ws.closed)
		})
	}
	for _, c := range []struct {
		frame   runtime.WebSocketMessage
		err     error
		message string
	}{
		{runtime.WebSocketBinary{1}, nil, "Inworld returned a non-text WebSocket frame"},
		{nil, io.EOF, "Inworld WebSocket closed before contextClosed"},
		{runtime.WebSocketText(strings.Repeat("é", 301)), nil, "Inworld message exceeds MaxMessageBytes"},
	} {
		ws := newSocket()
		ws.incoming <- socketResult{value: c.frame, err: c.err}
		stream, err := Synthesize(context.Background(), streaming(newSource([]Input{})), Options{WebSocket: ws, ContextID: runtime.Some("ctx"), MaxMessageBytes: 600})
		if err != nil {
			t.Fatal(err)
		}
		_, err = collect(stream)
		errorText(t, err, c.message)
	}
	for _, item := range []Input{nil, (*schema.TtsRequestStreamingTextVoiceTextItemAsString)(nil), text(strings.Repeat("🙂", 1001))} {
		source := newSource([]Input{item})
		ws := newSocket()
		stream, err := Synthesize(context.Background(), streaming(source), Options{WebSocket: ws, ContextID: runtime.Some("ctx")})
		if err != nil {
			t.Fatal(err)
		}
		_, err = collect(stream)
		expected := "Invalid inworld TTS input item"
		if _, ok := item.(schema.TtsRequestStreamingTextVoiceTextItemAsString); ok {
			expected = "Inworld text chunks must not exceed 2000 characters"
		}
		errorText(t, err, expected)
		equal(t, len(ws.messages()), 1)
		wait(t, source.closed)
	}
	original := errors.New("producer failed")
	source := newSource([]Input{})
	source.failure = original
	stream, err := Synthesize(context.Background(), streaming(source), Options{WebSocket: newSocket(), ContextID: runtime.Some("ctx")})
	if err != nil {
		t.Fatal(err)
	}
	_, err = collect(stream)
	equal(t, err, original)
}

func wave(rate uint32, extra []byte) []byte {
	data := make([]byte, 36)
	copy(data, "RIFF")
	copy(data[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(data[16:], 16)
	binary.LittleEndian.PutUint16(data[20:], 1)
	binary.LittleEndian.PutUint16(data[22:], 1)
	binary.LittleEndian.PutUint32(data[24:], rate)
	binary.LittleEndian.PutUint32(data[28:], rate*2)
	binary.LittleEndian.PutUint16(data[32:], 2)
	binary.LittleEndian.PutUint16(data[34:], 16)
	data = append(data, extra...)
	data = append(data, []byte{'d', 'a', 't', 'a', 2, 0, 0, 0, 0, 255}...)
	binary.LittleEndian.PutUint32(data[4:], uint32(len(data)-8))
	return data
}
func TestSocketWavEverySplitAndAutomaticFlush(t *testing.T) {
	data := wave(48000, []byte{'J', 'U', 'N', 'K', 1, 0, 0, 0, 'x', 0})
	expected := append([]byte{}, data...)
	binary.LittleEndian.PutUint32(expected[4:], 0xffffffff)
	binary.LittleEndian.PutUint32(expected[len(data)-6:], 0xffffffff)
	expected = append(expected, 0, 255)
	for split := 0; split <= len(data); split++ {
		source := newSource([]Input{})
		ws := newSocket()
		ws.onSend = func(_ context.Context, value map[string]any) error {
			if value["create"] != nil {
				ws.event("contextCreated", map[string]any{})
				for _, chunk := range [][]byte{data[:split], data[split:]} {
					ws.event("audioChunk", map[string]any{"audioContent": base64.StdEncoding.EncodeToString(chunk)})
				}
				ws.event("flushCompleted", map[string]any{})
				ws.event("audioChunk", map[string]any{"audioContent": base64.StdEncoding.EncodeToString(data)})
			}
			if value["close_context"] != nil {
				ws.event("contextClosed", map[string]any{})
			}
			return nil
		}
		r := streaming(source)
		r.Value.Output = &schema.TtsRequestStreamingTextVoiceOutputAsWav{}
		stream, err := Synthesize(context.Background(), r, Options{WebSocket: ws, ContextID: runtime.Some("ctx")})
		if err != nil {
			t.Fatal(err)
		}
		items, err := collect(stream)
		if err != nil {
			t.Fatalf("split %d: %v", split, err)
		}
		bytes := []byte{}
		flushes := []out.SynthesisItem{}
		for _, item := range items {
			if v, ok := item.(out.SynthesisItemAsBytes); ok {
				bytes = append(bytes, v.Value...)
			} else {
				flushes = append(flushes, item)
			}
		}
		equal(t, bytes, expected)
		equal(t, flushes, []out.SynthesisItem{out.SynthesisItemAsFlush{Value: out.FlushEvent{CorrelationId: "ctx:0", InputGroupId: runtime.Some("0")}}})
	}
}
