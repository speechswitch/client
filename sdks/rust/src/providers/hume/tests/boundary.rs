use super::*;

#[test]
fn auth_environment_child() {
    let Ok(case) = std::env::var("SPEECHSWITCH_TEST_HUME_ENV") else {
        return;
    };
    let mut credentials = auth();
    credentials.hume.as_mut().unwrap().api_key = if case == "explicit_empty" {
        Some(String::new())
    } else {
        None
    };
    let transport = Http::new(200, vec![]);
    let result = ready(synthesize(
        TtsRequest::Octave2TextVoice(request()),
        Options {
            auth: Some(&credentials),
            transport: Some(&transport),
            ..Default::default()
        },
    ));
    if case == "empty" || case == "explicit_empty" {
        assert_eq!(
            result.err().unwrap().to_string(),
            "Missing auth.hume.apiKey configuration"
        );
        assert!(transport.requests.lock().unwrap().is_empty());
    } else {
        drop(result.unwrap());
        assert_eq!(
            transport.requests.lock().unwrap()[0].headers[0],
            (
                "x-hume-api-key".into(),
                if case == "scoped" { "scoped" } else { "native" }.into()
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
                "providers::hume::tests::boundary::auth_environment_child",
                "--nocapture",
            ])
            .env("SPEECHSWITCH_TEST_HUME_ENV", case)
            .env("HUME_API_KEY", "native")
            .env_remove("SPEECHSWITCH_HUME_API_KEY");
        if case == "scoped" {
            command.env("SPEECHSWITCH_HUME_API_KEY", "scoped");
        }
        if case == "empty" {
            command.env("SPEECHSWITCH_HUME_API_KEY", "");
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
    fn random_bytes(&self, _: &mut [u8]) -> Result<(), TransportError> {
        panic!("unexpected random bytes")
    }
}

#[test]
fn dropping_pending_initialization_cancels_transport_and_owned_input() {
    for live in [false, true] {
        let counts = Arc::new(Counts::default());
        let input_counts = Arc::new(Counts::default());
        let transport = PendingIO(counts.clone());
        let auth = auth();
        let request = if live {
            streaming(Box::pin(Source {
                values: VecDeque::new(),
                counts: input_counts.clone(),
                stall: true,
                trace: Arc::default(),
            }))
        } else {
            TtsRequest::Octave2TextVoice(request())
        };
        let mut future = Box::pin(synthesize(
            request,
            Options {
                auth: Some(&auth),
                transport: Some(&transport),
                web_socket_transport: Some(&transport),
                ..Default::default()
            },
        ));
        let waker = Waker::from(counts.clone());
        assert!(future
            .as_mut()
            .poll(&mut Context::from_waker(&waker))
            .is_pending());
        drop(future);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(input_counts.reads.load(Ordering::SeqCst), 0);
        assert_eq!(input_counts.drops.load(Ordering::SeqCst), usize::from(live));
    }
}

#[test]
fn explicit_zero_false_empty_and_omitted_options_remain_distinct() {
    let mut request = fixture_request(5, false);
    let TtsRequest::Octave1TextVoiceName(v) = &mut request else {
        unreachable!()
    };
    v.trailing_silence_ms = Some(0.0);
    v.instructions = Some(String::new());
    v.temperature = None;
    v.context_before = None;
    let transport = Http::new(200, vec![]);
    let auth = auth();
    drop(
        ready(synthesize(
            request,
            Options {
                auth: Some(&auth),
                transport: Some(&transport),
                ..Default::default()
            },
        ))
        .unwrap(),
    );
    let requests = transport.requests.lock().unwrap();
    let body = std::str::from_utf8(&requests[0].body).unwrap();
    assert_eq!(fixture(Raw::parse_exact(body).unwrap()),fixture(Raw::parse_exact(r#"{"utterances":[{"text":"Hi","voice":{"name":"Ava","provider":"HUME_AI"},"description":"","speed":0.25,"trailing_silence":0}],"version":"1","format":{"type":"mp3"},"include_timestamp_types":[],"num_generations":1,"split_utterances":false,"strip_headers":true,"instant_mode":false}"#).unwrap()));
}

struct Connector {
    requests: Mutex<Vec<ConnectRequest>>,
    result: Mutex<Option<Result<Socket, TransportError>>>,
}
impl WebSocketTransport for Connector {
    fn connect(
        &self,
        request: ConnectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<Socket, TransportError>> + Send + '_>> {
        self.requests.lock().unwrap().push(request);
        Box::pin(async { self.result.lock().unwrap().take().unwrap() })
    }
    fn random_bytes(&self, _: &mut [u8]) -> Result<(), TransportError> {
        panic!("Hume needs no random ID")
    }
}

#[test]
fn query_auth_overrides_managed_settings_without_losing_proxy_paths() {
    for token in [false, true] {
        for explicit in [false, true] {
            let mut auth = auth();
            if token {
                auth.hume.as_mut().unwrap().access_token = Some("a +/?&世界".into());
            }
            let (socket, _) = socket(true);
            let connector = Connector {
                requests: Mutex::default(),
                result: Mutex::new(Some(Ok(socket))),
            };
            let stale="?tenant=one&api_key=stale&%61pi_key=duplicate&access_token=stale&version=1&no_binary=true&temperature=0.5&include_timestamp_types=word&context_generation_id=old";
            let base = format!("https://proxy.test/a%2Fb/{stale}");
            let custom = format!("https://proxy.test/custom%2Fendpoint{stale}");
            let stream = ready(synthesize(
                streaming(source(vec![TextInput::String("Hello".into())])),
                Options {
                    auth: Some(&auth),
                    web_socket_transport: Some(&connector),
                    base_url: Some(&base),
                    web_socket_url: if explicit { Some(&custom) } else { None },
                    ..Default::default()
                },
            ))
            .unwrap();
            drop(stream);
            let requests = connector.requests.lock().unwrap();
            let request = &requests[0];
            assert_eq!(request.headers, vec![]);
            assert_eq!(request.max_message_bytes, 4 * 1024 * 1024);
            let path = if explicit {
                "custom%2Fendpoint"
            } else {
                "a%2Fb/v0/tts/stream/input"
            };
            let credential = if token {
                "access_token=a+%2B%2F%3F%26%E4%B8%96%E7%95%8C"
            } else {
                "api_key=test-key"
            };
            assert_eq!(request.url,format!("wss://proxy.test/{path}?tenant=one&{credential}&format_type=pcm&version=2&instant_mode=true&no_binary=false&strip_headers=true"));
        }
    }
}

#[test]
fn continuation_temperature_and_timestamp_query_are_explicit() {
    let mut request = fixture_request(3, true);
    let TtsRequest::Octave2StreamingTextVoice(v) = &mut request else {
        unreachable!()
    };
    v.context_before = Some(TtsRequestOctave1TextContextBeforeObject {
        request_ids: vec!["prior /?".into()],
    });
    v.temperature = Some(0.1);
    v.timestamp_granularity = Some(TtsRequestOctave2TurnsTimestampGranularity::Array(vec![
        TtsRequestOctave2TurnsTimestampGranularityArrayItem::Phoneme(Default::default()),
        TtsRequestOctave2TurnsTimestampGranularityArrayItem::Word(Default::default()),
    ]));
    let validate = validate_request(&request).unwrap();
    let c = settings::settings(request, Box::new(validate)).unwrap();
    assert_eq!(speech_url("https://api.hume.ai",None,&c,"key",false).unwrap(),"wss://api.hume.ai/v0/tts/stream/input?api_key=key&format_type=pcm&version=2&instant_mode=true&no_binary=true&strip_headers=true&context_generation_id=prior+%2F%3F&temperature=0.1&include_timestamp_types=phoneme&include_timestamp_types=word");
}

#[test]
fn handshake_failure_drops_owned_input_without_pulling_it() {
    let counts = Arc::new(Counts::default());
    let input = Box::pin(Source {
        values: VecDeque::new(),
        counts: counts.clone(),
        stall: false,
        trace: Arc::default(),
    });
    let error = failure("denied handshake");
    let address = &*error as *const _ as *const ();
    let connector = Connector {
        requests: Mutex::default(),
        result: Mutex::new(Some(Err(error))),
    };
    let auth = auth();
    let error = ready(synthesize(
        streaming(input),
        Options {
            auth: Some(&auth),
            web_socket_transport: Some(&connector),
            ..Default::default()
        },
    ))
    .err()
    .unwrap();
    assert_eq!(&*error as *const _ as *const (), address);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn token_precedence_and_empty_token_fallback_use_native_http_headers() {
    for token in ["token", ""] {
        let mut auth = auth();
        auth.hume.as_mut().unwrap().access_token = Some(token.into());
        let transport = Http::new(200, vec![]);
        drop(
            ready(synthesize(
                TtsRequest::Octave2TextVoice(request()),
                Options {
                    auth: Some(&auth),
                    transport: Some(&transport),
                    ..Default::default()
                },
            ))
            .unwrap(),
        );
        assert_eq!(
            transport.requests.lock().unwrap()[0].headers,
            vec![
                if token.is_empty() {
                    ("x-hume-api-key".into(), "test-key".into())
                } else {
                    ("authorization".into(), "Bearer token".into())
                },
                ("content-type".into(), "application/json".into())
            ]
        );
    }
}

#[test]
fn generated_validation_and_relational_errors_precede_transport() {
    let mut invalid = request();
    invalid.speed = Some(0.0);
    let mut prior = request();
    prior.context_before = Some(TtsRequestOctave1TextContextBefore::Object(
        TtsRequestOctave1TextContextBeforeObject {
            request_ids: vec!["".into()],
        },
    ));
    for (request, message) in [
        (
            TtsRequest::Octave2TextVoice(invalid),
            "Invalid hume TTS request",
        ),
        (
            TtsRequest::Octave2TextVoice(prior),
            "Hume continuation requires a non-empty generation ID",
        ),
    ] {
        let transport = Http::new(200, vec![]);
        let auth = auth();
        let error = ready(synthesize(
            request,
            Options {
                auth: Some(&auth),
                transport: Some(&transport),
                ..Default::default()
            },
        ))
        .err()
        .unwrap();
        assert_eq!(error.to_string(), message);
        assert!(transport.requests.lock().unwrap().is_empty());
    }
    for (index, duplicate) in [(2, true), (6, false)] {
        let mut request = fixture_request(index, false);
        match &mut request {
            TtsRequest::Octave2Turns(v) => {
                v.speakers
                    .push(TtsRequestOctave1TurnsSpeakersItem::Object9c8ccfab(
                        TtsRequestOctave1TurnsSpeakersItemObject9c8ccfab {
                            alias: "a".into(),
                            voice: "other".into(),
                            voice_source: None,
                        },
                    ))
            }
            TtsRequest::Octave1Turns(v) => v.turns[0].speaker = "missing".into(),
            _ => unreachable!(),
        }
        let error = ready(synthesize(request, Options::default()))
            .err()
            .unwrap();
        assert_eq!(
            error.to_string(),
            if duplicate {
                "Hume speaker aliases must be unique"
            } else {
                "Unknown Hume speaker: missing"
            }
        );
    }
}

#[test]
fn endpoint_and_credentials_fail_without_exposing_values() {
    let credentials = auth();
    for url in [
        "https://user:secret@host",
        "https://host:65536",
        "https://host/#fragment",
        "file:///tmp/key",
        "https://host/?q=%XX",
        "https://host/a b",
        "https://host\\path",
    ] {
        let error = ready(synthesize(
            TtsRequest::Octave2TextVoice(request()),
            Options {
                auth: Some(&credentials),
                base_url: Some(url),
                ..Default::default()
            },
        ))
        .err()
        .unwrap();
        assert_eq!(error.to_string(), "Invalid Hume endpoint URL");
    }
    for credential in ["a\r\nb", "世界"] {
        let mut auth = auth();
        auth.hume.as_mut().unwrap().api_key = Some(credential.into());
        let error = ready(synthesize(
            TtsRequest::Octave2TextVoice(request()),
            Options {
                auth: Some(&auth),
                ..Default::default()
            },
        ))
        .err()
        .unwrap();
        assert_eq!(error.to_string(), "Invalid Hume authentication header");
    }
}

#[test]
fn wire_packet_validation_and_padding_bits_match_other_languages() {
    for (data, message) in [
        (r#"{"type":"\ud800"}"#, "Hume returned invalid JSON"),
        ("[]", "Hume returned an invalid event"),
        ("null", "Hume returned an invalid event"),
        (
            r#"{"type":"audio"}"#,
            "Hume returned invalid correlation identifiers",
        ),
        (
            r#"{"type":"audio","generation_id":"g","request_id":"r","snippet_id":"s","audio":"AA=","chunk_index":0,"is_last_chunk":true}"#,
            "Hume returned invalid base64 audio",
        ),
        (
            r#"{"type":"timestamp","generation_id":"g","request_id":"r","snippet_id":"s","timestamp":{"type":"word","text":"Hi","time":{"begin":20,"end":10}}}"#,
            "Hume returned an invalid timestamp",
        ),
    ] {
        assert_eq!(
            protocol::packet(data, true).err().unwrap().to_string(),
            message
        );
    }
    let item=protocol::packet(r#"{"type":"audio","generation_id":"g","request_id":"r","snippet_id":"s","audio":"AB==","chunk_index":0,"is_last_chunk":true}"#,true).unwrap().unwrap();
    let SynthesisItem::Timeline(e) = item else {
        panic!("expected timeline")
    };
    assert_eq!(e.audio, Some(vec![0]));
}
