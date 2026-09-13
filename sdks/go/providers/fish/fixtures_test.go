package fish

import (
	"testing"

	schema "github.com/speechswitch/client/sdks/go/generated/fish"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func requests() []schema.TtsRequest {
	a := request()
	b := schema.TtsRequestAsS1TextVoice{Value: schema.TtsRequestS1TextVoice{Text: "hello", Voice: "custom-voice", Output: schema.TtsRequestS1TextOutputAsObject{Value: schema.TtsRequestS1TextOutputObject{Format: schema.TtsRequestS1TextOutputObjectFormatAsPcm{}, SampleRateHz: runtime.Some(float64(24000))}}}}
	c := request()
	c.Value.Model = schema.TtsRequestText486ba478ModelAsS21Pro{}
	c.Value.Output = schema.TtsRequestS1TextOutputAsObject{Value: schema.TtsRequestS1TextOutputObject{Format: schema.TtsRequestS1TextOutputObjectFormatAsWav{}}}
	d := request()
	d.Value.Model = schema.TtsRequestText486ba478ModelAsS21ProFree{}
	d.Value.Output = schema.TtsRequestS1TextOutputAsMp3{Value: schema.TtsRequestS1TextOutputMp3{BitRateBps: runtime.Some(schema.TtsRequestS1TextOutputMp3BitRateBps(schema.TtsRequestS1TextOutputMp3BitRateBpsAsNumber192000{}))}}
	e := request()
	e.Value.Output = schema.TtsRequestS1TextOutputAsOggOpus{Value: schema.TtsRequestS1TextOutputOggOpus{BitRateBps: runtime.Some(schema.TtsRequestS1TextOutputOggOpusBitRateBps(schema.TtsRequestS1TextOutputOggOpusBitRateBpsAsNumber32000{}))}}
	e.Value.Speed = runtime.Some(0.5)
	e.Value.VolumeDb = runtime.Some(float64(-6))
	e.Value.LoudnessNormalization = runtime.Some(schema.TtsRequestS1TextConditionOnPreviousChunks(schema.TtsRequestS1TextConditionOnPreviousChunksAsFalse{}))
	e.Value.Temperature = runtime.Some(float64(0))
	e.Value.TopP = runtime.Some(float64(0))
	e.Value.TextChunkLength = runtime.Some(float64(100))
	e.Value.MinTextChunkLength = runtime.Some(float64(0))
	e.Value.MaxAudioTokens = runtime.Some(float64(2048))
	e.Value.RepetitionPenalty = runtime.Some(1.5)
	e.Value.ConditionOnPreviousChunks = e.Value.LoudnessNormalization
	e.Value.EarlyStopThreshold = runtime.Some(float64(0))
	e.Value.TextNormalization = e.Value.LoudnessNormalization
	e.Value.LatencyOptimization = runtime.Some(schema.TtsRequestS1TextLatencyOptimization(schema.TtsRequestS1TextLatencyOptimizationAsAggressive{}))
	e.Value.Features = runtime.Some([]string{"quality-guard"})
	samples := []schema.TtsRequestS1TextReferenceSamplesItem{{Audio: []byte{0, 255, 1}, Text: "my voice"}}
	f := schema.TtsRequestAsS1Text{Value: schema.TtsRequestS1Text{Text: "hello", Output: schema.TtsRequestS1TextOutputAsMp3{}, ReferenceSamples: samples}}
	g := request()
	g.Value.ReferenceSamples = runtime.Some(samples)
	h := schema.TtsRequestAsText486ba478{Value: schema.TtsRequestText486ba478{Model: schema.TtsRequestText486ba478ModelAsS2Pro{}, Text: "<|speaker:0|>Hello<|speaker:1|>Hi", Output: schema.TtsRequestS1TextOutputAsMp3{}, Speakers: schema.TtsRequestText486ba478SpeakersAsArraybc859dfb{Value: []schema.TtsRequestText486ba478SpeakersArraybc859dfbItem{{Voice: "a"}, {Voice: "b"}}}}}
	i := h
	i.Value.Speakers = schema.TtsRequestText486ba478SpeakersAsArray66345558{Value: []schema.TtsRequestText486ba478SpeakersArray66345558Item{{ReferenceSamples: []schema.TtsRequestS1TextReferenceSamplesItem{{Audio: []byte{1, 2}, Text: "a"}}}, {ReferenceSamples: []schema.TtsRequestS1TextReferenceSamplesItem{{Audio: []byte{3, 4}, Text: "b"}}}}}
	return []schema.TtsRequest{a, b, c, d, e, f, g, h, i}
}

func TestEveryRequestVariantAndPointerConvertsWithoutPolling(t *testing.T) {
	input := newSource()
	output := schema.TtsRequestS1TextOutputAsMp3{}
	samples := []schema.TtsRequestS1TextReferenceSamplesItem{{Audio: []byte{1}, Text: "voice"}}
	model := schema.TtsRequestText486ba478ModelAsS2Pro{}
	speakers := schema.TtsRequestText486ba478SpeakersAsArraybc859dfb{Value: []schema.TtsRequestText486ba478SpeakersArraybc859dfbItem{{Voice: "custom-voice"}}}
	a := schema.TtsRequestAsS1Text{Value: schema.TtsRequestS1Text{Text: "hello", Output: output, ReferenceSamples: samples}}
	b := schema.TtsRequestAsS1StreamingText{Value: schema.TtsRequestS1StreamingText{Text: input, Output: output, ReferenceSamples: samples}}
	c := schema.TtsRequestAsS1TextVoice{Value: schema.TtsRequestS1TextVoice{Text: "hello", Output: output, Voice: "custom-voice"}}
	d := schema.TtsRequestAsS1StreamingTextVoice{Value: schema.TtsRequestS1StreamingTextVoice{Text: input, Output: output, Voice: "custom-voice"}}
	e := schema.TtsRequestAsText486ba478{Value: schema.TtsRequestText486ba478{Model: model, Text: "hello", Output: output, Speakers: speakers}}
	f := schema.TtsRequestAsStreamingText5a166f9a{Value: schema.TtsRequestStreamingText5a166f9a{Model: model, Text: input, Output: output, Speakers: speakers}}
	g := schema.TtsRequestAsText054c2c18{Value: schema.TtsRequestText054c2c18{Model: model, Text: "hello", Output: output, ReferenceSamples: samples}}
	h := schema.TtsRequestAsStreamingText8d1c40c1{Value: schema.TtsRequestStreamingText8d1c40c1{Model: model, Text: input, Output: output, ReferenceSamples: samples}}
	i, j := request(), streaming(input)
	for _, r := range []schema.TtsRequest{a, &a, b, &b, c, &c, d, &d, e, &e, f, &f, g, &g, h, &h, i, &i, j, &j} {
		if _, err := schema.ValidateRequest(r); err != nil {
			t.Fatal(err)
		}
		config, err := settings(r)
		if err != nil {
			t.Fatal(err)
		}
		wire, err := wireSettings(config)
		if err != nil {
			t.Fatal(err)
		}
		equal(t, wire["format"], "mp3")
		equal(t, wire["sample_rate"], float64(44100))
	}
	equal(t, input.reads.Load(), int32(0))
	equal(t, input.closes.Load(), int32(0))
}
