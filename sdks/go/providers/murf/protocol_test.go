package murf

import (
	"encoding/json"
	"github.com/speechswitch/client/sdks/go/runtime"
	"testing"
)

func TestNativeErrorBodyAndExplicitFinalFalse(t *testing.T) {
	raw := []byte(`{"error":{"code":429,"message":"quota"}}`)
	_, err := decodePacket(raw)
	equal(t, err, &Error{Body: string(raw)})
	p, err := decodePacket([]byte(`{"context_id":"native","audio":"AP+A","final":false}`))
	equal(t, err, nil)
	equal(t, p, packet{context: "native", audio: []byte{0, 255, 128}, final: false})
}
func TestGen2RejectsMalformedTimingAndMetadata(t *testing.T) {
	for _, tc := range []struct {
		fields map[string]any
		want   string
	}{
		{map[string]any{"audioLengthInSeconds": true}, "Murf returned an invalid audio duration"},
		{map[string]any{"audioLengthInSeconds": -1}, "Murf returned an invalid audio duration"},
		{map[string]any{"remainingCharacterCount": 0.5}, "Murf returned an invalid remaining character count"},
		{map[string]any{"warning": nil}, "Murf returned an invalid warning"},
		{map[string]any{"wordDurations": nil}, "Murf returned no word durations"},
		{map[string]any{"wordDurations": []any{map[string]any{"word": "Hi", "startMs": 2, "endMs": 1}}}, "Murf returned an invalid word duration"},
		{map[string]any{"wordDurations": []any{map[string]any{"word": "Hi", "startMs": 0, "endMs": 0.5}}}, "Murf returned an invalid word duration"},
		{map[string]any{"encodedAudio": "!!!"}, "Murf returned invalid base64 audio"},
	} {
		value := decode(t, fixture(t)["generation"]).(map[string]any)
		for k, v := range tc.fields {
			value[k] = v
		}
		data, _ := json.Marshal(value)
		_, err := decodeGeneration(data, true, true)
		errorText(t, err, tc.want)
	}
	g, err := decodeGeneration(fixture(t)["generation"], true, true)
	equal(t, err, nil)
	equal(t, g.warning, runtime.Some(""))
	equal(t, g.remaining, float64(0))
}
