use speechswitch_types::generated::resemble;

#[test]
fn native_style_scale_and_reference_bytes_survive_type_generation() {
    let request = resemble::TtsRequestText {
        model: None, text: "Hello".into(), output: None, random_seed: Some(0.0),
        reference_audio: Some(vec![0, 255, 128]), reference_audio_trimming: None,
        style_exaggeration: Some(2.0), temperature: Some(5.0), voice_guidance: Some(0.2),
    };
    assert_eq!(request.style_exaggeration, Some(2.0));
    assert_eq!(request.reference_audio, Some(vec![0, 255, 128]));
    let normalized = resemble::TtsRequest::Text(request);
    assert!(matches!(normalized, resemble::TtsRequest::Text(_)));
}
