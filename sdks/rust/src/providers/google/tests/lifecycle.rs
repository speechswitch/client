use super::*;
use crate::{http2::InputClosed, runtime::ValidationError};

#[test]
fn http_splits_empty_chunks_and_drop_ownership() {
    let bytes = br#"{"audioContent":"AP8B"}"#;
    for split in 0..=bytes.len() {
        let counts = Arc::new(Counts::default());
        let http = http(
            200,
            source(
                vec![
                    Ok(bytes[..split].to_vec()),
                    Ok(vec![]),
                    Ok(bytes[split..].to_vec()),
                ],
                &counts,
                false,
            ),
        );
        let mut stream = ready(synthesize(
            TtsRequest::TextVoice(whole()),
            Options {
                auth: Some(&auth()),
                transport: Some(&http),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        assert_eq!(next(&mut stream).unwrap().unwrap(), vec![0, 255, 1]);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert!(next(&mut stream).is_none());
    }
    for poll in [false, true] {
        let counts = Arc::new(Counts::default());
        let http = http(200, source(vec![], &counts, true));
        let mut stream = ready(synthesize(
            TtsRequest::TextVoice(whole()),
            Options {
                auth: Some(&auth()),
                transport: Some(&http),
                ..Default::default()
            },
        ))
        .unwrap();
        if poll {
            pending(&mut stream);
        }
        drop(stream);
        assert_eq!(counts.reads.load(Ordering::SeqCst), usize::from(poll));
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn http_errors_are_exact_bounded_and_terminal() {
    for (status, body, limit, expected) in [
        (
            200,
            b"{}".to_vec(),
            1024,
            Error::Invalid("Google returned an invalid synthesis response"),
        ),
        (
            200,
            br#"{"audioContent":null}"#.to_vec(),
            1024,
            Error::Invalid("Google returned an invalid synthesis response"),
        ),
        (
            200,
            br#"{"audioContent":"!"}"#.to_vec(),
            1024,
            Error::Invalid("Google returned an invalid synthesis response"),
        ),
        (
            200,
            br#"{"audioContent":"AQ==\n"}"#.to_vec(),
            1024,
            Error::Invalid("Google returned an invalid synthesis response"),
        ),
        (
            200,
            b"\xff".to_vec(),
            1024,
            Error::Invalid("Google returned an invalid synthesis response"),
        ),
        (
            200,
            br#"{"audioContent":""} garbage"#.to_vec(),
            1024,
            Error::Invalid("Google returned an invalid synthesis response"),
        ),
        (
            200,
            br#"{"audioContent":"AQ=="}"#.to_vec(),
            2,
            Error::Invalid("Google response exceeds max_json_bytes"),
        ),
        (
            403,
            br#"{"error":{"message":"denied"}}"#.to_vec(),
            1024,
            Error::Http {
                status: 403,
                message: "denied".into(),
            },
        ),
        (
            502,
            b"\xef\xbb\xbfupstream \xff".to_vec(),
            1024,
            Error::Http {
                status: 502,
                message: "upstream �".into(),
            },
        ),
        (
            500,
            vec![1, 2, 3],
            2,
            Error::Invalid("Google response exceeds max_json_bytes"),
        ),
    ] {
        let counts = Arc::new(Counts::default());
        let http = http(status, source(vec![Ok(body)], &counts, false));
        let mut stream = ready(synthesize(
            TtsRequest::TextVoice(whole()),
            Options {
                auth: Some(&auth()),
                transport: Some(&http),
                max_json_bytes: limit,
                ..Default::default()
            },
        ))
        .unwrap();
        let error = next(&mut stream).unwrap().unwrap_err();
        assert_eq!(error.downcast_ref::<Error>(), Some(&expected));
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert!(next(&mut stream).is_none());
    }
    let counts = Arc::new(Counts::default());
    let http = http(
        200,
        source(vec![Ok(br#"{"audioContent":""}"#.to_vec())], &counts, false),
    );
    let mut stream = ready(synthesize(
        TtsRequest::TextVoice(whole()),
        Options {
            auth: Some(&auth()),
            transport: Some(&http),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(collect(&mut stream).unwrap(), vec![Vec::<u8>::new()]);
}

#[test]
fn output_progresses_while_writes_and_input_are_stalled() {
    for stall_flush in [false, true] {
        let counts = Arc::new(Counts::default());
        let state = Arc::new(Mutex::new(CallState {
            stall_flush,
            incoming: vec![Ok(vec![10, 2, 0, 255])].into(),
            ..Default::default()
        }));
        let mut stream = grpc_stream(streaming(source(vec![], &counts, true)), &state);
        assert_eq!(next(&mut stream).unwrap().unwrap(), vec![0, 255]);
        pending(&mut stream);
        assert!(!state.lock().unwrap().ended);
        drop(stream);
        assert_eq!(state.lock().unwrap().drops, 1);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn prompt_only_first_input_and_empty_audio_is_not_eof() {
    let counts = Arc::new(Counts::default());
    let TtsRequest::Object7d956f3d(mut request) = streaming(source(
        vec![Ok("one".into()), Ok("two".into())],
        &counts,
        false,
    )) else {
        panic!()
    };
    request.instructions = Some("warm".into());
    let state = Arc::new(Mutex::new(CallState {
        incoming: vec![Ok(vec![]), Ok(vec![10, 0]), Ok(vec![10, 1, 255])].into(),
        ..Default::default()
    }));
    let mut stream = grpc_stream(TtsRequest::Object7d956f3d(request), &state);
    assert_eq!(collect(&mut stream).unwrap(), vec![vec![], vec![255]]);
    let state = state.lock().unwrap();
    assert_eq!(state.messages.len(), 3);
    assert_eq!(hex(&state.messages[1]), "120b0a036f6e6532047761726d");
    assert_eq!(hex(&state.messages[2]), "12050a0374776f");
    assert!(state.ended);
    assert_eq!(state.drops, 1);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn input_closed_drains_real_status_instead_of_hiding_it() {
    for stage in ["send", "flush", "end"] {
        let counts = Arc::new(Counts::default());
        let mut initial = CallState::default();
        match stage {
            "send" => initial.send_error = Some(InputClosed.into()),
            "flush" => initial.flush_error = Some(InputClosed.into()),
            _ => initial.end_error = Some(InputClosed.into()),
        }
        let state = Arc::new(Mutex::new(initial));
        let mut stream = grpc_stream(
            streaming(source(vec![Ok("hello".into())], &counts, false)),
            &state,
        );
        pending(&mut stream);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        let expected = grpc::Error::Status {
            code: 7,
            message: "denied".into(),
        };
        state
            .lock()
            .unwrap()
            .incoming
            .push_back(Err(expected.clone().into()));
        let error = next(&mut stream).unwrap().unwrap_err();
        assert_eq!(error.downcast_ref::<grpc::Error>(), Some(&expected));
        assert_eq!(state.lock().unwrap().drops, 1);
        assert!(next(&mut stream).is_none());
    }
}

#[test]
fn premature_success_is_an_error_but_pending_end_flush_is_allowed() {
    let counts = Arc::new(Counts::default());
    let state = Arc::new(Mutex::new(CallState {
        early_eof: true,
        ..Default::default()
    }));
    let mut stream = grpc_stream(streaming(source(vec![], &counts, true)), &state);
    assert_eq!(
        next(&mut stream).unwrap().unwrap_err().to_string(),
        "Google gRPC ended before input completed"
    );
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);

    // A peer can acknowledge END_STREAM before the caller's next flush poll.
    let state = Arc::new(Mutex::new(CallState::default()));
    let mut request = whole();
    request.output = TtsRequestChirp3HdTextVoicebb77af5cOutput::Pcm(pcm());
    let mut stream = grpc_stream(TtsRequest::TextVoice(request), &state);
    assert_eq!(collect(&mut stream).unwrap(), Vec::<Vec<u8>>::new());
    assert!(state.lock().unwrap().ended);
}

#[derive(Debug)]
struct Original(Arc<()>);
impl std::fmt::Display for Original {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("original")
    }
}
impl std::error::Error for Original {}
#[test]
fn original_transport_and_producer_errors_keep_identity_and_cleanup() {
    for stage in ["body", "input", "send", "flush", "end", "receive"] {
        let identity = Arc::new(());
        let error: TransportError = Box::new(Original(identity.clone()));
        let counts = Arc::new(Counts::default());
        let state = Arc::new(Mutex::new(CallState::default()));
        let mut stream = if stage == "body" {
            let http = http(200, source(vec![Err(error)], &counts, false));
            ready(synthesize(
                TtsRequest::TextVoice(whole()),
                Options {
                    auth: Some(&auth()),
                    transport: Some(&http),
                    ..Default::default()
                },
            ))
            .unwrap()
        } else {
            let items = if stage == "input" {
                vec![Err(error)]
            } else {
                let mut s = state.lock().unwrap();
                match stage {
                    "send" => s.send_error = Some(error),
                    "flush" => s.flush_error = Some(error),
                    "end" => s.end_error = Some(error),
                    _ => s.incoming.push_back(Err(error)),
                }
                vec![Ok("hello".into())]
            };
            grpc_stream(streaming(source(items, &counts, false)), &state)
        };
        let error = next(&mut stream).unwrap().unwrap_err();
        assert!(Arc::ptr_eq(
            &error.downcast_ref::<Original>().unwrap().0,
            &identity
        ));
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert!(next(&mut stream).is_none());
        if stage != "body" {
            assert_eq!(state.lock().unwrap().drops, 1);
        }
    }
}

#[test]
fn schema_validation_and_byte_limits_precede_io() {
    for (request, expected) in {
        let mut rate = whole();
        rate.output = TtsRequestChirp3HdTextVoicebb77af5cOutput::Wav(
            TtsRequestChirp3HdTextVoicebb77af5cOutputWav {
                sample_rate_hz: Some(24000.5),
                ..wav()
            },
        );
        let mut speed = whole();
        speed.speed = Some(f64::NAN);
        let mut text = whole();
        text.text = "é".repeat(2001);
        let mut prompt = whole();
        prompt.instructions = Some("é".repeat(2001));
        [
            (rate, "Invalid google TTS request"),
            (speed, "Invalid google TTS request"),
            (text, "Google input exceeds 4000 UTF-8 bytes"),
            (prompt, "Google input exceeds 4000 UTF-8 bytes"),
        ]
    } {
        let http = http(200, source(vec![], &Arc::default(), false));
        let error = ready(synthesize(
            TtsRequest::TextVoice(request),
            Options {
                transport: Some(&http),
                ..Default::default()
            },
        ))
        .err()
        .unwrap();
        assert_eq!(error.to_string(), expected);
        assert!(http.request.lock().unwrap().is_none());
    }
    let counts = Arc::new(Counts::default());
    let state = Arc::new(Mutex::new(CallState::default()));
    let mut stream = grpc_stream(
        streaming(source(vec![Ok("é".repeat(2001))], &counts, false)),
        &state,
    );
    assert_eq!(
        next(&mut stream).unwrap().unwrap_err().to_string(),
        "Google input exceeds 4000 UTF-8 bytes"
    );
    assert_eq!(state.lock().unwrap().messages.len(), 1);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

fn dialogue(input: TtsRequestObject8dbffa0cTurns) -> TtsRequestObject8dbffa0c {
    gemini_fields!(TtsRequestObject8dbffa0c,model:TtsRequestTextModel::Gemini25FlashTts(Default::default()),speakers:speakers(),turns:input,output:TtsRequestChirp3Hda92b414cOutput::Pcm(pcm()))
}
#[test]
fn dialogue_item_guards_and_cross_references_are_distinct() {
    for (speaker, expected, generated) in [
        ("!", "Invalid google TTS input item", true),
        ("Ann", "Unknown Google dialogue speaker: Ann", false),
    ] {
        let counts = Arc::new(Counts::default());
        let state = Arc::new(Mutex::new(CallState::default()));
        let request = dialogue(TtsRequestObject8dbffa0cTurns::AsyncIterable(source(
            vec![Ok(settings::Turn {
                speaker: speaker.into(),
                text: "hello".into(),
            })],
            &counts,
            false,
        )));
        let mut stream = grpc_stream(TtsRequest::Object8dbffa0c(request), &state);
        let error = next(&mut stream).unwrap().unwrap_err();
        assert_eq!(error.to_string(), expected);
        assert_eq!(error.is::<ValidationError>(), generated);
        assert_eq!(state.lock().unwrap().messages.len(), 1);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
    for (mut request, expected) in [
        (
            dialogue(TtsRequestObject8dbffa0cTurns::Array(vec![])),
            "Google dialogue turns must not be empty",
        ),
        (
            dialogue(TtsRequestObject8dbffa0cTurns::Array(vec![settings::Turn {
                speaker: "Ann".into(),
                text: "hello".into(),
            }])),
            "Unknown Google dialogue speaker: Ann",
        ),
        (
            dialogue(TtsRequestObject8dbffa0cTurns::Array(turns())),
            "Google dialogue requires exactly two distinct speaker aliases",
        ),
    ] {
        if expected == "Google dialogue requires exactly two distinct speaker aliases" {
            request.speakers[1].alias = "Sam".into();
        }
        assert_eq!(
            ready(synthesize(
                TtsRequest::Object8dbffa0c(request),
                Options::default()
            ))
            .err()
            .unwrap()
            .to_string(),
            expected
        );
    }
}

#[test]
fn unread_grpc_drop_and_cooperative_empty_output() {
    let counts = Arc::new(Counts::default());
    let state = Arc::new(Mutex::new(CallState::default()));
    drop(grpc_stream(
        streaming(source(vec![], &counts, true)),
        &state,
    ));
    assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(state.lock().unwrap().drops, 1);
    let counts = Arc::new(Counts::default());
    let state = Arc::new(Mutex::new(CallState {
        incoming: (0..100).map(|_| Ok(vec![])).collect(),
        ..Default::default()
    }));
    let mut stream = grpc_stream(streaming(source(vec![], &counts, true)), &state);
    let wakes = Arc::new(Counts::default());
    let waker = Waker::from(wakes.clone());
    assert!(Pin::new(&mut stream)
        .poll_next(&mut Context::from_waker(&waker))
        .is_pending());
    assert_eq!(state.lock().unwrap().receives, 32);
    assert_eq!(wakes.wakes.load(Ordering::SeqCst), 1);
    assert!(counts.reads.load(Ordering::SeqCst) > 0);
}

#[test]
fn grpc_message_limits_cover_opening_input_and_override_responses() {
    for stage in ["opening", "input", "response"] {
        let counts = Arc::new(Counts::default());
        let state = Arc::new(Mutex::new(CallState::default()));
        let text = if stage == "input" {
            "a".repeat(3000)
        } else {
            "hello".into()
        };
        if stage == "response" {
            state.lock().unwrap().incoming.push_back(Ok(vec![0; 2001]));
        }
        let result = ready(synthesize(
            streaming(source(vec![Ok(text)], &counts, false)),
            Options {
                auth: Some(&auth()),
                grpc: Some(call(&state)),
                max_message_bytes: if stage == "opening" { 1 } else { 2000 },
                ..Default::default()
            },
        ));
        let error = match result {
            Err(error) => error,
            Ok(mut stream) => {
                let error = next(&mut stream).unwrap().unwrap_err();
                assert!(next(&mut stream).is_none());
                error
            }
        };
        assert_eq!(
            error.to_string(),
            "Google gRPC message exceeds max_message_bytes"
        );
        assert_eq!(
            state.lock().unwrap().messages.len(),
            usize::from(stage != "opening")
        );
        assert_eq!(state.lock().unwrap().drops, 1);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn repeated_safety_categories_and_aggregate_dialogue_bytes_are_checked() {
    let mut request = whole();
    request.safety_settings = Some(
        (0..2)
            .map(|_| TtsRequestTextSafetySettingsItem {
                category: TtsRequestTextSafetySettingsItemCategory::Harassment(Default::default()),
                threshold: TtsRequestTextSafetySettingsItemThreshold::Off(Default::default()),
            })
            .collect(),
    );
    assert_eq!(
        ready(synthesize(
            TtsRequest::TextVoice(request),
            Options::default()
        ))
        .err()
        .unwrap()
        .to_string(),
        "Google safety categories must be unique"
    );
    let request = dialogue(TtsRequestObject8dbffa0cTurns::Array(vec![
        settings::Turn {
            speaker: "Sam".into(),
            text: "é".repeat(1000),
        },
        settings::Turn {
            speaker: "Bob".into(),
            text: "é".repeat(1001),
        },
    ]));
    assert_eq!(
        ready(synthesize(
            TtsRequest::Object8dbffa0c(request),
            Options::default()
        ))
        .err()
        .unwrap()
        .to_string(),
        "Google input exceeds 4000 UTF-8 bytes"
    );
}

#[test]
fn empty_http_chunks_yield_cooperatively() {
    let counts = Arc::new(Counts::default());
    let http = http(
        200,
        source((0..100).map(|_| Ok(vec![])).collect(), &counts, true),
    );
    let mut stream = ready(synthesize(
        TtsRequest::TextVoice(whole()),
        Options {
            auth: Some(&auth()),
            transport: Some(&http),
            ..Default::default()
        },
    ))
    .unwrap();
    let wakes = Arc::new(Counts::default());
    let waker = Waker::from(wakes.clone());
    assert!(Pin::new(&mut stream)
        .poll_next(&mut Context::from_waker(&waker))
        .is_pending());
    assert_eq!(counts.reads.load(Ordering::SeqCst), 32);
    assert_eq!(wakes.wakes.load(Ordering::SeqCst), 1);
    drop(stream);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}
