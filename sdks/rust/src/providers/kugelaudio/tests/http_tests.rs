use super::*;

#[test]
fn shared_http_fixture_and_raw_audio() {
    let auth = auth();
    let http = Http::new(200, vec![vec![], vec![1, 2], vec![255]]);
    let mut stream = ready(synthesize(
        TtsRequest::TextVoice(request()),
        Options {
            auth: Some(&auth),
            transport: Some(&http),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        collect(&mut stream).unwrap(),
        vec![Value::Binary(vec![1, 2]), Value::Binary(vec![255])]
    );
    let requests = http.requests.lock().unwrap();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].method, "POST");
    assert_eq!(
        requests[0].url,
        "https://api.kugelaudio.com/v1/tts/generate"
    );
    assert_eq!(
        requests[0].headers,
        vec![
            ("authorization".into(), "Bearer test-key".into()),
            ("content-type".into(), "application/json".into())
        ]
    );
    let Value::Map(mut expected) = fixture(fixtures()["settings"]) else {
        unreachable!()
    };
    expected.insert("text".into(), Value::String("Hi".into()));
    expected.insert("temperature".into(), Value::Number(0.4));
    assert_eq!(
        value(std::str::from_utf8(&requests[0].body).unwrap()),
        Value::Map(expected)
    );
}

#[test]
fn all_models_formats_and_dictionary_omissions() {
    for model in [
        TtsRequestTextVoiceModel::Kugel1(Default::default()),
        TtsRequestTextVoiceModel::Kugel1Turbo(Default::default()),
        TtsRequestTextVoiceModel::Kugel2(Default::default()),
        TtsRequestTextVoiceModel::Kugel2Turbo(Default::default()),
        TtsRequestTextVoiceModel::Kugel25(Default::default()),
        TtsRequestTextVoiceModel::Kugel3(Default::default()),
    ] {
        let expected = model.value();
        let mut r = request();
        r.model = Some(model);
        let c = settings::settings(TtsRequest::TextVoice(r)).unwrap();
        assert_eq!(c.body["model_id"], JsonValue::String(expected.into()));
    }
    for rate in [
        TtsRequestTextVoiceOutputPcmSampleRateHz::Number8000(Default::default()),
        TtsRequestTextVoiceOutputPcmSampleRateHz::Number16000(Default::default()),
        TtsRequestTextVoiceOutputPcmSampleRateHz::Number22050(Default::default()),
        TtsRequestTextVoiceOutputPcmSampleRateHz::Number24000(Default::default()),
        TtsRequestTextVoiceOutputPcmSampleRateHz::Number44100(Default::default()),
    ] {
        let expected = rate.value();
        let mut r = request();
        let TtsRequestTextVoiceOutput::Pcm(pcm) = &mut r.output else {
            unreachable!()
        };
        pcm.sample_rate_hz = Some(rate);
        let c = settings::settings(TtsRequest::TextVoice(r)).unwrap();
        assert_eq!(c.body["sample_rate"], JsonValue::Number(expected));
        assert_eq!(c.body.get("output_format"), None);
        assert_eq!((c.rate, c.encoding), (expected, "pcm_s16le"));
    }
    for format in [
        TtsRequestTextVoiceOutputObjectFormat::Alaw(Default::default()),
        TtsRequestTextVoiceOutputObjectFormat::Mulaw(Default::default()),
    ] {
        let encoding = format.value();
        let mut r = request();
        r.output = TtsRequestTextVoiceOutput::Object(TtsRequestTextVoiceOutputObject {
            format,
            sample_rate_hz: None,
        });
        let c = settings::settings(TtsRequest::TextVoice(r)).unwrap();
        assert_eq!((c.rate, c.encoding), (8000.0, encoding));
        assert_eq!(
            c.body["output_format"],
            JsonValue::String(
                if encoding == "mulaw" {
                    "ulaw_8000"
                } else {
                    "alaw_8000"
                }
                .into()
            )
        );
    }
    for ids in [None, Some(vec![]), Some(vec![1.0, 2.0])] {
        let mut r = request();
        r.voice = TtsRequestTextVoiceVoice::Number(7.0);
        r.pronunciation_dictionary_selection =
            Some(TtsRequestTextVoicePronunciationDictionarySelection {
                scope: 3.0,
                ids: ids.clone(),
            });
        let c = settings::settings(TtsRequest::TextVoice(r)).unwrap();
        assert_eq!(c.body["voice_id"], JsonValue::Number(7.0));
        assert_eq!(c.body["project_id"], JsonValue::Number(3.0));
        assert_eq!(
            c.body.get("dictionary_ids").cloned(),
            ids.map(|v| JsonValue::Array(v.into_iter().map(JsonValue::Number).collect()))
        );
    }
}

