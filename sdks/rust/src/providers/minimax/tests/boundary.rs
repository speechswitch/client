use super::*;

#[test]
fn generated_validation_and_url_checks_precede_io() {
    let auth = auth();
    let http = http(200, false, "");
    let mut zero_volume = request();
    zero_volume.volume_scale = Some(0.0);
    let mut fractional_pitch = request();
    fractional_pitch.pitch_bias = Some(0.5);
    for r in [zero_volume, fractional_pitch] {
        assert_eq!(
            ready(synthesize(
                TtsRequest::TextVoice9b47fc40(r),
                Options {
                    auth: Some(&auth),
                    transport: Some(&http),
                    ..Default::default()
                }
            ))
            .err()
            .unwrap()
            .to_string(),
            "Invalid minimax TTS request"
        );
    }
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
                TtsRequest::TextVoice9b47fc40(request()),
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
            "Invalid MiniMax endpoint URL"
        );
    }
    let (socket, _) = socket(false);
    assert_eq!(
        ready(synthesize(
            TtsRequest::TextVoice9b47fc40(request()),
            Options {
                web_socket: Some(socket),
                ..Default::default()
            }
        ))
        .err()
        .unwrap()
        .to_string(),
        "MiniMax WebSocket overrides require streaming input"
    );
    assert!(http.requests.lock().unwrap().is_empty());
}

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
fn native_backend_receives_header_auth_and_bidi_path() {
    for reject in [false, true] {
        let (socket, state) = socket(true);
        let backend = Backend {
            request: Mutex::default(),
            socket: Mutex::new(Some(socket)),
            reject,
        };
        let counts = Arc::new(Counts::default());
        let input = Box::pin(Source::<Input> {
            values: VecDeque::new(),
            counts: counts.clone(),
            stall: false,
            trace: Arc::default(),
        });
        let auth = auth();
        let result = ready(synthesize(
            TtsRequest::StreamingTextVoice9e2e17ce(streaming(input)),
            Options {
                auth: Some(&auth),
                web_socket_transport: Some(&backend),
                base_url: Some("https://proxy.invalid/a%2Fb/?tenant=x"),
                ..Default::default()
            },
        ));
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        if reject {
            assert_eq!(result.err().unwrap().to_string(), "upgrade rejected");
        } else {
            drop(result.unwrap());
            assert_eq!(state.lock().unwrap().drops, 1);
        }
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        let r = backend.request.lock().unwrap();
        let r = r.as_ref().unwrap();
        assert_eq!(
            r.headers,
            vec![("Authorization".into(), "Bearer test-key".into())]
        );
        assert_eq!(
            r.url,
            "wss://proxy.invalid/a%2Fb/ws/v1/t2a_v2_bidi?tenant=x"
        );
        assert_eq!(r.max_message_bytes, 4 * 1024 * 1024);
    }
}

#[test]
fn environment_auth_child() {
    let Ok(expected) = std::env::var("SPEECHSWITCH_TEST_MINIMAX_AUTH") else {
        return;
    };
    let mut auth = auth();
    if expected == "explicit-empty" {
        auth.minimax.as_mut().unwrap().api_key = Some(String::new());
    }
    let http = http(200, false, "");
    let result = ready(synthesize(
        TtsRequest::TextVoice9b47fc40(request()),
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
            "Missing auth.minimax.apiKey configuration"
        );
        assert!(http.requests.lock().unwrap().is_empty());
    } else {
        drop(result.unwrap());
        assert_eq!(
            http.requests.lock().unwrap()[0].headers[0],
            ("Authorization".into(), format!("Bearer {expected}"))
        );
    }
}
#[test]
fn environment_precedence_isolated_from_parallel_tests() {
    for (scoped, native, expected) in [
        (None, Some("legacy"), "legacy"),
        (Some("scoped"), Some("legacy"), "scoped"),
        (Some(""), Some("legacy"), ""),
        (Some("scoped"), None, "test-key"),
        (Some("scoped"), None, "explicit-empty"),
        (None, None, ""),
    ] {
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "providers::minimax::tests::boundary::environment_auth_child",
            ])
            .env("SPEECHSWITCH_TEST_MINIMAX_AUTH", expected)
            .env_remove("SPEECHSWITCH_MINIMAX_API_KEY")
            .env_remove("MINIMAX_API_KEY");
        if let Some(v) = scoped {
            command.env("SPEECHSWITCH_MINIMAX_API_KEY", v);
        }
        if let Some(v) = native {
            command.env("MINIMAX_API_KEY", v);
        }
        let result = command.output().unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stdout)
        );
    }
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
fn dropping_pending_synthesis_future_aborts_http_headers() {
    let counts = Arc::new(Counts::default());
    let transport = PendingHttp(counts.clone());
    let auth = auth();
    let mut future = Box::pin(synthesize(
        TtsRequest::TextVoice9b47fc40(request()),
        Options {
            auth: Some(&auth),
            transport: Some(&transport),
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
