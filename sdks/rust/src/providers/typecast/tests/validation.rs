use super::*;

#[test]
fn malformed_wire_metadata_and_alignments_are_rejected_exactly() {
    let base = shared()["timestampResponse"].object().unwrap();
    for (field, replacement, expected) in [
        ("audio", r#""""#, "Invalid Typecast base64 audio"),
        ("audio", r#""AP9=""#, "Invalid Typecast base64 audio"),
        ("audio", r#""AP8=\n""#, "Invalid Typecast base64 audio"),
        ("audio", r#""é""#, "Invalid Typecast base64 audio"),
        ("audio", "true", "Invalid Typecast base64 audio"),
        (
            "audio_duration",
            "true",
            "Invalid Typecast timestamp audio metadata",
        ),
        (
            "audio_duration",
            "-1",
            "Invalid Typecast timestamp audio metadata",
        ),
        (
            "audio_duration",
            "1e308",
            "Invalid Typecast timestamp audio metadata",
        ),
        (
            "audio_duration",
            "1e999",
            "Invalid Typecast timestamp audio metadata",
        ),
        (
            "audio_format",
            r#""mp3""#,
            "Invalid Typecast timestamp audio metadata",
        ),
        ("words", "null", "Typecast omitted words alignment"),
        ("words", "[null]", "Invalid Typecast alignment segment"),
        (
            "characters",
            r#"[{"text":"bad","start":true,"end":1}]"#,
            "Invalid Typecast alignment interval",
        ),
        (
            "characters",
            r#"[{"text":"bad","start":1,"end":0}]"#,
            "Invalid Typecast alignment interval",
        ),
        (
            "characters",
            r#"[{"text":"bad","start":-1,"end":0}]"#,
            "Invalid Typecast alignment interval",
        ),
        (
            "characters",
            r#"[{"text":"bad","start":0,"end":1e308}]"#,
            "Invalid Typecast alignment interval",
        ),
        (
            "characters",
            r#"[{"text":1,"start":0,"end":1}]"#,
            "Invalid Typecast alignment interval",
        ),
        (
            "characters",
            r#"[{"text":"bad","start":0}]"#,
            "Invalid Typecast alignment interval",
        ),
    ] {
        let mut wire = String::from("{");
        for (index, (key, value)) in base.iter().enumerate() {
            if index > 0 {
                wire.push(',');
            }
            crate::json::quote(key, &mut wire);
            wire.push(':');
            wire.push_str(if key == field {
                replacement
            } else {
                value.text()
            });
        }
        wire.push('}');
        let (backend, counts) = transport(vec![wire.into_bytes()], 200, "application/json", false);
        let auth = auth();
        let request = TtsRequest::SsfmV30TextVoiceda7d6fa9(fixtures::timed());
        let mut stream = ready(synthesize(
            &request,
            &backend,
            Options {
                auth: Some(&auth),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(
            collect(&mut stream).unwrap_err().to_string(),
            expected,
            "{field}={replacement}"
        );
        assert!(next(&mut stream).is_none());
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn strict_json_and_null_unrequested_tracks() {
    for bytes in [
        b"{".to_vec(),
        b"null".to_vec(),
        b"[]".to_vec(),
        b"NaN".to_vec(),
        vec![255],
        br#"{"bad":"\ud800"}"#.to_vec(),
    ] {
        assert_eq!(
            decode_timestamps(&bytes, "wav", true, false)
                .err()
                .unwrap()
                .to_string(),
            "Invalid Typecast timestamp response"
        );
    }
    let valid =
        br#"{"audio":"AP8=","audio_format":"wav","audio_duration":0,"words":[],"characters":null}"#;
    let value = decode_timestamps(valid, "wav", true, false).unwrap();
    assert_eq!(value.audio, vec![0, 255]);
    assert_eq!(value.duration_ms, 0.0);
    assert_eq!(value.timestamps.len(), 0);
    assert_eq!(
        decode_timestamps(valid, "wav", true, true)
            .err()
            .unwrap()
            .to_string(),
        "Typecast omitted characters alignment"
    );
    let missing = br#"{"audio":"AP8=","audio_format":"wav","audio_duration":0,"words":[]}"#;
    assert_eq!(
        decode_timestamps(missing, "wav", true, false)
            .err()
            .unwrap()
            .to_string(),
        "Typecast omitted characters alignment"
    );
    let mut bom = vec![239, 187, 191];
    bom.extend(valid);
    assert_eq!(
        decode_timestamps(&bom, "wav", true, false).unwrap().audio,
        vec![0, 255]
    );
}

#[test]
fn generated_request_checks_precede_transport() {
    let mut cases = Vec::new();
    let mut empty = fixtures::plain();
    empty.text.clear();
    cases.push(empty);
    let mut long = fixtures::plain();
    long.text = "😀".repeat(2001);
    cases.push(long);
    let mut voice = fixtures::plain();
    voice.voice = "missing-prefix".into();
    cases.push(voice);
    let mut speed = fixtures::plain();
    speed.speed = Some(f64::NAN);
    cases.push(speed);
    let mut pitch = fixtures::plain();
    pitch.pitch_semitones = Some(0.5);
    cases.push(pitch);
    let mut seed = fixtures::plain();
    seed.random_seed = Some(4294967296.0);
    cases.push(seed);
    for request in cases {
        let request = TtsRequest::SsfmV30TextVoicec9d5257e(request);
        let (backend, _) = transport(vec![], 200, "", false);
        let auth = auth();
        assert_eq!(
            ready(synthesize(
                &request,
                &backend,
                Options {
                    auth: Some(&auth),
                    ..Default::default()
                }
            ))
            .err()
            .unwrap()
            .to_string(),
            "Invalid typecast TTS request"
        );
        assert_eq!(backend.requests.lock().unwrap().len(), 0);
    }
}

#[test]
fn composition_totals_unicode_boundaries_and_pause_underflow() {
    let compose = |segments| {
        TtsRequest::Object(TtsRequestObject {
            output: None,
            segments,
        })
    };
    let pause = |pause_ms| {
        TtsRequestObjectSegmentsItem::Object(TtsRequestObjectSegmentsItemObject {
            kind: Default::default(),
            pause_ms,
        })
    };
    let speech = |text: String| {
        let mut r = fixtures::speech();
        r.text = text;
        TtsRequestObjectSegmentsItem::SsfmV21TextVoice4e8a729e(r)
    };
    let mut too_many_pauses = vec![speech("Hi".into())];
    too_many_pauses.extend((0..7).map(|_| pause(10000.0)));
    for request in [
        compose(vec![pause(1.0)]),
        compose(vec![speech("😀".repeat(1001)), speech("x".repeat(1000))]),
        compose(too_many_pauses),
    ] {
        let (backend, _) = transport(vec![], 200, "", false);
        let auth = auth();
        assert_eq!(ready(synthesize(&request,&backend,Options{auth:Some(&auth),..Default::default()})).err().unwrap().to_string(),"Typecast composition requires speech, at most 2000 total text code points and at most 60000 ms total pauses");
        assert_eq!(backend.requests.lock().unwrap().len(), 0);
    }
    let request = compose(vec![speech("Hi".into()), pause(f64::from_bits(1))]);
    assert_eq!(
        settings::prepare(&request, None).err().unwrap().to_string(),
        "Typecast pause cannot be represented as positive seconds"
    );
    let mut segments = vec![speech("😀".repeat(1000)), speech("x".repeat(1000))];
    segments.extend((0..6).map(|_| pause(10000.0)));
    let request = compose(segments);
    let (backend, _) = transport(vec![b"audio".to_vec()], 200, "audio/wav", false);
    let auth = auth();
    let mut stream = ready(synthesize(
        &request,
        &backend,
        Options {
            auth: Some(&auth),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(collect(&mut stream).unwrap().len(), 2);
    assert_eq!(backend.requests.lock().unwrap().len(), 1);
    for segments in [vec![], (0..51).map(|_| speech("Hi".into())).collect()] {
        let request = compose(segments);
        assert_eq!(
            validate_request(&request).err().unwrap().to_string(),
            "Invalid typecast TTS request"
        );
    }
}

#[test]
fn protocol_overrides_do_not_discard_controls_or_rates() {
    for request in fixtures::requests().into_iter().skip(9) {
        assert_eq!(settings::prepare(&request,Some(Protocol::Stream)).err().unwrap().to_string(),"Typecast composition, timestamps, volume scaling and 44.1 kHz WAV require ordinary synthesis");
    }
    let mut r = fixtures::plain();
    r.output = Some(TtsRequestSsfmV21TextVoicef82be0f4Output::Wav(
        TtsRequestSsfmV21TextVoicef82be0f4OutputWav {
            format: Default::default(),
            sample_rate_hz: Some(
                TtsRequestSsfmV21TextVoicef82be0f4OutputWavSampleRateHz::Number32000(
                    Default::default(),
                ),
            ),
            byte_order: None,
            channel_count: None,
            sample_encoding: None,
        },
    ));
    let request = TtsRequest::SsfmV30TextVoicec9d5257e(r);
    assert_eq!(
        settings::prepare(&request, Some(Protocol::Http))
            .err()
            .unwrap()
            .to_string(),
        "Typecast ordinary WAV uses 44100 Hz, not 32000 Hz"
    );
    assert_eq!(
        settings::prepare(&request, None).unwrap().operation,
        "/stream"
    );
    let request = TtsRequest::SsfmV30TextVoicec9d5257e(fixtures::plain());
    assert_eq!(
        settings::prepare(&request, Some(Protocol::Http))
            .unwrap()
            .operation,
        ""
    );
}

#[test]
fn zero_seed_and_volume_rounding_match_typescript() {
    for (scale, expected) in [
        (0.0, 0.0),
        (0.005, 1.0),
        (f64::from_bits(0.005f64.to_bits() - 1), 0.0),
        (0.025, 3.0),
        (2.0, 200.0),
    ] {
        let mut request = fixtures::requests().remove(5);
        if let TtsRequest::SsfmV30TextVoice2e7e5231(v) = &mut request {
            v.volume_scale = scale;
            v.random_seed = Some(0.0);
        }
        let wire = settings::prepare(&request, None).unwrap().body;
        let value = Raw::parse_exact(&wire).unwrap().object().unwrap();
        assert_eq!(value["seed"].number().unwrap(), 0.0);
        assert_eq!(
            value["output"].object().unwrap()["volume"]
                .number()
                .unwrap(),
            expected
        );
    }
}

#[test]
fn invalid_public_options_fail_before_sending() {
    let auth = auth();
    let request = TtsRequest::SsfmV30TextVoicec9d5257e(fixtures::plain());
    for base in [
        "ftp://example.test",
        "https://user:pass@example.test",
        "https://example.test/#fragment",
        "https://example.test:65536",
        "https://example.test:bad",
        "https://example.test/ bad",
        "https://example.test/%xx",
        "https://example.test/?key=%xx",
    ] {
        let (backend, _) = transport(vec![], 200, "", false);
        assert_eq!(
            ready(synthesize(
                &request,
                &backend,
                Options {
                    auth: Some(&auth),
                    base_url: Some(base),
                    ..Default::default()
                }
            ))
            .err()
            .unwrap()
            .to_string(),
            "Typecast endpoint must be HTTP(S) without credentials, fragments or invalid escapes"
        );
        assert_eq!(backend.requests.lock().unwrap().len(), 0);
    }
    for limit in [0, usize::MAX] {
        if limit != 0 && limit as u128 <= 9007199254740991 {
            continue;
        }
        let (backend, _) = transport(vec![], 200, "", false);
        assert_eq!(
            ready(synthesize(
                &request,
                &backend,
                Options {
                    auth: Some(&auth),
                    max_timestamp_response_bytes: limit,
                    ..Default::default()
                }
            ))
            .err()
            .unwrap()
            .to_string(),
            "Typecast max_timestamp_response_bytes must be a positive safe integer"
        );
        assert_eq!(backend.requests.lock().unwrap().len(), 0);
    }
    for key in ["", "bad key", "a\nb", "é"] {
        let mut auth = super::auth();
        auth.typecast.as_mut().unwrap().api_key = Some(key.into());
        let (backend, _) = transport(vec![], 200, "", false);
        assert_eq!(
            ready(synthesize(
                &request,
                &backend,
                Options {
                    auth: Some(&auth),
                    ..Default::default()
                }
            ))
            .err()
            .unwrap()
            .to_string(),
            if key.is_empty() {
                "Missing auth.typecast.apiKey configuration"
            } else {
                "Typecast API key must contain only visible ASCII characters"
            }
        );
        assert_eq!(backend.requests.lock().unwrap().len(), 0);
    }
}

#[test]
fn environment_child() {
    let Ok(mode) = std::env::var("SPEECHSWITCH_TYPECAST_TEST_CHILD") else {
        return;
    };
    let mut auth = auth();
    auth.typecast.as_mut().unwrap().api_key = match mode.as_str() {
        "explicit" => Some("explicit".into()),
        "empty" => Some("".into()),
        _ => None,
    };
    let (backend, _) = transport(vec![], 200, "", false);
    let request = TtsRequest::SsfmV30TextVoicec9d5257e(fixtures::plain());
    let result = ready(synthesize(
        &request,
        &backend,
        Options {
            auth: Some(&auth),
            ..Default::default()
        },
    ));
    match std::env::var("SPEECHSWITCH_TYPECAST_TEST_EXPECTED") {
        Ok(key) => {
            drop(result.unwrap());
            assert_eq!(
                backend.requests.lock().unwrap()[0].headers[0],
                ("X-API-KEY".into(), key)
            );
        }
        Err(_) => {
            assert_eq!(
                result.err().unwrap().to_string(),
                "Missing auth.typecast.apiKey configuration"
            );
            assert_eq!(backend.requests.lock().unwrap().len(), 0);
        }
    }
}

#[test]
fn environment_precedence_uses_isolated_processes() {
    for (mode, scoped, vendor, expected) in [
        ("explicit", Some("scoped"), Some("vendor"), Some("explicit")),
        ("none", Some("scoped"), Some("vendor"), Some("scoped")),
        ("none", None, Some("vendor"), Some("vendor")),
        ("empty", Some("scoped"), Some("vendor"), None),
        ("none", Some(""), Some("vendor"), None),
        ("none", None, None, None),
    ] {
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "providers::typecast::tests::validation::environment_child",
                "--nocapture",
            ])
            .env("SPEECHSWITCH_TYPECAST_TEST_CHILD", mode)
            .env_remove("SPEECHSWITCH_TYPECAST_API_KEY")
            .env_remove("TYPECAST_API_KEY")
            .env_remove("SPEECHSWITCH_TYPECAST_TEST_EXPECTED");
        if let Some(v) = scoped {
            command.env("SPEECHSWITCH_TYPECAST_API_KEY", v);
        }
        if let Some(v) = vendor {
            command.env("TYPECAST_API_KEY", v);
        }
        if let Some(v) = expected {
            command.env("SPEECHSWITCH_TYPECAST_TEST_EXPECTED", v);
        }
        let result = command.output().unwrap();
        assert!(
            result.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        );
    }
}
