use speechswitch_types::{generated::{respeecher::*,respeecher_output::AudioEnvelope},runtime::StreamingInput};
fn wave(v: &mut TtsRequestTextVoice, text: StreamingInput<String>) { v.text = text; }
fn mulaw(v: &mut TtsRequestObjectOutputMulaw) { v.sample_encoding = Some("float_32"); }
fn reference(v: &mut TtsRequestObject) { v.reference_audio = Some(vec![]); }
fn timestamps(v: &mut TtsRequestObject) { v.timestamp_granularity = Some("word"); }
fn format(v: &mut TtsRequestTextVoiceOutput) { v.format = "mp3"; }
fn model(v: &mut TtsRequestObject) { v.model = Some("marketplace"); }
fn timestamp_data(v: &mut AudioEnvelope) { v.timestamps = [()]; }
