//! Normalized OpenAI speech over the source-generated wire client.
mod settings;
#[cfg(test)]
mod tests;

pub use crate::generated::{openai::TtsRequest, openai_output::SynthesisItem};
use crate::{
    base64,
    clients::openai as wire,
    generated::{
        auth::Auth,
        openai_output::{DoneEvent, DoneEventEvent, Usage},
        validators::openai::validate_request,
    },
    http::{HttpTransport, TransportError},
    runtime::{InputStream, StreamingInput},
    sse::Decoder,
};
use std::{
    pin::Pin,
    task::{Context, Poll},
};

pub struct Options<'a> {
    pub auth: Option<&'a Auth>,
    /// API root including /v1. Omission selects the source-defined default.
    pub base_url: Option<&'a str>,
    pub max_event_bytes: usize,
    pub max_json_bytes: usize,
}
impl Default for Options<'_> {
    fn default() -> Self {
        Self {
            auth: None,
            base_url: None,
            max_event_bytes: 4 * 1024 * 1024,
            max_json_bytes: 16 * 1024 * 1024,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct Error {
    pub status_code: u16,
    pub body: String,
    pub request_id: Option<String>,
    pub retry_after: Option<String>,
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "OpenAI speech failed ({})", self.status_code)
    }
}
impl std::error::Error for Error {}
fn failure(message: &str) -> TransportError {
    std::io::Error::new(std::io::ErrorKind::InvalidData, message).into()
}

/// Drop the pending future or stream to cancel; an executor timeout can bound
/// both. The backend owns TCP/TLS and must reject redirects, automatic retries
/// and ambient credentials. Poll and drop must not block or buffer complete audio.
pub async fn synthesize(
    request: &TtsRequest,
    transport: &dyn HttpTransport,
    options: Options<'_>,
) -> Result<Stream, TransportError> {
    let _check = validate_request(request)?;
    let key = match options
        .auth
        .and_then(|a| a.openai.as_ref())
        .and_then(|a| a.api_key.as_ref())
    {
        Some(key) => key.clone(),
        None => match std::env::var("SPEECHSWITCH_OPENAI_API_KEY") {
            Ok(key) => key,
            Err(std::env::VarError::NotPresent) => match std::env::var("OPENAI_API_KEY") {
                Ok(key) => key,
                Err(_) => return Err(failure("Missing auth.openai.apiKey configuration")),
            },
            Err(_) => return Err(failure("Missing auth.openai.apiKey configuration")),
        },
    };
    if key.is_empty() {
        return Err(failure("Missing auth.openai.apiKey configuration"));
    }
    if !key.bytes().all(|b| (32..=126).contains(&b)) {
        return Err(failure("Invalid OpenAI authentication header"));
    }
    if options.max_event_bytes == 0 || options.max_json_bytes == 0 {
        return Err(failure("OpenAI response byte limits must be positive"));
    }
    let decoder = Decoder::new(options.max_event_bytes)?;
    let (input, usage) = settings::settings(request);
    let response = wire::create_speech(
        &input,
        &key,
        options.base_url.unwrap_or(wire::DEFAULT_BASE_URL),
        transport,
    )
    .await?;
    let mut content_type = String::new();
    let mut request_id = None;
    let mut retry_after = None;
    for (name, value) in response.headers {
        match name.to_ascii_lowercase().as_str() {
            "content-type" => {
                content_type = value
                    .split(';')
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_ascii_lowercase()
            }
            "x-request-id" => request_id = Some(value),
            "retry-after" => retry_after = Some(value),
            _ => {}
        }
    }
    Ok(Stream {
        body: Some(response.body),
        status: response.status,
        content_type,
        request_id,
        retry_after,
        decoder,
        usage,
        received_audio: false,
        max_json_bytes: options.max_json_bytes,
        buffer: Vec::new(),
        offset: 0,
        error_body: Vec::new(),
    })
}

