use super::*;

#[test]
fn falcon_fixture_and_early_bytes_before_eof() {
    let counts = Arc::new(Counts::default());
    let http = Http {
        requests: Mutex::default(),
        responses: Mutex::new(VecDeque::from([HttpResponse {
            status: 200,
            headers: vec![("content-type".into(), "audio/pcm".into())],
            body: Box::pin(Source {
                values: VecDeque::from([Ok(vec![0, 255, 128])]),
                counts: counts.clone(),
                stall: true,
                trace: Arc::default(),
            }),
        }])),
    };
    let auth = auth();
    let mut stream = ready(synthesize(
        TtsRequest::TextVoice(request()),
        Options {
            auth: Some(&auth),
            transport: Some(&http),
            base_url: Some("https://proxy.invalid/a%2Fb/?tenant=one"),
            ..Default::default()
        },
    ))
    .unwrap();
    let SynthesisItem::Bytes(data) = next(&mut stream).unwrap().unwrap() else {
        panic!("bytes")
    };
    assert_eq!(data, vec![0, 255, 128]);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    let requests = http.requests.lock().unwrap();
    assert_eq!(
        requests[0].url,
        "https://proxy.invalid/a%2Fb/v1/speech/stream?tenant=one"
    );
    assert_eq!(
        value(std::str::from_utf8(&requests[0].body).unwrap()),
        fixture(fixtures()["falcon"])
    );
    assert_eq!(
        requests[0].headers,
        vec![
            ("api-key".into(), "test-key".into()),
            ("Content-Type".into(), "application/json".into()),
            ("Accept".into(), "audio/*, application/octet-stream".into())
        ]
    );
    drop(stream);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}
