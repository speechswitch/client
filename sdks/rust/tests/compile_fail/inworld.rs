use speechswitch_types::generated::{inworld::*, inworld_output::*};
fn temperature(r: &mut TtsRequestInworldTts2TextVoice) { r.temperature = Some(1.0); }
fn delivery(r: &mut TtsRequestTextVoice) { r.delivery_mode = None; }
fn instructions(r: &mut TtsRequestTextVoice) { r.instructions = Some("Quiet".into()); }
fn acting(r: &mut TtsRequestInworldTts2StreamingTextVoice) { r.instructions = Some("Quiet".into()); }
fn voice(r: &mut TtsRequestInworldTts2TextVoice) { r.voice_name = "Ava".into(); }
fn flac() -> TtsRequestStreamingTextVoiceOutput { TtsRequestStreamingTextVoiceOutput::Flac(()) }
fn clear() -> TtsRequestStreamingTextVoiceTextItem { TtsRequestStreamingTextVoiceTextItem::Clear(()) }
fn event() -> SynthesisItem { SynthesisItem::Clear(()) }
fn correlation(r: &mut InworldTimelineEnvelope) { r.correlation = "chunk"; }
fn context(r: &mut TtsRequestStreamingTextVoice) { r.context_before = None; }
