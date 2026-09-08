use super::socket::{automatic, socket, SocketState};
use super::*;

struct Backend {
    request: Mutex<Option<ConnectRequest>>,
    socket: Mutex<Option<Socket>>,
}
impl WebSocketTransport for Backend {
    fn connect(
        &self,
        request: ConnectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<Socket, TransportError>> + Send + '_>> {
        *self.request.lock().unwrap() = Some(request);
        Box::pin(async { Ok(self.socket.lock().unwrap().take().unwrap()) })
    }
    fn random_bytes(&self, _: &mut [u8]) -> Result<(), TransportError> {
        panic!("Gradium needs no fabricated correlation ID")
    }
}
fn backend(state: &Arc<Mutex<SocketState>>) -> Backend {
    Backend {
        request: Mutex::new(None),
        socket: Mutex::new(Some(socket(state))),
    }
}

#[test]
fn native_backend_auth_token_replacement_and_transport_selection() {
    for token in [false, true] {
        for explicit in [false, true] {
            let mut auth = auth();
            if token {
                let entry = auth.gradium.as_mut().unwrap();
                entry.api_key = None;
                entry.single_use_token = Some("a +/?&".into());
            }
            let state = automatic();
            let backend = backend(&state);
            let mut stream = ready(synthesize(
                request(),
                Options {
                    auth: Some(&auth),
                    web_socket_transport: Some(&backend),
                    base_url: Some("https://proxy.test/a%2Fb/api/?tenant=one"),
                    web_socket_url: explicit.then_some(
                        "https://proxy.test/custom%2Fendpoint?tenant=one&%74oken=stale&token=again",
                    ),
                    setup_retry_ms: Some(0),
                    ..Default::default()
                },
            ))
            .unwrap();
            assert_eq!(
                collect(&mut stream).unwrap(),
                vec![Value::Binary(vec![0, 255])]
            );
            let request = backend.request.lock().unwrap().take().unwrap();
            let expected = match (token, explicit) {
                (false, false) => "wss://proxy.test/a%2Fb/api/speech/tts?tenant=one",
                (true, false) => {
                    "wss://proxy.test/a%2Fb/api/speech/tts?tenant=one&token=a+%2B%2F%3F%26"
                }
                (false, true) => {
                    "wss://proxy.test/custom%2Fendpoint?tenant=one&%74oken=stale&token=again"
                }
                (true, true) => {
                    "wss://proxy.test/custom%2Fendpoint?tenant=one&token=a+%2B%2F%3F%26"
                }
            };
            assert_eq!(request.url, expected);
            assert_eq!(
                request.headers,
                if token {
                    vec![]
                } else {
                    vec![("x-api-key".into(), "test-key".into())]
                }
            );
            assert_eq!(request.max_message_bytes, 4 * 1024 * 1024);
        }
    }
    let auth = auth();
    let state = automatic();
    let backend = backend(&state);
    let mut r = request();
    r.lexicon = Some("dictionary".into());
    let stream = ready(synthesize(
        r,
        Options {
            auth: Some(&auth),
            web_socket_transport: Some(&backend),
            ..Default::default()
        },
    ))
    .unwrap();
    assert!(backend.request.lock().unwrap().is_some());
    drop(stream);
}

