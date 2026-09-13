use super::{failure, Error};
use crate::{
    base64, generated::xai_output::*, http::TransportError, json::Raw, websocket::Message,
};
use std::collections::BTreeMap;

pub(super) fn milliseconds(raw: Raw<'_>, message: &str) -> Result<f64, TransportError> {
    let value = raw.number().map_err(|_| failure(message))? * 1000.0;
    if !value.is_finite() || value < 0.0 {
        return Err(failure(message));
    }
    Ok(value)
}
pub(super) fn audio(
    fields: &BTreeMap<String, Raw<'_>>,
    key: &str,
    duration: &str,
) -> Result<TimestampedAudio, TransportError> {
    let encoded = fields
        .get(key)
        .and_then(|v| v.string().ok())
        .ok_or_else(|| failure("Invalid xAI base64 audio"))?;
    let audio = base64::decode(&encoded)
        .filter(|v| base64::encode(v) == encoded)
        .ok_or_else(|| failure("Invalid xAI base64 audio"))?;
    let mut timestamps = vec![];
    if let Some(raw) = fields.get("audio_timestamps") {
        let fields = raw
            .object()
            .map_err(|_| failure("Invalid xAI character timestamps"))?;
        let chars = fields
            .get("graph_chars")
            .and_then(|v| v.array().ok())
            .ok_or_else(|| failure("xAI returned incomplete or mismatched character timestamps"))?;
        let times = fields
            .get("graph_times")
            .and_then(|v| v.array().ok())
            .ok_or_else(|| failure("xAI returned incomplete or mismatched character timestamps"))?;
        if chars.len() != times.len() {
            return Err(failure(
                "xAI returned incomplete or mismatched character timestamps",
            ));
        }
        for (char, times) in chars.into_iter().zip(times) {
            let value = char
                .string()
                .map_err(|_| failure("Invalid xAI character timestamp interval"))?;
            let times = times
                .array()
                .map_err(|_| failure("Invalid xAI character timestamp interval"))?;
            let [start, end] = times.as_slice() else {
                return Err(failure("Invalid xAI character timestamp interval"));
            };
            let start_time_ms = milliseconds(*start, "Invalid xAI character timestamp interval")?;
            let end_time_ms = milliseconds(*end, "Invalid xAI character timestamp interval")?;
            if end_time_ms < start_time_ms {
                return Err(failure("Invalid xAI character timestamp interval"));
            }
            timestamps.push(CharacterTimestamp {
                kind: Default::default(),
                value,
                start_time_ms,
                end_time_ms,
            });
        }
    }
    let duration_ms = fields
        .get(duration)
        .map(|v| milliseconds(*v, "Invalid xAI audio duration"))
        .transpose()?;
    Ok(TimestampedAudio {
        correlation: Default::default(),
        audio,
        timestamps,
        duration_ms,
    })
}
pub(super) fn decode(message: Message, limit: usize) -> Result<SynthesisItem, TransportError> {
    let Message::Text(text) = message else {
        return Err(failure("xAI returned a non-text WebSocket message"));
    };
    if text.len() > limit {
        return Err(failure("xAI message exceeds max_message_bytes"));
    }
    let raw = Raw::parse_exact(&text).map_err(|_| failure("Invalid xAI JSON"))?;
    let fields = raw
        .object()
        .map_err(|_| failure("xAI returned an invalid WebSocket event"))?;
    let kind = fields
        .get("type")
        .and_then(|v| v.string().ok())
        .unwrap_or_default();
    match kind.as_str() {
        "audio.delta" => Ok(SynthesisItem::Chunk(audio(
            &fields,
            "delta",
            "audio_duration",
        )?)),
        "audio.done" => Ok(SynthesisItem::Done(DoneEvent {
            event: Default::default(),
            trace_id: fields
                .get("trace_id")
                .map(|v| v.string())
                .transpose()
                .map_err(|_| failure("Invalid xAI trace identifier"))?,
        })),
        "audio.clear" => Ok(SynthesisItem::Clear(ClearEvent {
            event: Default::default(),
        })),
        "session.updated" => {
            let map = fields
                .get("replace")
                .and_then(|v| v.object_entries().ok())
                .ok_or_else(|| failure("xAI session.updated event has no valid replacement map"))?;
            let mut replacements = Vec::new();
            for (pattern, value) in map {
                replacements.push(UpdatedEventReplacementsItem {
                    pattern,
                    replacement: value.string().map_err(|_| {
                        failure("xAI session.updated event has no valid replacement map")
                    })?,
                });
            }
            Ok(SynthesisItem::Updated(UpdatedEvent {
                event: Default::default(),
                replacements,
            }))
        }
        "error" => {
            fields
                .get("message")
                .and_then(|v| v.string().ok())
                .ok_or_else(|| failure("xAI error event has no message"))?;
            Err(Box::new(Error { status: None }))
        }
        _ => Err(failure("xAI returned an unknown WebSocket event")),
    }
}
