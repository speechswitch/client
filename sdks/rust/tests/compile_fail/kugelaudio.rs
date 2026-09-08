use speechswitch_types::generated::{kugelaudio::*, kugelaudio_output::*};
fn mp3() -> TtsRequestTextVoiceOutput { TtsRequestTextVoiceOutput::Mp3(()) }
fn rate(r: &mut TtsRequestTextVoiceOutputObject) { r.sample_rate_hz = Some(TtsRequestTextVoiceOutputPcmSampleRateHzNumber44100); }
fn buffering(r: &mut TtsRequestTextVoice) { r.text_flush_delay_ms = Some(1.0); }
fn voice(r: &mut TtsRequestTextVoice) { r.voice_name = "custom".into(); }
fn identity(r: &mut TtsRequestStreamingTextVoiceTextItemUpdate) { r.voice = None; }
fn replacements(r: &mut TtsRequestStreamingTextVoiceTextItemUpdate) { r.replacements = None; }
fn output(r: &mut TtsRequestStreamingTextVoiceTextItemClear) { r.output = None; }
fn correlation(r: &mut KugelAudioEnvelope) { r.correlation = "chunk"; }
fn model(r: &mut TtsRequestTextVoice) { r.model = Some("unknown"); }
fn event() -> SynthesisItem { SynthesisItem::Batch(()) }
