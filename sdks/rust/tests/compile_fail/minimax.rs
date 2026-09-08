use speechswitch_types::generated::{minimax::*, minimax_output::*};
fn legacy_language(r: &mut TtsRequestTextVoice9d11e112) { r.language = Some(TtsRequestTexte253c939Language::Fa(Default::default())); }
fn modern_emotion(r: &mut TtsRequestTextVoice9b47fc40) { r.emotion = Some(TtsRequestTexte253c939Emotion::Whisper(Default::default())); }
fn socket_normalization(r: &mut TtsRequestStreamingTextVoice9e2e17ce) { r.text_normalization = true; }
fn socket_timestamps(r: &mut TtsRequestStreamingTextVoice9e2e17ce) { r.timestamp_granularity = "word"; }
fn older_segmentation(r: &mut TtsRequestStreamingTextVoicee206c70a) { r.split_turns = true; }
fn voice_blend(r: &mut TtsRequestTextVoice9b47fc40) { r.voice_blend = vec![]; }
fn reference(r: &mut TtsRequestTextVoice9b47fc40) { r.reference_audio = vec![1]; }
fn wave(r: &mut TtsRequestStreamingTextVoice9e2e17ce, output: TtsRequestTextf2dcc77eOutput) { r.output = Some(output); }
fn update() { let _ = TtsRequestStreamingText12421ea0TextItem::Update(Default::default()); }
fn correlation(r: &mut MiniMaxEnvelope) { r.correlation = "chunk"; }
fn flush(r: &mut FlushEvent) { r.correlation_id = 1; }
