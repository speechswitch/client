use super::*;
use crate::{
    generated::{auth::AuthCartesia, inworld::*, inworld_output::*},
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
        inworld: Some(AuthCartesia {
            api_key: Some("test-key".into()),
            access_token: None,
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
    automatic: bool,
    defer_created: bool,
    stall_on: Option<&'static str>,
    extra_create: Vec<Message>,
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
        let fields = Raw::parse_exact(&text).unwrap().object().unwrap();
        let mut w = self.0.lock().unwrap();
        if w.automatic {
            let id = fields["contextId"].string().unwrap();
            if fields.contains_key("create") && !w.defer_created {
                w.incoming
                    .push_back(Some(Ok(event(&id, "contextCreated", "{}"))));
                for message in std::mem::take(&mut w.extra_create) {
                    w.incoming.push_back(Some(Ok(message)));
                }
            }
            if fields.contains_key("send_text") {
                if w.defer_created {
                    w.defer_created = false;
                    w.incoming
                        .push_back(Some(Ok(event(&id, "contextCreated", "{}"))));
                }
                w.incoming.push_back(Some(Ok(event(
                    &id,
                    "audioChunk",
                    r#"{"audioContent":"AP8="}"#,
                ))));
            }
            if fields.contains_key("flush_context") {
                w.incoming
                    .push_back(Some(Ok(event(&id, "flushCompleted", "{}"))));
            }
            if fields.contains_key("close_context") {
                w.incoming
                    .push_back(Some(Ok(event(&id, "contextClosed", "{}"))));
            }
        }
        if w.stall_on.is_some_and(|k| fields.contains_key(k)) {
            w.writing = true;
        }
        w.sent.push(text);
        Ok(())
    }
    fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Result<(), TransportError>> {
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
            Some(v) => Poll::Ready(v),
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

fn event(id: &str, kind: &str, body: &str) -> Message {
    let mut quoted = String::new();
    json::quote(id, &mut quoted);
    Message::Text(format!(
        r#"{{"result":{{"contextId":{quoted},"{kind}":{body}}}}}"#
    ))
}
fn fixtures() -> BTreeMap<String, Raw<'static>> {
    Raw::parse_exact(include_str!("../../../../fixtures/inworld.json"))
        .unwrap()
        .object()
        .unwrap()
}
fn request() -> TtsRequestInworldTts2TextVoice {
    TtsRequestInworldTts2TextVoice {
        model: Default::default(),
        text: "Hello".into(),
        voice: "custom-voice".into(),
        output: TtsRequestTextVoiceOutput::Pcm(TtsRequestTextVoiceOutputPcm {
            format: Default::default(),
            sample_rate_hz: None,
            sample_encoding: None,
            byte_order: None,
        }),
        audio_enhancement: None,
        context_before: None,
        delivery_mode: None,
        instructions: None,
        language: None,
        speed: None,
        text_normalization: None,
        timestamp_delivery: None,
        timestamp_granularity: None,
    }
}
fn streaming(input: StreamingInput<Input>) -> TtsRequestInworldTts2StreamingTextVoice {
    TtsRequestInworldTts2StreamingTextVoice {
        model: Default::default(),
        text: input,
        voice: "custom-voice".into(),
        output: TtsRequestStreamingTextVoiceOutput::Pcm(TtsRequestTextVoiceOutputPcm {
            format: Default::default(),
            sample_rate_hz: None,
            sample_encoding: None,
            byte_order: None,
        }),
        automatic_text_flushing: None,
        delivery_mode: None,
        language: None,
        speed: None,
        text_buffer_threshold: None,
        text_flush_delay_ms: None,
        text_normalization: None,
        timestamp_delivery: None,
        timestamp_granularity: None,
    }
}
fn normalized(item: SynthesisItem) -> Value {
    let (correlation, id, audio, marks) = match item {
        SynthesisItem::Bytes(v) => return Value::Binary(v),
        SynthesisItem::Flush(v) => {
            return Value::Map(BTreeMap::from([
                ("event".into(), Value::String("flush".into())),
                ("correlationId".into(), Value::String(v.correlation_id)),
                (
                    "inputGroupId".into(),
                    Value::String(v.input_group_id.unwrap()),
                ),
            ]))
        }
        SynthesisItem::Chunk(v) => ("chunk", v.correlation_id, Some(v.audio), v.timestamps),
        SynthesisItem::Timeline(v) => ("timeline", v.correlation_id, v.audio, v.timestamps),
    };
    let marks = marks
        .into_iter()
        .map(|v| {
            let mut mark = BTreeMap::from([
                ("kind".into(), Value::String(v.kind.value().into())),
                ("value".into(), Value::String(v.value)),
                ("startTimeMs".into(), Value::Number(v.start_time_ms)),
            ]);
            if let Some(end) = v.end_time_ms {
                mark.insert("endTimeMs".into(), Value::Number(end));
            }
            if let Some(index) = v.word_index {
                mark.insert("wordIndex".into(), Value::Number(index));
            }
            Value::Map(mark)
        })
        .collect();
    let mut result = BTreeMap::from([
        ("correlation".into(), Value::String(correlation.into())),
        ("timestamps".into(), Value::Array(marks)),
    ]);
    if let Some(id) = id {
        result.insert("correlationId".into(), Value::String(id));
    }
    if let Some(audio) = audio {
        result.insert("audio".into(), Value::Binary(audio));
    }
    Value::Map(result)
}
