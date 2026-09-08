use crate::{base64, generated::cartesia_output as out, http::TransportError, json::Raw};
use std::{collections::BTreeMap, fmt};

#[derive(Debug)]
pub struct Error {
    pub status_code: f64,
    pub error_code: Option<String>,
    pub request_id: Option<String>,
    pub doc_url: Option<String>,
    pub context_id: Option<String>,
    title: String,
    message: String,
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Cartesia {}: {}: {}",
            self.status_code, self.title, self.message
        )
    }
}
impl std::error::Error for Error {}

pub(super) fn failure(message: impl Into<String>) -> TransportError {
    Box::new(std::io::Error::other(message.into()))
}
pub(super) fn response_error(value: &str, status: f64) -> Error {
    let parsed = Raw::parse_exact(value).ok();
    let fields = parsed.and_then(|v| v.object().ok()).unwrap_or_default();
    let string = |key: &str| fields.get(key).and_then(|v| v.string().ok());
    Error {
        status_code: status,
        error_code: string("error_code"),
        request_id: string("request_id"),
        doc_url: string("doc_url"),
        context_id: string("context_id"),
        title: string("title").unwrap_or_else(|| "Request failed".into()),
        message: string("message").unwrap_or_else(|| match parsed {
            Some(value) => value
                .string()
                .unwrap_or_else(|_| "Invalid error response".into()),
            None => value.into(),
        }),
    }
}

pub(super) struct Context {
    pub id: Option<String>,
    pub group: Option<String>,
}
pub(super) enum Packet {
    Chunk(Context, String),
    Timing(Context, Vec<out::Timestamp>),
    Done(Context),
    Flushed(Context, String),
    Failure(Context, Error),
}
impl Packet {
    pub fn context(&self) -> &Context {
        match self {
            Self::Chunk(v, _)
            | Self::Timing(v, _)
            | Self::Done(v)
            | Self::Flushed(v, _)
            | Self::Failure(v, _) => v,
        }
    }
}

pub(super) fn decode(text: &str, websocket: bool) -> Result<Packet, TransportError> {
    let parsed = Raw::parse_exact(text).map_err(|_| failure("Cartesia returned invalid JSON"))?;
    let fields = parsed
        .object()
        .map_err(|_| failure("Cartesia returned an invalid frame"))?;
    let status = fields
        .get("status_code")
        .and_then(|v| v.number().ok())
        .filter(|v| v.is_finite() && v.fract() == 0.0)
        .ok_or_else(|| failure("Cartesia returned an invalid status_code"))?;
    let id = match fields.get("context_id") {
        None => None,
        Some(v) if v.is_null() => None,
        Some(v) => Some(
            v.string()
                .map_err(|_| failure("Cartesia returned an invalid context ID"))?,
        ),
    };
    let group = match fields.get("flush_id") {
        None => None,
        Some(v) => {
            let n = v
                .number()
                .ok()
                .filter(|v| {
                    v.is_finite() && *v >= 0.0 && *v <= 9007199254740991.0 && v.fract() == 0.0
                })
                .ok_or_else(|| failure("Cartesia returned an invalid flush ID"))?;
            Some((n as u64).to_string())
        }
    };
    let context = Context { id, group };
    let kind = fields.get("type").and_then(|v| v.string().ok());
    if kind.as_deref() == Some("error") {
        return Ok(Packet::Failure(context, response_error(text, status)));
    }
    if websocket && context.id.is_none() {
        return Err(failure("Cartesia WebSocket output lacks its context ID"));
    }
    let done = fields
        .get("done")
        .and_then(|v| v.boolean().ok())
        .ok_or_else(|| failure("Cartesia returned an invalid completion flag"))?;
    match kind.as_deref() {
        Some("done") if done => return Ok(Packet::Done(context)),
        Some("flush_done")
            if websocket
                && fields.get("flush_done").and_then(|v| v.boolean().ok()) == Some(true) =>
        {
            if let Some(group) = context.group.clone() {
                return Ok(Packet::Flushed(context, group));
            }
        }
        Some("chunk") => {
            if let Some(data) = fields.get("data").and_then(|v| v.string().ok()) {
                return Ok(Packet::Chunk(context, data));
            }
        }
        Some("timestamps") | Some("phoneme_timestamps") => {
            let phoneme = kind.as_deref() == Some("phoneme_timestamps");
            let field = if phoneme {
                "phoneme_timestamps"
            } else {
                "word_timestamps"
            };
            let timestamps = match fields.get(field) {
                None if websocket => Vec::new(),
                value => {
                    let timing = value
                        .and_then(|v| v.object().ok())
                        .ok_or_else(|| failure("Cartesia returned incomplete timestamps"))?;
                    timestamps(&timing, phoneme)?
                }
            };
            return Ok(Packet::Timing(context, timestamps));
        }
        _ => {}
    }
    let kind = kind.unwrap_or_else(|| fields.get("type").map_or("undefined", |v| v.text()).into());
    Err(failure(format!("Unknown Cartesia event: {kind}")))
}

