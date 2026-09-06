use super::*;

#[test]
fn premature_close_and_write_errors_are_terminal_without_starving_input() {
    for phase in ["send", "flush", "close"] {
        let counts = Arc::new(Counts::default());
        let input_counts = Arc::new(Counts::default());
        let mut socket = script(&counts);
        let expected = if phase == "close" {
            socket.close = true;
            "Deepgram WebSocket closed before input completion"
        } else {
            if phase == "send" {
                socket.send_error = Some(failure("original write"));
            } else {
                socket.flush_error = Some(failure("original write"));
            }
            // Sustained ready audio must not starve the input/write failure.
            socket
                .incoming
                .extend((0..100).map(|_| Ok(Message::Binary(vec![1]))));
            "original write"
        };
        let auth = auth();
        let mut stream = ready(synthesize(
            streaming(
                0,
                source(
                    vec![Ok(settings::Input::String("Hello".into()))],
                    &input_counts,
                    true,
                ),
            ),
            Options {
                auth: Some(&auth),
                web_socket: Some(Box::pin(socket)),
                ..Default::default()
            },
        ))
        .unwrap();
        let mut delivered = 0;
        loop {
            match next(&mut stream).unwrap() {
                Ok(v) => {
                    assert_eq!(item(v), parse("[1]"));
                    delivered += 1;
                    assert!(delivered <= 2);
                }
                Err(error) => {
                    assert_eq!(error.to_string(), expected);
                    break;
                }
            }
        }
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(input_counts.drops.load(Ordering::SeqCst), 1);
        assert!(next(&mut stream).is_none());
    }
}

