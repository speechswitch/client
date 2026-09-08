use speechswitch_types::generated::{lovo::TtsRequest, lovo_output::SynthesisItem};
fn model(r: &mut TtsRequest) { r.model = Some("pro".into()); }
fn language(r: &mut TtsRequest) { r.language = Some("en".into()); }
fn format(r: &mut TtsRequest) { r.output = Some("mp3".into()); }
fn streaming(r: &mut TtsRequest) { r.text = Vec::from(["Hi".to_owned()]); }
fn voice(r: &mut TtsRequest) { r.voice = 1; }
fn reference(r: &mut TtsRequest) { r.reference_audio = Some(vec![1]); }
fn correlation(r: &mut SynthesisItem) { r.correlation = "chunk"; }
fn timestamps(r: &mut SynthesisItem) { r.timestamps = [()]; }
