mod credentials;
mod fixtures;
mod splitters;
mod validation;
use super::*;
use crate::{
    generated::{auth::AuthCartesia, vocu::*},
    json::Raw,
    msgpack::{tests::fixture, Value},
};
use std::{
    collections::VecDeque,
    future::Future,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    task::{Wake, Waker},
    time::{Duration, Instant},
};

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
            Some(value) => Poll::Ready(Some(value)),
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
struct Transport {
    requests: Mutex<Vec<HttpRequest>>,
    responses: Mutex<VecDeque<(HttpResponse, bool)>>,
}
impl HttpTransport for Transport {
    fn send(
        &self,
        request: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        self.requests.lock().unwrap().push(request);
        Box::pin(async {
            let (response, pending) = self
                .responses
                .lock()
                .unwrap()
                .pop_front()
                .expect("unexpected request");
            if pending {
                let _: () = std::future::pending().await;
            }
            Ok(response)
        })
    }
}
fn response(
    chunks: Vec<Vec<u8>>,
    status: u16,
    headers: Vec<(String, String)>,
    stall: bool,
) -> (HttpResponse, Arc<Counts>) {
    let counts = Arc::new(Counts::default());
    (
        HttpResponse {
            status,
            headers,
            body: Box::pin(Body {
                chunks: chunks.into_iter().map(Ok).collect(),
                counts: counts.clone(),
                stall,
            }),
        },
        counts,
    )
}
fn transport(responses: Vec<(HttpResponse, bool)>) -> Transport {
    Transport {
        requests: Mutex::new(vec![]),
        responses: Mutex::new(responses.into()),
    }
}
fn audio() -> (HttpResponse, Arc<Counts>) {
    response(
        vec![vec![0, 255, 128]],
        200,
        vec![("CONTENT-type".into(), "audio/mpeg".into())],
        false,
    )
}
fn metadata(value: &str) -> (HttpResponse, Arc<Counts>) {
    response(
        vec![format!("{{\"status\":200,\"data\":{value}}}").into_bytes()],
        200,
        vec![],
        false,
    )
}
fn ready<T>(future: impl Future<Output = T>) -> T {
    let mut future = std::pin::pin!(future);
    let counts = Arc::new(Counts::default());
    let waker = Waker::from(counts.clone());
    let mut cx = Context::from_waker(&waker);
    for _ in 0..100000 {
        let before = counts.wakes.load(Ordering::SeqCst);
        match future.as_mut().poll(&mut cx) {
            Poll::Ready(value) => return value,
            Poll::Pending => assert!(
                counts.wakes.load(Ordering::SeqCst) > before,
                "pending without wake"
            ),
        }
    }
    panic!("future did not finish")
}
fn next(stream: &mut Stream) -> Option<Result<SynthesisItem, TransportError>> {
    ready(poll_fn(|cx| Pin::new(&mut *stream).poll_next(cx)))
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
        rime: None,
        smallest_ai: None,
        typecast: None,
        vocu: Some(AuthCartesia {
            api_key: Some("fixture".into()),
            access_token: None,
        }),
        voice_ai: None,
        xai: None,
    }
}
fn shared() -> BTreeMap<String, Raw<'static>> {
    Raw::parse_exact(include_str!("../../../../fixtures/vocu.json"))
        .unwrap()
        .object()
        .unwrap()
}
fn json_value(value: JsonValue) -> Value {
    match value {
        JsonValue::Null => Value::Nil,
        JsonValue::Bool(value) => Value::Bool(value),
        JsonValue::Number(value) => Value::Number(value),
        JsonValue::String(value) => Value::String(value),
        JsonValue::Array(values) => Value::Array(values.into_iter().map(json_value).collect()),
        JsonValue::Object(values) => Value::Map(
            values
                .into_iter()
                .map(|(key, value)| (key, json_value(value)))
                .collect(),
        ),
    }
}
fn item(value: SynthesisItem) -> Value {
    match value {
        SynthesisItem::Bytes(bytes) => Value::Binary(bytes),
        SynthesisItem::Done(done) => {
            let mut value: BTreeMap<String, Value> = [
                ("event".into(), Value::String(done.event.value().into())),
                (
                    "completion".into(),
                    Value::String(done.completion.value().into()),
                ),
            ]
            .into();
            if let Some(metadata) = done.metadata {
                let VocuDoneEventMetadata::Record(metadata) = metadata else {
                    panic!("metadata must retain native object")
                };
                value.insert("metadata".into(), json_value(JsonValue::Object(metadata)));
            }
            if let Some(id) = done.request_id {
                value.insert("requestId".into(), Value::String(id));
            }
            Value::Map(value)
        }
    }
}
fn collect(stream: &mut Stream) -> Result<Vec<Value>, TransportError> {
    let mut items = vec![];
    while let Some(value) = next(stream) {
        items.push(item(value?));
    }
    Ok(items)
}

