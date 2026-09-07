package vocu

import (
	"errors"
	"strconv"

	schema "github.com/speechswitch/client/sdks/go/generated/vocu"
	"github.com/speechswitch/client/sdks/go/runtime"
)

// Optional binding controls are genuine inherited domain state, not defaults.
type binding struct {
	voice, style, processing runtime.Optional[string]
	delivery                 runtime.Optional[schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeDeliveryMode]
	language                 runtime.Optional[schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeLanguage]
	emotion                  runtime.Optional[schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeEmotionSource]
	blend                    runtime.Optional[schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeEmotionBlend]
	vivid, long              runtime.Optional[schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeLongTextMode]
	speed, seed              runtime.Optional[float64]
	markup                   runtime.Optional[bool]
	emphasis                 runtime.Optional[schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasis]
}

// Called only while resolving the public boundary, after generated validation.
func wireBinding(value any, defaults bool) (map[string]any, error) {
	var b binding
	switch r := value.(type) {
	case *schema.TtsRequestTextVoicee296d426:
		return wireBinding(*r, defaults)
	case *schema.TtsRequestTextVoice2a721534:
		return wireBinding(*r, defaults)
	case *schema.TtsRequestTextVoice9c5ed44a:
		return wireBinding(*r, defaults)
	case *schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aae:
		return wireBinding(*r, defaults)
	case *schema.TtsRequestObject42a4f93cSegmentsItemTextVoicec00e1b14:
		return wireBinding(*r, defaults)
	case *schema.TtsRequestText8f38e545TextSplitterObject1611dc76FallbackObject7f01c485:
		return wireBinding(*r, defaults)
	case *schema.TtsRequestText8f38e545TextSplitterObject1611dc76FallbackObject8e112a71:
		return wireBinding(*r, defaults)
	case *schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1d:
		return wireBinding(*r, defaults)
	case *schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObjectdbedc771:
		return wireBinding(*r, defaults)
	case *schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject50954e5c:
		return wireBinding(*r, defaults)
	case *schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject87c9e6cd:
		return wireBinding(*r, defaults)
	case *schema.TtsRequestObject42a4f93cSegmentsItemAsTextVoicef8490aae:
		return wireBinding(*r, defaults)
	case *schema.TtsRequestObject42a4f93cSegmentsItemAsTextVoicec00e1b14:
		return wireBinding(*r, defaults)
	case *schema.TtsRequestText8f38e545TextSplitterObject1611dc76FallbackAsObject7f01c485:
		return wireBinding(*r, defaults)
	case *schema.TtsRequestText8f38e545TextSplitterObject1611dc76FallbackAsObject8e112a71:
		return wireBinding(*r, defaults)
	case *schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemAsObject943eda1d:
		return wireBinding(*r, defaults)
	case *schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemAsObjectdbedc771:
		return wireBinding(*r, defaults)
	case *schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemAsObject50954e5c:
		return wireBinding(*r, defaults)
	case *schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemAsObject87c9e6cd:
		return wireBinding(*r, defaults)
	case schema.TtsRequestObject42a4f93cSegmentsItemAsTextVoicef8490aae:
		return wireBinding(r.Value, defaults)
	case schema.TtsRequestObject42a4f93cSegmentsItemAsTextVoicec00e1b14:
		return wireBinding(r.Value, defaults)
	case schema.TtsRequestText8f38e545TextSplitterObject1611dc76FallbackAsObject7f01c485:
		return wireBinding(r.Value, defaults)
	case schema.TtsRequestText8f38e545TextSplitterObject1611dc76FallbackAsObject8e112a71:
		return wireBinding(r.Value, defaults)
	case schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemAsObject943eda1d:
		return wireBinding(r.Value, defaults)
	case schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemAsObjectdbedc771:
		return wireBinding(r.Value, defaults)
	case schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemAsObject50954e5c:
		return wireBinding(r.Value, defaults)
	case schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemAsObject87c9e6cd:
		return wireBinding(r.Value, defaults)
	case schema.TtsRequestTextVoicee296d426:
		b = binding{voice: runtime.Some(r.Voice), style: r.VoiceStyle, processing: r.AudioProcessingProfile,
			delivery: r.DeliveryMode, language: r.Language, emotion: r.EmotionSource, blend: r.EmotionBlend,
			vivid: r.VividExpression, long: r.LongTextMode, speed: r.Speed, seed: r.RandomSeed}
		b.markup, b.emphasis = runtime.Some(true), r.ReferenceEmphasis
	case schema.TtsRequestTextVoice2a721534:
		b = binding{voice: runtime.Some(r.Voice), style: r.VoiceStyle, processing: r.AudioProcessingProfile,
			delivery: r.DeliveryMode, language: r.Language, emotion: r.EmotionSource, blend: r.EmotionBlend,
			vivid: r.VividExpression, long: r.LongTextMode, speed: r.Speed, seed: r.RandomSeed}
		if r.InputType.Present {
			b.markup = runtime.Some(false)
		}
	case schema.TtsRequestTextVoice9c5ed44a:
		b = binding{voice: runtime.Some(r.Voice), style: r.VoiceStyle, processing: r.AudioProcessingProfile,
			delivery: r.DeliveryMode, language: r.Language, emotion: r.EmotionSource, blend: r.EmotionBlend,
			vivid: r.VividExpression, long: r.LongTextMode, speed: r.Speed, seed: r.RandomSeed}
		if r.InputType.Present {
			b.markup = runtime.Some(false)
		}
	case schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aae:
		b = binding{voice: runtime.Some(r.Voice), style: r.VoiceStyle, processing: r.AudioProcessingProfile,
			delivery: r.DeliveryMode, language: r.Language, emotion: r.EmotionSource, blend: r.EmotionBlend,
			vivid: r.VividExpression, long: r.LongTextMode, speed: r.Speed, seed: r.RandomSeed}
		b.markup, b.emphasis = runtime.Some(true), r.ReferenceEmphasis
	case schema.TtsRequestObject42a4f93cSegmentsItemTextVoicec00e1b14:
		b = binding{voice: runtime.Some(r.Voice), style: r.VoiceStyle, processing: r.AudioProcessingProfile,
			delivery: r.DeliveryMode, language: r.Language, emotion: r.EmotionSource, blend: r.EmotionBlend,
			vivid: r.VividExpression, long: r.LongTextMode, speed: r.Speed, seed: r.RandomSeed}
		if r.InputType.Present {
			b.markup = runtime.Some(false)
		}
	case schema.TtsRequestText8f38e545TextSplitterObject1611dc76FallbackObject7f01c485:
		b = binding{voice: runtime.Some(r.Voice), style: r.VoiceStyle, processing: r.AudioProcessingProfile,
			delivery: r.DeliveryMode, language: r.Language, emotion: r.EmotionSource, blend: r.EmotionBlend,
			vivid: r.VividExpression, long: r.LongTextMode, speed: r.Speed, seed: r.RandomSeed}
		b.markup, b.emphasis = runtime.Some(true), r.ReferenceEmphasis
	case schema.TtsRequestText8f38e545TextSplitterObject1611dc76FallbackObject8e112a71:
		b = binding{voice: runtime.Some(r.Voice), style: r.VoiceStyle, processing: r.AudioProcessingProfile,
			delivery: r.DeliveryMode, language: r.Language, emotion: r.EmotionSource, blend: r.EmotionBlend,
			vivid: r.VividExpression, long: r.LongTextMode, speed: r.Speed, seed: r.RandomSeed}
		if r.InputType.Present {
			b.markup = runtime.Some(false)
		}
	case schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1d:
		b = binding{voice: r.Voice, style: r.VoiceStyle, processing: r.AudioProcessingProfile,
			delivery: r.DeliveryMode, language: r.Language, emotion: r.EmotionSource, blend: r.EmotionBlend,
			vivid: r.VividExpression, long: r.LongTextMode, speed: r.Speed, seed: r.RandomSeed}
		b.markup, b.emphasis = runtime.Some(true), r.ReferenceEmphasis
	case schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObjectdbedc771:
		b = binding{voice: r.Voice, style: r.VoiceStyle, processing: r.AudioProcessingProfile,
			delivery: r.DeliveryMode, language: r.Language, emotion: r.EmotionSource, blend: r.EmotionBlend,
			vivid: r.VividExpression, long: r.LongTextMode, speed: r.Speed, seed: r.RandomSeed}
		if r.InputType.Present {
			b.markup = runtime.Some(false)
		}
	case schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject50954e5c:
		b = binding{voice: r.Voice, style: r.VoiceStyle, processing: r.AudioProcessingProfile,
			delivery: r.DeliveryMode, language: r.Language, emotion: r.EmotionSource, blend: r.EmotionBlend,
			vivid: r.VividExpression, long: r.LongTextMode, speed: r.Speed, seed: r.RandomSeed}
		b.markup, b.emphasis = runtime.Some(true), r.ReferenceEmphasis
	case schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject87c9e6cd:
		b = binding{voice: r.Voice, style: r.VoiceStyle, processing: r.AudioProcessingProfile,
			delivery: r.DeliveryMode, language: r.Language, emotion: r.EmotionSource, blend: r.EmotionBlend,
			vivid: r.VividExpression, long: r.LongTextMode, speed: r.Speed, seed: r.RandomSeed}
		if r.InputType.Present {
			b.markup = runtime.Some(false)
		}
	default:
		return nil, errors.New("Unsupported generated Vocu binding representation")
	}
	wire := map[string]any{}
	if defaults {
		wire = map[string]any{"promptId": "default", "preset": "balance", "language": "auto", "vivid": false, "speechRate": 1.0, "seed": -1.0}
	}
	if b.voice.Present {
		wire["voiceId"] = b.voice.Value
	}
	if b.style.Present {
		wire["promptId"] = b.style.Value
	}
	if b.processing.Present {
		wire["post_processing"] = b.processing.Value
	}
	if b.delivery.Present {
		preset := b.delivery.Value.LiteralValue()
		if preset == "balanced" {
			preset = "balance"
		}
		wire["preset"] = preset
	}
	if b.language.Present {
		language := b.language.Value.LiteralValue()
		if language == "en-US" {
			language = "en-us"
		} else if language == "fr-FR" {
			language = "fr-fr"
		}
		wire["language"] = language
	}
	if b.emotion.Present {
		wire["break_clone"] = b.emotion.Value.LiteralValue() == "text"
	}
	if b.blend.Present {
		blend := b.blend.Value
		weights := []float64{0, 0, 0, 0, 0}
		for index, weight := range []runtime.Optional[float64]{blend.Anger, blend.Happiness, blend.Neutral, blend.Sadness, blend.Contextual} {
			if weight.Present {
				weights[index] = weight.Value
			}
		}
		wire["emo_switch"] = weights
	}
	if b.vivid.Present {
		wire["vivid"] = b.vivid.Value.LiteralValue()
	}
	if b.long.Present {
		wire["infinite_mode"] = b.long.Value.LiteralValue()
	}
	if b.speed.Present {
		wire["speechRate"] = 1 / b.speed.Value
	}
	if b.seed.Present {
		wire["seed"] = b.seed.Value
	}
	if b.markup.Present {
		wire["instruct_mode"] = b.markup.Value
	}
	if b.emphasis.Present {
		wire["reference_mode"] = b.emphasis.Value.LiteralValue()
	}
	return wire, nil
}

