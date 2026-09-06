package elevenlabs

import (
	schema "github.com/speechswitch/client/sdks/go/generated/elevenlabs"
	"github.com/speechswitch/client/sdks/go/runtime"
	"testing"
)

func TestAllGeneratedRequestRepresentations(t *testing.T) {
	input, v3input := newSource(text("")), newSource(dialogueText(""))
	cases := []struct {
		request                 schema.TtsRequest
		live, timed, unbuffered bool
		model, normalization    string
	}{
		{schema.TtsRequestAsTextVoice4a0120ae{Value: schema.TtsRequestTextVoice4a0120ae{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice4a0120aeOutputAsMp356cad1fb{}, Model: schema.TtsRequestTextVoice4a0120aeModelAsFlashV25{}}}, false, false, false, "flash-v2.5", "auto"},
		{&schema.TtsRequestAsTextVoice4a0120ae{Value: schema.TtsRequestTextVoice4a0120ae{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice4a0120aeOutputAsMp356cad1fb{}, Model: schema.TtsRequestTextVoice4a0120aeModelAsFlashV25{}}}, false, false, false, "flash-v2.5", "auto"},
		{schema.TtsRequestAsTextVoice68b36b42{Value: schema.TtsRequestTextVoice68b36b42{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice4a0120aeOutputAsMp356cad1fb{}, Model: schema.TtsRequestTextVoice4a0120aeModelAsFlashV25{}}}, false, false, false, "flash-v2.5", "off"},
		{&schema.TtsRequestAsTextVoice68b36b42{Value: schema.TtsRequestTextVoice68b36b42{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice4a0120aeOutputAsMp356cad1fb{}, Model: schema.TtsRequestTextVoice4a0120aeModelAsFlashV25{}}}, false, false, false, "flash-v2.5", "off"},
		{schema.TtsRequestAsTextVoice9cb211ad{Value: schema.TtsRequestTextVoice9cb211ad{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice4a0120aeOutputAsMp356cad1fb{}, Model: schema.TtsRequestTextVoice4a0120aeModelAsFlashV25{}}}, false, true, false, "flash-v2.5", "off"},
		{&schema.TtsRequestAsTextVoice9cb211ad{Value: schema.TtsRequestTextVoice9cb211ad{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice4a0120aeOutputAsMp356cad1fb{}, Model: schema.TtsRequestTextVoice4a0120aeModelAsFlashV25{}}}, false, true, false, "flash-v2.5", "off"},
		{schema.TtsRequestAsStreamingTextVoice194990a6{Value: schema.TtsRequestStreamingTextVoice194990a6{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice194990a6OutputAsMp356cad1fb{}, Model: schema.TtsRequestTextVoice4a0120aeModelAsFlashV25{}}}, true, false, false, "flash-v2.5", "auto"},
		{&schema.TtsRequestAsStreamingTextVoice194990a6{Value: schema.TtsRequestStreamingTextVoice194990a6{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice194990a6OutputAsMp356cad1fb{}, Model: schema.TtsRequestTextVoice4a0120aeModelAsFlashV25{}}}, true, false, false, "flash-v2.5", "auto"},
		{schema.TtsRequestAsTextVoiceac5e804b{Value: schema.TtsRequestTextVoiceac5e804b{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice4a0120aeOutputAsMp356cad1fb{}, Model: schema.TtsRequestTextVoice4a0120aeModelAsFlashV25{}}}, false, true, false, "flash-v2.5", "auto"},
		{&schema.TtsRequestAsTextVoiceac5e804b{Value: schema.TtsRequestTextVoiceac5e804b{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice4a0120aeOutputAsMp356cad1fb{}, Model: schema.TtsRequestTextVoice4a0120aeModelAsFlashV25{}}}, false, true, false, "flash-v2.5", "auto"},
		{schema.TtsRequestAsStreamingTextVoice04078405{Value: schema.TtsRequestStreamingTextVoice04078405{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice194990a6OutputAsMp356cad1fb{}, Model: schema.TtsRequestTextVoice4a0120aeModelAsFlashV25{}}}, true, true, false, "flash-v2.5", "auto"},
		{&schema.TtsRequestAsStreamingTextVoice04078405{Value: schema.TtsRequestStreamingTextVoice04078405{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice194990a6OutputAsMp356cad1fb{}, Model: schema.TtsRequestTextVoice4a0120aeModelAsFlashV25{}}}, true, true, false, "flash-v2.5", "auto"},
		{schema.TtsRequestAsStreamingTextVoicef49cfea8{Value: schema.TtsRequestStreamingTextVoicef49cfea8{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice194990a6OutputAsMp356cad1fb{}, Model: schema.TtsRequestTextVoice4a0120aeModelAsFlashV25{}}}, true, false, true, "flash-v2.5", "auto"},
		{&schema.TtsRequestAsStreamingTextVoicef49cfea8{Value: schema.TtsRequestStreamingTextVoicef49cfea8{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice194990a6OutputAsMp356cad1fb{}, Model: schema.TtsRequestTextVoice4a0120aeModelAsFlashV25{}}}, true, false, true, "flash-v2.5", "auto"},
		{schema.TtsRequestAsStreamingTextVoice282de2db{Value: schema.TtsRequestStreamingTextVoice282de2db{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice194990a6OutputAsMp356cad1fb{}, Model: schema.TtsRequestTextVoice4a0120aeModelAsFlashV25{}}}, true, true, true, "flash-v2.5", "auto"},
		{&schema.TtsRequestAsStreamingTextVoice282de2db{Value: schema.TtsRequestStreamingTextVoice282de2db{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice194990a6OutputAsMp356cad1fb{}, Model: schema.TtsRequestTextVoice4a0120aeModelAsFlashV25{}}}, true, true, true, "flash-v2.5", "auto"},
		{schema.TtsRequestAsMultilingualV2TextVoiceb7dcb211{Value: schema.TtsRequestMultilingualV2TextVoiceb7dcb211{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice4a0120aeOutputAsMp356cad1fb{}}}, false, false, false, "multilingual-v2", "auto"},
		{&schema.TtsRequestAsMultilingualV2TextVoiceb7dcb211{Value: schema.TtsRequestMultilingualV2TextVoiceb7dcb211{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice4a0120aeOutputAsMp356cad1fb{}}}, false, false, false, "multilingual-v2", "auto"},
		{schema.TtsRequestAsMultilingualV2TextVoice6b4236de{Value: schema.TtsRequestMultilingualV2TextVoice6b4236de{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice4a0120aeOutputAsMp356cad1fb{}}}, false, false, false, "multilingual-v2", "off"},
		{&schema.TtsRequestAsMultilingualV2TextVoice6b4236de{Value: schema.TtsRequestMultilingualV2TextVoice6b4236de{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice4a0120aeOutputAsMp356cad1fb{}}}, false, false, false, "multilingual-v2", "off"},
		{schema.TtsRequestAsMultilingualV2TextVoiceca4ba9c1{Value: schema.TtsRequestMultilingualV2TextVoiceca4ba9c1{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice4a0120aeOutputAsMp356cad1fb{}}}, false, true, false, "multilingual-v2", "off"},
		{&schema.TtsRequestAsMultilingualV2TextVoiceca4ba9c1{Value: schema.TtsRequestMultilingualV2TextVoiceca4ba9c1{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice4a0120aeOutputAsMp356cad1fb{}}}, false, true, false, "multilingual-v2", "off"},
		{schema.TtsRequestAsMultilingualV2StreamingTextVoice90f3837b{Value: schema.TtsRequestMultilingualV2StreamingTextVoice90f3837b{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice194990a6OutputAsMp356cad1fb{}}}, true, false, false, "multilingual-v2", "auto"},
		{&schema.TtsRequestAsMultilingualV2StreamingTextVoice90f3837b{Value: schema.TtsRequestMultilingualV2StreamingTextVoice90f3837b{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice194990a6OutputAsMp356cad1fb{}}}, true, false, false, "multilingual-v2", "auto"},
		{schema.TtsRequestAsMultilingualV2TextVoice51150c25{Value: schema.TtsRequestMultilingualV2TextVoice51150c25{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice4a0120aeOutputAsMp356cad1fb{}}}, false, true, false, "multilingual-v2", "auto"},
		{&schema.TtsRequestAsMultilingualV2TextVoice51150c25{Value: schema.TtsRequestMultilingualV2TextVoice51150c25{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice4a0120aeOutputAsMp356cad1fb{}}}, false, true, false, "multilingual-v2", "auto"},
		{schema.TtsRequestAsMultilingualV2StreamingTextVoice7bc2227c{Value: schema.TtsRequestMultilingualV2StreamingTextVoice7bc2227c{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice194990a6OutputAsMp356cad1fb{}}}, true, true, false, "multilingual-v2", "auto"},
		{&schema.TtsRequestAsMultilingualV2StreamingTextVoice7bc2227c{Value: schema.TtsRequestMultilingualV2StreamingTextVoice7bc2227c{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice194990a6OutputAsMp356cad1fb{}}}, true, true, false, "multilingual-v2", "auto"},
		{schema.TtsRequestAsMultilingualV2StreamingTextVoice388d65c0{Value: schema.TtsRequestMultilingualV2StreamingTextVoice388d65c0{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice194990a6OutputAsMp356cad1fb{}}}, true, false, true, "multilingual-v2", "auto"},
		{&schema.TtsRequestAsMultilingualV2StreamingTextVoice388d65c0{Value: schema.TtsRequestMultilingualV2StreamingTextVoice388d65c0{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice194990a6OutputAsMp356cad1fb{}}}, true, false, true, "multilingual-v2", "auto"},
		{schema.TtsRequestAsMultilingualV2StreamingTextVoice1e73ed4e{Value: schema.TtsRequestMultilingualV2StreamingTextVoice1e73ed4e{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice194990a6OutputAsMp356cad1fb{}}}, true, true, true, "multilingual-v2", "auto"},
		{&schema.TtsRequestAsMultilingualV2StreamingTextVoice1e73ed4e{Value: schema.TtsRequestMultilingualV2StreamingTextVoice1e73ed4e{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice194990a6OutputAsMp356cad1fb{}}}, true, true, true, "multilingual-v2", "auto"},
		{schema.TtsRequestAsElevenV3TextVoiceedc22df3{Value: schema.TtsRequestElevenV3TextVoiceedc22df3{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice4a0120aeOutputAsMp356cad1fb{}}}, false, false, false, "eleven-v3", "auto"},
		{&schema.TtsRequestAsElevenV3TextVoiceedc22df3{Value: schema.TtsRequestElevenV3TextVoiceedc22df3{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice4a0120aeOutputAsMp356cad1fb{}}}, false, false, false, "eleven-v3", "auto"},
		{schema.TtsRequestAsElevenV3TextVoicea067d696{Value: schema.TtsRequestElevenV3TextVoicea067d696{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice4a0120aeOutputAsMp356cad1fb{}}}, false, false, false, "eleven-v3", "off"},
		{&schema.TtsRequestAsElevenV3TextVoicea067d696{Value: schema.TtsRequestElevenV3TextVoicea067d696{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice4a0120aeOutputAsMp356cad1fb{}}}, false, false, false, "eleven-v3", "off"},
		{schema.TtsRequestAsElevenV3TextVoiceb4b74c48{Value: schema.TtsRequestElevenV3TextVoiceb4b74c48{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice4a0120aeOutputAsMp356cad1fb{}}}, false, true, false, "eleven-v3", "off"},
		{&schema.TtsRequestAsElevenV3TextVoiceb4b74c48{Value: schema.TtsRequestElevenV3TextVoiceb4b74c48{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice4a0120aeOutputAsMp356cad1fb{}}}, false, true, false, "eleven-v3", "off"},
		{schema.TtsRequestAsElevenV3StreamingTextVoicef18e078f{Value: schema.TtsRequestElevenV3StreamingTextVoicef18e078f{Voice: "custom/id", Text: v3input, Output: schema.TtsRequestStreamingTextVoice194990a6OutputAsMp356cad1fb{}}}, true, false, false, "eleven-v3", "auto"},
		{&schema.TtsRequestAsElevenV3StreamingTextVoicef18e078f{Value: schema.TtsRequestElevenV3StreamingTextVoicef18e078f{Voice: "custom/id", Text: v3input, Output: schema.TtsRequestStreamingTextVoice194990a6OutputAsMp356cad1fb{}}}, true, false, false, "eleven-v3", "auto"},
		{schema.TtsRequestAsElevenV3TextVoicef41607cd{Value: schema.TtsRequestElevenV3TextVoicef41607cd{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice4a0120aeOutputAsMp356cad1fb{}}}, false, true, false, "eleven-v3", "auto"},
		{&schema.TtsRequestAsElevenV3TextVoicef41607cd{Value: schema.TtsRequestElevenV3TextVoicef41607cd{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice4a0120aeOutputAsMp356cad1fb{}}}, false, true, false, "eleven-v3", "auto"},
		{schema.TtsRequestAsElevenV3StreamingTextVoicec9aef256{Value: schema.TtsRequestElevenV3StreamingTextVoicec9aef256{Voice: "custom/id", Text: v3input, Output: schema.TtsRequestStreamingTextVoice194990a6OutputAsMp356cad1fb{}}}, true, true, false, "eleven-v3", "auto"},
		{&schema.TtsRequestAsElevenV3StreamingTextVoicec9aef256{Value: schema.TtsRequestElevenV3StreamingTextVoicec9aef256{Voice: "custom/id", Text: v3input, Output: schema.TtsRequestStreamingTextVoice194990a6OutputAsMp356cad1fb{}}}, true, true, false, "eleven-v3", "auto"},
	}
	for _, tc := range cases {
		if _, err := schema.ValidateRequest(tc.request); err != nil {
			t.Fatalf("%T: %v", tc.request, err)
		}
		c, err := settings(tc.request)
		if err != nil {
			t.Fatal(err)
		}
		equal(t, c.input != nil, tc.live)
		equal(t, c.timed, tc.timed)
		equal(t, c.unbuffered, tc.unbuffered)
		equal(t, c.model, tc.model)
		equal(t, c.normalization, tc.normalization)
	}
	equal(t, input.pulls.Load(), int32(0))
	equal(t, v3input.pulls.Load(), int32(0))
}

