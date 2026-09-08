//! Deepdub's handwritten HTTP protocol with canonical generated requests.
mod settings;
mod stream;
#[cfg(test)]
mod tests;

use crate::{
    endpoint,
    entropy::Entropy,
    generated::{auth::Auth, deepdub::TtsRequest, validators::deepdub::validate_request},
    http::{HttpRequest, HttpTransport, TransportError},
};
pub use stream::{Error, Stream};

pub struct Options<'a> {
    pub auth: Option<&'a Auth>,
    pub transport: Option<&'a dyn HttpTransport>,
    pub base_url: Option<&'a str>,
    /// Omission requires OS entropy to mint a UUID; a supplied empty ID is retained.
    pub request_id: Option<&'a str>,
    pub entropy: Option<&'a dyn Entropy>,
    /// Positive bound on the error response body; defaults to 1 MiB.
    pub max_error_bytes: usize,
}
impl Default for Options<'_> {
    fn default() -> Self {
        Self {
            auth: None,
            transport: None,
            base_url: None,
            request_id: None,
            entropy: None,
            max_error_bytes: 1024 * 1024,
        }
    }
}

/// Takes complete text and returns an owned, byte-native stream. Drop this future
/// or returned stream to cancel, including between polls. HTTP/TLS and the executor
/// are supplied by the application; no runtime package or retry is introduced.
pub async fn synthesize(
    request: TtsRequest,
    options: Options<'_>,
) -> Result<Stream, TransportError> {
    let _validate_input = validate_request(&request)?;
    let request = settings::prepare(request)?;
    if options.max_error_bytes == 0 {
        return Err(failure("Deepdub max_error_bytes must be positive"));
    }
    let entry = options.auth.and_then(|auth| auth.deepdub.as_ref());
    let mut key = entry.and_then(|v| v.api_key.clone());
    if key.is_none() {
        for name in ["SPEECHSWITCH_DEEPDUB_API_KEY", "DEEPDUB_API_KEY"] {
            match std::env::var(name) {
                Ok(value) => {
                    key = Some(value);
                    break;
                }
                Err(std::env::VarError::NotPresent) => {}
                Err(_) => return Err(failure("Invalid Deepdub environment credential")),
            }
        }
    }
    let key = key
        .filter(|v| !v.is_empty())
        .ok_or_else(|| failure("Missing auth.deepdub.apiKey configuration"))?;
    let url = endpoint::append(
        options
            .base_url
            .unwrap_or("https://restapi.deepdub.ai/api/v1"),
        "/tts",
    )
    .ok_or_else(|| failure("Invalid Deepdub HTTP endpoint URL"))?;
    let transport = options
        .transport
        .ok_or_else(|| failure("Deepdub HTTP transport is required"))?;
    let id = match options.request_id {
        Some(id) => id.to_owned(),
        None => {
            let entropy = options
                .entropy
                .ok_or_else(|| failure("Deepdub entropy source is required without request_id"))?;
            let mut bytes = [0; 16];
            entropy.fill(&mut bytes)?;
            bytes[6] = bytes[6] & 15 | 64;
            bytes[8] = bytes[8] & 63 | 128;
            let hex: String = bytes.iter().map(|v| format!("{v:02x}")).collect();
            format!(
                "{}-{}-{}-{}-{}",
                &hex[..8],
                &hex[8..12],
                &hex[12..16],
                &hex[16..20],
                &hex[20..]
            )
        }
    };
    let (body, opus) = request.encode(&id);
    let response = transport
        .send(HttpRequest {
            method: "POST".into(),
            url,
            headers: vec![
                ("x-api-key".into(), key),
                ("content-type".into(), "application/json".into()),
            ],
            body: body.into_bytes(),
        })
        .await?;
    Ok(Stream::new(response, id, opus, options.max_error_bytes))
}

fn failure(message: &'static str) -> TransportError {
    Box::new(std::io::Error::other(message))
}
