use super::*;

struct Backend {
    requests: Mutex<Vec<ConnectRequest>>,
    wire: Arc<Mutex<Wire>>,
}
impl WebSocketTransport for Backend {
    fn connect(
        &self,
        request: ConnectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<Socket, TransportError>> + Send + '_>> {
        self.requests.lock().unwrap().push(request);
        Box::pin(async { Ok(Box::pin(TestSocket(self.wire.clone())) as Socket) })
    }
    fn random_bytes(&self, _: &mut [u8]) -> Result<(), TransportError> {
        panic!("KugelAudio does not need correlation entropy")
    }
}

#[test]
fn native_header_auth_region_routes_and_overrides() {
    for (key, region, expected) in [
        (
            "eu-private",
            None,
            "wss://api.eu.kugelaudio.com/ws/tts/stream",
        ),
        (
            "eu-private",
            Some(Region::Global),
            "wss://api.kugelaudio.com/ws/tts/stream",
        ),
        (
            "private",
            Some(Region::Eu),
            "wss://api.eu.kugelaudio.com/ws/tts/stream",
        ),
    ] {
        let mut auth = auth();
        auth.kugelaudio.as_mut().unwrap().api_key = Some(key.into());
        let backend = Backend {
            requests: Mutex::default(),
            wire: Arc::default(),
        };
        let stream = ready(synthesize(
            TtsRequest::StreamingTextVoice(streaming(source(vec![]))),
            Options {
                auth: Some(&auth),
                web_socket_transport: Some(&backend),
                region,
                max_message_bytes: 1024,
                ..Default::default()
            },
        ))
        .unwrap();
        let requests = backend.requests.lock().unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].url, expected);
        assert_eq!(
            requests[0].headers,
            vec![("authorization".into(), "Bearer private".into())]
        );
        assert_eq!(requests[0].max_message_bytes, 1024);
        drop(stream);
        assert_eq!(backend.wire.lock().unwrap().closed, 1);
    }
    for (base, ws, socket, live, expected) in [
        (
            "https://test/p%2Fath/?x=1",
            None,
            false,
            false,
            "https://test/p%2Fath/v1/tts/generate?x=1",
        ),
        (
            "https://test/p/?x=1",
            None,
            true,
            false,
            "wss://test/p/ws/tts?x=1",
        ),
        (
            "http://test/p",
            None,
            true,
            true,
            "ws://test/p/ws/tts/stream",
        ),
        (
            "https://test",
            Some("wss://override/exact?x=1"),
            true,
            true,
            "wss://override/exact?x=1",
        ),
    ] {
        assert_eq!(speech_url(base, ws, socket, live).unwrap(), expected);
    }
    for url in [
        "https://user:secret@test",
        "https://test/#x",
        "https://test/%xx",
        "ftp://test",
        "https://test/\n",
    ] {
        assert_eq!(
            speech_url(url, None, true, false)
                .err()
                .unwrap()
                .to_string(),
            "Invalid KugelAudio endpoint URL"
        );
    }
}

