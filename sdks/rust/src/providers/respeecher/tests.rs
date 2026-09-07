use super::*;
mod lifecycle;
use crate::{
    generated::{auth::AuthAsync, respeecher::*},
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
        respeecher: Some(AuthAsync {
            api_key: Some("fixture".into()),
        }),
        rime: None,
        smallest_ai: None,
        typecast: None,
        vocu: None,
        voice_ai: None,
        xai: None,
    }
}
fn request() -> TtsRequestObject {
    TtsRequestObject {
        frequency_penalty: None,
        language: None,
        min_p: None,
        model: None,
        output: None,
        presence_penalty: None,
        random_seed: None,
        repetition_penalty: None,
        temperature: None,
        text: TtsRequestObjectText::String("Hello".into()),
        top_k: None,
        top_p: None,
        voice: "custom-voice".into(),
    }
}
fn wav(rate: Option<f64>) -> TtsRequest {
    TtsRequest::TextVoice(TtsRequestTextVoice {
        frequency_penalty: None,
        language: None,
        min_p: None,
        model: None,
        output: TtsRequestTextVoiceOutput {
            byte_order: None,
            channel_count: None,
            format: Default::default(),
            sample_encoding: None,
            sample_rate_hz: rate,
        },
        presence_penalty: None,
        random_seed: None,
        repetition_penalty: None,
        temperature: None,
        text: "Hi".into(),
        top_k: None,
        top_p: None,
        voice: "voice".into(),
    })
}
fn value(text: &str) -> Value {
    fixture(Raw::parse_exact(text).unwrap())
}
#[derive(Debug, PartialEq)]
enum Item {
    Bytes(Vec<u8>),
    Audio(String, Vec<u8>),
    Clear,
    Flush(String),
    Done,
}
fn item(value: SynthesisItem) -> Item {
    match value {
        SynthesisItem::Bytes(b) => Item::Bytes(b),
        SynthesisItem::Ordered(v) => {
            assert_eq!(v.correlation.value(), "ordered");
            assert_eq!(v.timestamps, []);
            Item::Audio(v.correlation_id, v.audio)
        }
        SynthesisItem::Clear(v) => {
            assert_eq!(v.event.value(), "clear");
            Item::Clear
        }
        SynthesisItem::Flush(v) => {
            assert_eq!(v.event.value(), "flush");
            assert_eq!(v.correlation_id, v.input_group_id);
            Item::Flush(v.correlation_id)
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
const FIXTURES: &str = include_str!("../../../../fixtures/respeecher.json");

#[test]
fn shared_requests_are_exact() {
    let mut uk = request();
    uk.language = Some(TtsRequestObjectLanguage::Uk(Default::default()));
    uk.text = TtsRequestObjectText::String("Приві́т!".into());
    uk.temperature = Some(0.0);
    uk.top_k = Some(0.0);
    uk.top_p = Some(0.9);
    uk.min_p = Some(0.0);
    uk.presence_penalty = Some(2.0);
    uk.frequency_penalty = Some(0.0);
    uk.repetition_penalty = Some(1.0);
    uk.random_seed = Some(-7.0);
    uk.output = Some(TtsRequestObjectOutput::Pcm(TtsRequestObjectOutputPcm {
        byte_order: None,
        channel_count: None,
        format: Default::default(),
        sample_encoding: Some(TtsRequestObjectOutputPcmSampleEncoding::SignedInteger16(
            Default::default(),
        )),
        sample_rate_hz: Some(44100.0),
    }));
    let mut mu = request();
    mu.text = TtsRequestObjectText::String("Hi".into());
    mu.voice = "voice".into();
    mu.top_k = Some(12.0);
    mu.output = Some(TtsRequestObjectOutput::Mulaw(TtsRequestObjectOutputMulaw {
        channel_count: None,
        format: Default::default(),
        sample_rate_hz: Some(24000.0),
    }));
    let fixtures = Raw::parse_exact(FIXTURES).unwrap().object().unwrap();
    let fixtures = fixtures["requests"].array().unwrap();
    for (request, f) in [
        TtsRequest::Object(request()),
        TtsRequest::Object(uk),
        TtsRequest::Object(mu),
        wav(Some(48000.0)),
    ]
    .into_iter()
    .zip(fixtures)
    {
        let f = f.object().unwrap();
        let wave = f["name"].string().unwrap() == "wav";
        let (backend, counts) = http(vec![if wave {
            vec![0, 255]
        } else {
            b"{\"type\":\"chunk\",\"data\":\"AP8=\"}\n".to_vec()
        }]);
        let auth = auth();
        let mut stream = ready(synthesize(
            request,
            Options {
                auth: Some(&auth),
                transport: Some(&backend),
                protocol: Some(Protocol::Http),
                ..Default::default()
            },
        ))
        .unwrap();
        let sent = backend.requests.lock().unwrap();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].method, "POST");
        assert_eq!(
            sent[0].url,
            format!(
                "https://api.respeecher.com/v1/public/tts{}",
                f["path"].string().unwrap()
            )
        );
        assert_eq!(
            sent[0].headers,
            vec![
                ("X-API-Key".into(), "fixture".into()),
                ("Content-Type".into(), "application/json".into())
            ]
        );
        assert_eq!(
            value(std::str::from_utf8(&sent[0].body).unwrap()),
            fixture(f["body"])
        );
        drop(sent);
        assert_eq!(
            item(pull(&mut stream).unwrap().unwrap()),
            Item::Bytes(vec![0, 255])
        );
        assert_eq!(item(pull(&mut stream).unwrap().unwrap()), Item::Done);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert!(pull(&mut stream).is_none());
    }
}

#[test]
fn shared_jsonl_every_byte_split() {
    let root = Raw::parse_exact(FIXTURES).unwrap().object().unwrap();
    for f in root["jsonl"].array().unwrap() {
        let f = f.object().unwrap();
        let wire = f["wire"].string().unwrap();
        let expected_error = if f["error"].is_null() {
            None
        } else {
            Some(f["error"].string().unwrap())
        };
        let expected_audio: Vec<Item> = f["audio"]
            .array()
            .unwrap()
            .into_iter()
            .map(|v| {
                Item::Bytes(
                    v.array()
                        .unwrap()
                        .into_iter()
                        .map(|n| n.number().unwrap() as u8)
                        .collect(),
                )
            })
            .collect();
        for split in 0..=wire.len() {
            let bytes = wire.as_bytes();
            let (backend, counts) = http(vec![bytes[..split].to_vec(), bytes[split..].to_vec()]);
            let auth = auth();
            let mut stream = ready(synthesize(
                TtsRequest::Object(request()),
                Options {
                    auth: Some(&auth),
                    transport: Some(&backend),
                    protocol: Some(Protocol::Http),
                    ..Default::default()
                },
            ))
            .unwrap();
            let mut audio = vec![];
            let mut error = None;
            let mut done = false;
            while let Some(value) = pull(&mut stream) {
                match value {
                    Ok(value) => match item(value) {
                        Item::Done => done = true,
                        a => audio.push(a),
                    },
                    Err(e) => {
                        if f["name"].string().unwrap() == "native-error" {
                            let native = e.downcast_ref::<Error>().unwrap();
                            assert_eq!(native.status_code, 429);
                            assert_eq!(native.context_id.as_deref(), Some("native"))
                        };
                        error = Some(e.to_string())
                    }
                }
            }
            assert_eq!(audio, expected_audio);
            assert_eq!(error, expected_error);
            assert_eq!(done, expected_error.is_none());
            assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        }
    }
}

struct SocketState {
    sent: Vec<String>,
    replies: VecDeque<Result<Message, TransportError>>,
    automatic: bool,
    flush_pending: bool,
    closed: bool,
    drops: usize,
    failure: Option<TransportError>,
}
struct MockSocket(Arc<Mutex<SocketState>>);
impl Drop for MockSocket {
    fn drop(&mut self) {
        self.0.lock().unwrap().drops += 1
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
        };
        if s.automatic {
            let object = Raw::parse_exact(&text).unwrap().object().unwrap();
            if let Some(transcript) = object.get("transcript") {
                let id = object["context_id"].string().unwrap();
                if !transcript.string().unwrap().is_empty() {
                    s.replies.push_back(Ok(Message::Text(format!(
                        "{{\"type\":\"chunk\",\"context_id\":\"{id}\",\"data\":\"AP8=\"}}"
                    ))))
                }
                if object["continue"].boolean().unwrap() == false {
                    s.replies.push_back(Ok(Message::Text(format!(
                        "{{\"type\":\"done\",\"context_id\":\"{id}\"}}"
                    ))))
                }
            }
        };
        s.sent.push(text);
        Ok(())
    }
    fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Result<(), TransportError>> {
        if self.0.lock().unwrap().flush_pending {
            Poll::Pending
        } else {
            Poll::Ready(Ok(()))
        }
    }
    fn poll_receive(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
    ) -> Poll<Option<Result<Message, TransportError>>> {
        let mut s = self.0.lock().unwrap();
        if let Some(v) = s.replies.pop_front() {
            Poll::Ready(Some(v))
        } else if s.closed {
            Poll::Ready(None)
        } else {
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
    }));
    (Box::pin(MockSocket(state.clone())), state)
}
fn entropy(bytes: &mut [u8]) -> Result<(), TransportError> {
    for (i, b) in bytes.iter_mut().enumerate() {
        *b = i as u8
    }
    Ok(())
}
fn live(text: StreamingInput<TtsRequestObjectTextAsyncIterableItem>, socket: Socket) -> Stream {
    let auth = auth();
    let mut r = request();
    r.text = TtsRequestObjectText::AsyncIterable(text);
    ready(synthesize(
        TtsRequest::Object(r),
        Options {
            auth: Some(&auth),
            web_socket: Some(socket),
            entropy: Some(&entropy),
            ..Default::default()
        },
    ))
    .unwrap()
}
fn text(v: &str) -> TtsRequestObjectTextAsyncIterableItem {
    TtsRequestObjectTextAsyncIterableItem::String(v.into())
}
fn flush() -> TtsRequestObjectTextAsyncIterableItem {
    TtsRequestObjectTextAsyncIterableItem::Flush(TtsRequestObjectTextAsyncIterableItemFlush {
        command: Default::default(),
    })
}
fn clear() -> TtsRequestObjectTextAsyncIterableItem {
    TtsRequestObjectTextAsyncIterableItem::Clear(TtsRequestObjectTextAsyncIterableItemClear {
        command: Default::default(),
    })
}
fn sent(stream: &mut Stream, socket: &Arc<Mutex<SocketState>>, count: usize) -> String {
    for _ in 0..1000 {
        if socket.lock().unwrap().sent.len() >= count {
            return socket.lock().unwrap().sent[count - 1].clone();
        };
        tick(stream)
    }
    panic!("send not reached")
}
fn id(message: &str) -> String {
    Raw::parse_exact(message).unwrap().object().unwrap()["context_id"]
        .string()
        .unwrap()
}
fn packet(s: &Arc<Mutex<SocketState>>, kind: &str, id: &str, data: &str) {
    s.lock()
        .unwrap()
        .replies
        .push_back(Ok(Message::Text(format!(
            "{{\"type\":\"{kind}\",\"context_id\":\"{id}\",\"data\":\"{data}\"}}"
        ))))
}