#[test]
fn invalid_requests_options_and_urls_never_touch_transport_or_input() {
    let auth = auth();
    for temperature in [f64::NAN, f64::INFINITY, -0.1, 1.51] {
        let counts = Arc::new(Counts::default());
        let mut r = request();
        r.temperature = Some(temperature);
        r.text = TtsRequestText::AsyncIterable(source(vec![], &counts, true));
        let expected = validate_request(&r).err().unwrap().to_string();
        let state = automatic();
        let backend = backend(&state);
        assert_eq!(
            ready(synthesize(
                r,
                Options {
                    auth: Some(&auth),
                    web_socket_transport: Some(&backend),
                    ..Default::default()
                }
            ))
            .err()
            .unwrap()
            .to_string(),
            expected
        );
        assert!(backend.request.lock().unwrap().is_none());
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
    }
    let mut r = request();
    r.text_normalization = Some(TtsRequestTextNormalization::Object81d1078f(
        TtsRequestTextNormalizationObject81d1078f { rules: vec![] },
    ));
    assert_eq!(
        validate_request(&r).err().unwrap().to_string(),
        "Invalid gradium TTS request:\nrequest[\"textNormalization\"]: expected \"auto\"\nrequest[\"textNormalization\"]: expected false\nrequest[\"textNormalization\"][\"locale\"]: required field\nrequest[\"textNormalization\"][\"rules\"]: field is not allowed\nrequest[\"textNormalization\"][\"rules\"]: expected at least 1 items"
    );
    for (options, expected) in [
        (
            Options {
                max_json_bytes: 0,
                ..Default::default()
            },
            "Gradium max_json_bytes must be a positive uint32 value",
        ),
        (
            Options {
                max_message_bytes: 0,
                ..Default::default()
            },
            "Gradium max_message_bytes must be a positive uint32 value",
        ),
        (
            Options {
                setup_retry_ms: Some(9007199254740992),
                ..Default::default()
            },
            "Gradium setup_retry_ms must be a non-negative safe integer",
        ),
    ] {
        assert_eq!(
            ready(synthesize(request(), options))
                .err()
                .unwrap()
                .to_string(),
            expected
        );
    }
    for url in [
        "https://user:secret@host",
        "https://host/#fragment",
        "https://host:99999",
        "https://host/%xx",
        "https://host/?q=%xx",
        "ftp://host",
        "https://host/space here",
    ] {
        assert_eq!(
            speech_url(url, None, false, None).unwrap_err().to_string(),
            "Invalid Gradium endpoint URL"
        );
    }
    assert_eq!(
        ready(synthesize(
            request(),
            Options {
                auth: Some(&auth),
                ..Default::default()
            }
        ))
        .err()
        .unwrap()
        .to_string(),
        "Gradium HTTP transport is required"
    );
    assert_eq!(
        ready(synthesize(
            request(),
            Options {
                auth: Some(&auth),
                setup_retry_ms: Some(0),
                ..Default::default()
            }
        ))
        .err()
        .unwrap()
        .to_string(),
        "Gradium WebSocket transport is required"
    );
}

#[test]
fn every_format_and_normalization_default_convert_after_generated_checks() {
    for rate in [
        TtsRequestOutputPcmSampleRateHz::Number8000(Default::default()),
        TtsRequestOutputPcmSampleRateHz::Number16000(Default::default()),
        TtsRequestOutputPcmSampleRateHz::Number22050(Default::default()),
        TtsRequestOutputPcmSampleRateHz::Number24000(Default::default()),
        TtsRequestOutputPcmSampleRateHz::Number44100(Default::default()),
        TtsRequestOutputPcmSampleRateHz::Number48000(Default::default()),
    ] {
        let expected = format!("pcm_{}", rate.value());
        let mut r = request();
        let TtsRequestOutput::Pcm(v) = &mut r.output else {
            panic!()
        };
        v.sample_rate_hz = Some(rate);
        v.byte_order = Some(Default::default());
        v.sample_encoding = Some(Default::default());
        assert!(validate_request(&r).is_ok());
        assert_eq!(
            settings::wire(&r)["output_format"],
            JsonValue::String(expected)
        );
    }
    let mut r = request();
    r.output = TtsRequestOutput::Object(TtsRequestOutputObject {
        format: TtsRequestOutputObjectFormat::Alaw(Default::default()),
        sample_rate_hz: Some(Default::default()),
    });
    assert!(validate_request(&r).is_ok());
    assert_eq!(
        settings::wire(&r)["output_format"],
        JsonValue::String("alaw_8000".into())
    );
    let expected = settings::wire(&request());
    let mut r = request();
    r.model = Some(TtsRequestModel::Default(Default::default()));
    r.text_normalization = Some(TtsRequestTextNormalization::Auto(Default::default()));
    assert_eq!(settings::wire(&r), expected);
}

