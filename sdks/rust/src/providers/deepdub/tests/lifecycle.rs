use super::*;

#[derive(Debug)]
struct Marker(Arc<()>);
impl std::fmt::Display for Marker {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("original transport error")
    }
}
impl std::error::Error for Marker {}
fn marker(id: &Arc<()>) -> TransportError {
    Box::new(Marker(id.clone()))
}
fn same(error: TransportError, id: &Arc<()>) {
    assert!(Arc::ptr_eq(&error.downcast::<Marker>().unwrap().0, id));
}

#[test]
fn bounded_http_errors_preserve_status_and_native_id() {
    for (text, expected) in [
        ("\u{feff}{\"message\":\"quota\"}", "quota"),
        ("{\"message\":1}", "{\"message\":1}"),
        (
            "{\"message\":\"quota\"} trailing",
            "{\"message\":\"quota\"} trailing",
        ),
        ("[1]", "[1]"),
        ("unavailable", "unavailable"),
        ("", "Request failed"),
    ] {
        for status in [199, 300, 429, 503, 599] {
            for native_id in [None, Some("native"), Some("")] {
                let counts = Arc::new(Counts::default());
                let chunks = text.as_bytes().chunks(1).map(|v| Ok(v.to_vec())).collect();
                let headers = native_id
                    .map(|v| vec![("X-GeNeRaTiOn-ID".into(), v.into())])
                    .unwrap_or_default();
                // Error bodies must never enter the successful Opus codec guard.
                let mut stream = Stream::new(
                    HttpResponse {
                        status,
                        headers,
                        body: body(chunks, &counts, false),
                    },
                    "trace".into(),
                    true,
                    text.len().max(1),
                );
                let error = next(&mut stream)
                    .unwrap()
                    .unwrap_err()
                    .downcast::<Error>()
                    .unwrap();
                assert_eq!(
                    (
                        error.status_code,
                        error.generation_id.as_str(),
                        error.message.as_str()
                    ),
                    (status, native_id.unwrap_or("trace"), expected)
                );
                assert_eq!(
                    error.to_string(),
                    format!("Deepdub returned HTTP {status}: {expected}")
                );
                assert!(next(&mut stream).is_none());
                assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
            }
        }
    }
    for chunks in [
        vec![Ok(b"large".to_vec())],
        vec![Ok(b"1234".to_vec()), Ok(vec![5])],
    ] {
        let counts = Arc::new(Counts::default());
        let mut stream = Stream::new(
            HttpResponse {
                status: 500,
                headers: vec![],
                body: body(chunks, &counts, false),
            },
            "trace".into(),
            false,
            4,
        );
        assert_eq!(
            next(&mut stream).unwrap().unwrap_err().to_string(),
            "Deepdub response exceeds max_error_bytes"
        );
        assert!(next(&mut stream).is_none());
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn original_read_send_and_entropy_errors_are_terminal() {
    let id = Arc::new(());
    let auth = auth();
    for status in [200, 500] {
        for codec in [false, true] {
            let counts = Arc::new(Counts::default());
            let mut stream = Stream::new(
                HttpResponse {
                    status,
                    headers: vec![],
                    body: body(vec![Err(marker(&id))], &counts, false),
                },
                "trace".into(),
                codec,
                1024,
            );
            same(next(&mut stream).unwrap().unwrap_err(), &id);
            assert!(next(&mut stream).is_none());
            assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
            assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        }
    }
    let counts = Arc::new(Counts::default());
    let http = Http::new(body(vec![], &counts, false));
    *http.response.lock().unwrap() = Some(Err(marker(&id)));
    same(
        ready(synthesize(request(), options(&auth, &http)))
            .err()
            .unwrap(),
        &id,
    );
    assert_eq!(http.requests.lock().unwrap().len(), 1);
    let http = Http::new(body(vec![], &counts, false));
    let entropy = |_: &mut [u8]| Err(marker(&id));
    same(
        ready(synthesize(
            request(),
            Options {
                request_id: None,
                entropy: Some(&entropy),
                ..options(&auth, &http)
            },
        ))
        .err()
        .unwrap(),
        &id,
    );
    assert_eq!(http.requests.lock().unwrap().len(), 0);
}

#[test]
fn dropping_unread_pending_and_buffered_responses_cancels() {
    let auth = auth();
    let waker = Waker::from(Arc::new(Counts::default()));
    let mut cx = Context::from_waker(&waker);
    for poll in [false, true] {
        let counts = Arc::new(Counts::default());
        let http = Http::new(body(vec![], &counts, true));
        let mut stream = ready(synthesize(request(), options(&auth, &http))).unwrap();
        if poll {
            assert!(Pin::new(&mut stream).poll_next(&mut cx).is_pending());
        }
        drop(stream);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(counts.reads.load(Ordering::SeqCst), usize::from(poll));
    }
    for verified in [false, true] {
        let counts = Arc::new(Counts::default());
        let bytes = opus(255);
        let chunks = if verified {
            vec![Ok(bytes[..20].to_vec()), Ok(bytes[20..].to_vec())]
        } else {
            vec![Ok(bytes[..20].to_vec())]
        };
        let mut stream = Stream::new(
            HttpResponse {
                status: 200,
                headers: vec![],
                body: body(chunks, &counts, true),
            },
            "trace".into(),
            true,
            1024,
        );
        if verified {
            assert_eq!(next(&mut stream).unwrap().unwrap(), bytes[..20]);
        } else {
            assert!(Pin::new(&mut stream).poll_next(&mut cx).is_pending());
        }
        drop(stream);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(
            counts.reads.load(Ordering::SeqCst),
            if verified { 2 } else { 1 }
        );
    }
    let counts = Arc::new(Counts::default());
    let mut http = Http::new(body(vec![], &counts, false));
    http.stall = true;
    let mut future = Box::pin(synthesize(request(), options(&auth, &http)));
    assert!(future.as_mut().poll(&mut cx).is_pending());
    assert_eq!(http.drops.drops.load(Ordering::SeqCst), 0);
    drop(future);
    assert_eq!(http.drops.drops.load(Ordering::SeqCst), 1);
    assert_eq!(http.requests.lock().unwrap().len(), 1);
}

#[test]
fn empty_and_error_chunks_cooperate_one_read_per_poll() {
    for status in [200, 503] {
        let counts = Arc::new(Counts::default());
        let wakes = Arc::new(Counts::default());
        let waker = Waker::from(wakes.clone());
        let mut cx = Context::from_waker(&waker);
        let chunks = (0..10)
            .map(|_| Ok(if status == 200 { vec![] } else { vec![b'x'] }))
            .collect();
        let mut stream = Stream::new(
            HttpResponse {
                status,
                headers: vec![],
                body: body(chunks, &counts, true),
            },
            "trace".into(),
            false,
            1024,
        );
        for read in 1..=10 {
            assert!(Pin::new(&mut stream).poll_next(&mut cx).is_pending());
            assert_eq!(counts.reads.load(Ordering::SeqCst), read);
            assert_eq!(wakes.wakes.load(Ordering::SeqCst), read);
        }
        drop(stream);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn generated_constraints_and_configuration_fail_before_io() {
    let auth = auth();
    let counts = Arc::new(Counts::default());
    let http = Http::new(body(vec![], &counts, false));
    for speed in [-0.01, 2.01, f64::NAN, f64::INFINITY] {
        let mut r = whole();
        r.speed = Some(speed);
        assert_eq!(
            ready(synthesize(
                TtsRequest::TextVoiceb776b412(r),
                options(&auth, &http)
            ))
            .err()
            .unwrap()
            .to_string(),
            "Invalid deepdub TTS request"
        );
    }
    let mut r = whole();
    r.voice.clear();
    assert_eq!(
        ready(synthesize(
            TtsRequest::TextVoiceb776b412(r),
            options(&auth, &http)
        ))
        .err()
        .unwrap()
        .to_string(),
        "Invalid deepdub TTS request"
    );
    let mut r = whole();
    r.reference_audio = Some(vec![]);
    assert_eq!(
        ready(synthesize(
            TtsRequest::TextVoiceb776b412(r),
            options(&auth, &http)
        ))
        .err()
        .unwrap()
        .to_string(),
        "Deepdub reference_audio must not be empty"
    );
    for (opts, expected) in [
        (
            Options {
                max_error_bytes: 0,
                ..options(&auth, &http)
            },
            "Deepdub max_error_bytes must be positive",
        ),
        (
            Options {
                transport: None,
                ..options(&auth, &http)
            },
            "Deepdub HTTP transport is required",
        ),
        (
            Options {
                request_id: None,
                ..options(&auth, &http)
            },
            "Deepdub entropy source is required without request_id",
        ),
    ] {
        assert_eq!(
            ready(synthesize(request(), opts))
                .err()
                .unwrap()
                .to_string(),
            expected
        );
    }
    for url in [
        "",
        "wss://host",
        "https://user:key@host",
        "https://host/#fragment",
        "https://host:bad",
    ] {
        assert_eq!(
            ready(synthesize(
                request(),
                Options {
                    base_url: Some(url),
                    ..options(&auth, &http)
                }
            ))
            .err()
            .unwrap()
            .to_string(),
            "Invalid Deepdub HTTP endpoint URL"
        );
    }
    assert_eq!(http.requests.lock().unwrap().len(), 0);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
}

#[test]
fn generated_duration_and_seed_bounds_run_at_the_provider_boundary() {
    let fixtures = Raw::parse_exact(include_str!("../../../../../fixtures/deepdub.json"))
        .unwrap()
        .array()
        .unwrap();
    let auth = auth();
    let counts = Arc::new(Counts::default());
    let http = Http::new(body(vec![], &counts, false));
    for seed in [0.5, 9007199254740992.0, -9007199254740992.0, f64::NAN] {
        let mut request = fixture_request(5, fixtures[5].object().unwrap()["request"]);
        let TtsRequest::Og11TextVoiceafafd490(v) = &mut request else {
            unreachable!()
        };
        v.random_seed = seed;
        assert_eq!(
            ready(synthesize(request, options(&auth, &http)))
                .err()
                .unwrap()
                .to_string(),
            "Invalid deepdub TTS request"
        );
    }
    for duration in [0.0, -0.01, f64::NAN, f64::INFINITY] {
        let mut request = fixture_request(1, fixtures[1].object().unwrap()["request"]);
        let TtsRequest::TextVoice5ce3f477(v) = &mut request else {
            unreachable!()
        };
        v.target_duration_ms = duration;
        assert_eq!(
            ready(synthesize(request, options(&auth, &http)))
                .err()
                .unwrap()
                .to_string(),
            "Invalid deepdub TTS request"
        );
    }
    assert_eq!(http.requests.lock().unwrap().len(), 0);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
}

#[test]
fn explicit_ids_skip_entropy_and_default_ids_are_uuid4() {
    let auth = auth();
    for (id, expected) in [
        (None, "00010203-0405-4607-8809-0a0b0c0d0e0f"),
        (Some(""), ""),
        (Some("quoted\"\n雪"), "quoted\"\n雪"),
    ] {
        let calls = AtomicUsize::new(0);
        let entropy = |bytes: &mut [u8]| {
            calls.fetch_add(1, Ordering::SeqCst);
            assert_eq!(bytes.len(), 16);
            for (i, v) in bytes.iter_mut().enumerate() {
                *v = i as u8;
            }
            Ok(())
        };
        let counts = Arc::new(Counts::default());
        let http = Http::new(body(vec![], &counts, false));
        let stream = ready(synthesize(
            request(),
            Options {
                request_id: id,
                entropy: Some(&entropy),
                base_url: Some("https://restapi.eu.deepdub.ai/api/v1/?trace=1"),
                ..options(&auth, &http)
            },
        ))
        .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), usize::from(id.is_none()));
        let sent = http.requests.lock().unwrap();
        assert_eq!(
            sent[0].url,
            "https://restapi.eu.deepdub.ai/api/v1/tts?trace=1"
        );
        let wire = Raw::parse_exact(std::str::from_utf8(&sent[0].body).unwrap())
            .unwrap()
            .object()
            .unwrap();
        assert_eq!(wire["generationId"].string().unwrap(), expected);
        drop(stream);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn auth_environment_child() {
    let Ok(expected) = std::env::var("SPEECHSWITCH_TEST_DEEPDUB_AUTH") else {
        return;
    };
    let mut auth = auth();
    if expected == "explicit-empty" {
        auth.deepdub.as_mut().unwrap().api_key = Some(String::new());
    }
    let counts = Arc::new(Counts::default());
    let http = Http::new(body(vec![], &counts, false));
    let result = ready(synthesize(
        request(),
        Options {
            auth: if expected == "key" || expected == "explicit-empty" {
                Some(&auth)
            } else {
                None
            },
            ..options(&auth, &http)
        },
    ));
    if expected.is_empty() || expected == "explicit-empty" || expected == "invalid-unicode" {
        assert_eq!(
            result.err().unwrap().to_string(),
            if expected == "invalid-unicode" {
                "Invalid Deepdub environment credential"
            } else {
                "Missing auth.deepdub.apiKey configuration"
            }
        );
        assert_eq!(http.requests.lock().unwrap().len(), 0);
    } else {
        drop(result.unwrap());
        assert_eq!(
            http.requests.lock().unwrap()[0].headers[0],
            ("x-api-key".into(), expected)
        );
    }
}

#[test]
fn auth_precedence_in_isolated_processes() {
    for (scoped, native, expected) in [
        (None, Some("native"), "native"),
        (Some("scoped"), Some("native"), "scoped"),
        (Some(""), Some("native"), ""),
        (None, Some(""), ""),
        (None, None, ""),
        (Some("scoped"), Some("native"), "key"),
        (Some("scoped"), Some("native"), "explicit-empty"),
    ] {
        let mut command = auth_command(expected);
        for (key, value) in [
            ("SPEECHSWITCH_DEEPDUB_API_KEY", scoped),
            ("DEEPDUB_API_KEY", native),
        ] {
            if let Some(value) = value {
                command.env(key, value);
            }
        }
        let result = command.output().unwrap();
        assert_eq!(
            result.status.code(),
            Some(0),
            "{}{}",
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        );
    }
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStringExt;
        for expected in ["invalid-unicode", "key"] {
            let result = auth_command(expected)
                .env(
                    "SPEECHSWITCH_DEEPDUB_API_KEY",
                    std::ffi::OsString::from_vec(vec![255]),
                )
                .env("DEEPDUB_API_KEY", "native")
                .output()
                .unwrap();
            assert_eq!(
                result.status.code(),
                Some(0),
                "{}{}",
                String::from_utf8_lossy(&result.stdout),
                String::from_utf8_lossy(&result.stderr)
            );
        }
    }
}
fn auth_command(expected: &str) -> std::process::Command {
    let mut command = std::process::Command::new(std::env::current_exe().unwrap());
    command
        .args([
            "--exact",
            "providers::deepdub::tests::lifecycle::auth_environment_child",
            "--nocapture",
        ])
        .env("SPEECHSWITCH_TEST_DEEPDUB_AUTH", expected)
        .env_remove("SPEECHSWITCH_DEEPDUB_API_KEY")
        .env_remove("DEEPDUB_API_KEY");
    command
}