#[test]
fn socket_overlapping_clear_flush_and_late_output() {
    let (input, counts, source) = body(
        vec![Ok(text("First")), Ok(flush()), Ok(text("Second"))],
        false,
    );
    let (socket, state) = socket(false);
    let mut stream = live(input, socket);
    let one = id(&sent(&mut stream, &state, 1));
    let end = sent(&mut stream, &state, 2);
    let obj = Raw::parse_exact(&end).unwrap().object().unwrap();
    assert!(!obj["continue"].boolean().unwrap());
    assert_eq!(obj["transcript"].string().unwrap(), "");
    let two = id(&sent(&mut stream, &state, 3));
    assert_ne!(one, two);
    packet(&state, "chunk", &one, "AQ==");
    assert_eq!(
        item(pull(&mut stream).unwrap().unwrap()),
        Item::Audio(one.clone(), vec![1])
    );
    source.lock().unwrap().values.push_back(Ok(clear()));
    assert_eq!(item(pull(&mut stream).unwrap().unwrap()), Item::Clear);
    sent(&mut stream, &state, 5);
    let messages: Vec<Value> = state.lock().unwrap().sent[3..5]
        .iter()
        .map(|v| value(v))
        .collect();
    let expected: Vec<Value> = [one.clone(), two.clone()]
        .into_iter()
        .map(|id| value(&format!("{{\"context_id\":\"{id}\",\"cancel\":true}}")))
        .collect();
    assert_eq!(messages, expected);
    packet(&state, "chunk", &one, "AP8=");
    packet(&state, "done", &two, "");
    state.lock().unwrap().replies.push_back(Ok(Message::Text(format!("{{\"type\":\"error\",\"context_id\":\"{one}\",\"status_code\":499,\"error\":\"canceled\"}}"))));
    {
        let mut s = source.lock().unwrap();
        s.values.push_back(Ok(text("Third")));
        s.values.push_back(Ok(flush()));
    }
    let three = id(&sent(&mut stream, &state, 6));
    sent(&mut stream, &state, 7);
    packet(&state, "chunk", &three, "Ag==");
    assert_eq!(
        item(pull(&mut stream).unwrap().unwrap()),
        Item::Audio(three.clone(), vec![2])
    );
    packet(&state, "done", &three, "");
    assert_eq!(
        item(pull(&mut stream).unwrap().unwrap()),
        Item::Flush(three)
    );
    source.lock().unwrap().ended = true;
    assert_eq!(item(pull(&mut stream).unwrap().unwrap()), Item::Done);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(state.lock().unwrap().drops, 1);
    assert!(pull(&mut stream).is_none())
}

