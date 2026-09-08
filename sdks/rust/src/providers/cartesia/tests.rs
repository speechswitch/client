use super::*;
use crate::{
    generated::{auth::AuthCartesia, cartesia::*, cartesia_output as out},
    runtime::{InputStream, JsonValue, StreamingInput},
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
mod http;
mod mappings;
mod native;
mod protocol;
mod socket;

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
type Trace = Arc<Mutex<Vec<&'static str>>>;
struct Body<T> {
    values: VecDeque<Result<T, TransportError>>,
    counts: Arc<Counts>,
    stall: bool,
    trace: Trace,
    name: &'static str,
}
impl<T: Send + Unpin> InputStream<T> for Body<T> {
    fn poll_next(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<T, TransportError>>> {
        let s = self.get_mut();
        s.counts.reads.fetch_add(1, Ordering::SeqCst);
        if let Some(value) = s.values.pop_front() {
            Poll::Ready(Some(value))
        } else if s.stall {
            *s.counts.waker.lock().unwrap() = Some(cx.waker().clone());
            Poll::Pending
        } else {
            Poll::Ready(None)
        }
    }
}
impl<T> Drop for Body<T> {
    fn drop(&mut self) {
        self.counts.drops.fetch_add(1, Ordering::SeqCst);
        self.trace.lock().unwrap().push(self.name);
    }
}
fn body<T: Send + Unpin + 'static>(
    values: Vec<Result<T, TransportError>>,
    counts: &Arc<Counts>,
    trace: &Trace,
    stall: bool,
    name: &'static str,
) -> StreamingInput<T> {
    Box::pin(Body {
        values: values.into(),
        counts: counts.clone(),
        trace: trace.clone(),
        stall,
        name,
    })
}
fn entropy(bytes: &mut [u8]) -> Result<(), TransportError> {
    for (index, value) in bytes.iter_mut().enumerate() {
        *value = index as u8;
    }
    Ok(())
}
fn auth() -> Auth {
    Auth {
        cartesia: Some(AuthCartesia {
            api_key: Some("key".into()),
            access_token: None,
        }),
        async_: None,
        aws: None,
        camb: None,
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
fn pcm() -> TtsRequestTextVoicef0bb1766OutputPcm {
    TtsRequestTextVoicef0bb1766OutputPcm {
        byte_order: Default::default(),
        format: Default::default(),
        sample_encoding: TtsRequestTextVoicef0bb1766OutputPcmSampleEncoding::SignedInteger16(
            Default::default(),
        ),
        sample_rate_hz: TtsRequestTextVoicef0bb1766OutputPcmSampleRateHz::Number24000(
            Default::default(),
        ),
    }
}
fn whole() -> TtsRequestTextVoicef0bb1766 {
    TtsRequestTextVoicef0bb1766 {
        text: "Hello".into(),
        voice: "saved-custom".into(),
        model: TtsRequestTextVoicef0bb1766Model::Sonic35(Default::default()),
        output: TtsRequestTextVoicef0bb1766Output::Pcm(pcm()),
        accent: None,
        emotion: None,
        language: None,
        lexicon: None,
        speed: None,
        text_normalization: None,
        volume_scale: None,
    }
}
fn live(text: StreamingInput<settings::Input>) -> TtsRequestStreamingTextVoice0bf53a99 {
    TtsRequestStreamingTextVoice0bf53a99 {
        text,
        voice: "saved-custom".into(),
        model: TtsRequestTextVoicef0bb1766Model::Sonic35(Default::default()),
        output: TtsRequestStreamingTextVoice0bf53a99Output::Pcm(pcm()),
        accent: None,
        emotion: None,
        language: None,
        lexicon: None,
        speed: None,
        text_normalization: None,
        volume_scale: None,
        max_buffer_delay_ms: None,
    }
}
fn timed() -> TtsRequest {
    TtsRequest::TextVoicec75c718e(TtsRequestTextVoicec75c718e {
        text: "Hello".into(),
        voice: "saved-custom".into(),
        model: TtsRequestTextVoicef0bb1766Model::Sonic35(Default::default()),
        output: TtsRequestStreamingTextVoice0bf53a99Output::Pcm(pcm()),
        accent: None,
        emotion: None,
        language: None,
        lexicon: None,
        speed: None,
        text_normalization: None,
        volume_scale: None,
        timestamp_text: None,
        timestamp_granularity: TtsRequestStreamingTextVoice12b0fd0cTimestampGranularity::Array(
            vec![
                TtsRequestStreamingTextVoice12b0fd0cTimestampGranularityArrayItem::Word(
                    Default::default(),
                ),
                TtsRequestStreamingTextVoice12b0fd0cTimestampGranularityArrayItem::Phoneme(
                    Default::default(),
                ),
            ],
        ),
    })
}
fn ready<T>(future: impl Future<Output = T>) -> T {
    let mut future = std::pin::pin!(future);
    let counts = Arc::new(Counts::default());
    let waker = Waker::from(counts.clone());
    let mut cx = Context::from_waker(&waker);
    for _ in 0..10000 {
        let wakes = counts.wakes.load(Ordering::SeqCst);
        match future.as_mut().poll(&mut cx) {
            Poll::Ready(value) => return value,
            Poll::Pending => assert!(
                counts.wakes.load(Ordering::SeqCst) > wakes,
                "pending future did not schedule another poll"
            ),
        }
    }
    panic!("future did not complete")
}
fn next(stream: &mut Stream) -> Option<Result<out::SynthesisItem, TransportError>> {
    ready(std::future::poll_fn(|cx| {
        Pin::new(&mut *stream).poll_next(cx)
    }))
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
fn canonical(item: out::SynthesisItem) -> JsonValue {
    let mut object = BTreeMap::new();
    match item {
        out::SynthesisItem::Bytes(data) => {
            return JsonValue::Array(
                data.into_iter()
                    .map(|v| JsonValue::Number(v as f64))
                    .collect(),
            )
        }
        out::SynthesisItem::Clear(_) => {
            object.insert("event".into(), JsonValue::String("clear".into()));
        }
        out::SynthesisItem::Flush(v) => {
            object.insert("event".into(), JsonValue::String("flush".into()));
            object.insert("correlationId".into(), JsonValue::String(v.correlation_id));
            if let Some(group) = v.input_group_id {
                object.insert("inputGroupId".into(), JsonValue::String(group));
            }
        }
        out::SynthesisItem::Timeline(v) => {
            object.insert(
                "correlation".into(),
                JsonValue::String(v.correlation.value().into()),
            );
            object.insert("correlationId".into(), JsonValue::String(v.correlation_id));
            if let Some(group) = v.input_group_id {
                object.insert("inputGroupId".into(), JsonValue::String(group));
            }
            if let Some(audio) = v.audio {
                object.insert("audio".into(), canonical(out::SynthesisItem::Bytes(audio)));
            }
            object.insert(
                "timestamps".into(),
                JsonValue::Array(
                    v.timestamps
                        .into_iter()
                        .map(|stamp| {
                            JsonValue::Object(BTreeMap::from([
                                ("kind".into(), JsonValue::String(stamp.kind.value().into())),
                                ("value".into(), JsonValue::String(stamp.value)),
                                ("startTimeMs".into(), JsonValue::Number(stamp.start_time_ms)),
                                ("endTimeMs".into(), JsonValue::Number(stamp.end_time_ms)),
                            ]))
                        })
                        .collect(),
                ),
            );
        }
    }
    JsonValue::Object(object)
}

struct Http {
    requests: Mutex<Vec<HttpRequest>>,
    responses: Mutex<VecDeque<HttpResponse>>,
    stall: bool,
    counts: Arc<Counts>,
}
impl Http {
    fn new(response: HttpResponse) -> Self {
        Self {
            requests: Mutex::new(Vec::new()),
            responses: Mutex::new(VecDeque::from([response])),
            stall: false,
            counts: Arc::new(Counts::default()),
        }
    }
}
impl HttpTransport for Http {
    fn send(
        &self,
        request: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        self.requests.lock().unwrap().push(request);
        Box::pin(async move {
            struct Guard(Arc<Counts>);
            impl Drop for Guard {
                fn drop(&mut self) {
                    self.0.drops.fetch_add(1, Ordering::SeqCst);
                }
            }
            let _guard = Guard(self.counts.clone());
            if self.stall {
                std::future::pending::<()>().await;
            }
            Ok(self
                .responses
                .lock()
                .unwrap()
                .pop_front()
                .expect("unexpected HTTP request"))
        })
    }
}

#[derive(Debug)]
struct Marker(Arc<()>);
impl std::fmt::Display for Marker {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("original failure")
    }
}
impl std::error::Error for Marker {}
fn marker(shared: &Arc<()>) -> TransportError {
    Box::new(Marker(shared.clone()))
}
fn same(error: &TransportError, shared: &Arc<()>) {
    assert!(Arc::ptr_eq(
        &error.downcast_ref::<Marker>().unwrap().0,
        shared
    ));
}
