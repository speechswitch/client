use super::*;

#[test]
fn bidirectional_clear_flush_and_terminal_ownership() {
    let (socket, state) = socket(true);
    let input = source(vec![
        Input::String("first".into()),
        Input::Clear(TtsRequestStreamingText12421ea0TextItemClear {
            command: Default::default(),
        }),
        Input::String("replacement".into()),
        Input::Flush(TtsRequestStreamingText12421ea0TextItemFlush {
            command: Default::default(),
        }),
    ]);
    let mut stream = ready(synthesize(
        TtsRequest::StreamingTextVoice9e2e17ce(streaming(input)),
        Options {
            web_socket: Some(socket),
            entropy: Some(&entropy),
            ..Default::default()
        },
    ))
    .unwrap();
    let mut events = vec![];
    while let Some(item) = next(&mut stream) {
        match item.unwrap() {
            SynthesisItem::OrderedOrTimeline(e) => {
                assert_eq!(e.audio, Some(vec![0, 255]));
                assert_eq!(e.correlation.value(), "ordered");
                assert!(e.timestamps.is_empty());
                assert_eq!(e.request_complete.unwrap().value(), true);
                assert_eq!(e.correlation_id.as_deref(), Some("trace"));
                events.push("audio");
            }
            SynthesisItem::Clear(_) => events.push("clear"),
            SynthesisItem::Flush(e) => {
                assert_eq!(e.correlation_id, "flushed");
                assert!(e.input_group_id.is_some());
                events.push("flush");
            }
            SynthesisItem::Done(e) => {
                assert_eq!(e.trace_id.as_deref(), Some("finished"));
                assert!(stream.state.is_none());
                events.push("done");
            }
            SynthesisItem::Bytes(_) => panic!("envelope expected"),
        }
    }
    assert_eq!(events, vec!["audio", "clear", "audio", "flush", "done"]);
    let state = state.lock().unwrap();
    assert_eq!(state.drops, 1);
    let sent: Vec<_> = state
        .sent
        .iter()
        .map(|s| {
            Raw::parse(s).unwrap().object().unwrap()["event"]
                .string()
                .unwrap()
        })
        .collect();
    assert_eq!(
        sent,
        vec![
            "task_start",
            "task_continue",
            "task_cancel",
            "task_continue",
            "task_flush",
            "task_finish"
        ]
    );
    let config = Raw::parse(&state.sent[0]).unwrap().object().unwrap();
    assert_eq!(
        config["session_id"].string().unwrap(),
        "000102030405460788090a0b0c0d0e0f"
    );
    assert!(!config["continuous_sound"].boolean().unwrap());
    assert!(!config["subtitle_enable"].boolean().unwrap());
    assert!(
        !config["voice_setting"].object().unwrap()["english_normalization"]
            .boolean()
            .unwrap()
    );
}

