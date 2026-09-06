package deepdub

import (
	"encoding/base64"
	"errors"
	schema "github.com/speechswitch/client/sdks/go/generated/deepdub"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type configuration struct {
	model, text, language                        string
	output                                       schema.TtsRequestOg11Text188d3251Output
	voice, delivery                              runtime.Optional[string]
	reference                                    runtime.Optional[[]byte]
	speed, duration, seed, variance, temperature runtime.Optional[float64]
	boost, stretch, enhancement, gain            runtime.Optional[schema.TtsRequestOg11Text188d3251AudioEnhancement]
	priority                                     runtime.Optional[schema.TtsRequestOg11Text188d3251ProcessingPriority]
	gender                                       runtime.Optional[schema.TtsRequestOg11Text188d3251SpeakerGender]
	accent                                       runtime.Optional[schema.TtsRequestOg11Text188d3251AccentBlend]
}

// These cases convert the generated representations after generated validation.
func settings(request schema.TtsRequest) (configuration, error) {
	var c configuration
	switch request := request.(type) {
	case *schema.TtsRequestAsOg11Text188d3251:
		return settings(*request)
	case *schema.TtsRequestAsOg11Text63cdfcb0:
		return settings(*request)
	case *schema.TtsRequestAsOg11TextVoiceafafd490:
		return settings(*request)
	case *schema.TtsRequestAsOg11TextVoice7f540c02:
		return settings(*request)
	case *schema.TtsRequestAsTextee721c85:
		return settings(*request)
	case *schema.TtsRequestAsText8086f935:
		return settings(*request)
	case *schema.TtsRequestAsTextVoice5ce3f477:
		return settings(*request)
	case *schema.TtsRequestAsTextVoiceb776b412:
		return settings(*request)
	case schema.TtsRequestAsOg11Text188d3251:
		v := request.Value
		c = configuration{model: v.Model.Value(), text: v.Text, language: v.Language, output: v.Output, voice: v.Voice, reference: runtime.Some(v.ReferenceAudio), duration: runtime.Some(v.TargetDurationMs), seed: runtime.Some(v.RandomSeed), delivery: v.DeliveryReference, variance: v.DeliveryVariance, temperature: v.Temperature, boost: v.VoiceBoost, stretch: v.DurationStretching, enhancement: v.AudioEnhancement, gain: v.AutomaticGainControl, priority: v.ProcessingPriority, gender: v.SpeakerGender, accent: v.AccentBlend}
	case schema.TtsRequestAsOg11Text63cdfcb0:
		v := request.Value
		c = configuration{model: v.Model.Value(), text: v.Text, language: v.Language, output: v.Output, voice: v.Voice, reference: runtime.Some(v.ReferenceAudio), speed: v.Speed, seed: runtime.Some(v.RandomSeed), delivery: v.DeliveryReference, variance: v.DeliveryVariance, temperature: v.Temperature, boost: v.VoiceBoost, stretch: v.DurationStretching, enhancement: v.AudioEnhancement, gain: v.AutomaticGainControl, priority: v.ProcessingPriority, gender: v.SpeakerGender, accent: v.AccentBlend}
	case schema.TtsRequestAsOg11TextVoiceafafd490:
		v := request.Value
		c = configuration{model: v.Model.Value(), text: v.Text, language: v.Language, output: v.Output, voice: runtime.Some(v.Voice), reference: v.ReferenceAudio, duration: runtime.Some(v.TargetDurationMs), seed: runtime.Some(v.RandomSeed), delivery: v.DeliveryReference, variance: v.DeliveryVariance, temperature: v.Temperature, boost: v.VoiceBoost, stretch: v.DurationStretching, enhancement: v.AudioEnhancement, gain: v.AutomaticGainControl, priority: v.ProcessingPriority, gender: v.SpeakerGender, accent: v.AccentBlend}
	case schema.TtsRequestAsOg11TextVoice7f540c02:
		v := request.Value
		c = configuration{model: v.Model.Value(), text: v.Text, language: v.Language, output: v.Output, voice: runtime.Some(v.Voice), reference: v.ReferenceAudio, speed: v.Speed, seed: runtime.Some(v.RandomSeed), delivery: v.DeliveryReference, variance: v.DeliveryVariance, temperature: v.Temperature, boost: v.VoiceBoost, stretch: v.DurationStretching, enhancement: v.AudioEnhancement, gain: v.AutomaticGainControl, priority: v.ProcessingPriority, gender: v.SpeakerGender, accent: v.AccentBlend}
	case schema.TtsRequestAsTextee721c85:
		v := request.Value
		c = configuration{model: v.Model.LiteralValue(), text: v.Text, language: v.Language, output: v.Output, voice: v.Voice, reference: runtime.Some(v.ReferenceAudio), duration: runtime.Some(v.TargetDurationMs), delivery: v.DeliveryReference, variance: v.DeliveryVariance, temperature: v.Temperature, boost: v.VoiceBoost, stretch: v.DurationStretching, enhancement: v.AudioEnhancement, gain: v.AutomaticGainControl, priority: v.ProcessingPriority, gender: v.SpeakerGender, accent: v.AccentBlend}
	case schema.TtsRequestAsText8086f935:
		v := request.Value
		c = configuration{model: v.Model.LiteralValue(), text: v.Text, language: v.Language, output: v.Output, voice: v.Voice, reference: runtime.Some(v.ReferenceAudio), speed: v.Speed, delivery: v.DeliveryReference, variance: v.DeliveryVariance, temperature: v.Temperature, boost: v.VoiceBoost, stretch: v.DurationStretching, enhancement: v.AudioEnhancement, gain: v.AutomaticGainControl, priority: v.ProcessingPriority, gender: v.SpeakerGender, accent: v.AccentBlend}
	case schema.TtsRequestAsTextVoice5ce3f477:
		v := request.Value
		c = configuration{model: v.Model.LiteralValue(), text: v.Text, language: v.Language, output: v.Output, voice: runtime.Some(v.Voice), reference: v.ReferenceAudio, duration: runtime.Some(v.TargetDurationMs), delivery: v.DeliveryReference, variance: v.DeliveryVariance, temperature: v.Temperature, boost: v.VoiceBoost, stretch: v.DurationStretching, enhancement: v.AudioEnhancement, gain: v.AutomaticGainControl, priority: v.ProcessingPriority, gender: v.SpeakerGender, accent: v.AccentBlend}
	case schema.TtsRequestAsTextVoiceb776b412:
		v := request.Value
		c = configuration{model: v.Model.LiteralValue(), text: v.Text, language: v.Language, output: v.Output, voice: runtime.Some(v.Voice), reference: v.ReferenceAudio, speed: v.Speed, delivery: v.DeliveryReference, variance: v.DeliveryVariance, temperature: v.Temperature, boost: v.VoiceBoost, stretch: v.DurationStretching, enhancement: v.AudioEnhancement, gain: v.AutomaticGainControl, priority: v.ProcessingPriority, gender: v.SpeakerGender, accent: v.AccentBlend}
	default:
		return c, errors.New("Unsupported generated Deepdub request representation")
	}
	return c, nil
}

func payload(c configuration, id string) map[string]any {
	format := c.output.Format.LiteralValue()
	if format == "ogg_opus" {
		format = "opus"
	}
	rate := float64(48000)
	if format == "mulaw" {
		rate = 8000
	}
	if c.output.SampleRateHz.Present {
		rate = c.output.SampleRateHz.Value.LiteralValue()
	}
	wire := map[string]any{
		"generationId": id, "model": map[string]string{"og-1.1": "dd-etts-1.1", "lightning-2.5": "dd-etts-2.5", "phantom-x-3.2": "dd-etts-3.2"}[c.model],
		"targetText": c.text, "locale": c.language, "format": format, "sampleRate": rate,
		"cleanAudio": false, "autoGain": true,
	}
	if c.voice.Present {
		wire["voicePromptId"] = c.voice.Value
	}
	if c.reference.Present {
		wire["voiceReference"] = base64.StdEncoding.EncodeToString(c.reference.Value)
	}
	if c.delivery.Present {
		wire["performanceReferencePromptId"] = c.delivery.Value
	}
	for name, value := range map[string]runtime.Optional[float64]{"tempo": c.speed, "seed": c.seed, "variance": c.variance, "temperature": c.temperature} {
		if value.Present {
			wire[name] = value.Value
		}
	}
	if c.duration.Present {
		wire["targetDuration"] = c.duration.Value / 1000
	}
	for name, value := range map[string]runtime.Optional[schema.TtsRequestOg11Text188d3251AudioEnhancement]{"promptBoost": c.boost, "superStretch": c.stretch, "cleanAudio": c.enhancement, "autoGain": c.gain} {
		if value.Present {
			wire[name] = value.Value.LiteralValue()
		}
	}
	if c.priority.Present {
		wire["realtime"] = c.priority.Value.LiteralValue() == "realtime"
	}
	if c.gender.Present {
		wire["targetGender"] = c.gender.Value.LiteralValue()
	}
	if c.accent.Present {
		v := c.accent.Value
		wire["accentControl"] = map[string]any{"accentBaseLocale": v.BaseLocale, "accentLocale": v.TargetLocale, "accentRatio": v.Ratio}
	}
	return wire
}
