//! Handwritten Chatterbox Gradio upload, queue and completed-file protocol.
mod settings;
#[cfg(test)]
mod tests;
mod urls;

pub use crate::generated::{resemble::TtsRequest, resemble_output::SynthesisItem};
use crate::{
    generated::{
        auth::Auth,
        resemble_output::{DoneEvent, DoneEventEvent},
        validators::resemble::validate_request,
    },
    http::{HttpRequest, HttpResponse, HttpTransport, TransportError},
    json::{self, Raw},
    runtime::{InputStream, StreamingInput},
    sse::Decoder,
};
use std::{
    future::poll_fn,
    pin::Pin,
    task::{Context, Poll},
};
use urls::{component, Url};

pub struct Options<'a> {
    pub auth: Option<&'a Auth>,
    /// Deployment root; omission selects the model's official Space.
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
    pub status_code: Option<u16>,
    pub body: String,
    pub request_id: Option<String>,
    pub retry_after: Option<String>,
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self.status_code {
            Some(status) => write!(f, "Resemble Chatterbox returned HTTP {status}"),
            None => f.write_str("Resemble Chatterbox generation failed"),
        }
    }
}
impl std::error::Error for Error {}
fn failure(message: &str) -> TransportError {
    std::io::Error::new(std::io::ErrorKind::InvalidData, message).into()
}

async fn read(mut body: StreamingInput<Vec<u8>>, limit: usize) -> Result<String, TransportError> {
    let mut data = Vec::new();
    poll_fn(|cx| match body.as_mut().poll_next(cx) {
        Poll::Pending => Poll::Pending,
        Poll::Ready(None) => Poll::Ready(Ok(())),
        Poll::Ready(Some(Err(err))) => Poll::Ready(Err(err)),
        Poll::Ready(Some(Ok(chunk))) => {
            if chunk.len() > limit - data.len() {
                return Poll::Ready(Err(failure("Resemble response exceeds max_json_bytes")));
            }
            data.extend(chunk);
            cx.waker().wake_by_ref();
            Poll::Pending
        }
    })
    .await?;
    let text = String::from_utf8_lossy(&data);
    Ok(text.strip_prefix('\u{feff}').unwrap_or(&text).to_owned())
}
async fn send(
    transport: &dyn HttpTransport,
    method: &str,
    url: String,
    headers: &[(String, String)],
    body: Vec<u8>,
    request_id: Option<&str>,
    limit: usize,
) -> Result<HttpResponse, TransportError> {
    let response = transport
        .send(HttpRequest {
            method: method.into(),
            url,
            headers: headers.to_vec(),
            body,
        })
        .await?;
    if !(200..300).contains(&response.status) {
        let retry_after = response
            .headers
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case("retry-after"))
            .map(|(_, value)| value.clone());
        return Err(Box::new(Error {
            status_code: Some(response.status),
            body: read(response.body, limit).await?,
            request_id: request_id.map(str::to_owned),
            retry_after,
        }));
    }
    Ok(response)
}
fn parse(text: &str) -> Result<Raw<'_>, TransportError> {
    Raw::parse(text).map_err(|_| failure("Resemble returned invalid JSON"))
}
fn file(value: Raw<'_>) -> Result<(String, Option<String>), TransportError> {
    let decode = || -> Result<_, json::Error> {
        let object = value.object()?;
        let path = object.get("path").ok_or(json::Error)?.string()?;
        if path.is_empty() {
            return Err(json::Error);
        }
        let url = match object.get("url") {
            Some(value) if !value.is_null() => Some(value.string()?),
            _ => None,
        };
        if let Some(value) = object.get("is_stream") {
            if value.boolean()? {
                return Err(json::Error);
            }
        }
        if let Some(value) = object.get("meta") {
            if value.object()?.get("_type").ok_or(json::Error)?.string()? != "gradio.FileData" {
                return Err(json::Error);
            }
        }
        Ok((path, url))
    };
    decode().map_err(|_| failure("Resemble returned an invalid audio file"))
}
fn default_reference(info: &str) -> Result<String, TransportError> {
    let root = parse(info)?;
    let parameter = || -> Result<Raw<'_>, json::Error> {
        let root = root.object()?;
        let endpoints = root.get("named_endpoints").ok_or(json::Error)?.object()?;
        let generate = endpoints.get("/generate").ok_or(json::Error)?.object()?;
        let parameters = generate.get("parameters").ok_or(json::Error)?.array()?;
        let parameter = parameters.get(1).ok_or(json::Error)?.object()?;
        if parameter
            .get("parameter_name")
            .ok_or(json::Error)?
            .string()?
            != "audio_prompt_path"
        {
            return Err(json::Error);
        }
        parameter
            .get("parameter_default")
            .copied()
            .ok_or(json::Error)
    };
    // /info's URL is a generic example; the cached path is the actual reference.
    Ok(
        file(
            parameter().map_err(|_| failure("Resemble returned no default reference recording"))?,
        )?
        .0,
    )
}
async fn completed_file(
    mut response: HttpResponse,
    request_id: &str,
    mut decoder: Decoder,
) -> Result<(String, Option<String>), TransportError> {
    if content_type(&response.headers) != "text/event-stream" {
        return Err(failure("Resemble returned no event stream"));
    }
    let mut buffer = Vec::new();
    let mut offset = 0;
    poll_fn(|cx| {
        let mut budget = 8192;
        loop {
            if offset == buffer.len() {
                match response.body.as_mut().poll_next(cx) {
                    Poll::Pending => return Poll::Pending,
                    Poll::Ready(None) => {
                        return Poll::Ready(Err(failure(
                            "Resemble event stream ended before completion",
                        )))
                    }
                    Poll::Ready(Some(Err(err))) => return Poll::Ready(Err(err)),
                    Poll::Ready(Some(Ok(bytes))) => {
                        buffer = bytes;
                        offset = 0;
                    }
                }
                if buffer.is_empty() {
                    cx.waker().wake_by_ref();
                    return Poll::Pending;
                }
            }
            while offset < buffer.len() && budget > 0 {
                let message = match decoder.push(buffer[offset]) {
                    Ok(v) => v,
                    Err(err) => return Poll::Ready(Err(Box::new(err) as TransportError)),
                };
                offset += 1;
                budget -= 1;
                if let Some(message) = message {
                    match message.event.as_str() {
                        "heartbeat" => {}
                        "error" => {
                            return Poll::Ready(Err(Box::new(Error {
                                status_code: None,
                                body: message.data,
                                request_id: Some(request_id.into()),
                                retry_after: None,
                            })))
                        }
                        "complete" => {
                            return Poll::Ready((|| {
                                let value = parse(&message.data)?;
                                let output = value.array().map_err(|_| {
                                    failure("Resemble returned an invalid output list")
                                })?;
                                if output.len() != 1 {
                                    return Err(failure(
                                        "Resemble returned an invalid output list",
                                    ));
                                }
                                file(output[0])
                            })())
                        }
                        _ => {
                            return Poll::Ready(Err(failure(&format!(
                                "Unexpected Resemble event: {}",
                                message.event
                            ))))
                        }
                    }
                }
            }
            if budget == 0 {
                cx.waker().wake_by_ref();
                return Poll::Pending;
            }
        }
    })
    .await
}
fn content_type(headers: &[(String, String)]) -> String {
    headers
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("content-type"))
        .map_or(String::new(), |(_, value)| {
            value
                .split(';')
                .next()
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase()
        })
}

