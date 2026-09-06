use speechswitch_types::generated::openai;
pub fn legacy(request: &mut openai::TtsRequestTextVoice15a214fc) {
    request.instructions = Some("Whisper".into());
}
