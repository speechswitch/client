package gradium

import (
	"strconv"
	"strings"

	schema "github.com/speechswitch/client/sdks/go/generated/gradium"
	"github.com/speechswitch/client/sdks/go/runtime"
)

// Generated validation precedes these wire representation conversions.
func settings(r schema.TtsRequest) (map[string]any, string, runtime.Input[Input]) {
	model := "default"
	if r.Model.Present {
		model = r.Model.Value.LiteralValue()
	}
	config := map[string]any{"temp": 0.7, "cfg_coef": float64(2), "padding_bonus": float64(0)}
	if r.Temperature.Present {
		config["temp"] = r.Temperature.Value
	}
	if r.VoiceGuidance.Present {
		config["cfg_coef"] = r.VoiceGuidance.Value
	}
	if r.PacingBias.Present {
		config["padding_bonus"] = r.PacingBias.Value
	}
	if r.TextNormalization.Present {
		normalization := r.TextNormalization.Value
		switch v := normalization.(type) {
		case *schema.TtsRequestTextNormalizationAsFalse:
			normalization = *v
		case *schema.TtsRequestTextNormalizationAsObjecte21202a8:
			normalization = *v
		case *schema.TtsRequestTextNormalizationAsObject81d1078f:
			normalization = *v
		}
		switch v := normalization.(type) {
		case schema.TtsRequestTextNormalizationAsFalse:
			config["rewrite_rules"] = "none"
		case schema.TtsRequestTextNormalizationAsObjecte21202a8:
			config["rewrite_rules"] = v.Value.Locale.LiteralValue()
		case schema.TtsRequestTextNormalizationAsObject81d1078f:
			rules := make([]string, len(v.Value.Rules))
			for i, rule := range v.Value.Rules {
				rules[i] = rule.LiteralValue()
			}
			config["rewrite_rules"] = strings.Join(rules, ",")
		}
	}
	output := r.Output
	switch v := output.(type) {
	case *schema.TtsRequestOutputAsPcm:
		output = *v
	case *schema.TtsRequestOutputAsOggOpus:
		output = *v
	case *schema.TtsRequestOutputAsObject:
		output = *v
	case *schema.TtsRequestOutputAsWav:
		output = *v
	}
	var format string
	switch v := output.(type) {
	case schema.TtsRequestOutputAsPcm:
		rate := float64(48000)
		if v.Value.SampleRateHz.Present {
			rate = v.Value.SampleRateHz.Value.LiteralValue()
		}
		format = "pcm_" + strconv.FormatFloat(rate, 'f', 0, 64)
	case schema.TtsRequestOutputAsOggOpus:
		format = "opus"
	case schema.TtsRequestOutputAsObject:
		if v.Value.Format.LiteralValue() == "mulaw" {
			format = "ulaw_8000"
		} else {
			format = "alaw_8000"
		}
	case schema.TtsRequestOutputAsWav:
		format = "wav"
	}
	text := r.Text
	switch v := text.(type) {
	case *schema.TtsRequestTextAsString:
		text = *v
	case *schema.TtsRequestTextAsAsyncIterable:
		text = *v
	}
	var complete string
	var input runtime.Input[Input]
	switch v := text.(type) {
	case schema.TtsRequestTextAsString:
		complete = v.Value
	case schema.TtsRequestTextAsAsyncIterable:
		input = v.Value
	}
	return map[string]any{"model_name": model, "voice_id": r.Voice, "output_format": format, "json_config": config}, complete, input
}