#[test]
fn gen2_inline_download_and_independent_timing_match_fixture() {
    for inline in [false, true] {
        let f = fixtures();
        let http = http(200, f["generation"].text().as_bytes().to_vec());
        http.responses.lock().unwrap().push_back(HttpResponse {
            status: 200,
            headers: vec![],
            body: source(vec![vec![0, 255, 128]]),
        });
        let auth = auth();
        let mut r = gen2();
        r.timestamp_granularity = Some(Default::default());
        if inline {
            r.audio_retention = Some(TtsRequestGen2TextVoiceca621e19AudioRetention::False(
                Default::default(),
            ));
        }
        let mut stream = ready(synthesize(
            TtsRequest::Gen2TextVoiceca621e19(r),
            Options {
                auth: Some(&auth),
                transport: Some(&http),
                ..Default::default()
            },
        ))
        .unwrap();
        let SynthesisItem::OrderedOrTimeline(e) = next(&mut stream).unwrap().unwrap() else {
            panic!("audio")
        };
        assert_eq!(e.audio, Some(vec![0, 255, 128]));
        assert_eq!(e.correlation.value(), "timeline");
        assert_eq!(e.timestamps.len(), 0);
        assert!(e.correlation_id.is_none());
        let SynthesisItem::OrderedOrTimeline(e) = next(&mut stream).unwrap().unwrap() else {
            panic!("timing")
        };
        assert_eq!(e.duration_ms, Some(500.0));
        assert_eq!(e.audio, None);
        assert_eq!(marks(e.timestamps), fixture(f["timestamps"]));
        let SynthesisItem::Done(done) = next(&mut stream).unwrap().unwrap() else {
            panic!("done")
        };
        assert_eq!(done.remaining_characters, Some(0.0));
        assert_eq!(done.warning, Some(String::new()));
        assert!(next(&mut stream).is_none());
        assert!(stream.state.is_none());
        let requests = http.requests.lock().unwrap();
        assert_eq!(requests.len(), if inline { 1 } else { 2 });
        let mut expected = f["gen2"].object().unwrap();
        expected.insert(
            "encodeAsBase64".into(),
            Raw::parse(if inline { "true" } else { "false" }).unwrap(),
        );
        assert_eq!(
            value(std::str::from_utf8(&requests[0].body).unwrap()),
            Value::Map(expected.into_iter().map(|(k, v)| (k, fixture(v))).collect())
        );
        if !inline {
            assert_eq!(requests[1].method, "GET");
            assert_eq!(requests[1].url, "https://files.invalid/audio/?signed=one");
            assert_eq!(requests[1].headers, vec![]);
            assert_eq!(requests[1].body, vec![]);
        }
    }
}
#[test]
fn errors_limits_and_empty_audio_are_not_success() {
    for (status, data, gen2, limit, error) in [
        (429, "quota", false, 100, "Murf synthesis failed (429)"),
        (200, "", false, 100, "Murf returned no audio"),
        (
            200,
            "xxxxxx",
            true,
            4,
            "Murf response exceeds max_json_bytes",
        ),
        (
            200,
            "{}",
            true,
            100,
            "Murf returned an invalid audio duration",
        ),
    ] {
        let http = http(status, data.as_bytes().to_vec());
        let auth = auth();
        let r = if gen2 {
            TtsRequest::Gen2TextVoiceca621e19(super::gen2())
        } else {
            TtsRequest::TextVoice(request())
        };
        let mut stream = ready(synthesize(
            r,
            Options {
                auth: Some(&auth),
                transport: Some(&http),
                max_json_bytes: limit,
                ..Default::default()
            },
        ))
        .unwrap();
        let err = next(&mut stream).unwrap().err().unwrap();
        assert_eq!(err.to_string(), error);
        if status == 429 {
            assert_eq!(
                err.downcast_ref::<Error>().unwrap(),
                &Error {
                    status: Some(429),
                    body: "quota".into(),
                    retry_after: None
                }
            );
        }
        assert!(stream.state.is_none());
        assert!(next(&mut stream).is_none());
    }
    let http = http(200, b"{}".to_vec());
    http.responses.lock().unwrap()[0]
        .headers
        .push(("Content-Type".into(), "application/json".into()));
    let auth = auth();
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
        next(&mut stream).unwrap().err().unwrap().to_string(),
        "Murf returned a non-audio streaming response"
    );
}
#[test]
fn unsafe_audio_urls_fail_before_a_download() {
    for (url, error) in [
        (
            "http://files.invalid/audio",
            "Murf returned an unsafe audio file URL",
        ),
        (
            "https://user:pass@files.invalid/audio",
            "Invalid Murf endpoint URL",
        ),
    ] {
        let doc = format!(
            "{{\"audioFile\":{},\"audioLengthInSeconds\":0.5,\"remainingCharacterCount\":0}}",
            encoded(&JsonValue::String(url.into()))
        );
        let http = http(200, doc.into_bytes());
        let auth = auth();
        let mut stream = ready(synthesize(
            TtsRequest::Gen2TextVoiceca621e19(gen2()),
            Options {
                auth: Some(&auth),
                transport: Some(&http),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(next(&mut stream).unwrap().err().unwrap().to_string(), error);
        assert_eq!(http.requests.lock().unwrap().len(), 1);
    }
}

#[test]
fn malformed_gen2_fields_and_native_error_body_are_preserved() {
    for (field, replacement, error) in [
        (
            "audioLengthInSeconds",
            "true",
            "Murf returned an invalid audio duration",
        ),
        (
            "audioLengthInSeconds",
            "-1",
            "Murf returned an invalid audio duration",
        ),
        (
            "remainingCharacterCount",
            "0.5",
            "Murf returned an invalid remaining character count",
        ),
        ("warning", "null", "Murf returned an invalid warning"),
        ("wordDurations", "null", "Murf returned no word durations"),
        (
            "wordDurations",
            r#"[{"word":"Hi","startMs":2,"endMs":1}]"#,
            "Murf returned an invalid word duration",
        ),
        (
            "encodedAudio",
            r#""!!!""#,
            "Murf returned invalid base64 audio",
        ),
    ] {
        let mut fields = fixtures()["generation"].object().unwrap();
        fields.insert(field.into(), Raw::parse(replacement).unwrap());
        let text = format!(
            "{{{}}}",
            fields
                .iter()
                .map(|(k, v)| format!("{}:{}", encoded(&JsonValue::String(k.clone())), v.text()))
                .collect::<Vec<_>>()
                .join(",")
        );
        assert_eq!(
            protocol::generation(&text, true, true)
                .err()
                .unwrap()
                .to_string(),
            error
        );
    }
    let text = r#"{"error":{"code":429,"message":"quota"}}"#;
    let error = protocol::packet(text).err().unwrap();
    assert_eq!(
        error.downcast_ref::<Error>().unwrap(),
        &Error {
            status: None,
            body: text.into(),
            retry_after: None
        }
    );
}

#[test]
fn dropping_during_audio_metadata_or_download_releases_response() {
    for stage in ["audio", "metadata", "download"] {
        let counts = Arc::new(Counts::default());
        let pending = HttpResponse {
            status: 200,
            headers: vec![],
            body: Box::pin(Source::<Vec<u8>> {
                values: VecDeque::new(),
                counts: counts.clone(),
                stall: true,
                trace: Arc::default(),
            }),
        };
        let mut responses = VecDeque::new();
        if stage == "download" {
            responses.push_back(HttpResponse {
                status: 200,
                headers: vec![],
                body: source(vec![fixtures()["generation"].text().as_bytes().to_vec()]),
            });
        }
        responses.push_back(pending);
        let http = Http {
            requests: Mutex::default(),
            responses: Mutex::new(responses),
        };
        let auth = auth();
        let r = if stage == "audio" {
            TtsRequest::TextVoice(request())
        } else {
            TtsRequest::Gen2TextVoiceca621e19(gen2())
        };
        let mut stream = ready(synthesize(
            r,
            Options {
                auth: Some(&auth),
                transport: Some(&http),
                ..Default::default()
            },
        ))
        .unwrap();
        let waker = Waker::from(counts.clone());
        let mut cx = Context::from_waker(&waker);
        assert!(Pin::new(&mut stream).poll_next(&mut cx).is_pending());
        assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
        drop(stream);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}