#[test]
fn shared_payloads_and_completion_match_typescript_and_python() {
    let auth = auth();
    let shared = shared();
    let cases = shared["requests"].array().unwrap();
    for (index, request) in fixtures::requests().into_iter().enumerate() {
        let case = cases[index].object().unwrap();
        let mode = match case["mode"].string().unwrap().as_str() {
            "stream" => Mode::Stream,
            "http" => Mode::Http,
            "async" => Mode::Async,
            _ => unreachable!(),
        };
        let (response, counts) = response(
            vec![vec![], vec![0], vec![255, 128]],
            200,
            vec![("content-type".into(), "Audio/MPEG; codec=mp3".into())],
            false,
        );
        let mut replies = vec![];
        let mut metadata_counts = None;
        let native = shared[if mode == Mode::Async {
            "generatedJob"
        } else {
            "httpMetadata"
        }];
        if mode != Mode::Stream {
            let (response, counts) = metadata(native.text());
            metadata_counts = Some(counts);
            replies.push((response, false));
        }
        replies.push((response, false));
        let http = transport(replies);
        let mut stream = ready(synthesize(
            &request,
            &http,
            Options {
                auth: Some(&auth),
                mode: Some(mode),
                base_url: Some("https://proxy.test/base%2Fescaped"),
                ..Default::default()
            },
        ))
        .unwrap();
        let items = collect(&mut stream).unwrap();
        let mut done = BTreeMap::from([
            ("event".into(), Value::String("done".into())),
            (
                "completion".into(),
                Value::String(
                    if mode == Mode::Async {
                        "generated"
                    } else {
                        "transport"
                    }
                    .into(),
                ),
            ),
        ]);
        if mode != Mode::Stream {
            done.insert("metadata".into(), fixture(native));
        }
        assert_eq!(
            items,
            vec![
                Value::Binary(vec![0]),
                Value::Binary(vec![255, 128]),
                Value::Map(done)
            ]
        );
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        if let Some(counts) = metadata_counts {
            assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        }
        let requests = http.requests.lock().unwrap();
        let first = &requests[0];
        assert_eq!(first.method, "POST");
        assert_eq!(
            first.url,
            format!(
                "https://proxy.test/base%2Fescaped/api/tts/{}",
                if mode == Mode::Async {
                    "generate"
                } else {
                    "simple-generate"
                }
            )
        );
        assert_eq!(
            first.headers,
            vec![
                ("Authorization".into(), "Bearer fixture".into()),
                ("Content-Type".into(), "application/json".into())
            ]
        );
        assert_eq!(
            fixture(Raw::parse_exact(std::str::from_utf8(&first.body).unwrap()).unwrap()),
            fixture(case["wire"])
        );
        assert_eq!(requests.len(), if mode == Mode::Stream { 1 } else { 2 });
        if mode != Mode::Stream {
            let last = &requests[1];
            assert_eq!(last.method, "GET");
            assert_eq!(last.headers, vec![]);
            assert_eq!(last.body, vec![]);
            assert_eq!(
                last.url,
                if mode == Mode::Async {
                    "https://storage.vocu.ai/generate/merged.mp3"
                } else {
                    "https://storage.vocu.ai/generate/stream.mp3?auth=fixture"
                }
            );
        }
    }
}

