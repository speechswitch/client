use speechswitch_types::generated::{cartesia::*, cartesia_output::TimelineOutput};
fn language(request: &mut TtsRequestTextVoicef0bb1766) { request.language = Some("en-GB".to_owned()); }
fn format() { let _ = TtsRequestStreamingTextVoice0bf53a99Output::Mp3(()); }
fn correlation(output: &mut TimelineOutput) { output.correlation = "chunk"; }
