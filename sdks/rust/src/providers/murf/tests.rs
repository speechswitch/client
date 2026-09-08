use super::*;
use crate::{
    generated::{auth::AuthAsync, murf::*, murf_output::*},
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
mod socket_tests;

#[derive(Default)]
struct Counts {
    reads: AtomicUsize,
    drops: AtomicUsize,
    wakes: AtomicUsize,
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
    Raw::parse(include_str!("../../../../fixtures/murf.json"))
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
        minimax: None,
        mistral: None,
        murf: Some(AuthAsync {
            api_key: Some("test-key".into()),
        }),
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
fn request() -> TtsRequestTextVoice {
    TtsRequestTextVoice {
        language: None,
        model: None,
        output: None,
        pitch_bias: None,
        speed_bias: None,
        text: "Hello".into(),
        voice: "existing-voice".into(),
        voice_style: None,
    }
}
fn gen2() -> TtsRequestGen2TextVoiceca621e19 {
    TtsRequestGen2TextVoiceca621e19 {
        audio_retention: None,
        delivery_variance: None,
        input_type: None,
        language: None,
        model: Default::default(),
        output: None,
        pitch_bias: None,
        speed_bias: None,
        target_duration_ms: None,
        text: "Hello".into(),
        timestamp_granularity: None,
        timestamp_text: None,
        voice: "existing-voice".into(),
        voice_style: None,
    }
}
fn streaming(input: StreamingInput<Input>) -> TtsRequest {
    TtsRequest::StreamingTextVoice(TtsRequestStreamingTextVoice {
        language: None,
        max_buffer_delay_ms: None,
        model: None,
        output: None,
        pitch_bias: None,
        speed_bias: None,
        text: input,
        text_buffer_threshold: None,
        voice: "existing-voice".into(),
        voice_style: None,
    })
}
fn clear() -> Input {
    Input::Clear(TtsRequestStreamingTextVoiceTextItemClear {
        command: Default::default(),
    })
}
fn flush() -> Input {
    Input::Flush(TtsRequestStreamingTextVoiceTextItemFlush {
        command: Default::default(),
    })
}
struct Http {
    requests: Mutex<Vec<HttpRequest>>,
    responses: Mutex<VecDeque<HttpResponse>>,
}
impl HttpTransport for Http {
    fn send(
        &self,
        request: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        Box::pin(async move {
            self.requests.lock().unwrap().push(request);
            Ok(self
                .responses
                .lock()
                .unwrap()
                .pop_front()
                .expect("unexpected HTTP request"))
        })
    }
}
fn http(status: u16, data: Vec<u8>) -> Http {
    Http {
        requests: Mutex::default(),
        responses: Mutex::new(VecDeque::from([HttpResponse {
            status,
            headers: vec![],
            body: source(vec![data]),
        }])),
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
    stall: Option<&'static str>,
    flush_error: Option<&'static str>,
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
fn operation(fields: &BTreeMap<String, Raw<'_>>) -> &'static str {
    if fields.contains_key("clear") {
        "clear"
    } else if fields.contains_key("end") {
        "end"
    } else if fields.contains_key("text") {
        "text"
    } else if fields.contains_key("context_id") {
        "update"
    } else {
        "config"
    }
}
impl WebSocketLike for TestSocket {
    fn start_send(self: Pin<&mut Self>, message: Message) -> Result<(), TransportError> {
        let Message::Text(text) = message else {
            panic!("JSON expected")
        };
        let fields = Raw::parse(&text).unwrap().object().unwrap();
        let mut s = self.0.lock().unwrap();
        assert!(!s.pending, "overlapping writes");
        s.pending = true;
        if s.auto {
            match operation(&fields) {
                "text" => s.incoming.push_back(Ok(Message::Text(format!(
                    "{{\"context_id\":{},\"audio\":\"AP+A\"}}",
                    fields["context_id"].text()
                )))),
                "end" => s.incoming.push_back(Ok(Message::Text(format!(
                    "{{\"context_id\":{},\"final\":true}}",
                    fields["context_id"].text()
                )))),
                "clear" => s.incoming.push_back(Ok(Message::Text(format!(
                    "{{\"context_id\":{},\"audio\":\"3q0=\",\"final\":true}}",
                    fields["context_id"].text()
                )))),
                _ => {}
            }
        }
        s.sent.push(text);
        Ok(())
    }
    fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Result<(), TransportError>> {
        let mut s = self.0.lock().unwrap();
        let op = operation(
            &Raw::parse(s.sent.last().unwrap())
                .unwrap()
                .object()
                .unwrap(),
        );
        if s.stall == Some(op) {
            return Poll::Pending;
        }
        if s.flush_error == Some(op) {
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
    let s = Arc::new(Mutex::new(SocketState {
        auto,
        ..Default::default()
    }));
    (Box::pin(TestSocket(s.clone())), s)
}
fn marks(marks: Vec<MurfTimestamp>) -> Value {
    Value::Array(
        marks
            .into_iter()
            .map(|m| {
                Value::Map(BTreeMap::from([
                    ("kind".into(), Value::String(m.kind.value().into())),
                    ("value".into(), Value::String(m.value)),
                    ("startTimeMs".into(), Value::Number(m.start_time_ms)),
                    ("endTimeMs".into(), Value::Number(m.end_time_ms)),
                ]))
            })
            .collect(),
    )
}
