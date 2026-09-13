use super::failure;
use crate::{
    generated::xai::*,
    http::TransportError,
    runtime::{JsonValue, StreamingInput},
};
use std::collections::{BTreeMap, BTreeSet};

pub(super) type Map = BTreeMap<String, JsonValue>;
pub(super) enum Text {
    Whole(String),
    Live(StreamingInput<TtsRequestStreamingTextTextItem>),
}
pub(super) struct Settings {
    pub text: Text,
    pub wire: Map,
    pub initial: Option<Map>,
    pub timed: bool,
}

// The generated validator owns provider variants, literal choices and bounds.
pub(super) fn resolve(request: TtsRequest) -> Result<Settings, TransportError> {
    let (text, voice, language, output, speed, latency, normalization, replacements, timed) =
        match request {
            TtsRequest::Text(v) => (
                Text::Whole(v.text),
                v.voice,
                v.language,
                v.output,
                v.speed,
                v.latency_optimization,
                v.text_normalization,
                v.replacements,
                v.timestamp_granularity.is_some(),
            ),
            TtsRequest::StreamingText(v) => (
                Text::Live(v.text),
                v.voice,
                v.language,
                v.output,
                v.speed,
                v.latency_optimization,
                v.text_normalization,
                v.replacements,
                v.timestamp_granularity.is_some(),
            ),
        };
    let mut wire = Map::from([(
        "language".into(),
        JsonValue::String(language.as_ref().map_or("auto", |v| v.value()).into()),
    )]);
    if let Some(v) = voice {
        wire.insert("voice_id".into(), JsonValue::String(v));
    }
    if let Some(v) = speed {
        wire.insert("speed".into(), JsonValue::Number(v));
    }
    if let Some(v) = normalization {
        wire.insert("text_normalization".into(), JsonValue::Bool(v.value()));
    }
    if let Some(v) = latency {
        wire.insert(
            "optimize_streaming_latency".into(),
            JsonValue::Number(match v {
                TtsRequestTextLatencyOptimization::None(_) => 0.0,
                TtsRequestTextLatencyOptimization::Moderate(_) => 1.0,
                TtsRequestTextLatencyOptimization::Aggressive(_) => 2.0,
            }),
        );
    }
    if timed {
        wire.insert("with_timestamps".into(), JsonValue::Bool(true));
    }
    if let Some(output) = output {
        let (format, rate, bitrate) = match output {
            TtsRequestTextOutput::Mp3(v) => ("mp3", v.sample_rate_hz, v.bit_rate_bps),
            TtsRequestTextOutput::Object(v) => (v.format.value(), v.sample_rate_hz, None),
        };
        let mut native = Map::from([("codec".into(), JsonValue::String(format.into()))]);
        if let Some(v) = rate {
            native.insert("sample_rate".into(), JsonValue::Number(v.value()));
        }
        if let Some(v) = bitrate {
            native.insert("bit_rate".into(), JsonValue::Number(v.value()));
        }
        wire.insert("output_format".into(), JsonValue::Object(native));
    }
    Ok(Settings {
        text,
        wire,
        initial: replacements.map(replacement_map).transpose()?,
        timed,
    })
}

pub(super) fn replacement_map(
    values: Vec<TtsRequestTextReplacementsItem>,
) -> Result<Map, TransportError> {
    let mut result = Map::new();
    let mut phrases = BTreeSet::new();
    for item in values {
        // Match Go's conservative preflight; xAI owns non-ASCII case equivalence.
        let words: Vec<_> = item
            .pattern
            .split(|c: char| c == '\u{feff}' || c != '\u{85}' && c.is_whitespace())
            .filter(|s| !s.is_empty())
            .collect();
        let phrase = words.join(" ").to_ascii_lowercase();
        if !phrases.insert(phrase) {
            return Err(failure(&format!(
                "Duplicate xAI replacement phrase: {}",
                item.pattern
            )));
        }
        result.insert(item.pattern, JsonValue::String(item.replacement));
    }
    Ok(result)
}