pub struct Stream {
    body: Option<StreamingInput<Vec<u8>>>,
    status: u16,
    content_type: String,
    request_id: Option<String>,
    retry_after: Option<String>,
    decoder: Decoder,
    usage: bool,
    received_audio: bool,
    max_json_bytes: usize,
    buffer: Vec<u8>,
    offset: usize,
    error_body: Vec<u8>,
}
impl Stream {
    fn next(&mut self, cx: &mut Context<'_>) -> Poll<Result<SynthesisItem, TransportError>> {
        let body = self.body.as_mut().expect("body checked by poll_next");
        if self.status != wire::SPEECH_STATUS {
            match body.as_mut().poll_next(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(Some(Err(error))) => return Poll::Ready(Err(error)),
                Poll::Ready(Some(Ok(chunk))) => {
                    if chunk.len() > self.max_json_bytes - self.error_body.len() {
                        return Poll::Ready(Err(failure("OpenAI response exceeds max_json_bytes")));
                    }
                    self.error_body.extend(chunk);
                    cx.waker().wake_by_ref();
                    return Poll::Pending;
                }
                Poll::Ready(None) => {
                    return Poll::Ready(Err(Box::new(Error {
                        status_code: self.status,
                        body: String::from_utf8_lossy(&self.error_body).into_owned(),
                        request_id: self.request_id.take(),
                        retry_after: self.retry_after.take(),
                    })))
                }
            }
        }
        if !self.usage {
            if !self.content_type.is_empty()
                && self.content_type != "application/octet-stream"
                && !self.content_type.starts_with("audio/")
            {
                return Poll::Ready(Err(failure("OpenAI returned a non-audio response")));
            }
            return match body.as_mut().poll_next(cx) {
                Poll::Pending => Poll::Pending,
                Poll::Ready(Some(Err(error))) => Poll::Ready(Err(error)),
                Poll::Ready(Some(Ok(audio))) if audio.is_empty() => {
                    cx.waker().wake_by_ref();
                    Poll::Pending
                }
                Poll::Ready(Some(Ok(audio))) => {
                    self.received_audio = true;
                    Poll::Ready(Ok(SynthesisItem::Bytes(audio)))
                }
                Poll::Ready(None) if !self.received_audio => {
                    Poll::Ready(Err(failure("OpenAI returned no audio")))
                }
                Poll::Ready(None) => Poll::Ready(Ok(SynthesisItem::Done(DoneEvent {
                    event: DoneEventEvent,
                    request_id: self.request_id.take(),
                    usage: None,
                }))),
            };
        }
        if self.content_type != "text/event-stream" {
            return Poll::Ready(Err(failure("OpenAI returned no SSE usage stream")));
        }
        if self.offset == self.buffer.len() {
            match body.as_mut().poll_next(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(None) => {
                    return Poll::Ready(Err(failure(
                        "OpenAI speech stream ended before speech.audio.done",
                    )))
                }
                Poll::Ready(Some(Err(error))) => return Poll::Ready(Err(error)),
                Poll::Ready(Some(Ok(chunk))) => {
                    self.buffer = chunk;
                    self.offset = 0;
                }
            }
        }
        // Bound immediately-ready work, including huge comment-only backend chunks.
        let end = self.offset + (self.buffer.len() - self.offset).min(8192);
        while self.offset < end {
            let message = self.decoder.push(self.buffer[self.offset])?;
            self.offset += 1;
            let Some(message) = message else { continue };
            let event = wire::decode_speech_event(&message.data)?;
            match event {
                wire::SpeechEvent::Variant0(event) => {
                    if message.event != "message" && message.event != event.type_ {
                        return Poll::Ready(Err(failure(
                            "OpenAI returned conflicting SSE event types",
                        )));
                    }
                    let audio = base64::decode(&event.audio)
                        .ok_or_else(|| failure("OpenAI returned invalid base64 audio"))?;
                    if audio.is_empty() {
                        continue;
                    }
                    self.received_audio = true;
                    return Poll::Ready(Ok(SynthesisItem::Bytes(audio)));
                }
                wire::SpeechEvent::Variant1(event) => {
                    if message.event != "message" && message.event != event.type_ {
                        return Poll::Ready(Err(failure(
                            "OpenAI returned conflicting SSE event types",
                        )));
                    }
                    if !self.received_audio {
                        return Poll::Ready(Err(failure("OpenAI returned no audio")));
                    }
                    let usage = event.usage;
                    return Poll::Ready(Ok(SynthesisItem::Done(DoneEvent {
                        event: DoneEventEvent,
                        request_id: self.request_id.take(),
                        usage: Some(Usage {
                            input_tokens: usage.input_tokens,
                            output_tokens: usage.output_tokens,
                            total_tokens: usage.total_tokens,
                        }),
                    })));
                }
            }
        }
        cx.waker().wake_by_ref();
        Poll::Pending
    }
}
impl InputStream<SynthesisItem> for Stream {
    fn poll_next(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<SynthesisItem, TransportError>>> {
        let s = self.get_mut();
        if s.body.is_none() {
            return Poll::Ready(None);
        }
        let result = s.next(cx);
        if matches!(
            result,
            Poll::Ready(Err(_)) | Poll::Ready(Ok(SynthesisItem::Done(_)))
        ) {
            s.body = None;
            s.decoder.finish();
            s.buffer = Vec::new();
            s.error_body = Vec::new();
        }
        result.map(Some)
    }
}
