use super::*;

struct Http {
    response: Mutex<Option<Result<HttpResponse, TransportError>>>,
    requests: Mutex<Vec<HttpRequest>>,
}
impl HttpTransport for Http {
    fn send(
        &self,
        request: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        self.requests.lock().unwrap().push(request);
        Box::pin(async { self.response.lock().unwrap().take().unwrap() })
    }
}
fn http(counts: &Arc<Counts>, status: u16, chunks: Vec<Vec<u8>>, stall: bool) -> Http {
    Http {
        response: Mutex::new(Some(Ok(HttpResponse {
            status,
            headers: vec![],
            body: Box::pin(Body {
                values: chunks.into_iter().map(Ok).collect(),
                counts: counts.clone(),
                stall,
                name: "body",
            }),
        }))),
        requests: Mutex::new(vec![]),
    }
}

#[test]
fn every_http_model_and_audio_format_uses_typed_wire_settings() {
    for (model, wire_model) in [
        "mars-flash",
        "mars-instruct",
        "mars-pro",
        "mars-8.1-flash-beta",
        "mars-8.1-pro-beta",
    ]
    .into_iter()
    .enumerate()
    {
        for (format, wire_format) in [
            "mp3",
            "wav",
            "flac",
            "adts",
            "pcm_s16le",
            "pcm_s16be",
            "pcm_s32le",
            "pcm_s32be",
            "pcm_f32le",
            "pcm_f32be",
        ]
        .into_iter()
        .enumerate()
        {
            let mut request = whole();
            request.model = match model {
                0 => TtsRequestTextVoiceModel::Mars8Flash(Default::default()),
                1 => TtsRequestTextVoiceModel::Mars8Instruct(Default::default()),
                2 => TtsRequestTextVoiceModel::Mars8Pro(Default::default()),
                3 => TtsRequestTextVoiceModel::Mars81FlashBeta(Default::default()),
                4 => TtsRequestTextVoiceModel::Mars81ProBeta(Default::default()),
                _ => unreachable!(),
            };
            request.output = if format < 4 {
                TtsRequestTextVoiceOutput::Object(
                    TtsRequestMars81FlashBetaStreamingTextVoiceOutput {
                        format: match format {
                            0 => TtsRequestMars81FlashBetaStreamingTextVoiceOutputFormat::Mp3(
                                Default::default(),
                            ),
                            1 => TtsRequestMars81FlashBetaStreamingTextVoiceOutputFormat::Wav(
                                Default::default(),
                            ),
                            2 => TtsRequestMars81FlashBetaStreamingTextVoiceOutputFormat::Flac(
                                Default::default(),
                            ),
                            3 => TtsRequestMars81FlashBetaStreamingTextVoiceOutputFormat::Aac(
                                Default::default(),
                            ),
                            _ => unreachable!(),
                        },
                        sample_rate_hz: Some(24000.0),
                    },
                )
            } else {
                TtsRequestTextVoiceOutput::Pcm(TtsRequestTextVoiceOutputPcm {
                    format: Default::default(),
                    sample_rate_hz: Some(24000.0),
                    sample_encoding: match (format - 4) / 2 {
                        0 => TtsRequestTextVoiceOutputPcmSampleEncoding::SignedInteger16(
                            Default::default(),
                        ),
                        1 => TtsRequestTextVoiceOutputPcmSampleEncoding::SignedInteger32(
                            Default::default(),
                        ),
                        2 => {
                            TtsRequestTextVoiceOutputPcmSampleEncoding::Float32(Default::default())
                        }
                        _ => unreachable!(),
                    },
                    byte_order: if format % 2 == 0 {
                        TtsRequestTextVoiceOutputPcmByteOrder::LittleEndian(Default::default())
                    } else {
                        TtsRequestTextVoiceOutputPcmByteOrder::BigEndian(Default::default())
                    },
                })
            };
            request.speed = Some(1.25);
            request.audio_enhancement = Some(flag(false));
            request.named_entity_pronunciation_enhancement = Some(flag(true));
            request.reference_audio_enhancement = Some(flag(false));
            request.accent_preservation = Some(flag(true));
            let counts = Arc::new(Counts::default());
            let backend = http(&counts, 200, vec![vec![0, 255], vec![], vec![128]], false);
            let auth = auth();
            let mut stream = ready(synthesize(
                TtsRequest::TextVoice(request),
                Options {
                    auth: Some(&auth),
                    transport: Some(&backend),
                    base_url: Some("https://proxy.test/a%20b/?trace=1"),
                    ..Default::default()
                },
            ))
            .unwrap();
            assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
            assert_eq!(
                drain(&mut stream),
                (vec![json("[0,255]"), json("[128]")], None)
            );
            assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
            let requests = backend.requests.lock().unwrap();
            assert_eq!(requests.len(), 1);
            assert_eq!(
                requests[0].url,
                "https://proxy.test/a%20b/tts-stream?trace=1"
            );
            assert_eq!(requests[0].method, "POST");
            assert_eq!(
                requests[0].headers,
                [
                    ("x-api-key".into(), "test + key".into()),
                    ("content-type".into(), "application/json".into())
                ]
            );
            assert_eq!(
                wire::parse_http_input(std::str::from_utf8(&requests[0].body).unwrap()).unwrap(),
                wire::HttpInput {
                    text: "Hello".into(),
                    language: "en-us".into(),
                    voice_id: 123.0,
                    speech_model: Some(wire_model.into()),
                    enhance_named_entities_pronunciation: Some(true),
                    output_configuration: Some(wire::HttpInputOutputConfiguration {
                        format: Some(wire_format.into()),
                        sample_rate: Some(Some(24000.0)),
                        apply_enhancement: Some(Some(false)),
                        ..Default::default()
                    }),
                    voice_settings: Some(wire::HttpInputVoiceSettings {
                        speaking_rate: Some(Some(1.25)),
                        enhance_reference_audio_quality: Some(Some(false)),
                        maintain_source_accent: Some(Some(true)),
                        ..Default::default()
                    }),
                    ..Default::default()
                }
            );
        }
    }
}

