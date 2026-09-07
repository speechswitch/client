package hume

import (
	"context"
	"errors"
	"net/http"
	"testing"

	schema "github.com/speechswitch/client/sdks/go/generated/hume"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func TestPacketRejectsMalformedWireValues(t *testing.T) {
	for _, tc := range []struct{ data, message string }{
		{`{"type":`, "Hume returned invalid JSON"},
		{`{"type":"\ud800"}`, "Hume returned invalid JSON"},
		{"{\"type\":\"\xff\"}", "Hume returned invalid JSON"},
		{`[]`, "Hume returned an invalid event"},
		{`null`, "Hume returned an invalid event"},
		{`{"type":"audio"}`, "Hume returned invalid correlation identifiers"},
	} {
		for _, metadata := range []bool{false, true} {
			_, err := packet([]byte(tc.data), metadata)
			errorText(t, err, tc.message)
		}
	}
	f := loadFixtures(t)
	for _, tc := range []struct {
		index   int
		field   string
		value   any
		message string
	}{
		{1, "chunk_index", true, "Hume returned an invalid audio event"},
		{1, "chunk_index", 0.5, "Hume returned an invalid audio event"},
		{1, "chunk_index", 9007199254740992.0, "Hume returned an invalid audio event"},
		{1, "utterance_index", -1, "Hume returned an invalid audio event"},
		{1, "utterance_index", "0", "Hume returned an invalid audio event"},
		{1, "is_last_chunk", 1, "Hume returned an invalid audio event"},
		{1, "audio", nil, "Hume returned an invalid audio event"},
		{1, "audio", "AA=", "Hume returned invalid base64 audio"},
		{1, "audio", "AP8=\n", "Hume returned invalid base64 audio"},
		{0, "timestamp", map[string]any{"type": "word", "text": "Hi", "time": map[string]any{"begin": 20, "end": 10}}, "Hume returned an invalid timestamp"},
		{0, "timestamp", map[string]any{"type": "word", "text": "Hi", "time": map[string]any{"begin": 0.1, "end": 1}}, "Hume returned an invalid timestamp"},
		{0, "timestamp", map[string]any{"type": "sentence", "text": "Hi", "time": map[string]any{"begin": 0, "end": 1}}, "Hume returned an invalid timestamp"},
		{0, "type", "unknown", "Hume returned an invalid event"},
		{0, "request_id", 3, "Hume returned invalid correlation identifiers"},
	} {
		v := map[string]any{}
		for k, value := range f.Timeline[tc.index].Packet {
			v[k] = value
		}
		v[tc.field] = tc.value
		_, err := packet(mustJSON(t, v), true)
		errorText(t, err, tc.message)
	}
	_, err := packet([]byte(`{"error":"native","message":"preferred","code":"invalid"}`), false)
	equal(t, err, &Error{Message: "preferred", Code: runtime.Some("invalid")})
}

func TestGeneratedAndRelationalChecksPrecedeIO(t *testing.T) {
	invalid := request()
	invalid.Value.Speed = runtime.Some(0.0)
	missing := request()
	missing.Value.Voice = ""
	duplicate := requests()[2].(schema.TtsRequestAsOctave2Turns)
	duplicate.Value.Speakers = append(duplicate.Value.Speakers, duplicate.Value.Speakers[0])
	unknown := requests()[2].(schema.TtsRequestAsOctave2Turns)
	unknown.Value.Turns[0].Speaker = "missing"
	prior := request()
	prior.Value.ContextBefore = runtime.Some(schema.TtsRequestOctave1TextContextBefore(&schema.TtsRequestOctave1TextContextBeforeAsObject{Value: schema.TtsRequestOctave1TextContextBeforeObject{RequestIds: []string{""}}}))
	for _, tc := range []struct {
		r       schema.TtsRequest
		message string
	}{
		{nil, "Invalid hume TTS request"},
		{(*schema.TtsRequestAsOctave2TextVoice)(nil), "Invalid hume TTS request"},
		{invalid, "Invalid hume TTS request"},
		{missing, "Invalid hume TTS request"},
		{duplicate, "Hume speaker aliases must be unique"},
		{unknown, "Unknown Hume speaker: missing"},
		{prior, "Hume continuation requires a non-empty generation ID"},
	} {
		called := false
		_, err := Synthesize(context.Background(), tc.r, Options{Auth: testAuth, Transport: transport(func(*http.Request) (*http.Response, error) {
			called = true
			return nil, errors.New("unexpected network")
		})})
		errorText(t, err, tc.message)
		equal(t, called, false)
	}
}

func TestNestedPointerSelectionsAndTimestampModes(t *testing.T) {
	for _, tc := range []struct {
		choice schema.TtsRequestOctave2TurnsTimestampGranularity
		kinds  []string
	}{
		{&schema.TtsRequestOctave2TurnsTimestampGranularityAsWord{}, []string{"word"}},
		{&schema.TtsRequestOctave2TurnsTimestampGranularityAsPhoneme{}, []string{"phoneme"}},
		{&schema.TtsRequestOctave2TurnsTimestampGranularityAsArray{Value: []schema.TtsRequestOctave2TurnsTimestampGranularityArrayItem{&schema.TtsRequestOctave2TurnsTimestampGranularityArrayItemAsPhoneme{}, &schema.TtsRequestOctave2TurnsTimestampGranularityArrayItemAsWord{}}}, []string{"phoneme", "word"}},
		{&schema.TtsRequestOctave2TurnsTimestampGranularityAsArray{Value: []schema.TtsRequestOctave2TurnsTimestampGranularityArrayItem{}}, []string{}},
	} {
		r := requests()[2].(schema.TtsRequestAsOctave2Turns)
		speaker := r.Value.Speakers[0].(schema.TtsRequestOctave1TurnsSpeakersItemAsObject9c8ccfab)
		r.Value.Speakers[0] = &speaker
		r.Value.Output.Format = &schema.TtsRequestOctave1TextOutputFormatAsWav{}
		r.Value.TimestampGranularity = runtime.Some(tc.choice)
		r.Value.ContextBefore = runtime.Some(schema.TtsRequestOctave2TurnsContextBefore(&schema.TtsRequestOctave2TurnsContextBeforeAsTurns{Value: schema.TtsRequestOctave2TurnsContextBeforeTurns{Turns: r.Value.Turns}}))
		validate, err := schema.ValidateRequest(r)
		if err != nil {
			t.Fatal(err)
		}
		c, err := settings(r, validate)
		if err != nil {
			t.Fatal(err)
		}
		equal(t, c.kinds, tc.kinds)
		equal(t, c.metadata, true)
		body := jsonValue(t, c.body).(map[string]any)
		equal(t, body["context"], map[string]any{"utterances": body["utterances"]})
	}
}
