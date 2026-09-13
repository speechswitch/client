package vocu

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"testing"

	schema "github.com/speechswitch/client/sdks/go/generated/vocu"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func objectKeys(t *testing.T, data []byte) []string {
	t.Helper()
	decoder := json.NewDecoder(bytes.NewReader(data))
	start, err := decoder.Token()
	equal(t, err, nil)
	equal(t, start, json.Delim('{'))
	keys := []string{}
	for decoder.More() {
		key, err := decoder.Token()
		equal(t, err, nil)
		keys = append(keys, key.(string))
		var value json.RawMessage
		equal(t, decoder.Decode(&value), nil)
	}
	end, err := decoder.Token()
	equal(t, err, nil)
	equal(t, end, json.Delim('}'))
	return keys
}

func TestSplitterWireRetainsRuleOrderBeyondTenEntries(t *testing.T) {
	lookup := []schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItem{}
	for index := 0; index < 12; index++ {
		lookup = append(lookup, schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemAsObjectdbedc771{
			Value: schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObjectdbedc771{
				Tags: []schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1dTagsItem{
					schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1dTagsItemAsString{Value: "tag"},
				},
			},
		})
	}
	request := schema.TtsRequestAsText8f38e545{Value: schema.TtsRequestText8f38e545{Text: "hi", TextSplitter: schema.TtsRequestText8f38e545TextSplitterAsObject2a1f0164{Value: schema.TtsRequestText8f38e545TextSplitterObject2a1f0164{
		Placeholders: []schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItem{
			schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemAsObject87c9e6cd{Value: schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject87c9e6cd{Marker: "[z]", Voice: runtime.Some("z")}},
			schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemAsObject87c9e6cd{Value: schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject87c9e6cd{Marker: "[a]", Voice: runtime.Some("a")}},
		}, Lookup: runtime.Some(lookup),
	}}}}
	o := Options{Auth: authConfig(), Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
		var root map[string]json.RawMessage
		equal(t, json.NewDecoder(r.Body).Decode(&root), nil)
		var splitter map[string]json.RawMessage
		equal(t, json.Unmarshal(root["splitter"], &splitter), nil)
		equal(t, objectKeys(t, splitter["lookupTable"]), []string{"entry0", "entry1", "entry2", "entry3", "entry4", "entry5", "entry6", "entry7", "entry8", "entry9", "entry10", "entry11"})
		equal(t, objectKeys(t, root["splitter"]), []string{"[z]", "[a]", "lookupTable"})
		return metadata(t, native(t, shared(t).GeneratedJob)), nil
	})}
	s, err := Synthesize(context.Background(), request, o)
	if err != nil {
		t.Fatal(err)
	}
	s.Close()
}

func decodeRequest(request *http.Request) (any, error) {
	var value any
	err := json.NewDecoder(request.Body).Decode(&value)
	return value, err
}

