use super::{failure, Error};
use crate::{
    base64,
    generated::{smallest_ai_output::SmallestEnvelopeTimestampsItem, transport::SseMessage},
    http::TransportError,
    json::Raw,
};

pub(super) enum Payload {
    Chunk(Vec<u8>),
    Word {
        index: f64,
        timestamp: SmallestEnvelopeTimestampsItem,
    },
    Complete,
}
pub(super) struct Packet {
    pub request_id: String,
    pub external_id: Option<String>,
    pub payload: Payload,
}
fn audio(value: Raw<'_>) -> Result<Vec<u8>, TransportError> {
    let encoded = value
        .string()
        .map_err(|_| failure("Invalid Smallest.ai base64 audio"))?;
    base64::decode(&encoded)
        .filter(|v| base64::encode(v) == encoded)
        .ok_or_else(|| failure("Invalid Smallest.ai base64 audio"))
}
pub(super) fn decode(text: &str) -> Result<Option<Packet>, TransportError> {
    let raw = Raw::parse_exact(text).map_err(|_| failure("Smallest.ai returned invalid JSON"))?;
    let fields = raw
        .object()
        .map_err(|_| failure("Invalid Smallest.ai response object"))?;
    if fields.len() == 1
        && fields.get("type").and_then(|v| v.string().ok()).as_deref() == Some("pong")
    {
        return Ok(None);
    }
    let status = fields.get("status").and_then(|v| v.string().ok());
    if status.as_deref() == Some("error") {
        let error = fields
            .get("error")
            .copied()
            .unwrap_or(raw)
            .object()
            .map_err(|_| failure("Invalid Smallest.ai error response"))?;
        let message = error
            .get("message")
            .and_then(|v| v.string().ok())
            .ok_or_else(|| failure("Invalid Smallest.ai error response"))?;
        let code = error
            .get("code")
            .map(|v| v.string())
            .transpose()
            .map_err(|_| failure("Invalid Smallest.ai error response"))?;
        return Err(Box::new(Error {
            message,
            code,
            status: None,
        }));
    }
    let request_id = fields
        .get("request_id")
        .and_then(|v| v.string().ok())
        .filter(|v| !v.is_empty())
        .ok_or_else(|| failure("Invalid Smallest.ai request identity"))?;
    let external_id = fields
        .get("external_request_id")
        .map(|v| v.string())
        .transpose()
        .map_err(|_| failure("Invalid Smallest.ai request identity"))?;
    let payload = if status.as_deref() == Some("complete") {
        Payload::Complete
    } else {
        let data = fields
            .get("data")
            .and_then(|v| v.object().ok())
            .ok_or_else(|| failure("Invalid Smallest.ai response object"))?;
        match status.as_deref() {
            Some("chunk") => Payload::Chunk(audio(
                *data
                    .get("audio")
                    .ok_or_else(|| failure("Invalid Smallest.ai base64 audio"))?,
            )?),
            Some("word_timestamp") => {
                let word = data
                    .get("word")
                    .and_then(|v| v.string().ok())
                    .ok_or_else(|| failure("Invalid Smallest.ai word timestamp"))?;
                let index = data
                    .get("id")
                    .and_then(|v| v.number().ok())
                    .ok_or_else(|| failure("Invalid Smallest.ai word timestamp"))?;
                let start = data
                    .get("start")
                    .and_then(|v| v.number().ok())
                    .ok_or_else(|| failure("Invalid Smallest.ai word timestamp"))?
                    * 1000.0;
                let end = data
                    .get("end")
                    .and_then(|v| v.number().ok())
                    .ok_or_else(|| failure("Invalid Smallest.ai word timestamp"))?
                    * 1000.0;
                if !index.is_finite()
                    || !(0.0..=9007199254740991.0).contains(&index)
                    || index.fract() != 0.0
                    || !start.is_finite()
                    || !end.is_finite()
                    || start < 0.0
                    || end < start
                {
                    return Err(failure("Invalid Smallest.ai word timestamp"));
                }
                Payload::Word {
                    index,
                    timestamp: SmallestEnvelopeTimestampsItem {
                        value: word,
                        start_time_ms: start,
                        end_time_ms: Some(end),
                        kind: Default::default(),
                        source: None,
                    },
                }
            }
            _ => return Err(failure("Unknown Smallest.ai WebSocket status")),
        }
    };
    Ok(Some(Packet {
        request_id,
        external_id,
        payload,
    }))
}
pub(super) fn sse(event: SseMessage) -> Result<(bool, Vec<u8>), TransportError> {
    let raw =
        Raw::parse_exact(&event.data).map_err(|_| failure("Smallest.ai returned invalid JSON"))?;
    let fields = raw
        .object()
        .map_err(|_| failure("Invalid Smallest.ai response object"))?;
    let status = fields.get("status").and_then(|v| v.string().ok());
    if event.event == "error" || status.as_deref() == Some("error") || fields.contains_key("error")
    {
        return Err(Box::new(Error {
            message: "Smallest.ai SSE returned an error".into(),
            status: None,
            code: None,
        }));
    }
    let done = fields
        .get("done")
        .and_then(|v| v.boolean().ok())
        .ok_or_else(|| failure("Invalid Smallest.ai SSE status"))?;
    if !matches!(status.as_deref(), Some("200" | "206"))
        || done != (status.as_deref() == Some("200"))
    {
        return Err(failure("Invalid Smallest.ai SSE status"));
    }
    let bytes = match fields.get("audio") {
        Some(value) => audio(*value)?,
        None if done => Vec::new(),
        None => return Err(failure("Smallest.ai SSE chunk omitted audio")),
    };
    Ok((done, bytes))
}