#[test]
fn body_limits_errors_and_drop_do_not_buffer_successful_audio() {
    let auth = auth();
    for (status, body, limit, expected) in [
        (
            429,
            "\u{feff} quota \n".as_bytes(),
            40,
            "CAMB returned HTTP 429: quota",
        ),
        (
            500,
            b"large".as_slice(),
            4,
            "CAMB response exceeds max_error_bytes",
        ),
        (400, b"".as_slice(), 1, "CAMB returned HTTP 400: "),
    ] {
        for split in 0..=body.len() {
            let counts = Arc::new(Counts::default());
            let backend = http(
                &counts,
                status,
                vec![body[..split].into(), body[split..].into()],
                false,
            );
            let mut stream = ready(synthesize(
                TtsRequest::TextVoice(whole()),
                Options {
                    auth: Some(&auth),
                    transport: Some(&backend),
                    max_error_bytes: limit,
                    ..Default::default()
                },
            ))
            .unwrap();
            assert_eq!(drain(&mut stream), (vec![], Some(expected.into())));
            assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        }
    }
    for read in [false, true] {
        let counts = Arc::new(Counts::default());
        let backend = http(&counts, 200, vec![vec![255; 100]], true);
        let mut stream = ready(synthesize(
            TtsRequest::TextVoice(whole()),
            Options {
                auth: Some(&auth),
                transport: Some(&backend),
                max_error_bytes: 1,
                ..Default::default()
            },
        ))
        .unwrap();
        if read {
            let waker = Waker::from(counts.clone());
            let mut cx = Context::from_waker(&waker);
            assert_eq!(
                poll(&mut stream, &mut cx),
                Poll::Ready(Some(Ok(JsonValue::Array(vec![
                    JsonValue::Number(255.0);
                    100
                ]))))
            );
            assert_eq!(poll(&mut stream, &mut cx), Poll::Pending);
            assert!(counts.waker.lock().unwrap().is_some());
        }
        drop(stream);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn defaults_schema_validation_and_voice_conversion_precede_http() {
    let auth = auth();
    let counts = Arc::new(Counts::default());
    let backend = http(&counts, 200, vec![], false);
    for (voice, expected) in [
        ("bad", None),
        ("0", Some("CAMB voice must be a positive integer ID")),
        (
            "9007199254740992",
            Some("CAMB voice must be a positive integer ID"),
        ),
        (
            "999999999999999999999999999999",
            Some("CAMB voice must be a positive integer ID"),
        ),
    ] {
        let mut request = whole();
        request.voice = voice.into();
        let request = TtsRequest::TextVoice(request);
        let expected = expected.map(str::to_owned).unwrap_or_else(|| validation_error(&request));
        assert_eq!(
            ready(synthesize(
                request,
                Options {
                    auth: Some(&auth),
                    transport: Some(&backend),
                    ..Default::default()
                }
            ))
            .err()
            .unwrap()
            .to_string(),
            expected
        );
    }
    let mut request = whole();
    request.speed = Some(f64::NAN);
    let request = TtsRequest::TextVoice(request);
    let expected = validation_error(&request);
    assert_eq!(
        ready(synthesize(
            request,
            Options {
                auth: Some(&auth),
                transport: Some(&backend),
                ..Default::default()
            }
        ))
        .err()
        .unwrap()
        .to_string(),
        expected
    );
    assert_eq!(backend.requests.lock().unwrap().len(), 0);
    let mut request = whole();
    request.voice = "0009007199254740991".into();
    drop(
        ready(synthesize(
            TtsRequest::TextVoice(request),
            Options {
                auth: Some(&auth),
                transport: Some(&backend),
                ..Default::default()
            },
        ))
        .unwrap(),
    );
    let requests = backend.requests.lock().unwrap();
    assert_eq!(requests[0].url, "https://client.camb.ai/apis/tts-stream");
    assert_eq!(
        json(std::str::from_utf8(&requests[0].body).unwrap()),
        json(
            r#"{"text":"Hello","language":"en-us","voice_id":9007199254740991,"speech_model":"mars-flash","output_configuration":{"format":"mp3"},"voice_settings":{}}"#
        )
    );
}

#[test]
fn http_error_identity_survives_send_and_body_cleanup() {
    for send in [true, false] {
        let counts = Arc::new(Counts::default());
        let token = Arc::new(());
        let response = if send {
            Err(Box::new(Cause(token.clone())))
        } else {
            Ok(HttpResponse {
                status: 200,
                headers: vec![],
                body: Box::pin(Body {
                    values: VecDeque::from([Err(Box::new(Cause(token.clone())) as TransportError)]),
                    counts: counts.clone(),
                    stall: false,
                    name: "body",
                }),
            })
        };
        let backend = Http {
            response: Mutex::new(Some(response.map_err(|error| error as TransportError))),
            requests: Mutex::new(vec![]),
        };
        let auth = auth();
        let result = ready(synthesize(
            TtsRequest::TextVoice(whole()),
            Options {
                auth: Some(&auth),
                transport: Some(&backend),
                ..Default::default()
            },
        ));
        let error = if send {
            result.err().unwrap()
        } else {
            let mut stream = result.unwrap();
            match Pin::new(&mut stream).poll_next(&mut Context::from_waker(Waker::noop())) {
                Poll::Ready(Some(Err(error))) => {
                    assert_eq!(
                        poll(&mut stream, &mut Context::from_waker(Waker::noop())),
                        Poll::Ready(None)
                    );
                    error
                }
                _ => panic!("missing body error"),
            }
        };
        assert!(Arc::ptr_eq(
            &error.downcast_ref::<Cause>().unwrap().0,
            &token
        ));
        assert_eq!(
            counts.drops.load(Ordering::SeqCst),
            if send { 0 } else { 1 }
        );
    }
}

#[test]
fn auth_environment_child() {
    let Ok(case) = std::env::var("SPEECHSWITCH_TEST_CAMB_AUTH_CASE") else {
        return;
    };
    let mut auth = auth();
    auth.camb.as_mut().unwrap().api_key = match case.as_str() {
        "explicit" => Some("explicit".into()),
        "empty" => Some("".into()),
        _ => None,
    };
    let counts = Arc::new(Counts::default());
    let backend = http(&counts, 200, vec![], false);
    let result = ready(synthesize(
        TtsRequest::TextVoice(whole()),
        Options {
            auth: Some(&auth),
            transport: Some(&backend),
            ..Default::default()
        },
    ));
    if ["empty", "scoped-empty", "missing"].contains(&case.as_str()) {
        assert_eq!(
            result.err().unwrap().to_string(),
            "Missing auth.camb.apiKey configuration"
        );
        assert_eq!(backend.requests.lock().unwrap().len(), 0);
    } else {
        drop(result.unwrap());
        assert_eq!(
            backend.requests.lock().unwrap()[0].headers[0],
            ("x-api-key".into(), case)
        );
    }
}

#[test]
fn auth_precedence_is_checked_in_isolated_environments() {
    for case in [
        "explicit",
        "empty",
        "scoped",
        "scoped-empty",
        "legacy",
        "missing",
    ] {
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "providers::camb::tests::http::auth_environment_child",
                "--nocapture",
            ])
            .env("SPEECHSWITCH_TEST_CAMB_AUTH_CASE", case)
            .env_remove("SPEECHSWITCH_CAMB_API_KEY")
            .env_remove("CAMB_API_KEY");
        if case != "missing" {
            command.env("CAMB_API_KEY", "legacy");
        }
        if matches!(case, "explicit" | "empty" | "scoped") {
            command.env("SPEECHSWITCH_CAMB_API_KEY", "scoped");
        }
        if case == "scoped-empty" {
            command.env("SPEECHSWITCH_CAMB_API_KEY", "");
        }
        let result = command.output().unwrap();
        assert_eq!(
            result.status.code(),
            Some(0),
            "{case}: {} {}",
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        );
    }
}
