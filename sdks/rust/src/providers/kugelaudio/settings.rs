use super::{protocol::failure, Input};
use crate::{
    generated::kugelaudio::*,
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
    pub rate: f64,
    pub encoding: &'static str,
    pub timed: bool,
    pub socket: bool,
    pub speaker: bool,
}
struct Parts {
    model: Option<TtsRequestTextVoiceModel>,
    voice: TtsRequestTextVoiceVoice,
    output: TtsRequestTextVoiceOutput,
    language: Option<TtsRequestTextVoiceLanguage>,
    speed: Option<f64>,
    guidance: Option<f64>,
    tokens: Option<f64>,
    normalize: Option<TtsRequestTextVoiceTextNormalization>,
    boost: Option<TtsRequestTextVoiceTextNormalization>,
    dictionaries: Option<TtsRequestTextVoicePronunciationDictionarySelection>,
    timed: bool,
}
pub(super) fn settings(request: TtsRequest) -> Result<Settings, TransportError> {
    let mut body = Map::new();
    let mut input = None;
    let p = match request {
        TtsRequest::TextVoice(v) => {
            body.insert("text".into(), JsonValue::String(v.text));
            body.insert(
                "temperature".into(),
                JsonValue::Number(v.temperature.unwrap_or(0.4)),
            );
            Parts {
                model: v.model,
                voice: v.voice,
                output: v.output,
                language: v.language,
                speed: v.speed,
                guidance: v.voice_guidance,
                tokens: v.max_audio_tokens,
                normalize: v.text_normalization,
                boost: v.voice_boost,
                dictionaries: v.pronunciation_dictionary_selection,
                timed: v.timestamp_granularity.is_some(),
            }
        }
        TtsRequest::StreamingTextVoice(v) => {
            input = Some(v.text);
            if let Some(value) = v.temperature {
                body.insert("temperature".into(), JsonValue::Number(value));
            }
            body.insert(
                "flush_timeout_ms".into(),
                JsonValue::Number(v.text_flush_delay_ms.unwrap_or(500.0)),
            );
            body.insert(
                "max_buffer_length".into(),
                JsonValue::Number(v.text_buffer_threshold.unwrap_or(10000.0)),
            );
            Parts {
                model: v.model,
                voice: v.voice,
                output: v.output,
                language: v.language,
                speed: v.speed,
                guidance: v.voice_guidance,
                tokens: v.max_audio_tokens,
                normalize: v.text_normalization,
                boost: v.voice_boost,
                dictionaries: v.pronunciation_dictionary_selection,
                timed: v.timestamp_granularity.is_some(),
            }
        }
    };
    let voice = match p.voice {
        TtsRequestTextVoiceVoice::String(value) => {
            if value
                .trim_matches(|c| {
                    matches!(c, '\u{9}'..='\u{d}' | '\u{20}' | '\u{a0}' | '\u{1680}'
                        | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}'
                        | '\u{205f}' | '\u{3000}' | '\u{feff}')
                })
                .is_empty()
            {
                return Err(failure(
                    "KugelAudio voice must be a nonempty handle or an integer ID",
                ));
            }
            JsonValue::String(value)
        }
        TtsRequestTextVoiceVoice::Number(value) => {
            if value.fract() != 0.0 || value.abs() > 9007199254740991.0 {
                return Err(failure(
                    "KugelAudio voice must be a nonempty handle or an integer ID",
                ));
            }
            JsonValue::Number(value)
        }
    };
    body.insert("voice_id".into(), voice);
    body.insert(
        "model_id".into(),
        JsonValue::String(p.model.map_or("kugel-3", |v| v.value()).into()),
    );
    body.insert(
        "cfg_scale".into(),
        JsonValue::Number(p.guidance.unwrap_or(2.0)),
    );
    body.insert(
        "max_new_tokens".into(),
        JsonValue::Number(p.tokens.unwrap_or(2048.0)),
    );
    body.insert("speed".into(), JsonValue::Number(p.speed.unwrap_or(1.0)));
    body.insert(
        "normalize".into(),
        JsonValue::Bool(p.normalize.is_none_or(|v| v.value())),
    );
    if let Some(language) = p.language {
        body.insert(
            "language".into(),
            JsonValue::String(language.value().into()),
        );
    }
    if let Some(d) = p.dictionaries {
        body.insert("project_id".into(), JsonValue::Number(d.scope));
        if let Some(ids) = d.ids {
            body.insert(
                "dictionary_ids".into(),
                JsonValue::Array(ids.into_iter().map(JsonValue::Number).collect()),
            );
        }
    }
    let (rate, encoding) = match p.output {
        TtsRequestTextVoiceOutput::Pcm(v) => {
            (v.sample_rate_hz.map_or(24000.0, |v| v.value()), "pcm_s16le")
        }
        TtsRequestTextVoiceOutput::Object(v) => (8000.0, v.format.value()),
    };
    body.insert("sample_rate".into(), JsonValue::Number(rate));
    if encoding != "pcm_s16le" {
        body.insert(
            "output_format".into(),
            JsonValue::String(
                if encoding == "mulaw" {
                    "ulaw_8000"
                } else {
                    "alaw_8000"
                }
                .into(),
            ),
        );
    }
    let socket = input.is_some() || p.timed || p.boost.is_some();
    Ok(Settings {
        body,
        input,
        rate,
        encoding,
        timed: p.timed,
        socket,
        speaker: p.boost.is_none_or(|v| v.value()),
    })
}

pub(super) fn update(v: TtsRequestStreamingTextVoiceTextItemUpdate) -> Map {
    let mut settings = Map::new();
    for (key, value) in [
        ("cfg_scale", v.voice_guidance),
        ("temperature", v.temperature),
        ("max_new_tokens", v.max_audio_tokens),
        ("speed", v.speed),
    ] {
        if let Some(value) = value {
            settings.insert(key.into(), JsonValue::Number(value));
        }
    }
    if let Some(value) = v.language {
        settings.insert("language".into(), JsonValue::String(value.value().into()));
    }
    if let Some(value) = v.text_normalization {
        settings.insert("normalize".into(), JsonValue::Bool(value.value()));
    }
    Map::from([("update_settings".into(), JsonValue::Object(settings))])
}