type settings struct {
	payload                 map[string]any
	async, flash, subtitles bool
}

func resolve(request schema.TtsRequest, mode string) (settings, error) {
	var result settings
	var speech any
	var text string
	var splitter any
	var segments []any
	switch r := request.(type) {
	case *schema.TtsRequestAsObject42a4f93c:
		return resolve(*r, mode)
	case *schema.TtsRequestAsObject9cd7c2ee:
		return resolve(*r, mode)
	case *schema.TtsRequestAsTextVoicee296d426:
		return resolve(*r, mode)
	case *schema.TtsRequestAsTextVoice2a721534:
		return resolve(*r, mode)
	case *schema.TtsRequestAsTextVoice9c5ed44a:
		return resolve(*r, mode)
	case *schema.TtsRequestAsText8f38e545:
		return resolve(*r, mode)
	case *schema.TtsRequestAsTextb838f1b5:
		return resolve(*r, mode)
	case schema.TtsRequestAsObject42a4f93c:
		result.async = true
		for _, segment := range r.Value.Segments {
			segments = append(segments, segment)
		}
	case schema.TtsRequestAsObject9cd7c2ee:
		result.async, result.subtitles = true, true
		for _, segment := range r.Value.Segments {
			segments = append(segments, segment)
		}
	case schema.TtsRequestAsTextVoicee296d426:
		speech, text = r.Value, r.Value.Text
		result.flash = r.Value.LatencyOptimization.Present && r.Value.LatencyOptimization.Value.LiteralValue() == "maximum"
	case schema.TtsRequestAsTextVoice2a721534:
		speech, text, result.subtitles = r.Value, r.Value.Text, true
	case schema.TtsRequestAsTextVoice9c5ed44a:
		speech, text = r.Value, r.Value.Text
		result.flash = r.Value.LatencyOptimization.Present && r.Value.LatencyOptimization.Value.LiteralValue() == "maximum"
	case schema.TtsRequestAsText8f38e545:
		result.async, splitter, text = true, r.Value.TextSplitter, r.Value.Text
	case schema.TtsRequestAsTextb838f1b5:
		result.async, result.subtitles, splitter, text = true, true, r.Value.TextSplitter, r.Value.Text
	default:
		return result, errors.New("Unsupported generated Vocu request representation")
	}
	if mode == "" {
		if result.async {
			mode = "async"
		} else {
			mode = "stream"
		}
	}
	if mode != "stream" && mode != "http" && mode != "async" {
		return result, errors.New("Invalid Vocu mode")
	}
	if result.async && mode != "async" {
		return result, errors.New("Vocu segments and text splitting require async synthesis")
	}
	if mode == "async" && result.flash {
		return result, errors.New("Vocu async synthesis does not support flash latency optimization")
	}
	result.async = mode == "async"
	if splitter != nil {
		payload, err := wireSplitter(splitter)
		if err != nil {
			return result, err
		}
		payload["text"], payload["srt"] = text, result.subtitles
		result.payload = payload
		return result, nil
	}
	if segments != nil {
		contents := make([]map[string]any, 0, len(segments))
		for _, segment := range segments {
			wire, err := wireSegment(segment)
			if err != nil {
				return result, err
			}
			contents = append(contents, wire)
		}
		result.payload = map[string]any{"contents": contents, "srt": result.subtitles}
		return result, nil
	}
	wire, err := wireBinding(speech, true)
	if err != nil {
		return result, err
	}
	wire["text"] = text
	if result.async {
		wire["type"] = "text"
		result.payload = map[string]any{"contents": []map[string]any{wire}, "srt": result.subtitles}
	} else {
		wire["flash"], wire["srt"], wire["stream"], wire["direct_stream"] = result.flash, result.subtitles, true, mode == "stream"
		result.payload = wire
	}
	return result, nil
}