#[test]
fn auth_environment_child() {
    let Ok(case) = std::env::var("SPEECHSWITCH_TEST_KUGELAUDIO_ENV") else {
        return;
    };
    let mut auth = auth();
    auth.kugelaudio.as_mut().unwrap().api_key = if case == "explicit_empty" {
        Some(String::new())
    } else {
        None
    };
    let http = Http::new(200, vec![]);
    let result = ready(synthesize(
        TtsRequest::TextVoice(request()),
        Options {
            auth: Some(&auth),
            transport: Some(&http),
            ..Default::default()
        },
    ));
    if case == "empty" || case == "explicit_empty" {
        assert_eq!(
            result.err().unwrap().to_string(),
            "Missing auth.kugelaudio.apiKey configuration"
        );
        assert_eq!(http.requests.lock().unwrap().len(), 0);
    } else {
        drop(result.unwrap());
        assert_eq!(
            http.requests.lock().unwrap()[0].headers[0],
            (
                "authorization".into(),
                if case == "scoped" {
                    "Bearer scoped"
                } else {
                    "Bearer native"
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
                "providers::kugelaudio::tests::boundary::auth_environment_child",
                "--nocapture",
            ])
            .env("SPEECHSWITCH_TEST_KUGELAUDIO_ENV", case)
            .env("KUGELAUDIO_API_KEY", "native")
            .env_remove("SPEECHSWITCH_KUGELAUDIO_API_KEY");
        if case == "scoped" {
            command.env("SPEECHSWITCH_KUGELAUDIO_API_KEY", "scoped");
        }
        if case == "empty" {
            command.env("SPEECHSWITCH_KUGELAUDIO_API_KEY", "");
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

#[test]
fn limits_auth_and_io_failures_drop_owned_resources() {
    for (json_limit, message_limit, expected) in [
        (
            0,
            1024,
            "KugelAudio max_json_bytes must be a positive uint32 value",
        ),
        (
            1024,
            0,
            "KugelAudio max_message_bytes must be a positive uint32 value",
        ),
    ] {
        let (socket, wire) = socket(false);
        assert_eq!(
            ready(synthesize(
                TtsRequest::TextVoice(request()),
                Options {
                    web_socket: Some(socket),
                    max_json_bytes: json_limit,
                    max_message_bytes: message_limit,
                    ..Default::default()
                }
            ))
            .err()
            .unwrap()
            .to_string(),
            expected
        );
        assert_eq!(wire.lock().unwrap().closed, 1);
    }
    let mut auth = auth();
    auth.kugelaudio.as_mut().unwrap().api_key = Some("key\r\nInjected: header".into());
    assert_eq!(
        ready(synthesize(
            TtsRequest::TextVoice(request()),
            Options {
                auth: Some(&auth),
                ..Default::default()
            }
        ))
        .err()
        .unwrap()
        .to_string(),
        "Invalid KugelAudio authentication header"
    );
    for (frame, limit, expected) in [
        (
            Some(Ok(Message::Binary(vec![1]))),
            1024,
            "KugelAudio returned a non-text WebSocket frame",
        ),
        (
            Some(Ok(Message::Text("é".repeat(301)))),
            600,
            "KugelAudio message exceeds max_message_bytes",
        ),
        (
            None,
            1024,
            "KugelAudio WebSocket closed before synthesis completed",
        ),
        (Some(Err(failure("read failed"))), 1024, "read failed"),
    ] {
        let (socket, wire) = socket(false);
        wire.lock().unwrap().incoming.push_back(frame);
        let mut stream = ready(synthesize(
            TtsRequest::TextVoice(request()),
            Options {
                web_socket: Some(socket),
                max_message_bytes: limit,
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(collect(&mut stream).err().unwrap().to_string(), expected);
        assert_eq!(wire.lock().unwrap().closed, 1);
    }
    let (socket, wire) = socket(false);
    let mut stream = ready(synthesize(
        TtsRequest::TextVoice(request()),
        Options {
            web_socket: Some(socket),
            max_message_bytes: 1,
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        collect(&mut stream).err().unwrap().to_string(),
        "KugelAudio message exceeds max_message_bytes"
    );
    assert_eq!(sent(&wire), vec![]);
}

#[test]
fn warning_callback_and_unavailable_billing_are_preserved() {
    let (socket, wire) = socket(false);
    for packet in [
        r#"{"warning":"fallback"}"#,
        r#"{"final":true,"usage":{"audio_seconds":0,"characters":0,"cost_cents":null,"cost_unavailable":true}}"#,
    ] {
        wire.lock()
            .unwrap()
            .incoming
            .push_back(Some(Ok(Message::Text(packet.into()))));
    }
    let warnings = Arc::new(Mutex::new(vec![]));
    let saved = warnings.clone();
    let mut stream = ready(synthesize(
        TtsRequest::TextVoice(request()),
        Options {
            web_socket: Some(socket),
            on_warning: Some(Box::new(move |v| saved.lock().unwrap().push(v.to_string()))),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        collect(&mut stream).unwrap(),
        vec![value(
            r#"{"event":"done","usage":{"audioSeconds":0,"characters":0,"costCents":null}}"#
        )]
    );
    assert_eq!(*warnings.lock().unwrap(), vec!["fallback"]);
}
