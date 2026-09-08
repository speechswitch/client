use super::*;

#[test]
fn auth_environment_child() {
    let Ok(case) = std::env::var("SPEECHSWITCH_TEST_INWORLD_ENV") else {
        return;
    };
    let mut credentials = auth();
    credentials.inworld.as_mut().unwrap().api_key = if case == "explicit_empty" {
        Some(String::new())
    } else {
        None
    };
    let transport = Http::new(200, vec![]);
    let result = ready(synthesize(
        TtsRequest::InworldTts2TextVoice(request()),
        Options {
            auth: Some(&credentials),
            transport: Some(&transport),
            ..Default::default()
        },
    ));
    if case == "empty" || case == "explicit_empty" {
        assert_eq!(
            result.err().unwrap().to_string(),
            "Missing auth.inworld.apiKey configuration"
        );
        assert!(transport.requests.lock().unwrap().is_empty());
    } else {
        drop(result.unwrap());
        assert_eq!(
            transport.requests.lock().unwrap()[0].headers[0],
            (
                "authorization".into(),
                if case == "scoped" {
                    "Basic scoped"
                } else {
                    "Basic native"
                }
                .into()
            )
        );
    }
}

#[test]
fn environment_precedence_is_process_isolated() {
    for case in ["native", "scoped", "empty", "explicit_empty"] {
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "providers::inworld::tests::boundary::auth_environment_child",
                "--nocapture",
            ])
            .env("SPEECHSWITCH_TEST_INWORLD_ENV", case)
            .env("INWORLD_API_KEY", "native")
            .env_remove("SPEECHSWITCH_INWORLD_API_KEY");
        if case == "scoped" {
            command.env("SPEECHSWITCH_INWORLD_API_KEY", "scoped");
        }
        if case == "empty" {
            command.env("SPEECHSWITCH_INWORLD_API_KEY", "");
        }
        let output = command.output().unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
}

struct Backend {
    requests: Mutex<Vec<ConnectRequest>>,
    wire: Arc<Mutex<Wire>>,
    fail: bool,
    entropy: AtomicUsize,
}

