use crate::{generated::voice_ai::*, runtime::JsonValue};
use std::collections::BTreeMap;

pub(super) type Map = BTreeMap<String, JsonValue>;
pub(super) struct Settings {
    pub text: TtsRequestObject1ec54d36Text,
    pub wire: Map,
    pub legacy: bool,
    pub paced: bool,
}

// The generated validator owns model/format combinations and bounds.
pub(super) fn resolve(request: TtsRequest) -> Settings {
    let (text, voice, temperature, top_p, dictionaries, mut model, language, format, paced) =
        match request {
            TtsRequest::Object1ec54d36(v) => (
                v.text,
                v.voice,
                v.temperature,
                v.top_p,
                v.pronunciation_dictionaries,
                "auto",
                v.language.as_ref().map_or("en", |v| v.value()),
                output(v.output.as_ref()),
                false,
            ),
            TtsRequest::Object4870017d(v) => (
                v.text,
                v.voice,
                v.temperature,
                v.top_p,
                v.pronunciation_dictionaries,
                "auto",
                v.language.as_ref().map_or("en", |v| v.value()),
                paced_output(&v.output),
                true,
            ),
            TtsRequest::Object3dd4eb5b(v) => (
                v.text,
                v.voice,
                v.temperature,
                v.top_p,
                v.pronunciation_dictionaries,
                v.model.value(),
                "en",
                output(v.output.as_ref()),
                false,
            ),
            TtsRequest::Object50ac9774(v) => (
                v.text,
                v.voice,
                v.temperature,
                v.top_p,
                v.pronunciation_dictionaries,
                v.model.value(),
                "en",
                paced_output(&v.output),
                true,
            ),
            TtsRequest::Objectdd71553d(v) => (
                v.text,
                v.voice,
                v.temperature,
                v.top_p,
                v.pronunciation_dictionaries,
                v.model.value(),
                "en",
                output(v.output.as_ref()),
                false,
            ),
            TtsRequest::Objectdbc284be(v) => (
                v.text,
                v.voice,
                v.temperature,
                v.top_p,
                v.pronunciation_dictionaries,
                v.model.value(),
                "en",
                paced_output(&v.output),
                true,
            ),
            TtsRequest::Object239f4158(v) => (
                v.text,
                v.voice,
                v.temperature,
                v.top_p,
                v.pronunciation_dictionaries,
                v.model.value(),
                v.language.value(),
                output(v.output.as_ref()),
                false,
            ),
            TtsRequest::Objectcb749376(v) => (
                v.text,
                v.voice,
                v.temperature,
                v.top_p,
                v.pronunciation_dictionaries,
                v.model.value(),
                v.language.value(),
                paced_output(&v.output),
                true,
            ),
            TtsRequest::TextVoice(v) => {
                let mut wire = Map::from([
                    ("voice".into(), JsonValue::String(v.voice)),
                    (
                        "audio_format".into(),
                        JsonValue::String(
                            v.output.as_ref().map_or("mp3", |v| v.format.value()).into(),
                        ),
                    ),
                ]);
                if let Some(value) = v.temperature {
                    wire.insert("temperature".into(), JsonValue::Number(value));
                }
                if let Some(value) = v.top_p {
                    wire.insert("top_p".into(), JsonValue::Number(value));
                }
                return Settings {
                    text: TtsRequestObject1ec54d36Text::String(v.text),
                    wire,
                    legacy: true,
                    paced: false,
                };
            }
        };
    if model == "auto" {
        model = if language == "en" {
            "voiceai-tts-v1-latest"
        } else {
            "voiceai-tts-multilingual-v1-latest"
        };
    }
    let mut wire = Map::from([
        ("model".into(), JsonValue::String(model.into())),
        ("language".into(), JsonValue::String(language.into())),
        ("audio_format".into(), JsonValue::String(format)),
        (
            "temperature".into(),
            JsonValue::Number(temperature.unwrap_or(1.0)),
        ),
        ("top_p".into(), JsonValue::Number(top_p.unwrap_or(0.8))),
    ]);
    if let Some(voice) = voice {
        wire.insert("voice_id".into(), JsonValue::String(voice));
    }
    if let Some(dictionaries) = dictionaries {
        let dictionary = dictionaries
            .into_iter()
            .next()
            .expect("validated dictionary count");
        wire.insert("dictionary_id".into(), JsonValue::String(dictionary.id));
        if let Some(version) = dictionary.version {
            wire.insert("dictionary_version".into(), JsonValue::Number(version));
        }
    }
    Settings {
        text,
        wire,
        legacy: false,
        paced,
    }
}

fn pcm(v: &TtsRequestObject1ec54d36OutputPcm) -> String {
    format!(
        "pcm_{}",
        v.sample_rate_hz.as_ref().map_or(32000.0, |v| v.value())
    )
}
fn telephony(v: &TtsRequestObject1ec54d36OutputObject) -> String {
    if v.format.value() == "mulaw" {
        "ulaw_8000"
    } else {
        "alaw_8000"
    }
    .into()
}
fn paced_output(v: &TtsRequestObject4870017dOutput) -> String {
    match v {
        TtsRequestObject4870017dOutput::Pcm(v) => pcm(v),
        TtsRequestObject4870017dOutput::Object(v) => telephony(v),
    }
}
fn output(v: Option<&TtsRequestObject1ec54d36Output>) -> String {
    use TtsRequestObject1ec54d36Output::*;
    match v {
        None | Some(Mp3904ec5a3(_)) => "mp3".into(),
        Some(Mp36dc1fbe1(_)) => "mp3_22050_32".into(),
        Some(Mp3f58f8da7(_)) => "mp3_24000_48".into(),
        Some(Mp39b9ac8e8(v)) => format!("mp3_44100_{}", v.bit_rate_bps.value() / 1000.0),
        Some(Opus(v)) => format!("opus_48000_{}", v.bit_rate_bps.value() / 1000.0),
        Some(Pcm(v)) => pcm(v),
        Some(Object(v)) => telephony(v),
        Some(Wav(v)) => {
            let rate = v.sample_rate_hz.as_ref().map_or(32000.0, |v| v.value());
            if rate == 32000.0 {
                "wav".into()
            } else {
                format!("wav_{rate}")
            }
        }
    }
}
