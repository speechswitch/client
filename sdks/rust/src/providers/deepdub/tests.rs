use super::*;
use crate::{
    generated::{auth::AuthAsync, deepdub::*},
    http::HttpResponse,
    json::Raw,
    runtime::{InputStream, JsonValue, StreamingInput},
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
struct Body {
    chunks: VecDeque<Result<Vec<u8>, TransportError>>,
    counts: Arc<Counts>,
    stall: bool,
}
impl InputStream<Vec<u8>> for Body {
    fn poll_next(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
    ) -> Poll<Option<Result<Vec<u8>, TransportError>>> {
        let s = self.get_mut();
        s.counts.reads.fetch_add(1, Ordering::SeqCst);
        match s.chunks.pop_front() {
            Some(v) => Poll::Ready(Some(v)),
            None if s.stall => Poll::Pending,
            None => Poll::Ready(None),
        }
    }
}
impl Drop for Body {
    fn drop(&mut self) {
        self.counts.drops.fetch_add(1, Ordering::SeqCst);
    }
}
fn body(
    chunks: Vec<Result<Vec<u8>, TransportError>>,
    counts: &Arc<Counts>,
    stall: bool,
) -> StreamingInput<Vec<u8>> {
    Box::pin(Body {
        chunks: chunks.into(),
        counts: counts.clone(),
        stall,
    })
}
struct Http {
    requests: Mutex<Vec<HttpRequest>>,
    response: Mutex<Option<Result<HttpResponse, TransportError>>>,
    stall: bool,
    drops: Arc<Counts>,
}
impl Http {
    fn new(body: StreamingInput<Vec<u8>>) -> Self {
        Self {
            requests: Mutex::new(Vec::new()),
            response: Mutex::new(Some(Ok(HttpResponse {
                status: 200,
                headers: Vec::new(),
                body,
            }))),
            stall: false,
            drops: Arc::new(Counts::default()),
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
            let _guard = Guard(self.drops.clone());
            if self.stall {
                std::future::pending::<()>().await;
            }
            self.response.lock().unwrap().take().unwrap()
        })
    }
}
fn auth() -> Auth {
    Auth {
        deepdub: Some(AuthAsync {
            api_key: Some("key".into()),
        }),
        async_: None,
        aws: None,
        camb: None,
        cartesia: None,
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
fn options<'a>(auth: &'a Auth, http: &'a Http) -> Options<'a> {
    Options {
        auth: Some(auth),
        transport: Some(http),
        request_id: Some("trace"),
        ..Default::default()
    }
}
fn ready<T>(future: impl Future<Output = T>) -> T {
    let mut future = std::pin::pin!(future);
    let counts = Arc::new(Counts::default());
    let waker = Waker::from(counts.clone());
    let mut cx = Context::from_waker(&waker);
    for _ in 0..10000 {
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
fn next(s: &mut Stream) -> Option<Result<Vec<u8>, TransportError>> {
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
fn rate(n: u32) -> TtsRequestOg11Text188d3251OutputSampleRateHz {
    use TtsRequestOg11Text188d3251OutputSampleRateHz::*;
    match n {
        8000 => Number8000(Default::default()),
        16000 => Number16000(Default::default()),
        22050 => Number22050(Default::default()),
        24000 => Number24000(Default::default()),
        32000 => Number32000(Default::default()),
        36000 => Number36000(Default::default()),
        44100 => Number44100(Default::default()),
        48000 => Number48000(Default::default()),
        _ => panic!("unexpected fixture rate"),
    }
}
fn output(format: &str, sample_rate_hz: Option<u32>) -> TtsRequestOg11Text188d3251Output {
    use TtsRequestOg11Text188d3251OutputFormat::*;
    TtsRequestOg11Text188d3251Output {
        format: match format {
            "mp3" => Mp3(Default::default()),
            "mulaw" => Mulaw(Default::default()),
            "ogg_opus" => OggOpus(Default::default()),
            _ => panic!("unexpected fixture format"),
        },
        sample_rate_hz: sample_rate_hz.map(rate),
    }
}
fn whole() -> TtsRequestTextVoiceb776b412 {
    TtsRequestTextVoiceb776b412 {
        model: TtsRequestTextee721c85Model::PhantomX32(Default::default()),
        text: "Hello".into(),
        voice: "custom".into(),
        language: "en-US".into(),
        output: output("mp3", None),
        reference_audio: None,
        accent_blend: None,
        audio_enhancement: None,
        automatic_gain_control: None,
        delivery_reference: None,
        delivery_variance: None,
        duration_stretching: None,
        processing_priority: None,
        speaker_gender: None,
        speed: None,
        temperature: None,
        voice_boost: None,
    }
}
fn request() -> TtsRequest {
    TtsRequest::TextVoiceb776b412(whole())
}
fn boolean(v: bool) -> TtsRequestOg11Text188d3251AudioEnhancement {
    if v {
        TtsRequestOg11Text188d3251AudioEnhancement::True(Default::default())
    } else {
        TtsRequestOg11Text188d3251AudioEnhancement::False(Default::default())
    }
}
fn fixture_request(index: usize, raw: Raw<'_>) -> TtsRequest {
    let fields = raw.object().unwrap();
    let string = |key| fields.get(key).map(|v| v.string().unwrap());
    let number = |key| fields.get(key).map(|v| v.number().unwrap());
    let flag = |key| fields.get(key).map(|v| boolean(v.boolean().unwrap()));
    let reference = || {
        fields.get("referenceAudio").map(|v| {
            v.array()
                .unwrap()
                .iter()
                .map(|v| v.number().unwrap() as u8)
                .collect()
        })
    };
    let format = fields["output"].object().unwrap();
    let output = output(
        &format["format"].string().unwrap(),
        format
            .get("sampleRateHz")
            .map(|v| v.number().unwrap() as u32),
    );
    let model = || match string("model").unwrap().as_str() {
        "og-1.1" => TtsRequestTextee721c85Model::Og11(Default::default()),
        "lightning-2.5" => TtsRequestTextee721c85Model::Lightning25(Default::default()),
        "phantom-x-3.2" => TtsRequestTextee721c85Model::PhantomX32(Default::default()),
        _ => panic!("unexpected fixture model"),
    };
    macro_rules! build {
        ($variant:ident, $ty:ident, $($key:ident: $val:expr),+ $(,)?) => {
            TtsRequest::$variant($ty {
                text: string("text").unwrap(), language: string("language").unwrap(), output,
                accent_blend: fields.get("accentBlend").map(|v| { let v = v.object().unwrap(); TtsRequestOg11Text188d3251AccentBlend { base_locale: v["baseLocale"].string().unwrap(), target_locale: v["targetLocale"].string().unwrap(), ratio: v["ratio"].number().unwrap() } }),
                audio_enhancement: flag("audioEnhancement"), automatic_gain_control: flag("automaticGainControl"),
                delivery_reference: string("deliveryReference"), delivery_variance: number("deliveryVariance"),
                duration_stretching: flag("durationStretching"), temperature: number("temperature"), voice_boost: flag("voiceBoost"),
                processing_priority: string("processingPriority").map(|v| match v.as_str() {
                    "standard" => TtsRequestOg11Text188d3251ProcessingPriority::Standard(Default::default()),
                    "realtime" => TtsRequestOg11Text188d3251ProcessingPriority::Realtime(Default::default()), _ => panic!("priority") }),
                speaker_gender: string("speakerGender").map(|v| match v.as_str() {
                    "female" => TtsRequestOg11Text188d3251SpeakerGender::Female(Default::default()),
                    "male" => TtsRequestOg11Text188d3251SpeakerGender::Male(Default::default()), _ => panic!("gender") }),
                $($key: $val),+
            })
        };
    }
    match index {
        0 => {
            build!(TextVoiceb776b412, TtsRequestTextVoiceb776b412, model: model(), voice: string("voice").unwrap(), reference_audio: reference(), speed: number("speed"))
        }
        1 => {
            build!(TextVoice5ce3f477, TtsRequestTextVoice5ce3f477, model: model(), voice: string("voice").unwrap(), reference_audio: reference(), target_duration_ms: number("targetDurationMs").unwrap())
        }
        2 => {
            build!(Text8086f935, TtsRequestText8086f935, model: model(), voice: string("voice"), reference_audio: reference().unwrap(), speed: number("speed"))
        }
        3 => {
            build!(Textee721c85, TtsRequestTextee721c85, model: model(), voice: string("voice"), reference_audio: reference().unwrap(), target_duration_ms: number("targetDurationMs").unwrap())
        }
        4 => {
            build!(Og11TextVoice7f540c02, TtsRequestOg11TextVoice7f540c02, model: Default::default(), voice: string("voice").unwrap(), reference_audio: reference(), speed: number("speed"), random_seed: number("randomSeed").unwrap())
        }
        5 => {
            build!(Og11TextVoiceafafd490, TtsRequestOg11TextVoiceafafd490, model: Default::default(), voice: string("voice").unwrap(), reference_audio: reference(), target_duration_ms: number("targetDurationMs").unwrap(), random_seed: number("randomSeed").unwrap())
        }
        6 => {
            build!(Og11Text63cdfcb0, TtsRequestOg11Text63cdfcb0, model: Default::default(), voice: string("voice"), reference_audio: reference().unwrap(), speed: number("speed"), random_seed: number("randomSeed").unwrap())
        }
        7 => {
            build!(Og11Text188d3251, TtsRequestOg11Text188d3251, model: Default::default(), voice: string("voice"), reference_audio: reference().unwrap(), target_duration_ms: number("targetDurationMs").unwrap(), random_seed: number("randomSeed").unwrap())
        }
        _ => panic!("unexpected fixture"),
    }
}

#[test]
fn shared_wire_fixtures_and_owned_lazy_audio() {
    let fixtures = Raw::parse_exact(include_str!("../../../../fixtures/deepdub.json"))
        .unwrap()
        .array()
        .unwrap();
    assert_eq!(fixtures.len(), 8);
    let auth = auth();
    for (index, fixture) in fixtures.into_iter().enumerate() {
        let fixture = fixture.object().unwrap();
        let counts = Arc::new(Counts::default());
        let http = Http::new(body(vec![Ok(vec![0, 255]), Ok(vec![42])], &counts, false));
        let mut stream = ready(synthesize(
            fixture_request(index, fixture["request"]),
            options(&auth, &http),
        ))
        .unwrap();
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        {
            let sent = http.requests.lock().unwrap();
            assert_eq!(sent.len(), 1);
            assert_eq!(
                (&*sent[0].method, &*sent[0].url),
                ("POST", "https://restapi.deepdub.ai/api/v1/tts")
            );
            assert_eq!(
                sent[0].headers,
                [
                    ("x-api-key".into(), "key".into()),
                    ("content-type".into(), "application/json".into())
                ]
            );
            assert_eq!(
                parse(std::str::from_utf8(&sent[0].body).unwrap()),
                value(fixture["wire"]),
                "fixture {index}"
            );
        }
        drop(http); // The returned stream cannot borrow the transport.
        let first = next(&mut stream).unwrap().unwrap();
        assert_eq!(first, [0, 255]);
        assert_eq!(next(&mut stream).unwrap().unwrap(), [42]);
        assert_eq!(first, [0, 255]);
        assert!(next(&mut stream).is_none());
        assert!(next(&mut stream).is_none());
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

fn opus(segments: u8) -> Vec<u8> {
    let mut bytes = vec![0; 27 + segments as usize];
    bytes[..5].copy_from_slice(b"OggS\0");
    bytes[26] = segments;
    bytes.extend_from_slice(b"OpusHead");
    bytes
}

#[test]
fn all_format_rates_and_codec_byte_splits() {
    let auth = auth();
    for format in ["mp3", "mulaw", "ogg_opus"] {
        for rate in [8000, 16000, 22050, 24000, 32000, 36000, 44100, 48000] {
            let mut r = whole();
            r.output = output(format, Some(rate));
            let counts = Arc::new(Counts::default());
            let http = Http::new(body(vec![Ok(opus(1))], &counts, false));
            let mut stream = ready(synthesize(
                TtsRequest::TextVoiceb776b412(r),
                options(&auth, &http),
            ))
            .unwrap();
            let sent = http.requests.lock().unwrap();
            let wire = Raw::parse_exact(std::str::from_utf8(&sent[0].body).unwrap())
                .unwrap()
                .object()
                .unwrap();
            assert_eq!(
                wire["format"].string().unwrap(),
                if format == "ogg_opus" { "opus" } else { format }
            );
            assert_eq!(wire["sampleRate"].number().unwrap(), rate as f64);
            assert_eq!(next(&mut stream).unwrap().unwrap(), opus(1));
            drop(stream);
            assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
            assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        }
    }
    for segments in [1, 255] {
        let bytes = opus(segments);
        for split in 0..=bytes.len() {
            let counts = Arc::new(Counts::default());
            let chunks: Vec<_> = [
                bytes[..split].to_vec(),
                bytes[split..].to_vec(),
                vec![0, 255],
            ]
            .into_iter()
            .map(Ok)
            .collect();
            let mut stream = Stream::new(
                HttpResponse {
                    status: 200,
                    headers: vec![],
                    body: body(chunks, &counts, false),
                },
                "trace".into(),
                true,
                1024,
            );
            let mut actual = Vec::new();
            while let Some(chunk) = next(&mut stream) {
                actual.push(chunk.unwrap());
            }
            assert_eq!(
                actual,
                [
                    bytes[..split].to_vec(),
                    bytes[split..].to_vec(),
                    vec![0, 255]
                ]
                .into_iter()
                .filter(|v| !v.is_empty())
                .collect::<Vec<_>>(),
                "segments {segments}, split {split}"
            );
            assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        }
    }
}

#[test]
fn malformed_codec_never_yields_audio() {
    let mut invalid = opus(1);
    invalid[0] = b'X';
    let mut version = opus(1);
    version[4] = 1;
    let mut vorbis = opus(1);
    vorbis[28..36].copy_from_slice(b"\x01vorbis\0");
    for (bytes, expected) in [
        (vec![], "Deepdub returned a truncated Ogg Opus header"),
        (opus(1)[..35].to_vec(), "Deepdub returned a truncated Ogg Opus header"),
        (invalid, "Deepdub did not return an Ogg Opus stream"),
        (version, "Deepdub did not return an Ogg Opus stream"),
        (opus(0), "Deepdub did not return an Ogg Opus stream"),
        (vorbis, "Deepdub returned a different Ogg codec (the trial API has returned Vorbis) for requested Opus audio"),
    ] {
        let counts = Arc::new(Counts::default());
        let mut stream = Stream::new(HttpResponse { status: 200, headers: vec![], body: body(vec![Ok(bytes)], &counts, false) }, "trace".into(), true, 1024);
        assert_eq!(next(&mut stream).unwrap().unwrap_err().to_string(), expected);
        assert!(next(&mut stream).is_none());
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}
