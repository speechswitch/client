use super::*;

const READY: &str = r#"{"type":"session.ready","session_id":"saved","run_id":1,"config":{}}"#;
const DONE: &str = r#"{"type":"session.done"}"#;
const START: &str = r#"{"type":"segment.start","segment_id":7,"text":"Hello"}"#;
const END: &str = r#"{"type":"segment.done","segment_id":7}"#;

struct SocketState {
    incoming: VecDeque<Result<Message, TransportError>>,
    on_done: Vec<Message>,
    sent: Vec<String>,
    auto_ready: bool,
    block_settings: bool,
    block_text: bool,
    writing: bool,
    eof: bool,
    drops: usize,
    send_error: Option<TransportError>,
    flush_error: Option<TransportError>,
    waker: Option<Waker>,
    counts: Arc<Counts>,
}
struct TestSocket(Arc<Mutex<SocketState>>);
impl Drop for TestSocket {
    fn drop(&mut self) {
        let mut state = self.0.lock().unwrap();
        state.drops += 1;
        state.counts.trace.lock().unwrap().push("socket");
    }
}
impl WebSocketLike for TestSocket {
    fn start_send(self: Pin<&mut Self>, message: Message) -> Result<(), TransportError> {
        let mut state = self.0.lock().unwrap();
        assert!(
            !state.writing,
            "a second write was enqueued before flush completed"
        );
        if let Some(error) = state.send_error.take() {
            return Err(error);
        }
        let Message::Text(text) = message else {
            panic!("client sent binary");
        };
        let kind = Raw::parse_exact(&text).unwrap().object().unwrap()["type"]
            .string()
            .unwrap();
        state.sent.push(text);
        state.writing = true;
        if kind == "session.start" && state.auto_ready {
            state.incoming.push_back(Ok(Message::Text(READY.into())));
        }
        if kind == "text.done" {
            let frames = std::mem::take(&mut state.on_done);
            state.incoming.extend(frames.into_iter().map(Ok));
            state.incoming.push_back(Ok(Message::Text(DONE.into())));
        }
        Ok(())
    }
    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), TransportError>> {
        let mut state = self.0.lock().unwrap();
        if let Some(error) = state.flush_error.take() {
            return Poll::Ready(Err(error));
        }
        if (state.sent.len() == 1 && state.block_settings)
            || (state.sent.len() > 1 && state.block_text)
        {
            state.waker = Some(cx.waker().clone());
            Poll::Pending
        } else {
            state.writing = false;
            Poll::Ready(Ok(()))
        }
    }
    fn poll_receive(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Message, TransportError>>> {
        let mut state = self.0.lock().unwrap();
        if let Some(message) = state.incoming.pop_front() {
            Poll::Ready(Some(message))
        } else if state.eof {
            Poll::Ready(None)
        } else {
            state.waker = Some(cx.waker().clone());
            Poll::Pending
        }
    }
}
struct Factory {
    state: Arc<Mutex<SocketState>>,
    requests: Mutex<Vec<ConnectRequest>>,
    connect_error: Mutex<Option<TransportError>>,
}
impl Factory {
    fn new(counts: &Arc<Counts>) -> Self {
        Self {
            requests: Mutex::new(vec![]),
            connect_error: Mutex::new(None),
            state: Arc::new(Mutex::new(SocketState {
                incoming: VecDeque::new(),
                on_done: vec![],
                sent: vec![],
                auto_ready: true,
                block_settings: false,
                block_text: false,
                writing: false,
                eof: false,
                drops: 0,
                send_error: None,
                flush_error: None,
                waker: None,
                counts: counts.clone(),
            })),
        }
    }
    fn frames(&self, frames: impl IntoIterator<Item = Message>) {
        let mut state = self.state.lock().unwrap();
        state.incoming.extend(frames.into_iter().map(Ok));
        if let Some(waker) = state.waker.take() {
            waker.wake();
        }
    }
}
impl WebSocketTransport for Factory {
    fn connect(
        &self,
        request: ConnectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<Socket, TransportError>> + Send + '_>> {
        self.requests.lock().unwrap().push(request);
        Box::pin(async {
            if let Some(error) = self.connect_error.lock().unwrap().take() {
                return Err(error);
            }
            let socket: Socket = Box::pin(TestSocket(self.state.clone()));
            Ok(socket)
        })
    }
    fn random_bytes(&self, _: &mut [u8]) -> Result<(), TransportError> {
        panic!("CAMB does not need correlation entropy");
    }
}

