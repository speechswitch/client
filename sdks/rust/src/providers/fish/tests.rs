use super::*;
use crate::{
    generated::{auth::AuthAsync, fish::*, fish_output::*},
    http::HttpResponse,
    json::Raw,
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

macro_rules! request_fields {
    ($name:ident, $($field:ident:$value:expr),* $(,)?) => { $name {
        condition_on_previous_chunks:None,early_stop_threshold:None,features:None,
        latency_optimization:None,max_audio_tokens:None,min_text_chunk_length:None,
        repetition_penalty:None,speed:None,temperature:None,text_chunk_length:None,
        text_normalization:None,top_p:None,volume_db:None,$($field:$value,)*
    } };
}
mod fixtures;
mod http_tests;
mod socket;

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
            Some(value) => Poll::Ready(Some(value)),
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
fn source<T: Send + Unpin + 'static>(
    values: Vec<Result<T, TransportError>>,
    counts: &Arc<Counts>,
    stall: bool,
) -> StreamingInput<T> {
    Box::pin(Source {
        values: values.into(),
        counts: counts.clone(),
        stall,
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
            Poll::Ready(value) => return value,
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
    let mut values = Vec::new();
    while let Some(item) = next(stream) {
        values.push(normalized(item?))
    }
    Ok(values)
}
fn normalized(value: SynthesisItem) -> Value {
    match value {
        SynthesisItem::Bytes(bytes) => Value::Binary(bytes),
        SynthesisItem::Timeline(value) => {
            let timestamps = value
                .timestamps
                .into_iter()
                .map(|v| {
                    Value::Map(BTreeMap::from([
                        ("kind".into(), Value::String(v.kind.value().into())),
                        ("value".into(), Value::String(v.value)),
                        ("startTimeMs".into(), Value::Number(v.start_time_ms)),
                        ("endTimeMs".into(), Value::Number(v.end_time_ms)),
                    ]))
                })
                .collect();
            let mut fields = BTreeMap::from([
                (
                    "correlation".into(),
                    Value::String(value.correlation.value().into()),
                ),
                ("correlationId".into(), Value::String(value.correlation_id)),
                (
                    "timelineOffsetMs".into(),
                    Value::Number(value.timeline_offset_ms),
                ),
                ("audio".into(), Value::Binary(value.audio)),
                ("timestamps".into(), Value::Array(timestamps)),
            ]);
            if let Some(update) = value.timestamp_update {
                fields.insert(
                    "timestampUpdate".into(),
                    Value::String(update.value().into()),
                );
            }
            if let Some(duration) = value.duration_ms {
                fields.insert("durationMs".into(), Value::Number(duration));
            }
            Value::Map(fields)
        }
    }
}
fn fixture_root() -> BTreeMap<String, Raw<'static>> {
    Raw::parse_exact(include_str!("../../../../fixtures/fish.json"))
        .unwrap()
        .object()
        .unwrap()
}
fn mp3() -> TtsRequestS1TextOutput {
    TtsRequestS1TextOutput::Mp3(TtsRequestS1TextOutputMp3 {
        format: Default::default(),
        sample_rate_hz: None,
        bit_rate_bps: None,
    })
}
fn model() -> TtsRequestText486ba478Model {
    TtsRequestText486ba478Model::S2Pro(Default::default())
}
fn voice() -> TtsRequestTextVoice {
    request_fields!(TtsRequestTextVoice,model:model(),text:"hello".into(),voice:"custom-voice".into(),reference_samples:None,output:mp3(),loudness_normalization:None,timestamp_granularity:None)
}
fn streaming(input: StreamingInput<settings::Input>) -> TtsRequest {
    TtsRequest::StreamingTextVoice(
        request_fields!(TtsRequestStreamingTextVoice,model:model(),text:input,voice:"custom-voice".into(),reference_samples:None,output:mp3(),loudness_normalization:None),
    )
}
fn auth() -> Auth {
    Auth {
        fish: Some(AuthAsync {
            api_key: Some("test-key".into()),
        }),
        async_: None,
        aws: None,
        camb: None,
        cartesia: None,
        deepdub: None,
        deepgram: None,
        elevenlabs: None,
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
            status,
            body,
            headers: vec![("Content-Type".into(), "application/json".into())],
        })),
    }
}
