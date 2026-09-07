package microsoft

import (
	"context"
	"encoding/json"
	schema "github.com/speechswitch/client/sdks/go/generated/microsoft"
	"github.com/speechswitch/client/sdks/go/runtime"
	"io"
	"net/http"
	"reflect"
	"strings"
	"testing"
)

func TestAllSharedFormatTokens(t *testing.T) {
	outputs := []schema.TtsRequestDragonHdFlashTextVoiceOutput{
		schema.TtsRequestDragonHdFlashTextVoiceOutputAsMp3c7ff7390{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputMp3c7ff7390{BitRateBps: schema.TtsRequestDragonHdFlashTextVoiceOutputMp3c7ff7390BitRateBpsAsNumber128000{}}},
		schema.TtsRequestDragonHdFlashTextVoiceOutputAsMp3cfa54ac8{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputMp3cfa54ac8{BitRateBps: schema.TtsRequestDragonHdFlashTextVoiceOutputMp3cfa54ac8BitRateBpsAsNumber160000{}}},
		schema.TtsRequestDragonHdFlashTextVoiceOutputAsMp332730738{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputMp332730738{BitRateBps: schema.TtsRequestDragonHdFlashTextVoiceOutputMp332730738BitRateBpsAsNumber192000{}}},
		schema.TtsRequestDragonHdFlashTextVoiceOutputAsPcm{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputPcm{SampleRateHz: schema.TtsRequestDragonHdFlashTextVoiceOutputPcmSampleRateHzAsNumber22050{}}},
		schema.TtsRequestDragonHdFlashTextVoiceOutputAsPcm{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputPcm{SampleRateHz: schema.TtsRequestDragonHdFlashTextVoiceOutputPcmSampleRateHzAsNumber44100{}}},
		schema.TtsRequestDragonHdFlashTextVoiceOutputAsWavbcb4c8a6{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputWavbcb4c8a6{SampleRateHz: schema.TtsRequestDragonHdFlashTextVoiceOutputPcmSampleRateHzAsNumber16000{}}},
		schema.TtsRequestDragonHdFlashTextVoiceOutputAsWav7dc10d1f{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputWav7dc10d1f{SampleEncoding: schema.TtsRequestDragonHdFlashTextVoiceOutputObjectFormatAsAlaw{}}},
		schema.TtsRequestDragonHdFlashTextVoiceOutputAsWav7dc10d1f{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputWav7dc10d1f{SampleEncoding: schema.TtsRequestDragonHdFlashTextVoiceOutputObjectFormatAsMulaw{}}},
		schema.TtsRequestDragonHdFlashTextVoiceOutputAsObject{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputObject{Format: schema.TtsRequestDragonHdFlashTextVoiceOutputObjectFormatAsAlaw{}}},
		schema.TtsRequestDragonHdFlashTextVoiceOutputAsObject{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputObject{Format: schema.TtsRequestDragonHdFlashTextVoiceOutputObjectFormatAsMulaw{}}},
		schema.TtsRequestDragonHdFlashTextVoiceOutputAsOggOpus{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputOggOpus{SampleRateHz: schema.TtsRequestDragonHdFlashTextVoiceOutputOggOpusSampleRateHzAsNumber48000{}}},
		schema.TtsRequestDragonHdFlashTextVoiceOutputAsOpusacd6a00c{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputOpusacd6a00c{}},
		schema.TtsRequestDragonHdFlashTextVoiceOutputAsOpus0a945e79{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputOpus0a945e79{BitRateBps: schema.TtsRequestDragonHdFlashTextVoiceOutputOpus0a945e79BitRateBpsAsNumber48000{}}},
		schema.TtsRequestDragonHdFlashTextVoiceOutputAsWebmOpus036ccd81{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputWebmOpus036ccd81{BitRateBps: runtime.Some(schema.TtsRequestDragonHdFlashTextVoiceOutputMp3cfa54ac8SampleRateHz{})}},
		schema.TtsRequestDragonHdFlashTextVoiceOutputAsWebmOpus00bc3439{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputWebmOpus00bc3439{}},
		schema.TtsRequestDragonHdFlashTextVoiceOutputAsTruesilk{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputTruesilk{SampleRateHz: schema.TtsRequestDragonHdFlashTextVoiceOutputTruesilkSampleRateHzAsNumber24000{}}},
		schema.TtsRequestDragonHdFlashTextVoiceOutputAsAmrWb{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputAmrWb{}},
		schema.TtsRequestDragonHdFlashTextVoiceOutputAsG722{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputG722{}},
	}
	var rows [][2]json.RawMessage
	if err := json.Unmarshal(fixture(t)["formats"], &rows); err != nil {
		t.Fatal(err)
	}
	equal(t, len(outputs), len(rows))
	for i, output := range outputs {
		pointer := reflect.New(reflect.TypeOf(output))
		pointer.Elem().Set(reflect.ValueOf(output))
		if got, _ := audioFormat(pointer.Interface()); got == "" {
			t.Fatal("empty pointer output format")
		} else {
			expected, _ := audioFormat(output)
			equal(t, got, expected)
		}
		r := request()
		r.Value.Output = runtime.Some(output)
		if _, err := schema.ValidateRequest(r); err != nil {
			t.Fatalf("output %d: %v", i, err)
		}
		c, err := settings(r)
		if err != nil {
			t.Fatal(err)
		}
		var expected string
		json.Unmarshal(rows[i][1], &expected)
		equal(t, c.format, expected)
	}
	r := request()
	r.Value.Output.Value = schema.TtsRequestDragonHdFlashTextVoiceOutputAsPcm{}
	c, err := settings(r)
	if err != nil {
		t.Fatal(err)
	}
	equal(t, c.format, "raw-24khz-16bit-mono-pcm")
}