#[test]
fn whitespace_and_utf16_message_boundaries() {
    for (pieces, expected) in [
        (
            vec![" ".into(), "\u{feff}".into(), "Hi".into()],
            vec![" \u{feff}Hi".into()],
        ),
        (
            vec![" ".into(), format!("{}x", "😀".repeat(4999))],
            vec![format!(" {}", "😀".repeat(4999)), "x".into()],
        ),
    ] {
        let (socket, state) = socket(true);
        let input = source(pieces.into_iter().map(Input::String).collect());
        let mut stream = ready(synthesize(
            TtsRequest::StreamingTextVoice9e2e17ce(streaming(input)),
            Options {
                web_socket: Some(socket),
                entropy: Some(&entropy),
                ..Default::default()
            },
        ))
        .unwrap();
        while let Some(item) = next(&mut stream) {
            item.unwrap();
        }
        let sent: Vec<_> = state
            .lock()
            .unwrap()
            .sent
            .iter()
            .filter_map(|s| {
                Raw::parse(s)
                    .unwrap()
                    .object()
                    .unwrap()
                    .get("text")
                    .map(|v| v.string().unwrap())
            })
            .collect();
        assert_eq!(sent, expected);
    }
    let (socket, _) = socket(true);
    let input = source(vec![Input::String("😀".repeat(5000))]);
    let mut stream = ready(synthesize(
        TtsRequest::StreamingTextVoice9e2e17ce(streaming(input)),
        Options {
            web_socket: Some(socket),
            entropy: Some(&entropy),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        next(&mut stream).unwrap().err().unwrap().to_string(),
        "MiniMax text pieces must contain fewer than 10000 UTF-16 code units"
    );
}

#[test]
fn pending_input_or_writes_do_not_block_audio_and_drop() {
    for phase in [
        "input",
        "task_start",
        "task_continue",
        "task_finish",
        "task_cancel",
    ] {
        let (socket, state) = socket(true);
        let trace = Arc::new(Mutex::new(vec![]));
        state.lock().unwrap().trace = trace.clone();
        state.lock().unwrap().stall = if phase == "input" {
            None
        } else {
            Some(phase.into())
        };
        let counts = Arc::new(Counts::default());
        let input = Box::pin(Source {
            values: if phase == "task_cancel" {
                VecDeque::from([Ok(Input::Clear(
                    TtsRequestStreamingText12421ea0TextItemClear {
                        command: Default::default(),
                    },
                ))])
            } else if phase == "task_continue" {
                VecDeque::from([Ok(Input::String("Hi".into()))])
            } else {
                VecDeque::new()
            },
            counts: counts.clone(),
            stall: phase == "input",
            trace: trace.clone(),
        });
        let mut stream = ready(synthesize(
            TtsRequest::StreamingTextVoice9e2e17ce(streaming(input)),
            Options {
                web_socket: Some(socket),
                entropy: Some(&entropy),
                ..Default::default()
            },
        ))
        .unwrap();
        let waker = Waker::from(Arc::new(Counts::default()));
        let mut cx = Context::from_waker(&waker);
        let mut audio = false;
        for _ in 0..30 {
            if let Poll::Ready(Some(item)) = Pin::new(&mut stream).poll_next(&mut cx) {
                match item.unwrap() {
                    SynthesisItem::OrderedOrTimeline(_) => audio = true,
                    SynthesisItem::Clear(_) => {}
                    _ => panic!("completed while blocked"),
                }
            }
        }
        assert_eq!(audio, phase == "task_continue");
        if phase == "task_start" {
            assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        }
        drop(stream);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(state.lock().unwrap().drops, 1);
        assert_eq!(*trace.lock().unwrap(), vec!["socket", "input"]);
    }
}

#[test]
fn unread_stream_drops_input_without_starting_and_failed_finish_wins() {
    let (socket, state) = socket(true);
    let counts = Arc::new(Counts::default());
    let input = Box::pin(Source::<Input> {
        values: VecDeque::new(),
        counts: counts.clone(),
        stall: false,
        trace: Arc::default(),
    });
    let stream = ready(synthesize(
        TtsRequest::StreamingTextVoice9e2e17ce(streaming(input)),
        Options {
            web_socket: Some(socket),
            entropy: Some(&entropy),
            ..Default::default()
        },
    ))
    .unwrap();
    drop(stream);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert!(state.lock().unwrap().sent.is_empty());
    let (socket, state) = super::socket(true);
    state.lock().unwrap().flush_error = Some("task_finish".into());
    let mut stream = ready(synthesize(
        TtsRequest::StreamingTextVoice9e2e17ce(streaming(source(vec![]))),
        Options {
            web_socket: Some(socket),
            entropy: Some(&entropy),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        next(&mut stream).unwrap().err().unwrap().to_string(),
        "write failure"
    );
    assert!(stream.state.is_none());
}

#[test]
fn producer_error_interrupts_pending_cancel_ack() {
    let (socket, state) = socket(true);
    state.lock().unwrap().cancel_ack = false;
    let input = Box::pin(Source {
        values: VecDeque::from([
            Ok(Input::Clear(TtsRequestStreamingText12421ea0TextItemClear {
                command: Default::default(),
            })),
            Err(failure("producer failure")),
        ]),
        counts: Arc::default(),
        stall: false,
        trace: Arc::default(),
    });
    let mut stream = ready(synthesize(
        TtsRequest::StreamingTextVoice9e2e17ce(streaming(input)),
        Options {
            web_socket: Some(socket),
            entropy: Some(&entropy),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        next(&mut stream).unwrap().err().unwrap().to_string(),
        "producer failure"
    );
    assert_eq!(state.lock().unwrap().drops, 1);
}

#[test]
fn native_errors_and_correlation_failures_are_terminal() {
    for (packet, error) in [
        (
            r#"{"event":"task_finished"}"#,
            "MiniMax ended the session before task_finish",
        ),
        (
            r#"{"event":"task_canceled"}"#,
            "MiniMax returned an unsolicited cancel acknowledgement",
        ),
        (
            r#"{"session_id":"other","data":{"audio":"00"}}"#,
            "MiniMax returned an unexpected session ID",
        ),
        (
            r#"{"connect_id":"other","data":{"audio":"00"}}"#,
            "MiniMax returned an unexpected connection ID",
        ),
    ] {
        let (socket, state) = socket(true);
        let counts = Arc::new(Counts::default());
        let input = Box::pin(Source::<Input> {
            values: VecDeque::new(),
            counts: counts.clone(),
            stall: true,
            trace: Arc::default(),
        });
        let mut stream = ready(synthesize(
            TtsRequest::StreamingTextVoice9e2e17ce(streaming(input)),
            Options {
                web_socket: Some(socket),
                entropy: Some(&entropy),
                ..Default::default()
            },
        ))
        .unwrap();
        let waker = Waker::from(Arc::new(Counts::default()));
        let mut cx = Context::from_waker(&waker);
        for _ in 0..8 {
            assert!(Pin::new(&mut stream).poll_next(&mut cx).is_pending());
        }
        assert!(counts.reads.load(Ordering::SeqCst) > 0);
        state
            .lock()
            .unwrap()
            .incoming
            .push_back(Ok(Message::Text(packet.into())));
        assert_eq!(next(&mut stream).unwrap().err().unwrap().to_string(), error);
        assert!(stream.state.is_none());
        assert_eq!(state.lock().unwrap().drops, 1);
    }
    for code in [2204, 2205] {
        let (socket, state) = socket(false);
        state.lock().unwrap().incoming=VecDeque::from([Ok(Message::Text(format!("{{\"base_resp\":{{\"status_code\":{code},\"status_msg\":\"queue\"}},\"data\":null,\"extra_info\":\"unavailable\"}}")))]);
        let mut stream = ready(synthesize(
            TtsRequest::StreamingTextVoice9e2e17ce(streaming(source(vec![]))),
            Options {
                web_socket: Some(socket),
                entropy: Some(&entropy),
                ..Default::default()
            },
        ))
        .unwrap();
        let error = next(&mut stream).unwrap().err().unwrap();
        assert_eq!(
            *error.downcast_ref::<Error>().unwrap(),
            Error {
                message: "queue".into(),
                code: Some(code),
                status: None,
                retry_after: None
            }
        );
        assert!(state.lock().unwrap().sent.is_empty());
    }
}

#[test]
fn handshake_message_shape_and_limits_do_not_acquire_input() {
    for (message, limit, error) in [
        (
            Message::Text(r#"{"event":"wrong"}"#.into()),
            1024,
            "MiniMax did not acknowledge the connection",
        ),
        (
            Message::Binary(vec![0]),
            1024,
            "MiniMax WebSocket messages must be JSON text",
        ),
        (
            Message::Text("long".into()),
            2,
            "MiniMax message exceeds max_message_bytes",
        ),
    ] {
        let (socket, state) = socket(false);
        state.lock().unwrap().incoming = VecDeque::from([Ok(message)]);
        let counts = Arc::new(Counts::default());
        let input = Box::pin(Source::<Input> {
            values: VecDeque::new(),
            counts: counts.clone(),
            stall: false,
            trace: Arc::default(),
        });
        let mut stream = ready(synthesize(
            TtsRequest::StreamingTextVoice9e2e17ce(streaming(input)),
            Options {
                web_socket: Some(socket),
                entropy: Some(&entropy),
                max_message_bytes: limit,
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(next(&mut stream).unwrap().err().unwrap().to_string(), error);
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn sentence_boundaries_do_not_become_guessed_timestamps() {
    let (socket, state) = socket(true);
    let input = Box::pin(Source::<Input> {
        values: VecDeque::new(),
        counts: Arc::default(),
        stall: true,
        trace: Arc::default(),
    });
    let mut stream = ready(synthesize(
        TtsRequest::StreamingTextVoice9e2e17ce(streaming(input)),
        Options {
            web_socket: Some(socket),
            entropy: Some(&entropy),
            ..Default::default()
        },
    ))
    .unwrap();
    let waker = Waker::from(Arc::new(Counts::default()));
    let mut cx = Context::from_waker(&waker);
    for _ in 0..8 {
        assert!(Pin::new(&mut stream).poll_next(&mut cx).is_pending());
    }
    for (event, expected) in [("sentence_start", "start"), ("sentence_end", "end")] {
        state
            .lock()
            .unwrap()
            .incoming
            .push_back(Ok(Message::Text(format!(
                "{{\"event\":\"{event}\",\"trace_id\":\"trace\"}}"
            ))));
        let SynthesisItem::OrderedOrTimeline(e) = next(&mut stream).unwrap().unwrap() else {
            panic!("envelope")
        };
        assert_eq!(e.sentence_boundary.unwrap().value(), expected);
        assert!(e.request_complete.is_none());
        assert!(e.timestamps.is_empty());
        assert!(e.audio.is_none());
        assert_eq!(e.trace_id.as_deref(), Some("trace"));
    }
}
