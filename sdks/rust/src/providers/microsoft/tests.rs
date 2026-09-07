use super::*;
use crate::{
    generated::{auth::AuthMicrosoft, microsoft::*, microsoft_output::*},
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
mod formats;
mod lifecycle;
mod models;

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
            Some(v) => Poll::Ready(Some(v)),
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
                "pending without wake"
            ),
        }
    }
    panic!("did not complete")
}
fn next(stream: &mut Stream) -> Option<Result<SynthesisItem, TransportError>> {
    ready(poll_fn(|cx| Pin::new(&mut *stream).poll_next(cx)))
}
fn fixtures() -> BTreeMap<String, Raw<'static>> {
    Raw::parse(include_str!("../../../../fixtures/microsoft.json"))
        .unwrap()
        .object()
        .unwrap()
}
fn auth() -> Auth {
    Auth {
        microsoft: Some(AuthMicrosoft {
            api_key: Some("key".into()),
            access_token: None,
            region: Some("eastus".into()),
        }),
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
fn entropy(bytes: &mut [u8]) -> Result<(), TransportError> {
    for (i, b) in bytes.iter_mut().enumerate() {
        *b = i as u8;
    }
    Ok(())
}
fn request() -> TtsRequestTextVoice4ff226b4 {
    TtsRequestTextVoice4ff226b4 {
        text: "Hi".into(),
        voice: "en-US-AvaNeural".into(),
        emotion: None,
        input_type: None,
        language: None,
        model: None,
        output: None,
        pitch_semitones: None,
        speed: None,
        volume_scale: None,
    }
}
fn streaming(input: StreamingInput<String>) -> TtsRequestStreamingTextVoicee86a65c0 {
    TtsRequestStreamingTextVoicee86a65c0 {
        text: input,
        voice: "en-US-AvaNeural".into(),
        emotion: None,
        input_type: None,
        language: None,
        lexicon_url: None,
        model: None,
        output: None,
        pitch_semitones: None,
        preferred_languages: None,
        speed: None,
        timestamp_granularity: None,
        volume_scale: None,
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Sent {
    path: String,
    id: String,
    body: String,
}
fn sent(message: Message) -> Sent {
    let Message::Text(text) = message else {
        panic!("expected text")
    };
    let (headers, body) = text.split_once("\r\n\r\n").unwrap();
    let fields: BTreeMap<_, _> = headers
        .split("\r\n")
        .map(|v| v.split_once(": ").unwrap())
        .collect();
    Sent {
        path: fields["Path"].into(),
        id: fields["X-RequestId"].into(),
        body: body.into(),
    }
}
fn text_frame(path: &str, id: &str, body: &str) -> Message {
    Message::Text(format!("Path: {path}\r\nX-RequestId: {id}\r\n\r\n{body}"))
}
fn audio_frame(id: &str, stream: &str) -> Message {
    let headers = format!("Path: audio\r\nX-RequestId: {id}\r\nX-StreamId: {stream}\r\n");
    let mut bytes = (headers.len() as u16).to_be_bytes().to_vec();
    bytes.extend(headers.as_bytes());
    bytes.extend([0, 255, 128]);
    Message::Binary(bytes)
}
#[derive(Default)]
struct SocketState {
    sent: Vec<Sent>,
    incoming: VecDeque<Result<Message, TransportError>>,
    drops: usize,
    flushes: usize,
    stall_path: Option<String>,
    pending: bool,
    closed: bool,
    flush_error: Option<TransportError>,
    auto: bool,
    responded: bool,
    metadata: String,
}
struct TestSocket {
    state: Arc<Mutex<SocketState>>,
    trace: Arc<Mutex<Vec<&'static str>>>,
}
impl Drop for TestSocket {
    fn drop(&mut self) {
        self.state.lock().unwrap().drops += 1;
        self.trace.lock().unwrap().push("socket");
    }
}
impl WebSocketLike for TestSocket {
    fn start_send(self: Pin<&mut Self>, message: Message) -> Result<(), TransportError> {
        let f = sent(message);
        let mut s = self.state.lock().unwrap();
        assert!(!s.pending, "overwrote an unfinished frame");
        s.pending = true;
        if s.auto && ["ssml", "text.piece"].contains(&f.path.as_str()) && !s.responded {
            s.responded = true;
            s.incoming.push_back(Ok(text_frame(
                "response",
                &f.id,
                r#"{"audio":{"streamId":"stream"}}"#,
            )));
            if !s.metadata.is_empty() {
                let metadata = s.metadata.clone();
                s.incoming
                    .push_back(Ok(text_frame("audio.metadata", &f.id, &metadata)));
            }
            s.incoming.push_back(Ok(audio_frame(&f.id, "stream")));
        }
        if s.auto && ["ssml", "text.end"].contains(&f.path.as_str()) {
            s.incoming
                .push_back(Ok(text_frame("turn.end", &f.id, "{}")));
        }
        s.sent.push(f);
        Ok(())
    }
    fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Result<(), TransportError>> {
        let mut s = self.state.lock().unwrap();
        s.flushes += 1;
        if let Some(error) = s.flush_error.take() {
            return Poll::Ready(Err(error));
        }
        if s.stall_path
            .as_ref()
            .is_some_and(|v| s.sent.last().is_some_and(|f| &f.path == v))
        {
            return Poll::Pending;
        }
        s.pending = false;
        Poll::Ready(Ok(()))
    }
    fn poll_receive(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
    ) -> Poll<Option<Result<Message, TransportError>>> {
        let mut s = self.state.lock().unwrap();
        match s.incoming.pop_front() {
            Some(v) => Poll::Ready(Some(v)),
            None if s.closed => Poll::Ready(None),
            None => Poll::Pending,
        }
    }
}
fn socket(state: Arc<Mutex<SocketState>>, trace: Arc<Mutex<Vec<&'static str>>>) -> Socket {
    Box::pin(TestSocket { state, trace })
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
        Box::pin(async move {
            self.requests.lock().unwrap().push(request);
            Ok(self.response.lock().unwrap().take().unwrap())
        })
    }
}

fn normalized_marks(marks: Vec<MicrosoftTimestamp>) -> Value {
    Value::Array(
        marks
            .into_iter()
            .map(|mark| {
                let mut fields = BTreeMap::from([
                    ("kind".into(), Value::String(mark.kind.value().into())),
                    ("value".into(), Value::String(mark.value)),
                    ("startTimeMs".into(), Value::Number(mark.start_time_ms)),
                ]);
                if let Some(v) = mark.end_time_ms {
                    fields.insert("endTimeMs".into(), Value::Number(v));
                }
                if let Some(v) = mark.boundary_type {
                    fields.insert("boundaryType".into(), Value::String(v));
                }
                if let Some(v) = mark.animation_chunk {
                    fields.insert("animationChunk".into(), Value::String(v));
                }
                if let Some(v) = mark.is_last_animation {
                    fields.insert("isLastAnimation".into(), Value::Bool(v.value()));
                }
                assert!(mark.source.is_none());
                Value::Map(fields)
            })
            .collect(),
    )
}

#[test]
fn shared_ssml_early_bytes_and_deployment() {
    let counts = Arc::new(Counts::default());
    let http = Http {
        requests: Mutex::default(),
        response: Mutex::new(Some(HttpResponse {
            status: 200,
            headers: vec![],
            body: Box::pin(Source {
                values: VecDeque::from([Ok(vec![1])]),
                counts: counts.clone(),
                stall: true,
                trace: Arc::default(),
            }),
        })),
    };
    let mut r = request();
    r.text = "A & <B> \"C\"".into();
    r.speed = Some(1.5);
    r.pitch_semitones = Some(-2.0);
    r.volume_scale = Some(0.0);
    r.emotion = Some("calm\"".into());
    let mut stream = ready(synthesize(
        TtsRequest::TextVoice4ff226b4(r),
        Options {
            auth: Some(&auth()),
            transport: Some(&http),
            base_url: Some("https://proxy.invalid/a%2Fb/?tenant=one"),
            deployment_id: Some("custom/1"),
            ..Default::default()
        },
    ))
    .unwrap();
    assert!(matches!(next(&mut stream),Some(Ok(SynthesisItem::Bytes(v))) if v==vec![1]));
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    drop(stream);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    let requests = http.requests.lock().unwrap();
    assert_eq!(requests.len(), 1);
    let r = &requests[0];
    assert_eq!(
        r.url,
        "https://proxy.invalid/a%2Fb/cognitiveservices/v1?tenant=one&deploymentId=custom%2F1"
    );
    assert_eq!(r.method, "POST");
    assert_eq!(
        String::from_utf8(r.body.clone()).unwrap(),
        fixtures()["ssml"].string().unwrap()
    );
    assert_eq!(
        r.headers,
        vec![
            ("Ocp-Apim-Subscription-Key".into(), "key".into()),
            ("Content-Type".into(), "application/ssml+xml".into()),
            (
                "X-Microsoft-OutputFormat".into(),
                "raw-24khz-16bit-mono-pcm".into()
            ),
            ("User-Agent".into(), "speechswitch".into())
        ]
    );
}

#[test]
fn live_settings_independent_timeline_and_drop() {
    let counts = Arc::new(Counts::default());
    let trace = Arc::new(Mutex::new(vec![]));
    let state = Arc::new(Mutex::new(SocketState {
        auto: true,
        metadata: fixtures()["metadata"].text().into(),
        ..Default::default()
    }));
    let input = Box::pin(Source {
        values: VecDeque::from([Ok("Hi".into())]),
        counts: counts.clone(),
        stall: true,
        trace: trace.clone(),
    });
    let mut r = streaming(input);
    r.lexicon_url = Some("https://example.com/lexicon".into());
    r.preferred_languages = Some(vec!["en-US".into(), "zh-CN".into()]);
    r.timestamp_granularity = Some(
        TtsRequestStreamingTextVoicee86a65c0TimestampGranularity::Array(vec![
            TtsRequestStreamingTextVoicee86a65c0TimestampGranularityArrayItem::Word(
                Default::default(),
            ),
            TtsRequestStreamingTextVoicee86a65c0TimestampGranularityArrayItem::Sentence(
                Default::default(),
            ),
        ]),
    );
    let mut stream = ready(synthesize(
        TtsRequest::StreamingTextVoicee86a65c0(r),
        Options {
            web_socket: Some(socket(state.clone(), trace.clone())),
            entropy: Some(&entropy),
            ..Default::default()
        },
    ))
    .unwrap();
    let Some(Ok(SynthesisItem::Timeline(marks))) = next(&mut stream) else {
        panic!("expected metadata")
    };
    assert!(marks.audio.is_none());
    assert_eq!(marks.stream_id.as_deref(), Some("stream"));
    assert_eq!(marks.duration_ms, Some(10.0));
    let mut expected = fixtures()["timestamps"].array().unwrap();
    expected.truncate(2);
    assert_eq!(
        normalized_marks(marks.timestamps),
        Value::Array(expected.into_iter().map(fixture).collect())
    );
    let Some(Ok(SynthesisItem::Timeline(audio))) = next(&mut stream) else {
        panic!("expected audio")
    };
    assert_eq!(audio.audio, Some(vec![0, 255, 128]));
    assert!(audio.timestamps.is_empty());
    assert_eq!(audio.correlation_id, marks.correlation_id);
    let state_guard = state.lock().unwrap();
    let context = Raw::parse(&state_guard.sent[1].body)
        .unwrap()
        .object()
        .unwrap();
    assert_eq!(
        fixture(context["synthesis"].object().unwrap()["input"]),
        fixture(fixtures()["streamingInput"])
    );
    drop(state_guard);
    // Let the outstanding audio-triggering write finish before testing idle stop.
    let mut cx = Context::from_waker(Waker::noop());
    for _ in 0..5 {
        assert!(Pin::new(&mut stream).poll_next(&mut cx).is_pending());
    }
    drop(stream);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(*trace.lock().unwrap(), vec!["socket", "input"]);
    let state = state.lock().unwrap();
    assert_eq!(state.drops, 1);
    assert_eq!(state.sent.last().unwrap().path, "synthesis.control");
}

#[test]
fn raw_ssml_all_metadata_and_done() {
    let state = Arc::new(Mutex::new(SocketState {
        auto: true,
        metadata: fixtures()["metadata"].text().into(),
        ..Default::default()
    }));
    let r = TtsRequest::Text686f0afb(TtsRequestText686f0afb {
        input_type: Default::default(),
        text: "<speak/>".into(),
        output: None,
        timestamp_granularity: TtsRequestText686f0afbTimestampGranularity::Array(vec![
            TtsRequestText686f0afbTimestampGranularityArrayItem::Word(Default::default()),
            TtsRequestText686f0afbTimestampGranularityArrayItem::Sentence(Default::default()),
            TtsRequestText686f0afbTimestampGranularityArrayItem::Ssml(Default::default()),
            TtsRequestText686f0afbTimestampGranularityArrayItem::Viseme(Default::default()),
        ]),
    });
    let mut stream = ready(synthesize(
        r,
        Options {
            web_socket: Some(socket(state.clone(), Arc::default())),
            entropy: Some(&entropy),
            ..Default::default()
        },
    ))
    .unwrap();
    let Some(Ok(SynthesisItem::Timeline(marks))) = next(&mut stream) else {
        panic!("expected metadata")
    };
    assert_eq!(
        normalized_marks(marks.timestamps),
        fixture(fixtures()["timestamps"])
    );
    assert!(matches!(
        next(&mut stream),
        Some(Ok(SynthesisItem::Timeline(_)))
    ));
    let Some(Ok(SynthesisItem::Done(done))) = next(&mut stream) else {
        panic!("expected done")
    };
    assert_eq!(done.duration_ms, Some(10.0));
    assert_eq!(done.request_id, state.lock().unwrap().sent[0].id);
    assert_eq!(state.lock().unwrap().drops, 1);
    assert!(next(&mut stream).is_none());
    assert_eq!(state.lock().unwrap().sent[2].body, "<speak/>");
}
