use super::{google_rest as wire, google_rest_beta as beta};
use crate::{http::*, runtime::InputStream};
use std::{
    future::Future,
    pin::Pin,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    task::{Context, Poll, Wake},
};

#[derive(Default)]
struct Counts {
    reads: AtomicUsize,
    drops: AtomicUsize,
}
impl Wake for Counts {
    fn wake(self: Arc<Self>) {}
}
struct Body(Arc<Counts>);
impl InputStream<Vec<u8>> for Body {
    fn poll_next(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
    ) -> Poll<Option<Result<Vec<u8>, TransportError>>> {
        self.0.reads.fetch_add(1, Ordering::SeqCst);
        panic!("Generated client read the response body")
    }
}
impl Drop for Body {
    fn drop(&mut self) {
        self.0.drops.fetch_add(1, Ordering::SeqCst);
    }
}
struct Transport {
    calls: Mutex<Vec<HttpRequest>>,
    counts: Arc<Counts>,
}
impl HttpTransport for Transport {
    fn send(
        &self,
        request: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        self.calls.lock().unwrap().push(request);
        Box::pin(async {
            Ok(HttpResponse {
                status: 429,
                headers: vec![("retry-after".into(), "1".into())],
                body: Box::pin(Body(self.counts.clone())),
            })
        })
    }
}
fn ready<F: Future>(future: F) -> F::Output {
    let waker = Arc::new(Counts::default()).into();
    match Box::pin(future)
        .as_mut()
        .poll(&mut Context::from_waker(&waker))
    {
        Poll::Ready(value) => value,
        Poll::Pending => panic!("Unexpected pending response"),
    }
}

