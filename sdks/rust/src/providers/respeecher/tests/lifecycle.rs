use super::*;

#[test]
fn auth_environment_child() {
    let Ok(expected) = std::env::var("SPEECHSWITCH_TEST_RESPEECHER_AUTH") else {
        return;
    };
    let mut auth = auth();
    if expected == "explicit-empty" {
        auth.respeecher.as_mut().unwrap().api_key = Some(String::new())
    };
    let (backend, _) = http(vec![]);
    let result = ready(synthesize(
        TtsRequest::Object(request()),
        Options {
            auth: if expected == "fixture" || expected == "explicit-empty" {
                Some(&auth)
            } else {
                None
            },
            transport: Some(&backend),
            protocol: Some(Protocol::Http),
            ..Default::default()
        },
    ));
    if expected.is_empty() || expected == "explicit-empty" || expected == "invalid-env" {
        assert_eq!(
            result.err().unwrap().to_string(),
            if expected == "invalid-env" {
                "Invalid Respeecher environment credential"
            } else {
                "Missing auth.respeecher.apiKey configuration"
            }
        );
        assert_eq!(backend.requests.lock().unwrap().len(), 0)
    } else {
        drop(result.unwrap());
        assert_eq!(
            backend.requests.lock().unwrap()[0].headers[0],
            ("X-API-Key".into(), expected)
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
                "providers::respeecher::tests::lifecycle::auth_environment_child",
                "--nocapture",
            ])
            .env("SPEECHSWITCH_TEST_RESPEECHER_AUTH", expected);
        for (name, value) in [
            ("SPEECHSWITCH_RESPEECHER_API_KEY", scoped),
            ("RESPEECHER_API_KEY", native),
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
                "providers::respeecher::tests::lifecycle::auth_environment_child",
                "--nocapture",
            ])
            .env("SPEECHSWITCH_TEST_RESPEECHER_AUTH", "invalid-env")
            .env(
                "SPEECHSWITCH_RESPEECHER_API_KEY",
                std::ffi::OsString::from_vec(vec![255]),
            )
            .env("RESPEECHER_API_KEY", "legacy")
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
                std::future::pending::<()>().await
            };
            Ok(socket)
        })
    }
}
#[test]
fn native_boundary_sets_headers_proxy_path_and_limits() {
    let (socket, state) = socket(true);
    let backend = Backend {
        socket: Mutex::new(Some(socket)),
        requests: Mutex::new(vec![]),
        pending: false,
        counts: Arc::new(Counts::default()),
    };
    let auth = auth();
    let mut stream = ready(synthesize(
        TtsRequest::Object(request()),
        Options {
            auth: Some(&auth),
            web_socket_transport: Some(&backend),
            base_url: Some("https://proxy.example/prefix%20path?route=uk&x=%2F"),
            max_message_bytes: 1024,
            ..Default::default()
        },
    ))
    .unwrap();
    let sent = backend.requests.lock().unwrap();
    assert_eq!(sent.len(), 1);
    assert_eq!(
        sent[0].url,
        "wss://proxy.example/prefix%20path/tts/websocket?route=uk&x=%2F"
    );
    assert_eq!(
        sent[0].headers,
        vec![("X-API-Key".into(), "fixture".into())]
    );
    assert_eq!(sent[0].max_message_bytes, 1024);
    drop(sent);
    drop(backend);
    drop(auth);
    assert!(
        matches!(item(pull(&mut stream).unwrap().unwrap()),Item::Audio(_,bytes) if bytes==vec![0,255])
    );
    assert_eq!(item(pull(&mut stream).unwrap().unwrap()), Item::Done);
    assert_eq!(state.lock().unwrap().drops, 1);
}

