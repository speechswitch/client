use crate::generated::vocu::*;
pub(super) fn plain() -> TtsRequestTextVoice9c5ed44a {
    TtsRequestTextVoice9c5ed44a {
        audio_processing_profile: None,
        delivery_mode: None,
        emotion_blend: None,
        emotion_source: None,
        language: None,
        long_text_mode: None,
        random_seed: None,
        speed: None,
        vivid_expression: None,
        voice_style: None,
        voice: "market:owned".into(),
        input_type: None,
        text: "Hello".into(),
        output: None,
        latency_optimization: None,
    }
}
pub(super) fn markup() -> TtsRequestTextVoicee296d426 {
    TtsRequestTextVoicee296d426 {
        audio_processing_profile: None,
        delivery_mode: None,
        emotion_blend: None,
        emotion_source: None,
        language: None,
        long_text_mode: None,
        random_seed: None,
        speed: None,
        vivid_expression: None,
        voice_style: None,
        voice: "market:owned".into(),
        input_type: Default::default(),
        reference_emphasis: None,
        text: "Hello".into(),
        output: None,
        latency_optimization: None,
    }
}
pub(super) fn subtitles() -> TtsRequestTextVoice2a721534 {
    TtsRequestTextVoice2a721534 {
        audio_processing_profile: None,
        delivery_mode: None,
        emotion_blend: None,
        emotion_source: None,
        language: None,
        long_text_mode: None,
        random_seed: None,
        speed: None,
        vivid_expression: None,
        voice_style: None,
        voice: "market:owned".into(),
        input_type: None,
        text: "Hello".into(),
        subtitle_format: Default::default(),
        output: None,
        latency_optimization: None,
    }
}
pub(super) fn segment() -> TtsRequestObject42a4f93cSegmentsItemTextVoicec00e1b14 {
    TtsRequestObject42a4f93cSegmentsItemTextVoicec00e1b14 {
        audio_processing_profile: None,
        delivery_mode: None,
        emotion_blend: None,
        emotion_source: None,
        language: None,
        long_text_mode: None,
        random_seed: None,
        speed: None,
        vivid_expression: None,
        voice_style: None,
        voice: "market:owned".into(),
        input_type: None,
        text: "Hello".into(),
        kind: Default::default(),
    }
}
pub(super) fn marked_segment() -> TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aae {
    TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aae {
        audio_processing_profile: None,
        delivery_mode: None,
        emotion_blend: None,
        emotion_source: None,
        language: None,
        long_text_mode: None,
        random_seed: None,
        speed: None,
        vivid_expression: None,
        voice_style: None,
        voice: "market:owned".into(),
        input_type: Default::default(),
        reference_emphasis: None,
        text: "Hello".into(),
        kind: Default::default(),
    }
}
pub(super) fn fallback() -> TtsRequestText8f38e545TextSplitterObject1611dc76FallbackObject8e112a71 {
    TtsRequestText8f38e545TextSplitterObject1611dc76FallbackObject8e112a71 {
        audio_processing_profile: None,
        delivery_mode: None,
        emotion_blend: None,
        emotion_source: None,
        language: None,
        long_text_mode: None,
        random_seed: None,
        speed: None,
        vivid_expression: None,
        voice_style: None,
        voice: "market:owned".into(),
        input_type: None,
    }
}
pub(super) fn marked_fallback(
) -> TtsRequestText8f38e545TextSplitterObject1611dc76FallbackObject7f01c485 {
    TtsRequestText8f38e545TextSplitterObject1611dc76FallbackObject7f01c485 {
        audio_processing_profile: None,
        delivery_mode: None,
        emotion_blend: None,
        emotion_source: None,
        language: None,
        long_text_mode: None,
        random_seed: None,
        speed: None,
        vivid_expression: None,
        voice_style: None,
        voice: "market:owned".into(),
        input_type: Default::default(),
        reference_emphasis: None,
    }
}
pub(super) fn placeholder(
) -> TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject87c9e6cd {
    TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject87c9e6cd {
        audio_processing_profile: None,
        delivery_mode: None,
        emotion_blend: None,
        emotion_source: None,
        language: None,
        long_text_mode: None,
        random_seed: None,
        speed: None,
        vivid_expression: None,
        voice_style: None,
        voice: None,
        input_type: None,
        marker: "[A]".into(),
    }
}
pub(super) fn marked_placeholder(
) -> TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject50954e5c {
    TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject50954e5c {
        audio_processing_profile: None,
        delivery_mode: None,
        emotion_blend: None,
        emotion_source: None,
        language: None,
        long_text_mode: None,
        random_seed: None,
        speed: None,
        vivid_expression: None,
        voice_style: None,
        voice: None,
        input_type: Default::default(),
        reference_emphasis: None,
        marker: "[A]".into(),
    }
}
pub(super) fn lookup() -> TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObjectdbedc771 {
    TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObjectdbedc771{
audio_processing_profile:None,
delivery_mode:None,
emotion_blend:None,
emotion_source:None,
language:None,
long_text_mode:None,
random_seed:None,
speed:None,
vivid_expression:None,
voice_style:None,
voice:None,input_type:None,
tags:vec![TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1dTagsItem::String("tag".into())],
}
}
pub(super) fn marked_lookup(
) -> TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1d {
    TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1d{
audio_processing_profile:None,
delivery_mode:None,
emotion_blend:None,
emotion_source:None,
language:None,
long_text_mode:None,
random_seed:None,
speed:None,
vivid_expression:None,
voice_style:None,
voice:None,input_type:Default::default(),
reference_emphasis:None,
tags:vec![TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1dTagsItem::String("tag".into())],
}
}

