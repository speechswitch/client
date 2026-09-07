use super::*;
fn all_requests() -> Vec<(TtsRequest, &'static str, bool, &'static str)> {
    vec![
        (
            TtsRequest::LightningV31ProStreamingTextVoice8f1b36fb(
                TtsRequestLightningV31ProStreamingTextVoice8f1b36fb {
                    content_retention_days: None,
                    formula_reading: None,
                    language: None,
                    model: Default::default(),
                    number_pronunciation_language: None,
                    output: None,
                    request_id: None,
                    session_id: None,
                    speed: None,
                    text: body(vec![Ok(text("  hello  "))], true).0,
                    voice: "saved-voice".into(),

                    continuation: TtsRequestLightningV31ProStreamingTextVoice8f1b36fbContinuation {
                        id: "context".into(),
                        max_buffer_delay_ms: None,
                    },
                },
            ),
            "lightning_v3.1_pro",
            false,
            "continuation",
        ),
        (
            TtsRequest::LightningV31ProStreamingTextVoiced206187f(
                TtsRequestLightningV31ProStreamingTextVoiced206187f {
                    content_retention_days: None,
                    formula_reading: None,
                    language: None,
                    model: Default::default(),
                    number_pronunciation_language: None,
                    output: None,
                    request_id: None,
                    session_id: None,
                    speed: None,
                    text: body(vec![Ok("  hello  ".to_owned())], true).0,
                    voice: "saved-voice".into(),

                    completion_delay_ms: None,
                    max_buffer_delay_ms: None,
                },
            ),
            "lightning_v3.1_pro",
            false,
            "stream",
        ),
        (
            TtsRequest::LightningV31ProTextVoice74d06326(
                TtsRequestLightningV31ProTextVoice74d06326 {
                    content_retention_days: None,
                    formula_reading: None,
                    language: None,
                    model: Default::default(),
                    number_pronunciation_language: None,
                    output: None,
                    request_id: None,
                    session_id: None,
                    speed: None,
                    text: "  hello  ".into(),
                    voice: "saved-voice".into(),

                    pronunciation_dictionaries: None,
                },
            ),
            "lightning_v3.1_pro",
            false,
            "whole",
        ),
        (
            TtsRequest::LightningV31ProStreamingTextVoice4f8c2395(
                TtsRequestLightningV31ProStreamingTextVoice4f8c2395 {
                    content_retention_days: None,
                    formula_reading: None,
                    language: None,
                    model: Default::default(),
                    number_pronunciation_language: None,
                    output: None,
                    request_id: None,
                    session_id: None,
                    speed: None,
                    text: body(vec![Ok(text("  hello  "))], true).0,
                    voice: TtsRequestLightningV31ProStreamingTextVoice4f8c2395Voice::Meher(
                        Default::default(),
                    ),
                    timestamp_granularity: Default::default(),
                    continuation: TtsRequestLightningV31ProStreamingTextVoice8f1b36fbContinuation {
                        id: "context".into(),
                        max_buffer_delay_ms: None,
                    },
                },
            ),
            "lightning_v3.1_pro",
            true,
            "continuation",
        ),
        (
            TtsRequest::LightningV31ProStreamingTextVoice2da2f6d9(
                TtsRequestLightningV31ProStreamingTextVoice2da2f6d9 {
                    content_retention_days: None,
                    formula_reading: None,
                    language: None,
                    model: Default::default(),
                    number_pronunciation_language: None,
                    output: None,
                    request_id: None,
                    session_id: None,
                    speed: None,
                    text: body(vec![Ok("  hello  ".to_owned())], true).0,
                    voice: TtsRequestLightningV31ProStreamingTextVoice4f8c2395Voice::Meher(
                        Default::default(),
                    ),
                    timestamp_granularity: Default::default(),
                    completion_delay_ms: None,
                    max_buffer_delay_ms: None,
                },
            ),
            "lightning_v3.1_pro",
            true,
            "stream",
        ),
        (
            TtsRequest::LightningV31ProTextVoice3c7c5185(
                TtsRequestLightningV31ProTextVoice3c7c5185 {
                    content_retention_days: None,
                    formula_reading: None,
                    language: None,
                    model: Default::default(),
                    number_pronunciation_language: None,
                    output: None,
                    request_id: None,
                    session_id: None,
                    speed: None,
                    text: "  hello  ".into(),
                    voice: TtsRequestLightningV31ProStreamingTextVoice4f8c2395Voice::Meher(
                        Default::default(),
                    ),
                    timestamp_granularity: Default::default(),
                },
            ),
            "lightning_v3.1_pro",
            true,
            "whole",
        ),
        (
            TtsRequest::LightningV31StreamingTextVoicebf9ab904(
                TtsRequestLightningV31StreamingTextVoicebf9ab904 {
                    content_retention_days: None,
                    formula_reading: None,
                    language: None,
                    model: Default::default(),
                    number_pronunciation_language: None,
                    output: None,
                    request_id: None,
                    session_id: None,
                    speed: None,
                    text: body(vec![Ok(text("  hello  "))], true).0,
                    voice: "saved-voice".into(),

                    continuation: TtsRequestLightningV31ProStreamingTextVoice8f1b36fbContinuation {
                        id: "context".into(),
                        max_buffer_delay_ms: None,
                    },
                },
            ),
            "lightning_v3.1",
            false,
            "continuation",
        ),
        (
            TtsRequest::LightningV31StreamingTextVoiced272850b(
                TtsRequestLightningV31StreamingTextVoiced272850b {
                    content_retention_days: None,
                    formula_reading: None,
                    language: None,
                    model: Default::default(),
                    number_pronunciation_language: None,
                    output: None,
                    request_id: None,
                    session_id: None,
                    speed: None,
                    text: body(vec![Ok("  hello  ".to_owned())], true).0,
                    voice: "saved-voice".into(),

                    completion_delay_ms: None,
                    max_buffer_delay_ms: None,
                },
            ),
            "lightning_v3.1",
            false,
            "stream",
        ),
        (
            TtsRequest::LightningV31TextVoice5e2ae2e5(TtsRequestLightningV31TextVoice5e2ae2e5 {
                content_retention_days: None,
                formula_reading: None,
                language: None,
                model: Default::default(),
                number_pronunciation_language: None,
                output: None,
                request_id: None,
                session_id: None,
                speed: None,
                text: "  hello  ".into(),
                voice: "saved-voice".into(),

                pronunciation_dictionaries: None,
            }),
            "lightning_v3.1",
            false,
            "whole",
        ),
        (
            TtsRequest::LightningV31StreamingTextVoice90b1878c(
                TtsRequestLightningV31StreamingTextVoice90b1878c {
                    content_retention_days: None,
                    formula_reading: None,
                    language: None,
                    model: Default::default(),
                    number_pronunciation_language: None,
                    output: None,
                    request_id: None,
                    session_id: None,
                    speed: None,
                    text: body(vec![Ok(text("  hello  "))], true).0,
                    voice: TtsRequestLightningV31ProStreamingTextVoice4f8c2395Voice::Meher(
                        Default::default(),
                    ),
                    timestamp_granularity: Default::default(),
                    continuation: TtsRequestLightningV31ProStreamingTextVoice8f1b36fbContinuation {
                        id: "context".into(),
                        max_buffer_delay_ms: None,
                    },
                },
            ),
            "lightning_v3.1",
            true,
            "continuation",
        ),
        (
            TtsRequest::LightningV31StreamingTextVoicea9844e06(
                TtsRequestLightningV31StreamingTextVoicea9844e06 {
                    content_retention_days: None,
                    formula_reading: None,
                    language: None,
                    model: Default::default(),
                    number_pronunciation_language: None,
                    output: None,
                    request_id: None,
                    session_id: None,
                    speed: None,
                    text: body(vec![Ok("  hello  ".to_owned())], true).0,
                    voice: TtsRequestLightningV31ProStreamingTextVoice4f8c2395Voice::Meher(
                        Default::default(),
                    ),
                    timestamp_granularity: Default::default(),
                    completion_delay_ms: None,
                    max_buffer_delay_ms: None,
                },
            ),
            "lightning_v3.1",
            true,
            "stream",
        ),
        (
            TtsRequest::LightningV31TextVoice727240a7(TtsRequestLightningV31TextVoice727240a7 {
                content_retention_days: None,
                formula_reading: None,
                language: None,
                model: Default::default(),
                number_pronunciation_language: None,
                output: None,
                request_id: None,
                session_id: None,
                speed: None,
                text: "  hello  ".into(),
                voice: TtsRequestLightningV31ProStreamingTextVoice4f8c2395Voice::Meher(
                    Default::default(),
                ),
                timestamp_granularity: Default::default(),
            }),
            "lightning_v3.1",
            true,
            "whole",
        ),
    ]
}
#[test]
fn all_twelve_model_input_alignment_variants() {
    for (mut request, model, timed, mode) in all_requests() {
        settings::trim(&mut request);
        let _ = validate_request(&request).unwrap();
        let values = settings::prepare(&request);
        let voice = if timed { "meher" } else { "saved-voice" };
        let lang = if timed { "en" } else { "auto" };
        assert_eq!(
            value(&values.wire),
            value(&format!(
                r#"{{"voice_id":"{voice}","model":"{model}","language":"{lang}","sample_rate":44100,"output_format":"pcm","speed":1,"math_notation":false{}}}"#,
                if timed {
                    r#","word_timestamps":true"#
                } else {
                    ""
                }
            ))
        );
        assert_eq!(values.timed, timed);
        assert_eq!(values.completion_delay, 4000.0);
        assert_eq!(
            values.continuation.as_deref(),
            if mode == "continuation" {
                Some("context")
            } else {
                None
            }
        );
        assert_eq!(
            values.buffer_delay,
            if mode == "continuation" { 3000.0 } else { 0.0 }
        );
        let (socket, state) = socket(true);
        let mut stream = live(request, socket);
        if mode == "continuation" {
            let first = pull(&mut stream).unwrap().unwrap();
            assert_eq!(
                item(first),
                if timed {
                    Item::Envelope("native".into(), Some(vec![0, 255, 128]), vec![], None)
                } else {
                    Item::Bytes(vec![0, 255, 128])
                }
            );
            assert_eq!(
                item(pull(&mut stream).unwrap().unwrap()),
                Item::Batch("native".into())
            );
            tick(&mut stream);
            assert_eq!(state.lock().unwrap().drops, 0);
            drop(stream);
            assert_eq!(state.lock().unwrap().drops, 1);
        } else {
            let result = collect(&mut stream).unwrap();
            assert_eq!(
                result,
                vec![
                    if timed {
                        Item::Envelope("native".into(), Some(vec![0, 255, 128]), vec![], None)
                    } else {
                        Item::Bytes(vec![0, 255, 128])
                    },
                    Item::Done
                ]
            );
            assert_eq!(state.lock().unwrap().drops, 1);
            let s = state.lock().unwrap();
            let wire = Raw::parse_exact(&s.sent[0]).unwrap().object().unwrap();
            assert_eq!(
                wire["text"].string().unwrap(),
                if mode == "whole" {
                    "hello"
                } else {
                    "  hello  "
                }
            );
            if mode == "stream" {
                assert_eq!(s.sent.len(), 2);
                let final_wire = Raw::parse_exact(&s.sent[1]).unwrap().object().unwrap();
                assert_eq!(final_wire["continue"].boolean().unwrap(), false);
                assert_eq!(final_wire["flush"].boolean().unwrap(), true);
            } else {
                assert_eq!(s.sent.len(), 1);
                assert!(!wire.contains_key("continue"));
            }
        }
    }
}
pub(super) fn pro_request() -> TtsRequestLightningV31ProTextVoice74d06326 {
    TtsRequestLightningV31ProTextVoice74d06326 {
        content_retention_days: None,
        formula_reading: Some(
            TtsRequestLightningV31ProStreamingTextVoice8f1b36fbFormulaReading::False(
                Default::default(),
            ),
        ),
        language: Some(
            TtsRequestLightningV31ProStreamingTextVoice8f1b36fbLanguage::Ja(Default::default()),
        ),
        model: Default::default(),
        number_pronunciation_language: None,
        output: None,
        pronunciation_dictionaries: Some(vec![]),
        request_id: None,
        session_id: None,
        speed: None,
        text: "こんにちは".into(),
        voice: "cloned_voice".into(),
    }
}
fn fixture_requests() -> Vec<TtsRequest> {
    let mut first = request();
    first.text = "  Hello  ".into();
    first.voice = "custom_voice".into();
    let mut third = pro_request();
    third.voice = "saved-voice".into();
    third.text = "3+2".into();
    third.number_pronunciation_language =
        Some(TtsRequestLightningV31ProStreamingTextVoice8f1b36fbLanguage::Hi(Default::default()));
    third.formula_reading = Some(
        TtsRequestLightningV31ProStreamingTextVoice8f1b36fbFormulaReading::PlainText(
            Default::default(),
        ),
    );
    third.speed = Some(0.5);
    third.content_retention_days = Some(Default::default());
    third.pronunciation_dictionaries = Some(vec![
        TtsRequestLightningV31ProTextVoice74d06326PronunciationDictionariesItem {
            id: "dict-1".into(),
        },
    ]);
    third.session_id = Some("session.1".into());
    third.request_id = Some("request-1".into());
    third.output=Some(TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutput::Object1e4e72b8(TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject1e4e72b8{
 channel_count:None,format:TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject1e4e72b8Format::Mulaw(Default::default()),
 sample_rate_hz:Some(TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject1e4e72b8SampleRateHz::Number8000(Default::default())),
 }));
    vec![
        TtsRequest::LightningV31TextVoice5e2ae2e5(first),
        TtsRequest::LightningV31ProTextVoice74d06326(pro_request()),
        TtsRequest::LightningV31ProTextVoice74d06326(third),
    ]
}
#[test]
fn shared_request_fixtures_and_every_sse_byte_split() {
    let fixtures = Raw::parse_exact(FIXTURES).unwrap().object().unwrap();
    let cases = fixtures["requests"].array().unwrap();
    let wire = fixtures["sse"].string().unwrap();
    for split in 0..=wire.len() {
        for (i, r) in fixture_requests().into_iter().enumerate() {
            let (http, counts) = http(vec![
                wire.as_bytes()[..split].to_vec(),
                wire.as_bytes()[split..].to_vec(),
            ]);
            let auth = auth();
            let mut stream = ready(synthesize(
                r,
                Options {
                    auth: Some(&auth),
                    transport: Some(&http),
                    base_url: Some("https://proxy.test/path%2Fraw?tenant=a%2Bb"),
                    ..Default::default()
                },
            ))
            .unwrap();
            assert_eq!(
                collect(&mut stream).unwrap(),
                vec![
                    Item::Bytes(vec![0, 255, 128]),
                    Item::Bytes(vec![1, 2]),
                    Item::Done
                ]
            );
            assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
            let requests = http.requests.lock().unwrap();
            assert_eq!(requests.len(), 1);
            assert_eq!(
                requests[0].url,
                "https://proxy.test/path%2Fraw/waves/v1/tts/live?tenant=a%2Bb"
            );
            assert_eq!(requests[0].method, "POST");
            assert_eq!(
                value(std::str::from_utf8(&requests[0].body).unwrap()),
                fixture(cases[i].object().unwrap()["body"])
            );
            let mut headers = vec![("Authorization".to_owned(), "Bearer fixture".to_owned())];
            if i == 2 {
                headers.push(("x-expire-content".into(), "true".into()));
            }
            headers.extend([
                ("Content-Type".into(), "application/json".into()),
                ("Accept".into(), "text/event-stream".into()),
            ]);
            assert_eq!(requests[0].headers, headers);
        }
    }
}
#[test]
fn whole_text_uses_ecmascript_whitespace_and_unicode_bounds() {
    for (original, expected) in [
        ("\u{feff} hello\u{3000}", "hello"),
        ("\u{85}hello\u{85}", "\u{85}hello\u{85}"),
        ("\u{1c}hello\u{1c}", "\u{1c}hello\u{1c}"),
    ] {
        let mut r = request();
        r.text = original.into();
        let mut r = TtsRequest::LightningV31TextVoice5e2ae2e5(r);
        settings::trim(&mut r);
        let _ = validate_request(&r).unwrap();
        let TtsRequest::LightningV31TextVoice5e2ae2e5(r) = r else {
            panic!()
        };
        assert_eq!(r.text, expected);
    }
    for (size, valid) in [(8000, true), (8001, false)] {
        let mut r = request();
        r.text = "🚀".repeat(size);
        assert_eq!(
            validate_request(&TtsRequest::LightningV31TextVoice5e2ae2e5(r)).is_ok(),
            valid
        );
    }
    let mut r = request();
    r.text = "\u{feff} \u{3000}".into();
    let error = ready(synthesize(
        TtsRequest::LightningV31TextVoice5e2ae2e5(r),
        Options::default(),
    ))
    .err()
    .unwrap();
    assert_eq!(error.to_string(), "Invalid smallest.ai TTS request");
}
#[test]
fn shared_invalid_frames_and_strict_native_errors() {
    let fixture = Raw::parse_exact(FIXTURES).unwrap().object().unwrap();
    for case in fixture["invalidFrames"].array().unwrap() {
        let case = case.object().unwrap();
        assert_eq!(
            protocol::decode(&case["wire"].string().unwrap())
                .err()
                .unwrap()
                .to_string(),
            case["error"].string().unwrap()
        );
    }
    for wire in [
        r#"{"status":"error","message":"failure","code":"native"}"#,
        r#"{"status":"error","error":{"message":"failure","code":"native"}}"#,
    ] {
        let error = protocol::decode(wire).err().unwrap();
        assert_eq!(
            error.downcast_ref::<Error>().unwrap(),
            &Error {
                message: "failure".into(),
                status: None,
                code: Some("native".into())
            }
        );
    }
    for wire in [
        r#"{"status":"error","error":null}"#,
        r#"{"status":"error","message":"failure","code":1}"#,
    ] {
        assert_eq!(
            protocol::decode(wire).err().unwrap().to_string(),
            "Invalid Smallest.ai error response"
        );
    }
}
#[test]
fn sse_rejects_incomplete_malformed_and_empty_success() {
    for (wire, want) in [
        (
            "data: {\"status\":\"206\",\"done\":false,\"audio\":\"AA==\"}\n\n",
            "Smallest.ai SSE ended before completion",
        ),
        (
            "data: {\"status\":\"200\",\"done\":true,\"audio\":\"AA==\"}",
            "Smallest.ai SSE ended before completion",
        ),
        (
            "data: {\"status\":200,\"done\":true}\n\n",
            "Invalid Smallest.ai SSE status",
        ),
        (
            "data: {\"status\":\"200\",\"done\":false}\n\n",
            "Invalid Smallest.ai SSE status",
        ),
        (
            "data: {\"status\":\"206\",\"done\":true}\n\n",
            "Invalid Smallest.ai SSE status",
        ),
        (
            "data: {\"status\":\"206\",\"done\":false}\n\n",
            "Smallest.ai SSE chunk omitted audio",
        ),
        (
            "data: {\"status\":\"200\",\"done\":true}\n\n",
            "Smallest.ai returned no audio",
        ),
        (
            "data: {\"status\":\"200\",\"done\":true,\"audio\":\"AB==\"}\n\n",
            "Invalid Smallest.ai base64 audio",
        ),
        (
            "event: error\ndata: {\"message\":\"secret\"}\n\n",
            "Smallest.ai SSE returned an error",
        ),
        (
            "data: {\"error\":\"secret\"}\n\n",
            "Smallest.ai SSE returned an error",
        ),
    ] {
        let (http, counts) = http(vec![wire.as_bytes().to_vec()]);
        let auth = auth();
        let mut stream = ready(synthesize(
            whole(),
            Options {
                auth: Some(&auth),
                transport: Some(&http),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(collect(&mut stream).unwrap_err().to_string(), want);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert!(pull(&mut stream).is_none());
    }
}

#[test]
fn every_codec_and_independent_rate_use_binary_http() {
    for (format, native) in [
        ("pcm", "pcm"),
        ("wav", "wav"),
        ("mp3", "mp3"),
        ("mulaw", "ulaw"),
        ("alaw", "alaw"),
    ] {
        for hz in [8000, 16000, 24000, 44100] {
            let rate=Some(match hz {
 8000=>TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject1e4e72b8SampleRateHz::Number8000(Default::default()),
 16000=>TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject1e4e72b8SampleRateHz::Number16000(Default::default()),
 24000=>TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject1e4e72b8SampleRateHz::Number24000(Default::default()),
 _=>TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject1e4e72b8SampleRateHz::Number44100(Default::default()),
 });
            let mut r = request();
            r.output = Some(if format == "pcm" || format == "wav" {
                TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutput::Object172ee74a(
                    TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject172ee74a {
                        format: if format == "pcm" {
                            TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject172ee74aFormat::Pcm(Default::default())
                        } else {
                            TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject172ee74aFormat::Wav(Default::default())
                        },
                        sample_rate_hz: rate,
                        byte_order: Some(Default::default()),
                        channel_count: Some(Default::default()),
                        sample_encoding: Some(Default::default()),
                    },
                )
            } else {
                TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutput::Object1e4e72b8(TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject1e4e72b8{
 format:match format{
 "mp3"=>TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject1e4e72b8Format::Mp3(Default::default()),
 "mulaw"=>TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject1e4e72b8Format::Mulaw(Default::default()),
 _=>TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject1e4e72b8Format::Alaw(Default::default()),
 },sample_rate_hz:rate,channel_count:Some(Default::default()),
 })
            });
            let (http, counts) = http(vec![vec![0, 255], vec![128]]);
            let auth = auth();
            let mut stream = ready(synthesize(
                TtsRequest::LightningV31TextVoice5e2ae2e5(r),
                Options {
                    auth: Some(&auth),
                    transport: Some(&http),
                    protocol: Some(Protocol::Http),
                    ..Default::default()
                },
            ))
            .unwrap();
            assert_eq!(
                collect(&mut stream).unwrap(),
                vec![
                    Item::Bytes(vec![0, 255]),
                    Item::Bytes(vec![128]),
                    Item::Done
                ]
            );
            assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
            let requests = http.requests.lock().unwrap();
            let request = &requests[0];
            assert_eq!(request.url, "https://api.smallest.ai/waves/v1/tts");
            assert_eq!(
                request.headers.last().unwrap(),
                &("Accept".into(), "audio/wav".into())
            );
            let wire = Raw::parse_exact(std::str::from_utf8(&request.body).unwrap())
                .unwrap()
                .object()
                .unwrap();
            assert_eq!(wire["output_format"].string().unwrap(), native);
            assert_eq!(wire["sample_rate"].number().unwrap(), hz as f64);
        }
    }
}

#[test]
fn generated_input_validation_keeps_plain_strings_distinct_from_commands() {
    let (source, _, _) = body(vec![], false);
    let r = streaming(source);
    let validate = validate_request(&r).unwrap();
    assert!(validate(&" ".to_owned(), None).is_ok());
    assert_eq!(
        validate(&clear(), None).unwrap_err().to_string(),
        "Invalid smallest.ai TTS input item"
    );
    let (source, _, _) = body(vec![], false);
    let r = continuation(source);
    let validate = validate_request(&r).unwrap();
    assert!(validate(&clear(), None).is_ok());
    assert!(validate(&text(" "), None).is_ok());
    assert_eq!(
        validate(&" ".to_owned(), None).unwrap_err().to_string(),
        "Invalid smallest.ai TTS input item"
    );
}

#[test]
fn generated_request_validation_precedes_io_and_closes_overrides() {
    let auth = auth();
    for speed in [f64::NAN, f64::INFINITY, 0.49, 2.01] {
        let mut r = request();
        r.speed = Some(speed);
        let (socket, state) = socket(false);
        let error = ready(synthesize(
            TtsRequest::LightningV31TextVoice5e2ae2e5(r),
            Options {
                auth: Some(&auth),
                web_socket: Some(socket),
                ..Default::default()
            },
        ))
        .err()
        .unwrap();
        assert_eq!(error.to_string(), "Invalid smallest.ai TTS request");
        assert_eq!(state.lock().unwrap().drops, 1);
        assert_eq!(state.lock().unwrap().sent.len(), 0);
    }
    let (source, counts, _) = body(vec![Ok("hello".to_owned())], false);
    let mut r = streaming(source);
    if let TtsRequest::LightningV31StreamingTextVoiced272850b(v) = &mut r {
        v.max_buffer_delay_ms = Some(1.5);
    }
    let error = ready(synthesize(
        r,
        Options {
            auth: Some(&auth),
            ..Default::default()
        },
    ))
    .err()
    .unwrap();
    assert_eq!(error.to_string(), "Invalid smallest.ai TTS request");
    assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}
