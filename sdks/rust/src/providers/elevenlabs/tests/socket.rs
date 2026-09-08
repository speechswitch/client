use super::*;
mod boundary;
mod failures;
type Handler = Box<dyn FnMut(&mut SocketState, &str) -> Result<(), TransportError> + Send>;
struct SocketState {
    sent: Vec<JsonValue>,
    incoming: VecDeque<Result<Message, TransportError>>,
    reader: Option<Waker>,
    flusher: Option<Waker>,
    blocked: bool,
    context: String,
    handler: Option<Handler>,
}
struct MockSocket {
    state: Arc<Mutex<SocketState>>,
    counts: Arc<Counts>,
}
impl Drop for MockSocket {
    fn drop(&mut self) {
        self.counts.drops.fetch_add(1, Ordering::SeqCst);
    }
}
impl WebSocketLike for MockSocket {
    fn start_send(self: Pin<&mut Self>, message: Message) -> Result<(), TransportError> {
        let Message::Text(text) = message else {
            panic!("nontext write")
        };
        let mut state = self.state.lock().unwrap();
        state.sent.push(parse(&text));
        let result = if let Some(mut handler) = state.handler.take() {
            let result = handler(&mut state, &text);
            state.handler = Some(handler);
            result
        } else {
            automatic(&mut state, &text)
        };
        if let Some(waker) = state.reader.take() {
            waker.wake()
        }
        result
    }
    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), TransportError>> {
        let mut state = self.state.lock().unwrap();
        if state.blocked {
            state.flusher = Some(cx.waker().clone());
            Poll::Pending
        } else {
            Poll::Ready(Ok(()))
        }
    }
    fn poll_receive(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Message, TransportError>>> {
        let mut state = self.state.lock().unwrap();
        if let Some(value) = state.incoming.pop_front() {
            Poll::Ready(Some(value))
        } else {
            state.reader = Some(cx.waker().clone());
            Poll::Pending
        }
    }
}
fn frame(state: &mut SocketState, text: String) {
    state.incoming.push_back(Ok(Message::Text(text)))
}
fn automatic(state: &mut SocketState, text: &str) -> Result<(), TransportError> {
    let fields = Raw::parse_exact(text).unwrap().object().unwrap();
    if fields.contains_key("voice_settings") {
        state.context = fields
            .get("context_id")
            .and_then(|v| v.string().ok())
            .unwrap_or_default();
    } else if fields.contains_key("close_socket") {
        frame(
            state,
            format!(
                "{{\"context_id\":\"{}\",\"audio\":\"AQ==\",\"is_final\":true}}",
                state.context
            ),
        );
    } else if fields.contains_key("inputs")
        || fields
            .get("text")
            .and_then(|v| v.string().ok())
            .is_some_and(|v| !v.is_empty() && v != " ")
    {
        frame(
            state,
            format!(
                "{{\"context_id\":\"{}\",\"audio\":\"AP8=\"}}",
                state.context
            ),
        );
    }
    Ok(())
}
fn socket(counts: &Arc<Counts>) -> (Socket, Arc<Mutex<SocketState>>) {
    let state = Arc::new(Mutex::new(SocketState {
        sent: vec![],
        incoming: VecDeque::new(),
        reader: None,
        flusher: None,
        blocked: false,
        context: String::new(),
        handler: None,
    }));
    (
        Box::pin(MockSocket {
            state: state.clone(),
            counts: counts.clone(),
        }),
        state,
    )
}
fn entropy(bytes: &mut [u8]) -> Result<(), TransportError> {
    bytes.fill(7);
    Ok(())
}
fn text(value: &str) -> Result<settings::Input, TransportError> {
    Ok(settings::Input::String(value.into()))
}
fn dialogue_text(value: &str) -> Result<settings::DialogueInput, TransportError> {
    Ok(settings::DialogueInput::String(value.into()))
}
fn wait(mut predicate: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(3);
    while !predicate() {
        assert!(Instant::now() < deadline, "condition did not become true");
        std::thread::sleep(Duration::from_millis(1));
    }
}

