use crate::{
    client::*,
    http::{HttpRequest, HttpResponse, HttpTransport, TransportError},
    json::Error,
    runtime::InputStream,
    websocket::Message,
};
use std::{
    future::Future,
    pin::Pin,
    sync::Mutex,
    task::{Context, Poll, Waker},
};

#[derive(Default)]
struct Transport(Mutex<Vec<HttpRequest>>);
struct EmptyBody;
impl InputStream<Vec<u8>> for EmptyBody {
    fn poll_next(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
    ) -> Poll<Option<Result<Vec<u8>, TransportError>>> {
        Poll::Ready(None)
    }
}
impl HttpTransport for Transport {
    fn send(
        &self,
        request: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        self.0.lock().unwrap().push(request);
        Box::pin(async {
            Ok(HttpResponse {
                status: 200,
                headers: vec![],
                body: Box::pin(EmptyBody),
            })
        })
    }
}
fn ready<T>(future: impl Future<Output = T>) -> T {
    match std::pin::pin!(future).poll(&mut Context::from_waker(Waker::noop())) {
        Poll::Ready(result) => result,
        Poll::Pending => panic!("fixture future unexpectedly pending"),
    }
}

#[test]
fn mutated_http_types_validation_routes_and_auth() {
    let transport = Transport::default();
    // Compiles only against the changed contract, not the cataloged text type.
    let mut request = HttpInput {
        text: 8.0,
        voice_id: 1.0,
        language: "en-us".into(),
        extra_flag: true,
        ..Default::default()
    };
    let response = ready(stream_speech(
        &request,
        "key",
        &format!("{DEFAULT_BASE_URL}/?trace=1"),
        &transport,
    ))
    .unwrap();
    assert_eq!(response.status, 200);
    {
        let calls = transport.0.lock().unwrap();
        assert_eq!(calls.len(), 1);
        let sent = &calls[0];
        assert_eq!(sent.method, "POST");
        assert_eq!(sent.url, "https://new.invalid/api/new-tts?trace=1");
        assert_eq!(
            sent.headers,
            [
                ("new-key".into(), "key".into()),
                ("content-type".into(), "application/json".into())
            ]
        );
        let text = std::str::from_utf8(&sent.body).unwrap();
        assert_eq!(parse_http_input(text), Ok(request.clone()));
        assert_eq!(
            text,
            r#"{"text":8,"language":"en-us","voice_id":1,"extra_flag":true}"#
        );
    }
    assert_eq!(
        DEFAULT_WEB_SOCKET_URL,
        "wss://live.invalid/apis/live-tts/ws"
    );
    for text in [
        r#"{"text":"hello","voice_id":1,"language":"en-us","extra_flag":true}"#,
        r#"{"text":8,"voice_id":1,"language":"en-us"}"#,
        r#"{"text":4,"voice_id":1,"language":"en-us","extra_flag":true}"#,
        r#"{"text":10,"voice_id":1,"language":"en-us","extra_flag":true}"#,
        r#"{"text":true,"voice_id":1,"language":"en-us","extra_flag":true}"#,
    ] {
        assert_eq!(parse_http_input(text), Err(Error), "{text}");
    }
    for text in [4.0, 10.0, 8.5, f64::INFINITY, f64::NAN] {
        request.text = text;
        let error = ready(stream_speech(&request, "key", DEFAULT_BASE_URL, &transport))
            .err()
            .unwrap();
        assert_eq!(error.to_string(), "Invalid wire JSON");
    }
    request.text = 8.0;
    let error = ready(stream_speech(
        &request,
        "key",
        "https://user:secret@host",
        &transport,
    ))
    .err()
    .unwrap();
    assert_eq!(error.to_string(), "Invalid CAMB HTTP endpoint URL");
    assert_eq!(transport.0.lock().unwrap().len(), 1);
}

