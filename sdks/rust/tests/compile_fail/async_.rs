use speechswitch_types::generated::async_::*;
fn pro(request: &mut TtsRequestProV10TextVoice54fc4ea5) {
    request.speed = Some(1.0);
}
fn stream(output: TtsRequestFlashV15TextVoicee827622bOutputWav) -> TtsRequestFlashV15StreamingTextVoiceOutput {
    TtsRequestFlashV15TextVoicee827622bOutput::Wav(output)
}
fn timed(output: TtsRequestFlashV15StreamingTextVoiceOutputMulaw) -> TtsRequestFlashV15TextVoice7c30ce7aOutput {
    TtsRequestFlashV15TextVoicee827622bOutput::Mulaw(output)
}
