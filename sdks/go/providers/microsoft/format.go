package microsoft

import (
	schema "github.com/speechswitch/client/sdks/go/generated/microsoft"
	"strconv"
)

func audioFormat(output any) (string, bool) {
	switch v := output.(type) {
	case nil:
		return "raw-24khz-16bit-mono-pcm", false
	case schema.TtsRequestDragonHdFlashTextVoiceOutputAsAmrWb:
		return audioFormat(v.Value)
	case *schema.TtsRequestDragonHdFlashTextVoiceOutputAsAmrWb:
		return audioFormat(v.Value)
	case schema.TtsRequestDragonHdFlashTextVoiceOutputAsG722:
		return audioFormat(v.Value)
	case *schema.TtsRequestDragonHdFlashTextVoiceOutputAsG722:
		return audioFormat(v.Value)
	case schema.TtsRequestDragonHdFlashTextVoiceOutputAsMp3c7ff7390:
		return audioFormat(v.Value)
	case *schema.TtsRequestDragonHdFlashTextVoiceOutputAsMp3c7ff7390:
		return audioFormat(v.Value)
	case schema.TtsRequestDragonHdFlashTextVoiceOutputAsMp3cfa54ac8:
		return audioFormat(v.Value)
	case *schema.TtsRequestDragonHdFlashTextVoiceOutputAsMp3cfa54ac8:
		return audioFormat(v.Value)
	case schema.TtsRequestDragonHdFlashTextVoiceOutputAsMp332730738:
		return audioFormat(v.Value)
	case *schema.TtsRequestDragonHdFlashTextVoiceOutputAsMp332730738:
		return audioFormat(v.Value)
	case schema.TtsRequestDragonHdFlashTextVoiceOutputAsOggOpus:
		return audioFormat(v.Value)
	case *schema.TtsRequestDragonHdFlashTextVoiceOutputAsOggOpus:
		return audioFormat(v.Value)
	case schema.TtsRequestDragonHdFlashTextVoiceOutputAsPcm:
		return audioFormat(v.Value)
	case *schema.TtsRequestDragonHdFlashTextVoiceOutputAsPcm:
		return audioFormat(v.Value)
	case schema.TtsRequestDragonHdFlashTextVoiceOutputAsOpusacd6a00c:
		return audioFormat(v.Value)
	case *schema.TtsRequestDragonHdFlashTextVoiceOutputAsOpusacd6a00c:
		return audioFormat(v.Value)
	case schema.TtsRequestDragonHdFlashTextVoiceOutputAsOpus0a945e79:
		return audioFormat(v.Value)
	case *schema.TtsRequestDragonHdFlashTextVoiceOutputAsOpus0a945e79:
		return audioFormat(v.Value)
	case schema.TtsRequestDragonHdFlashTextVoiceOutputAsObject:
		return audioFormat(v.Value)
	case *schema.TtsRequestDragonHdFlashTextVoiceOutputAsObject:
		return audioFormat(v.Value)
	case schema.TtsRequestDragonHdFlashTextVoiceOutputAsTruesilk:
		return audioFormat(v.Value)
	case *schema.TtsRequestDragonHdFlashTextVoiceOutputAsTruesilk:
		return audioFormat(v.Value)
	case schema.TtsRequestDragonHdFlashTextVoiceOutputAsWavbcb4c8a6:
		return audioFormat(v.Value)
	case *schema.TtsRequestDragonHdFlashTextVoiceOutputAsWavbcb4c8a6:
		return audioFormat(v.Value)
	case schema.TtsRequestDragonHdFlashTextVoiceOutputAsWav7dc10d1f:
		return audioFormat(v.Value)
	case *schema.TtsRequestDragonHdFlashTextVoiceOutputAsWav7dc10d1f:
		return audioFormat(v.Value)
	case schema.TtsRequestDragonHdFlashTextVoiceOutputAsWebmOpus00bc3439:
		return audioFormat(v.Value)
	case *schema.TtsRequestDragonHdFlashTextVoiceOutputAsWebmOpus00bc3439:
		return audioFormat(v.Value)
	case schema.TtsRequestDragonHdFlashTextVoiceOutputAsWebmOpus036ccd81:
		return audioFormat(v.Value)
	case *schema.TtsRequestDragonHdFlashTextVoiceOutputAsWebmOpus036ccd81:
		return audioFormat(v.Value)
	case schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsAmrWb:
		return audioFormat(v.Value)
	case *schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsAmrWb:
		return audioFormat(v.Value)
	case schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsG722:
		return audioFormat(v.Value)
	case *schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsG722:
		return audioFormat(v.Value)
	case schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsMp3c7ff7390:
		return audioFormat(v.Value)
	case *schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsMp3c7ff7390:
		return audioFormat(v.Value)
	case schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsMp3cfa54ac8:
		return audioFormat(v.Value)
	case *schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsMp3cfa54ac8:
		return audioFormat(v.Value)
	case schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsMp332730738:
		return audioFormat(v.Value)
	case *schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsMp332730738:
		return audioFormat(v.Value)
	case schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsOggOpus:
		return audioFormat(v.Value)
	case *schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsOggOpus:
		return audioFormat(v.Value)
	case schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsPcm:
		return audioFormat(v.Value)
	case *schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsPcm:
		return audioFormat(v.Value)
	case schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsOpusacd6a00c:
		return audioFormat(v.Value)
	case *schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsOpusacd6a00c:
		return audioFormat(v.Value)
	case schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsOpus0a945e79:
		return audioFormat(v.Value)
	case *schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsOpus0a945e79:
		return audioFormat(v.Value)
	case schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsObject:
		return audioFormat(v.Value)
	case *schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsObject:
		return audioFormat(v.Value)
	case schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsTruesilk:
		return audioFormat(v.Value)
	case *schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsTruesilk:
		return audioFormat(v.Value)
	case schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsWebmOpus00bc3439:
		return audioFormat(v.Value)
	case *schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsWebmOpus00bc3439:
		return audioFormat(v.Value)
	case schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsWebmOpus036ccd81:
		return audioFormat(v.Value)
	case *schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsWebmOpus036ccd81:
		return audioFormat(v.Value)
	case schema.TtsRequestDragonHdFlashTextVoiceOutputAmrWb:
		return "amr-wb-16000hz", false
	case schema.TtsRequestDragonHdFlashTextVoiceOutputG722:
		return "g722-16khz-64kbps", false
	case schema.TtsRequestDragonHdFlashTextVoiceOutputMp3c7ff7390:
		return "audio-16khz-" + strconv.Itoa(int(v.BitRateBps.LiteralValue())/1000) + "kbitrate-mono-mp3", false
	case schema.TtsRequestDragonHdFlashTextVoiceOutputMp3cfa54ac8:
		return "audio-24khz-" + strconv.Itoa(int(v.BitRateBps.LiteralValue())/1000) + "kbitrate-mono-mp3", false
	case schema.TtsRequestDragonHdFlashTextVoiceOutputMp332730738:
		return "audio-48khz-" + strconv.Itoa(int(v.BitRateBps.LiteralValue())/1000) + "kbitrate-mono-mp3", false
	case schema.TtsRequestDragonHdFlashTextVoiceOutputOggOpus:
		return "ogg-" + strconv.Itoa(int(v.SampleRateHz.LiteralValue())/1000) + "khz-16bit-mono-opus", false
	case schema.TtsRequestDragonHdFlashTextVoiceOutputPcm:
		return "raw-" + sampleRate(v.SampleRateHz.LiteralValue()) + "-16bit-mono-pcm", false
	case schema.TtsRequestDragonHdFlashTextVoiceOutputOpusacd6a00c:
		return "audio-16khz-16bit-32kbps-mono-opus", false
	case schema.TtsRequestDragonHdFlashTextVoiceOutputOpus0a945e79:
		return "audio-24khz-16bit-" + strconv.Itoa(int(v.BitRateBps.LiteralValue())/1000) + "kbps-mono-opus", false
	case schema.TtsRequestDragonHdFlashTextVoiceOutputObject:
		return "raw-8khz-8bit-mono-" + v.Format.LiteralValue(), false
	case schema.TtsRequestDragonHdFlashTextVoiceOutputTruesilk:
		return "raw-" + strconv.Itoa(int(v.SampleRateHz.LiteralValue())/1000) + "khz-16bit-mono-truesilk", false
	case schema.TtsRequestDragonHdFlashTextVoiceOutputWavbcb4c8a6:
		return "riff-" + sampleRate(v.SampleRateHz.LiteralValue()) + "-16bit-mono-pcm", true
	case schema.TtsRequestDragonHdFlashTextVoiceOutputWav7dc10d1f:
		return "riff-8khz-8bit-mono-" + v.SampleEncoding.LiteralValue(), true
	case schema.TtsRequestDragonHdFlashTextVoiceOutputWebmOpus00bc3439:
		return "webm-16khz-16bit-mono-opus", false
	case schema.TtsRequestDragonHdFlashTextVoiceOutputWebmOpus036ccd81:
		rate := ""
		if v.BitRateBps.Present {
			rate = "24kbps-"
		}
		return "webm-24khz-16bit-" + rate + "mono-opus", false
	default:
		panic("Microsoft output conversion is missing a validated schema variant")
	}
}
func sampleRate(rate float64) string {
	if rate == 22050 || rate == 44100 {
		return strconv.Itoa(int(rate)) + "hz"
	}
	return strconv.Itoa(int(rate)/1000) + "khz"
}
