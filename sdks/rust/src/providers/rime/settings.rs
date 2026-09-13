use super::failure;
use crate::{generated::rime::*, http::TransportError, json};
use std::fmt::Write;

pub(super) struct Settings {
    pub wire: String,
    pub query: Vec<(&'static str, String)>,
    pub format: &'static str,
    pub timed: bool,
    pub explicit_segmentation: bool,
}
#[derive(Default)]
struct Markup<'a> {
    pauses: bool,
    phonemes: bool,
    speeds: Option<&'a [f64]>,
}
fn markup(value: Option<&TtsRequestMistV2StreamingTextVoice03cc8904TextMarkup>) -> Markup<'_> {
    value.map_or_else(Markup::default, |v| Markup {
        pauses: v.pauses.as_ref().is_some_and(|v| v.value()),
        phonemes: v.phonemes.as_ref().is_some_and(|v| v.value()),
        speeds: v.speeds.as_deref(),
    })
}
fn simple_markup(
    value: Option<&TtsRequestMistV3StreamingTextVoice49f68e83TextMarkup>,
) -> Markup<'_> {
    value.map_or_else(Markup::default, |v| Markup {
        pauses: v.pauses.as_ref().is_some_and(|v| v.value()),
        phonemes: false,
        speeds: v.speeds.as_deref(),
    })
}
fn modern_output(
    value: Option<&TtsRequestCodaStreamingTextVoice84ec2db1Output>,
) -> (&'static str, f64) {
    match value {
        None => ("pcm", 24000.0),
        Some(TtsRequestCodaStreamingTextVoice84ec2db1Output::Object60a95a19(v)) => {
            (v.format.value(), v.sample_rate_hz.unwrap_or(24000.0))
        }
        Some(TtsRequestCodaStreamingTextVoice84ec2db1Output::Objectb2df2f24(v)) => {
            (v.format.value(), v.sample_rate_hz.unwrap_or(24000.0))
        }
    }
}
fn legacy_output(
    value: Option<&TtsRequestMistV2StreamingTextVoice03cc8904Output>,
) -> (&'static str, f64) {
    match value {
        None => ("pcm", 16000.0),
        Some(TtsRequestMistV2StreamingTextVoice03cc8904Output::Pcm(v)) => {
            ("pcm", v.sample_rate_hz.unwrap_or(16000.0))
        }
        Some(TtsRequestMistV2StreamingTextVoice03cc8904Output::Mp3(v)) => {
            ("mp3", v.sample_rate_hz.unwrap_or(22050.0))
        }
        Some(TtsRequestMistV2StreamingTextVoice03cc8904Output::Mulaw(v)) => {
            ("mulaw", v.sample_rate_hz.unwrap_or(8000.0))
        }
    }
}