pub(super) fn requests() -> Vec<TtsRequest> {
    let mut controls = plain();
    controls.voice = "custom".into();
    controls.voice_style = Some("my-style".into());
    controls.speed = Some(2.0);
    controls.random_seed = Some(0.0);
    controls.language = Some(
        TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeLanguage::EnUS(Default::default()),
    );
    controls.delivery_mode = Some(
        TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeDeliveryMode::Stable(
            Default::default(),
        ),
    );
    controls.emotion_source = Some(
        TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeEmotionSource::Voice(
            Default::default(),
        ),
    );
    controls.vivid_expression = Some(
        TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeLongTextMode::False(Default::default()),
    );
    controls.emotion_blend = Some(
        TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeEmotionBlend {
            anger: Some(5.0),
            happiness: None,
            neutral: None,
            sadness: Some(2.0),
            contextual: Some(0.0),
        },
    );
    controls.long_text_mode = Some(
        TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeLongTextMode::False(Default::default()),
    );
    controls.audio_processing_profile = Some("chain".into());
    controls.latency_optimization = Some(TtsRequestTextVoicee296d426LatencyOptimization::Maximum(
        Default::default(),
    ));
    let mut marked = markup();
    marked.voice = "custom".into();
    marked.text = "{{happy}}Bonjour".into();
    marked.speed = Some(0.5);
    marked.language = Some(
        TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeLanguage::FrFR(Default::default()),
    );
    marked.emotion_source = Some(
        TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeEmotionSource::Text(Default::default()),
    );
    marked.reference_emphasis = Some(
        TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasis::Expressive(
            Default::default(),
        ),
    );
    let mut single = subtitles();
    single.voice = "custom".into();
    let mut alice = segment();
    alice.voice = "alice".into();
    alice.emotion_blend = Some(
        TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeEmotionBlend {
            anger: None,
            happiness: Some(4.0),
            neutral: None,
            sadness: None,
            contextual: None,
        },
    );
    let mut bob = marked_segment();
    bob.voice = "bob".into();
    bob.text = "{{quiet}}Two".into();
    bob.reference_emphasis = Some(
        TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasis::Similarity(
            Default::default(),
        ),
    );
    let mut marker = placeholder();
    marker.marker = "[Alice]".into();
    marker.voice = Some("alice".into());
    marker.speed = Some(1.25);
    let mut proto = placeholder();
    proto.marker = "__proto__".into();
    proto.voice = Some("bob".into());
    proto.random_seed = Some(0.0);
    let mut fallback = fallback();
    fallback.voice = "narrator".into();
    let mut anger = lookup();
    anger.tags = vec![
        TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1dTagsItem::String(
            "angry".into(),
        ),
        TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1dTagsItem::Array(
            vec!["Alice".into(), "sad".into()],
        ),
    ];
    anger.emotion_blend = Some(
        TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeEmotionBlend {
            anger: Some(5.0),
            happiness: None,
            neutral: None,
            sadness: None,
            contextual: None,
        },
    );
    let mut quiet = lookup();
    quiet.tags = vec![
        TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1dTagsItem::String(
            "quiet".into(),
        ),
    ];
    quiet.vivid_expression = Some(
        TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeLongTextMode::False(Default::default()),
    );
    vec![
 TtsRequest::TextVoice9c5ed44a(plain()),
 TtsRequest::TextVoice9c5ed44a(controls),
 TtsRequest::TextVoicee296d426(marked),
 TtsRequest::TextVoice2a721534(single),
 TtsRequest::Object42a4f93c(TtsRequestObject42a4f93c{output:None,segments:vec![TtsRequestObject42a4f93cSegmentsItem::TextVoicec00e1b14(alice),TtsRequestObject42a4f93cSegmentsItem::TextVoicef8490aae(bob)]}),
 TtsRequest::Textb838f1b5(TtsRequestTextb838f1b5{output:None,subtitle_format:Default::default(),text:"[Alice] Hello".into(),text_splitter:TtsRequestTextb838f1b5TextSplitter::Object0ad93c7b(TtsRequestText8f38e545TextSplitterObject0ad93c7b{id:"saved".into()})}),
 TtsRequest::Text8f38e545(TtsRequestText8f38e545{output:None,text:"[Alice] Hello".into(),text_splitter:TtsRequestText8f38e545TextSplitter::Object2a1f0164(TtsRequestText8f38e545TextSplitterObject2a1f0164{
 brackets:Some(vec![TtsRequestText8f38e545TextSplitterObject1611dc76BracketsItem{open:"[".into(),close:"]".into()}]),
 placeholders:vec![TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItem::Object87c9e6cd(marker),TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItem::Object87c9e6cd(proto)],
 fallback:Some(TtsRequestText8f38e545TextSplitterObject1611dc76Fallback::Object8e112a71(fallback)),
 lookup:Some(vec![TtsRequestText8f38e545TextSplitterObject1611dc76LookupItem::Objectdbedc771(anger),TtsRequestText8f38e545TextSplitterObject1611dc76LookupItem::Objectdbedc771(quiet)]),
 })}),
 ]
}
