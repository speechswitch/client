use crate::{
    base64,
    generated::async_output::*,
    http::TransportError,
    json::{self, Raw},
};

#[derive(Debug)]
struct ProtocolError(String);
impl std::fmt::Display for ProtocolError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for ProtocolError {}
pub(super) fn failure(message: impl Into<String>) -> TransportError {
    Box::new(ProtocolError(message.into()))
}

pub(super) const WHITESPACE: &[char] = &[
    ' ', '\t', '\n', '\r', '\x0b', '\x0c', '\u{a0}', '\u{1680}', '\u{2000}', '\u{2001}',
    '\u{2002}', '\u{2003}', '\u{2004}', '\u{2005}', '\u{2006}', '\u{2007}', '\u{2008}', '\u{2009}',
    '\u{200a}', '\u{2028}', '\u{2029}', '\u{202f}', '\u{205f}', '\u{3000}', '\u{feff}',
];

pub(super) fn timestamped(text: &str) -> Result<TimestampedAudio, TransportError> {
    let value = Raw::parse(text)
        .and_then(Raw::object)
        .map_err(|_| failure("Async returned an invalid timestamp response"))?;
    let incomplete = || failure("Async returned incomplete timestamped audio");
    let audio = value
        .get("audio_base64")
        .ok_or_else(incomplete)?
        .string()
        .map_err(|_| incomplete())?;
    let alignment = value
        .get("alignment")
        .ok_or_else(incomplete)?
        .object()
        .map_err(|_| incomplete())?;
    let mismatch = || failure("Async returned mismatched word timestamp arrays");
    let words = alignment
        .get("words")
        .ok_or_else(mismatch)?
        .array()
        .map_err(|_| mismatch())?;
    let starts = alignment
        .get("word_start_times_milliseconds")
        .ok_or_else(mismatch)?
        .array()
        .map_err(|_| mismatch())?;
    let ends = alignment
        .get("word_end_times_milliseconds")
        .ok_or_else(mismatch)?
        .array()
        .map_err(|_| mismatch())?;
    if words.len() != starts.len() || words.len() != ends.len() {
        return Err(mismatch());
    }
    let mut timestamps = Vec::with_capacity(words.len());
    for ((word, start), end) in words.into_iter().zip(starts).zip(ends) {
        let invalid = || failure("Async returned an invalid word timestamp");
        let value = word.string().map_err(|_| invalid())?;
        let start = start.number().map_err(|_| invalid())?;
        let end = end.number().map_err(|_| invalid())?;
        if !start.is_finite() || start < 0.0 || !end.is_finite() || end < start {
            return Err(invalid());
        }
        timestamps.push(WordTimestamp {
            kind: WordTimestampKind,
            value,
            start_time_ms: start,
            end_time_ms: end,
        });
    }
    Ok(TimestampedAudio {
        correlation: TimestampedAudioCorrelation,
        audio: base64::decode(&audio)
            .ok_or_else(|| failure("Async returned invalid base64 audio"))?,
        timestamps,
    })
}

pub(super) fn socket_audio(
    text: &str,
    context_id: &str,
    input_done: bool,
) -> Result<(Vec<u8>, bool), TransportError> {
    let value = Raw::parse(text)
        .and_then(Raw::object)
        .map_err(|_| failure("Async returned an invalid WebSocket message"))?;
    if let (Some(code), Some(message)) = (
        value.get("error_code").and_then(|v| v.string().ok()),
        value.get("message").and_then(|v| v.string().ok()),
    ) {
        return Err(failure(format!(
            "Async synthesis failed ({code}): {message}"
        )));
    }
    let unknown = || failure("Async returned an unknown WebSocket message");
    let id = value
        .get("context_id")
        .ok_or_else(unknown)?
        .string()
        .map_err(|_| unknown())?;
    let audio = value
        .get("audio")
        .ok_or_else(unknown)?
        .string()
        .map_err(|_| unknown())?;
    let final_ = value
        .get("final")
        .ok_or_else(unknown)?
        .boolean()
        .map_err(|_| unknown())?;
    if id != context_id {
        return Err(failure("Async returned output for an unexpected context"));
    }
    if final_ && !input_done {
        return Err(failure(
            "Async finalized the context before input completed",
        ));
    }
    Ok((
        base64::decode(&audio).ok_or_else(|| failure("Async returned invalid base64 audio"))?,
        final_,
    ))
}

pub(super) fn text_message(id: &str, text: &str, force: bool, close: bool) -> String {
    let mut value = String::from("{\"context_id\":");
    json::quote(id, &mut value);
    value.push_str(",\"transcript\":");
    json::quote(text, &mut value);
    value.push_str(if close {
        ",\"close_context\":true}"
    } else if force {
        ",\"force\":true}"
    } else {
        ",\"force\":false}"
    });
    value
}

pub(super) fn validate_url<'a>(url: &'a str, schemes: &[&str]) -> Result<&'a str, TransportError> {
    let tail = schemes
        .iter()
        .find_map(|scheme| url.strip_prefix(scheme))
        .ok_or_else(|| failure("Invalid Async endpoint URL"))?;
    let authority = tail.split(['/', '?']).next().unwrap_or("");
    if authority.is_empty()
        || authority.contains('@')
        || url
            .chars()
            .any(|ch| ch.is_control() || ch.is_whitespace() || matches!(ch, '\\' | '#'))
    {
        return Err(failure("Invalid Async endpoint URL"));
    }
    Ok(url)
}

pub(super) fn socket_url(url: &str, key: &str) -> Result<String, TransportError> {
    validate_url(url, &["ws://", "wss://"])?;
    let (path, query) = url.split_once('?').unwrap_or((url, ""));
    let mut result = format!("{path}?");
    for pair in query.split('&').filter(|pair| !pair.is_empty()) {
        let name = pair.split_once('=').map_or(pair, |(name, _)| name);
        let mut decoded = Vec::new();
        let mut bytes = name.bytes();
        while let Some(byte) = bytes.next() {
            decoded.push(match byte {
                b'+' => b' ',
                b'%' => {
                    let high = bytes.next().and_then(|ch| (ch as char).to_digit(16));
                    let low = bytes.next().and_then(|ch| (ch as char).to_digit(16));
                    match (high, low) {
                        (Some(high), Some(low)) => (high * 16 + low) as u8,
                        _ => return Err(failure("Invalid Async endpoint query")),
                    }
                }
                other => other,
            });
        }
        if decoded == b"api_key" || decoded == b"version" {
            continue;
        }
        result.push_str(pair);
        result.push('&');
    }
    result.push_str("api_key=");
    const HEX: &[u8] = b"0123456789ABCDEF";
    for byte in key.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            result.push(byte as char);
        } else {
            result.push('%');
            result.push(HEX[(byte >> 4) as usize] as char);
            result.push(HEX[(byte & 15) as usize] as char);
        }
    }
    result.push_str("&version=v1");
    Ok(result)
}
