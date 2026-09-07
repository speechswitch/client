use speechswitch_types::{generated::{vocu, vocu_output}, http::HttpTransport, providers::vocu as provider, runtime::StreamingInput};
pub fn markup(request: &mut vocu::TtsRequestTextVoicee296d426) {
    request.subtitle_format = Some(String::from("srt"));
}
pub fn model(request: &mut vocu::TtsRequestTextVoice9c5ed44a) { request.model = "v3.5".into(); }
pub fn emphasis(request: &mut vocu::TtsRequestTextVoice9c5ed44a) { request.reference_emphasis = Some(1.0); }
pub fn splitter(request: &mut vocu::TtsRequestText8f38e545) { request.voice = "voice".into(); }
pub fn clear() { let _ = vocu_output::SynthesisItem::Clear; }
pub fn streaming(request: &mut vocu::TtsRequestTextVoice9c5ed44a, input: StreamingInput<String>) { request.text = input; }
pub async fn wrong_request(request: &vocu_output::SynthesisItem, transport: &dyn HttpTransport) { let _ = provider::synthesize(request, transport, provider::Options::default()).await; }
