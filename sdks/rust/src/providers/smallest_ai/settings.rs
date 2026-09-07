use crate::{generated::smallest_ai::*, json};
use std::fmt::Write;

pub(super) struct Settings {
    pub wire: String,
    pub voice: String,
    pub request_id: Option<String>,
    pub continuation: Option<String>,
    pub buffer_delay: f64,
    pub completion_delay: f64,
    pub timed: bool,
    pub retention: bool,
    pub dictionaries: bool,
}

// Whole-text normalization occurs before generated validation. Stream fragments
// are intentionally not trimmed or constrained by the whole-request text limit.
pub(super) fn trim(request: &mut TtsRequest) {
    let text = match request {
        TtsRequest::LightningV31ProTextVoice74d06326(v) => &mut v.text,
        TtsRequest::LightningV31ProTextVoice3c7c5185(v) => &mut v.text,
        TtsRequest::LightningV31TextVoice5e2ae2e5(v) => &mut v.text,
        TtsRequest::LightningV31TextVoice727240a7(v) => &mut v.text,
        _ => return,
    };
    *text = text
        .trim_matches(|c| {
            matches!(
                c,
                '\t' | '\n' | '\x0b' | '\x0c' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
                    ..='\u{200a}'
                        | '\u{2028}'
                        | '\u{2029}'
                        | '\u{202f}'
                        | '\u{205f}'
                        | '\u{3000}'
                        | '\u{feff}'
            )
        })
        .to_owned();
}

