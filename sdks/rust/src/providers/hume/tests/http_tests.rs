use super::*;

#[test]
fn all_static_models_match_shared_fixtures() {
    let fixtures = fixtures()["http"].array().unwrap();
    for (i, case) in fixtures.iter().enumerate() {
        let transport = Http::new(200, vec![vec![0, 255]]);
        let auth = auth();
        let mut stream = ready(synthesize(
            fixture_request(i, false),
            Options {
                auth: Some(&auth),
                transport: Some(&transport),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(
            collect(&mut stream).unwrap(),
            vec![Value::Binary(vec![0, 255])]
        );
        let requests = transport.requests.lock().unwrap();
        let request = &requests[0];
        assert_eq!(request.method, "POST");
        assert_eq!(request.url, "https://api.hume.ai/v0/tts/stream/file");
        assert_eq!(
            request.headers,
            vec![
                ("x-hume-api-key".into(), "test-key".into()),
                ("content-type".into(), "application/json".into())
            ]
        );
        assert_eq!(
            fixture(Raw::parse_exact(std::str::from_utf8(&request.body).unwrap()).unwrap()),
            fixture(case.object().unwrap()["body"])
        );
    }
}

#[test]
fn timeline_fixtures_at_every_byte_split() {
    let entries = fixtures()["timeline"].array().unwrap();
    let mut data = b"\xef\xbb\xbf\r\n".to_vec();
    let mut expected = vec![];
    for (i, entry) in entries.iter().enumerate() {
        let entry = entry.object().unwrap();
        data.extend(entry["packet"].text().as_bytes());
        if i + 1 < entries.len() {
            data.extend(b"\r\n");
        }
        expected.push(fixture(entry["item"]));
    }
    for split in 0..=data.len() {
        let transport = Http::new(200, vec![data[..split].to_vec(), data[split..].to_vec()]);
        let auth = auth();
        let mut stream = ready(synthesize(
            TtsRequest::Octave2TextVoice(request()),
            Options {
                auth: Some(&auth),
                transport: Some(&transport),
                include_metadata: true,
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(collect(&mut stream).unwrap(), expected, "split {split}");
        assert_eq!(
            transport.requests.lock().unwrap()[0].url,
            "https://api.hume.ai/v0/tts/stream/json"
        );
    }
}

#[test]
fn metadata_also_works_on_octave_one() {
    let case = fixtures()["timeline"].array().unwrap()[1].object().unwrap();
    let transport = Http::new(200, vec![case["packet"].text().as_bytes().to_vec()]);
    let auth = auth();
    let mut stream = ready(synthesize(
        fixture_request(0, false),
        Options {
            auth: Some(&auth),
            transport: Some(&transport),
            include_metadata: true,
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(collect(&mut stream).unwrap(), vec![fixture(case["item"])]);
}

#[test]
fn errors_keep_status_code_and_original_identity() {
    for (data, message, code) in [
        (
            br#"{"message":"denied","error":"fallback","code":"bad_key"}"#.to_vec(),
            "denied",
            Some("bad_key"),
        ),
        (
            br#"{"error":"rejected","code":3}"#.to_vec(),
            "rejected",
            None,
        ),
        (b"\xef\xbb\xbfno\xff".to_vec(), "no\u{fffd}", None),
    ] {
        let transport = Http::new(401, vec![data]);
        let auth = auth();
        let err = ready(synthesize(
            TtsRequest::Octave2TextVoice(request()),
            Options {
                auth: Some(&auth),
                transport: Some(&transport),
                ..Default::default()
            },
        ))
        .err()
        .unwrap();
        assert_eq!(
            err.downcast_ref::<Error>(),
            Some(&Error {
                message: message.into(),
                status: Some(401),
                code: code.map(str::to_owned)
            })
        );
    }
    for status in [200, 400] {
        let original = failure("original read error");
        let address = &*original as *const _ as *const ();
        let counts = Arc::default();
        let transport = Http {
            requests: Mutex::default(),
            response: Mutex::new(Some(HttpResponse {
                status,
                headers: vec![],
                body: Box::pin(Source {
                    values: vec![Err(original)].into(),
                    counts,
                    stall: false,
                    trace: Arc::default(),
                }),
            })),
        };
        let auth = auth();
        let result = ready(synthesize(
            TtsRequest::Octave2TextVoice(request()),
            Options {
                auth: Some(&auth),
                transport: Some(&transport),
                ..Default::default()
            },
        ));
        let err = if status == 200 {
            collect(&mut result.unwrap()).err().unwrap()
        } else {
            result.err().unwrap()
        };
        assert_eq!(&*err as *const _ as *const (), address);
    }
}

#[test]
fn bounds_and_malformed_http_close_the_body() {
    for (status, data, limit, message) in [
        (
            400,
            b"12345".to_vec(),
            4,
            "Hume response exceeds max_json_bytes",
        ),
        (
            200,
            b"12345\n".to_vec(),
            4,
            "Hume JSON line exceeds max_json_bytes",
        ),
        (
            200,
            b"{\"type\":\"\xff\"}\n".to_vec(),
            100,
            "Hume returned invalid UTF-8",
        ),
    ] {
        let counts = Arc::new(Counts::default());
        let transport = Http {
            requests: Mutex::default(),
            response: Mutex::new(Some(HttpResponse {
                status,
                headers: vec![],
                body: Box::pin(Source {
                    values: vec![Ok(data)].into(),
                    counts: counts.clone(),
                    stall: false,
                    trace: Arc::default(),
                }),
            })),
        };
        let auth = auth();
        let result = ready(synthesize(
            TtsRequest::Octave2TextVoice(request()),
            Options {
                auth: Some(&auth),
                transport: Some(&transport),
                include_metadata: true,
                max_json_bytes: limit,
                ..Default::default()
            },
        ));
        let err = if status == 200 {
            collect(&mut result.unwrap()).err().unwrap()
        } else {
            result.err().unwrap()
        };
        assert_eq!(err.to_string(), message);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn early_bytes_and_unread_or_pending_drop_release_body() {
    for unread in [false, true] {
        let counts = Arc::new(Counts::default());
        let body = Box::pin(Source {
            values: vec![Ok(vec![1, 2])].into(),
            counts: counts.clone(),
            stall: true,
            trace: Arc::default(),
        });
        let transport = Http {
            requests: Mutex::default(),
            response: Mutex::new(Some(HttpResponse {
                status: 200,
                headers: vec![],
                body,
            })),
        };
        let auth = auth();
        let mut stream = ready(synthesize(
            TtsRequest::Octave2TextVoice(request()),
            Options {
                auth: Some(&auth),
                transport: Some(&transport),
                ..Default::default()
            },
        ))
        .unwrap();
        if !unread {
            assert_eq!(
                normalized(next(&mut stream).unwrap().unwrap()),
                Value::Binary(vec![1, 2])
            );
            let waker = Waker::from(counts.clone());
            assert!(Pin::new(&mut stream)
                .poll_next(&mut Context::from_waker(&waker))
                .is_pending());
        }
        drop(stream);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}