#[test]
fn wire_presence_headers_and_unread_response_ownership() {
    let counts = Arc::new(Counts::default());
    let transport = Transport {
        calls: Mutex::new(vec![]),
        counts: counts.clone(),
    };
    let headers = vec![
        ("authorization".into(), "Bearer test".into()),
        ("Content-Type".into(), "bad".into()),
        ("CONTENT-TYPE".into(), "also bad".into()),
    ];
    let original_headers = headers.clone();
    let request = wire::SynthesizeSpeechRequest {
        advanced_voice_options: Some(wire::AdvancedVoiceOptions {
            enable_textnorm: Some(false),
            ..Default::default()
        }),
        audio_config: Some(wire::AudioConfig {
            audio_encoding: Some(wire::AudioConfigAudioEncoding::Mp3),
            volume_gain_db: Some(0.0),
            effects_profile_id: Some(vec![]),
            ..Default::default()
        }),
        input: Some(wire::SynthesisInput {
            text: Some("Acme 日本\n\0".into()),
            ..Default::default()
        }),
        voice: Some(wire::VoiceSelectionParams {
            language_code: Some("en-US".into()),
            voice_clone: Some(wire::VoiceCloneParams {
                voice_cloning_key: Some("existing".into()),
            }),
            ..Default::default()
        }),
    };
    let response = ready(wire::synthesize_speech(
        &request,
        wire::ClientOptions {
            base_url: "https://proxy.invalid/g%2Fp/?tenant=one&blank=",
            headers: &headers,
            transport: &transport,
        },
    ))
    .unwrap();
    assert_eq!(response.status, 429);
    assert_eq!(response.headers, [("retry-after".into(), "1".into())]);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 0);
    let calls = transport.calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].method, "POST");
    assert_eq!(
        calls[0].url,
        "https://proxy.invalid/g%2Fp/v1/text:synthesize?tenant=one&blank="
    );
    assert_eq!(
        calls[0].headers,
        [
            ("authorization".into(), "Bearer test".into()),
            ("content-type".into(), "application/json".into())
        ]
    );
    assert_eq!(
        std::str::from_utf8(&calls[0].body).unwrap(),
        r#"{"advancedVoiceOptions":{"enableTextnorm":false},"audioConfig":{"audioEncoding":"MP3","effectsProfileId":[],"volumeGainDb":0},"input":{"text":"Acme 日本\n\u0000"},"voice":{"languageCode":"en-US","voiceClone":{"voiceCloningKey":"existing"}}}"#
    );
    assert_eq!(headers, original_headers);
    drop(response);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn query_replacement_beta_fields_and_empty_objects() {
    let transport = Transport {
        calls: Mutex::new(vec![]),
        counts: Arc::new(Counts::default()),
    };
    ready(wire::list_voices(
        &wire::ListVoicesInput {
            language_code: Some("en US".into()),
        },
        wire::ClientOptions {
            base_url:
                "https://proxy.invalid/g/?tenant=a&%6canguageCode=old&tenant=b&languageCode=older",
            headers: &[],
            transport: &transport,
        },
    ))
    .unwrap();
    ready(beta::synthesize_speech(
        &beta::SynthesizeSpeechRequest {
            enable_time_pointing: Some(vec![
                beta::SynthesizeSpeechRequestEnableTimePointingItem::SsmlMark,
            ]),
            input: Some(beta::SynthesisInput {
                markup: Some(String::new()),
                ..Default::default()
            }),
            ..Default::default()
        },
        beta::ClientOptions {
            base_url: beta::DEFAULT_BASE_URL,
            headers: &[],
            transport: &transport,
        },
    ))
    .unwrap();
    ready(wire::synthesize_speech(
        &wire::SynthesizeSpeechRequest {
            input: Some(wire::SynthesisInput::default()),
            ..Default::default()
        },
        wire::ClientOptions {
            base_url: wire::DEFAULT_BASE_URL,
            headers: &[],
            transport: &transport,
        },
    ))
    .unwrap();
    let calls = transport.calls.lock().unwrap();
    assert_eq!(calls.len(), 3);
    assert_eq!(calls[0].method, "GET");
    assert_eq!(
        calls[0].url,
        "https://proxy.invalid/g/v1/voices?tenant=a&tenant=b&languageCode=en+US"
    );
    assert_eq!(calls[0].headers, vec![]);
    assert_eq!(calls[0].body, vec![]);
    assert_eq!(
        calls[1].url,
        "https://texttospeech.googleapis.com/v1beta1/text:synthesize"
    );
    assert_eq!(
        calls[1].body,
        br#"{"enableTimePointing":["SSML_MARK"],"input":{"markup":""}}"#
    );
    assert_eq!(calls[2].body, br#"{"input":{}}"#);
}

#[test]
fn exact_wire_validation_before_io() {
    let transport = Transport {
        calls: Mutex::new(vec![]),
        counts: Arc::new(Counts::default()),
    };
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let result = ready(wire::synthesize_speech(
            &wire::SynthesizeSpeechRequest {
                audio_config: Some(wire::AudioConfig {
                    volume_gain_db: Some(value),
                    ..Default::default()
                }),
                ..Default::default()
            },
            wire::ClientOptions {
                base_url: wire::DEFAULT_BASE_URL,
                headers: &[],
                transport: &transport,
            },
        ));
        assert_eq!(
            result.err().unwrap().to_string(),
            "Invalid Google synthesizeSpeech input"
        );
    }
    for base_url in [
        "ftp://proxy.invalid",
        "https://user:pass@proxy.invalid",
        "https://proxy.invalid/#fragment",
        "/relative",
    ] {
        let result = ready(wire::synthesize_speech(
            &wire::SynthesizeSpeechRequest::default(),
            wire::ClientOptions {
                base_url,
                headers: &[],
                transport: &transport,
            },
        ));
        assert_eq!(
            result.err().unwrap().to_string(),
            "Invalid Google HTTP endpoint URL"
        );
    }
    assert_eq!(transport.calls.lock().unwrap().len(), 0);
}

