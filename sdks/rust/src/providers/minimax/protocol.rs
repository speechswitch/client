use crate::{generated::minimax_output::*, http::TransportError, json::Raw};
use std::{collections::BTreeMap, fmt};

#[derive(Debug, PartialEq, Eq)]
pub struct Error {
    pub message: String,
    pub code: Option<u64>,
    pub status: Option<u16>,
    pub retry_after: Option<String>,
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}
impl std::error::Error for Error {}
pub(super) fn failure(message: &str) -> TransportError {
    Box::new(Error {
        message: message.into(),
        code: None,
        status: None,
        retry_after: None,
    })
}

#[derive(Default)]
pub(super) struct Packet {
    pub code: Option<u64>,
    pub message: String,
    pub event: Option<String>,
    pub trace: Option<String>,
    pub session: Option<String>,
    pub connection: Option<String>,
    pub subtitle: Option<String>,
    pub audio: Option<Vec<u8>>,
    pub status: Option<u8>,
    pub final_audio: Option<bool>,
    pub usage: Option<Usage>,
}
pub(super) fn text(data: &[u8]) -> Result<&str, TransportError> {
    std::str::from_utf8(data.strip_prefix(&[239, 187, 191]).unwrap_or(data))
        .map_err(|_| failure("MiniMax returned invalid UTF-8"))
}
fn object(value: Raw<'_>) -> Result<BTreeMap<String, Raw<'_>>, TransportError> {
    value
        .object()
        .map_err(|_| failure("MiniMax returned an invalid response object"))
}
fn string(value: Raw<'_>, field: &str) -> Result<String, TransportError> {
    value
        .string()
        .map_err(|_| failure(&format!("MiniMax returned invalid {field}")))
}
fn number(value: Option<&Raw<'_>>, field: &str, integer: bool) -> Result<f64, TransportError> {
    let n = value.and_then(|v| v.number().ok()).filter(|n| {
        n.is_finite() && *n >= 0.0 && (!integer || (n.fract() == 0.0 && *n <= 9007199254740991.0))
    });
    n.ok_or_else(|| failure(&format!("MiniMax returned invalid {field}")))
}
pub(super) fn packet(text: &str) -> Result<Packet, TransportError> {
    let fields = object(
        Raw::parse(text).map_err(|_| failure("MiniMax returned an invalid response object"))?,
    )?;
    let mut p = Packet::default();
    if let Some(base) = fields.get("base_resp") {
        let base = object(*base)?;
        let code = number(base.get("status_code"), "base_resp.status_code", true)? as u64;
        p.code = (code != 0).then_some(code);
        if let Some(v) = base.get("status_msg") {
            p.message = string(*v, "base_resp.status_msg")?;
        }
    }
    for (key, target) in [("event", &mut p.event), ("trace_id", &mut p.trace)] {
        if let Some(v) = fields.get(key) {
            *target = Some(string(*v, key)?);
        }
    }
    // Native errors can carry unavailable or malformed success metadata.
    if p.code.is_some() {
        return Ok(p);
    }
    for (key, target) in [
        ("session_id", &mut p.session),
        ("connect_id", &mut p.connection),
    ] {
        if let Some(v) = fields.get(key) {
            *target = Some(string(*v, key)?);
        }
    }
    if let Some(v) = fields.get("is_final") {
        p.final_audio = Some(
            v.boolean()
                .map_err(|_| failure("MiniMax returned invalid is_final"))?,
        );
    }
    if let Some(v) = fields.get("data").filter(|v| !v.is_null()) {
        let data = object(*v)?;
        if let Some(v) = data.get("status") {
            let n = number(Some(v), "data.status", true)?;
            if n != 1.0 && n != 2.0 {
                return Err(failure("MiniMax returned invalid data.status"));
            }
            p.status = Some(n as u8);
        }
        if let Some(v) = data.get("audio") {
            let audio = string(*v, "data.audio")?;
            if audio.len() % 2 != 0 || !audio.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err(failure("MiniMax returned invalid hex audio"));
            }
            p.audio = Some(
                audio
                    .as_bytes()
                    .chunks_exact(2)
                    .map(|v| {
                        ((v[0] as char).to_digit(16).unwrap() * 16
                            + (v[1] as char).to_digit(16).unwrap()) as u8
                    })
                    .collect(),
            );
        }
        if let Some(v) = data.get("subtitle_file") {
            p.subtitle = Some(string(*v, "data.subtitle_file")?);
        }
    }
    if let Some(v) = fields.get("extra_info").filter(|v| !v.is_null()) {
        let data = object(*v)?;
        let mut usage = Usage {
            duration_ms: None,
            sample_rate_hz: None,
            byte_length: None,
            bit_rate_bps: None,
            channel_count: None,
            billed_characters: None,
            word_count: None,
            invalid_character_ratio: None,
            format: None,
        };
        for (key, target) in [
            ("audio_length", &mut usage.duration_ms),
            ("audio_sample_rate", &mut usage.sample_rate_hz),
            ("audio_size", &mut usage.byte_length),
            ("bitrate", &mut usage.bit_rate_bps),
            ("audio_channel", &mut usage.channel_count),
            ("usage_characters", &mut usage.billed_characters),
            ("word_count", &mut usage.word_count),
        ] {
            if let Some(v) = data.get(key) {
                *target = Some(number(Some(v), key, true)?);
            }
        }
        if let Some(v) = data.get("invisible_character_ratio") {
            let ratio = number(Some(v), "invisible_character_ratio", false)?;
            if ratio > 1.0 {
                return Err(failure(
                    "MiniMax returned invalid invisible_character_ratio",
                ));
            }
            usage.invalid_character_ratio = Some(ratio);
        }
        if let Some(v) = data.get("audio_format") {
            usage.format = Some(string(*v, "audio_format")?);
        }
        p.usage = Some(usage);
    }
    Ok(p)
}

pub(super) fn subtitles(text: &str, kind: &str) -> Result<Vec<MiniMaxTimestamp>, TransportError> {
    let rows = Raw::parse(text)
        .and_then(|v| v.array())
        .map_err(|_| failure("MiniMax subtitles must be a JSON array"))?;
    rows.into_iter()
        .map(|row| {
            let row = object(row)?;
            let start = number(row.get("time_begin"), "subtitle time_begin", false)?;
            let end = number(row.get("time_end"), "subtitle time_end", false)?;
            if end < start {
                return Err(failure("MiniMax returned reversed subtitle timestamps"));
            }
            let value = row
                .get("text")
                .ok_or_else(|| failure("MiniMax returned invalid subtitle text"))?;
            Ok(MiniMaxTimestamp {
                value: string(*value, "subtitle text")?,
                start_time_ms: start,
                end_time_ms: Some(end),
                source: None,
                kind: if kind == "sentence" {
                    MiniMaxTimestampKind::Sentence(Default::default())
                } else {
                    MiniMaxTimestampKind::Word(Default::default())
                },
            })
        })
        .collect()
}

pub(super) fn envelope(timeline: bool, trace: Option<String>) -> MiniMaxEnvelope {
    MiniMaxEnvelope {
        correlation: if timeline {
            MiniMaxEnvelopeCorrelation::Timeline(Default::default())
        } else {
            MiniMaxEnvelopeCorrelation::Ordered(Default::default())
        },
        audio: None,
        correlation_id: None,
        input_group_id: None,
        request_complete: None,
        sentence_boundary: None,
        timestamps: Vec::new(),
        trace_id: trace,
        usage: None,
    }
}
