use speechswitch_types::generated::deepgram::*;
fn tags(r: &mut TtsRequestAura1StreamingTextVoice) { r.tags = Some(vec![]); }
fn output(r: &mut TtsRequestAura1StreamingTextVoice) { r.output = TtsRequestAura1StreamingTextVoiceOutput::Mp3; }
fn language(r: &mut TtsRequestAura1TextVoice) { r.language = "es"; }
