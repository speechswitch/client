use speechswitch_types::generated::{rime::*, rime_output::RimeEnvelope};
fn coda_markup(r: &mut TtsRequestCodaTextVoicef75e9756) { r.text_markup = None; }
fn spanish_phonemes(r: &mut TtsRequestMistV3StreamingTextVoice49f68e83TextMarkup) { r.phonemes = None; }
fn arabic_timestamps(r: &mut TtsRequestCodaTextVoice50d85478) { r.timestamp_granularity = None; }
fn legacy_wav(r: &mut TtsRequestMistV2StreamingTextVoice03cc8904OutputPcm) { r.format = "wav"; }
fn modern_normalization(r: &mut TtsRequestMistV3TextVoice2a5bc5c5) { r.text_normalization = None; }
fn float_pcm(r: &mut TtsRequestCodaStreamingTextVoice84ec2db1OutputObjectb2df2f24) { r.sample_encoding = Some("float_32"); }
fn reference_audio(r: &mut TtsRequestCodaTextVoicef75e9756) { r.reference_audio = None; }
fn wrong_model(r: &mut TtsRequestCodaTextVoicef75e9756) { r.model = "mist-v2"; }
fn inferred_pairing(r: &mut RimeEnvelope) { r.correlation_id = None; }
