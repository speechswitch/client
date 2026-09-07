use super::*;
use crate::{
    generated::{auth::AuthAsync, xai::*, xai_output::*},
    json::Raw,
    msgpack::{tests::fixture, Value},
    runtime::{InputStream, StreamingInput},
    websocket::{Message, WebSocketLike},
};
use std::{
    collections::VecDeque,
    future::{poll_fn, Future},
    pin::Pin,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    task::{Context, Poll, Wake, Waker},
};
mod lifecycle;
mod requests;

#[derive(Default)]
struct Counts {
    reads: AtomicUsize,
    wakes: AtomicUsize,
    drops: AtomicUsize,
}
impl Wake for Counts {
    fn wake(self: Arc<Self>) {
        self.wake_by_ref();
    }
    fn wake_by_ref(self: &Arc<Self>) {
        self.wakes.fetch_add(1, Ordering::SeqCst);
    }
}
struct Source<T> {
    values: VecDeque<Result<T, TransportError>>,
    counts: Arc<Counts>,
    stall: bool,
    trace: Arc<Mutex<Vec<&'static str>>>,
}
impl<T: Send + Unpin> InputStream<T> for Source<T> {
    fn poll_next(
        self: Pin<&mut Self>,
        _cx: &mut Context<'_>,
    ) -> Poll<Option<Result<T, TransportError>>> {
        let s = self.get_mut();
        s.counts.reads.fetch_add(1, Ordering::SeqCst);
        match s.values.pop_front() {
            Some(v) => Poll::Ready(Some(v)),
            None if s.stall => Poll::Pending,
            None => Poll::Ready(None),
        }
    }
}
impl<T> Drop for Source<T> {
    fn drop(&mut self) {
        self.counts.drops.fetch_add(1, Ordering::SeqCst);
        self.trace.lock().unwrap().push("input");
    }
}
fn source<T: Send + Unpin + 'static>(values: Vec<T>) -> StreamingInput<T> {
    Box::pin(Source {
        values: values.into_iter().map(Ok).collect(),
        counts: Arc::default(),
        stall: false,
        trace: Arc::default(),
    })
}
fn ready<T>(future: impl Future<Output = T>) -> T {
    let mut future = std::pin::pin!(future);
    let counts = Arc::new(Counts::default());
    let waker = Waker::from(counts.clone());
    let mut cx = Context::from_waker(&waker);
    for _ in 0..10000 {
        let before = counts.wakes.load(Ordering::SeqCst);
        match future.as_mut().poll(&mut cx) {
            Poll::Ready(v) => return v,
            Poll::Pending => assert!(
                counts.wakes.load(Ordering::SeqCst) > before,
                "pending without a wake"
            ),
        }
    }
    panic!("did not complete")
}
fn poll(stream: &mut Stream) -> Poll<Option<Result<SynthesisItem, TransportError>>> {
    let waker = Waker::from(Arc::new(Counts::default()));
    Pin::new(stream).poll_next(&mut Context::from_waker(&waker))
}
fn next(stream: &mut Stream) -> Option<Result<SynthesisItem, TransportError>> {
    ready(poll_fn(|cx| Pin::new(&mut *stream).poll_next(cx)))
}
fn value(text: &str) -> Value {
    fixture(Raw::parse_exact(text).unwrap())
}
fn output(item: SynthesisItem) -> Value {
    match item {
        SynthesisItem::Bytes(v) => Value::Binary(v),
        SynthesisItem::Clear(v) => value(&format!(r#"{{"event":"{}"}}"#, v.event.value())),
        SynthesisItem::Done(v) => Value::Map(std::collections::BTreeMap::from([
            ("event".into(), Value::String(v.event.value().into())),
            (
                "traceId".into(),
                v.trace_id.map_or(Value::Nil, Value::String),
            ),
        ])),
        SynthesisItem::Updated(v) => Value::Array(
            v.replacements
                .into_iter()
                .map(|r| Value::Array(vec![Value::String(r.pattern), Value::String(r.replacement)]))
                .collect(),
        ),
        SynthesisItem::Chunk(v) => {
            let timestamps = v
                .timestamps
                .into_iter()
                .map(|t| {
                    JsonValue::Object(settings::Map::from([
                        ("kind".into(), JsonValue::String(t.kind.value().into())),
                        ("value".into(), JsonValue::String(t.value)),
                        ("startTimeMs".into(), JsonValue::Number(t.start_time_ms)),
                        ("endTimeMs".into(), JsonValue::Number(t.end_time_ms)),
                    ]))
                })
                .collect();
            let mut text = String::new();
            json::write(
                &JsonValue::Object(settings::Map::from([
                    (
                        "correlation".into(),
                        JsonValue::String(v.correlation.value().into()),
                    ),
                    (
                        "audio".into(),
                        JsonValue::Array(
                            v.audio
                                .into_iter()
                                .map(|b| JsonValue::Number(b.into()))
                                .collect(),
                        ),
                    ),
                    (
                        "durationMs".into(),
                        v.duration_ms.map_or(JsonValue::Null, JsonValue::Number),
                    ),
                    ("timestamps".into(), JsonValue::Array(timestamps)),
                ])),
                &mut text,
            )
            .unwrap();
            value(&text)
        }
    }
}
fn collect(stream: &mut Stream) -> Result<Vec<Value>, TransportError> {
    let mut items = Vec::new();
    while let Some(item) = next(stream) {
        items.push(output(item?));
    }
    Ok(items)
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
        openai: None,
        resemble: None,
        respeecher: None,
        rime: None,
        smallest_ai: None,
        typecast: None,
        vocu: None,
        voice_ai: None,
        xai: Some(AuthAsync {
            api_key: Some("fixture".into()),
        }),
    }
}
fn request() -> TtsRequestText {
    TtsRequestText {
        language: None,
        latency_optimization: None,
        model: None,
        output: None,
        replacements: None,
        speed: None,
        text: "Hello".into(),
        text_normalization: None,
        timestamp_granularity: None,
        voice: None,
    }
}
fn live(input: StreamingInput<Input>) -> TtsRequest {
    TtsRequest::StreamingText(TtsRequestStreamingText {
        language: None,
        latency_optimization: None,
        model: None,
        output: None,
        replacements: None,
        speed: None,
        text: input,
        text_normalization: None,
        timestamp_granularity: None,
        voice: None,
    })
}
fn flush() -> Input {
    Input::Flush(TtsRequestStreamingTextTextItemFlush {
        command: Default::default(),
    })
}
fn clear() -> Input {
    Input::Clear(TtsRequestStreamingTextTextItemClear {
        command: Default::default(),
    })
}
fn update() -> Input {
    Input::Update(TtsRequestStreamingTextTextItemUpdate {
        command: Default::default(),
        replacements: vec![],
    })
}
struct Http {
    requests: Mutex<Vec<HttpRequest>>,
    response: Mutex<Option<HttpResponse>>,
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
fn http(bytes: Vec<u8>, mime: &str) -> Http {
    Http {
        requests: Mutex::default(),
        response: Mutex::new(Some(HttpResponse {
            status: 200,
            headers: vec![("Content-Type".into(), mime.into())],
            body: source(vec![bytes]),
        })),
    }
}
#[derive(Default)]
struct SocketData {
    sent: Vec<String>,
    incoming: VecDeque<Result<Message, TransportError>>,
    automatic: bool,
    closed: bool,
    block_flush: bool,
    block_done: bool,
    flush_error: Option<&'static str>,
    start_error: bool,
    wake: Option<Waker>,
}
struct FakeSocket {
    data: Arc<Mutex<SocketData>>,
    trace: Arc<Mutex<Vec<&'static str>>>,
}
impl WebSocketLike for FakeSocket {
    fn start_send(self: Pin<&mut Self>, message: Message) -> Result<(), TransportError> {
        let Message::Text(text) = message else {
            panic!("text protocol")
        };
        let fields = Raw::parse_exact(&text).unwrap().object().unwrap();
        let kind = fields["type"].string().unwrap();
        let mut data = self.data.lock().unwrap();
        if data.start_error {
            return Err(failure("start failed"));
        }
        if kind == "text.done" && data.block_done {
            data.block_flush = true;
        }
        if data.automatic {
            let reply = match kind.as_str() {
                "session.update" => Some(format!(
                    r#"{{"type":"session.updated","replace":{}}}"#,
                    fields["replace"].text()
                )),
                "text.delta" => Some(r#"{"type":"audio.delta","delta":"AP+A"}"#.into()),
                "text.done" => Some(r#"{"type":"audio.done","trace_id":"native"}"#.into()),
                "text.clear" => Some(r#"{"type":"audio.clear"}"#.into()),
                _ => panic!("unexpected input"),
            };
            if let Some(reply) = reply {
                data.incoming.push_back(Ok(Message::Text(reply)));
            }
        }
        data.sent.push(text);
        if let Some(waker) = data.wake.take() {
            waker.wake();
        }
        Ok(())
    }
    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), TransportError>> {
        let mut data = self.data.lock().unwrap();
        if let Some(message) = data.flush_error.take() {
            return Poll::Ready(Err(failure(message)));
        }
        if data.block_flush {
            data.wake = Some(cx.waker().clone());
            Poll::Pending
        } else {
            Poll::Ready(Ok(()))
        }
    }
    fn poll_receive(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Message, TransportError>>> {
        let mut data = self.data.lock().unwrap();
        match data.incoming.pop_front() {
            Some(v) => Poll::Ready(Some(v)),
            None if data.closed => Poll::Ready(None),
            None => {
                data.wake = Some(cx.waker().clone());
                Poll::Pending
            }
        }
    }
}
impl Drop for FakeSocket {
    fn drop(&mut self) {
        self.data.lock().unwrap().wake.take();
        self.trace.lock().unwrap().push("socket");
    }
}
fn socket(data: &Arc<Mutex<SocketData>>, trace: &Arc<Mutex<Vec<&'static str>>>) -> Socket {
    Box::pin(FakeSocket {
        data: data.clone(),
        trace: trace.clone(),
    })
}
fn native(
    input: StreamingInput<Input>,
    data: &Arc<Mutex<SocketData>>,
    trace: &Arc<Mutex<Vec<&'static str>>>,
) -> Stream {
    ready(synthesize(
        live(input),
        Options {
            auth: Some(&auth()),
            web_socket: Some(socket(data, trace)),
            ..Default::default()
        },
    ))
    .unwrap()
}

#[test]
fn native_http_bytes_have_no_synthetic_done_and_default_language_is_auto() {
    let http = http(vec![0, 255, 128], "audio/mpeg");
    let mut stream = ready(synthesize(
        TtsRequest::Text(request()),
        Options {
            auth: Some(&auth()),
            transport: Some(&http),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        collect(&mut stream).unwrap(),
        vec![Value::Binary(vec![0, 255, 128])]
    );
    let requests = http.requests.lock().unwrap();
    assert_eq!(requests.len(), 1);
    let req = &requests[0];
    assert_eq!(req.method, "POST");
    assert_eq!(req.url, "https://api.x.ai/v1/tts");
    assert_eq!(
        req.headers,
        [
            ("Authorization".into(), "Bearer fixture".into()),
            ("Content-Type".into(), "application/json".into()),
            ("Accept".into(), "audio/*, application/octet-stream".into())
        ]
    );
    assert_eq!(
        value(std::str::from_utf8(&req.body).unwrap()),
        value(r#"{"text":"Hello","language":"auto"}"#)
    );
}

#[test]
fn shared_native_timestamp_fixture_and_exact_invalid_frames() {
    let fixtures = Raw::parse_exact(include_str!("../../../../fixtures/xai.json"))
        .unwrap()
        .object()
        .unwrap();
    let timed = fixtures["timestamped"].object().unwrap();
    let http = http(
        timed["wire"].text().as_bytes().to_vec(),
        "application/json; charset=utf-8",
    );
    let mut req = request();
    req.timestamp_granularity = Some(Default::default());
    let mut stream = ready(synthesize(
        TtsRequest::Text(req),
        Options {
            auth: Some(&auth()),
            transport: Some(&http),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        collect(&mut stream).unwrap(),
        vec![fixture(timed["output"])]
    );
    let wire = timed["wire"].object().unwrap();
    let message = format!(
        r#"{{"type":"audio.delta","delta":{},"audio_duration":{},"audio_timestamps":{}}}"#,
        wire["audio"].text(),
        wire["duration"].text(),
        wire["audio_timestamps"].text()
    );
    assert_eq!(
        output(protocol::decode(Message::Text(message), 4096).unwrap()),
        fixture(timed["output"])
    );
    for item in fixtures["invalidFrames"].array().unwrap() {
        let fields = item.object().unwrap();
        let result = protocol::decode(Message::Text(fields["wire"].string().unwrap()), 4096);
        assert_eq!(
            result.err().unwrap().to_string(),
            fields["error"].string().unwrap()
        );
    }
}

#[test]
fn streaming_updates_flush_clear_and_native_completions() {
    let data = Arc::new(Mutex::new(SocketData {
        automatic: true,
        ..Default::default()
    }));
    let trace = Arc::default();
    let mut stream = native(
        source(vec![
            update(),
            Input::String("Hello".into()),
            flush(),
            clear(),
            Input::String("again".into()),
        ]),
        &data,
        &trace,
    );
    let outputs = collect(&mut stream).unwrap();
    assert_eq!(
        outputs,
        vec![
            value("[]"),
            Value::Binary(vec![0, 255, 128]),
            value(r#"{"event":"clear"}"#),
            Value::Binary(vec![0, 255, 128]),
            value(r#"{"event":"done","traceId":"native"}"#)
        ]
    );
    let sent: Vec<_> = data.lock().unwrap().sent.iter().map(|v| value(v)).collect();
    assert_eq!(
        sent,
        vec![
            value(r#"{"type":"session.update","replace":{}}"#),
            value(r#"{"type":"text.delta","delta":"Hello"}"#),
            value(r#"{"type":"text.done"}"#),
            value(r#"{"type":"text.clear"}"#),
            value(r#"{"type":"text.delta","delta":"again"}"#),
            value(r#"{"type":"text.done"}"#)
        ]
    );
    assert_eq!(*trace.lock().unwrap(), ["socket"]);
}

#[test]
fn replacement_echo_retains_native_order_and_last_value_for_duplicate_keys() {
    let item = protocol::decode(
        Message::Text(
            r#"{"type":"session.updated","replace":{"z":"first","a":"middle","\u007a":"last"}}"#
                .into(),
        ),
        4096,
    )
    .unwrap();
    assert_eq!(output(item), value(r#"[["z","last"],["a","middle"]]"#));
}

#[test]
fn bounded_json_strict_wire_and_sanitized_errors() {
    for (wire, expected) in [
        (
            r#"{"type":"error","message":"private text and key"}"#,
            "xAI reported a synthesis error",
        ),
        (
            r#"{"type":"audio.delta","delta":"AA==","audio_duration":1e999}"#,
            "Invalid xAI audio duration",
        ),
        (
            r#"{"type":"audio.delta","delta":"AA==","audio_timestamps":{"graph_chars":["a"],"graph_times":[[2,1]]}}"#,
            "Invalid xAI character timestamp interval",
        ),
        (
            r#"{"type":"audio.done","ignored":"\ud800"}"#,
            "Invalid xAI JSON",
        ),
        (
            r#"{"type":"session.updated","replace":{"a":null}}"#,
            "xAI session.updated event has no valid replacement map",
        ),
    ] {
        assert_eq!(
            protocol::decode(Message::Text(wire.into()), 4096)
                .err()
                .unwrap()
                .to_string(),
            expected
        );
    }
    assert_eq!(
        protocol::decode(Message::Binary(vec![]), 4096)
            .err()
            .unwrap()
            .to_string(),
        "xAI returned a non-text WebSocket message"
    );
    assert_eq!(
        protocol::decode(Message::Text("{}".into()), 1)
            .err()
            .unwrap()
            .to_string(),
        "xAI message exceeds max_message_bytes"
    );
    let mut stream = Stream::http(source(vec![b"{}".to_vec()]), true, 1);
    assert_eq!(
        next(&mut stream).unwrap().err().unwrap().to_string(),
        "xAI response exceeds max_response_bytes"
    );
    assert!(next(&mut stream).is_none());
    let mut stream = Stream::http(source(vec![]), false, 1);
    assert_eq!(
        next(&mut stream).unwrap().err().unwrap().to_string(),
        "xAI returned no audio bytes"
    );
}

#[test]
fn discovery_preserves_language_states_and_escapes_custom_id_as_one_component() {
    let http = http(br#"{"voices":[{"voice_id":"a","name":"A"},{"voice_id":"b","name":"B","language":null},{"voice_id":"c","name":"C","language":"en"}]}"#.to_vec(), "application/json");
    let voices = ready(voices(VoiceOptions {
        auth: Some(&auth()),
        transport: Some(&http),
        ..Default::default()
    }))
    .unwrap();
    assert_eq!(voices.len(), 3);
    assert!(voices[0].language.is_none());
    assert!(matches!(voices[1].language, Some(VoiceLanguage::Null(_))));
    assert!(matches!(&voices[2].language,Some(VoiceLanguage::String(v)) if v == "en"));
    assert_eq!(
        http.requests.lock().unwrap()[0].url,
        "https://api.x.ai/v1/tts/voices"
    );
    let http = self::http(
        br#"{"voice_id":"custom","name":"Custom"}"#.to_vec(),
        "application/json",
    );
    let voice = ready(voice(
        "../custom?#雪",
        VoiceOptions {
            auth: Some(&auth()),
            transport: Some(&http),
            base_url: Some("https://proxy.test/a%2Fb/?tenant=x%20y"),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(voice.voice_id, "custom");
    assert_eq!(voice.name, "Custom");
    let requests = http.requests.lock().unwrap();
    assert_eq!(
        requests[0].url,
        "https://proxy.test/a%2Fb/v1/tts/voices/%2E%2E%2Fcustom%3F%23%E9%9B%AA?tenant=x%20y"
    );
    assert_eq!(requests[0].method, "GET");
    assert_eq!(requests[0].body, []);
}