#[test]
fn exact_packet_failures_and_negative_zero_correlation() {
    for (data, expected) in [
        ("null", "Gradium returned an invalid event"),
        ("[]", "Gradium returned an invalid event"),
        ("{} trailing", "Gradium returned invalid JSON"),
        (r#"{"type":"ready"}"#, "Gradium returned an invalid event"),
        (
            r#"{"type":"error","message":"bad","code":true}"#,
            "Gradium returned an invalid event",
        ),
        (
            r#"{"type":"audio","audio":"AA==","client_req_id":null}"#,
            "Gradium returned an unexpected multiplexed request ID",
        ),
        (
            r#"{"type":"audio","audio":"AA==","stream_id":1.5}"#,
            "Gradium returned an invalid stream ID",
        ),
        (
            r#"{"type":"audio","audio":"AA==","stream_id":-1}"#,
            "Gradium returned an invalid stream ID",
        ),
        (
            r#"{"type":"audio","audio":"AA==","start_s":0}"#,
            "Gradium returned an invalid time range",
        ),
        (
            r#"{"type":"text","text":"hi","start_s":1,"stop_s":0}"#,
            "Gradium returned an invalid time range",
        ),
        (
            r#"{"type":"text","text":"hi","start_s":0,"stop_s":1e308}"#,
            "Gradium returned an invalid time range",
        ),
        (
            r#"{"type":"audio","audio":"AA\n=="}"#,
            "Gradium returned invalid base64 audio",
        ),
        (
            r#"{"type":"audio","audio":"%%"}"#,
            "Gradium returned invalid base64 audio",
        ),
        (
            r#"{"type":"audio","audio":"\ud800"}"#,
            "Gradium returned invalid JSON",
        ),
    ] {
        assert_eq!(
            protocol::packet(data, true).err().unwrap().to_string(),
            expected
        );
    }
    let protocol::Packet::Item(SynthesisItem::Timeline(v)) =
        protocol::packet(r#"{"type":"audio","audio":"AA==","stream_id":-0}"#, true).unwrap()
    else {
        panic!()
    };
    assert_eq!(v.correlation_id, Some("0".into()));
}

struct Guard(Arc<Counts>);
impl Drop for Guard {
    fn drop(&mut self) {
        self.0.drops.fetch_add(1, Ordering::SeqCst);
    }
}
struct Pending {
    counts: Arc<Counts>,
}
impl HttpTransport for Pending {
    fn send(
        &self,
        _: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        let guard = Guard(self.counts.clone());
        Box::pin(async move {
            let _guard = guard;
            std::future::pending().await
        })
    }
}
impl WebSocketTransport for Pending {
    fn connect(
        &self,
        _: ConnectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<Socket, TransportError>> + Send + '_>> {
        let guard = Guard(self.counts.clone());
        Box::pin(async move {
            let _guard = guard;
            std::future::pending().await
        })
    }
    fn random_bytes(&self, _: &mut [u8]) -> Result<(), TransportError> {
        panic!()
    }
}
#[test]
fn drop_pending_http_or_socket_setup_cancels_backend_before_input_polling() {
    let auth = auth();
    for socket in [false, true] {
        let counts = Arc::new(Counts::default());
        let input = Arc::new(Counts::default());
        let backend = Pending {
            counts: counts.clone(),
        };
        let mut r = request();
        if socket {
            r.text = TtsRequestText::AsyncIterable(source(vec![], &input, true));
        }
        let mut future = Box::pin(synthesize(
            r,
            Options {
                auth: Some(&auth),
                transport: Some(&backend),
                web_socket_transport: Some(&backend),
                ..Default::default()
            },
        ));
        let waker = Waker::from(Arc::new(Counts::default()));
        let mut cx = Context::from_waker(&waker);
        assert!(future.as_mut().poll(&mut cx).is_pending());
        drop(future);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(input.reads.load(Ordering::SeqCst), 0);
        if socket {
            assert_eq!(input.drops.load(Ordering::SeqCst), 1);
        }
    }
}

#[test]
fn auth_environment_child() {
    let Ok(expected) = std::env::var("SPEECHSWITCH_TEST_GRADIUM_AUTH") else {
        return;
    };
    let mut auth = auth();
    if expected == "explicit-empty" {
        auth.gradium.as_mut().unwrap().api_key = Some(String::new());
    }
    let http = http(source(vec![], &Arc::default(), false), 200);
    let result = ready(synthesize(
        request(),
        Options {
            auth: if expected == "test-key" || expected == "explicit-empty" {
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
            "Missing auth.gradium.apiKey configuration"
        );
        assert!(http.request.lock().unwrap().is_none());
    } else {
        drop(result.unwrap());
        assert_eq!(
            http.request.lock().unwrap().as_ref().unwrap().headers[0],
            ("x-api-key".into(), expected)
        );
    }
}
#[test]
fn auth_precedence_isolated_from_other_tests() {
    for (scoped, native, expected) in [
        (None, Some("native"), "native"),
        (Some("scoped"), Some("native"), "scoped"),
        (Some(""), Some("native"), ""),
        (None, None, ""),
        (Some("scoped"), Some("native"), "test-key"),
        (Some("scoped"), Some("native"), "explicit-empty"),
    ] {
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "providers::gradium::tests::boundary::auth_environment_child",
                "--nocapture",
            ])
            .env("SPEECHSWITCH_TEST_GRADIUM_AUTH", expected);
        for (name, value) in [
            ("SPEECHSWITCH_GRADIUM_API_KEY", scoped),
            ("GRADIUM_API_KEY", native),
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
}
