use super::failure;
use crate::{
    clients::camb as wire, generated::camb::*, http::TransportError, runtime::StreamingInput,
};

pub(super) enum Input {
    Whole(Option<String>),
    Streaming(StreamingInput<String>),
}
pub(super) enum Prepared {
    Http(wire::HttpInput),
    Socket {
        start: wire::SessionStart,
        input: Input,
        timed: bool,
    },
}

// Only wire conversions live here. Request unions, literal choices and bounds
// are enforced by the generated types and validator before these fields move.
pub(super) fn prepare(request: TtsRequest) -> Result<Prepared, TransportError> {
    let (
        voice,
        language,
        output,
        speed,
        audio,
        entities,
        reference,
        accent,
        delay,
        steps,
        input,
        timed,
    ) = match request {
        TtsRequest::TextVoice(r) => {
            let model = match r.model {
                TtsRequestTextVoiceModel::Mars8Flash(_) => "mars-flash",
                TtsRequestTextVoiceModel::Mars8Instruct(_) => "mars-instruct",
                TtsRequestTextVoiceModel::Mars8Pro(_) => "mars-pro",
                TtsRequestTextVoiceModel::Mars81FlashBeta(_) => "mars-8.1-flash-beta",
                TtsRequestTextVoiceModel::Mars81ProBeta(_) => "mars-8.1-pro-beta",
            };
            let (format, sample_rate) = match r.output {
                TtsRequestTextVoiceOutput::Object(output) => (
                    if matches!(
                        output.format,
                        TtsRequestMars81FlashBetaStreamingTextVoiceOutputFormat::Aac(_)
                    ) {
                        "adts"
                    } else {
                        output.format.value()
                    }
                    .to_owned(),
                    output.sample_rate_hz,
                ),
                TtsRequestTextVoiceOutput::Pcm(output) => {
                    let encoding = match output.sample_encoding {
                        TtsRequestTextVoiceOutputPcmSampleEncoding::SignedInteger16(_) => "s16",
                        TtsRequestTextVoiceOutputPcmSampleEncoding::SignedInteger32(_) => "s32",
                        TtsRequestTextVoiceOutputPcmSampleEncoding::Float32(_) => "f32",
                    };
                    let order = match output.byte_order {
                        TtsRequestTextVoiceOutputPcmByteOrder::LittleEndian(_) => "le",
                        TtsRequestTextVoiceOutputPcmByteOrder::BigEndian(_) => "be",
                    };
                    (format!("pcm_{encoding}{order}"), output.sample_rate_hz)
                }
            };
            return Ok(Prepared::Http(wire::HttpInput {
                text: r.text,
                voice_id: voice_id(&r.voice)?,
                language: r.language.value().into(),
                speech_model: Some(model.into()),
                enhance_named_entities_pronunciation: r
                    .named_entity_pronunciation_enhancement
                    .map(|v| v.value()),
                output_configuration: Some(wire::HttpInputOutputConfiguration {
                    format: Some(format),
                    sample_rate: sample_rate.map(Some),
                    apply_enhancement: r.audio_enhancement.map(|v| Some(v.value())),
                    ..Default::default()
                }),
                voice_settings: Some(wire::HttpInputVoiceSettings {
                    speaking_rate: r.speed.map(Some),
                    enhance_reference_audio_quality: r
                        .reference_audio_enhancement
                        .map(|v| Some(v.value())),
                    maintain_source_accent: r.accent_preservation.map(|v| Some(v.value())),
                    ..Default::default()
                }),
                ..Default::default()
            }));
        }
        TtsRequest::Mars81FlashBetaStreamingTextVoice(r) => (
            r.voice,
            r.language,
            r.output,
            r.speed,
            r.audio_enhancement,
            r.named_entity_pronunciation_enhancement,
            r.reference_audio_enhancement,
            r.accent_preservation,
            r.text_flush_delay_ms,
            r.inference_steps,
            Input::Streaming(r.text),
            r.timestamp_granularity.is_some(),
        ),
        TtsRequest::Mars81FlashBetaTextVoice(r) => (
            r.voice,
            r.language,
            r.output,
            r.speed,
            r.audio_enhancement,
            r.named_entity_pronunciation_enhancement,
            r.reference_audio_enhancement,
            r.accent_preservation,
            r.text_flush_delay_ms,
            r.inference_steps,
            Input::Whole(Some(r.text)),
            true,
        ),
    };
    Ok(Prepared::Socket {
        input,
        timed,
        start: wire::SessionStart {
            type_: "session.start".into(),
            voice_id: voice_id(&voice)?,
            language: Some(language.value().into()),
            output_format: Some(output.format.value().into()),
            sample_rate: output.sample_rate_hz.map(Some),
            word_timestamps: Some(timed),
            idle_timeout: Some(delay.unwrap_or(1000.0) / 1000.0),
            inference_steps: steps.map(Some),
            speaking_rate: speed.map(Some),
            apply_enhancement: audio.map(|v| Some(v.value())),
            enhance_named_entities_pronunciation: Some(entities.is_some_and(|v| v.value())),
            enhance_reference_audio_quality: Some(reference.is_some_and(|v| v.value())),
            maintain_source_accent: Some(accent.is_some_and(|v| v.value())),
            ..Default::default()
        },
    })
}

fn voice_id(voice: &str) -> Result<f64, TransportError> {
    let value: u64 = voice
        .trim_start_matches('0')
        .parse()
        .map_err(|_| failure("CAMB voice must be a positive integer ID"))?;
    if value == 0 || value > 9007199254740991 {
        return Err(failure("CAMB voice must be a positive integer ID"));
    }
    Ok(value as f64)
}
