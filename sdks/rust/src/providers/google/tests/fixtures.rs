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
    a.output = TtsRequestChirp3HdTextVoicebb77af5cOutput::Wav(
        TtsRequestChirp3HdTextVoicebb77af5cOutputWav {
            sample_rate_hz: Some(24000.0),
            ..wav()
        },
    );
    let b = TtsRequestChirp3HdTextVoicebb77af5c {
        model: Default::default(),
        language: language(),
        voice: voice(),
        input_type: Some(TtsRequestChirp3HdTextVoicebb77af5cInputType::Ssml(
            Default::default(),
        )),
        text: "<speak>Acme</speak>".into(),
        replacements: Some(vec![TtsRequestChirp3HdTextVoicebb77af5cReplacementsItem {
            pattern: "Acme".into(),
            replacement: "ækmi".into(),
            alphabet: TtsRequestChirp3HdTextVoicebb77af5cReplacementsItemAlphabet::Ipa(
                Default::default(),
            ),
        }]),
        output: TtsRequestChirp3HdTextVoicebb77af5cOutput::Pcm(pcm()),
        speed: None,
        effects_profiles: None,
        volume_db: None,
    };
    let c = TtsRequestChirp3InstantCustomVoiceTextVoicedb488368 {
        model: Default::default(),
        language: language(),
        voice: "existing-key".into(),
        input_type: Some(TtsRequestChirp3Hda92b414cInputType::Markup(
            Default::default(),
        )),
        text: "hello".into(),
        replacements: None,
        speed: None,
        output: TtsRequestChirp3InstantCustomVoiceTextVoicedb488368Output::Wav(
            TtsRequestChirp3HdTextVoicebb77af5cOutputWav {
                sample_encoding: Some(
                    TtsRequestChirp3HdTextVoicebb77af5cOutputWavSampleEncoding::Alaw(
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
    d.output = TtsRequestChirp3HdTextVoicebb77af5cOutput::Pcm(
        TtsRequestChirp3HdTextVoicebb77af5cOutputPcm {
            sample_rate_hz: Some(24000.0),
            ..pcm()
        },
    );
    let e = TtsRequestChirp3InstantCustomVoicefa2d40ff {
        model: Default::default(),
        language: language(),
        voice: "existing-key".into(),
        input_type: Some(TtsRequestChirp3Hda92b414cInputType::Markup(
            Default::default(),
        )),
        text: TtsRequestChirp3Hda92b414cText::String("hello".into()),
        speed: Some(1.5),
        replacements: Some(vec![TtsRequestChirp3HdTextVoicebb77af5cReplacementsItem {
            pattern: "Acme".into(),
            replacement: "akmi".into(),
            alphabet: TtsRequestChirp3HdTextVoicebb77af5cReplacementsItemAlphabet::XSampa(
                Default::default(),
            ),
        }]),
        output: TtsRequestChirp3Hda92b414cOutput::Object(TtsRequestChirp3Hda92b414cOutputObject {
            format: TtsRequestChirp3Hda92b414cOutputObjectFormat::Mulaw(Default::default()),
            sample_rate_hz: None,
        }),
    };
    let f = gemini_fields!(TtsRequestTurns,model:TtsRequestTextModel::Gemini31FlashTtsPreview(Default::default()),speakers:speakers(),turns:turns(),output:TtsRequestChirp3HdTextVoicebb77af5cOutput::Mp3(TtsRequestChirp3HdTextVoicebb77af5cOutputMp3 {format:Default::default(),sample_rate_hz:None,bit_rate_bps:Some(Default::default())}),effects_profiles:None,pitch_semitones:None,volume_db:None);
    let mut g = gemini_fields!(TtsRequestObject8dbffa0c,model:TtsRequestTextModel::Gemini25FlashTts(Default::default()),speakers:speakers(),turns:TtsRequestObject8dbffa0cTurns::Array(vec![settings::Turn {speaker:"Sam".into(),text:"Hi".into()}]),output:TtsRequestChirp3Hda92b414cOutput::OggOpus(TtsRequestChirp3HdTextVoicebb77af5cOutputOggOpus {format:Default::default(),sample_rate_hz:None}));
    g.instructions = Some("Conversational".into());
    let mut h = whole();
    h.model = TtsRequestTextVoiceModel::Gemini25FlashLitePreviewTts(Default::default());
    h.language = "cmn-tw".into();
    h.volume_db = Some(0.0);
    h.output = TtsRequestChirp3HdTextVoicebb77af5cOutput::OggOpus(
        TtsRequestChirp3HdTextVoicebb77af5cOutputOggOpus {
            format: Default::default(),
            sample_rate_hz: None,
        },
    );
    let cases = [
        TtsRequest::TextVoice(a),
        TtsRequest::Chirp3HdTextVoicebb77af5c(b),
        TtsRequest::Chirp3InstantCustomVoiceTextVoicedb488368(c),
        TtsRequest::TextVoice(d),
        TtsRequest::Chirp3InstantCustomVoicefa2d40ff(e),
        TtsRequest::Turns(f),
        TtsRequest::Object8dbffa0c(g),
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
fn all_sixteen_canonical_alternatives_execute() {
    let counts = Arc::new(Counts::default());
    let text = || {
        TtsRequestChirp3Hda92b414cText::AsyncIterable(source(
            vec![Ok("hello".into())],
            &counts,
            false,
        ))
    };
    let output = || TtsRequestChirp3Hda92b414cOutput::Pcm(pcm());
    let whole_output = || TtsRequestChirp3HdTextVoicebb77af5cOutput::Wav(wav());
    let clone_output = || TtsRequestChirp3InstantCustomVoiceTextVoicedb488368Output::Wav(wav());
    let b = || TtsRequestChirp3HdTextVoicec6612bf7Language::BnIN(Default::default());
    let c = || TtsRequestChirp3HdTextVoiceab6ef40eLanguage::BgBG(Default::default());
    let d =
        || TtsRequestChirp3InstantCustomVoiceTextVoice298c5192Language::BnIN(Default::default());
    let model = || TtsRequestTextModel::Gemini25FlashTts(Default::default());
    let cases = [
        TtsRequest::Chirp3HdTextVoicebb77af5c(TtsRequestChirp3HdTextVoicebb77af5c {
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
        TtsRequest::Chirp3Hda92b414c(TtsRequestChirp3Hda92b414c {
            model: Default::default(),
            language: language(),
            voice: voice(),
            text: text(),
            input_type: None,
            replacements: None,
            speed: None,
            output: output(),
        }),
        TtsRequest::Chirp3HdTextVoicec6612bf7(TtsRequestChirp3HdTextVoicec6612bf7 {
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
        TtsRequest::Chirp3Hd9b5c25a8(TtsRequestChirp3Hd9b5c25a8 {
            model: Default::default(),
            language: b(),
            voice: voice(),
            text: text(),
            input_type: None,
            speed: None,
            output: output(),
        }),
        TtsRequest::Chirp3HdTextVoiceab6ef40e(TtsRequestChirp3HdTextVoiceab6ef40e {
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
        TtsRequest::Chirp3Hd562ca724(TtsRequestChirp3Hd562ca724 {
            model: Default::default(),
            language: c(),
            voice: voice(),
            text: text(),
            input_type: None,
            speed: None,
            output: output(),
        }),
        TtsRequest::Chirp3InstantCustomVoiceTextVoicedb488368(
            TtsRequestChirp3InstantCustomVoiceTextVoicedb488368 {
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
        TtsRequest::Chirp3InstantCustomVoicefa2d40ff(TtsRequestChirp3InstantCustomVoicefa2d40ff {
            model: Default::default(),
            language: language(),
            voice: "key".into(),
            text: text(),
            input_type: None,
            replacements: None,
            speed: None,
            output: output(),
        }),
        TtsRequest::Chirp3InstantCustomVoiceTextVoice298c5192(
            TtsRequestChirp3InstantCustomVoiceTextVoice298c5192 {
                model: Default::default(),
                language: d(),
                voice: "key".into(),
                text: "hello".into(),
                input_type: None,
                speed: None,
                output: clone_output(),
            },
        ),
        TtsRequest::Chirp3InstantCustomVoiceaec4d903(TtsRequestChirp3InstantCustomVoiceaec4d903 {
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
        TtsRequest::Objectd20064bc(
            gemini_fields!(TtsRequestObjectd20064bc,model:model(),speakers:speakers(),text:text(),output:output()),
        ),
        TtsRequest::TextVoice(whole()),
        streaming(source(vec![Ok("hello".into())], &counts, false)),
        TtsRequest::Turns(
            gemini_fields!(TtsRequestTurns,model:model(),speakers:speakers(),turns:turns(),output:whole_output(),volume_db:None,pitch_semitones:None,effects_profiles:None),
        ),
        TtsRequest::Object8dbffa0c(
            gemini_fields!(TtsRequestObject8dbffa0c,model:model(),speakers:speakers(),turns:TtsRequestObject8dbffa0cTurns::AsyncIterable(source(turns().into_iter().map(Ok).collect(), &counts, false)),output:output()),
        ),
    ];
    assert_eq!(cases.len(), 16);
    for (index, request) in cases.into_iter().enumerate() {
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
        if index % 2 == 0 {
            assert_eq!(output, vec![vec![1]]);
        } else {
            assert_eq!(output, Vec::<Vec<u8>>::new());
            assert_eq!(
                state.lock().unwrap().messages.len(),
                if index == 15 { 3 } else { 2 }
            );
        }
    }
    assert_eq!(counts.drops.load(Ordering::SeqCst), 8);
}