#[test]
fn response_types_presence_and_numeric_bounds() {
    assert_eq!(
        wire::decode_synthesize_speech_response(br#"{}"#).unwrap(),
        wire::SynthesizeSpeechResponse {
            audio_content: None
        }
    );
    assert_eq!(
        wire::decode_synthesize_speech_response(br#"{"audioContent":"","unknown":true}"#).unwrap(),
        wire::SynthesizeSpeechResponse {
            audio_content: Some(String::new())
        }
    );
    for data in [
        &b"\xff"[..],
        br#"{"audioContent":null}"#,
        br#"{"audioContent":1}"#,
        br#"{"audioContent":"\ud800"}"#,
        b"{}{}",
        b"[]",
    ] {
        assert_eq!(
            wire::decode_synthesize_speech_response(data)
                .unwrap_err()
                .to_string(),
            "Invalid Google synthesizeSpeech response"
        );
    }
    for number in [
        "2147483648",
        "-2147483649",
        "1.5",
        "true",
        "null",
        "1e400",
        "\"24000\"",
    ] {
        let data = format!(r#"{{"voices":[{{"naturalSampleRateHertz":{number}}}]}}"#);
        assert_eq!(
            wire::decode_list_voices_response(data.as_bytes())
                .unwrap_err()
                .to_string(),
            "Invalid Google listVoices response"
        );
    }
    assert_eq!(wire::decode_list_voices_response(br#"{"voices":[{"naturalSampleRateHertz":2147483647,"ssmlGender":"FEMALE","languageCodes":[]},{"naturalSampleRateHertz":-2147483648}]}"#).unwrap(), wire::ListVoicesResponse { voices: Some(vec![
        wire::Voice { natural_sample_rate_hertz: Some(i32::MAX), ssml_gender: Some(wire::VoiceSsmlGender::Female), language_codes: Some(vec![]), ..Default::default() },
        wire::Voice { natural_sample_rate_hertz: Some(i32::MIN), ..Default::default() },
    ]) });
    assert_eq!(
        wire::decode_list_voices_response(br#"{"voices":[{"ssmlGender":"ALIEN"}]}"#)
            .unwrap_err()
            .to_string(),
        "Invalid Google listVoices response"
    );
    let beta = beta::decode_synthesize_speech_response(
        br#"{"audioContent":"AP8=","timepoints":[{"markName":"a","timeSeconds":0}]}"#,
    )
    .unwrap();
    assert_eq!(beta.audio_content, Some("AP8=".into()));
    assert_eq!(
        beta.timepoints,
        Some(vec![beta::Timepoint {
            mark_name: Some("a".into()),
            time_seconds: Some(0.0)
        }])
    );
}

struct Pending(Arc<Counts>);
impl Future for Pending {
    type Output = Result<HttpResponse, TransportError>;
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        cx.waker().wake_by_ref();
        Poll::Pending
    }
}
impl Drop for Pending {
    fn drop(&mut self) {
        self.0.drops.fetch_add(1, Ordering::SeqCst);
    }
}
struct PendingTransport(Arc<Counts>);
impl HttpTransport for PendingTransport {
    fn send(
        &self,
        _: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        Box::pin(Pending(self.0.clone()))
    }
}
#[test]
fn dropping_a_pending_operation_releases_the_transport_future() {
    let counts = Arc::new(Counts::default());
    let transport = PendingTransport(counts.clone());
    let request = wire::SynthesizeSpeechRequest::default();
    let mut future = Box::pin(wire::synthesize_speech(
        &request,
        wire::ClientOptions {
            base_url: wire::DEFAULT_BASE_URL,
            headers: &[],
            transport: &transport,
        },
    ));
    let waker = counts.clone().into();
    assert!(future
        .as_mut()
        .poll(&mut Context::from_waker(&waker))
        .is_pending());
    assert_eq!(counts.drops.load(Ordering::SeqCst), 0);
    drop(future);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}
