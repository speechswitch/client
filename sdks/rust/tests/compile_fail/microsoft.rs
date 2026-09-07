use speechswitch_types::{generated::{microsoft::*,microsoft_output::*},runtime::StreamingInput};
fn lexicon(r: &mut TtsRequestTextVoice4ff226b4) { r.lexicon_url = Some("url".into()); }
fn languages(r: &mut TtsRequestTextVoice4ff226b4) { r.preferred_languages = Some(vec![]); }
fn prosody(r: &mut TtsRequestDragonHdTextVoice) { r.speed = Some(1.0); }
fn sampling(r: &mut TtsRequestDragonHdOmniStreamingTextVoice) { r.top_k = Some(20.0); }
fn wave() -> TtsRequestDragonHdFlashStreamingTextVoiceOutput { TtsRequestDragonHdFlashStreamingTextVoiceOutput::Wavbcb4c8a6(()) }
fn commands(r: &mut TtsRequestDragonHdStreamingTextVoice, input: StreamingInput<i32>) { r.text = input; }
fn clear() -> SynthesisItem { SynthesisItem::Clear(()) }
fn reference(r: &mut TtsRequestTextVoice4ff226b4) { r.reference_audio = Some(vec![1]); }
fn correlation(r: &mut MicrosoftEnvelope) { r.correlation = "chunk"; }
