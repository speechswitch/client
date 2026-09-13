use super::*;
mod heartbeat;
mod lifecycle;
mod models;
use crate::{
    generated::{auth::AuthAsync, smallest_ai::*},
    http::HttpResponse,
    json::Raw,
    msgpack::{tests::fixture, Value},
    runtime::{InputStream, StreamingInput},
    websocket::{Message, WebSocketLike},
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
struct Data<T> {
    values: VecDeque<Result<T, TransportError>>,
    ended: bool,
}
struct Body<T> {
    data: Arc<Mutex<Data<T>>>,
    counts: Arc<Counts>,
}
impl<T: Send + Unpin> InputStream<T> for Body<T> {
    fn poll_next(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<T, TransportError>>> {
        self.counts.reads.fetch_add(1, Ordering::SeqCst);
        let mut data = self.data.lock().unwrap();
        if let Some(v) = data.values.pop_front() {
            Poll::Ready(Some(v))
        } else if data.ended {
            Poll::Ready(None)
        } else {
            *self.counts.waker.lock().unwrap() = Some(cx.waker().clone());
            Poll::Pending
        }
    }
}
impl<T> Drop for Body<T> {
    fn drop(&mut self) {
        self.counts.drops.fetch_add(1, Ordering::SeqCst);
    }
}
fn body<T: Send + Unpin + 'static>(
    values: Vec<Result<T, TransportError>>,
    ended: bool,
) -> (StreamingInput<T>, Arc<Counts>, Arc<Mutex<Data<T>>>) {
    let counts = Arc::new(Counts::default());
    let data = Arc::new(Mutex::new(Data {
        values: values.into(),
        ended,
    }));
    (
        Box::pin(Body {
            counts: counts.clone(),
            data: data.clone(),
        }),
        counts,
        data,
    )
}
fn ready<F: Future>(future: F) -> F::Output {
    let waker = Waker::from(Arc::new(Counts::default()));
    let mut cx = Context::from_waker(&waker);
    let mut future = Box::pin(future);
    for _ in 0..100000 {
        if let Poll::Ready(value) = future.as_mut().poll(&mut cx) {
            return value;
        }
    }
    panic!("future stayed pending")
}
fn pull(stream: &mut Stream) -> Option<Result<SynthesisItem, TransportError>> {
    let waker = Waker::from(Arc::new(Counts::default()));
    let mut cx = Context::from_waker(&waker);
    for _ in 0..100000 {
        if let Poll::Ready(value) = Pin::new(&mut *stream).poll_next(&mut cx) {
            return value;
        }
    }
    panic!("stream stayed pending")
}
fn tick(stream: &mut Stream) {
    let waker = Waker::from(Arc::new(Counts::default()));
    let mut cx = Context::from_waker(&waker);
    assert!(Pin::new(stream).poll_next(&mut cx).is_pending())
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
        smallest_ai: Some(AuthAsync {
            api_key: Some("fixture".into()),
        }),
        rime: None,
        typecast: None,
        vocu: None,
        voice_ai: None,
        xai: None,
    }
}
fn request() -> TtsRequestLightningV31TextVoice5e2ae2e5 {
    TtsRequestLightningV31TextVoice5e2ae2e5 {
        content_retention_days: None,
        formula_reading: None,
        language: None,
        model: Default::default(),
        number_pronunciation_language: None,
        output: None,
        pronunciation_dictionaries: None,
        request_id: None,
        session_id: None,
        speed: None,
        text: "Hello".into(),
        voice: "custom-uuid".into(),
    }
}
fn whole() -> TtsRequest {
    TtsRequest::LightningV31TextVoice5e2ae2e5(request())
}
fn streaming(text: StreamingInput<String>) -> TtsRequest {
    TtsRequest::LightningV31StreamingTextVoiced272850b(
        TtsRequestLightningV31StreamingTextVoiced272850b {
            completion_delay_ms: None,
            content_retention_days: None,
            formula_reading: None,
            language: None,
            max_buffer_delay_ms: None,
            model: Default::default(),
            number_pronunciation_language: None,
            output: None,
            request_id: None,
            session_id: None,
            speed: None,
            text,
            voice: "custom-uuid".into(),
        },
    )
}
type Input = TtsRequestLightningV31ProStreamingTextVoice8f1b36fbTextItem;
fn continuation(text: StreamingInput<Input>) -> TtsRequest {
    TtsRequest::LightningV31StreamingTextVoicebf9ab904(
        TtsRequestLightningV31StreamingTextVoicebf9ab904 {
            continuation: TtsRequestLightningV31ProStreamingTextVoice8f1b36fbContinuation {
                id: "context".into(),
                max_buffer_delay_ms: None,
            },
            content_retention_days: None,
            formula_reading: None,
            language: None,
            model: Default::default(),
            number_pronunciation_language: None,
            output: None,
            request_id: None,
            session_id: None,
            speed: None,
            text,
            voice: "custom-uuid".into(),
        },
    )
}
fn value(text: &str) -> Value {
    fixture(Raw::parse_exact(text).unwrap())
}
#[derive(Debug, PartialEq)]
enum Item {
    Bytes(Vec<u8>),
    Envelope(
        String,
        Option<Vec<u8>>,
        Vec<(String, f64, Option<f64>)>,
        Option<f64>,
    ),
    Clear,
    Batch(String),
    Done,
}
fn item(value: SynthesisItem) -> Item {
    match value {
        SynthesisItem::Bytes(v) => Item::Bytes(v),
        SynthesisItem::Ordered(v) => {
            assert_eq!(v.correlation.value(), "ordered");
            Item::Envelope(
                v.correlation_id,
                v.audio,
                v.timestamps
                    .into_iter()
                    .map(|v| {
                        assert_eq!(v.kind.value(), "word");
                        assert!(v.source.is_none());
                        (v.value, v.start_time_ms, v.end_time_ms)
                    })
                    .collect(),
                v.word_index,
            )
        }
        SynthesisItem::Clear(v) => {
            assert_eq!(v.event.value(), "clear");
            Item::Clear
        }
        SynthesisItem::Batch(v) => {
            assert_eq!(v.event.value(), "batch");
            Item::Batch(v.request_id)
        }
        SynthesisItem::Done(v) => {
            assert_eq!(v.event.value(), "done");
            Item::Done
        }
    }
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
        Box::pin(async move {
            self.requests.lock().unwrap().push(request);
            Ok(self.response.lock().unwrap().take().unwrap())
        })
    }
}
fn http(chunks: Vec<Vec<u8>>) -> (Http, Arc<Counts>) {
    let (body, counts, _) = body(chunks.into_iter().map(Ok).collect(), true);
    (
        Http {
            response: Mutex::new(Some(HttpResponse {
                status: 200,
                headers: vec![],
                body,
            })),
            requests: Mutex::new(vec![]),
        },
        counts,
    )
}
const FIXTURES: &str = include_str!("../../../../fixtures/smallest.json");
struct SocketState {
    sent: Vec<String>,
    replies: VecDeque<Result<Message, TransportError>>,
    automatic: bool,
    flush_pending: bool,
    block_final: bool,
    closed: bool,
    drops: usize,
    failure: Option<TransportError>,
    flush_failure: Option<TransportError>,
    read_waker: Option<Waker>,
    write_waker: Option<Waker>,
}
struct MockSocket(Arc<Mutex<SocketState>>);
impl Drop for MockSocket {
    fn drop(&mut self) {
        self.0.lock().unwrap().drops += 1;
    }
}
impl WebSocketLike for MockSocket {
    fn start_send(self: Pin<&mut Self>, message: Message) -> Result<(), TransportError> {
        let Message::Text(text) = message else {
            panic!("binary send")
        };
        let mut s = self.0.lock().unwrap();
        if let Some(error) = s.failure.take() {
            return Err(error);
        }
        if s.block_final {
            let object = Raw::parse_exact(&text).unwrap().object().unwrap();
            if object.get("continue").and_then(|v| v.boolean().ok()) == Some(false) {
                s.flush_pending = true;
            }
        }
        if s.automatic {
            let object = Raw::parse_exact(&text).unwrap().object().unwrap();
            let spoken = object
                .get("text")
                .and_then(|v| v.string().ok())
                .is_some_and(|v| !v.is_empty());
            if spoken {
                s.replies.push_back(Ok(Message::Text(CHUNK.into())));
            }
            let continued = object.get("continue").and_then(|v| v.boolean().ok());
            if continued == Some(false) || spoken && continued.is_none() {
                s.replies.push_back(Ok(Message::Text(COMPLETE.into())));
            }
        }
        s.sent.push(text);
        Ok(())
    }
    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), TransportError>> {
        let mut s = self.0.lock().unwrap();
        if let Some(error) = s.flush_failure.take() {
            return Poll::Ready(Err(error));
        }
        if s.flush_pending {
            s.write_waker = Some(cx.waker().clone());
            Poll::Pending
        } else {
            Poll::Ready(Ok(()))
        }
    }
    fn poll_receive(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Message, TransportError>>> {
        let mut s = self.0.lock().unwrap();
        if let Some(v) = s.replies.pop_front() {
            Poll::Ready(Some(v))
        } else if s.closed {
            Poll::Ready(None)
        } else {
            s.read_waker = Some(cx.waker().clone());
            Poll::Pending
        }
    }
}
fn socket(automatic: bool) -> (Socket, Arc<Mutex<SocketState>>) {
    let state = Arc::new(Mutex::new(SocketState {
        sent: vec![],
        replies: VecDeque::new(),
        automatic,
        flush_pending: false,
        block_final: false,
        closed: false,
        drops: 0,
        failure: None,
        flush_failure: None,
        read_waker: None,
        write_waker: None,
    }));
    (Box::pin(MockSocket(state.clone())), state)
}
fn entropy(bytes: &mut [u8]) -> Result<(), TransportError> {
    for (i, b) in bytes.iter_mut().enumerate() {
        *b = i as u8;
    }
    Ok(())
}
fn live(request: TtsRequest, socket: Socket) -> Stream {
    let auth = auth();
    ready(synthesize(
        request,
        Options {
            auth: Some(&auth),
            web_socket: Some(socket),
            entropy: Some(&entropy),
            ..Default::default()
        },
    ))
    .unwrap()
}
fn text(value: &str) -> Input {
    Input::String(value.into())
}
fn clear() -> Input {
    Input::Clear(
        TtsRequestLightningV31ProStreamingTextVoice8f1b36fbTextItemClear {
            command: Default::default(),
        },
    )
}
fn sent(stream: &mut Stream, socket: &Arc<Mutex<SocketState>>, count: usize) -> String {
    for _ in 0..1000 {
        if socket.lock().unwrap().sent.len() >= count {
            return socket.lock().unwrap().sent[count - 1].clone();
        }
        tick(stream);
    }
    panic!("send not reached");
}
fn packet(socket: &Arc<Mutex<SocketState>>, wire: &str) {
    socket
        .lock()
        .unwrap()
        .replies
        .push_back(Ok(Message::Text(wire.into())));
}
const CHUNK: &str = r#"{"status":"chunk","request_id":"native","data":{"audio":"AP+A"}}"#;
const COMPLETE: &str = r#"{"status":"complete","request_id":"native"}"#;
fn collect(stream: &mut Stream) -> Result<Vec<Item>, TransportError> {
    let mut items = vec![];
    while let Some(value) = pull(stream) {
        items.push(item(value?));
    }
    Ok(items)
}
