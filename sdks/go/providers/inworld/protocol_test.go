package inworld

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"
	"testing"

	schema "github.com/speechswitch/client/sdks/go/generated/inworld"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func TestMalformedWirePacketsFailExactly(t *testing.T) {
	for i, c := range []struct{ data, message string }{
		{"\xff\n", "Inworld returned invalid UTF-8"},
		{`{"result":{"audioContent":NaN}}`, "Inworld returned invalid JSON"},
		{`{"result":{"audioContent":"%%%="}}`, "Inworld returned invalid base64 audio"},
		{`{"result":{"audioContent":"AP8=\n"}}`, "Inworld returned invalid base64 audio"},
		{`{"result":{"audioContent":[]}}`, "Inworld returned invalid audio content"},
		{`{"result":{}}`, "Inworld returned no audio or alignment"},
		{`{"result":{"status":{"code":true},"usage":{}}}`, "Inworld returned an invalid status code"},
		{`{"result":{"timestampInfo":{"wordAlignment":{"words":["Hi"],"wordStartTimeSeconds":[],"wordEndTimeSeconds":[]}}}}`, "Inworld returned mismatched timestamp arrays"},
		{`{"result":{"timestampInfo":{"wordAlignment":{"words":["Hi"],"wordStartTimeSeconds":[1],"wordEndTimeSeconds":[0]}}}}`, "Inworld returned a reversed timestamp range"},
		{`{"result":{"timestampInfo":{"wordAlignment":{"words":["Hi"],"wordStartTimeSeconds":[-1],"wordEndTimeSeconds":[0]}}}}`, "Inworld returned an invalid timestamp"},
		{`{"result":{"timestampInfo":{"wordAlignment":{"words":[],"wordStartTimeSeconds":[],"wordEndTimeSeconds":[],"phoneticDetails":[{"wordIndex":0,"phones":[]}]}}}}`, "Inworld returned an invalid phonetic word index"},
	} {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			b := &body{Reader: strings.NewReader(c.data)}
			r := request()
			r.Value.TimestampGranularity = runtime.Some(schema.TtsRequestTextVoiceTimestampGranularity(schema.TtsRequestTextVoiceTimestampGranularityAsWord{}))
			stream, err := Synthesize(context.Background(), r, Options{Auth: testAuth, Transport: responseTransport(b, 200)})
			if err != nil {
				t.Fatal(err)
			}
			_, err = collect(stream)
			errorText(t, err, c.message)
			equal(t, b.closes.Load(), int32(1))
		})
	}
	r := request()
	r.Value.TimestampGranularity = runtime.Some(schema.TtsRequestTextVoiceTimestampGranularity(schema.TtsRequestTextVoiceTimestampGranularityAsCharacter{}))
	r.Value.TimestampDelivery = runtime.Some(schema.TtsRequestTextVoiceTimestampDelivery(schema.TtsRequestTextVoiceTimestampDeliveryAsChunk{}))
	stream, err := Synthesize(context.Background(), r, Options{Auth: testAuth, Transport: responseTransport(&body{Reader: strings.NewReader(`{"result":{"timestampInfo":{}}}`)}, 200)})
	if err != nil {
		t.Fatal(err)
	}
	_, err = collect(stream)
	errorText(t, err, "Inworld omitted audio from synchronized alignment")
}

func TestWavErrorsCrossNativeBoundaries(t *testing.T) {
	for i, c := range []struct {
		parts   [][]byte
		message string
	}{
		{[][]byte{wave(48000, nil), wave(24000, nil)}, "Inworld changed WAV format between flushes"},
		{[][]byte{[]byte("RIFF")}, "Inworld returned an incomplete WAV header"},
		{[][]byte{[]byte("RIFF\x00\x00\x00\x00WAVEJUNK\xff\xff\xff\xff")}, "Inworld WAV header is too large"},
		{[][]byte{[]byte("RIFF\x00\x00\x00\x00WAVEdata\x00\x00\x00\x00")}, "Inworld WAV omitted its format"},
	} {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			ws := newSocket()
			ws.onSend = func(_ context.Context, value map[string]any) error {
				if value["create"] != nil {
					ws.event("contextCreated", map[string]any{})
					for _, part := range c.parts {
						ws.event("audioChunk", map[string]any{"audioContent": base64.StdEncoding.EncodeToString(part)})
						ws.event("flushCompleted", map[string]any{})
					}
				}
				if value["close_context"] != nil {
					ws.event("contextClosed", map[string]any{})
				}
				return nil
			}
			r := streaming(newSource([]Input{}))
			r.Value.Output = schema.TtsRequestStreamingTextVoiceOutputAsWav{}
			stream, err := Synthesize(context.Background(), r, Options{WebSocket: ws, ContextID: runtime.Some("ctx")})
			if err != nil {
				t.Fatal(err)
			}
			_, err = collect(stream)
			errorText(t, err, c.message)
			wait(t, ws.closed)
		})
	}
}

func TestAbsentOptionalPayloadsAndAllOutputRepresentations(t *testing.T) {
	r := streaming(newSource([]Input{}))
	r.Value.TextFlushDelayMs = runtime.Optional[float64]{Value: 900}
	r.Value.TextNormalization = runtime.Optional[schema.TtsRequestTextVoiceTextNormalization]{Value: schema.TtsRequestTextVoiceTextNormalizationAsTrue{}}
	r.Value.Speed = runtime.Optional[float64]{Value: 99}
	_, err := schema.ValidateRequest(r)
	if err != nil {
		t.Fatal(err)
	}
	c, err := settings(r)
	if err != nil {
		t.Fatal(err)
	}
	equal(t, c.body["maxBufferDelayMs"], float64(0))
	equal(t, c.body["applyTextNormalization"], "APPLY_TEXT_NORMALIZATION_UNSPECIFIED")
	equal(t, c.body["audioConfig"].(map[string]any)["speakingRate"], float64(1))
	for _, format := range []schema.TtsRequestStreamingTextVoiceOutput{
		&schema.TtsRequestStreamingTextVoiceOutputAsPcm{}, &schema.TtsRequestStreamingTextVoiceOutputAsWav{}, &schema.TtsRequestStreamingTextVoiceOutputAsMp3{}, &schema.TtsRequestStreamingTextVoiceOutputAsOggOpus{}, &schema.TtsRequestStreamingTextVoiceOutputAsObject{Value: schema.TtsRequestTextVoiceOutputObject{Format: &schema.TtsRequestTextVoiceOutputObjectFormatAsAlaw{}}},
	} {
		r.Value.Output = format
		_, err := schema.ValidateRequest(&r)
		if err != nil {
			t.Fatal(err)
		}
		c, err := settings(&r)
		if err != nil {
			t.Fatal(err)
		}
		audio := c.body["audioConfig"].(map[string]any)
		equal(t, audio["audioEncoding"], strings.ToUpper(c.format))
		if c.format == "alaw" {
			equal(t, audio["sampleRateHertz"], float64(8000))
		} else {
			equal(t, audio["sampleRateHertz"], float64(48000))
		}
	}
}
