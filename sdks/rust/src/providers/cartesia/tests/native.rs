use super::socket::{automatic, socket, SocketState};
use super::*;

#[test]
fn auth_environment_child() {
    let Ok(expected) = std::env::var("SPEECHSWITCH_TEST_CARTESIA_AUTH") else {
        return;
    };
    let mut auth = auth();
    if expected == "explicit-empty" {
        auth.cartesia.as_mut().unwrap().api_key = Some(String::new());
    }
    let counts = Arc::new(Counts::default());
    let trace = Trace::default();
    let http = Http::new(HttpResponse {
        status: 200,
        headers: Vec::new(),
        body: body(Vec::new(), &counts, &trace, false, "response"),
    });
    let result = ready(synthesize(
        TtsRequest::TextVoicef0bb1766(whole()),
        Options {
            auth: if expected == "key" || expected == "explicit-empty" {
                Some(&auth)
            } else {
                None
            },
            transport: Some(&http),
            ..Default::default()
        },
    ));
    if expected.is_empty() || expected == "explicit-empty" {
        assert_eq!(
            result.err().unwrap().to_string(),
            "Missing auth.cartesia.apiKey or auth.cartesia.accessToken configuration"
        );
        assert_eq!(http.requests.lock().unwrap().len(), 0);
    } else {
        drop(result.unwrap());
        assert_eq!(
            http.requests.lock().unwrap()[0].headers[0],
            ("authorization".into(), format!("Bearer {expected}"))
        );
    }
}

