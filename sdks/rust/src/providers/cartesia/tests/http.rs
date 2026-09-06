use super::*;

#[test]
fn shared_sse_fixtures_at_every_byte_split() {
    let fixtures = Raw::parse(include_str!("../../../../../fixtures/cartesia.json"))
        .unwrap()
        .array()
        .unwrap();
    let auth = auth();
    for fixture in fixtures {
        let fixture = fixture.object().unwrap();
        let name = fixture["name"].string().unwrap();
        let frames = fixture["frames"].array().unwrap();
        let data: String = frames
            .into_iter()
            .map(|frame| format!("data: {}\n\n", frame.text()))
            .collect();
        for split in 0..=data.len() {
            let counts = Arc::new(Counts::default());
            let trace = Trace::default();
            let http = Http::new(HttpResponse {
                status: 200,
                headers: Vec::new(),
                body: body(
                    vec![
                        Ok(data.as_bytes()[..split].to_vec()),
                        Ok(data.as_bytes()[split..].to_vec()),
                    ],
                    &counts,
                    &trace,
                    false,
                    "response",
                ),
            });
            let mut stream = ready(synthesize(
                timed(),
                Options {
                    auth: Some(&auth),
                    transport: Some(&http),
                    entropy: Some(&entropy),
                    ..Default::default()
                },
            ))
            .unwrap();
            let id = {
                let requests = http.requests.lock().unwrap();
                let text = std::str::from_utf8(&requests[0].body).unwrap();
                Raw::parse(text).unwrap().object().unwrap()["context_id"]
                    .string()
                    .unwrap()
            };
            let mut items = Vec::new();
            let mut error = None;
            while let Some(item) = next(&mut stream) {
                match item {
                    Err(value) => {
                        error = Some(value.to_string());
                        break;
                    }
                    Ok(item) => {
                        let JsonValue::Object(mut item) = canonical(item) else {
                            panic!("expected timeline")
                        };
                        assert_eq!(item["correlationId"], JsonValue::String(id.clone()));
                        item.insert("correlationId".into(), JsonValue::String("context".into()));
                        items.push(JsonValue::Object(item));
                    }
                }
            }
            assert_eq!(
                JsonValue::Array(items),
                value(fixture["items"]),
                "{name}, split {split}"
            );
            assert_eq!(
                error,
                fixture.get("error").map(|v| v.string().unwrap()),
                "{name}, split {split}"
            );
            assert!(next(&mut stream).is_none());
            assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        }
    }
}

