//! Typecast's handwritten HTTP protocol over TypeScript-generated contracts.
mod settings;
#[cfg(test)]
mod tests;

pub use crate::generated::{typecast::TtsRequest, typecast_output::SynthesisItem};
use crate::{
    base64, endpoint,
    generated::{auth::Auth, typecast_output::*, validators::typecast::validate_request},
    http::{HttpRequest, HttpTransport, TransportError},
    json::Raw,
    runtime::{InputStream, StreamingInput},
};
use std::{
    pin::Pin,
    task::{Context, Poll},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Protocol {
    Stream,
    Http,
}

pub struct Options<'a> {
    pub auth: Option<&'a Auth>,
    pub base_url: Option<&'a str>,
    /// Omission selects the lowest-latency operation compatible with the request.
    pub protocol: Option<Protocol>,
    /// Caps timestamp JSON only. Raw audio remains unbuffered and uncapped.
    pub max_timestamp_response_bytes: usize,
}
impl Default for Options<'_> {
    fn default() -> Self {
        Self {
            auth: None,
            base_url: None,
            protocol: None,
            max_timestamp_response_bytes: 128 * 1024 * 1024,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct Error {
    pub status: u16,
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Typecast returned HTTP {}", self.status)
    }
}
impl std::error::Error for Error {}
fn failure(message: &str) -> TransportError {
    std::io::Error::new(std::io::ErrorKind::InvalidData, message).into()
}

/// Drop the pending future or returned stream to cancel. Host-executor timeouts
/// can bound both. The backend must return at headers, honor drop cancellation,
/// and reject redirects, retries and ambient credentials. Poll/drop cannot block.
/// The returned stream owns its body and does not borrow the request or backend.
pub async fn synthesize(
    request: &TtsRequest,
    transport: &dyn HttpTransport,
    options: Options<'_>,
) -> Result<Stream, TransportError> {
    let _validate = validate_request(request)?;
    let settings = settings::prepare(request, options.protocol)?;
    let mut key = options
        .auth
        .and_then(|a| a.typecast.as_ref())
        .and_then(|a| a.api_key.clone());
    if key.is_none() {
        for name in ["SPEECHSWITCH_TYPECAST_API_KEY", "TYPECAST_API_KEY"] {
            match std::env::var(name) {
                Ok(value) => {
                    key = Some(value);
                    break;
                }
                Err(std::env::VarError::NotPresent) => {}
                Err(_) => return Err(failure("Invalid Typecast environment credential")),
            }
        }
    }
    let key = key
        .filter(|key| !key.is_empty())
        .ok_or_else(|| failure("Missing auth.typecast.apiKey configuration"))?;
    if !key.bytes().all(|b| (33..=126).contains(&b)) {
        return Err(failure(
            "Typecast API key must contain only visible ASCII characters",
        ));
    }
    let limit = options.max_timestamp_response_bytes;
    if limit == 0 || limit as u128 > 9007199254740991 {
        return Err(failure(
            "Typecast max_timestamp_response_bytes must be a positive safe integer",
        ));
    }
    let base = options.base_url.unwrap_or("https://api.typecast.ai");
    let bytes = base.as_bytes();
    for (index, byte) in bytes.iter().enumerate() {
        if *byte == b'%'
            && !bytes
                .get(index + 1..index + 3)
                .is_some_and(|digits| digits.iter().all(u8::is_ascii_hexdigit))
        {
            return Err(failure("Typecast endpoint must be HTTP(S) without credentials, fragments or invalid escapes"));
        }
    }
    let mut url=endpoint::append(base,&format!("/v1/text-to-speech{}",settings.operation))
        .ok_or_else(||failure("Typecast endpoint must be HTTP(S) without credentials, fragments or invalid escapes"))?;
    if settings.words != settings.characters {
        endpoint::set_query(
            &mut url,
            "granularity",
            if settings.words { "word" } else { "char" },
        )
    } else {
        endpoint::remove_query(&mut url, "granularity")
    }
    .ok_or_else(|| failure("Invalid Typecast endpoint query"))?;
    let timed = settings.words || settings.characters;
    let media = if timed {
        "application/json"
    } else if settings.format == "wav" {
        "audio/wav"
    } else {
        "audio/mpeg"
    };
    let response = transport
        .send(HttpRequest {
            method: "POST".into(),
            url,
            body: settings.body.into_bytes(),
            headers: vec![
                ("X-API-KEY".into(), key),
                ("Content-Type".into(), "application/json".into()),
                ("Accept".into(), media.into()),
            ],
        })
        .await?;
    if !(200..300).contains(&response.status) {
        return Err(Box::new(Error {
            status: response.status,
        }));
    }
    let content_type = response
        .headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case("content-type"))
        .map(|(_, value)| {
            value
                .split(';')
                .next()
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase()
        })
        .unwrap_or_default();
    if !content_type.is_empty()
        && content_type != media
        && (timed || content_type != "application/octet-stream")
    {
        return Err(failure("Typecast returned an unexpected content type"));
    }
    Ok(Stream {
        body: Some(response.body),
        format: settings.format,
        words: settings.words,
        characters: settings.characters,
        limit,
        data: Vec::new(),
        received: false,
        pending_done: false,
    })
}

