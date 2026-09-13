use speechswitch_types::generated::resemble;
pub fn language(r: &mut resemble::TtsRequestText) { r.language = Some("en".into()); }
pub fn guidance(r: &mut resemble::TtsRequestChatterboxTurboText) { r.voice_guidance = Some(0.5); }
pub fn sampling(r: &mut resemble::TtsRequestChatterboxMultilingualText) { r.top_p = Some(0.5); }
pub fn streaming(r: &mut resemble::TtsRequestText, text: speechswitch_types::runtime::StreamingInput<String>) { r.text = text; }
pub fn voice(r: &mut resemble::TtsRequestText) { r.voice = Some("saved".into()); }
pub fn output(r: &mut resemble::TtsRequestTextOutput) { r.sample_rate_hz = Some(24000.0); }
