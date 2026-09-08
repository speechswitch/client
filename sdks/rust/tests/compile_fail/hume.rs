use speechswitch_types::generated::{hume::*, hume_output::*};
fn acting(r: &mut TtsRequestOctave2TextVoice) { r.instructions = Some("Whisper".into()); }
fn design(r: &mut TtsRequestOctave2TextVoice) { r.voice_description = Some("Narrator".into()); }
fn timestamps(r: &mut TtsRequestOctave1TextVoice) { r.timestamp_granularity = None; }
fn rate(r: &mut TtsRequestOctave1TextOutput) { r.sample_rate_hz = Some(24000.0); }
fn voice(r: &mut TtsRequestOctave2TextVoice) { r.voice_name = "Ava".into(); }
fn clear() -> TtsRequestOctave2StreamingTurnsTurnsItem { TtsRequestOctave2StreamingTurnsTurnsItem::Clear(()) }
fn turn(r: &mut TtsRequestOctave2TurnsContextBeforeTurnsTurnsItem) { r.instructions = Some("Whisper".into()); }
fn association(r: &mut HumeEnvelope) { r.correlation = "chunk"; }
fn event() -> SynthesisItem { SynthesisItem::Flush(()) }
fn split(r: &mut TtsRequestOctave2StreamingTextVoice) { r.split_turns = Some(false); }
