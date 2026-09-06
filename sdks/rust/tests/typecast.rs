use speechswitch_types::generated::typecast;

#[test]
fn smart_emotion_preserves_explicit_empty_context_and_zero_loudness() {
    let request = typecast::TtsRequestSsfmV30TextVoicebb79df90 {
        model: Default::default(), emotion: Default::default(), text: "Hello".into(), voice: "uc_voice".into(),
        context_before: Some(typecast::TtsRequestObjectSegmentsItemSsfmV30TextVoice0e2e956cContextAfter { text: String::new() }),
        context_after: None, language: None, output: None, pitch_semitones: None,
        random_seed: Some(0.0), speed: None, target_loudness_lufs: Some(0.0),
    };
    assert_eq!(request.model.value(), "ssfm-v30");
    assert_eq!(request.emotion.value(), "auto");
    assert_eq!(request.context_before.map(|value| value.text), Some(String::new()));
    assert_eq!(request.random_seed, Some(0.0));
    assert_eq!(request.target_loudness_lufs, Some(0.0));
}