#[test]
fn whole_text_socket_and_owned_stream() {
    let auth = auth();
    let (socket, state) = socket(true);
    let mut stream = ready(synthesize(
        TtsRequest::Object(request()),
        Options {
            auth: Some(&auth),
            web_socket: Some(socket),
            entropy: Some(&entropy),
            ..Default::default()
        },
    ))
    .unwrap();
    drop(auth);
    let audio = item(pull(&mut stream).unwrap().unwrap());
    let id = id(&state.lock().unwrap().sent[0]);
    assert_eq!(audio, Item::Audio(id, vec![0, 255]));
    assert_eq!(item(pull(&mut stream).unwrap().unwrap()), Item::Done);
    assert_eq!(state.lock().unwrap().drops, 1);
    assert!(pull(&mut stream).is_none())
}

#[test]
fn backpressured_writes_do_not_block_audio_and_drop_releases_input() {
    let (input, counts, _) = body(vec![Ok(text("Hello"))], false);
    let (socket, state) = socket(false);
    state.lock().unwrap().flush_pending = true;
    let mut stream = live(input, socket);
    let id = id(&sent(&mut stream, &state, 1));
    packet(&state, "chunk", &id, "AQ==");
    assert_eq!(
        item(pull(&mut stream).unwrap().unwrap()),
        Item::Audio(id, vec![1])
    );
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    drop(stream);
    assert_eq!(state.lock().unwrap().drops, 1);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1)
}

