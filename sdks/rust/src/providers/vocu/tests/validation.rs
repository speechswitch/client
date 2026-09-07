use super::*;

#[test]
fn generated_constraints_and_boundary_options_fail_before_network() {
    let auth = auth();
    let mut invalid = Vec::new();
    for speed in [0.49, 2.01, f64::NAN, f64::INFINITY] {
        let mut r = fixtures::plain();
        r.speed = Some(speed);
        invalid.push(TtsRequest::TextVoice9c5ed44a(r));
    }
    let mut r = fixtures::plain();
    r.random_seed = Some(0.5);
    invalid.push(TtsRequest::TextVoice9c5ed44a(r));
    let mut r = fixtures::plain();
    r.text = " \n".into();
    invalid.push(TtsRequest::TextVoice9c5ed44a(r));
    invalid.push(TtsRequest::Object42a4f93c(TtsRequestObject42a4f93c {
        output: None,
        segments: vec![],
    }));
    for request in invalid {
        let http = transport(vec![]);
        let error = ready(synthesize(
            &request,
            &http,
            Options {
                auth: Some(&auth),
                ..Default::default()
            },
        ))
        .err()
        .unwrap();
        assert_eq!(error.to_string(), "Invalid vocu TTS request");
        assert!(http.requests.lock().unwrap().is_empty());
    }
    for (options, message) in [
        (
            Options {
                poll_interval_ms: u32::MAX,
                ..Default::default()
            },
            "Vocu polling interval must be an integer between 0 and 2147483647",
        ),
        (
            Options {
                max_metadata_bytes: 0,
                ..Default::default()
            },
            "Vocu max_metadata_bytes must be a positive safe integer",
        ),
        (
            Options {
                base_url: Some("https://host/?"),
                ..Default::default()
            },
            "Vocu base URL must not contain a query",
        ),
        (
            Options {
                base_url: Some("https://u:p@host"),
                ..Default::default()
            },
            "Vocu URLs must be HTTP(S) without credentials, fragments or invalid escapes",
        ),
        (
            Options {
                base_url: Some("https://host/#"),
                ..Default::default()
            },
            "Vocu URLs must be HTTP(S) without credentials, fragments or invalid escapes",
        ),
        (
            Options {
                base_url: Some("https://host/%zz"),
                ..Default::default()
            },
            "Vocu URLs must be HTTP(S) without credentials, fragments or invalid escapes",
        ),
        (
            Options {
                base_url: Some("https://host:99999"),
                ..Default::default()
            },
            "Vocu URLs must be HTTP(S) without credentials, fragments or invalid escapes",
        ),
        (
            Options {
                audio_origins: &["https://host/path"],
                ..Default::default()
            },
            "Vocu audio_origins must contain HTTP(S) origins only",
        ),
        (
            Options {
                audio_origins: &["https://HOST"],
                ..Default::default()
            },
            "Vocu audio_origins must contain HTTP(S) origins only",
        ),
    ] {
        let http = transport(vec![]);
        let error = ready(synthesize(
            &TtsRequest::TextVoice9c5ed44a(fixtures::plain()),
            &http,
            Options {
                auth: Some(&auth),
                ..options
            },
        ))
        .err()
        .unwrap();
        assert_eq!(error.to_string(), message);
        assert!(http.requests.lock().unwrap().is_empty());
    }
    for (index, mode, message) in [
        (
            4,
            Mode::Stream,
            "Vocu segments and text splitting require async synthesis",
        ),
        (
            5,
            Mode::Http,
            "Vocu segments and text splitting require async synthesis",
        ),
        (
            1,
            Mode::Async,
            "Vocu async synthesis does not support flash latency optimization",
        ),
    ] {
        let http = transport(vec![]);
        let error = ready(synthesize(
            &fixtures::requests().remove(index),
            &http,
            Options {
                auth: Some(&auth),
                mode: Some(mode),
                ..Default::default()
            },
        ))
        .err()
        .unwrap();
        assert_eq!(error.to_string(), message);
        assert!(http.requests.lock().unwrap().is_empty());
    }
}

