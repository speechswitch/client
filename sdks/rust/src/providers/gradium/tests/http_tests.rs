use super::*;

#[test]
fn bounded_http_framing_yields_before_a_large_line_finishes() {
    let auth = auth();
    let counts = Arc::new(Counts::default());
    let data = format!(
        "{}{{\"type\":\"audio\",\"audio\":\"AP8=\"}}\n",
        " ".repeat(8192)
    );
    let http = http(source(vec![Ok(data.into_bytes())], &counts, false), 200);
    let mut r = request();
    r.timestamp_granularity = Some(Default::default());
    let mut stream = ready(synthesize(
        r,
        Options {
            auth: Some(&auth),
            transport: Some(&http),
            ..Default::default()
        },
    ))
    .unwrap();
    let wakes = Arc::new(Counts::default());
    let waker = Waker::from(wakes.clone());
    let mut cx = Context::from_waker(&waker);
    assert!(Pin::new(&mut stream).poll_next(&mut cx).is_pending());
    assert_eq!(wakes.wakes.load(Ordering::SeqCst), 1);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    let SynthesisItem::Timeline(item) = next(&mut stream).unwrap().unwrap() else {
        panic!("expected timeline")
    };
    assert_eq!(item.audio, Some(vec![0, 255]));
    assert!(next(&mut stream).is_none());
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn shared_http_settings_and_byte_ownership() {
    let auth = auth();
    let fixtures = fixture_root()["http"].array().unwrap();
    let requests = requests();
    assert_eq!(fixtures.len(), requests.len());
    for (request, fixture) in requests.into_iter().zip(fixtures) {
        let counts = Arc::new(Counts::default());
        let http = http(
            source(vec![Ok(vec![0, 255]), Ok(vec![1])], &counts, false),
            200,
        );
        let mut stream = ready(synthesize(
            request,
            Options {
                auth: Some(&auth),
                transport: Some(&http),
                base_url: Some("https://proxy.test/a%2Fb/api/?tenant=one"),
                ..Default::default()
            },
        ))
        .unwrap();
        let request = http.request.lock().unwrap().take().unwrap();
        assert_eq!(request.method, "POST");
        assert_eq!(
            request.url,
            "https://proxy.test/a%2Fb/api/post/speech/tts?tenant=one"
        );
        assert_eq!(
            request.headers,
            vec![
                ("x-api-key".into(), "test-key".into()),
                ("content-type".into(), "application/json".into())
            ]
        );
        let body = String::from_utf8(request.body).unwrap();
        let mut fields = Raw::parse_exact(&body).unwrap().object().unwrap();
        assert_eq!(fields.remove("text").unwrap().string().unwrap(), "Hello");
        assert_eq!(
            fields.remove("only_audio").unwrap().boolean().unwrap(),
            true
        );
        let config = fields.remove("json_config").unwrap().string().unwrap();
        let mut actual: BTreeMap<_, _> = fields
            .into_iter()
            .map(|(k, v)| (k, super::fixture(v)))
            .collect();
        actual.insert(
            "json_config".into(),
            super::fixture(Raw::parse_exact(&config).unwrap()),
        );
        assert_eq!(
            Value::Map(actual),
            super::fixture(fixture.object().unwrap()["settings"])
        );
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        assert_eq!(
            collect(&mut stream).unwrap(),
            vec![Value::Binary(vec![0, 255]), Value::Binary(vec![1])]
        );
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn shared_timeline_every_byte_split_and_optional_eos() {
    let auth = auth();
    let fixtures = fixture_root()["timeline"].array().unwrap();
    let expected: Vec<_> = fixtures
        .iter()
        .map(|v| fixture(v.object().unwrap()["item"]))
        .collect();
    for eos in [false, true] {
        let mut data = b"\xef\xbb\xbf\r\n".to_vec();
        for (i, v) in fixtures.iter().enumerate() {
            if i > 0 {
                data.extend(b"\r\n");
            }
            data.extend(v.object().unwrap()["packet"].text().as_bytes());
        }
        if eos {
            data.extend(b"\n{\"type\":\"end_of_stream\"}\nignored");
        }
        for split in 0..=data.len() {
            let counts = Arc::new(Counts::default());
            let http = http(
                source(
                    vec![Ok(data[..split].to_vec()), Ok(data[split..].to_vec())],
                    &counts,
                    false,
                ),
                200,
            );
            let mut r = request();
            r.timestamp_granularity = Some(Default::default());
            let mut stream = ready(synthesize(
                r,
                Options {
                    auth: Some(&auth),
                    transport: Some(&http),
                    ..Default::default()
                },
            ))
            .unwrap();
            assert_eq!(
                collect(&mut stream).unwrap(),
                expected,
                "split {split}, eos {eos}"
            );
            assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        }
    }
}

#[test]
fn early_http_output_and_pending_drop_cancel_without_more_reads() {
    for timed in [false, true] {
        let auth = auth();
        let counts = Arc::new(Counts::default());
        let data = if timed {
            b"{\"type\":\"audio\",\"audio\":\"AP8=\"}\n".to_vec()
        } else {
            vec![0, 255]
        };
        let http = http(source(vec![Ok(data)], &counts, true), 200);
        let mut r = request();
        r.timestamp_granularity = timed.then(Default::default);
        let mut stream = ready(synthesize(
            r,
            Options {
                auth: Some(&auth),
                transport: Some(&http),
                ..Default::default()
            },
        ))
        .unwrap();
        assert!(next(&mut stream).unwrap().is_ok());
        assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
        let waker = Waker::from(Arc::new(Counts::default()));
        let mut cx = Context::from_waker(&waker);
        assert!(Pin::new(&mut stream).poll_next(&mut cx).is_pending());
        let before = counts.reads.load(Ordering::SeqCst);
        drop(stream);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(counts.reads.load(Ordering::SeqCst), before);
    }
}

#[test]
fn native_error_codes_messages_and_read_errors_are_preserved() {
    let auth = auth();
    for (data, message, code) in [
        (
            "\u{feff}error from server 1008: refusé\nnext",
            "refusé\nnext",
            Some(1008),
        ),
        ("error from server 9007199254740992: denied", "denied", None),
        (
            "error from server 00000000000000001008: denied",
            "denied",
            Some(1008),
        ),
        ("error from server 0: zero", "zero", Some(0)),
        ("proxy", "proxy", None),
    ] {
        let counts = Arc::new(Counts::default());
        let http = http(
            source(
                data.as_bytes().iter().map(|v| Ok(vec![*v])).collect(),
                &counts,
                false,
            ),
            403,
        );
        let error = ready(synthesize(
            request(),
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
                message: message.into(),
                status: Some(403),
                code
            })
        );
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
    let error = Box::new(std::io::Error::other("original"));
    let identity = (&*error) as *const std::io::Error;
    let counts = Arc::new(Counts::default());
    let http = http(
        source(vec![Err(error as TransportError)], &counts, false),
        500,
    );
    let error = ready(synthesize(
        request(),
        Options {
            auth: Some(&auth),
            transport: Some(&http),
            ..Default::default()
        },
    ))
    .err()
    .unwrap();
    assert_eq!(
        error.downcast_ref::<std::io::Error>().unwrap() as *const _,
        identity
    );
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn malformed_http_lines_and_limits_fail_exactly_and_release() {
    let auth = auth();
    for (data, limit, expected) in [
        (
            b"xxx".to_vec(),
            2,
            "Gradium JSON line exceeds max_json_bytes",
        ),
        (vec![0xff], 100, "Gradium returned invalid UTF-8"),
        (
            b"{} trailing".to_vec(),
            100,
            "Gradium returned invalid JSON",
        ),
        (
            b"{\"v\":NaN}".to_vec(),
            100,
            "Gradium returned invalid JSON",
        ),
    ] {
        let counts = Arc::new(Counts::default());
        let http = http(source(vec![Ok(data)], &counts, false), 200);
        let mut r = request();
        r.timestamp_granularity = Some(Default::default());
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
        assert_eq!(collect(&mut stream).unwrap_err().to_string(), expected);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
    let counts = Arc::new(Counts::default());
    let http = http(source(vec![Ok(b"long".to_vec())], &counts, false), 500);
    assert_eq!(
        ready(synthesize(
            request(),
            Options {
                auth: Some(&auth),
                transport: Some(&http),
                max_json_bytes: 3,
                ..Default::default()
            }
        ))
        .err()
        .unwrap()
        .to_string(),
        "Gradium response exceeds max_json_bytes"
    );
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn unread_stream_and_stalled_error_future_release_by_drop() {
    let auth = auth();
    for status in [200, 500] {
        let counts = Arc::new(Counts::default());
        let http = http(source(vec![], &counts, true), status);
        let mut future = Box::pin(synthesize(
            request(),
            Options {
                auth: Some(&auth),
                transport: Some(&http),
                ..Default::default()
            },
        ));
        let waker = Waker::from(Arc::new(Counts::default()));
        let mut cx = Context::from_waker(&waker);
        if status == 200 {
            drop(ready(future));
        } else {
            assert!(future.as_mut().poll(&mut cx).is_pending());
            drop(future);
        }
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}
