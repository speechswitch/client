use speechswitch_types::generated::{gradium, gradium_output};
fn speed(r: &gradium::TtsRequest) { let _ = &r.speed; }
fn opus_rate(r: &gradium::TtsRequestOutputOggOpus) { let _ = &r.sample_rate_hz; }
fn conflicting_normalization(r: &gradium::TtsRequestTextNormalizationObjecte21202a8) { let _ = &r.rules; }
fn clear_input() { let _ = gradium::TtsRequestTextAsyncIterableItem::Clear; }
fn chunk_correlation(r: &mut gradium_output::TimelineOutput) { r.correlation = "chunk"; }
fn clear_output() { let _ = gradium_output::SynthesisItem::Clear; }
