use super::*;
use crate::{
    generated::auth::AuthAsync,
    http::{HttpResponse, TransportError},
    json::Raw,
    runtime::JsonValue,
};
use std::{
    collections::{BTreeMap, VecDeque},
    future::Future,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    task::{Wake, Waker},
};

const DELTA: &str = "data: {\"type\":\"speech.audio.delta\",\"audio_data\":\"AP+A\"}\n\n";
const DONE: &str = "data: {\"type\":\"speech.audio.done\",\"usage\":{}}\n\n";
#[derive(Default)]
struct Counts {
    reads: AtomicUsize,
    drops: AtomicUsize,
    wakes: AtomicUsize,
}

#[test]
fn auth_environment_child() {
    let Ok(expected) = std::env::var("SPEECHSWITCH_TEST_MISTRAL_AUTH") else {
        return;
    };
    let counts = Arc::new(Counts::default());
    let waker = Waker::from(counts.clone());
    let mut context = Context::from_waker(&waker);
    let transport = transport(&counts, vec![], "", 200, false);
    let auth = auth();
    let options = Options {
        auth: if expected == "test" {
            Some(&auth)
        } else {
            None
        },
        ..Options::default()
    };
    let result = ready(synthesize(&request(), &transport, options), &mut context);
    if expected.is_empty() {
        assert_eq!(
            result.err().unwrap().to_string(),
            "Missing auth.mistral.apiKey configuration"
        );
        assert!(transport.requests.lock().unwrap().is_empty());
    } else {
        drop(result.unwrap());
        assert_eq!(
            transport.requests.lock().unwrap()[0].headers[0],
            ("Authorization".into(), format!("Bearer {expected}"))
        );
    }
}