#[test]
fn explicit_socket_needs_an_id_or_entropy_and_received_limits_count_bytes() {
    let (socket, wire) = socket(true);
    let result = ready(synthesize(
        TtsRequest::InworldTts2StreamingTextVoice(streaming(source(vec![]))),
        Options {
            web_socket: Some(socket),
            ..Default::default()
        },
    ));
    assert_eq!(
        result.err().unwrap().to_string(),
        "Inworld context_id or WebSocket entropy source is required"
    );
    assert_eq!(wire.lock().unwrap().closed, 1);
    let (socket, wire) = super::socket(false);
    wire.lock()
        .unwrap()
        .incoming
        .push_back(Some(Ok(Message::Text("é".repeat(301)))));
    let mut stream = ready(synthesize(
        TtsRequest::InworldTts2StreamingTextVoice(streaming(source(vec![]))),
        Options {
            web_socket: Some(socket),
            context_id: Some("ctx"),
            max_message_bytes: 600,
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        collect(&mut stream).err().unwrap().to_string(),
        "Inworld message exceeds max_message_bytes"
    );
    assert_eq!(wire.lock().unwrap().closed, 1);
}

#[test]
fn character_alignment_and_invalid_utf8_remain_explicit() {
    let auth = auth();
    let transport=Http::new(200,vec![br#"{"result":{"audioContent":"AP8=","timestampInfo":{"characterAlignment":{"characters":["H"],"characterStartTimeSeconds":[0],"characterEndTimeSeconds":[0.1]}}}}"#.to_vec()]);
    let mut r = request();
    r.timestamp_granularity = Some(TtsRequestTextVoiceTimestampGranularity::Character(
        Default::default(),
    ));
    r.timestamp_delivery = Some(TtsRequestTextVoiceTimestampDelivery::Chunk(
        Default::default(),
    ));
    let mut stream = ready(synthesize(
        TtsRequest::InworldTts2TextVoice(r),
        Options {
            auth: Some(&auth),
            transport: Some(&transport),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(collect(&mut stream).unwrap(),vec![fixture(Raw::parse_exact(r#"{"correlation":"chunk","audio":{"$bytes":[0,255]},"timestamps":[{"kind":"character","value":"H","startTimeMs":0,"endTimeMs":100}]}"#).unwrap())]);
    let transport = Http::new(200, vec![vec![255, 10]]);
    let mut stream = ready(synthesize(
        TtsRequest::InworldTts2TextVoice(request()),
        Options {
            auth: Some(&auth),
            transport: Some(&transport),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        collect(&mut stream).err().unwrap().to_string(),
        "Inworld returned invalid UTF-8"
    );
}
impl WebSocketTransport for Backend {
    fn connect(
        &self,
        request: ConnectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<Socket, TransportError>> + Send + '_>> {
        self.requests.lock().unwrap().push(request);
        Box::pin(async {
            if self.fail {
                Err(protocol::failure("handshake rejected"))
            } else {
                Ok(Box::pin(TestSocket(self.wire.clone())) as Socket)
            }
        })
    }
    fn random_bytes(&self, output: &mut [u8]) -> Result<(), TransportError> {
        self.entropy.fetch_add(1, Ordering::SeqCst);
        output.fill(1);
        Ok(())
    }
}
#[test]
fn backend_header_auth_entropy_and_proxy_endpoint_are_explicit() {
    for token in [false, true] {
        for explicit in [false, true] {
            let wire = Arc::new(Mutex::new(Wire {
                automatic: true,
                ..Default::default()
            }));
            let backend = Backend {
                requests: Mutex::new(vec![]),
                wire: wire.clone(),
                fail: false,
                entropy: AtomicUsize::new(0),
            };
            let mut auth = auth();
            if token {
                auth.inworld.as_mut().unwrap().access_token = Some("once".into());
            }
            let mut stream = ready(synthesize(
                TtsRequest::InworldTts2StreamingTextVoice(streaming(source(vec![Input::String(
                    "Hi".into(),
                )]))),
                Options {
                    auth: Some(&auth),
                    web_socket_transport: Some(&backend),
                    base_url: Some("https://proxy.test/a%2Fb/?tenant=one"),
                    web_socket_url: explicit
                        .then_some("https://proxy.test/custom%2Fsocket?tenant=one"),
                    ..Default::default()
                },
            ))
            .unwrap();
            assert_eq!(
                collect(&mut stream).unwrap(),
                vec![Value::Binary(vec![0, 255])]
            );
            assert_eq!(backend.entropy.load(Ordering::SeqCst), 1);
            let requests = backend.requests.lock().unwrap();
            assert_eq!(requests.len(), 1);
            assert_eq!(
                requests[0].url,
                if explicit {
                    "wss://proxy.test/custom%2Fsocket?tenant=one"
                } else {
                    "wss://proxy.test/a%2Fb/tts/v1/voice:streamBidirectional?tenant=one"
                }
            );
            assert_eq!(
                requests[0].headers,
                vec![(
                    "authorization".into(),
                    if token {
                        "Bearer once"
                    } else {
                        "Basic test-key"
                    }
                    .into()
                )]
            );
            assert_eq!(requests[0].max_message_bytes, 4 * 1024 * 1024);
            assert_eq!(
                Raw::parse_exact(&wire.lock().unwrap().sent[0])
                    .unwrap()
                    .object()
                    .unwrap()["contextId"]
                    .string()
                    .unwrap(),
                "01".repeat(16)
            );
        }
    }
}
#[test]
fn failed_handshake_drops_input_without_polling_or_replay() {
    let counts = Arc::new(Counts::default());
    let input = Box::pin(Source {
        values: VecDeque::new(),
        counts: counts.clone(),
        stall: true,
        trace: Arc::default(),
    });
    let backend = Backend {
        requests: Mutex::new(vec![]),
        wire: Arc::default(),
        fail: true,
        entropy: AtomicUsize::new(0),
    };
    let auth = auth();
    let result = ready(synthesize(
        TtsRequest::InworldTts2StreamingTextVoice(streaming(input)),
        Options {
            auth: Some(&auth),
            web_socket_transport: Some(&backend),
            ..Default::default()
        },
    ));
    assert_eq!(result.err().unwrap().to_string(), "handshake rejected");
    assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(backend.requests.lock().unwrap().len(), 1);
}
struct PendingIO(Arc<Counts>);
struct Guard(Arc<Counts>);
impl Drop for Guard {
    fn drop(&mut self) {
        self.0.drops.fetch_add(1, Ordering::SeqCst);
    }
}
impl HttpTransport for PendingIO {
    fn send(
        &self,
        _: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        Box::pin(async {
            let _guard = Guard(self.0.clone());
            std::future::pending().await
        })
    }
}
impl WebSocketTransport for PendingIO {
    fn connect(
        &self,
        _: ConnectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<Socket, TransportError>> + Send + '_>> {
        Box::pin(async {
            let _guard = Guard(self.0.clone());
            std::future::pending().await
        })
    }
    fn random_bytes(&self, bytes: &mut [u8]) -> Result<(), TransportError> {
        bytes.fill(1);
        Ok(())
    }
}
#[test]
fn dropping_pending_initialization_cancels_transport_and_owned_input() {
    for live in [false, true] {
        let counts = Arc::new(Counts::default());
        let inputs = Arc::new(Counts::default());
        let backend = PendingIO(counts.clone());
        let auth = auth();
        let r = if live {
            TtsRequest::InworldTts2StreamingTextVoice(streaming(Box::pin(Source {
                values: VecDeque::new(),
                counts: inputs.clone(),
                stall: true,
                trace: Arc::default(),
            })))
        } else {
            TtsRequest::InworldTts2TextVoice(request())
        };
        let mut future = Box::pin(synthesize(
            r,
            Options {
                auth: Some(&auth),
                transport: Some(&backend),
                web_socket_transport: Some(&backend),
                ..Default::default()
            },
        ));
        let waker = Waker::from(counts.clone());
        let mut cx = Context::from_waker(&waker);
        assert!(future.as_mut().poll(&mut cx).is_pending());
        drop(future);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(inputs.reads.load(Ordering::SeqCst), 0);
        assert_eq!(inputs.drops.load(Ordering::SeqCst), usize::from(live));
    }
}

#[derive(Debug)]
struct Marker(Arc<()>);
impl std::fmt::Display for Marker {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("original failure")
    }
}
impl std::error::Error for Marker {}
#[test]
fn producer_and_body_errors_keep_identity_and_drop_resources() {
    for live in [false, true] {
        let token = Arc::new(());
        let counts = Arc::new(Counts::default());
        let auth = auth();
        let mut stream = if live {
            let (socket, _) = socket(true);
            let input = Box::pin(Source {
                values: VecDeque::from([Err(Box::new(Marker(token.clone())) as TransportError)]),
                counts: counts.clone(),
                stall: false,
                trace: Arc::default(),
            });
            ready(synthesize(
                TtsRequest::InworldTts2StreamingTextVoice(streaming(input)),
                Options {
                    web_socket: Some(socket),
                    context_id: Some("ctx"),
                    ..Default::default()
                },
            ))
            .unwrap()
        } else {
            let transport = Http::new(200, vec![]);
            transport.response.lock().unwrap().as_mut().unwrap().body = Box::pin(Source {
                values: VecDeque::from([Err(Box::new(Marker(token.clone())) as TransportError)]),
                counts: counts.clone(),
                stall: false,
                trace: Arc::default(),
            });
            ready(synthesize(
                TtsRequest::InworldTts2TextVoice(request()),
                Options {
                    auth: Some(&auth),
                    transport: Some(&transport),
                    ..Default::default()
                },
            ))
            .unwrap()
        };
        let error = next(&mut stream).unwrap().err().unwrap();
        assert!(Arc::ptr_eq(
            &token,
            &error.downcast_ref::<Marker>().unwrap().0
        ));
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert!(next(&mut stream).is_none());
    }
}

#[test]
fn generated_request_guards_relational_bounds_and_message_limits() {
    let auth = auth();
    let mut r = request();
    r.speed = Some(9.0);
    let r = TtsRequest::InworldTts2TextVoice(r);
    let expected = validate_request(&r).err().unwrap().to_string();
    assert_eq!(
        ready(synthesize(
            r,
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
    let mut r = request();
    r.context_before = Some(TtsRequestTextVoiceContextBefore {
        texts: vec!["🙂".repeat(600), "🙂".repeat(401)],
    });
    assert_eq!(
        ready(synthesize(
            TtsRequest::InworldTts2TextVoice(r),
            Options {
                auth: Some(&auth),
                ..Default::default()
            }
        ))
        .err()
        .unwrap()
        .to_string(),
        "Inworld preceding context must not exceed 2000 characters"
    );
    let mut r = request();
    r.text = "🙂".repeat(1001);
    assert_eq!(
        ready(synthesize(
            TtsRequest::InworldTts2TextVoice(r),
            Options {
                auth: Some(&auth),
                http_mode: Some(HttpMode::Single),
                ..Default::default()
            }
        ))
        .err()
        .unwrap()
        .to_string(),
        "Inworld single-response text must not exceed 2000 characters"
    );
    let (socket, wire) = super::socket(true);
    let mut stream = ready(synthesize(
        TtsRequest::InworldTts2StreamingTextVoice(streaming(source(vec![Input::String(
            "🙂".repeat(1001),
        )]))),
        Options {
            web_socket: Some(socket),
            context_id: Some("ctx"),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        collect(&mut stream).err().unwrap().to_string(),
        "Inworld text chunks must not exceed 2000 characters"
    );
    assert_eq!(wire.lock().unwrap().sent.len(), 1);
    let (socket, wire) = super::socket(true);
    let mut stream = ready(synthesize(
        TtsRequest::InworldTts2StreamingTextVoice(streaming(source(vec![]))),
        Options {
            web_socket: Some(socket),
            context_id: Some("ctx"),
            max_message_bytes: 10,
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        collect(&mut stream).err().unwrap().to_string(),
        "Inworld message exceeds max_message_bytes"
    );
    assert!(wire.lock().unwrap().sent.is_empty());
    for url in [
        "https://user:secret@host",
        "https://host:99999",
        "https://host/%xx",
        "https://host/?q=%xx",
        "https://host/#fragment",
        "https://host/space here",
    ] {
        assert_eq!(
            ready(synthesize(
                TtsRequest::InworldTts2TextVoice(request()),
                Options {
                    auth: Some(&auth),
                    base_url: Some(url),
                    ..Default::default()
                }
            ))
            .err()
            .unwrap()
            .to_string(),
            "Invalid Inworld endpoint URL"
        );
    }
}

#[test]
fn malformed_wire_audio_alignment_and_json_fail_exactly() {
    for (data, expected) in [
        (
            r#"{"result":{"audioContent":NaN}}"#,
            "Inworld returned invalid JSON",
        ),
        (
            r#"{"result":{"audioContent":"%%%="}}"#,
            "Inworld returned invalid base64 audio",
        ),
        (
            r#"{"result":{"audioContent":[]}}"#,
            "Inworld returned invalid audio content",
        ),
        (r#"{"result":{}}"#, "Inworld returned no audio or alignment"),
        (
            r#"{"result":{"status":{"code":true},"usage":{}}}"#,
            "Inworld returned an invalid status code",
        ),
        (
            r#"{"result":{"timestampInfo":{"wordAlignment":{"words":["Hi"],"wordStartTimeSeconds":[],"wordEndTimeSeconds":[]}}}}"#,
            "Inworld returned mismatched timestamp arrays",
        ),
        (
            r#"{"result":{"timestampInfo":{"wordAlignment":{"words":["Hi"],"wordStartTimeSeconds":[1],"wordEndTimeSeconds":[0]}}}}"#,
            "Inworld returned a reversed timestamp range",
        ),
    ] {
        let transport = Http::new(200, vec![data.as_bytes().to_vec()]);
        let auth = auth();
        let mut r = request();
        r.timestamp_granularity = Some(TtsRequestTextVoiceTimestampGranularity::Word(
            Default::default(),
        ));
        let mut stream = ready(synthesize(
            TtsRequest::InworldTts2TextVoice(r),
            Options {
                auth: Some(&auth),
                transport: Some(&transport),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(collect(&mut stream).err().unwrap().to_string(), expected);
    }
}