func TestEveryInlineSplitterAlternative(t *testing.T) {
	requests := []schema.TtsRequest{
		schema.TtsRequestAsText8f38e545{Value: schema.TtsRequestText8f38e545{Text: "[A] hi", TextSplitter: schema.TtsRequestText8f38e545TextSplitterAsObject1611dc76{Value: schema.TtsRequestText8f38e545TextSplitterObject1611dc76{
			Brackets:     []schema.TtsRequestText8f38e545TextSplitterObject1611dc76BracketsItem{{Open: "[", Close: "]"}},
			Fallback:     runtime.Some(schema.TtsRequestText8f38e545TextSplitterObject1611dc76Fallback(schema.TtsRequestText8f38e545TextSplitterObject1611dc76FallbackAsObject7f01c485{Value: schema.TtsRequestText8f38e545TextSplitterObject1611dc76FallbackObject7f01c485{Voice: "narrator", ReferenceEmphasis: runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasis(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasisAsBalanced{}))}})),
			Placeholders: runtime.Some([]schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItem{schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemAsObject50954e5c{Value: schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject50954e5c{Marker: "[A]", Voice: runtime.Some("alice"), ReferenceEmphasis: runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasis(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasisAsBalanced{}))}}}),
			Lookup:       runtime.Some([]schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItem{schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemAsObject943eda1d{Value: schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1d{Tags: []schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1dTagsItem{schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1dTagsItemAsString{Value: "tag"}}, ReferenceEmphasis: runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasis(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasisAsBalanced{}))}}}),
		}}}},
		schema.TtsRequestAsText8f38e545{Value: schema.TtsRequestText8f38e545{Text: "[A] hi", TextSplitter: schema.TtsRequestText8f38e545TextSplitterAsObjectda2887fb{Value: schema.TtsRequestText8f38e545TextSplitterObjectda2887fb{
			Brackets:     runtime.Some([]schema.TtsRequestText8f38e545TextSplitterObject1611dc76BracketsItem{{Open: "[", Close: "]"}}),
			Fallback:     schema.TtsRequestText8f38e545TextSplitterObject1611dc76Fallback(schema.TtsRequestText8f38e545TextSplitterObject1611dc76FallbackAsObject7f01c485{Value: schema.TtsRequestText8f38e545TextSplitterObject1611dc76FallbackObject7f01c485{Voice: "narrator", ReferenceEmphasis: runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasis(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasisAsBalanced{}))}}),
			Placeholders: runtime.Some([]schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItem{schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemAsObject50954e5c{Value: schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject50954e5c{Marker: "[A]", Voice: runtime.Some("alice"), ReferenceEmphasis: runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasis(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasisAsBalanced{}))}}}),
			Lookup:       runtime.Some([]schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItem{schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemAsObject943eda1d{Value: schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1d{Tags: []schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1dTagsItem{schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1dTagsItemAsString{Value: "tag"}}, ReferenceEmphasis: runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasis(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasisAsBalanced{}))}}}),
		}}}},
		schema.TtsRequestAsText8f38e545{Value: schema.TtsRequestText8f38e545{Text: "[A] hi", TextSplitter: schema.TtsRequestText8f38e545TextSplitterAsObject2a1f0164{Value: schema.TtsRequestText8f38e545TextSplitterObject2a1f0164{
			Brackets:     runtime.Some([]schema.TtsRequestText8f38e545TextSplitterObject1611dc76BracketsItem{{Open: "[", Close: "]"}}),
			Fallback:     runtime.Some(schema.TtsRequestText8f38e545TextSplitterObject1611dc76Fallback(schema.TtsRequestText8f38e545TextSplitterObject1611dc76FallbackAsObject7f01c485{Value: schema.TtsRequestText8f38e545TextSplitterObject1611dc76FallbackObject7f01c485{Voice: "narrator", ReferenceEmphasis: runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasis(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasisAsBalanced{}))}})),
			Placeholders: []schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItem{schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemAsObject50954e5c{Value: schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject50954e5c{Marker: "[A]", Voice: runtime.Some("alice"), ReferenceEmphasis: runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasis(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasisAsBalanced{}))}}},
			Lookup:       runtime.Some([]schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItem{schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemAsObject943eda1d{Value: schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1d{Tags: []schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1dTagsItem{schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1dTagsItemAsString{Value: "tag"}}, ReferenceEmphasis: runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasis(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasisAsBalanced{}))}}}),
		}}}},
		schema.TtsRequestAsTextb838f1b5{Value: schema.TtsRequestTextb838f1b5{Text: "[A] hi", TextSplitter: schema.TtsRequestTextb838f1b5TextSplitterAsObjectc0dd7752{Value: schema.TtsRequestTextb838f1b5TextSplitterObjectc0dd7752{
			Brackets:     []schema.TtsRequestText8f38e545TextSplitterObject1611dc76BracketsItem{{Open: "[", Close: "]"}},
			Fallback:     runtime.Some(schema.TtsRequestText8f38e545TextSplitterObject1611dc76FallbackObject8e112a71{Voice: "narrator", InputType: runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeEmotionSourceText{})}),
			Placeholders: runtime.Some([]schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject87c9e6cd{schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject87c9e6cd{Marker: "[A]", Voice: runtime.Some("alice"), InputType: runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeEmotionSourceText{})}}),
			Lookup:       runtime.Some([]schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObjectdbedc771{schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObjectdbedc771{Tags: []schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1dTagsItem{schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1dTagsItemAsString{Value: "tag"}}, InputType: runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeEmotionSourceText{})}}),
		}}}},
		schema.TtsRequestAsTextb838f1b5{Value: schema.TtsRequestTextb838f1b5{Text: "[A] hi", TextSplitter: schema.TtsRequestTextb838f1b5TextSplitterAsObject6b7b3424{Value: schema.TtsRequestTextb838f1b5TextSplitterObject6b7b3424{
			Brackets:     runtime.Some([]schema.TtsRequestText8f38e545TextSplitterObject1611dc76BracketsItem{{Open: "[", Close: "]"}}),
			Fallback:     schema.TtsRequestText8f38e545TextSplitterObject1611dc76FallbackObject8e112a71{Voice: "narrator", InputType: runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeEmotionSourceText{})},
			Placeholders: runtime.Some([]schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject87c9e6cd{schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject87c9e6cd{Marker: "[A]", Voice: runtime.Some("alice"), InputType: runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeEmotionSourceText{})}}),
			Lookup:       runtime.Some([]schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObjectdbedc771{schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObjectdbedc771{Tags: []schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1dTagsItem{schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1dTagsItemAsString{Value: "tag"}}, InputType: runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeEmotionSourceText{})}}),
		}}}},
		schema.TtsRequestAsTextb838f1b5{Value: schema.TtsRequestTextb838f1b5{Text: "[A] hi", TextSplitter: schema.TtsRequestTextb838f1b5TextSplitterAsObject94322b13{Value: schema.TtsRequestTextb838f1b5TextSplitterObject94322b13{
			Brackets:     runtime.Some([]schema.TtsRequestText8f38e545TextSplitterObject1611dc76BracketsItem{{Open: "[", Close: "]"}}),
			Fallback:     runtime.Some(schema.TtsRequestText8f38e545TextSplitterObject1611dc76FallbackObject8e112a71{Voice: "narrator", InputType: runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeEmotionSourceText{})}),
			Placeholders: []schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject87c9e6cd{schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject87c9e6cd{Marker: "[A]", Voice: runtime.Some("alice"), InputType: runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeEmotionSourceText{})}},
			Lookup:       runtime.Some([]schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObjectdbedc771{schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObjectdbedc771{Tags: []schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1dTagsItem{schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1dTagsItemAsString{Value: "tag"}}, InputType: runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeEmotionSourceText{})}}),
		}}}},
	}
	for index, r := range requests {
		var payload any
		calls := 0
		o := Options{Auth: authConfig(), Transport: transportFunc(func(request *http.Request) (*http.Response, error) {
			calls++
			if calls == 1 {
				var err error
				payload, err = decodeRequest(request)
				if err != nil {
					t.Fatal(err)
				}
				return metadata(t, native(t, shared(t).GeneratedJob)), nil
			}
			return response(newBody(step{data: []byte{1}})), nil
		})}
		s, err := Synthesize(context.Background(), r, o)
		if err != nil {
			t.Fatal(err)
		}
		_, err = collect(t, s)
		equal(t, err, nil)
		equal(t, calls, 2)
		subtitles := index >= 3
		placeholder := map[string]any{"voiceId": "alice", "instruct_mode": !subtitles}
		fallback := map[string]any{"voiceId": "narrator", "instruct_mode": !subtitles}
		lookup := map[string]any{"tags": []any{"tag"}, "instruct_mode": !subtitles}
		if !subtitles {
			placeholder["reference_mode"] = "balanced"
			fallback["reference_mode"] = "balanced"
			lookup["reference_mode"] = "balanced"
		}
		equal(t, payload, map[string]any{"text": "[A] hi", "srt": subtitles, "splitter": map[string]any{
			"[A]": placeholder, "fallbackConfig": fallback, "splitterMarks": []any{"[]"}, "lookupTable": map[string]any{"entry0": lookup},
		}})
	}
}

