use super::{failure, Error};
use crate::{base64, http::TransportError, json::Raw, websocket::Message};

pub(super) enum Payload {
    Audio(Vec<u8>),
    Flush,
    Closed,
}
pub(super) struct Packet {
    pub id: String,
    pub payload: Payload,
}
pub(super) fn decode(message: Message, limit: usize) -> Result<Packet, TransportError> {
    let Message::Text(text) = message else {
        return Err(failure("Voice.ai expected a JSON text frame"));
    };
    if text.len() > limit {
        return Err(failure("Voice.ai message exceeds MaxMessageBytes"));
    }
    let raw = Raw::parse_exact(&text).map_err(|_| failure("Invalid Voice.ai JSON"))?;
    let fields = raw
        .object()
        .map_err(|_| failure("Invalid Voice.ai message"))?;
    let mut variants = ["audio", "is_last", "context_closed", "error"]
        .into_iter()
        .filter(|key| fields.contains_key(*key));
    let kind = variants
        .next()
        .ok_or_else(|| failure("Invalid Voice.ai message variant"))?;
    if variants.next().is_some() {
        return Err(failure("Invalid Voice.ai message variant"));
    }
    let id = fields.get("context_id");
    if kind == "error" {
        fields[kind]
            .string()
            .map_err(|_| failure("Invalid Voice.ai error message"))?;
        let context_id = id
            .filter(|v| !v.is_null())
            .map(|v| v.string())
            .transpose()
            .map_err(|_| failure("Invalid Voice.ai error message"))?;
        return Err(Box::new(Error {
            status: None,
            context_id,
        }));
    }
    let id = id
        .and_then(|v| v.string().ok())
        .filter(|v| !v.is_empty())
        .ok_or_else(|| failure("Voice.ai omitted context_id"))?;
    let payload = if kind == "audio" {
        let encoded = fields[kind]
            .string()
            .map_err(|_| failure("Invalid Voice.ai base64 audio"))?;
        let audio = base64::decode(&encoded)
            .filter(|bytes| base64::encode(bytes) == encoded)
            .ok_or_else(|| failure("Invalid Voice.ai base64 audio"))?;
        Payload::Audio(audio)
    } else {
        if fields[kind].boolean().ok() != Some(true) {
            return Err(failure("Invalid Voice.ai completion flag"));
        }
        if kind == "is_last" {
            Payload::Flush
        } else {
            Payload::Closed
        }
    };
    Ok(Packet { id, payload })
}