pub struct Stream {
    body: Option<StreamingInput<Vec<u8>>>,
    format: &'static str,
    words: bool,
    characters: bool,
    limit: usize,
    data: Vec<u8>,
    received: bool,
    pending_done: bool,
}
impl InputStream<SynthesisItem> for Stream {
    fn poll_next(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<SynthesisItem, TransportError>>> {
        let s = self.get_mut();
        if s.pending_done {
            s.pending_done = false;
            return Poll::Ready(Some(Ok(SynthesisItem::Done(DoneEvent {
                event: DoneEventEvent,
            }))));
        }
        let Some(body) = &mut s.body else {
            return Poll::Ready(None);
        };
        match body.as_mut().poll_next(cx) {
            Poll::Pending => Poll::Pending,
            Poll::Ready(Some(Err(err))) => {
                s.body = None;
                s.data = Vec::new();
                Poll::Ready(Some(Err(err)))
            }
            Poll::Ready(Some(Ok(bytes))) => {
                if s.words || s.characters {
                    if bytes.len() > s.limit - s.data.len() {
                        s.body = None;
                        s.data = Vec::new();
                        return Poll::Ready(Some(Err(failure(
                            "Typecast timestamp response exceeds max_timestamp_response_bytes",
                        ))));
                    }
                    s.data.extend_from_slice(&bytes);
                } else if !bytes.is_empty() {
                    s.received = true;
                    return Poll::Ready(Some(Ok(SynthesisItem::Bytes(bytes))));
                }
                // One transport read per poll keeps buffered JSON and empty producers cooperative.
                cx.waker().wake_by_ref();
                Poll::Pending
            }
            Poll::Ready(None) => {
                s.body = None;
                if s.words || s.characters {
                    let data = std::mem::take(&mut s.data);
                    match decode_timestamps(&data, s.format, s.words, s.characters) {
                        Ok(value) => {
                            s.pending_done = true;
                            Poll::Ready(Some(Ok(SynthesisItem::Chunk(value))))
                        }
                        Err(err) => Poll::Ready(Some(Err(err))),
                    }
                } else if !s.received {
                    Poll::Ready(Some(Err(failure("Typecast returned no audio"))))
                } else {
                    Poll::Ready(Some(Ok(SynthesisItem::Done(DoneEvent {
                        event: DoneEventEvent,
                    }))))
                }
            }
        }
    }
}

fn seconds(value: Option<&Raw<'_>>, message: &str) -> Result<f64, TransportError> {
    let number = value
        .and_then(|v| v.number().ok())
        .filter(|v| *v >= 0.0 && (*v * 1000.0).is_finite());
    number.ok_or_else(|| failure(message))
}
fn decode_timestamps(
    data: &[u8],
    format: &str,
    words: bool,
    characters: bool,
) -> Result<TypecastEnvelope, TransportError> {
    let data = data.strip_prefix(&[239, 187, 191]).unwrap_or(data);
    let text =
        std::str::from_utf8(data).map_err(|_| failure("Invalid Typecast timestamp response"))?;
    let value = Raw::parse_exact(text)
        .and_then(Raw::object)
        .map_err(|_| failure("Invalid Typecast timestamp response"))?;
    let duration = seconds(
        value.get("audio_duration"),
        "Invalid Typecast timestamp audio metadata",
    )?;
    if value
        .get("audio_format")
        .and_then(|v| v.string().ok())
        .as_deref()
        != Some(format)
    {
        return Err(failure("Invalid Typecast timestamp audio metadata"));
    }
    let encoded = value
        .get("audio")
        .and_then(|v| v.string().ok())
        .ok_or_else(|| failure("Invalid Typecast base64 audio"))?;
    let audio = base64::decode(&encoded)
        .filter(|v| !v.is_empty() && base64::encode(v) == encoded)
        .ok_or_else(|| failure("Invalid Typecast base64 audio"))?;
    let mut timestamps = Vec::new();
    for (key, required, word) in [("words", words, true), ("characters", characters, false)] {
        let entries = value.get(key);
        if !required && entries.is_some_and(|v| v.is_null()) {
            continue;
        }
        let entries = entries
            .and_then(|v| v.array().ok())
            .ok_or_else(|| failure(&format!("Typecast omitted {key} alignment")))?;
        for entry in entries {
            let entry = entry
                .object()
                .map_err(|_| failure("Invalid Typecast alignment segment"))?;
            let text = entry
                .get("text")
                .and_then(|v| v.string().ok())
                .ok_or_else(|| failure("Invalid Typecast alignment interval"))?;
            let start = seconds(entry.get("start"), "Invalid Typecast alignment interval")?;
            let end = seconds(entry.get("end"), "Invalid Typecast alignment interval")?;
            if end < start {
                return Err(failure("Invalid Typecast alignment interval"));
            }
            if required {
                timestamps.push(TypecastEnvelopeTimestampsItem {
                    kind: if word {
                        TypecastEnvelopeTimestampsItemKind::Word(
                            TypecastEnvelopeTimestampsItemKindWord,
                        )
                    } else {
                        TypecastEnvelopeTimestampsItemKind::Character(
                            TypecastEnvelopeTimestampsItemKindCharacter,
                        )
                    },
                    value: text,
                    start_time_ms: start * 1000.0,
                    end_time_ms: Some(end * 1000.0),
                    source: None,
                });
            }
        }
    }
    Ok(TypecastEnvelope {
        correlation: TypecastEnvelopeCorrelation,
        audio,
        duration_ms: duration * 1000.0,
        timestamps,
    })
}