#[test]
fn polling_uses_one_job_and_preserves_api_tracing() {
    let mut auth = auth();
    auth.vocu = Some(AuthCartesia {
        api_key: None,
        access_token: Some("session".into()),
    });
    let (mut initial, a) = metadata(
        r#"{"id":"job_1","status":"pending","metadata":{"audio":"https://evil.test/not-ready"}}"#,
    );
    initial
        .headers
        .push(("X-Vocu-App-Request-Id".into(), "submit".into()));
    let (processing, b) = metadata(r#"{"id":"job_1","status":"processing"}"#);
    let (mut generated, c) = metadata(shared()["generatedJob"].text());
    generated
        .headers
        .push(("x-vocu-app-request-id".into(), "poll".into()));
    let (mut audio, d) = audio();
    audio
        .headers
        .push(("x-vocu-app-request-id".into(), "asset".into()));
    let http = transport(vec![
        (initial, false),
        (processing, false),
        (generated, false),
        (audio, false),
    ]);
    let mut stream = ready(synthesize(
        &fixtures::requests().remove(4),
        &http,
        Options {
            auth: Some(&auth),
            poll_interval_ms: 0,
            ..Default::default()
        },
    ))
    .unwrap();
    let items = collect(&mut stream).unwrap();
    let Value::Map(done) = &items[1] else {
        panic!("missing done")
    };
    assert_eq!(done.get("requestId"), Some(&Value::String("poll".into())));
    assert_eq!(
        done.get("metadata"),
        Some(&fixture(shared()["generatedJob"]))
    );
    let requests = http.requests.lock().unwrap();
    let urls: Vec<_> = requests.iter().map(|r| r.url.as_str()).collect();
    assert_eq!(
        urls,
        vec![
            "https://v1.vocu.ai/api/tts/generate",
            "https://v1.vocu.ai/api/tts/generate/job_1",
            "https://v1.vocu.ai/api/tts/generate/job_1",
            "https://storage.vocu.ai/generate/merged.mp3"
        ]
    );
    for r in &requests[..3] {
        assert_eq!(
            r.headers[0],
            ("Authorization".into(), "Bearer session".into())
        );
    }
    assert!(requests[3].headers.is_empty());
    for counts in [a, b, c, d] {
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn raw_header_metadata_is_opaque_and_audio_is_not_metadata_bounded() {
    let auth = auth();
    let (mut audio, counts) = audio();
    let raw = r#"{"credit_used":0,"srt":[null,false,{"native_key":"你好😀"}]}"#;
    audio
        .headers
        .push(("x-reecho-response-data".into(), raw.into()));
    audio
        .headers
        .push(("x-vocu-app-request-id".into(), "trace".into()));
    let http = transport(vec![(audio, false)]);
    let mut stream = ready(synthesize(
        &TtsRequest::TextVoice2a721534(fixtures::subtitles()),
        &http,
        Options {
            auth: Some(&auth),
            ..Default::default()
        },
    ))
    .unwrap();
    let items = collect(&mut stream).unwrap();
    let Value::Map(done) = &items[1] else {
        panic!("missing done")
    };
    assert_eq!(
        done.get("metadata"),
        Some(&fixture(Raw::parse_exact(raw).unwrap()))
    );
    assert_eq!(done.get("requestId"), Some(&Value::String("trace".into())));
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    let (audio, _) = response(vec![vec![1; 10000]], 200, vec![], false);
    let http = transport(vec![(audio, false)]);
    let mut stream = ready(synthesize(
        &TtsRequest::TextVoice9c5ed44a(fixtures::plain()),
        &http,
        Options {
            auth: Some(&auth),
            max_metadata_bytes: 1,
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        collect(&mut stream).unwrap()[0],
        Value::Binary(vec![1; 10000])
    );
}

#[test]
fn drop_and_read_errors_release_audio_once_without_done() {
    let auth = auth();
    for read in [false, true] {
        let (response, counts) = response(vec![vec![0, 255], vec![99]], 200, vec![], true);
        let http = transport(vec![(response, false)]);
        let mut stream = ready(synthesize(
            &TtsRequest::TextVoice9c5ed44a(fixtures::plain()),
            &http,
            Options {
                auth: Some(&auth),
                ..Default::default()
            },
        ))
        .unwrap();
        if read {
            assert_eq!(
                item(next(&mut stream).unwrap().unwrap()),
                Value::Binary(vec![0, 255])
            );
        }
        drop(stream);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(counts.reads.load(Ordering::SeqCst), usize::from(read));
    }
    let counts = Arc::new(Counts::default());
    let response = HttpResponse {
        status: 200,
        headers: vec![],
        body: Box::pin(Body {
            chunks: vec![Ok(vec![1]), Err(failure("read failed"))].into(),
            counts: counts.clone(),
            stall: false,
        }),
    };
    let http = transport(vec![(response, false)]);
    let mut stream = ready(synthesize(
        &TtsRequest::TextVoice9c5ed44a(fixtures::plain()),
        &http,
        Options {
            auth: Some(&auth),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        item(next(&mut stream).unwrap().unwrap()),
        Value::Binary(vec![1])
    );
    assert_eq!(
        next(&mut stream).unwrap().err().unwrap().to_string(),
        "read failed"
    );
    assert!(next(&mut stream).is_none());
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn dropping_a_pending_audio_read_releases_the_body_without_completion() {
    let auth = auth();
    let (reply, counts) = response(vec![vec![42]], 200, vec![], true);
    let http = transport(vec![(reply, false)]);
    let mut stream = ready(synthesize(
        &TtsRequest::TextVoice9c5ed44a(fixtures::plain()),
        &http,
        Options {
            auth: Some(&auth),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        item(next(&mut stream).unwrap().unwrap()),
        Value::Binary(vec![42])
    );
    let waker = Waker::from(counts.clone());
    assert!(Pin::new(&mut stream)
        .poll_next(&mut Context::from_waker(&waker))
        .is_pending());
    assert_eq!(counts.drops.load(Ordering::SeqCst), 0);
    drop(stream);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 2);
}

#[test]
fn dropping_pending_sends_metadata_downloads_and_poll_delays_releases_ownership() {
    let auth = auth();
    let request = TtsRequest::TextVoice9c5ed44a(fixtures::plain());
    for stage in ["headers", "metadata", "poll", "download"] {
        let (audio, counts) = audio();
        let mut replies = vec![];
        let mut initial_counts = None;
        let options = Options {
            auth: Some(&auth),
            mode: Some(if stage == "poll" {
                Mode::Async
            } else {
                Mode::Http
            }),
            poll_interval_ms: 60000,
            ..Default::default()
        };
        match stage {
            "headers" => replies.push((audio, true)),
            "metadata" => {
                let (r, c) = response(vec![], 200, vec![], true);
                initial_counts = Some(c);
                replies.push((r, false));
                drop(audio);
            }
            "poll" => {
                let (r, c) = metadata(r#"{"id":"job","status":"pending"}"#);
                initial_counts = Some(c);
                replies.push((r, false));
                drop(audio);
            }
            "download" => {
                let (r, c) = metadata(shared()["httpMetadata"].text());
                initial_counts = Some(c);
                replies.push((r, false));
                replies.push((audio, true));
            }
            _ => unreachable!(),
        }
        let http = transport(replies);
        let mut future = Box::pin(synthesize(&request, &http, options));
        let wakes = Arc::new(Counts::default());
        let waker = Waker::from(wakes);
        let mut cx = Context::from_waker(&waker);
        for _ in 0..4 {
            assert!(future.as_mut().poll(&mut cx).is_pending());
        }
        drop(future);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        if let Some(c) = initial_counts {
            assert_eq!(c.drops.load(Ordering::SeqCst), 1);
        }
        assert_eq!(
            http.requests.lock().unwrap().len(),
            if stage == "download" { 2 } else { 1 }
        );
    }
}

#[test]
fn polling_delay_is_nonblocking_and_honors_its_interval() {
    let auth = auth();
    let request = TtsRequest::TextVoice9c5ed44a(fixtures::plain());
    let (pending, _) = metadata(r#"{"id":"job_1","status":"pending"}"#);
    let (generated, _) = metadata(shared()["generatedJob"].text());
    let (audio, _) = audio();
    let http = transport(vec![(pending, false), (generated, false), (audio, false)]);
    let mut future = Box::pin(synthesize(
        &request,
        &http,
        Options {
            auth: Some(&auth),
            mode: Some(Mode::Async),
            poll_interval_ms: 20,
            ..Default::default()
        },
    ));
    let counts = Arc::new(Counts::default());
    let waker = Waker::from(counts);
    let mut cx = Context::from_waker(&waker);
    let started = Instant::now();
    let mut stream = loop {
        match future.as_mut().poll(&mut cx) {
            Poll::Ready(value) => break value.unwrap(),
            Poll::Pending => {
                assert!(started.elapsed() < Duration::from_secs(3));
                std::thread::sleep(Duration::from_millis(1));
            }
        }
    };
    assert!(started.elapsed() >= Duration::from_millis(20));
    assert_eq!(collect(&mut stream).unwrap().len(), 2);
}
