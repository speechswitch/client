use super::*;
use crate::runtime::JsonValue;
fn model_request(index: usize, live: bool) -> TtsRequest {
    match (index, live) {
        (0, false) => TtsRequest::TextVoice4ff226b4(TtsRequestTextVoice4ff226b4 {
            text: "Hi".into(),
            voice: "en-US-AvaNeural".into(),
            input_type: None,
            language: None,
            output: None,
            model: None,
            emotion: None,
            speed: None,
            pitch_semitones: None,
            volume_scale: None,
        }),
        (0, true) => TtsRequest::StreamingTextVoicee86a65c0(TtsRequestStreamingTextVoicee86a65c0 {
            text: source(vec!["Hi".into()]),
            voice: "en-US-AvaNeural".into(),
            input_type: None,
            language: None,
            output: None,
            model: None,
            emotion: None,
            speed: None,
            pitch_semitones: None,
            volume_scale: None,
            lexicon_url: None,
            preferred_languages: None,
            timestamp_granularity: None,
        }),
        (1, false) => TtsRequest::DragonHdTextVoice(TtsRequestDragonHdTextVoice {
            text: "Hi".into(),
            voice: "en-US-Ava".into(),
            input_type: None,
            language: None,
            output: None,
            model: Default::default(),
            temperature: None,
            named_entity_pronunciation_enhancement: None,
        }),
        (1, true) => TtsRequest::DragonHdStreamingTextVoice(TtsRequestDragonHdStreamingTextVoice {
            text: source(vec!["Hi".into()]),
            voice: "en-US-Ava".into(),
            input_type: None,
            language: None,
            output: None,
            model: Default::default(),
            temperature: None,
            lexicon_url: None,
            preferred_languages: None,
        }),
        (2, false) => {
            TtsRequest::DragonHdOmniTextVoicea5a77562(TtsRequestDragonHdOmniTextVoicea5a77562 {
                text: "Hi".into(),
                voice: "en-US-Ava".into(),
                input_type: None,
                language: None,
                output: None,
                model: Default::default(),
                emotion: None,
                temperature: None,
                top_k: None,
                top_p: None,
                voice_guidance: None,
            })
        }
        (2, true) => {
            TtsRequest::DragonHdOmniStreamingTextVoice(TtsRequestDragonHdOmniStreamingTextVoice {
                text: source(vec!["Hi".into()]),
                voice: "en-US-Ava".into(),
                input_type: None,
                language: None,
                output: None,
                model: Default::default(),
                emotion: None,
                temperature: None,
                lexicon_url: None,
                preferred_languages: None,
                timestamp_granularity: None,
            })
        }
        (3, false) => TtsRequest::TextVoicefd836b1e(TtsRequestTextVoicefd836b1e {
            text: "Hi".into(),
            voice: "en-US-Ava".into(),
            input_type: None,
            language: None,
            output: None,
            model: TtsRequestTextVoicefd836b1eModel::MaiVoice2(Default::default()),
            emotion: None,
        }),
        (3, true) => TtsRequest::StreamingTextVoicee690c86a(TtsRequestStreamingTextVoicee690c86a {
            text: source(vec!["Hi".into()]),
            voice: "en-US-Ava".into(),
            input_type: None,
            language: None,
            output: None,
            model: TtsRequestTextVoicefd836b1eModel::MaiVoice2(Default::default()),
            emotion: None,
            lexicon_url: None,
            preferred_languages: None,
        }),
        (4, false) => TtsRequest::DragonHdFlashTextVoice(TtsRequestDragonHdFlashTextVoice {
            text: "Hi".into(),
            voice: "en-US-Ava".into(),
            input_type: None,
            language: None,
            output: None,
            model: Default::default(),
            emotion: None,
        }),
        (4, true) => {
            TtsRequest::DragonHdFlashStreamingTextVoice(TtsRequestDragonHdFlashStreamingTextVoice {
                text: source(vec!["Hi".into()]),
                voice: "en-US-Ava".into(),
                input_type: None,
                language: None,
                output: None,
                model: Default::default(),
                emotion: None,
                lexicon_url: None,
                preferred_languages: None,
            })
        }
        (5, false) => TtsRequest::TextVoicefd836b1e(TtsRequestTextVoicefd836b1e {
            text: "Hi".into(),
            voice: "en-US-Ava".into(),
            input_type: None,
            language: None,
            output: None,
            model: TtsRequestTextVoicefd836b1eModel::MaiVoice2Flash(Default::default()),
            emotion: None,
        }),
        (5, true) => TtsRequest::StreamingTextVoicee690c86a(TtsRequestStreamingTextVoicee690c86a {
            text: source(vec!["Hi".into()]),
            voice: "en-US-Ava".into(),
            input_type: None,
            language: None,
            output: None,
            model: TtsRequestTextVoicefd836b1eModel::MaiVoice2Flash(Default::default()),
            emotion: None,
            lexicon_url: None,
            preferred_languages: None,
        }),
        _ => panic!("invalid test model"),
    }
}
#[test]
fn model_defaults_and_empty_controls() {
    for (index, suffix, temp) in [
        (0, "Neural", None),
        (1, ":DragonHDLatestNeural", Some("1")),
        (2, ":DragonHDOmniLatestNeural", Some("0.7")),
        (3, ":MAI-Voice-2", None),
        (4, ":DragonHDFlashLatestNeural", None),
        (5, ":MAI-Voice-2-Flash", None),
    ] {
        for live in [false, true] {
            let r = model_request(index, live);
            let _ = validate_request(&r).unwrap();
            let c = settings::settings(r).unwrap();
            assert_eq!(
                c.native.get("voiceName"),
                Some(&JsonValue::String(format!("en-US-Ava{suffix}")))
            );
            assert_eq!(
                c.native.get("temperature"),
                temp.map(|v| JsonValue::String(v.into())).as_ref()
            );
            assert_eq!(c.input.is_some(), live);
            assert!(!c.wave);
            assert!(!c.timed);
        }
    }
    let mut r = streaming(source(vec![]));
    r.lexicon_url = Some(String::new());
    r.preferred_languages = Some(vec![]);
    let c = settings::settings(TtsRequest::StreamingTextVoicee86a65c0(r)).unwrap();
    assert_eq!(
        c.native,
        BTreeMap::from([
            ("bidirectionalStreamingMode".into(), JsonValue::Bool(true)),
            (
                "voiceName".into(),
                JsonValue::String("en-US-AvaNeural".into())
            ),
            ("language".into(), JsonValue::String("en-US".into())),
            ("customLexiconUrl".into(), JsonValue::String(String::new())),
            ("preferLocales".into(), JsonValue::String(String::new()))
        ])
    );
}
#[test]
fn static_sampling_language_override_and_raw_ssml() {
    let TtsRequest::DragonHdOmniTextVoicea5a77562(mut r) = model_request(2, false) else {
        unreachable!()
    };
    r.language = Some("fr-FR".into());
    r.temperature = Some(0.8);
    r.top_p = Some(0.9);
    r.top_k = Some(20.0);
    r.voice_guidance = Some(1.2);
    let c = settings::settings(TtsRequest::DragonHdOmniTextVoicea5a77562(r)).unwrap();
    assert_eq!(
        c.markup,
        r#"<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US"><voice name="en-US-Ava:DragonHDOmniLatestNeural" parameters="temperature=0.8;top_p=0.9;top_k=20;cfg_scale=1.2"><lang xml:lang="fr-FR">Hi</lang></voice></speak>"#
    );
    let text = r#"<speak><voice name="custom">Hi</voice></speak>"#;
    let r = TtsRequest::Text404f3d9b(TtsRequestText404f3d9b {
        input_type: Default::default(),
        text: text.into(),
        output: None,
    });
    let c = settings::settings(r).unwrap();
    assert_eq!(c.markup, text);
}
#[test]
fn request_validation_precedes_auth_or_transport() {
    let TtsRequest::DragonHdOmniTextVoicea5a77562(mut r) = model_request(2, false) else {
        unreachable!()
    };
    r.top_k = Some(1.5);
    let err = match ready(synthesize(
        TtsRequest::DragonHdOmniTextVoicea5a77562(r),
        Options::default(),
    )) {
        Err(err) => err,
        Ok(_) => panic!("expected error"),
    };
    assert_eq!(err.to_string(), "Invalid microsoft TTS request");
    for language in ["en-US,zh-CN", "en\nUS", "en\rUS"] {
        let mut r = streaming(source(vec![]));
        r.preferred_languages = Some(vec![language.into()]);
        let err = match ready(synthesize(
            TtsRequest::StreamingTextVoicee86a65c0(r),
            Options::default(),
        )) {
            Err(err) => err,
            Ok(_) => panic!("expected error"),
        };
        assert_eq!(
            err.to_string(),
            "Microsoft preferred languages cannot contain commas or line breaks"
        );
    }
}
