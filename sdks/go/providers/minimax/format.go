package minimax

import (
	schema "github.com/speechswitch/client/sdks/go/generated/minimax"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func audioSettings(output any, socket bool) map[string]any {
	format := "mp3"
	var rate, bitrate, channel runtime.Optional[float64]
	var cbr runtime.Optional[bool]
	switch v := output.(type) {
	case *schema.TtsRequestText77d171beOutputAsFlac:
		return audioSettings(*v, socket)
	case schema.TtsRequestText77d171beOutputAsFlac:
		return audioSettings(v.Value, socket)
	case *schema.TtsRequestText77d171beOutputAsMp3:
		return audioSettings(*v, socket)
	case schema.TtsRequestText77d171beOutputAsMp3:
		return audioSettings(v.Value, socket)
	case *schema.TtsRequestText77d171beOutputAsWav:
		return audioSettings(*v, socket)
	case schema.TtsRequestText77d171beOutputAsWav:
		return audioSettings(v.Value, socket)
	case *schema.TtsRequestTextf2dcc77eOutputAsObject:
		return audioSettings(*v, socket)
	case schema.TtsRequestTextf2dcc77eOutputAsObject:
		return audioSettings(v.Value, socket)
	case *schema.TtsRequestTextf2dcc77eOutputAsMp3:
		return audioSettings(*v, socket)
	case schema.TtsRequestTextf2dcc77eOutputAsMp3:
		return audioSettings(v.Value, socket)
	case *schema.TtsRequestTextf2dcc77eOutputAsMulaw:
		return audioSettings(*v, socket)
	case schema.TtsRequestTextf2dcc77eOutputAsMulaw:
		return audioSettings(v.Value, socket)
	case *schema.TtsRequestTextf2dcc77eOutputAsWav6dd8e06a:
		return audioSettings(*v, socket)
	case schema.TtsRequestTextf2dcc77eOutputAsWav6dd8e06a:
		return audioSettings(v.Value, socket)
	case *schema.TtsRequestTextf2dcc77eOutputAsOggOpus:
		return audioSettings(*v, socket)
	case schema.TtsRequestTextf2dcc77eOutputAsOggOpus:
		return audioSettings(v.Value, socket)
	case *schema.TtsRequestTextf2dcc77eOutputAsWava066cb88:
		return audioSettings(*v, socket)
	case schema.TtsRequestTextf2dcc77eOutputAsWava066cb88:
		return audioSettings(v.Value, socket)
	case *schema.TtsRequestStreamingTextaa771f19OutputAsObject:
		return audioSettings(*v, socket)
	case schema.TtsRequestStreamingTextaa771f19OutputAsObject:
		return audioSettings(v.Value, socket)
	case *schema.TtsRequestStreamingTextaa771f19OutputAsMulaw:
		return audioSettings(*v, socket)
	case schema.TtsRequestStreamingTextaa771f19OutputAsMulaw:
		return audioSettings(v.Value, socket)
	case *schema.TtsRequestStreamingTextaa771f19OutputAsWav:
		return audioSettings(*v, socket)
	case schema.TtsRequestStreamingTextaa771f19OutputAsWav:
		return audioSettings(v.Value, socket)
	case *schema.TtsRequestStreamingTextaa771f19OutputAsOggOpus:
		return audioSettings(*v, socket)
	case schema.TtsRequestStreamingTextaa771f19OutputAsOggOpus:
		return audioSettings(v.Value, socket)
	case *schema.TtsRequestStreamingTextaa771f19OutputAsMp3:
		return audioSettings(*v, socket)
	case schema.TtsRequestStreamingTextaa771f19OutputAsMp3:
		return audioSettings(v.Value, socket)
	case *schema.TtsRequestText77d171beOutputFlac:
		return audioSettings(*v, socket)
	case schema.TtsRequestText77d171beOutputFlac:
		format = v.Format.Value()
		if v.SampleRateHz.Present {
			rate = runtime.Some(v.SampleRateHz.Value.LiteralValue())
		}
		if v.ChannelCount.Present {
			channel = runtime.Some(v.ChannelCount.Value.LiteralValue())
		}
	case *schema.TtsRequestText77d171beOutputMp3:
		return audioSettings(*v, socket)
	case schema.TtsRequestText77d171beOutputMp3:
		format = v.Format.Value()
		if v.SampleRateHz.Present {
			rate = runtime.Some(v.SampleRateHz.Value.LiteralValue())
		}
		if v.ChannelCount.Present {
			channel = runtime.Some(v.ChannelCount.Value.LiteralValue())
		}
		if v.BitRateBps.Present {
			bitrate = runtime.Some(v.BitRateBps.Value.LiteralValue())
		}
		if v.ConstantBitRate.Present {
			cbr = runtime.Some(v.ConstantBitRate.Value.LiteralValue())
		}
	case *schema.TtsRequestText77d171beOutputWav:
		return audioSettings(*v, socket)
	case schema.TtsRequestText77d171beOutputWav:
		format = v.Format.Value()
		if v.SampleRateHz.Present {
			rate = runtime.Some(v.SampleRateHz.Value.LiteralValue())
		}
		if v.ChannelCount.Present {
			channel = runtime.Some(v.ChannelCount.Value.LiteralValue())
		}
	case *schema.TtsRequestTextf2dcc77eOutputObject:
		return audioSettings(*v, socket)
	case schema.TtsRequestTextf2dcc77eOutputObject:
		format = v.Format.LiteralValue()
		if v.SampleRateHz.Present {
			rate = runtime.Some(v.SampleRateHz.Value.LiteralValue())
		}
		if v.ChannelCount.Present {
			channel = runtime.Some(v.ChannelCount.Value.LiteralValue())
		}
	case *schema.TtsRequestTextf2dcc77eOutputMulaw:
		return audioSettings(*v, socket)
	case schema.TtsRequestTextf2dcc77eOutputMulaw:
		format = v.Format.Value()
		if v.SampleRateHz.Present {
			rate = runtime.Some(v.SampleRateHz.Value.Value())
		}
		if v.ChannelCount.Present {
			channel = runtime.Some(v.ChannelCount.Value.LiteralValue())
		}
	case *schema.TtsRequestTextf2dcc77eOutputWav6dd8e06a:
		return audioSettings(*v, socket)
	case schema.TtsRequestTextf2dcc77eOutputWav6dd8e06a:
		format = v.Format.Value()
		if v.SampleRateHz.Present {
			rate = runtime.Some(v.SampleRateHz.Value.Value())
		}
		if v.ChannelCount.Present {
			channel = runtime.Some(v.ChannelCount.Value.LiteralValue())
		}
		format = "pcmu_wav"
	case *schema.TtsRequestTextf2dcc77eOutputOggOpus:
		return audioSettings(*v, socket)
	case schema.TtsRequestTextf2dcc77eOutputOggOpus:
		format = v.Format.Value()
		if v.SampleRateHz.Present {
			rate = runtime.Some(v.SampleRateHz.Value.LiteralValue())
		}
		if v.ChannelCount.Present {
			channel = runtime.Some(v.ChannelCount.Value.LiteralValue())
		}
	case *schema.TtsRequestStreamingText12421ea0Output:
		return audioSettings(*v, socket)
	case schema.TtsRequestStreamingText12421ea0Output:
		format = v.Format.Value()
		if v.SampleRateHz.Present {
			rate = runtime.Some(v.SampleRateHz.Value.LiteralValue())
		}
		if v.ChannelCount.Present {
			channel = runtime.Some(v.ChannelCount.Value.LiteralValue())
		}
		if v.BitRateBps.Present {
			bitrate = runtime.Some(v.BitRateBps.Value.LiteralValue())
		}
	}
	switch format {
	case "ogg_opus":
		format = "opus"
	case "mulaw":
		format = "pcmu_raw"
	}
	sampleRate := float64(32000)
	if format == "pcmu_raw" || format == "pcmu_wav" {
		sampleRate = 8000
	} else if format == "opus" {
		sampleRate = 24000
	}
	if rate.Present {
		sampleRate = rate.Value
	}
	channels := float64(1)
	if channel.Present {
		channels = channel.Value
	}
	result := map[string]any{"format": format, "sample_rate": sampleRate, "channel": channels}
	if format == "mp3" {
		bitRate := float64(128000)
		if bitrate.Present {
			bitRate = bitrate.Value
		}
		result["bitrate"] = bitRate
		if !socket {
			constant := false
			if cbr.Present {
				constant = cbr.Value
			}
			result["force_cbr"] = constant
		}
	}
	return result
}
