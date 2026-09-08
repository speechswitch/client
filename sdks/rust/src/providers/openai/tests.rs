use super::*;
use crate::{
    generated::{auth::AuthAsync, openai::*},
    http::{HttpRequest, HttpResponse},
    json::{self, Raw},
    msgpack::{tests::fixture, Value},
};
use std::{
    collections::VecDeque,
    future::{poll_fn, Future},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    task::{Wake, Waker},
};

#[derive(Default)]
struct Counts {
    reads: AtomicUsize,
    drops: AtomicUsize,
    wakes: AtomicUsize,
}
impl Wake for Counts {
    fn wake(self: Arc<Self>) {
        self.wake_by_ref()
    }
    fn wake_by_ref(self: &Arc<Self>) {
        self.wakes.fetch_add(1, Ordering::SeqCst);
    }
}
struct Body {
    chunks: VecDeque<Result<Vec<u8>, TransportError>>,
    counts: Arc<Counts>,
    stall: bool,
}
impl InputStream<Vec<u8>> for Body {
    fn poll_next(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
    ) -> Poll<Option<Result<Vec<u8>, TransportError>>> {
        let s = self.get_mut();
        s.counts.reads.fetch_add(1, Ordering::SeqCst);
        match s.chunks.pop_front() {
            Some(v) => Poll::Ready(Some(v)),
            None if s.stall => Poll::Pending,
            None => Poll::Ready(None),
        }
    }
}
impl Drop for Body {
    fn drop(&mut self) {
        self.counts.drops.fetch_add(1, Ordering::SeqCst);
    }
}
struct Transport {
    requests: Mutex<Vec<HttpRequest>>,
    response: Mutex<Option<HttpResponse>>,
    pending: bool,
}
impl HttpTransport for Transport {
    fn send(
        &self,
        request: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        self.requests.lock().unwrap().push(request);
        Box::pin(async {
            let response = self.response.lock().unwrap().take().expect("one request");
            if self.pending {
                std::future::pending::<()>().await;
            }
            Ok(response)
        })
    }
}
fn transport(
    chunks: Vec<Vec<u8>>,
    status: u16,
    media: &str,
    stall: bool,
) -> (Transport, Arc<Counts>) {
    let counts = Arc::new(Counts::default());
    (
        Transport {
            requests: Mutex::new(vec![]),
            pending: false,
            response: Mutex::new(Some(HttpResponse {
                status,
                headers: vec![
                    ("Content-Type".into(), media.into()),
                    ("x-request-id".into(), "".into()),
                    ("retry-after".into(), "7".into()),
                ],
                body: Box::pin(Body {
                    chunks: chunks.into_iter().map(Ok).collect(),
                    counts: counts.clone(),
                    stall,
                }),
            })),
        },
        counts,
    )
}
fn ready<T>(future: impl Future<Output = T>) -> T {
    let mut future = std::pin::pin!(future);
    let counts = Arc::new(Counts::default());
    let waker = Waker::from(counts.clone());
    let mut cx = Context::from_waker(&waker);
    for _ in 0..100000 {
        let before = counts.wakes.load(Ordering::SeqCst);
        match future.as_mut().poll(&mut cx) {
            Poll::Ready(v) => return v,
            Poll::Pending => assert!(
                counts.wakes.load(Ordering::SeqCst) > before,
                "pending without wake"
            ),
        }
    }
    panic!("did not finish")
}
fn next(stream: &mut Stream) -> Option<Result<SynthesisItem, TransportError>> {
    ready(poll_fn(|cx| Pin::new(&mut *stream).poll_next(cx)))
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
        mistral: None,
        murf: None,
        openai: Some(AuthAsync {
            api_key: Some("test".into()),
        }),
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
fn legacy() -> TtsRequestTextVoice15a214fc {
    TtsRequestTextVoice15a214fc {
        model: None,
        text: "Hello".into(),
        voice: TtsRequestTextVoice15a214fcVoice::Alloy(Default::default()),
        voice_source: None,
        output: None,
        speed: None,
    }
}
fn mini() -> TtsRequestTextVoicef51a0f7e {
    TtsRequestTextVoicef51a0f7e {
        model: TtsRequestTextVoicef51a0f7eModel::Gpt4oMiniTts(Default::default()),
        text: "Hello".into(),
        voice: TtsRequestTextVoicef51a0f7eVoice::Cedar(Default::default()),
        voice_source: None,
        output: None,
        speed: None,
        instructions: None,
        include_usage: Some(TtsRequestTextVoicef51a0f7eIncludeUsage::True(
            Default::default(),
        )),
    }
}
fn value(text: &str) -> Value {
    fixture(Raw::parse(text).unwrap())
}
fn item_value(item: SynthesisItem) -> Value {
    match item {
        SynthesisItem::Bytes(bytes) => Value::Map(
            [(
                "audio".into(),
                Value::Array(bytes.into_iter().map(|b| Value::Number(b.into())).collect()),
            )]
            .into(),
        ),
        SynthesisItem::Done(event) => {
            let mut text = String::from("{\"event\":\"done\"");
            if let Some(id) = event.request_id {
                text.push_str(",\"requestId\":");
                json::quote(&id, &mut text);
            }
            if let Some(u) = event.usage {
                text.push_str(&format!(
                    ",\"usage\":{{\"inputTokens\":{},\"outputTokens\":{},\"totalTokens\":{}}}",
                    u.input_tokens, u.output_tokens, u.total_tokens
                ));
            }
            text.push('}');
            value(&text)
        }
    }
}
const DELTA: &str = "data: {\"type\":\"speech.audio.delta\",\"audio\":\"AP+A\"}\n\n";
const DONE: &str = "data: {\"type\":\"speech.audio.done\",\"usage\":{\"input_tokens\":0,\"output_tokens\":1,\"total_tokens\":1}}\n\n";

#[test]
fn shared_streams_at_every_byte_split() {
    let fixtures = Raw::parse(include_str!("../../../../fixtures/openai.json"))
        .unwrap()
        .object()
        .unwrap();
    let auth = auth();
    for case in fixtures["streams"].array().unwrap() {
        let case = case.object().unwrap();
        let body = case["body"].string().unwrap();
        for split in 0..=body.len() {
            let (transport, counts) = transport(
                vec![
                    body.as_bytes()[..split].to_vec(),
                    body.as_bytes()[split..].to_vec(),
                ],
                200,
                "text/event-stream",
                false,
            );
            let mut audio = ready(synthesize(
                &TtsRequest::TextVoicef51a0f7e(mini()),
                &transport,
                Options {
                    auth: Some(&auth),
                    ..Default::default()
                },
            ))
            .unwrap();
            let mut output = vec![];
            let mut error = None;
            while let Some(item) = next(&mut audio) {
                match item {
                    Ok(item) => output.push(item_value(item)),
                    Err(e) => {
                        error = Some(e.to_string());
                        break;
                    }
                }
            }
            assert_eq!(
                output,
                case["output"]
                    .array()
                    .unwrap()
                    .into_iter()
                    .map(fixture)
                    .collect::<Vec<_>>(),
                "split {split}"
            );
            assert_eq!(
                error,
                if case["error"].is_null() {
                    None
                } else {
                    Some(case["error"].string().unwrap())
                }
            );
            assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
            assert!(next(&mut audio).is_none());
        }
    }
}

#[test]
fn shared_requests_preserve_models_custom_ids_and_empty_values() {
    let mut hd = legacy();
    hd.model = Some(TtsRequestTextVoice15a214fcModel::Tts1Hd(Default::default()));
    hd.voice = TtsRequestTextVoice15a214fcVoice::Nova(Default::default());
    hd.speed = Some(4.0);
    hd.output = Some(TtsRequestTextVoice15a214fcOutput::Object(
        TtsRequestTextVoice15a214fcOutputObject {
            format: TtsRequestTextVoice15a214fcOutputObjectFormat::Mp3(Default::default()),
        },
    ));
    let mut modern = mini();
    modern.instructions = Some(String::new());
    let custom = TtsRequestTextVoicef3ee42bf {
        model: TtsRequestTextVoicef51a0f7eModel::Gpt4oMiniTts20251215(Default::default()),
        text: "Hello".into(),
        voice: "alloy".into(),
        voice_source: Default::default(),
        speed: Some(0.25),
        instructions: None,
        include_usage: Some(TtsRequestTextVoicef51a0f7eIncludeUsage::False(
            Default::default(),
        )),
        output: Some(TtsRequestTextVoice15a214fcOutput::Object(
            TtsRequestTextVoice15a214fcOutputObject {
                format: TtsRequestTextVoice15a214fcOutputObjectFormat::Wav(Default::default()),
            },
        )),
    };
    let mut march = mini();
    march.model = TtsRequestTextVoicef51a0f7eModel::Gpt4oMiniTts20250320(Default::default());
    march.voice = TtsRequestTextVoicef51a0f7eVoice::Marin(Default::default());
    march.instructions = Some("Whisper".into());
    march.include_usage = None;
    march.output = Some(TtsRequestTextVoice15a214fcOutput::Object(
        TtsRequestTextVoice15a214fcOutputObject {
            format: TtsRequestTextVoice15a214fcOutputObjectFormat::Opus(Default::default()),
        },
    ));
    let requests = [
        TtsRequest::TextVoice15a214fc(legacy()),
        TtsRequest::TextVoice15a214fc(hd),
        TtsRequest::TextVoicef51a0f7e(modern),
        TtsRequest::TextVoicef3ee42bf(custom),
        TtsRequest::TextVoicef51a0f7e(march),
    ];
    let fixtures = Raw::parse(include_str!("../../../../fixtures/openai.json"))
        .unwrap()
        .object()
        .unwrap();
    let auth = auth();
    for (request, expected) in requests.iter().zip(fixtures["requests"].array().unwrap()) {
        let (transport, counts) = transport(vec![], 200, "", false);
        let audio = ready(synthesize(
            request,
            &transport,
            Options {
                auth: Some(&auth),
                base_url: Some("https://proxy.test/prefix%2Fv1/?tenant=one;two&x=%2F"),
                ..Default::default()
            },
        ))
        .unwrap();
        let requests = transport.requests.lock().unwrap();
        let captured = &requests[0];
        assert_eq!(
            value(std::str::from_utf8(&captured.body).unwrap()),
            fixture(expected.object().unwrap()["wire"])
        );
        assert_eq!(
            captured.url,
            "https://proxy.test/prefix%2Fv1/audio/speech?tenant=one;two&x=%2F"
        );
        assert_eq!(captured.method, "POST");
        assert_eq!(
            captured.headers,
            vec![
                ("Authorization".into(), "Bearer test".into()),
                ("Content-Type".into(), "application/json".into()),
                (
                    "Accept".into(),
                    "application/octet-stream, text/event-stream".into()
                )
            ]
        );
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        drop(audio);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn body_is_released_on_early_exit_and_native_done_without_eof() {
    let auth = auth();
    for usage in [false, true] {
        let chunks = if usage {
            vec![format!("{DELTA}{DONE}broken tail").into_bytes()]
        } else {
            vec![vec![0, 255, 128]]
        };
        let (transport, counts) = transport(
            chunks,
            200,
            if usage {
                "text/event-stream"
            } else {
                "audio/pcm"
            },
            true,
        );
        let request = if usage {
            TtsRequest::TextVoicef51a0f7e(mini())
        } else {
            TtsRequest::TextVoice15a214fc(legacy())
        };
        let mut audio = ready(synthesize(
            &request,
            &transport,
            Options {
                auth: Some(&auth),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(
            item_value(next(&mut audio).unwrap().unwrap()),
            value(r#"{"audio":[0,255,128]}"#)
        );
        assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 0);
        if usage {
            assert_eq!(
                item_value(next(&mut audio).unwrap().unwrap()),
                value(
                    r#"{"event":"done","requestId":"","usage":{"inputTokens":0,"outputTokens":1,"totalTokens":1}}"#
                )
            );
            assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
            assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        }
        drop(audio);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn drop_pending_headers_or_reads_releases_owned_transport() {
    let auth = auth();
    let request = TtsRequest::TextVoice15a214fc(legacy());
    let (mut transport, counts) = transport(vec![], 200, "", true);
    transport.pending = true;
    let mut future = Box::pin(synthesize(
        &request,
        &transport,
        Options {
            auth: Some(&auth),
            ..Default::default()
        },
    ));
    assert!(future
        .as_mut()
        .poll(&mut Context::from_waker(Waker::noop()))
        .is_pending());
    assert_eq!(counts.drops.load(Ordering::SeqCst), 0);
    drop(future);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    for (status, media, usage) in [
        (200, "audio/pcm", false),
        (200, "text/event-stream", true),
        (429, "application/json", false),
    ] {
        let (transport, counts) = self::transport(vec![], status, media, true);
        let request = if usage {
            TtsRequest::TextVoicef51a0f7e(mini())
        } else {
            TtsRequest::TextVoice15a214fc(legacy())
        };
        let mut audio = ready(synthesize(
            &request,
            &transport,
            Options {
                auth: Some(&auth),
                ..Default::default()
            },
        ))
        .unwrap();
        assert!(Pin::new(&mut audio)
            .poll_next(&mut Context::from_waker(Waker::noop()))
            .is_pending());
        assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
        drop(audio);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn exact_status_errors_and_limits_release_response() {
    let auth = auth();
    let request = TtsRequest::TextVoice15a214fc(legacy());
    for status in [201, 302, 401, 429, 500] {
        let (transport, counts) = transport(
            vec![b"native ".to_vec(), b"\xfferror".to_vec()],
            status,
            "application/json",
            false,
        );
        let mut audio = ready(synthesize(
            &request,
            &transport,
            Options {
                auth: Some(&auth),
                ..Default::default()
            },
        ))
        .unwrap();
        let error = next(&mut audio).unwrap().err().unwrap();
        assert_eq!(
            error.downcast_ref::<Error>(),
            Some(&Error {
                status_code: status,
                body: "native �error".into(),
                request_id: Some(String::new()),
                retry_after: Some("7".into())
            })
        );
        assert_eq!(
            error.to_string(),
            format!("OpenAI speech failed ({status})")
        );
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
    for (status, media, data, usage, json_limit, event_limit, message) in [
        (
            200,
            "application/json",
            "{}",
            false,
            1024,
            1024,
            "OpenAI returned a non-audio response",
        ),
        (
            200,
            "audio/pcm",
            "audio",
            true,
            1024,
            1024,
            "OpenAI returned no SSE usage stream",
        ),
        (
            200,
            "audio/pcm",
            "",
            false,
            1024,
            1024,
            "OpenAI returned no audio",
        ),
        (
            400,
            "application/json",
            "12345",
            false,
            4,
            1024,
            "OpenAI response exceeds max_json_bytes",
        ),
        (
            200,
            "text/event-stream",
            ":123456789",
            true,
            1024,
            4,
            "SSE event exceeds byte limit",
        ),
        (
            200,
            "text/event-stream",
            "data: NaN\n\n",
            true,
            1024,
            1024,
            "Invalid OpenAI speech event",
        ),
        (
            200,
            "text/event-stream",
            "data: []\n\n",
            true,
            1024,
            1024,
            "Invalid OpenAI speech event",
        ),
        (
            200,
            "text/event-stream",
            "data: {broken}\n\n",
            true,
            1024,
            1024,
            "Invalid OpenAI speech event",
        ),
    ] {
        let (transport, counts) = transport(vec![data.as_bytes().to_vec()], status, media, false);
        let request = if usage {
            TtsRequest::TextVoicef51a0f7e(mini())
        } else {
            TtsRequest::TextVoice15a214fc(legacy())
        };
        let mut audio = ready(synthesize(
            &request,
            &transport,
            Options {
                auth: Some(&auth),
                max_json_bytes: json_limit,
                max_event_bytes: event_limit,
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(
            next(&mut audio).unwrap().err().unwrap().to_string(),
            message
        );
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert!(next(&mut audio).is_none());
    }
}

#[test]
fn all_formats_and_pcm_traits_convert_without_extra_wire_controls() {
    let formats = [
        TtsRequestTextVoice15a214fcOutputObjectFormat::Aac(Default::default()),
        TtsRequestTextVoice15a214fcOutputObjectFormat::Flac(Default::default()),
        TtsRequestTextVoice15a214fcOutputObjectFormat::Mp3(Default::default()),
        TtsRequestTextVoice15a214fcOutputObjectFormat::Opus(Default::default()),
        TtsRequestTextVoice15a214fcOutputObjectFormat::Wav(Default::default()),
    ];
    let auth = auth();
    for format in formats {
        let expected = format.value();
        let mut request = legacy();
        request.output = Some(TtsRequestTextVoice15a214fcOutput::Object(
            TtsRequestTextVoice15a214fcOutputObject { format },
        ));
        let request = TtsRequest::TextVoice15a214fc(request);
        let (transport, _) = transport(vec![], 200, "", false);
        drop(
            ready(synthesize(
                &request,
                &transport,
                Options {
                    auth: Some(&auth),
                    ..Default::default()
                },
            ))
            .unwrap(),
        );
        assert_eq!(
            settings::settings(&request).0.response_format.as_deref(),
            Some(expected)
        );
    }
    let mut request = legacy();
    request.output = Some(TtsRequestTextVoice15a214fcOutput::Pcm(
        TtsRequestTextVoice15a214fcOutputPcm {
            format: Default::default(),
            sample_encoding: Some(Default::default()),
            sample_rate_hz: Some(Default::default()),
            byte_order: Some(Default::default()),
            channel_count: Some(Default::default()),
        },
    ));
    let (transport, _) = transport(vec![], 200, "", false);
    drop(
        ready(synthesize(
            &TtsRequest::TextVoice15a214fc(request),
            &transport,
            Options {
                auth: Some(&auth),
                ..Default::default()
            },
        ))
        .unwrap(),
    );
    let requests = transport.requests.lock().unwrap();
    assert_eq!(
        value(std::str::from_utf8(&requests[0].body).unwrap()),
        value(
            r#"{"model":"tts-1","input":"Hello","voice":"alloy","response_format":"pcm","speed":1,"stream_format":"audio"}"#
        )
    );
}

#[test]
fn generated_validation_runs_before_transport() {
    let auth = auth();
    let (transport, _) = transport(vec![], 200, "", false);
    for speed in [0.24, 4.01, f64::NAN, f64::INFINITY] {
        let mut request = legacy();
        request.speed = Some(speed);
        let request = TtsRequest::TextVoice15a214fc(request);
        let expected = match validate_request(&request) {
            Err(error) => error.to_string(),
            Ok(_) => panic!("expected generated validation failure"),
        };
        assert_eq!(
            ready(synthesize(
                &request,
                &transport,
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
    }
    for field in ["text", "instructions"] {
        let mut request = mini();
        if field == "text" {
            request.text = "😀".repeat(4097)
        } else {
            request.instructions = Some("x".repeat(4097))
        }
        let request = TtsRequest::TextVoicef51a0f7e(request);
        let expected = match validate_request(&request) {
            Err(error) => error.to_string(),
            Ok(_) => panic!("expected generated validation failure"),
        };
        assert_eq!(
            ready(synthesize(
                &request,
                &transport,
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
    }
    assert!(transport.requests.lock().unwrap().is_empty());
    let mut request = mini();
    request.text = "😀".repeat(4096);
    request.instructions = Some("😀".repeat(4096));
    drop(
        ready(synthesize(
            &TtsRequest::TextVoicef51a0f7e(request),
            &transport,
            Options {
                auth: Some(&auth),
                ..Default::default()
            },
        ))
        .unwrap(),
    );
    assert_eq!(transport.requests.lock().unwrap().len(), 1);
}

#[test]
fn invalid_boundary_options_and_credentials_do_not_send() {
    let auth = auth();
    let request = TtsRequest::TextVoice15a214fc(legacy());
    let (transport, _) = transport(vec![], 200, "", false);
    for url in [
        "ws://api.test",
        "https://user:pass@api.test",
        "https://api.test/#fragment",
        "relative/path",
        "https://",
        "https://api.test:65536",
    ] {
        assert_eq!(
            ready(synthesize(
                &request,
                &transport,
                Options {
                    auth: Some(&auth),
                    base_url: Some(url),
                    ..Default::default()
                }
            ))
            .err()
            .unwrap()
            .to_string(),
            "Invalid OpenAI base_url"
        );
    }
    for (event, json) in [(0, 1024), (1024, 0)] {
        assert_eq!(
            ready(synthesize(
                &request,
                &transport,
                Options {
                    auth: Some(&auth),
                    max_event_bytes: event,
                    max_json_bytes: json,
                    ..Default::default()
                }
            ))
            .err()
            .unwrap()
            .to_string(),
            "OpenAI response byte limits must be positive"
        );
    }
    for key in ["", "key\r\nheader", "é"] {
        let mut auth = self::auth();
        auth.openai.as_mut().unwrap().api_key = Some(key.into());
        assert_eq!(
            ready(synthesize(
                &request,
                &transport,
                Options {
                    auth: Some(&auth),
                    ..Default::default()
                }
            ))
            .err()
            .unwrap()
            .to_string(),
            if key.is_empty() {
                "Missing auth.openai.apiKey configuration"
            } else {
                "Invalid OpenAI authentication header"
            }
        );
    }
    assert!(transport.requests.lock().unwrap().is_empty());
}

#[test]
fn transport_and_body_errors_keep_identity() {
    let auth = auth();
    let request = TtsRequest::TextVoice15a214fc(legacy());
    let counts = Arc::new(Counts::default());
    let error = Box::new(std::io::Error::other("original read error"));
    let pointer = &*error as *const std::io::Error;
    let transport = Transport {
        requests: Mutex::new(vec![]),
        pending: false,
        response: Mutex::new(Some(HttpResponse {
            status: 200,
            headers: vec![],
            body: Box::pin(Body {
                chunks: vec![Ok(vec![1]), Err(error as TransportError)].into(),
                counts: counts.clone(),
                stall: false,
            }),
        })),
    };
    let mut audio = ready(synthesize(
        &request,
        &transport,
        Options {
            auth: Some(&auth),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        item_value(next(&mut audio).unwrap().unwrap()),
        value(r#"{"audio":[1]}"#)
    );
    let error = next(&mut audio).unwrap().err().unwrap();
    assert_eq!(
        error.downcast_ref::<std::io::Error>().unwrap() as *const std::io::Error,
        pointer
    );
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert!(next(&mut audio).is_none());
    struct Rejected;
    impl HttpTransport for Rejected {
        fn send(
            &self,
            _: HttpRequest,
        ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>>
        {
            Box::pin(async {
                Err(Box::new(Error {
                    status_code: 503,
                    body: "failed headers".into(),
                    request_id: None,
                    retry_after: None,
                }) as TransportError)
            })
        }
    }
    let error = ready(synthesize(
        &request,
        &Rejected,
        Options {
            auth: Some(&auth),
            ..Default::default()
        },
    ))
    .err()
    .unwrap();
    assert_eq!(
        error.downcast_ref::<Error>(),
        Some(&Error {
            status_code: 503,
            body: "failed headers".into(),
            request_id: None,
            retry_after: None
        })
    );
}

#[test]
fn empty_chunks_are_cooperative_and_binary_eof_has_no_invented_identity() {
    let auth = auth();
    let (transport, counts) = transport(
        vec![vec![], vec![42]],
        200,
        "AUDIO/PCM; charset=binary",
        false,
    );
    transport
        .response
        .lock()
        .unwrap()
        .as_mut()
        .unwrap()
        .headers
        .retain(|(key, _)| key != "x-request-id");
    let mut audio = ready(synthesize(
        &TtsRequest::TextVoice15a214fc(legacy()),
        &transport,
        Options {
            auth: Some(&auth),
            ..Default::default()
        },
    ))
    .unwrap();
    let wakes = Arc::new(Counts::default());
    let waker = Waker::from(wakes.clone());
    let mut cx = Context::from_waker(&waker);
    assert!(Pin::new(&mut audio).poll_next(&mut cx).is_pending());
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    assert_eq!(wakes.wakes.load(Ordering::SeqCst), 1);
    assert_eq!(
        item_value(next(&mut audio).unwrap().unwrap()),
        value(r#"{"audio":[42]}"#)
    );
    assert_eq!(
        item_value(next(&mut audio).unwrap().unwrap()),
        value(r#"{"event":"done"}"#)
    );
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert!(next(&mut audio).is_none());
}

#[test]
fn buffered_sse_has_a_cooperative_work_budget() {
    let auth = auth();
    let body = format!(":{}\n\n{DELTA}{DONE}", "x".repeat(20000));
    let (transport, counts) = transport(vec![body.into_bytes()], 200, "text/event-stream", true);
    let mut audio = ready(synthesize(
        &TtsRequest::TextVoicef51a0f7e(mini()),
        &transport,
        Options {
            auth: Some(&auth),
            ..Default::default()
        },
    ))
    .unwrap();
    let wakes = Arc::new(Counts::default());
    let waker = Waker::from(wakes.clone());
    assert!(Pin::new(&mut audio)
        .poll_next(&mut Context::from_waker(&waker))
        .is_pending());
    assert_eq!(audio.offset, 8192);
    assert_eq!(wakes.wakes.load(Ordering::SeqCst), 1);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    assert_eq!(
        item_value(next(&mut audio).unwrap().unwrap()),
        value(r#"{"audio":[0,255,128]}"#)
    );
    assert!(matches!(next(&mut audio), Some(Ok(SynthesisItem::Done(_)))));
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn generated_event_validation_and_base64_remain_protocol_exact() {
    for count in ["true", "null", "0.5", "1e100", "9007199254740992"] {
        let text = format!(
            r#"{{"type":"speech.audio.done","usage":{{"input_tokens":{count},"output_tokens":1,"total_tokens":1}}}}"#
        );
        assert_eq!(
            wire::decode_speech_event(&text).unwrap_err().to_string(),
            "Invalid OpenAI speech event"
        );
    }
    let event = wire::decode_speech_event(r#"{"type":"speech.audio.done","usage":{"input_tokens":-1,"output_tokens":1.0,"total_tokens":0},"future":true}"#).unwrap();
    match event {
        wire::SpeechEvent::Variant1(event) => assert_eq!(
            (
                event.usage.input_tokens,
                event.usage.output_tokens,
                event.usage.total_tokens
            ),
            (-1.0, 1.0, 0.0)
        ),
        _ => panic!("wrong event"),
    }
    let auth = auth();
    for encoded in ["AA\n==", "AA-_", "AAAA====", "AA=A"] {
        let mut text = "data: {\"type\":\"speech.audio.delta\",\"audio\":".to_owned();
        json::quote(encoded, &mut text);
        text.push_str("}\n\n");
        let (transport, counts) =
            transport(vec![text.into_bytes()], 200, "text/event-stream", true);
        let mut audio = ready(synthesize(
            &TtsRequest::TextVoicef51a0f7e(mini()),
            &transport,
            Options {
                auth: Some(&auth),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(
            next(&mut audio).unwrap().err().unwrap().to_string(),
            "OpenAI returned invalid base64 audio"
        );
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn environment_child() {
    let Ok(mode) = std::env::var("SPEECHSWITCH_OPENAI_TEST_CHILD") else {
        return;
    };
    let mut credentials = auth();
    credentials.openai.as_mut().unwrap().api_key = match mode.as_str() {
        "explicit" => Some("explicit".into()),
        "empty" => Some(String::new()),
        _ => None,
    };
    let (transport, _) = transport(vec![], 200, "", false);
    let result = ready(synthesize(
        &TtsRequest::TextVoice15a214fc(legacy()),
        &transport,
        Options {
            auth: Some(&credentials),
            ..Default::default()
        },
    ));
    match std::env::var("SPEECHSWITCH_OPENAI_TEST_EXPECTED") {
        Ok(key) => {
            drop(result.unwrap());
            assert_eq!(
                transport.requests.lock().unwrap()[0].headers[0],
                ("Authorization".into(), format!("Bearer {key}"))
            );
        }
        Err(_) => {
            assert_eq!(
                result.err().unwrap().to_string(),
                "Missing auth.openai.apiKey configuration"
            );
            assert!(transport.requests.lock().unwrap().is_empty());
        }
    }
}

#[test]
fn environment_precedence_is_checked_in_isolated_processes() {
    for (mode, scoped, vendor, expected) in [
        ("explicit", Some("scoped"), Some("vendor"), Some("explicit")),
        ("none", Some("scoped"), Some("vendor"), Some("scoped")),
        ("none", None, Some("vendor"), Some("vendor")),
        ("empty", Some("scoped"), Some("vendor"), None),
        ("none", Some(""), Some("vendor"), None),
        ("none", None, None, None),
    ] {
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "providers::openai::tests::environment_child",
                "--nocapture",
            ])
            .env("SPEECHSWITCH_OPENAI_TEST_CHILD", mode)
            .env_remove("SPEECHSWITCH_OPENAI_API_KEY")
            .env_remove("OPENAI_API_KEY")
            .env_remove("SPEECHSWITCH_OPENAI_TEST_EXPECTED");
        if let Some(v) = scoped {
            command.env("SPEECHSWITCH_OPENAI_API_KEY", v);
        }
        if let Some(v) = vendor {
            command.env("OPENAI_API_KEY", v);
        }
        if let Some(v) = expected {
            command.env("SPEECHSWITCH_OPENAI_TEST_EXPECTED", v);
        }
        let result = command.output().unwrap();
        assert!(
            result.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        );
    }
}
