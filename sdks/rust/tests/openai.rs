use speechswitch_types::generated::openai;

#[test]
fn custom_voice_requires_modern_model_and_retains_explicit_usage_choice() {
    let request = openai::TtsRequestTextVoicef3ee42bf {
        model: openai::TtsRequestTextVoicef51a0f7eModel::Gpt4oMiniTts(Default::default()),
        text: "Hello".into(), voice: "saved-voice".into(), voice_source: Default::default(),
        instructions: Some("Whisper".into()), output: None, speed: None,
        include_usage: Some(openai::TtsRequestTextVoicef51a0f7eIncludeUsage::False(Default::default())),
    };
    assert_eq!(request.voice_source.value(), "custom");
    assert_eq!(request.instructions.as_deref(), Some("Whisper"));
    let Some(openai::TtsRequestTextVoicef51a0f7eIncludeUsage::False(value)) = &request.include_usage else { panic!("lost false") };
    assert!(!value.value());
    let normalized = openai::TtsRequest::TextVoicef3ee42bf(request);
    assert!(matches!(normalized, openai::TtsRequest::TextVoicef3ee42bf(_)));
}