fn output(kind: &str) -> (TtsRequestTextVoicef0bb1766Output, JsonValue) {
    let rate = || TtsRequestTextVoicef0bb1766OutputPcmSampleRateHz::Number24000(Default::default());
    let (output, container, encoding) = match kind {
        "mp3" => {
            return (
                TtsRequestTextVoicef0bb1766Output::Mp3(TtsRequestTextVoicef0bb1766OutputMp3 {
                    format: Default::default(),
                    sample_rate_hz: rate(),
                    bit_rate_bps: TtsRequestTextVoicef0bb1766OutputMp3BitRateBps::Number128000(
                        Default::default(),
                    ),
                }),
                parse(r#"{"container":"mp3","sample_rate":24000,"bit_rate":128000}"#),
            )
        }
        "pcm" => (
            TtsRequestTextVoicef0bb1766Output::Pcm(pcm()),
            "raw",
            "pcm_s16le",
        ),
        "float" => {
            let mut v = pcm();
            v.sample_encoding =
                TtsRequestTextVoicef0bb1766OutputPcmSampleEncoding::Float32(Default::default());
            (
                TtsRequestTextVoicef0bb1766Output::Pcm(v),
                "raw",
                "pcm_f32le",
            )
        }
        "mulaw" | "alaw" => (
            TtsRequestTextVoicef0bb1766Output::Object(TtsRequestTextVoicef0bb1766OutputObject {
                format: if kind == "mulaw" {
                    TtsRequestTextVoicef0bb1766OutputObjectFormat::Mulaw(Default::default())
                } else {
                    TtsRequestTextVoicef0bb1766OutputObjectFormat::Alaw(Default::default())
                },
                sample_rate_hz: rate(),
            }),
            "raw",
            if kind == "mulaw" {
                "pcm_mulaw"
            } else {
                "pcm_alaw"
            },
        ),
        _ => {
            let (encoding, native) = match kind {
                "wav16" => (
                    TtsRequestTextVoicef0bb1766OutputWavSampleEncoding::SignedInteger16(
                        Default::default(),
                    ),
                    "pcm_s16le",
                ),
                "wavfloat" => (
                    TtsRequestTextVoicef0bb1766OutputWavSampleEncoding::Float32(Default::default()),
                    "pcm_f32le",
                ),
                "wavmulaw" => (
                    TtsRequestTextVoicef0bb1766OutputWavSampleEncoding::Mulaw(Default::default()),
                    "pcm_mulaw",
                ),
                "wavalaw" => (
                    TtsRequestTextVoicef0bb1766OutputWavSampleEncoding::Alaw(Default::default()),
                    "pcm_alaw",
                ),
                _ => panic!("unknown fixture"),
            };
            (
                TtsRequestTextVoicef0bb1766Output::Wav(TtsRequestTextVoicef0bb1766OutputWav {
                    format: Default::default(),
                    byte_order: None,
                    sample_encoding: Some(encoding),
                    sample_rate_hz: rate(),
                }),
                "wav",
                native,
            )
        }
    };
    (
        output,
        parse(&format!(
            r#"{{"container":"{container}","sample_rate":24000,"encoding":"{encoding}"}}"#
        )),
    )
}

#[test]
fn all_http_model_encodings_and_independent_controls() {
    let auth = auth();
    for model in ["sonic-3", "sonic-3.5", "sonic-3.6"] {
        for kind in [
            "mp3", "pcm", "float", "mulaw", "alaw", "wav16", "wavfloat", "wavmulaw", "wavalaw",
        ] {
            let (format, expected_output) = output(kind);
            let mut request = whole();
            request.output = format;
            if model == "sonic-3" {
                request.model = TtsRequestTextVoicef0bb1766Model::Sonic3(Default::default());
            }
            request.language = Some(TtsRequestTextVoicef0bb1766Language::En(Default::default()));
            request.accent = Some("fr".into());
            request.lexicon = Some("dictionary".into());
            request.speed = Some(0.6);
            request.volume_scale = Some(0.5);
            request.emotion = Some(TtsRequestTextVoicef0bb1766Emotion::Nostalgic(
                Default::default(),
            ));
            request.text_normalization =
                Some(TtsRequestTextVoicef0bb1766TextNormalization::Object(
                    TtsRequestTextVoicef0bb1766TextNormalizationObject {
                        locale: "en-IN".into(),
                    },
                ));
            let request = if model == "sonic-3.6" {
                TtsRequest::Sonic36TextVoice35faf3f2(TtsRequestSonic36TextVoice35faf3f2 {
                    model: Default::default(),
                    voice: request.voice,
                    text: request.text,
                    output: request.output,
                    language: Some("en-GB".into()),
                    accent: request.accent,
                    lexicon: request.lexicon,
                    emotion: request.emotion,
                    speed: request.speed,
                    volume_scale: request.volume_scale,
                    text_normalization: request.text_normalization,
                })
            } else {
                TtsRequest::TextVoicef0bb1766(request)
            };
            let counts = Arc::new(Counts::default());
            let trace = Trace::default();
            let http = Http::new(HttpResponse {
                status: 200,
                headers: Vec::new(),
                body: body(
                    vec![Ok(vec![0, 255]), Ok(b"later".to_vec())],
                    &counts,
                    &trace,
                    false,
                    "response",
                ),
            });
            let mut stream = ready(synthesize(
                request,
                Options {
                    auth: Some(&auth),
                    transport: Some(&http),
                    base_url: Some("https://proxy.test/prefix%20path/?keep=1"),
                    ..Default::default()
                },
            ))
            .unwrap();
            assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
            assert_eq!(
                canonical(next(&mut stream).unwrap().unwrap()),
                parse("[0,255]")
            );
            drop(stream);
            assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
            assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
            let requests = http.requests.lock().unwrap();
            let sent = &requests[0];
            assert_eq!(
                (&*sent.method, &*sent.url),
                ("POST", "https://proxy.test/prefix%20path/tts/bytes?keep=1")
            );
            assert_eq!(
                sent.headers,
                [
                    ("authorization".into(), "Bearer key".into()),
                    ("cartesia-version".into(), VERSION.into()),
                    ("content-type".into(), "application/json".into())
                ]
            );
            let mut expected = match parse(
                r#"{"voice":"saved-custom","transcript":"Hello","accent":"fr","pronunciation_dict_id":"dictionary","normalization":"en-IN","generation_config":{"speed":0.6,"volume":0.5,"emotion":"nostalgic"}}"#,
            ) {
                JsonValue::Object(v) => v,
                _ => unreachable!(),
            };
            expected.insert("model_id".into(), JsonValue::String(model.into()));
            expected.insert("output_format".into(), expected_output);
            expected.insert(
                if model == "sonic-3.6" {
                    "locale"
                } else {
                    "language"
                }
                .into(),
                JsonValue::String(if model == "sonic-3.6" { "en-GB" } else { "en" }.into()),
            );
            assert_eq!(
                parse(std::str::from_utf8(&sent.body).unwrap()),
                JsonValue::Object(expected)
            );
        }
    }
}

#[test]
fn http_errors_limits_and_pending_drop() {
    let auth = auth();
    for (text, status, limit, expected) in [
        (
            r#"{"title":"Quota","message":"exhausted","error_code":null,"request_id":"req","doc_url":"docs"}"#,
            429,
            1000,
            "Cartesia 429: Quota: exhausted",
        ),
        (
            "unavailable",
            502,
            1000,
            "Cartesia 502: Request failed: unavailable",
        ),
        ("large", 502, 4, "Cartesia response exceeds max_json_bytes"),
    ] {
        let counts = Arc::new(Counts::default());
        let trace = Trace::default();
        let http = Http::new(HttpResponse {
            status,
            headers: Vec::new(),
            body: body(
                vec![Ok(text.as_bytes().to_vec())],
                &counts,
                &trace,
                false,
                "response",
            ),
        });
        let mut stream = ready(synthesize(
            TtsRequest::TextVoicef0bb1766(whole()),
            Options {
                auth: Some(&auth),
                transport: Some(&http),
                max_json_bytes: limit,
                ..Default::default()
            },
        ))
        .unwrap();
        let error = next(&mut stream).unwrap().err().unwrap();
        assert_eq!(error.to_string(), expected);
        if status == 429 {
            let e = error.downcast_ref::<Error>().unwrap();
            assert_eq!(
                (
                    e.status_code,
                    e.error_code.as_deref(),
                    e.request_id.as_deref(),
                    e.doc_url.as_deref()
                ),
                (429.0, None, Some("req"), Some("docs"))
            );
        }
        assert!(next(&mut stream).is_none());
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
    let counts = Arc::new(Counts::default());
    let trace = Trace::default();
    let marker = Arc::new(());
    let http = Http::new(HttpResponse {
        status: 200,
        headers: Vec::new(),
        body: body(
            vec![Ok(vec![1]), Err(super::marker(&marker))],
            &counts,
            &trace,
            false,
            "response",
        ),
    });
    let mut stream = ready(synthesize(
        TtsRequest::TextVoicef0bb1766(whole()),
        Options {
            auth: Some(&auth),
            transport: Some(&http),
            ..Default::default()
        },
    ))
    .unwrap();
    next(&mut stream).unwrap().unwrap();
    same(&next(&mut stream).unwrap().err().unwrap(), &marker);
    assert!(next(&mut stream).is_none());
    let counts = Arc::new(Counts::default());
    let http = Http::new(HttpResponse {
        status: 200,
        headers: Vec::new(),
        body: body(Vec::new(), &counts, &trace, true, "response"),
    });
    let mut stream = ready(synthesize(
        TtsRequest::TextVoicef0bb1766(whole()),
        Options {
            auth: Some(&auth),
            transport: Some(&http),
            ..Default::default()
        },
    ))
    .unwrap();
    let waker = Waker::from(Arc::new(Counts::default()));
    assert!(Pin::new(&mut stream)
        .poll_next(&mut Context::from_waker(&waker))
        .is_pending());
    drop(stream);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    let mut http = Http::new(HttpResponse {
        status: 200,
        headers: Vec::new(),
        body: body(Vec::new(), &counts, &trace, false, "unused"),
    });
    http.stall = true;
    let mut pending = Box::pin(synthesize(
        TtsRequest::TextVoicef0bb1766(whole()),
        Options {
            auth: Some(&auth),
            transport: Some(&http),
            ..Default::default()
        },
    ));
    assert!(pending
        .as_mut()
        .poll(&mut Context::from_waker(&waker))
        .is_pending());
    drop(pending);
    assert_eq!(http.counts.drops.load(Ordering::SeqCst), 1);
}