#[test]
fn shared_segment_fixtures_preserve_exact_native_association() {
    let mut count = 0;
    for fixture in Raw::parse(include_str!("../../../../../fixtures/camb.json"))
        .unwrap()
        .array()
        .unwrap()
    {
        let fixture = fixture.object().unwrap();
        let name = fixture["name"].string().unwrap();
        let counts = Arc::new(Counts::default());
        let backend = Factory::new(&counts);
        backend.state.lock().unwrap().on_done = fixture["frames"]
            .array()
            .unwrap()
            .into_iter()
            .map(|frame| {
                let frame = frame.object().unwrap();
                if let Some(audio) = frame.get("audio") {
                    Message::Binary(
                        audio
                            .array()
                            .unwrap()
                            .into_iter()
                            .map(|value| value.number().unwrap() as u8)
                            .collect(),
                    )
                } else {
                    Message::Text(frame["json"].text().into())
                }
            })
            .collect();
        let auth = auth();
        let mut stream = ready(synthesize(
            timed("Hello world"),
            Options {
                auth: Some(&auth),
                web_socket_transport: Some(&backend),
                ..Default::default()
            },
        ))
        .unwrap();
        let (actual, error) = drain(&mut stream);
        assert_eq!(JsonValue::Array(actual), tree(fixture["items"]), "{name}");
        assert_eq!(
            error,
            fixture.get("error").map(|value| value.string().unwrap()),
            "{name}"
        );
        assert_eq!(backend.state.lock().unwrap().drops, 1);
        count += 1;
    }
    assert_eq!(count, 7);
}

