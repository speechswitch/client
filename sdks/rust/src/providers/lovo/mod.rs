//! LOVO job orchestration over its generated OpenAPI wire client.
mod delay;
mod stream;
#[cfg(test)]
mod tests;
pub use crate::generated::{lovo::TtsRequest, lovo_output::SynthesisItem};
use crate::{
    clients::lovo as wire,
    endpoint,
    generated::{auth::Auth, validators::lovo::validate_request},
    http::{HttpResponse, HttpTransport, TransportError},
    json::Raw,
};
use std::{future::poll_fn, task::Poll};
pub use stream::Stream;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Mode {
    #[default]
    Sync,
    Async,
}
pub struct Options<'a> {
    pub auth: Option<&'a Auth>,
    pub base_url: Option<&'a str>,
    pub mode: Mode,
    pub poll_interval_ms: u32,
    pub max_json_bytes: usize,
}
impl Default for Options<'_> {
    fn default() -> Self {
        Self {
            auth: None,
            base_url: None,
            mode: Mode::Sync,
            poll_interval_ms: 1000,
            max_json_bytes: 16 * 1024 * 1024,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct Error {
    pub message: String,
    pub status_code: Option<u16>,
    pub code: Option<String>,
    pub job_id: Option<String>,
    pub retry_after: Option<String>,
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}
impl std::error::Error for Error {}
fn failure(message: &str) -> TransportError {
    std::io::Error::new(std::io::ErrorKind::InvalidData, message).into()
}
fn native_error(value: wire::JobErrorResponse, id: &str) -> TransportError {
    Box::new(Error {
        message: value.message,
        code: Some(value.code),
        job_id: Some(id.into()),
        status_code: None,
        retry_after: None,
    })
}

/// The transport supplies HTTP/TLS and must reject redirects and retries.
/// Drop the pending future or returned stream to stop local work. This does not
/// send a remote cancel command. Every output is checked before any download.
pub async fn synthesize<'a>(
    request: &TtsRequest,
    transport: &'a dyn HttpTransport,
    options: Options<'_>,
) -> Result<Stream<'a>, TransportError> {
    let _validate_input = validate_request(request)?;
    if options.poll_interval_ms > i32::MAX as u32 {
        return Err(failure(
            "LOVO polling interval must be an integer between 0 and 2147483647",
        ));
    }
    if options.max_json_bytes == 0 || options.max_json_bytes > u32::MAX as usize {
        return Err(failure(
            "LOVO max_json_bytes must be a positive uint32 value",
        ));
    }
    let mut key = options
        .auth
        .and_then(|a| a.lovo.as_ref())
        .and_then(|a| a.api_key.clone());
    if key.is_none() {
        for name in ["SPEECHSWITCH_LOVO_API_KEY", "LOVO_API_KEY"] {
            match std::env::var(name) {
                Ok(value) => {
                    key = Some(value);
                    break;
                }
                Err(std::env::VarError::NotPresent) => {}
                Err(_) => return Err(failure("Invalid LOVO environment credential")),
            }
        }
    }
    let key = key.unwrap_or_default();
    if key.is_empty() {
        return Err(failure("Missing auth.lovo.apiKey configuration"));
    }
    if !key.bytes().all(|byte| (32..=126).contains(&byte)) {
        return Err(failure("Invalid LOVO authentication header"));
    }
    let base = options.base_url.unwrap_or(wire::DEFAULT_BASE_URL);
    let base_origin = origin(base)?;
    let (id, mut kind, mut status, mut error, mut outputs) = match options.mode {
        Mode::Sync => {
            let response = wire::create_speech(
                &wire::CreateSpeechInput {
                    text: request.text.clone(),
                    speaker: request.voice.clone(),
                    speaker_style: request.voice_style.clone(),
                    speed: Some(request.speed.unwrap_or(1.0)),
                    ..Default::default()
                },
                &key,
                base,
                transport,
            )
            .await?;
            let job = wire::decode_create_speech(
                &metadata(response, wire::CREATE_SPEECH_STATUS, options.max_json_bytes).await?,
            )?;
            (job.id, job.type_, job.status, job.error, job.data)
        }
        Mode::Async => {
            let response = wire::create_speech_job(
                &wire::CreateSpeechJobInput {
                    text: request.text.clone(),
                    speaker: request.voice.clone(),
                    speaker_style: request.voice_style.clone(),
                    speed: Some(request.speed.unwrap_or(1.0)),
                    ..Default::default()
                },
                &key,
                base,
                transport,
            )
            .await?;
            let job = wire::decode_create_speech_job(
                &metadata(
                    response,
                    wire::CREATE_SPEECH_JOB_STATUS,
                    options.max_json_bytes,
                )
                .await?,
            )?;
            (job.id, job.type_, job.status, job.error, Vec::new())
        }
    };
    if id.is_empty() || id == "." || id == ".." {
        return Err(failure("LOVO returned an invalid job ID"));
    }
    let mut completed = options.mode == Mode::Sync;
    loop {
        if kind != "tts" && kind != "simple_tts" {
            return Err(failure("LOVO returned a non-TTS job"));
        }
        if let Some(error) = error {
            return Err(native_error(error, &id));
        }
        if status == "done" {
            if !completed {
                let job = poll(&id, &key, base, transport, options.max_json_bytes).await?;
                if job.id != id
                    || job.status != "done"
                    || (job.type_ != "tts" && job.type_ != "simple_tts")
                {
                    return Err(failure("LOVO returned an inconsistent completed job"));
                }
                if let Some(error) = job.error {
                    return Err(native_error(error, &id));
                }
                outputs = job.data;
            }
            break;
        }
        delay::Delay::new(options.poll_interval_ms)?.await;
        let job = poll(&id, &key, base, transport, options.max_json_bytes).await?;
        if job.id != id {
            return Err(failure("LOVO returned a different job ID while polling"));
        }
        kind = job.type_;
        status = job.status;
        error = job.error;
        outputs = job.data;
        completed = true;
    }
    if outputs.is_empty() {
        return Err(failure("LOVO completed without audio outputs"));
    }
    let mut assets = Vec::new();
    for (output_index, output) in outputs.into_iter().enumerate() {
        if let Some(error) = output.error {
            return Err(native_error(error, &id));
        }
        if output.status == "failed" {
            return Err(Box::new(Error {
                message: "LOVO speech output failed".into(),
                status_code: None,
                code: None,
                job_id: Some(id),
                retry_after: None,
            }));
        }
        let urls = output.urls.unwrap_or_default();
        if output.status != "succeeded" || urls.is_empty() {
            return Err(failure("LOVO completed without usable audio URLs"));
        }
        for (index, url) in urls.into_iter().enumerate() {
            let asset_origin = origin(&url)?;
            if !asset_origin.starts_with("https://") && asset_origin != base_origin {
                return Err(failure("LOVO returned an unsafe audio URL"));
            }
            assets.push(stream::Asset {
                url,
                correlation_id: format!("{id}:{output_index}:{index}"),
                input_group_id: format!("{id}:{output_index}"),
            });
        }
    }
    Ok(Stream::new(transport, assets, id, options.max_json_bytes))
}

