use super::*;
#[test]
fn auth_environment_child() {
    let Ok(expected) = std::env::var("SPEECHSWITCH_TEST_RIME_AUTH") else {
        return;
    };
    let mut auth = auth();
    if expected == "explicit-empty" {
        auth.rime.as_mut().unwrap().api_key = Some(String::new())
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
                "Invalid Rime environment credential"
            } else {
                "Missing auth.rime.apiKey configuration"
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
                "providers::rime::tests::lifecycle::auth_environment_child",
                "--nocapture",
            ])
            .env("SPEECHSWITCH_TEST_RIME_AUTH", expected);
        for (name, value) in [
            ("SPEECHSWITCH_RIME_API_KEY", scoped),
            ("RIME_API_KEY", native),
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
                "providers::rime::tests::lifecycle::auth_environment_child",
                "--nocapture",
            ])
            .env("SPEECHSWITCH_TEST_RIME_AUTH", "invalid-env")
            .env(
                "SPEECHSWITCH_RIME_API_KEY",
                std::ffi::OsString::from_vec(vec![255]),
            )
            .env("RIME_API_KEY", "legacy")
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
fn native_boundary_sets_auth_model_query_and_owned_stream() {
    for (request, query) in [
        (
            whole(),
            concat!(
                "speaker=custom-uuid&modelId=coda&lang=en&samplingRate=24000",
                "&timeScaleFactor=1&audioFormat=pcm&segment=bySentence"
            ),
        ),
        (
            fixture_requests().remove(5),
            concat!(
                "speaker=custom-uuid&modelId=mistv2&lang=spa&samplingRate=22050",
                "&speedAlpha=0.5&noTextNormalization=true&pauseBetweenBrackets=false",
                "&phonemizeBetweenBrackets=true&audioFormat=mp3&segment=bySentence"
            ),
        ),
    ] {
        let (socket, state) = socket(true);
        let backend = Backend {
            socket: Mutex::new(Some(socket)),
            requests: Mutex::new(vec![]),
            pending: false,
            counts: Arc::new(Counts::default()),
        };
        let auth = auth();
        let mut stream = ready(synthesize(request, Options {
            auth: Some(&auth),
            web_socket_transport: Some(&backend),
            web_socket_url: Some("wss://proxy.example/prefix%2Fraw/ws3?tenant=a%2Bb&modelId=bad&modelId=also-bad"),
            max_message_bytes: 1024,
            ..Default::default()
        })).unwrap();
        let sent = backend.requests.lock().unwrap();
        assert_eq!(sent.len(), 1);
        assert_eq!(
            sent[0].url,
            format!("wss://proxy.example/prefix%2Fraw/ws3?tenant=a%2Bb&{query}")
        );
        assert_eq!(
            sent[0].headers,
            vec![("Authorization".into(), "Bearer fixture".into())]
        );
        assert_eq!(sent[0].max_message_bytes, 1024);
        drop(sent);
        drop(backend);
        drop(auth);
        assert_eq!(
            item(pull(&mut stream).unwrap().unwrap()),
            Item::Bytes(vec![0, 255])
        );
        assert_eq!(item(pull(&mut stream).unwrap().unwrap()), Item::Done);
        assert_eq!(state.lock().unwrap().drops, 1);
    }
}
#[test]
fn dropping_connect_future_owns_handshake_and_unpolled_input() {
    let (socket, state) = socket(false);
    let counts = Arc::new(Counts::default());
    let backend = Backend {
        socket: Mutex::new(Some(socket)),
        requests: Mutex::new(vec![]),
        pending: true,
        counts: counts.clone(),
    };
    let (input, input_counts, _) = body(vec![], false);
    let auth = auth();
    let mut future = Box::pin(synthesize(
        streaming(input),
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
fn drop_pending_headers_body_or_unpolled_future_releases_resources() {
    let auth = auth();
    let counts = Arc::new(Counts::default());
    let backend = PendingHttp(counts.clone());
    let mut future = Box::pin(synthesize(
        whole(),
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
            whole(),
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
            );
        }
        tick(&mut stream);
        assert!(counts.waker.lock().unwrap().is_some());
        drop(stream);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
    let (input, counts, _) = body(vec![], false);
    let (socket, state) = socket(false);
    drop(synthesize(
        streaming(input),
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
fn http_rejection_content_type_and_empty_body_do_not_complete() {
    let auth = auth();
    for (status, media, message) in [
        (403, "audio/L16", "Rime returned HTTP 403"),
        (307, "", "Rime returned HTTP 307"),
        (
            200,
            "application/json",
            "Rime returned an unexpected content type",
        ),
    ] {
        let (backend, counts) = http(vec![b"secret".to_vec()]);
        {
            let mut response = backend.response.lock().unwrap();
            let response = response.as_mut().unwrap();
            response.status = status;
            response.headers = vec![("Content-Type".into(), media.into())];
        }
        let error = ready(synthesize(
            whole(),
            Options {
                auth: Some(&auth),
                transport: Some(&backend),
                ..Default::default()
            },
        ))
        .err()
        .unwrap();
        assert_eq!(error.to_string(), message);
        if status != 200 {
            assert_eq!(error.downcast_ref::<Error>().unwrap().status, Some(status));
        }
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
    let (backend, counts) = http(vec![]);
    let mut stream = ready(synthesize(
        whole(),
        Options {
            auth: Some(&auth),
            transport: Some(&backend),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        pull(&mut stream).unwrap().err().unwrap().to_string(),
        "Rime returned no audio"
    );
    assert!(pull(&mut stream).is_none());
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
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
fn body_input_send_receive_and_flush_errors_keep_identity() {
    let auth = auth();
    let (bytes, counts, _) = body(
        vec![Ok(vec![1]), Err(Box::new(Marker) as TransportError)],
        true,
    );
    let backend = Http {
        response: Mutex::new(Some(HttpResponse {
            status: 200,
            headers: vec![],
            body: bytes,
        })),
        requests: Mutex::new(vec![]),
    };
    let mut stream = ready(synthesize(
        whole(),
        Options {
            auth: Some(&auth),
            transport: Some(&backend),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        item(pull(&mut stream).unwrap().unwrap()),
        Item::Bytes(vec![1])
    );
    assert!(pull(&mut stream).unwrap().err().unwrap().is::<Marker>());
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    for phase in ["input", "send", "receive", "flush"] {
        let (input, counts, _) = body(
            if phase == "input" {
                vec![Err(Box::new(Marker) as TransportError)]
            } else {
                vec![Ok(text("hi"))]
            },
            false,
        );
        let (socket, state) = socket(false);
        match phase {
            "send" => state.lock().unwrap().failure = Some(Box::new(Marker)),
            "receive" => state
                .lock()
                .unwrap()
                .replies
                .push_back(Err(Box::new(Marker))),
            "flush" => state.lock().unwrap().flush_failure = Some(Box::new(Marker)),
            _ => {}
        }
        let mut stream = live(input, socket, false);
        assert!(pull(&mut stream).unwrap().err().unwrap().is::<Marker>());
        assert!(pull(&mut stream).is_none());
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(state.lock().unwrap().drops, 1);
    }
}
#[test]
fn clean_close_still_requires_eos_write_completion() {
    let (input, _, _) = body(vec![], true);
    let (socket, state) = socket(false);
    let mut stream = live(input, socket, false);
    sent(&mut stream, &state, 1);
    {
        let mut s = state.lock().unwrap();
        s.closed = true;
        s.flush_pending = true;
    }
    tick(&mut stream);
    tick(&mut stream);
    assert_eq!(state.lock().unwrap().drops, 0);
    assert!(state.lock().unwrap().write_waker.is_some());
    state.lock().unwrap().flush_failure = Some(Box::new(Marker));
    assert!(pull(&mut stream).unwrap().err().unwrap().is::<Marker>());
    assert_eq!(state.lock().unwrap().drops, 1);
}
#[test]
fn frame_caps_unicode_and_cooperative_empty_chunks() {
    let auth = auth();
    let (backend, counts) = http(vec![vec![], vec![], vec![1]]);
    let mut stream = ready(synthesize(
        whole(),
        Options {
            auth: Some(&auth),
            transport: Some(&backend),
            ..Default::default()
        },
    ))
    .unwrap();
    tick(&mut stream);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    tick(&mut stream);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 2);
    assert_eq!(
        item(pull(&mut stream).unwrap().unwrap()),
        Item::Bytes(vec![1])
    );
    let (input, _, _) = body(
        vec![
            Ok(text("")),
            Ok(text(&"🚀".repeat(1000))),
            Ok(text(&"🚀".repeat(1000))),
            Ok(text(&"🚀".repeat(1001))),
        ],
        false,
    );
    let (socket, state) = socket(false);
    let mut stream = live(input, socket, false);
    let first = sent(&mut stream, &state, 1);
    assert_eq!(first, sent(&mut stream, &state, 2));
    assert_eq!(
        pull(&mut stream).unwrap().err().unwrap().to_string(),
        "Rime WebSocket text frames are limited to 1000 code points"
    );
    for incoming in [false, true] {
        let (socket, state) = self::socket(false);
        if incoming {
            packet(&state, &" ".repeat(100));
        }
        let mut stream = ready(synthesize(
            whole(),
            Options {
                auth: Some(&auth),
                web_socket: Some(socket),
                entropy: Some(&entropy),
                max_message_bytes: if incoming { 99 } else { 1 },
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(
            pull(&mut stream).unwrap().err().unwrap().to_string(),
            "Rime message exceeds max_message_bytes"
        );
        assert_eq!(state.lock().unwrap().drops, 1);
    }
}
#[test]
fn generated_validation_and_configuration_errors_precede_io() {
    let auth = auth();
    for phase in ["request", "limit", "entropy"] {
        let (socket, state) = socket(false);
        let mut r = request();
        if phase == "request" {
            r.speed = Some(0.0);
        }
        let error = ready(synthesize(
            TtsRequest::CodaTextVoicef75e9756(r),
            Options {
                auth: Some(&auth),
                web_socket: Some(socket),
                entropy: if phase == "entropy" {
                    None
                } else {
                    Some(&entropy)
                },
                max_message_bytes: if phase == "limit" { 0 } else { 1024 },
                ..Default::default()
            },
        ))
        .err()
        .unwrap();
        assert_eq!(
            error.to_string(),
            match phase {
                "request" => "Invalid rime TTS request",
                "limit" => "Rime max_message_bytes must be positive",
                _ => "Rime socket override entropy source is required",
            }
        );
        assert_eq!(state.lock().unwrap().sent.len(), 0);
        assert_eq!(state.lock().unwrap().drops, 1);
    }
    for speed in [0.0, -1.0, f64::from_bits(1)] {
        let mut request = fixture_requests().remove(2);
        if let TtsRequest::MistV3TextVoice2a5bc5c5(v) = &mut request {
            v.text_markup.as_mut().unwrap().speeds = Some(vec![speed]);
        }
        assert_eq!(
            ready(synthesize(
                request,
                Options {
                    auth: Some(&auth),
                    ..Default::default()
                }
            ))
            .err()
            .unwrap()
            .to_string(),
            "Rime inline speeds must have a positive finite reciprocal"
        );
    }
}
