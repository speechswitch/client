use speechswitch_types::{generated::{xai, xai_output, amazon}, providers::xai as provider, runtime::StreamingInput};
pub fn bitrate(output: &mut xai::TtsRequestTextOutputObject) { output.bit_rate_bps = None; }
pub fn latency(request: &mut xai::TtsRequestText) { request.latency_optimization = Some(true); }
pub fn model(request: &mut xai::TtsRequestText) { request.model = Some(String::from("other")); }
pub fn replacement(update: &mut xai::TtsRequestStreamingTextTextItemUpdate) { update.replacements = String::from("Acme"); }
pub fn correlation(output: &mut xai_output::TimestampedAudio) { output.correlation = "timeline"; }
pub fn timestamp(output: &mut xai_output::CharacterTimestamp) { output.end_time_ms = "later"; }
pub fn narrower(request: &mut amazon::TtsRequestGenerativeStreamingTextVoice, input: StreamingInput<provider::Input>) { request.text = input; }
pub async fn wrong_request(request: xai::TtsRequestText) { let _ = provider::synthesize(request, provider::Options::default()).await; }
