use super::*;

struct PendingHttp(Arc<Counts>);
struct PendingHeaders(Arc<Counts>);
impl Drop for PendingHeaders {
    fn drop(&mut self) {
        self.0.drops.fetch_add(1, Ordering::SeqCst);
    }
}
impl HttpTransport for PendingHttp {
    fn send(
        &self,
        _: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        Box::pin(async {
            let _guard = PendingHeaders(self.0.clone());
            self.0.reads.fetch_add(1, Ordering::SeqCst);
            std::future::pending().await
        })
    }
}

#[test]
fn drop_cancels_pending_http_headers_and_body_reads() {
    let a = auth();
    let counts = Arc::new(Counts::default());
    let transport = PendingHttp(counts.clone());
    let waker = Waker::from(Arc::new(Notice::default()));
    let mut cx = Context::from_waker(&waker);
    let mut future = Box::pin(synthesize(
        TtsRequest::TextVoice814840b5(fixtures::flash()),
        Options {
            auth: Some(&a),
            transport: Some(&transport),
            ..Default::default()
        },
    ));
    assert!(future.as_mut().poll(&mut cx).is_pending());
    drop(future);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);

    for status in [200, 429] {
        let counts = Arc::new(Counts::default());
        let transport = http(source(vec![], &counts, true), status);
        let mut future = Box::pin(synthesize(
            TtsRequest::TextVoice814840b5(fixtures::flash()),
            Options {
                auth: Some(&a),
                transport: Some(&transport),
                ..Default::default()
            },
        ));
        if status == 200 {
            let mut stream = ready(future).unwrap();
            assert!(Pin::new(&mut stream).poll_next(&mut cx).is_pending());
            drop(stream);
        } else {
            assert!(future.as_mut().poll(&mut cx).is_pending());
            drop(future);
        }
        assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn invalid_schema_and_limits_fail_before_io() {
    let a = auth();
    for invalid_schema in [false, true] {
        let counts = Arc::new(Counts::default());
        let transport = PendingHttp(counts.clone());
        let mut request = fixtures::flash();
        if invalid_schema {
            request.speed = Some(f64::NAN);
        }
        let request = TtsRequest::TextVoice814840b5(request);
        let expected = validate_request(&request).err();
        let error = ready(synthesize(
            request,
            Options {
                auth: Some(&a),
                transport: Some(&transport),
                max_json_bytes: if invalid_schema { 1024 } else { 0 },
                ..Default::default()
            },
        ))
        .err()
        .unwrap();
        if invalid_schema {
            assert!(expected.is_some());
            assert_eq!(
                error.downcast_ref::<crate::runtime::ValidationError>(),
                expected.as_ref()
            );
        } else {
            assert_eq!(error.to_string(), "ElevenLabs byte limits must be positive");
        }
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 0);
    }
}