// Conversion only: the generated validator owns provider/model bounds and unions.
pub(super) fn prepare(request: &TtsRequest) -> Result<Settings, TransportError> {
    let (voice, model, language, output, speed, segmentation, timed, markup, normalization) =
        match request {
            TtsRequest::CodaStreamingTextVoice84ec2db1(
                TtsRequestCodaStreamingTextVoice84ec2db1 {
                    voice,
                    language,
                    output,
                    speed,
                    segmentation,
                    ..
                },
            )
            | TtsRequest::CodaTextVoice50d85478(TtsRequestCodaTextVoice50d85478 {
                voice,
                language,
                output,
                speed,
                segmentation,
                ..
            }) => (
                voice,
                "coda",
                language.value(),
                modern_output(output.as_ref()),
                speed,
                segmentation,
                false,
                Markup::default(),
                true,
            ),
            TtsRequest::CodaStreamingTextVoice33f4bd25(
                TtsRequestCodaStreamingTextVoice33f4bd25 {
                    voice,
                    language,
                    output,
                    speed,
                    segmentation,
                    timestamp_granularity,
                    ..
                },
            )
            | TtsRequest::CodaTextVoicef75e9756(TtsRequestCodaTextVoicef75e9756 {
                voice,
                language,
                output,
                speed,
                segmentation,
                timestamp_granularity,
                ..
            }) => (
                voice,
                "coda",
                language.as_ref().map_or("en", |v| v.value()),
                modern_output(output.as_ref()),
                speed,
                segmentation,
                timestamp_granularity.is_some(),
                Markup::default(),
                true,
            ),
            TtsRequest::MistV2StreamingTextVoice03cc8904(
                TtsRequestMistV2StreamingTextVoice03cc8904 {
                    voice,
                    language,
                    output,
                    speed,
                    segmentation,
                    text_markup,
                    text_normalization,
                    ..
                },
            )
            | TtsRequest::MistV2TextVoice20785ce4(TtsRequestMistV2TextVoice20785ce4 {
                voice,
                language,
                output,
                speed,
                segmentation,
                text_markup,
                text_normalization,
                ..
            }) => (
                voice,
                "mistv2",
                language.value(),
                legacy_output(output.as_ref()),
                speed,
                segmentation,
                false,
                markup(text_markup.as_ref()),
                text_normalization.as_ref().is_none_or(|v| v.value()),
            ),
            TtsRequest::MistV2StreamingTextVoicec0dcaaf1(
                TtsRequestMistV2StreamingTextVoicec0dcaaf1 {
                    voice,
                    language,
                    output,
                    speed,
                    segmentation,
                    text_markup,
                    text_normalization,
                    timestamp_granularity,
                    ..
                },
            )
            | TtsRequest::MistV2TextVoiceae274411(TtsRequestMistV2TextVoiceae274411 {
                voice,
                language,
                output,
                speed,
                segmentation,
                text_markup,
                text_normalization,
                timestamp_granularity,
                ..
            }) => (
                voice,
                "mistv2",
                language.as_ref().map_or("en", |v| v.value()),
                legacy_output(output.as_ref()),
                speed,
                segmentation,
                timestamp_granularity.is_some(),
                markup(text_markup.as_ref()),
                text_normalization.as_ref().is_none_or(|v| v.value()),
            ),
            TtsRequest::MistV3StreamingTextVoice88a01d24(
                TtsRequestMistV3StreamingTextVoice88a01d24 {
                    voice,
                    output,
                    speed,
                    segmentation,
                    text_markup,
                    timestamp_granularity,
                    ..
                },
            )
            | TtsRequest::MistV3TextVoice2a5bc5c5(TtsRequestMistV3TextVoice2a5bc5c5 {
                voice,
                output,
                speed,
                segmentation,
                text_markup,
                timestamp_granularity,
                ..
            }) => (
                voice,
                "mistv3",
                "en",
                modern_output(output.as_ref()),
                speed,
                segmentation,
                timestamp_granularity.is_some(),
                markup(text_markup.as_ref()),
                true,
            ),
            TtsRequest::MistV3StreamingTextVoice49f68e83(
                TtsRequestMistV3StreamingTextVoice49f68e83 {
                    voice,
                    language,
                    output,
                    speed,
                    segmentation,
                    text_markup,
                    ..
                },
            )
            | TtsRequest::MistV3TextVoice7d020de1(TtsRequestMistV3TextVoice7d020de1 {
                voice,
                language,
                output,
                speed,
                segmentation,
                text_markup,
                ..
            }) => (
                voice,
                "mistv3",
                language.value(),
                modern_output(output.as_ref()),
                speed,
                segmentation,
                false,
                simple_markup(text_markup.as_ref()),
                true,
            ),
            TtsRequest::MistV3StreamingTextVoice3acf8862(
                TtsRequestMistV3StreamingTextVoice3acf8862 {
                    voice,
                    output,
                    speed,
                    segmentation,
                    text_markup,
                    timestamp_granularity,
                    ..
                },
            )
            | TtsRequest::MistV3TextVoice3fb6eaa2(TtsRequestMistV3TextVoice3fb6eaa2 {
                voice,
                output,
                speed,
                segmentation,
                text_markup,
                timestamp_granularity,
                ..
            }) => (
                voice,
                "mistv3",
                "es",
                modern_output(output.as_ref()),
                speed,
                segmentation,
                timestamp_granularity.is_some(),
                simple_markup(text_markup.as_ref()),
                true,
            ),
        };
    let (format, rate) = output;
    let scale = 1.0 / speed.unwrap_or(1.0);
    if !scale.is_finite() {
        return Err(failure(
            "Rime speed cannot be represented as a finite time scale",
        ));
    }
    let wire_language = if model == "mistv2" {
        match language {
            "en" => "eng",
            "es" => "spa",
            "fr" => "fra",
            "de" => "ger",
            _ => unreachable!("validated legacy language"),
        }
    } else {
        language
    };
    let mut wire = String::from("{\"speaker\":");
    json::quote(voice, &mut wire);
    wire.push_str(",\"modelId\":");
    json::quote(model, &mut wire);
    wire.push_str(",\"lang\":");
    json::quote(wire_language, &mut wire);
    write!(wire, ",\"samplingRate\":{rate}").unwrap();
    let mut query = vec![
        ("speaker", voice.clone()),
        ("modelId", model.into()),
        ("lang", wire_language.into()),
        ("samplingRate", rate.to_string()),
    ];
    if model == "mistv2" {
        write!(
            wire,
            ",\"speedAlpha\":{scale},\"noTextNormalization\":{}",
            !normalization
        )
        .unwrap();
        query.push(("speedAlpha", scale.to_string()));
        query.push(("noTextNormalization", (!normalization).to_string()));
    } else {
        write!(wire, ",\"timeScaleFactor\":{scale}").unwrap();
        query.push(("timeScaleFactor", scale.to_string()));
    }
    if model != "coda" {
        write!(wire, ",\"pauseBetweenBrackets\":{}", markup.pauses).unwrap();
        query.push(("pauseBetweenBrackets", markup.pauses.to_string()));
    }
    if model == "mistv2" || model == "mistv3" && language == "en" {
        write!(wire, ",\"phonemizeBetweenBrackets\":{}", markup.phonemes).unwrap();
        query.push(("phonemizeBetweenBrackets", markup.phonemes.to_string()));
    }
    if let Some(speeds) = markup.speeds {
        let mut inline = String::new();
        for (i, speed) in speeds.iter().enumerate() {
            // Numeric item annotations cannot express a strictly positive finite reciprocal.
            let scale = 1.0 / speed;
            if *speed <= 0.0 || !scale.is_finite() {
                return Err(failure(
                    "Rime inline speeds must have a positive finite reciprocal",
                ));
            }
            if i != 0 {
                inline.push(',');
            }
            write!(inline, "{scale}").unwrap();
        }
        wire.push_str(",\"inlineSpeedAlpha\":");
        json::quote(&inline, &mut wire);
        query.push(("inlineSpeedAlpha", inline));
    }
    wire.push('}');
    query.push((
        "audioFormat",
        match format {
            "ogg_opus" => "ogg",
            "webm_opus" => "webm",
            v => v,
        }
        .into(),
    ));
    query.push((
        "segment",
        match segmentation.as_ref().map(|v| v.value()) {
            Some("manual") => "never",
            Some("immediate") => "immediate",
            _ => "bySentence",
        }
        .into(),
    ));
    Ok(Settings {
        wire,
        query,
        format,
        timed,
        explicit_segmentation: segmentation.is_some(),
    })
}