#[test]
fn native_auth_live_settings_and_empty_text_are_preserved() {
    let counts = Arc::new(Counts::default());
    let backend = Factory::new(&counts);
    backend.state.lock().unwrap().on_done = vec![
        Message::Text(START.into()),
        Message::Binary(vec![0, 255]),
        Message::Text(END.into()),
    ];
    let mut request = live(input(&counts, &["", " Hello\n", "world\u{feff}"], false));
    request.output.format =
        TtsRequestMars81FlashBetaStreamingTextVoiceOutputFormat::Aac(Default::default());
    request.output.sample_rate_hz = Some(24000.0);
    request.text_flush_delay_ms = Some(0.0);
    request.inference_steps = Some(0.0);
    request.speed = Some(1.25);
    request.audio_enhancement = Some(flag(false));
    request.named_entity_pronunciation_enhancement = Some(flag(true));
    request.reference_audio_enhancement = Some(flag(false));
    request.accent_preservation = Some(flag(true));
    let auth = auth();
    let mut stream = ready(synthesize(
        TtsRequest::Mars81FlashBetaStreamingTextVoice(request),
        Options {
            auth: Some(&auth),
            web_socket_transport: Some(&backend),
            web_socket_url: Some(
                "wss://proxy.test/a%2Fb?keep=%2B&%61pi_key=old&api_key=other&next=1",
            ),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
    {
        let requests = backend.requests.lock().unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].url, "wss://proxy.test/a%2Fb?keep=%2B&next=1");
        assert_eq!(
            requests[0].headers,
            [("x-api-key".into(), "test + key".into())]
        );
        assert_eq!(requests[0].max_message_bytes, 4 * 1024 * 1024);
    }
    assert_eq!(drain(&mut stream), (vec![json("[0,255]")], None));
    assert_eq!(counts.reads.load(Ordering::SeqCst), 4);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    let state = backend.state.lock().unwrap();
    assert_eq!(state.drops, 1);
    assert_eq!(
        state.sent.iter().map(|text| json(text)).collect::<Vec<_>>(),
        vec![
            json(
                r#"{"type":"session.start","voice_id":123,"language":"en-us","output_format":"aac","sample_rate":24000,"word_timestamps":false,"idle_timeout":0,"inference_steps":0,"speaking_rate":1.25,"apply_enhancement":false,"enhance_named_entities_pronunciation":true,"enhance_reference_audio_quality":false,"maintain_source_accent":true}"#
            ),
            json(r#"{"type":"text.chunk","text":"","index":0}"#),
            json(r#"{"type":"text.chunk","text":" Hello\n","index":1}"#),
            json(r#"{"type":"text.chunk","text":"world\ufeff","index":2}"#),
            json(r#"{"type":"text.done"}"#),
        ]
    );
}

#[test]
fn defaults_timed_whole_and_empty_incremental_complete_via_text_done() {
    for whole_text in [false, true] {
        let counts = Arc::new(Counts::default());
        let backend = Factory::new(&counts);
        let auth = auth();
        let request = if whole_text {
            timed("")
        } else {
            TtsRequest::Mars81FlashBetaStreamingTextVoice(live(input(&counts, &[], false)))
        };
        let mut stream = ready(synthesize(
            request,
            Options {
                auth: Some(&auth),
                web_socket_transport: Some(&backend),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(drain(&mut stream), (vec![], None));
        let state = backend.state.lock().unwrap();
        assert_eq!(
            json(&state.sent[0]),
            json(&format!(
                r#"{{"type":"session.start","voice_id":123,"language":"en-us","output_format":"mp3","word_timestamps":{whole_text},"idle_timeout":1,"enhance_named_entities_pronunciation":false,"enhance_reference_audio_quality":false,"maintain_source_accent":false}}"#
            ))
        );
        assert_eq!(state.sent.len(), if whole_text { 3 } else { 2 });
        assert_eq!(
            json(state.sent.last().unwrap()),
            json(r#"{"type":"text.done"}"#)
        );
        assert_eq!(
            backend.requests.lock().unwrap()[0].url,
            "wss://client.camb.ai/apis/live-tts/ws"
        );
    }
}

#[test]
fn input_waits_for_acknowledgement_and_flush_while_audio_remains_readable() {
    let counts = Arc::new(Counts::default());
    let waker = Waker::from(counts.clone());
    let mut cx = Context::from_waker(&waker);
    let backend = Factory::new(&counts);
    {
        let mut state = backend.state.lock().unwrap();
        state.auto_ready = false;
        state.block_settings = true;
    }
    let auth = auth();
    let mut stream = ready(synthesize(
        TtsRequest::Mars81FlashBetaStreamingTextVoice(live(input(
            &counts,
            &["hello", "later"],
            true,
        ))),
        Options {
            auth: Some(&auth),
            web_socket_transport: Some(&backend),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(poll(&mut stream, &mut cx), Poll::Pending);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
    backend.frames([Message::Text(READY.into())]);
    assert_eq!(poll(&mut stream, &mut cx), Poll::Pending);
    assert_eq!(poll(&mut stream, &mut cx), Poll::Pending);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
    {
        let mut state = backend.state.lock().unwrap();
        state.block_settings = false;
        state.block_text = true;
        state.waker.take().unwrap().wake();
    }
    assert_eq!(poll(&mut stream, &mut cx), Poll::Pending);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    backend.frames([Message::Text(START.into()), Message::Binary(vec![255])]);
    assert_eq!(poll(&mut stream, &mut cx), Poll::Pending);
    assert_eq!(
        poll(&mut stream, &mut cx),
        Poll::Ready(Some(Ok(json("[255]"))))
    );
    assert_eq!(poll(&mut stream, &mut cx), Poll::Pending);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    assert_eq!(backend.state.lock().unwrap().sent.len(), 2);
    assert!(counts.wakes.load(Ordering::SeqCst) > 0);
    drop(stream);
    assert_eq!(*counts.trace.lock().unwrap(), ["socket", "input"]);
}

#[test]
fn rejection_before_ready_drops_unpolled_input_and_error_is_terminal() {
    for (frame, expected) in [
        (
            Message::Text(r#"{"type":"session.error","error":"bad voice"}"#.into()),
            "CAMB rejected session: bad voice",
        ),
        (
            Message::Text(START.into()),
            "CAMB did not acknowledge the session before sending output",
        ),
        (
            Message::Binary(vec![1]),
            "CAMB did not acknowledge the session before sending output",
        ),
        (Message::Text("{}".into()), "Invalid wire JSON"),
    ] {
        let counts = Arc::new(Counts::default());
        let backend = Factory::new(&counts);
        backend.state.lock().unwrap().auto_ready = false;
        backend.frames([frame]);
        let auth = auth();
        let mut stream = ready(synthesize(
            TtsRequest::Mars81FlashBetaStreamingTextVoice(live(input(&counts, &["unread"], true))),
            Options {
                auth: Some(&auth),
                web_socket_transport: Some(&backend),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(drain(&mut stream), (vec![], Some(expected.into())));
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        assert_eq!(*counts.trace.lock().unwrap(), ["socket", "input"]);
    }
}

#[test]
fn live_protocol_failures_never_fabricate_success() {
    for (frames, expected) in [
        (vec![READY], "Unexpected CAMB event: session.ready"),
        (vec![END], "CAMB completed an unexpected segment"),
        (
            vec![START, START],
            "CAMB returned an overlapping or reused segment",
        ),
        (
            vec![START, r#"{"type":"segment.done","segment_id":8}"#],
            "CAMB completed an unexpected segment",
        ),
        (
            vec![r#"{"type":"segment.start","segment_id":1.5,"text":"x"}"#],
            "Invalid wire JSON",
        ),
        (
            vec![r#"{"type":"session.error","error":"failed"}"#],
            "CAMB synthesis failed: failed",
        ),
        (vec![r#"{"type":"unknown"}"#], "Invalid wire JSON"),
    ] {
        let counts = Arc::new(Counts::default());
        let backend = Factory::new(&counts);
        backend.state.lock().unwrap().on_done = frames
            .into_iter()
            .map(|v| Message::Text(v.into()))
            .collect();
        let auth = auth();
        let mut stream = ready(synthesize(
            TtsRequest::Mars81FlashBetaStreamingTextVoice(live(input(&counts, &[], false))),
            Options {
                auth: Some(&auth),
                web_socket_transport: Some(&backend),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(drain(&mut stream), (vec![], Some(expected.into())));
        assert_eq!(backend.state.lock().unwrap().drops, 1);
    }
    for (word, expected) in [
        (
            r#"{"word":"x","start":-1,"end":0}"#,
            "CAMB returned invalid word timing",
        ),
        (
            r#"{"word":"x","start":1,"end":0}"#,
            "CAMB returned invalid word timing",
        ),
        (r#"{"word":"x","start":0,"end":1e400}"#, "Invalid wire JSON"),
    ] {
        let counts = Arc::new(Counts::default());
        let backend = Factory::new(&counts);
        let auth = auth();
        backend.state.lock().unwrap().on_done = vec![Message::Text(format!(
            r#"{{"type":"segment.start","segment_id":1,"text":"x","word_timestamps":[{word}]}}"#
        ))];
        let mut stream = ready(synthesize(
            timed("x"),
            Options {
                auth: Some(&auth),
                web_socket_transport: Some(&backend),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(drain(&mut stream), (vec![], Some(expected.into())));
    }
}

#[test]
fn premature_close_or_completion_cannot_truncate_pending_input() {
    for (ack, done, expected) in [
        (false, false, "CAMB closed before session.ready"),
        (true, false, "CAMB closed before session.done"),
        (true, true, "CAMB ended an incomplete session"),
    ] {
        let counts = Arc::new(Counts::default());
        let backend = Factory::new(&counts);
        let auth = auth();
        backend.state.lock().unwrap().auto_ready = ack;
        let mut stream = ready(synthesize(
            TtsRequest::Mars81FlashBetaStreamingTextVoice(live(input(&counts, &[], true))),
            Options {
                auth: Some(&auth),
                web_socket_transport: Some(&backend),
                ..Default::default()
            },
        ))
        .unwrap();
        if done {
            backend.frames([Message::Text(DONE.into())]);
        } else {
            backend.state.lock().unwrap().eof = true;
        }
        assert_eq!(drain(&mut stream), (vec![], Some(expected.into())));
        assert_eq!(*counts.trace.lock().unwrap(), ["socket", "input"]);
    }
}

#[test]
fn validation_configuration_and_message_limits_precede_connection_or_input() {
    let auth = auth();
    for case in 0..8 {
        let counts = Arc::new(Counts::default());
        let backend = Factory::new(&counts);
        let mut request = live(input(&counts, &["unread"], true));
        let mut options = Options {
            auth: Some(&auth),
            web_socket_transport: Some(&backend),
            ..Default::default()
        };
        let expected = match case {
            0 => {
                request.output.sample_rate_hz = Some(0.0);
                None
            }
            1 => {
                request.text_flush_delay_ms = Some(-1.0);
                None
            }
            2 => {
                request.inference_steps = Some(1.5);
                None
            }
            3 => {
                options.max_error_bytes = 0;
                Some("CAMB byte limits must be positive")
            }
            4 => {
                options.max_message_bytes = 0;
                Some("CAMB byte limits must be positive")
            }
            5 => {
                options.max_message_bytes = 1;
                Some("CAMB message exceeds max_message_bytes")
            }
            6 => {
                options.web_socket_url = Some("wss://user:secret@host/");
                Some("Invalid CAMB WebSocket endpoint URL")
            }
            7 => {
                options.web_socket_transport = None;
                Some("CAMB WebSocket transport is required")
            }
            _ => unreachable!(),
        };
        let request = TtsRequest::Mars81FlashBetaStreamingTextVoice(request);
        let expected = expected.map(str::to_owned).unwrap_or_else(|| validation_error(&request));
        assert_eq!(
            ready(synthesize(
                request,
                options
            ))
            .err()
            .unwrap()
            .to_string(),
            expected
        );
        assert_eq!(backend.requests.lock().unwrap().len(), 0);
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
    for inbound in [
        None,
        Some(Message::Binary(vec![0; 513])),
        Some(Message::Text("é".repeat(257))),
    ] {
        let counts = Arc::new(Counts::default());
        let backend = Factory::new(&counts);
        let text = "x".repeat(513);
        let mut stream = ready(synthesize(
            TtsRequest::Mars81FlashBetaStreamingTextVoice(live(input(&counts, &[&text], true))),
            Options {
                auth: Some(&auth),
                web_socket_transport: Some(&backend),
                max_message_bytes: 512,
                ..Default::default()
            },
        ))
        .unwrap();
        if let Some(frame) = inbound {
            backend.frames([frame]);
        }
        assert_eq!(
            drain(&mut stream),
            (
                vec![],
                Some("CAMB message exceeds max_message_bytes".into())
            )
        );
        assert_eq!(backend.state.lock().unwrap().sent.len(), 1);
        assert_eq!(*counts.trace.lock().unwrap(), ["socket", "input"]);
    }
    assert_eq!(
        ready(synthesize(
            TtsRequest::TextVoice(whole()),
            Options {
                auth: Some(&auth),
                ..Default::default()
            }
        ))
        .err()
        .unwrap()
        .to_string(),
        "CAMB HTTP transport is required"
    );
}

#[test]
fn malformed_queries_are_rejected_and_other_values_remain_exact() {
    assert_eq!(
        socket_url("WSS://[::1]:8080/a%2Fb?keep=+%2b&api%5fkey=old&api_key=other").unwrap(),
        "WSS://[::1]:8080/a%2Fb?keep=+%2b"
    );
    assert_eq!(
        socket_url("wss://host/?api_key=old").unwrap(),
        "wss://host/"
    );
    for url in ["wss://host/?api%=old", "wss://host/?keep=%zz"] {
        assert_eq!(
            socket_url(url).err().unwrap().to_string(),
            "Invalid CAMB WebSocket endpoint query"
        );
    }
    for url in [
        "https://host",
        "wss:///path",
        "wss://host/#fragment",
        "wss://host:bad",
        "wss://host:65536",
    ] {
        assert_eq!(
            socket_url(url).err().unwrap().to_string(),
            "Invalid CAMB WebSocket endpoint URL"
        );
    }
}

struct DropGuard(Arc<Counts>);
impl Drop for DropGuard {
    fn drop(&mut self) {
        self.0.trace.lock().unwrap().push("initialization");
    }
}
struct PendingBackend(Arc<Counts>);
impl WebSocketTransport for PendingBackend {
    fn connect(
        &self,
        _: ConnectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<Socket, TransportError>> + Send + '_>> {
        let guard = DropGuard(self.0.clone());
        Box::pin(async move {
            let _guard = guard;
            std::future::pending().await
        })
    }
    fn random_bytes(&self, _: &mut [u8]) -> Result<(), TransportError> {
        panic!("unexpected entropy");
    }
}
impl HttpTransport for PendingBackend {
    fn send(
        &self,
        _: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        let guard = DropGuard(self.0.clone());
        Box::pin(async move {
            let _guard = guard;
            std::future::pending().await
        })
    }
}

#[test]
fn drop_cancels_unpolled_stream_pending_input_and_pending_initialization() {
    let auth = auth();
    for initialization in [false, true] {
        let counts = Arc::new(Counts::default());
        let backend = PendingBackend(counts.clone());
        let request = if initialization {
            TtsRequest::Mars81FlashBetaStreamingTextVoice(live(input(&counts, &["unread"], true)))
        } else {
            TtsRequest::TextVoice(whole())
        };
        let mut future = Box::pin(synthesize(
            request,
            Options {
                auth: Some(&auth),
                transport: Some(&backend),
                web_socket_transport: Some(&backend),
                ..Default::default()
            },
        ));
        assert!(future
            .as_mut()
            .poll(&mut Context::from_waker(Waker::noop()))
            .is_pending());
        drop(future);
        assert_eq!(
            *counts.trace.lock().unwrap(),
            if initialization {
                vec!["initialization", "input"]
            } else {
                vec!["initialization"]
            }
        );
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
    }
    for read in [false, true] {
        let counts = Arc::new(Counts::default());
        let backend = Factory::new(&counts);
        let mut stream = ready(synthesize(
            TtsRequest::Mars81FlashBetaStreamingTextVoice(live(input(&counts, &[], true))),
            Options {
                auth: Some(&auth),
                web_socket_transport: Some(&backend),
                ..Default::default()
            },
        ))
        .unwrap();
        if read {
            let waker = Waker::from(counts.clone());
            let mut cx = Context::from_waker(&waker);
            assert_eq!(poll(&mut stream, &mut cx), Poll::Pending);
            assert_eq!(poll(&mut stream, &mut cx), Poll::Pending);
            assert!(counts.waker.lock().unwrap().is_some());
        }
        drop(stream);
        assert_eq!(*counts.trace.lock().unwrap(), ["socket", "input"]);
    }
}

#[test]
fn original_input_send_flush_and_receive_errors_survive_cleanup() {
    let auth = auth();
    for stage in ["connect", "send", "flush", "receive", "input"] {
        let counts = Arc::new(Counts::default());
        let backend = Factory::new(&counts);
        let token = Arc::new(());
        let cause = || Box::new(Cause(token.clone())) as TransportError;
        if stage == "connect" {
            *backend.connect_error.lock().unwrap() = Some(cause());
        }
        let text: StreamingInput<String> = if stage == "input" {
            Box::pin(Body {
                values: VecDeque::from([Err(cause())]),
                counts: counts.clone(),
                stall: true,
                name: "input",
            })
        } else {
            input(&counts, &[], true)
        };
        {
            let mut state = backend.state.lock().unwrap();
            match stage {
                "send" => state.send_error = Some(cause()),
                "flush" => state.flush_error = Some(cause()),
                "receive" => state.incoming.push_back(Err(cause())),
                _ => {}
            }
        }
        let result = ready(synthesize(
            TtsRequest::Mars81FlashBetaStreamingTextVoice(live(text)),
            Options {
                auth: Some(&auth),
                web_socket_transport: Some(&backend),
                ..Default::default()
            },
        ));
        let error = if matches!(stage, "connect" | "send") {
            result.err().unwrap()
        } else {
            let mut stream = result.unwrap();
            let mut error = None;
            for _ in 0..4 {
                match Pin::new(&mut stream).poll_next(&mut Context::from_waker(Waker::noop())) {
                    Poll::Ready(Some(Err(value))) => {
                        error = Some(value);
                        break;
                    }
                    Poll::Pending => {}
                    _ => panic!("missing original error"),
                }
            }
            assert_eq!(
                poll(&mut stream, &mut Context::from_waker(Waker::noop())),
                Poll::Ready(None)
            );
            error.unwrap()
        };
        assert!(Arc::ptr_eq(
            &error.downcast_ref::<Cause>().unwrap().0,
            &token
        ));
        assert_eq!(
            *counts.trace.lock().unwrap(),
            if stage == "connect" {
                vec!["input"]
            } else {
                vec!["socket", "input"]
            }
        );
    }
}
