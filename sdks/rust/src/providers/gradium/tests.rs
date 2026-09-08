use super::*;
use crate::{
    generated::{auth::AuthElevenlabs, gradium::*, gradium_output::*},
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

mod boundary;
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
    let mut values = Vec::new();
    while let Some(item) = next(stream) {
        values.push(normalized(item?));
    }
    Ok(values)
}
fn normalized(value: SynthesisItem) -> Value {
    match value {
        SynthesisItem::Bytes(v) => Value::Binary(v),
        SynthesisItem::Timeline(v) => {
            let timestamps = v
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
                    Value::String(v.correlation.value().into()),
                ),
                ("timestamps".into(), Value::Array(timestamps)),
            ]);
            if let Some(id) = v.correlation_id {
                fields.insert("correlationId".into(), Value::String(id));
            }
            if let Some(audio) = v.audio {
                fields.insert("audio".into(), Value::Binary(audio));
            }
            if let Some(timing) = v.audio_timing {
                fields.insert(
                    "audioTiming".into(),
                    Value::Map(BTreeMap::from([
                        ("startTimeMs".into(), Value::Number(timing.start_time_ms)),
                        ("endTimeMs".into(), Value::Number(timing.end_time_ms)),
                    ])),
                );
            }
            Value::Map(fields)
        }
    }
}
fn fixture_root() -> BTreeMap<String, Raw<'static>> {
    Raw::parse_exact(include_str!("../../../../fixtures/gradium.json"))
        .unwrap()
        .object()
        .unwrap()
}
fn request() -> TtsRequest {
    TtsRequest {
        model: None,
        voice: "existing-custom".into(),
        text: TtsRequestText::String("Hello".into()),
        output: TtsRequestOutput::Pcm(TtsRequestOutputPcm {
            format: Default::default(),
            byte_order: None,
            sample_encoding: None,
            sample_rate_hz: None,
        }),
        lexicon: None,
        pacing_bias: None,
        temperature: None,
        text_normalization: None,
        timestamp_granularity: None,
        voice_guidance: None,
    }
}
fn requests() -> Vec<TtsRequest> {
    let a = request();
    let mut b = request();
    let mut c = request();
    let mut d = request();
    b.model = Some(TtsRequestModel::GradiumTtsBeta(Default::default()));
    b.output = TtsRequestOutput::Object(TtsRequestOutputObject {
        format: TtsRequestOutputObjectFormat::Mulaw(Default::default()),
        sample_rate_hz: Some(Default::default()),
    });
    b.temperature = Some(0.0);
    b.voice_guidance = Some(10.0);
    b.pacing_bias = Some(-5.0);
    b.text_normalization = Some(TtsRequestTextNormalization::False(Default::default()));
    c.output = TtsRequestOutput::OggOpus(TtsRequestOutputOggOpus {
        format: Default::default(),
    });
    c.text_normalization = Some(TtsRequestTextNormalization::Objecte21202a8(
        TtsRequestTextNormalizationObjecte21202a8 {
            locale: TtsRequestTextNormalizationObjecte21202a8Locale::FrCh(Default::default()),
        },
    ));
    d.output = TtsRequestOutput::Wav(TtsRequestOutputWav {
        format: Default::default(),
        byte_order: None,
        sample_encoding: None,
        sample_rate_hz: None,
    });
    d.temperature = Some(1.5);
    d.pacing_bias = Some(5.0);
    d.text_normalization = Some(TtsRequestTextNormalization::Object81d1078f(
        TtsRequestTextNormalizationObject81d1078f {
            rules: vec![
                TtsRequestTextNormalizationObject81d1078fRulesItem::CurrencyFrCh(Default::default()),
                TtsRequestTextNormalizationObject81d1078fRulesItem::UrlFr(Default::default()),
                TtsRequestTextNormalizationObject81d1078fRulesItem::AlNum(Default::default()),
            ],
        },
    ));
    vec![a, b, c, d]
}
fn auth() -> Auth {
    Auth {
        fish: None,
        gradium: Some(AuthElevenlabs {
            api_key: Some("test-key".into()),
            single_use_token: None,
        }),
        async_: None,
        aws: None,
        camb: None,
        cartesia: None,
        deepdub: None,
        deepgram: None,
        elevenlabs: None,
        google: None,
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
            headers: vec![],
        })),
    }
}
