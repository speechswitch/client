use super::*;

#[test]
fn typed_dialogue_flush_and_generated_item_checks() {
    for (index, invalid) in [(2, false), (6, false), (2, true), (6, true)] {
        let mut request = fixture_request(index, true);
        match &mut request {
            TtsRequest::Octave2StreamingTurns(v) => {
                v.turns = source(if invalid {
                    vec![TurnInput::Text(
                        TtsRequestOctave2TurnsContextBeforeTurnsTurnsItem {
                            speaker: "a".into(),
                            text: "Hi".into(),
                            speed: Some(0.0),
                            trailing_silence_ms: None,
                        },
                    )]
                } else {
                    vec![TurnInput::Flush(
                        TtsRequestOctave1StreamingTextTextItemFlush {
                            command: Default::default(),
                        },
                    )]
                })
            }
            TtsRequest::Octave1StreamingTurns(v) => {
                v.turns = source(if invalid {
                    vec![DirectedTurnInput::Text(
                        TtsRequestOctave1TurnsContextBeforeTurnsTurnsItem {
                            speaker: "a".into(),
                            text: "Hi".into(),
                            instructions: None,
                            speed: Some(0.0),
                            trailing_silence_ms: None,
                        },
                    )]
                } else {
                    vec![DirectedTurnInput::Flush(
                        TtsRequestOctave1StreamingTextTextItemFlush {
                            command: Default::default(),
                        },
                    )]
                })
            }
            _ => unreachable!(),
        }
        let (socket, wire) = socket(true);
        let mut stream = ready(synthesize(
            request,
            Options {
                web_socket: Some(socket),
                ..Default::default()
            },
        ))
        .unwrap();
        if invalid {
            assert_eq!(
                collect(&mut stream).err().unwrap().to_string(),
                "Invalid hume TTS input item:\nturns item[\"speed\"]: expected number >= 0.25\nturns item[\"command\"]: required field"
            );
            assert!(wire.lock().unwrap().sent.is_empty());
        } else {
            assert_eq!(collect(&mut stream).unwrap(), vec![]);
            assert_eq!(
                wire.lock().unwrap().sent,
                vec![r#"{"flush":true}"#, r#"{"close":true}"#]
            );
        }
    }
}

#[test]
fn unread_drop_closes_socket_and_input_without_polling() {
    let counts = Arc::new(Counts::default());
    let input = Box::pin(Source {
        values: VecDeque::new(),
        counts: counts.clone(),
        stall: true,
        trace: Arc::default(),
    });
    let (socket, wire) = socket(false);
    drop(
        ready(synthesize(
            streaming(input),
            Options {
                web_socket: Some(socket),
                ..Default::default()
            },
        ))
        .unwrap(),
    );
    assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(wire.lock().unwrap().closed, 1);
}

#[test]
fn all_streaming_models_match_shared_utterances() {
    let cases = fixtures()["http"].array().unwrap();
    for (i, case) in cases.iter().enumerate() {
        let (socket, wire) = socket(true);
        let mut stream = ready(synthesize(
            fixture_request(i, true),
            Options {
                web_socket: Some(socket),
                ..Default::default()
            },
        ))
        .unwrap();
        let audio = collect(&mut stream).unwrap();
        let utterances = case.object().unwrap()["body"].object().unwrap()["utterances"]
            .array()
            .unwrap();
        assert_eq!(
            audio,
            (0..utterances.len())
                .map(|_| Value::Binary(vec![0, 255]))
                .collect::<Vec<_>>()
        );
        let mut expected = utterances.into_iter().map(fixture).collect::<Vec<_>>();
        expected.push(fixture(Raw::parse_exact(r#"{"close":true}"#).unwrap()));
        let w = wire.lock().unwrap();
        assert_eq!(
            w.sent
                .iter()
                .map(|v| fixture(Raw::parse_exact(v).unwrap()))
                .collect::<Vec<_>>(),
            expected
        );
        assert_eq!(w.closed, 1);
    }
}

#[test]
fn flush_preserves_fragments_without_acknowledgements() {
    let input = source(vec![
        TextInput::String("Hello".into()),
        TextInput::Flush(TtsRequestOctave1StreamingTextTextItemFlush {
            command: Default::default(),
        }),
        TextInput::String(" world".into()),
    ]);
    let (socket, wire) = socket(true);
    let mut stream = ready(synthesize(
        streaming(input),
        Options {
            web_socket: Some(socket),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        collect(&mut stream).unwrap(),
        vec![Value::Binary(vec![0, 255]), Value::Binary(vec![0, 255])]
    );
    let w = wire.lock().unwrap();
    assert_eq!(w.sent.len(), 4);
    assert_eq!(w.sent[1], r#"{"flush":true}"#);
    assert_eq!(
        Raw::parse_exact(&w.sent[2]).unwrap().object().unwrap()["text"]
            .string()
            .unwrap(),
        " world"
    );
}

#[test]
fn timestamp_timelines_and_binary_metadata_are_independent() {
    for metadata in [false, true] {
        let (socket, wire) = socket(true);
        let entries = fixtures()["timeline"].array().unwrap();
        let mut expected = vec![];
        {
            let mut w = wire.lock().unwrap();
            for entry in entries {
                let entry = entry.object().unwrap();
                w.incoming
                    .push_back(Some(Ok(Message::Text(entry["packet"].text().into()))));
                if metadata {
                    expected.push(fixture(entry["item"]));
                }
            }
        }
        // Empty input still sends close; no fake input audio is inserted by the fixture socket.
        let mut stream = ready(synthesize(
            streaming(source(vec![])),
            Options {
                web_socket: Some(socket),
                include_metadata: metadata,
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(collect(&mut stream).unwrap(), expected);
    }
}

#[test]
fn pending_input_or_write_does_not_block_audio_and_drop_closes_socket_first() {
    for writing in [false, true] {
        let trace = Arc::new(Mutex::new(vec![]));
        let counts = Arc::new(Counts::default());
        let input = Box::pin(Source {
            values: if writing {
                vec![Ok(TextInput::String("Hello".into()))].into()
            } else {
                VecDeque::new()
            },
            counts: counts.clone(),
            stall: true,
            trace: trace.clone(),
        });
        let (socket, wire) = socket(false);
        {
            let mut w = wire.lock().unwrap();
            w.writing = writing;
            w.trace = trace.clone();
        }
        let mut stream = ready(synthesize(
            streaming(input),
            Options {
                web_socket: Some(socket),
                ..Default::default()
            },
        ))
        .unwrap();
        let waker = Waker::from(counts.clone());
        let mut cx = Context::from_waker(&waker);
        assert!(Pin::new(&mut stream).poll_next(&mut cx).is_pending());
        wire.lock()
            .unwrap()
            .incoming
            .push_back(Some(Ok(Message::Binary(vec![7]))));
        assert_eq!(
            normalized(next(&mut stream).unwrap().unwrap()),
            Value::Binary(vec![7])
        );
        drop(stream);
        assert_eq!(*trace.lock().unwrap(), vec!["socket", "input"]);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn normal_close_can_complete_before_close_write_drains() {
    let (socket, wire) = socket(true);
    wire.lock().unwrap().writing = true;
    let mut stream = ready(synthesize(
        streaming(source(vec![])),
        Options {
            web_socket: Some(socket),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(collect(&mut stream).unwrap(), vec![]);
    let w = wire.lock().unwrap();
    assert_eq!(w.sent, vec![r#"{"close":true}"#]);
    assert_eq!(w.closed, 1);
}

#[test]
fn early_close_and_binary_json_mode_are_errors() {
    for (message, metadata, expected) in [
        (
            None,
            false,
            "Hume WebSocket closed before the input stream ended",
        ),
        (
            Some(Ok(Message::Binary(vec![1]))),
            true,
            "Hume returned binary audio in JSON mode",
        ),
        (
            Some(Ok(Message::Text(
                r#"{"type":"error","message":"denied"}"#.into(),
            ))),
            false,
            "denied",
        ),
    ] {
        let (socket, wire) = socket(false);
        wire.lock().unwrap().incoming.push_back(message);
        let input = source(vec![TextInput::String("Hello".into())]);
        let mut stream = ready(synthesize(
            streaming(input),
            Options {
                web_socket: Some(socket),
                include_metadata: metadata,
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(collect(&mut stream).err().unwrap().to_string(), expected);
        assert_eq!(wire.lock().unwrap().closed, 1);
        assert!(next(&mut stream).is_none());
    }
}

#[test]
fn original_input_and_socket_errors_survive() {
    for input_error in [false, true] {
        let error = failure("original");
        let address = &*error as *const _ as *const ();
        let (socket, wire) = socket(false);
        let input: StreamingInput<TextInput> = if input_error {
            Box::pin(Source {
                values: vec![Err(error)].into(),
                counts: Arc::default(),
                stall: false,
                trace: Arc::default(),
            })
        } else {
            wire.lock().unwrap().incoming.push_back(Some(Err(error)));
            source(vec![])
        };
        let mut stream = ready(synthesize(
            streaming(input),
            Options {
                web_socket: Some(socket),
                ..Default::default()
            },
        ))
        .unwrap();
        let error = collect(&mut stream).err().unwrap();
        assert_eq!(&*error as *const _ as *const (), address);
        assert_eq!(wire.lock().unwrap().closed, 1);
    }
}

#[test]
fn input_and_message_bounds_are_checked_before_send() {
    for (text, limit, message) in [
        (
            "😀".repeat(2501),
            4 * 1024 * 1024,
            "Hume text must not exceed 5000 characters per utterance",
        ),
        ("Hello".into(), 1, "Hume message exceeds max_message_bytes"),
    ] {
        let (socket, wire) = socket(false);
        let mut stream = ready(synthesize(
            streaming(source(vec![TextInput::String(text)])),
            Options {
                web_socket: Some(socket),
                max_message_bytes: limit,
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(collect(&mut stream).err().unwrap().to_string(), message);
        assert_eq!(wire.lock().unwrap().sent, Vec::<String>::new());
        assert_eq!(wire.lock().unwrap().closed, 1);
    }
}
