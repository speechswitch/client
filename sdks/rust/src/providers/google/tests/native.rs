use super::*;
use crate::http2::{self, Event, Http2Like};

#[derive(Default)]
struct NativeState {
    request: Option<http2::ConnectRequest>,
    frames: Vec<(Vec<u8>, bool)>,
    events: VecDeque<Event>,
    drops: usize,
}
struct Native(Arc<Mutex<NativeState>>);
impl Http2Transport for Native {
    fn connect(
        &self,
        request: http2::ConnectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<http2::Stream, TransportError>> + Send + '_>> {
        self.0.lock().unwrap().request = Some(request);
        Box::pin(async { Ok(Box::pin(Native(self.0.clone())) as http2::Stream) })
    }
}
impl Http2Like for Native {
    fn start_send(self: Pin<&mut Self>, bytes: Vec<u8>, end: bool) -> Result<(), TransportError> {
        let mut s = self.0.lock().unwrap();
        s.frames.push((bytes, end));
        if end {
            s.events
                .push_back(Event::Trailers(vec![("grpc-status".into(), "0".into())]));
        }
        Ok(())
    }
    fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Result<(), TransportError>> {
        Poll::Ready(Ok(()))
    }
    fn poll_receive(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
    ) -> Poll<Option<Result<Event, TransportError>>> {
        self.0
            .lock()
            .unwrap()
            .events
            .pop_front()
            .map_or(Poll::Pending, |event| Poll::Ready(Some(Ok(event))))
    }
}
impl Drop for Native {
    fn drop(&mut self) {
        self.0.lock().unwrap().drops += 1;
    }
}

