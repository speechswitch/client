use super::*;

struct Backend {
    request: Mutex<Option<ConnectRequest>>,
    socket: Mutex<Option<Socket>>,
    reject: bool,
}
impl WebSocketTransport for Backend {
    fn random_bytes(&self, b: &mut [u8]) -> Result<(), TransportError> {
        entropy(b)
    }
    fn connect(
        &self,
        r: ConnectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<Socket, TransportError>> + Send + '_>> {
        Box::pin(async move {
            *self.request.lock().unwrap() = Some(r);
            if self.reject {
                Err(failure("upgrade rejected"))
            } else {
                Ok(self.socket.lock().unwrap().take().unwrap())
            }
        })
    }
}
#[test]
fn native_backend_gets_header_auth_and_preserved_raw_query() {
    let (socket, _) = socket(true);
    let backend = Backend {
        request: Mutex::default(),
        socket: Mutex::new(Some(socket)),
        reject: false,
    };
    let auth = auth();
    let mut stream = ready(synthesize(
        streaming(source(vec![Input::String("Hi".into())])),
        Options {
            auth: Some(&auth),
            web_socket_transport: Some(&backend),
            base_url: Some(
                "https://proxy.invalid/a%2Fb/?tenant=a%20b&tag=a;b&%61pi_key=discard&model=gen2",
            ),
            ..Default::default()
        },
    ))
    .unwrap();
    while let Some(v) = next(&mut stream) {
        v.unwrap();
    }
    let request = backend.request.lock().unwrap();
    let r = request.as_ref().unwrap();
    assert_eq!(r.url,"wss://proxy.invalid/a%2Fb/v1/speech/stream-input?tenant=a%20b&tag=a;b&model=falcon-2&format=PCM&sample_rate=24000&channel_type=MONO");
    assert_eq!(r.headers, vec![("api_key".into(), "test-key".into())]);
    assert_eq!(r.max_message_bytes, 4 * 1024 * 1024);
}
#[test]
fn rejected_handshake_drops_unread_owned_input() {
    let backend = Backend {
        request: Mutex::default(),
        socket: Mutex::new(None),
        reject: true,
    };
    let auth = auth();
    let counts = Arc::new(Counts::default());
    let input = Box::pin(Source::<Input> {
        values: VecDeque::new(),
        counts: counts.clone(),
        stall: false,
        trace: Arc::default(),
    });
    assert_eq!(
        ready(synthesize(
            streaming(input),
            Options {
                auth: Some(&auth),
                web_socket_transport: Some(&backend),
                ..Default::default()
            }
        ))
        .err()
        .unwrap()
        .to_string(),
        "upgrade rejected"
    );
    assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}
