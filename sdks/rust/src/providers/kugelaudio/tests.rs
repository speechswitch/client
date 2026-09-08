use super::*;
use crate::{
    generated::{auth::AuthAsync, kugelaudio::*, kugelaudio_output::*},
    http::HttpResponse,
    msgpack::{tests::fixture, Value},
    runtime::{InputStream, StreamingInput},
    websocket::{Message, WebSocketLike},
};
use std::{
    collections::{BTreeMap, VecDeque},
    future::Future,
    pin::Pin,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    task::{Context, Poll, Wake, Waker},
};
mod boundary;
mod http_tests;
mod socket_tests;

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
struct Source<T> {
    values: VecDeque<Result<T, TransportError>>,
    counts: Arc<Counts>,
    stall: bool,
    trace: Arc<Mutex<Vec<&'static str>>>,
}
impl<T: Send + Unpin> InputStream<T> for Source<T> {
    fn poll_next(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
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
                "pending without wake"
            ),
        }
    }
    panic!("did not complete")
}
fn next(stream: &mut Stream) -> Option<Result<SynthesisItem, TransportError>> {
    ready(poll_fn(|cx| Pin::new(&mut *stream).poll_next(cx)))
}
fn collect(stream: &mut Stream) -> Result<Vec<Value>, TransportError> {
    let mut result = vec![];
    while let Some(v) = next(stream) {
        result.push(normalized(v?));
    }
    Ok(result)
}
fn auth() -> Auth {
    Auth {
        kugelaudio: Some(AuthAsync {
            api_key: Some("test-key".into()),
        }),
        vocu: None,
        voice_ai: None,
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
        xai: None,
    }
}
struct Http {
    requests: Mutex<Vec<HttpRequest>>,
    response: Mutex<Option<HttpResponse>>,
}
impl Http {
    fn new(status: u16, chunks: Vec<Vec<u8>>) -> Self {
        Self {
            requests: Mutex::new(vec![]),
            response: Mutex::new(Some(HttpResponse {
                status,
                headers: vec![],
                body: source(chunks),
            })),
        }
    }
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

#[derive(Default)]
struct Wire {
    sent: Vec<String>,
    incoming: VecDeque<Option<Result<Message, TransportError>>>,
    writing: bool,
    send_error: bool,
    flush_error: bool,
    automatic: bool,
    defer_turn: bool,
    defer_update: bool,
    stall_on: Option<&'static str>,
    closed: usize,
    trace: Arc<Mutex<Vec<&'static str>>>,
}
struct TestSocket(Arc<Mutex<Wire>>);
impl Drop for TestSocket {
    fn drop(&mut self) {
        let mut w = self.0.lock().unwrap();
        w.closed += 1;
        w.trace.lock().unwrap().push("socket");
    }
}
impl WebSocketLike for TestSocket {
    fn start_send(self: Pin<&mut Self>, message: Message) -> Result<(), TransportError> {
        let Message::Text(text) = message else {
            panic!("expected text")
        };
        let f = Raw::parse_exact(&text).unwrap().object().unwrap();
        let mut w = self.0.lock().unwrap();
        assert!(!w.writing, "send before previous flush");
        if w.send_error {
            return Err(failure("send failed"));
        }
        if w.automatic {
            if f.contains_key("text") {
                w.incoming
                    .push_back(Some(Ok(Message::Text(fixtures()["audio"].text().into()))));
                if f.contains_key("voice_id") {
                    if f["word_timestamps"].boolean().unwrap() {
                        w.incoming
                            .push_back(Some(Ok(Message::Text(fixtures()["word"].text().into()))));
                    }
                    w.incoming.push_back(Some(Ok(Message::Text(format!(
                        r#"{{"final":true,"usage":{}}}"#,
                        fixtures()["usage"].text()
                    )))));
                }
            }
            if f.contains_key("flush") && !w.defer_turn {
                w.incoming
                    .push_back(Some(Ok(Message::Text(r#"{"final":true}"#.into()))));
                w.incoming
                    .push_back(Some(Ok(Message::Text(r#"{"session_closed":true}"#.into()))));
            }
            if f.contains_key("cancel") {
                w.incoming
                    .push_back(Some(Ok(Message::Text(r#"{"interrupted":true}"#.into()))));
            }
            if let Some(settings) = f.get("update_settings").filter(|_| !w.defer_update) {
                w.incoming.push_back(Some(Ok(Message::Text(format!(
                    r#"{{"settings_updated":true,"settings":{}}}"#,
                    settings.text()
                )))));
            }
        }
        w.writing = w.stall_on.is_some_and(|k| f.contains_key(k));
        w.sent.push(text);
        Ok(())
    }
    fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Result<(), TransportError>> {
        if self.0.lock().unwrap().flush_error {
            return Poll::Ready(Err(failure("flush failed")));
        }
        if self.0.lock().unwrap().writing {
            Poll::Pending
        } else {
            Poll::Ready(Ok(()))
        }
    }
    fn poll_receive(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
    ) -> Poll<Option<Result<Message, TransportError>>> {
        match self.0.lock().unwrap().incoming.pop_front() {
            Some(value) => Poll::Ready(value),
            None => Poll::Pending,
        }
    }
}
fn socket(automatic: bool) -> (Socket, Arc<Mutex<Wire>>) {
    let wire = Arc::new(Mutex::new(Wire {
        automatic,
        ..Default::default()
    }));
    (Box::pin(TestSocket(wire.clone())), wire)
}
fn fixtures() -> BTreeMap<String, Raw<'static>> {
    Raw::parse_exact(include_str!("../../../../fixtures/kugelaudio.json"))
        .unwrap()
        .object()
        .unwrap()
}
fn value(text: &str) -> Value {
    fixture(Raw::parse_exact(text).unwrap())
}
fn sent(wire: &Arc<Mutex<Wire>>) -> Vec<Value> {
    wire.lock().unwrap().sent.iter().map(|v| value(v)).collect()
}
fn request() -> TtsRequestTextVoice {
    TtsRequestTextVoice {
        text: "Hi".into(),
        voice: TtsRequestTextVoiceVoice::String("existing-custom-voice".into()),
        output: TtsRequestTextVoiceOutput::Pcm(TtsRequestTextVoiceOutputPcm {
            format: Default::default(),
            sample_rate_hz: None,
            sample_encoding: None,
            byte_order: None,
        }),
        model: None,
        language: None,
        max_audio_tokens: None,
        speed: None,
        temperature: None,
        pronunciation_dictionary_selection: None,
        text_normalization: None,
        timestamp_delivery: None,
        timestamp_granularity: None,
        timestamp_text: None,
        voice_boost: None,
        voice_guidance: None,
    }
}
fn streaming(text: StreamingInput<Input>) -> TtsRequestStreamingTextVoice {
    let r = request();
    TtsRequestStreamingTextVoice {
        text,
        voice: r.voice,
        output: r.output,
        model: None,
        language: None,
        max_audio_tokens: None,
        speed: None,
        temperature: None,
        pronunciation_dictionary_selection: None,
        text_normalization: None,
        timestamp_delivery: None,
        timestamp_granularity: None,
        timestamp_text: None,
        voice_boost: None,
        voice_guidance: None,
        text_buffer_threshold: None,
        text_flush_delay_ms: None,
    }
}
fn flush() -> Input {
    Input::Flush(TtsRequestStreamingTextVoiceTextItemFlush {
        command: Default::default(),
    })
}
fn clear() -> Input {
    Input::Clear(TtsRequestStreamingTextVoiceTextItemClear {
        command: Default::default(),
    })
}
fn update() -> TtsRequestStreamingTextVoiceTextItemUpdate {
    TtsRequestStreamingTextVoiceTextItemUpdate {
        command: Default::default(),
        language: None,
        max_audio_tokens: None,
        speed: None,
        temperature: None,
        text_normalization: None,
        voice_guidance: None,
    }
}
fn live_settings() -> Value {
    let Value::Map(mut m) = fixture(fixtures()["settings"]) else {
        unreachable!()
    };
    m.extend([
        ("word_timestamps".into(), Value::Bool(false)),
        ("speaker_prefix".into(), Value::Bool(true)),
        ("flush_timeout_ms".into(), Value::Number(500.0)),
        ("max_buffer_length".into(), Value::Number(10000.0)),
    ]);
    Value::Map(m)
}
fn billing(v: KugelAudioUsage) -> Value {
    let mut m = BTreeMap::from([
        ("audioSeconds".into(), Value::Number(v.audio_seconds)),
        ("characters".into(), Value::Number(v.characters)),
        (
            "costCents".into(),
            match v.cost_cents {
                KugelAudioUsageCostCents::Null(_) => Value::Nil,
                KugelAudioUsageCostCents::Number(n) => Value::Number(n),
            },
        ),
    ]);
    if let Some(c) = v.currency {
        m.insert("currency".into(), Value::String(c.value().into()));
    }
    if let Some(model) = v.model {
        m.insert("model".into(), Value::String(model));
    }
    Value::Map(m)
}
fn normalized(item: SynthesisItem) -> Value {
    let mut m = BTreeMap::new();
    match item {
        SynthesisItem::Bytes(v) => return Value::Binary(v),
        SynthesisItem::Clear(v) => {
            m.insert("event".into(), Value::String(v.event.value().into()));
        }
        SynthesisItem::Done(v) => {
            m.insert("event".into(), Value::String(v.event.value().into()));
            if let Some(u) = v.usage {
                m.insert("usage".into(), billing(u));
            }
        }
        SynthesisItem::Flush(v) => {
            m.insert("event".into(), Value::String(v.event.value().into()));
            m.insert("correlationId".into(), Value::String(v.correlation_id));
            m.insert("inputGroupId".into(), Value::String(v.input_group_id));
            if let Some(u) = v.usage {
                m.insert("usage".into(), billing(u));
            }
        }
        SynthesisItem::Updated(v) => {
            m.insert("event".into(), Value::String(v.event.value().into()));
            assert!(v.replacements.is_none());
            for (k, n) in [
                ("voiceGuidance", v.voice_guidance),
                ("temperature", v.temperature),
                ("maxAudioTokens", v.max_audio_tokens),
                ("speed", v.speed),
            ] {
                if let Some(n) = n {
                    m.insert(k.into(), Value::Number(n));
                }
            }
            if let Some(v) = v.language {
                m.insert("language".into(), Value::String(v));
            }
            if let Some(v) = v.text_normalization {
                m.insert("textNormalization".into(), Value::Bool(v.value()));
            }
        }
        SynthesisItem::Ordered(v) => {
            m.insert(
                "correlation".into(),
                Value::String(v.correlation.value().into()),
            );
            m.insert("correlationId".into(), Value::String(v.correlation_id));
            m.insert("inputGroupId".into(), Value::String(v.input_group_id));
            m.insert("chunkId".into(), Value::Number(v.chunk_id));
            if let Some(a) = v.audio {
                m.insert("audio".into(), Value::Binary(a));
            }
            if let Some(t) = v.audio_timing {
                m.insert(
                    "audioTiming".into(),
                    Value::Map(BTreeMap::from([
                        ("startTimeMs".into(), Value::Number(t.start_time_ms)),
                        ("endTimeMs".into(), Value::Number(t.end_time_ms)),
                    ])),
                );
            }
            m.insert(
                "timestamps".into(),
                Value::Array(
                    v.timestamps
                        .into_iter()
                        .map(|t| {
                            let mut m = BTreeMap::from([
                                ("kind".into(), Value::String(t.kind.value().into())),
                                ("value".into(), Value::String(t.value)),
                                ("startTimeMs".into(), Value::Number(t.start_time_ms)),
                            ]);
                            if let Some(e) = t.end_time_ms {
                                m.insert("endTimeMs".into(), Value::Number(e));
                            }
                            if let Some(c) = t.confidence {
                                m.insert("confidence".into(), Value::Number(c));
                            }
                            if let Some(s) = t.source {
                                m.insert(
                                    "source".into(),
                                    Value::Map(BTreeMap::from([
                                        ("start".into(), Value::Number(s.start)),
                                        ("end".into(), Value::Number(s.end)),
                                    ])),
                                );
                            }
                            Value::Map(m)
                        })
                        .collect(),
                ),
            );
        }
    }
    Value::Map(m)
}