#[test]
fn provider_constructs_native_authenticated_stable_and_beta_calls() {
    for beta in [false, true] {
        let counts = Arc::new(Counts::default());
        let text = source(vec![Ok("hello".into())], &counts, true);
        let request = if beta {
            TtsRequest::Chirp3InstantCustomVoice093d5f29(
                TtsRequestChirp3InstantCustomVoice093d5f29 {
                    model: Default::default(),
                    language: language(),
                    voice: "existing-key".into(),
                    text: TtsRequestChirp3Hd174648a4Text::AsyncIterable(text),
                    input_type: None,
                    replacements: None,
                    speed: None,
                    output: TtsRequestChirp3Hd174648a4Output::Pcm(pcm()),
                },
            )
        } else {
            streaming(text)
        };
        let state = Arc::new(Mutex::new(NativeState::default()));
        let transport = Native(state.clone());
        let mut stream = ready(synthesize(
            request,
            Options {
                auth: Some(&auth()),
                http2_transport: Some(&transport),
                grpc_url: Some("https://proxy.test/a%2Fb/?tenant=one"),
                ..Default::default()
            },
        ))
        .unwrap();
        {
            let s = state.lock().unwrap();
            let request = s.request.as_ref().unwrap();
            assert_eq!(request.method, "POST");
            assert_eq!(request.url,format!("https://proxy.test/a%2Fb/google.cloud.texttospeech.{}.TextToSpeech/StreamingSynthesize?tenant=one",if beta {"v1beta1"} else {"v1"}));
            assert_eq!(
                request.headers,
                vec![
                    ("content-type".into(), "application/grpc".into()),
                    ("te".into(), "trailers".into()),
                    ("grpc-accept-encoding".into(), "identity".into()),
                    ("x-goog-api-key".into(), "test-key".into()),
                    ("authorization".into(), "Bearer test-token".into()),
                    ("x-goog-user-project".into(), "test-project".into())
                ]
            );
            assert_eq!(request.max_data_bytes, 64 * 1024);
            assert_eq!(request.max_header_bytes, 64 * 1024);
        }
        pending(&mut stream);
        {
            let mut s = state.lock().unwrap();
            assert_eq!(s.frames.len(), 2);
            assert_eq!(
                s.frames[1],
                (
                    vec![0, 0, 0, 0, 9, 18, 7, 10, 5, b'h', b'e', b'l', b'l', b'o'],
                    false
                )
            );
            s.events.push_back(Event::Headers {
                status: 200,
                headers: vec![("content-type".into(), "application/grpc".into())],
                end_stream: false,
            });
            for byte in [0, 0, 0, 0, 4, 10, 2, 0, 255] {
                s.events.push_back(Event::Data {
                    bytes: vec![byte],
                    end_stream: false,
                });
            }
        }
        assert_eq!(next(&mut stream).unwrap().unwrap(), vec![0, 255]);
        drop(stream);
        assert_eq!(state.lock().unwrap().drops, 1);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn boundary_rejects_invalid_auth_urls_and_limits_before_connecting() {
    for target in [
        "https://user:secret@host",
        "https://host/#fragment",
        "https://host:99999",
        "https://host/%x",
        "https://host/?x=%0z",
    ] {
        let state = Arc::new(Mutex::new(NativeState::default()));
        let transport = Native(state.clone());
        let request = streaming(source(vec![], &Arc::default(), false));
        let error = ready(synthesize(
            request,
            Options {
                auth: Some(&auth()),
                http2_transport: Some(&transport),
                grpc_url: Some(target),
                ..Default::default()
            },
        ))
        .err()
        .unwrap();
        assert_eq!(
            error.to_string(),
            if target.ends_with("%x") || target.ends_with("%0z") {
                "Invalid Google endpoint escape"
            } else {
                "Invalid Google endpoint URL"
            }
        );
        assert!(state.lock().unwrap().request.is_none());
    }
    let mut auth = auth();
    auth.google.as_mut().unwrap().api_key = Some("key\nsecret".into());
    assert_eq!(
        ready(synthesize(
            TtsRequest::TextVoice(whole()),
            Options {
                auth: Some(&auth),
                ..Default::default()
            }
        ))
        .err()
        .unwrap()
        .to_string(),
        "Invalid Google authentication header"
    );
    auth.google.as_mut().unwrap().api_key = Some(String::new());
    auth.google.as_mut().unwrap().access_token = Some(String::new());
    assert_eq!(
        ready(synthesize(
            TtsRequest::TextVoice(whole()),
            Options {
                auth: Some(&auth),
                ..Default::default()
            }
        ))
        .err()
        .unwrap()
        .to_string(),
        "Missing auth.google.apiKey or auth.google.accessToken configuration"
    );
    assert_eq!(
        ready(synthesize(
            TtsRequest::TextVoice(whole()),
            Options {
                max_json_bytes: 0,
                ..Default::default()
            }
        ))
        .err()
        .unwrap()
        .to_string(),
        "Google byte limits must be positive uint32 values"
    );
}

#[test]
fn environment_resolution_in_isolated_process() {
    const CHILD: &str = "SPEECHSWITCH_GOOGLE_AUTH_TEST_CHILD";
    let names = [
        ("SPEECHSWITCH_GOOGLE_API_KEY", "GOOGLE_API_KEY"),
        (
            "SPEECHSWITCH_GOOGLE_ACCESS_TOKEN",
            "GOOGLE_OAUTH_ACCESS_TOKEN",
        ),
        (
            "SPEECHSWITCH_GOOGLE_QUOTA_PROJECT",
            "GOOGLE_CLOUD_QUOTA_PROJECT",
        ),
    ];
    if let Ok(expected) = std::env::var(CHILD) {
        let explicit = auth();
        let http = http(200, source(vec![], &Arc::default(), false));
        let result = ready(synthesize(
            TtsRequest::TextVoice(whole()),
            Options {
                auth: if expected == "explicit" {
                    Some(&explicit)
                } else {
                    None
                },
                transport: Some(&http),
                ..Default::default()
            },
        ));
        if expected == "empty" {
            assert_eq!(
                result.err().unwrap().to_string(),
                "Missing auth.google.apiKey or auth.google.accessToken configuration"
            );
            assert!(http.request.lock().unwrap().is_none());
        } else {
            drop(result.unwrap());
            let values = if expected == "explicit" {
                [
                    "test-key".into(),
                    "test-token".into(),
                    "test-project".into(),
                ]
            } else {
                [
                    format!("{expected}-0"),
                    format!("{expected}-1"),
                    format!("{expected}-2"),
                ]
            };
            assert_eq!(
                http.request.lock().unwrap().as_ref().unwrap().headers,
                vec![
                    ("x-goog-api-key".into(), values[0].clone()),
                    ("authorization".into(), format!("Bearer {}", values[1])),
                    ("x-goog-user-project".into(), values[2].clone()),
                    ("content-type".into(), "application/json".into()),
                ]
            );
        }
        return;
    }
    for expected in ["explicit", "scoped", "fallback", "empty"] {
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "providers::google::tests::native::environment_resolution_in_isolated_process",
            ])
            .env(CHILD, expected);
        for (index, (scoped, fallback)) in names.into_iter().enumerate() {
            command
                .env(fallback, format!("fallback-{index}"))
                .env_remove(scoped);
            if expected != "fallback" {
                command.env(
                    scoped,
                    if expected == "empty" {
                        String::new()
                    } else {
                        format!("scoped-{index}")
                    },
                );
            }
        }
        let output = command.output().unwrap();
        assert!(
            output.status.success(),
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
}

struct PendingOpen<T> {
    counts: Arc<Counts>,
    output: std::marker::PhantomData<fn() -> T>,
}
impl<T> Future for PendingOpen<T> {
    type Output = Result<T, TransportError>;
    fn poll(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Self::Output> {
        Poll::Pending
    }
}
impl<T> Drop for PendingOpen<T> {
    fn drop(&mut self) {
        self.counts.drops.fetch_add(1, Ordering::SeqCst);
    }
}
struct PendingTransport(Arc<Counts>);
impl HttpTransport for PendingTransport {
    fn send(
        &self,
        _: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        Box::pin(PendingOpen {
            counts: self.0.clone(),
            output: std::marker::PhantomData,
        })
    }
}
impl Http2Transport for PendingTransport {
    fn connect(
        &self,
        _: http2::ConnectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<http2::Stream, TransportError>> + Send + '_>> {
        Box::pin(PendingOpen {
            counts: self.0.clone(),
            output: std::marker::PhantomData,
        })
    }
}
#[test]
fn dropping_pending_setup_cancels_open_and_input() {
    for http in [false, true] {
        let opens = Arc::new(Counts::default());
        let inputs = Arc::new(Counts::default());
        let transport = PendingTransport(opens.clone());
        let auth = auth();
        let request = if http {
            TtsRequest::TextVoice(whole())
        } else {
            streaming(source(vec![], &inputs, true))
        };
        let mut future = Box::pin(synthesize(
            request,
            Options {
                auth: Some(&auth),
                transport: Some(&transport),
                http2_transport: Some(&transport),
                ..Default::default()
            },
        ));
        fn assert_send(_: &impl Send) {}
        assert_send(&future);
        let waker = Waker::from(Arc::new(Counts::default()));
        assert!(future
            .as_mut()
            .poll(&mut Context::from_waker(&waker))
            .is_pending());
        assert_eq!(inputs.reads.load(Ordering::SeqCst), 0);
        drop(future);
        assert_eq!(opens.drops.load(Ordering::SeqCst), 1);
        assert_eq!(inputs.drops.load(Ordering::SeqCst), usize::from(!http));
    }
}
