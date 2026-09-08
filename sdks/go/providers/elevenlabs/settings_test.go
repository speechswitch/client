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
		{schema.TtsRequestAsTextVoice814840b5{Value: schema.TtsRequestTextVoice814840b5{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice814840b5OutputAsMp356cad1fb{}, Model: schema.TtsRequestTextVoice814840b5ModelAsFlashV25{}}}, false, false, false, "flash-v2.5", "auto"},
		{&schema.TtsRequestAsTextVoice814840b5{Value: schema.TtsRequestTextVoice814840b5{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice814840b5OutputAsMp356cad1fb{}, Model: schema.TtsRequestTextVoice814840b5ModelAsFlashV25{}}}, false, false, false, "flash-v2.5", "auto"},
		{schema.TtsRequestAsTextVoiceeabc9ca0{Value: schema.TtsRequestTextVoiceeabc9ca0{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice814840b5OutputAsMp356cad1fb{}, Model: schema.TtsRequestTextVoice814840b5ModelAsFlashV25{}}}, false, false, false, "flash-v2.5", "off"},
		{&schema.TtsRequestAsTextVoiceeabc9ca0{Value: schema.TtsRequestTextVoiceeabc9ca0{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice814840b5OutputAsMp356cad1fb{}, Model: schema.TtsRequestTextVoice814840b5ModelAsFlashV25{}}}, false, false, false, "flash-v2.5", "off"},
		{schema.TtsRequestAsTextVoice1aa1b026{Value: schema.TtsRequestTextVoice1aa1b026{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice814840b5OutputAsMp356cad1fb{}, Model: schema.TtsRequestTextVoice814840b5ModelAsFlashV25{}}}, false, true, false, "flash-v2.5", "off"},
		{&schema.TtsRequestAsTextVoice1aa1b026{Value: schema.TtsRequestTextVoice1aa1b026{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice814840b5OutputAsMp356cad1fb{}, Model: schema.TtsRequestTextVoice814840b5ModelAsFlashV25{}}}, false, true, false, "flash-v2.5", "off"},
		{schema.TtsRequestAsStreamingTextVoice5024de38{Value: schema.TtsRequestStreamingTextVoice5024de38{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice5024de38OutputAsMp356cad1fb{}, Model: schema.TtsRequestTextVoice814840b5ModelAsFlashV25{}}}, true, false, false, "flash-v2.5", "auto"},
		{&schema.TtsRequestAsStreamingTextVoice5024de38{Value: schema.TtsRequestStreamingTextVoice5024de38{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice5024de38OutputAsMp356cad1fb{}, Model: schema.TtsRequestTextVoice814840b5ModelAsFlashV25{}}}, true, false, false, "flash-v2.5", "auto"},
		{schema.TtsRequestAsTextVoice6596490e{Value: schema.TtsRequestTextVoice6596490e{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice814840b5OutputAsMp356cad1fb{}, Model: schema.TtsRequestTextVoice814840b5ModelAsFlashV25{}}}, false, true, false, "flash-v2.5", "auto"},
		{&schema.TtsRequestAsTextVoice6596490e{Value: schema.TtsRequestTextVoice6596490e{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice814840b5OutputAsMp356cad1fb{}, Model: schema.TtsRequestTextVoice814840b5ModelAsFlashV25{}}}, false, true, false, "flash-v2.5", "auto"},
		{schema.TtsRequestAsStreamingTextVoiceb9af60c3{Value: schema.TtsRequestStreamingTextVoiceb9af60c3{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice5024de38OutputAsMp356cad1fb{}, Model: schema.TtsRequestTextVoice814840b5ModelAsFlashV25{}}}, true, true, false, "flash-v2.5", "auto"},
		{&schema.TtsRequestAsStreamingTextVoiceb9af60c3{Value: schema.TtsRequestStreamingTextVoiceb9af60c3{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice5024de38OutputAsMp356cad1fb{}, Model: schema.TtsRequestTextVoice814840b5ModelAsFlashV25{}}}, true, true, false, "flash-v2.5", "auto"},
		{schema.TtsRequestAsStreamingTextVoice732994d4{Value: schema.TtsRequestStreamingTextVoice732994d4{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice5024de38OutputAsMp356cad1fb{}, Model: schema.TtsRequestTextVoice814840b5ModelAsFlashV25{}}}, true, false, true, "flash-v2.5", "auto"},
		{&schema.TtsRequestAsStreamingTextVoice732994d4{Value: schema.TtsRequestStreamingTextVoice732994d4{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice5024de38OutputAsMp356cad1fb{}, Model: schema.TtsRequestTextVoice814840b5ModelAsFlashV25{}}}, true, false, true, "flash-v2.5", "auto"},
		{schema.TtsRequestAsStreamingTextVoicebc33fdb4{Value: schema.TtsRequestStreamingTextVoicebc33fdb4{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice5024de38OutputAsMp356cad1fb{}, Model: schema.TtsRequestTextVoice814840b5ModelAsFlashV25{}}}, true, true, true, "flash-v2.5", "auto"},
		{&schema.TtsRequestAsStreamingTextVoicebc33fdb4{Value: schema.TtsRequestStreamingTextVoicebc33fdb4{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice5024de38OutputAsMp356cad1fb{}, Model: schema.TtsRequestTextVoice814840b5ModelAsFlashV25{}}}, true, true, true, "flash-v2.5", "auto"},
		{schema.TtsRequestAsMultilingualV2TextVoiceae5db0bf{Value: schema.TtsRequestMultilingualV2TextVoiceae5db0bf{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice814840b5OutputAsMp356cad1fb{}}}, false, false, false, "multilingual-v2", "auto"},
		{&schema.TtsRequestAsMultilingualV2TextVoiceae5db0bf{Value: schema.TtsRequestMultilingualV2TextVoiceae5db0bf{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice814840b5OutputAsMp356cad1fb{}}}, false, false, false, "multilingual-v2", "auto"},
		{schema.TtsRequestAsMultilingualV2TextVoice2ee6cad1{Value: schema.TtsRequestMultilingualV2TextVoice2ee6cad1{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice814840b5OutputAsMp356cad1fb{}}}, false, false, false, "multilingual-v2", "off"},
		{&schema.TtsRequestAsMultilingualV2TextVoice2ee6cad1{Value: schema.TtsRequestMultilingualV2TextVoice2ee6cad1{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice814840b5OutputAsMp356cad1fb{}}}, false, false, false, "multilingual-v2", "off"},
		{schema.TtsRequestAsMultilingualV2TextVoice4ed687d7{Value: schema.TtsRequestMultilingualV2TextVoice4ed687d7{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice814840b5OutputAsMp356cad1fb{}}}, false, true, false, "multilingual-v2", "off"},
		{&schema.TtsRequestAsMultilingualV2TextVoice4ed687d7{Value: schema.TtsRequestMultilingualV2TextVoice4ed687d7{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice814840b5OutputAsMp356cad1fb{}}}, false, true, false, "multilingual-v2", "off"},
		{schema.TtsRequestAsMultilingualV2StreamingTextVoice729ee226{Value: schema.TtsRequestMultilingualV2StreamingTextVoice729ee226{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice5024de38OutputAsMp356cad1fb{}}}, true, false, false, "multilingual-v2", "auto"},
		{&schema.TtsRequestAsMultilingualV2StreamingTextVoice729ee226{Value: schema.TtsRequestMultilingualV2StreamingTextVoice729ee226{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice5024de38OutputAsMp356cad1fb{}}}, true, false, false, "multilingual-v2", "auto"},
		{schema.TtsRequestAsMultilingualV2TextVoice11f62a92{Value: schema.TtsRequestMultilingualV2TextVoice11f62a92{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice814840b5OutputAsMp356cad1fb{}}}, false, true, false, "multilingual-v2", "auto"},
		{&schema.TtsRequestAsMultilingualV2TextVoice11f62a92{Value: schema.TtsRequestMultilingualV2TextVoice11f62a92{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice814840b5OutputAsMp356cad1fb{}}}, false, true, false, "multilingual-v2", "auto"},
		{schema.TtsRequestAsMultilingualV2StreamingTextVoice3f7db298{Value: schema.TtsRequestMultilingualV2StreamingTextVoice3f7db298{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice5024de38OutputAsMp356cad1fb{}}}, true, true, false, "multilingual-v2", "auto"},
		{&schema.TtsRequestAsMultilingualV2StreamingTextVoice3f7db298{Value: schema.TtsRequestMultilingualV2StreamingTextVoice3f7db298{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice5024de38OutputAsMp356cad1fb{}}}, true, true, false, "multilingual-v2", "auto"},
		{schema.TtsRequestAsMultilingualV2StreamingTextVoiceac3750e0{Value: schema.TtsRequestMultilingualV2StreamingTextVoiceac3750e0{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice5024de38OutputAsMp356cad1fb{}}}, true, false, true, "multilingual-v2", "auto"},
		{&schema.TtsRequestAsMultilingualV2StreamingTextVoiceac3750e0{Value: schema.TtsRequestMultilingualV2StreamingTextVoiceac3750e0{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice5024de38OutputAsMp356cad1fb{}}}, true, false, true, "multilingual-v2", "auto"},
		{schema.TtsRequestAsMultilingualV2StreamingTextVoiceb51c2303{Value: schema.TtsRequestMultilingualV2StreamingTextVoiceb51c2303{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice5024de38OutputAsMp356cad1fb{}}}, true, true, true, "multilingual-v2", "auto"},
		{&schema.TtsRequestAsMultilingualV2StreamingTextVoiceb51c2303{Value: schema.TtsRequestMultilingualV2StreamingTextVoiceb51c2303{Voice: "custom/id", Text: input, Output: schema.TtsRequestStreamingTextVoice5024de38OutputAsMp356cad1fb{}}}, true, true, true, "multilingual-v2", "auto"},
		{schema.TtsRequestAsElevenV3TextVoicec3eabebc{Value: schema.TtsRequestElevenV3TextVoicec3eabebc{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice814840b5OutputAsMp356cad1fb{}}}, false, false, false, "eleven-v3", "auto"},
		{&schema.TtsRequestAsElevenV3TextVoicec3eabebc{Value: schema.TtsRequestElevenV3TextVoicec3eabebc{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice814840b5OutputAsMp356cad1fb{}}}, false, false, false, "eleven-v3", "auto"},
		{schema.TtsRequestAsElevenV3TextVoicefade944d{Value: schema.TtsRequestElevenV3TextVoicefade944d{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice814840b5OutputAsMp356cad1fb{}}}, false, false, false, "eleven-v3", "off"},
		{&schema.TtsRequestAsElevenV3TextVoicefade944d{Value: schema.TtsRequestElevenV3TextVoicefade944d{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice814840b5OutputAsMp356cad1fb{}}}, false, false, false, "eleven-v3", "off"},
		{schema.TtsRequestAsElevenV3TextVoicebb26fac2{Value: schema.TtsRequestElevenV3TextVoicebb26fac2{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice814840b5OutputAsMp356cad1fb{}}}, false, true, false, "eleven-v3", "off"},
		{&schema.TtsRequestAsElevenV3TextVoicebb26fac2{Value: schema.TtsRequestElevenV3TextVoicebb26fac2{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice814840b5OutputAsMp356cad1fb{}}}, false, true, false, "eleven-v3", "off"},
		{schema.TtsRequestAsElevenV3StreamingTextVoice145c0c5a{Value: schema.TtsRequestElevenV3StreamingTextVoice145c0c5a{Voice: "custom/id", Text: v3input, Output: schema.TtsRequestStreamingTextVoice5024de38OutputAsMp356cad1fb{}}}, true, false, false, "eleven-v3", "auto"},
		{&schema.TtsRequestAsElevenV3StreamingTextVoice145c0c5a{Value: schema.TtsRequestElevenV3StreamingTextVoice145c0c5a{Voice: "custom/id", Text: v3input, Output: schema.TtsRequestStreamingTextVoice5024de38OutputAsMp356cad1fb{}}}, true, false, false, "eleven-v3", "auto"},
		{schema.TtsRequestAsElevenV3TextVoicede803f4c{Value: schema.TtsRequestElevenV3TextVoicede803f4c{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice814840b5OutputAsMp356cad1fb{}}}, false, true, false, "eleven-v3", "auto"},
		{&schema.TtsRequestAsElevenV3TextVoicede803f4c{Value: schema.TtsRequestElevenV3TextVoicede803f4c{Voice: "custom/id", Text: "Hello", Output: schema.TtsRequestTextVoice814840b5OutputAsMp356cad1fb{}}}, false, true, false, "eleven-v3", "auto"},
		{schema.TtsRequestAsElevenV3StreamingTextVoicec1dc022a{Value: schema.TtsRequestElevenV3StreamingTextVoicec1dc022a{Voice: "custom/id", Text: v3input, Output: schema.TtsRequestStreamingTextVoice5024de38OutputAsMp356cad1fb{}}}, true, true, false, "eleven-v3", "auto"},
		{&schema.TtsRequestAsElevenV3StreamingTextVoicec1dc022a{Value: schema.TtsRequestElevenV3StreamingTextVoicec1dc022a{Voice: "custom/id", Text: v3input, Output: schema.TtsRequestStreamingTextVoice5024de38OutputAsMp356cad1fb{}}}, true, true, false, "eleven-v3", "auto"},
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
	var bitrate schema.TtsRequestTextVoice814840b5OutputMp356cad1fbBitRateBps = schema.TtsRequestTextVoice814840b5OutputMp356cad1fbBitRateBpsAsNumber192000{}
	mp3 := schema.TtsRequestTextVoice814840b5OutputMp356cad1fb{BitRateBps: runtime.Some(bitrate)}
	opus := schema.TtsRequestTextVoice814840b5OutputOggOpus{BitRateBps: runtime.Some(bitrate)}
	pcm := schema.TtsRequestTextVoice814840b5OutputPcm{SampleRateHz: schema.TtsRequestTextVoice814840b5OutputPcmSampleRateHzAsNumber8000{}}
	wav := schema.TtsRequestTextVoice814840b5OutputWav{SampleRateHz: schema.TtsRequestTextVoice814840b5OutputPcmSampleRateHzAsNumber22050{}}
	law := schema.TtsRequestTextVoice814840b5OutputObject{Format: schema.TtsRequestTextVoice814840b5OutputObjectFormatAsAlaw{}}
	for _, tc := range []struct {
		value any
		want  string
	}{
		{&schema.TtsRequestTextVoice814840b5OutputAsMp31de777c9{}, "mp3_22050_32"},
		{&schema.TtsRequestTextVoice814840b5OutputAsMp34def27fa{}, "mp3_24000_48"},
		{&schema.TtsRequestTextVoice814840b5OutputAsMp356cad1fb{Value: mp3}, "mp3_44100_192"},
		{&schema.TtsRequestTextVoice814840b5OutputAsOggOpus{Value: opus}, "opus_48000_192"},
		{&schema.TtsRequestTextVoice814840b5OutputAsPcm{Value: pcm}, "pcm_8000"},
		{&schema.TtsRequestTextVoice814840b5OutputAsWav{Value: wav}, "wav_22050"},
		{&schema.TtsRequestTextVoice814840b5OutputAsObject{Value: law}, "alaw_8000"},
		{schema.TtsRequestStreamingTextVoice5024de38OutputAsMp31de777c9{}, "mp3_22050_32"},
		{schema.TtsRequestStreamingTextVoice5024de38OutputAsMp34def27fa{}, "mp3_24000_48"},
		{schema.TtsRequestStreamingTextVoice5024de38OutputAsOggOpus{Value: opus}, "opus_48000_192"},
		{schema.TtsRequestStreamingTextVoice5024de38OutputAsObject{Value: law}, "alaw_8000"},
		{&schema.TtsRequestStreamingTextVoice5024de38OutputAsMp31de777c9{}, "mp3_22050_32"},
		{&schema.TtsRequestStreamingTextVoice5024de38OutputAsMp34def27fa{}, "mp3_24000_48"},
		{&schema.TtsRequestStreamingTextVoice5024de38OutputAsMp356cad1fb{Value: mp3}, "mp3_44100_192"},
		{&schema.TtsRequestStreamingTextVoice5024de38OutputAsOggOpus{Value: opus}, "opus_48000_192"},
		{&schema.TtsRequestStreamingTextVoice5024de38OutputAsPcm{Value: pcm}, "pcm_8000"},
		{&schema.TtsRequestStreamingTextVoice5024de38OutputAsObject{Value: law}, "alaw_8000"},
	} {
		value, err := outputFormat(tc.value)
		if err != nil {
			t.Fatal(err)
		}
		equal(t, value, tc.want)
	}
}
