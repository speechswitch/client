use crate::{
    client::*,
    http::{HttpRequest, HttpResponse, HttpTransport, TransportError},
    json::Raw,
};
use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
    task::{Context, Poll, Wake, Waker},
};

struct W;
impl Wake for W {
    fn wake(self: Arc<Self>) {}
}
fn ready<T>(f: impl Future<Output = T>) -> T {
    let mut f = std::pin::pin!(f);
    let waker = Waker::from(Arc::new(W));
    match f.as_mut().poll(&mut Context::from_waker(&waker)) {
        Poll::Ready(v) => v,
        Poll::Pending => panic!("unexpected pending"),
    }
}
struct Http(Mutex<Vec<HttpRequest>>);
impl HttpTransport for Http {
    fn send(
        &self,
        r: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        self.0.lock().unwrap().push(r);
        Box::pin(async { Err(std::io::Error::other("sent").into()) })
    }
}
fn error<T>(r: Result<T, TransportError>) -> String {
    match r {
        Ok(_) => panic!("expected failure"),
        Err(e) => e.to_string(),
    }
}

#[test]
fn changed_operations_and_request_constraints() {
    assert_eq!(DEFAULT_BASE_URL, "https://changed.invalid/root/?tenant=one");
    assert_eq!(CREATE_SPEECH_STATUS, 202);
    let http = Http(Mutex::new(vec![]));
    assert_eq!(
        error(ready(get_speech_job(
            &GetSpeechJobInput {
                id: "a/b?x".into(),
                ..Default::default()
            },
            "key",
            DEFAULT_BASE_URL,
            &http
        ))),
        "sent"
    );
    assert_eq!(
        error(ready(get_speech_job(
            &GetSpeechJobInput {
                id: "x".into(),
                ..Default::default()
            },
            "key",
            DEFAULT_BASE_URL,
            &http
        ))),
        "Invalid LOVO async-retrieve-job request"
    );
    let mut valid = CreateSpeechInput {
        text: 7.0,
        speaker: "v".into(),
        enabled: false,
        nickname: Some(Some("😀a".into())),
        ..Default::default()
    };
    for n in [4.0, 11.0, 7.5, 9007199254740992.0] {
        let value = CreateSpeechInput {
            text: n,
            ..valid.clone()
        };
        assert_eq!(
            error(ready(create_speech(&value, "key", DEFAULT_BASE_URL, &http))),
            "Invalid LOVO sync-tts request"
        );
    }
    assert_eq!(http.0.lock().unwrap().len(), 1);
    assert_eq!(
        error(ready(create_speech(&valid, "key", DEFAULT_BASE_URL, &http))),
        "sent"
    );
    valid.nickname = Some(None);
    assert_eq!(
        error(ready(create_speech(&valid, "key", DEFAULT_BASE_URL, &http))),
        "sent"
    );
    valid.extra.insert("text".into(), "8".into());
    assert_eq!(
        error(ready(create_speech(&valid, "key", DEFAULT_BASE_URL, &http))),
        "Invalid LOVO sync-tts request"
    );
    let calls = http.0.lock().unwrap();
    assert_eq!(calls.len(), 3);
    assert_eq!(calls[0].method, "POST");
    assert_eq!(
        calls[0].url,
        "https://changed.invalid/root/new/a%2Fb%3Fx?tenant=one"
    );
    assert_eq!(calls[0].headers, vec![("changed-key".into(), "key".into())]);
    assert_eq!(calls[0].body, Vec::new());
    let value = Raw::parse_exact(std::str::from_utf8(&calls[1].body).unwrap())
        .unwrap()
        .object()
        .unwrap();
    let keys: Vec<_> = value.keys().map(String::as_str).collect();
    assert_eq!(keys, vec!["enabled", "nickname", "speaker", "text"]);
    assert!(!value["enabled"].boolean().unwrap());
    assert_eq!(value["nickname"].string().unwrap(), "😀a");
    assert_eq!(value["text"].number().unwrap(), 7.0);
    assert!(
        Raw::parse_exact(std::str::from_utf8(&calls[2].body).unwrap())
            .unwrap()
            .object()
            .unwrap()["nickname"]
            .is_null()
    );
}

#[test]
fn changed_response_requiredness_literals_and_fractional_enums() {
    let text = r#"{"id":"job","type":"tts","status":"done","progress":1,"team":"team","createdAt":"now","data":[{"status":"new_status","text":"Hi","speaker":"v","speakerStyle":"s","speed":1,"pause":[],"emphasis":[{"position":0,"value":0.1}],"pronunciations":[],"urls":[1]}]}"#;
    let job = decode_create_speech(text).unwrap();
    assert_eq!(job.data[0].emphasis[0].value, 0.1);
    assert_eq!(job.data[0].urls, vec![1.0]);
    for (from, to) in [
        ("new_status", "succeeded"),
        (r#""urls":[1]"#, r#""urls":["https://audio.invalid"]"#),
        (r#""urls":[1]"#, r#""urls":[true]"#),
        (r#""urls":[1]"#, r#""urls":[1.5]"#),
        (r#""value":0.1"#, r#""value":0.25"#),
        (r#","urls":[1]"#, ""),
    ] {
        let changed = text.replace(from, to);
        assert_eq!(
            error(decode_create_speech(&changed)),
            "Invalid LOVO sync-tts response"
        );
    }
}
