use super::*;

#[derive(Default)]
pub(super) struct SocketState {
    sent: Vec<String>,
    incoming: VecDeque<Result<Message, TransportError>>,
    automatic: bool,
    blocked: Option<String>,
    last: String,
    writing: bool,
    closed: bool,
    send_error: Option<TransportError>,
    trace: Arc<Mutex<Vec<&'static str>>>,
    drops: usize,
}
struct FakeSocket(Arc<Mutex<SocketState>>);
impl Drop for FakeSocket {
    fn drop(&mut self) {
        let mut s = self.0.lock().unwrap();
        s.drops += 1;
        s.trace.lock().unwrap().push("socket");
    }
}
impl WebSocketLike for FakeSocket {
    fn start_send(self: Pin<&mut Self>, message: Message) -> Result<(), TransportError> {
        let mut s = self.0.lock().unwrap();
        assert!(!s.writing, "sent before previous flush finished");
        if let Some(error) = s.send_error.take() {
            return Err(error);
        }
        let Message::Text(text) = message else {
            panic!("expected text");
        };
        let kind = Raw::parse_exact(&text).unwrap().object().unwrap()["type"]
            .string()
            .unwrap();
        s.sent.push(text);
        s.last = kind.clone();
        s.writing = true;
        if s.automatic {
            let reply = match kind.as_str() {
                "setup" => r#"{"type":"ready","request_id":"req"}"#,
                "text" => r#"{"type":"audio","audio":"AP8="}"#,
                "end_of_stream" => r#"{"type":"end_of_stream"}"#,
                _ => panic!("unexpected message"),
            };
            s.incoming.push_back(Ok(Message::Text(reply.into())));
        }
        Ok(())
    }
    fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Result<(), TransportError>> {
        let mut s = self.0.lock().unwrap();
        if s.blocked.as_ref() == Some(&s.last) {
            return Poll::Pending;
        }
        s.writing = false;
        Poll::Ready(Ok(()))
    }
    fn poll_receive(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
    ) -> Poll<Option<Result<Message, TransportError>>> {
        let mut s = self.0.lock().unwrap();
        match s.incoming.pop_front() {
            Some(v) => Poll::Ready(Some(v)),
            None if s.closed => Poll::Ready(None),
            None => Poll::Pending,
        }
    }
}
pub(super) fn socket(state: &Arc<Mutex<SocketState>>) -> Socket {
    Box::pin(FakeSocket(state.clone()))
}
pub(super) fn automatic() -> Arc<Mutex<SocketState>> {
    Arc::new(Mutex::new(SocketState {
        automatic: true,
        ..Default::default()
    }))
}
fn text(value: &str) -> Result<Input, TransportError> {
    Ok(Input::String(value.into()))
}

