use speechswitch_types::generated::stream::*;
fn invalid_audio(chunk: &mut SynthesisEnvelopeChunk) {
    chunk.audio = None;
}
fn invalid_event(clear: &mut ClearEvent) {
    clear.event = "cancel";
}
fn bare_audio() -> TimestampStreamItem {
    TimestampStreamItem::Bytes(vec![1])
}
