use super::TtsRequest;
use crate::json;

pub(super) struct Input<'a> {
    pub host: &'static str,
    pub api: &'static str,
    pub reference: Option<&'a [u8]>,
    pub needs_reference: bool,
    pub prefix: String,
    pub suffix: String,
}

// Conversion after generated validation; keep omission distinct from zero/false.
pub(super) fn settings(request: &TtsRequest) -> Input<'_> {
    let (host, api, reference, text, suffix, needs_reference) = match request {
        TtsRequest::Text(r) => (
            "https://resembleai-chatterbox.hf.space",
            "generate_tts_audio",
            r.reference_audio.as_deref(),
            &r.text,
            format!(
                ",{},{},{},{},{}]}}",
                r.style_exaggeration.unwrap_or(0.5),
                r.temperature.unwrap_or(0.8),
                r.random_seed.unwrap_or(0.0),
                r.voice_guidance.unwrap_or(0.5),
                r.reference_audio_trimming
                    .as_ref()
                    .map_or(false, |v| v.value())
            ),
            false,
        ),
        TtsRequest::ChatterboxMultilingualText(r) => {
            let mut language = String::new();
            json::quote(
                r.language.as_ref().map_or("en", |v| v.value()),
                &mut language,
            );
            (
                "https://resembleai-chatterbox-multilingual-tts-v3.hf.space",
                "generate_tts_audio",
                r.reference_audio.as_deref(),
                &r.text,
                format!(
                    ",{language},{},{},{},{}]}}",
                    r.style_exaggeration.unwrap_or(0.5),
                    r.temperature.unwrap_or(0.8),
                    r.random_seed.unwrap_or(0.0),
                    r.voice_guidance.unwrap_or(0.5)
                ),
                false,
            )
        }
        TtsRequest::ChatterboxTurboText(r) => (
            "https://resembleai-chatterbox-turbo-demo.hf.space",
            "generate",
            r.reference_audio.as_deref(),
            &r.text,
            format!(
                ",{},{},{},{},{},{},{}]}}",
                r.temperature.unwrap_or(0.8),
                r.random_seed.unwrap_or(0.0),
                r.min_p.unwrap_or(0.0),
                r.top_p.unwrap_or(0.95),
                r.top_k.unwrap_or(1000.0),
                r.repetition_penalty.unwrap_or(1.2),
                r.loudness_normalization
                    .as_ref()
                    .map_or(true, |v| v.value())
            ),
            true,
        ),
    };
    let mut prefix = String::from("{\"data\":[");
    json::quote(text, &mut prefix);
    prefix.push(',');
    Input {
        host,
        api,
        reference,
        needs_reference,
        prefix,
        suffix,
    }
}
