use super::*;

#[derive(Default)]
struct SocketState {
    sent: Vec<Value>,
    incoming: VecDeque<Result<Message, TransportError>>,
    stall_write: bool,
    send_error: bool,
    flush_error: bool,
    eof: bool,
    flood: bool,
    reader: Option<Waker>,
    writer: Option<Waker>,
}
impl SocketState {
    fn emit(&mut self, value: Value) {
        self.incoming
            .push_back(Ok(Message::Binary(msgpack::encode(&value).unwrap())));
        if let Some(waker) = self.reader.take() {
            waker.wake()
        }
    }
}
struct TestSocket {
    state: Arc<Mutex<SocketState>>,
    counts: Arc<Counts>,
    trace: Arc<Mutex<Vec<&'static str>>>,
}
impl WebSocketLike for TestSocket {
    fn start_send(self: Pin<&mut Self>, message: Message) -> Result<(), TransportError> {
        let Message::Binary(bytes) = message else {
            panic!("expected binary")
        };
        let value = msgpack::decode(&bytes)?;
        let mut state = self.state.lock().unwrap();
        if state.send_error {
            return Err(failure("send failed"));
        }
        let Value::Map(fields) = &value else { panic!() };
        match fields.get("event") {
            Some(Value::String(event)) if event == "text" => state.emit(audio()),
            Some(Value::String(event)) if event == "stop" => state.emit(finish("stop")),
            _ => {}
        }
        state.sent.push(value);
        Ok(())
    }
    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), TransportError>> {
        let mut state = self.state.lock().unwrap();
        if state.flush_error {
            return Poll::Ready(Err(failure("flush failed")));
        }
        if state.stall_write && state.sent.len() > 1 {
            state.writer = Some(cx.waker().clone());
            return Poll::Pending;
        }
        Poll::Ready(Ok(()))
    }
    fn poll_receive(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Message, TransportError>>> {
        self.counts.reads.fetch_add(1, Ordering::SeqCst);
        let mut state = self.state.lock().unwrap();
        if let Some(message) = state.incoming.pop_front() {
            return Poll::Ready(Some(message));
        }
        if state.flood {
            return Poll::Ready(Some(Ok(Message::Binary(
                msgpack::encode(&event("future")).unwrap(),
            ))));
        }
        if state.eof {
            return Poll::Ready(None);
        }
        state.reader = Some(cx.waker().clone());
        Poll::Pending
    }
}
impl Drop for TestSocket {
    fn drop(&mut self) {
        self.counts.drops.fetch_add(1, Ordering::SeqCst);
        self.trace.lock().unwrap().push("socket");
    }
}
fn socket(
    state: &Arc<Mutex<SocketState>>,
    counts: &Arc<Counts>,
    trace: &Arc<Mutex<Vec<&'static str>>>,
) -> Socket {
    Box::pin(TestSocket {
        state: state.clone(),
        counts: counts.clone(),
        trace: trace.clone(),
    })
}
fn event(name: &str) -> Value {
    Value::Map(BTreeMap::from([(
        "event".into(),
        Value::String(name.into()),
    )]))
}
fn audio() -> Value {
    Value::Map(BTreeMap::from([
        ("event".into(), Value::String("audio".into())),
        ("audio".into(), Value::Binary(vec![0, 255])),
    ]))
}
fn finish(reason: &str) -> Value {
    Value::Map(BTreeMap::from([
        ("event".into(), Value::String("finish".into())),
        ("reason".into(), Value::String(reason.into())),
    ]))
}
fn text(value: &str) -> settings::Input {
    settings::Input::String(value.into())
}
fn flush() -> settings::Input {
    settings::Input::Flush(TtsRequestS1StreamingTextTextItemFlush {
        command: Default::default(),
    })
}

