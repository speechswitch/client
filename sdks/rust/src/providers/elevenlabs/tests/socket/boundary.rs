use super::*;

struct Backend {
    socket: Mutex<Option<Socket>>,
    request: Mutex<Option<ConnectRequest>>,
    entropy: AtomicUsize,
}
impl WebSocketTransport for Backend {
    fn connect(
        &self,
        r: ConnectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<Socket, TransportError>> + Send + '_>> {
        *self.request.lock().unwrap() = Some(r);
        Box::pin(async { Ok(self.socket.lock().unwrap().take().unwrap()) })
    }
    fn random_bytes(&self, bytes: &mut [u8]) -> Result<(), TransportError> {
        self.entropy.fetch_add(1, Ordering::SeqCst);
        entropy(bytes)
    }
}
#[test]
fn native_headers_tokens_and_normalized_queries() {
    for dialogue in [false, true] {
        for token in [false, true] {
            let inputs = Arc::new(Counts::default());
            let counts = Arc::new(Counts::default());
            let (socket, state) = socket(&counts);
            let backend = Backend {
                socket: Mutex::new(Some(socket)),
                request: Mutex::new(None),
                entropy: AtomicUsize::new(0),
            };
            let mut a = auth();
            if token {
                a.elevenlabs.as_mut().unwrap().single_use_token = Some("short+token".into())
            }
            let r = if dialogue {
                let mut r = fixtures::dialogue(source(vec![dialogue_text("hi")], &inputs, false));
                r.language = Some("ja".into());
                r.random_seed = Some(4294967295.0);
                r.stability = Some(0.0);
                r.text_normalization = Some(TtsRequestTextVoice814840b5TextNormalization::False(
                    Default::default(),
                ));
                TtsRequest::ElevenV3StreamingTextVoice145c0c5a(r)
            } else {
                let mut r = fixtures::tts(source(vec![text("hi")], &inputs, false));
                r.model = TtsRequestTextVoice814840b5Model::FlashV25(Default::default());
                r.language = Some("ja".into());
                r.random_seed = Some(4294967295.0);
                r.stability = Some(0.0);
                r.voice_boost = Some(TtsRequestTextVoice814840b5LanguageTextNormalization::False(
                    Default::default(),
                ));
                r.text_normalization = Some(TtsRequestTextVoice814840b5TextNormalization::False(
                    Default::default(),
                ));
                r.text_buffer_thresholds = Some(vec![50.0, 500.0]);
                TtsRequest::StreamingTextVoice5024de38(r)
            };
            let mut stream = ready(synthesize(
                r,
                Options {
                    auth: Some(&a),
                    web_socket_transport: Some(&backend),
                    base_url: Some(
                        "https://proxy.test/p%20x?trace=1&seed=2&single_use_token=old&api_key=old",
                    ),
                    request_logging: false,
                    ..Default::default()
                },
            ))
            .unwrap();
            assert_eq!(collect(&mut stream), vec![parse("[0,255]"), parse("[1]")]);
            let lock = backend.request.lock().unwrap();
            let request = lock.as_ref().unwrap();
            assert_eq!(
                request.headers,
                if token {
                    vec![]
                } else {
                    vec![("xi-api-key".into(), "test-key".into())]
                }
            );
            assert_eq!(request.max_message_bytes, 4 * 1024 * 1024);
            let path = if dialogue {
                "/v1/text-to-dialogue/stream-input"
            } else {
                "/v1/text-to-speech/custom%2Fid/multi-stream-input"
            };
            let suffix = if dialogue {
                ""
            } else {
                "&inactivity_timeout=20&auto_mode=false&enable_ssml_parsing=false"
            };
            assert_eq!(request.url,format!("wss://proxy.test/p%20x{path}?trace=1&output_format=mp3_22050_32&enable_logging=false&model_id={}&sync_alignment=false&apply_text_normalization=off&language_code=ja&seed=4294967295{}{suffix}",if dialogue{"eleven_v3"}else{"eleven_flash_v2_5"},if token{"&single_use_token=short%2Btoken"}else{""}));
            let state = state.lock().unwrap();
            let expected = if dialogue {
                parse(r#"{"voice_settings":{"stability":0},"voices":["custom/id"]}"#)
            } else {
                parse(&format!("{{\"voice_settings\":{{\"stability\":0,\"use_speaker_boost\":false}},\"generation_config\":{{\"chunk_length_schedule\":[50,500]}},\"text\":\" \",\"context_id\":\"{}\"}}",state.context))
            };
            assert_eq!(state.sent[0], expected);
            assert_eq!(
                backend.entropy.load(Ordering::SeqCst),
                usize::from(!dialogue)
            );
        }
    }
}
#[test]
fn shared_socket_timestamp_shapes_and_final_audio() {
    for fixture in fixture_list("timing").into_iter().skip(1) {
        for normalized in [false, true] {
            let f = fixture.object().unwrap();
            let dialogue = f["protocol"].string().unwrap() == "dialogue";
            if dialogue && normalized {
                continue;
            }
            let inputs = Arc::new(Counts::default());
            let counts = Arc::new(Counts::default());
            let (socket, state) = socket(&counts);
            let a = auth();
            let alignment = f["alignment"].text();
            state.lock().unwrap().handler = Some(Box::new(move |state, text| {
                let fields = Raw::parse_exact(text).unwrap().object().unwrap();
                if fields.contains_key("close_socket") {
                    frame(state,format!("{{\"context_id\":\"{}\",\"audio\":\"AP8=\",\"is_final\":true,\"{}\":{alignment}}}",state.context,if normalized{"normalizedAlignment"}else{"alignment"}));
                    Ok(())
                } else if fields.contains_key("voice_settings") {
                    automatic(state, text)
                } else {
                    Ok(())
                }
            }));
            let r = if dialogue {
                TtsRequest::ElevenV3StreamingTextVoicec1dc022a(fixtures::timed_dialogue(source(
                    vec![dialogue_text("hi")],
                    &inputs,
                    false,
                )))
            } else {
                let mut r = fixtures::timed_tts(source(vec![text("hi")], &inputs, false));
                if normalized {
                    r.timestamp_text = Some(TtsRequestTextVoice1aa1b026TimestampText::Normalized(
                        Default::default(),
                    ))
                }
                TtsRequest::StreamingTextVoiceb9af60c3(r)
            };
            let mut stream = ready(synthesize(
                r,
                Options {
                    auth: Some(&a),
                    web_socket: Some(socket),
                    entropy: Some(&entropy),
                    ..Default::default()
                },
            ))
            .unwrap();
            assert_eq!(
                item(next(&mut stream).unwrap().unwrap()),
                parse(&format!(
                    "{{\"correlation\":\"chunk\",\"audio\":[0,255],\"timestamps\":{}}}",
                    f["timestamps"].text()
                ))
            );
            assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
            assert!(next(&mut stream).is_none());
        }
    }
}

struct HandshakeGuard(Arc<Counts>);
impl Drop for HandshakeGuard {
    fn drop(&mut self) {
        self.0.drops.fetch_add(1, Ordering::SeqCst);
    }
}
struct PendingBackend(Arc<Counts>);
impl WebSocketTransport for PendingBackend {
    fn connect(
        &self,
        _: ConnectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<Socket, TransportError>> + Send + '_>> {
        Box::pin(async {
            let _guard = HandshakeGuard(self.0.clone());
            self.0.reads.fetch_add(1, Ordering::SeqCst);
            std::future::pending().await
        })
    }
    fn random_bytes(&self, bytes: &mut [u8]) -> Result<(), TransportError> {
        entropy(bytes)
    }
}
#[test]
fn dropping_pending_handshake_releases_it_without_polling_input() {
    let inputs = Arc::new(Counts::default());
    let counts = Arc::new(Counts::default());
    let backend = PendingBackend(counts.clone());
    let a = auth();
    let mut future = Box::pin(synthesize(
        TtsRequest::StreamingTextVoice5024de38(fixtures::tts(source(
            vec![text("unread")],
            &inputs,
            false,
        ))),
        Options {
            auth: Some(&a),
            web_socket_transport: Some(&backend),
            ..Default::default()
        },
    ));
    let waker = Waker::from(Arc::new(Notice::default()));
    let mut cx = Context::from_waker(&waker);
    assert!(future.as_mut().poll(&mut cx).is_pending());
    drop(future);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(inputs.reads.load(Ordering::SeqCst), 0);
    assert_eq!(inputs.drops.load(Ordering::SeqCst), 1);
}
