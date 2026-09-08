use crate::{clients::openai as wire, generated::openai::*};

// Generated validation runs first; only the normalized-to-wire conversion lives here.
pub(super) fn settings(request: &TtsRequest) -> (wire::SpeechRequest, bool) {
    let (model, text, voice, custom, speed, output, instructions, usage) = match request {
        TtsRequest::TextVoice15a214fc(r) => (
            r.model.as_ref().map_or("tts-1", |v| v.value()),
            &r.text,
            r.voice.value(),
            false,
            r.speed,
            &r.output,
            None,
            false,
        ),
        TtsRequest::TextVoicef51a0f7e(r) => (
            r.model.value(),
            &r.text,
            r.voice.value(),
            false,
            r.speed,
            &r.output,
            r.instructions.as_ref(),
            r.include_usage.as_ref().is_some_and(|v| v.value()),
        ),
        TtsRequest::TextVoicef3ee42bf(r) => (
            r.model.value(),
            &r.text,
            r.voice.as_str(),
            true,
            r.speed,
            &r.output,
            r.instructions.as_ref(),
            r.include_usage.as_ref().is_some_and(|v| v.value()),
        ),
    };
    let format = match output {
        None => "pcm",
        Some(TtsRequestTextVoice15a214fcOutput::Pcm(v)) => v.format.value(),
        Some(TtsRequestTextVoice15a214fcOutput::Object(v)) => v.format.value(),
    };
    (
        wire::SpeechRequest {
            model: wire::CreateSpeechRequestModel::Variant0(model.into()),
            input: text.clone(),
            voice: if custom {
                wire::VoiceIdsOrCustomVoice::Variant1(wire::VoiceIdsOrCustomVoiceVariant1 {
                    id: voice.into(),
                })
            } else {
                wire::VoiceIdsOrCustomVoice::Variant0(wire::VoiceIdsShared::Variant0(voice.into()))
            },
            speed: Some(speed.unwrap_or(1.0)),
            response_format: Some(format.into()),
            instructions: instructions.cloned(),
            stream_format: Some(if usage { "sse" } else { "audio" }.into()),
        },
        usage,
    )
}
