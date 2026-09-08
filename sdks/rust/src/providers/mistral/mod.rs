//! Handwritten Voxtral protocol: the cataloged upstream contracts are incomplete.
mod lifetime;
mod protocol;
#[cfg(test)]
mod tests;
use crate::{
    base64,
    generated::{auth::Auth, mistral::*, mistral_output::*, validators::mistral::validate_request},
    http::{HttpRequest, HttpTransport, TransportError},
    json,
    runtime::InputStream,
    sse::Decoder,
};
pub use lifetime::DeadlineExpired;
use lifetime::Lifetime;
pub use protocol::Error;
use protocol::{decode_event, decode_json, failure};
use std::{
    future::poll_fn,
    pin::Pin,
    task::{Context, Poll},
    time::Duration,
};

pub struct Options<'a> {
    pub auth: Option<&'a Auth>,
    pub base_url: Option<&'a str>,
    /// Omission has no deadline. Explicit zero expires before network access.
    pub timeout: Option<Duration>,
    pub max_event_bytes: usize,
    pub max_json_bytes: usize,
}
impl Default for Options<'_> {
    fn default() -> Self {
        Self {
            auth: None,
            base_url: None,
            timeout: None,
            max_event_bytes: 4 * 1024 * 1024,
            max_json_bytes: 16 * 1024 * 1024,
        }
    }
}

/// The injected transport supplies HTTP/TLS. Drop the pending future or returned
/// stream to cancel. Audio is pulled without a provider-owned prefetch queue.
pub async fn synthesize(
    request: &TtsRequest,
    transport: &dyn HttpTransport,
    options: Options<'_>,
) -> Result<Stream, TransportError> {
    let _check_input = validate_request(request)?;
    let key = match options
        .auth
        .and_then(|auth| auth.mistral.as_ref())
        .and_then(|entry| entry.api_key.as_ref())
    {
        Some(key) => key.clone(),
        None => match std::env::var("SPEECHSWITCH_MISTRAL_API_KEY") {
            Ok(key) => key,
            Err(std::env::VarError::NotPresent) => {
                std::env::var("MISTRAL_API_KEY").unwrap_or_default()
            }
            Err(_) => return Err(failure("Missing auth.mistral.apiKey configuration")),
        },
    };
    if key.is_empty() {
        return Err(failure("Missing auth.mistral.apiKey configuration"));
    }
    if options.max_event_bytes == 0 || options.max_json_bytes == 0 {
        return Err(failure("Mistral response byte limits must be positive"));
    }
    let base = options.base_url.unwrap_or("https://api.mistral.ai");
    let authority = base
        .strip_prefix("https://")
        .or_else(|| base.strip_prefix("http://"))
        .and_then(|tail| tail.split(['/', '?']).next());
    if authority.map_or(true, |host| host.is_empty() || host.contains('@'))
        || base
            .chars()
            .any(|ch| ch.is_control() || ch.is_whitespace() || ch == '\\' || ch == '#')
    {
        return Err(failure(
            "Mistral base_url must be an HTTP(S) URL without credentials or a fragment",
        ));
    }
    let (path, query) = base
        .split_once('?')
        .map_or((base, String::new()), |(path, query)| {
            (path, format!("?{query}"))
        });
    let url = format!("{}/v1/audio/speech{query}", path.trim_end_matches('/'));
    let format = match &request.output {
        None => "pcm",
        Some(TtsRequestOutput::Pcm(value)) => value.format.value(),
        Some(TtsRequestOutput::Object(value)) => match &value.format {
            TtsRequestOutputObjectFormat::Flac(value) => value.value(),
            TtsRequestOutputObjectFormat::Mp3(value) => value.value(),
            TtsRequestOutputObjectFormat::Opus(value) => value.value(),
            TtsRequestOutputObjectFormat::Wav(value) => value.value(),
        },
    };
    let mut body = String::from("{\"model\":");
    json::quote(request.model.unwrap_or_default().value(), &mut body);
    body.push_str(",\"input\":");
    json::quote(&request.text, &mut body);
    body.push_str(",\"stream\":true,\"response_format\":");
    json::quote(format, &mut body);
    for (field, value) in [
        ("voice_id", request.voice.as_ref()),
        ("prompt_cache_key", request.prompt_cache_key.as_ref()),
    ] {
        if let Some(value) = value {
            body.push(',');
            json::quote(field, &mut body);
            body.push(':');
            json::quote(value, &mut body);
        }
    }
    if let Some(audio) = &request.reference_audio {
        body.push_str(",\"ref_audio\":");
        json::quote(&base64::encode(audio), &mut body);
    }
    if let Some(metadata) = &request.metadata {
        body.push_str(",\"metadata\":{");
        for (index, (key, value)) in metadata.iter().enumerate() {
            if index != 0 {
                body.push(',');
            }
            json::quote(key, &mut body);
            body.push(':');
            json::write(value, &mut body)?;
        }
        body.push('}');
    }
    body.push('}');
    let lifetime = Lifetime::new(options.timeout)?;
    let wire = HttpRequest {
        method: "POST".into(),
        url,
        body: body.into_bytes(),
        headers: vec![
            ("Authorization".into(), format!("Bearer {key}")),
            ("Content-Type".into(), "application/json".into()),
            (
                "Accept".into(),
                "text/event-stream, application/json".into(),
            ),
        ],
    };
    let mut pending = transport.send(wire);
    let response = poll_fn(|context| {
        if let Err(error) = lifetime.check(context) {
            return Poll::Ready(Err(error));
        }
        let result = pending.as_mut().poll(context);
        if let Err(error) = lifetime.check(context) {
            return Poll::Ready(Err(error));
        }
        result
    })
    .await?;
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
    let retry_after = response
        .headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case("retry-after"))
        .map(|(_, value)| value.clone());
    lifetime.set_body(response.body)?;
    Ok(Stream {
        lifetime,
        status: response.status,
        content_type,
        retry_after,
        decoder: Decoder::new(options.max_event_bytes)?,
        max_json_bytes: options.max_json_bytes,
        buffer: Vec::new(),
        offset: 0,
        json: Vec::new(),
        json_done: false,
        received_audio: false,
        terminal: false,
    })
}