#[test]
fn generated_request_and_input_bounds_precede_wire_writes() {
    let auth = auth();
    let http = http(200, vec![1]);
    for pitch in [0.5, 51.0, -51.0, f64::NAN, f64::INFINITY] {
        let mut r = request();
        r.pitch_bias = Some(pitch);
        assert_eq!(
            ready(synthesize(
                TtsRequest::TextVoice(r),
                Options {
                    auth: Some(&auth),
                    transport: Some(&http),
                    ..Default::default()
                }
            ))
            .err()
            .unwrap()
            .to_string(),
            "Invalid murf TTS request"
        );
    }
    for text in ["x".repeat(3000), "🚀".repeat(1500), "line\n".repeat(600)] {
        let mut r = request();
        r.text = text;
        assert!(validate_request(&TtsRequest::TextVoice(r)).is_ok());
    }
    for text in ["x".repeat(3001), "🚀".repeat(1501)] {
        let mut r = request();
        r.text = text;
        assert_eq!(
            ready(synthesize(
                TtsRequest::TextVoice(r),
                Options {
                    auth: Some(&auth),
                    transport: Some(&http),
                    ..Default::default()
                }
            ))
            .err()
            .unwrap()
            .to_string(),
            "Invalid murf TTS request"
        );
    }
    let (socket, state) = socket(false);
    let mut stream = ready(synthesize(
        streaming(source(vec![Input::String("🚀".repeat(1501))])),
        Options {
            web_socket: Some(socket),
            entropy: Some(&entropy),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        next(&mut stream).unwrap().err().unwrap().to_string(),
        "Murf text messages must not exceed 3000 characters"
    );
    assert_eq!(state.lock().unwrap().sent.len(), 1);
    assert_eq!(http.requests.lock().unwrap().len(), 0);
}
#[test]
fn unsafe_endpoints_empty_auth_and_transport_overrides_fail_before_io() {
    let auth = auth();
    let http = http(200, vec![1]);
    for target in [
        "https://user:pass@host",
        "https://host:65536",
        "https://host/?bad=%xx",
        "file:///tmp/audio",
        "https://host/#",
        "https://host/\n",
    ] {
        assert_eq!(
            ready(synthesize(
                TtsRequest::TextVoice(request()),
                Options {
                    auth: Some(&auth),
                    transport: Some(&http),
                    base_url: Some(target),
                    ..Default::default()
                }
            ))
            .err()
            .unwrap()
            .to_string(),
            "Invalid Murf endpoint URL"
        );
    }
    let mut empty = super::auth();
    empty.murf.as_mut().unwrap().api_key = Some(String::new());
    assert_eq!(
        ready(synthesize(
            TtsRequest::TextVoice(request()),
            Options {
                auth: Some(&empty),
                transport: Some(&http),
                ..Default::default()
            }
        ))
        .err()
        .unwrap()
        .to_string(),
        "Missing auth.murf.apiKey configuration"
    );
    let (socket, _) = socket(true);
    assert_eq!(
        ready(synthesize(
            TtsRequest::TextVoice(request()),
            Options {
                web_socket: Some(socket),
                ..Default::default()
            }
        ))
        .err()
        .unwrap()
        .to_string(),
        "Murf WebSocket overrides require streaming input"
    );
    assert_eq!(http.requests.lock().unwrap().len(), 0);
}

struct PendingHttp(Arc<Counts>);
struct PendingRequest(Arc<Counts>);
impl Drop for PendingRequest {
    fn drop(&mut self) {
        self.0.drops.fetch_add(1, Ordering::SeqCst);
    }
}
impl Future for PendingRequest {
    type Output = Result<HttpResponse, TransportError>;
    fn poll(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Self::Output> {
        self.0.reads.fetch_add(1, Ordering::SeqCst);
        Poll::Pending
    }
}
impl HttpTransport for PendingHttp {
    fn send(
        &self,
        _: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        Box::pin(PendingRequest(self.0.clone()))
    }
}
#[test]
fn dropping_pending_http_headers_aborts_request() {
    let counts = Arc::new(Counts::default());
    let http = PendingHttp(counts.clone());
    let auth = auth();
    let mut future = Box::pin(synthesize(
        TtsRequest::TextVoice(request()),
        Options {
            auth: Some(&auth),
            transport: Some(&http),
            ..Default::default()
        },
    ));
    let waker = Waker::from(counts.clone());
    let mut cx = Context::from_waker(&waker);
    assert!(future.as_mut().poll(&mut cx).is_pending());
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    drop(future);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn environment_auth_child() {
    let Ok(expected) = std::env::var("SPEECHSWITCH_TEST_MURF_AUTH") else {
        return;
    };
    let mut auth = auth();
    if expected == "explicit-empty" {
        auth.murf.as_mut().unwrap().api_key = Some(String::new());
    }
    let http = http(200, vec![]);
    let result = ready(synthesize(
        TtsRequest::TextVoice(request()),
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
            "Missing auth.murf.apiKey configuration"
        );
        assert_eq!(http.requests.lock().unwrap().len(), 0);
    } else {
        drop(result.unwrap());
        assert_eq!(
            http.requests.lock().unwrap()[0].headers[0],
            ("api-key".into(), expected)
        );
    }
}
#[test]
fn environment_precedence_uses_isolated_processes() {
    for (scoped, native, expected) in [
        (None, Some("legacy"), "legacy"),
        (Some("scoped"), Some("legacy"), "scoped"),
        (Some(""), Some("legacy"), ""),
        (Some("scoped"), None, "test-key"),
        (Some("scoped"), None, "explicit-empty"),
        (None, None, ""),
    ] {
        let mut cmd = std::process::Command::new(std::env::current_exe().unwrap());
        cmd.args([
            "--exact",
            "providers::murf::tests::boundary::environment_auth_child",
        ])
        .env("SPEECHSWITCH_TEST_MURF_AUTH", expected)
        .env_remove("SPEECHSWITCH_MURF_API_KEY")
        .env_remove("MURF_API_KEY");
        if let Some(v) = scoped {
            cmd.env("SPEECHSWITCH_MURF_API_KEY", v);
        }
        if let Some(v) = native {
            cmd.env("MURF_API_KEY", v);
        }
        let result = cmd.output().unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stdout)
        );
    }
}

#[test]
fn both_models_preserve_all_native_formats_and_rate_channel_choices() {
    for gen in [false, true] {
        for format in [
            TtsRequestStreamingTextVoiceOutputFormat::Pcm(Default::default()),
            TtsRequestStreamingTextVoiceOutputFormat::Wav(Default::default()),
            TtsRequestStreamingTextVoiceOutputFormat::Mp3(Default::default()),
            TtsRequestStreamingTextVoiceOutputFormat::Flac(Default::default()),
            TtsRequestStreamingTextVoiceOutputFormat::Alaw(Default::default()),
            TtsRequestStreamingTextVoiceOutputFormat::Mulaw(Default::default()),
            TtsRequestStreamingTextVoiceOutputFormat::Ogg(Default::default()),
        ] {
            let expected = if format.value() == "mulaw" {
                "ULAW".into()
            } else {
                format.value().to_ascii_uppercase()
            };
            let r = if gen {
                let mut r = gen2();
                r.output = Some(TtsRequestGen2TextVoiceca621e19Output {
                    format,
                    sample_rate_hz: Some(
                        TtsRequestGen2TextVoiceca621e19OutputSampleRateHz::Number48000(
                            Default::default(),
                        ),
                    ),
                    channel_count: Some(TtsRequestStreamingTextVoiceOutputChannelCount::Number2(
                        Default::default(),
                    )),
                });
                TtsRequest::Gen2TextVoiceca621e19(r)
            } else {
                let mut r = request();
                r.output = Some(TtsRequestStreamingTextVoiceOutput {
                    format,
                    sample_rate_hz: Some(
                        TtsRequestStreamingTextVoiceOutputSampleRateHz::Number48000(
                            Default::default(),
                        ),
                    ),
                    channel_count: Some(TtsRequestStreamingTextVoiceOutputChannelCount::Number2(
                        Default::default(),
                    )),
                });
                TtsRequest::TextVoice(r)
            };
            assert!(validate_request(&r).is_ok());
            let c = settings::settings(r);
            assert_eq!(c.format, expected);
            assert_eq!(c.rate, 48000.0);
            assert_eq!(c.channel, "STEREO");
        }
    }
}

#[test]
fn original_alignment_and_all_six_variance_values_preserve_zero() {
    for (index, variance) in [
        TtsRequestGen2TextVoiceca621e19DeliveryVariance::Number0(Default::default()),
        TtsRequestGen2TextVoiceca621e19DeliveryVariance::Number0Point2(Default::default()),
        TtsRequestGen2TextVoiceca621e19DeliveryVariance::Number0Point4(Default::default()),
        TtsRequestGen2TextVoiceca621e19DeliveryVariance::Number0Point6(Default::default()),
        TtsRequestGen2TextVoiceca621e19DeliveryVariance::Number0Point8(Default::default()),
        TtsRequestGen2TextVoiceca621e19DeliveryVariance::Number1(Default::default()),
    ]
    .into_iter()
    .enumerate()
    {
        let r = TtsRequest::Gen2TextVoice13ad89db(TtsRequestGen2TextVoice13ad89db {
            audio_retention: Some(TtsRequestGen2TextVoiceca621e19AudioRetention::False(
                Default::default(),
            )),
            delivery_variance: Some(variance),
            input_type: None,
            language: "en-US".into(),
            model: Default::default(),
            output: None,
            pitch_bias: Some(0.0),
            speed_bias: Some(0.0),
            target_duration_ms: Some(0.0),
            text: "Hello".into(),
            timestamp_granularity: Default::default(),
            timestamp_text: Default::default(),
            voice: "custom".into(),
            voice_style: Some(String::new()),
        });
        assert!(validate_request(&r).is_ok());
        let c = settings::settings(r);
        assert!(c.timed && c.inline);
        assert_eq!(c.rate, 44100.0);
        assert_eq!(c.wire["variation"], JsonValue::Number(index as f64));
        assert_eq!(c.wire["audioDuration"], JsonValue::Number(0.0));
        assert_eq!(c.wire["wordDurationsAsOriginalText"], JsonValue::Bool(true));
        assert_eq!(c.wire["style"], JsonValue::String(String::new()));
        assert_eq!(c.wire["rate"], JsonValue::Number(0.0));
        assert_eq!(c.wire["pitch"], JsonValue::Number(0.0));
    }
}

struct PendingSocket(Arc<Counts>);
impl Drop for PendingSocket {
    fn drop(&mut self) {
        self.0.drops.fetch_add(1, Ordering::SeqCst);
    }
}
impl Future for PendingSocket {
    type Output = Result<Socket, TransportError>;
    fn poll(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Self::Output> {
        self.0.reads.fetch_add(1, Ordering::SeqCst);
        Poll::Pending
    }
}
struct PendingBackend(Arc<Counts>);
impl WebSocketTransport for PendingBackend {
    fn random_bytes(&self, b: &mut [u8]) -> Result<(), TransportError> {
        entropy(b)
    }
    fn connect(
        &self,
        _: ConnectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<Socket, TransportError>> + Send + '_>> {
        Box::pin(PendingSocket(self.0.clone()))
    }
}
#[test]
fn dropping_pending_handshake_cancels_without_consuming_input() {
    let counts = Arc::new(Counts::default());
    let inputs = Arc::new(Counts::default());
    let backend = PendingBackend(counts.clone());
    let auth = auth();
    let input = Box::pin(Source::<Input> {
        values: VecDeque::new(),
        counts: inputs.clone(),
        stall: false,
        trace: Arc::default(),
    });
    let mut future = Box::pin(synthesize(
        streaming(input),
        Options {
            auth: Some(&auth),
            web_socket_transport: Some(&backend),
            ..Default::default()
        },
    ));
    let waker = Waker::from(counts.clone());
    let mut cx = Context::from_waker(&waker);
    assert!(future.as_mut().poll(&mut cx).is_pending());
    assert_eq!(inputs.reads.load(Ordering::SeqCst), 0);
    drop(future);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(inputs.drops.load(Ordering::SeqCst), 1);
}

struct PendingAsset {
    initial: Mutex<Option<HttpResponse>>,
    counts: Arc<Counts>,
}
impl HttpTransport for PendingAsset {
    fn send(
        &self,
        r: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        if let Some(response) = self.initial.lock().unwrap().take() {
            assert_eq!(r.method, "POST");
            Box::pin(async move { Ok(response) })
        } else {
            assert_eq!(r.method, "GET");
            assert_eq!(r.headers, vec![]);
            Box::pin(PendingRequest(self.counts.clone()))
        }
    }
}
#[test]
fn dropping_pending_audio_download_headers_releases_both_stages() {
    let counts = Arc::new(Counts::default());
    let metadata = Arc::new(Counts::default());
    let initial = HttpResponse {
        status: 200,
        headers: vec![],
        body: Box::pin(Source {
            values: VecDeque::from([Ok(fixtures()["generation"].text().as_bytes().to_vec())]),
            counts: metadata.clone(),
            stall: false,
            trace: Arc::default(),
        }),
    };
    let http = PendingAsset {
        initial: Mutex::new(Some(initial)),
        counts: counts.clone(),
    };
    let auth = auth();
    let mut stream = ready(synthesize(
        TtsRequest::Gen2TextVoiceca621e19(gen2()),
        Options {
            auth: Some(&auth),
            transport: Some(&http),
            ..Default::default()
        },
    ))
    .unwrap();
    let waker = Waker::from(counts.clone());
    let mut cx = Context::from_waker(&waker);
    assert!(Pin::new(&mut stream).poll_next(&mut cx).is_pending());
    assert_eq!(metadata.drops.load(Ordering::SeqCst), 1);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    drop(stream);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}