#[test]
fn auth_precedence_uses_isolated_process_environments() {
    for (scoped, native, scoped_token, native_token, expected) in [
        (None, Some("native"), None, None, "native"),
        (Some("scoped"), Some("native"), None, None, "scoped"),
        (Some(""), Some("native"), Some("token"), None, ""),
        (None, None, None, Some("native-token"), "native-token"),
        (
            None,
            None,
            Some("scoped-token"),
            Some("native-token"),
            "scoped-token",
        ),
        (None, None, Some(""), Some("native-token"), ""),
        (None, None, None, None, ""),
        (Some("scoped"), Some("native"), Some("token"), None, "key"),
        (
            Some("scoped"),
            Some("native"),
            Some("token"),
            None,
            "explicit-empty",
        ),
    ] {
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "providers::cartesia::tests::native::auth_environment_child",
                "--nocapture",
            ])
            .env("SPEECHSWITCH_TEST_CARTESIA_AUTH", expected);
        for (key, value) in [
            ("SPEECHSWITCH_CARTESIA_API_KEY", scoped),
            ("CARTESIA_API_KEY", native),
            ("SPEECHSWITCH_CARTESIA_ACCESS_TOKEN", scoped_token),
            ("CARTESIA_ACCESS_TOKEN", native_token),
        ] {
            command.env_remove(key);
            if let Some(value) = value {
                command.env(key, value);
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
}

#[test]
fn socket_query_rejects_malformed_endpoints_and_removes_encoded_credentials() {
    for url in [
        "https://example.test/socket",
        "wss://user:key@example.test/socket",
        "wss://example.test/#fragment",
    ] {
        assert_eq!(
            socket_url(url, "token").unwrap_err().to_string(),
            "Invalid Cartesia WebSocket endpoint URL"
        );
    }
    for url in ["wss://example.test/?bad=%", "wss://example.test/?%GG=value"] {
        assert_eq!(
            socket_url(url, "token").unwrap_err().to_string(),
            "Invalid Cartesia WebSocket endpoint query"
        );
    }
    assert_eq!(socket_url("wss://example.test/proxy%2Fsocket?x=%2f&%61pi_key=secret&access_token=old&cartesia_version=old&flag", "a +é").unwrap(),
        format!("wss://example.test/proxy%2Fsocket?x=%2f&flag&cartesia_version={VERSION}&access_token=a%20%2B%C3%A9"));
}

struct Backend {
    requests: Mutex<Vec<ConnectRequest>>,
    socket: Mutex<Option<Socket>>,
    counts: Arc<Counts>,
    random_calls: AtomicUsize,
    stall: bool,
    connect_error: Option<Arc<()>>,
    entropy_error: Option<Arc<()>>,
}
impl Backend {
    fn new(socket: Socket) -> Self {
        Self {
            requests: Mutex::new(Vec::new()),
            socket: Mutex::new(Some(socket)),
            counts: Arc::new(Counts::default()),
            random_calls: AtomicUsize::new(0),
            stall: false,
            connect_error: None,
            entropy_error: None,
        }
    }
}
impl WebSocketTransport for Backend {
    fn connect(
        &self,
        request: ConnectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<Socket, TransportError>> + Send + '_>> {
        self.requests.lock().unwrap().push(request);
        Box::pin(async move {
            struct Guard(Arc<Counts>);
            impl Drop for Guard {
                fn drop(&mut self) {
                    self.0.drops.fetch_add(1, Ordering::SeqCst);
                }
            }
            let _guard = Guard(self.counts.clone());
            if self.stall {
                std::future::pending::<()>().await;
            }
            if let Some(error) = &self.connect_error {
                return Err(marker(error));
            }
            Ok(self.socket.lock().unwrap().take().unwrap())
        })
    }
    fn random_bytes(&self, bytes: &mut [u8]) -> Result<(), TransportError> {
        self.random_calls.fetch_add(1, Ordering::SeqCst);
        if let Some(error) = &self.entropy_error {
            return Err(marker(error));
        }
        entropy(bytes)
    }
}

#[test]
fn native_token_exchange_and_owned_connection_do_not_borrow_backend() {
    for exchange in [true, false] {
        let trace = Trace::default();
        let counts = Arc::new(Counts::default());
        let socket_counts = Arc::new(Counts::default());
        let response_counts = Arc::new(Counts::default());
        let mut state = SocketState::default();
        state.respond = Some(Box::new(automatic));
        let state = Arc::new(Mutex::new(state));
        let backend = Backend::new(socket(&state, &socket_counts, &trace));
        let http = Http::new(HttpResponse {
            status: 200,
            headers: Vec::new(),
            body: body(
                vec![Ok(br#"{"token":"short + token"}"#.to_vec())],
                &response_counts,
                &trace,
                false,
                "response",
            ),
        });
        let mut auth = auth();
        if !exchange {
            auth.cartesia.as_mut().unwrap().access_token = Some("short + token".into());
        }
        let input = body(
            vec![
                Ok(settings::Input::String("Hello".into())),
                Ok(settings::Input::Clear(
                    TtsRequestStreamingTextVoice0bf53a99TextItemClear {
                        command: Default::default(),
                    },
                )),
                Ok(settings::Input::String("World".into())),
            ],
            &counts,
            &trace,
            false,
            "input",
        );
        let mut stream = ready(synthesize(
            TtsRequest::StreamingTextVoice0bf53a99(live(input)),
            Options {
                auth: Some(&auth),
                transport: Some(&http),
                web_socket_transport: Some(&backend),
                base_url: Some("https://proxy.test/prefix/?tenant=1"),
                web_socket_url: Some("wss://proxy.test/live?keep=1&api_key=stale&%61pi_key=other&access_token=old&cartesia_version=old"),
                ..Default::default()
            },
        )).unwrap();
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        assert_eq!(backend.random_calls.load(Ordering::SeqCst), 1);
        {
            let requests = backend.requests.lock().unwrap();
            assert_eq!(requests.len(), 1);
            assert_eq!(requests[0].url,"wss://proxy.test/live?keep=1&cartesia_version=2026-08-14&access_token=short%20%2B%20token");
            assert_eq!(requests[0].headers, []);
            assert_eq!(requests[0].max_message_bytes, 4 * 1024 * 1024);
        }
        {
            let requests = http.requests.lock().unwrap();
            assert_eq!(requests.len(), usize::from(exchange));
            if exchange {
                assert_eq!(
                    (&*requests[0].method, &*requests[0].url),
                    ("POST", "https://proxy.test/prefix/access-token?tenant=1")
                );
                assert_eq!(
                    requests[0].headers,
                    [
                        ("authorization".into(), "Bearer key".into()),
                        ("cartesia-version".into(), VERSION.into()),
                        ("content-type".into(), "application/json".into())
                    ]
                );
                assert_eq!(
                    parse(std::str::from_utf8(&requests[0].body).unwrap()),
                    parse(r#"{"grants":{"tts":true},"expires_in":60}"#)
                );
                assert_eq!(response_counts.drops.load(Ordering::SeqCst), 1);
            }
        }
        drop(backend);
        assert_eq!(socket_counts.drops.load(Ordering::SeqCst), 0);
        let mut items = Vec::new();
        while let Some(item) = next(&mut stream) {
            items.push(canonical(item.unwrap()));
        }
        assert_eq!(items.len(), 3);
        assert_eq!(items[1], parse(r#"{"event":"clear"}"#));
        let JsonValue::Object(first) = &items[0] else {
            panic!()
        };
        let JsonValue::Object(last) = &items[2] else {
            panic!()
        };
        assert_ne!(first["correlationId"], last["correlationId"]);
        assert_eq!(socket_counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn token_failures_and_pending_initialization_drop_owned_input_without_polling() {
    let auth = auth();
    for data in [
        r#"{}"#,
        r#"[]"#,
        r#"{"token":null}"#,
        r#"{"token":""}"#,
        r#"{"token":1}"#,
    ] {
        let trace = Trace::default();
        let counts = Arc::new(Counts::default());
        let response_counts = Arc::new(Counts::default());
        let socket_counts = Arc::new(Counts::default());
        let state = Arc::new(Mutex::new(SocketState::default()));
        let backend = Backend::new(socket(&state, &socket_counts, &trace));
        let http = Http::new(HttpResponse {
            status: 200,
            headers: Vec::new(),
            body: body(
                vec![Ok(data.as_bytes().to_vec())],
                &response_counts,
                &trace,
                false,
                "response",
            ),
        });
        let input = body(Vec::new(), &counts, &trace, true, "input");
        let error = ready(synthesize(
            TtsRequest::StreamingTextVoice0bf53a99(live(input)),
            Options {
                auth: Some(&auth),
                transport: Some(&http),
                web_socket_transport: Some(&backend),
                ..Default::default()
            },
        ))
        .err()
        .unwrap();
        assert_eq!(
            error.to_string(),
            "Cartesia returned an invalid access token"
        );
        assert_eq!(response_counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(backend.requests.lock().unwrap().len(), 0);
    }
    for exchange in [true, false] {
        let trace = Trace::default();
        let counts = Arc::new(Counts::default());
        let response_counts = Arc::new(Counts::default());
        let socket_counts = Arc::new(Counts::default());
        let state = Arc::new(Mutex::new(SocketState::default()));
        let mut backend = Backend::new(socket(&state, &socket_counts, &trace));
        backend.stall = true;
        let http = Http::new(HttpResponse {
            status: 200,
            headers: Vec::new(),
            body: body(Vec::new(), &response_counts, &trace, true, "response"),
        });
        let mut auth = super::auth();
        if !exchange {
            auth.cartesia.as_mut().unwrap().access_token = Some("token".into());
        }
        let input = body(Vec::new(), &counts, &trace, true, "input");
        let mut future = Box::pin(synthesize(
            TtsRequest::StreamingTextVoice0bf53a99(live(input)),
            Options {
                auth: Some(&auth),
                transport: Some(&http),
                web_socket_transport: Some(&backend),
                ..Default::default()
            },
        ));
        let waker = Waker::from(counts.clone());
        assert!(future
            .as_mut()
            .poll(&mut Context::from_waker(&waker))
            .is_pending());
        drop(future);
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        if exchange {
            assert_eq!(response_counts.drops.load(Ordering::SeqCst), 1);
        } else {
            assert_eq!(backend.counts.drops.load(Ordering::SeqCst), 1);
        }
    }
}

#[test]
fn entropy_configuration_and_failures_precede_io() {
    let auth = auth();
    let trace = Trace::default();
    let counts = Arc::new(Counts::default());
    let original = Arc::new(());
    let http = Http::new(HttpResponse {
        status: 200,
        headers: Vec::new(),
        body: body(Vec::new(), &counts, &trace, false, "unused"),
    });
    let error = ready(synthesize(
        timed(),
        Options {
            auth: Some(&auth),
            transport: Some(&http),
            ..Default::default()
        },
    ))
    .err()
    .unwrap();
    assert_eq!(error.to_string(), "Cartesia SSE entropy source is required");
    assert_eq!(http.requests.lock().unwrap().len(), 0);
    let failing = |_: &mut [u8]| Err(marker(&original));
    let error = ready(synthesize(
        timed(),
        Options {
            auth: Some(&auth),
            transport: Some(&http),
            entropy: Some(&failing),
            ..Default::default()
        },
    ))
    .err()
    .unwrap();
    same(&error, &original);
    assert_eq!(http.requests.lock().unwrap().len(), 0);
    let stream = ready(synthesize(
        TtsRequest::TextVoicef0bb1766(whole()),
        Options {
            auth: Some(&auth),
            transport: Some(&http),
            entropy: Some(&failing),
            ..Default::default()
        },
    ))
    .unwrap();
    drop(stream);
    let mut bytes = [0; 16];
    entropy(&mut bytes).unwrap();
    let mut ids = ContextIds::new(bytes);
    let first = ids.current.clone();
    ids.advance().unwrap();
    assert_ne!(ids.current, first);
    assert_eq!(ids.current, format!("{}:1", ids.prefix));
    ids.index = u64::MAX;
    assert_eq!(
        ids.advance().unwrap_err().to_string(),
        "Cartesia context counter exhausted"
    );
}

#[test]
fn native_backend_errors_are_not_replaced() {
    for random in [true, false] {
        let original = Arc::new(());
        let trace = Trace::default();
        let counts = Arc::new(Counts::default());
        let socket_counts = Arc::new(Counts::default());
        let state = Arc::new(Mutex::new(SocketState::default()));
        let mut backend = Backend::new(socket(&state, &socket_counts, &trace));
        if random {
            backend.entropy_error = Some(original.clone());
        } else {
            backend.connect_error = Some(original.clone());
        }
        let mut auth = auth();
        auth.cartesia.as_mut().unwrap().access_token = Some("token".into());
        let input = body(Vec::new(), &counts, &trace, true, "input");
        let error = ready(synthesize(
            TtsRequest::StreamingTextVoice0bf53a99(live(input)),
            Options {
                auth: Some(&auth),
                web_socket_transport: Some(&backend),
                ..Default::default()
            },
        ))
        .err()
        .unwrap();
        same(&error, &original);
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(backend.requests.lock().unwrap().len(), usize::from(!random));
    }
}
