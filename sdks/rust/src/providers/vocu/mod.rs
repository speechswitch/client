//! Vocu's handwritten HTTP protocol over TypeScript-generated contracts.
mod settings;
#[cfg(test)]
mod tests;
mod wire;

pub use crate::generated::{vocu::TtsRequest, vocu_output::SynthesisItem};
use crate::{
    delay::Delay,
    generated::{auth::Auth, validators::vocu::validate_request, vocu_output::*},
    http::{HttpRequest, HttpResponse, HttpTransport, TransportError},
    runtime::{InputStream, JsonValue, StreamingInput},
};
use std::{
    collections::BTreeMap,
    future::poll_fn,
    pin::Pin,
    task::{Context, Poll},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Stream,
    Http,
    Async,
}

pub struct Options<'a> {
    pub auth: Option<&'a Auth>,
    pub base_url: Option<&'a str>,
    /// Omission selects async for batches/splitters and direct streaming otherwise.
    pub mode: Option<Mode>,
    pub poll_interval_ms: u32,
    /// Bound metadata only, never audio. Defaults to 4 MiB.
    pub max_metadata_bytes: usize,
    /// Additional exact trusted download origins. Credentials are never forwarded.
    pub audio_origins: &'a [&'a str],
}
impl Default for Options<'_> {
    fn default() -> Self {
        Self {
            auth: None,
            base_url: None,
            mode: None,
            poll_interval_ms: 1000,
            max_metadata_bytes: 4 * 1024 * 1024,
            audio_origins: &[],
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct Error {
    pub status: Option<u16>,
    pub job_id: Option<String>,
    pub request_id: Option<String>,
    pub retry_after: Option<String>,
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Some(status) = self.status {
            write!(f, "Vocu returned HTTP {status}")
        } else {
            f.write_str("Vocu generation failed")
        }
    }
}
impl std::error::Error for Error {}
fn failure(message: &str) -> TransportError {
    std::io::Error::new(std::io::ErrorKind::InvalidData, message).into()
}

/// The transport supplies HTTP/TLS, returns at headers and must reject redirects,
/// retries and ambient credentials. Drop the pending future or returned stream
/// to cancel local work. This never claims to cancel an accepted server job.
/// Apply host-executor deadlines to the operation and stream; there is no hidden
/// short queue timeout. The returned stream owns its body, borrowing no backend.
pub async fn synthesize(
    request: &TtsRequest,
    transport: &dyn HttpTransport,
    options: Options<'_>,
) -> Result<Stream, TransportError> {
    let _validate = validate_request(request)?;
    let settings = settings::prepare(request, options.mode)?;
    let explicit = options.auth.and_then(|a| a.vocu.as_ref()).and_then(|a| {
        a.api_key.as_ref().or(if settings.mode == Mode::Async {
            a.access_token.as_ref()
        } else {
            None
        })
    });
    let mut token = explicit.cloned();
    if token.is_none() {
        let names = if settings.mode == Mode::Async {
            &[
                "SPEECHSWITCH_VOCU_API_KEY",
                "VOCU_API_KEY",
                "SPEECHSWITCH_VOCU_ACCESS_TOKEN",
                "VOCU_ACCESS_TOKEN",
            ][..]
        } else {
            &["SPEECHSWITCH_VOCU_API_KEY", "VOCU_API_KEY"][..]
        };
        for name in names {
            match std::env::var(name) {
                Ok(value) => {
                    token = Some(value);
                    break;
                }
                Err(std::env::VarError::NotPresent) => {}
                Err(_) => return Err(failure("Invalid Vocu environment credential")),
            }
        }
    }
    let token = token.filter(|value| !value.is_empty()).ok_or_else(|| {
        failure(if settings.mode == Mode::Async {
            "Missing auth.vocu.apiKey or auth.vocu.accessToken configuration"
        } else {
            "Missing auth.vocu.apiKey configuration"
        })
    })?;
    if !token.bytes().all(|byte| (33..=126).contains(&byte)) {
        return Err(failure(
            "Vocu credential must contain only visible ASCII characters",
        ));
    }
    if options.poll_interval_ms > i32::MAX as u32 {
        return Err(failure(
            "Vocu polling interval must be an integer between 0 and 2147483647",
        ));
    }
    let limit = options.max_metadata_bytes;
    if limit == 0 || limit as u128 > 9007199254740991 {
        return Err(failure(
            "Vocu max_metadata_bytes must be a positive safe integer",
        ));
    }
    let base = options.base_url.unwrap_or("https://v1.vocu.ai");
    wire::origin(base)?;
    if base.contains('?') {
        return Err(failure("Vocu base URL must not contain a query"));
    }
    let mut origins = vec![
        "https://storage.vocu.ai".into(),
        "https://storage.vocu.studio".into(),
        "https://v1.vocu.ai".into(),
        "https://v1.vocu.studio".into(),
    ];
    for address in options.audio_origins {
        let origin = wire::origin(address)?;
        if origin != *address {
            return Err(failure(
                "Vocu audio_origins must contain HTTP(S) origins only",
            ));
        }
        origins.push(origin);
    }
    let endpoint = format!("{}/api/tts/", base.trim_end_matches('/'));
    let mut session = Session {
        transport,
        token,
        endpoint,
        limit,
        request_id: None,
        job_id: None,
    };
    let initial = session
        .send(
            format!(
                "{}{}",
                session.endpoint,
                if settings.mode == Mode::Async {
                    "generate"
                } else {
                    "simple-generate"
                }
            ),
            Some(settings.body),
            true,
        )
        .await?;
    let mut metadata = None;
    let audio = if settings.mode == Mode::Stream {
        initial
    } else {
        let mut result = read_metadata(initial, limit).await?;
        if settings.mode == Mode::Async {
            let id = match result.get("id") {
                Some(JsonValue::String(id))
                    if !id.is_empty()
                        && id.bytes().all(|byte| {
                            byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-')
                        }) =>
                {
                    id.clone()
                }
                _ => return Err(failure("Invalid Vocu job ID")),
            };
            session.job_id = Some(id.clone());
            loop {
                if result.get("id") != Some(&JsonValue::String(id.clone())) {
                    return Err(failure("Vocu returned a different job ID while polling"));
                }
                match result.get("status") {
                    Some(JsonValue::String(status)) if status == "generated" => break,
                    Some(JsonValue::String(status)) if status == "failed" => {
                        return Err(Box::new(Error {
                            status: None,
                            job_id: Some(id),
                            request_id: session.request_id,
                            retry_after: None,
                        }))
                    }
                    Some(JsonValue::String(status))
                        if status == "pending" || status == "processing" => {}
                    _ => return Err(failure("Invalid Vocu job status")),
                }
                Delay::new(options.poll_interval_ms)?.await;
                let response = session
                    .send(format!("{}generate/{id}", session.endpoint), None, true)
                    .await?;
                result = read_metadata(response, session.limit).await?;
            }
        }
        let address = if settings.mode == Mode::Async {
            match result.get("metadata") {
                Some(JsonValue::Object(value)) => value.get("audio"),
                _ => return Err(failure("Invalid Vocu response object")),
            }
        } else {
            match result.get("streamUrl") {
                None | Some(JsonValue::Null) => result.get("audio"),
                value => value,
            }
        };
        let address = match address {
            Some(JsonValue::String(value)) if !value.trim().is_empty() => value,
            _ => return Err(failure("Vocu returned no audio URL")),
        };
        let address = wire::audio_url(base, address, &origins)?;
        metadata = Some(result);
        session.send(address, None, false).await?
    };
    if metadata.is_none() {
        if let Some((_, header)) = audio
            .headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case("x-reecho-response-data"))
        {
            if header.len() > limit {
                return Err(failure("Vocu metadata exceeds max_metadata_bytes"));
            }
            metadata = Some(wire::metadata(header)?);
        }
    }
    if let Some((_, content_type)) = audio
        .headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case("content-type"))
    {
        let media = content_type.split(';').next().unwrap_or("").trim();
        if !media.is_empty()
            && !media.eq_ignore_ascii_case("audio/mpeg")
            && !media.eq_ignore_ascii_case("application/octet-stream")
        {
            return Err(failure("Vocu returned an unexpected audio content type"));
        }
    }
    Ok(Stream {
        body: Some(audio.body),
        received: false,
        done: Some(VocuDoneEvent {
            event: Default::default(),
            completion: if settings.mode == Mode::Async {
                VocuDoneEventCompletion::Generated(Default::default())
            } else {
                VocuDoneEventCompletion::Transport(Default::default())
            },
            metadata: metadata.map(VocuDoneEventMetadata::Record),
            request_id: session.request_id,
        }),
    })
}

