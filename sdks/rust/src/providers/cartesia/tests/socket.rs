use super::*;

type Respond = Box<dyn FnMut(&str) -> Vec<Message> + Send>;
#[derive(Default)]
pub(super) struct SocketState {
    sent: Vec<String>,
    incoming: VecDeque<Result<Message, TransportError>>,
    pub(super) respond: Option<Respond>,
    flush_pending: bool,
    send_error: Option<TransportError>,
    flush_error: Option<TransportError>,
    receive_waker: Option<Waker>,
    flush_waker: Option<Waker>,
    receives: usize,
}
struct SocketMock {
    state: Arc<Mutex<SocketState>>,
    counts: Arc<Counts>,
    trace: Trace,
}
impl WebSocketLike for SocketMock {
    fn start_send(self: Pin<&mut Self>, message: Message) -> Result<(), TransportError> {
        let Message::Text(text) = message else {
            panic!("binary input")
        };
        let mut s = self.state.lock().unwrap();
        if let Some(error) = s.send_error.take() {
            return Err(error);
        }
        if let Some(respond) = &mut s.respond {
            let frames = respond(&text);
            s.incoming.extend(frames.into_iter().map(Ok));
        }
        s.sent.push(text);
        if let Some(waker) = s.receive_waker.take() {
            waker.wake();
        }
        Ok(())
    }
    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), TransportError>> {
        let mut s = self.state.lock().unwrap();
        if let Some(error) = s.flush_error.take() {
            return Poll::Ready(Err(error));
        }
        if s.flush_pending {
            s.flush_waker = Some(cx.waker().clone());
            Poll::Pending
        } else {
            Poll::Ready(Ok(()))
        }
    }
    fn poll_receive(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Message, TransportError>>> {
        let mut s = self.state.lock().unwrap();
        s.receives += 1;
        if let Some(value) = s.incoming.pop_front() {
            Poll::Ready(Some(value))
        } else {
            s.receive_waker = Some(cx.waker().clone());
            Poll::Pending
        }
    }
}
impl Drop for SocketMock {
    fn drop(&mut self) {
        self.counts.drops.fetch_add(1, Ordering::SeqCst);
        self.trace.lock().unwrap().push("socket");
    }
}
pub(super) fn socket(
    state: &Arc<Mutex<SocketState>>,
    counts: &Arc<Counts>,
    trace: &Trace,
) -> Socket {
    Box::pin(SocketMock {
        state: state.clone(),
        counts: counts.clone(),
        trace: trace.clone(),
    })
}
fn frame(id: &str, tail: &str) -> Message {
    let mut message = String::from("{\"status_code\":200,\"done\":false,\"context_id\":");
    json::quote(id, &mut message);
    message.push(',');
    message.push_str(tail);
    message.push('}');
    Message::Text(message)
}
pub(super) fn automatic(text: &str) -> Vec<Message> {
    let fields = Raw::parse(text).unwrap().object().unwrap();
    let id = fields["context_id"].string().unwrap();
    if fields.contains_key("cancel") {
        return vec![
            frame(&id, r#""type":"chunk","data":"////""#),
            frame(&id, r#""type":"error","message":"late""#),
            frame(&id, r#""type":"done","done":true"#),
        ];
    }
    if fields["flush"].boolean().unwrap() {
        return vec![frame(
            &id,
            r#""type":"flush_done","flush_done":true,"flush_id":1"#,
        )];
    }
    if !fields["continue"].boolean().unwrap() {
        return vec![frame(&id, r#""type":"done","done":true"#)];
    }
    vec![frame(&id, r#""type":"chunk","data":"AQ==","flush_id":1"#)]
}

#[test]
fn observed_done_rotates_context_without_replaying_text() {
    let trace = Trace::default();
    let counts = Arc::new(Counts::default());
    let socket_counts = Arc::new(Counts::default());
    let state = Arc::new(Mutex::new(SocketState {
        respond: Some(Box::new(|text| {
            let fields = Raw::parse(text).unwrap().object().unwrap();
            let id = fields["context_id"].string().unwrap();
            vec![
                frame(&id, r#""type":"done","done":true"#),
                frame(&id, r#""type":"chunk","data":"AQ==""#),
                frame(&id, r#""type":"error","message":"late""#),
            ]
        })),
        ..Default::default()
    }));
    let input = body(
        vec![
            Ok(settings::Input::String("first".into())),
            Ok(settings::Input::String("second".into())),
        ],
        &counts,
        &trace,
        false,
        "input",
    );
    let mut stream = ready(synthesize(
        TtsRequest::StreamingTextVoice0bf53a99(live(input)),
        Options {
            web_socket: Some(socket(&state, &socket_counts, &trace)),
            entropy: Some(&entropy),
            ..Default::default()
        },
    ))
    .unwrap();
    assert!(next(&mut stream).is_none());
    let state = state.lock().unwrap();
    let messages: Vec<_> = state
        .sent
        .iter()
        .map(|v| Raw::parse(v).unwrap().object().unwrap())
        .collect();
    assert_eq!(messages.len(), 2);
    let mut seed = [0; 16];
    entropy(&mut seed).unwrap();
    let mut ids = ContextIds::new(seed);
    for (message, transcript) in messages.iter().zip(["first", "second"]) {
        assert_eq!(message["context_id"].string().unwrap(), ids.current);
        assert_eq!(message["transcript"].string().unwrap(), transcript);
        assert_eq!(message["continue"].boolean().unwrap(), true);
        ids.advance().unwrap();
    }
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(socket_counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn request_validation_precedes_io_and_wire_limits_release_ownership() {
    for case in ["schema", "limit", "binary", "context", "outgoing", "empty"] {
        let trace = Trace::default();
        let counts = Arc::new(Counts::default());
        let socket_counts = Arc::new(Counts::default());
        let state = Arc::new(Mutex::new(SocketState::default()));
        match case {
            "limit" => state
                .lock()
                .unwrap()
                .incoming
                .push_back(Ok(Message::Text("123456789".into()))),
            "binary" => state
                .lock()
                .unwrap()
                .incoming
                .push_back(Ok(Message::Binary(vec![1]))),
            "context" => state
                .lock()
                .unwrap()
                .incoming
                .push_back(Ok(frame("unknown", r#""type":"chunk","data":"AQ==""#))),
            _ => {}
        }
        let values = if case == "empty" {
            vec![
                Ok(settings::Input::String(String::new())),
                Ok(settings::Input::Flush(
                    TtsRequestStreamingTextVoice0bf53a99TextItemFlush {
                        command: Default::default(),
                    },
                )),
            ]
        } else {
            vec![Ok(settings::Input::String("Hello".into()))]
        };
        let input = body(values, &counts, &trace, false, "input");
        let mut request = live(input);
        if case == "schema" {
            request.speed = Some(f64::NAN);
        }
        let result = ready(synthesize(
            TtsRequest::StreamingTextVoice0bf53a99(request),
            Options {
                web_socket: Some(socket(&state, &socket_counts, &trace)),
                entropy: Some(&entropy),
                max_message_bytes: if case == "limit" || case == "outgoing" {
                    8
                } else {
                    4096
                },
                ..Default::default()
            },
        ));
        if case == "schema" {
            assert_eq!(
                result.err().unwrap().to_string(),
                "Invalid cartesia TTS request"
            );
            assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
            assert_eq!(state.lock().unwrap().receives, 0);
        } else {
            let mut stream = result.unwrap();
            if case == "empty" {
                assert!(next(&mut stream).is_none());
            } else {
                let expected = match case {
                    "limit" | "outgoing" => "Cartesia message exceeds max_message_bytes",
                    "binary" => "Cartesia returned a non-text frame",
                    "context" => "Cartesia returned output for an unexpected context",
                    _ => unreachable!(),
                };
                assert_eq!(
                    next(&mut stream).unwrap().err().unwrap().to_string(),
                    expected
                );
            }
            assert!(next(&mut stream).is_none());
        }
        assert_eq!(state.lock().unwrap().sent.len(), 0);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(socket_counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn clear_flush_retired_contexts_and_native_group_output() {
    let trace = Trace::default();
    let counts = Arc::new(Counts::default());
    let socket_counts = Arc::new(Counts::default());
    let state = Arc::new(Mutex::new(SocketState {
        respond: Some(Box::new(automatic)),
        ..Default::default()
    }));
    let input = body(
        vec![
            Ok(settings::Input::String("before ".into())),
            Ok(settings::Input::Flush(
                TtsRequestStreamingTextVoice0bf53a99TextItemFlush {
                    command: Default::default(),
                },
            )),
            Ok(settings::Input::Clear(
                TtsRequestStreamingTextVoice0bf53a99TextItemClear {
                    command: Default::default(),
                },
            )),
            Ok(settings::Input::String(" after".into())),
        ],
        &counts,
        &trace,
        false,
        "input",
    );
    let mut stream = ready(synthesize(
        TtsRequest::StreamingTextVoice0bf53a99(live(input)),
        Options {
            web_socket: Some(socket(&state, &socket_counts, &trace)),
            entropy: Some(&entropy),
            ..Default::default()
        },
    ))
    .unwrap();
    let mut items = Vec::new();
    while let Some(item) = next(&mut stream) {
        items.push(canonical(item.unwrap()));
    }
    let state = state.lock().unwrap();
    let messages: Vec<_> = state
        .sent
        .iter()
        .map(|v| Raw::parse(v).unwrap().object().unwrap())
        .collect();
    let first = messages[0]["context_id"].string().unwrap();
    let second = messages.last().unwrap()["context_id"].string().unwrap();
    assert_ne!(first, second);
    assert_eq!(
        items,
        vec![
            parse(&format!(
                r#"{{"correlation":"timeline","correlationId":"{first}","inputGroupId":"1","audio":[1],"timestamps":[]}}"#
            )),
            parse(&format!(
                r#"{{"event":"flush","correlationId":"{first}","inputGroupId":"1"}}"#
            )),
            parse(r#"{"event":"clear"}"#),
            parse(&format!(
                r#"{{"correlation":"timeline","correlationId":"{second}","inputGroupId":"1","audio":[1],"timestamps":[]}}"#
            ))
        ]
    );
    let transcripts: Vec<_> = messages
        .iter()
        .map(|v| v.get("transcript").map(|v| v.string().unwrap()))
        .collect();
    assert_eq!(
        transcripts,
        [
            Some("before ".into()),
            Some("".into()),
            None,
            Some(" after".into()),
            Some("".into())
        ]
    );
    assert_eq!(
        parse(&state.sent[2]),
        parse(&format!(r#"{{"context_id":"{first}","cancel":true}}"#))
    );
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(socket_counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn backpressured_write_does_not_block_audio_or_prefetch_input() {
    let trace = Trace::default();
    let counts = Arc::new(Counts::default());
    let socket_counts = Arc::new(Counts::default());
    let state = Arc::new(Mutex::new(SocketState {
        flush_pending: true,
        respond: Some(Box::new(|text| {
            let id = Raw::parse(text).unwrap().object().unwrap()["context_id"]
                .string()
                .unwrap();
            vec![
                frame(&id, r#""type":"chunk","data":"AQ==""#),
                frame(&id, r#""type":"chunk","data":"Ag==""#),
            ]
        })),
        ..Default::default()
    }));
    let input = body(
        vec![
            Ok(settings::Input::String("first".into())),
            Ok(settings::Input::String("later".into())),
        ],
        &counts,
        &trace,
        true,
        "input",
    );
    let mut stream = ready(synthesize(
        TtsRequest::StreamingTextVoice0bf53a99(live(input)),
        Options {
            web_socket: Some(socket(&state, &socket_counts, &trace)),
            entropy: Some(&entropy),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(canonical(next(&mut stream).unwrap().unwrap()), parse("[1]"));
    assert_eq!(canonical(next(&mut stream).unwrap().unwrap()), parse("[2]"));
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    drop(stream);
    assert_eq!(*trace.lock().unwrap(), ["socket", "input"]);
}

#[test]
fn continuous_audio_cannot_starve_clear_or_flush_failure() {
    for failed in [false, true] {
        let trace = Trace::default();
        let counts = Arc::new(Counts::default());
        let socket_counts = Arc::new(Counts::default());
        let original = Arc::new(());
        let state = Arc::new(Mutex::new(SocketState {
            flush_error: if failed {
                Some(marker(&original))
            } else {
                None
            },
            respond: Some(Box::new(|text| {
                let fields = Raw::parse(text).unwrap().object().unwrap();
                if fields.contains_key("cancel") {
                    return Vec::new();
                }
                let id = fields["context_id"].string().unwrap();
                (0..100)
                    .map(|_| frame(&id, r#""type":"chunk","data":"AQ==""#))
                    .collect()
            })),
            ..Default::default()
        }));
        let input = body(
            vec![
                Ok(settings::Input::String("before".into())),
                Ok(settings::Input::Clear(
                    TtsRequestStreamingTextVoice0bf53a99TextItemClear {
                        command: Default::default(),
                    },
                )),
            ],
            &counts,
            &trace,
            true,
            "input",
        );
        let mut stream = ready(synthesize(
            TtsRequest::StreamingTextVoice0bf53a99(live(input)),
            Options {
                web_socket: Some(socket(&state, &socket_counts, &trace)),
                entropy: Some(&entropy),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(canonical(next(&mut stream).unwrap().unwrap()), parse("[1]"));
        if failed {
            same(&next(&mut stream).unwrap().err().unwrap(), &original);
            assert!(next(&mut stream).is_none());
        } else {
            assert_eq!(canonical(next(&mut stream).unwrap().unwrap()), parse("[1]"));
            assert_eq!(
                canonical(next(&mut stream).unwrap().unwrap()),
                parse(r#"{"event":"clear"}"#)
            );
        }
    }
}

#[test]
fn pending_and_unread_drop_release_network_before_input() {
    for read in [false, true] {
        let trace = Trace::default();
        let counts = Arc::new(Counts::default());
        let socket_counts = Arc::new(Counts::default());
        let state = Arc::new(Mutex::new(SocketState::default()));
        let input = body(Vec::new(), &counts, &trace, true, "input");
        let mut stream = ready(synthesize(
            TtsRequest::StreamingTextVoice0bf53a99(live(input)),
            Options {
                web_socket: Some(socket(&state, &socket_counts, &trace)),
                entropy: Some(&entropy),
                ..Default::default()
            },
        ))
        .unwrap();
        if read {
            let waker = Waker::from(counts.clone());
            assert!(Pin::new(&mut stream)
                .poll_next(&mut Context::from_waker(&waker))
                .is_pending());
        }
        assert_eq!(counts.reads.load(Ordering::SeqCst), usize::from(read));
        drop(stream);
        assert_eq!(*trace.lock().unwrap(), ["socket", "input"]);
    }
}

#[test]
fn source_send_receive_errors_retain_identity_and_are_terminal() {
    for stage in ["input", "send", "receive"] {
        let trace = Trace::default();
        let counts = Arc::new(Counts::default());
        let socket_counts = Arc::new(Counts::default());
        let state = Arc::new(Mutex::new(SocketState::default()));
        let original = Arc::new(());
        if stage == "send" {
            state.lock().unwrap().send_error = Some(marker(&original));
        }
        if stage == "receive" {
            state
                .lock()
                .unwrap()
                .incoming
                .push_back(Err(marker(&original)));
        }
        let input = body(
            vec![if stage == "input" {
                Err(marker(&original))
            } else {
                Ok(settings::Input::String("hello".into()))
            }],
            &counts,
            &trace,
            true,
            "input",
        );
        let mut stream = ready(synthesize(
            TtsRequest::StreamingTextVoice0bf53a99(live(input)),
            Options {
                web_socket: Some(socket(&state, &socket_counts, &trace)),
                entropy: Some(&entropy),
                ..Default::default()
            },
        ))
        .unwrap();
        same(&next(&mut stream).unwrap().err().unwrap(), &original);
        assert!(next(&mut stream).is_none());
        assert_eq!(*trace.lock().unwrap(), ["socket", "input"]);
    }
}
