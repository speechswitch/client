use crate::{client::*, http::*, runtime::InputStream};
use std::{future::Future, pin::Pin, sync::Mutex, task::{Context, Poll, Waker}};
struct Body;
impl InputStream<Vec<u8>> for Body {
    fn poll_next(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Option<Result<Vec<u8>, TransportError>>> { Poll::Ready(None) }
}
#[derive(Default)]
struct Transport { requests: Mutex<Vec<HttpRequest>> }
impl HttpTransport for Transport {
    fn send(&self, request: HttpRequest) -> Pin<Box<dyn Future<Output=Result<HttpResponse, TransportError>> + Send + '_>> {
        self.requests.lock().unwrap().push(request);
        Box::pin(async { Ok(HttpResponse { status: 201, headers: vec![], body: Box::pin(Body) }) })
    }
}
fn ready<T>(future: impl Future<Output=T>) -> T {
    let mut future = std::pin::pin!(future);
    match future.as_mut().poll(&mut Context::from_waker(Waker::noop())) { Poll::Ready(v) => v, Poll::Pending => panic!("pending") }
}
#[test]
fn changed_contract_controls_wire_types_guards_and_transport() {
    assert_eq!(DEFAULT_BASE_URL, "https://changed.invalid/root"); assert_eq!(SPEECH_STATUS, 201);
    let transport = Transport::default();
    let request = SpeechRequest { input: "😀😀".into(), model: CreateSpeechRequestModel::Variant0("tts-1".into()),
        voice: VoiceIdsOrCustomVoice::Variant1(VoiceIdsOrCustomVoiceVariant1 { id: "saved".into() }), enabled: false,
        fraction: Some(0.25), ..Default::default() };
    let response = ready(create_speech(&request, "test", &format!("{DEFAULT_BASE_URL}/?tenant=one"), &transport)).unwrap();
    assert_eq!(response.status, 201);
    let requests = transport.requests.lock().unwrap(); let captured = &requests[0];
    assert_eq!(captured.method, "POST"); assert_eq!(captured.url, "https://changed.invalid/root/changed/speech?tenant=one");
    assert_eq!(captured.headers, vec![("Authorization".into(), "Bearer test".into()), ("Content-Type".into(), "application/json".into()), ("Accept".into(), "application/octet-stream, text/event-stream".into())]);
    assert_eq!(String::from_utf8(captured.body.clone()).unwrap(), "{\"enabled\":false,\"fraction\":0.25,\"input\":\"😀😀\",\"model\":\"tts-1\",\"voice\":{\"id\":\"saved\"}}");
    drop(requests);
    for invalid in [SpeechRequest { input: "abc".into(), ..request.clone() }, SpeechRequest { speed: Some(f64::NAN), ..request.clone() }, SpeechRequest { fraction: Some(0.5), ..request.clone() }, SpeechRequest { speed: Some(0.1), ..request.clone() }] {
        assert_eq!(ready(create_speech(&invalid, "test", DEFAULT_BASE_URL, &transport)).err().unwrap().to_string(), "Invalid OpenAI speech wire request");
    }
    assert_eq!(transport.requests.lock().unwrap().len(), 1);
    let event = decode_speech_event(r#"{"type":"speech.completed","usage":{"input_tokens":"0","output_tokens":1,"total_tokens":1},"future":true}"#).unwrap();
    assert_eq!(event, SpeechEvent::Variant1(SpeechAudioDoneEvent { type_: "speech.completed".into(), usage: SpeechAudioDoneEventUsage { input_tokens: "0".into(), output_tokens: 1.0, total_tokens: 1.0, extra: Default::default() }, extra: [("future".into(), "true".into())].into() }));
    for text in [r#"{"type":"speech.audio.done","usage":{"input_tokens":"0","output_tokens":1,"total_tokens":1}}"#, r#"{"type":"speech.completed","usage":{"input_tokens":0,"output_tokens":1,"total_tokens":1}}"#, r#"{"type":"speech.completed","usage":{"input_tokens":"","output_tokens":1,"total_tokens":1}}"#] {
        assert_eq!(decode_speech_event(text).unwrap_err().to_string(), "Invalid OpenAI speech event");
    }
}