struct Session<'a> {
    transport: &'a dyn HttpTransport,
    token: String,
    endpoint: String,
    limit: usize,
    request_id: Option<String>,
    job_id: Option<String>,
}
impl Session<'_> {
    async fn send(
        &mut self,
        url: String,
        body: Option<String>,
        authenticated: bool,
    ) -> Result<HttpResponse, TransportError> {
        let mut headers = Vec::new();
        if authenticated {
            headers.push(("Authorization".into(), format!("Bearer {}", self.token)));
        }
        if body.is_some() {
            headers.push(("Content-Type".into(), "application/json".into()));
        }
        let response = self
            .transport
            .send(HttpRequest {
                method: if body.is_some() { "POST" } else { "GET" }.into(),
                url,
                headers,
                body: body.unwrap_or_default().into_bytes(),
            })
            .await?;
        let trace = response
            .headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case("x-vocu-app-request-id"))
            .map(|(_, value)| value.clone());
        if !(200..300).contains(&response.status) {
            return Err(Box::new(Error {
                status: Some(response.status),
                job_id: self.job_id.clone(),
                request_id: trace,
                retry_after: response
                    .headers
                    .iter()
                    .find(|(key, _)| key.eq_ignore_ascii_case("retry-after"))
                    .map(|(_, value)| value.clone()),
            }));
        }
        if authenticated && trace.is_some() {
            self.request_id = trace;
        }
        Ok(response)
    }
}

