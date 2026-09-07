use crate::{generated::respeecher::*, json};

pub(super) struct Settings {
    pub wire: String,
    pub wave: bool,
    pub language: &'static str,
}
pub(super) fn prepare(request: &TtsRequest) -> Settings {
    let (voice, language, sampling, rate, encoding, wave) = match request {
        TtsRequest::Object(v) => {
            let (rate, encoding) = match &v.output {
                None => (22050.0, "pcm_f32le"),
                Some(TtsRequestObjectOutput::Mulaw(o)) => {
                    (o.sample_rate_hz.unwrap_or(22050.0), "pcm_mulaw")
                }
                Some(TtsRequestObjectOutput::Pcm(o)) => (
                    o.sample_rate_hz.unwrap_or(22050.0),
                    if matches!(
                        o.sample_encoding,
                        Some(TtsRequestObjectOutputPcmSampleEncoding::SignedInteger16(_))
                    ) {
                        "pcm_s16le"
                    } else {
                        "pcm_f32le"
                    },
                ),
            };
            (
                &v.voice,
                v.language.as_ref(),
                [
                    v.random_seed,
                    v.temperature,
                    v.top_k,
                    v.top_p,
                    v.min_p,
                    v.presence_penalty,
                    v.frequency_penalty,
                    v.repetition_penalty,
                ],
                rate,
                encoding,
                false,
            )
        }
        TtsRequest::TextVoice(v) => (
            &v.voice,
            v.language.as_ref(),
            [
                v.random_seed,
                v.temperature,
                v.top_k,
                v.top_p,
                v.min_p,
                v.presence_penalty,
                v.frequency_penalty,
                v.repetition_penalty,
            ],
            v.output.sample_rate_hz.unwrap_or(22050.0),
            "",
            true,
        ),
    };
    let mut wire = String::from("{\"voice\":{\"id\":");
    json::quote(voice, &mut wire);
    wire.push_str(",\"sampling_params\":{");
    let mut first = true;
    for (name, value) in [
        "seed",
        "temperature",
        "top_k",
        "top_p",
        "min_p",
        "presence_penalty",
        "frequency_penalty",
        "repetition_penalty",
    ]
    .into_iter()
    .zip(sampling)
    {
        if let Some(value) = value {
            if !first {
                wire.push(',')
            };
            first = false;
            json::quote(name, &mut wire);
            wire.push(':');
            wire.push_str(
                &(if name == "top_k" && value == 0.0 {
                    -1.0
                } else {
                    value
                })
                .to_string(),
            );
        }
    }
    wire.push_str("}},\"output_format\":{\"sample_rate\":");
    wire.push_str(&rate.to_string());
    if !wave {
        wire.push_str(",\"encoding\":");
        json::quote(encoding, &mut wire)
    };
    wire.push_str("}}");
    Settings {
        wire,
        wave,
        language: if matches!(language, Some(TtsRequestObjectLanguage::Uk(_))) {
            "ua"
        } else {
            "en"
        },
    }
}
