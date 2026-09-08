use super::*;
use crate::{
    generated::{auth::AuthElevenlabs, elevenlabs::*, elevenlabs_output::SynthesisItem},
    http::HttpResponse,
    json::Raw,
    runtime::{InputStream, StreamingInput},
    websocket::{Message, WebSocketLike},
};
use std::{
    collections::VecDeque,
    future::Future,
    pin::Pin,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Condvar, Mutex,
    },
    task::{Context, Poll, Wake, Waker},
    time::Instant,
};
mod fixtures;
mod http_tests;
mod socket;

#[derive(Default)]
struct Counts {
    reads: AtomicUsize,
    drops: AtomicUsize,
}
struct Source<T> {
    values: VecDeque<Result<T, TransportError>>,
    counts: Arc<Counts>,
    stall: bool,
}
impl<T: Send + Unpin> InputStream<T> for Source<T> {
    fn poll_next(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
    ) -> Poll<Option<Result<T, TransportError>>> {
        let s = self.get_mut();
        s.counts.reads.fetch_add(1, Ordering::SeqCst);
        match s.values.pop_front() {
            Some(value) => Poll::Ready(Some(value)),
            None if s.stall => Poll::Pending,
            None => Poll::Ready(None),
        }
    }
}
impl<T> Drop for Source<T> {
    fn drop(&mut self) {
        self.counts.drops.fetch_add(1, Ordering::SeqCst);
    }
}
fn source<T: Send + Unpin + 'static>(
    values: Vec<Result<T, TransportError>>,
    counts: &Arc<Counts>,
    stall: bool,
) -> StreamingInput<T> {
    Box::pin(Source {
        values: values.into(),
        counts: counts.clone(),
        stall,
    })
}
#[derive(Default)]
struct Notice {
    ready: Mutex<bool>,
    changed: Condvar,
}
impl Wake for Notice {
    fn wake(self: Arc<Self>) {
        self.wake_by_ref()
    }
    fn wake_by_ref(self: &Arc<Self>) {
        *self.ready.lock().unwrap() = true;
        self.changed.notify_one();
    }
}
fn ready<T>(future: impl Future<Output = T>) -> T {
    let notice = Arc::new(Notice::default());
    let waker = Waker::from(notice.clone());
    let mut cx = Context::from_waker(&waker);
    let mut future = std::pin::pin!(future);
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        *notice.ready.lock().unwrap() = false;
        if let Poll::Ready(value) = future.as_mut().poll(&mut cx) {
            return value;
        }
        let mut signaled = notice.ready.lock().unwrap();
        while !*signaled {
            let remaining = deadline.saturating_duration_since(Instant::now());
            assert!(!remaining.is_zero(), "operation stalled");
            signaled = notice.changed.wait_timeout(signaled, remaining).unwrap().0;
        }
    }
}
fn next(s: &mut Stream) -> Option<Result<SynthesisItem, TransportError>> {
    ready(poll_fn(|cx| Pin::new(&mut *s).poll_next(cx)))
}
fn value(raw: Raw<'_>) -> JsonValue {
    if raw.is_null() {
        JsonValue::Null
    } else if let Ok(v) = raw.boolean() {
        JsonValue::Bool(v)
    } else if let Ok(v) = raw.number() {
        JsonValue::Number(v)
    } else if let Ok(v) = raw.string() {
        JsonValue::String(v)
    } else if let Ok(v) = raw.array() {
        JsonValue::Array(v.into_iter().map(value).collect())
    } else {
        JsonValue::Object(
            raw.object()
                .unwrap()
                .into_iter()
                .map(|(k, v)| (k, value(v)))
                .collect(),
        )
    }
}
fn parse(text: &str) -> JsonValue {
    value(Raw::parse_exact(text).unwrap())
}
fn fixture_list(key: &str) -> Vec<Raw<'static>> {
    Raw::parse_exact(include_str!("../../../../fixtures/elevenlabs.json"))
        .unwrap()
        .object()
        .unwrap()[key]
        .array()
        .unwrap()
}
fn item(value: SynthesisItem) -> JsonValue {
    match value {
        SynthesisItem::Bytes(bytes) => JsonValue::Array(
            bytes
                .into_iter()
                .map(|v| JsonValue::Number(v as f64))
                .collect(),
        ),
        SynthesisItem::Clear(v) => {
            assert_eq!(v.event.value(), "clear");
            parse(r#"{"event":"clear"}"#)
        }
        SynthesisItem::Chunk(v) => {
            assert_eq!(v.correlation.value(), "chunk");
            JsonValue::Object(BTreeMap::from([
                ("correlation".into(), JsonValue::String("chunk".into())),
                (
                    "audio".into(),
                    JsonValue::Array(
                        v.audio
                            .into_iter()
                            .map(|v| JsonValue::Number(v as f64))
                            .collect(),
                    ),
                ),
                (
                    "timestamps".into(),
                    JsonValue::Array(
                        v.timestamps
                            .into_iter()
                            .map(|t| {
                                assert_eq!(t.kind.value(), "character");
                                JsonValue::Object(BTreeMap::from([
                                    ("kind".into(), JsonValue::String("character".into())),
                                    ("value".into(), JsonValue::String(t.value)),
                                    ("startTimeMs".into(), JsonValue::Number(t.start_time_ms)),
                                    ("endTimeMs".into(), JsonValue::Number(t.end_time_ms)),
                                ]))
                            })
                            .collect(),
                    ),
                ),
            ]))
        }
    }
}
fn collect(stream: &mut Stream) -> Vec<JsonValue> {
    let mut values = vec![];
    while let Some(value) = next(stream) {
        values.push(item(value.unwrap()))
    }
    values
}
fn auth() -> Auth {
    Auth {
        elevenlabs: Some(AuthElevenlabs {
            api_key: Some("test-key".into()),
            single_use_token: None,
        }),
        async_: None,
        aws: None,
        camb: None,
        cartesia: None,
        deepdub: None,
        deepgram: None,
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
struct Http {
    request: Mutex<Option<HttpRequest>>,
    response: Mutex<Option<HttpResponse>>,
}
impl HttpTransport for Http {
    fn send(
        &self,
        request: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        *self.request.lock().unwrap() = Some(request);
        Box::pin(async { Ok(self.response.lock().unwrap().take().unwrap()) })
    }
}
fn http(body: StreamingInput<Vec<u8>>, status: u16) -> Http {
    Http {
        request: Mutex::new(None),
        response: Mutex::new(Some(HttpResponse {
            body,
            status,
            headers: vec![("Request-Id".into(), "trace".into())],
        })),
    }
}
