use super::*;
#[test]
fn auth_environment_child() {
    let Ok(expected) = std::env::var("SPEECHSWITCH_TEST_SMALLEST_AUTH") else {
        return;
    };
    let mut auth = auth();
    if expected == "explicit-empty" {
        auth.smallest_ai.as_mut().unwrap().api_key = Some(String::new())
    };
    let (backend, _) = http(vec![]);
    let result = ready(synthesize(
        whole(),
        Options {
            auth: if expected == "fixture" || expected == "explicit-empty" {
                Some(&auth)
            } else {
                None
            },
            transport: Some(&backend),
            ..Default::default()
        },
    ));
    if expected.is_empty() || expected == "explicit-empty" || expected == "invalid-env" {
        assert_eq!(
            result.err().unwrap().to_string(),
            if expected == "invalid-env" {
                "Invalid Smallest.ai environment credential"
            } else {
                "Missing auth.smallest.ai.apiKey configuration"
            }
        );
        assert_eq!(backend.requests.lock().unwrap().len(), 0)
    } else {
        drop(result.unwrap());
        assert_eq!(
            backend.requests.lock().unwrap()[0].headers[0],
            ("Authorization".into(), format!("Bearer {expected}"))
        )
    }
}

#[test]
fn auth_precedence_and_non_utf8_environment_are_isolated() {
    for (scoped, native, expected) in [
        (None, Some("legacy"), "legacy"),
        (Some("scoped"), Some("legacy"), "scoped"),
        (Some(""), Some("legacy"), ""),
        (None, None, ""),
        (Some("scoped"), Some("legacy"), "fixture"),
        (Some("scoped"), Some("legacy"), "explicit-empty"),
    ] {
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "providers::smallest_ai::tests::lifecycle::auth_environment_child",
                "--nocapture",
            ])
            .env("SPEECHSWITCH_TEST_SMALLEST_AUTH", expected);
        for (name, value) in [
            ("SPEECHSWITCH_SMALLEST_API_KEY", scoped),
            ("SMALLEST_API_KEY", native),
        ] {
            command.env_remove(name);
            if let Some(value) = value {
                command.env(name, value);
            }
        }
        let result = command.output().unwrap();
        assert_eq!(
            result.status.code(),
            Some(0),
            "{}{}",
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        );
    }
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStringExt;
        let result = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "providers::smallest_ai::tests::lifecycle::auth_environment_child",
                "--nocapture",
            ])
            .env("SPEECHSWITCH_TEST_SMALLEST_AUTH", "invalid-env")
            .env(
                "SPEECHSWITCH_SMALLEST_API_KEY",
                std::ffi::OsString::from_vec(vec![255]),
            )
            .env("SMALLEST_API_KEY", "legacy")
            .output()
            .unwrap();
        assert_eq!(
            result.status.code(),
            Some(0),
            "{}{}",
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        );
    }
}

struct Guard(Arc<Counts>);
impl Drop for Guard {
    fn drop(&mut self) {
        self.0.drops.fetch_add(1, Ordering::SeqCst);
    }
}
struct Backend {
    socket: Mutex<Option<Socket>>,
    requests: Mutex<Vec<ConnectRequest>>,
    pending: bool,
    counts: Arc<Counts>,
}
impl WebSocketTransport for Backend {
    fn random_bytes(&self, bytes: &mut [u8]) -> Result<(), TransportError> {
        entropy(bytes)
    }
    fn connect(
        &self,
        request: ConnectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<Socket, TransportError>> + Send + '_>> {
        Box::pin(async move {
            self.requests.lock().unwrap().push(request);
            let socket = self.socket.lock().unwrap().take().unwrap();
            let _guard = Guard(self.counts.clone());
            if self.pending {
                {
                    let pending: std::future::Pending<()> = std::future::pending();
                    pending.await
                }
            };
            Ok(socket)
        })
    }
}