#[test]
fn input_does_not_wait_for_ready_or_starve_behind_queued_audio() {
    for queued_audio in [false, true] {
        let state = automatic();
        {
            let mut s = state.lock().unwrap();
            s.automatic = false;
            if queued_audio {
                s.incoming.push_back(Ok(Message::Text(
                    r#"{"type":"ready","request_id":"req"}"#.into(),
                )));
                for _ in 0..32 {
                    s.incoming.push_back(Ok(Message::Text(
                        r#"{"type":"audio","audio":"AP8="}"#.into(),
                    )));
                }
            }
        }
        let counts = Arc::new(Counts::default());
        let mut r = request();
        r.text = TtsRequestText::AsyncIterable(source(vec![text("Hello ")], &counts, false));
        let mut stream = ready(synthesize(
            r,
            Options {
                web_socket: Some(socket(&state)),
                ..Default::default()
            },
        ))
        .unwrap();
        if queued_audio {
            for reads in [0, 1] {
                assert_eq!(
                    normalized(next(&mut stream).unwrap().unwrap()),
                    Value::Binary(vec![0, 255])
                );
                assert_eq!(counts.reads.load(Ordering::SeqCst), reads);
            }
            assert_eq!(state.lock().unwrap().sent.len(), 2);
        } else {
            ready(poll_fn(|cx| {
                assert!(Pin::new(&mut stream).poll_next(cx).is_pending());
                if state.lock().unwrap().sent.len() == 3 {
                    Poll::Ready(())
                } else {
                    Poll::Pending
                }
            }));
            assert_eq!(
                state.lock().unwrap().sent[1..]
                    .iter()
                    .map(|v| fixture(Raw::parse_exact(v).unwrap()))
                    .collect::<Vec<_>>(),
                vec![
                    fixture(Raw::parse_exact(r#"{"type":"text","text":"Hello"}"#).unwrap()),
                    fixture(Raw::parse_exact(r#"{"type":"end_of_stream"}"#).unwrap())
                ]
            );
            assert_eq!(counts.reads.load(Ordering::SeqCst), 2);
        }
        drop(stream);
        assert_eq!(state.lock().unwrap().drops, 1);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn shared_socket_settings_and_text_fragments() {
    for (r, raw) in requests()
        .into_iter()
        .zip(fixture_root()["http"].array().unwrap())
    {
        let state = automatic();
        let mut stream = ready(synthesize(
            r,
            Options {
                web_socket: Some(socket(&state)),
                ..Default::default()
            },
        ))
        .unwrap();
        collect(&mut stream).unwrap();
        let s = state.lock().unwrap();
        let mut setup = Raw::parse_exact(&s.sent[0]).unwrap().object().unwrap();
        assert_eq!(setup.remove("type").unwrap().string().unwrap(), "setup");
        assert!(setup.remove("close_ws_on_eos").unwrap().boolean().unwrap());
        assert_eq!(setup.remove("retry_for_s").unwrap().number().unwrap(), 0.0);
        assert_eq!(
            Value::Map(setup.into_iter().map(|(k, v)| (k, fixture(v))).collect()),
            fixture(raw.object().unwrap()["settings"])
        );
        assert_eq!(s.drops, 1);
    }
    let raw = fixture_root()["text"].object().unwrap();
    let items = raw["input"]
        .array()
        .unwrap()
        .into_iter()
        .map(|v| match v.string() {
            Ok(v) => text(&v),
            Err(_) => {
                assert_eq!(v.object().unwrap()["command"].string().unwrap(), "flush");
                Ok(Input::Flush(TtsRequestTextAsyncIterableItemFlush {
                    command: Default::default(),
                }))
            }
        })
        .collect();
    let counts = Arc::new(Counts::default());
    let mut r = request();
    r.text = TtsRequestText::AsyncIterable(source(items, &counts, false));
    let state = automatic();
    let mut stream = ready(synthesize(
        r,
        Options {
            web_socket: Some(socket(&state)),
            ..Default::default()
        },
    ))
    .unwrap();
    collect(&mut stream).unwrap();
    assert_eq!(
        state.lock().unwrap().sent[1..]
            .iter()
            .map(|v| fixture(Raw::parse_exact(v).unwrap()))
            .collect::<Vec<_>>(),
        raw["messages"]
            .array()
            .unwrap()
            .into_iter()
            .map(fixture)
            .collect::<Vec<_>>()
    );
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn shared_socket_timelines_reserved_flush_and_lexicon() {
    let fixtures = fixture_root()["timeline"].array().unwrap();
    let state = automatic();
    {
        let mut s = state.lock().unwrap();
        s.automatic = false;
        s.incoming.push_back(Ok(Message::Text(
            r#"{"type":"ready","request_id":"req"}"#.into(),
        )));
        s.incoming
            .push_back(Ok(Message::Text(r#"{"type":"flushed"}"#.into())));
        for v in &fixtures {
            s.incoming.push_back(Ok(Message::Text(
                v.object().unwrap()["packet"].text().into(),
            )));
        }
    }
    let mut r = request();
    r.timestamp_granularity = Some(Default::default());
    r.lexicon = Some("dictionary".into());
    let mut stream = ready(synthesize(
        r,
        Options {
            web_socket: Some(socket(&state)),
            setup_retry_ms: Some(250),
            ..Default::default()
        },
    ))
    .unwrap();
    for raw in &fixtures {
        assert_eq!(
            normalized(next(&mut stream).unwrap().unwrap()),
            fixture(raw.object().unwrap()["item"])
        );
    }
    let s = state.lock().unwrap();
    let setup = Raw::parse_exact(&s.sent[0]).unwrap().object().unwrap();
    assert_eq!(setup["pronunciation_id"].string().unwrap(), "dictionary");
    assert_eq!(setup["retry_for_s"].number().unwrap(), 0.25);
    drop(s);
    drop(stream);
    assert_eq!(state.lock().unwrap().drops, 1);
}

#[test]
fn stalled_input_or_text_write_never_blocks_audio_and_drop_closes_network_first() {
    for blocked in [None, Some("text")] {
        let counts = Arc::new(Counts::default());
        let trace = Arc::new(Mutex::new(Vec::new()));
        let state = automatic();
        {
            let mut s = state.lock().unwrap();
            s.trace = trace.clone();
            s.blocked = blocked.map(str::to_owned);
        }
        let mut r = request();
        r.text = TtsRequestText::AsyncIterable(Box::pin(Source {
            values: vec![text("Hello ")].into(),
            counts: counts.clone(),
            stall: true,
            trace: trace.clone(),
        }));
        let mut stream = ready(synthesize(
            r,
            Options {
                web_socket: Some(socket(&state)),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(
            normalized(next(&mut stream).unwrap().unwrap()),
            Value::Binary(vec![0, 255])
        );
        let reads = counts.reads.load(Ordering::SeqCst);
        drop(stream);
        assert_eq!(counts.reads.load(Ordering::SeqCst), reads);
        assert_eq!(*trace.lock().unwrap(), vec!["socket", "input"]);
    }
}

#[test]
fn pending_setup_error_and_pending_eos_ack_release_everything() {
    let counts = Arc::new(Counts::default());
    let state = automatic();
    {
        let mut s = state.lock().unwrap();
        s.automatic = false;
        s.blocked = Some("setup".into());
        s.incoming.push_back(Ok(Message::Text(
            r#"{"type":"error","message":"unavailable","code":1013}"#.into(),
        )));
    }
    let mut r = request();
    r.text = TtsRequestText::AsyncIterable(source(vec![text("Hello ")], &counts, true));
    let mut stream = ready(synthesize(
        r,
        Options {
            web_socket: Some(socket(&state)),
            ..Default::default()
        },
    ))
    .unwrap();
    let error = collect(&mut stream).unwrap_err();
    assert_eq!(
        error.downcast_ref::<Error>(),
        Some(&Error {
            message: "unavailable".into(),
            code: Some(1013),
            status: None
        })
    );
    assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(state.lock().unwrap().drops, 1);
    let state = automatic();
    state.lock().unwrap().blocked = Some("end_of_stream".into());
    let mut stream = ready(synthesize(
        request(),
        Options {
            web_socket: Some(socket(&state)),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        collect(&mut stream).unwrap(),
        vec![Value::Binary(vec![0, 255])]
    );
    assert_eq!(state.lock().unwrap().drops, 1);
}

#[test]
fn protocol_order_closure_and_original_errors_are_exact() {
    for (events, expected) in [
        (
            vec![r#"{"type":"audio","audio":"AA=="}"#],
            "Gradium returned output before ready",
        ),
        (
            vec![
                r#"{"type":"ready","request_id":"req"}"#,
                r#"{"type":"ready","request_id":"req"}"#,
            ],
            "Gradium returned duplicate ready",
        ),
        (
            vec![
                r#"{"type":"ready","request_id":"req"}"#,
                r#"{"type":"end_of_stream"}"#,
            ],
            "Gradium completed before the input stream ended",
        ),
    ] {
        let counts = Arc::new(Counts::default());
        let state = automatic();
        {
            let mut s = state.lock().unwrap();
            s.automatic = false;
            s.incoming = events
                .into_iter()
                .map(|v| Ok(Message::Text(v.into())))
                .collect();
        }
        let mut r = request();
        r.text = TtsRequestText::AsyncIterable(source(vec![], &counts, true));
        let mut stream = ready(synthesize(
            r,
            Options {
                web_socket: Some(socket(&state)),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(collect(&mut stream).unwrap_err().to_string(), expected);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(state.lock().unwrap().drops, 1);
    }
    for stage in ["send", "receive", "input"] {
        let error = Box::new(std::io::Error::other(stage));
        let identity = &*error as *const std::io::Error;
        let error: TransportError = error;
        let counts = Arc::new(Counts::default());
        let state = automatic();
        let mut r = request();
        match stage {
            "send" => state.lock().unwrap().send_error = Some(error),
            "receive" => state.lock().unwrap().incoming.push_back(Err(error)),
            _ => r.text = TtsRequestText::AsyncIterable(source(vec![Err(error)], &counts, false)),
        }
        let mut stream = ready(synthesize(
            r,
            Options {
                web_socket: Some(socket(&state)),
                ..Default::default()
            },
        ))
        .unwrap();
        let error = collect(&mut stream).unwrap_err();
        assert_eq!(
            error.downcast_ref::<std::io::Error>().unwrap() as *const _,
            identity
        );
        assert_eq!(state.lock().unwrap().drops, 1);
    }
    for binary in [false, true] {
        let state = automatic();
        {
            let mut s = state.lock().unwrap();
            s.automatic = false;
            s.closed = !binary;
            if binary {
                s.incoming.push_back(Ok(Message::Binary(vec![0])));
            }
        }
        let mut stream = ready(synthesize(
            request(),
            Options {
                web_socket: Some(socket(&state)),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(
            collect(&mut stream).unwrap_err().to_string(),
            if binary {
                "Gradium returned a non-text WebSocket frame"
            } else {
                "Gradium WebSocket closed before end_of_stream"
            }
        );
    }
}

#[test]
fn unread_and_stalled_stream_drop_requires_no_more_polling() {
    for read in [false, true] {
        let counts = Arc::new(Counts::default());
        let state = automatic();
        let mut r = request();
        r.text = TtsRequestText::AsyncIterable(source(vec![], &counts, true));
        let mut stream = ready(synthesize(
            r,
            Options {
                web_socket: Some(socket(&state)),
                ..Default::default()
            },
        ))
        .unwrap();
        if read {
            let waker = Waker::from(Arc::new(Counts::default()));
            let mut cx = Context::from_waker(&waker);
            for _ in 0..8 {
                assert!(Pin::new(&mut stream).poll_next(&mut cx).is_pending());
            }
        }
        let reads = counts.reads.load(Ordering::SeqCst);
        drop(stream);
        assert_eq!(counts.reads.load(Ordering::SeqCst), reads);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(state.lock().unwrap().drops, 1);
    }
}

#[test]
fn text_and_frame_limits_and_inline_flush_are_enforced() {
    for (value, limit, expected) in [
        (
            "Hello ".into(),
            1,
            "Gradium message exceeds max_message_bytes",
        ),
        (
            "x".repeat(1025),
            1024,
            "Gradium text buffer exceeds max_message_bytes",
        ),
        (
            format!("{} ", "\0".repeat(200)),
            1024,
            "Gradium message exceeds max_message_bytes",
        ),
    ] {
        let counts = Arc::new(Counts::default());
        let state = automatic();
        let mut r = request();
        r.text = TtsRequestText::AsyncIterable(source(vec![text(&value)], &counts, false));
        let mut stream = ready(synthesize(
            r,
            Options {
                web_socket: Some(socket(&state)),
                max_message_bytes: limit,
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(collect(&mut stream).unwrap_err().to_string(), expected);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
    let mut buffer = protocol::TextBuffer {
        pending: String::new(),
        limit: 1024,
    };
    assert_eq!(buffer.push("abc<flush>").unwrap(), "abc<flush>");
    assert_eq!(buffer.push("word\u{85}next ").unwrap(), "word\u{85}next");
    assert_eq!(buffer.push("\u{feff}").unwrap(), "");
    let state = automatic();
    state
        .lock()
        .unwrap()
        .incoming
        .push_back(Ok(Message::Text("é".repeat(513))));
    let mut stream = ready(synthesize(
        request(),
        Options {
            web_socket: Some(socket(&state)),
            max_message_bytes: 1024,
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        collect(&mut stream).unwrap_err().to_string(),
        "Gradium message exceeds max_message_bytes"
    );
}
