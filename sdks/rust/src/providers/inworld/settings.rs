use super::{protocol::failure, Input};
use crate::{
    generated::inworld::*,
    http::TransportError,
    runtime::{JsonValue, StreamingInput, ValidationError},
};
use std::{any::Any, collections::BTreeMap};

pub(super) type Map = BTreeMap<String, JsonValue>;
pub(super) type Validator =
    Box<dyn Fn(&dyn Any, Option<&str>) -> Result<(), ValidationError> + Send>;
pub(super) struct Settings {
    pub body: Map,
    pub input: Option<StreamingInput<Input>>,
    pub format: &'static str,
    pub timed: bool,
    pub chunk: bool,
}
struct Parts {
    model: &'static str,
    voice: String,
    output: TtsRequestTextVoiceOutput,
    speed: Option<f64>,
    language: Option<String>,
    normalization: Option<TtsRequestTextVoiceTextNormalization>,
    granularity: Option<TtsRequestTextVoiceTimestampGranularity>,
    timing: Option<TtsRequestTextVoiceTimestampDelivery>,
}

pub(super) fn settings(request: TtsRequest) -> Result<Settings, TransportError> {
    let mut body = Map::new();
    let mut input = None;
    // These conversions consume the generated variants after schema validation.
    let p = match request {
        TtsRequest::TextVoice(v) => {
            body.insert(
                "temperature".into(),
                JsonValue::Number(v.temperature.filter(|v| *v != 0.0).unwrap_or(1.0)),
            );
            body.insert("text".into(), JsonValue::String(v.text));
            body.insert(
                "enhanceGeneration".into(),
                JsonValue::Bool(v.audio_enhancement.is_some_and(|v| v.value())),
            );
            if let Some(prior) = v.context_before {
                if prior
                    .texts
                    .iter()
                    .map(|v| v.encode_utf16().count())
                    .sum::<usize>()
                    > 2000
                {
                    return Err(failure(
                        "Inworld preceding context must not exceed 2000 characters",
                    ));
                }
                body.insert(
                    "synthesisContext".into(),
                    JsonValue::Object(Map::from([(
                        "previousRequests".into(),
                        JsonValue::Array(
                            prior
                                .texts
                                .into_iter()
                                .map(|v| {
                                    JsonValue::Object(Map::from([(
                                        "text".into(),
                                        JsonValue::String(v),
                                    )]))
                                })
                                .collect(),
                        ),
                    )])),
                );
            }
            Parts {
                model: v.model.value(),
                voice: v.voice,
                output: v.output,
                speed: v.speed,
                language: v.language,
                normalization: v.text_normalization,
                granularity: v.timestamp_granularity,
                timing: v.timestamp_delivery,
            }
        }
        TtsRequest::StreamingTextVoice(v) => {
            body.insert(
                "temperature".into(),
                JsonValue::Number(v.temperature.filter(|v| *v != 0.0).unwrap_or(1.0)),
            );
            input = Some(v.text);
            body.insert(
                "maxBufferDelayMs".into(),
                JsonValue::Number(v.text_flush_delay_ms.unwrap_or(0.0)),
            );
            body.insert(
                "bufferCharThreshold".into(),
                JsonValue::Number(
                    v.text_buffer_threshold
                        .filter(|v| *v != 0.0)
                        .unwrap_or(1000.0),
                ),
            );
            body.insert(
                "autoMode".into(),
                JsonValue::Bool(v.automatic_text_flushing.is_some_and(|v| v.value())),
            );
            Parts {
                model: v.model.value(),
                voice: v.voice,
                output: streaming_output(v.output),
                speed: v.speed,
                language: v.language,
                normalization: v.text_normalization,
                granularity: v.timestamp_granularity,
                timing: v.timestamp_delivery,
            }
        }
        TtsRequest::InworldTts2TextVoice(v) => {
            body.insert(
                "deliveryMode".into(),
                JsonValue::String(
                    v.delivery_mode
                        .map(|v| v.value())
                        .unwrap_or("balanced")
                        .to_ascii_uppercase(),
                ),
            );
            body.insert("text".into(), JsonValue::String(v.text));
            body.insert(
                "enhanceGeneration".into(),
                JsonValue::Bool(v.audio_enhancement.is_some_and(|v| v.value())),
            );
            if let Some(prior) = v.context_before {
                if prior
                    .texts
                    .iter()
                    .map(|v| v.encode_utf16().count())
                    .sum::<usize>()
                    > 2000
                {
                    return Err(failure(
                        "Inworld preceding context must not exceed 2000 characters",
                    ));
                }
                body.insert(
                    "synthesisContext".into(),
                    JsonValue::Object(Map::from([(
                        "previousRequests".into(),
                        JsonValue::Array(
                            prior
                                .texts
                                .into_iter()
                                .map(|v| {
                                    JsonValue::Object(Map::from([(
                                        "text".into(),
                                        JsonValue::String(v),
                                    )]))
                                })
                                .collect(),
                        ),
                    )])),
                );
            }
            if let Some(v) = v.instructions {
                body.insert("instruction".into(), JsonValue::String(v));
            }
            Parts {
                model: v.model.value(),
                voice: v.voice,
                output: v.output,
                speed: v.speed,
                language: v.language,
                normalization: v.text_normalization,
                granularity: v.timestamp_granularity,
                timing: v.timestamp_delivery,
            }
        }
        TtsRequest::InworldTts2StreamingTextVoice(v) => {
            body.insert(
                "deliveryMode".into(),
                JsonValue::String(
                    v.delivery_mode
                        .map(|v| v.value())
                        .unwrap_or("balanced")
                        .to_ascii_uppercase(),
                ),
            );
            input = Some(v.text);
            body.insert(
                "maxBufferDelayMs".into(),
                JsonValue::Number(v.text_flush_delay_ms.unwrap_or(0.0)),
            );
            body.insert(
                "bufferCharThreshold".into(),
                JsonValue::Number(
                    v.text_buffer_threshold
                        .filter(|v| *v != 0.0)
                        .unwrap_or(1000.0),
                ),
            );
            body.insert(
                "autoMode".into(),
                JsonValue::Bool(v.automatic_text_flushing.is_some_and(|v| v.value())),
            );
            Parts {
                model: v.model.value(),
                voice: v.voice,
                output: streaming_output(v.output),
                speed: v.speed,
                language: v.language,
                normalization: v.text_normalization,
                granularity: v.timestamp_granularity,
                timing: v.timestamp_delivery,
            }
        }
    };
    let (format, mut audio) = audio(p.output);
    audio.insert(
        "speakingRate".into(),
        JsonValue::Number(p.speed.unwrap_or(1.0)),
    );
    body.insert("audioConfig".into(), JsonValue::Object(audio));
    body.insert("modelId".into(), JsonValue::String(p.model.into()));
    body.insert("voiceId".into(), JsonValue::String(p.voice));
    if let Some(language) = p.language {
        body.insert("language".into(), JsonValue::String(language));
    }
    let normalization = match p.normalization {
        Some(TtsRequestTextVoiceTextNormalization::True(_)) => "ON",
        Some(TtsRequestTextVoiceTextNormalization::False(_)) => "OFF",
        _ => "APPLY_TEXT_NORMALIZATION_UNSPECIFIED",
    };
    body.insert(
        "applyTextNormalization".into(),
        JsonValue::String(normalization.into()),
    );
    let timed = p.granularity.is_some();
    body.insert(
        "timestampType".into(),
        JsonValue::String(
            p.granularity
                .map(|v| v.value().to_ascii_uppercase())
                .unwrap_or("TIMESTAMP_TYPE_UNSPECIFIED".into()),
        ),
    );
    Ok(Settings {
        body,
        input,
        format,
        timed,
        chunk: p.timing.is_some_and(|v| v.value() == "chunk"),
    })
}

