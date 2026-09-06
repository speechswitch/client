use speechswitch_types::generated::{voice_ai::*, stream::FlushEvent};

#[test]
fn lite_keeps_existing_voice_numbered_dictionary_and_explicit_zero() {
    let request = TtsRequestObjectdd71553d {
        api_version: None, audio_delivery: None, language: None,
        model: TtsRequestObjectdd71553dModel::VoiceaiTtsLiteV1Latest(Default::default()),
        output: None, pronunciation_dictionaries: Some(vec![TtsRequestObject1ec54d36PronunciationDictionariesItem { id: "owned-dictionary".into(), version: Some(2.0) }]),
        temperature: Some(0.0), top_p: Some(0.0), text: TtsRequestObject1ec54d36Text::String("Hello".into()), voice: Some("cloned".into()),
    };
    assert_eq!(request.temperature, Some(0.0));
    assert_eq!(request.voice.as_deref(), Some("cloned"));
    assert_eq!(request.pronunciation_dictionaries.unwrap()[0].version, Some(2.0));
    let flush = FlushEvent { event: Default::default(), correlation_id: "context".into(), input_group_id: None };
    assert!(flush.input_group_id.is_none());
}
