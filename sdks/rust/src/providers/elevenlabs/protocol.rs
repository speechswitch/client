use crate::{base64, generated::elevenlabs_output as out, http::TransportError, json::Raw};
use std::fmt;

#[derive(Debug)]
pub struct Error {
    pub status_code: f64,
    pub error_code: Option<String>,
    pub request_id: Option<String>,
    message: String,
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "ElevenLabs {}: {}", self.status_code, self.message)
    }
}
impl std::error::Error for Error {}
pub(super) fn failure(message: &'static str) -> TransportError {
    Box::new(std::io::Error::other(message))
}
pub(super) fn response_error(text: &str, status: f64) -> Error {
    let raw = Raw::parse_exact(text).ok();
    let fields = raw.and_then(|v| v.object().ok()).unwrap_or_default();
    let detail = fields.get("detail");
    let nested = detail.and_then(|v| v.object().ok());
    let effective = nested.as_ref().unwrap_or(&fields);
    let message = effective
        .get("message")
        .and_then(|v| v.string().ok())
        .or_else(|| detail.and_then(|v| v.string().ok()))
        .or_else(|| raw.and_then(|v| v.string().ok()))
        .unwrap_or_else(|| text.into());
    Error {
        status_code: status,
        error_code: effective
            .get("status")
            .and_then(|v| v.string().ok())
            .or_else(|| fields.get("error").and_then(|v| v.string().ok())),
        request_id: None,
        message,
    }
}
pub(super) fn audio(value: &str) -> Result<Vec<u8>, TransportError> {
    base64::decode(value).ok_or_else(|| failure("ElevenLabs returned invalid base64 audio"))
}
pub(super) fn timestamps(
    raw: Option<Raw<'_>>,
    protocol: &str,
) -> Result<Vec<out::CharacterTimestamp>, TransportError> {
    let Some(raw) = raw.filter(|v| !v.is_null()) else {
        return Ok(Vec::new());
    };
    let fields = raw
        .object()
        .map_err(|_| failure("Invalid ElevenLabs alignment"))?;
    let keys = match protocol {
        "http" => [
            "characters",
            "character_start_times_seconds",
            "character_end_times_seconds",
        ],
        "dialogue" => ["chars", "char_start_times_ms", "char_durations_ms"],
        _ => ["chars", "charStartTimesMs", "charDurationsMs"],
    };
    let [Some(chars), Some(starts), Some(durations)] =
        keys.map(|key| fields.get(key).and_then(|v| v.array().ok()))
    else {
        return Err(failure(
            "ElevenLabs returned incomplete or mismatched alignment arrays",
        ));
    };
    if chars.len() != starts.len() || chars.len() != durations.len() {
        return Err(failure(
            "ElevenLabs returned incomplete or mismatched alignment arrays",
        ));
    }
    chars
        .into_iter()
        .zip(starts)
        .zip(durations)
        .map(|((char, start), duration)| {
            let value = char
                .string()
                .map_err(|_| failure("ElevenLabs returned invalid character timing"))?;
            let start = start
                .number()
                .map_err(|_| failure("ElevenLabs returned invalid character timing"))?;
            let duration = duration
                .number()
                .map_err(|_| failure("ElevenLabs returned invalid character timing"))?;
            if !start.is_finite()
                || !duration.is_finite()
                || start < 0.0
                || duration < 0.0
                || (protocol == "http" && duration < start)
            {
                return Err(failure("ElevenLabs returned invalid character timing"));
            }
            let (start_time_ms, end_time_ms) = if protocol == "http" {
                (start * 1000.0, duration * 1000.0)
            } else {
                (start, start + duration)
            };
            if !start_time_ms.is_finite() || !end_time_ms.is_finite() {
                return Err(failure("ElevenLabs returned invalid character timing"));
            }
            Ok(out::CharacterTimestamp {
                kind: Default::default(),
                value,
                start_time_ms,
                end_time_ms,
            })
        })
        .collect()
}
pub(super) fn timestamped(
    text: &str,
    normalized: bool,
) -> Result<out::SynthesisItem, TransportError> {
    let fields = Raw::parse_exact(text)
        .map_err(|_| failure("ElevenLabs returned invalid JSON"))?
        .object()
        .map_err(|_| failure("Invalid ElevenLabs timestamped audio chunk"))?;
    let bytes = fields
        .get("audio_base64")
        .and_then(|v| v.string().ok())
        .ok_or_else(|| failure("Invalid ElevenLabs timestamped audio chunk"))?;
    Ok(out::SynthesisItem::Chunk(out::TimestampedAudio {
        correlation: Default::default(),
        audio: audio(&bytes)?,
        timestamps: timestamps(
            fields
                .get(if normalized {
                    "normalized_alignment"
                } else {
                    "alignment"
                })
                .copied(),
            "http",
        )?,
    }))
}
pub(super) struct Packet<'a> {
    pub context: Option<String>,
    pub audio: Option<String>,
    pub alignment: Option<Raw<'a>>,
    pub final_: bool,
    pub error: Option<Error>,
}
pub(super) fn decode(
    text: &str,
    dialogue: bool,
    normalized: bool,
) -> Result<Packet<'_>, TransportError> {
    let fields = Raw::parse_exact(text)
        .map_err(|_| failure("ElevenLabs returned invalid JSON"))?
        .object()
        .map_err(|_| failure("Invalid ElevenLabs WebSocket frame"))?;
    let mut context = None;
    let mut seen_context = false;
    for key in ["contextId", "context_id"] {
        if let Some(raw) = fields.get(key) {
            let value = if raw.is_null() {
                None
            } else {
                Some(
                    raw.string()
                        .map_err(|_| failure("Invalid ElevenLabs context identifier"))?,
                )
            };
            if seen_context && context != value {
                return Err(failure("Conflicting ElevenLabs context identifiers"));
            }
            context = value;
            seen_context = true;
        }
    }
    if fields.contains_key("error") || fields.contains_key("detail") {
        let code = fields
            .get("code")
            .and_then(|v| v.number().ok())
            .filter(|v| v.is_finite())
            .unwrap_or(0.0);
        return Ok(Packet {
            context,
            audio: None,
            alignment: None,
            final_: false,
            error: Some(response_error(text, code)),
        });
    }
    let mut final_ = None;
    for key in ["isFinal", "is_final"] {
        if let Some(raw) = fields.get(key) {
            let value = raw
                .boolean()
                .map_err(|_| failure("Invalid ElevenLabs final flag"))?;
            if final_.is_some_and(|v| v != value) {
                return Err(failure("Conflicting ElevenLabs final flags"));
            }
            final_ = Some(value);
        }
    }
    let audio = fields
        .get("audio")
        .filter(|v| !v.is_null())
        .map(|v| v.string())
        .transpose()
        .map_err(|_| failure("Invalid ElevenLabs audio payload"))?;
    let turn_final = if dialogue {
        fields
            .get("is_final_audio_for_turn")
            .map(|v| v.boolean())
            .transpose()
            .map_err(|_| failure("Invalid ElevenLabs turn-final flag"))?
            .unwrap_or(false)
    } else {
        false
    };
    let final_ = final_.unwrap_or(false);
    if audio.is_none() && !final_ && !turn_final {
        return Err(failure("Unknown ElevenLabs WebSocket message"));
    }
    if !dialogue && context.is_none() {
        return Err(failure(
            "ElevenLabs multi-context output lacks its context identifier",
        ));
    }
    let alignment = fields
        .get(if !normalized {
            "alignment"
        } else if dialogue {
            "normalized_alignment"
        } else {
            "normalizedAlignment"
        })
        .copied();
    Ok(Packet {
        context,
        audio,
        alignment,
        final_,
        error: None,
    })
}