#[test]
fn mutated_message_optional_nullable_arrays_collisions_and_unions() {
    for (text, nickname) in [
        (
            r#"{"type":"added","count":3,"items":[{"value":"hello","new":{"nested":[null,false]}}]}"#,
            None,
        ),
        (
            r#"{"type":"added","count":3,"items":[],"nickname":null}"#,
            Some(None),
        ),
        (
            r#"{"type":"added","count":3.0,"items":[],"nickname":"😀x","a-b":{"flag":true},"a_b":{"flag":2.5}}"#,
            Some(Some("😀x".to_owned())),
        ),
        (
            r#"{"type":"added","count":3,"items":[],"choice":"hi"}"#,
            None,
        ),
        (r#"{"type":"added","count":3,"items":[],"choice":5}"#, None),
    ] {
        let ServerMessage::Added(value) = decode_message(Message::Text(text.into())).unwrap()
        else {
            panic!("expected Added")
        };
        assert_eq!(value.count, 3.0);
        assert_eq!(value.nickname, nickname);
        let encoded = encode_message(&ClientMessage::Added(value.clone())).unwrap();
        assert_eq!(
            decode_message(Message::Text(encoded)),
            Ok(ServerMessage::Added(value))
        );
    }
    let text = r#"{"type":"added","count":3,"items":[],"a-b":{"flag":true},"a_b":{"flag":2.5},"fooBAR":false,"fooBar":0,"choice":5}"#;
    let ServerMessage::Added(mut value) = decode_message(Message::Text(text.into())).unwrap()
    else {
        panic!("expected Added")
    };
    assert_eq!(value.a_b.as_ref().unwrap().flag, Some(true));
    assert_eq!(value.a_b2.as_ref().unwrap().flag, Some(2.5));
    assert_eq!(value.foo_bar, Some(false));
    assert_eq!(value.foo_bar2, Some(0.0));
    assert_eq!(value.choice, Some(AddedChoice::Variant1(5.0)));
    value.choice = Some(AddedChoice::Variant1(4.0));
    assert_eq!(
        encode_message(&ClientMessage::Added(value.clone())),
        Err(Error)
    );
    value.choice = Some(AddedChoice::Variant0("x".into()));
    assert_eq!(
        encode_message(&ClientMessage::Added(value.clone())),
        Err(Error)
    );
    value.choice = None;
    value.nickname = Some(Some("😀".into()));
    assert_eq!(encode_message(&ClientMessage::Added(value)), Err(Error));

    for text in [
        r#"{"type":"added","count":3.5,"items":[]}"#,
        r#"{"type":"added","count":true,"items":[]}"#,
        r#"{"type":"added","count":3,"items":[],"nickname":"😀"}"#,
        r#"{"type":"added","count":3,"items":[],"nickname":"abc"}"#,
        r#"{"type":"added","count":3,"items":[null]}"#,
        r#"{"type":"added","count":3,"items":[{}]}"#,
        r#"{"type":"added","count":3,"items":[],"extra":true}"#,
        r#"{"type":"added","count":3,"items":[],"a_b":{"flag":false}}"#,
        r#"{"type":"session.done","extra":NaN}"#,
        r#"{"type":"added","count":3,"items":[],"nickname":"\ud800x"}"#,
        r#"{"type":"added","count":3,"items":[],"choice":4}"#,
        r#"{"type":"added","count":3,"items":[],"choice":true}"#,
        r#"{"type":"added","count":3,"items":[],"choice":"x"}"#,
    ] {
        assert_eq!(
            decode_message(Message::Text(text.into())),
            Err(Error),
            "{text}"
        );
    }
    assert_eq!(
        decode_message(Message::Binary(vec![0, 255])),
        Ok(ServerMessage::AudioChunk(vec![0, 255]))
    );
}

#[test]
fn additional_properties_cannot_shadow_or_smuggle_invalid_json() {
    let mut value = TextDone {
        type_: "text.done".into(),
        ..Default::default()
    };
    value
        .extra
        .insert("new".into(), r#"{"nested":[null,false,{}]}"#.into());
    assert_eq!(
        encode_message(&ClientMessage::TextDone(value.clone())),
        Ok(r#"{"type":"text.done","new":{"nested":[null,false,{}]}}"#.into())
    );
    for (key, raw) in [
        ("type", r#""text.done""#),
        ("new", "{} false"),
        ("new", r#"{"\ud800":1}"#),
    ] {
        value.extra.clear();
        value.extra.insert(key.into(), raw.into());
        assert_eq!(
            encode_message(&ClientMessage::TextDone(value.clone())),
            Err(Error)
        );
    }
}

#[test]
fn escaped_schema_literals_remain_exact_in_generated_code() {
    let value = Added {
        type_: "added".into(),
        count: 3.0,
        escaped: Some("\x08\x0c\\u0000\0".into()),
        ..Default::default()
    };
    let text = encode_message(&ClientMessage::Added(value.clone())).unwrap();
    assert_eq!(
        text,
        r#"{"type":"added","count":3,"items":[],"escaped":"\u0008\u000c\\u0000\u0000"}"#
    );
    assert_eq!(
        decode_message(Message::Text(text)),
        Ok(ServerMessage::Added(value))
    );
}
