use super::*;

#[test]
fn drop_releases_socket_before_producer() {
    let counts = Arc::new(Counts::default());
    let socket_counts = Arc::new(Counts::default());
    let trace = Arc::new(Mutex::new(vec![]));
    let data = Arc::new(Mutex::new(SocketData {
        block: true,
        ..Default::default()
    }));
    let input = Box::pin(Source {
        values: VecDeque::from([Ok(Input::String("Hello".into()))]),
        counts: counts.clone(),
        stall: true,
        trace: trace.clone(),
    });
    let mut stream = ready(synthesize(
        live(input),
        Options {
            auth: Some(&auth()),
            web_socket: Some(socket(data, socket_counts.clone(), trace.clone())),
            entropy: Some(&entropy),
            ..Options::default()
        },
    ))
    .unwrap();
    assert!(poll(&mut stream).is_pending());
    drop(stream);
    assert_eq!(*trace.lock().unwrap(), vec!["socket", "input"]);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(socket_counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn reads_progress_during_write_but_completion_does_not_hide_failure() {
    let data = Arc::new(Mutex::new(SocketData {
        automatic: true,
        block_flush: true,
        ..Default::default()
    }));
    let mut stream = stream(TtsRequest::Object1ec54d36(request()), data.clone());
    assert_eq!(
        output(next(&mut stream).unwrap().unwrap()),
        Value::Array(vec![
            Value::String("audio".into()),
            Value::String(FIRST.into()),
            Value::Binary(vec![0, 255, 128])
        ])
    );
    assert_eq!(
        output(next(&mut stream).unwrap().unwrap()),
        value(&format!(r#"["flush","{FIRST}"]"#))
    );
    assert!(poll(&mut stream).is_pending());
    let mut state = data.lock().unwrap();
    state.block = false;
    state.flush_error = Some(Box::new(Error {
        status: None,
        context_id: Some("write failure".into()),
    }));
    drop(state);
    let error = next(&mut stream).unwrap().err().unwrap();
    assert_eq!(
        error.downcast_ref::<Error>(),
        Some(&Error {
            status: None,
            context_id: Some("write failure".into())
        })
    );
    assert!(next(&mut stream).is_none());
}

#[test]
fn protocol_rejects_premature_duplicate_and_unknown_events() {
    for (flush_first, frames, expected) in [
        (
            false,
            vec![r#""audio":"AA==""#],
            "Voice.ai audio arrived outside an active flush",
        ),
        (
            false,
            vec![r#""is_last":true"#],
            "Voice.ai returned an unexpected or empty flush completion",
        ),
        (
            true,
            vec![r#""context_closed":true"#],
            "Voice.ai context closed before flush completion",
        ),
        (
            true,
            vec![r#""audio":"""#, r#""is_last":true"#],
            "Voice.ai returned an unexpected or empty flush completion",
        ),
        (
            true,
            vec![
                r#""audio":"AA==""#,
                r#""is_last":true"#,
                r#""is_last":true"#,
            ],
            "Voice.ai returned an unexpected or empty flush completion",
        ),
        (
            true,
            vec![
                r#""audio":"AA==""#,
                r#""is_last":true"#,
                r#""audio":"AQ==""#,
            ],
            "Voice.ai audio arrived outside an active flush",
        ),
        (
            true,
            vec![
                r#""audio":"AA==""#,
                r#""is_last":true"#,
                r#""context_closed":true"#,
                r#""audio":"AQ==""#,
            ],
            "Voice.ai returned an unknown or completed context",
        ),
    ] {
        let mut values = VecDeque::from([Ok(Input::String("Hello".into()))]);
        if flush_first {
            values.push_back(Ok(flush()));
        }
        let input = Box::pin(Source {
            values,
            counts: Arc::default(),
            stall: true,
            trace: Arc::default(),
        });
        let data = Arc::new(Mutex::new(SocketData::default()));
        let mut stream = stream(live(input), data.clone());
        assert!(poll(&mut stream).is_pending());
        for frame in frames {
            data.lock()
                .unwrap()
                .push(format!(r#"{{"context_id":"{FIRST}",{frame}}}"#));
        }
        let error = collect(&mut stream).err().unwrap();
        assert_eq!(error.to_string(), expected);
        assert!(next(&mut stream).is_none());
    }
    for id in [
        "alien",
        "000102030405060708090a0b0c0d0e0f:01",
        "000102030405060708090a0b0c0d0e0f:0",
        "000102030405060708090a0b0c0d0e0f:+1",
    ] {
        let data = Arc::new(Mutex::new(SocketData::default()));
        let mut stream = stream(
            live(source(vec![
                Input::String("Hello".into()),
                clear(),
                Input::String("new".into()),
            ])),
            data.clone(),
        );
        assert!(poll(&mut stream).is_pending());
        data.lock()
            .unwrap()
            .push(format!(r#"{{"context_id":"{id}","audio":"AA=="}}"#));
        assert_eq!(
            next(&mut stream).unwrap().err().unwrap().to_string(),
            "Voice.ai returned an unknown or completed context"
        );
    }
}

#[test]
fn http_releases_unread_errors_and_streams_before_eof() {
    for (status, media, expected) in [
        (401, "application/json", "Voice.ai returned HTTP 401"),
        (
            200,
            "application/json",
            "Voice.ai returned an unexpected audio content type",
        ),
    ] {
        let counts = Arc::new(Counts::default());
        let body = Box::pin(Source {
            values: VecDeque::from([Ok(vec![0, 255])]),
            counts: counts.clone(),
            stall: true,
            trace: Arc::default(),
        });
        let http = Http {
            requests: Mutex::new(vec![]),
            response: Mutex::new(Some(HttpResponse {
                status,
                headers: vec![("Content-Type".into(), media.into())],
                body,
            })),
        };
        let error = ready(synthesize(
            TtsRequest::Object1ec54d36(request()),
            Options {
                auth: Some(&auth()),
                transport: Some(&http),
                ..Options::default()
            },
        ))
        .err()
        .unwrap();
        assert_eq!(error.to_string(), expected);
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
    let counts = Arc::new(Counts::default());
    let body = Box::pin(Source {
        values: VecDeque::from([Ok(vec![0, 255])]),
        counts: counts.clone(),
        stall: true,
        trace: Arc::default(),
    });
    let http = Http {
        requests: Mutex::new(vec![]),
        response: Mutex::new(Some(HttpResponse {
            status: 200,
            headers: vec![],
            body,
        })),
    };
    let mut stream = ready(synthesize(
        TtsRequest::Object1ec54d36(request()),
        Options {
            auth: Some(&auth()),
            transport: Some(&http),
            ..Options::default()
        },
    ))
    .unwrap();
    assert_eq!(
        output(next(&mut stream).unwrap().unwrap()),
        Value::Binary(vec![0, 255])
    );
    assert_eq!(counts.drops.load(Ordering::SeqCst), 0);
    assert!(poll(&mut stream).is_pending());
    drop(stream);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn http_empty_body_and_input_errors_never_succeed() {
    let http = Http {
        requests: Mutex::new(vec![]),
        response: Mutex::new(Some(HttpResponse {
            status: 200,
            headers: vec![],
            body: source(vec![Vec::<u8>::new()]),
        })),
    };
    let mut stream = ready(synthesize(
        TtsRequest::Object1ec54d36(request()),
        Options {
            auth: Some(&auth()),
            transport: Some(&http),
            ..Options::default()
        },
    ))
    .unwrap();
    assert_eq!(
        next(&mut stream).unwrap().err().unwrap().to_string(),
        "Voice.ai returned no audio bytes"
    );
    assert!(next(&mut stream).is_none());
    let counts = Arc::new(Counts::default());
    let input = Box::pin(Source {
        values: VecDeque::from([Err(Box::new(Error {
            status: Some(418),
            context_id: None,
        }) as TransportError)]),
        counts: counts.clone(),
        stall: false,
        trace: Arc::default(),
    });
    let mut stream = super::stream(live(input), Arc::default());
    let error = next(&mut stream).unwrap().err().unwrap();
    assert_eq!(
        error.downcast_ref::<Error>(),
        Some(&Error {
            status: Some(418),
            context_id: None
        })
    );
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

struct PendingSend {
    counts: Arc<Counts>,
}
impl Future for PendingSend {
    type Output = Result<HttpResponse, TransportError>;
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        *self.counts.waiting.lock().unwrap() = Some(cx.waker().clone());
        Poll::Pending
    }
}
impl Drop for PendingSend {
    fn drop(&mut self) {
        self.counts.waiting.lock().unwrap().take();
        self.counts.drops.fetch_add(1, Ordering::SeqCst);
    }
}
struct PendingHttp(Arc<Counts>);
impl HttpTransport for PendingHttp {
    fn send(
        &self,
        _: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        Box::pin(PendingSend {
            counts: self.0.clone(),
        })
    }
}

#[test]
fn dropping_pending_http_acquisition_cancels_owned_future() {
    let counts = Arc::new(Counts::default());
    let http = PendingHttp(counts.clone());
    let a = auth();
    let waker = Waker::from(Arc::new(Counts::default()));
    let mut cx = Context::from_waker(&waker);
    let mut future = Box::pin(synthesize(
        TtsRequest::Object1ec54d36(request()),
        Options {
            auth: Some(&a),
            transport: Some(&http),
            ..Options::default()
        },
    ));
    assert!(future.as_mut().poll(&mut cx).is_pending());
    drop(future);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

struct PendingConnect(Arc<Counts>);
impl Future for PendingConnect {
    type Output = Result<Socket, TransportError>;
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        *self.0.waiting.lock().unwrap() = Some(cx.waker().clone());
        Poll::Pending
    }
}
impl Drop for PendingConnect {
    fn drop(&mut self) {
        self.0.waiting.lock().unwrap().take();
        self.0.drops.fetch_add(1, Ordering::SeqCst);
    }
}
struct Backend {
    requests: Mutex<Vec<ConnectRequest>>,
    socket: Mutex<Option<Socket>>,
    pending: Option<Arc<Counts>>,
    reject: bool,
}
impl WebSocketTransport for Backend {
    fn connect(
        &self,
        request: ConnectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<Socket, TransportError>> + Send + '_>> {
        self.requests.lock().unwrap().push(request);
        if let Some(counts) = &self.pending {
            return Box::pin(PendingConnect(counts.clone()));
        }
        Box::pin(async {
            if self.reject {
                Err(failure("upgrade rejected"))
            } else {
                Ok(self.socket.lock().unwrap().take().unwrap())
            }
        })
    }
    fn random_bytes(&self, bytes: &mut [u8]) -> Result<(), TransportError> {
        entropy(bytes)
    }
}

#[test]
fn provider_constructs_header_auth_and_defers_input_until_handshake() {
    let data = Arc::new(Mutex::new(SocketData {
        automatic: true,
        ..Default::default()
    }));
    let backend = Backend {
        requests: Mutex::new(vec![]),
        socket: Mutex::new(Some(socket(data, Arc::default(), Arc::default()))),
        pending: None,
        reject: false,
    };
    let mut stream = ready(synthesize(
        TtsRequest::Object1ec54d36(request()),
        Options {
            auth: Some(&auth()),
            web_socket_transport: Some(&backend),
            protocol: Some(Protocol::WebSocket),
            base_url: Some("https://proxy.test/proxy%2Fraw/"),
            ..Options::default()
        },
    ))
    .unwrap();
    collect(&mut stream).unwrap();
    let requests = backend.requests.lock().unwrap();
    assert_eq!(requests.len(), 1);
    assert_eq!(
        requests[0].url,
        "wss://proxy.test/proxy%2Fraw/api/v1/tts/multi-stream"
    );
    assert_eq!(
        requests[0].headers,
        vec![("Authorization".into(), "Bearer fixture".into())]
    );
    assert_eq!(requests[0].max_message_bytes, 4 * 1024 * 1024);
    for pending in [false, true] {
        let input_counts = Arc::new(Counts::default());
        let connect_counts = Arc::new(Counts::default());
        let input = Box::pin(Source {
            values: VecDeque::from([Ok(Input::String("Hello".into()))]),
            counts: input_counts.clone(),
            stall: false,
            trace: Arc::default(),
        });
        let backend = Backend {
            requests: Mutex::new(vec![]),
            socket: Mutex::new(None),
            pending: pending.then(|| connect_counts.clone()),
            reject: !pending,
        };
        let a = auth();
        let mut future = Box::pin(synthesize(
            live(input),
            Options {
                auth: Some(&a),
                web_socket_transport: Some(&backend),
                ..Options::default()
            },
        ));
        if pending {
            let waker = Waker::from(Arc::new(Counts::default()));
            assert!(future
                .as_mut()
                .poll(&mut Context::from_waker(&waker))
                .is_pending());
            drop(future);
            assert_eq!(connect_counts.drops.load(Ordering::SeqCst), 1);
        } else {
            assert_eq!(ready(future).err().unwrap().to_string(), "upgrade rejected");
        }
        assert_eq!(input_counts.reads.load(Ordering::SeqCst), 0);
        assert_eq!(input_counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn validation_and_limits_precede_io_and_own_overrides() {
    let mut r = request();
    r.temperature = Some(f64::NAN);
    let counts = Arc::new(Counts::default());
    let error = ready(synthesize(
        TtsRequest::Object1ec54d36(r),
        Options {
            web_socket: Some(socket(Arc::default(), counts.clone(), Arc::default())),
            ..Options::default()
        },
    ))
    .err()
    .unwrap();
    assert_eq!(error.to_string(), "Invalid voice.ai TTS request");
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
    let data = Arc::new(Mutex::new(SocketData::default()));
    let mut stream = ready(synthesize(
        TtsRequest::Object1ec54d36(request()),
        Options {
            auth: Some(&auth()),
            web_socket: Some(socket(data.clone(), Arc::default(), Arc::default())),
            entropy: Some(&entropy),
            max_message_bytes: 20,
            ..Options::default()
        },
    ))
    .unwrap();
    assert_eq!(
        next(&mut stream).unwrap().err().unwrap().to_string(),
        "Voice.ai message exceeds MaxMessageBytes"
    );
    assert_eq!(data.lock().unwrap().sent.len(), 0);
}

#[test]
fn repeated_empty_inputs_yield_to_the_executor_and_socket_eof_is_not_done() {
    let data = Arc::new(Mutex::new(SocketData::default()));
    let mut stream = stream(
        live(source(
            (0..1000).map(|_| Input::String(String::new())).collect(),
        )),
        data.clone(),
    );
    // ready() rejects a Pending result that failed to schedule another poll.
    assert_eq!(collect(&mut stream).unwrap(), vec![value(r#""done""#)]);
    assert_eq!(data.lock().unwrap().sent.len(), 0);
    let data = Arc::new(Mutex::new(SocketData::default()));
    let mut stream = super::stream(TtsRequest::Object1ec54d36(request()), data.clone());
    assert!(poll(&mut stream).is_pending());
    let mut state = data.lock().unwrap();
    state.push(format!(r#"{{"context_id":"{FIRST}","audio":"AA=="}}"#));
    state.closed = true;
    drop(state);
    assert_eq!(
        output(next(&mut stream).unwrap().unwrap()),
        Value::Array(vec![
            Value::String("audio".into()),
            Value::String(FIRST.into()),
            Value::Binary(vec![0])
        ])
    );
    assert_eq!(
        next(&mut stream).unwrap().err().unwrap().to_string(),
        "Voice.ai closed before input and contexts completed"
    );
    assert!(next(&mut stream).is_none());
}
