use super::*;

#[test]
fn shared_settings_and_early_http_bytes() {
    let expected = fixtures();
    let config = settings::settings(TtsRequest::TextVoice9b47fc40(request()));
    assert_eq!(
        value(&encoded(&JsonValue::Object(config.wire))),
        fixture(expected["configuration"])
    );
    let counts = Arc::new(Counts::default());
    let http = Http {
        requests: Mutex::default(),
        responses: Mutex::new(VecDeque::from([HttpResponse {
            status: 200,
            headers: vec![(
                "content-type".into(),
                "text/event-stream; charset=utf-8".into(),
            )],
            body: Box::pin(Source {
                values: VecDeque::from([Ok(
                    b"data: {\"data\":{\"status\":1,\"audio\":\"00ff\"}}\r\n\r\n".to_vec(),
                )]),
                counts: counts.clone(),
                stall: true,
                trace: Arc::default(),
            }),
        }])),
    };
    let auth = auth();
    let mut stream = ready(synthesize(
        TtsRequest::TextVoice9b47fc40(request()),
        Options {
            auth: Some(&auth),
            transport: Some(&http),
            base_url: Some("https://proxy.invalid/a%2Fb/?tenant=x"),
            ..Default::default()
        },
    ))
    .unwrap();
    let SynthesisItem::Bytes(bytes) = next(&mut stream).unwrap().unwrap() else {
        panic!("bytes")
    };
    assert_eq!(bytes, vec![0, 255]);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    let requests = http.requests.lock().unwrap();
    assert_eq!(
        requests[0].url,
        "https://proxy.invalid/a%2Fb/v1/t2a_v2?tenant=x"
    );
    assert_eq!(
        requests[0].headers[0],
        ("Authorization".into(), "Bearer test-key".into())
    );
    let fields = Raw::parse(std::str::from_utf8(&requests[0].body).unwrap())
        .unwrap()
        .object()
        .unwrap();
    assert_eq!(
        fixture(fields["stream_options"]),
        value(r#"{"exclude_aggregated_audio":true}"#)
    );
    drop(stream);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn independent_subtitles_and_shared_usage() {
    let f = fixtures();
    let data=format!("data: {{\"data\":{{\"status\":1,\"audio\":\"00\"}}}}\n\ndata: {{\"data\":{{\"status\":2,\"subtitle_file\":\"https://files.invalid/subtitles/?signed=x\"}},\"trace_id\":\"trace\",\"extra_info\":{}}}\n\n",f["usage"].text().replace('\n',""));
    let http = http(200, true, &data);
    let subtitle_drops = Arc::new(Counts::default());
    http.responses.lock().unwrap().push_back(HttpResponse {
        status: 200,
        headers: vec![],
        body: Box::pin(Source {
            values: VecDeque::from([Ok(f["subtitles"].text().as_bytes().to_vec())]),
            counts: subtitle_drops.clone(),
            stall: false,
            trace: Arc::default(),
        }),
    });
    let mut r = request();
    r.timestamp_granularity = Some(TtsRequestText77d171beTimestampGranularity::Word(
        Default::default(),
    ));
    let auth = auth();
    let mut stream = ready(synthesize(
        TtsRequest::TextVoice9b47fc40(r),
        Options {
            auth: Some(&auth),
            transport: Some(&http),
            ..Default::default()
        },
    ))
    .unwrap();
    let SynthesisItem::OrderedOrTimeline(e) = next(&mut stream).unwrap().unwrap() else {
        panic!("audio envelope")
    };
    assert_eq!(e.correlation.value(), "timeline");
    assert_eq!(e.audio, Some(vec![0]));
    assert!(e.timestamps.is_empty());
    assert_eq!(http.requests.lock().unwrap().len(), 1);
    let SynthesisItem::OrderedOrTimeline(e) = next(&mut stream).unwrap().unwrap() else {
        panic!("timestamp envelope")
    };
    assert_eq!(e.correlation.value(), "timeline");
    assert!(e.audio.is_none());
    assert_eq!(marks(e.timestamps), fixture(f["timestamps"]));
    assert_eq!(e.trace_id.as_deref(), Some("trace"));
    assert!(e.correlation_id.is_none());
    assert_eq!(subtitle_drops.drops.load(Ordering::SeqCst), 1);
    let SynthesisItem::Done(done) = next(&mut stream).unwrap().unwrap() else {
        panic!("done")
    };
    assert_eq!(usage(done.usage.unwrap()), fixture(f["normalizedUsage"]));
    assert!(stream.state.is_none());
    assert!(next(&mut stream).is_none());
    let requests = http.requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    assert!(requests[1].headers.is_empty());
    assert_eq!(requests[1].method, "GET");
    assert_eq!(requests[1].url, "https://files.invalid/subtitles/?signed=x");
}

#[test]
fn malformed_packets_hex_and_subtitles_are_rejected_exactly() {
    for audio in ["0", "001", "0g", "0x01", "AA BB", "AA\n", "ＡＡ", "AQI="] {
        let text = format!(
            "{{\"data\":{{\"audio\":{}}}}}",
            encoded(&JsonValue::String(audio.into()))
        );
        assert_eq!(
            protocol::packet(&text).err().unwrap().to_string(),
            "MiniMax returned invalid hex audio"
        );
    }
    for (data, error) in [
        ("null", "MiniMax returned an invalid response object"),
        (
            r#"{"base_resp":{"status_code":true}}"#,
            "MiniMax returned invalid base_resp.status_code",
        ),
        (
            r#"{"data":{"status":true}}"#,
            "MiniMax returned invalid data.status",
        ),
        (r#"{"is_final":null}"#, "MiniMax returned invalid is_final"),
        (
            r#"{"extra_info":{"audio_length":0.5}}"#,
            "MiniMax returned invalid audio_length",
        ),
        (
            r#"{"extra_info":{"invisible_character_ratio":2}}"#,
            "MiniMax returned invalid invisible_character_ratio",
        ),
    ] {
        assert_eq!(protocol::packet(data).err().unwrap().to_string(), error);
    }
    for (data, error) in [
        (
            r#"{"subtitles":[]}"#,
            "MiniMax subtitles must be a JSON array",
        ),
        (
            r#"[{"text":"Hi","time_begin":-1,"time_end":1}]"#,
            "MiniMax returned invalid subtitle time_begin",
        ),
        (
            r#"[{"text":"Hi","time_begin":2,"time_end":1}]"#,
            "MiniMax returned reversed subtitle timestamps",
        ),
        (
            r#"[{"text":null,"time_begin":0,"time_end":1}]"#,
            "MiniMax returned invalid subtitle text",
        ),
    ] {
        assert_eq!(
            protocol::subtitles(data, "word").err().unwrap().to_string(),
            error
        );
    }
}

#[test]
fn bounded_errors_and_http_completion() {
    for (status, sse, data, limit, error) in [
        (
            200,
            true,
            "",
            100,
            "MiniMax HTTP stream ended before completion",
        ),
        (
            200,
            true,
            "data: [DONE]\n\n",
            100,
            "MiniMax HTTP stream ended before completion",
        ),
        (
            200,
            false,
            "{}",
            100,
            "MiniMax JSON synthesis did not report completion",
        ),
        (
            200,
            false,
            "xxxxxxxxxx",
            4,
            "MiniMax response exceeds max_json_bytes",
        ),
        (
            200,
            false,
            r#"{"data":{"status":2}}"#,
            100,
            "MiniMax returned no audio",
        ),
    ] {
        let http = http(status, sse, data);
        let auth = auth();
        let mut stream = ready(synthesize(
            TtsRequest::TextVoice9b47fc40(request()),
            Options {
                auth: Some(&auth),
                transport: Some(&http),
                max_json_bytes: limit,
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(next(&mut stream).unwrap().err().unwrap().to_string(), error);
        assert!(stream.state.is_none());
        assert!(next(&mut stream).is_none());
    }
    for status in [307, 429] {
        let http = http(status, false, "<html>gateway</html>");
        http.responses.lock().unwrap()[0]
            .headers
            .push(("Retry-After".into(), "2".into()));
        let auth = auth();
        let mut stream = ready(synthesize(
            TtsRequest::TextVoice9b47fc40(request()),
            Options {
                auth: Some(&auth),
                transport: Some(&http),
                ..Default::default()
            },
        ))
        .unwrap();
        let error = next(&mut stream).unwrap().err().unwrap();
        assert_eq!(
            *error.downcast_ref::<Error>().unwrap(),
            Error {
                message: format!("MiniMax HTTP {status}"),
                code: None,
                status: Some(status),
                retry_after: Some("2".into())
            }
        );
        assert_eq!(http.requests.lock().unwrap().len(), 1);
    }
}

#[test]
fn dropping_subtitle_and_error_reads_releases_the_current_body() {
    for subtitles in [false, true] {
        let counts = Arc::new(Counts::default());
        let pending = HttpResponse {
            status: if subtitles { 200 } else { 429 },
            headers: vec![],
            body: Box::pin(Source::<Vec<u8>> {
                values: VecDeque::new(),
                counts: counts.clone(),
                stall: true,
                trace: Arc::default(),
            }),
        };
        let mut responses = VecDeque::new();
        if subtitles {
            responses.push_back(HttpResponse{status:200,headers:vec![],body:source(vec![br#"{"data":{"status":2,"audio":"00","subtitle_file":"https://files.invalid/marks"}}"#.to_vec()])});
        }
        responses.push_back(pending);
        let http = Http {
            requests: Mutex::default(),
            responses: Mutex::new(responses),
        };
        let auth = auth();
        let mut r = request();
        if subtitles {
            r.timestamp_granularity = Some(TtsRequestText77d171beTimestampGranularity::Sentence(
                Default::default(),
            ));
        }
        let mut stream = ready(synthesize(
            TtsRequest::TextVoice9b47fc40(r),
            Options {
                auth: Some(&auth),
                transport: Some(&http),
                ..Default::default()
            },
        ))
        .unwrap();
        if subtitles {
            next(&mut stream).unwrap().unwrap();
        }
        let waker = Waker::from(Arc::new(Counts::default()));
        let mut cx = Context::from_waker(&waker);
        assert!(Pin::new(&mut stream).poll_next(&mut cx).is_pending());
        assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
        drop(stream);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn invalid_subtitle_urls_do_not_make_a_second_request() {
    for target in [
        "ftp://files.invalid/a",
        "https://user:password@files.invalid/a",
        "https://files.invalid/%xx",
        "https://files.invalid/a#fragment",
    ] {
        let data = format!(
            "{{\"data\":{{\"status\":2,\"audio\":\"00\",\"subtitle_file\":{}}}}}",
            encoded(&JsonValue::String(target.into()))
        );
        let http = http(200, false, &data);
        let auth = auth();
        let mut r = request();
        r.timestamp_granularity = Some(TtsRequestText77d171beTimestampGranularity::Word(
            Default::default(),
        ));
        let mut stream = ready(synthesize(
            TtsRequest::TextVoice9b47fc40(r),
            Options {
                auth: Some(&auth),
                transport: Some(&http),
                ..Default::default()
            },
        ))
        .unwrap();
        next(&mut stream).unwrap().unwrap();
        assert_eq!(
            next(&mut stream).unwrap().err().unwrap().to_string(),
            "Invalid MiniMax endpoint URL"
        );
        assert_eq!(http.requests.lock().unwrap().len(), 1);
    }
}
