//! Google model-specific requests over generated REST/protobuf clients.
mod protobuf;
mod rest;
mod settings;
mod stream;
#[cfg(test)]
mod tests;

use crate::{
    clients::{google_grpc, google_grpc_beta, google_rest, google_rest_beta},
    endpoint,
    generated::{auth::Auth, google::TtsRequest, validators::google::validate_request},
    grpc::{self, Call},
    http::{HttpTransport, TransportError},
    http2::Http2Transport,
};
use settings::Model;
pub use stream::Stream;

#[derive(Debug, PartialEq, Eq)]
pub enum Error {
    Invalid(&'static str),
    InputBytes(usize),
    UnknownSpeaker(String),
    Http { status: u16, message: String },
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid(message) => f.write_str(message),
            Self::InputBytes(limit) => write!(f, "Google input exceeds {limit} UTF-8 bytes"),
            Self::UnknownSpeaker(name) => write!(f, "Unknown Google dialogue speaker: {name}"),
            Self::Http { status, message } => write!(f, "Google {status}: {message}"),
        }
    }
}
impl std::error::Error for Error {}

pub struct Options<'a> {
    pub auth: Option<&'a Auth>,
    pub transport: Option<&'a dyn HttpTransport>,
    pub http2_transport: Option<&'a dyn Http2Transport>,
    /// Owned, already-authenticated gRPC override.
    pub grpc: Option<Call>,
    pub base_url: Option<&'a str>,
    pub grpc_url: Option<&'a str>,
    pub max_json_bytes: usize,
    pub max_message_bytes: usize,
    pub max_header_bytes: usize,
}
impl Default for Options<'_> {
    fn default() -> Self {
        Self {
            auth: None,
            transport: None,
            http2_transport: None,
            grpc: None,
            base_url: None,
            grpc_url: None,
            max_json_bytes: 16 * 1024 * 1024,
            max_message_bytes: 64 * 1024 * 1024,
            max_header_bytes: 64 * 1024,
        }
    }
}

/// Always returns owned streaming audio. Drop the future or stream to cancel.
/// HTTP/TLS, HTTP/2 and the executor are supplied by the application. Credentials
/// are forwarded as native headers; no ADC discovery, token refresh or retry.
pub async fn synthesize(
    request: TtsRequest,
    options: Options<'_>,
) -> Result<Stream, TransportError> {
    let validate = validate_request(&request)?;
    let c = settings::prepare(request)?;
    for limit in [
        options.max_json_bytes,
        options.max_message_bytes,
        options.max_header_bytes,
    ] {
        if limit == 0 || u32::try_from(limit).is_err() {
            return Err(Error::Invalid("Google byte limits must be positive uint32 values").into());
        }
    }
    let entry = options.auth.and_then(|auth| auth.google.as_ref());
    let key = credential(
        entry.and_then(|v| v.api_key.as_deref()),
        ["SPEECHSWITCH_GOOGLE_API_KEY", "GOOGLE_API_KEY"],
    )?;
    let token = credential(
        entry.and_then(|v| v.access_token.as_deref()),
        [
            "SPEECHSWITCH_GOOGLE_ACCESS_TOKEN",
            "GOOGLE_OAUTH_ACCESS_TOKEN",
        ],
    )?;
    let quota = credential(
        entry.and_then(|v| v.quota_project.as_deref()),
        [
            "SPEECHSWITCH_GOOGLE_QUOTA_PROJECT",
            "GOOGLE_CLOUD_QUOTA_PROJECT",
        ],
    )?;
    if key.is_empty() && token.is_empty() {
        return Err(Error::Invalid(
            "Missing auth.google.apiKey or auth.google.accessToken configuration",
        )
        .into());
    }
    let mut headers = Vec::new();
    if !key.is_empty() {
        headers.push(("x-goog-api-key".into(), key));
    }
    if !token.is_empty() {
        headers.push(("authorization".into(), format!("Bearer {token}")));
    }
    if !quota.is_empty() {
        headers.push(("x-goog-user-project".into(), quota));
    }
    if headers
        .iter()
        .any(|(_, value)| !value.bytes().all(|b| (32..=126).contains(&b)))
    {
        return Err(Error::Invalid("Invalid Google authentication header").into());
    }
    let target = if c.output.http {
        options.base_url
    } else {
        options.grpc_url
    }
    .unwrap_or(google_rest::DEFAULT_BASE_URL);
    endpoint::validate(target, &["http", "https"])
        .ok_or(Error::Invalid("Invalid Google endpoint URL"))?;
    let mut bytes = target.bytes();
    while let Some(byte) = bytes.next() {
        if byte == b'%'
            && !(bytes.next().is_some_and(|b| b.is_ascii_hexdigit())
                && bytes.next().is_some_and(|b| b.is_ascii_hexdigit()))
        {
            return Err(Error::Invalid("Invalid Google endpoint escape").into());
        }
    }
    let beta = matches!(c.model, Model::Clone);
    if c.output.http {
        let transport = options
            .transport
            .ok_or(Error::Invalid("Google HTTP transport is required"))?;
        let response = if beta {
            google_rest_beta::synthesize_speech(
                &c.beta_rest_request()?,
                google_rest_beta::ClientOptions {
                    base_url: target,
                    headers: &headers,
                    transport,
                },
            )
            .await?
        } else {
            google_rest::synthesize_speech(
                &c.rest_request()?,
                google_rest::ClientOptions {
                    base_url: target,
                    headers: &headers,
                    transport,
                },
            )
            .await?
        };
        return Ok(Stream::http(response, options.max_json_bytes, beta));
    }
    let opening = c.opening()?;
    if opening.len() > options.max_message_bytes {
        return Err(Error::Invalid("Google gRPC message exceeds max_message_bytes").into());
    }
    let path = if beta {
        google_grpc_beta::STREAMING_SYNTHESIZE_PATH
    } else {
        google_grpc::STREAMING_SYNTHESIZE_PATH
    };
    let url =
        endpoint::append(target, path).ok_or(Error::Invalid("Invalid Google endpoint URL"))?;
    let call = match options.grpc {
        Some(call) => call,
        None => Box::pin(
            grpc::connect(
                options
                    .http2_transport
                    .ok_or(Error::Invalid("Google HTTP/2 transport is required"))?,
                grpc::ConnectRequest {
                    url,
                    headers,
                    max_message_bytes: options.max_message_bytes,
                    max_header_bytes: options.max_header_bytes,
                },
            )
            .await?,
        ),
    };
    Ok(Stream::grpc(
        call,
        c,
        opening,
        options.max_message_bytes,
        Box::new(validate),
    ))
}

fn credential(value: Option<&str>, names: [&str; 2]) -> Result<String, TransportError> {
    if let Some(value) = value {
        return Ok(value.into());
    }
    for name in names {
        match std::env::var(name) {
            Ok(value) => return Ok(value),
            Err(std::env::VarError::NotPresent) => {}
            Err(_) => return Err(Error::Invalid("Invalid Google environment credential").into()),
        }
    }
    Ok(String::new())
}