async fn poll(
    id: &str,
    key: &str,
    base: &str,
    transport: &dyn HttpTransport,
    limit: usize,
) -> Result<wire::GetSpeechJobResponse, TransportError> {
    let response = wire::get_speech_job(
        &wire::GetSpeechJobInput {
            job_id: id.into(),
            ..Default::default()
        },
        key,
        base,
        transport,
    )
    .await?;
    wire::decode_get_speech_job(&metadata(response, wire::GET_SPEECH_JOB_STATUS, limit).await?)
}
async fn read(mut response: HttpResponse, limit: usize) -> Result<String, TransportError> {
    let mut data = Vec::new();
    while let Some(chunk) = poll_fn(|cx| response.body.as_mut().poll_next(cx)).await {
        let chunk = chunk?;
        if chunk.len() > limit - data.len() {
            return Err(failure("LOVO response exceeds max_json_bytes"));
        }
        data.extend(chunk);
        // Bound work per poll even if the transport produces endlessly-ready chunks.
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
    let text = String::from_utf8_lossy(&data);
    Ok(text.strip_prefix('\u{feff}').unwrap_or(&text).to_owned())
}
async fn metadata(
    response: HttpResponse,
    expected: u16,
    limit: usize,
) -> Result<String, TransportError> {
    let status = response.status;
    let retry_after = retry_after(&response);
    let text = read(response, limit).await?;
    if status != expected {
        return Err(Box::new(Error {
            message: if text.is_empty() {
                format!("LOVO returned HTTP {status}; expected {expected}")
            } else {
                text
            },
            status_code: Some(status),
            code: None,
            job_id: None,
            retry_after,
        }));
    }
    if Raw::parse(&text).is_err() {
        return Err(failure("LOVO returned invalid JSON"));
    }
    Ok(text)
}
fn retry_after(response: &HttpResponse) -> Option<String> {
    let values: Vec<_> = response
        .headers
        .iter()
        .filter(|(key, _)| key.eq_ignore_ascii_case("retry-after"))
        .map(|(_, value)| value.as_str())
        .collect();
    if values.is_empty() {
        None
    } else {
        Some(values.join(", "))
    }
}
fn origin(url: &str) -> Result<String, TransportError> {
    let invalid =
        || failure("LOVO URL must be HTTP(S) without credentials, fragments or invalid escapes");
    endpoint::validate(url, &["http", "https"]).ok_or_else(invalid)?;
    let mut bytes = url.bytes();
    while let Some(byte) = bytes.next() {
        if byte == b'%'
            && (!bytes.next().map_or(false, |b| b.is_ascii_hexdigit())
                || !bytes.next().map_or(false, |b| b.is_ascii_hexdigit()))
        {
            return Err(invalid());
        }
    }
    let (scheme, tail) = url.split_once("://").ok_or_else(invalid)?;
    let scheme = scheme.to_ascii_lowercase();
    let authority = tail.split(['/', '?']).next().ok_or_else(invalid)?;
    let (host, port) = if authority.starts_with('[') {
        let end = authority.find(']').ok_or_else(invalid)?;
        (&authority[..=end], authority[end + 1..].strip_prefix(':'))
    } else {
        authority
            .split_once(':')
            .map_or((authority, None), |(host, port)| (host, Some(port)))
    };
    let port = match port {
        Some(port) => port.parse::<u16>().map_err(|_| invalid())?,
        None => {
            if scheme == "https" {
                443
            } else {
                80
            }
        }
    };
    Ok(format!("{scheme}://{}:{port}", host.to_ascii_lowercase()))
}
