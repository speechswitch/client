use crate::{base64, generated::hume_output::*, http::TransportError, json::Raw};

#[derive(Debug, PartialEq, Eq)]
pub struct Error {
    pub message: String,
    pub status: Option<u16>,
    pub code: Option<String>,
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

pub(super) fn packet(data: &str, metadata: bool) -> Result<Option<SynthesisItem>, TransportError> {
    let raw = Raw::parse_exact(data).map_err(|_| failure("Hume returned invalid JSON"))?;
    let fields = raw
        .object()
        .map_err(|_| failure("Hume returned an invalid event"))?;
    let native_error = fields.get("error").and_then(|v| v.string().ok());
    let kind = fields.get("type").and_then(|v| v.string().ok());
    if native_error.is_some() || kind.as_deref() == Some("error") {
        return Err(Box::new(Error {
            message: fields
                .get("message")
                .and_then(|v| v.string().ok())
                .or(native_error)
                .unwrap_or_else(|| "Hume synthesis failed".into()),
            status: None,
            code: fields.get("code").and_then(|v| v.string().ok()),
        }));
    }
    let mut ids = Vec::new();
    for name in ["generation_id", "request_id", "snippet_id"] {
        ids.push(
            fields
                .get(name)
                .and_then(|v| v.string().ok())
                .ok_or_else(|| failure("Hume returned invalid correlation identifiers"))?,
        );
    }
    let mut e = HumeEnvelope {
        correlation: HumeEnvelopeCorrelation,
        generation_id: ids.remove(0),
        request_id: ids.remove(0),
        correlation_id: ids.remove(0),
        audio: None,
        chunk_index: None,
        is_last_chunk: None,
        input_group_id: None,
        timestamps: vec![],
    };
    match kind.as_deref() {
        Some("audio") => {
            let invalid = || failure("Hume returned an invalid audio event");
            let audio = fields
                .get("audio")
                .map(|v| v.string().map_err(|_| invalid()))
                .transpose()?;
            if metadata && audio.is_none() {
                return Err(invalid());
            }
            let index = fields
                .get("chunk_index")
                .and_then(|v| v.number().ok())
                .ok_or_else(invalid)?;
            let last = fields
                .get("is_last_chunk")
                .and_then(|v| v.boolean().ok())
                .ok_or_else(invalid)?;
            let utterance = fields
                .get("utterance_index")
                .filter(|v| !v.is_null())
                .map(|v| v.number().map_err(|_| invalid()))
                .transpose()?;
            for n in std::iter::once(index).chain(utterance) {
                if !n.is_finite() || n.fract() != 0.0 || !(0.0..=9007199254740991.0).contains(&n) {
                    return Err(invalid());
                }
            }
            // Binary mode's JSON metadata is not a second audio emission.
            if !metadata {
                return Ok(None);
            }
            e.audio = Some(
                base64::decode(&audio.unwrap())
                    .ok_or_else(|| failure("Hume returned invalid base64 audio"))?,
            );
            e.chunk_index = Some(index);
            e.is_last_chunk = Some(if last {
                HumeEnvelopeIsLastChunk::True(HumeEnvelopeIsLastChunkTrue)
            } else {
                HumeEnvelopeIsLastChunk::False(HumeEnvelopeIsLastChunkFalse)
            });
            e.input_group_id = utterance.map(|n| (n as u64).to_string());
        }
        Some("timestamp") => {
            let invalid = || failure("Hume returned an invalid timestamp");
            let mark = fields
                .get("timestamp")
                .and_then(|v| v.object().ok())
                .ok_or_else(invalid)?;
            let time = mark
                .get("time")
                .and_then(|v| v.object().ok())
                .ok_or_else(invalid)?;
            let text = mark
                .get("text")
                .and_then(|v| v.string().ok())
                .ok_or_else(invalid)?;
            let kind = match mark.get("type").and_then(|v| v.string().ok()).as_deref() {
                Some("word") => TimestampKind::Word(TimestampKindWord),
                Some("phoneme") => TimestampKind::Phoneme(TimestampKindPhoneme),
                _ => return Err(invalid()),
            };
            let start = time
                .get("begin")
                .and_then(|v| v.number().ok())
                .ok_or_else(invalid)?;
            let end = time
                .get("end")
                .and_then(|v| v.number().ok())
                .ok_or_else(invalid)?;
            if !start.is_finite()
                || !end.is_finite()
                || start < 0.0
                || end < start
                || end > 9007199254740991.0
                || start.fract() != 0.0
                || end.fract() != 0.0
            {
                return Err(invalid());
            }
            if !metadata {
                return Ok(None);
            }
            e.timestamps.push(Timestamp {
                kind,
                value: text,
                start_time_ms: start,
                end_time_ms: Some(end),
                source: None,
            });
        }
        _ => return Err(failure("Hume returned an invalid event")),
    }
    Ok(Some(SynthesisItem::Timeline(e)))
}
