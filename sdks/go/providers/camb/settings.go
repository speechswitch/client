package camb

import (
	"context"
	"errors"
	"io"
	"strconv"
	"strings"

	wire "github.com/speechswitch/client/sdks/go/clients/camb"
	schema "github.com/speechswitch/client/sdks/go/generated/camb"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type prepared struct {
	http       wire.HttpInput
	start      wire.SessionStart
	input      runtime.Input[string]
	timed      bool
	checkInput bool
}

type common struct {
	voice, language, model, format     string
	sampleRate, speed, delay, steps    runtime.Optional[float64]
	audio, reference, accent, entities runtime.Optional[schema.TtsRequestMars81FlashBetaStreamingTextVoiceAccentPreservation]
}

func settings(request schema.TtsRequest) (prepared, error) {
	var result prepared
	var value common
	switch request := request.(type) {
	case *schema.TtsRequestAsTextVoice:
		return settings(*request)
	case *schema.TtsRequestAsMars81FlashBetaTextVoice:
		return settings(*request)
	case *schema.TtsRequestAsMars81FlashBetaStreamingTextVoice:
		return settings(*request)
	case schema.TtsRequestAsTextVoice:
		item := request.Value
		format, sampleRate, err := staticOutput(item.Output)
		if err != nil {
			return result, err
		}
		value = common{voice: item.Voice, language: item.Language.LiteralValue(), model: item.Model.LiteralValue(), format: format,
			sampleRate: sampleRate, speed: item.Speed, audio: item.AudioEnhancement, reference: item.ReferenceAudioEnhancement,
			accent: item.AccentPreservation, entities: item.NamedEntityPronunciationEnhancement}
		result.http.Text = item.Text
	case schema.TtsRequestAsMars81FlashBetaTextVoice:
		item := request.Value
		value = common{voice: item.Voice, language: item.Language.LiteralValue(), model: item.Model.Value(), format: item.Output.Format.LiteralValue(),
			sampleRate: item.Output.SampleRateHz, speed: item.Speed, audio: item.AudioEnhancement, reference: item.ReferenceAudioEnhancement,
			accent: item.AccentPreservation, entities: item.NamedEntityPronunciationEnhancement, delay: item.TextFlushDelayMs, steps: item.InferenceSteps}
		result.input = &wholeInput{text: item.Text}
		result.timed = true
	case schema.TtsRequestAsMars81FlashBetaStreamingTextVoice:
		item := request.Value
		value = common{voice: item.Voice, language: item.Language.LiteralValue(), model: item.Model.Value(), format: item.Output.Format.LiteralValue(),
			sampleRate: item.Output.SampleRateHz, speed: item.Speed, audio: item.AudioEnhancement, reference: item.ReferenceAudioEnhancement,
			accent: item.AccentPreservation, entities: item.NamedEntityPronunciationEnhancement, delay: item.TextFlushDelayMs, steps: item.InferenceSteps}
		result.input = item.Text
		result.timed = item.TimestampGranularity.Present
		result.checkInput = true
	default:
		return result, errors.New("Unsupported generated CAMB request representation")
	}
	decimal := strings.TrimLeft(value.voice, "0")
	voice, err := strconv.ParseUint(decimal, 10, 64)
	if err != nil || voice == 0 || voice > 9007199254740991 {
		return result, errors.New("CAMB voice must be a positive integer ID")
	}
	output := wire.HttpInputOutputConfiguration{Format: runtime.Some(value.format)}
	voiceSettings := wire.HttpInputVoiceSettings{}
	result.start = wire.SessionStart{Type: "session.start", VoiceId: float64(voice), Language: runtime.Some(value.language), OutputFormat: runtime.Some(value.format),
		WordTimestamps: runtime.Some(result.timed), IdleTimeout: runtime.Some(1.0), EnhanceNamedEntitiesPronunciation: runtime.Some(false),
		EnhanceReferenceAudioQuality: runtime.Some(false), MaintainSourceAccent: runtime.Some(false)}
	if value.delay.Present {
		result.start.IdleTimeout = runtime.Some(value.delay.Value / 1000)
	}
	if value.sampleRate.Present {
		output.SampleRate = runtime.Some(&value.sampleRate.Value)
		result.start.SampleRate = output.SampleRate
	}
	if value.speed.Present {
		voiceSettings.SpeakingRate = runtime.Some(&value.speed.Value)
		result.start.SpeakingRate = voiceSettings.SpeakingRate
	}
	if value.steps.Present {
		result.start.InferenceSteps = runtime.Some(&value.steps.Value)
	}
	if value.audio.Present {
		enabled := value.audio.Value.LiteralValue()
		output.ApplyEnhancement = runtime.Some(&enabled)
		result.start.ApplyEnhancement = output.ApplyEnhancement
	}
	if value.reference.Present {
		enabled := value.reference.Value.LiteralValue()
		voiceSettings.EnhanceReferenceAudioQuality = runtime.Some(&enabled)
		result.start.EnhanceReferenceAudioQuality = runtime.Some(enabled)
	}
	if value.accent.Present {
		enabled := value.accent.Value.LiteralValue()
		voiceSettings.MaintainSourceAccent = runtime.Some(&enabled)
		result.start.MaintainSourceAccent = runtime.Some(enabled)
	}
	if value.entities.Present {
		enabled := value.entities.Value.LiteralValue()
		result.http.EnhanceNamedEntitiesPronunciation = runtime.Some(enabled)
		result.start.EnhanceNamedEntitiesPronunciation = runtime.Some(enabled)
	}
	if value.format == "aac" {
		output.Format = runtime.Some("adts")
	}
	result.http.VoiceId, result.http.Language = float64(voice), value.language
	result.http.SpeechModel = runtime.Some(map[string]string{"mars8-flash": "mars-flash", "mars8-instruct": "mars-instruct", "mars8-pro": "mars-pro", "mars8.1-flash-beta": "mars-8.1-flash-beta", "mars8.1-pro-beta": "mars-8.1-pro-beta"}[value.model])
	result.http.OutputConfiguration = runtime.Some(output)
	result.http.VoiceSettings = runtime.Some(voiceSettings)
	return result, nil
}

func staticOutput(output schema.TtsRequestTextVoiceOutput) (string, runtime.Optional[float64], error) {
	switch output := output.(type) {
	case *schema.TtsRequestTextVoiceOutputAsObject:
		return staticOutput(*output)
	case *schema.TtsRequestTextVoiceOutputAsPcm:
		return staticOutput(*output)
	case schema.TtsRequestTextVoiceOutputAsObject:
		return output.Value.Format.LiteralValue(), output.Value.SampleRateHz, nil
	case schema.TtsRequestTextVoiceOutputAsPcm:
		value := output.Value
		prefix := map[string]string{"signed_integer_16": "s16", "signed_integer_32": "s32", "float_32": "f32"}[value.SampleEncoding.LiteralValue()]
		order := map[string]string{"little_endian": "le", "big_endian": "be"}[value.ByteOrder.LiteralValue()]
		return "pcm_" + prefix + order, value.SampleRateHz, nil
	default:
		return "", runtime.Optional[float64]{}, errors.New("Unsupported generated CAMB output representation")
	}
}

// Whole text has already passed its request validator; no external producer is read.
type wholeInput struct {
	text string
	done bool
}

func (s *wholeInput) Next(ctx context.Context) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if s.done {
		return "", io.EOF
	}
	s.done = true
	return s.text, nil
}
func (*wholeInput) Close() error { return nil }