pub struct Stream {
    lifetime: Lifetime,
    status: u16,
    content_type: String,
    retry_after: Option<String>,
    decoder: Decoder,
    max_json_bytes: usize,
    buffer: Vec<u8>,
    offset: usize,
    json: Vec<u8>,
    json_done: bool,
    received_audio: bool,
    terminal: bool,
}
impl Stream {
    fn next(&mut self, context: &mut Context<'_>) -> Poll<Result<SynthesisItem, TransportError>> {
        self.lifetime.check(context)?;
        if self.json_done {
            return Poll::Ready(Ok(SynthesisItem::Done(DoneEvent {
                event: DoneEventEvent,
                usage: None,
            })));
        }
        if !(200..300).contains(&self.status) || self.content_type == "application/json" {
            match self.lifetime.poll_body(context) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(Some(Err(error))) => return Poll::Ready(Err(error)),
                Poll::Ready(Some(Ok(chunk))) => {
                    if chunk.len() > self.max_json_bytes - self.json.len() {
                        return Poll::Ready(Err(failure(
                            "Mistral response exceeds max_json_bytes",
                        )));
                    }
                    self.json.extend(chunk);
                    context.waker().wake_by_ref();
                    return Poll::Pending;
                }
                Poll::Ready(None) => {}
            }
            let text = String::from_utf8_lossy(&self.json);
            if !(200..300).contains(&self.status) {
                return Poll::Ready(Err(Box::new(Error {
                    status_code: self.status,
                    body: text.into_owned(),
                    retry_after: self.retry_after.take(),
                })));
            }
            let audio = decode_json(&text)?;
            if audio.is_empty() {
                return Poll::Ready(Err(failure("Mistral returned no audio")));
            }
            self.json = Vec::new();
            self.json_done = true;
            return Poll::Ready(Ok(SynthesisItem::Bytes(audio)));
        }
        if self.content_type != "text/event-stream" {
            return Poll::Ready(Err(failure(
                "Mistral returned an unsupported response content type",
            )));
        }
        if self.offset == self.buffer.len() {
            match self.lifetime.poll_body(context) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(None) => {
                    return Poll::Ready(Err(failure(
                        "Mistral speech stream ended before speech.audio.done",
                    )))
                }
                Poll::Ready(Some(Err(error))) => return Poll::Ready(Err(error)),
                Poll::Ready(Some(Ok(chunk))) => {
                    self.buffer = chunk;
                    self.offset = 0;
                }
            }
        }
        while self.offset < self.buffer.len() {
            let message = self.decoder.push(self.buffer[self.offset])?;
            self.offset += 1;
            if let Some(message) = message {
                let item = decode_event(message)?;
                if let SynthesisItem::Bytes(audio) = &item {
                    if audio.is_empty() {
                        continue;
                    }
                    self.received_audio = true;
                } else if !self.received_audio {
                    return Poll::Ready(Err(failure("Mistral returned no audio")));
                }
                return Poll::Ready(Ok(item));
            }
        }
        context.waker().wake_by_ref();
        Poll::Pending
    }
}
impl InputStream<SynthesisItem> for Stream {
    fn poll_next(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
    ) -> Poll<Option<Result<SynthesisItem, TransportError>>> {
        let stream = self.get_mut();
        if stream.terminal {
            return Poll::Ready(None);
        }
        let mut result = stream.next(context);
        if let Err(error) = stream.lifetime.check(context) {
            result = Poll::Ready(Err(error));
        }
        if matches!(
            result,
            Poll::Ready(Err(_)) | Poll::Ready(Ok(SynthesisItem::Done(_)))
        ) {
            stream.terminal = true;
            stream.lifetime.finish();
            stream.decoder.finish();
            stream.buffer = Vec::new();
            stream.json = Vec::new();
        }
        result.map(Some)
    }
}
