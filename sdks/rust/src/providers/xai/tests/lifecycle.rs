use super::*;

fn push(data: &Arc<Mutex<SocketData>>, wire: &str) {
    let mut data = data.lock().unwrap();
    data.incoming.push_back(Ok(Message::Text(wire.into())));
    if let Some(wake) = data.wake.take() {
        wake.wake();
    }
}
fn sent(data: &Arc<Mutex<SocketData>>) -> Vec<Value> {
    data.lock().unwrap().sent.iter().map(|v| value(v)).collect()
}

#[test]
fn clear_interrupts_a_flushing_utterance_and_gates_new_text_until_ack() {
    let data = Arc::default();
    let trace = Arc::default();
    let mut stream = native(
        source(vec![
            Input::String("old".into()),
            flush(),
            clear(),
            Input::String("new".into()),
        ]),
        &data,
        &trace,
    );
    assert!(poll(&mut stream).is_pending());
    assert_eq!(
        sent(&data),
        vec![
            value(r#"{"type":"text.delta","delta":"old"}"#),
            value(r#"{"type":"text.done"}"#),
            value(r#"{"type":"text.clear"}"#)
        ]
    );
    push(&data, r#"{"type":"audio.delta","delta":"AA=="}"#);
    push(&data, r#"{"type":"audio.done"}"#);
    assert!(poll(&mut stream).is_pending());
    assert_eq!(sent(&data).len(), 3);
    push(&data, r#"{"type":"audio.clear"}"#);
    assert_eq!(
        output(next(&mut stream).unwrap().unwrap()),
        value(r#"{"event":"clear"}"#)
    );
    assert!(poll(&mut stream).is_pending());
    assert_eq!(
        &sent(&data)[3..],
        [
            value(r#"{"type":"text.delta","delta":"new"}"#),
            value(r#"{"type":"text.done"}"#)
        ]
    );
    push(&data, r#"{"type":"audio.done","trace_id":"new"}"#);
    assert_eq!(
        output(next(&mut stream).unwrap().unwrap()),
        value(r#"{"event":"done","traceId":"new"}"#)
    );
    assert!(next(&mut stream).is_none());
}

#[test]
fn next_text_is_not_sent_early_and_input_order_is_never_skipped() {
    let data = Arc::default();
    let trace = Arc::default();
    let mut stream = native(
        source(vec![
            Input::String("one".into()),
            flush(),
            Input::String("two".into()),
            clear(),
        ]),
        &data,
        &trace,
    );
    assert!(poll(&mut stream).is_pending());
    assert_eq!(sent(&data).len(), 2);
    push(&data, r#"{"type":"audio.done"}"#);
    assert_eq!(
        output(next(&mut stream).unwrap().unwrap()),
        value(r#"{"event":"done","traceId":null}"#)
    );
    assert!(poll(&mut stream).is_pending());
    assert_eq!(
        &sent(&data)[2..],
        [
            value(r#"{"type":"text.delta","delta":"two"}"#),
            value(r#"{"type":"text.clear"}"#)
        ]
    );
}

#[test]
fn pending_writes_do_not_block_audio_but_done_cannot_hide_write_failure() {
    let data = Arc::new(Mutex::new(SocketData {
        block_flush: true,
        ..Default::default()
    }));
    let trace = Arc::default();
    let mut stream = native(source(vec![Input::String("Hello".into())]), &data, &trace);
    assert!(poll(&mut stream).is_pending());
    push(&data, r#"{"type":"audio.delta","delta":"AP+A"}"#);
    assert_eq!(
        output(next(&mut stream).unwrap().unwrap()),
        Value::Binary(vec![0, 255, 128])
    );
    data.lock().unwrap().block_flush = false;
    assert!(poll(&mut stream).is_pending());
    assert_eq!(sent(&data).len(), 2);
    drop(stream);
    let data = Arc::new(Mutex::new(SocketData {
        block_done: true,
        ..Default::default()
    }));
    let mut stream = native(source(vec![Input::String("Hello".into())]), &data, &trace);
    assert!(poll(&mut stream).is_pending());
    push(&data, r#"{"type":"audio.done"}"#);
    assert!(poll(&mut stream).is_pending());
    data.lock().unwrap().flush_error = Some("write failed");
    assert_eq!(
        next(&mut stream).unwrap().err().unwrap().to_string(),
        "write failed"
    );
    assert!(next(&mut stream).is_none());
}

#[test]
fn unsolicited_audio_is_rejected_before_later_input_can_authorize_it() {
    let data = Arc::default();
    let mut stream = native(
        source(vec![Input::String("Hello".into()), flush()]),
        &data,
        &Arc::default(),
    );
    push(&data, r#"{"type":"audio.delta","delta":"AA=="}"#);
    assert_eq!(
        next(&mut stream).unwrap().err().unwrap().to_string(),
        "xAI returned audio without an active utterance"
    );
    assert!(next(&mut stream).is_none());
}

#[test]
fn drop_releases_socket_before_input_and_terminal_error_is_emitted_once() {
    let data = Arc::default();
    let trace: Arc<Mutex<Vec<&'static str>>> = Arc::default();
    let counts = Arc::new(Counts::default());
    let input = Box::pin(Source {
        values: VecDeque::new(),
        counts: counts.clone(),
        stall: true,
        trace: trace.clone(),
    });
    let mut stream = native(input, &data, &trace);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
    assert!(poll(&mut stream).is_pending());
    drop(stream);
    assert_eq!(*trace.lock().unwrap(), ["socket", "input"]);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    for (wire, expected) in [
        (
            r#"{"type":"audio.clear"}"#,
            "Unexpected xAI audio.clear acknowledgement",
        ),
        (
            r#"{"type":"audio.done"}"#,
            "Unexpected xAI audio.done acknowledgement",
        ),
        (
            r#"{"type":"session.updated","replace":{}}"#,
            "Unexpected xAI session.updated acknowledgement",
        ),
    ] {
        let data = Arc::default();
        let mut stream = native(source(vec![]), &data, &Arc::default());
        push(&data, wire);
        assert_eq!(
            next(&mut stream).unwrap().err().unwrap().to_string(),
            expected
        );
        assert!(next(&mut stream).is_none());
    }
}

#[test]
fn validation_precedes_io_and_owned_overrides_are_dropped_on_failure() {
    let data = Arc::default();
    let trace = Arc::default();
    let mut req = request();
    req.speed = Some(2.0);
    let req = TtsRequest::Text(req);
    let expected = validate_request(&req).err().unwrap().to_string();
    let result = ready(synthesize(
        req,
        Options {
            auth: Some(&auth()),
            web_socket: Some(socket(&data, &trace)),
            ..Default::default()
        },
    ));
    assert_eq!(result.err().unwrap().to_string(), expected);
    assert_eq!(*trace.lock().unwrap(), ["socket"]);
    assert_eq!(sent(&data), []);
    for key in ["", "secret\nvalue", "snow雪"] {
        let mut auth = auth();
        auth.xai.as_mut().unwrap().api_key = Some(key.into());
        let expected = if key.is_empty() {
            "Missing auth.xai.apiKey configuration"
        } else {
            "xAI API key must contain only visible ASCII characters"
        };
        assert_eq!(
            ready(synthesize(
                TtsRequest::Text(request()),
                Options {
                    auth: Some(&auth),
                    ..Default::default()
                }
            ))
            .err()
            .unwrap()
            .to_string(),
            expected
        );
    }
}

struct Backend {
    socket: Mutex<Option<Socket>>,
    requests: Mutex<Vec<ConnectRequest>>,
    pending: bool,
}
impl WebSocketTransport for Backend {
    fn connect(
        &self,
        request: ConnectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<Socket, TransportError>> + Send + '_>> {
        self.requests.lock().unwrap().push(request);
        Box::pin(async {
            if self.pending {
                std::future::pending().await
            } else {
                Ok(self.socket.lock().unwrap().take().unwrap())
            }
        })
    }
    fn random_bytes(&self, _bytes: &mut [u8]) -> Result<(), TransportError> {
        panic!("xAI needs no context entropy")
    }
}

#[test]
fn native_upgrade_auth_and_full_url_preserve_proxy_paths_and_replace_managed_query() {
    let data = Arc::default();
    let trace = Arc::default();
    let backend = Backend {
        socket: Mutex::new(Some(socket(&data, &trace))),
        requests: Mutex::default(),
        pending: false,
    };
    let stream = ready(synthesize(live(source(vec![])),Options { auth: Some(&auth()), web_socket_transport: Some(&backend), web_socket_url: Some("https://proxy.test/a%2Fb/?tenant=x%20y&language=fr&%6canguage=en&codec=mp3&voice=old&tag=a;b"), ..Default::default() })).unwrap();
    let requests = backend.requests.lock().unwrap();
    assert_eq!(requests.len(), 1);
    assert_eq!(
        requests[0].url,
        "wss://proxy.test/a%2Fb/?tenant=x%20y&tag=a;b&language=auto"
    );
    assert_eq!(
        requests[0].headers,
        [("Authorization".into(), "Bearer fixture".into())]
    );
    assert_eq!(requests[0].max_message_bytes, 4 * 1024 * 1024);
    assert_eq!(sent(&data), []);
    drop(stream);
    assert_eq!(*trace.lock().unwrap(), ["socket"]);
}

#[test]
fn dropping_pending_handshake_never_polls_the_producer() {
    let counts = Arc::new(Counts::default());
    let trace = Arc::default();
    let backend = Backend {
        socket: Mutex::new(None),
        requests: Mutex::default(),
        pending: true,
    };
    let credentials = auth();
    let mut future = Box::pin(synthesize(
        live(Box::pin(Source {
            values: VecDeque::new(),
            counts: counts.clone(),
            stall: true,
            trace,
        })),
        Options {
            auth: Some(&credentials),
            web_socket_transport: Some(&backend),
            ..Default::default()
        },
    ));
    let waker = Waker::from(Arc::new(Counts::default()));
    assert!(future
        .as_mut()
        .poll(&mut Context::from_waker(&waker))
        .is_pending());
    assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
    drop(future);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn invalid_endpoints_and_failed_http_headers_never_read_private_response_bodies() {
    for url in [
        "https://user:secret@host",
        "https://host/#x",
        "https://host/%",
        "https://host/?x=%GG",
        "https://host:65536",
        "https://[bad]/",
    ] {
        assert_eq!(
            endpoint(url, "/v1/tts", false).err().unwrap().to_string(),
            "Invalid xAI endpoint"
        );
    }
    for (status, mime, expected) in [
        (401, "application/json", "xAI returned HTTP 401"),
        (
            200,
            "text/html",
            "xAI returned an unexpected audio content type",
        ),
    ] {
        let counts = Arc::new(Counts::default());
        let http = Http {
            requests: Mutex::default(),
            response: Mutex::new(Some(HttpResponse {
                status,
                headers: vec![("Content-Type".into(), mime.into())],
                body: Box::pin(Source {
                    values: VecDeque::new(),
                    counts: counts.clone(),
                    stall: true,
                    trace: Arc::default(),
                }),
            })),
        };
        assert_eq!(
            ready(synthesize(
                TtsRequest::Text(request()),
                Options {
                    auth: Some(&auth()),
                    transport: Some(&http),
                    ..Default::default()
                }
            ))
            .err()
            .unwrap()
            .to_string(),
            expected
        );
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn completion_waits_for_pending_write_success_and_update_acknowledgements() {
    let data = Arc::new(Mutex::new(SocketData {
        block_done: true,
        ..Default::default()
    }));
    let mut stream = native(
        source(vec![Input::String("Hello".into())]),
        &data,
        &Arc::default(),
    );
    assert!(poll(&mut stream).is_pending());
    push(&data, r#"{"type":"audio.done","trace_id":""}"#);
    assert!(poll(&mut stream).is_pending());
    data.lock().unwrap().block_flush = false;
    assert_eq!(
        output(next(&mut stream).unwrap().unwrap()),
        value(r#"{"event":"done","traceId":""}"#)
    );
    assert!(next(&mut stream).is_none());

    let data = Arc::default();
    let mut stream = native(
        source(vec![Input::String("Hello".into()), flush(), update()]),
        &data,
        &Arc::default(),
    );
    assert!(poll(&mut stream).is_pending());
    assert_eq!(
        sent(&data),
        vec![
            value(r#"{"type":"text.delta","delta":"Hello"}"#),
            value(r#"{"type":"text.done"}"#),
            value(r#"{"type":"session.update","replace":{}}"#)
        ]
    );
    push(&data, r#"{"type":"audio.done"}"#);
    assert_eq!(
        output(next(&mut stream).unwrap().unwrap()),
        value(r#"{"event":"done","traceId":null}"#)
    );
    assert!(poll(&mut stream).is_pending());
    push(&data, r#"{"type":"session.updated","replace":{}}"#);
    assert_eq!(output(next(&mut stream).unwrap().unwrap()), value("[]"));
    assert!(next(&mut stream).is_none());
}

#[test]
fn socket_start_receive_and_early_close_fail_once_and_release_io() {
    for (start_error, closed, incoming, expected) in [
        (true, false, None, "start failed"),
        (
            false,
            true,
            None,
            "xAI socket closed before synthesis completed",
        ),
        (false, false, Some(failure("read failed")), "read failed"),
    ] {
        let data = Arc::new(Mutex::new(SocketData {
            start_error,
            closed,
            incoming: incoming.into_iter().map(Err).collect(),
            ..Default::default()
        }));
        let trace = Arc::default();
        let mut stream = native(source(vec![Input::String("Hello".into())]), &data, &trace);
        assert_eq!(
            next(&mut stream).unwrap().err().unwrap().to_string(),
            expected
        );
        assert!(next(&mut stream).is_none());
        assert_eq!(*trace.lock().unwrap(), ["socket"]);
    }
}

#[test]
fn outgoing_cap_and_input_errors_release_socket_before_producer() {
    let data = Arc::default();
    let trace: Arc<Mutex<Vec<&'static str>>> = Arc::default();
    let input = Box::pin(Source {
        values: [Err(failure("producer failed"))].into(),
        counts: Arc::default(),
        stall: false,
        trace: trace.clone(),
    });
    let mut stream = native(input, &data, &trace);
    assert_eq!(
        next(&mut stream).unwrap().err().unwrap().to_string(),
        "producer failed"
    );
    assert_eq!(*trace.lock().unwrap(), ["socket", "input"]);
    let data = Arc::default();
    let trace = Arc::default();
    let mut stream = ready(synthesize(
        live(source(vec![update()])),
        Options {
            auth: Some(&auth()),
            web_socket: Some(socket(&data, &trace)),
            max_message_bytes: 1,
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        next(&mut stream).unwrap().err().unwrap().to_string(),
        "xAI message exceeds max_message_bytes"
    );
    assert_eq!(sent(&data), []);
    assert_eq!(*trace.lock().unwrap(), ["socket"]);
}

#[test]
fn http_stream_is_lazy_and_dropping_timed_or_raw_response_releases_body() {
    for timed in [false, true] {
        let counts = Arc::new(Counts::default());
        let http = Http {
            requests: Mutex::default(),
            response: Mutex::new(Some(HttpResponse {
                status: 200,
                headers: vec![],
                body: Box::pin(Source {
                    values: VecDeque::new(),
                    counts: counts.clone(),
                    stall: true,
                    trace: Arc::default(),
                }),
            })),
        };
        let mut req = request();
        if timed {
            req.timestamp_granularity = Some(Default::default());
        }
        let mut stream = ready(synthesize(
            TtsRequest::Text(req),
            Options {
                auth: Some(&auth()),
                transport: Some(&http),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        assert!(poll(&mut stream).is_pending());
        drop(stream);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn bounded_discovery_rejects_invalid_shapes_and_cancels_when_dropped() {
    for (wire, limit, expected) in [
        ("{}", 1024, "Invalid xAI voices response"),
        (r#"{"voices":[{"name":"a"}]}"#, 1024, "Invalid xAI voice"),
        (
            r#"{"voices":[{"name":"a","voice_id":"a","language":false}]}"#,
            1024,
            "Invalid xAI voice",
        ),
        ("{}", 1, "xAI response exceeds max_response_bytes"),
        ("invalid", 1024, "Invalid xAI JSON"),
    ] {
        let http = http(wire.as_bytes().to_vec(), "application/json");
        assert_eq!(
            ready(voices(VoiceOptions {
                auth: Some(&auth()),
                transport: Some(&http),
                max_response_bytes: limit,
                ..Default::default()
            }))
            .err()
            .unwrap()
            .to_string(),
            expected
        );
    }
    let counts = Arc::new(Counts::default());
    let http = Http {
        requests: Mutex::default(),
        response: Mutex::new(Some(HttpResponse {
            status: 200,
            headers: vec![],
            body: Box::pin(Source {
                values: VecDeque::new(),
                counts: counts.clone(),
                stall: true,
                trace: Arc::default(),
            }),
        })),
    };
    let credentials = auth();
    let mut future = Box::pin(voices(VoiceOptions {
        auth: Some(&credentials),
        transport: Some(&http),
        ..Default::default()
    }));
    let waker = Waker::from(Arc::new(Counts::default()));
    assert!(future
        .as_mut()
        .poll(&mut Context::from_waker(&waker))
        .is_pending());
    drop(future);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}