struct PendingHttp(Arc<Counts>);
impl HttpTransport for PendingHttp {
    fn send(
        &self,
        _: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        Box::pin(async {
            struct Guard(Arc<Counts>);
            impl Drop for Guard {
                fn drop(&mut self) {
                    self.0.drops.fetch_add(1, Ordering::SeqCst);
                }
            }
            let _guard = Guard(self.0.clone());
            std::future::pending().await
        })
    }
}
#[test]
fn drop_cancels_pending_http_headers() {
    let counts = Arc::new(Counts::default());
    let http = PendingHttp(counts.clone());
    let auth = auth();
    let mut future = Box::pin(synthesize(
        whole(),
        Options {
            auth: Some(&auth),
            transport: Some(&http),
            ..Default::default()
        },
    ));
    let waker = Waker::from(Arc::new(Counts::default()));
    assert!(future
        .as_mut()
        .poll(&mut Context::from_waker(&waker))
        .is_pending());
    assert_eq!(counts.drops.load(Ordering::SeqCst), 0);
    drop(future);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

fn error(result: Result<Stream, TransportError>) -> String {
    match result {
        Ok(_) => panic!("expected error"),
        Err(error) => error.to_string(),
    }
}
fn poll_pending(stream: &mut Stream) {
    let counts = Arc::new(Counts::default());
    let waker = Waker::from(counts.clone());
    let mut cx = Context::from_waker(&waker);
    for _ in 0..100 {
        let wakes = counts.wakes.load(Ordering::SeqCst);
        assert!(Pin::new(&mut *stream).poll_next(&mut cx).is_pending());
        if counts.wakes.load(Ordering::SeqCst) == wakes {
            return;
        }
    }
    panic!("stream busy loops")
}

#[test]
fn http_errors_close_unread_and_are_terminal() {
    for (status, content_type, expected) in [
        (
            429,
            "application/json",
            "HTTP request failed with status 429",
        ),
        (
            200,
            "text/html",
            "Deepgram returned an unexpected audio content type",
        ),
    ] {
        let counts = Arc::new(Counts::default());
        let http = http(
            source(vec![Ok(vec![99])], &counts, true),
            status,
            content_type,
        );
        let auth = auth();
        assert_eq!(
            error(ready(synthesize(
                whole(),
                Options {
                    auth: Some(&auth),
                    transport: Some(&http),
                    ..Default::default()
                }
            ))),
            expected
        );
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
    for (chunks, expected) in [
        (vec![], "Deepgram returned an empty audio response"),
        (vec![Err(failure("original read"))], "original read"),
    ] {
        let counts = Arc::new(Counts::default());
        let http = http(
            source(chunks, &counts, false),
            200,
            "application/octet-stream",
        );
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
        assert_eq!(
            next(&mut stream).unwrap().err().unwrap().to_string(),
            expected
        );
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert!(next(&mut stream).is_none());
    }
}

#[test]
fn drop_cancels_unread_or_pending_http_and_socket_ownership() {
    for poll in [false, true] {
        let counts = Arc::new(Counts::default());
        let http = http(source(vec![], &counts, true), 200, "audio/pcm");
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
        if poll {
            poll_pending(&mut stream);
        }
        drop(stream);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);

        let socket_counts = Arc::new(Counts::default());
        let input_counts = Arc::new(Counts::default());
        let mut stream = ready(synthesize(
            streaming(0, source(vec![], &input_counts, true)),
            Options {
                auth: Some(&auth),
                web_socket: Some(Box::pin(script(&socket_counts))),
                ..Default::default()
            },
        ))
        .unwrap();
        if poll {
            poll_pending(&mut stream);
        }
        drop(stream);
        assert_eq!(socket_counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(input_counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(
            input_counts.reads.load(Ordering::SeqCst),
            if poll { 1 } else { 0 }
        );
    }
}

#[test]
fn pending_write_does_not_block_audio_or_prefetch_input() {
    let socket_counts = Arc::new(Counts::default());
    let input_counts = Arc::new(Counts::default());
    let mut socket = script(&socket_counts);
    socket.pending_write = true;
    socket.steps.push_back((
        parse(r#"{"type":"Speak","text":"Hello"}"#),
        vec![Message::Binary(vec![0, 255])],
    ));
    let auth = auth();
    let mut stream = ready(synthesize(
        streaming(
            0,
            source(
                vec![
                    Ok(settings::Input::String("Hello".into())),
                    Ok(settings::Input::String("unread".into())),
                ],
                &input_counts,
                false,
            ),
        ),
        Options {
            auth: Some(&auth),
            web_socket: Some(Box::pin(socket)),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(item(next(&mut stream).unwrap().unwrap()), parse("[0,255]"));
    poll_pending(&mut stream);
    assert_eq!(input_counts.reads.load(Ordering::SeqCst), 1);
    drop(stream);
    assert_eq!(socket_counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(input_counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn invalid_events_and_transport_errors_release_both_lanes_once() {
    for (text, expected) in [
        ("{", "Deepgram returned invalid JSON"),
        (
            r#"{"type":"Metadata","request_id":"\ud800"}"#,
            "Deepgram returned invalid JSON",
        ),
        ("[]", "Deepgram returned an invalid WebSocket event"),
        (
            r#"{"type":"Metadata"}"#,
            "Deepgram returned an invalid WebSocket event",
        ),
        (
            r#"{"type":"Flushed","sequence_id":-1}"#,
            "Deepgram returned an invalid WebSocket event",
        ),
        (
            r#"{"type":"Flushed","sequence_id":1.5}"#,
            "Deepgram returned an invalid WebSocket event",
        ),
        (
            r#"{"type":"Flushed","sequence_id":9007199254740992}"#,
            "Deepgram returned an invalid WebSocket event",
        ),
        (
            r#"{"type":"Flushed","sequence_id":"1"}"#,
            "Deepgram returned an invalid WebSocket event",
        ),
        (
            r#"{"type":"Flushed","sequence_id":0}"#,
            "Deepgram returned an unexpected Flushed acknowledgement",
        ),
        (
            r#"{"type":"Cleared","sequence_id":0}"#,
            "Deepgram returned an unexpected Cleared acknowledgement",
        ),
        (
            r#"{"type":"Other"}"#,
            "Deepgram returned an invalid WebSocket event",
        ),
        (
            r#"{"type":"Warning","code":"LIMIT","description":"too many flushes"}"#,
            "Deepgram Warning LIMIT: too many flushes",
        ),
        (
            r#"{"type":"Error","code":"BAD","description":"failed"}"#,
            "Deepgram Error BAD: failed",
        ),
        (
            r#"{"type":"Error","code":12,"description":"failed"}"#,
            "Deepgram returned an invalid error event",
        ),
    ] {
        let counts = Arc::new(Counts::default());
        let input_counts = Arc::new(Counts::default());
        let mut socket = script(&counts);
        socket.incoming.push_back(Ok(Message::Text(text.into())));
        let auth = auth();
        let mut stream = ready(synthesize(
            streaming(0, source(vec![], &input_counts, true)),
            Options {
                auth: Some(&auth),
                web_socket: Some(Box::pin(socket)),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(
            next(&mut stream).unwrap().err().unwrap().to_string(),
            expected
        );
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(input_counts.drops.load(Ordering::SeqCst), 1);
        assert!(next(&mut stream).is_none());
    }
    for input_error in [false, true] {
        let counts = Arc::new(Counts::default());
        let input_counts = Arc::new(Counts::default());
        let mut socket = script(&counts);
        let input = if input_error {
            vec![Err(failure("original error"))]
        } else {
            socket.incoming.push_back(Err(failure("original error")));
            vec![]
        };
        let auth = auth();
        let mut stream = ready(synthesize(
            streaming(0, source(input, &input_counts, true)),
            Options {
                auth: Some(&auth),
                web_socket: Some(Box::pin(socket)),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(
            next(&mut stream).unwrap().err().unwrap().to_string(),
            "original error"
        );
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(input_counts.drops.load(Ordering::SeqCst), 1);
        assert!(next(&mut stream).is_none());
    }
}

#[test]
fn schema_validation_precedes_auth_and_transport() {
    for speed in [0.6, 1.6, f64::NAN, f64::INFINITY] {
        let TtsRequest::Aura1TextVoice(mut r) = whole() else {
            unreachable!()
        };
        r.speed = Some(speed);
        assert!(ready(synthesize(
            TtsRequest::Aura1TextVoice(r),
            Options::default()
        ))
        .err()
        .unwrap()
        .is::<crate::runtime::ValidationError>());
    }
    let mut auth = auth();
    auth.deepgram.as_mut().unwrap().api_key = Some(String::new());
    assert_eq!(
        error(ready(synthesize(
            whole(),
            Options {
                auth: Some(&auth),
                ..Default::default()
            }
        ))),
        "Missing auth.deepgram.apiKey configuration"
    );
    assert_eq!(
        error(ready(synthesize(
            whole(),
            Options {
                max_message_bytes: 0,
                ..Default::default()
            }
        ))),
        "Deepgram max_message_bytes must be positive"
    );
}

#[test]
fn url_overrides_preserve_paths_but_cannot_override_owned_parameters() {
    let query = vec![
        ("model", "aura-asteria-en".into()),
        ("tag", "雪 a&b".into()),
    ];
    assert_eq!(speech_url("https://proxy.test/a%20b/v1/speak?trace=1&%6dodel=old&encoding=mp3&container=wav&sample_rate=1&bit_rate=1&speed=1&mip_opt_out=true&tag=old&api%5fkey=secret&access_token=secret", false, query).unwrap(),
        "https://proxy.test/a%20b/v1/speak?trace=1&model=aura-asteria-en&tag=%E9%9B%AA%20a%26b");
    for url in [
        "https://user:key@host",
        "https://host:65536",
        "https://host/#fragment",
        "https://host/ a",
        "wss://host/v1/speak",
        "https://host?bad%=x",
    ] {
        assert_eq!(
            speech_url(url, false, vec![]).err().unwrap().to_string(),
            if url.ends_with("bad%=x") {
                "Invalid Deepgram endpoint query"
            } else {
                "Invalid Deepgram endpoint URL"
            }
        );
    }
}

struct Backend {
    request: Mutex<Option<ConnectRequest>>,
    socket: Mutex<Option<Socket>>,
    pending: bool,
    counts: Arc<Counts>,
}
impl WebSocketTransport for Backend {
    fn connect(
        &self,
        request: ConnectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<Socket, TransportError>> + Send + '_>> {
        *self.request.lock().unwrap() = Some(request);
        Box::pin(async {
            struct Guard(Arc<Counts>);
            impl Drop for Guard {
                fn drop(&mut self) {
                    self.0.drops.fetch_add(1, Ordering::SeqCst);
                }
            }
            let _guard = Guard(self.counts.clone());
            if self.pending {
                std::future::pending::<()>().await;
            }
            Ok(self.socket.lock().unwrap().take().unwrap())
        })
    }
    fn random_bytes(&self, _: &mut [u8]) -> Result<(), TransportError> {
        panic!("Deepgram needs no random correlation")
    }
}
#[test]
fn native_connect_receives_header_auth_and_drop_cancels_handshake() {
    for pending in [false, true] {
        let counts = Arc::new(Counts::default());
        let input_counts = Arc::new(Counts::default());
        let socket_counts = Arc::new(Counts::default());
        let backend = Backend {
            request: Mutex::new(None),
            socket: Mutex::new(Some(Box::pin(script(&socket_counts)))),
            pending,
            counts: counts.clone(),
        };
        let auth = auth();
        let mut future = Box::pin(synthesize(
            streaming(0, source(vec![], &input_counts, true)),
            Options {
                auth: Some(&auth),
                web_socket_transport: Some(&backend),
                web_socket_url: Some("wss://proxy.test/v1/speak?api_key=old&tag=old&trace=1"),
                max_message_bytes: 4096,
                ..Default::default()
            },
        ));
        let waker = Waker::from(Arc::new(Counts::default()));
        let mut cx = Context::from_waker(&waker);
        if pending {
            assert!(future.as_mut().poll(&mut cx).is_pending());
        } else {
            drop(ready(&mut future).unwrap());
        }
        drop(future);
        let request = backend.request.lock().unwrap().take().unwrap();
        assert_eq!(
            request.url,
            "wss://proxy.test/v1/speak?trace=1&model=aura-asteria-en&encoding=linear16"
        );
        assert_eq!(
            request.headers,
            vec![("authorization".into(), "Token key".into())]
        );
        assert_eq!(request.max_message_bytes, 4096);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(input_counts.reads.load(Ordering::SeqCst), 0);
        assert_eq!(input_counts.drops.load(Ordering::SeqCst), 1);
        drop(backend);
        assert_eq!(socket_counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn message_limits_apply_to_native_binary_text_and_outgoing_text() {
    for frame in [Message::Binary(vec![0; 33]), Message::Text(" ".repeat(33))] {
        let counts = Arc::new(Counts::default());
        let mut socket = script(&counts);
        socket.incoming.push_back(Ok(frame));
        let auth = auth();
        let mut stream = ready(synthesize(
            streaming(0, source(vec![], &counts, true)),
            Options {
                auth: Some(&auth),
                web_socket: Some(Box::pin(socket)),
                max_message_bytes: 32,
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(
            next(&mut stream).unwrap().err().unwrap().to_string(),
            "Deepgram message exceeds max_message_bytes"
        );
        assert_eq!(counts.drops.load(Ordering::SeqCst), 2);
    }
    let counts = Arc::new(Counts::default());
    let socket = script(&counts);
    let sent = socket.sent.clone();
    let auth = auth();
    let mut stream = ready(synthesize(
        streaming(
            0,
            source(
                vec![Ok(settings::Input::String("Hello".into()))],
                &counts,
                true,
            ),
        ),
        Options {
            auth: Some(&auth),
            web_socket: Some(Box::pin(socket)),
            max_message_bytes: 16,
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        next(&mut stream).unwrap().err().unwrap().to_string(),
        "Deepgram message exceeds max_message_bytes"
    );
    assert_eq!(*sent.lock().unwrap(), Vec::<JsonValue>::new());
    assert_eq!(counts.drops.load(Ordering::SeqCst), 2);
}