fn streaming_output(output: TtsRequestStreamingTextVoiceOutput) -> TtsRequestTextVoiceOutput {
    match output {
        TtsRequestStreamingTextVoiceOutput::Mp3(v) => TtsRequestTextVoiceOutput::Mp3(v),
        TtsRequestStreamingTextVoiceOutput::OggOpus(v) => TtsRequestTextVoiceOutput::OggOpus(v),
        TtsRequestStreamingTextVoiceOutput::Pcm(v) => TtsRequestTextVoiceOutput::Pcm(v),
        TtsRequestStreamingTextVoiceOutput::Object(v) => TtsRequestTextVoiceOutput::Object(v),
        TtsRequestStreamingTextVoiceOutput::Wav(v) => TtsRequestTextVoiceOutput::Wav(v),
    }
}
fn audio(output: TtsRequestTextVoiceOutput) -> (&'static str, Map) {
    let (format, rate, bit) = match output {
        TtsRequestTextVoiceOutput::Flac(v) => (
            v.format.value(),
            v.sample_rate_hz.map(|v| v.value()).unwrap_or(48000.0),
            None,
        ),
        TtsRequestTextVoiceOutput::Mp3(v) => (
            v.format.value(),
            v.sample_rate_hz.map(|v| v.value()).unwrap_or(48000.0),
            Some(v.bit_rate_bps.unwrap_or(128000.0)),
        ),
        TtsRequestTextVoiceOutput::OggOpus(v) => (
            v.format.value(),
            v.sample_rate_hz.map(|v| v.value()).unwrap_or(48000.0),
            Some(v.bit_rate_bps.unwrap_or(128000.0)),
        ),
        TtsRequestTextVoiceOutput::Pcm(v) => (
            v.format.value(),
            v.sample_rate_hz.map(|v| v.value()).unwrap_or(48000.0),
            None,
        ),
        TtsRequestTextVoiceOutput::Object(v) => (v.format.value(), 8000.0, None),
        TtsRequestTextVoiceOutput::Wav(v) => (
            v.format.value(),
            v.sample_rate_hz.map(|v| v.value()).unwrap_or(48000.0),
            None,
        ),
    };
    let mut audio = Map::from([
        (
            "audioEncoding".into(),
            JsonValue::String(format.to_ascii_uppercase()),
        ),
        ("sampleRateHertz".into(), JsonValue::Number(rate)),
    ]);
    if let Some(bit) = bit {
        audio.insert("bitRate".into(), JsonValue::Number(bit));
    }
    (format, audio)
}