/// Await upload/queue/download headers, then consume the owned audio stream.
/// Drop the pending future or stream to release local HTTP resources. The host
/// executor can impose a deadline; no remote GPU cancellation is promised.
/// The injected backend supplies HTTP/TLS, rejects redirects/retries and adds
/// no cookies or credentials to off-origin file requests.
pub async fn synthesize(
    request: &TtsRequest,
    transport: &dyn HttpTransport,
    options: Options<'_>,
) -> Result<Stream, TransportError> {
    let _check = validate_request(request)?;
    if options.max_event_bytes == 0 || options.max_json_bytes == 0 {
        return Err(failure("Resemble response byte limits must be positive"));
    }
    let input = settings::settings(request);
    let mut base = Url::parse(options.base_url.unwrap_or(input.host))?;
    base.root();
    let mut token = options
        .auth
        .and_then(|a| a.resemble.as_ref())
        .and_then(|a| a.token.clone());
    if token.is_none() {
        for name in ["SPEECHSWITCH_RESEMBLE_TOKEN", "HF_TOKEN"] {
            match std::env::var(name) {
                Ok(value) => {
                    token = Some(value);
                    break;
                }
                Err(std::env::VarError::NotPresent) => {}
                Err(_) => return Err(failure("Invalid Resemble environment token")),
            }
        }
    }
    let token = token.unwrap_or_default();
    if !token.bytes().all(|b| (32..=126).contains(&b)) {
        return Err(failure("Invalid Resemble token"));
    }
    let headers = if token.is_empty() {
        vec![]
    } else {
        vec![("Authorization".into(), format!("Bearer {token}"))]
    };
    let decoder = Decoder::new(options.max_event_bytes)?;
    let reference = if let Some(audio) = input.reference {
        // A multipart boundary is framing, not a secret. Select one absent from
        // the reference so arbitrary bytes cannot create additional form parts.
        let mut count = 0u64;
        let boundary = loop {
            let candidate = format!("speechswitch-reference-{count}");
            if !audio
                .windows(candidate.len())
                .any(|w| w == candidate.as_bytes())
            {
                break candidate;
            }
            count += 1;
        };
        let mut payload = format!("--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"reference.audio\"\r\nContent-Type: application/octet-stream\r\n\r\n").into_bytes();
        payload.extend_from_slice(audio);
        payload.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        let mut upload_headers = headers.clone();
        upload_headers.push((
            "Content-Type".into(),
            format!("multipart/form-data; boundary={boundary}"),
        ));
        let response = send(
            transport,
            "POST",
            base.endpoint("upload"),
            &upload_headers,
            payload,
            None,
            options.max_json_bytes,
        )
        .await?;
        let text = read(response.body, options.max_json_bytes).await?;
        let paths = parse(&text)?
            .array()
            .map_err(|_| failure("Resemble returned an invalid upload path"))?;
        if paths.len() != 1 {
            return Err(failure("Resemble returned an invalid upload path"));
        }
        let path = paths[0]
            .string()
            .map_err(|_| failure("Resemble returned an invalid upload path"))?;
        if path.is_empty() {
            return Err(failure("Resemble returned an invalid upload path"));
        }
        Some(path)
    } else if input.needs_reference {
        let response = send(
            transport,
            "GET",
            base.endpoint("info"),
            &headers,
            vec![],
            None,
            options.max_json_bytes,
        )
        .await?;
        Some(default_reference(
            &read(response.body, options.max_json_bytes).await?,
        )?)
    } else {
        None
    };
    let mut payload = input.prefix;
    if let Some(reference) = reference {
        payload.push_str("{\"path\":");
        json::quote(&reference, &mut payload);
        payload.push_str(",\"meta\":{\"_type\":\"gradio.FileData\"}}");
    } else {
        payload.push_str("null");
    }
    payload.push_str(&input.suffix);
    let mut json_headers = headers.clone();
    json_headers.push(("Content-Type".into(), "application/json".into()));
    let response = send(
        transport,
        "POST",
        base.endpoint(&format!("call/{}", input.api)),
        &json_headers,
        payload.into_bytes(),
        None,
        options.max_json_bytes,
    )
    .await?;
    let text = read(response.body, options.max_json_bytes).await?;
    let id = parse(&text)?
        .object()
        .ok()
        .and_then(|o| o.get("event_id").and_then(|v| v.string().ok()))
        .filter(|v| !v.is_empty() && v != "." && v != "..")
        .ok_or_else(|| failure("Resemble returned an invalid event ID"))?;
    let response = send(
        transport,
        "GET",
        base.endpoint(&format!("call/{}/{}", input.api, component(&id))),
        &headers,
        vec![],
        Some(&id),
        options.max_json_bytes,
    )
    .await?;
    let (path, url) = completed_file(response, &id, decoder).await?;
    let asset = if let Some(url) = url.filter(|v| !v.is_empty()) {
        base.resolve(&url)?
    } else {
        Url::parse(&base.endpoint(&format!("file={}", component(&path))))?
    };
    let same_origin = asset.same_origin(&base);
    if asset.scheme != "https" && !same_origin {
        return Err(failure("Resemble returned an unsafe audio URL"));
    }
    let response = send(
        transport,
        "GET",
        asset.text(),
        if same_origin { &headers } else { &[] },
        vec![],
        Some(&id),
        options.max_json_bytes,
    )
    .await?;
    let media = content_type(&response.headers);
    if !media.is_empty() && media != "application/octet-stream" && !media.starts_with("audio/") {
        return Err(failure("Resemble returned no audio stream"));
    }
    Ok(Stream {
        body: Some(response.body),
        request_id: id,
        received: false,
    })
}

pub struct Stream {
    body: Option<StreamingInput<Vec<u8>>>,
    request_id: String,
    received: bool,
}
impl InputStream<SynthesisItem> for Stream {
    fn poll_next(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<SynthesisItem, TransportError>>> {
        let s = self.get_mut();
        let Some(body) = &mut s.body else {
            return Poll::Ready(None);
        };
        match body.as_mut().poll_next(cx) {
            Poll::Pending => Poll::Pending,
            Poll::Ready(Some(Ok(bytes))) if bytes.is_empty() => {
                cx.waker().wake_by_ref();
                Poll::Pending
            }
            Poll::Ready(Some(Ok(bytes))) => {
                s.received = true;
                Poll::Ready(Some(Ok(SynthesisItem::Bytes(bytes))))
            }
            Poll::Ready(Some(Err(err))) => {
                s.body = None;
                Poll::Ready(Some(Err(err)))
            }
            Poll::Ready(None) => {
                s.body = None;
                Poll::Ready(Some(if s.received {
                    Ok(SynthesisItem::Done(DoneEvent {
                        event: DoneEventEvent,
                        request_id: std::mem::take(&mut s.request_id),
                    }))
                } else {
                    Err(failure("Resemble returned empty audio"))
                }))
            }
        }
    }
}