func TestReservedAndDuplicateSplitterMarkers(t *testing.T) {
	for _, marker := range []string{"splitterMarks", "lookupTable", "fallbackConfig", "duplicate"} {
		request := schema.TtsRequestAsText8f38e545{Value: schema.TtsRequestText8f38e545{Text: "Hello", TextSplitter: schema.TtsRequestText8f38e545TextSplitterAsObject2a1f0164{Value: schema.TtsRequestText8f38e545TextSplitterObject2a1f0164{Placeholders: []schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItem{
			schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemAsObject87c9e6cd{Value: schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject87c9e6cd{Marker: marker, Voice: runtime.Some("a")}},
			schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemAsObject87c9e6cd{Value: schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject87c9e6cd{Marker: marker, Voice: runtime.Some("b")}},
		}}}}}
		s, err := Synthesize(context.Background(), request, options())
		equal(t, s, nil)
		if err == nil {
			t.Fatal("collision accepted")
		}
		equal(t, err.Error(), "Vocu splitter markers must be unique and cannot use reserved protocol keys")
	}
}

func TestBatchSubtitlesAndSavedAudioSplitter(t *testing.T) {
	batch := schema.TtsRequestAsObject9cd7c2ee{Value: schema.TtsRequestObject9cd7c2ee{Segments: []schema.TtsRequestObject42a4f93cSegmentsItemTextVoicec00e1b14{
		{Voice: "a", Text: "Hello", InputType: runtime.Some(schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeEmotionSourceText{})},
	}}}
	saved := schema.TtsRequestAsText8f38e545{Value: schema.TtsRequestText8f38e545{Text: "[A] hi", TextSplitter: schema.TtsRequestText8f38e545TextSplitterAsObject0ad93c7b{Value: schema.TtsRequestText8f38e545TextSplitterObject0ad93c7b{Id: "saved"}}}}
	for index, r := range []schema.TtsRequest{batch, saved} {
		var payload any
		calls := 0
		o := Options{Auth: authConfig(), Transport: transportFunc(func(request *http.Request) (*http.Response, error) {
			calls++
			if calls == 1 {
				var err error
				payload, err = decodeRequest(request)
				if err != nil {
					t.Fatal(err)
				}
				return metadata(t, native(t, shared(t).GeneratedJob)), nil
			}
			return response(newBody(step{data: []byte{1}})), nil
		})}
		s, err := Synthesize(context.Background(), r, o)
		if err != nil {
			t.Fatal(err)
		}
		_, err = collect(t, s)
		equal(t, err, nil)
		var expected any = map[string]any{"text": "[A] hi", "splitterId": "saved", "srt": false}
		if index == 0 {
			expected = map[string]any{"contents": []any{map[string]any{"type": "text", "text": "Hello", "voiceId": "a", "promptId": "default", "preset": "balance", "language": "auto", "vivid": false, "speechRate": float64(1), "seed": float64(-1), "instruct_mode": false}}, "srt": true}
		}
		equal(t, payload, expected)
	}
}
