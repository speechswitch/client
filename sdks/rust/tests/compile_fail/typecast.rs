use speechswitch_types::{generated::{typecast, typecast_output}, runtime::StreamingInput};
pub fn invalid() { let _ = typecast::TtsRequestObjectSegmentsItemSsfmV21TextVoiceb3babbe2Emotion::Auto(Default::default()); }
pub fn smart(mut r: typecast::TtsRequestSsfmV30TextVoicebb79df90) { r.emotion_intensity = Some(1.0); }
pub fn language() { let _ = typecast::TtsRequestObjectSegmentsItemSsfmV21TextVoiceb3babbe2Language::Hi(Default::default()); }
pub fn gain(mut r: typecast::TtsRequestSsfmV30TextVoice2e7e5231) { r.target_loudness_lufs = Some(-20.0); }
pub fn composed(mut r: typecast::TtsRequestObject) { r.text = "Hi".into(); }
pub fn pause(mut r: typecast::TtsRequestObjectSegmentsItemObject) { r.voice = "tc_voice".into(); }
pub fn rate(mut r: typecast::TtsRequestObjectOutputWav) { r.sample_rate_hz = Some(typecast::TtsRequestSsfmV21TextVoicef82be0f4OutputWavSampleRateHzNumber32000); }
pub fn input(mut r: typecast::TtsRequestSsfmV30TextVoicec9d5257e, text: StreamingInput<String>) { r.text = text; }
pub fn clear() { let _ = typecast_output::SynthesisItem::Clear; }
