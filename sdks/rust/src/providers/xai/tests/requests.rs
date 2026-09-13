use super::*;

#[test]
fn shared_request_fixtures_cover_custom_voice_formats_latency_and_replacements() {
    let fixtures = Raw::parse_exact(include_str!("../../../../../fixtures/xai.json"))
        .unwrap()
        .object()
        .unwrap();
    let fixtures = fixtures["requests"].array().unwrap();
    let mut custom = request();
    custom.text = "Acme Mobile 😀".into();
    custom.model = Some(Default::default());
    custom.voice = Some("existing-custom-voice".into());
    custom.output = Some(TtsRequestTextOutput::Mp3(TtsRequestTextOutputMp3 {
        format: Default::default(),
        sample_rate_hz: Some(TtsRequestTextOutputMp3SampleRateHz::Number24000(
            Default::default(),
        )),
        bit_rate_bps: Some(TtsRequestTextOutputMp3BitRateBps::Number128000(
            Default::default(),
        )),
    }));
    custom.speed = Some(0.7);
    custom.text_normalization = Some(TtsRequestTextTextNormalization::False(Default::default()));
    custom.latency_optimization = Some(TtsRequestTextLatencyOptimization::Aggressive(
        Default::default(),
    ));
    custom.replacements = Some(vec![TtsRequestTextReplacementsItem {
        pattern: "Acme Mobile".into(),
        replacement: "Acme Mobull".into(),
    }]);
    let mut phone = request();
    phone.text = "Bonjour".into();
    phone.language = Some(TtsRequestTextLanguage::Fr(Default::default()));
    phone.output = Some(TtsRequestTextOutput::Object(TtsRequestTextOutputObject {
        format: TtsRequestTextOutputObjectFormat::Mulaw(Default::default()),
        sample_rate_hz: Some(TtsRequestTextOutputMp3SampleRateHz::Number8000(
            Default::default(),
        )),
    }));
    phone.latency_optimization = Some(TtsRequestTextLatencyOptimization::None(Default::default()));
    phone.replacements = Some(vec![]);
    let mut timed = request();
    timed.text = "Acme".into();
    timed.output = Some(TtsRequestTextOutput::Object(TtsRequestTextOutputObject {
        format: TtsRequestTextOutputObjectFormat::Pcm(Default::default()),
        sample_rate_hz: Some(TtsRequestTextOutputMp3SampleRateHz::Number48000(
            Default::default(),
        )),
    }));
    timed.latency_optimization = Some(TtsRequestTextLatencyOptimization::Moderate(
        Default::default(),
    ));
    timed.timestamp_granularity = Some(Default::default());
    timed.text_normalization = Some(TtsRequestTextTextNormalization::True(Default::default()));
    let requests = [request(), custom, phone, timed];
    assert_eq!(requests.len(), fixtures.len());
    for (req, expected) in requests.into_iter().zip(fixtures) {
        let fields = expected.object().unwrap();
        let http = http(
            vec![],
            if req.timestamp_granularity.is_some() {
                "application/json"
            } else {
                "audio/mpeg"
            },
        );
        let stream = ready(synthesize(
            TtsRequest::Text(req),
            Options {
                auth: Some(&auth()),
                transport: Some(&http),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(
            value(std::str::from_utf8(&http.requests.lock().unwrap()[0].body).unwrap()),
            fixture(fields["body"]),
            "{}",
            fields["name"].string().unwrap()
        );
        drop(stream);
    }
}

#[test]
fn initial_replacements_precede_text_and_streaming_items_use_generated_validation() {
    let data = Arc::new(Mutex::new(SocketData {
        automatic: true,
        ..Default::default()
    }));
    let TtsRequest::StreamingText(mut req) =
        live(source(vec![Input::String("Acme".into()), update()]))
    else {
        unreachable!()
    };
    req.replacements = Some(vec![TtsRequestTextReplacementsItem {
        pattern: "Acme".into(),
        replacement: "Ack me".into(),
    }]);
    let mut stream = ready(synthesize(
        TtsRequest::StreamingText(req),
        Options {
            auth: Some(&auth()),
            web_socket: Some(socket(&data, &Arc::default())),
            ..Default::default()
        },
    ))
    .unwrap();
    let items = collect(&mut stream).unwrap();
    assert_eq!(items[0], value(r#"[["Acme","Ack me"]]"#));
    assert_eq!(
        value(&data.lock().unwrap().sent[0]),
        value(r#"{"type":"session.update","replace":{"Acme":"Ack me"}}"#)
    );
    let input = Input::Update(TtsRequestStreamingTextTextItemUpdate {
        command: Default::default(),
        replacements: vec![TtsRequestTextReplacementsItem {
            pattern: "😀".repeat(101),
            replacement: "okay".into(),
        }],
    });
    let data = Arc::default();
    let expected = validate_request(&live(source(vec![]))).unwrap()(&input, None)
        .err()
        .unwrap()
        .to_string();
    let mut stream = native(source(vec![input]), &data, &Arc::default());
    assert_eq!(
        next(&mut stream).unwrap().err().unwrap().to_string(),
        expected
    );
    assert_eq!(data.lock().unwrap().sent, [] as [String; 0]);
}

#[test]
fn conservative_duplicate_preflight_preserves_unrelated_unicode_keys() {
    let duplicate = vec![
        TtsRequestTextReplacementsItem {
            pattern: " Acme\u{feff}Mobile ".into(),
            replacement: "one".into(),
        },
        TtsRequestTextReplacementsItem {
            pattern: "acme mobile".into(),
            replacement: "two".into(),
        },
    ];
    assert_eq!(
        super::super::settings::replacement_map(duplicate)
            .err()
            .unwrap()
            .to_string(),
        "Duplicate xAI replacement phrase: acme mobile"
    );
    let distinct = ["İ", "i", "ΟΣ", "ος", "οσ", "a\u{85}b", "a b"]
        .map(|pattern| TtsRequestTextReplacementsItem {
            pattern: pattern.into(),
            replacement: pattern.into(),
        })
        .into();
    let map = super::super::settings::replacement_map(distinct).unwrap();
    assert_eq!(map.len(), 7);
}

#[test]
fn text_caps_count_unicode_scalars_per_delta_not_total_stream_length() {
    let mut req = request();
    req.text = "😀".repeat(15001);
    let req = TtsRequest::Text(req);
    let expected = validate_request(&req).err().unwrap().to_string();
    assert_eq!(
        ready(synthesize(
            req,
            Options {
                auth: Some(&auth()),
                ..Default::default()
            }
        ))
        .err()
        .unwrap()
        .to_string(),
        expected
    );
    let data = Arc::new(Mutex::new(SocketData {
        automatic: true,
        ..Default::default()
    }));
    let mut stream = native(
        source(vec![
            Input::String("😀".repeat(15000)),
            Input::String("😀".repeat(15000)),
        ]),
        &data,
        &Arc::default(),
    );
    assert_eq!(collect(&mut stream).unwrap().len(), 3);
    let mut stream = native(
        source(vec![Input::String("😀".repeat(15001))]),
        &Arc::default(),
        &Arc::default(),
    );
    assert_eq!(
        next(&mut stream).unwrap().err().unwrap().to_string(),
        "xAI text.delta exceeds 15000 Unicode code points"
    );
}