#[test]
fn malformed_metadata_is_bounded_finite_and_exact_utf8() {
    let auth = auth();
    for (data, message) in [
        (b"{".to_vec(), "Invalid Vocu metadata"),
        (vec![255], "Invalid Vocu metadata UTF-8"),
        (b"[]".to_vec(), "Invalid Vocu response object"),
        (
            br#"{"status":201,"data":{}}"#.to_vec(),
            "Invalid Vocu response status",
        ),
        (
            br#"{"status":200,"data":[]}"#.to_vec(),
            "Invalid Vocu response object",
        ),
        (
            br#"{"status":200,"data":{"x":1e999}}"#.to_vec(),
            "Invalid Vocu metadata",
        ),
        (
            br#"{"status":200,"data":{"x":NaN}}"#.to_vec(),
            "Invalid Vocu metadata",
        ),
        (
            br#"{"status":200,"data":{"x":"\ud800"}}"#.to_vec(),
            "Invalid Vocu metadata",
        ),
    ] {
        let (response, counts) = response(vec![data], 200, vec![], false);
        let http = transport(vec![(response, false)]);
        let error = ready(synthesize(
            &TtsRequest::TextVoice9c5ed44a(fixtures::plain()),
            &http,
            Options {
                auth: Some(&auth),
                mode: Some(Mode::Http),
                ..Default::default()
            },
        ))
        .err()
        .unwrap();
        assert_eq!(error.to_string(), message);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
    for header in [false, true] {
        let (mut response, counts) = response(vec![b"12345".to_vec()], 200, vec![], false);
        if header {
            response
                .headers
                .push(("x-reecho-response-data".into(), "{\"x\":1}".into()));
        }
        let http = transport(vec![(response, false)]);
        let error = ready(synthesize(
            &TtsRequest::TextVoice9c5ed44a(fixtures::plain()),
            &http,
            Options {
                auth: Some(&auth),
                mode: Some(if header { Mode::Stream } else { Mode::Http }),
                max_metadata_bytes: 4,
                ..Default::default()
            },
        ))
        .err()
        .unwrap();
        assert_eq!(
            error.to_string(),
            "Vocu metadata exceeds max_metadata_bytes"
        );
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(counts.reads.load(Ordering::SeqCst), usize::from(!header));
    }
    let deeply_nested = format!("{{\"x\":{}0{}}}", "[".repeat(130), "]".repeat(130));
    assert_eq!(
        wire::metadata(&deeply_nested).unwrap_err().to_string(),
        "Vocu metadata exceeds maximum nesting depth (128)"
    );
    let within_limit = format!("{{\"x\":{}0{}}}", "[".repeat(127), "]".repeat(127));
    assert!(wire::metadata(&within_limit).is_ok());
}

#[test]
fn fragmented_metadata_preserves_native_keys_and_null_fallback() {
    let auth = auth();
    let raw="{\"status\":200,\"data\":{\"native_key\":\"你好😀\",\"streamUrl\":null,\"audio\":\"https://storage.vocu.ai/audio\"}}";
    let (metadata, counts) = response(
        raw.as_bytes().iter().map(|byte| vec![*byte]).collect(),
        200,
        vec![],
        false,
    );
    let (audio, _) = audio();
    let http = transport(vec![(metadata, false), (audio, false)]);
    let mut stream = ready(synthesize(
        &TtsRequest::TextVoice9c5ed44a(fixtures::plain()),
        &http,
        Options {
            auth: Some(&auth),
            mode: Some(Mode::Http),
            max_metadata_bytes: raw.len(),
            ..Default::default()
        },
    ))
    .unwrap();
    let items = collect(&mut stream).unwrap();
    let Value::Map(done) = &items[1] else {
        panic!("missing done")
    };
    assert_eq!(
        done.get("metadata"),
        Some(&fixture(
            Raw::parse_exact(raw).unwrap().object().unwrap()["data"]
        ))
    );
    assert_eq!(
        http.requests.lock().unwrap()[1].url,
        "https://storage.vocu.ai/audio"
    );
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn unsafe_audio_urls_never_receive_a_request() {
    let auth = auth();
    for address in [
        "https://evil.test/audio",
        "http://127.0.0.1/secret",
        "https://storage.vocu.ai.evil.test/audio",
        "https://key:secret@storage.vocu.ai/audio",
        "https://storage.vocu.ai/audio#fragment",
        "https://storage.vocu.ai/\nsecret",
        "https://storage.vocu.ai/%zz",
        "//evil.test/audio",
    ] {
        let mut value = String::from("{\"audio\":");
        crate::json::quote(address, &mut value);
        value.push('}');
        let (response, counts) = metadata(&value);
        let http = transport(vec![(response, false)]);
        let error = ready(synthesize(
            &TtsRequest::TextVoice9c5ed44a(fixtures::plain()),
            &http,
            Options {
                auth: Some(&auth),
                mode: Some(Mode::Http),
                ..Default::default()
            },
        ))
        .err()
        .unwrap();
        assert_eq!(error.to_string(), "Vocu returned an untrusted audio URL");
        assert_eq!(http.requests.lock().unwrap().len(), 1);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn relative_downloads_and_explicit_origins_do_not_inherit_auth() {
    let auth = auth();
    for (address, base, origins, want) in [
        (
            "relative.mp3",
            "https://v1.vocu.ai/base",
            &[][..],
            "https://v1.vocu.ai/relative.mp3",
        ),
        (
            "../final.mp3?token=a%2Fb",
            "https://v1.vocu.ai/a/b/",
            &[][..],
            "https://v1.vocu.ai/a/final.mp3?token=a%2Fb",
        ),
        (
            "../..?q=1",
            "https://v1.vocu.ai/a/b/c/",
            &[][..],
            "https://v1.vocu.ai/a/?q=1",
        ),
        (
            "/audio.mp3",
            "https://proxy.test/base",
            &["https://proxy.test"][..],
            "https://proxy.test/audio.mp3",
        ),
        (
            "http://127.0.0.1:8181/audio?token=fixture",
            "https://v1.vocu.ai",
            &["http://127.0.0.1:8181"][..],
            "http://127.0.0.1:8181/audio?token=fixture",
        ),
    ] {
        let mut value = String::from("{\"audio\":");
        crate::json::quote(address, &mut value);
        value.push('}');
        let (metadata, _) = metadata(&value);
        let (audio, _) = audio();
        let http = transport(vec![(metadata, false), (audio, false)]);
        let mut stream = ready(synthesize(
            &TtsRequest::TextVoice9c5ed44a(fixtures::plain()),
            &http,
            Options {
                auth: Some(&auth),
                mode: Some(Mode::Http),
                base_url: Some(base),
                audio_origins: origins,
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(collect(&mut stream).unwrap().len(), 2);
        let requests = http.requests.lock().unwrap();
        let request = &requests[1];
        assert_eq!(request.url, want);
        assert_eq!(request.method, "GET");
        assert!(request.headers.is_empty());
        assert!(request.body.is_empty());
    }
}

#[test]
fn job_status_identity_and_final_asset_are_validated() {
    let auth = auth();
    for (jobs, message) in [
        (
            vec![r#"{"id":"../other","status":"pending"}"#],
            "Invalid Vocu job ID",
        ),
        (
            vec![r#"{"id":"job\n","status":"pending"}"#],
            "Invalid Vocu job ID",
        ),
        (
            vec![r#"{"id":"job","status":"unknown"}"#],
            "Invalid Vocu job status",
        ),
        (
            vec![
                r#"{"id":"job","status":"pending"}"#,
                r#"{"id":"other","status":"generated"}"#,
            ],
            "Vocu returned a different job ID while polling",
        ),
        (
            vec![r#"{"id":"job","status":"failed","reason":"private text"}"#],
            "Vocu generation failed",
        ),
        (
            vec![r#"{"id":"job","status":"generated","metadata":{}}"#],
            "Vocu returned no audio URL",
        ),
        (
            vec![r#"{"id":"job","status":"generated","metadata":[]}"#],
            "Invalid Vocu response object",
        ),
    ] {
        let mut responses = vec![];
        let mut counts = vec![];
        for job in &jobs {
            let (r, c) = metadata(job);
            responses.push((r, false));
            counts.push(c);
        }
        let http = transport(responses);
        let error = ready(synthesize(
            &TtsRequest::TextVoice9c5ed44a(fixtures::plain()),
            &http,
            Options {
                auth: Some(&auth),
                mode: Some(Mode::Async),
                poll_interval_ms: 0,
                ..Default::default()
            },
        ))
        .err()
        .unwrap();
        assert_eq!(error.to_string(), message);
        assert_eq!(http.requests.lock().unwrap().len(), jobs.len());
        for counts in counts {
            assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        }
        if message == "Vocu generation failed" {
            assert_eq!(
                error.downcast_ref::<Error>().unwrap(),
                &Error {
                    status: None,
                    job_id: Some("job".into()),
                    request_id: None,
                    retry_after: None
                }
            );
        }
    }
}

#[test]
fn error_bodies_are_unread_and_only_diagnostic_headers_are_retained() {
    let auth = auth();
    for status in [302, 401, 429, 500] {
        let (response, counts) = response(
            vec![b"private response".to_vec()],
            status,
            vec![
                ("X-Vocu-App-Request-Id".into(), "trace".into()),
                ("Retry-After".into(), "7".into()),
            ],
            false,
        );
        let http = transport(vec![(response, false)]);
        let error = ready(synthesize(
            &TtsRequest::TextVoice9c5ed44a(fixtures::plain()),
            &http,
            Options {
                auth: Some(&auth),
                ..Default::default()
            },
        ))
        .err()
        .unwrap();
        assert_eq!(error.to_string(), format!("Vocu returned HTTP {status}"));
        assert_eq!(
            error.downcast_ref::<Error>().unwrap(),
            &Error {
                status: Some(status),
                job_id: None,
                request_id: Some("trace".into()),
                retry_after: Some("7".into())
            }
        );
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(http.requests.lock().unwrap().len(), 1);
    }
    let (job, _) = metadata(shared()["generatedJob"].text());
    let (audio, counts) = response(vec![vec![1]], 503, vec![], false);
    let http = transport(vec![(job, false), (audio, false)]);
    let error = ready(synthesize(
        &TtsRequest::TextVoice9c5ed44a(fixtures::plain()),
        &http,
        Options {
            auth: Some(&auth),
            mode: Some(Mode::Async),
            ..Default::default()
        },
    ))
    .err()
    .unwrap();
    assert_eq!(
        error.downcast_ref::<Error>().unwrap(),
        &Error {
            status: Some(503),
            job_id: Some("job_1".into()),
            request_id: None,
            retry_after: None
        }
    );
    assert!(http.requests.lock().unwrap()[1].headers.is_empty());
    assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn empty_audio_and_invalid_headers_do_not_emit_completion() {
    let auth = auth();
    let (audio, counts) = response(vec![], 200, vec![], false);
    let http = transport(vec![(audio, false)]);
    let mut stream = ready(synthesize(
        &TtsRequest::TextVoice9c5ed44a(fixtures::plain()),
        &http,
        Options {
            auth: Some(&auth),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        next(&mut stream).unwrap().err().unwrap().to_string(),
        "Vocu returned no audio"
    );
    assert!(next(&mut stream).is_none());
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    for (header, value, message) in [
        (
            "content-type",
            "application/json",
            "Vocu returned an unexpected audio content type",
        ),
        ("x-reecho-response-data", "bad", "Invalid Vocu metadata"),
    ] {
        let (audio, counts) = response(
            vec![vec![1]],
            200,
            vec![(header.into(), value.into())],
            false,
        );
        let http = transport(vec![(audio, false)]);
        let error = ready(synthesize(
            &TtsRequest::TextVoice9c5ed44a(fixtures::plain()),
            &http,
            Options {
                auth: Some(&auth),
                ..Default::default()
            },
        ))
        .err()
        .unwrap();
        assert_eq!(error.to_string(), message);
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}