#[test]
fn native_boundary_auth_query_and_detached_stream_ownership() {
    for pro in [false, true] {
        let (socket, state) = socket(true);
        let backend = Backend {
            socket: Mutex::new(Some(socket)),
            requests: Mutex::new(vec![]),
            pending: false,
            counts: Arc::new(Counts::default()),
        };
        let auth = auth();
        let request = if pro {
            let mut r = models::pro_request();
            r.pronunciation_dictionaries = None;
            r.content_retention_days = Some(Default::default());
            TtsRequest::LightningV31ProTextVoice74d06326(r)
        } else {
            let mut r = request();
            r.content_retention_days = Some(Default::default());
            TtsRequest::LightningV31TextVoice5e2ae2e5(r)
        };
        let mut stream = ready(synthesize(
            request,
            Options {
                auth: Some(&auth),
                web_socket_transport: Some(&backend),
                base_url: Some(
                    "https://proxy.example/prefix%2Fraw?tenant=a%2Bb&timeout=1&timeout=2",
                ),
                web_socket_url: if pro {
                    Some("wss://proxy.example/exact?tenant=a%2Bb&timeout=1&timeout=2")
                } else {
                    None
                },
                protocol: Some(Protocol::WebSocket),
                idle_timeout_seconds: if pro { 900 } else { 120 },
                max_message_bytes: 1024,
                ..Default::default()
            },
        ))
        .unwrap();
        let requests = backend.requests.lock().unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(
            requests[0].url,
            if pro {
                "wss://proxy.example/exact?tenant=a%2Bb&timeout=180"
            } else {
                "wss://proxy.example/prefix%2Fraw/waves/v1/tts/live?tenant=a%2Bb&timeout=120"
            }
        );
        assert_eq!(
            requests[0].headers,
            vec![
                ("Authorization".into(), "Bearer fixture".into()),
                ("x-expire-content".into(), "true".into())
            ]
        );
        assert_eq!(requests[0].max_message_bytes, 1024);
        drop(requests);
        drop(backend);
        drop(auth);
        assert_eq!(
            collect(&mut stream).unwrap(),
            vec![Item::Bytes(vec![0, 255, 128]), Item::Done]
        );
        assert_eq!(state.lock().unwrap().drops, 1);
    }
}

