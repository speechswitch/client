use super::*;
use crate::{
    generated::{auth::AuthAsync, voice_ai::*, voice_ai_output::*},
    http::HttpResponse,
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
mod models;

#[derive(Default)]
struct Counts {
    reads: AtomicUsize,
    drops: AtomicUsize,
    wakes: AtomicUsize,
    waiting: Mutex<Option<Waker>>,
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
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<T, TransportError>>> {
        let s = self.get_mut();
        s.counts.reads.fetch_add(1, Ordering::SeqCst);
        match s.values.pop_front() {
            Some(v) => Poll::Ready(Some(v)),
            None if s.stall => {
                *s.counts.waiting.lock().unwrap() = Some(cx.waker().clone());
                Poll::Pending
            }
            None => Poll::Ready(None),
        }
    }
}
impl<T> Drop for Source<T> {
    fn drop(&mut self) {
        self.counts.waiting.lock().unwrap().take();
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
fn collect(stream: &mut Stream) -> Result<Vec<Value>, TransportError> {
    let mut items = vec![];
    while let Some(item) = next(stream) {
        items.push(output(item?));
    }
    Ok(items)
}
fn value(text: &str) -> Value {
    fixture(Raw::parse_exact(text).unwrap())
}
fn output(item: SynthesisItem) -> Value {
    match item {
        SynthesisItem::Bytes(v) => Value::Binary(v),
        SynthesisItem::Ordered(v) => {
            assert_eq!(v.correlation.value(), "ordered");
            assert_eq!(v.timestamps, []);
            Value::Array(vec![
                Value::String("audio".into()),
                Value::String(v.correlation_id),
                Value::Binary(v.audio),
            ])
        }
        SynthesisItem::Flush(v) => {
            assert_eq!(v.event.value(), "flush");
            assert_eq!(v.input_group_id, None);
            Value::Array(vec![
                Value::String("flush".into()),
                Value::String(v.correlation_id),
            ])
        }
        SynthesisItem::Clear(v) => {
            assert_eq!(v.event.value(), "clear");
            Value::String("clear".into())
        }
        SynthesisItem::Done(v) => {
            assert_eq!(v.event.value(), "done");
            assert_eq!(v.trace_id, None);
            Value::String("done".into())
        }
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
        mistral: None,
        murf: None,
        openai: None,
        resemble: None,
        respeecher: None,
        rime: None,
        smallest_ai: None,
        typecast: None,
        vocu: None,
        voice_ai: Some(AuthAsync {
            api_key: Some("fixture".into()),
        }),
        xai: None,
    }
}
fn request() -> TtsRequestObject1ec54d36 {
    TtsRequestObject1ec54d36 {
        api_version: None,
        audio_delivery: None,
        language: None,
        model: None,
        output: None,
        pronunciation_dictionaries: None,
        temperature: None,
        text: Text::String("Hello".into()),
        top_p: None,
        voice: None,
    }
}
fn live(input: StreamingInput<Input>) -> TtsRequest {
    let mut r = request();
    r.text = Text::AsyncIterable(input);
    TtsRequest::Object1ec54d36(r)
}
fn entropy(bytes: &mut [u8]) -> Result<(), TransportError> {
    for (i, b) in bytes.iter_mut().enumerate() {
        *b = i as u8;
    }
    Ok(())
}
const FIRST: &str = "000102030405060708090a0b0c0d0e0f:1";
const SECOND: &str = "000102030405060708090a0b0c0d0e0f:2";
fn flush() -> Input {
    Input::Flush(TtsRequestObject1ec54d36TextAsyncIterableItemFlush {
        command: Default::default(),
    })
}
fn clear() -> Input {
    Input::Clear(TtsRequestObject1ec54d36TextAsyncIterableItemClear {
        command: Default::default(),
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
#[derive(Default)]
struct SocketData {
    sent: Vec<String>,
    incoming: VecDeque<Result<Message, TransportError>>,
    block: bool,
    block_flush: bool,
    automatic: bool,
    closed: bool,
    flush_error: Option<TransportError>,
    waker: Option<Waker>,
}
impl SocketData {
    fn push(&mut self, text: String) {
        self.incoming.push_back(Ok(Message::Text(text)));
        if let Some(waker) = self.waker.take() {
            waker.wake();
        }
    }
    fn finish(&mut self, id: &str) {
        for text in [
            format!(r#"{{"context_id":"{id}","audio":"AP+A"}}"#),
            format!(r#"{{"context_id":"{id}","is_last":true}}"#),
            format!(r#"{{"context_id":"{id}","context_closed":true}}"#),
        ] {
            self.push(text)
        }
    }
}
struct TestSocket {
    data: Arc<Mutex<SocketData>>,
    counts: Arc<Counts>,
    trace: Arc<Mutex<Vec<&'static str>>>,
}
impl Drop for TestSocket {
    fn drop(&mut self) {
        self.counts.drops.fetch_add(1, Ordering::SeqCst);
        self.trace.lock().unwrap().push("socket");
    }
}
impl WebSocketLike for TestSocket {
    fn start_send(self: Pin<&mut Self>, message: Message) -> Result<(), TransportError> {
        let Message::Text(text) = message else {
            panic!("binary client message")
        };
        let fields = Raw::parse_exact(&text).unwrap().object().unwrap();
        let id = fields["context_id"].string().unwrap();
        let mut data = self.data.lock().unwrap();
        if fields.get("flush").is_some_and(|v| v.boolean().unwrap()) {
            if data.automatic {
                data.finish(&id)
            }
            if data.block_flush {
                data.block = true;
            }
        }
        if data.automatic
            && fields
                .get("close_context")
                .is_some_and(|v| v.boolean().unwrap())
        {
            data.push(format!(r#"{{"context_id":"{id}","context_closed":true}}"#));
        }
        data.sent.push(text);
        Ok(())
    }
    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), TransportError>> {
        let mut data = self.data.lock().unwrap();
        if data.block {
            data.waker = Some(cx.waker().clone());
            Poll::Pending
        } else {
            Poll::Ready(data.flush_error.take().map_or(Ok(()), Err))
        }
    }
    fn poll_receive(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Message, TransportError>>> {
        self.counts.reads.fetch_add(1, Ordering::SeqCst);
        let mut data = self.data.lock().unwrap();
        match data.incoming.pop_front() {
            Some(v) => Poll::Ready(Some(v)),
            None if data.closed => Poll::Ready(None),
            None => {
                data.waker = Some(cx.waker().clone());
                Poll::Pending
            }
        }
    }
}
fn socket(
    data: Arc<Mutex<SocketData>>,
    counts: Arc<Counts>,
    trace: Arc<Mutex<Vec<&'static str>>>,
) -> Socket {
    Box::pin(TestSocket {
        data,
        counts,
        trace,
    })
}
fn stream(request: TtsRequest, data: Arc<Mutex<SocketData>>) -> Stream {
    ready(synthesize(
        request,
        Options {
            auth: Some(&auth()),
            web_socket: Some(socket(data, Arc::default(), Arc::default())),
            entropy: Some(&entropy),
            ..Options::default()
        },
    ))
    .unwrap()
}

#[test]
fn shared_invalid_frames_and_sanitized_errors() {
    let root = Raw::parse_exact(include_str!("../../../../fixtures/voice_ai.json"))
        .unwrap()
        .object()
        .unwrap();
    for case in root["invalidFrames"].array().unwrap() {
        let c = case.object().unwrap();
        let error = protocol::decode(Message::Text(c["wire"].string().unwrap()), 4096)
            .err()
            .unwrap();
        assert_eq!(error.to_string(), c["error"].string().unwrap());
    }
    for (text, want) in [
        (
            r#"{"audio":"AA==","context_id":"\ud800"}"#,
            "Invalid Voice.ai JSON",
        ),
        (
            r#"{"audio":"AA\n==","context_id":"x"}"#,
            "Invalid Voice.ai base64 audio",
        ),
    ] {
        assert_eq!(
            protocol::decode(Message::Text(text.into()), 4096)
                .err()
                .unwrap()
                .to_string(),
            want
        )
    }
    assert_eq!(
        protocol::decode(Message::Binary(vec![0]), 4096)
            .err()
            .unwrap()
            .to_string(),
        "Voice.ai expected a JSON text frame"
    );
    assert_eq!(
        protocol::decode(Message::Text("{}".into()), 1)
            .err()
            .unwrap()
            .to_string(),
        "Voice.ai message exceeds MaxMessageBytes"
    );
    let err = protocol::decode(
        Message::Text(r#"{"error":"SECRET","context_id":"ctx"}"#.into()),
        4096,
    )
    .err()
    .unwrap();
    assert_eq!(err.to_string(), "Voice.ai reported a synthesis error");
    assert_eq!(
        err.downcast_ref::<Error>(),
        Some(&Error {
            status: None,
            context_id: Some("ctx".into())
        })
    );
}

#[test]
fn concurrent_contexts_keep_native_identity() {
    let data = Arc::new(Mutex::new(SocketData::default()));
    let mut stream = stream(
        live(source(vec![
            Input::String("first".into()),
            flush(),
            Input::String("second".into()),
            flush(),
        ])),
        data.clone(),
    );
    assert!(poll(&mut stream).is_pending());
    let mut state = data.lock().unwrap();
    assert_eq!(state.sent.len(), 4);
    state.finish(SECOND);
    state.finish(FIRST);
    drop(state);
    assert_eq!(
        collect(&mut stream).unwrap(),
        vec![
            Value::Array(vec![
                Value::String("audio".into()),
                Value::String(SECOND.into()),
                Value::Binary(vec![0, 255, 128])
            ]),
            value(&format!(r#"["flush","{SECOND}"]"#)),
            Value::Array(vec![
                Value::String("audio".into()),
                Value::String(FIRST.into()),
                Value::Binary(vec![0, 255, 128])
            ]),
            value(&format!(r#"["flush","{FIRST}"]"#)),
            value(r#""done""#)
        ]
    );
}

#[test]
fn clear_waits_for_closure_and_suppresses_retired_audio() {
    for flushing in [false, true] {
        let data = Arc::new(Mutex::new(SocketData::default()));
        let mut items = vec![Input::String("old".into())];
        if flushing {
            items.push(flush())
        }
        items.extend([clear(), clear(), Input::String("new".into())]);
        let mut stream = stream(live(source(items)), data.clone());
        assert!(poll(&mut stream).is_pending());
        let mut state = data.lock().unwrap();
        assert_eq!(state.sent.len(), 4);
        assert_eq!(
            value(&state.sent[1]),
            value(&if flushing {
                format!(r#"{{"context_id":"{FIRST}","text":"","flush":true,"auto_close":true}}"#)
            } else {
                format!(r#"{{"context_id":"{FIRST}","close_context":true}}"#)
            })
        );
        state.push(format!(
            r#"{{"context_id":"{FIRST}","context_closed":true}}"#
        ));
        state.finish(FIRST);
        state.finish(SECOND);
        drop(state);
        assert_eq!(
            collect(&mut stream).unwrap(),
            vec![
                value(r#""clear""#),
                value(r#""clear""#),
                Value::Array(vec![
                    Value::String("audio".into()),
                    Value::String(SECOND.into()),
                    Value::Binary(vec![0, 255, 128])
                ]),
                value(&format!(r#"["flush","{SECOND}"]"#)),
                value(r#""done""#)
            ]
        );
    }
}

#[test]
fn empty_text_flush_and_clear_are_local() {
    let data = Arc::new(Mutex::new(SocketData::default()));
    let mut stream = stream(
        live(source(vec![
            Input::String(String::new()),
            flush(),
            clear(),
            flush(),
        ])),
        data.clone(),
    );
    assert_eq!(
        collect(&mut stream).unwrap(),
        vec![value(r#""clear""#), value(r#""done""#)]
    );
    assert_eq!(data.lock().unwrap().sent, Vec::<String>::new());
}
