use crate::{base64, generated::gradium_output::*, http::TransportError, json::Raw};

#[derive(Debug, PartialEq, Eq)]
pub struct Error {
    pub message: String,
    pub status: Option<u16>,
    pub code: Option<i64>,
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

pub(super) enum Packet {
    Ready,
    End,
    Ignored,
    Item(SynthesisItem),
}
pub(super) fn packet(data: &str, timed: bool) -> Result<Packet, TransportError> {
    let raw = Raw::parse_exact(data).map_err(|_| failure("Gradium returned invalid JSON"))?;
    let invalid = || failure("Gradium returned an invalid event");
    let fields = raw.object().map_err(|_| invalid())?;
    if fields.contains_key("client_req_id") {
        return Err(failure(
            "Gradium returned an unexpected multiplexed request ID",
        ));
    }
    let kind = fields
        .get("type")
        .and_then(|v| v.string().ok())
        .ok_or_else(invalid)?;
    match kind.as_str() {
        "ready" => {
            fields
                .get("request_id")
                .and_then(|v| v.string().ok())
                .ok_or_else(invalid)?;
            return Ok(Packet::Ready);
        }
        "end_of_stream" => return Ok(Packet::End),
        "flushed" => return Ok(Packet::Ignored),
        "error" => {
            let message = fields
                .get("message")
                .and_then(|v| v.string().ok())
                .ok_or_else(invalid)?;
            let code = fields
                .get("code")
                .map(|v| {
                    let n = v.number().map_err(|_| invalid())?;
                    if !n.is_finite() || n.fract() != 0.0 || n.abs() > 9007199254740991.0 {
                        return Err(invalid());
                    }
                    Ok(n as i64)
                })
                .transpose()?;
            return Err(Box::new(Error {
                message,
                status: None,
                code,
            }));
        }
        "audio" | "text" => {}
        _ => return Err(invalid()),
    }
    let payload = fields
        .get(kind.as_str())
        .and_then(|v| v.string().ok())
        .ok_or_else(invalid)?;
    let correlation_id = fields
        .get("stream_id")
        .map(|v| {
            let invalid = || failure("Gradium returned an invalid stream ID");
            let n = v.number().map_err(|_| invalid())?;
            if !n.is_finite() || !(0.0..=9007199254740991.0).contains(&n) || n.fract() != 0.0 {
                return Err(invalid());
            }
            Ok((n as u64).to_string())
        })
        .transpose()?;
    let range = if kind == "text" || fields.contains_key("start_s") || fields.contains_key("stop_s")
    {
        let invalid = || failure("Gradium returned an invalid time range");
        let start = fields
            .get("start_s")
            .and_then(|v| v.number().ok())
            .ok_or_else(invalid)?;
        let end = fields
            .get("stop_s")
            .and_then(|v| v.number().ok())
            .ok_or_else(invalid)?;
        if start < 0.0
            || end < start
            || !(start * 1000.0).is_finite()
            || !(end * 1000.0).is_finite()
        {
            return Err(invalid());
        }
        Some(TimelineOutputAudioTiming {
            start_time_ms: start * 1000.0,
            end_time_ms: end * 1000.0,
        })
    } else {
        None
    };
    let mut envelope = TimelineOutput {
        correlation: TimelineOutputCorrelation,
        correlation_id,
        audio: None,
        audio_timing: None,
        timestamps: Vec::new(),
    };
    if kind == "audio" {
        let audio = base64::decode(&payload)
            .ok_or_else(|| failure("Gradium returned invalid base64 audio"))?;
        if !timed {
            return Ok(Packet::Item(SynthesisItem::Bytes(audio)));
        }
        envelope.audio = Some(audio);
        envelope.audio_timing = range;
    } else {
        if !timed {
            return Ok(Packet::Ignored);
        }
        let range = range.unwrap();
        envelope.timestamps.push(SegmentTimestamp {
            kind: SegmentTimestampKind,
            value: payload,
            start_time_ms: range.start_time_ms,
            end_time_ms: range.end_time_ms,
        });
    }
    Ok(Packet::Item(SynthesisItem::Timeline(envelope)))
}

// ECMAScript whitespace, including BOM and excluding Rust's extra U+0085.
pub(super) const SPACE: &str = "\t\n\u{b}\u{c}\r \u{a0}\u{1680}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}";
pub(super) struct TextBuffer {
    pub pending: String,
    pub limit: usize,
}
impl TextBuffer {
    pub fn push(&mut self, text: &str) -> Result<String, TransportError> {
        if text.len() > self.limit - self.pending.len() {
            return Err(failure("Gradium text buffer exceeds max_message_bytes"));
        }
        self.pending.push_str(text);
        let mut in_tag = false;
        let mut boundary = None;
        for (i, c) in self.pending.char_indices() {
            if c == '<' {
                in_tag = true;
            } else if c == '>' {
                in_tag = false;
                if self.pending[..i + 1].ends_with("<flush>") {
                    boundary = Some(i + 1);
                }
            } else if !in_tag && SPACE.contains(c) {
                boundary = Some(i + c.len_utf8());
            }
        }
        let Some(boundary) = boundary else {
            return Ok(String::new());
        };
        let text = self.pending[..boundary]
            .trim_end_matches(|c| SPACE.contains(c))
            .to_owned();
        self.pending.drain(..boundary);
        Ok(text)
    }
}
