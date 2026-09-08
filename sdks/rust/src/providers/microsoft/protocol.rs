use crate::{generated::microsoft_output::*, http::TransportError, json::Raw, websocket::Message};
use std::{
    collections::BTreeMap,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Debug, PartialEq, Eq)]
pub struct Error {
    pub message: String,
    pub status: Option<u16>,
    pub retry_after: Option<String>,
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}
impl std::error::Error for Error {}
pub(super) fn failure(message: &str) -> TransportError {
    Box::new(Error {
        message: message.into(),
        status: None,
        retry_after: None,
    })
}

pub(super) fn timestamp(now: SystemTime) -> Result<String, TransportError> {
    let elapsed = now
        .duration_since(UNIX_EPOCH)
        .map_err(|_| failure("Microsoft clock precedes the Unix epoch"))?;
    let mut days = elapsed.as_secs() / 86400;
    let mut year = 1970;
    loop {
        let length = if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) {
            366
        } else {
            365
        };
        if days < length {
            break;
        }
        days -= length;
        year += 1;
        if year > 9999 {
            return Err(failure(
                "Microsoft clock exceeds the supported calendar range",
            ));
        }
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let mut month = 1;
    for length in [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ] {
        if days < length {
            break;
        };
        days -= length;
        month += 1;
    }
    let second = elapsed.as_secs() % 86400;
    Ok(format!(
        "{year:04}-{month:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        days + 1,
        second / 3600,
        second / 60 % 60,
        second % 60,
        elapsed.subsec_millis()
    ))
}
pub(super) fn encode(path: &str, id: &str, body: String) -> Result<Message, TransportError> {
    let content_type = match path {
        "ssml" => "application/ssml+xml",
        "text.piece" | "text.end" => "text/plain",
        _ => "application/json",
    };
    Ok(Message::Text(format!("Path: {path}\r\nX-RequestId: {id}\r\nX-Timestamp: {}\r\nContent-Type: {content_type}\r\n\r\n{body}",timestamp(SystemTime::now())?)))
}
pub(super) struct Frame {
    pub path: String,
    pub request_id: String,
    pub stream_id: Option<String>,
    pub body: Message,
}
pub(super) fn decode(message: Message, limit: usize) -> Result<Frame, TransportError> {
    let (headers, body) = match message {
        Message::Text(mut data) => {
            if data.len() > limit {
                return Err(failure("Microsoft message exceeds max_message_bytes"));
            }
            let end = data
                .find("\r\n\r\n")
                .ok_or_else(|| failure("Microsoft text frame is missing its header separator"))?;
            let body = data.split_off(end + 4);
            data.truncate(end);
            (data, Message::Text(body))
        }
        Message::Binary(mut data) => {
            if data.len() > limit {
                return Err(failure("Microsoft message exceeds max_message_bytes"));
            }
            if data.len() < 2 {
                return Err(failure(
                    "Microsoft binary frame is missing its header length",
                ));
            }
            let length = u16::from_be_bytes([data[0], data[1]]) as usize;
            if length > data.len() - 2 {
                return Err(failure("Microsoft binary frame has a truncated header"));
            }
            let body = data.split_off(length + 2);
            let headers = std::str::from_utf8(&data[2..])
                .map_err(|_| failure("Microsoft binary frame has invalid UTF-8 headers"))?
                .to_owned();
            (headers, Message::Binary(body))
        }
    };
    let mut fields = BTreeMap::new();
    for line in headers.split("\r\n").filter(|v| !v.is_empty()) {
        let (name, value) = line
            .split_once(':')
            .ok_or_else(|| failure("Microsoft frame contains an invalid header"))?;
        let (name, value) = (name.trim().to_ascii_lowercase(), value.trim().to_owned());
        if name.is_empty()
            || !name
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            || value.contains(['\r', '\n'])
        {
            return Err(failure("Microsoft frame contains an invalid header"));
        }
        if fields.insert(name.clone(), value).is_some() {
            return Err(failure(&format!("Microsoft frame repeats header {name}")));
        }
    }
    let path = fields
        .remove("path")
        .filter(|v| !v.is_empty())
        .ok_or_else(|| failure("Microsoft frame is missing Path or X-RequestId"))?;
    let request_id = fields
        .remove("x-requestid")
        .filter(|v| !v.is_empty())
        .ok_or_else(|| failure("Microsoft frame is missing Path or X-RequestId"))?;
    Ok(Frame {
        path: path.to_ascii_lowercase(),
        request_id,
        stream_id: fields.remove("x-streamid"),
        body,
    })
}
pub(super) fn object(text: &str) -> Result<BTreeMap<String, Raw<'_>>, TransportError> {
    Raw::parse(text)
        .map_err(|_| failure("Microsoft returned invalid JSON"))?
        .object()
        .map_err(|_| failure("Microsoft returned an invalid synthesis object"))
}
fn ticks(value: Option<Raw<'_>>, name: &str) -> Result<f64, TransportError> {
    value
        .and_then(|v| v.number().ok())
        .filter(|n| n.is_finite() && *n >= 0.0 && *n <= 9007199254740991.0 && n.fract() == 0.0)
        .ok_or_else(|| failure(&format!("Microsoft returned invalid {name}")))
}
pub(super) fn metadata(
    body: BTreeMap<String, Raw<'_>>,
) -> Result<(Vec<MicrosoftTimestamp>, Option<f64>), TransportError> {
    let rows = body
        .get("Metadata")
        .and_then(|v| v.array().ok())
        .ok_or_else(|| failure("Microsoft returned invalid synthesis Metadata"))?;
    let mut marks = vec![];
    let mut duration = None;
    for row in rows {
        let row = row
            .object()
            .map_err(|_| failure("Microsoft returned an invalid synthesis object"))?;
        let kind = row
            .get("Type")
            .and_then(|v| v.string().ok())
            .ok_or_else(|| failure("Microsoft returned an invalid metadata type"))?;
        if ![
            "WordBoundary",
            "SentenceBoundary",
            "Bookmark",
            "Viseme",
            "SessionEnd",
        ]
        .contains(&kind.as_str())
        {
            continue;
        }
        let data = row
            .get("Data")
            .and_then(|v| v.object().ok())
            .ok_or_else(|| failure("Microsoft returned an invalid synthesis object"))?;
        let offset = ticks(data.get("Offset").copied(), "metadata Offset")?;
        if kind == "SessionEnd" {
            if duration.is_some() {
                return Err(failure("Microsoft returned duplicate SessionEnd metadata"));
            };
            duration = Some(offset / 10000.0);
            continue;
        }
        let mut mark = MicrosoftTimestamp {
            kind: MicrosoftTimestampKind::Ssml(MicrosoftTimestampKindSsml),
            value: String::new(),
            start_time_ms: offset / 10000.0,
            end_time_ms: None,
            source: None,
            boundary_type: None,
            animation_chunk: None,
            is_last_animation: None,
        };
        match kind.as_str() {
            "WordBoundary" | "SentenceBoundary" => {
                let text = data
                    .get("text")
                    .and_then(|v| v.object().ok())
                    .ok_or_else(|| failure("Microsoft returned an invalid synthesis object"))?;
                mark.value = text
                    .get("Text")
                    .and_then(|v| v.string().ok())
                    .ok_or_else(|| failure("Microsoft returned invalid boundary text"))?;
                if let Some(value) = text.get("BoundaryType") {
                    mark.boundary_type = Some(
                        value
                            .string()
                            .map_err(|_| failure("Microsoft returned invalid boundary text"))?,
                    );
                }
                let length = ticks(data.get("Duration").copied(), "metadata Duration")?;
                if offset + length > 9007199254740991.0 {
                    return Err(failure("Microsoft metadata timing overflow"));
                }
                mark.kind = if kind == "WordBoundary" {
                    MicrosoftTimestampKind::Word(MicrosoftTimestampKindWord)
                } else {
                    MicrosoftTimestampKind::Sentence(MicrosoftTimestampKindSentence)
                };
                mark.end_time_ms = Some(offset / 10000.0 + length / 10000.0);
            }
            "Bookmark" => {
                mark.value = data
                    .get("Bookmark")
                    .and_then(|v| v.string().ok())
                    .ok_or_else(|| failure("Microsoft returned an invalid bookmark"))?;
            }
            "Viseme" => {
                let id = ticks(data.get("VisemeId").copied(), "viseme metadata")?;
                mark.kind = MicrosoftTimestampKind::Viseme(MicrosoftTimestampKindViseme);
                mark.value = id.to_string();
                if let Some(value) = data.get("AnimationChunk") {
                    mark.animation_chunk = Some(
                        value
                            .string()
                            .map_err(|_| failure("Microsoft returned invalid viseme metadata"))?,
                    );
                }
                if let Some(value) = data.get("IsLastAnimation") {
                    mark.is_last_animation = Some(
                        if value
                            .boolean()
                            .map_err(|_| failure("Microsoft returned invalid viseme metadata"))?
                        {
                            MicrosoftTimestampIsLastAnimation::True(
                                MicrosoftTimestampIsLastAnimationTrue,
                            )
                        } else {
                            MicrosoftTimestampIsLastAnimation::False(
                                MicrosoftTimestampIsLastAnimationFalse,
                            )
                        },
                    );
                }
            }
            _ => unreachable!(),
        }
        marks.push(mark);
    }
    Ok((marks, duration))
}
