use super::failure;
use crate::{base64, generated::deepdub::*, http::TransportError, json};

pub(super) struct Configuration {
    model: &'static str,
    text: String,
    language: String,
    format: &'static str,
    sample_rate_hz: f64,
    voice: Option<String>,
    reference: Option<Vec<u8>>,
    delivery: Option<String>,
    speed: Option<f64>,
    duration: Option<f64>,
    seed: Option<f64>,
    variance: Option<f64>,
    temperature: Option<f64>,
    boost: Option<TtsRequestOg11Text188d3251AudioEnhancement>,
    stretch: Option<TtsRequestOg11Text188d3251AudioEnhancement>,
    enhancement: bool,
    gain: bool,
    priority: Option<TtsRequestOg11Text188d3251ProcessingPriority>,
    gender: Option<TtsRequestOg11Text188d3251SpeakerGender>,
    accent: Option<TtsRequestOg11Text188d3251AccentBlend>,
}

pub(super) fn prepare(request: TtsRequest) -> Result<Configuration, TransportError> {
    // Extract shared fields without erasing the exhaustive generated variants.
    macro_rules! configuration {
        ($v:ident, $model:expr, $voice:expr, $reference:expr, $speed:expr, $duration:expr, $seed:expr) => {{
            let format = match $v.output.format {
                TtsRequestOg11Text188d3251OutputFormat::Mp3(_) => "mp3",
                TtsRequestOg11Text188d3251OutputFormat::Mulaw(_) => "mulaw",
                TtsRequestOg11Text188d3251OutputFormat::OggOpus(_) => "opus",
            };
            let sample_rate_hz = $v
                .output
                .sample_rate_hz
                .map_or(if format == "mulaw" { 8000.0 } else { 48000.0 }, |v| {
                    v.value()
                });
            Configuration {
                model: $model,
                voice: $voice,
                reference: $reference,
                speed: $speed,
                duration: $duration,
                seed: $seed,
                text: $v.text,
                language: $v.language,
                format,
                sample_rate_hz,
                delivery: $v.delivery_reference,
                variance: $v.delivery_variance,
                temperature: $v.temperature,
                boost: $v.voice_boost,
                stretch: $v.duration_stretching,
                enhancement: $v.audio_enhancement.is_some_and(|v| v.value()),
                gain: $v.automatic_gain_control.is_none_or(|v| v.value()),
                priority: $v.processing_priority,
                gender: $v.speaker_gender,
                accent: $v.accent_blend,
            }
        }};
    }
    let value = match request {
        TtsRequest::Og11Text188d3251(v) => configuration!(
            v,
            "dd-etts-1.1",
            v.voice,
            Some(v.reference_audio),
            None,
            Some(v.target_duration_ms),
            Some(v.random_seed)
        ),
        TtsRequest::Og11Text63cdfcb0(v) => configuration!(
            v,
            "dd-etts-1.1",
            v.voice,
            Some(v.reference_audio),
            v.speed,
            None,
            Some(v.random_seed)
        ),
        TtsRequest::Og11TextVoiceafafd490(v) => configuration!(
            v,
            "dd-etts-1.1",
            Some(v.voice),
            v.reference_audio,
            None,
            Some(v.target_duration_ms),
            Some(v.random_seed)
        ),
        TtsRequest::Og11TextVoice7f540c02(v) => configuration!(
            v,
            "dd-etts-1.1",
            Some(v.voice),
            v.reference_audio,
            v.speed,
            None,
            Some(v.random_seed)
        ),
        TtsRequest::Textee721c85(v) => configuration!(
            v,
            model(v.model),
            v.voice,
            Some(v.reference_audio),
            None,
            Some(v.target_duration_ms),
            None
        ),
        TtsRequest::Text8086f935(v) => configuration!(
            v,
            model(v.model),
            v.voice,
            Some(v.reference_audio),
            v.speed,
            None,
            None
        ),
        TtsRequest::TextVoice5ce3f477(v) => configuration!(
            v,
            model(v.model),
            Some(v.voice),
            v.reference_audio,
            None,
            Some(v.target_duration_ms),
            None
        ),
        TtsRequest::TextVoiceb776b412(v) => configuration!(
            v,
            model(v.model),
            Some(v.voice),
            v.reference_audio,
            v.speed,
            None,
            None
        ),
    };
    // Byte-length constraints are not represented by the schema annotations.
    if value.reference.as_ref().is_some_and(Vec::is_empty) {
        return Err(failure("Deepdub reference_audio must not be empty"));
    }
    Ok(value)
}

fn model(value: TtsRequestTextee721c85Model) -> &'static str {
    match value {
        TtsRequestTextee721c85Model::Og11(_) => "dd-etts-1.1",
        TtsRequestTextee721c85Model::Lightning25(_) => "dd-etts-2.5",
        TtsRequestTextee721c85Model::PhantomX32(_) => "dd-etts-3.2",
    }
}

impl Configuration {
    pub(super) fn encode(self, id: &str) -> (String, bool) {
        let format = self.format;
        let rate = self.sample_rate_hz;
        let mut wire = String::from("{\"generationId\":");
        json::quote(id, &mut wire);
        for (name, value) in [
            ("model", Some(self.model.into())),
            ("targetText", Some(self.text)),
            ("locale", Some(self.language)),
            ("voicePromptId", self.voice),
            ("voiceReference", self.reference.map(|v| base64::encode(&v))),
            ("performanceReferencePromptId", self.delivery),
            ("targetGender", self.gender.map(|v| v.value().into())),
        ] {
            if let Some(value) = value {
                wire.push_str(&format!(",\"{name}\":"));
                json::quote(&value, &mut wire);
            }
        }
        wire.push_str(&format!(",\"format\":\"{format}\",\"sampleRate\":{rate}"));
        for (name, value) in [
            ("tempo", self.speed),
            ("targetDuration", self.duration.map(|v| v / 1000.0)),
            ("seed", self.seed),
            ("variance", self.variance),
            ("temperature", self.temperature),
        ] {
            if let Some(value) = value {
                wire.push_str(&format!(",\"{name}\":{value}"));
            }
        }
        for (name, value) in [
            ("cleanAudio", Some(self.enhancement)),
            ("autoGain", Some(self.gain)),
            ("promptBoost", self.boost.map(|v| v.value())),
            ("superStretch", self.stretch.map(|v| v.value())),
            ("realtime", self.priority.map(|v| v.value() == "realtime")),
        ] {
            if let Some(value) = value {
                wire.push_str(&format!(",\"{name}\":{value}"));
            }
        }
        if let Some(accent) = self.accent {
            wire.push_str(",\"accentControl\":{\"accentBaseLocale\":");
            json::quote(&accent.base_locale, &mut wire);
            wire.push_str(",\"accentLocale\":");
            json::quote(&accent.target_locale, &mut wire);
            wire.push_str(&format!(",\"accentRatio\":{}}}", accent.ratio));
        }
        wire.push('}');
        (wire, format == "opus")
    }
}