func TestModelAndInputVariantsHaveTheirOwnWireSettings(t *testing.T) {
	source := newSource()
	cases := []struct {
		request     schema.TtsRequest
		voice       string
		temperature any
		live        bool
		timed       bool
	}{
		{&schema.TtsRequestAsDragonHdFlashTextVoice{Value: schema.TtsRequestDragonHdFlashTextVoice{Voice: "en-US-Ava", Text: "Hi"}}, "en-US-Ava:DragonHDFlashLatestNeural", nil, false, false},
		{&schema.TtsRequestAsDragonHdFlashStreamingTextVoice{Value: schema.TtsRequestDragonHdFlashStreamingTextVoice{Voice: "en-US-Ava", Text: source}}, "en-US-Ava:DragonHDFlashLatestNeural", nil, true, false},
		{&schema.TtsRequestAsDragonHdTextVoice{Value: schema.TtsRequestDragonHdTextVoice{Voice: "en-US-Ava", Text: "Hi"}}, "en-US-Ava:DragonHDLatestNeural", "1", false, false},
		{&schema.TtsRequestAsDragonHdStreamingTextVoice{Value: schema.TtsRequestDragonHdStreamingTextVoice{Voice: "en-US-Ava", Text: source, Temperature: runtime.Some(0.0)}}, "en-US-Ava:DragonHDLatestNeural", "0", true, false},
		{&schema.TtsRequestAsTextVoicefd836b1e{Value: schema.TtsRequestTextVoicefd836b1e{Voice: "en-US-Ava", Text: "Hi", Model: schema.TtsRequestTextVoicefd836b1eModelAsMaiVoice2{}}}, "en-US-Ava:MAI-Voice-2", nil, false, false},
		{&schema.TtsRequestAsStreamingTextVoicee690c86a{Value: schema.TtsRequestStreamingTextVoicee690c86a{Voice: "en-US-Ava", Text: source, Model: schema.TtsRequestTextVoicefd836b1eModelAsMaiVoice2Flash{}}}, "en-US-Ava:MAI-Voice-2-Flash", nil, true, false},
		{&schema.TtsRequestAsTextVoice4ff226b4{Value: schema.TtsRequestTextVoice4ff226b4{Voice: "en-US-AvaNeural", Text: "Hi"}}, "en-US-AvaNeural", nil, false, false},
		{&schema.TtsRequestAsStreamingTextVoicee86a65c0{Value: schema.TtsRequestStreamingTextVoicee86a65c0{Voice: "en-US-AvaNeural", Text: source}}, "en-US-AvaNeural", nil, true, false},
		{&schema.TtsRequestAsTextVoicef6245d6f{Value: schema.TtsRequestTextVoicef6245d6f{Voice: "en-US-AvaNeural", Text: "Hi", TimestampGranularity: schema.TtsRequestStreamingTextVoicee86a65c0TimestampGranularityAsWord{}}}, "en-US-AvaNeural", nil, false, true},
		{&schema.TtsRequestAsDragonHdOmniTextVoicea5a77562{Value: schema.TtsRequestDragonHdOmniTextVoicea5a77562{Voice: "en-US-Ava", Text: "Hi"}}, "en-US-Ava:DragonHDOmniLatestNeural", "0.7", false, false},
		{&schema.TtsRequestAsDragonHdOmniStreamingTextVoice{Value: schema.TtsRequestDragonHdOmniStreamingTextVoice{Voice: "en-US-Ava", Text: source}}, "en-US-Ava:DragonHDOmniLatestNeural", "0.7", true, false},
		{&schema.TtsRequestAsDragonHdOmniTextVoice4088531e{Value: schema.TtsRequestDragonHdOmniTextVoice4088531e{Voice: "en-US-Ava", Text: "Hi"}}, "en-US-Ava:DragonHDOmniLatestNeural", "0.7", false, true},
	}
	for _, row := range cases {
		if _, err := schema.ValidateRequest(row.request); err != nil {
			t.Fatal(err)
		}
		c, err := settings(row.request)
		if err != nil {
			t.Fatal(err)
		}
		equal(t, c.native["voiceName"], row.voice)
		equal(t, c.native["temperature"], row.temperature)
		equal(t, c.input != nil, row.live)
		equal(t, c.timed, row.timed)
	}
	equal(t, source.reads.Load(), int32(0))
}

