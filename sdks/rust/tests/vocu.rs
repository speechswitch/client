use speechswitch_types::generated::vocu;

#[test]
fn markup_preserves_existing_voice_and_zero_seed() {
    let request = vocu::TtsRequestTextVoicee296d426 {
        text: "{{happy}}Hello".into(), voice: "market:owned".into(), input_type: Default::default(),
        voice_style: Some("existing-style".into()), random_seed: Some(0.0),
        vivid_expression: Some(vocu::TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeLongTextMode::False(Default::default())),
        audio_processing_profile: None, delivery_mode: None, emotion_blend: None, emotion_source: None,
        language: None, latency_optimization: None, long_text_mode: None, output: None, reference_emphasis: None, speed: None,
    };
    assert_eq!(request.input_type.value(), "markup");
    assert_eq!(request.voice, "market:owned");
    assert_eq!(request.voice_style.as_deref(), Some("existing-style"));
    assert_eq!(request.random_seed, Some(0.0));
    assert!(matches!(request.vivid_expression, Some(vocu::TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeLongTextMode::False(_))));
}
