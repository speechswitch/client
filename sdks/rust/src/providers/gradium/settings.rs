use crate::{generated::gradium::*, runtime::JsonValue};
use std::collections::BTreeMap;

// Generated validation runs first; these are explicit wire conversions only.
pub(super) fn wire(r: &TtsRequest) -> BTreeMap<String, JsonValue> {
    let format = match &r.output {
        TtsRequestOutput::Pcm(v) => format!(
            "pcm_{}",
            v.sample_rate_hz.as_ref().map_or(48000.0, |v| v.value())
        ),
        TtsRequestOutput::Wav(_) => "wav".into(),
        TtsRequestOutput::OggOpus(_) => "opus".into(),
        TtsRequestOutput::Object(v) => if v.format.value() == "mulaw" {
            "ulaw_8000"
        } else {
            "alaw_8000"
        }
        .into(),
    };
    let mut config = BTreeMap::from([
        (
            "temp".into(),
            JsonValue::Number(r.temperature.unwrap_or(0.7)),
        ),
        (
            "cfg_coef".into(),
            JsonValue::Number(r.voice_guidance.unwrap_or(2.0)),
        ),
        (
            "padding_bonus".into(),
            JsonValue::Number(r.pacing_bias.unwrap_or(0.0)),
        ),
    ]);
    let rewriting = match &r.text_normalization {
        None | Some(TtsRequestTextNormalization::Auto(_)) => None,
        Some(TtsRequestTextNormalization::False(_)) => Some("none".into()),
        Some(TtsRequestTextNormalization::Objecte21202a8(v)) => Some(v.locale.value().into()),
        Some(TtsRequestTextNormalization::Object81d1078f(v)) => Some(
            v.rules
                .iter()
                .map(|v| v.value())
                .collect::<Vec<_>>()
                .join(","),
        ),
    };
    if let Some(rewriting) = rewriting {
        config.insert("rewrite_rules".into(), JsonValue::String(rewriting));
    }
    BTreeMap::from([
        (
            "model_name".into(),
            JsonValue::String(r.model.as_ref().map_or("default", |v| v.value()).into()),
        ),
        ("voice_id".into(), JsonValue::String(r.voice.clone())),
        ("output_format".into(), JsonValue::String(format)),
        ("json_config".into(), JsonValue::Object(config)),
    ])
}
