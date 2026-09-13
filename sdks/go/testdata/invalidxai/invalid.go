package invalidxai

import (
	"context"
	"github.com/speechswitch/client/sdks/go/generated/amazon"
	schema "github.com/speechswitch/client/sdks/go/generated/xai"
	out "github.com/speechswitch/client/sdks/go/generated/xai_output"
	provider "github.com/speechswitch/client/sdks/go/providers/xai"
	"github.com/speechswitch/client/sdks/go/runtime"
)

var bitrate = schema.TtsRequestTextOutputObject{BitRateBps: runtime.Some(128000)}
var latency = schema.TtsRequestText{LatencyOptimization: runtime.Some(true)}
var model = schema.TtsRequestText{Model: runtime.Some("other")}
var update = schema.TtsRequestStreamingTextTextItemUpdate{Replacements: "Acme"}
var correlation = out.TimestampedAudio{Correlation: "timeline"}
var interval = out.CharacterTimestamp{EndTimeMs: "later"}

func wrong(text runtime.Input[schema.TtsRequestStreamingTextTextItem]) {
	_ = amazon.TtsRequestGenerativeStreamingTextVoice{Text: text}
}

var _, _ = provider.Synthesize(context.Background(), schema.TtsRequestText{}, provider.Options{})