#[test]
fn protocol_errors_are_terminal() {
    for (wire, expected) in [
        ("[]", "Invalid Respeecher response"),
        (
            "{\"type\":\"chunk\",\"data\":\"AQ==\"}",
            "Respeecher omitted the native context ID",
        ),
        (
            "{\"type\":\"chunk\",\"context_id\":null,\"data\":\"AQ==\"}",
            "Invalid Respeecher context ID",
        ),
        (
            "{\"type\":\"chunk\",\"context_id\":\"wrong\",\"data\":\"AQ==\"}",
            "Respeecher returned an unknown context ID",
        ),
        (
            "{\"type\":\"error\",\"status_code\":true,\"error\":\"secret\"}",
            "Invalid Respeecher error response",
        ),
        (
            "{\"type\":\"error\",\"status_code\":429.5,\"error\":\"secret\"}",
            "Invalid Respeecher error response",
        ),
    ] {
        let (input, counts, _) = body(Vec::new(), false);
        let (socket, state) = socket(false);
        state
            .lock()
            .unwrap()
            .replies
            .push_back(Ok(Message::Text(wire.into())));
        let mut stream = live(input, socket);
        assert_eq!(
            pull(&mut stream).unwrap().err().unwrap().to_string(),
            expected
        );
        assert_eq!(state.lock().unwrap().drops, 1);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert!(pull(&mut stream).is_none())
    }
}
