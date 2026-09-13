use super::*;
use crate::{
    generated::{auth::AuthResemble, resemble::*},
    msgpack::{tests::fixture as json_value, Value},
};
use std::{
    collections::VecDeque,
    future::Future,
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
struct Transport {
    requests: Mutex<Vec<HttpRequest>>,
    responses: Mutex<VecDeque<Result<HttpResponse, TransportError>>>,
    pending_at: Option<usize>,
}
impl HttpTransport for Transport {
    fn send(
        &self,
        request: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        let index = {
            let mut requests = self.requests.lock().unwrap();
            let index = requests.len();
            requests.push(request);
            index
        };
        Box::pin(async move {
            let response = self
                .responses
                .lock()
                .unwrap()
                .pop_front()
                .expect("unexpected request");
            if self.pending_at == Some(index) {
                std::future::pending::<()>().await;
            }
            response
        })
    }
}
fn transport(responses: Vec<HttpResponse>) -> Transport {
    Transport {
        requests: Mutex::new(vec![]),
        responses: Mutex::new(responses.into_iter().map(Ok).collect()),
        pending_at: None,
    }
}
fn response(
    chunks: Vec<Vec<u8>>,
    status: u16,
    media: &str,
    stall: bool,
) -> (HttpResponse, Arc<Counts>) {
    let counts = Arc::new(Counts::default());
    (
        HttpResponse {
            status,
            headers: vec![
                ("CONTENT-Type".into(), media.into()),
                ("Retry-After".into(), "7".into()),
            ],
            body: Box::pin(Body {
                chunks: chunks.into_iter().map(Ok).collect(),
                counts: counts.clone(),
                stall,
            }),
        },
        counts,
    )
}
fn reply(data: &str, media: &str) -> HttpResponse {
    response(vec![data.as_bytes().to_vec()], 200, media, false).0
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
    panic!("did not finish")
}
fn next(stream: &mut Stream) -> Option<Result<SynthesisItem, TransportError>> {
    ready(poll_fn(|cx| Pin::new(&mut *stream).poll_next(cx)))
}
fn value(text: &str) -> Value {
    json_value(Raw::parse(text).unwrap())
}
fn item_value(item: SynthesisItem) -> Value {
    match item {
        SynthesisItem::Bytes(bytes) => Value::Map(
            [(
                "audio".into(),
                Value::Array(bytes.into_iter().map(|b| Value::Number(b.into())).collect()),
            )]
            .into(),
        ),
        SynthesisItem::Done(event) => Value::Map(
            [
                ("event".into(), Value::String(event.event.value().into())),
                ("requestId".into(), Value::String(event.request_id)),
            ]
            .into(),
        ),
    }
}
fn collect(stream: &mut Stream) -> (Vec<Value>, Option<String>) {
    let mut output = vec![];
    while let Some(item) = next(stream) {
        match item {
            Ok(item) => output.push(item_value(item)),
            Err(err) => return (output, Some(err.to_string())),
        }
    }
    (output, None)
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
        resemble: Some(AuthResemble {
            token: Some("fixture".into()),
        }),
        respeecher: None,
        rime: None,
        smallest_ai: None,
        typecast: None,
        vocu: None,
        voice_ai: None,
        xai: None,
    }
}
fn base() -> TtsRequestText {
    TtsRequestText {
        model: None,
        text: "Hello".into(),
        output: None,
        random_seed: None,
        reference_audio: None,
        reference_audio_trimming: None,
        style_exaggeration: None,
        temperature: None,
        voice_guidance: None,
    }
}
fn turbo() -> TtsRequestChatterboxTurboText {
    TtsRequestChatterboxTurboText {
        model: Default::default(),
        text: "Hello".into(),
        output: None,
        random_seed: None,
        reference_audio: None,
        temperature: None,
        min_p: None,
        top_p: None,
        top_k: None,
        repetition_penalty: None,
        loudness_normalization: None,
    }
}
fn request(value: Raw<'_>) -> TtsRequest {
    let r = value.object().unwrap();
    let number = |name| r.get(name).map(|v| v.number().unwrap());
    let boolean = |name| {
        r.get(name).map(|v| {
            if v.boolean().unwrap() {
                TtsRequestTextReferenceAudioTrimming::True(Default::default())
            } else {
                TtsRequestTextReferenceAudioTrimming::False(Default::default())
            }
        })
    };
    let reference_audio = r.get("referenceAudio").map(|v| {
        v.array()
            .unwrap()
            .iter()
            .map(|v| v.number().unwrap() as u8)
            .collect()
    });
    let output = r.get("output").map(|v| {
        assert_eq!(v.object().unwrap()["format"].string().unwrap(), "wav");
        TtsRequestTextOutput {
            format: Default::default(),
        }
    });
    let text = r["text"].string().unwrap();
    match r
        .get("model")
        .map(|v| v.string().unwrap())
        .as_deref()
        .unwrap_or("chatterbox")
    {
        "chatterbox" => TtsRequest::Text(TtsRequestText {
            model: r.get("model").map(|_| Default::default()),
            text,
            reference_audio,
            output,
            temperature: number("temperature"),
            random_seed: number("randomSeed"),
            style_exaggeration: number("styleExaggeration"),
            voice_guidance: number("voiceGuidance"),
            reference_audio_trimming: boolean("referenceAudioTrimming"),
        }),
        "chatterbox-multilingual" => {
            TtsRequest::ChatterboxMultilingualText(TtsRequestChatterboxMultilingualText {
                model: Default::default(),
                text,
                reference_audio,
                output,
                temperature: number("temperature"),
                random_seed: number("randomSeed"),
                style_exaggeration: number("styleExaggeration"),
                voice_guidance: number("voiceGuidance"),
                language: r.get("language").map(|v| {
                    assert_eq!(v.string().unwrap(), "fr");
                    TtsRequestChatterboxMultilingualTextLanguage::Fr(Default::default())
                }),
            })
        }
        "chatterbox-turbo" => TtsRequest::ChatterboxTurboText(TtsRequestChatterboxTurboText {
            model: Default::default(),
            text,
            reference_audio,
            output,
            temperature: number("temperature"),
            random_seed: number("randomSeed"),
            min_p: number("minP"),
            top_p: number("topP"),
            top_k: number("topK"),
            repetition_penalty: number("repetitionPenalty"),
            loudness_normalization: boolean("loudnessNormalization"),
        }),
        model => panic!("unexpected fixture model {model}"),
    }
}
const SUBMITTED: &str = "{\"event_id\":\"event/?#雪\"}";
const COMPLETE: &str = "event: complete\ndata: [{\"path\":\"/tmp/gradio/file with?#雪.wav\"}]\n\n";

