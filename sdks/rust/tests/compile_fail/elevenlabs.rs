use speechswitch_types::generated::elevenlabs::*;
fn speed(r: &mut TtsRequestElevenV3TextVoicec3eabebc) { r.speed = Some(1.0); }
fn thresholds(r: &mut TtsRequestStreamingTextVoice732994d4) { r.text_buffer_thresholds = Some(vec![120.0]); }
fn clear() -> TtsRequestElevenV3StreamingTextVoice145c0c5aTextItem { TtsRequestElevenV3StreamingTextVoice145c0c5aTextItem::Clear(Default::default()) }
fn wav(r: &mut TtsRequestStreamingTextVoice5024de38, output: TtsRequestTextVoice814840b5Output) { r.output = output; }
