use speechswitch_types::{generated::{voice_ai, voice_ai_output}, providers::voice_ai as provider, runtime::StreamingInput};
pub fn invalid(request: &mut voice_ai::TtsRequestObjectdd71553d) {
    request.language = Some(voice_ai::TtsRequestObject1ec54d36LanguageEs);
}
pub fn paced(request: &mut voice_ai::TtsRequestObject4870017d, output: voice_ai::TtsRequestObject1ec54d36Output) { request.output = output; }
pub fn legacy(request: &mut voice_ai::TtsRequestTextVoice, input: StreamingInput<String>) { request.text = input; }
pub fn dictionary(request: &mut voice_ai::TtsRequestObject1ec54d36PronunciationDictionariesItem) { request.version = Some(String::from("revision")); }
pub fn timestamps(output: &mut voice_ai_output::VoiceAiEnvelope) { output.timestamps = [()]; }
pub fn update() { let _ = provider::Input::Update; }
pub async fn wrong_request(request: voice_ai::TtsRequestObject1ec54d36) { let _ = provider::synthesize(request, provider::Options::default()).await; }
