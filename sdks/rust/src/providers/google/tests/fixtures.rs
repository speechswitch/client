use super::*;
use crate::{json::Raw, msgpack::tests::fixture};

#[test]
fn shared_wire_fixtures() {
    let mut a = whole();
    a.instructions = Some("Warmly".into());
    a.text_normalization = Some(TtsRequestTextTextNormalization::False(Default::default()));
    a.speed = Some(0.5);
    a.volume_db = Some(0.0);
    a.pitch_semitones = Some(0.0);
    a.effects_profiles = Some(vec![]);
    a.safety_settings = Some(vec![TtsRequestTextSafetySettingsItem {
        category: TtsRequestTextSafetySettingsItemCategory::Harassment(Default::default()),
        threshold: TtsRequestTextSafetySettingsItemThreshold::High(Default::default()),
    }]);
    a.output = TtsRequestChirp3HdTextVoiceffbf1cc1Output::Wav(
        TtsRequestChirp3HdTextVoiceffbf1cc1OutputWav {
            sample_rate_hz: Some(24000.0),
            ..wav()
        },
    );
    let b = TtsRequestChirp3HdTextVoiceffbf1cc1 {
        model: Default::default(),
        language: language(),
        voice: voice(),
        input_type: Some(TtsRequestChirp3HdTextVoiceffbf1cc1InputType::Ssml(
            Default::default(),
        )),
        text: "<speak>Acme</speak>".into(),
        replacements: Some(vec![TtsRequestChirp3HdTextVoiceffbf1cc1ReplacementsItem {
            pattern: "Acme".into(),
            replacement: "ækmi".into(),
            alphabet: TtsRequestChirp3HdTextVoiceffbf1cc1ReplacementsItemAlphabet::Ipa(
                Default::default(),
            ),
        }]),
        output: TtsRequestChirp3HdTextVoiceffbf1cc1Output::Pcm(pcm()),
        speed: None,
        effects_profiles: None,
        volume_db: None,
    };
    let c = TtsRequestChirp3InstantCustomVoiceTextVoiced9d056de {
        model: Default::default(),
        language: language(),
        voice: "existing-key".into(),
        input_type: Some(TtsRequestChirp3Hd174648a4InputType::Markup(
            Default::default(),
        )),
        text: "hello".into(),
        replacements: None,
        speed: None,
        output: TtsRequestChirp3InstantCustomVoiceTextVoiced9d056deOutput::Wav(
            TtsRequestChirp3HdTextVoiceffbf1cc1OutputWav {
                sample_encoding: Some(
                    TtsRequestChirp3HdTextVoiceffbf1cc1OutputWavSampleEncoding::Alaw(
                        Default::default(),
                    ),
                ),
                ..wav()
            },
        ),
    };
    let mut d = whole();
    d.model = TtsRequestTextVoiceModel::Gemini25ProTts(Default::default());
    d.language = "es-419".into();
    d.text = "hola".into();
    d.text_normalization = Some(TtsRequestTextTextNormalization::False(Default::default()));
    d.output = TtsRequestChirp3HdTextVoiceffbf1cc1Output::Pcm(
        TtsRequestChirp3HdTextVoiceffbf1cc1OutputPcm {
            sample_rate_hz: Some(24000.0),
            ..pcm()
        },
    );
    let e = TtsRequestChirp3InstantCustomVoice093d5f29 {
        model: Default::default(),
        language: language(),
        voice: "existing-key".into(),
        input_type: Some(TtsRequestChirp3Hd174648a4InputType::Markup(
            Default::default(),
        )),
        text: TtsRequestChirp3Hd174648a4Text::String("hello".into()),
        speed: Some(1.5),
        replacements: Some(vec![TtsRequestChirp3HdTextVoiceffbf1cc1ReplacementsItem {
            pattern: "Acme".into(),
            replacement: "akmi".into(),
            alphabet: TtsRequestChirp3HdTextVoiceffbf1cc1ReplacementsItemAlphabet::XSampa(
                Default::default(),
            ),
        }]),
        output: TtsRequestChirp3Hd174648a4Output::Object(TtsRequestChirp3Hd174648a4OutputObject {
            format: TtsRequestChirp3Hd174648a4OutputObjectFormat::Mulaw(Default::default()),
            sample_rate_hz: None,
        }),
    };
    let f = gemini_fields!(TtsRequestTurns5ba0ad7a,model:TtsRequestTextModel::Gemini31FlashTtsPreview(Default::default()),speakers:speakers(),turns:turns(),output:TtsRequestChirp3HdTextVoiceffbf1cc1Output::Mp3(TtsRequestChirp3HdTextVoiceffbf1cc1OutputMp3 {format:Default::default(),sample_rate_hz:None,bit_rate_bps:Some(Default::default())}),effects_profiles:None,pitch_semitones:None,volume_db:None);
    let mut g = gemini_fields!(TtsRequestTurns9a76562f,model:TtsRequestTextModel::Gemini25FlashTts(Default::default()),speakers:speakers(),turns:vec![settings::Turn {speaker:"Sam".into(),text:"Hi".into()}],output:TtsRequestChirp3Hd174648a4Output::OggOpus(TtsRequestChirp3HdTextVoiceffbf1cc1OutputOggOpus {format:Default::default(),sample_rate_hz:None}));
    g.instructions = Some("Conversational".into());
    let mut h = whole();
    h.model = TtsRequestTextVoiceModel::Gemini25FlashLitePreviewTts(Default::default());
    h.language = "cmn-tw".into();
    h.volume_db = Some(0.0);
    h.output = TtsRequestChirp3HdTextVoiceffbf1cc1Output::OggOpus(
        TtsRequestChirp3HdTextVoiceffbf1cc1OutputOggOpus {
            format: Default::default(),
            sample_rate_hz: None,
        },
    );
    let cases = [
        TtsRequest::TextVoice(a),
        TtsRequest::Chirp3HdTextVoiceffbf1cc1(b),
        TtsRequest::Chirp3InstantCustomVoiceTextVoiced9d056de(c),
        TtsRequest::TextVoice(d),
        TtsRequest::Chirp3InstantCustomVoice093d5f29(e),
        TtsRequest::Turns5ba0ad7a(f),
        TtsRequest::Turns9a76562f(g),
        TtsRequest::TextVoice(h),
    ];
    let fixtures = Raw::parse_exact(include_str!("../../../../../fixtures/google.json"))
        .unwrap()
        .array()
        .unwrap();
    assert_eq!(cases.len(), fixtures.len());
    // Golden protobuf bytes from the independent build-time parser of the shared fixtures.
    let golden = [
        ("gemini-complete-native", ["0a390a220a0665732d34313912044b6f7265321267656d696e692d322e352d70726f2d747473220f080710c0bb0119000000000000f03f3a021000", "12060a04686f6c61"]),
        ("clone-beta-native", ["0a380a170a05656e2d55532a0e0a0c6578697374696e672d6b6579220b080519000000000000f83f2a100a0e0a0441636d6510021a04616b6d69", "12072a0568656c6c6f"]),
        ("gemini-dialogue-native", ["0a4c0a390a05656e2d5553321467656d696e692d322e352d666c6173682d7474733a1a120b0a0353616d12044b6f7265120b0a03426f6212045075636b220b080319000000000000f03f3a021001", "121d3a0b0a090a0353616d12024869320e436f6e766572736174696f6e616c"]),
    ];
    for (request, raw) in cases.into_iter().zip(fixtures) {
        let fields = raw.object().unwrap();
        let name = fields["name"].string().unwrap();
        let counts = Arc::new(Counts::default());
        let http = http(
            200,
            source(
                vec![Ok(br#"{"audioContent":"AP8B"}"#.to_vec())],
                &counts,
                false,
            ),
        );
        let state = Arc::new(Mutex::new(CallState::default()));
        let mut stream = ready(synthesize(
            request,
            Options {
                auth: Some(&auth()),
                transport: Some(&http),
                grpc: Some(call(&state)),
                base_url: Some("https://proxy.test/a%20b/?tenant=one"),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        if let Some(body) = fields.get("body") {
            assert_eq!(
                collect(&mut stream).unwrap(),
                vec![vec![0, 255, 1]],
                "{name}"
            );
            let request = http.request.lock().unwrap().take().unwrap();
            assert_eq!(request.method, "POST");
            assert_eq!(
                request.url,
                format!(
                    "https://proxy.test/a%20b{}?tenant=one",
                    fields["path"].string().unwrap()
                )
            );
            assert_eq!(
                request.headers,
                vec![
                    ("x-goog-api-key".into(), "test-key".into()),
                    ("authorization".into(), "Bearer test-token".into()),
                    ("x-goog-user-project".into(), "test-project".into()),
                    ("content-type".into(), "application/json".into())
                ]
            );
            assert_eq!(
                fixture(Raw::parse_exact(std::str::from_utf8(&request.body).unwrap()).unwrap()),
                fixture(*body),
                "{name}"
            );
            assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        } else {
            assert_eq!(collect(&mut stream).unwrap(), Vec::<Vec<u8>>::new());
            let state = state.lock().unwrap();
            assert_eq!(
                state.messages.iter().map(|v| hex(v)).collect::<Vec<_>>(),
                golden.iter().find(|(key, _)| *key == name).unwrap().1,
                "{name}"
            );
            assert_eq!(state.drops, 1);
            assert!(state.ended);
        }
    }
}

#[test]
fn all_canonical_alternatives_execute() {
    let counts = Arc::new(Counts::default());
    let text = || {
        TtsRequestChirp3Hd174648a4Text::AsyncIterable(source(
            vec![Ok("hello".into())],
            &counts,
            false,
        ))
    };
    let output = || TtsRequestChirp3Hd174648a4Output::Pcm(pcm());
    let whole_output = || TtsRequestChirp3HdTextVoiceffbf1cc1Output::Wav(wav());
    let clone_output = || TtsRequestChirp3InstantCustomVoiceTextVoiced9d056deOutput::Wav(wav());
    let b = || TtsRequestChirp3HdTextVoice3fb16684Language::BnIN(Default::default());
    let c = || TtsRequestChirp3HdTextVoice0df9de22Language::BgBG(Default::default());
    let d =
        || TtsRequestChirp3InstantCustomVoiceTextVoice16ed8d8aLanguage::BnIN(Default::default());
    let model = || TtsRequestTextModel::Gemini25FlashTts(Default::default());
    let cases = [
        TtsRequest::Chirp3HdTextVoiceffbf1cc1(TtsRequestChirp3HdTextVoiceffbf1cc1 {
            model: Default::default(),
            language: language(),
            voice: voice(),
            text: "hello".into(),
            input_type: None,
            replacements: None,
            speed: None,
            volume_db: None,
            effects_profiles: None,
            output: whole_output(),
        }),
        TtsRequest::Chirp3Hd174648a4(TtsRequestChirp3Hd174648a4 {
            model: Default::default(),
            language: language(),
            voice: voice(),
            text: text(),
            input_type: None,
            replacements: None,
            speed: None,
            output: output(),
        }),
        TtsRequest::Chirp3HdTextVoice3fb16684(TtsRequestChirp3HdTextVoice3fb16684 {
            model: Default::default(),
            language: b(),
            voice: voice(),
            text: "hello".into(),
            input_type: None,
            speed: None,
            volume_db: None,
            effects_profiles: None,
            output: whole_output(),
        }),
        TtsRequest::Chirp3Hd140fecab(TtsRequestChirp3Hd140fecab {
            model: Default::default(),
            language: b(),
            voice: voice(),
            text: text(),
            input_type: None,
            speed: None,
            output: output(),
        }),
        TtsRequest::Chirp3HdTextVoice0df9de22(TtsRequestChirp3HdTextVoice0df9de22 {
            model: Default::default(),
            language: c(),
            voice: voice(),
            text: "hello".into(),
            input_type: None,
            speed: None,
            volume_db: None,
            effects_profiles: None,
            output: whole_output(),
        }),
        TtsRequest::Chirp3Hd69e36cb2(TtsRequestChirp3Hd69e36cb2 {
            model: Default::default(),
            language: c(),
            voice: voice(),
            text: text(),
            input_type: None,
            speed: None,
            output: output(),
        }),
        TtsRequest::Chirp3InstantCustomVoiceTextVoiced9d056de(
            TtsRequestChirp3InstantCustomVoiceTextVoiced9d056de {
                model: Default::default(),
                language: language(),
                voice: "key".into(),
                text: "hello".into(),
                input_type: None,
                replacements: None,
                speed: None,
                output: clone_output(),
            },
        ),
        TtsRequest::Chirp3InstantCustomVoice093d5f29(TtsRequestChirp3InstantCustomVoice093d5f29 {
            model: Default::default(),
            language: language(),
            voice: "key".into(),
            text: text(),
            input_type: None,
            replacements: None,
            speed: None,
            output: output(),
        }),
        TtsRequest::Chirp3InstantCustomVoiceTextVoice16ed8d8a(
            TtsRequestChirp3InstantCustomVoiceTextVoice16ed8d8a {
                model: Default::default(),
                language: d(),
                voice: "key".into(),
                text: "hello".into(),
                input_type: None,
                speed: None,
                output: clone_output(),
            },
        ),
        TtsRequest::Chirp3InstantCustomVoicebd483c3d(TtsRequestChirp3InstantCustomVoicebd483c3d {
            model: Default::default(),
            language: d(),
            voice: "key".into(),
            text: text(),
            input_type: None,
            speed: None,
            output: output(),
        }),
        TtsRequest::Text(
            gemini_fields!(TtsRequestText,model:model(),speakers:speakers(),text:"hello".into(),output:whole_output(),volume_db:None,pitch_semitones:None,effects_profiles:None),
        ),
        TtsRequest::Object551db176(
            gemini_fields!(TtsRequestObject551db176,model:model(),speakers:speakers(),text:text(),output:output()),
        ),
        TtsRequest::TextVoice(whole()),
        streaming(source(vec![Ok("hello".into())], &counts, false)),
        TtsRequest::Turns5ba0ad7a(
            gemini_fields!(TtsRequestTurns5ba0ad7a,model:model(),speakers:speakers(),turns:turns(),output:whole_output(),volume_db:None,pitch_semitones:None,effects_profiles:None),
        ),
        TtsRequest::Turns9a76562f(
            gemini_fields!(TtsRequestTurns9a76562f,model:model(),speakers:speakers(),turns:turns(),output:output()),
        ),
        TtsRequest::StreamingTurns(
            gemini_fields!(TtsRequestStreamingTurns,model:model(),speakers:speakers(),turns:source(turns().into_iter().map(Ok).collect(), &counts, false),output:output()),
        ),
    ];
    assert_eq!(cases.len(), 17);
    for request in cases {
        let http_expected = matches!(&request,
            TtsRequest::Chirp3HdTextVoiceffbf1cc1(_)
            | TtsRequest::Chirp3HdTextVoice3fb16684(_)
            | TtsRequest::Chirp3HdTextVoice0df9de22(_)
            | TtsRequest::Chirp3InstantCustomVoiceTextVoiced9d056de(_)
            | TtsRequest::Chirp3InstantCustomVoiceTextVoice16ed8d8a(_)
            | TtsRequest::Text(_) | TtsRequest::TextVoice(_) | TtsRequest::Turns5ba0ad7a(_));
        let expected_messages = if matches!(&request, TtsRequest::StreamingTurns(_)) { 3 } else { 2 };
        let state = Arc::new(Mutex::new(CallState::default()));
        let http = http(
            200,
            source(
                vec![Ok(br#"{"audioContent":"AQ=="}"#.to_vec())],
                &Arc::default(),
                false,
            ),
        );
        let before = counts.reads.load(Ordering::SeqCst);
        let mut stream = ready(synthesize(
            request,
            Options {
                auth: Some(&auth()),
                transport: Some(&http),
                grpc: Some(call(&state)),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(counts.reads.load(Ordering::SeqCst), before);
        let output = collect(&mut stream).unwrap();
        if http_expected {
            assert_eq!(output, vec![vec![1]]);
        } else {
            assert_eq!(output, Vec::<Vec<u8>>::new());
            assert_eq!(
                state.lock().unwrap().messages.len(),
                expected_messages
            );
        }
    }
    assert_eq!(counts.drops.load(Ordering::SeqCst), 8);
}