#[test]
fn http_errors_limits_headers_and_immediate_drop() {
    let auth = auth();
    let http = Http::new(
        429,
        vec![br#"{"error":"quota","error_code":"QUOTA"}"#.to_vec()],
    );
    http.response
        .lock()
        .unwrap()
        .as_mut()
        .unwrap()
        .headers
        .push(("Retry-After".into(), "3".into()));
    let error = ready(synthesize(
        TtsRequest::TextVoice(request()),
        Options {
            auth: Some(&auth),
            transport: Some(&http),
            ..Default::default()
        },
    ))
    .err()
    .unwrap();
    assert_eq!(
        error.downcast_ref::<Error>(),
        Some(&Error {
            message: "quota".into(),
            status: Some(429),
            code: Some("QUOTA".into()),
            retry_after: Some("3".into())
        })
    );
    for (status, headers, chunks, limit, expected) in [
        (
            500,
            vec![],
            vec![vec![1, 2]],
            1,
            "KugelAudio response exceeds max_json_bytes",
        ),
        (
            200,
            vec![("X-Sample-Rate".into(), "44100".into())],
            vec![],
            100,
            "KugelAudio returned an unexpected audio format",
        ),
        (
            200,
            vec![("X-Audio-Format".into(), "mulaw".into())],
            vec![],
            100,
            "KugelAudio returned an unexpected audio format",
        ),
    ] {
        let http = Http::new(status, chunks);
        http.response.lock().unwrap().as_mut().unwrap().headers = headers;
        let error = ready(synthesize(
            TtsRequest::TextVoice(request()),
            Options {
                auth: Some(&auth),
                transport: Some(&http),
                max_json_bytes: limit,
                ..Default::default()
            },
        ))
        .err()
        .unwrap();
        assert_eq!(error.to_string(), expected);
    }
    for unread in [false, true] {
        let counts = Arc::new(Counts::default());
        let http = Http::new(200, vec![]);
        http.response.lock().unwrap().as_mut().unwrap().body = Box::pin(Source {
            values: VecDeque::from([Err(failure("read failed"))]),
            counts: counts.clone(),
            stall: false,
            trace: Arc::default(),
        });
        let mut stream = ready(synthesize(
            TtsRequest::TextVoice(request()),
            Options {
                auth: Some(&auth),
                transport: Some(&http),
                ..Default::default()
            },
        ))
        .unwrap();
        if unread {
            drop(stream);
        } else {
            assert_eq!(
                next(&mut stream).unwrap().err().unwrap().to_string(),
                "read failed"
            );
            assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
            assert!(next(&mut stream).is_none());
        }
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn generated_validation_precedes_auth_and_io() {
    let invalid: Vec<Box<dyn Fn(&mut TtsRequestTextVoice)>> = vec![
        Box::new(|r| r.text = " ".into()),
        Box::new(|r| r.text = "😀".repeat(5001)),
        Box::new(|r| r.max_audio_tokens = Some(1.5)),
        Box::new(|r| r.speed = Some(1.3)),
        Box::new(|r| r.temperature = Some(f64::NAN)),
        Box::new(|r| {
            r.pronunciation_dictionary_selection =
                Some(TtsRequestTextVoicePronunciationDictionarySelection {
                    scope: 1.5,
                    ids: None,
                })
        }),
        Box::new(|r| {
            r.pronunciation_dictionary_selection =
                Some(TtsRequestTextVoicePronunciationDictionarySelection {
                    scope: 1.0,
                    ids: Some(vec![1.0; 51]),
                })
        }),
        Box::new(|r| {
            r.pronunciation_dictionary_selection =
                Some(TtsRequestTextVoicePronunciationDictionarySelection {
                    scope: 1.0,
                    ids: Some(vec![1.5]),
                })
        }),
    ];
    for mutate in invalid {
        let mut r = request();
        mutate(&mut r);
        let http = Http::new(200, vec![]);
        let e = ready(synthesize(
            TtsRequest::TextVoice(r),
            Options {
                transport: Some(&http),
                ..Default::default()
            },
        ))
        .err()
        .unwrap();
        assert_eq!(e.to_string(), "Invalid kugelaudio TTS request");
        assert_eq!(http.requests.lock().unwrap().len(), 0);
    }
    for voice in [
        TtsRequestTextVoiceVoice::String("\u{feff}".into()),
        TtsRequestTextVoiceVoice::Number(1.5),
    ] {
        let mut r = request();
        r.voice = voice;
        assert_eq!(
            ready(synthesize(TtsRequest::TextVoice(r), Options::default()))
                .err()
                .unwrap()
                .to_string(),
            "KugelAudio voice must be a nonempty handle or an integer ID"
        );
    }
}