func TestStreamingFormatsAndPointerRepresentations(t *testing.T) {
	outputs := []struct {
		index int
		value schema.TtsRequestDragonHdFlashStreamingTextVoiceOutput
	}{
		{0, schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsMp3c7ff7390{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputMp3c7ff7390{BitRateBps: schema.TtsRequestDragonHdFlashTextVoiceOutputMp3c7ff7390BitRateBpsAsNumber128000{}}}},
		{1, schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsMp3cfa54ac8{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputMp3cfa54ac8{BitRateBps: schema.TtsRequestDragonHdFlashTextVoiceOutputMp3cfa54ac8BitRateBpsAsNumber160000{}}}},
		{2, schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsMp332730738{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputMp332730738{BitRateBps: schema.TtsRequestDragonHdFlashTextVoiceOutputMp332730738BitRateBpsAsNumber192000{}}}},
		{3, schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsPcm{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputPcm{SampleRateHz: schema.TtsRequestDragonHdFlashTextVoiceOutputPcmSampleRateHzAsNumber22050{}}}},
		{4, schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsPcm{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputPcm{SampleRateHz: schema.TtsRequestDragonHdFlashTextVoiceOutputPcmSampleRateHzAsNumber44100{}}}},
		{8, schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsObject{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputObject{Format: schema.TtsRequestDragonHdFlashTextVoiceOutputObjectFormatAsAlaw{}}}},
		{9, schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsObject{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputObject{Format: schema.TtsRequestDragonHdFlashTextVoiceOutputObjectFormatAsMulaw{}}}},
		{10, schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsOggOpus{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputOggOpus{SampleRateHz: schema.TtsRequestDragonHdFlashTextVoiceOutputOggOpusSampleRateHzAsNumber48000{}}}},
		{11, schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsOpusacd6a00c{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputOpusacd6a00c{}}},
		{12, schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsOpus0a945e79{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputOpus0a945e79{BitRateBps: schema.TtsRequestDragonHdFlashTextVoiceOutputOpus0a945e79BitRateBpsAsNumber48000{}}}},
		{13, schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsWebmOpus036ccd81{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputWebmOpus036ccd81{BitRateBps: runtime.Some(schema.TtsRequestDragonHdFlashTextVoiceOutputMp3cfa54ac8SampleRateHz{})}}},
		{14, schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsWebmOpus00bc3439{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputWebmOpus00bc3439{}}},
		{15, schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsTruesilk{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputTruesilk{SampleRateHz: schema.TtsRequestDragonHdFlashTextVoiceOutputTruesilkSampleRateHzAsNumber24000{}}}},
		{16, schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsAmrWb{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputAmrWb{}}},
		{17, schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsG722{Value: schema.TtsRequestDragonHdFlashTextVoiceOutputG722{}}},
	}
	var rows [][2]json.RawMessage
	if err := json.Unmarshal(fixture(t)["formats"], &rows); err != nil {
		t.Fatal(err)
	}
	for _, row := range outputs {
		pointer := reflect.New(reflect.TypeOf(row.value))
		pointer.Elem().Set(reflect.ValueOf(row.value))
		for _, output := range []schema.TtsRequestDragonHdFlashStreamingTextVoiceOutput{row.value, pointer.Interface().(schema.TtsRequestDragonHdFlashStreamingTextVoiceOutput)} {
			r := streaming(newSource())
			r.Value.Output = runtime.Some(output)
			if _, err := schema.ValidateRequest(r); err != nil {
				t.Fatal(err)
			}
			c, err := settings(r)
			if err != nil {
				t.Fatal(err)
			}
			var expected string
			json.Unmarshal(rows[row.index][1], &expected)
			equal(t, c.format, expected)
			equal(t, c.wave, false)
		}
	}
}

func TestRawSSMLHTTPAndOmniSpeakingLanguage(t *testing.T) {
	raw := `<speak><voice name="existing custom voice">Hi</voice></speak>`
	r := &schema.TtsRequestAsText404f3d9b{Value: schema.TtsRequestText404f3d9b{Text: raw}}
	stream, err := Synthesize(context.Background(), r, Options{Auth: testAuth, Transport: transport(func(request *http.Request) (*http.Response, error) {
		data, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatal(err)
		}
		equal(t, string(data), raw)
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader("audio"))}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	stream.Close()
	omni := schema.TtsRequestAsDragonHdOmniTextVoicea5a77562{Value: schema.TtsRequestDragonHdOmniTextVoicea5a77562{
		Voice: "en-US-Ava", Text: "Hi", Language: runtime.Some("fr-FR"), Temperature: runtime.Some(0.8), TopP: runtime.Some(0.9), TopK: runtime.Some(20.0), VoiceGuidance: runtime.Some(1.2),
	}}
	if _, err := schema.ValidateRequest(omni); err != nil {
		t.Fatal(err)
	}
	c, err := settings(omni)
	if err != nil {
		t.Fatal(err)
	}
	equal(t, c.markup, `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US"><voice name="en-US-Ava:DragonHDOmniLatestNeural" parameters="temperature=0.8;top_p=0.9;top_k=20;cfg_scale=1.2"><lang xml:lang="fr-FR">Hi</lang></voice></speak>`)
}
