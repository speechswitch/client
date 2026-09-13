use super::*;
mod lifecycle;
mod models;
use crate::{
    generated::{auth::AuthAsync, rime::*},
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
        rime: Some(AuthAsync {
            api_key: Some("fixture".into()),
        }),
        smallest_ai: None,
        typecast: None,
        vocu: None,
        voice_ai: None,
        xai: None,
    }
}
fn request() -> TtsRequestCodaTextVoicef75e9756 {
    TtsRequestCodaTextVoicef75e9756 {
        language: None,
        model: Default::default(),
        output: None,
        segmentation: None,
        speed: None,
        text: "Hello".into(),
        timestamp_granularity: None,
        voice: "custom-uuid".into(),
    }
}
fn whole() -> TtsRequest {
    TtsRequest::CodaTextVoicef75e9756(request())
}
fn streaming(text: StreamingInput<TtsRequestCodaStreamingTextVoice84ec2db1TextItem>) -> TtsRequest {
    TtsRequest::CodaStreamingTextVoice33f4bd25(TtsRequestCodaStreamingTextVoice33f4bd25 {
        language: None,
        model: Default::default(),
        output: None,
        segmentation: None,
        speed: None,
        text,
        timestamp_granularity: None,
        voice: "custom-uuid".into(),
    })
}
fn value(text: &str) -> Value {
    fixture(Raw::parse_exact(text).unwrap())
}
#[derive(Debug, PartialEq)]
enum Item {
    Bytes(Vec<u8>),
    Envelope(
        Option<String>,
        Option<Vec<u8>>,
        Vec<(String, f64, Option<f64>)>,
    ),
    Clear,
    Batch(Option<String>),
    Done,
}
fn item(value: SynthesisItem) -> Item {
    match value {
        SynthesisItem::Bytes(b) => Item::Bytes(b),
        SynthesisItem::Ordered(v) => {
            assert_eq!(v.correlation.value(), "ordered");
            assert_eq!(v.timestamp_origin.value(), "synthesis");
            Item::Envelope(
                v.input_group_id,
                v.audio,
                v.timestamps
                    .into_iter()
                    .map(|v| {
                        assert_eq!(v.kind.value(), "word");
                        assert!(v.source.is_none());
                        (v.value, v.start_time_ms, v.end_time_ms)
                    })
                    .collect(),
            )
        }
        SynthesisItem::Clear(v) => {
            assert_eq!(v.event.value(), "clear");
            Item::Clear
        }
        SynthesisItem::Batch(v) => {
            assert_eq!(v.event.value(), "batch");
            Item::Batch(v.input_group_id)
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
const FIXTURES: &str = include_str!("../../../../fixtures/rime.json");

struct SocketState {
    sent: Vec<String>,
    replies: VecDeque<Result<Message, TransportError>>,
    automatic: bool,
    flush_pending: bool,
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
        if s.automatic {
            let object = Raw::parse_exact(&text).unwrap().object().unwrap();
            if object.get("text").is_some() {
                let id = object["contextId"].string().unwrap();
                s.replies.push_back(Ok(Message::Text(format!(
                    "{{\"type\":\"chunk\",\"contextId\":\"{id}\",\"data\":\"AP8=\"}}"
                ))));
            }
            if object
                .get("operation")
                .and_then(|v| v.string().ok())
                .as_deref()
                == Some("eos")
            {
                s.closed = true;
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
fn live(
    text: StreamingInput<TtsRequestCodaStreamingTextVoice84ec2db1TextItem>,
    socket: Socket,
    timed: bool,
) -> Stream {
    let auth = auth();
    let mut r = streaming(text);
    if let TtsRequest::CodaStreamingTextVoice33f4bd25(v) = &mut r {
        if timed {
            v.timestamp_granularity = Some(Default::default());
        }
    }
    ready(synthesize(
        r,
        Options {
            auth: Some(&auth),
            web_socket: Some(socket),
            entropy: Some(&entropy),
            ..Default::default()
        },
    ))
    .unwrap()
}
fn text(v: &str) -> TtsRequestCodaStreamingTextVoice84ec2db1TextItem {
    TtsRequestCodaStreamingTextVoice84ec2db1TextItem::String(v.into())
}
fn flush() -> TtsRequestCodaStreamingTextVoice84ec2db1TextItem {
    TtsRequestCodaStreamingTextVoice84ec2db1TextItem::Flush(
        TtsRequestCodaStreamingTextVoice84ec2db1TextItemFlush {
            command: Default::default(),
        },
    )
}
fn clear() -> TtsRequestCodaStreamingTextVoice84ec2db1TextItem {
    TtsRequestCodaStreamingTextVoice84ec2db1TextItem::Clear(
        TtsRequestCodaStreamingTextVoice84ec2db1TextItemClear {
            command: Default::default(),
        },
    )
}
fn sent(stream: &mut Stream, socket: &Arc<Mutex<SocketState>>, count: usize) -> String {
    for _ in 0..1000 {
        if socket.lock().unwrap().sent.len() >= count {
            return socket.lock().unwrap().sent[count - 1].clone();
        }
        tick(stream)
    }
    panic!("send not reached")
}
fn id(message: &str) -> String {
    Raw::parse_exact(message).unwrap().object().unwrap()["contextId"]
        .string()
        .unwrap()
}
fn packet(s: &Arc<Mutex<SocketState>>, wire: &str) {
    s.lock()
        .unwrap()
        .replies
        .push_back(Ok(Message::Text(wire.into())));
}

fn fixture_requests() -> Vec<TtsRequest> {
    let arabic = TtsRequest::CodaTextVoice50d85478(TtsRequestCodaTextVoice50d85478 {
        voice: "custom-uuid".into(),
        text: "مرحبا".into(),
        model: Default::default(),
        language: TtsRequestCodaStreamingTextVoice84ec2db1Language::Ar(Default::default()),
        speed: Some(2.5),
        segmentation: None,
        output: Some(
            TtsRequestCodaStreamingTextVoice84ec2db1Output::Object60a95a19(
                TtsRequestCodaStreamingTextVoice84ec2db1OutputObject60a95a19 {
                    format:
                        TtsRequestCodaStreamingTextVoice84ec2db1OutputObject60a95a19Format::WebmOpus(
                            Default::default(),
                        ),
                    sample_rate_hz: Some(48000.0),
                },
            ),
        ),
    });
    let english = TtsRequest::MistV3TextVoice2a5bc5c5(TtsRequestMistV3TextVoice2a5bc5c5 {
        voice: "cove".into(),
        text: "[Hi] <200> {k1Ast0xm}".into(),
        model: Default::default(),
        language: None,
        speed: Some(2.0),
        segmentation: None,
        timestamp_granularity: None,
        text_markup: Some(TtsRequestMistV2StreamingTextVoice03cc8904TextMarkup {
            pauses: Some(
                TtsRequestMistV2StreamingTextVoice03cc8904TextMarkupPauses::True(Default::default()),
            ),
            phonemes: Some(
                TtsRequestMistV2StreamingTextVoice03cc8904TextMarkupPauses::True(Default::default()),
            ),
            speeds: Some(vec![2.0, 0.5]),
        }),
        output: Some(
            TtsRequestCodaStreamingTextVoice84ec2db1Output::Objectb2df2f24(
                TtsRequestCodaStreamingTextVoice84ec2db1OutputObjectb2df2f24 {
                    format: TtsRequestCodaStreamingTextVoice84ec2db1OutputObjectb2df2f24Format::Wav(
                        Default::default(),
                    ),
                    sample_rate_hz: None,
                    byte_order: None,
                    sample_encoding: None,
                },
            ),
        ),
    });
    let spanish = TtsRequest::MistV3TextVoice3fb6eaa2(TtsRequestMistV3TextVoice3fb6eaa2 {
        voice: "custom-uuid".into(),
        text: "Hola".into(),
        model: Default::default(),
        language: Default::default(),
        speed: None,
        segmentation: None,
        timestamp_granularity: None,
        text_markup: None,
        output: Some(
            TtsRequestCodaStreamingTextVoice84ec2db1Output::Object60a95a19(
                TtsRequestCodaStreamingTextVoice84ec2db1OutputObject60a95a19 {
                    format:
                        TtsRequestCodaStreamingTextVoice84ec2db1OutputObject60a95a19Format::OggOpus(
                            Default::default(),
                        ),
                    sample_rate_hz: None,
                },
            ),
        ),
    });
    let german = TtsRequest::MistV2TextVoice20785ce4(TtsRequestMistV2TextVoice20785ce4 {
        voice: "custom-uuid".into(),
        text: "Hallo".into(),
        model: Default::default(),
        language: TtsRequestMistV2StreamingTextVoice03cc8904Language::De(Default::default()),
        speed: None,
        segmentation: None,
        text_markup: None,
        text_normalization: None,
        output: None,
    });
    let legacy_spanish = TtsRequest::MistV2TextVoiceae274411(TtsRequestMistV2TextVoiceae274411 {
        voice: "custom-uuid".into(),
        text: "Hola".into(),
        model: Default::default(),
        language: Some(TtsRequestCodaStreamingTextVoice33f4bd25Language::Es(
            Default::default(),
        )),
        speed: Some(2.0),
        segmentation: None,
        timestamp_granularity: None,
        text_normalization: Some(
            TtsRequestMistV2StreamingTextVoice03cc8904TextMarkupPauses::False(Default::default()),
        ),
        text_markup: Some(TtsRequestMistV2StreamingTextVoice03cc8904TextMarkup {
            pauses: None,
            phonemes: Some(
                TtsRequestMistV2StreamingTextVoice03cc8904TextMarkupPauses::True(Default::default()),
            ),
            speeds: None,
        }),
        output: Some(TtsRequestMistV2StreamingTextVoice03cc8904Output::Mp3(
            TtsRequestMistV2StreamingTextVoice03cc8904OutputMp3 {
                format: Default::default(),
                sample_rate_hz: None,
            },
        )),
    });
    let french = TtsRequest::MistV2TextVoice20785ce4(TtsRequestMistV2TextVoice20785ce4 {
        voice: "custom-uuid".into(),
        text: "Bonjour".into(),
        model: Default::default(),
        language: TtsRequestMistV2StreamingTextVoice03cc8904Language::Fr(Default::default()),
        speed: None,
        segmentation: None,
        text_markup: None,
        text_normalization: None,
        output: Some(TtsRequestMistV2StreamingTextVoice03cc8904Output::Mulaw(
            TtsRequestMistV2StreamingTextVoice03cc8904OutputMulaw {
                format: Default::default(),
                sample_rate_hz: None,
            },
        )),
    });
    vec![
        whole(),
        arabic,
        english,
        spanish,
        german,
        legacy_spanish,
        french,
    ]
}

#[test]
fn shared_http_requests_and_audio_are_exact() {
    let fixtures = Raw::parse_exact(FIXTURES).unwrap().object().unwrap();
    let fixtures = fixtures["requests"].array().unwrap();
    let requests = fixture_requests();
    assert_eq!(requests.len(), fixtures.len());
    for (request, f) in requests.into_iter().zip(fixtures) {
        let f = f.object().unwrap();
        let auth = auth();
        let (backend, counts) = http(vec![vec![], vec![0, 255], vec![128]]);
        let mut stream = ready(synthesize(
            request,
            Options {
                auth: Some(&auth),
                transport: Some(&backend),
                base_url: Some("https://example.test/proxy%2Fraw/?tenant=a%2Bb"),
                ..Default::default()
            },
        ))
        .unwrap();
        let sent = backend.requests.lock().unwrap();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].method, "POST");
        assert_eq!(
            sent[0].url,
            "https://example.test/proxy%2Fraw/v1/rime-tts?tenant=a%2Bb"
        );
        assert_eq!(
            sent[0].headers,
            vec![
                ("Authorization".into(), "Bearer fixture".into()),
                ("Content-Type".into(), "application/json".into()),
                ("Accept".into(), f["accept"].string().unwrap())
            ]
        );
        assert_eq!(
            value(std::str::from_utf8(&sent[0].body).unwrap()),
            fixture(f["body"])
        );
        drop(sent);
        drop(backend);
        drop(auth);
        assert_eq!(
            item(pull(&mut stream).unwrap().unwrap()),
            Item::Bytes(vec![0, 255])
        );
        assert_eq!(
            item(pull(&mut stream).unwrap().unwrap()),
            Item::Bytes(vec![128])
        );
        assert_eq!(item(pull(&mut stream).unwrap().unwrap()), Item::Done);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert!(pull(&mut stream).is_none());
    }
}
#[test]
fn shared_invalid_frames_are_terminal() {
    let root = Raw::parse_exact(FIXTURES).unwrap().object().unwrap();
    for f in root["invalidFrames"].array().unwrap() {
        let f = f.object().unwrap();
        let (socket, state) = socket(false);
        let (input, counts, _) = body(vec![Ok(text("Hello"))], false);
        packet(&state, &f["wire"].string().unwrap());
        let mut stream = live(input, socket, false);
        assert_eq!(
            pull(&mut stream).unwrap().err().unwrap().to_string(),
            f["error"].string().unwrap()
        );
        assert!(pull(&mut stream).is_none());
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(state.lock().unwrap().drops, 1);
    }
}
#[test]
fn clear_batch_and_independent_timestamp_origins() {
    let (input, counts, source) = body(
        vec![
            Ok(text("Hello")),
            Ok(flush()),
            Ok(flush()),
            Ok(clear()),
            Ok(text("Again")),
        ],
        false,
    );
    let (socket, state) = socket(false);
    let mut stream = live(input, socket, true);
    let old = id(&sent(&mut stream, &state, 1));
    assert_eq!(
        value(&sent(&mut stream, &state, 2)),
        value("{\"operation\":\"flush\"}")
    );
    assert_eq!(
        value(&sent(&mut stream, &state, 3)),
        value("{\"operation\":\"flush\"}")
    );
    assert_eq!(item(pull(&mut stream).unwrap().unwrap()), Item::Clear);
    let fresh = id(&sent(&mut stream, &state, 5));
    assert_eq!(fresh, format!("{}1", old.strip_suffix('0').unwrap()));
    for wire in [
        format!("{{\"type\":\"chunk\",\"contextId\":\"{old}\",\"data\":\"AQ==\"}}"),
        format!("{{\"type\":\"done\",\"contextId\":\"{old}\"}}"),
        format!("{{\"type\":\"timestamps\",\"contextId\":\"{old}\",\"word_timestamps\":{{\"words\":[\"stale\"],\"start\":[0],\"end\":[1]}}}}"),
        format!("{{\"type\":\"chunk\",\"contextId\":\"{fresh}\",\"data\":\"AP8=\"}}"),
    ] {
        packet(&state, &wire)
    }
    assert_eq!(
        item(pull(&mut stream).unwrap().unwrap()),
        Item::Envelope(Some(fresh.clone()), Some(vec![0, 255]), vec![])
    );
    for word in ["Again", "Next"] {
        packet(&state,&format!("{{\"type\":\"timestamps\",\"contextId\":\"{fresh}\",\"word_timestamps\":{{\"words\":[\"{word}\"],\"start\":[0],\"end\":[0.125]}}}}"));
        assert_eq!(
            item(pull(&mut stream).unwrap().unwrap()),
            Item::Envelope(
                Some(fresh.clone()),
                None,
                vec![(word.into(), 0.0, Some(125.0))]
            )
        );
    }
    for label in [&fresh, "native-label"] {
        packet(
            &state,
            &format!("{{\"type\":\"done\",\"contextId\":\"{label}\"}}"),
        );
        assert_eq!(
            item(pull(&mut stream).unwrap().unwrap()),
            Item::Batch(Some(label.into()))
        );
    }
    source.lock().unwrap().ended = true;
    assert_eq!(
        value(&sent(&mut stream, &state, 6)),
        value("{\"operation\":\"eos\"}")
    );
    state.lock().unwrap().closed = true;
    assert_eq!(item(pull(&mut stream).unwrap().unwrap()), Item::Done);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(state.lock().unwrap().drops, 1);
}
#[test]
fn null_after_clear_fails_and_native_errors_are_global() {
    for (wire, message) in [
        (
            "{\"type\":\"chunk\",\"contextId\":null,\"data\":\"AQ==\"}",
            "Rime omitted context identity after clear; stale audio cannot be distinguished",
        ),
        (
            "{\"type\":\"error\",\"message\":\"native failure\"}",
            "native failure",
        ),
    ] {
        let (input, _, _) = body(vec![Ok(clear())], false);
        let (socket, state) = socket(false);
        let mut stream = live(input, socket, false);
        assert_eq!(item(pull(&mut stream).unwrap().unwrap()), Item::Clear);
        packet(&state, wire);
        let error = pull(&mut stream).unwrap().err().unwrap();
        assert_eq!(error.to_string(), message);
        if message == "native failure" {
            assert_eq!(error.downcast_ref::<Error>().unwrap().status, None)
        }
        assert_eq!(state.lock().unwrap().drops, 1);
    }
}
#[test]
fn whole_text_socket_and_empty_eos_release_owned_stream() {
    let auth = auth();
    let (socket, state) = socket(true);
    let mut stream = ready(synthesize(
        whole(),
        Options {
            auth: Some(&auth),
            web_socket: Some(socket),
            entropy: Some(&entropy),
            ..Default::default()
        },
    ))
    .unwrap();
    drop(auth);
    assert_eq!(
        item(pull(&mut stream).unwrap().unwrap()),
        Item::Bytes(vec![0, 255])
    );
    assert_eq!(item(pull(&mut stream).unwrap().unwrap()), Item::Done);
    assert!(pull(&mut stream).is_none());
    assert_eq!(state.lock().unwrap().drops, 1);
    let (input, counts, _) = body(vec![], true);
    let (socket, state) = self::socket(false);
    let mut stream = live(input, socket, false);
    sent(&mut stream, &state, 1);
    packet(&state, "{\"type\":\"done\",\"contextId\":null}");
    assert_eq!(item(pull(&mut stream).unwrap().unwrap()), Item::Batch(None));
    state.lock().unwrap().closed = true;
    assert_eq!(item(pull(&mut stream).unwrap().unwrap()), Item::Done);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(state.lock().unwrap().drops, 1);
}
#[test]
fn backpressured_write_reads_audio_without_input_lookahead() {
    let (input, counts, _) = body(vec![Ok(text("Hello")), Ok(text("Later"))], false);
    let (socket, state) = socket(false);
    state.lock().unwrap().flush_pending = true;
    let mut stream = live(input, socket, false);
    sent(&mut stream, &state, 1);
    packet(
        &state,
        "{\"type\":\"chunk\",\"contextId\":null,\"data\":\"AQ==\"}",
    );
    assert_eq!(
        item(pull(&mut stream).unwrap().unwrap()),
        Item::Bytes(vec![1])
    );
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    drop(stream);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(state.lock().unwrap().drops, 1);
}
#[test]
fn early_and_buffered_close_cannot_be_relabelled_by_eos() {
    for batch in [false, true] {
        let (input, _, source) = body(vec![], false);
        let (socket, state) = socket(false);
        let mut stream = live(input, socket, false);
        if batch {
            packet(&state, "{\"type\":\"done\",\"contextId\":null}");
            assert_eq!(item(pull(&mut stream).unwrap().unwrap()), Item::Batch(None));
        }
        state.lock().unwrap().closed = true;
        source.lock().unwrap().ended = true;
        assert_eq!(
            pull(&mut stream).unwrap().err().unwrap().to_string(),
            "Rime WebSocket closed before clean end-of-stream"
        );
        assert!(state.lock().unwrap().sent.is_empty());
    }
}