#[test]
fn dropping_handshake_future_owns_socket_and_unpolled_input() {
    let (socket, state) = socket(false);
    let counts = Arc::new(Counts::default());
    let backend = Backend {
        socket: Mutex::new(Some(socket)),
        requests: Mutex::new(vec![]),
        pending: true,
        counts: counts.clone(),
    };
    let (source, input_counts, _) = body(vec![], false);
    let auth = auth();
    let mut future = Box::pin(synthesize(
        streaming(source),
        Options {
            auth: Some(&auth),
            web_socket_transport: Some(&backend),
            ..Default::default()
        },
    ));
    let waker = Waker::from(Arc::new(Counts::default()));
    assert!(future
        .as_mut()
        .poll(&mut Context::from_waker(&waker))
        .is_pending());
    assert_eq!(input_counts.reads.load(Ordering::SeqCst), 0);
    drop(future);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(input_counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(state.lock().unwrap().drops, 1);
}

struct PendingHttp(Arc<Counts>);
impl HttpTransport for PendingHttp {
    fn send(
        &self,
        _: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        Box::pin(async move {
            let _guard = Guard(self.0.clone());
            let pending: std::future::Pending<()> = std::future::pending();
            pending.await;
            unreachable!()
        })
    }
}
#[test]
fn http_future_body_and_terminal_audio_release_resources() {
    let auth = auth();
    let counts = Arc::new(Counts::default());
    let transport = PendingHttp(counts.clone());
    let mut future = Box::pin(synthesize(
        whole(),
        Options {
            auth: Some(&auth),
            transport: Some(&transport),
            ..Default::default()
        },
    ));
    let waker = Waker::from(Arc::new(Counts::default()));
    assert!(future
        .as_mut()
        .poll(&mut Context::from_waker(&waker))
        .is_pending());
    drop(future);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    for sse in [false, true] {
        let bytes = if sse {
            b"data: {\"status\":\"206\",\"done\":false,\"audio\":\"AP+A\"}\n\n".to_vec()
        } else {
            vec![0, 255, 128]
        };
        let (body, counts, _) = body(vec![Ok(bytes)], false);
        let http = Http {
            response: Mutex::new(Some(HttpResponse {
                status: 200,
                headers: vec![],
                body,
            })),
            requests: Mutex::new(vec![]),
        };
        let mut stream = ready(synthesize(
            whole(),
            Options {
                auth: Some(&auth),
                transport: Some(&http),
                protocol: Some(if sse { Protocol::Sse } else { Protocol::Http }),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(
            item(pull(&mut stream).unwrap().unwrap()),
            Item::Bytes(vec![0, 255, 128])
        );
        tick(&mut stream);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 0);
        drop(stream);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
    let (http, counts) = http(vec![
        b"data: {\"status\":\"200\",\"done\":true,\"audio\":\"AA==\"}\n\n".to_vec(),
    ]);
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
        item(pull(&mut stream).unwrap().unwrap()),
        Item::Bytes(vec![0])
    );
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(item(pull(&mut stream).unwrap().unwrap()), Item::Done);
    assert!(pull(&mut stream).is_none());
}

#[test]
fn ordinary_input_preserves_fragments_and_no_prefetch_during_writes() {
    let (source, counts, _) = body(vec![Ok("  ".to_owned()), Ok("🚀".repeat(8001))], true);
    let (socket, state) = socket(false);
    state.lock().unwrap().flush_pending = true;
    state.lock().unwrap().block_final = true;
    let mut stream = live(streaming(source), socket);
    let first = sent(&mut stream, &state, 1);
    let first = Raw::parse_exact(&first).unwrap().object().unwrap();
    let id = first["request_id"].string().unwrap();
    assert_eq!(first["text"].string().unwrap(), "  ");
    assert_eq!(first["continue"].boolean().unwrap(), true);
    assert_eq!(first["max_buffer_flush_ms"].number().unwrap(), 0.0);
    assert_eq!(first["complete_backoff_ms"].number().unwrap(), 4000.0);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    packet(&state, CHUNK);
    assert_eq!(
        item(pull(&mut stream).unwrap().unwrap()),
        Item::Bytes(vec![0, 255, 128])
    );
    tick(&mut stream);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    state.lock().unwrap().flush_pending = false;
    let second = sent(&mut stream, &state, 2);
    assert_eq!(
        Raw::parse_exact(&second).unwrap().object().unwrap()["text"]
            .string()
            .unwrap(),
        "🚀".repeat(8001)
    );
    let final_message = sent(&mut stream, &state, 3);
    assert_eq!(
        value(&final_message),
        value(&format!(
            r#"{{"voice_id":"custom-uuid","model":"lightning_v3.1","language":"auto","sample_rate":44100,"output_format":"pcm","speed":1,"math_notation":false,"text":"","request_id":"{id}","continue":false,"flush":true,"max_buffer_flush_ms":0,"complete_backoff_ms":4000}}"#
        ))
    );
    packet(&state, COMPLETE);
    tick(&mut stream);
    tick(&mut stream);
    state.lock().unwrap().flush_pending = false;
    assert_eq!(item(pull(&mut stream).unwrap().unwrap()), Item::Done);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(state.lock().unwrap().drops, 1);
}

#[derive(Debug)]
struct Failure(Arc<()>);
impl std::fmt::Display for Failure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("fixture failure")
    }
}
impl std::error::Error for Failure {}

#[test]
fn final_write_failure_cannot_be_hidden_by_native_completion() {
    let (source, _, _) = body(vec![Ok("hello".to_owned())], true);
    let (socket, state) = socket(false);
    state.lock().unwrap().block_final = true;
    let mut stream = live(streaming(source), socket);
    sent(&mut stream, &state, 1);
    packet(&state, CHUNK);
    pull(&mut stream).unwrap().unwrap();
    sent(&mut stream, &state, 2);
    packet(&state, COMPLETE);
    tick(&mut stream);
    let identity = Arc::new(());
    state.lock().unwrap().flush_failure = Some(Box::new(Failure(identity.clone())));
    let error = pull(&mut stream).unwrap().err().unwrap();
    assert!(Arc::ptr_eq(
        &identity,
        &error.downcast_ref::<Failure>().unwrap().0
    ));
    assert_eq!(state.lock().unwrap().drops, 1);
}

#[test]
fn buffered_premature_completion_is_checked_before_later_input_eof() {
    let (source, counts, data) = body(vec![Ok("hello".to_owned())], false);
    let (socket, state) = socket(false);
    let mut stream = live(streaming(source), socket);
    sent(&mut stream, &state, 1);
    packet(&state, CHUNK);
    assert_eq!(
        item(pull(&mut stream).unwrap().unwrap()),
        Item::Bytes(vec![0, 255, 128])
    );
    packet(&state, COMPLETE);
    data.lock().unwrap().ended = true;
    let error = pull(&mut stream).unwrap().err().unwrap();
    assert_eq!(
        error.to_string(),
        "Smallest.ai completed before input ended"
    );
    assert_eq!(state.lock().unwrap().sent.len(), 1);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

fn timed_continuation(source: StreamingInput<Input>) -> TtsRequest {
    TtsRequest::LightningV31StreamingTextVoice90b1878c(
        TtsRequestLightningV31StreamingTextVoice90b1878c {
            continuation: TtsRequestLightningV31ProStreamingTextVoice8f1b36fbContinuation {
                id: "context".into(),
                max_buffer_delay_ms: None,
            },
            content_retention_days: None,
            formula_reading: None,
            language: None,
            model: Default::default(),
            number_pronunciation_language: None,
            output: None,
            request_id: None,
            session_id: None,
            speed: None,
            text: source,
            timestamp_granularity: Default::default(),
            voice: TtsRequestLightningV31ProStreamingTextVoice4f8c2395Voice::Meher(
                Default::default(),
            ),
        },
    )
}
#[test]
fn continuation_clear_batch_and_independent_word_audio_identity() {
    let (source, counts, data) = body(vec![Ok(text("first"))], false);
    let (socket, state) = socket(false);
    let mut stream = live(timed_continuation(source), socket);
    let first = sent(&mut stream, &state, 1);
    let first = Raw::parse_exact(&first).unwrap().object().unwrap();
    let old_id = first["request_id"].string().unwrap();
    assert_eq!(first["language"].string().unwrap(), "en");
    assert_eq!(first["max_buffer_delay_ms"].number().unwrap(), 3000.0);
    packet(
        &state,
        r#"{"status":"word_timestamp","request_id":"word-segment","data":{"id":2,"word":" first ","start":0.1,"end":0.25}}"#,
    );
    assert_eq!(
        item(pull(&mut stream).unwrap().unwrap()),
        Item::Envelope(
            "word-segment".into(),
            None,
            vec![(" first ".into(), 100.0, Some(250.0))],
            Some(2.0)
        )
    );
    data.lock().unwrap().values.push_back(Ok(clear()));
    assert_eq!(item(pull(&mut stream).unwrap().unwrap()), Item::Clear);
    assert_eq!(
        value(&sent(&mut stream, &state, 2)),
        value(r#"{"context_id":"context","cancel_request":true}"#)
    );
    data.lock().unwrap().values.push_back(Ok(text("second")));
    let second = sent(&mut stream, &state, 3);
    let id = Raw::parse_exact(&second).unwrap().object().unwrap()["request_id"]
        .string()
        .unwrap();
    assert_ne!(id, old_id);
    packet(
        &state,
        &format!(
            r#"{{"status":"chunk","request_id":"stale","external_request_id":"{old_id}","data":{{"audio":"AA=="}}}}"#
        ),
    );
    packet(
        &state,
        &format!(
            r#"{{"status":"complete","request_id":"stale","external_request_id":"{old_id}"}}"#
        ),
    );
    packet(
        &state,
        &format!(
            r#"{{"status":"chunk","request_id":"audio-segment","external_request_id":"{id}","data":{{"audio":"AP+A"}}}}"#
        ),
    );
    assert_eq!(
        item(pull(&mut stream).unwrap().unwrap()),
        Item::Envelope(
            "audio-segment".into(),
            Some(vec![0, 255, 128]),
            vec![],
            None
        )
    );
    data.lock().unwrap().ended = true;
    assert_eq!(
        value(&sent(&mut stream, &state, 4)),
        value(r#"{"context_id":"context","voice_id":"meher","continue":false}"#)
    );
    packet(
        &state,
        &format!(
            r#"{{"status":"complete","request_id":"batch-segment","external_request_id":"{id}"}}"#
        ),
    );
    assert_eq!(
        item(pull(&mut stream).unwrap().unwrap()),
        Item::Batch("batch-segment".into())
    );
    tick(&mut stream);
    assert_eq!(state.lock().unwrap().drops, 0);
    drop(stream);
    assert_eq!(state.lock().unwrap().drops, 1);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn clear_rejects_ambiguous_identity_and_does_not_mask_global_errors() {
    for (wire, want) in [
        (
            CHUNK,
            "Smallest.ai omitted external request identity after clear",
        ),
        (
            r#"{"status":"chunk","request_id":"r","external_request_id":"unknown","data":{"audio":"AA=="}}"#,
            "Smallest.ai returned an unknown external request identity after clear",
        ),
        (
            r#"{"status":"error","error":{"message":"failure","code":"native"}}"#,
            "failure",
        ),
    ] {
        let (source, _, _) = body(vec![Ok(clear())], false);
        let (socket, state) = socket(false);
        let mut stream = live(continuation(source), socket);
        assert_eq!(item(pull(&mut stream).unwrap().unwrap()), Item::Clear);
        packet(&state, wire);
        let error = pull(&mut stream).unwrap().err().unwrap();
        assert_eq!(error.to_string(), want);
        if want == "failure" {
            assert_eq!(
                error.downcast_ref::<Error>().unwrap().code.as_deref(),
                Some("native")
            );
        }
        assert_eq!(state.lock().unwrap().drops, 1);
    }
}

#[test]
fn empty_continuation_requires_caller_exit_but_ordinary_empty_input_finishes() {
    let (source, counts, _) = body(vec![], true);
    let (socket, state) = socket(false);
    let mut stream = live(streaming(source), socket);
    assert_eq!(collect(&mut stream).unwrap(), vec![Item::Done]);
    assert_eq!(state.lock().unwrap().sent.len(), 0);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    let (source, counts, _) = body(vec![], true);
    let (socket, state) = super::socket(false);
    let mut stream = live(continuation(source), socket);
    assert_eq!(
        value(&sent(&mut stream, &state, 1)),
        value(r#"{"context_id":"context","voice_id":"custom-uuid","continue":false}"#)
    );
    tick(&mut stream);
    assert_eq!(state.lock().unwrap().drops, 0);
    state.lock().unwrap().closed = true;
    assert_eq!(
        pull(&mut stream).unwrap().err().unwrap().to_string(),
        "Smallest.ai continuation closed without a context-complete marker"
    );
    assert_eq!(state.lock().unwrap().drops, 1);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn status_and_media_failures_drop_unread_bodies() {
    let auth = auth();
    for (status, media, protocol, want) in [
        (
            401,
            "text/plain",
            Protocol::Sse,
            "Smallest.ai returned HTTP 401",
        ),
        (
            307,
            "text/plain",
            Protocol::Http,
            "Smallest.ai returned HTTP 307",
        ),
        (
            200,
            "application/json",
            Protocol::Sse,
            "Smallest.ai returned an unexpected content type",
        ),
        (
            200,
            "text/plain",
            Protocol::Http,
            "Smallest.ai returned an unexpected content type",
        ),
    ] {
        let (http, counts) = http(vec![b"secret".to_vec()]);
        {
            let mut response = http.response.lock().unwrap();
            let response = response.as_mut().unwrap();
            response.status = status;
            response.headers = vec![("Content-Type".into(), media.into())];
        }
        let error = ready(synthesize(
            whole(),
            Options {
                auth: Some(&auth),
                transport: Some(&http),
                protocol: Some(protocol),
                ..Default::default()
            },
        ))
        .err()
        .unwrap();
        assert_eq!(error.to_string(), want);
        if status != 200 {
            assert_eq!(error.downcast_ref::<Error>().unwrap().status, Some(status));
        }
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
    let (http, counts) = http(vec![]);
    let mut stream = ready(synthesize(
        whole(),
        Options {
            auth: Some(&auth),
            transport: Some(&http),
            protocol: Some(Protocol::Http),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        pull(&mut stream).unwrap().err().unwrap().to_string(),
        "Smallest.ai returned no audio"
    );
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn socket_protocol_failures_are_terminal() {
    for (message, want) in [
        (
            Message::Binary(vec![0]),
            "Smallest.ai returned a non-text WebSocket frame",
        ),
        (
            Message::Text("bad JSON".into()),
            "Smallest.ai returned invalid JSON",
        ),
        (
            Message::Text(COMPLETE.into()),
            "Smallest.ai returned no audio",
        ),
    ] {
        let (socket, state) = socket(false);
        let mut stream = live(whole(), socket);
        sent(&mut stream, &state, 1);
        state.lock().unwrap().replies.push_back(Ok(message));
        assert_eq!(pull(&mut stream).unwrap().err().unwrap().to_string(), want);
        assert_eq!(state.lock().unwrap().drops, 1);
        assert!(pull(&mut stream).is_none());
    }
    let (socket, state) = socket(false);
    let mut stream = live(whole(), socket);
    sent(&mut stream, &state, 1);
    state.lock().unwrap().closed = true;
    assert_eq!(
        pull(&mut stream).unwrap().err().unwrap().to_string(),
        "Smallest.ai WebSocket closed before completion"
    );
}

#[test]
fn transport_and_input_failures_preserve_identity() {
    let auth = auth();
    let identity = Arc::new(());
    let (source, counts, _) = body(
        vec![Err(Box::new(Failure(identity.clone())) as TransportError)],
        false,
    );
    let (socket, state) = socket(false);
    let mut stream = live(streaming(source), socket);
    let error = pull(&mut stream).unwrap().err().unwrap();
    assert!(Arc::ptr_eq(
        &identity,
        &error.downcast_ref::<Failure>().unwrap().0
    ));
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(state.lock().unwrap().drops, 1);
    for stage in ["send", "receive", "flush"] {
        let (socket, state) = super::socket(false);
        let mut stream = live(whole(), socket);
        let error: TransportError = Box::new(Failure(identity.clone()));
        match stage {
            "send" => state.lock().unwrap().failure = Some(error),
            "receive" => {
                sent(&mut stream, &state, 1);
                state.lock().unwrap().replies.push_back(Err(error));
            }
            _ => {
                sent(&mut stream, &state, 1);
                state.lock().unwrap().flush_failure = Some(error);
            }
        }
        let error = pull(&mut stream).unwrap().err().unwrap();
        assert!(Arc::ptr_eq(
            &identity,
            &error.downcast_ref::<Failure>().unwrap().0
        ));
        assert_eq!(state.lock().unwrap().drops, 1);
    }
    let (body, counts, _) = body(
        vec![
            Ok(vec![1]),
            Err(Box::new(Failure(identity.clone())) as TransportError),
        ],
        true,
    );
    let http = Http {
        response: Mutex::new(Some(HttpResponse {
            status: 200,
            headers: vec![],
            body,
        })),
        requests: Mutex::new(vec![]),
    };
    let mut stream = ready(synthesize(
        whole(),
        Options {
            auth: Some(&auth),
            transport: Some(&http),
            protocol: Some(Protocol::Http),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        item(pull(&mut stream).unwrap().unwrap()),
        Item::Bytes(vec![1])
    );
    let error = pull(&mut stream).unwrap().err().unwrap();
    assert!(Arc::ptr_eq(
        &identity,
        &error.downcast_ref::<Failure>().unwrap().0
    ));
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn drop_cancels_unpolled_future_idle_input_and_pending_write() {
    let auth = auth();
    for stage in ["unpolled", "input", "write", "idle"] {
        let (source, counts, _) = body(
            if stage == "write" || stage == "idle" {
                vec![Ok("hello".to_owned())]
            } else {
                vec![]
            },
            false,
        );
        let (socket, state) = socket(false);
        if stage == "write" {
            state.lock().unwrap().flush_pending = true;
        }
        let future = synthesize(
            streaming(source),
            Options {
                auth: Some(&auth),
                web_socket: Some(socket),
                entropy: Some(&entropy),
                ..Default::default()
            },
        );
        if stage == "unpolled" {
            drop(future);
            assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        } else {
            let mut stream = ready(future).unwrap();
            tick(&mut stream);
            if stage == "idle" {
                packet(&state, CHUNK);
                assert_eq!(
                    item(pull(&mut stream).unwrap().unwrap()),
                    Item::Bytes(vec![0, 255, 128])
                );
            }
            drop(stream);
        }
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(state.lock().unwrap().drops, 1);
    }
}

#[test]
fn protocol_options_and_entropy_fail_before_io() {
    let auth = auth();
    let cases=[
 (Options{max_message_bytes:0,..Default::default()},"Smallest.ai max_message_bytes must be positive"),
 (Options{idle_timeout_seconds:0,..Default::default()},"Smallest.ai idle_timeout_seconds must be a positive safe integer"),
 (Options{idle_timeout_seconds:u64::MAX,..Default::default()},"Smallest.ai idle_timeout_seconds must be a positive safe integer"),
 (Options{base_url:Some("https://user:pass@host"),..Default::default()},"Invalid Smallest.ai endpoint URL"),
 (Options{web_socket_url:Some("https://host"),..Default::default()},"Invalid Smallest.ai endpoint URL"),
 (Options{protocol:Some(Protocol::Http),..Default::default()},"Smallest.ai incremental text, timestamps and socket overrides require WebSocket transport"),
 (Options::default(),"Smallest.ai socket override entropy source is required"),
 ];
    for (mut options, want) in cases {
        let (socket, state) = socket(false);
        options.web_socket = Some(socket);
        options.auth = Some(&auth);
        assert_eq!(
            ready(synthesize(whole(), options))
                .err()
                .unwrap()
                .to_string(),
            want
        );
        assert_eq!(state.lock().unwrap().drops, 1);
        assert_eq!(state.lock().unwrap().sent.len(), 0);
    }
    let (socket, state) = socket(false);
    assert_eq!(
        ready(synthesize(
            TtsRequest::LightningV31ProTextVoice74d06326(models::pro_request()),
            Options {
                auth: Some(&auth),
                web_socket: Some(socket),
                ..Default::default()
            }
        ))
        .err()
        .unwrap()
        .to_string(),
        "Smallest.ai pronunciation dictionaries are documented only for HTTP/SSE"
    );
    assert_eq!(state.lock().unwrap().drops, 1);
}

#[test]
fn explicit_request_identity_avoids_unneeded_entropy_and_clear_skips_collisions() {
    let auth = auth();
    let (socket, state) = socket(true);
    let mut r = request();
    r.request_id = Some("caller-id".into());
    let mut stream = ready(synthesize(
        TtsRequest::LightningV31TextVoice5e2ae2e5(r),
        Options {
            auth: Some(&auth),
            web_socket: Some(socket),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        collect(&mut stream).unwrap(),
        vec![Item::Bytes(vec![0, 255, 128]), Item::Done]
    );
    assert_eq!(
        Raw::parse_exact(&state.lock().unwrap().sent[0])
            .unwrap()
            .object()
            .unwrap()["request_id"]
            .string()
            .unwrap(),
        "caller-id"
    );
    let (source, _, data) = body(vec![Ok(clear())], false);
    let mut r = continuation(source);
    if let TtsRequest::LightningV31StreamingTextVoicebf9ab904(v) = &mut r {
        v.request_id = Some("000102030405060708090a0b0c0d0e0f-1".into());
    }
    let (socket, state) = super::socket(false);
    let mut stream = live(r, socket);
    assert_eq!(item(pull(&mut stream).unwrap().unwrap()), Item::Clear);
    data.lock().unwrap().values.push_back(Ok(text("hello")));
    let message = sent(&mut stream, &state, 2);
    assert_eq!(
        Raw::parse_exact(&message).unwrap().object().unwrap()["request_id"]
            .string()
            .unwrap(),
        "000102030405060708090a0b0c0d0e0f-2"
    );
}

#[test]
fn bounded_messages_and_sse_events_do_not_invent_total_stream_limits() {
    let auth = auth();
    let (socket, state) = socket(false);
    let mut stream = ready(synthesize(
        whole(),
        Options {
            auth: Some(&auth),
            web_socket: Some(socket),
            entropy: Some(&entropy),
            max_message_bytes: 8,
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        pull(&mut stream).unwrap().err().unwrap().to_string(),
        "Smallest.ai message exceeds max_message_bytes"
    );
    assert_eq!(state.lock().unwrap().sent.len(), 0);
    let (socket, state) = super::socket(false);
    let mut stream = ready(synthesize(
        whole(),
        Options {
            auth: Some(&auth),
            web_socket: Some(socket),
            entropy: Some(&entropy),
            max_message_bytes: 300,
            ..Default::default()
        },
    ))
    .unwrap();
    sent(&mut stream, &state, 1);
    packet(&state, &" ".repeat(301));
    assert_eq!(
        pull(&mut stream).unwrap().err().unwrap().to_string(),
        "Smallest.ai message exceeds max_message_bytes"
    );
    let (http, counts) = http(vec![b"data: oversized event\n\n".to_vec()]);
    let mut stream = ready(synthesize(
        whole(),
        Options {
            auth: Some(&auth),
            transport: Some(&http),
            max_message_bytes: 8,
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        pull(&mut stream).unwrap().err().unwrap().to_string(),
        "SSE event exceeds byte limit"
    );
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    let mut wire = "data: {\"status\":\"206\",\"done\":false,\"audio\":\"AA==\"}\n\n".repeat(10);
    wire.push_str("data: {\"status\":\"200\",\"done\":true}\n\n");
    let (http, counts) = super::http(vec![wire.into_bytes()]);
    let mut stream = ready(synthesize(
        whole(),
        Options {
            auth: Some(&auth),
            transport: Some(&http),
            max_message_bytes: 80,
            ..Default::default()
        },
    ))
    .unwrap();
    let mut expected: Vec<_> = (0..10).map(|_| Item::Bytes(vec![0])).collect();
    expected.push(Item::Done);
    assert_eq!(collect(&mut stream).unwrap(), expected);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}