#[test]
fn auth_precedence_uses_isolated_process_environments() {
    for (scoped, native, expected) in [
        (None, Some("native"), "native"),
        (Some("scoped"), Some("native"), "scoped"),
        (Some(""), Some("native"), ""),
        (None, None, ""),
        (Some("scoped"), Some("native"), "test"),
    ] {
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "providers::mistral::tests::auth_environment_child",
                "--nocapture",
            ])
            .env_remove("SPEECHSWITCH_MISTRAL_API_KEY")
            .env_remove("MISTRAL_API_KEY")
            .env("SPEECHSWITCH_TEST_MISTRAL_AUTH", expected);
        if let Some(value) = scoped {
            command.env("SPEECHSWITCH_MISTRAL_API_KEY", value);
        }
        if let Some(value) = native {
            command.env("MISTRAL_API_KEY", value);
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
impl Wake for Counts {
    fn wake(self: Arc<Self>) {
        self.wake_by_ref();
    }
    fn wake_by_ref(self: &Arc<Self>) {
        self.wakes.fetch_add(1, Ordering::SeqCst);
    }
}
struct Body {
    counts: Arc<Counts>,
    chunks: VecDeque<Result<Vec<u8>, TransportError>>,
    stalled: bool,
}
impl Drop for Body {
    fn drop(&mut self) {
        self.counts.drops.fetch_add(1, Ordering::SeqCst);
    }
}
impl InputStream<Vec<u8>> for Body {
    fn poll_next(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
    ) -> Poll<Option<Result<Vec<u8>, TransportError>>> {
        let body = self.get_mut();
        body.counts.reads.fetch_add(1, Ordering::SeqCst);
        if body.stalled && body.chunks.is_empty() {
            return Poll::Pending;
        }
        Poll::Ready(body.chunks.pop_front())
    }
}
struct Transport {
    response: Mutex<Option<HttpResponse>>,
    requests: Mutex<Vec<HttpRequest>>,
}
impl HttpTransport for Transport {
    fn send(
        &self,
        request: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        self.requests.lock().unwrap().push(request);
        let response = self.response.lock().unwrap().take().unwrap();
        Box::pin(async move { Ok(response) })
    }
}
fn transport(
    counts: &Arc<Counts>,
    chunks: Vec<Vec<u8>>,
    content_type: &str,
    status: u16,
    stalled: bool,
) -> Transport {
    Transport {
        requests: Mutex::new(Vec::new()),
        response: Mutex::new(Some(HttpResponse {
            status,
            headers: vec![
                ("Content-Type".into(), content_type.into()),
                ("Retry-After".into(), "7".into()),
            ],
            body: Box::pin(Body {
                counts: counts.clone(),
                chunks: chunks.into_iter().map(Ok).collect(),
                stalled,
            }),
        })),
    }
}
fn request() -> TtsRequest {
    TtsRequest {
        text: "Hello".into(),
        model: None,
        output: None,
        voice: None,
        reference_audio: None,
        metadata: None,
        prompt_cache_key: None,
    }
}
fn auth() -> Auth {
    Auth {
        async_: None,
        aws: None,
        camb: None,
        cartesia: None,
        deepdub: None,
        deepgram: None,
        elevenlabs: None,
        fish: None,
        google: None,
        gradium: None,
        hume: None,
        inworld: None,
        kugelaudio: None,
        lovo: None,
        microsoft: None,
        minimax: None,
        mistral: Some(AuthAsync {
            api_key: Some("test".into()),
        }),
        murf: None,
        openai: None,
        resemble: None,
        respeecher: None,
        rime: None,
        smallest_ai: None,
        typecast: None,
        vocu: None,
        voice_ai: None,
        xai: None,
    }
}
fn ready<T>(future: impl Future<Output = T>, context: &mut Context<'_>) -> T {
    match std::pin::pin!(future).as_mut().poll(context) {
        Poll::Ready(value) => value,
        Poll::Pending => panic!("unexpected pending send"),
    }
}
fn value(raw: Raw<'_>) -> JsonValue {
    if raw.is_null() {
        JsonValue::Null
    } else if let Ok(value) = raw.boolean() {
        JsonValue::Bool(value)
    } else if let Ok(value) = raw.string() {
        JsonValue::String(value)
    } else if let Ok(value) = raw.array() {
        JsonValue::Array(value.into_iter().map(self::value).collect())
    } else if let Ok(value) = raw.object() {
        JsonValue::Object(
            value
                .into_iter()
                .map(|(key, value)| (key, self::value(value)))
                .collect(),
        )
    } else {
        JsonValue::Number(raw.number().unwrap())
    }
}
fn nullable(value: PromptTokensDetailsMessagesItemTotalTokens) -> JsonValue {
    match value {
        PromptTokensDetailsMessagesItemTotalTokens::Null(_) => JsonValue::Null,
        PromptTokensDetailsMessagesItemTotalTokens::Number(value) => JsonValue::Number(value),
    }
}
fn details(value: UsagePromptTokenDetails) -> JsonValue {
    let value = match value {
        UsagePromptTokenDetails::Null(_) => return JsonValue::Null,
        UsagePromptTokenDetails::Object(value) => value,
    };
    let mut fields = BTreeMap::new();
    if let Some(value) = value.cached_tokens {
        fields.insert("cachedTokens".into(), JsonValue::Number(value));
    }
    if let Some(value) = value.audio_tokens {
        fields.insert("audioTokens".into(), JsonValue::Number(value));
    }
    if let Some(value) = value.messages {
        fields.insert(
            "messages".into(),
            JsonValue::Array(
                value
                    .into_iter()
                    .map(|value| {
                        let role = match value.role {
                            PromptTokensDetailsMessagesItemRole::Assistant(value) => value.value(),
                            PromptTokensDetailsMessagesItemRole::System(value) => value.value(),
                            PromptTokensDetailsMessagesItemRole::Tool(value) => value.value(),
                            PromptTokensDetailsMessagesItemRole::User(value) => value.value(),
                        };
                        let mut fields =
                            BTreeMap::from([("role".into(), JsonValue::String(role.into()))]);
                        if let Some(value) = value.total_tokens {
                            fields.insert("totalTokens".into(), nullable(value));
                        }
                        if let Some(value) = value.usage_count {
                            fields.insert("usageCount".into(), JsonValue::Number(value));
                        }
                        if let Some(value) = value.truncated {
                            fields.insert(
                                "truncated".into(),
                                JsonValue::Bool(match value {
                                    PromptTokensDetailsMessagesItemTruncated::False(value) => {
                                        value.value()
                                    }
                                    PromptTokensDetailsMessagesItemTruncated::True(value) => {
                                        value.value()
                                    }
                                }),
                            );
                        }
                        JsonValue::Object(fields)
                    })
                    .collect(),
            ),
        );
    }
    JsonValue::Object(fields)
}
fn normalized(item: SynthesisItem) -> JsonValue {
    match item {
        SynthesisItem::Bytes(audio) => JsonValue::Object(BTreeMap::from([(
            "audio".into(),
            JsonValue::Array(
                audio
                    .into_iter()
                    .map(|value| JsonValue::Number(value as f64))
                    .collect(),
            ),
        )])),
        SynthesisItem::Done(done) => {
            let mut result =
                BTreeMap::from([("event".into(), JsonValue::String(done.event.value().into()))]);
            if let Some(value) = done.usage {
                let mut fields = BTreeMap::new();
                for (name, value) in [
                    ("promptTokens", value.prompt_tokens),
                    ("totalTokens", value.total_tokens),
                ] {
                    if let Some(value) = value {
                        fields.insert(name.into(), JsonValue::Number(value));
                    }
                }
                for (name, value) in [
                    ("completionTokens", value.completion_tokens),
                    ("promptAudioSeconds", value.prompt_audio_seconds),
                    ("requestCount", value.request_count),
                    ("cachedTokens", value.cached_tokens),
                ] {
                    if let Some(value) = value {
                        fields.insert(name.into(), nullable(value));
                    }
                }
                for (name, value) in [
                    ("promptTokensDetails", value.prompt_tokens_details),
                    ("promptTokenDetails", value.prompt_token_details),
                ] {
                    if let Some(value) = value {
                        fields.insert(name.into(), details(value));
                    }
                }
                if let Some(value) = value.completion_tokens_details {
                    fields.insert(
                        "completionTokensDetails".into(),
                        match value {
                            UsageCompletionTokensDetails::Null(_) => JsonValue::Null,
                            UsageCompletionTokensDetails::Object(value) => JsonValue::Object(
                                value
                                    .reasoning_tokens
                                    .map(|value| {
                                        ("reasoningTokens".into(), JsonValue::Number(value))
                                    })
                                    .into_iter()
                                    .collect(),
                            ),
                        },
                    );
                }
                result.insert("usage".into(), JsonValue::Object(fields));
            }
            JsonValue::Object(result)
        }
    }
}

#[test]
fn shared_protocol_fixtures_at_every_byte_split() {
    for fixture in Raw::parse(include_str!("../../../../fixtures/mistral.json"))
        .unwrap()
        .array()
        .unwrap()
    {
        let fixture = fixture.object().unwrap();
        let name = fixture["name"].string().unwrap();
        let body = fixture["body"].string().unwrap().into_bytes();
        for split in 0..=body.len() {
            let counts = Arc::new(Counts::default());
            let waker = Waker::from(counts.clone());
            let mut context = Context::from_waker(&waker);
            let transport = transport(
                &counts,
                vec![body[..split].to_vec(), body[split..].to_vec()],
                &fixture["contentType"].string().unwrap(),
                200,
                false,
            );
            let auth = auth();
            let mut stream = ready(
                synthesize(
                    &request(),
                    &transport,
                    Options {
                        auth: Some(&auth),
                        ..Options::default()
                    },
                ),
                &mut context,
            )
            .unwrap();
            let mut output = Vec::new();
            let mut error = None;
            let mut terminal = false;
            for _ in 0..body.len() + 20 {
                match Pin::new(&mut stream).poll_next(&mut context) {
                    Poll::Pending => {}
                    Poll::Ready(None) => {
                        terminal = true;
                        break;
                    }
                    Poll::Ready(Some(Ok(item))) => output.push(normalized(item)),
                    Poll::Ready(Some(Err(failure))) => {
                        error = Some(failure.to_string());
                        terminal = true;
                        break;
                    }
                }
            }
            assert!(terminal, "{name} split {split} did not finish");
            assert_eq!(
                JsonValue::Array(output),
                value(fixture["output"]),
                "{name} split {split}"
            );
            assert_eq!(
                error,
                fixture.get("error").map(|raw| raw.string().unwrap()),
                "{name} split {split}"
            );
            assert_eq!(
                counts.drops.load(Ordering::SeqCst),
                1,
                "{name} split {split}"
            );
            drop(stream);
            assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        }
    }
}

#[test]
fn request_conversion_and_completion_without_prefetch() {
    let counts = Arc::new(Counts::default());
    let waker = Waker::from(counts.clone());
    let mut context = Context::from_waker(&waker);
    let transport = transport(
        &counts,
        vec![DELTA.as_bytes().to_vec(), DONE.as_bytes().to_vec()],
        "text/event-stream",
        200,
        true,
    );
    let auth = auth();
    let mut request = request();
    request.voice = Some("existing-custom-voice".into());
    request.reference_audio = Some(vec![0, 255, 128]);
    request.prompt_cache_key = Some(String::new());
    request.metadata = Some(BTreeMap::from([(
        "KeepCase".into(),
        JsonValue::Array(vec![
            JsonValue::Null,
            JsonValue::Bool(false),
            JsonValue::Number(0.0),
            JsonValue::String("🚀\n".into()),
        ]),
    )]));
    let mut stream = ready(
        synthesize(
            &request,
            &transport,
            Options {
                auth: Some(&auth),
                base_url: Some("https://proxy.test/prefix%20path/?a=1"),
                ..Options::default()
            },
        ),
        &mut context,
    )
    .unwrap();
    assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
    let audio = match Pin::new(&mut stream).poll_next(&mut context) {
        Poll::Ready(Some(Ok(SynthesisItem::Bytes(bytes)))) => bytes,
        _ => panic!("audio was buffered"),
    };
    assert_eq!(audio, [0, 255, 128]);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    assert!(matches!(
        Pin::new(&mut stream).poll_next(&mut context),
        Poll::Ready(Some(Ok(SynthesisItem::Done(_))))
    ));
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(audio, [0, 255, 128]);
    let requests = transport.requests.lock().unwrap();
    let wire = &requests[0];
    assert_eq!(
        wire.url,
        "https://proxy.test/prefix%20path/v1/audio/speech?a=1"
    );
    assert_eq!(wire.method, "POST");
    assert_eq!(
        wire.headers,
        [
            ("Authorization".into(), "Bearer test".into()),
            ("Content-Type".into(), "application/json".into()),
            (
                "Accept".into(),
                "text/event-stream, application/json".into()
            )
        ]
    );
    assert_eq!(value(Raw::parse(std::str::from_utf8(&wire.body).unwrap()).unwrap()), value(Raw::parse(r#"{"model":"voxtral-mini-tts-2603","input":"Hello","stream":true,"response_format":"pcm","voice_id":"existing-custom-voice","ref_audio":"AP+A","prompt_cache_key":"","metadata":{"KeepCase":[null,false,0,"🚀\n"]}}"#).unwrap()));
}

#[test]
fn drop_releases_unread_partial_and_pending_bodies() {
    for pulls in 0..=2 {
        let counts = Arc::new(Counts::default());
        let waker = Waker::from(counts.clone());
        let mut context = Context::from_waker(&waker);
        let transport = transport(
            &counts,
            vec![DELTA.as_bytes().to_vec()],
            "text/event-stream",
            200,
            true,
        );
        let auth = auth();
        let mut stream = ready(
            synthesize(
                &request(),
                &transport,
                Options {
                    auth: Some(&auth),
                    timeout: Some(Duration::from_secs(60)),
                    ..Options::default()
                },
            ),
            &mut context,
        )
        .unwrap();
        for _ in 0..pulls {
            let _ = Pin::new(&mut stream).poll_next(&mut context);
        }
        assert_eq!(counts.drops.load(Ordering::SeqCst), 0);
        drop(stream);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(counts.reads.load(Ordering::SeqCst), pulls);
    }
}

struct PendingSend(Arc<Counts>);
impl Future for PendingSend {
    type Output = Result<HttpResponse, TransportError>;
    fn poll(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Self::Output> {
        self.0.reads.fetch_add(1, Ordering::SeqCst);
        Poll::Pending
    }
}
impl Drop for PendingSend {
    fn drop(&mut self) {
        self.0.drops.fetch_add(1, Ordering::SeqCst);
    }
}
struct PendingTransport(Arc<Counts>);
impl HttpTransport for PendingTransport {
    fn send(
        &self,
        _: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        Box::pin(PendingSend(self.0.clone()))
    }
}
fn wait_for(counter: &AtomicUsize) {
    let deadline = std::time::Instant::now() + Duration::from_secs(3);
    while counter.load(Ordering::SeqCst) == 0 {
        assert!(std::time::Instant::now() < deadline, "timer did not signal");
        std::thread::sleep(Duration::from_millis(1));
    }
}

#[test]
fn dropping_or_timing_out_a_pending_send_releases_the_future() {
    for timeout in [None, Some(Duration::from_millis(25))] {
        let counts = Arc::new(Counts::default());
        let waker = Waker::from(counts.clone());
        let mut context = Context::from_waker(&waker);
        let transport = PendingTransport(counts.clone());
        let auth = auth();
        let request = request();
        let mut future = Box::pin(synthesize(
            &request,
            &transport,
            Options {
                auth: Some(&auth),
                timeout,
                ..Options::default()
            },
        ));
        fn assert_send(_: &impl Send) {}
        assert_send(&future);
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        assert!(future.as_mut().poll(&mut context).is_pending());
        assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
        if timeout.is_some() {
            wait_for(&counts.wakes);
            let error = match future.as_mut().poll(&mut context) {
                Poll::Ready(Err(error)) => error,
                _ => panic!("pending send did not expire"),
            };
            assert_eq!(
                error.downcast_ref::<DeadlineExpired>(),
                Some(&DeadlineExpired)
            );
            assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        }
        drop(future);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn idle_deadline_releases_body_and_suppresses_buffered_done() {
    let counts = Arc::new(Counts::default());
    let waker = Waker::from(counts.clone());
    let mut context = Context::from_waker(&waker);
    let transport = transport(
        &counts,
        vec![format!("{DELTA}{DONE}").into_bytes()],
        "text/event-stream",
        200,
        true,
    );
    let auth = auth();
    let mut stream = ready(
        synthesize(
            &request(),
            &transport,
            Options {
                auth: Some(&auth),
                timeout: Some(Duration::from_millis(100)),
                ..Options::default()
            },
        ),
        &mut context,
    )
    .unwrap();
    assert!(matches!(
        Pin::new(&mut stream).poll_next(&mut context),
        Poll::Ready(Some(Ok(SynthesisItem::Bytes(_))))
    ));
    wait_for(&counts.drops); // No consumer polling is needed to release the body.
    let error = match Pin::new(&mut stream).poll_next(&mut context) {
        Poll::Ready(Some(Err(error))) => error,
        _ => panic!("emitted stale done"),
    };
    assert_eq!(
        error.downcast_ref::<DeadlineExpired>(),
        Some(&DeadlineExpired)
    );
    assert!(matches!(
        Pin::new(&mut stream).poll_next(&mut context),
        Poll::Ready(None)
    ));
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn formats_and_pre_network_rejection() {
    let outputs = [
        (None, "pcm"),
        (
            Some(TtsRequestOutput::Pcm(TtsRequestOutputPcm {
                format: TtsRequestOutputPcmFormat,
                byte_order: None,
                sample_rate_hz: None,
                sample_encoding: None,
                channel_count: None,
            })),
            "pcm",
        ),
        (
            Some(TtsRequestOutput::Object(TtsRequestOutputObject {
                format: TtsRequestOutputObjectFormat::Flac(TtsRequestOutputObjectFormatFlac),
            })),
            "flac",
        ),
        (
            Some(TtsRequestOutput::Object(TtsRequestOutputObject {
                format: TtsRequestOutputObjectFormat::Mp3(TtsRequestOutputObjectFormatMp3),
            })),
            "mp3",
        ),
        (
            Some(TtsRequestOutput::Object(TtsRequestOutputObject {
                format: TtsRequestOutputObjectFormat::Opus(TtsRequestOutputObjectFormatOpus),
            })),
            "opus",
        ),
        (
            Some(TtsRequestOutput::Object(TtsRequestOutputObject {
                format: TtsRequestOutputObjectFormat::Wav(TtsRequestOutputObjectFormatWav),
            })),
            "wav",
        ),
    ];
    for (output, expected) in outputs {
        let counts = Arc::new(Counts::default());
        let waker = Waker::from(counts.clone());
        let mut context = Context::from_waker(&waker);
        let transport = transport(&counts, vec![], "", 200, false);
        let auth = auth();
        let mut request = request();
        request.output = output;
        let stream = ready(
            synthesize(
                &request,
                &transport,
                Options {
                    auth: Some(&auth),
                    ..Options::default()
                },
            ),
            &mut context,
        )
        .unwrap();
        drop(stream);
        let requests = transport.requests.lock().unwrap();
        assert_eq!(
            Raw::parse(std::str::from_utf8(&requests[0].body).unwrap())
                .unwrap()
                .object()
                .unwrap()["response_format"]
                .string()
                .unwrap(),
            expected
        );
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
    let counts = Arc::new(Counts::default());
    let waker = Waker::from(counts.clone());
    let mut context = Context::from_waker(&waker);
    let transport = PendingTransport(counts.clone());
    let mut auth = auth();
    let mut request = request();
    request.metadata = Some(BTreeMap::from([(
        "bad".into(),
        JsonValue::Number(f64::NAN),
    )]));
    let error = ready(
        synthesize(
            &request,
            &transport,
            Options {
                auth: Some(&auth),
                ..Options::default()
            },
        ),
        &mut context,
    )
    .err()
    .unwrap();
    assert_eq!(error.to_string(), "Invalid mistral TTS request:\nrequest[\"metadata\"][\"bad\"]: expected JSON value");
    request.metadata = None;
    let error = ready(
        synthesize(
            &request,
            &transport,
            Options {
                auth: Some(&auth),
                timeout: Some(Duration::ZERO),
                ..Options::default()
            },
        ),
        &mut context,
    )
    .err()
    .unwrap();
    assert_eq!(
        error.downcast_ref::<DeadlineExpired>(),
        Some(&DeadlineExpired)
    );
    for url in [
        "file:///tmp/test",
        "https://user@host",
        "https://host/#fragment",
        "https://host\\@other",
        "https://",
    ] {
        let error = ready(
            synthesize(
                &request,
                &transport,
                Options {
                    auth: Some(&auth),
                    base_url: Some(url),
                    ..Options::default()
                },
            ),
            &mut context,
        )
        .err()
        .unwrap();
        assert_eq!(
            error.to_string(),
            "Mistral base_url must be an HTTP(S) URL without credentials or a fragment"
        );
    }
    auth.mistral.as_mut().unwrap().api_key = Some(String::new());
    let error = ready(
        synthesize(
            &request,
            &transport,
            Options {
                auth: Some(&auth),
                ..Options::default()
            },
        ),
        &mut context,
    )
    .err()
    .unwrap();
    assert_eq!(
        error.to_string(),
        "Missing auth.mistral.apiKey configuration"
    );
    assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
}

#[test]
fn opaque_errors_read_failure_identity_and_byte_limits() {
    for (status, content, data, limit, expected) in [
        (
            429,
            "application/json",
            "opaque",
            1024,
            "Mistral synthesis failed (429)",
        ),
        (
            200,
            "application/json",
            "{\"audio_data\":\"AQ==\"}",
            8,
            "Mistral response exceeds max_json_bytes",
        ),
        (
            200,
            "text/event-stream",
            DELTA,
            8,
            "SSE event exceeds byte limit",
        ),
    ] {
        let counts = Arc::new(Counts::default());
        let waker = Waker::from(counts.clone());
        let mut context = Context::from_waker(&waker);
        let transport = transport(
            &counts,
            vec![data.as_bytes().to_vec()],
            content,
            status,
            false,
        );
        let auth = auth();
        let mut stream = ready(
            synthesize(
                &request(),
                &transport,
                Options {
                    auth: Some(&auth),
                    max_json_bytes: limit,
                    max_event_bytes: limit,
                    ..Options::default()
                },
            ),
            &mut context,
        )
        .unwrap();
        let error = loop {
            match Pin::new(&mut stream).poll_next(&mut context) {
                Poll::Pending => {}
                Poll::Ready(Some(Err(error))) => break error,
                _ => panic!("unexpected audio"),
            }
        };
        assert_eq!(error.to_string(), expected);
        if status == 429 {
            let error = error.downcast_ref::<Error>().unwrap();
            assert_eq!(error.status_code, 429);
            assert_eq!(error.body, "opaque");
            assert_eq!(error.retry_after.as_deref(), Some("7"));
        }
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
    let counts = Arc::new(Counts::default());
    let waker = Waker::from(counts.clone());
    let mut context = Context::from_waker(&waker);
    let failure = Box::new(std::io::Error::other("read failed"));
    let pointer = &*failure as *const std::io::Error;
    let transport = Transport {
        requests: Mutex::new(Vec::new()),
        response: Mutex::new(Some(HttpResponse {
            status: 200,
            headers: vec![("Content-Type".into(), "text/event-stream".into())],
            body: Box::pin(Body {
                counts: counts.clone(),
                chunks: VecDeque::from([Err(failure as TransportError)]),
                stalled: false,
            }),
        })),
    };
    let auth = auth();
    let mut stream = ready(
        synthesize(
            &request(),
            &transport,
            Options {
                auth: Some(&auth),
                ..Options::default()
            },
        ),
        &mut context,
    )
    .unwrap();
    let error = match Pin::new(&mut stream).poll_next(&mut context) {
        Poll::Ready(Some(Err(error))) => error,
        _ => panic!("missing reader failure"),
    };
    assert_eq!(
        error.downcast_ref::<std::io::Error>().unwrap() as *const std::io::Error,
        pointer
    );
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}
