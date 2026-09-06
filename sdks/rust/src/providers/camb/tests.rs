use super::*;
use crate::{
    generated::{auth::AuthAsync, camb::*, camb_output::SynthesisItem},
    http::{HttpRequest, HttpResponse},
    json::Raw,
    runtime::{InputStream, JsonValue, StreamingInput},
    websocket::{Socket, WebSocketLike},
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
mod http;
mod socket;

#[derive(Default)]
struct Counts {
    reads: AtomicUsize,
    drops: AtomicUsize,
    wakes: AtomicUsize,
    waker: Mutex<Option<Waker>>,
    trace: Mutex<Vec<&'static str>>,
}
impl Wake for Counts {
    fn wake(self: Arc<Self>) {
        self.wakes.fetch_add(1, Ordering::SeqCst);
    }
    fn wake_by_ref(self: &Arc<Self>) {
        self.wakes.fetch_add(1, Ordering::SeqCst);
    }
}
struct Body<T> {
    values: VecDeque<Result<T, TransportError>>,
    counts: Arc<Counts>,
    stall: bool,
    name: &'static str,
}
impl<T: Send + Unpin> InputStream<T> for Body<T> {
    fn poll_next(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<T, TransportError>>> {
        let body = self.get_mut();
        body.counts.reads.fetch_add(1, Ordering::SeqCst);
        if let Some(value) = body.values.pop_front() {
            Poll::Ready(Some(value))
        } else if body.stall {
            *body.counts.waker.lock().unwrap() = Some(cx.waker().clone());
            Poll::Pending
        } else {
            Poll::Ready(None)
        }
    }
}
impl<T> Drop for Body<T> {
    fn drop(&mut self) {
        self.counts.drops.fetch_add(1, Ordering::SeqCst);
        self.counts.trace.lock().unwrap().push(self.name);
    }
}
fn input(counts: &Arc<Counts>, chunks: &[&str], stall: bool) -> StreamingInput<String> {
    Box::pin(Body {
        values: chunks.iter().map(|text| Ok((*text).into())).collect(),
        counts: counts.clone(),
        stall,
        name: "input",
    })
}
fn auth() -> Auth {
    Auth {
        camb: Some(AuthAsync {
            api_key: Some("test + key".into()),
        }),
        async_: None,
        aws: None,
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
        voice_ai: None,
        xai: None,
    }
}
fn output() -> TtsRequestMars81FlashBetaStreamingTextVoiceOutput {
    TtsRequestMars81FlashBetaStreamingTextVoiceOutput {
        format: TtsRequestMars81FlashBetaStreamingTextVoiceOutputFormat::Mp3(Default::default()),
        sample_rate_hz: None,
    }
}
fn whole() -> TtsRequestTextVoice {
    TtsRequestTextVoice {
        text: "Hello".into(),
        voice: "000123".into(),
        language: TtsRequestMars81FlashBetaStreamingTextVoiceLanguage::EnUs(Default::default()),
        model: TtsRequestTextVoiceModel::Mars8Flash(Default::default()),
        output: TtsRequestTextVoiceOutput::Object(output()),
        speed: None,
        accent_preservation: None,
        audio_enhancement: None,
        named_entity_pronunciation_enhancement: None,
        reference_audio_enhancement: None,
    }
}
fn live(text: StreamingInput<String>) -> TtsRequestMars81FlashBetaStreamingTextVoice {
    TtsRequestMars81FlashBetaStreamingTextVoice {
        text,
        voice: "123".into(),
        model: Default::default(),
        language: TtsRequestMars81FlashBetaStreamingTextVoiceLanguage::EnUs(Default::default()),
        output: output(),
        speed: None,
        accent_preservation: None,
        audio_enhancement: None,
        named_entity_pronunciation_enhancement: None,
        reference_audio_enhancement: None,
        text_flush_delay_ms: None,
        inference_steps: None,
        timestamp_granularity: None,
    }
}
fn timed(text: &str) -> TtsRequest {
    TtsRequest::Mars81FlashBetaTextVoice(TtsRequestMars81FlashBetaTextVoice {
        text: text.into(),
        voice: "123".into(),
        model: Default::default(),
        language: TtsRequestMars81FlashBetaStreamingTextVoiceLanguage::EnUs(Default::default()),
        output: output(),
        speed: None,
        accent_preservation: None,
        audio_enhancement: None,
        named_entity_pronunciation_enhancement: None,
        reference_audio_enhancement: None,
        text_flush_delay_ms: None,
        inference_steps: None,
        timestamp_granularity: Default::default(),
    })
}
fn flag(value: bool) -> TtsRequestMars81FlashBetaStreamingTextVoiceAccentPreservation {
    if value {
        TtsRequestMars81FlashBetaStreamingTextVoiceAccentPreservation::True(Default::default())
    } else {
        TtsRequestMars81FlashBetaStreamingTextVoiceAccentPreservation::False(Default::default())
    }
}
fn ready<T>(future: impl Future<Output = T>) -> T {
    match std::pin::pin!(future).poll(&mut Context::from_waker(Waker::noop())) {
        Poll::Ready(value) => value,
        Poll::Pending => panic!("unexpected pending test future"),
    }
}
fn tree(raw: Raw<'_>) -> JsonValue {
    if raw.is_null() {
        JsonValue::Null
    } else if let Ok(value) = raw.boolean() {
        JsonValue::Bool(value)
    } else if let Ok(value) = raw.string() {
        JsonValue::String(value)
    } else if let Ok(value) = raw.array() {
        JsonValue::Array(value.into_iter().map(tree).collect())
    } else if let Ok(value) = raw.object() {
        JsonValue::Object(
            value
                .into_iter()
                .map(|(key, raw)| (key, tree(raw)))
                .collect(),
        )
    } else {
        JsonValue::Number(raw.number().unwrap())
    }
}
fn json(text: &str) -> JsonValue {
    tree(Raw::parse_exact(text).unwrap())
}
fn item(value: SynthesisItem) -> JsonValue {
    match value {
        SynthesisItem::Bytes(bytes) => JsonValue::Array(
            bytes
                .into_iter()
                .map(|v| JsonValue::Number(v as f64))
                .collect(),
        ),
        SynthesisItem::Ordered(value) => {
            let mut fields = std::collections::BTreeMap::from([
                (
                    "correlation".into(),
                    JsonValue::String(value.correlation.value().into()),
                ),
                (
                    "correlationId".into(),
                    JsonValue::String(value.correlation_id),
                ),
                (
                    "timestamps".into(),
                    JsonValue::Array(
                        value
                            .timestamps
                            .into_iter()
                            .map(|word| {
                                JsonValue::Object(
                                    [
                                        (
                                            "kind".into(),
                                            JsonValue::String(word.kind.value().into()),
                                        ),
                                        ("value".into(), JsonValue::String(word.value)),
                                        (
                                            "startTimeMs".into(),
                                            JsonValue::Number(word.start_time_ms),
                                        ),
                                        ("endTimeMs".into(), JsonValue::Number(word.end_time_ms)),
                                    ]
                                    .into(),
                                )
                            })
                            .collect(),
                    ),
                ),
            ]);
            if let Some(bytes) = value.audio {
                fields.insert(
                    "audio".into(),
                    JsonValue::Array(
                        bytes
                            .into_iter()
                            .map(|v| JsonValue::Number(v as f64))
                            .collect(),
                    ),
                );
            }
            JsonValue::Object(fields)
        }
    }
}
fn poll(stream: &mut Stream, cx: &mut Context<'_>) -> Poll<Option<Result<JsonValue, String>>> {
    Pin::new(stream)
        .poll_next(cx)
        .map(|value| value.map(|value| value.map(item).map_err(|error| error.to_string())))
}
fn drain(stream: &mut Stream) -> (Vec<JsonValue>, Option<String>) {
    let mut items = Vec::new();
    let mut cx = Context::from_waker(Waker::noop());
    for _ in 0..128 {
        match poll(stream, &mut cx) {
            Poll::Pending => {}
            Poll::Ready(None) => return (items, None),
            Poll::Ready(Some(Ok(value))) => items.push(value),
            Poll::Ready(Some(Err(error))) => {
                assert_eq!(poll(stream, &mut cx), Poll::Ready(None));
                return (items, Some(error));
            }
        }
    }
    panic!("stream did not terminate");
}

#[derive(Debug)]
struct Cause(Arc<()>);
impl std::fmt::Display for Cause {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("original failure")
    }
}
impl std::error::Error for Cause {}