async fn read_metadata(
    mut response: HttpResponse,
    limit: usize,
) -> Result<BTreeMap<String, JsonValue>, TransportError> {
    let mut data = Vec::new();
    while let Some(chunk) = poll_fn(|cx| response.body.as_mut().poll_next(cx)).await {
        let chunk = chunk?;
        if chunk.len() > limit - data.len() {
            return Err(failure("Vocu metadata exceeds max_metadata_bytes"));
        }
        data.extend(chunk);
        // Metadata readers can be immediately ready forever; bound work per poll.
        let mut yielded = false;
        poll_fn(|cx| {
            if yielded {
                Poll::Ready(())
            } else {
                yielded = true;
                cx.waker().wake_by_ref();
                Poll::Pending
            }
        })
        .await;
    }
    drop(response);
    let text = std::str::from_utf8(&data).map_err(|_| failure("Invalid Vocu metadata UTF-8"))?;
    let mut value = wire::metadata(text.strip_prefix('\u{feff}').unwrap_or(text))?;
    if value.get("status") != Some(&JsonValue::Number(200.0)) {
        return Err(failure("Invalid Vocu response status"));
    }
    match value.remove("data") {
        Some(JsonValue::Object(value)) => Ok(value),
        _ => Err(failure("Invalid Vocu response object")),
    }
}

/// Pull-based MP3 chunks. Dropping the stream releases its response body.
pub struct Stream {
    body: Option<StreamingInput<Vec<u8>>>,
    received: bool,
    done: Option<VocuDoneEvent>,
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
                s.done = None;
                Poll::Ready(Some(Err(err)))
            }
            Poll::Ready(None) => {
                s.body = None;
                if !s.received {
                    s.done = None;
                    return Poll::Ready(Some(Err(failure("Vocu returned no audio"))));
                }
                Poll::Ready(s.done.take().map(|done| Ok(SynthesisItem::Done(done))))
            }
        }
    }
}