#[test]
fn both_socket_protocols_preserve_text_flush_and_final_audio() {
    for dialogue in [false, true] {
        let input_counts = Arc::new(Counts::default());
        let counts = Arc::new(Counts::default());
        let (socket, state) = socket(&counts);
        let a = auth();
        let r = if dialogue {
            TtsRequest::ElevenV3StreamingTextVoice145c0c5a(fixtures::dialogue(source(
                vec![
                    dialogue_text("Hel"),
                    dialogue_text("lo"),
                    Ok(settings::DialogueInput::Flush(
                        TtsRequestStreamingTextVoice5024de38TextItemFlush {
                            command: Default::default(),
                        },
                    )),
                ],
                &input_counts,
                false,
            )))
        } else {
            TtsRequest::StreamingTextVoice5024de38(fixtures::tts(source(
                vec![
                    text("Hel"),
                    text("lo"),
                    Ok(settings::Input::Flush(
                        TtsRequestStreamingTextVoice5024de38TextItemFlush {
                            command: Default::default(),
                        },
                    )),
                ],
                &input_counts,
                false,
            )))
        };
        let mut stream = ready(synthesize(
            r,
            Options {
                auth: Some(&a),
                web_socket: Some(socket),
                entropy: Some(&entropy),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(input_counts.reads.load(Ordering::SeqCst), 0);
        assert_eq!(
            collect(&mut stream),
            vec![parse("[0,255]"), parse("[0,255]"), parse("[1]")]
        );
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(input_counts.drops.load(Ordering::SeqCst), 1);
        let state = state.lock().unwrap();
        let expected = if dialogue {
            vec![
                parse(r#"{"voice_settings":{},"xi_api_key":"test-key","voices":["custom/id"]}"#),
                parse(r#"{"inputs":[{"text":"Hel","voice_id":"custom/id"}]}"#),
                parse(r#"{"inputs":[{"text":"lo","voice_id":"custom/id"}]}"#),
                parse(r#"{"flush":true}"#),
                parse(r#"{"close_socket":true}"#),
            ]
        } else {
            let id = &state.context;
            vec![parse(&format!("{{\"voice_settings\":{{}},\"xi_api_key\":\"test-key\",\"generation_config\":{{\"chunk_length_schedule\":[120,160,250,290]}},\"text\":\" \",\"context_id\":\"{id}\"}}")),parse(&format!("{{\"text\":\"Hel\",\"context_id\":\"{id}\"}}")),parse(&format!("{{\"text\":\"lo\",\"context_id\":\"{id}\"}}")),parse(&format!("{{\"text\":\" \",\"flush\":true,\"context_id\":\"{id}\"}}")),parse(&format!("{{\"text\":\" \",\"flush\":true,\"context_id\":\"{id}\"}}")),parse(r#"{"close_socket":true}"#)]
        };
        assert_eq!(state.sent, expected);
    }
}
#[test]
fn clear_retires_old_audio_final_and_errors() {
    let inputs = Arc::new(Counts::default());
    let counts = Arc::new(Counts::default());
    let (socket, state) = socket(&counts);
    let a = auth();
    state.lock().unwrap().handler = Some(Box::new(|state, text| {
        let fields = Raw::parse_exact(text).unwrap().object().unwrap();
        if fields.contains_key("close_context") {
            let id = fields["context_id"].string().unwrap();
            for extra in [
                r#""audio":"AQ==""#,
                r#""isFinal":true"#,
                r#""error":"late","code":500"#,
            ] {
                frame(state, format!("{{\"contextId\":\"{id}\",{extra}}}"));
            }
            Ok(())
        } else if fields.get("text").and_then(|v| v.string().ok()).as_deref() == Some("old") {
            Ok(())
        } else {
            automatic(state, text)
        }
    }));
    let r = fixtures::tts(source(
        vec![
            text("old"),
            Ok(settings::Input::Clear(
                TtsRequestStreamingTextVoice5024de38TextItemClear {
                    command: Default::default(),
                },
            )),
            text("new"),
        ],
        &inputs,
        false,
    ));
    let mut stream = ready(synthesize(
        TtsRequest::StreamingTextVoice5024de38(r),
        Options {
            auth: Some(&a),
            web_socket: Some(socket),
            entropy: Some(&entropy),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        collect(&mut stream),
        vec![
            parse(r#"{"event":"clear"}"#),
            parse("[0,255]"),
            parse("[1]")
        ]
    );
    let state = state.lock().unwrap();
    assert_eq!(state.context, format!("{}:1", "07".repeat(16)));
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(inputs.drops.load(Ordering::SeqCst), 1);
}
#[test]
fn blocked_write_does_not_block_audio_or_prefetch() {
    let inputs = Arc::new(Counts::default());
    let counts = Arc::new(Counts::default());
    let (socket, state) = socket(&counts);
    let a = auth();
    state.lock().unwrap().handler = Some(Box::new(|state, text| {
        automatic(state, text)?;
        let f = Raw::parse_exact(text).unwrap().object().unwrap();
        if f.get("text").and_then(|v| v.string().ok()).as_deref() == Some("hi") {
            state.blocked = true;
        }
        Ok(())
    }));
    let mut stream = ready(synthesize(
        TtsRequest::StreamingTextVoice5024de38(fixtures::tts(source(
            vec![text("hi"), text("unread")],
            &inputs,
            false,
        ))),
        Options {
            auth: Some(&a),
            web_socket: Some(socket),
            entropy: Some(&entropy),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(item(next(&mut stream).unwrap().unwrap()), parse("[0,255]"));
    assert_eq!(inputs.reads.load(Ordering::SeqCst), 1);
    drop(stream);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(inputs.drops.load(Ordering::SeqCst), 1);
}
#[test]
fn unread_drop_never_polls_input_or_writes() {
    let inputs = Arc::new(Counts::default());
    let counts = Arc::new(Counts::default());
    let (socket, state) = socket(&counts);
    let a = auth();
    let stream = ready(synthesize(
        TtsRequest::StreamingTextVoice5024de38(fixtures::tts(source(
            vec![text("hi")],
            &inputs,
            false,
        ))),
        Options {
            auth: Some(&a),
            web_socket: Some(socket),
            entropy: Some(&entropy),
            ..Default::default()
        },
    ))
    .unwrap();
    drop(stream);
    assert_eq!(inputs.reads.load(Ordering::SeqCst), 0);
    assert_eq!(inputs.drops.load(Ordering::SeqCst), 1);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(state.lock().unwrap().sent, vec![]);
}
#[test]
fn heartbeat_runs_and_fails_while_consumer_is_idle() {
    for dialogue in [false, true] {
        for fail in [false, true] {
            let inputs = Arc::new(Counts::default());
            let counts = Arc::new(Counts::default());
            let (socket, state) = socket(&counts);
            let ticks = Arc::new(AtomicUsize::new(0));
            let ticks_copy = ticks.clone();
            state.lock().unwrap().handler = Some(Box::new(move |state, text| {
                let f = Raw::parse_exact(text).unwrap().object().unwrap();
                if f.contains_key("keep_alive")
                    || f.get("text").and_then(|v| v.string().ok()).as_deref() == Some("")
                {
                    ticks_copy.fetch_add(1, Ordering::SeqCst);
                    if fail {
                        return Err(failure("heartbeat write"));
                    }
                }
                automatic(state, text)
            }));
            let r = if dialogue {
                TtsRequest::ElevenV3StreamingTextVoice145c0c5a(fixtures::dialogue(source(
                    vec![dialogue_text("hi")],
                    &inputs,
                    true,
                )))
            } else {
                TtsRequest::StreamingTextVoice5024de38(fixtures::tts(source(
                    vec![text("hi")],
                    &inputs,
                    true,
                )))
            };
            let validate = validate_request(&r).unwrap();
            let c = settings::prepare(r);
            let mut stream = Stream::socket(live::Configuration {
                socket,
                text: c.text,
                voice: c.voice,
                settings: r#"{"voice_settings":{}}"#.into(),
                dialogue,
                timed: false,
                normalized: false,
                seed: [7; 16],
                max_message: 1024,
                heartbeat_interval: Duration::from_millis(5),
                validate: Box::new(validate),
            })
            .unwrap();
            assert_eq!(item(next(&mut stream).unwrap().unwrap()), parse("[0,255]"));
            let reads = inputs.reads.load(Ordering::SeqCst);
            wait(|| ticks.load(Ordering::SeqCst) > 0);
            assert_eq!(inputs.reads.load(Ordering::SeqCst), reads);
            if fail {
                wait(|| counts.drops.load(Ordering::SeqCst) == 1);
                assert_eq!(
                    next(&mut stream).unwrap().err().unwrap().to_string(),
                    "heartbeat write"
                )
            }
            drop(stream);
            assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
            assert_eq!(inputs.drops.load(Ordering::SeqCst), 1);
        }
    }
}
#[test]
fn final_context_reinitializes_before_consumer_resumes() {
    let inputs = Arc::new(Counts::default());
    let counts = Arc::new(Counts::default());
    let (socket, state) = socket(&counts);
    let a = auth();
    state.lock().unwrap().handler = Some(Box::new(|state, text| {
        let f = Raw::parse_exact(text).unwrap().object().unwrap();
        if f.get("text").and_then(|v| v.string().ok()).as_deref() == Some("hi") {
            frame(
                state,
                format!(
                    "{{\"context_id\":\"{}\",\"audio\":\"AQ==\",\"is_final\":true}}",
                    state.context
                ),
            );
            Ok(())
        } else {
            automatic(state, text)
        }
    }));
    let mut stream = ready(synthesize(
        TtsRequest::StreamingTextVoice5024de38(fixtures::tts(source(
            vec![text("hi")],
            &inputs,
            true,
        ))),
        Options {
            auth: Some(&a),
            web_socket: Some(socket),
            entropy: Some(&entropy),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(item(next(&mut stream).unwrap().unwrap()), parse("[1]"));
    wait(|| state.lock().unwrap().context == format!("{}:1", "07".repeat(16)));
    drop(stream);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}