#[test]
fn drop_pending_socket_connect_releases_handshake_and_unpolled_input() {
    let (socket, state) = socket(false);
    let counts = Arc::new(Counts::default());
    let backend = Backend {
        socket: Mutex::new(Some(socket)),
        requests: Mutex::new(vec![]),
        pending: true,
        counts: counts.clone(),
    };
    let (input, input_counts, _) = body(Vec::new(), false);
    let mut r = request();
    r.text = TtsRequestObjectText::AsyncIterable(input);
    let auth = auth();
    let mut future = Box::pin(synthesize(
        TtsRequest::Object(r),
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
            std::future::pending().await
        })
    }
}
#[test]
fn drop_pending_http_headers_or_body_is_cancellation() {
    let auth = auth();
    let counts = Arc::new(Counts::default());
    let backend = PendingHttp(counts.clone());
    let mut future = Box::pin(synthesize(
        wav(None),
        Options {
            auth: Some(&auth),
            transport: Some(&backend),
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
    for after_audio in [false, true] {
        let (body, counts, _) = body(
            if after_audio {
                vec![Ok(vec![0, 255])]
            } else {
                vec![]
            },
            false,
        );
        let backend = Http {
            response: Mutex::new(Some(HttpResponse {
                status: 200,
                headers: vec![],
                body,
            })),
            requests: Mutex::new(vec![]),
        };
        let mut stream = ready(synthesize(
            wav(None),
            Options {
                auth: Some(&auth),
                transport: Some(&backend),
                ..Default::default()
            },
        ))
        .unwrap();
        drop(backend);
        if after_audio {
            assert_eq!(
                item(pull(&mut stream).unwrap().unwrap()),
                Item::Bytes(vec![0, 255])
            )
        };
        tick(&mut stream);
        assert!(counts.waker.lock().unwrap().is_some());
        drop(stream);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn unpolled_future_owns_and_drops_override_and_input() {
    let (input, counts, _) = body(Vec::new(), false);
    let (socket, state) = socket(false);
    let mut r = request();
    r.text = TtsRequestObjectText::AsyncIterable(input);
    let auth = auth();
    drop(synthesize(
        TtsRequest::Object(r),
        Options {
            auth: Some(&auth),
            web_socket: Some(socket),
            entropy: Some(&entropy),
            ..Default::default()
        },
    ));
    assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(state.lock().unwrap().drops, 1);
}

#[test]
fn http_status_content_type_empty_body_and_utf8_fail_without_done() {
    let auth = auth();
    for (status, media, bytes, expected) in [
        (
            403,
            "audio/wav",
            b"secret".to_vec(),
            "Respeecher returned HTTP 403",
        ),
        (
            200,
            "text/html",
            b"secret".to_vec(),
            "Respeecher returned an unexpected content type",
        ),
        (
            200,
            "application/json",
            vec![],
            "Respeecher returned no audio",
        ),
        (
            200,
            "application/json",
            vec![255, 10],
            "Respeecher returned invalid UTF-8",
        ),
    ] {
        let (backend, counts) = http(vec![bytes]);
        {
            let mut response = backend.response.lock().unwrap();
            response.as_mut().unwrap().status = status;
            response.as_mut().unwrap().headers = vec![("Content-TYPE".into(), media.into())]
        };
        let result = ready(synthesize(
            TtsRequest::Object(request()),
            Options {
                auth: Some(&auth),
                transport: Some(&backend),
                protocol: Some(Protocol::Http),
                ..Default::default()
            },
        ));
        let error = match result {
            Err(e) => {
                assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
                e
            }
            Ok(mut stream) => {
                let error = pull(&mut stream).unwrap().err().unwrap();
                assert!(pull(&mut stream).is_none());
                error
            }
        };
        assert_eq!(error.to_string(), expected);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1)
    }
}

#[derive(Debug)]
struct Marker;
impl std::fmt::Display for Marker {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("marker")
    }
}
impl std::error::Error for Marker {}
#[test]
fn body_input_and_socket_errors_keep_identity() {
    let auth = auth();
    for phase in ["http", "input", "send", "receive"] {
        let (body, counts, _) = body(
            if phase == "input" {
                vec![Err(Box::new(Marker) as TransportError)]
            } else {
                vec![Ok(text("Hi"))]
            },
            false,
        );
        let (socket, state) = socket(false);
        let mut stream = if phase == "http" {
            let (response, response_counts, _) = super::body(
                vec![
                    Ok(b"{\"type\":\"chunk\",\"data\":\"AQ==\"}\n".to_vec()),
                    Err(Box::new(Marker)),
                ],
                true,
            );
            let backend = Http {
                response: Mutex::new(Some(HttpResponse {
                    status: 200,
                    headers: vec![],
                    body: response,
                })),
                requests: Mutex::new(vec![]),
            };
            let mut s = ready(synthesize(
                TtsRequest::Object(request()),
                Options {
                    auth: Some(&auth),
                    transport: Some(&backend),
                    protocol: Some(Protocol::Http),
                    ..Default::default()
                },
            ))
            .unwrap();
            assert_eq!(item(pull(&mut s).unwrap().unwrap()), Item::Bytes(vec![1]));
            let error = pull(&mut s).unwrap().err().unwrap();
            assert!(error.is::<Marker>());
            assert_eq!(response_counts.drops.load(Ordering::SeqCst), 1);
            drop(body);
            drop(socket);
            continue;
        } else {
            if phase == "send" {
                state.lock().unwrap().failure = Some(Box::new(Marker))
            };
            if phase == "receive" {
                state
                    .lock()
                    .unwrap()
                    .replies
                    .push_back(Err(Box::new(Marker)))
            };
            live(body, socket)
        };
        let error = pull(&mut stream).unwrap().err().unwrap();
        assert!(error.is::<Marker>());
        assert!(pull(&mut stream).is_none());
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(state.lock().unwrap().drops, 1);
    }
}

#[test]
fn jsonl_processing_and_empty_backend_chunks_yield_cooperatively() {
    for chunk in [vec![b'\n'; 32768], vec![]] {
        let (backend, counts) = http(vec![chunk]);
        let auth = auth();
        let mut stream = ready(synthesize(
            TtsRequest::Object(request()),
            Options {
                auth: Some(&auth),
                transport: Some(&backend),
                protocol: Some(Protocol::Http),
                ..Default::default()
            },
        ))
        .unwrap();
        let wake = Arc::new(Counts::default());
        let waker = Waker::from(wake.clone());
        assert!(Pin::new(&mut stream)
            .poll_next(&mut Context::from_waker(&waker))
            .is_pending());
        assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
        assert_eq!(wake.wakes.load(Ordering::SeqCst), 1);
        drop(stream);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1)
    }
}

#[test]
fn explicit_limits_reject_bounded_protocol_data() {
    let auth = auth();
    let (backend, counts) = http(vec![vec![b' '; 9]]);
    let mut stream = ready(synthesize(
        TtsRequest::Object(request()),
        Options {
            auth: Some(&auth),
            transport: Some(&backend),
            protocol: Some(Protocol::Http),
            max_message_bytes: 8,
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        pull(&mut stream).unwrap().err().unwrap().to_string(),
        "Respeecher line exceeds max_message_bytes"
    );
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    for receiving in [false, true] {
        let (socket, state) = socket(false);
        if receiving {
            state
                .lock()
                .unwrap()
                .replies
                .push_back(Ok(Message::Text(" ".repeat(513))))
        };
        let mut r = request();
        if !receiving {
            r.text = TtsRequestObjectText::String("x".repeat(513))
        };
        let mut stream = ready(synthesize(
            TtsRequest::Object(r),
            Options {
                auth: Some(&auth),
                web_socket: Some(socket),
                entropy: Some(&entropy),
                max_message_bytes: 512,
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(
            pull(&mut stream).unwrap().err().unwrap().to_string(),
            "Respeecher message exceeds max_message_bytes"
        );
        assert_eq!(state.lock().unwrap().drops, 1);
    }
}

#[test]
fn schema_validation_precedes_io_and_invalid_options_drop_owned_socket() {
    let auth = auth();
    let (backend, counts) = http(vec![]);
    let mut r = request();
    r.top_p = Some(0.0);
    let error = ready(synthesize(
        TtsRequest::Object(r),
        Options {
            auth: Some(&auth),
            transport: Some(&backend),
            protocol: Some(Protocol::Http),
            ..Default::default()
        },
    ))
    .err()
    .unwrap();
    assert_eq!(error.to_string(), "Invalid respeecher TTS request");
    assert_eq!(backend.requests.lock().unwrap().len(), 0);
    drop(backend);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    for (mode, expected) in [
        ("limit", "Respeecher max_message_bytes must be positive"),
        (
            "entropy",
            "Respeecher socket override entropy source is required",
        ),
        ("wave", "Respeecher WAV output requires HTTP"),
        ("url", "Invalid Respeecher endpoint URL"),
    ] {
        let (socket, state) = socket(false);
        let mut options = Options {
            auth: Some(&auth),
            web_socket: Some(socket),
            entropy: Some(&entropy),
            ..Default::default()
        };
        let r = if mode == "wave" {
            options.protocol = Some(Protocol::WebSocket);
            wav(None)
        } else {
            TtsRequest::Object(request())
        };
        match mode {
            "limit" => options.max_message_bytes = 0,
            "entropy" => options.entropy = None,
            "url" => options.base_url = Some("https://user:key@example.test"),
            _ => {}
        };
        assert_eq!(
            ready(synthesize(r, options)).err().unwrap().to_string(),
            expected
        );
        assert_eq!(state.lock().unwrap().drops, 1);
    }
}

#[test]
fn early_or_silent_context_done_is_not_success() {
    for ended in [false, true] {
        let mut values = vec![Ok(text("Hi"))];
        if ended {
            values.push(Ok(flush()))
        };
        let (input, counts, _) = body(values, false);
        let (socket, state) = socket(false);
        let mut stream = live(input, socket);
        let id = id(&sent(&mut stream, &state, 1));
        if ended {
            sent(&mut stream, &state, 2);
        };
        packet(&state, "done", &id, "");
        assert_eq!(
            pull(&mut stream).unwrap().err().unwrap().to_string(),
            if ended {
                "Respeecher completed a context without audio"
            } else {
                "Respeecher completed a context before its text ended"
            }
        );
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(state.lock().unwrap().drops, 1);
    }
}
