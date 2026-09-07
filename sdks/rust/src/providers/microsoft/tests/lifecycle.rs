use super::*;

#[test]
fn rejects_cross_turn_frames_and_premature_completion() {
    let id = "101112131415461798191a1b1c1d1e1f";
    for (frames, closed, expected) in [
        (
            vec![text_frame("turn.start", "other", "{}")],
            false,
            "Microsoft returned an unexpected synthesis request ID",
        ),
        (
            vec![text_frame("turn.end", id, "{}")],
            false,
            "Microsoft ended synthesis before text.end",
        ),
        (vec![], true, "Microsoft WebSocket closed before turn.end"),
        (
            vec![audio_frame(id, "other")],
            false,
            "Microsoft returned audio for an unexpected stream",
        ),
        (
            vec![text_frame("response", id, r#"{"audio":{}}"#)],
            false,
            "Microsoft synthesis response is missing audio.streamId",
        ),
        (
            vec![
                text_frame("response", id, r#"{"audio":{"streamId":"one"}}"#),
                text_frame("response", id, r#"{"audio":{"streamId":"two"}}"#),
            ],
            false,
            "Microsoft changed the audio stream within a synthesis turn",
        ),
    ] {
        let counts = Arc::new(Counts::default());
        let state = Arc::new(Mutex::new(SocketState {
            incoming: frames.into_iter().map(Ok).collect(),
            closed,
            ..Default::default()
        }));
        let mut stream = ready(synthesize(
            TtsRequest::StreamingTextVoicee86a65c0(streaming(Box::pin(Source {
                values: VecDeque::new(),
                counts: counts.clone(),
                stall: true,
                trace: Arc::default(),
            }))),
            Options {
                web_socket: Some(socket(state.clone(), Arc::default())),
                entropy: Some(&entropy),
                ..Default::default()
            },
        ))
        .unwrap();
        let Some(Err(error)) = next(&mut stream) else {
            panic!("expected protocol error")
        };
        assert_eq!(error.to_string(), expected);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(state.lock().unwrap().drops, 1);
        assert!(next(&mut stream).is_none());
    }
}

#[test]
fn acknowledgement_does_not_hide_a_pending_write_failure() {
    let state = Arc::new(Mutex::new(SocketState {
        auto: true,
        stall_path: Some("text.end".into()),
        ..Default::default()
    }));
    let mut stream = ready(synthesize(
        TtsRequest::StreamingTextVoicee86a65c0(streaming(source(vec![]))),
        Options {
            web_socket: Some(socket(state.clone(), Arc::default())),
            entropy: Some(&entropy),
            ..Default::default()
        },
    ))
    .unwrap();
    let mut cx = Context::from_waker(Waker::noop());
    for _ in 0..30 {
        assert!(Pin::new(&mut stream).poll_next(&mut cx).is_pending());
    }
    {
        let mut state = state.lock().unwrap();
        assert_eq!(state.sent.last().unwrap().path, "text.end");
        assert!(state.incoming.is_empty());
        assert!(state.pending);
        state.flush_error = Some(failure("late write failure"));
    }
    let Some(Err(error)) = next(&mut stream) else {
        panic!("expected write failure")
    };
    assert_eq!(error.to_string(), "late write failure");
    assert_eq!(state.lock().unwrap().drops, 1);
    assert!(next(&mut stream).is_none());
}

#[derive(Debug)]
struct Sentinel(Arc<()>);
impl std::fmt::Display for Sentinel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("sentinel")
    }
}
impl std::error::Error for Sentinel {}

#[test]
fn propagates_owned_input_and_transport_errors_without_wrapping() {
    for lane in ["input", "socket", "http"] {
        let identity = Arc::new(());
        let error: TransportError = Box::new(Sentinel(identity.clone()));
        let counts = Arc::new(Counts::default());
        let state = Arc::new(Mutex::new(SocketState::default()));
        let mut stream = if lane == "http" {
            let http = Http {
                requests: Mutex::default(),
                response: Mutex::new(Some(HttpResponse {
                    status: 200,
                    headers: vec![],
                    body: Box::pin(Source {
                        values: VecDeque::from([Err(error)]),
                        counts: counts.clone(),
                        stall: false,
                        trace: Arc::default(),
                    }),
                })),
            };
            ready(synthesize(
                TtsRequest::TextVoice4ff226b4(request()),
                Options {
                    auth: Some(&auth()),
                    transport: Some(&http),
                    ..Default::default()
                },
            ))
            .unwrap()
        } else {
            let values = if lane == "input" {
                VecDeque::from([Err(error)])
            } else {
                state.lock().unwrap().incoming.push_back(Err(error));
                VecDeque::new()
            };
            ready(synthesize(
                TtsRequest::StreamingTextVoicee86a65c0(streaming(Box::pin(Source {
                    values,
                    counts: counts.clone(),
                    stall: true,
                    trace: Arc::default(),
                }))),
                Options {
                    web_socket: Some(socket(state.clone(), Arc::default())),
                    entropy: Some(&entropy),
                    ..Default::default()
                },
            ))
            .unwrap()
        };
        let Some(Err(error)) = next(&mut stream) else {
            panic!("expected original error")
        };
        assert!(Arc::ptr_eq(
            &error.downcast_ref::<Sentinel>().unwrap().0,
            &identity
        ));
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(state.lock().unwrap().drops, usize::from(lane != "http"));
        assert!(next(&mut stream).is_none());
    }
}

#[test]
fn dropping_http_setup_cancels_pending_headers_and_error_body() {
    struct PendingHttp(Arc<Counts>);
    impl HttpTransport for PendingHttp {
        fn send(
            &self,
            _: HttpRequest,
        ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>>
        {
            Box::pin(async move {
                let _guard = super::boundary::Guard(self.0.clone());
                std::future::pending().await
            })
        }
    }
    let counts = Arc::new(Counts::default());
    let pending = PendingHttp(counts.clone());
    let body = Http {
        requests: Mutex::default(),
        response: Mutex::new(Some(HttpResponse {
            status: 429,
            headers: vec![],
            body: Box::pin(Source {
                values: VecDeque::new(),
                counts: counts.clone(),
                stall: true,
                trace: Arc::default(),
            }),
        })),
    };
    let auth = auth();
    for (index, transport) in [&pending as &dyn HttpTransport, &body]
        .into_iter()
        .enumerate()
    {
        let mut future = Box::pin(synthesize(
            TtsRequest::TextVoice4ff226b4(request()),
            Options {
                auth: Some(&auth),
                transport: Some(transport),
                ..Default::default()
            },
        ));
        let mut cx = Context::from_waker(Waker::noop());
        assert!(future.as_mut().poll(&mut cx).is_pending());
        drop(future);
        assert_eq!(counts.drops.load(Ordering::SeqCst), index + 1);
    }
}
