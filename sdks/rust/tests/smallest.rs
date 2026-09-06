use speechswitch_types::generated::smallest_ai;

#[test]
fn pro_preserves_japanese_and_explicit_false() {
    let request = smallest_ai::TtsRequestLightningV31ProTextVoice74d06326 {
        model: Default::default(), text: "こんにちは".into(), voice: "saved-voice".into(),
        language: Some(smallest_ai::TtsRequestLightningV31ProStreamingTextVoice8f1b36fbLanguage::Ja(Default::default())),
        formula_reading: Some(smallest_ai::TtsRequestLightningV31ProStreamingTextVoice8f1b36fbFormulaReading::False(Default::default())),
        content_retention_days: None, number_pronunciation_language: None, output: None,
        pronunciation_dictionaries: Some(vec![]), request_id: None, session_id: None, speed: None,
    };
    assert_eq!(request.model.value(), "lightning-v3.1-pro");
    let Some(smallest_ai::TtsRequestLightningV31ProStreamingTextVoice8f1b36fbLanguage::Ja(value)) = request.language else { panic!("lost Japanese") };
    assert_eq!(value.value(), "ja");
    let Some(smallest_ai::TtsRequestLightningV31ProStreamingTextVoice8f1b36fbFormulaReading::False(value)) = request.formula_reading else { panic!("lost explicit false") };
    assert!(!value.value());
    assert_eq!(request.pronunciation_dictionaries.map(|values| values.len()), Some(0));
}
