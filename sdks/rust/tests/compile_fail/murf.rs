use speechswitch_types::generated::{murf as s, murf_output as o};
pub fn duration(r: &s::TtsRequestTextVoice) { let _ = &r.target_duration_ms; }
pub fn timing(r: &s::TtsRequestTextVoice) { let _ = &r.timestamp_granularity; }
pub fn retention(r: &s::TtsRequestStreamingTextVoice) { let _ = &r.audio_retention; }
pub fn reference(r: &s::TtsRequestTextVoice) { let _ = &r.reference_audio; }
pub fn updates(r: &s::TtsRequestStreamingTextVoiceTextItemUpdate) { let _ = &r.replacements; }
pub fn input(r: &mut s::TtsRequestGen2TextVoiceca621e19, input: speechswitch_types::runtime::StreamingInput<String>) { r.text = input; }
pub fn rate() { let _ = s::TtsRequestGen2TextVoiceca621e19OutputSampleRateHz::Number16000(Default::default()); }
pub fn correlation() { let _ = o::MurfEnvelopeCorrelation::Chunk(Default::default()); }
pub fn event() { let _ = o::SynthesisItem::Updated(Default::default()); }
pub fn flush(r: &mut o::FlushEvent) { r.input_group_id = 1; }