func wireSegment(value any) (map[string]any, error) {
	var text string
	switch r := value.(type) {
	case *schema.TtsRequestObject42a4f93cSegmentsItemAsTextVoicef8490aae:
		return wireSegment(*r)
	case *schema.TtsRequestObject42a4f93cSegmentsItemAsTextVoicec00e1b14:
		return wireSegment(*r)
	case schema.TtsRequestObject42a4f93cSegmentsItemAsTextVoicef8490aae:
		return wireSegment(r.Value)
	case schema.TtsRequestObject42a4f93cSegmentsItemAsTextVoicec00e1b14:
		return wireSegment(r.Value)
	case schema.TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aae:
		text = r.Text
	case schema.TtsRequestObject42a4f93cSegmentsItemTextVoicec00e1b14:
		text = r.Text
	default:
		return nil, errors.New("Unsupported generated Vocu segment representation")
	}
	wire, err := wireBinding(value, true)
	if err != nil {
		return nil, err
	}
	wire["text"], wire["type"] = text, "text"
	return wire, nil
}

func wireSplitter(value any) (map[string]any, error) {
	var brackets runtime.Optional[[]schema.TtsRequestText8f38e545TextSplitterObject1611dc76BracketsItem]
	var fallback any
	var placeholders, lookup []any
	var hasPlaceholders, hasLookup bool
	switch r := value.(type) {
	case *schema.TtsRequestText8f38e545TextSplitterAsObject1611dc76:
		return wireSplitter(*r)
	case schema.TtsRequestText8f38e545TextSplitterAsObject1611dc76:
		return wireSplitter(r.Value)
	case *schema.TtsRequestText8f38e545TextSplitterAsObjectda2887fb:
		return wireSplitter(*r)
	case schema.TtsRequestText8f38e545TextSplitterAsObjectda2887fb:
		return wireSplitter(r.Value)
	case *schema.TtsRequestText8f38e545TextSplitterAsObject2a1f0164:
		return wireSplitter(*r)
	case schema.TtsRequestText8f38e545TextSplitterAsObject2a1f0164:
		return wireSplitter(r.Value)
	case *schema.TtsRequestText8f38e545TextSplitterAsObject0ad93c7b:
		return wireSplitter(*r)
	case schema.TtsRequestText8f38e545TextSplitterAsObject0ad93c7b:
		return wireSplitter(r.Value)
	case *schema.TtsRequestTextb838f1b5TextSplitterAsObject0ad93c7b:
		return wireSplitter(*r)
	case schema.TtsRequestTextb838f1b5TextSplitterAsObject0ad93c7b:
		return wireSplitter(r.Value)
	case *schema.TtsRequestTextb838f1b5TextSplitterAsObjectc0dd7752:
		return wireSplitter(*r)
	case schema.TtsRequestTextb838f1b5TextSplitterAsObjectc0dd7752:
		return wireSplitter(r.Value)
	case *schema.TtsRequestTextb838f1b5TextSplitterAsObject6b7b3424:
		return wireSplitter(*r)
	case schema.TtsRequestTextb838f1b5TextSplitterAsObject6b7b3424:
		return wireSplitter(r.Value)
	case *schema.TtsRequestTextb838f1b5TextSplitterAsObject94322b13:
		return wireSplitter(*r)
	case schema.TtsRequestTextb838f1b5TextSplitterAsObject94322b13:
		return wireSplitter(r.Value)
	case schema.TtsRequestText8f38e545TextSplitterObject1611dc76:
		brackets = runtime.Some(r.Brackets)
		if r.Fallback.Present {
			fallback = r.Fallback.Value
		}
		hasPlaceholders = r.Placeholders.Present
		for _, p := range r.Placeholders.Value {
			placeholders = append(placeholders, p)
		}
		hasLookup = r.Lookup.Present
		for _, l := range r.Lookup.Value {
			lookup = append(lookup, l)
		}
	case schema.TtsRequestText8f38e545TextSplitterObjectda2887fb:
		brackets = r.Brackets
		fallback = r.Fallback
		hasPlaceholders = r.Placeholders.Present
		for _, p := range r.Placeholders.Value {
			placeholders = append(placeholders, p)
		}
		hasLookup = r.Lookup.Present
		for _, l := range r.Lookup.Value {
			lookup = append(lookup, l)
		}
	case schema.TtsRequestText8f38e545TextSplitterObject2a1f0164:
		brackets = r.Brackets
		if r.Fallback.Present {
			fallback = r.Fallback.Value
		}
		hasPlaceholders = true
		for _, p := range r.Placeholders {
			placeholders = append(placeholders, p)
		}
		hasLookup = r.Lookup.Present
		for _, l := range r.Lookup.Value {
			lookup = append(lookup, l)
		}
	case schema.TtsRequestText8f38e545TextSplitterObject0ad93c7b:
		return map[string]any{"splitterId": r.Id}, nil
	case schema.TtsRequestTextb838f1b5TextSplitterObjectc0dd7752:
		brackets = runtime.Some(r.Brackets)
		if r.Fallback.Present {
			fallback = r.Fallback.Value
		}
		hasPlaceholders = r.Placeholders.Present
		for _, p := range r.Placeholders.Value {
			placeholders = append(placeholders, p)
		}
		hasLookup = r.Lookup.Present
		for _, l := range r.Lookup.Value {
			lookup = append(lookup, l)
		}
	case schema.TtsRequestTextb838f1b5TextSplitterObject6b7b3424:
		brackets = r.Brackets
		fallback = r.Fallback
		hasPlaceholders = r.Placeholders.Present
		for _, p := range r.Placeholders.Value {
			placeholders = append(placeholders, p)
		}
		hasLookup = r.Lookup.Present
		for _, l := range r.Lookup.Value {
			lookup = append(lookup, l)
		}
	case schema.TtsRequestTextb838f1b5TextSplitterObject94322b13:
		brackets = r.Brackets
		if r.Fallback.Present {
			fallback = r.Fallback.Value
		}
		hasPlaceholders = true
		for _, p := range r.Placeholders {
			placeholders = append(placeholders, p)
		}
		hasLookup = r.Lookup.Present
		for _, l := range r.Lookup.Value {
			lookup = append(lookup, l)
		}
	default:
		return nil, errors.New("Unsupported generated Vocu splitter representation")
	}
	native := orderedObject{}
	markers := map[string]bool{}
	if hasPlaceholders {
		for _, rule := range placeholders {
			marker, _, wire, err := wireRule(rule)
			if err != nil {
				return nil, err
			}
			if markers[marker] || marker == "splitterMarks" || marker == "lookupTable" || marker == "fallbackConfig" {
				return nil, errors.New("Vocu splitter markers must be unique and cannot use reserved protocol keys")
			}
			markers[marker] = true
			native = append(native, wireEntry{marker, wire})
		}
	}
	if brackets.Present {
		marks := make([]string, 0, len(brackets.Value))
		for _, pair := range brackets.Value {
			marks = append(marks, pair.Open+pair.Close)
		}
		native = append(native, wireEntry{"splitterMarks", marks})
	}
	if fallback != nil {
		wire, err := wireBinding(fallback, false)
		if err != nil {
			return nil, err
		}
		native = append(native, wireEntry{"fallbackConfig", wire})
	}
	if hasLookup {
		table := orderedObject{}
		for index, rule := range lookup {
			_, tags, wire, err := wireRule(rule)
			if err != nil {
				return nil, err
			}
			wire["tags"] = tags
			table = append(table, wireEntry{"entry" + strconv.Itoa(index), wire})
		}
		native = append(native, wireEntry{"lookupTable", table})
	}
	return map[string]any{"splitter": native}, nil
}

