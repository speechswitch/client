package murf

import (
	schema "github.com/speechswitch/client/sdks/go/generated/murf"
	"github.com/speechswitch/client/sdks/go/runtime"
	"strings"
)

type Input = schema.TtsRequestStreamingTextVoiceTextItem

type configuration struct {
	wire, voice            map[string]any
	input                  runtime.Input[Input]
	gen2, timed, inline    bool
	format, channel        string
	rate, threshold, delay float64
}

// The generated validator has checked every variant before wire conversion.
func settings(request schema.TtsRequest) configuration {
	c := configuration{wire: map[string]any{}, voice: map[string]any{}, format: "PCM", channel: "MONO", rate: 24000, threshold: 40, delay: 300}
	var voice, text string
	var language, style runtime.Optional[string]
	var speed, pitch, duration runtime.Optional[float64]
	var output runtime.Optional[schema.TtsRequestStreamingTextVoiceOutput]
	var genOutput runtime.Optional[schema.TtsRequestGen2TextVoiceca621e19Output]
	var variance runtime.Optional[schema.TtsRequestGen2TextVoiceca621e19DeliveryVariance]
	var retention runtime.Optional[schema.TtsRequestGen2TextVoiceca621e19AudioRetention]
	original := false
	switch r := request.(type) {
	case *schema.TtsRequestAsTextVoice:
		return settings(*r)
	case *schema.TtsRequestAsStreamingTextVoice:
		return settings(*r)
	case *schema.TtsRequestAsGen2TextVoiceca621e19:
		return settings(*r)
	case *schema.TtsRequestAsGen2TextVoice13ad89db:
		return settings(*r)
	case schema.TtsRequestAsTextVoice:
		v := r.Value
		voice, text, language, style, speed, pitch, output = v.Voice, v.Text, v.Language, v.VoiceStyle, v.SpeedBias, v.PitchBias, v.Output
	case schema.TtsRequestAsStreamingTextVoice:
		v := r.Value
		voice, c.input, language, style, speed, pitch, output = v.Voice, v.Text, v.Language, v.VoiceStyle, v.SpeedBias, v.PitchBias, v.Output
		if v.TextBufferThreshold.Present {
			c.threshold = v.TextBufferThreshold.Value
		}
		if v.MaxBufferDelayMs.Present {
			c.delay = v.MaxBufferDelayMs.Value
		}
	case schema.TtsRequestAsGen2TextVoiceca621e19:
		v := r.Value
		c.gen2, c.timed = true, v.TimestampGranularity.Present
		voice, text, language, style, speed, pitch = v.Voice, v.Text, v.Language, v.VoiceStyle, v.SpeedBias, v.PitchBias
		genOutput, variance, retention, duration = v.Output, v.DeliveryVariance, v.AudioRetention, v.TargetDurationMs
	case schema.TtsRequestAsGen2TextVoice13ad89db:
		v := r.Value
		c.gen2, c.timed, original = true, true, true
		voice, text, language, style, speed, pitch = v.Voice, v.Text, runtime.Some(v.Language), v.VoiceStyle, v.SpeedBias, v.PitchBias
		genOutput, variance, retention, duration = v.Output, v.DeliveryVariance, v.AudioRetention, v.TargetDurationMs
	}
	if c.gen2 {
		c.rate = 44100
	}
	if output.Present {
		v := output.Value
		c.format = strings.ToUpper(v.Format.LiteralValue())
		if v.SampleRateHz.Present {
			c.rate = v.SampleRateHz.Value.LiteralValue()
		}
		if v.ChannelCount.Present && v.ChannelCount.Value.LiteralValue() == 2 {
			c.channel = "STEREO"
		}
	}
	if genOutput.Present {
		v := genOutput.Value
		c.format = strings.ToUpper(v.Format.LiteralValue())
		if v.SampleRateHz.Present {
			c.rate = v.SampleRateHz.Value.LiteralValue()
		}
		if v.ChannelCount.Present && v.ChannelCount.Value.LiteralValue() == 2 {
			c.channel = "STEREO"
		}
	}
	if c.format == "MULAW" {
		c.format = "ULAW"
	}
	c.wire = map[string]any{"text": text, "voiceId": voice, "rate": float64(0), "pitch": float64(0), "format": c.format, "sampleRate": c.rate, "channelType": c.channel}
	c.voice = map[string]any{"voice_id": voice, "rate": float64(0), "pitch": float64(0)}
	if speed.Present {
		c.wire["rate"], c.voice["rate"] = speed.Value, speed.Value
	}
	if pitch.Present {
		c.wire["pitch"], c.voice["pitch"] = pitch.Value, pitch.Value
	}
	if language.Present {
		c.wire["locale"], c.voice["locale"] = language.Value, language.Value
	}
	if style.Present {
		c.wire["style"], c.voice["style"] = style.Value, style.Value
	}
	if c.gen2 {
		c.inline = retention.Present && !retention.Value.LiteralValue()
		variation := float64(1)
		if variance.Present {
			variation = variance.Value.LiteralValue() * 5
		}
		c.wire["modelVersion"], c.wire["variation"], c.wire["encodeAsBase64"], c.wire["wordDurationsAsOriginalText"] = "GEN2", variation, c.inline, original
		if duration.Present {
			c.wire["audioDuration"] = duration.Value / 1000
		}
	} else {
		c.wire["model"] = "falcon-2"
	}
	return c
}

func command(item Input) (string, string, map[string]any, map[string]any) {
	switch v := item.(type) {
	case *schema.TtsRequestStreamingTextVoiceTextItemAsString:
		return command(*v)
	case *schema.TtsRequestStreamingTextVoiceTextItemAsClear:
		return command(*v)
	case *schema.TtsRequestStreamingTextVoiceTextItemAsFlush:
		return command(*v)
	case *schema.TtsRequestStreamingTextVoiceTextItemAsUpdate:
		return command(*v)
	case schema.TtsRequestStreamingTextVoiceTextItemAsString:
		return "text", v.Value, nil, nil
	case schema.TtsRequestStreamingTextVoiceTextItemAsClear:
		return "clear", "", nil, nil
	case schema.TtsRequestStreamingTextVoiceTextItemAsFlush:
		return "flush", "", nil, nil
	case schema.TtsRequestStreamingTextVoiceTextItemAsUpdate:
		u := v.Value
		voice, buffering := map[string]any{}, map[string]any{}
		if u.Voice.Present {
			voice["voice_id"] = u.Voice.Value
		}
		if u.VoiceStyle.Present {
			voice["style"] = u.VoiceStyle.Value
		}
		if u.Language.Present {
			voice["locale"] = u.Language.Value
		}
		if u.SpeedBias.Present {
			voice["rate"] = u.SpeedBias.Value
		}
		if u.PitchBias.Present {
			voice["pitch"] = u.PitchBias.Value
		}
		if u.TextBufferThreshold.Present {
			buffering["min_buffer_size"] = u.TextBufferThreshold.Value
		}
		if u.MaxBufferDelayMs.Present {
			buffering["max_buffer_delay_in_ms"] = u.MaxBufferDelayMs.Value
		}
		return "update", "", voice, buffering
	}
	panic("validated Murf input has no representation")
}
