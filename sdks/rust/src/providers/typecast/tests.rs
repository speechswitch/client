mod fixtures;
mod validation;
use super::*;
use crate::{
    generated::{auth::AuthAsync, typecast::*},
    http::{HttpRequest, HttpResponse},
    msgpack::{tests::fixture, Value},
};
use std::{
    collections::VecDeque,
    future::{poll_fn, Future},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    task::{Wake, Waker},
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
    response: Mutex<Option<HttpResponse>>,
    pending: bool,
}
impl HttpTransport for Transport {
    fn send(
        &self,
        request: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        self.requests.lock().unwrap().push(request);
        Box::pin(async {
            let response = self.response.lock().unwrap().take().expect("one request");
            if self.pending {
                let never = std::future::pending();
                let _: () = never.await;
            }
            Ok(response)
        })
    }
}
fn transport(
    chunks: Vec<Vec<u8>>,
    status: u16,
    media: &str,
    stall: bool,
) -> (Transport, Arc<Counts>) {
    let counts = Arc::new(Counts::default());
    (
        Transport {
            requests: Mutex::new(vec![]),
            pending: false,
            response: Mutex::new(Some(HttpResponse {
                status,
                headers: vec![("cOnTeNt-TyPe".into(), media.into())],
                body: Box::pin(Body {
                    chunks: chunks.into_iter().map(Ok).collect(),
                    counts: counts.clone(),
                    stall,
                }),
            })),
        },
        counts,
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
        typecast: Some(AuthAsync {
            api_key: Some("fixture".into()),
        }),
        vocu: None,
        voice_ai: None,
        xai: None,
    }
}
fn shared() -> std::collections::BTreeMap<String, Raw<'static>> {
    Raw::parse_exact(include_str!("../../../../fixtures/typecast.json"))
        .unwrap()
        .object()
        .unwrap()
}
fn item(item: SynthesisItem) -> Value {
    match item {
        SynthesisItem::Bytes(bytes) => Value::Binary(bytes),
        SynthesisItem::Done(done) => {
            Value::Map([("event".into(), Value::String(done.event.value().into()))].into())
        }
        SynthesisItem::Chunk(v) => {
            assert_eq!(v.correlation.value(), "chunk");
            let marks = v
                .timestamps
                .into_iter()
                .map(|m| {
                    assert_eq!(m.source.is_none(), true);
                    Value::Map(
                        [
                            ("kind".into(), Value::String(m.kind.value().into())),
                            ("value".into(), Value::String(m.value)),
                            ("startTimeMs".into(), Value::Number(m.start_time_ms)),
                            ("endTimeMs".into(), Value::Number(m.end_time_ms.unwrap())),
                        ]
                        .into(),
                    )
                })
                .collect();
            Value::Map(
                [
                    ("audio".into(), Value::Binary(v.audio)),
                    ("durationMs".into(), Value::Number(v.duration_ms)),
                    ("timestamps".into(), Value::Array(marks)),
                ]
                .into(),
            )
        }
    }
}
fn collect(stream: &mut Stream) -> Result<Vec<Value>, TransportError> {
    let mut items = Vec::new();
    while let Some(value) = next(stream) {
        items.push(item(value?));
    }
    Ok(items)
}