#[test]
fn binary_protocol_and_unknown_events() {
    let input = Arc::new(Counts::default());
    let counts = Arc::new(Counts::default());
    let state = Arc::new(Mutex::new(SocketState::default()));
    state.lock().unwrap().emit(event("future"));
    let trace = Arc::default();
    let mut stream = ready(synthesize(
        streaming(source(
            vec![Ok(text("hello")), Ok(flush()), Ok(text("world"))],
            &input,
            false,
        )),
        Options {
            web_socket: Some(socket(&state, &counts, &trace)),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(input.reads.load(Ordering::SeqCst), 0);
    assert!(state.lock().unwrap().sent.is_empty());
    assert_eq!(
        collect(&mut stream).unwrap(),
        vec![Value::Binary(vec![0, 255]), Value::Binary(vec![0, 255])]
    );
    let Value::Map(mut wire) = fixture(fixture_root()["defaults"]) else {
        panic!()
    };
    wire.insert("text".into(), Value::String(String::new()));
    assert_eq!(
        state.lock().unwrap().sent,
        vec![
            Value::Map(BTreeMap::from([
                ("event".into(), Value::String("start".into())),
                ("request".into(), Value::Map(wire))
            ])),
            Value::Map(BTreeMap::from([
                ("event".into(), Value::String("text".into())),
                ("text".into(), Value::String("hello".into()))
            ])),
            event("flush"),
            Value::Map(BTreeMap::from([
                ("event".into(), Value::String("text".into())),
                ("text".into(), Value::String("world".into()))
            ])),
            event("stop"),
        ]
    );
    assert_eq!(input.drops.load(Ordering::SeqCst), 1);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert!(next(&mut stream).is_none());
}

#[test]
fn blocked_write_yields_audio_without_input_prefetch() {
    let input = Arc::new(Counts::default());
    let counts = Arc::new(Counts::default());
    let state = Arc::new(Mutex::new(SocketState {
        stall_write: true,
        ..Default::default()
    }));
    let trace = Arc::default();
    let mut stream = ready(synthesize(
        streaming(source(
            vec![Ok(text("one")), Ok(text("two"))],
            &input,
            false,
        )),
        Options {
            web_socket: Some(socket(&state, &counts, &trace)),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        normalized(next(&mut stream).unwrap().unwrap()),
        Value::Binary(vec![0, 255])
    );
    assert_eq!(input.reads.load(Ordering::SeqCst), 1);
    let wakes = Arc::new(Counts::default());
    let waker = Waker::from(wakes.clone());
    let mut cx = Context::from_waker(&waker);
    assert!(Pin::new(&mut stream).poll_next(&mut cx).is_pending());
    assert_eq!(input.reads.load(Ordering::SeqCst), 1);
    {
        let mut state = state.lock().unwrap();
        state.stall_write = false;
        state.writer.take().unwrap().wake();
    }
    assert_eq!(wakes.wakes.load(Ordering::SeqCst), 1);
    assert_eq!(
        collect(&mut stream).unwrap(),
        vec![Value::Binary(vec![0, 255])]
    );
}

#[test]
fn unread_and_pending_drop_release_socket_before_input() {
    for unread in [true, false] {
        let trace = Arc::new(Mutex::new(Vec::new()));
        let input = Arc::new(Counts::default());
        let counts = Arc::new(Counts::default());
        let state = Arc::new(Mutex::new(SocketState::default()));
        let src = Box::pin(Source {
            values: VecDeque::new(),
            counts: input.clone(),
            stall: true,
            trace: trace.clone(),
        });
        let mut stream = ready(synthesize(
            streaming(src),
            Options {
                web_socket: Some(socket(&state, &counts, &trace)),
                ..Default::default()
            },
        ))
        .unwrap();
        if !unread {
            let waker = Waker::from(Arc::new(Counts::default()));
            let mut cx = Context::from_waker(&waker);
            for _ in 0..5 {
                assert!(Pin::new(&mut stream).poll_next(&mut cx).is_pending());
            }
        }
        drop(stream);
        assert_eq!(*trace.lock().unwrap(), vec!["socket", "input"]);
        assert_eq!(input.drops.load(Ordering::SeqCst), 1);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        if unread {
            assert_eq!(input.reads.load(Ordering::SeqCst), 0)
        }
    }
}

#[test]
fn exact_protocol_errors_are_terminal() {
    for (mode, expected) in [
        ("input", "input failed"),
        ("send", "send failed"),
        ("flush", "flush failed"),
        ("read", "read failed"),
        (
            "early-finish",
            "Fish finished before the input stream ended",
        ),
        ("eof", "Fish WebSocket closed before session completion"),
        ("provider", "Fish 0: Streaming synthesis failed"),
        ("text", "Fish returned a non-binary WebSocket frame"),
        ("known", "Fish returned an invalid WebSocket event"),
        ("limit", "Fish message exceeds max_message_bytes"),
    ] {
        let counts = Arc::new(Counts::default());
        let input = Arc::new(Counts::default());
        let trace = Arc::default();
        let mut initial = SocketState::default();
        let mut values = vec![];
        match mode {
            "input" => values.push(Err(failure("input failed"))),
            "send" => initial.send_error = true,
            "flush" => initial.flush_error = true,
            "read" => initial.incoming.push_back(Err(failure("read failed"))),
            "early-finish" => initial.emit(finish("stop")),
            "eof" => initial.eof = true,
            "provider" => initial.emit(finish("error")),
            "text" => initial.incoming.push_back(Ok(Message::Text("{}".into()))),
            "known" => initial.emit(event("audio")),
            _ => {}
        }
        let state = Arc::new(Mutex::new(initial));
        let mut stream = ready(synthesize(
            streaming(source(values, &input, true)),
            Options {
                web_socket: Some(socket(&state, &counts, &trace)),
                max_message_bytes: if mode == "limit" { 1 } else { 4096 },
                ..Default::default()
            },
        ))
        .unwrap();
        let error = next(&mut stream).unwrap().err().unwrap();
        assert_eq!(error.to_string(), expected, "{mode}");
        assert!(next(&mut stream).is_none());
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(input.drops.load(Ordering::SeqCst), 1);
        if mode == "provider" {
            assert_eq!(
                error.downcast_ref::<Error>().unwrap(),
                &Error {
                    status: 0,
                    message: "Streaming synthesis failed".into(),
                    reason: Some("error".into())
                }
            );
        }
    }
}

#[test]
fn continuous_unknown_events_do_not_starve_input_or_finish() {
    let counts = Arc::new(Counts::default());
    let input = Arc::new(Counts::default());
    let trace = Arc::default();
    let state = Arc::new(Mutex::new(SocketState {
        flood: true,
        ..Default::default()
    }));
    let mut stream = ready(synthesize(
        streaming(source(vec![Ok(text("hello"))], &input, false)),
        Options {
            web_socket: Some(socket(&state, &counts, &trace)),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        collect(&mut stream).unwrap(),
        vec![Value::Binary(vec![0, 255])]
    );
    assert_eq!(state.lock().unwrap().sent.len(), 3);
    let state = Arc::new(Mutex::new(SocketState::default()));
    let mut stream = ready(synthesize(
        streaming(source(vec![], &input, false)),
        Options {
            web_socket: Some(socket(&state, &counts, &trace)),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(collect(&mut stream).unwrap(), vec![]);
    assert_eq!(state.lock().unwrap().sent.len(), 2);
}

struct Connector {
    request: Mutex<Option<ConnectRequest>>,
    socket: Mutex<Option<Socket>>,
}
impl WebSocketTransport for Connector {
    fn connect(
        &self,
        request: ConnectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<Socket, TransportError>> + Send + '_>> {
        *self.request.lock().unwrap() = Some(request);
        Box::pin(async { Ok(self.socket.lock().unwrap().take().unwrap()) })
    }
    fn random_bytes(&self, _: &mut [u8]) -> Result<(), TransportError> {
        panic!("Fish requires no random correlation identifiers")
    }
}
#[test]
fn provider_boundary_supplies_native_auth_model_and_path() {
    let auth = auth();
    for model in ["s1", "s2-pro", "s2.1-pro", "s2.1-pro-free"] {
        for override_url in [None, Some("https://override.test/custom?tenant=one")] {
            let counts = Arc::new(Counts::default());
            let input = Arc::new(Counts::default());
            let state = Arc::new(Mutex::new(SocketState::default()));
            let trace = Arc::default();
            let transport = Connector {
                request: Mutex::new(None),
                socket: Mutex::new(Some(socket(&state, &counts, &trace))),
            };
            let src = source(vec![], &input, false);
            let request = if model == "s1" {
                TtsRequest::S1StreamingTextVoice(
                    request_fields!(TtsRequestS1StreamingTextVoice,model:Default::default(),text:src,voice:"custom-voice".into(),reference_samples:None,output:mp3()),
                )
            } else {
                let model = match model {
                    "s2-pro" => TtsRequestTextfd2d056aModel::S2Pro(Default::default()),
                    "s2.1-pro" => TtsRequestTextfd2d056aModel::S21Pro(Default::default()),
                    _ => TtsRequestTextfd2d056aModel::S21ProFree(Default::default()),
                };
                TtsRequest::StreamingTextVoice(
                    request_fields!(TtsRequestStreamingTextVoice,model:model,text:src,voice:"custom-voice".into(),reference_samples:None,output:mp3(),loudness_normalization:None),
                )
            };
            let stream = ready(synthesize(
                request,
                Options {
                    auth: Some(&auth),
                    web_socket_transport: Some(&transport),
                    base_url: Some("https://proxy.test/p%20x/?tenant=one"),
                    web_socket_url: override_url,
                    max_message_bytes: 1024,
                    ..Default::default()
                },
            ))
            .unwrap();
            let request = transport.request.lock().unwrap().take().unwrap();
            assert_eq!(
                request.url,
                if override_url.is_some() {
                    "wss://override.test/custom?tenant=one"
                } else {
                    "wss://proxy.test/p%20x/v1/tts/live?tenant=one"
                }
            );
            assert_eq!(
                request.headers,
                vec![
                    ("authorization".into(), "Bearer test-key".into()),
                    ("model".into(), model.into())
                ]
            );
            assert_eq!(request.max_message_bytes, 1024);
            assert_eq!(input.reads.load(Ordering::SeqCst), 0);
            drop(stream);
            assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        }
    }
}

struct PendingConnect {
    counts: Arc<Counts>,
}
struct ConnectFuture {
    counts: Arc<Counts>,
}
impl Future for ConnectFuture {
    type Output = Result<Socket, TransportError>;
    fn poll(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Self::Output> {
        self.counts.reads.fetch_add(1, Ordering::SeqCst);
        Poll::Pending
    }
}
impl Drop for ConnectFuture {
    fn drop(&mut self) {
        self.counts.drops.fetch_add(1, Ordering::SeqCst);
    }
}
impl WebSocketTransport for PendingConnect {
    fn connect(
        &self,
        _: ConnectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<Socket, TransportError>> + Send + '_>> {
        Box::pin(ConnectFuture {
            counts: self.counts.clone(),
        })
    }
    fn random_bytes(&self, _: &mut [u8]) -> Result<(), TransportError> {
        panic!()
    }
}
#[test]
fn dropping_pending_handshake_cancels_connection_and_unpolled_input() {
    let auth = auth();
    let counts = Arc::new(Counts::default());
    let input = Arc::new(Counts::default());
    let transport = PendingConnect {
        counts: counts.clone(),
    };
    let mut future = Box::pin(synthesize(
        streaming(source(vec![], &input, true)),
        Options {
            auth: Some(&auth),
            web_socket_transport: Some(&transport),
            ..Default::default()
        },
    ));
    let waker = Waker::from(Arc::new(Counts::default()));
    let mut cx = Context::from_waker(&waker);
    assert!(future.as_mut().poll(&mut cx).is_pending());
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    assert_eq!(input.reads.load(Ordering::SeqCst), 0);
    drop(future);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(input.drops.load(Ordering::SeqCst), 1);
}
