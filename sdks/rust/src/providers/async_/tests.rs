use super::*;
use crate::{
    generated::{async_::*, async_output::*, auth::AuthAsync},
    http::HttpResponse,
    json::Raw,
    runtime::{InputStream, JsonValue, StreamingInput},
    websocket::{Socket, WebSocketLike},
};
use std::{
    collections::VecDeque,
    future::Future,
    pin::Pin,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    task::{Context, Poll, Wake, Waker},
};

const ID: &str = "00010203-0405-4607-8809-0a0b0c0d0e0f";
#[derive(Default)]
struct Counts {
    reads: AtomicUsize,
    drops: AtomicUsize,
    wakes: AtomicUsize,
    waker: Mutex<Option<Waker>>,
}
impl Wake for Counts {
    fn wake(self: Arc<Self>) {
        self.wakes.fetch_add(1, Ordering::SeqCst);
    }
    fn wake_by_ref(self: &Arc<Self>) {
        self.wakes.fetch_add(1, Ordering::SeqCst);
    }
}
struct Body<T> {
    values: VecDeque<Result<T, TransportError>>,
    counts: Arc<Counts>,
    stall: bool,
}
impl<T: Send + Unpin> InputStream<T> for Body<T> {
    fn poll_next(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<T, TransportError>>> {
        let body = self.get_mut();
        body.counts.reads.fetch_add(1, Ordering::SeqCst);
        if let Some(value) = body.values.pop_front() {
            Poll::Ready(Some(value))
        } else if body.stall {
            *body.counts.waker.lock().unwrap() = Some(cx.waker().clone());
            Poll::Pending
        } else {
            Poll::Ready(None)
        }
    }
}
impl<T> Drop for Body<T> {
    fn drop(&mut self) {
        self.counts.drops.fetch_add(1, Ordering::SeqCst);
    }
}
fn input(counts: &Arc<Counts>, chunks: &[&str], stall: bool) -> StreamingInput<String> {
    Box::pin(Body {
        values: chunks.iter().map(|text| Ok((*text).into())).collect(),
        counts: counts.clone(),
        stall,
    })
}
struct Http {
    response: Mutex<Option<HttpResponse>>,
    requests: Mutex<Vec<HttpRequest>>,
}
impl HttpTransport for Http {
    fn send(
        &self,
        request: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        self.requests.lock().unwrap().push(request);
        Box::pin(async { Ok(self.response.lock().unwrap().take().unwrap()) })
    }
}
fn http(counts: &Arc<Counts>, chunks: Vec<Vec<u8>>, status: u16, stall: bool) -> Http {
    Http {
        response: Mutex::new(Some(HttpResponse {
            status,
            headers: Vec::new(),
            body: Box::pin(Body {
                values: chunks.into_iter().map(Ok).collect(),
                counts: counts.clone(),
                stall,
            }),
        })),
        requests: Mutex::new(Vec::new()),
    }
}
fn auth() -> Auth {
    Auth {
        async_: Some(AuthAsync {
            api_key: Some("test + key".into()),
        }),
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
fn pcm() -> TtsRequestFlashV15StreamingTextVoiceOutputPcm {
    TtsRequestFlashV15StreamingTextVoiceOutputPcm {
        format: Default::default(),
        sample_rate_hz: 24000.0,
        byte_order: None,
        sample_encoding: None,
    }
}
fn whole(mode: Mode) -> TtsRequest {
    match mode {
        Mode::Timestamped => {
            TtsRequest::FlashV15TextVoice7c30ce7a(TtsRequestFlashV15TextVoice7c30ce7a {
                model: Default::default(),
                text: "Hello".into(),
                voice: "custom-voice".into(),
                language: None,
                output: TtsRequestFlashV15TextVoice7c30ce7aOutput::Pcm(pcm()),
                timestamp_granularity: Default::default(),
            })
        }
        _ => TtsRequest::FlashV15TextVoicee827622b(TtsRequestFlashV15TextVoicee827622b {
            model: Default::default(),
            text: "Hello".into(),
            voice: "custom-voice".into(),
            language: None,
            output: if mode == Mode::Plain {
                TtsRequestFlashV15TextVoicee827622bOutput::Wav(
                    TtsRequestFlashV15TextVoicee827622bOutputWav {
                        format: Default::default(),
                        sample_rate_hz: 24000.0,
                        byte_order: None,
                        sample_encoding: None,
                    },
                )
            } else {
                TtsRequestFlashV15TextVoicee827622bOutput::Pcm(pcm())
            },
        }),
    }
}
fn incremental(text: StreamingInput<String>) -> TtsRequest {
    TtsRequest::FlashV15StreamingTextVoice(TtsRequestFlashV15StreamingTextVoice {
        model: Default::default(),
        text,
        voice: "custom-voice".into(),
        language: None,
        output: TtsRequestFlashV15StreamingTextVoiceOutput::Pcm(pcm()),
        segmentation: Some(TtsRequestFlashV15StreamingTextVoiceSegmentation::Immediate(
            Default::default(),
        )),
    })
}
fn ready<T>(future: impl Future<Output = T>, cx: &mut Context<'_>) -> T {
    match std::pin::pin!(future).as_mut().poll(cx) {
        Poll::Ready(value) => value,
        Poll::Pending => panic!("unexpected pending initialization"),
    }
}
fn tree(raw: Raw<'_>) -> JsonValue {
    if raw.is_null() {
        JsonValue::Null
    } else if let Ok(value) = raw.boolean() {
        JsonValue::Bool(value)
    } else if let Ok(value) = raw.string() {
        JsonValue::String(value)
    } else if let Ok(value) = raw.array() {
        JsonValue::Array(value.into_iter().map(tree).collect())
    } else if let Ok(value) = raw.object() {
        JsonValue::Object(
            value
                .into_iter()
                .map(|(key, raw)| (key, tree(raw)))
                .collect(),
        )
    } else {
        JsonValue::Number(raw.number().unwrap())
    }
}
fn json_tree(text: &str) -> JsonValue {
    tree(Raw::parse(text).unwrap())
}
fn bytes(raw: Raw<'_>) -> Vec<u8> {
    raw.array()
        .unwrap()
        .into_iter()
        .map(|raw| raw.number().unwrap() as u8)
        .collect()
}
fn envelope(value: TimestampedAudio) -> JsonValue {
    JsonValue::Object(
        [
            (
                "correlation".into(),
                JsonValue::String(value.correlation.value().into()),
            ),
            (
                "audio".into(),
                JsonValue::Array(
                    value
                        .audio
                        .into_iter()
                        .map(|v| JsonValue::Number(v as f64))
                        .collect(),
                ),
            ),
            (
                "timestamps".into(),
                JsonValue::Array(
                    value
                        .timestamps
                        .into_iter()
                        .map(|v| {
                            JsonValue::Object(
                                [
                                    ("kind".into(), JsonValue::String(v.kind.value().into())),
                                    ("value".into(), JsonValue::String(v.value)),
                                    ("startTimeMs".into(), JsonValue::Number(v.start_time_ms)),
                                    ("endTimeMs".into(), JsonValue::Number(v.end_time_ms)),
                                ]
                                .into(),
                            )
                        })
                        .collect(),
                ),
            ),
        ]
        .into(),
    )
}

#[test]
fn shared_http_fixtures_at_every_byte_split() {
    for fixture in Raw::parse(include_str!("../../../../fixtures/async.json"))
        .unwrap()
        .array()
        .unwrap()
    {
        let fixture = fixture.object().unwrap();
        let name = fixture["name"].string().unwrap();
        let data = fixture
            .get("bodyBytes")
            .map(|raw| bytes(*raw))
            .unwrap_or_else(|| fixture["bodyText"].string().unwrap().into_bytes());
        let mode = match fixture["mode"].string().unwrap().as_str() {
            "plain" => Mode::Plain,
            "streaming" => Mode::Streaming,
            "timestamped" => Mode::Timestamped,
            _ => panic!("invalid fixture"),
        };
        for split in 0..=data.len() {
            let counts = Arc::new(Counts::default());
            let waker = Waker::from(counts.clone());
            let mut cx = Context::from_waker(&waker);
            let transport = http(
                &counts,
                vec![data[..split].into(), data[split..].into()],
                fixture["status"].number().unwrap() as u16,
                false,
            );
            let auth = auth();
            let mut stream = ready(
                synthesize(
                    whole(mode),
                    Options {
                        auth: Some(&auth),
                        transport: Some(&transport),
                        ..Options::default()
                    },
                ),
                &mut cx,
            )
            .unwrap();
            let mut audio = Vec::new();
            let mut envelopes = Vec::new();
            let mut error = None;
            let mut finished = false;
            for _ in 0..data.len() + 20 {
                match Pin::new(&mut stream).poll_next(&mut cx) {
                    Poll::Pending => {}
                    Poll::Ready(None) => {
                        finished = true;
                        break;
                    }
                    Poll::Ready(Some(Err(value))) => {
                        error = Some(value.to_string());
                        finished = true;
                        break;
                    }
                    Poll::Ready(Some(Ok(SynthesisItem::Bytes(bytes)))) => audio.extend(bytes),
                    Poll::Ready(Some(Ok(SynthesisItem::Chunk(value)))) => {
                        envelopes.push(envelope(value))
                    }
                }
            }
            assert!(finished, "{name} split {split} did not finish");
            assert_eq!(audio, bytes(fixture["audio"]), "{name} split {split}");
            assert_eq!(
                JsonValue::Array(envelopes),
                tree(fixture["envelopes"]),
                "{name} split {split}"
            );
            assert_eq!(
                error,
                fixture.get("error").map(|raw| raw.string().unwrap()),
                "{name} split {split}"
            );
            assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
            assert!(matches!(
                Pin::new(&mut stream).poll_next(&mut cx),
                Poll::Ready(None)
            ));
            drop(stream);
            assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        }
    }
}

#[test]
fn http_routes_settings_limits_and_drop_ownership() {
    for mode in [Mode::Plain, Mode::Streaming, Mode::Timestamped] {
        let counts = Arc::new(Counts::default());
        let waker = Waker::from(counts.clone());
        let mut cx = Context::from_waker(&waker);
        let transport = http(&counts, vec![vec![0, 255, 128]], 200, true);
        let auth = auth();
        let mut stream = ready(
            synthesize(
                whole(mode),
                Options {
                    auth: Some(&auth),
                    transport: Some(&transport),
                    base_url: Some("https://proxy.test/prefix%2Fvoice/?keep=1"),
                    ..Options::default()
                },
            ),
            &mut cx,
        )
        .unwrap();
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        let requests = transport.requests.lock().unwrap();
        let request = &requests[0];
        let (path, container) = match mode {
            Mode::Plain => ("/text_to_speech", "wav"),
            Mode::Streaming => ("/text_to_speech/streaming", "raw"),
            Mode::Timestamped => ("/text_to_speech/with_timestamps", "raw"),
        };
        assert_eq!(
            request.url,
            format!("https://proxy.test/prefix%2Fvoice{path}?keep=1")
        );
        assert_eq!(request.method, "POST");
        assert_eq!(
            request.headers,
            vec![
                ("x-api-key".into(), "test + key".into()),
                ("version".into(), "v1".into()),
                ("content-type".into(), "application/json".into())
            ]
        );
        assert_eq!(
            json_tree(std::str::from_utf8(&request.body).unwrap()),
            json_tree(&format!(
                r#"{{"model_id":"async_flash_v1.5","voice":{{"mode":"id","id":"custom-voice"}},"output_format":{{"container":"{container}","sample_rate":24000,"encoding":"pcm_s16le"}},"transcript":"Hello"}}"#
            ))
        );
        if mode != Mode::Timestamped {
            assert!(
                matches!(Pin::new(&mut stream).poll_next(&mut cx), Poll::Ready(Some(Ok(SynthesisItem::Bytes(value)))) if value == vec![0,255,128])
            );
        }
        drop(stream);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
    for status in [200, 400] {
        let counts = Arc::new(Counts::default());
        let waker = Waker::from(counts.clone());
        let mut cx = Context::from_waker(&waker);
        let transport = http(&counts, vec![vec![1; 5]], status, false);
        let auth = auth();
        let mut stream = ready(
            synthesize(
                whole(Mode::Timestamped),
                Options {
                    auth: Some(&auth),
                    transport: Some(&transport),
                    max_json_bytes: 4,
                    ..Options::default()
                },
            ),
            &mut cx,
        )
        .unwrap();
        match Pin::new(&mut stream).poll_next(&mut cx) {
            Poll::Ready(Some(Err(error))) => {
                assert_eq!(error.to_string(), "Async response exceeds max_json_bytes")
            }
            _ => panic!("limit not enforced"),
        }
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[derive(Default)]
struct SocketState {
    messages: Vec<String>,
    incoming: VecDeque<Result<Message, TransportError>>,
    writing: bool,
    block_settings: bool,
    block_text: bool,
    eof: bool,
    receives: usize,
    drops: usize,
    waker: Option<Waker>,
    send_error: Option<TransportError>,
    flush_error: Option<TransportError>,
}
struct TestSocket(Arc<Mutex<SocketState>>);
impl Drop for TestSocket {
    fn drop(&mut self) {
        self.0.lock().unwrap().drops += 1;
    }
}
impl WebSocketLike for TestSocket {
    fn start_send(self: Pin<&mut Self>, message: Message) -> Result<(), TransportError> {
        let Message::Text(text) = message else {
            panic!("provider must send text");
        };
        let mut state = self.0.lock().unwrap();
        assert!(!state.writing, "a write overtook its predecessor");
        if let Some(error) = state.send_error.take() {
            return Err(error);
        }
        state.writing = true;
        let fields = Raw::parse(&text).unwrap().object().unwrap();
        if let Some(id) = fields.get("context_id") {
            let id = id.string().unwrap();
            let close = fields
                .get("close_context")
                .and_then(|v| v.boolean().ok())
                .unwrap_or(false);
            state.incoming.push_back(Ok(Message::Text(format!(
                r#"{{"context_id":"{id}","audio":"{}","final":{close}}}"#,
                if close { "" } else { "AP+A" }
            ))));
        }
        state.messages.push(text);
        Ok(())
    }
    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), TransportError>> {
        let mut state = self.0.lock().unwrap();
        if let Some(error) = state.flush_error.take() {
            return Poll::Ready(Err(error));
        }
        if (state.messages.len() == 1 && state.block_settings)
            || (state.messages.len() > 1 && state.block_text)
        {
            state.waker = Some(cx.waker().clone());
            Poll::Pending
        } else {
            state.writing = false;
            Poll::Ready(Ok(()))
        }
    }
    fn poll_receive(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Message, TransportError>>> {
        let mut state = self.0.lock().unwrap();
        state.receives += 1;
        if let Some(value) = state.incoming.pop_front() {
            Poll::Ready(Some(value))
        } else if state.eof {
            Poll::Ready(None)
        } else {
            state.waker = Some(cx.waker().clone());
            Poll::Pending
        }
    }
}
struct Factory {
    socket: Arc<Mutex<SocketState>>,
    requests: Mutex<Vec<ConnectRequest>>,
    entropy: AtomicUsize,
}
impl Factory {
    fn new() -> Self {
        Self {
            socket: Arc::new(Mutex::new(SocketState::default())),
            requests: Mutex::new(Vec::new()),
            entropy: AtomicUsize::new(0),
        }
    }
}
impl WebSocketTransport for Factory {
    fn connect(
        &self,
        request: ConnectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<Socket, TransportError>> + Send + '_>> {
        self.requests.lock().unwrap().push(request);
        Box::pin(async {
            let socket: Socket = Box::pin(TestSocket(self.socket.clone()));
            Ok(socket)
        })
    }
    fn random_bytes(&self, output: &mut [u8]) -> Result<(), TransportError> {
        self.entropy.fetch_add(1, Ordering::SeqCst);
        for (index, byte) in output.iter_mut().enumerate() {
            *byte = index as u8;
        }
        Ok(())
    }
}

#[test]
fn incremental_auth_context_final_and_exact_text() {
    let counts = Arc::new(Counts::default());
    let waker = Waker::from(counts.clone());
    let mut cx = Context::from_waker(&waker);
    let auth = auth();
    let factory = Factory::new();
    let mut stream = ready(synthesize(incremental(input(&counts, &["", "hello\u{feff}", "world\u{85}"], false)), Options { auth: Some(&auth), web_socket_transport: Some(&factory), web_socket_url: Some("wss://proxy.test/socket%2Fvoice?keep=1&%61pi_key=old&api_key=other&version=old"), ..Options::default() }), &mut cx).unwrap();
    assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
    let requests = factory.requests.lock().unwrap();
    assert_eq!(
        requests[0].url,
        "wss://proxy.test/socket%2Fvoice?keep=1&api_key=test%20%2B%20key&version=v1"
    );
    assert_eq!(requests[0].headers.len(), 0);
    assert_eq!(requests[0].max_message_bytes, 4 * 1024 * 1024);
    drop(requests);
    let mut output = Vec::new();
    let mut finished = false;
    for _ in 0..30 {
        match Pin::new(&mut stream).poll_next(&mut cx) {
            Poll::Pending => {}
            Poll::Ready(None) => {
                finished = true;
                break;
            }
            Poll::Ready(Some(Ok(SynthesisItem::Bytes(bytes)))) => output.push(bytes),
            _ => panic!("unexpected incremental result"),
        }
    }
    assert!(finished);
    assert_eq!(output, vec![vec![0, 255, 128], vec![0, 255, 128]]);
    let state = factory.socket.lock().unwrap();
    let messages: Vec<_> = state.messages.iter().map(|s| json_tree(s)).collect();
    assert_eq!(
        messages,
        vec![
            json_tree(
                r#"{"model_id":"async_flash_v1.5","voice":{"mode":"id","id":"custom-voice"},"output_format":{"container":"raw","sample_rate":24000,"encoding":"pcm_s16le"}}"#
            ),
            json_tree(&format!(
                r#"{{"context_id":"{ID}","transcript":"hello ","force":true}}"#
            )),
            json_tree(&format!(
                r#"{{"context_id":"{ID}","transcript":"world\u0085 ","force":true}}"#
            )),
            json_tree(&format!(
                r#"{{"context_id":"{ID}","transcript":"","close_context":true}}"#
            )),
        ]
    );
    assert_eq!(state.drops, 1);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(factory.entropy.load(Ordering::SeqCst), 1);
}

#[test]
fn settings_before_input_and_audio_during_blocked_write() {
    for settings in [true, false] {
        let counts = Arc::new(Counts::default());
        let waker = Waker::from(counts.clone());
        let mut cx = Context::from_waker(&waker);
        let auth = auth();
        let factory = Factory::new();
        {
            let mut state = factory.socket.lock().unwrap();
            state.block_settings = settings;
            state.block_text = !settings;
        }
        let mut stream = ready(
            synthesize(
                incremental(input(&counts, &["hello", "do not prefetch"], true)),
                Options {
                    auth: Some(&auth),
                    web_socket_transport: Some(&factory),
                    ..Options::default()
                },
            ),
            &mut cx,
        )
        .unwrap();
        assert!(Pin::new(&mut stream).poll_next(&mut cx).is_pending());
        if settings {
            assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        } else {
            assert!(
                matches!(Pin::new(&mut stream).poll_next(&mut cx), Poll::Ready(Some(Ok(SynthesisItem::Bytes(bytes)))) if bytes == vec![0,255,128])
            );
            assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
            assert!(factory.socket.lock().unwrap().writing);
        }
        drop(stream);
        assert_eq!(factory.socket.lock().unwrap().drops, 1);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn incremental_terminal_errors_and_limits_release_ownership() {
    for (message, expected) in [
        (
            Message::Binary(vec![1]),
            "Async returned a non-text WebSocket frame",
        ),
        (
            Message::Text("[]".into()),
            "Async returned an invalid WebSocket message",
        ),
        (
            Message::Text("{}".into()),
            "Async returned an unknown WebSocket message",
        ),
        (
            Message::Text(r#"{"error_code":"quota","message":"no credits"}"#.into()),
            "Async synthesis failed (quota): no credits",
        ),
        (
            Message::Text(r#"{"context_id":"other","audio":"","final":false}"#.into()),
            "Async returned output for an unexpected context",
        ),
        (
            Message::Text(format!(
                r#"{{"context_id":"{ID}","audio":"","final":true}}"#
            )),
            "Async finalized the context before input completed",
        ),
        (
            Message::Text(format!(
                r#"{{"context_id":"{ID}","audio":"!","final":false}}"#
            )),
            "Async returned invalid base64 audio",
        ),
        (
            Message::Text("x".repeat(301)),
            "Async message exceeds max_message_bytes",
        ),
    ] {
        let counts = Arc::new(Counts::default());
        let waker = Waker::from(counts.clone());
        let mut cx = Context::from_waker(&waker);
        let auth = auth();
        let factory = Factory::new();
        factory
            .socket
            .lock()
            .unwrap()
            .incoming
            .push_back(Ok(message));
        let mut stream = ready(
            synthesize(
                incremental(input(&counts, &[], true)),
                Options {
                    auth: Some(&auth),
                    web_socket_transport: Some(&factory),
                    max_message_bytes: 300,
                    ..Options::default()
                },
            ),
            &mut cx,
        )
        .unwrap();
        match Pin::new(&mut stream).poll_next(&mut cx) {
            Poll::Ready(Some(Err(error))) => assert_eq!(error.to_string(), expected),
            _ => panic!("missing protocol error {expected}"),
        }
        assert_eq!(factory.socket.lock().unwrap().drops, 1);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        assert!(matches!(
            Pin::new(&mut stream).poll_next(&mut cx),
            Poll::Ready(None)
        ));
    }
}

#[test]
fn empty_input_and_unread_stream_drop() {
    for unread in [false, true] {
        let counts = Arc::new(Counts::default());
        let waker = Waker::from(counts.clone());
        let mut cx = Context::from_waker(&waker);
        let auth = auth();
        let factory = Factory::new();
        let mut stream = ready(
            synthesize(
                incremental(input(&counts, &[], false)),
                Options {
                    auth: Some(&auth),
                    web_socket_transport: Some(&factory),
                    ..Options::default()
                },
            ),
            &mut cx,
        )
        .unwrap();
        if !unread {
            assert!(matches!(
                Pin::new(&mut stream).poll_next(&mut cx),
                Poll::Ready(None)
            ));
        }
        drop(stream);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(
            counts.reads.load(Ordering::SeqCst),
            if unread { 0 } else { 1 }
        );
        let state = factory.socket.lock().unwrap();
        assert_eq!(state.drops, 1);
        assert_eq!(state.messages.len(), 1);
    }
}

#[test]
fn generated_rejection_precedes_connect_and_entropy() {
    let counts = Arc::new(Counts::default());
    let waker = Waker::from(counts.clone());
    let mut cx = Context::from_waker(&waker);
    let auth = auth();
    let factory = Factory::new();
    let mut request = incremental(input(&counts, &["unread"], true));
    if let TtsRequest::FlashV15StreamingTextVoice(r) = &mut request {
        if let TtsRequestFlashV15StreamingTextVoiceOutput::Pcm(output) = &mut r.output {
            output.sample_rate_hz = 4000.0;
        }
    }
    let result = ready(
        synthesize(
            request,
            Options {
                auth: Some(&auth),
                web_socket_transport: Some(&factory),
                ..Options::default()
            },
        ),
        &mut cx,
    );
    assert_eq!(
        result.err().unwrap().to_string(),
        "Invalid async TTS request"
    );
    assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
    // Rust moved ownership into the call; failing still drops the owned producer.
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(factory.entropy.load(Ordering::SeqCst), 0);
    assert_eq!(factory.requests.lock().unwrap().len(), 0);
}

#[test]
fn timestamp_validation_and_url_auth_encoding() {
    for (body, expected) in [
        ("null", "Async returned an invalid timestamp response"),
        ("{}", "Async returned incomplete timestamped audio"),
        (
            r#"{"audio_base64":"","alignment":{"words":null,"word_start_times_milliseconds":[],"word_end_times_milliseconds":[]}}"#,
            "Async returned mismatched word timestamp arrays",
        ),
        (
            r#"{"audio_base64":"","alignment":{"words":["a"],"word_start_times_milliseconds":[true],"word_end_times_milliseconds":[1]}}"#,
            "Async returned an invalid word timestamp",
        ),
        (
            r#"{"audio_base64":"","alignment":{"words":["a"],"word_start_times_milliseconds":[0],"word_end_times_milliseconds":[1e400]}}"#,
            "Async returned an invalid word timestamp",
        ),
        (
            r#"{"audio_base64":"","alignment":{"words":["a"],"word_start_times_milliseconds":[2],"word_end_times_milliseconds":[1]}}"#,
            "Async returned an invalid word timestamp",
        ),
    ] {
        assert_eq!(
            protocol::timestamped(body).err().unwrap().to_string(),
            expected
        );
    }
    assert_eq!(
        protocol::socket_url(
            "wss://host/socket?keep=%2B&api%5Fkey=old&version=old",
            "é +/=&"
        )
        .unwrap(),
        "wss://host/socket?keep=%2B&api_key=%C3%A9%20%2B%2F%3D%26&version=v1"
    );
    for url in [
        "https://host",
        "wss://user:secret@host",
        "wss:///path",
        "wss://host/#secret",
        "wss://host/white space",
    ] {
        assert_eq!(
            protocol::socket_url(url, "secret").unwrap_err().to_string(),
            "Invalid Async endpoint URL"
        );
    }
}

#[test]
fn all_model_modes_and_format_settings_use_generated_types() {
    let counts = Arc::new(Counts::default());
    let requests = [
        (
            incremental(input(&counts, &[], false)),
            "async_flash_v1.5",
            false,
            true,
            "raw",
            None,
        ),
        (
            whole(Mode::Plain),
            "async_flash_v1.5",
            false,
            false,
            "wav",
            None,
        ),
        (
            whole(Mode::Timestamped),
            "async_flash_v1.5",
            true,
            false,
            "raw",
            None,
        ),
        (
            TtsRequest::Castleflow10StreamingTextVoice(TtsRequestCastleflow10StreamingTextVoice {
                model: Default::default(),
                voice: "custom-voice".into(),
                language: Some(TtsRequestCastleflow10StreamingTextVoiceLanguage::Ja(
                    Default::default(),
                )),
                text: input(&counts, &[], false),
                output: TtsRequestFlashV15StreamingTextVoiceOutput::Pcm(pcm()),
                speed: Some(0.7),
                stability: Some(0.005),
                segmentation: None,
            }),
            "async_flash_v1.0",
            false,
            true,
            "raw",
            Some("ja"),
        ),
        (
            TtsRequest::Castleflow10TextVoice8e858d00(TtsRequestCastleflow10TextVoice8e858d00 {
                model: Default::default(),
                voice: "custom-voice".into(),
                language: Some(TtsRequestCastleflow10StreamingTextVoiceLanguage::Ja(
                    Default::default(),
                )),
                text: "Hello".into(),
                output: TtsRequestFlashV15TextVoicee827622bOutput::Pcm(pcm()),
                speed: Some(0.7),
                stability: Some(0.005),
            }),
            "async_flash_v1.0",
            false,
            false,
            "raw",
            Some("ja"),
        ),
        (
            TtsRequest::Castleflow10TextVoice09f4eeb0(TtsRequestCastleflow10TextVoice09f4eeb0 {
                model: Default::default(),
                voice: "custom-voice".into(),
                language: Some(TtsRequestCastleflow10StreamingTextVoiceLanguage::Ja(
                    Default::default(),
                )),
                text: "Hello".into(),
                output: TtsRequestFlashV15TextVoice7c30ce7aOutput::Pcm(pcm()),
                speed: Some(0.7),
                stability: Some(0.005),
                timestamp_granularity: Default::default(),
            }),
            "async_flash_v1.0",
            true,
            false,
            "raw",
            Some("ja"),
        ),
        (
            TtsRequest::ProV10StreamingTextVoice(TtsRequestProV10StreamingTextVoice {
                model: Default::default(),
                voice: "custom-voice".into(),
                language: Some(Default::default()),
                text: input(&counts, &[], false),
                output: TtsRequestFlashV15StreamingTextVoiceOutput::Pcm(pcm()),
                segmentation: None,
            }),
            "async_pro_v1.0",
            false,
            true,
            "raw",
            Some("en"),
        ),
        (
            TtsRequest::ProV10TextVoice54fc4ea5(TtsRequestProV10TextVoice54fc4ea5 {
                model: Default::default(),
                voice: "custom-voice".into(),
                language: Some(Default::default()),
                text: "Hello".into(),
                output: TtsRequestFlashV15TextVoicee827622bOutput::Pcm(pcm()),
            }),
            "async_pro_v1.0",
            false,
            false,
            "raw",
            Some("en"),
        ),
        (
            TtsRequest::ProV10TextVoice96f74303(TtsRequestProV10TextVoice96f74303 {
                model: Default::default(),
                voice: "custom-voice".into(),
                language: Some(Default::default()),
                text: "Hello".into(),
                output: TtsRequestFlashV15TextVoice7c30ce7aOutput::Pcm(pcm()),
                timestamp_granularity: Default::default(),
            }),
            "async_pro_v1.0",
            true,
            false,
            "raw",
            Some("en"),
        ),
    ];
    for (request, model, timed, streaming, container, language) in requests {
        assert!(validate_request(&request).is_ok());
        let wire = settings::settings(request);
        let fields = Raw::parse(&wire.settings).unwrap().object().unwrap();
        let mut expected = format!(
            r#"{{"model_id":"{model}","voice":{{"mode":"id","id":"custom-voice"}},"output_format":{{"container":"{container}","sample_rate":24000,"encoding":"pcm_s16le"}}"#
        );
        if let Some(language) = language {
            expected.push_str(&format!(r#", "language":"{language}""#));
        }
        if model == "async_flash_v1.0" {
            expected.push_str(r#", "speed_control":0.7,"stability":1"#);
        }
        expected.push('}');
        assert_eq!(
            tree(Raw::parse(&wire.settings).unwrap()),
            json_tree(&expected)
        );
        assert_eq!(wire.mode == Mode::Timestamped, timed);
        assert_eq!(matches!(&wire.text, Text::Streaming(_)), streaming);
        if let Text::Whole(text) = &wire.text {
            assert_eq!(text, "Hello");
        }
        assert_eq!(fields["model_id"].string().unwrap(), model);
    }
    for (output, expected) in [
        (
            TtsRequestFlashV15TextVoicee827622bOutput::Mp3(
                TtsRequestFlashV15StreamingTextVoiceOutputMp3 {
                    format: Default::default(),
                    sample_rate_hz: 48000.0,
                    bit_rate_bps: None,
                },
            ),
            r#"{"container":"mp3","sample_rate":48000,"bit_rate":192000}"#,
        ),
        (
            TtsRequestFlashV15TextVoicee827622bOutput::Mp3(
                TtsRequestFlashV15StreamingTextVoiceOutputMp3 {
                    format: Default::default(),
                    sample_rate_hz: 44100.0,
                    bit_rate_bps: Some(32000.0),
                },
            ),
            r#"{"container":"mp3","sample_rate":44100,"bit_rate":32000}"#,
        ),
        (
            TtsRequestFlashV15TextVoicee827622bOutput::Mulaw(
                TtsRequestFlashV15StreamingTextVoiceOutputMulaw {
                    format: Default::default(),
                    sample_rate_hz: 8000.0,
                },
            ),
            r#"{"container":"raw","sample_rate":8000,"encoding":"pcm_mulaw"}"#,
        ),
        (
            TtsRequestFlashV15TextVoicee827622bOutput::Wav(
                TtsRequestFlashV15TextVoicee827622bOutputWav {
                    format: Default::default(),
                    sample_rate_hz: 24000.0,
                    sample_encoding: Some(
                        TtsRequestFlashV15StreamingTextVoiceOutputPcmSampleEncoding::Float32(
                            Default::default(),
                        ),
                    ),
                    byte_order: Some(Default::default()),
                },
            ),
            r#"{"container":"wav","sample_rate":24000,"encoding":"pcm_f32le"}"#,
        ),
    ] {
        let request =
            TtsRequest::Castleflow10TextVoice8e858d00(TtsRequestCastleflow10TextVoice8e858d00 {
                model: Default::default(),
                voice: "voice".into(),
                text: "text".into(),
                language: None,
                speed: None,
                stability: Some(0.0),
                output,
            });
        assert!(validate_request(&request).is_ok());
        let wire = settings::settings(request);
        let fields = Raw::parse(&wire.settings).unwrap().object().unwrap();
        assert_eq!(tree(fields["output_format"]), json_tree(expected));
        assert_eq!(fields["stability"].number().unwrap(), 0.0);
    }
}

struct DropGuard(Arc<Counts>);
impl Drop for DropGuard {
    fn drop(&mut self) {
        self.0.drops.fetch_add(1, Ordering::SeqCst);
    }
}
struct PendingBackend(Arc<Counts>);
impl HttpTransport for PendingBackend {
    fn send(
        &self,
        _: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        Box::pin(async {
            let _guard = DropGuard(self.0.clone());
            std::future::pending().await
        })
    }
}
impl WebSocketTransport for PendingBackend {
    fn connect(
        &self,
        _: ConnectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<Socket, TransportError>> + Send + '_>> {
        Box::pin(async {
            let _guard = DropGuard(self.0.clone());
            std::future::pending().await
        })
    }
    fn random_bytes(&self, bytes: &mut [u8]) -> Result<(), TransportError> {
        bytes.fill(42);
        Ok(())
    }
}
#[test]
fn dropping_pending_initialization_and_reads_cancels_without_repolling() {
    for socket in [false, true] {
        let network = Arc::new(Counts::default());
        let producer = Arc::new(Counts::default());
        let waker = Waker::from(network.clone());
        let mut cx = Context::from_waker(&waker);
        let auth = auth();
        let backend = PendingBackend(network.clone());
        let request = if socket {
            incremental(input(&producer, &["unread"], false))
        } else {
            whole(Mode::Streaming)
        };
        let mut future = Box::pin(synthesize(
            request,
            Options {
                auth: Some(&auth),
                transport: Some(&backend),
                web_socket_transport: Some(&backend),
                ..Options::default()
            },
        ));
        assert!(future.as_mut().poll(&mut cx).is_pending());
        assert_eq!(network.drops.load(Ordering::SeqCst), 0);
        drop(future);
        assert_eq!(network.drops.load(Ordering::SeqCst), 1);
        assert_eq!(producer.reads.load(Ordering::SeqCst), 0);
        assert_eq!(
            producer.drops.load(Ordering::SeqCst),
            if socket { 1 } else { 0 }
        );
    }
    for mode in [Mode::Plain, Mode::Streaming, Mode::Timestamped] {
        let counts = Arc::new(Counts::default());
        let waker = Waker::from(counts.clone());
        let mut cx = Context::from_waker(&waker);
        let auth = auth();
        let transport = http(&counts, Vec::new(), 200, true);
        let mut stream = ready(
            synthesize(
                whole(mode),
                Options {
                    auth: Some(&auth),
                    transport: Some(&transport),
                    ..Options::default()
                },
            ),
            &mut cx,
        )
        .unwrap();
        assert!(Pin::new(&mut stream).poll_next(&mut cx).is_pending());
        assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
        drop(stream);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[derive(Debug)]
struct Cause(Arc<()>);
impl std::fmt::Display for Cause {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("test transport error")
    }
}
impl std::error::Error for Cause {}

#[test]
fn transport_and_input_error_identity_survives_cleanup() {
    for source in ["http", "socket", "input"] {
        let marker = Arc::new(());
        let counts = Arc::new(Counts::default());
        let waker = Waker::from(counts.clone());
        let mut cx = Context::from_waker(&waker);
        let auth = auth();
        let factory = Factory::new();
        let error: TransportError = Box::new(Cause(marker.clone()));
        let mut stream = if source == "http" {
            let transport = Http {
                response: Mutex::new(Some(HttpResponse {
                    status: 200,
                    headers: Vec::new(),
                    body: Box::pin(Body {
                        values: vec![Err(error)].into(),
                        counts: counts.clone(),
                        stall: false,
                    }),
                })),
                requests: Mutex::new(Vec::new()),
            };
            ready(
                synthesize(
                    whole(Mode::Streaming),
                    Options {
                        auth: Some(&auth),
                        transport: Some(&transport),
                        ..Options::default()
                    },
                ),
                &mut cx,
            )
            .unwrap()
        } else {
            let text: StreamingInput<String> = if source == "input" {
                Box::pin(Body {
                    values: vec![Err(error)].into(),
                    counts: counts.clone(),
                    stall: false,
                })
            } else {
                factory
                    .socket
                    .lock()
                    .unwrap()
                    .incoming
                    .push_back(Err(error));
                input(&counts, &[], true)
            };
            ready(
                synthesize(
                    incremental(text),
                    Options {
                        auth: Some(&auth),
                        web_socket_transport: Some(&factory),
                        ..Options::default()
                    },
                ),
                &mut cx,
            )
            .unwrap()
        };
        let Poll::Ready(Some(Err(error))) = Pin::new(&mut stream).poll_next(&mut cx) else {
            panic!("missing {source} failure")
        };
        assert!(Arc::ptr_eq(
            &error.downcast_ref::<Cause>().unwrap().0,
            &marker
        ));
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        if source != "http" {
            assert_eq!(factory.socket.lock().unwrap().drops, 1);
        }
    }
}

#[test]
fn auth_environment_child() {
    let Ok(expected) = std::env::var("SPEECHSWITCH_TEST_ASYNC_AUTH") else {
        return;
    };
    let counts = Arc::new(Counts::default());
    let waker = Waker::from(counts.clone());
    let mut cx = Context::from_waker(&waker);
    let mut auth = auth();
    let transport = http(&counts, Vec::new(), 200, false);
    if expected == "explicit-empty" {
        auth.async_.as_mut().unwrap().api_key = Some(String::new());
    }
    let result = ready(
        synthesize(
            whole(Mode::Plain),
            Options {
                auth: if expected == "test + key" || expected == "explicit-empty" {
                    Some(&auth)
                } else {
                    None
                },
                transport: Some(&transport),
                ..Options::default()
            },
        ),
        &mut cx,
    );
    if expected.is_empty() || expected == "explicit-empty" {
        assert_eq!(
            result.err().unwrap().to_string(),
            "Missing auth.async.apiKey configuration"
        );
        assert_eq!(transport.requests.lock().unwrap().len(), 0);
    } else {
        drop(result.unwrap());
        assert_eq!(
            transport.requests.lock().unwrap()[0].headers[0],
            ("x-api-key".into(), expected)
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
        (Some("scoped"), Some("native"), "test + key"),
        (Some("scoped"), Some("native"), "explicit-empty"),
    ] {
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "providers::async_::tests::auth_environment_child",
                "--nocapture",
            ])
            .env_remove("SPEECHSWITCH_ASYNC_API_KEY")
            .env_remove("ASYNC_API_KEY")
            .env("SPEECHSWITCH_TEST_ASYNC_AUTH", expected);
        if let Some(value) = scoped {
            command.env("SPEECHSWITCH_ASYNC_API_KEY", value);
        }
        if let Some(value) = native {
            command.env("ASYNC_API_KEY", value);
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

#[test]
fn public_dependency_limits_and_premature_close_errors_are_explicit() {
    let counts = Arc::new(Counts::default());
    let waker = Waker::from(counts.clone());
    let mut cx = Context::from_waker(&waker);
    let auth = auth();
    assert_eq!(
        ready(
            synthesize(
                whole(Mode::Plain),
                Options {
                    auth: Some(&auth),
                    ..Options::default()
                }
            ),
            &mut cx
        )
        .err()
        .unwrap()
        .to_string(),
        "Async HTTP transport is required"
    );
    assert_eq!(
        ready(
            synthesize(
                incremental(input(&counts, &[], false)),
                Options {
                    auth: Some(&auth),
                    ..Options::default()
                }
            ),
            &mut cx
        )
        .err()
        .unwrap()
        .to_string(),
        "Async WebSocket transport is required"
    );
    assert_eq!(
        ready(
            synthesize(
                whole(Mode::Plain),
                Options {
                    auth: Some(&auth),
                    max_json_bytes: 0,
                    ..Options::default()
                }
            ),
            &mut cx
        )
        .err()
        .unwrap()
        .to_string(),
        "Async byte limits must be positive"
    );
    for settings in [true, false] {
        let factory = Factory::new();
        let counts = Arc::new(Counts::default());
        let text = "x".repeat(301);
        let result = ready(
            synthesize(
                incremental(input(&counts, &[&text], false)),
                Options {
                    auth: Some(&auth),
                    web_socket_transport: Some(&factory),
                    max_message_bytes: if settings { 1 } else { 300 },
                    ..Options::default()
                },
            ),
            &mut cx,
        );
        if settings {
            assert_eq!(
                result.err().unwrap().to_string(),
                "Async message exceeds max_message_bytes"
            );
            assert_eq!(factory.requests.lock().unwrap().len(), 0);
        } else {
            let mut stream = result.unwrap();
            let Poll::Ready(Some(Err(error))) = Pin::new(&mut stream).poll_next(&mut cx) else {
                panic!("oversize input accepted");
            };
            assert_eq!(error.to_string(), "Async message exceeds max_message_bytes");
            assert_eq!(factory.socket.lock().unwrap().messages.len(), 1);
        }
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
    let factory = Factory::new();
    factory.socket.lock().unwrap().eof = true;
    let mut stream = ready(
        synthesize(
            incremental(input(&counts, &[], true)),
            Options {
                auth: Some(&auth),
                web_socket_transport: Some(&factory),
                ..Options::default()
            },
        ),
        &mut cx,
    )
    .unwrap();
    let Poll::Ready(Some(Err(error))) = Pin::new(&mut stream).poll_next(&mut cx) else {
        panic!("premature close accepted");
    };
    assert_eq!(
        error.to_string(),
        "Async WebSocket closed before final output"
    );
    assert_eq!(factory.socket.lock().unwrap().drops, 1);
}

#[test]
fn failed_settings_send_or_flush_drops_socket_and_unpolled_input() {
    for flush in [false, true] {
        let counts = Arc::new(Counts::default());
        let waker = Waker::from(counts.clone());
        let mut cx = Context::from_waker(&waker);
        let auth = auth();
        let factory = Factory::new();
        let marker = Arc::new(());
        {
            let mut state = factory.socket.lock().unwrap();
            let error: TransportError = Box::new(Cause(marker.clone()));
            if flush {
                state.flush_error = Some(error);
            } else {
                state.send_error = Some(error);
            }
        }
        let result = ready(
            synthesize(
                incremental(input(&counts, &["unread"], true)),
                Options {
                    auth: Some(&auth),
                    web_socket_transport: Some(&factory),
                    ..Options::default()
                },
            ),
            &mut cx,
        );
        let error = if flush {
            let mut stream = result.unwrap();
            let Poll::Ready(Some(Err(error))) = Pin::new(&mut stream).poll_next(&mut cx) else {
                panic!("flush failure lost");
            };
            error
        } else {
            result.err().unwrap()
        };
        assert!(Arc::ptr_eq(
            &error.downcast_ref::<Cause>().unwrap().0,
            &marker
        ));
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(factory.socket.lock().unwrap().drops, 1);
    }
}