#[test]
fn shared_model_and_composition_fixtures() {
    let shared = shared();
    let cases = shared["requests"].array().unwrap();
    let requests = fixtures::requests();
    assert_eq!(requests.len(), cases.len());
    for (request, case) in requests.iter().zip(cases) {
        let case = case.object().unwrap();
        let path = case["path"].string().unwrap();
        let accept = case["accept"].string().unwrap();
        let timed = accept == "application/json";
        let data = if timed {
            shared["timestampResponse"].text().as_bytes().to_vec()
        } else {
            vec![0, 255]
        };
        let (backend, counts) = transport(vec![data], 200, &accept, false);
        let auth = auth();
        let mut stream = ready(synthesize(
            request,
            &backend,
            Options {
                auth: Some(&auth),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        let sent = backend.requests.lock().unwrap();
        assert_eq!(sent.len(), 1);
        assert_eq!(
            sent[0].url,
            format!("https://api.typecast.ai/v1/text-to-speech{path}")
        );
        assert_eq!(sent[0].method, "POST");
        assert_eq!(
            sent[0].headers,
            vec![
                ("X-API-KEY".into(), "fixture".into()),
                ("Content-Type".into(), "application/json".into()),
                ("Accept".into(), accept)
            ]
        );
        assert_eq!(
            fixture(Raw::parse_exact(std::str::from_utf8(&sent[0].body).unwrap()).unwrap()),
            fixture(case["body"])
        );
        drop(sent);
        let output = collect(&mut stream).unwrap();
        let first = if timed {
            let timestamps = shared["timestamps"]
                .array()
                .unwrap()
                .into_iter()
                .filter(|mark| {
                    let kind = mark.object().unwrap()["kind"].string().unwrap();
                    (!path.ends_with("=word") || kind == "word")
                        && (!path.ends_with("=char") || kind == "character")
                })
                .map(fixture)
                .collect();
            Value::Map(
                [
                    ("audio".into(), Value::Binary(vec![0, 255])),
                    ("durationMs".into(), Value::Number(500.0)),
                    ("timestamps".into(), Value::Array(timestamps)),
                ]
                .into(),
            )
        } else {
            Value::Binary(vec![0, 255])
        };
        assert_eq!(
            output,
            vec![first, fixture(Raw::parse(r#"{"event":"done"}"#).unwrap())]
        );
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert!(next(&mut stream).is_none());
    }
}

#[test]
fn every_timestamp_byte_split_and_exact_limit() {
    let shared = shared();
    let wire = shared["timestampResponse"].text().as_bytes();
    let request = TtsRequest::SsfmV30TextVoiceda7d6fa9(fixtures::timed());
    let auth = auth();
    for split in 0..=wire.len() {
        let (backend, counts) = transport(
            vec![wire[..split].to_vec(), vec![], wire[split..].to_vec()],
            200,
            "Application/JSON; charset=utf-8",
            false,
        );
        let mut stream = ready(synthesize(
            &request,
            &backend,
            Options {
                auth: Some(&auth),
                max_timestamp_response_bytes: wire.len(),
                ..Default::default()
            },
        ))
        .unwrap();
        let first = item(next(&mut stream).unwrap().unwrap());
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(
            first,
            Value::Map(
                [
                    ("audio".into(), Value::Binary(vec![0, 255])),
                    ("durationMs".into(), Value::Number(500.0)),
                    (
                        "timestamps".into(),
                        Value::Array(vec![fixture(shared["timestamps"].array().unwrap()[0])])
                    )
                ]
                .into()
            )
        );
        assert_eq!(
            collect(&mut stream).unwrap(),
            vec![fixture(Raw::parse(r#"{"event":"done"}"#).unwrap())]
        );
    }
}

#[test]
fn native_proxy_query_and_granularity() {
    let auth = auth();
    let wire = shared()["timestampResponse"].text().as_bytes().to_vec();
    for (selection, query) in [
        (
            TtsRequestSsfmV21TextVoicec8409957TimestampGranularity::Word(Default::default()),
            "&granularity=word",
        ),
        (
            TtsRequestSsfmV21TextVoicec8409957TimestampGranularity::Character(Default::default()),
            "&granularity=char",
        ),
        (
            TtsRequestSsfmV21TextVoicec8409957TimestampGranularity::Array(vec![
                TtsRequestSsfmV21TextVoicec8409957TimestampGranularityArrayItem::Word(
                    Default::default(),
                ),
                TtsRequestSsfmV21TextVoicec8409957TimestampGranularityArrayItem::Character(
                    Default::default(),
                ),
            ]),
            "",
        ),
    ] {
        let mut request = fixtures::timed();
        request.timestamp_granularity = selection;
        let request = TtsRequest::SsfmV30TextVoiceda7d6fa9(request);
        let (backend, _) = transport(vec![wire.clone()], 200, "application/json", false);
        let mut stream=ready(synthesize(&request,&backend,Options{auth:Some(&auth),base_url:Some("https://proxy.test/p%2Ftenant/?route=a%20b&granularity=old&%67ranularity=stale&empty="),..Default::default()})).unwrap();
        collect(&mut stream).unwrap();
        assert_eq!(backend.requests.lock().unwrap()[0].url,format!("https://proxy.test/p%2Ftenant/v1/text-to-speech/with-timestamps?route=a%20b&empty={query}"));
    }
}

#[test]
fn raw_audio_is_uncapped_and_owned_independently_of_the_request() {
    let (backend, counts) = transport(
        vec![vec![], b"RIFF".to_vec(), b"unread".to_vec()],
        200,
        "audio/wav",
        true,
    );
    let mut stream = {
        let request = TtsRequest::SsfmV30TextVoicec9d5257e(fixtures::plain());
        let auth = auth();
        ready(synthesize(
            &request,
            &backend,
            Options {
                auth: Some(&auth),
                max_timestamp_response_bytes: 1,
                ..Default::default()
            },
        ))
        .unwrap()
    };
    drop(backend);
    assert_eq!(
        item(next(&mut stream).unwrap().unwrap()),
        Value::Binary(b"RIFF".to_vec())
    );
    assert_eq!(counts.reads.load(Ordering::SeqCst), 2);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 0);
    drop(stream);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 2);
}

#[test]
fn status_and_media_failures_release_unread_bodies() {
    let request = TtsRequest::SsfmV30TextVoicec9d5257e(fixtures::plain());
    let auth = auth();
    for status in [199, 301, 401, 429, 500] {
        let (backend, counts) = transport(vec![b"private".to_vec()], status, "audio/wav", true);
        let err = ready(synthesize(
            &request,
            &backend,
            Options {
                auth: Some(&auth),
                ..Default::default()
            },
        ))
        .err()
        .unwrap();
        assert_eq!(err.downcast_ref::<Error>(), Some(&Error { status }));
        assert_eq!(err.to_string(), format!("Typecast returned HTTP {status}"));
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
    for media in ["application/json", "text/html", "audio/mpeg"] {
        let (backend, counts) = transport(vec![b"unread".to_vec()], 200, media, true);
        let err = ready(synthesize(
            &request,
            &backend,
            Options {
                auth: Some(&auth),
                ..Default::default()
            },
        ))
        .err()
        .unwrap();
        assert_eq!(
            err.to_string(),
            "Typecast returned an unexpected content type"
        );
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn dropping_before_headers_during_read_and_after_envelope() {
    let auth = auth();
    let request = TtsRequest::SsfmV30TextVoicec9d5257e(fixtures::plain());
    let waker = Waker::from(Arc::new(Counts::default()));
    let mut cx = Context::from_waker(&waker);
    let (mut backend, counts) = transport(vec![b"unread".to_vec()], 200, "audio/wav", false);
    backend.pending = true;
    let mut pending = Box::pin(synthesize(
        &request,
        &backend,
        Options {
            auth: Some(&auth),
            ..Default::default()
        },
    ));
    assert!(pending.as_mut().poll(&mut cx).is_pending());
    assert_eq!(counts.drops.load(Ordering::SeqCst), 0);
    drop(pending);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
    let (backend, counts) = transport(vec![], 200, "audio/wav", true);
    let mut stream = ready(synthesize(
        &request,
        &backend,
        Options {
            auth: Some(&auth),
            ..Default::default()
        },
    ))
    .unwrap();
    assert!(Pin::new(&mut stream).poll_next(&mut cx).is_pending());
    drop(stream);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    let request = TtsRequest::SsfmV30TextVoiceda7d6fa9(fixtures::timed());
    let (backend, counts) = transport(
        vec![shared()["timestampResponse"].text().as_bytes().to_vec()],
        200,
        "application/json",
        false,
    );
    let mut stream = ready(synthesize(
        &request,
        &backend,
        Options {
            auth: Some(&auth),
            ..Default::default()
        },
    ))
    .unwrap();
    assert!(matches!(
        next(&mut stream),
        Some(Ok(SynthesisItem::Chunk(_)))
    ));
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    let reads = counts.reads.load(Ordering::SeqCst);
    drop(stream);
    assert_eq!(counts.reads.load(Ordering::SeqCst), reads);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn buffered_json_and_empty_producers_yield_between_reads() {
    let auth = auth();
    let request = TtsRequest::SsfmV30TextVoiceda7d6fa9(fixtures::timed());
    let (backend, counts) = transport(vec![b"{".to_vec(); 100], 200, "application/json", true);
    let mut stream = ready(synthesize(
        &request,
        &backend,
        Options {
            auth: Some(&auth),
            ..Default::default()
        },
    ))
    .unwrap();
    let wakes = Arc::new(Counts::default());
    let waker = Waker::from(wakes.clone());
    let mut cx = Context::from_waker(&waker);
    assert!(Pin::new(&mut stream).poll_next(&mut cx).is_pending());
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    assert_eq!(wakes.wakes.load(Ordering::SeqCst), 1);
    drop(stream);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    let request = TtsRequest::SsfmV30TextVoicec9d5257e(fixtures::plain());
    let (backend, counts) = transport(vec![vec![]; 100], 200, "audio/wav", true);
    let mut stream = ready(synthesize(
        &request,
        &backend,
        Options {
            auth: Some(&auth),
            ..Default::default()
        },
    ))
    .unwrap();
    assert!(Pin::new(&mut stream).poll_next(&mut cx).is_pending());
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    drop(stream);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn no_audio_limit_and_read_failures_never_emit_done() {
    let auth = auth();
    let request = TtsRequest::SsfmV30TextVoicec9d5257e(fixtures::plain());
    let (backend, counts) = transport(vec![vec![]], 200, "", false);
    let mut stream = ready(synthesize(
        &request,
        &backend,
        Options {
            auth: Some(&auth),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        collect(&mut stream).unwrap_err().to_string(),
        "Typecast returned no audio"
    );
    assert!(next(&mut stream).is_none());
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    let (backend, counts) = transport(vec![], 200, "audio/wav", false);
    backend.response.lock().unwrap().as_mut().unwrap().body = Box::pin(Body {
        chunks: VecDeque::from([Ok(b"first".to_vec()), Err(failure("original read failure"))]),
        counts: counts.clone(),
        stall: false,
    });
    let before = counts.drops.load(Ordering::SeqCst);
    let mut stream = ready(synthesize(
        &request,
        &backend,
        Options {
            auth: Some(&auth),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        item(next(&mut stream).unwrap().unwrap()),
        Value::Binary(b"first".to_vec())
    );
    assert_eq!(
        next(&mut stream).unwrap().err().unwrap().to_string(),
        "original read failure"
    );
    assert!(next(&mut stream).is_none());
    assert_eq!(counts.drops.load(Ordering::SeqCst), before + 1);
    let request = TtsRequest::SsfmV30TextVoiceda7d6fa9(fixtures::timed());
    let (backend, counts) = transport(
        vec![b"12345".to_vec(), b"unread".to_vec()],
        200,
        "application/json",
        true,
    );
    let mut stream = ready(synthesize(
        &request,
        &backend,
        Options {
            auth: Some(&auth),
            max_timestamp_response_bytes: 4,
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        collect(&mut stream).unwrap_err().to_string(),
        "Typecast timestamp response exceeds max_timestamp_response_bytes"
    );
    assert!(next(&mut stream).is_none());
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}
