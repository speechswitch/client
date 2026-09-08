use super::*;

#[test]
fn shared_http_wire_fixtures_and_byte_ownership() {
    let auth = auth();
    let fixtures = fixture_root()["http"].array().unwrap();
    for (request, raw) in fixtures::requests().into_iter().zip(fixtures) {
        let fields = raw.object().unwrap();
        let Value::Map(mut expected) = fixture(fixture_root()["defaults"]) else {
            panic!()
        };
        let Value::Map(overrides) = fixture(fields["wire"]) else {
            panic!()
        };
        expected.extend(overrides);
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
                base_url: Some("https://proxy.test/prefix%20path/?tenant=one"),
                ..Default::default()
            },
        ))
        .unwrap();
        let request = http.request.lock().unwrap().take().unwrap();
        assert_eq!(request.method, "POST");
        assert_eq!(
            request.url,
            "https://proxy.test/prefix%20path/v1/tts?tenant=one"
        );
        assert_eq!(
            request.headers,
            vec![
                ("authorization".into(), "Bearer test-key".into()),
                (
                    "model".into(),
                    fields["request"].object().unwrap()["model"]
                        .string()
                        .unwrap()
                ),
                ("content-type".into(), "application/msgpack".into())
            ]
        );
        assert_eq!(
            msgpack::decode(&request.body).unwrap(),
            Value::Map(expected)
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
fn shared_timeline_every_byte_split() {
    let auth = auth();
    let fixtures = fixture_root()["timeline"].array().unwrap();
    let mut bytes = Vec::new();
    for raw in &fixtures {
        let fields = raw.object().unwrap();
        bytes.extend_from_slice(format!("data: {}\r\n\r\n", fields["packet"].text()).as_bytes());
    }
    for split in 0..=bytes.len() {
        let counts = Arc::new(Counts::default());
        let http = http(
            source(
                vec![Ok(bytes[..split].to_vec()), Ok(bytes[split..].to_vec())],
                &counts,
                false,
            ),
            200,
        );
        let mut request = voice();
        request.timestamp_granularity = Some(Default::default());
        let mut stream = ready(synthesize(
            TtsRequest::TextVoice(request),
            Options {
                auth: Some(&auth),
                transport: Some(&http),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(
            http.request.lock().unwrap().as_ref().unwrap().url,
            "https://api.fish.audio/v1/tts/stream/with-timestamp"
        );
        let expected: Vec<_> = fixtures
            .iter()
            .map(|v| fixture(v.object().unwrap()["item"]))
            .collect();
        assert_eq!(collect(&mut stream).unwrap(), expected, "split {split}");
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn timeline_emits_before_more_network_and_drop_cancels() {
    let auth = auth();
    let counts = Arc::new(Counts::default());
    let fields = fixture_root()["timeline"].array().unwrap()[1]
        .object()
        .unwrap();
    let http = http(
        source(
            vec![Ok(
                format!("data: {}\n\n", fields["packet"].text()).into_bytes()
            )],
            &counts,
            true,
        ),
        200,
    );
    let mut request = voice();
    request.timestamp_granularity = Some(Default::default());
    let mut stream = ready(synthesize(
        TtsRequest::TextVoice(request),
        Options {
            auth: Some(&auth),
            transport: Some(&http),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        normalized(next(&mut stream).unwrap().unwrap()),
        fixture(fields["item"])
    );
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    drop(stream);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn malformed_timestamp_fields_have_exact_errors() {
    let base = r#"{"audio_base64":"AQ==","content":"a","chunk_seq":0,"chunk_audio_offset_sec":0,"alignment":null}"#;
    for (from, to, expected) in [
        (r#""AQ==""#, r#""!""#, "Fish returned invalid base64 audio"),
        (
            r#""AQ==""#,
            r#""AQ==\n""#,
            "Fish returned invalid base64 audio",
        ),
        (
            "\"chunk_seq\":0",
            "\"chunk_seq\":0.5",
            "Fish returned an invalid timestamp event",
        ),
        (
            "\"chunk_audio_offset_sec\":0",
            "\"chunk_audio_offset_sec\":1e308",
            "Fish returned an invalid timestamp event",
        ),
        (
            "\"alignment\":null",
            "\"alignment\":{}",
            "Fish returned an invalid alignment snapshot",
        ),
        (
            "\"alignment\":null",
            r#""alignment":{"audio_duration":1e308,"segments":[]}"#,
            "Fish returned an invalid alignment snapshot",
        ),
        (
            "\"alignment\":null",
            r#""alignment":{"audio_duration":1,"segments":[{"text":"a","start":2,"end":1}]}"#,
            "Fish returned an invalid timing segment",
        ),
        (
            r#""content":"a""#,
            r#""content":"\ud800""#,
            "Fish returned invalid timestamp JSON",
        ),
    ] {
        let error = protocol::alignment(&base.replace(from, to)).err().unwrap();
        assert_eq!(error.to_string(), expected);
    }
    let value = protocol::alignment(&base.replace("AQ==", "Af==")).unwrap();
    let Value::Map(value) = normalized(value) else {
        panic!()
    };
    assert_eq!(value["audio"], Value::Binary(vec![1]));
}

#[test]
fn errors_limits_and_terminal_cleanup() {
    let auth = auth();
    for (status, data, limit, expected) in [
        (
            429,
            r#"{"message":"quota","reason":"credits"}"#,
            1024,
            "Fish 429: quota",
        ),
        (500, "1234", 3, "Fish response exceeds max_json_bytes"),
    ] {
        let counts = Arc::new(Counts::default());
        let http = http(
            source(vec![Ok(data.as_bytes().to_vec())], &counts, false),
            status,
        );
        let error = ready(synthesize(
            TtsRequest::TextVoice(voice()),
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
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        if status == 429 {
            assert_eq!(
                error.downcast_ref::<Error>().unwrap(),
                &Error {
                    status: 429,
                    message: "quota".into(),
                    reason: Some("credits".into())
                }
            );
        }
    }
    let counts = Arc::new(Counts::default());
    let http = http(
        source(
            vec![Ok(vec![1]), Err(failure("read failed"))],
            &counts,
            false,
        ),
        200,
    );
    let mut stream = ready(synthesize(
        TtsRequest::TextVoice(voice()),
        Options {
            auth: Some(&auth),
            transport: Some(&http),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        normalized(next(&mut stream).unwrap().unwrap()),
        Value::Binary(vec![1])
    );
    assert_eq!(
        next(&mut stream).unwrap().err().unwrap().to_string(),
        "read failed"
    );
    assert!(next(&mut stream).is_none());
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn validation_precedes_io() {
    let auth = auth();
    let counts = Arc::new(Counts::default());
    let http = http(source(vec![], &counts, false), 200);
    let mut r = voice();
    r.text_chunk_length = Some(100.5);
    let request = TtsRequest::TextVoice(r);
    let expected = crate::generated::validators::fish::validate_request(&request)
        .err().unwrap().to_string();
    let error = ready(synthesize(
        request,
        Options {
            auth: Some(&auth),
            transport: Some(&http),
            ..Default::default()
        },
    ))
    .err()
    .unwrap();
    assert_eq!(error.to_string(), expected);
    assert!(http.request.lock().unwrap().is_none());
    let mut r = voice();
    r.reference_samples = Some(vec![TtsRequestS1TextReferenceSamplesItem {
        audio: vec![],
        text: "voice".into(),
    }]);
    let error = ready(synthesize(
        TtsRequest::TextVoice(r),
        Options {
            auth: Some(&auth),
            transport: Some(&http),
            ..Default::default()
        },
    ))
    .err()
    .unwrap();
    assert_eq!(error.to_string(), "Fish reference audio must not be empty");
    assert!(http.request.lock().unwrap().is_none());
}

struct PendingHttp {
    counts: Arc<Counts>,
}
struct PendingResponse {
    counts: Arc<Counts>,
}
impl Future for PendingResponse {
    type Output = Result<HttpResponse, TransportError>;
    fn poll(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Self::Output> {
        self.counts.reads.fetch_add(1, Ordering::SeqCst);
        Poll::Pending
    }
}
impl Drop for PendingResponse {
    fn drop(&mut self) {
        self.counts.drops.fetch_add(1, Ordering::SeqCst);
    }
}
impl HttpTransport for PendingHttp {
    fn send(
        &self,
        _: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        Box::pin(PendingResponse {
            counts: self.counts.clone(),
        })
    }
}
#[test]
fn dropping_pending_setup_and_error_body_cancels_io() {
    let auth = auth();
    let counts = Arc::new(Counts::default());
    let transport = PendingHttp {
        counts: counts.clone(),
    };
    let wakes = Arc::new(Counts::default());
    let waker = Waker::from(wakes);
    let mut cx = Context::from_waker(&waker);
    let mut future = Box::pin(synthesize(
        TtsRequest::TextVoice(voice()),
        Options {
            auth: Some(&auth),
            transport: Some(&transport),
            ..Default::default()
        },
    ));
    assert!(future.as_mut().poll(&mut cx).is_pending());
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    drop(future);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    let counts = Arc::new(Counts::default());
    let transport = http(source(vec![Ok(vec![1])], &counts, true), 500);
    let mut future = Box::pin(synthesize(
        TtsRequest::TextVoice(voice()),
        Options {
            auth: Some(&auth),
            transport: Some(&transport),
            ..Default::default()
        },
    ));
    assert!(future.as_mut().poll(&mut cx).is_pending());
    assert!(future.as_mut().poll(&mut cx).is_pending());
    assert_eq!(counts.reads.load(Ordering::SeqCst), 2);
    drop(future);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[derive(Debug)]
struct Marker(Arc<()>);
impl std::fmt::Display for Marker {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("original failure")
    }
}
impl std::error::Error for Marker {}
#[test]
fn errors_preserve_identity_and_unread_empty_http_is_owned() {
    let auth = auth();
    for status in [200, 500] {
        let marker = Arc::new(());
        let counts = Arc::new(Counts::default());
        let transport = http(
            source(vec![Err(Box::new(Marker(marker.clone())))], &counts, false),
            status,
        );
        let result = ready(synthesize(
            TtsRequest::TextVoice(voice()),
            Options {
                auth: Some(&auth),
                transport: Some(&transport),
                ..Default::default()
            },
        ));
        let error = if status == 200 {
            let mut stream = result.unwrap();
            let error = next(&mut stream).unwrap().err().unwrap();
            assert!(next(&mut stream).is_none());
            error
        } else {
            result.err().unwrap()
        };
        assert!(Arc::ptr_eq(
            &error.downcast_ref::<Marker>().unwrap().0,
            &marker
        ));
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
    for unread in [false, true] {
        let counts = Arc::new(Counts::default());
        let transport = http(source(vec![], &counts, false), 200);
        let mut stream = ready(synthesize(
            TtsRequest::TextVoice(voice()),
            Options {
                auth: Some(&auth),
                transport: Some(&transport),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        if !unread {
            assert!(next(&mut stream).is_none());
        }
        drop(stream);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn framing_limits_and_unfinished_events_are_terminal() {
    let auth = auth();
    let packet = fixture_root()["timeline"].array().unwrap()[0]
        .object()
        .unwrap()["packet"]
        .text();
    for (data, limit, expected) in [
        (
            "data: too long\n\n".to_owned(),
            4,
            Some("SSE event exceeds byte limit"),
        ),
        (format!("data: {packet}\n"), 4096, None),
    ] {
        let counts = Arc::new(Counts::default());
        let transport = http(source(vec![Ok(data.into_bytes())], &counts, false), 200);
        let mut request = voice();
        request.timestamp_granularity = Some(Default::default());
        let mut stream = ready(synthesize(
            TtsRequest::TextVoice(request),
            Options {
                auth: Some(&auth),
                transport: Some(&transport),
                max_json_bytes: limit,
                ..Default::default()
            },
        ))
        .unwrap();
        match expected {
            Some(message) => assert_eq!(
                next(&mut stream).unwrap().err().unwrap().to_string(),
                message
            ),
            None => assert!(next(&mut stream).is_none()),
        };
        assert!(next(&mut stream).is_none());
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn environment_resolution_in_isolated_process() {
    const CHILD: &str = "SPEECHSWITCH_FISH_AUTH_TEST_CHILD";
    if let Ok(expected) = std::env::var(CHILD) {
        let mut explicit = auth();
        if expected == "missing" {
            explicit.fish.as_mut().unwrap().api_key = Some(String::new());
        }
        let counts = Arc::new(Counts::default());
        let transport = http(source(vec![], &counts, false), 200);
        let result = ready(synthesize(
            TtsRequest::TextVoice(voice()),
            Options {
                auth: if expected == "test-key" || expected == "missing" {
                    Some(&explicit)
                } else {
                    None
                },
                transport: Some(&transport),
                ..Default::default()
            },
        ));
        if expected == "missing" {
            assert_eq!(
                result.err().unwrap().to_string(),
                "Missing auth.fish.apiKey configuration"
            );
            assert!(transport.request.lock().unwrap().is_none());
        } else {
            drop(result.unwrap());
            assert_eq!(
                transport.request.lock().unwrap().as_ref().unwrap().headers[0],
                ("authorization".into(), format!("Bearer {expected}"))
            );
        }
        return;
    }
    for (expected, scoped, fallback) in [
        ("test-key", Some("scoped"), "fallback"),
        ("scoped", Some("scoped"), "fallback"),
        ("fallback", None, "fallback"),
        ("missing", Some("scoped"), "fallback"),
    ] {
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "providers::fish::tests::http_tests::environment_resolution_in_isolated_process",
            ])
            .env(CHILD, expected)
            .env("FISH_API_KEY", fallback)
            .env_remove("SPEECHSWITCH_FISH_API_KEY");
        if let Some(value) = scoped {
            command.env("SPEECHSWITCH_FISH_API_KEY", value);
        }
        let output = command.output().unwrap();
        assert!(
            output.status.success(),
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