#[test]
fn shared_http_mapping_fixtures() {
    assert_eq!(fixtures::requests().len(), fixture_list("http").len());
    for (r, fixture) in fixtures::requests().into_iter().zip(fixture_list("http")) {
        let f = fixture.object().unwrap();
        let timed = f["request"]
            .object()
            .unwrap()
            .contains_key("timestampGranularity");
        let timing = fixture_list("timing")[0].object().unwrap();
        let bytes = if timed {
            format!(
                "{{\"audio_base64\":\"AP8=\",\"alignment\":{},\"normalized_alignment\":{}}}",
                timing["alignment"].text(),
                timing["alignment"].text()
            )
            .into_bytes()
        } else {
            vec![0, 255]
        };
        let counts = Arc::new(Counts::default());
        let transport = http(
            source(
                vec![Ok(bytes[..1].to_vec()), Ok(vec![]), Ok(bytes[1..].to_vec())],
                &counts,
                false,
            ),
            200,
        );
        let a = auth();
        let mut stream=ready(synthesize(r,Options{auth:Some(&a),transport:Some(&transport),base_url:Some("https://proxy.test/p%20x?trace=1&seed=2&api_key=old&single_use_token=old&output_format=bad&optimize_streaming_latency=4"),..Default::default()})).unwrap();
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        let values = collect(&mut stream);
        if timed {
            assert_eq!(
                values,
                vec![parse(&format!(
                    "{{\"correlation\":\"chunk\",\"audio\":[0,255],\"timestamps\":{}}}",
                    timing["timestamps"].text()
                ))]
            )
        } else {
            assert_eq!(values, vec![parse("[0]"), parse("[255]")])
        }
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        let lock = transport.request.lock().unwrap();
        let request = lock.as_ref().unwrap();
        assert_eq!(request.method, "POST");
        assert_eq!(
            parse(std::str::from_utf8(&request.body).unwrap()),
            value(f["body"])
        );
        assert_eq!(
            request.headers,
            vec![
                ("xi-api-key".into(), "test-key".into()),
                ("content-type".into(), "application/json".into())
            ]
        );
        let (path, query) = request.url.split_once('?').unwrap();
        assert_eq!(
            path,
            format!("https://proxy.test/p%20x{}", f["path"].string().unwrap())
        );
        let mut expected = BTreeMap::from([("trace".into(), "1".into())]);
        for (key, value) in f["query"].object().unwrap() {
            expected.insert(key, value.array().unwrap()[0].string().unwrap());
        }
        assert_eq!(
            query
                .split('&')
                .map(|pair| {
                    let (k, v) = pair.split_once('=').unwrap();
                    (k.to_owned(), v.to_owned())
                })
                .collect::<BTreeMap<_, _>>(),
            expected
        );
    }
}
#[test]
fn ndjson_every_utf8_split_and_byte_bound() {
    let timing = fixture_list("timing")[0].object().unwrap();
    let line = format!(
        "{{\"audio_base64\":\"AQ==\",\"normalized_alignment\":{}}}",
        timing["alignment"].text()
    );
    let data = format!("\u{feff}\r\n{line}\r\n\n{line}").into_bytes();
    for split in 0..=data.len() {
        let counts = Arc::new(Counts::default());
        let transport = http(
            source(
                vec![Ok(data[..split].to_vec()), Ok(data[split..].to_vec())],
                &counts,
                false,
            ),
            200,
        );
        let a = auth();
        let mut stream = ready(synthesize(
            fixtures::requests().remove(8),
            Options {
                auth: Some(&a),
                transport: Some(&transport),
                max_json_bytes: line.len() + 1,
                ..Default::default()
            },
        ))
        .unwrap();
        let values = collect(&mut stream);
        assert_eq!(values.len(), 2);
        assert_eq!(values[0], values[1]);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}
#[test]
fn error_bodies_are_bounded_and_preserve_provider_fields() {
    let counts = Arc::new(Counts::default());
    let transport = http(
        source(
            vec![Ok(
                br#"{"detail":{"status":"quota_exceeded","message":"No quota"}}"#.to_vec(),
            )],
            &counts,
            false,
        ),
        429,
    );
    let a = auth();
    let error = match ready(synthesize(
        TtsRequest::TextVoice814840b5(fixtures::flash()),
        Options {
            auth: Some(&a),
            transport: Some(&transport),
            ..Default::default()
        },
    )) {
        Err(e) => e,
        Ok(_) => panic!("error response accepted"),
    };
    assert_eq!(error.to_string(), "ElevenLabs 429: No quota");
    let error = error.downcast::<Error>().unwrap();
    assert_eq!(error.error_code.as_deref(), Some("quota_exceeded"));
    assert_eq!(error.request_id.as_deref(), Some("trace"));
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    let transport = http(source(vec![Ok(vec![b'x'; 33])], &counts, false), 429);
    let error = match ready(synthesize(
        TtsRequest::TextVoice814840b5(fixtures::flash()),
        Options {
            auth: Some(&a),
            transport: Some(&transport),
            max_json_bytes: 32,
            ..Default::default()
        },
    )) {
        Err(e) => e,
        Ok(_) => panic!("oversized error response accepted"),
    };
    assert_eq!(
        error.to_string(),
        "ElevenLabs response exceeds max_json_bytes"
    );
    assert_eq!(counts.drops.load(Ordering::SeqCst), 2);
}
#[test]
fn http_drop_and_first_chunk_do_not_wait_for_completion() {
    for read in [false, true] {
        let counts = Arc::new(Counts::default());
        let transport = http(source(vec![Ok(vec![1])], &counts, true), 200);
        let a = auth();
        let mut stream = ready(synthesize(
            TtsRequest::TextVoice814840b5(fixtures::flash()),
            Options {
                auth: Some(&a),
                transport: Some(&transport),
                ..Default::default()
            },
        ))
        .unwrap();
        if read {
            assert_eq!(item(next(&mut stream).unwrap().unwrap()), parse("[1]"))
        }
        drop(stream);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(counts.reads.load(Ordering::SeqCst), usize::from(read));
    }
}
#[test]
fn malformed_timings_and_strict_json_fail_exactly() {
    for (text, want) in [
        (
            r#"{"audio_base64":"!"}"#,
            "ElevenLabs returned invalid base64 audio",
        ),
        (
            r#"{"audio_base64":"AQ==","alignment":{"characters":["x"],"character_start_times_seconds":[1e308],"character_end_times_seconds":[1e308]}}"#,
            "ElevenLabs returned invalid character timing",
        ),
        (
            r#"{"audio_base64":"\ud800"}"#,
            "ElevenLabs returned invalid JSON",
        ),
    ] {
        assert_eq!(
            protocol::timestamped(text, false)
                .err()
                .unwrap()
                .to_string(),
            want
        )
    }
}
