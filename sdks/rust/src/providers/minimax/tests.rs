use super::*;
use crate::{
    generated::{auth::AuthAsync, minimax::*, minimax_output::*},
    http::HttpResponse,
    json::Raw,
    msgpack::{tests::fixture, Value},
    runtime::StreamingInput,
    websocket::{Message, WebSocketLike},
};
use std::{
    collections::{BTreeMap, VecDeque},
    future::{poll_fn, Future},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    task::{Wake, Waker},
};
mod boundary;
mod http_tests;
mod models;
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
    panic!("did not complete")
}
fn next(stream: &mut Stream<'_>) -> Option<Result<SynthesisItem, TransportError>> {
    ready(poll_fn(|cx| Pin::new(&mut *stream).poll_next(cx)))
}
fn fixtures() -> BTreeMap<String, Raw<'static>> {
    Raw::parse(include_str!("../../../../fixtures/minimax.json"))
        .unwrap()
        .object()
        .unwrap()
}
fn encoded(value: &JsonValue) -> String {
    let mut s = String::new();
    json::write(value, &mut s).unwrap();
    s
}
fn value(text: &str) -> Value {
    fixture(Raw::parse(text).unwrap())
}
fn entropy(bytes: &mut [u8]) -> Result<(), TransportError> {
    for (i, b) in bytes.iter_mut().enumerate() {
        *b = i as u8;
    }
    Ok(())
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
        minimax: Some(AuthAsync {
            api_key: Some("test-key".into()),
        }),
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
fn request() -> TtsRequestTextVoice9b47fc40 {
    TtsRequestTextVoice9b47fc40 {
        emotion: None,
        language: None,
        model: None,
        output: None,
        pitch_bias: None,
        replacements: None,
        speed: None,
        text: "Hello".into(),
        text_normalization: None,
        timestamp_delivery: None,
        timestamp_granularity: None,
        voice: "existing-voice".into(),
        volume_scale: None,
    }
}
fn streaming(input: StreamingInput<Input>) -> TtsRequestStreamingTextVoice9e2e17ce {
    TtsRequestStreamingTextVoice9e2e17ce {
        emotion: None,
        language: None,
        language_text_normalization: None,
        model: None,
        output: None,
        pitch_bias: None,
        replacements: None,
        speed: None,
        split_turns: None,
        text: input,
        voice: "existing-voice".into(),
        volume_scale: None,
    }
}

#[derive(Default)]
struct SocketState {
    sent: Vec<String>,
    incoming: VecDeque<Result<Message, TransportError>>,
    drops: usize,
    auto: bool,
    closed: bool,
    pending: bool,
    stall: Option<String>,
    flush_error: Option<String>,
    cancel_ack: bool,
    trace: Arc<Mutex<Vec<&'static str>>>,
}
struct TestSocket(Arc<Mutex<SocketState>>);
impl Drop for TestSocket {
    fn drop(&mut self) {
        let mut s = self.0.lock().unwrap();
        s.drops += 1;
        s.trace.lock().unwrap().push("socket");
    }
}
impl WebSocketLike for TestSocket {
    fn start_send(self: Pin<&mut Self>, message: Message) -> Result<(), TransportError> {
        let Message::Text(text) = message else {
            panic!("JSON expected")
        };
        let fields = Raw::parse(&text).unwrap().object().unwrap();
        let event = fields["event"].string().unwrap();
        let mut s = self.0.lock().unwrap();
        assert!(!s.pending, "overlapping writes");
        s.pending = true;
        match event.as_str() {
   "task_start" if s.auto=>s.incoming.push_back(Ok(Message::Text(format!("{{\"event\":\"task_started\",\"session_id\":{}}}",fields["session_id"].text())))),
   "task_continue" if s.auto=>s.incoming.push_back(Ok(Message::Text(r#"{"event":"task_continued","trace_id":"trace","data":{"audio":"00ff"},"is_final":true}"#.into()))),
   "task_flush" if s.auto=>s.incoming.push_back(Ok(Message::Text(r#"{"event":"task_flushed","trace_id":"flushed"}"#.into()))),
   "task_cancel" if s.auto && s.cancel_ack=>{s.incoming.push_back(Ok(Message::Text(r#"{"data":{"audio":"dead"}}"#.into())));s.incoming.push_back(Ok(Message::Text(r#"{"event":"task_canceled"}"#.into())));},
   "task_finish" if s.auto=>s.incoming.push_back(Ok(Message::Text(r#"{"event":"task_finished","trace_id":"finished"}"#.into()))),
   _=>{}
  }
        s.sent.push(text);
        Ok(())
    }
    fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Result<(), TransportError>> {
        let mut s = self.0.lock().unwrap();
        let event = s.sent.last().map(|v| {
            Raw::parse(v).unwrap().object().unwrap()["event"]
                .string()
                .unwrap()
        });
        if s.stall == event && s.stall.is_some() {
            return Poll::Pending;
        }
        if s.flush_error == event && s.flush_error.is_some() {
            return Poll::Ready(Err(failure("write failure")));
        }
        s.pending = false;
        Poll::Ready(Ok(()))
    }
    fn poll_receive(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
    ) -> Poll<Option<Result<Message, TransportError>>> {
        let mut s = self.0.lock().unwrap();
        match s.incoming.pop_front() {
            Some(v) => Poll::Ready(Some(v)),
            None if s.closed => Poll::Ready(None),
            None => Poll::Pending,
        }
    }
}
fn socket(auto: bool) -> (Socket, Arc<Mutex<SocketState>>) {
    let state = Arc::new(Mutex::new(SocketState {
        auto,
        cancel_ack: true,
        incoming: VecDeque::from([Ok(Message::Text(
            r#"{"event":"connected_success","connect_id":"connection"}"#.into(),
        ))]),
        ..Default::default()
    }));
    (Box::pin(TestSocket(state.clone())), state)
}
struct Http {
    requests: Mutex<Vec<HttpRequest>>,
    responses: Mutex<VecDeque<HttpResponse>>,
}
impl HttpTransport for Http {
    fn send(
        &self,
        r: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        Box::pin(async move {
            self.requests.lock().unwrap().push(r);
            Ok(self
                .responses
                .lock()
                .unwrap()
                .pop_front()
                .expect("unexpected HTTP request"))
        })
    }
}
fn http(status: u16, sse: bool, data: &str) -> Http {
    Http {
        requests: Mutex::default(),
        responses: Mutex::new(VecDeque::from([HttpResponse {
            status,
            headers: if sse {
                vec![("Content-Type".into(), "text/event-stream".into())]
            } else {
                vec![]
            },
            body: source(vec![data.as_bytes().to_vec()]),
        }])),
    }
}
fn marks(marks: Vec<MiniMaxTimestamp>) -> Value {
    Value::Array(
        marks
            .into_iter()
            .map(|m| {
                assert!(m.source.is_none());
                Value::Map(BTreeMap::from([
                    ("kind".into(), Value::String(m.kind.value().into())),
                    ("value".into(), Value::String(m.value)),
                    ("startTimeMs".into(), Value::Number(m.start_time_ms)),
                    ("endTimeMs".into(), Value::Number(m.end_time_ms.unwrap())),
                ]))
            })
            .collect(),
    )
}
fn usage(u: Usage) -> Value {
    let mut f = BTreeMap::new();
    for (k, v) in [
        ("durationMs", u.duration_ms),
        ("sampleRateHz", u.sample_rate_hz),
        ("byteLength", u.byte_length),
        ("bitRateBps", u.bit_rate_bps),
        ("channelCount", u.channel_count),
        ("billedCharacters", u.billed_characters),
        ("wordCount", u.word_count),
        ("invalidCharacterRatio", u.invalid_character_ratio),
    ] {
        if let Some(v) = v {
            f.insert(k.into(), Value::Number(v));
        }
    }
    if let Some(v) = u.format {
        f.insert("format".into(), Value::String(v));
    }
    Value::Map(f)
}
