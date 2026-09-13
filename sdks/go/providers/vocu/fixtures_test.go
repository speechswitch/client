package vocu

import (
	schema "github.com/speechswitch/client/sdks/go/generated/vocu"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func fixtureRequests() []schema.TtsRequest {
	return []schema.TtsRequest{
		schema.TtsRequestAsTextVoice9c5ed44a{Value: schema.TtsRequestTextVoice9c5ed44a{Voice: "market:owned", Text: "Hello"}},
		schema.TtsRequestAsTextVoice9c5ed44a{Value: schema.TtsRequestTextVoice9c5ed44a{
			Voice: "custom", Text: "Hello", VoiceStyle: runtime.Some("my-style"), Speed: runtime.Some(2.0), RandomSeed: runtime.Some(0.0),
			Language:               runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeLanguage(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeLanguageAsEnUS{})),
			DeliveryMode:           runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeDeliveryMode(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeDeliveryModeAsStable{})),
			EmotionSource:          runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeEmotionSource(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeEmotionSourceAsVoice{})),
			VividExpression:        runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeLongTextMode(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeLongTextModeAsFalse{})),
			EmotionBlend:           runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeEmotionBlend{Anger: runtime.Some(5.0), Sadness: runtime.Some(2.0), Contextual: runtime.Some(0.0)}),
			LongTextMode:           runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeLongTextMode(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeLongTextModeAsFalse{})),
			AudioProcessingProfile: runtime.Some("chain"),
			LatencyOptimization:    runtime.Some(schema.TtsRequestTextVoicee296d426LatencyOptimization(schema.TtsRequestTextVoicee296d426LatencyOptimizationAsMaximum{})),
		}},
		schema.TtsRequestAsTextVoicee296d426{Value: schema.TtsRequestTextVoicee296d426{
			Voice: "custom", Text: "{{happy}}Bonjour", Speed: runtime.Some(0.5),
			Language:          runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeLanguage(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeLanguageAsFrFR{})),
			EmotionSource:     runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeEmotionSource(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeEmotionSourceAsText{})),
			ReferenceEmphasis: runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasis(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasisAsExpressive{})),
		}},
		schema.TtsRequestAsTextVoice2a721534{Value: schema.TtsRequestTextVoice2a721534{Voice: "custom", Text: "Hello"}},
		schema.TtsRequestAsObject42a4f93c{Value: schema.TtsRequestObject42a4f93c{Segments: []schema.TtsRequestObject42a4f93cSegmentsItem{
			schema.TtsRequestObject42a4f93cSegmentsItemAsTextVoicec00e1b14{Value: schema.TtsRequestObject42a4f93cSegmentsItemTextVoicec00e1b14{Voice: "alice", Text: "Hello", EmotionBlend: runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeEmotionBlend{Happiness: runtime.Some(4.0)})}},
			schema.TtsRequestObject42a4f93cSegmentsItemAsTextVoicef8490aae{Value: schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aae{Voice: "bob", Text: "{{quiet}}Two", ReferenceEmphasis: runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasis(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasisAsSimilarity{}))}},
		}}},
		schema.TtsRequestAsTextb838f1b5{Value: schema.TtsRequestTextb838f1b5{Text: "[Alice] Hello", TextSplitter: schema.TtsRequestTextb838f1b5TextSplitterAsObject0ad93c7b{Value: schema.TtsRequestText8f38e545TextSplitterObject0ad93c7b{Id: "saved"}}}},
		schema.TtsRequestAsText8f38e545{Value: schema.TtsRequestText8f38e545{Text: "[Alice] Hello", TextSplitter: schema.TtsRequestText8f38e545TextSplitterAsObject2a1f0164{Value: schema.TtsRequestText8f38e545TextSplitterObject2a1f0164{
			Placeholders: []schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItem{
				schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemAsObject87c9e6cd{Value: schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject87c9e6cd{Marker: "[Alice]", Voice: runtime.Some("alice"), Speed: runtime.Some(1.25)}},
				schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemAsObject87c9e6cd{Value: schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject87c9e6cd{Marker: "__proto__", Voice: runtime.Some("bob"), RandomSeed: runtime.Some(0.0)}},
			},
			Brackets: runtime.Some([]schema.TtsRequestText8f38e545TextSplitterObject1611dc76BracketsItem{{Open: "[", Close: "]"}}),
			Fallback: runtime.Some(schema.TtsRequestText8f38e545TextSplitterObject1611dc76Fallback(schema.TtsRequestText8f38e545TextSplitterObject1611dc76FallbackAsObject8e112a71{Value: schema.TtsRequestText8f38e545TextSplitterObject1611dc76FallbackObject8e112a71{Voice: "narrator"}})),
			Lookup: runtime.Some([]schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItem{
				schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemAsObjectdbedc771{Value: schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObjectdbedc771{Tags: []schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1dTagsItem{schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1dTagsItemAsString{Value: "angry"}, schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1dTagsItemAsArray{Value: []string{"Alice", "sad"}}}, EmotionBlend: runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeEmotionBlend{Anger: runtime.Some(5.0)})}},
				schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemAsObjectdbedc771{Value: schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObjectdbedc771{Tags: []schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1dTagsItem{schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1dTagsItemAsString{Value: "quiet"}}, VividExpression: runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeLongTextMode(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeLongTextModeAsFalse{}))}},
			}),
		}}}},
	}
}
