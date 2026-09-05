use speechswitch_types::{generated::{hume, xai}, runtime::StreamingInput};

fn wrong_model(request: &mut hume::TtsRequestOctave2TextVoice) {
    request.instructions = Some("Whisper".to_string());
}
fn wrong_literal() {
    let _: xai::TtsRequestStreamingTextTextItemClearCommand = "cancel";
}
fn wrong_stream(value: StreamingInput<xai::TtsRequestStreamingTextTextItem>) -> StreamingInput<String> {
    value
}