func wireRule(value any) (string, []any, map[string]any, error) {
	var marker string
	var tags []schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1dTagsItem
	switch r := value.(type) {
	case *schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemAsObject943eda1d:
		return wireRule(*r)
	case schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemAsObject943eda1d:
		return wireRule(r.Value)
	case *schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemAsObjectdbedc771:
		return wireRule(*r)
	case schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemAsObjectdbedc771:
		return wireRule(r.Value)
	case *schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemAsObject50954e5c:
		return wireRule(*r)
	case schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemAsObject50954e5c:
		return wireRule(r.Value)
	case *schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemAsObject87c9e6cd:
		return wireRule(*r)
	case schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemAsObject87c9e6cd:
		return wireRule(r.Value)
	case schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1d:
		tags = r.Tags
	case schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObjectdbedc771:
		tags = r.Tags
	case schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject50954e5c:
		marker = r.Marker
	case schema.TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject87c9e6cd:
		marker = r.Marker
	default:
		return "", nil, nil, errors.New("Unsupported generated Vocu splitter rule representation")
	}
	wire, err := wireBinding(value, false)
	if err != nil {
		return "", nil, nil, err
	}
	native := make([]any, 0, len(tags))
	for _, tag := range tags {
		switch t := tag.(type) {
		case schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1dTagsItemAsString:
			native = append(native, t.Value)
		case *schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1dTagsItemAsString:
			native = append(native, t.Value)
		case schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1dTagsItemAsArray:
			native = append(native, append([]string{}, t.Value...))
		case *schema.TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1dTagsItemAsArray:
			native = append(native, append([]string{}, t.Value...))
		default:
			return "", nil, nil, errors.New("Unsupported generated Vocu tag representation")
		}
	}
	return marker, native, wire, nil
}
