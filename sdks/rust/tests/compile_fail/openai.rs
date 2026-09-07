use speechswitch_types::generated::openai;
pub fn legacy(request: &mut openai::TtsRequestTextVoice15a214fc) {
    request.instructions = Some("Whisper".into());
}
pub fn usage(request: &mut openai::TtsRequestTextVoice15a214fc) { request.include_usage = Some(true); }
pub fn voice(request: &mut openai::TtsRequestTextVoice15a214fc) { request.voice = openai::TtsRequestTextVoicef51a0f7eVoice::Cedar(Default::default()); }
pub fn custom(request: &mut openai::TtsRequestTextVoicef3ee42bf) { request.model = openai::TtsRequestTextVoice15a214fcModel::Tts1(Default::default()); }
pub fn rate(request: &mut openai::TtsRequestTextVoice15a214fcOutputObject) { request.sample_rate_hz = Some(24000); }
pub fn streaming(request: &mut openai::TtsRequestTextVoicef51a0f7e, text: speechswitch_types::runtime::StreamingInput<String>) { request.text = text; }
