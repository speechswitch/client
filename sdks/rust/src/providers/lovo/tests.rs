use super::*;
use crate::{
    generated::auth::AuthAsync,
    http::HttpRequest,
    runtime::{InputStream, StreamingInput},
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
struct Body {
    values: VecDeque<Result<Vec<u8>, TransportError>>,
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
        match s.values.pop_front() {
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
fn body(values: Vec<Vec<u8>>, stall: bool) -> (StreamingInput<Vec<u8>>, Arc<Counts>) {
    let counts = Arc::new(Counts::default());
    (
        Box::pin(Body {
            values: values.into_iter().map(Ok).collect(),
            counts: counts.clone(),
            stall,
        }),
        counts,
    )
}
struct Http {
    requests: Mutex<Vec<HttpRequest>>,
    responses: Mutex<VecDeque<HttpResponse>>,
}
impl Http {
    fn new(responses: Vec<HttpResponse>) -> Self {
        Self {
            requests: Mutex::new(Vec::new()),
            responses: Mutex::new(responses.into()),
        }
    }
}
impl HttpTransport for Http {
    fn send(
        &self,
        request: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        self.requests.lock().unwrap().push(request);
        Box::pin(async {
            Ok(self
                .responses
                .lock()
                .unwrap()
                .pop_front()
                .expect("unexpected request"))
        })
    }
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
fn next(s: &mut Stream<'_>) -> Option<Result<SynthesisItem, TransportError>> {
    ready(poll_fn(|cx| Pin::new(&mut *s).poll_next(cx)))
}
fn fixture(key: &str) -> String {
    Raw::parse_exact(include_str!("../../../../fixtures/lovo.json"))
        .unwrap()
        .object()
        .unwrap()[key]
        .text()
        .into()
}
fn object(text: &str) -> BTreeMap<String, String> {
    Raw::parse_exact(text)
        .unwrap()
        .object()
        .unwrap()
        .into_iter()
        .map(|(k, v)| (k, v.text().into()))
        .collect()
}
fn changed(text: &str, changes: &[(&str, &str)]) -> String {
    let mut fields = object(text);
    for (k, v) in changes {
        fields.insert((*k).into(), (*v).into());
    }
    let mut result = String::from("{");
    for (index, (key, value)) in fields.into_iter().enumerate() {
        if index != 0 {
            result.push(',');
        }
        crate::json::quote(&key, &mut result);
        result.push(':');
        result.push_str(&value);
    }
    result.push('}');
    result
}
fn job(changes: &[(&str, &str)]) -> String {
    changed(
        &changed(
            &fixture("job"),
            &[
                ("data", &format!("[{}]", fixture("output"))),
                ("callbackUrls", "[]"),
            ],
        ),
        changes,
    )
}
fn response(status: u16, text: &str) -> HttpResponse {
    HttpResponse {
        status,
        headers: Vec::new(),
        body: body(vec![text.as_bytes().to_vec()], false).0,
    }
}
fn request() -> TtsRequest {
    TtsRequest {
        text: "Hello".into(),
        voice: "existing-speaker".into(),
        speed: Some(0.5),
        voice_style: Some("style".into()),
    }
}
fn auth() -> Auth {
    Auth {
        lovo: Some(AuthAsync {
            api_key: Some("test-key".into()),
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
fn message<T>(result: Result<T, TransportError>) -> String {
    match result {
        Ok(_) => panic!("expected failure"),
        Err(err) => err.to_string(),
    }
}

#[test]
fn shared_fixture_and_early_bytes_release_on_drop() {
    let (audio, counts) = body(vec![vec![1, 2]], true);
    let (metadata, metadata_counts) = body(vec![job(&[]).into_bytes()], false);
    let http = Http::new(vec![
        HttpResponse {
            status: 201,
            headers: vec![],
            body: metadata,
        },
        HttpResponse {
            status: 200,
            headers: vec![],
            body: audio,
        },
    ]);
    let auth = auth();
    let mut s = ready(synthesize(
        &request(),
        &http,
        Options {
            auth: Some(&auth),
            base_url: Some("https://proxy.invalid/a%2Fb/?tenant=one"),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(metadata_counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(http.requests.lock().unwrap().len(), 1);
    let item = next(&mut s).unwrap().unwrap();
    assert_eq!(item.audio, vec![1, 2]);
    assert_eq!(item.correlation.value(), "ordered");
    assert_eq!(item.correlation_id, "job/1:0:0");
    assert_eq!(item.input_group_id, "job/1:0");
    assert_eq!(item.timestamps, []);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 0);
    drop(s);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    let calls = http.requests.lock().unwrap();
    assert_eq!(
        calls[0].url,
        "https://proxy.invalid/a%2Fb/api/v1/tts/sync?tenant=one"
    );
    assert_eq!(calls[0].method, "POST");
    assert_eq!(
        calls[0].headers,
        vec![
            ("X-API-KEY".into(), "test-key".into()),
            ("content-type".into(), "application/json".into())
        ]
    );
    assert_eq!(
        object(std::str::from_utf8(&calls[0].body).unwrap()),
        object(&fixture("wire"))
    );
    assert_eq!(calls[1].url, "https://audio.invalid/result.wav");
    assert_eq!(calls[1].method, "GET");
    assert_eq!(calls[1].headers, Vec::new());
    assert_eq!(calls[1].body, Vec::new());
}

#[test]
fn both_modes_poll_and_done_async_creation_retrieves() {
    for mode in [Mode::Sync, Mode::Async] {
        for status in ["done", "in_progress"] {
            let initial = job(&[("status", &format!("\"{status}\""))]);
            let initial = if mode == Mode::Async {
                changed(&initial, &[("data", "\"ignored extension\"")])
            } else {
                initial
            };
            let mut responses = vec![response(201, &initial)];
            if mode == Mode::Async || status == "in_progress" {
                responses.push(response(200, &job(&[])));
            }
            responses.push(response(200, "a"));
            let http = Http::new(responses);
            let auth = auth();
            let mut s = ready(synthesize(
                &request(),
                &http,
                Options {
                    auth: Some(&auth),
                    mode,
                    poll_interval_ms: 0,
                    ..Default::default()
                },
            ))
            .unwrap();
            assert_eq!(next(&mut s).unwrap().unwrap().audio, b"a");
            assert!(next(&mut s).is_none());
            assert!(next(&mut s).is_none());
            let calls = http.requests.lock().unwrap();
            assert_eq!(
                calls[0].url,
                if mode == Mode::Sync {
                    "https://api.genny.lovo.ai/api/v1/tts/sync"
                } else {
                    "https://api.genny.lovo.ai/api/v1/tts"
                }
            );
            if mode == Mode::Async || status == "in_progress" {
                assert_eq!(calls[1].url, "https://api.genny.lovo.ai/api/v1/tts/job%2F1");
                assert_eq!(calls[1].method, "GET");
            }
        }
    }
}

#[test]
fn distinct_files_keep_output_groups() {
    let output = changed(
        &fixture("output"),
        &[(
            "urls",
            "[\"https://audio.invalid/a\",\"https://audio.invalid/b\"]",
        )],
    );
    let http = Http::new(vec![
        response(
            201,
            &job(&[("data", &format!("[{output},{}]", fixture("output")))]),
        ),
        response(200, "a"),
        response(200, "b"),
        response(200, "c"),
    ]);
    let auth = auth();
    let mut s = ready(synthesize(
        &request(),
        &http,
        Options {
            auth: Some(&auth),
            ..Default::default()
        },
    ))
    .unwrap();
    for (id, group, bytes) in [
        ("job/1:0:0", "job/1:0", b"a"),
        ("job/1:0:1", "job/1:0", b"b"),
        ("job/1:1:0", "job/1:1", b"c"),
    ] {
        let item = next(&mut s).unwrap().unwrap();
        assert_eq!(item.correlation_id, id);
        assert_eq!(item.input_group_id, group);
        assert_eq!(item.audio, bytes);
    }
    assert!(next(&mut s).is_none());
}

#[test]
fn generated_guards_precede_auth_and_io() {
    let http = Http::new(vec![]);
    for change in [
        "text",
        "voice",
        "long",
        "speed low",
        "speed high",
        "nan",
        "infinity",
    ] {
        let mut r = request();
        match change {
            "text" => r.text.clear(),
            "voice" => r.voice.clear(),
            "long" => r.text = "😀".repeat(501),
            "speed low" => r.speed = Some(0.0),
            "speed high" => r.speed = Some(3.01),
            "nan" => r.speed = Some(f64::NAN),
            _ => r.speed = Some(f64::INFINITY),
        }
        assert_eq!(
            message(ready(synthesize(&r, &http, Options::default()))),
            "Invalid lovo TTS request"
        );
    }
    assert_eq!(http.requests.lock().unwrap().len(), 0);
    let auth = auth();
    for speed in [0.05, 3.0] {
        let r = TtsRequest {
            text: "😀".repeat(500),
            speed: Some(speed),
            ..request()
        };
        let http = Http::new(vec![response(401, "denied")]);
        assert_eq!(
            message(ready(synthesize(
                &r,
                &http,
                Options {
                    auth: Some(&auth),
                    ..Default::default()
                }
            ))),
            "denied"
        );
    }
}

#[test]
fn boundary_auth_url_and_defaults() {
    let mut auth = auth();
    let http = Http::new(vec![]);
    auth.lovo.as_mut().unwrap().api_key = Some(String::new());
    assert_eq!(
        message(ready(synthesize(
            &request(),
            &http,
            Options {
                auth: Some(&auth),
                ..Default::default()
            }
        ))),
        "Missing auth.lovo.apiKey configuration"
    );
    auth.lovo.as_mut().unwrap().api_key = Some("a\n".into());
    assert_eq!(
        message(ready(synthesize(
            &request(),
            &http,
            Options {
                auth: Some(&auth),
                ..Default::default()
            }
        ))),
        "Invalid LOVO authentication header"
    );
    auth.lovo.as_mut().unwrap().api_key = Some("key".into());
    for url in [
        "https://user:pw@api.invalid",
        "https://api.invalid/#x",
        "https://api.invalid/%zz",
        "https://api.invalid/?x=%zz",
        "https://api.invalid:65536",
        "https://api.invalid/a b",
        "https://api.invalid/\\x",
    ] {
        assert_eq!(
            message(ready(synthesize(
                &request(),
                &http,
                Options {
                    auth: Some(&auth),
                    base_url: Some(url),
                    ..Default::default()
                }
            ))),
            "LOVO URL must be HTTP(S) without credentials, fragments or invalid escapes"
        );
    }
    assert_eq!(
        origin("HTTP://Api.invalid:00080/a").unwrap(),
        "http://api.invalid:80"
    );
    assert_eq!(
        origin("http://api.invalid:0").unwrap(),
        "http://api.invalid:0"
    );
    let r = TtsRequest {
        speed: None,
        voice_style: None,
        ..request()
    };
    let http = Http::new(vec![response(401, "denied")]);
    assert_eq!(
        message(ready(synthesize(
            &r,
            &http,
            Options {
                auth: Some(&auth),
                ..Default::default()
            }
        ))),
        "denied"
    );
    assert_eq!(
        object(std::str::from_utf8(&http.requests.lock().unwrap()[0].body).unwrap()),
        object("{\"text\":\"Hello\",\"speaker\":\"existing-speaker\",\"speed\":1}")
    );
}

#[test]
fn all_outputs_are_checked_before_downloads() {
    let failed = changed(&fixture("output"), &[("status", "\"failed\"")]);
    let unsafe_asset = changed(
        &fixture("output"),
        &[(
            "urls",
            "[\"https://audio.invalid/a\",\"http://other.invalid/b\"]",
        )],
    );
    for (raw, expected) in [
        (job(&[("id", "\"..\"")]), "LOVO returned an invalid job ID"),
        (
            job(&[("type", "\"dubbing\"")]),
            "LOVO returned a non-TTS job",
        ),
        (
            job(&[("data", "[]")]),
            "LOVO completed without audio outputs",
        ),
        (
            job(&[("data", &format!("[{},{}]", fixture("output"), failed))]),
            "LOVO speech output failed",
        ),
        (
            job(&[("data", &format!("[{unsafe_asset}]"))]),
            "LOVO returned an unsafe audio URL",
        ),
        (
            job(&[("error", "{\"code\":\"QUOTA\",\"message\":\"quota\"}")]),
            "quota",
        ),
    ] {
        let http = Http::new(vec![response(201, &raw)]);
        let auth = auth();
        let error = ready(synthesize(
            &request(),
            &http,
            Options {
                auth: Some(&auth),
                ..Default::default()
            },
        ))
        .err()
        .unwrap();
        assert_eq!(error.to_string(), expected);
        if expected == "quota" {
            assert_eq!(
                error.downcast_ref::<Error>().unwrap(),
                &Error {
                    message: "quota".into(),
                    code: Some("QUOTA".into()),
                    job_id: Some("job/1".into()),
                    status_code: None,
                    retry_after: None
                }
            );
        }
        assert_eq!(http.requests.lock().unwrap().len(), 1);
    }
}

#[test]
fn polling_rejects_changed_id_and_inconsistent_completion() {
    for (mode, status, final_job, expected) in [
        (
            Mode::Sync,
            "in_progress",
            job(&[("id", "\"other\"")]),
            "LOVO returned a different job ID while polling",
        ),
        (
            Mode::Async,
            "done",
            job(&[("status", "\"in_progress\"")]),
            "LOVO returned an inconsistent completed job",
        ),
    ] {
        let http = Http::new(vec![
            response(201, &job(&[("status", &format!("\"{status}\""))])),
            response(200, &final_job),
        ]);
        let auth = auth();
        assert_eq!(
            message(ready(synthesize(
                &request(),
                &http,
                Options {
                    auth: Some(&auth),
                    mode,
                    poll_interval_ms: 0,
                    ..Default::default()
                }
            ))),
            expected
        );
        assert_eq!(http.requests.lock().unwrap().len(), 2);
    }
}

#[test]
fn metadata_status_bounds_and_bom() {
    let auth = auth();
    for (status, text, limit, expected) in [
        (200, "", 1024, "LOVO returned HTTP 200; expected 201"),
        (201, "{", 1024, "LOVO returned invalid JSON"),
        (201, "{}", 1024, "Invalid LOVO sync-tts response"),
        (500, "abcd", 3, "LOVO response exceeds max_json_bytes"),
    ] {
        let http = Http::new(vec![response(status, text)]);
        assert_eq!(
            message(ready(synthesize(
                &request(),
                &http,
                Options {
                    auth: Some(&auth),
                    max_json_bytes: limit,
                    ..Default::default()
                }
            ))),
            expected
        );
    }
    let http = Http::new(vec![
        response(201, &format!("\u{feff}{}", job(&[]))),
        HttpResponse {
            status: 403,
            headers: vec![("Retry-After".into(), "".into())],
            body: body(vec![b"denied".to_vec()], false).0,
        },
    ]);
    let mut s = ready(synthesize(
        &request(),
        &http,
        Options {
            auth: Some(&auth),
            ..Default::default()
        },
    ))
    .unwrap();
    let error = next(&mut s).unwrap().err().unwrap();
    assert_eq!(
        error.downcast_ref::<Error>().unwrap(),
        &Error {
            message: "denied".into(),
            status_code: Some(403),
            job_id: Some("job/1".into()),
            code: None,
            retry_after: Some("".into())
        }
    );
    assert!(next(&mut s).is_none());
}

#[test]
fn dropping_pending_metadata_or_audio_releases_body() {
    for audio in [false, true] {
        let (pending, counts) = body(vec![], true);
        let mut responses = vec![];
        if audio {
            responses.push(response(201, &job(&[])));
        }
        responses.push(HttpResponse {
            status: if audio { 200 } else { 201 },
            headers: vec![],
            body: pending,
        });
        let http = Http::new(responses);
        let auth = auth();
        let request = request();
        let waker = Waker::from(Arc::new(Counts::default()));
        let mut cx = Context::from_waker(&waker);
        if audio {
            let mut stream = ready(synthesize(
                &request,
                &http,
                Options {
                    auth: Some(&auth),
                    ..Default::default()
                },
            ))
            .unwrap();
            assert!(Pin::new(&mut stream).poll_next(&mut cx).is_pending());
            drop(stream);
        } else {
            let mut pending = Box::pin(synthesize(
                &request,
                &http,
                Options {
                    auth: Some(&auth),
                    ..Default::default()
                },
            ));
            assert!(pending.as_mut().poll(&mut cx).is_pending());
            drop(pending);
        }
        assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn dropping_poll_delay_does_not_submit_again() {
    let http = Http::new(vec![response(201, &job(&[("status", "\"in_progress\"")]))]);
    let auth = auth();
    let request = request();
    let mut pending = Box::pin(synthesize(
        &request,
        &http,
        Options {
            auth: Some(&auth),
            poll_interval_ms: 60000,
            ..Default::default()
        },
    ));
    let waker = Waker::from(Arc::new(Counts::default()));
    let mut cx = Context::from_waker(&waker);
    for _ in 0..4 {
        assert!(pending.as_mut().poll(&mut cx).is_pending());
    }
    drop(pending);
    assert_eq!(http.requests.lock().unwrap().len(), 1);
}

struct Guard(Arc<Counts>);
impl Drop for Guard {
    fn drop(&mut self) {
        self.0.drops.fetch_add(1, Ordering::SeqCst);
    }
}
struct Delayed {
    http: Http,
    after: usize,
    counts: Arc<Counts>,
}
impl HttpTransport for Delayed {
    fn send(
        &self,
        request: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        if self.http.requests.lock().unwrap().len() < self.after {
            return self.http.send(request);
        }
        self.http.requests.lock().unwrap().push(request);
        let guard = Guard(self.counts.clone());
        Box::pin(async move {
            let _guard = guard;
            std::future::pending().await
        })
    }
}
#[test]
fn dropping_pending_submission_poll_or_asset_headers_cancels_send() {
    for phase in ["submission", "poll", "asset"] {
        let counts = Arc::new(Counts::default());
        let http = Delayed {
            http: Http::new(vec![response(
                201,
                &job(&[(
                    "status",
                    if phase == "poll" {
                        "\"in_progress\""
                    } else {
                        "\"done\""
                    },
                )]),
            )]),
            after: if phase == "submission" { 0 } else { 1 },
            counts: counts.clone(),
        };
        let auth = auth();
        let request = request();
        let waker = Waker::from(Arc::new(Counts::default()));
        let mut cx = Context::from_waker(&waker);
        if phase == "asset" {
            let mut s = ready(synthesize(
                &request,
                &http,
                Options {
                    auth: Some(&auth),
                    ..Default::default()
                },
            ))
            .unwrap();
            assert!(Pin::new(&mut s).poll_next(&mut cx).is_pending());
            drop(s);
        } else {
            let mut pending = Box::pin(synthesize(
                &request,
                &http,
                Options {
                    auth: Some(&auth),
                    poll_interval_ms: 0,
                    ..Default::default()
                },
            ));
            for _ in 0..5 {
                assert!(pending.as_mut().poll(&mut cx).is_pending());
            }
            drop(pending);
        }
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(
            http.http.requests.lock().unwrap().len(),
            if phase == "submission" { 1 } else { 2 }
        );
    }
}

struct ThreadWake(std::thread::Thread);
impl Wake for ThreadWake {
    fn wake(self: Arc<Self>) {
        self.0.unpark();
    }
    fn wake_by_ref(self: &Arc<Self>) {
        self.0.unpark();
    }
}
#[test]
fn timer_wakes_the_executor_to_poll_a_real_interval() {
    let http = Http::new(vec![
        response(201, &job(&[("status", "\"in_progress\"")])),
        response(200, &job(&[])),
    ]);
    let auth = auth();
    let request = request();
    let started = std::time::Instant::now();
    let mut pending = Box::pin(synthesize(
        &request,
        &http,
        Options {
            auth: Some(&auth),
            poll_interval_ms: 10,
            ..Default::default()
        },
    ));
    let waker = Waker::from(Arc::new(ThreadWake(std::thread::current())));
    let mut cx = Context::from_waker(&waker);
    loop {
        match pending.as_mut().poll(&mut cx) {
            Poll::Ready(result) => {
                drop(result.unwrap());
                break;
            }
            Poll::Pending => {
                assert!(started.elapsed() < std::time::Duration::from_secs(3));
                std::thread::park_timeout(std::time::Duration::from_millis(20));
            }
        }
    }
    assert!(started.elapsed() >= std::time::Duration::from_millis(10));
    assert_eq!(http.requests.lock().unwrap().len(), 2);
}

#[test]
fn read_errors_keep_identity_and_release_resources() {
    for audio in [false, true] {
        let original = Box::new(std::io::Error::other("original"));
        let address = &*original as *const std::io::Error;
        let counts = Arc::new(Counts::default());
        let failed = Box::pin(Body {
            values: vec![Err(original as TransportError)].into(),
            counts: counts.clone(),
            stall: false,
        });
        let mut responses = vec![];
        if audio {
            responses.push(response(201, &job(&[])));
        }
        responses.push(HttpResponse {
            status: if audio { 200 } else { 201 },
            headers: vec![],
            body: failed,
        });
        let http = Http::new(responses);
        let auth = auth();
        let error = if audio {
            let mut s = ready(synthesize(
                &request(),
                &http,
                Options {
                    auth: Some(&auth),
                    ..Default::default()
                },
            ))
            .unwrap();
            let error = next(&mut s).unwrap().err().unwrap();
            assert!(next(&mut s).is_none());
            error
        } else {
            ready(synthesize(
                &request(),
                &http,
                Options {
                    auth: Some(&auth),
                    ..Default::default()
                },
            ))
            .err()
            .unwrap()
        };
        assert_eq!(
            error.downcast_ref::<std::io::Error>().unwrap() as *const std::io::Error,
            address
        );
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn configured_http_origin_is_allowed_without_credentials() {
    let output = changed(
        &fixture("output"),
        &[("urls", "[\"HTTP://API.invalid:00080/audio\"]")],
    );
    let http = Http::new(vec![
        response(201, &job(&[("data", &format!("[{output}]"))])),
        response(200, "a"),
    ]);
    let auth = auth();
    let mut s = ready(synthesize(
        &request(),
        &http,
        Options {
            auth: Some(&auth),
            base_url: Some("http://api.invalid"),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(next(&mut s).unwrap().unwrap().audio, b"a");
    let calls = http.requests.lock().unwrap();
    assert_eq!(calls[1].url, "HTTP://API.invalid:00080/audio");
    assert_eq!(calls[1].headers, Vec::new());
}

#[test]
fn asset_errors_are_bounded_and_redirects_are_not_replayed() {
    let auth = auth();
    for phase in ["submission", "asset", "oversize"] {
        let mut responses = vec![];
        if phase != "submission" {
            responses.push(response(201, &job(&[])));
        }
        responses.push(if phase == "oversize" {
            response(500, &"x".repeat(1025))
        } else {
            HttpResponse {
                status: 307,
                headers: vec![("Location".into(), "https://other.invalid".into())],
                body: body(vec![], false).0,
            }
        });
        let http = Http::new(responses);
        let result = ready(synthesize(
            &request(),
            &http,
            Options {
                auth: Some(&auth),
                max_json_bytes: 1024,
                ..Default::default()
            },
        ));
        let error = if phase == "submission" {
            result.err().unwrap()
        } else {
            next(&mut result.unwrap()).unwrap().err().unwrap()
        };
        assert_eq!(
            error.to_string(),
            match phase {
                "submission" => "LOVO returned HTTP 307; expected 201",
                "asset" => "LOVO audio download returned HTTP 307",
                _ => "LOVO response exceeds max_json_bytes",
            }
        );
        assert_eq!(
            http.requests.lock().unwrap().len(),
            if phase == "submission" { 1 } else { 2 }
        );
    }
}

#[test]
fn scoped_environment_precedes_native_and_empty_blocks_fallback() {
    struct Restore(Vec<(&'static str, Option<std::ffi::OsString>)>);
    impl Drop for Restore {
        fn drop(&mut self) {
            for (key, value) in &self.0 {
                match value {
                    Some(value) => std::env::set_var(key, value),
                    None => std::env::remove_var(key),
                }
            }
        }
    }
    let _restore = Restore(
        ["SPEECHSWITCH_LOVO_API_KEY", "LOVO_API_KEY"]
            .into_iter()
            .map(|key| (key, std::env::var_os(key)))
            .collect(),
    );
    std::env::set_var("LOVO_API_KEY", "native");
    std::env::remove_var("SPEECHSWITCH_LOVO_API_KEY");
    for expected in ["native", "scoped"] {
        if expected == "scoped" {
            std::env::set_var("SPEECHSWITCH_LOVO_API_KEY", "scoped");
        }
        let http = Http::new(vec![response(401, "denied")]);
        assert_eq!(
            message(ready(synthesize(&request(), &http, Options::default()))),
            "denied"
        );
        assert_eq!(http.requests.lock().unwrap()[0].headers[0].1, expected);
    }
    std::env::set_var("SPEECHSWITCH_LOVO_API_KEY", "");
    let http = Http::new(vec![]);
    assert_eq!(
        message(ready(synthesize(&request(), &http, Options::default()))),
        "Missing auth.lovo.apiKey configuration"
    );
    for options in [
        Options {
            poll_interval_ms: 2147483648,
            ..Default::default()
        },
        Options {
            max_json_bytes: 0,
            ..Default::default()
        },
    ] {
        let expected = if options.max_json_bytes == 0 {
            "LOVO max_json_bytes must be a positive uint32 value"
        } else {
            "LOVO polling interval must be an integer between 0 and 2147483647"
        };
        assert_eq!(
            message(ready(synthesize(&request(), &http, options))),
            expected
        );
    }
    assert_eq!(http.requests.lock().unwrap().len(), 0);
}