func TestOutputMappingsAndPointerForms(t *testing.T) {
	var bitrate schema.TtsRequestTextVoice4a0120aeOutputMp356cad1fbBitRateBps = schema.TtsRequestTextVoice4a0120aeOutputMp356cad1fbBitRateBpsAsNumber192000{}
	mp3 := schema.TtsRequestTextVoice4a0120aeOutputMp356cad1fb{BitRateBps: runtime.Some(bitrate)}
	opus := schema.TtsRequestTextVoice4a0120aeOutputOggOpus{BitRateBps: runtime.Some(bitrate)}
	pcm := schema.TtsRequestTextVoice4a0120aeOutputPcm{SampleRateHz: schema.TtsRequestTextVoice4a0120aeOutputPcmSampleRateHzAsNumber8000{}}
	wav := schema.TtsRequestTextVoice4a0120aeOutputWav{SampleRateHz: schema.TtsRequestTextVoice4a0120aeOutputPcmSampleRateHzAsNumber22050{}}
	law := schema.TtsRequestTextVoice4a0120aeOutputObject{Format: schema.TtsRequestTextVoice4a0120aeOutputObjectFormatAsAlaw{}}
	for _, tc := range []struct {
		value any
		want  string
	}{
		{&schema.TtsRequestTextVoice4a0120aeOutputAsMp31de777c9{}, "mp3_22050_32"},
		{&schema.TtsRequestTextVoice4a0120aeOutputAsMp34def27fa{}, "mp3_24000_48"},
		{&schema.TtsRequestTextVoice4a0120aeOutputAsMp356cad1fb{Value: mp3}, "mp3_44100_192"},
		{&schema.TtsRequestTextVoice4a0120aeOutputAsOggOpus{Value: opus}, "opus_48000_192"},
		{&schema.TtsRequestTextVoice4a0120aeOutputAsPcm{Value: pcm}, "pcm_8000"},
		{&schema.TtsRequestTextVoice4a0120aeOutputAsWav{Value: wav}, "wav_22050"},
		{&schema.TtsRequestTextVoice4a0120aeOutputAsObject{Value: law}, "alaw_8000"},
		{schema.TtsRequestStreamingTextVoice194990a6OutputAsMp31de777c9{}, "mp3_22050_32"},
		{schema.TtsRequestStreamingTextVoice194990a6OutputAsMp34def27fa{}, "mp3_24000_48"},
		{schema.TtsRequestStreamingTextVoice194990a6OutputAsOggOpus{Value: opus}, "opus_48000_192"},
		{schema.TtsRequestStreamingTextVoice194990a6OutputAsObject{Value: law}, "alaw_8000"},
		{&schema.TtsRequestStreamingTextVoice194990a6OutputAsMp31de777c9{}, "mp3_22050_32"},
		{&schema.TtsRequestStreamingTextVoice194990a6OutputAsMp34def27fa{}, "mp3_24000_48"},
		{&schema.TtsRequestStreamingTextVoice194990a6OutputAsMp356cad1fb{Value: mp3}, "mp3_44100_192"},
		{&schema.TtsRequestStreamingTextVoice194990a6OutputAsOggOpus{Value: opus}, "opus_48000_192"},
		{&schema.TtsRequestStreamingTextVoice194990a6OutputAsPcm{Value: pcm}, "pcm_8000"},
		{&schema.TtsRequestStreamingTextVoice194990a6OutputAsObject{Value: law}, "alaw_8000"},
	} {
		value, err := outputFormat(tc.value)
		if err != nil {
			t.Fatal(err)
		}
		equal(t, value, tc.want)
	}
}