#[test]
fn shared_requests_preserve_model_inputs_and_multipart_bytes() {
    let fixtures = Raw::parse(include_str!("../../../../fixtures/resemble.json"))
        .unwrap()
        .object()
        .unwrap();
    let auth = auth();
    for fixture in fixtures["requests"].array().unwrap() {
        let fixture = fixture.object().unwrap();
        let request = request(fixture["request"]);
        let input = settings::settings(&request);
        let mut replies = vec![];
        let mut paths = vec![];
        let mut methods = vec![];
        if input.reference.is_some() {
            replies.push(reply("[\"/uploaded/reference\"]", "application/json"));
            paths.push("/gradio_api/upload".to_owned());
            methods.push("POST");
        } else if input.needs_reference {
            replies.push(reply(r#"{"named_endpoints":{"/generate":{"parameters":[null,{"parameter_name":"audio_prompt_path","parameter_default":{"path":"/current/cache/reference.wav","url":"https://wrong.example/generic.wav"}}]}}}"#, "application/json"));
            paths.push("/gradio_api/info".into());
            methods.push("GET");
        }
        replies.push(reply(SUBMITTED, "application/json"));
        let (queue, queue_counts) = response(
            vec![COMPLETE.as_bytes().to_vec()],
            200,
            " Text/Event-Stream ; charset=utf-8",
            true,
        );
        replies.push(queue);
        let (audio, audio_counts) = response(vec![vec![0, 255, 128]], 200, "audio/wav", false);
        replies.push(audio);
        let backend = transport(replies);
        let mut stream = ready(synthesize(
            &request,
            &backend,
            Options {
                auth: Some(&auth),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(queue_counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(audio_counts.reads.load(Ordering::SeqCst), 0);
        assert_eq!(
            collect(&mut stream),
            (
                vec![
                    value(r#"{"audio":[0,255,128]}"#),
                    value(r#"{"event":"done","requestId":"event/?#雪"}"#)
                ],
                None
            )
        );
        assert_eq!(audio_counts.drops.load(Ordering::SeqCst), 1);
        let calls = backend.requests.lock().unwrap();
        assert_eq!(
            value(std::str::from_utf8(&calls[calls.len() - 3].body).unwrap()),
            json_value(fixture["wire"])
        );
        let api = fixture["api"].string().unwrap();
        paths.extend([
            format!("/gradio_api/call/{api}"),
            format!("/gradio_api/call/{api}/event%2F%3F%23%E9%9B%AA"),
            "/gradio_api/file=%2Ftmp%2Fgradio%2Ffile%20with%3F%23%E9%9B%AA.wav".into(),
        ]);
        methods.extend(["POST", "GET", "GET"]);
        let host = fixture["host"].string().unwrap();
        assert_eq!(
            calls.iter().map(|r| r.url.clone()).collect::<Vec<_>>(),
            paths
                .iter()
                .map(|p| format!("https://{host}{p}"))
                .collect::<Vec<_>>()
        );
        assert_eq!(
            calls.iter().map(|r| r.method.as_str()).collect::<Vec<_>>(),
            methods
        );
        for call in calls.iter() {
            assert_eq!(
                call.headers
                    .iter()
                    .find(|(name, _)| name == "Authorization")
                    .map(|(_, value)| value.as_str()),
                Some("Bearer fixture")
            );
        }
        if let Some(reference) = input.reference {
            let call = &calls[0];
            let boundary = call
                .headers
                .iter()
                .find(|(name, _)| name == "Content-Type")
                .unwrap()
                .1
                .strip_prefix("multipart/form-data; boundary=")
                .unwrap();
            let mut expected = format!("--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"reference.audio\"\r\nContent-Type: application/octet-stream\r\n\r\n").into_bytes();
            expected.extend(reference);
            expected.extend(format!("\r\n--{boundary}--\r\n").as_bytes());
            assert_eq!(call.body, expected);
        }
    }
}

#[test]
fn shared_queue_streams_at_every_byte_split() {
    let fixtures = Raw::parse(include_str!("../../../../fixtures/resemble.json"))
        .unwrap()
        .object()
        .unwrap();
    let auth = auth();
    for case in fixtures["streams"].array().unwrap() {
        let case = case.object().unwrap();
        let data = case["body"].string().unwrap();
        for split in 0..=data.len() {
            let (queue, counts) = response(
                vec![
                    data.as_bytes()[..split].to_vec(),
                    data.as_bytes()[split..].to_vec(),
                ],
                200,
                "text/event-stream",
                false,
            );
            let (audio, audio_counts) = response(vec![vec![0, 255, 128]], 200, "audio/wav", false);
            let backend = transport(vec![reply(SUBMITTED, "application/json"), queue, audio]);
            let (output, error) = match ready(synthesize(
                &TtsRequest::Text(base()),
                &backend,
                Options {
                    auth: Some(&auth),
                    ..Default::default()
                },
            )) {
                Ok(mut stream) => collect(&mut stream),
                Err(err) => (vec![], Some(err.to_string())),
            };
            assert_eq!(
                output,
                case["output"]
                    .array()
                    .unwrap()
                    .into_iter()
                    .map(json_value)
                    .collect::<Vec<_>>(),
                "split {split}"
            );
            assert_eq!(
                error,
                if case["error"].is_null() {
                    None
                } else {
                    Some(case["error"].string().unwrap())
                },
                "split {split}"
            );
            assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
            assert_eq!(
                audio_counts.drops.load(Ordering::SeqCst),
                usize::from(error.is_none())
            );
            assert_eq!(
                backend.requests.lock().unwrap().len(),
                if error.is_none() { 3 } else { 2 }
            );
        }
    }
}

#[test]
fn stream_owns_audio_independently_of_request_and_backend_and_closes_on_drop() {
    let counts;
    let mut stream = {
        let request = TtsRequest::Text(base());
        let auth = auth();
        let (audio, c) = response(
            vec![vec![], b"first".to_vec(), b"second".to_vec()],
            200,
            "audio/wav",
            true,
        );
        counts = c;
        let backend = transport(vec![
            reply(SUBMITTED, "application/json"),
            reply(COMPLETE, "text/event-stream"),
            audio,
        ]);
        ready(synthesize(
            &request,
            &backend,
            Options {
                auth: Some(&auth),
                ..Default::default()
            },
        ))
        .unwrap()
    };
    assert_eq!(
        item_value(next(&mut stream).unwrap().unwrap()),
        value(r#"{"audio":[102,105,114,115,116]}"#)
    );
    assert_eq!(counts.reads.load(Ordering::SeqCst), 2);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 0);
    drop(stream);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 2);
}

#[test]
fn url_auth_boundaries_preserve_proxy_paths_and_raw_queries() {
    let auth = auth();
    for (url, expected, authorized) in [
        (None, "https://proxy.test/root/gradio_api/file=%2Ftmp%2Fa%20%3F%23%E9%9B%AA.wav?tenant=one;two&x=%2F", true),
        (Some("gradio_api/file=audio.wav?sig=one;two&x=%2F"), "https://proxy.test/root/gradio_api/file=audio.wav?sig=one;two&x=%2F", true),
        (Some("https://PROXY.test:443/audio"), "https://PROXY.test:443/audio", true),
        (Some("https://cdn.test/audio?sig=%2F"), "https://cdn.test/audio?sig=%2F", false),
        (Some("//cdn.test/audio"), "https://cdn.test/audio", false),
        (Some("https://proxy.test:0/audio"), "https://proxy.test:0/audio", false),
        (Some("../audio.wav"), "https://proxy.test/audio.wav", true),
        (Some("?signed=%2F"), "https://proxy.test/root/?signed=%2F", true),
    ] {
        let mut file = String::from("event: complete\ndata: [{\"path\":\"/tmp/a ?#雪.wav\",\"url\":"); if let Some(url) = url { json::quote(url, &mut file); } else { file.push_str("null"); } file.push_str("}]\n\n");
        let backend = transport(vec![reply(SUBMITTED, "application/json"), reply(&file, "text/event-stream"), reply("audio", "audio/wav")]);
        let mut stream = ready(synthesize(&TtsRequest::Text(base()), &backend, Options { auth: Some(&auth), base_url: Some("https://proxy.test/root?tenant=one;two&x=%2F"), ..Default::default() })).unwrap();
        assert_eq!(collect(&mut stream).1, None);
        let calls = backend.requests.lock().unwrap();
        assert_eq!(calls.iter().map(|r| r.url.as_str()).collect::<Vec<_>>(), vec!["https://proxy.test/root/gradio_api/call/generate_tts_audio?tenant=one;two&x=%2F", "https://proxy.test/root/gradio_api/call/generate_tts_audio/event%2F%3F%23%E9%9B%AA?tenant=one;two&x=%2F", expected]);
        assert_eq!(calls[2].headers, if authorized { vec![("Authorization".into(), "Bearer fixture".into())] } else { vec![] });
        assert_eq!(calls[2].body, vec![]);
    }
    for (base, relative, expected) in [
        (
            "https://proxy.test/a%2Fb/?x=1",
            "./file%20name?sig=%2F",
            "https://proxy.test/a%2Fb/file%20name?sig=%2F",
        ),
        (
            "http://localhost:8080/root/",
            "/audio.wav",
            "http://localhost:8080/audio.wav",
        ),
        (
            "https://proxy.test/a/b/",
            "../../audio.wav",
            "https://proxy.test/audio.wav",
        ),
    ] {
        assert_eq!(
            Url::parse(base).unwrap().resolve(relative).unwrap().text(),
            expected
        );
    }
    assert!(Url::parse("HTTPS://[0:0:0:0:0:0:0:1]:443/root")
        .unwrap()
        .same_origin(&Url::parse("https://[::1]/audio").unwrap()));
}

#[test]
fn unsafe_asset_urls_stop_before_download() {
    let auth = auth();
    for url in [
        "file:///tmp/a.wav",
        "http://cdn.test/audio",
        "https://user:pass@cdn.test/audio",
        "https://cdn.test/%wrong",
        "https://cdn.test/audio#fragment",
        "\\\\cdn.test\\audio",
        "\nhttps://cdn.test/audio",
    ] {
        let mut file = String::from("event: complete\ndata: [{\"path\":\"a\",\"url\":");
        json::quote(url, &mut file);
        file.push_str("}]\n\n");
        let backend = transport(vec![
            reply(SUBMITTED, "application/json"),
            reply(&file, "text/event-stream"),
        ]);
        let err = ready(synthesize(
            &TtsRequest::Text(base()),
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
            if url == "http://cdn.test/audio" {
                "Resemble returned an unsafe audio URL"
            } else {
                "Invalid Resemble deployment or audio URL"
            }
        );
        assert_eq!(backend.requests.lock().unwrap().len(), 2);
    }
}

#[test]
fn dropping_pending_future_cancels_every_phase() {
    let auth = auth();
    for stage in ["upload", "info", "submit", "queue", "download", "error"] {
        for headers in [false, true] {
            let mut request = TtsRequest::Text(base());
            let mut replies = vec![];
            if stage == "upload" {
                let mut r = base();
                r.reference_audio = Some(vec![0, 255]);
                request = TtsRequest::Text(r);
            }
            if stage == "info" {
                request = TtsRequest::ChatterboxTurboText(turbo());
            }
            if matches!(stage, "queue" | "download") {
                replies.push(reply(SUBMITTED, "application/json"));
            }
            if stage == "download" {
                replies.push(reply(COMPLETE, "text/event-stream"));
            }
            let before = replies.len();
            let media = if stage == "queue" {
                "text/event-stream"
            } else if stage == "download" {
                "audio/wav"
            } else {
                "application/json"
            };
            let (active, counts) = response(
                vec![],
                if stage == "error" { 503 } else { 200 },
                media,
                true,
            );
            replies.push(active);
            let mut backend = transport(replies);
            if headers {
                backend.pending_at = Some(before);
            }
            let mut future = Box::pin(synthesize(
                &request,
                &backend,
                Options {
                    auth: Some(&auth),
                    ..Default::default()
                },
            ));
            let wakes = Arc::new(Counts::default());
            let waker = Waker::from(wakes.clone());
            let mut cx = Context::from_waker(&waker);
            for _ in 0..100 {
                let n = wakes.wakes.load(Ordering::SeqCst);
                match future.as_mut().poll(&mut cx) {
                    Poll::Ready(Ok(stream)) if stage == "download" && !headers => {
                        let mut stream = Box::pin(stream);
                        assert!(stream.as_mut().poll_next(&mut cx).is_pending());
                        drop(stream);
                        break;
                    }
                    Poll::Ready(_) => panic!("unexpected completion at {stage}"),
                    Poll::Pending if n == wakes.wakes.load(Ordering::SeqCst) => break,
                    Poll::Pending => {}
                }
            }
            drop(future);
            assert_eq!(
                backend.requests.lock().unwrap().len(),
                before + 1,
                "{stage}"
            );
            assert_eq!(counts.reads.load(Ordering::SeqCst), usize::from(!headers));
            assert_eq!(counts.drops.load(Ordering::SeqCst), 1, "{stage}");
        }
    }
}

#[test]
fn http_and_queue_errors_preserve_native_details() {
    let auth = auth();
    for stage in ["upload", "info", "submit", "queue", "download"] {
        for status in [302, 401, 429, 503] {
            let mut request = TtsRequest::Text(base());
            let mut replies = vec![];
            if stage == "upload" {
                let mut r = base();
                r.reference_audio = Some(vec![]);
                request = TtsRequest::Text(r);
            }
            if stage == "info" {
                request = TtsRequest::ChatterboxTurboText(turbo());
            }
            if matches!(stage, "queue" | "download") {
                replies.push(reply(SUBMITTED, "application/json"));
            }
            if stage == "download" {
                replies.push(reply(COMPLETE, "text/event-stream"));
            }
            let (failed, counts) =
                response(vec![b"quota \xff".to_vec()], status, "text/plain", false);
            replies.push(failed);
            let count = replies.len();
            let backend = transport(replies);
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
                err.downcast_ref::<Error>(),
                Some(&Error {
                    status_code: Some(status),
                    body: "quota �".into(),
                    request_id: if matches!(stage, "queue" | "download") {
                        Some("event/?#雪".into())
                    } else {
                        None
                    },
                    retry_after: Some("7".into())
                })
            );
            assert_eq!(
                err.to_string(),
                format!("Resemble Chatterbox returned HTTP {status}")
            );
            assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
            assert_eq!(backend.requests.lock().unwrap().len(), count);
        }
    }
    let (queue, counts) = response(
        vec![b"event: error\ndata: \"GPU quota exhausted\"\n\n".to_vec()],
        200,
        "text/event-stream",
        true,
    );
    let backend = transport(vec![reply(SUBMITTED, "application/json"), queue]);
    let err = ready(synthesize(
        &TtsRequest::Text(base()),
        &backend,
        Options {
            auth: Some(&auth),
            ..Default::default()
        },
    ))
    .err()
    .unwrap();
    assert_eq!(
        err.downcast_ref::<Error>(),
        Some(&Error {
            status_code: None,
            body: "\"GPU quota exhausted\"".into(),
            request_id: Some("event/?#雪".into()),
            retry_after: None
        })
    );
    assert_eq!(err.to_string(), "Resemble Chatterbox generation failed");
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
}

#[test]
fn malformed_metadata_files_and_content_types_release_responses() {
    let auth = auth();
    let mut cases = vec![];
    for text in [
        "[]",
        "[\"\"]",
        "[null]",
        "[\"one\",\"two\"]",
        "{\"path\":\"x\"}",
    ] {
        let mut r = base();
        r.reference_audio = Some(vec![]);
        cases.push((
            TtsRequest::Text(r),
            vec![(text.to_owned(), "application/json")],
            "Resemble returned an invalid upload path",
        ));
    }
    for text in [
        "{}",
        "{\"event_id\":\"\"}",
        "{\"event_id\":\".\"}",
        "{\"event_id\":\"..\"}",
        "{\"event_id\":0}",
    ] {
        cases.push((
            TtsRequest::Text(base()),
            vec![(text.to_owned(), "application/json")],
            "Resemble returned an invalid event ID",
        ));
    }
    for text in [
        "{}",
        r#"{"named_endpoints":{}}"#,
        r#"{"named_endpoints":{"/generate":{"parameters":[]}}}"#,
        r#"{"named_endpoints":{"/generate":{"parameters":[null,{"parameter_name":"wrong","parameter_default":{"path":"a"}}]}}}"#,
    ] {
        cases.push((
            TtsRequest::ChatterboxTurboText(turbo()),
            vec![(text.to_owned(), "application/json")],
            "Resemble returned no default reference recording",
        ));
    }
    for text in ["{".to_owned(), "NaN".into(), "[".repeat(1000), "�".into()] {
        cases.push((
            TtsRequest::Text(base()),
            vec![(text, "application/json")],
            "Resemble returned invalid JSON",
        ));
    }
    for file in [
        r#"{"path":""}"#,
        r#"{"path":1}"#,
        r#"{"path":"a","url":3}"#,
        r#"{"path":"a","meta":null}"#,
        r#"{"path":"a","meta":{"_type":"wrong"}}"#,
        r#"{"path":"a","is_stream":0}"#,
    ] {
        cases.push((
            TtsRequest::Text(base()),
            vec![
                (SUBMITTED.into(), "application/json"),
                (
                    format!("event: complete\ndata: [{file}]\n\n"),
                    "text/event-stream",
                ),
            ],
            "Resemble returned an invalid audio file",
        ));
    }
    cases.push((
        TtsRequest::Text(base()),
        vec![
            (SUBMITTED.into(), "application/json"),
            (COMPLETE.into(), "application/json"),
        ],
        "Resemble returned no event stream",
    ));
    cases.push((
        TtsRequest::Text(base()),
        vec![
            (SUBMITTED.into(), "application/json"),
            (COMPLETE.into(), "text/event-stream"),
            ("{}".into(), "application/json"),
        ],
        "Resemble returned no audio stream",
    ));
    cases.push((
        TtsRequest::Text(base()),
        vec![
            (SUBMITTED.into(), "application/json"),
            (COMPLETE.into(), "text/event-stream"),
            ("".into(), "audio/wav"),
        ],
        "Resemble returned empty audio",
    ));
    for (request, replies, expected) in cases {
        let mut responses = vec![];
        let mut counts = vec![];
        for (text, media) in replies {
            let (r, c) = response(vec![text.into_bytes()], 200, media, false);
            responses.push(r);
            counts.push(c);
        }
        let backend = transport(responses);
        let error = match ready(synthesize(
            &request,
            &backend,
            Options {
                auth: Some(&auth),
                ..Default::default()
            },
        )) {
            Ok(mut stream) => collect(&mut stream).1.unwrap(),
            Err(err) => err.to_string(),
        };
        assert_eq!(error, expected);
        assert_eq!(backend.requests.lock().unwrap().len(), counts.len());
        for count in counts {
            assert_eq!(count.drops.load(Ordering::SeqCst), 1);
        }
    }
}

#[test]
fn generated_bounds_and_boundary_options_reject_before_io() {
    let auth = auth();
    let backend = transport(vec![]);
    let mut requests = vec![];
    for temperature in [0.0, 5.1, f64::NAN, f64::INFINITY] {
        let mut r = base();
        r.temperature = Some(temperature);
        requests.push(TtsRequest::Text(r));
    }
    let mut r = base();
    r.text = "😀".repeat(301);
    requests.push(TtsRequest::Text(r));
    let mut r = turbo();
    r.temperature = Some(5.0);
    requests.push(TtsRequest::ChatterboxTurboText(r));
    let mut r = turbo();
    r.top_k = Some(1001.0);
    requests.push(TtsRequest::ChatterboxTurboText(r));
    for request in requests {
        let expected = match validate_request(&request) {
            Err(error) => error.to_string(),
            Ok(_) => panic!("expected generated validation failure"),
        };
        assert_eq!(
            ready(synthesize(
                &request,
                &backend,
                Options {
                    auth: Some(&auth),
                    ..Default::default()
                }
            ))
            .err()
            .unwrap()
            .to_string(),
            expected
        );
    }
    for url in [
        "ws://api.test",
        "https://user:pass@api.test",
        "https://api.test/#fragment",
        "relative/path",
        "https://",
        "https://api.test:99999",
        "https://api.test/%bad%",
        "\nhttps://api.test",
    ] {
        assert_eq!(
            ready(synthesize(
                &TtsRequest::Text(base()),
                &backend,
                Options {
                    auth: Some(&auth),
                    base_url: Some(url),
                    ..Default::default()
                }
            ))
            .err()
            .unwrap()
            .to_string(),
            "Invalid Resemble deployment or audio URL"
        );
    }
    for (event, json) in [(0, 1024), (1024, 0)] {
        assert_eq!(
            ready(synthesize(
                &TtsRequest::Text(base()),
                &backend,
                Options {
                    auth: Some(&auth),
                    max_event_bytes: event,
                    max_json_bytes: json,
                    ..Default::default()
                }
            ))
            .err()
            .unwrap()
            .to_string(),
            "Resemble response byte limits must be positive"
        );
    }
    for token in ["a\rb", "a\nb", "雪", "a\0b", "a\u{7f}b"] {
        let mut credentials = self::auth();
        credentials.resemble.as_mut().unwrap().token = Some(token.into());
        assert_eq!(
            ready(synthesize(
                &TtsRequest::Text(base()),
                &backend,
                Options {
                    auth: Some(&credentials),
                    ..Default::default()
                }
            ))
            .err()
            .unwrap()
            .to_string(),
            "Invalid Resemble token"
        );
    }
    assert_eq!(backend.requests.lock().unwrap().len(), 0);
    let mut r = base();
    r.text = "😀".repeat(300);
    let backend = transport(vec![
        reply(SUBMITTED, "application/json"),
        reply(COMPLETE, "text/event-stream"),
        reply("audio", "audio/wav"),
    ]);
    drop(
        ready(synthesize(
            &TtsRequest::Text(r),
            &backend,
            Options {
                auth: Some(&auth),
                ..Default::default()
            },
        ))
        .unwrap(),
    );
    assert_eq!(
        Raw::parse(std::str::from_utf8(&backend.requests.lock().unwrap()[0].body).unwrap())
            .unwrap()
            .object()
            .unwrap()["data"]
            .array()
            .unwrap()[0]
            .string()
            .unwrap(),
        "😀".repeat(300)
    );
}

#[test]
fn metadata_limits_and_cooperative_queue_budget() {
    let auth = auth();
    for stage in ["submit", "error", "info", "upload"] {
        let mut request = TtsRequest::Text(base());
        if stage == "info" {
            request = TtsRequest::ChatterboxTurboText(turbo());
        }
        if stage == "upload" {
            let mut r = base();
            r.reference_audio = Some(vec![]);
            request = TtsRequest::Text(r);
        }
        let (active, counts) = response(
            vec![b"abcd".to_vec(), b"efgh".to_vec()],
            if stage == "error" { 500 } else { 200 },
            "application/json",
            true,
        );
        let backend = transport(vec![active]);
        assert_eq!(
            ready(synthesize(
                &request,
                &backend,
                Options {
                    auth: Some(&auth),
                    max_json_bytes: 7,
                    ..Default::default()
                }
            ))
            .err()
            .unwrap()
            .to_string(),
            "Resemble response exceeds max_json_bytes"
        );
        assert_eq!(counts.reads.load(Ordering::SeqCst), 2);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
    let (queue, counts) = response(
        vec![format!(":{}", "a".repeat(100)).into_bytes()],
        200,
        "text/event-stream",
        true,
    );
    let backend = transport(vec![reply(SUBMITTED, "application/json"), queue]);
    assert_eq!(
        ready(synthesize(
            &TtsRequest::Text(base()),
            &backend,
            Options {
                auth: Some(&auth),
                max_event_bytes: 100,
                ..Default::default()
            }
        ))
        .err()
        .unwrap()
        .to_string(),
        "SSE event exceeds byte limit"
    );
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    let (queue, counts) = response(
        vec![format!(":{}\n\n{COMPLETE}", "a".repeat(20000)).into_bytes()],
        200,
        "text/event-stream",
        true,
    );
    let mut future = Box::pin(completed_file(queue, "event", Decoder::new(30000).unwrap()));
    let waker = Waker::from(counts.clone());
    let mut cx = Context::from_waker(&waker);
    assert!(future.as_mut().poll(&mut cx).is_pending());
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    assert_eq!(counts.wakes.load(Ordering::SeqCst), 1);
    assert!(future.as_mut().poll(&mut cx).is_pending());
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    assert_eq!(counts.wakes.load(Ordering::SeqCst), 2);
    match future.as_mut().poll(&mut cx) {
        Poll::Ready(Ok(file)) => assert_eq!(file, ("/tmp/gradio/file with?#雪.wav".into(), None)),
        _ => panic!("queue did not complete"),
    }
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[derive(Debug)]
struct ReadError(Arc<()>);
impl std::fmt::Display for ReadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("original read")
    }
}
impl std::error::Error for ReadError {}

#[test]
fn transport_and_body_error_identity_and_terminal_ownership() {
    let auth = auth();
    for stage in ["headers", "submit", "queue", "download"] {
        let identity = Arc::new(());
        let error = Box::new(ReadError(identity.clone())) as TransportError;
        let counts = Arc::new(Counts::default());
        let mut replies = vec![];
        if matches!(stage, "queue" | "download") {
            replies.push(reply(SUBMITTED, "application/json"));
        }
        if stage == "download" {
            replies.push(reply(COMPLETE, "text/event-stream"));
        }
        let backend = if stage == "headers" {
            Transport {
                requests: Mutex::new(vec![]),
                responses: Mutex::new([Err(error)].into()),
                pending_at: None,
            }
        } else {
            replies.push(HttpResponse {
                status: 200,
                headers: vec![(
                    "Content-Type".into(),
                    if stage == "queue" {
                        "text/event-stream"
                    } else {
                        "application/octet-stream"
                    }
                    .into(),
                )],
                body: Box::pin(Body {
                    chunks: [Err(error)].into(),
                    counts: counts.clone(),
                    stall: false,
                }),
            });
            transport(replies)
        };
        let error = match ready(synthesize(
            &TtsRequest::Text(base()),
            &backend,
            Options {
                auth: Some(&auth),
                ..Default::default()
            },
        )) {
            Ok(mut stream) => {
                let error = next(&mut stream).unwrap().err().unwrap();
                assert!(next(&mut stream).is_none());
                error
            }
            Err(error) => error,
        };
        assert!(Arc::ptr_eq(
            &error.downcast_ref::<ReadError>().unwrap().0,
            &identity
        ));
        assert_eq!(
            counts.drops.load(Ordering::SeqCst),
            usize::from(stage != "headers")
        );
    }
    let (audio, counts) = response(vec![b"audio".to_vec()], 200, "audio/wav", false);
    let backend = transport(vec![
        reply(SUBMITTED, "application/json"),
        reply(COMPLETE, "text/event-stream"),
        audio,
    ]);
    let mut stream = ready(synthesize(
        &TtsRequest::Text(base()),
        &backend,
        Options {
            auth: Some(&auth),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        item_value(next(&mut stream).unwrap().unwrap()),
        value(r#"{"audio":[97,117,100,105,111]}"#)
    );
    assert_eq!(
        item_value(next(&mut stream).unwrap().unwrap()),
        value(r#"{"event":"done","requestId":"event/?#雪"}"#)
    );
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert!(next(&mut stream).is_none());
}

#[test]
fn live_reference_uses_path_and_multipart_boundary_cannot_collide() {
    let info = include_str!("../../../../../schemas/sources/resemble/02-gradio-schema.json");
    let parsed = Raw::parse(info).unwrap().object().unwrap();
    let path = parsed["named_endpoints"].object().unwrap()["/generate"]
        .object()
        .unwrap()["parameters"]
        .array()
        .unwrap()[1]
        .object()
        .unwrap()["parameter_default"]
        .object()
        .unwrap()["path"]
        .string()
        .unwrap();
    let fresh = info.replace(&path, "/new-cache/current.wav");
    assert_eq!(default_reference(&fresh).unwrap(), "/new-cache/current.wav");
    let auth = auth();
    let backend = transport(vec![
        reply(&fresh, "application/json"),
        reply(SUBMITTED, "application/json"),
        reply(COMPLETE, "text/event-stream"),
        reply("audio", "audio/wav"),
    ]);
    drop(
        ready(synthesize(
            &TtsRequest::ChatterboxTurboText(turbo()),
            &backend,
            Options {
                auth: Some(&auth),
                ..Default::default()
            },
        ))
        .unwrap(),
    );
    assert_eq!(
        value(std::str::from_utf8(&backend.requests.lock().unwrap()[1].body).unwrap()),
        value(
            r#"{"data":["Hello",{"path":"/new-cache/current.wav","meta":{"_type":"gradio.FileData"}},0.8,0,0,0.95,1000,1.2,true]}"#
        )
    );
    let mut r = base();
    let audio = b"\r\n--speechswitch-reference-0\r\n--speechswitch-reference-1\r\n\xff".to_vec();
    r.reference_audio = Some(audio.clone());
    let backend = transport(vec![
        reply("[\"/uploaded\"]", "application/json"),
        reply(SUBMITTED, "application/json"),
        reply(COMPLETE, "text/event-stream"),
        reply("audio", "audio/wav"),
    ]);
    drop(
        ready(synthesize(
            &TtsRequest::Text(r),
            &backend,
            Options {
                auth: Some(&auth),
                ..Default::default()
            },
        ))
        .unwrap(),
    );
    let calls = backend.requests.lock().unwrap();
    assert_eq!(
        calls[0].headers[1],
        (
            "Content-Type".into(),
            "multipart/form-data; boundary=speechswitch-reference-2".into()
        )
    );
    let mut expected = b"--speechswitch-reference-2\r\nContent-Disposition: form-data; name=\"files\"; filename=\"reference.audio\"\r\nContent-Type: application/octet-stream\r\n\r\n".to_vec();
    expected.extend(audio);
    expected.extend(b"\r\n--speechswitch-reference-2--\r\n");
    assert_eq!(calls[0].body, expected);
}

#[test]
fn environment_child() {
    let Ok(mode) = std::env::var("SPEECHSWITCH_RESEMBLE_TEST_CHILD") else {
        return;
    };
    let mut credentials = auth();
    credentials.resemble.as_mut().unwrap().token = match mode.as_str() {
        "explicit" => Some("explicit".into()),
        "empty" => Some(String::new()),
        _ => None,
    };
    let backend = transport(vec![
        reply(SUBMITTED, "application/json"),
        reply(COMPLETE, "text/event-stream"),
        reply("audio", "audio/wav"),
    ]);
    let result = ready(synthesize(
        &TtsRequest::Text(base()),
        &backend,
        Options {
            auth: Some(&credentials),
            ..Default::default()
        },
    ));
    if mode == "nonunicode" {
        assert_eq!(
            result.err().unwrap().to_string(),
            "Invalid Resemble environment token"
        );
        assert_eq!(backend.requests.lock().unwrap().len(), 0);
        return;
    }
    drop(result.unwrap());
    let expected = std::env::var("SPEECHSWITCH_RESEMBLE_TEST_EXPECTED").ok();
    for call in backend.requests.lock().unwrap().iter() {
        assert_eq!(
            call.headers
                .iter()
                .find(|(name, _)| name == "Authorization")
                .map(|(_, value)| value.to_owned()),
            expected.as_ref().map(|key| format!("Bearer {key}"))
        );
    }
}

#[test]
fn environment_precedence_uses_isolated_processes() {
    for (mode, scoped, vendor, expected) in [
        ("explicit", Some("scoped"), Some("vendor"), Some("explicit")),
        ("none", Some("scoped"), Some("vendor"), Some("scoped")),
        ("none", None, Some("vendor"), Some("vendor")),
        ("empty", Some("scoped"), Some("vendor"), None),
        ("none", Some(""), Some("vendor"), None),
        ("none", None, None, None),
    ] {
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "providers::resemble::tests::environment_child",
                "--nocapture",
            ])
            .env("SPEECHSWITCH_RESEMBLE_TEST_CHILD", mode)
            .env_remove("SPEECHSWITCH_RESEMBLE_TOKEN")
            .env_remove("HF_TOKEN")
            .env_remove("SPEECHSWITCH_RESEMBLE_TEST_EXPECTED");
        if let Some(value) = scoped {
            command.env("SPEECHSWITCH_RESEMBLE_TOKEN", value);
        }
        if let Some(value) = vendor {
            command.env("HF_TOKEN", value);
        }
        if let Some(value) = expected {
            command.env("SPEECHSWITCH_RESEMBLE_TEST_EXPECTED", value);
        }
        let result = command.output().unwrap();
        assert!(
            result.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        );
    }
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStringExt;
        let result = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "providers::resemble::tests::environment_child",
                "--nocapture",
            ])
            .env("SPEECHSWITCH_RESEMBLE_TEST_CHILD", "nonunicode")
            .env(
                "SPEECHSWITCH_RESEMBLE_TOKEN",
                std::ffi::OsString::from_vec(vec![255]),
            )
            .env("HF_TOKEN", "must-not-fall-through")
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        );
    }
}
