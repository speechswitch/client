use super::*;
use crate::{
    generated::{auth::AuthAsync, deepgram::*, deepgram_output::SynthesisItem},
    http::HttpResponse,
    json::Raw,
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
mod lifecycle;

#[derive(Default)]
struct Counts {
    reads: AtomicUsize,
    drops: AtomicUsize,
    wakes: AtomicUsize,
}
impl Wake for Counts {
    fn wake(self: Arc<Self>) {
        self.wakes.fetch_add(1, Ordering::SeqCst);
    }
    fn wake_by_ref(self: &Arc<Self>) {
        self.wakes.fetch_add(1, Ordering::SeqCst);
    }
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
            Some(v) => Poll::Ready(Some(v)),
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
fn http(body: StreamingInput<Vec<u8>>, status: u16, content_type: &str) -> Http {
    Http {
        request: Mutex::new(None),
        response: Mutex::new(Some(HttpResponse {
            body,
            status,
            headers: vec![("Content-Type".into(), content_type.into())],
        })),
    }
}
fn auth() -> Auth {
    Auth {
        deepgram: Some(AuthAsync {
            api_key: Some("key".into()),
        }),
        async_: None,
        aws: None,
        camb: None,
        cartesia: None,
        deepdub: None,
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
fn ready<T>(future: impl Future<Output = T>) -> T {
    let mut future = std::pin::pin!(future);
    let counts = Arc::new(Counts::default());
    let waker = Waker::from(counts.clone());
    let mut cx = Context::from_waker(&waker);
    for _ in 0..1000 {
        let wakes = counts.wakes.load(Ordering::SeqCst);
        match future.as_mut().poll(&mut cx) {
            Poll::Ready(v) => return v,
            Poll::Pending => assert!(
                counts.wakes.load(Ordering::SeqCst) > wakes,
                "pending without wake"
            ),
        }
    }
    panic!("did not complete")
}
fn next(s: &mut Stream) -> Option<Result<SynthesisItem, TransportError>> {
    ready(std::future::poll_fn(|cx| Pin::new(&mut *s).poll_next(cx)))
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
fn fixtures(key: &str) -> Vec<Raw<'static>> {
    Raw::parse_exact(include_str!("../../../../fixtures/deepgram.json"))
        .unwrap()
        .object()
        .unwrap()[key]
        .array()
        .unwrap()
}
fn bytes(raw: Raw<'_>) -> Vec<u8> {
    raw.array()
        .unwrap()
        .into_iter()
        .map(|v| v.number().unwrap() as u8)
        .collect()
}
fn item(value: SynthesisItem) -> JsonValue {
    match value {
        SynthesisItem::Bytes(v) => {
            JsonValue::Array(v.into_iter().map(|v| JsonValue::Number(v as f64)).collect())
        }
        SynthesisItem::Clear(v) => parse(&format!(
            r#"{{"event":"clear","sequenceId":{}}}"#,
            v.sequence_id
        )),
        SynthesisItem::Done(v) => {
            let mut result = format!(r#"{{"event":"done","sequenceId":{}"#, v.sequence_id);
            if let Some(trace) = v.trace_id {
                result.push_str(",\"traceId\":");
                json::quote(&trace, &mut result);
            }
            result.push('}');
            parse(&result)
        }
    }
}
fn output(raw: Raw<'_>) -> TtsRequestAura1TextVoiceOutput {
    let v = raw.object().unwrap();
    let rate = v.get("sampleRateHz").map(|v| v.number().unwrap() as u32);
    let bitrate = v.get("bitRateBps").map(|v| v.number().unwrap());
    let pcm_rate = || {
        rate.map(|v| match v {
            8000 => TtsRequestAura1TextVoiceOutputPcmSampleRateHz::Number8000(Default::default()),
            16000 => TtsRequestAura1TextVoiceOutputPcmSampleRateHz::Number16000(Default::default()),
            24000 => TtsRequestAura1TextVoiceOutputPcmSampleRateHz::Number24000(Default::default()),
            32000 => TtsRequestAura1TextVoiceOutputPcmSampleRateHz::Number32000(Default::default()),
            48000 => TtsRequestAura1TextVoiceOutputPcmSampleRateHz::Number48000(Default::default()),
            _ => panic!("fixture rate"),
        })
    };
    let law_rate =
        || {
            rate.map(|v| match v {
        8000 => TtsRequestAura1TextVoiceOutputObjectSampleRateHz::Number8000(Default::default()),
        16000 => TtsRequestAura1TextVoiceOutputObjectSampleRateHz::Number16000(Default::default()),
        _ => panic!("fixture G711 rate"),
    })
        };
    let law = |v: &str| match v {
        "mulaw" => TtsRequestAura1TextVoiceOutputObjectFormat::Mulaw(Default::default()),
        "alaw" => TtsRequestAura1TextVoiceOutputObjectFormat::Alaw(Default::default()),
        _ => panic!("fixture encoding"),
    };
    use TtsRequestAura1TextVoiceOutput::*;
    match v["format"].string().unwrap().as_str() {
        "pcm" => Pcm(TtsRequestAura1TextVoiceOutputPcm {
            format: Default::default(),
            sample_encoding: None,
            sample_rate_hz: pcm_rate(),
        }),
        format @ ("mulaw" | "alaw") => Object(TtsRequestAura1TextVoiceOutputObject {
            format: law(format),
            sample_rate_hz: law_rate(),
        }),
        "wav" => {
            if let Some(encoding) = v.get("sampleEncoding") {
                Wav669a6d8a(TtsRequestAura1TextVoiceOutputWav669a6d8a {
                    format: Default::default(),
                    sample_encoding: law(&encoding.string().unwrap()),
                    sample_rate_hz: law_rate(),
                })
            } else {
                Wavb8f00cbb(TtsRequestAura1TextVoiceOutputWavb8f00cbb {
                    format: Default::default(),
                    sample_encoding: None,
                    sample_rate_hz: pcm_rate(),
                })
            }
        }
        "mp3" => Mp3(TtsRequestAura1TextVoiceOutputMp3 {
            format: Default::default(),
            sample_rate_hz: rate.map(|v| {
                assert_eq!(v, 22050);
                Default::default()
            }),
            bit_rate_bps: bitrate.map(|v| match v as u32 {
                32000 => {
                    TtsRequestAura1TextVoiceOutputMp3BitRateBps::Number32000(Default::default())
                }
                48000 => {
                    TtsRequestAura1TextVoiceOutputMp3BitRateBps::Number48000(Default::default())
                }
                _ => panic!("MP3 bitrate"),
            }),
        }),
        "ogg_opus" => OggOpus(TtsRequestAura1TextVoiceOutputOggOpus {
            format: Default::default(),
            sample_rate_hz: rate.map(|v| {
                assert_eq!(v, 48000);
                Default::default()
            }),
            bit_rate_bps: bitrate,
        }),
        "aac" => Aac(TtsRequestAura1TextVoiceOutputAac {
            format: Default::default(),
            sample_rate_hz: rate.map(|v| {
                assert_eq!(v, 22050);
                Default::default()
            }),
            bit_rate_bps: bitrate,
        }),
        "flac" => Flac(TtsRequestAura1TextVoiceOutputFlac {
            format: Default::default(),
            sample_rate_hz: rate.map(|v| {
                assert_eq!(v, 22050);
                TtsRequestAura1TextVoiceOutputFlacSampleRateHz::Number22050(Default::default())
            }),
        }),
        _ => panic!("fixture format"),
    }
}
fn request(raw: Raw<'_>) -> TtsRequest {
    let v = raw.object().unwrap();
    let language = v["language"].string().unwrap();
    let voice = v["voice"].string().unwrap();
    let model = v["model"].string().unwrap();
    macro_rules! build {
        ($variant:ident, $ty:ident, $voice:expr, $model:literal, $language:literal, $name:literal) => {{
            assert_eq!((&*model, &*language, &*voice), ($model, $language, $name));
            TtsRequest::$variant($ty {
                model: Default::default(),
                language: Default::default(),
                voice: $voice,
                text: v["text"].string().unwrap(),
                output: output(v["output"]),
                speed: v.get("speed").map(|v| v.number().unwrap()),
                model_improvement_opt_out: v.get("modelImprovementOptOut").map(|v| {
                    if v.boolean().unwrap() {
                        TtsRequestAura1TextVoiceModelImprovementOptOut::True(Default::default())
                    } else {
                        TtsRequestAura1TextVoiceModelImprovementOptOut::False(Default::default())
                    }
                }),
                tags: v.get("tags").map(|v| {
                    v.array()
                        .unwrap()
                        .into_iter()
                        .map(|v| v.string().unwrap())
                        .collect()
                }),
            })
        }};
    }
    match (model.as_str(), language.as_str()) {
        ("aura-1", "en") => build!(
            Aura1TextVoice,
            TtsRequestAura1TextVoice,
            TtsRequestAura1TextVoiceVoice::Asteria(Default::default()),
            "aura-1",
            "en",
            "asteria"
        ),
        ("aura-2", "en") => build!(
            Aura2TextVoicecfca101c,
            TtsRequestAura2TextVoicecfca101c,
            TtsRequestAura2TextVoicecfca101cVoice::Thalia(Default::default()),
            "aura-2",
            "en",
            "thalia"
        ),
        ("aura-2", "es") => build!(
            Aura2TextVoice2ee322ad,
            TtsRequestAura2TextVoice2ee322ad,
            TtsRequestAura2TextVoice2ee322adVoice::Agustina(Default::default()),
            "aura-2",
            "es",
            "agustina"
        ),
        ("aura-2", "de") => build!(
            Aura2TextVoice977d4f43,
            TtsRequestAura2TextVoice977d4f43,
            TtsRequestAura2TextVoice977d4f43Voice::Aurelia(Default::default()),
            "aura-2",
            "de",
            "aurelia"
        ),
        ("aura-2", "fr") => build!(
            Aura2TextVoice0e5dc20c,
            TtsRequestAura2TextVoice0e5dc20c,
            TtsRequestAura2TextVoice0e5dc20cVoice::Agathe(Default::default()),
            "aura-2",
            "fr",
            "agathe"
        ),
        ("aura-2", "it") => build!(
            Aura2TextVoice76db964c,
            TtsRequestAura2TextVoice76db964c,
            TtsRequestAura2TextVoice76db964cVoice::Cesare(Default::default()),
            "aura-2",
            "it",
            "cesare"
        ),
        ("aura-2", "ja") => build!(
            Aura2TextVoicefa928059,
            TtsRequestAura2TextVoicefa928059,
            TtsRequestAura2TextVoicefa928059Voice::Ama(Default::default()),
            "aura-2",
            "ja",
            "ama"
        ),
        ("aura-2", "nl") => build!(
            Aura2TextVoiceaf63b261,
            TtsRequestAura2TextVoiceaf63b261,
            TtsRequestAura2TextVoiceaf63b261Voice::Beatrix(Default::default()),
            "aura-2",
            "nl",
            "beatrix"
        ),
        _ => panic!("fixture model/language"),
    }
}
fn whole() -> TtsRequest {
    request(fixtures("http")[0].object().unwrap()["request"])
}

#[test]
fn shared_http_fixtures() {
    for fixture in fixtures("http") {
        let f = fixture.object().unwrap();
        let counts = Arc::new(Counts::default());
        let http = http(
            source(
                vec![Ok(vec![]), Ok(vec![0, 255]), Ok(vec![2])],
                &counts,
                false,
            ),
            200,
            "Audio/PCM; rate=24000",
        );
        let auth = auth();
        let mut stream = ready(synthesize(
            request(f["request"]),
            Options {
                auth: Some(&auth),
                transport: Some(&http),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        let wire = http.request.lock().unwrap().take().unwrap();
        assert_eq!(wire.method, "POST");
        assert_eq!(
            wire.headers,
            vec![
                ("authorization".into(), "Token key".into()),
                ("content-type".into(), "application/json".into())
            ]
        );
        let (base, query) = wire.url.split_once('?').unwrap();
        assert_eq!(base, "https://api.deepgram.com/v1/speak");
        let mut actual: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for pair in query.split('&') {
            let (key, val) = pair.split_once('=').unwrap();
            actual.entry(key.into()).or_default().push(val.into());
        }
        let expected: BTreeMap<String, Vec<String>> = f["query"]
            .object()
            .unwrap()
            .into_iter()
            .map(|(key, v)| {
                (
                    key,
                    v.array()
                        .unwrap()
                        .into_iter()
                        .map(|v| v.string().unwrap())
                        .collect(),
                )
            })
            .collect();
        assert_eq!(actual, expected);
        assert_eq!(
            parse(std::str::from_utf8(&wire.body).unwrap()),
            JsonValue::Object(BTreeMap::from([(
                "text".into(),
                value(f["request"].object().unwrap()["text"])
            )]))
        );
        assert_eq!(item(next(&mut stream).unwrap().unwrap()), parse("[0,255]"));
        assert_eq!(item(next(&mut stream).unwrap().unwrap()), parse("[2]"));
        assert!(next(&mut stream).is_none());
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert!(next(&mut stream).is_none());
    }
}

struct Script {
    steps: VecDeque<(JsonValue, Vec<Message>)>,
    incoming: VecDeque<Result<Message, TransportError>>,
    counts: Arc<Counts>,
    sent: Arc<Mutex<Vec<JsonValue>>>,
    pending_write: bool,
    close: bool,
    send_error: Option<TransportError>,
    flush_error: Option<TransportError>,
}
impl WebSocketLike for Script {
    fn start_send(self: Pin<&mut Self>, message: Message) -> Result<(), TransportError> {
        let s = self.get_mut();
        if let Some(error) = s.send_error.take() {
            return Err(error);
        }
        let Message::Text(text) = message else {
            panic!("expected text")
        };
        let actual = parse(&text);
        s.sent.lock().unwrap().push(actual.clone());
        if let Some((expected, incoming)) = s.steps.pop_front() {
            assert_eq!(actual, expected);
            s.incoming.extend(incoming.into_iter().map(Ok));
        }
        Ok(())
    }
    fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Result<(), TransportError>> {
        let s = self.get_mut();
        if let Some(error) = s.flush_error.take() {
            return Poll::Ready(Err(error));
        }
        if s.pending_write {
            Poll::Pending
        } else {
            Poll::Ready(Ok(()))
        }
    }
    fn poll_receive(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
    ) -> Poll<Option<Result<Message, TransportError>>> {
        let s = self.get_mut();
        s.incoming.pop_front().map_or(
            if s.close {
                Poll::Ready(None)
            } else {
                Poll::Pending
            },
            |v| Poll::Ready(Some(v)),
        )
    }
}
impl Drop for Script {
    fn drop(&mut self) {
        self.counts.drops.fetch_add(1, Ordering::SeqCst);
    }
}
fn script(counts: &Arc<Counts>) -> Script {
    Script {
        steps: VecDeque::new(),
        incoming: VecDeque::new(),
        counts: counts.clone(),
        sent: Arc::new(Mutex::new(Vec::new())),
        pending_write: false,
        close: false,
        send_error: None,
        flush_error: None,
    }
}
fn streaming(group: usize, input: StreamingInput<settings::Input>) -> TtsRequest {
    macro_rules! build {
        ($variant:ident, $ty:ident, $voice:expr) => {
            TtsRequest::$variant($ty {
                model: Default::default(),
                language: Default::default(),
                voice: $voice,
                text: input,
                speed: None,
                model_improvement_opt_out: None,
                output: TtsRequestAura1StreamingTextVoiceOutput::Pcm(
                    TtsRequestAura1TextVoiceOutputPcm {
                        format: Default::default(),
                        sample_encoding: None,
                        sample_rate_hz: None,
                    },
                ),
            })
        };
    }
    match group {
        0 => build!(
            Aura1StreamingTextVoice,
            TtsRequestAura1StreamingTextVoice,
            TtsRequestAura1TextVoiceVoice::Asteria(Default::default())
        ),
        1 => build!(
            Aura2StreamingTextVoice9a9ab9cb,
            TtsRequestAura2StreamingTextVoice9a9ab9cb,
            TtsRequestAura2TextVoicecfca101cVoice::Thalia(Default::default())
        ),
        2 => build!(
            Aura2StreamingTextVoiceb9577a7c,
            TtsRequestAura2StreamingTextVoiceb9577a7c,
            TtsRequestAura2TextVoice2ee322adVoice::Agustina(Default::default())
        ),
        3 => build!(
            Aura2StreamingTextVoicec96c6915,
            TtsRequestAura2StreamingTextVoicec96c6915,
            TtsRequestAura2TextVoice977d4f43Voice::Aurelia(Default::default())
        ),
        4 => build!(
            Aura2StreamingTextVoice3b7bc554,
            TtsRequestAura2StreamingTextVoice3b7bc554,
            TtsRequestAura2TextVoice0e5dc20cVoice::Agathe(Default::default())
        ),
        5 => build!(
            Aura2StreamingTextVoice141a5c9a,
            TtsRequestAura2StreamingTextVoice141a5c9a,
            TtsRequestAura2TextVoice76db964cVoice::Cesare(Default::default())
        ),
        6 => build!(
            Aura2StreamingTextVoicec5cb87b8,
            TtsRequestAura2StreamingTextVoicec5cb87b8,
            TtsRequestAura2TextVoicefa928059Voice::Ama(Default::default())
        ),
        7 => build!(
            Aura2StreamingTextVoice8f696e76,
            TtsRequestAura2StreamingTextVoice8f696e76,
            TtsRequestAura2TextVoiceaf63b261Voice::Beatrix(Default::default())
        ),
        _ => panic!("fixture group"),
    }
}
#[test]
fn shared_websocket_fixtures_all_model_language_groups() {
    for group in 0..8 {
        for fixture in fixtures("stream") {
            let f = fixture.object().unwrap();
            let counts = Arc::new(Counts::default());
            let input_counts = Arc::new(Counts::default());
            let mut socket = script(&counts);
            let mut expected_sent = Vec::new();
            for step in f["steps"].array().unwrap() {
                let step = step.object().unwrap();
                expected_sent.push(value(step["send"]));
                socket.steps.push_back((
                    value(step["send"]),
                    step["receive"]
                        .array()
                        .unwrap()
                        .into_iter()
                        .map(|v| {
                            if v.array().is_ok() {
                                Message::Binary(bytes(v))
                            } else {
                                Message::Text(v.text().into())
                            }
                        })
                        .collect(),
                ));
            }
            let sent = socket.sent.clone();
            let input = f["input"]
                .array()
                .unwrap()
                .into_iter()
                .map(|v| {
                    Ok(if let Ok(text) = v.string() {
                        settings::Input::String(text)
                    } else {
                        match v.object().unwrap()["command"].string().unwrap().as_str() {
                            "clear" => settings::Input::Clear(
                                TtsRequestAura1StreamingTextVoiceTextItemClear {
                                    command: Default::default(),
                                },
                            ),
                            "flush" => settings::Input::Flush(
                                TtsRequestAura1StreamingTextVoiceTextItemFlush {
                                    command: Default::default(),
                                },
                            ),
                            _ => panic!("fixture command"),
                        }
                    })
                })
                .collect();
            let auth = auth();
            let mut stream = ready(synthesize(
                streaming(group, source(input, &input_counts, false)),
                Options {
                    auth: Some(&auth),
                    web_socket: Some(Box::pin(socket)),
                    ..Default::default()
                },
            ))
            .unwrap();
            assert_eq!(input_counts.reads.load(Ordering::SeqCst), 0);
            let mut actual = Vec::new();
            while let Some(result) = next(&mut stream) {
                actual.push(item(result.unwrap()));
            }
            assert_eq!(JsonValue::Array(actual), value(f["items"]));
            assert_eq!(*sent.lock().unwrap(), expected_sent);
            assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
            assert_eq!(input_counts.drops.load(Ordering::SeqCst), 1);
        }
    }
}