// Conversion only; authored combinations and bounds belong to the generated validator.
pub(super) fn prepare(request: &TtsRequest) -> Settings {
    let (
        model,
        voice,
        language,
        number_language,
        output,
        speed,
        formula,
        retention,
        session_id,
        request_id,
        dictionaries,
        continuation,
        buffer_delay,
        completion_delay,
        timed,
    ) = match request {
        TtsRequest::LightningV31ProStreamingTextVoice8f1b36fb(v) => (
            "lightning_v3.1_pro",
            v.voice.as_str(),
            v.language.as_ref().map_or("auto", |v| v.value()),
            v.number_pronunciation_language.as_ref().map(|v| v.value()),
            &v.output,
            v.speed,
            &v.formula_reading,
            v.content_retention_days.is_some(),
            &v.session_id,
            &v.request_id,
            None,
            Some(&v.continuation),
            None,
            None,
            false,
        ),
        TtsRequest::LightningV31ProStreamingTextVoiced206187f(v) => (
            "lightning_v3.1_pro",
            v.voice.as_str(),
            v.language.as_ref().map_or("auto", |v| v.value()),
            v.number_pronunciation_language.as_ref().map(|v| v.value()),
            &v.output,
            v.speed,
            &v.formula_reading,
            v.content_retention_days.is_some(),
            &v.session_id,
            &v.request_id,
            None,
            None,
            v.max_buffer_delay_ms,
            v.completion_delay_ms,
            false,
        ),
        TtsRequest::LightningV31ProTextVoice74d06326(v) => (
            "lightning_v3.1_pro",
            v.voice.as_str(),
            v.language.as_ref().map_or("auto", |v| v.value()),
            v.number_pronunciation_language.as_ref().map(|v| v.value()),
            &v.output,
            v.speed,
            &v.formula_reading,
            v.content_retention_days.is_some(),
            &v.session_id,
            &v.request_id,
            v.pronunciation_dictionaries.as_deref(),
            None,
            None,
            None,
            false,
        ),
        TtsRequest::LightningV31ProStreamingTextVoice4f8c2395(v) => (
            "lightning_v3.1_pro",
            v.voice.value(),
            v.language.as_ref().map_or("en", |v| v.value()),
            v.number_pronunciation_language.as_ref().map(|v| v.value()),
            &v.output,
            v.speed,
            &v.formula_reading,
            v.content_retention_days.is_some(),
            &v.session_id,
            &v.request_id,
            None,
            Some(&v.continuation),
            None,
            None,
            true,
        ),
        TtsRequest::LightningV31ProStreamingTextVoice2da2f6d9(v) => (
            "lightning_v3.1_pro",
            v.voice.value(),
            v.language.as_ref().map_or("en", |v| v.value()),
            v.number_pronunciation_language.as_ref().map(|v| v.value()),
            &v.output,
            v.speed,
            &v.formula_reading,
            v.content_retention_days.is_some(),
            &v.session_id,
            &v.request_id,
            None,
            None,
            v.max_buffer_delay_ms,
            v.completion_delay_ms,
            true,
        ),
        TtsRequest::LightningV31ProTextVoice3c7c5185(v) => (
            "lightning_v3.1_pro",
            v.voice.value(),
            v.language.as_ref().map_or("en", |v| v.value()),
            v.number_pronunciation_language.as_ref().map(|v| v.value()),
            &v.output,
            v.speed,
            &v.formula_reading,
            v.content_retention_days.is_some(),
            &v.session_id,
            &v.request_id,
            None,
            None,
            None,
            None,
            true,
        ),
        TtsRequest::LightningV31StreamingTextVoicebf9ab904(v) => (
            "lightning_v3.1",
            v.voice.as_str(),
            v.language.as_ref().map_or("auto", |v| v.value()),
            v.number_pronunciation_language.as_ref().map(|v| v.value()),
            &v.output,
            v.speed,
            &v.formula_reading,
            v.content_retention_days.is_some(),
            &v.session_id,
            &v.request_id,
            None,
            Some(&v.continuation),
            None,
            None,
            false,
        ),
        TtsRequest::LightningV31StreamingTextVoiced272850b(v) => (
            "lightning_v3.1",
            v.voice.as_str(),
            v.language.as_ref().map_or("auto", |v| v.value()),
            v.number_pronunciation_language.as_ref().map(|v| v.value()),
            &v.output,
            v.speed,
            &v.formula_reading,
            v.content_retention_days.is_some(),
            &v.session_id,
            &v.request_id,
            None,
            None,
            v.max_buffer_delay_ms,
            v.completion_delay_ms,
            false,
        ),
        TtsRequest::LightningV31TextVoice5e2ae2e5(v) => (
            "lightning_v3.1",
            v.voice.as_str(),
            v.language.as_ref().map_or("auto", |v| v.value()),
            v.number_pronunciation_language.as_ref().map(|v| v.value()),
            &v.output,
            v.speed,
            &v.formula_reading,
            v.content_retention_days.is_some(),
            &v.session_id,
            &v.request_id,
            v.pronunciation_dictionaries.as_deref(),
            None,
            None,
            None,
            false,
        ),
        TtsRequest::LightningV31StreamingTextVoice90b1878c(v) => (
            "lightning_v3.1",
            v.voice.value(),
            v.language.as_ref().map_or("en", |v| v.value()),
            v.number_pronunciation_language.as_ref().map(|v| v.value()),
            &v.output,
            v.speed,
            &v.formula_reading,
            v.content_retention_days.is_some(),
            &v.session_id,
            &v.request_id,
            None,
            Some(&v.continuation),
            None,
            None,
            true,
        ),
        TtsRequest::LightningV31StreamingTextVoicea9844e06(v) => (
            "lightning_v3.1",
            v.voice.value(),
            v.language.as_ref().map_or("en", |v| v.value()),
            v.number_pronunciation_language.as_ref().map(|v| v.value()),
            &v.output,
            v.speed,
            &v.formula_reading,
            v.content_retention_days.is_some(),
            &v.session_id,
            &v.request_id,
            None,
            None,
            v.max_buffer_delay_ms,
            v.completion_delay_ms,
            true,
        ),
        TtsRequest::LightningV31TextVoice727240a7(v) => (
            "lightning_v3.1",
            v.voice.value(),
            v.language.as_ref().map_or("en", |v| v.value()),
            v.number_pronunciation_language.as_ref().map(|v| v.value()),
            &v.output,
            v.speed,
            &v.formula_reading,
            v.content_retention_days.is_some(),
            &v.session_id,
            &v.request_id,
            None,
            None,
            None,
            None,
            true,
        ),
    };
    let (format, rate) = match output {
        None => ("pcm", 44100.0),
        Some(TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutput::Object1e4e72b8(v)) => (
            v.format.value(),
            v.sample_rate_hz.as_ref().map_or(44100.0, |v| v.value()),
        ),
        Some(TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutput::Object172ee74a(v)) => (
            v.format.value(),
            v.sample_rate_hz.as_ref().map_or(44100.0, |v| v.value()),
        ),
    };
    let format = if format == "mulaw" { "ulaw" } else { format };
    let math = matches!(
        formula,
        Some(TtsRequestLightningV31ProStreamingTextVoice8f1b36fbFormulaReading::PlainText(_))
    );
    let mut wire = String::from("{\"voice_id\":");
    json::quote(voice, &mut wire);
    wire.push_str(",\"model\":");
    json::quote(model, &mut wire);
    wire.push_str(",\"language\":");
    json::quote(language, &mut wire);
    wire.push_str(",\"output_format\":");
    json::quote(format, &mut wire);
    write!(
        wire,
        ",\"sample_rate\":{rate},\"speed\":{},\"math_notation\":{math}",
        speed.unwrap_or(1.0)
    )
    .unwrap();
    if let Some(language) = number_language {
        wire.push_str(",\"number_pronunciation_language\":");
        json::quote(language, &mut wire);
    }
    if let Some(id) = session_id {
        wire.push_str(",\"session_id\":");
        json::quote(id, &mut wire);
    }
    if let Some(dictionaries) = dictionaries {
        wire.push_str(",\"pronunciation_dicts\":[");
        for (i, dictionary) in dictionaries.iter().enumerate() {
            if i != 0 {
                wire.push(',');
            }
            json::quote(&dictionary.id, &mut wire);
        }
        wire.push(']');
    }
    if timed {
        wire.push_str(",\"word_timestamps\":true");
    }
    wire.push('}');
    Settings {
        wire,
        voice: voice.into(),
        request_id: request_id.clone(),
        continuation: continuation.map(|v| v.id.clone()),
        buffer_delay: continuation.map_or(buffer_delay.unwrap_or(0.0), |v| {
            v.max_buffer_delay_ms.unwrap_or(3000.0)
        }),
        completion_delay: completion_delay.unwrap_or(4000.0),
        timed,
        retention,
        dictionaries: dictionaries.is_some(),
    }
}
