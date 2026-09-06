use crate::{
    base64,
    generated::fish_output::*,
    http::TransportError,
    json::Raw,
    msgpack::{self, Value},
    websocket::Message,
};

#[derive(Debug, PartialEq, Eq)]
pub struct Error {
    pub status: u16,
    pub message: String,
    pub reason: Option<String>,
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Fish {}: {}", self.status, self.message)
    }
}
impl std::error::Error for Error {}
pub(super) fn failure(message: &str) -> TransportError {
    Box::new(std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        message,
    ))
}

pub(super) fn alignment(data: &str) -> Result<SynthesisItem, TransportError> {
    let value = Raw::parse_exact(data)
        .and_then(Raw::object)
        .map_err(|_| failure("Fish returned invalid timestamp JSON"))?;
    let event_error = || failure("Fish returned an invalid timestamp event");
    let audio = value
        .get("audio_base64")
        .and_then(|v| v.string().ok())
        .ok_or_else(event_error)?;
    value
        .get("content")
        .and_then(|v| v.string().ok())
        .ok_or_else(event_error)?;
    let seq = value
        .get("chunk_seq")
        .and_then(|v| v.number().ok())
        .ok_or_else(event_error)?;
    let offset = value
        .get("chunk_audio_offset_sec")
        .and_then(|v| v.number().ok())
        .ok_or_else(event_error)?;
    if !seq.is_finite()
        || !(0.0..=9007199254740991.0).contains(&seq)
        || seq.fract() != 0.0
        || offset < 0.0
        || !(offset * 1000.0).is_finite()
    {
        return Err(event_error());
    }
    let mut result = TimelineOutput {
        audio: base64::decode(&audio)
            .ok_or_else(|| failure("Fish returned invalid base64 audio"))?,
        correlation: TimelineOutputCorrelation,
        correlation_id: (seq as u64).to_string(),
        timeline_offset_ms: offset * 1000.0,
        timestamps: Vec::new(),
        timestamp_update: None,
        duration_ms: None,
    };
    let snapshot_error = || failure("Fish returned an invalid alignment snapshot");
    let snapshot = value.get("alignment").ok_or_else(snapshot_error)?;
    if snapshot.is_null() {
        return Ok(SynthesisItem::Timeline(result));
    }
    let fields = snapshot.object().map_err(|_| snapshot_error())?;
    let segments = fields
        .get("segments")
        .and_then(|v| v.array().ok())
        .ok_or_else(snapshot_error)?;
    let duration = fields
        .get("audio_duration")
        .and_then(|v| v.number().ok())
        .ok_or_else(snapshot_error)?;
    if duration < 0.0 || !(duration * 1000.0).is_finite() {
        return Err(snapshot_error());
    }
    let segment_error = || failure("Fish returned an invalid timing segment");
    for raw in segments {
        let segment = raw.object().map_err(|_| segment_error())?;
        let text = segment
            .get("text")
            .and_then(|v| v.string().ok())
            .ok_or_else(segment_error)?;
        let start = segment
            .get("start")
            .and_then(|v| v.number().ok())
            .ok_or_else(segment_error)?;
        let end = segment
            .get("end")
            .and_then(|v| v.number().ok())
            .ok_or_else(segment_error)?;
        if start < 0.0
            || end < start
            || !(start * 1000.0).is_finite()
            || !(end * 1000.0).is_finite()
        {
            return Err(segment_error());
        }
        result.timestamps.push(SegmentTimestamp {
            kind: SegmentTimestampKind,
            value: text,
            start_time_ms: start * 1000.0,
            end_time_ms: end * 1000.0,
        });
    }
    result.timestamp_update = Some(TimelineOutputTimestampUpdate);
    result.duration_ms = Some(duration * 1000.0);
    Ok(SynthesisItem::Timeline(result))
}

pub(super) enum Packet {
    Audio(Vec<u8>),
    Finish,
    Ignored,
}
pub(super) fn packet(message: Message, limit: usize) -> Result<Packet, TransportError> {
    let Message::Binary(data) = message else {
        return Err(failure("Fish returned a non-binary WebSocket frame"));
    };
    if data.len() > limit {
        return Err(failure("Fish message exceeds max_message_bytes"));
    }
    let Value::Map(mut value) = msgpack::decode(&data)? else {
        return Err(failure("Fish returned an invalid WebSocket event"));
    };
    let Some(Value::String(event)) = value.remove("event") else {
        return Err(failure("Fish returned an invalid WebSocket event"));
    };
    match event.as_str() {
        "audio" => match value.remove("audio") {
            Some(Value::Binary(bytes)) => Ok(Packet::Audio(bytes)),
            _ => Err(failure("Fish returned an invalid WebSocket event")),
        },
        "finish" => match value.remove("reason") {
            Some(Value::String(reason)) if reason == "stop" => Ok(Packet::Finish),
            Some(Value::String(reason)) if reason == "error" => Err(Box::new(Error {
                status: 0,
                message: "Streaming synthesis failed".into(),
                reason: Some(reason),
            })),
            _ => Err(failure("Fish returned an invalid WebSocket event")),
        },
        // Fish explicitly requires ignoring future event names.
        _ => Ok(Packet::Ignored),
    }
}