fn timestamps(
    value: &BTreeMap<String, Raw<'_>>,
    phoneme: bool,
) -> Result<Vec<out::Timestamp>, TransportError> {
    let arrays = [if phoneme { "phonemes" } else { "words" }, "start", "end"]
        .map(|key| value.get(key).and_then(|v| v.array().ok()));
    let [Some(labels), Some(starts), Some(ends)] = arrays else {
        return Err(failure("Cartesia returned mismatched timestamp arrays"));
    };
    if labels.len() != starts.len() || labels.len() != ends.len() {
        return Err(failure("Cartesia returned mismatched timestamp arrays"));
    }
    labels
        .into_iter()
        .zip(starts)
        .zip(ends)
        .map(|((label, start), end)| {
            let value = label
                .string()
                .map_err(|_| failure("Cartesia returned an invalid timestamp"))?;
            let start = start
                .number()
                .map_err(|_| failure("Cartesia returned an invalid timestamp"))?;
            let end = end
                .number()
                .map_err(|_| failure("Cartesia returned an invalid timestamp"))?;
            if !start.is_finite()
                || !end.is_finite()
                || start < 0.0
                || end < start
                || !(start * 1000.0).is_finite()
                || !(end * 1000.0).is_finite()
            {
                return Err(failure("Cartesia returned an invalid timestamp"));
            }
            Ok(out::Timestamp {
                kind: if phoneme {
                    out::TimestampKind::Phoneme(Default::default())
                } else {
                    out::TimestampKind::Word(Default::default())
                },
                value,
                start_time_ms: start * 1000.0,
                end_time_ms: end * 1000.0,
            })
        })
        .collect()
}

pub(super) fn output(
    packet: Packet,
    id: &str,
    timed: bool,
) -> Result<Option<out::SynthesisItem>, TransportError> {
    let (context, audio, timestamps) = match packet {
        Packet::Failure(_, error) => return Err(Box::new(error)),
        Packet::Done(_) => return Ok(None),
        Packet::Flushed(_, group) => {
            return Ok(Some(out::SynthesisItem::Flush(out::SynthesisItemFlush {
                event: Default::default(),
                correlation_id: id.into(),
                input_group_id: Some(group),
            })))
        }
        Packet::Chunk(context, data) => {
            let audio = base64::decode(&data)
                .ok_or_else(|| failure("Cartesia returned invalid base64 audio"))?;
            if !timed && context.group.is_none() {
                return Ok(Some(out::SynthesisItem::Bytes(audio)));
            }
            (context, Some(audio), Vec::new())
        }
        Packet::Timing(context, timestamps) => (context, None, timestamps),
    };
    Ok(Some(out::SynthesisItem::Timeline(out::TimelineOutput {
        correlation: Default::default(),
        correlation_id: id.into(),
        input_group_id: context.group,
        audio,
        timestamps,
    })))
}
