use super::*;

struct Backend {
    requests: Mutex<Vec<ConnectRequest>>,
    socket: Mutex<Option<Socket>>,
    stall: bool,
    reject: bool,
    drops: Arc<Counts>,
}
pub(super) struct Guard(pub(super) Arc<Counts>);
impl Drop for Guard {
    fn drop(&mut self) {
        self.0.drops.fetch_add(1, Ordering::SeqCst);
    }
}
impl WebSocketTransport for Backend {
    fn connect(
        &self,
        request: ConnectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<Socket, TransportError>> + Send + '_>> {
        Box::pin(async move {
            let _guard = Guard(self.drops.clone());
            self.requests.lock().unwrap().push(request);
            if self.stall {
                std::future::pending::<()>().await;
            }
            if self.reject {
                return Err(failure("rejected"));
            }
            Ok(self.socket.lock().unwrap().take().unwrap())
        })
    }
    fn random_bytes(&self, bytes: &mut [u8]) -> Result<(), TransportError> {
        entropy(bytes)
    }
}
#[test]
fn backend_auth_routes_and_handshake_ownership() {
    for live in [false, true] {
        for token in [false, true] {
            for explicit in [false, true] {
                let state = Arc::new(Mutex::new(SocketState::default()));
                let backend = Backend {
                    requests: Mutex::default(),
                    socket: Mutex::new(Some(socket(state.clone(), Arc::default()))),
                    stall: false,
                    reject: false,
                    drops: Arc::default(),
                };
                let mut auth = auth();
                if token {
                    auth.microsoft.as_mut().unwrap().access_token = Some("token".into());
                }
                let input_counts = Arc::new(Counts::default());
                let input = Box::pin(Source {
                    values: VecDeque::new(),
                    counts: input_counts.clone(),
                    stall: true,
                    trace: Arc::default(),
                });
                let r = if live {
                    TtsRequest::StreamingTextVoicee86a65c0(streaming(input))
                } else {
                    TtsRequest::TextVoicef6245d6f(TtsRequestTextVoicef6245d6f {
                        text: "Hi".into(),
                        voice: "en-US-AvaNeural".into(),
                        emotion: None,
                        input_type: None,
                        language: None,
                        model: None,
                        output: None,
                        pitch_semitones: None,
                        speed: None,
                        volume_scale: None,
                        timestamp_granularity:
                            TtsRequestStreamingTextVoicee86a65c0TimestampGranularity::Word(
                                Default::default(),
                            ),
                    })
                };
                let stream = ready(synthesize(
                    r,
                    Options {
                        auth: Some(&auth),
                        web_socket_transport: Some(&backend),
                        base_url: Some("https://proxy.invalid/a%2Fb/?tenant=one"),
                        web_socket_url: explicit
                            .then_some("wss://proxy.invalid/custom%2Fendpoint?tenant=one"),
                        deployment_id: Some("existing/1"),
                        ..Default::default()
                    },
                ))
                .unwrap();
                assert_eq!(input_counts.reads.load(Ordering::SeqCst), 0);
                drop(stream);
                assert_eq!(state.lock().unwrap().drops, 1);
                let requests = backend.requests.lock().unwrap();
                assert_eq!(requests.len(), 1);
                let r = &requests[0];
                let suffix = if explicit {
                    "custom%2Fendpoint"
                } else if live {
                    "a%2Fb/cognitiveservices/websocket/v2"
                } else {
                    "a%2Fb/tts/cognitiveservices/websocket/v1"
                };
                assert_eq!(
                    r.url,
                    format!("wss://proxy.invalid/{suffix}?tenant=one&deploymentId=existing%2F1")
                );
                assert_eq!(
                    r.headers,
                    vec![
                        (
                            if token {
                                "Authorization"
                            } else {
                                "Ocp-Apim-Subscription-Key"
                            }
                            .into(),
                            if token { "Bearer token" } else { "key" }.into()
                        ),
                        (
                            "X-ConnectionId".into(),
                            "000102030405460788090a0b0c0d0e0f".into()
                        )
                    ]
                );
                assert_eq!(r.max_message_bytes, 4 * 1024 * 1024);
            }
        }
    }
    for reject in [false, true] {
        let counts = Arc::new(Counts::default());
        let backend = Backend {
            requests: Mutex::default(),
            socket: Mutex::new(None),
            stall: !reject,
            reject,
            drops: Arc::default(),
        };
        let auth = auth();
        let input = Box::pin(Source {
            values: VecDeque::new(),
            counts: counts.clone(),
            stall: true,
            trace: Arc::default(),
        });
        let future = synthesize(
            TtsRequest::StreamingTextVoicee86a65c0(streaming(input)),
            Options {
                auth: Some(&auth),
                web_socket_transport: Some(&backend),
                ..Default::default()
            },
        );
        let mut future = Box::pin(future);
        let mut cx = Context::from_waker(Waker::noop());
        if reject {
            match future.as_mut().poll(&mut cx) {
                Poll::Ready(Err(err)) => assert_eq!(err.to_string(), "rejected"),
                _ => panic!("expected rejection"),
            }
        } else {
            assert!(future.as_mut().poll(&mut cx).is_pending());
        }
        drop(future);
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(backend.drops.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn drop_never_overwrites_a_stalled_frame() {
    for path in [
        "speech.config",
        "synthesis.context",
        "text.piece",
        "text.end",
    ] {
        let trace = Arc::new(Mutex::new(vec![]));
        let counts = Arc::new(Counts::default());
        let state = Arc::new(Mutex::new(SocketState {
            stall_path: Some(path.into()),
            ..Default::default()
        }));
        let input = Box::pin(Source {
            values: VecDeque::from([Ok("Hi".into())]),
            counts: counts.clone(),
            stall: path != "text.end",
            trace: trace.clone(),
        });
        let mut stream = ready(synthesize(
            TtsRequest::StreamingTextVoicee86a65c0(streaming(input)),
            Options {
                web_socket: Some(socket(state.clone(), trace.clone())),
                entropy: Some(&entropy),
                ..Default::default()
            },
        ))
        .unwrap();
        let mut cx = Context::from_waker(Waker::noop());
        for _ in 0..30 {
            assert!(Pin::new(&mut stream).poll_next(&mut cx).is_pending());
        }
        let before = state.lock().unwrap().sent.len();
        drop(stream);
        let state = state.lock().unwrap();
        assert_eq!(state.sent.len(), before);
        assert_eq!(state.sent.last().unwrap().path, path);
        assert_eq!(state.drops, 1);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        if path != "text.end" {
            assert_eq!(*trace.lock().unwrap(), vec!["socket", "input"]);
        }
    }
}

#[test]
fn drop_stalled_stop_and_unread_stream_are_nonblocking() {
    for unread in [false, true] {
        let trace = Arc::new(Mutex::new(vec![]));
        let counts = Arc::new(Counts::default());
        let state = Arc::new(Mutex::new(SocketState {
            stall_path: Some("synthesis.control".into()),
            ..Default::default()
        }));
        let input = Box::pin(Source {
            values: VecDeque::new(),
            counts: counts.clone(),
            stall: true,
            trace: trace.clone(),
        });
        let mut stream = ready(synthesize(
            TtsRequest::StreamingTextVoicee86a65c0(streaming(input)),
            Options {
                web_socket: Some(socket(state.clone(), trace.clone())),
                entropy: Some(&entropy),
                ..Default::default()
            },
        ))
        .unwrap();
        if !unread {
            let mut cx = Context::from_waker(Waker::noop());
            for _ in 0..10 {
                assert!(Pin::new(&mut stream).poll_next(&mut cx).is_pending());
            }
        }
        drop(stream);
        assert_eq!(*trace.lock().unwrap(), vec!["socket", "input"]);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        let state = state.lock().unwrap();
        assert_eq!(state.drops, 1);
        if unread {
            assert!(state.sent.is_empty());
        } else {
            assert_eq!(state.sent.last().unwrap().path, "synthesis.control");
        }
    }
}

#[test]
fn http_error_limits_content_types_and_drop() {
    for (status, data, limit, message) in [
        (429, "quota", 100, "Microsoft synthesis failed (429): quota"),
        (307, "", 100, "Microsoft synthesis failed (307): "),
        (500, "abcd", 3, "Microsoft response exceeds max_json_bytes"),
    ] {
        let counts = Arc::new(Counts::default());
        let http = Http {
            requests: Mutex::default(),
            response: Mutex::new(Some(HttpResponse {
                status,
                headers: vec![("Retry-After".into(), "3".into())],
                body: Box::pin(Source {
                    values: VecDeque::from([Ok(data.as_bytes().to_vec())]),
                    counts: counts.clone(),
                    stall: false,
                    trace: Arc::default(),
                }),
            })),
        };
        let err = match ready(synthesize(
            TtsRequest::TextVoice4ff226b4(request()),
            Options {
                auth: Some(&auth()),
                transport: Some(&http),
                max_json_bytes: limit,
                ..Default::default()
            },
        )) {
            Err(err) => err,
            Ok(_) => panic!("expected error"),
        };
        assert_eq!(err.to_string(), message);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        if limit == 100 {
            let err = err.downcast_ref::<Error>().unwrap();
            assert_eq!(err.status, Some(status));
            assert_eq!(err.retry_after.as_deref(), Some("3"));
        }
    }
    let counts = Arc::new(Counts::default());
    let http = Http {
        requests: Mutex::default(),
        response: Mutex::new(Some(HttpResponse {
            status: 200,
            headers: vec![("Content-Type".into(), "application/json".into())],
            body: Box::pin(Source {
                values: VecDeque::new(),
                counts: counts.clone(),
                stall: true,
                trace: Arc::default(),
            }),
        })),
    };
    let err = match ready(synthesize(
        TtsRequest::TextVoice4ff226b4(request()),
        Options {
            auth: Some(&auth()),
            transport: Some(&http),
            ..Default::default()
        },
    )) {
        Err(err) => err,
        Ok(_) => panic!("expected error"),
    };
    assert_eq!(err.to_string(), "Microsoft returned a non-audio response");
    assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn malformed_frames_metadata_and_timestamps() {
    for (message, error) in [
        (
            Message::Binary(vec![0]),
            "Microsoft binary frame is missing its header length",
        ),
        (
            Message::Binary(vec![0, 3, 1]),
            "Microsoft binary frame has a truncated header",
        ),
        (
            Message::Binary(vec![0, 1, 255]),
            "Microsoft binary frame has invalid UTF-8 headers",
        ),
        (
            Message::Text("no separator".into()),
            "Microsoft text frame is missing its header separator",
        ),
        (
            Message::Text("Path: audio\r\npath: response\r\nX-RequestId: id\r\n\r\n".into()),
            "Microsoft frame repeats header path",
        ),
    ] {
        let err = protocol::decode(message, 1000).err().unwrap();
        assert_eq!(err.to_string(), error);
    }
    for (data, message) in [
        (
            r#"{"Metadata":null}"#,
            "Microsoft returned invalid synthesis Metadata",
        ),
        (
            r#"{"Metadata":[{"Type":"WordBoundary","Data":{"Offset":true}}]}"#,
            "Microsoft returned invalid metadata Offset",
        ),
        (
            r#"{"Metadata":[{"Type":"SessionEnd","Data":{"Offset":1}},{"Type":"SessionEnd","Data":{"Offset":2}}]}"#,
            "Microsoft returned duplicate SessionEnd metadata",
        ),
    ] {
        assert_eq!(
            protocol::metadata(protocol::object(data).unwrap())
                .err()
                .unwrap()
                .to_string(),
            message
        );
    }
    use std::time::{Duration, UNIX_EPOCH};
    for (seconds, text) in [
        (0, "1970-01-01T00:00:00.123Z"),
        (951782400, "2000-02-29T00:00:00.123Z"),
        (4107542400, "2100-03-01T00:00:00.123Z"),
    ] {
        assert_eq!(
            protocol::timestamp(UNIX_EPOCH + Duration::new(seconds, 123000000)).unwrap(),
            text
        );
    }
}
