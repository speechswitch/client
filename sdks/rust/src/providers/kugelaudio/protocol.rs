use crate::{base64, generated::kugelaudio_output::*, http::TransportError, json::Raw};
use std::collections::BTreeMap;

#[derive(Debug, PartialEq, Eq)]
pub struct Error {
    pub message: String,
    pub status: Option<u64>,
    pub code: Option<String>,
    pub retry_after: Option<String>,
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}
impl std::error::Error for Error {}
pub(super) fn failure(message: &str) -> TransportError {
    Box::new(std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        message,
    ))
}
pub(super) type Fields<'a> = BTreeMap<String, Raw<'a>>;
pub(super) fn decode(data: &str) -> Result<Fields<'_>, TransportError> {
    Raw::parse_exact(data)
        .map_err(|_| failure("KugelAudio returned invalid JSON"))?
        .object()
        .map_err(|_| failure("KugelAudio returned an invalid object"))
}
pub(super) fn number(
    fields: &Fields<'_>,
    name: &str,
    integer: bool,
) -> Result<f64, TransportError> {
    fields
        .get(name)
        .and_then(|v| v.number().ok())
        .filter(|v| {
            v.is_finite()
                && *v >= 0.0
                && (!integer || (v.fract() == 0.0 && *v <= 9007199254740991.0))
        })
        .ok_or_else(|| failure(&format!("KugelAudio returned invalid {name}")))
}
pub(super) fn usage(fields: &Fields<'_>) -> Result<Option<KugelAudioUsage>, TransportError> {
    let Some(raw) = fields.get("usage") else {
        return Ok(None);
    };
    let fields = raw
        .object()
        .map_err(|_| failure("KugelAudio returned an invalid object"))?;
    let cost = fields
        .get("cost_cents")
        .ok_or_else(|| failure("KugelAudio omitted its cost-unavailable indicator"))?;
    let cost_cents = if cost.is_null() {
        if fields
            .get("cost_unavailable")
            .and_then(|v| v.boolean().ok())
            != Some(true)
        {
            return Err(failure("KugelAudio omitted its cost-unavailable indicator"));
        }
        KugelAudioUsageCostCents::Null(KugelAudioUsageCostCentsNull)
    } else {
        KugelAudioUsageCostCents::Number(number(&fields, "cost_cents", false)?)
    };
    let currency = fields
        .get("currency")
        .map(|v| {
            if v.string().ok().as_deref() != Some("eur") {
                return Err(failure("KugelAudio returned an invalid usage currency"));
            }
            Ok(KugelAudioUsageCurrency)
        })
        .transpose()?;
    let model = fields
        .get("model_id")
        .map(|v| {
            v.string()
                .map_err(|_| failure("KugelAudio returned an invalid usage model"))
        })
        .transpose()?;
    Ok(Some(KugelAudioUsage {
        audio_seconds: number(&fields, "audio_seconds", false)?,
        characters: number(&fields, "characters", true)?,
        cost_cents,
        currency,
        model,
    }))
}
pub(super) fn updated(raw: Option<&Raw<'_>>) -> Result<SynthesisItem, TransportError> {
    let f = raw
        .and_then(|v| v.object().ok())
        .ok_or_else(|| failure("KugelAudio returned an invalid object"))?;
    let numeric = |key, integer| f.get(key).map(|_| number(&f, key, integer)).transpose();
    let language = f
        .get("language")
        .map(|v| {
            v.string()
                .map_err(|_| failure("KugelAudio returned invalid settings language"))
        })
        .transpose()?;
    let text_normalization = f
        .get("normalize")
        .map(|v| -> Result<_, TransportError> {
            Ok(
                if v.boolean()
                    .map_err(|_| failure("KugelAudio returned invalid settings normalize"))?
                {
                    SynthesisItemUpdatedTextNormalization::True(
                        SynthesisItemUpdatedTextNormalizationTrue,
                    )
                } else {
                    SynthesisItemUpdatedTextNormalization::False(
                        SynthesisItemUpdatedTextNormalizationFalse,
                    )
                },
            )
        })
        .transpose()?;
    Ok(SynthesisItem::Updated(SynthesisItemUpdated {
        event: SynthesisItemUpdatedEvent,
        language,
        text_normalization,
        replacements: None,
        voice_guidance: numeric("cfg_scale", false)?,
        temperature: numeric("temperature", false)?,
        max_audio_tokens: numeric("max_new_tokens", true)?,
        speed: numeric("speed", false)?,
    }))
}
pub(super) fn alignment(raw: Raw<'_>) -> Result<Vec<KugelAudioTimestamp>, TransportError> {
    let words = raw
        .array()
        .map_err(|_| failure("KugelAudio returned invalid word timestamps"))?;
    words
        .into_iter()
        .map(|word| {
            let f = word
                .object()
                .map_err(|_| failure("KugelAudio returned an invalid object"))?;
            let value = f
                .get("word")
                .and_then(|v| v.string().ok())
                .ok_or_else(|| failure("KugelAudio returned an invalid word"))?;
            let start = number(&f, "start_ms", false)?;
            let end = number(&f, "end_ms", false)?;
            let first = number(&f, "char_start", true)?;
            let last = number(&f, "char_end", true)?;
            if end < start || last < first {
                return Err(failure("KugelAudio returned reversed alignment bounds"));
            }
            let confidence = f
                .get("score")
                .map(|_| number(&f, "score", false))
                .transpose()?;
            Ok(KugelAudioTimestamp {
                kind: KugelAudioTimestampKind,
                value,
                start_time_ms: start,
                end_time_ms: Some(end),
                source: Some(KugelAudioTimestampSource {
                    start: first,
                    end: last,
                }),
                confidence,
            })
        })
        .collect()
}
pub(super) fn audio(
    fields: &Fields<'_>,
    encoding: &str,
    rate: f64,
) -> Result<(Vec<u8>, u64), TransportError> {
    let encoded = fields
        .get("audio")
        .and_then(|v| v.string().ok())
        .ok_or_else(|| failure("KugelAudio returned an unexpected audio format"))?;
    if fields.get("enc").and_then(|v| v.string().ok()).as_deref() != Some(encoding)
        || fields.get("sr").and_then(|v| v.number().ok()) != Some(rate)
    {
        return Err(failure("KugelAudio returned an unexpected audio format"));
    }
    number(fields, "idx", true)?;
    let count = number(fields, "samples", true)? as u64;
    let audio = base64::decode(&encoded)
        .ok_or_else(|| failure("KugelAudio returned invalid base64 audio"))?;
    if audio.len() as u64 != count * if encoding == "pcm_s16le" { 2 } else { 1 } {
        return Err(failure(
            "KugelAudio audio size disagrees with its sample count",
        ));
    }
    Ok((audio, count))
}
