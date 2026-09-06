use speechswitch_types::generated::elevenlabs::*;
fn speed(r: &mut TtsRequestElevenV3TextVoiceedc22df3) { r.speed = Some(1.0); }
fn thresholds(r: &mut TtsRequestStreamingTextVoicef49cfea8) { r.text_buffer_thresholds = Some(vec![120.0]); }
fn clear() -> TtsRequestElevenV3StreamingTextVoicef18e078fTextItem { TtsRequestElevenV3StreamingTextVoicef18e078fTextItem::Clear(Default::default()) }
fn wav(r: &mut TtsRequestStreamingTextVoice194990a6, output: TtsRequestTextVoice4a0120aeOutput) { r.output = output; }
