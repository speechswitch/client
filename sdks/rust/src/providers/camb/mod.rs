//! Byte-native CAMB synthesis using canonical request validators and
//! contract-generated wire types/codecs.
mod settings;
mod stream;
#[cfg(test)]
mod tests;

use crate::{
    clients::camb as wire,
    endpoint,
    generated::{auth::Auth, camb::TtsRequest, validators::camb::validate_request},
    http::{HttpTransport, TransportError},
    websocket::{ConnectRequest, Message, WebSocketTransport},
};
use settings::Prepared;
pub use stream::Stream;

pub struct Options<'a> {
    pub auth: Option<&'a Auth>,
    pub transport: Option<&'a dyn HttpTransport>,
    pub web_socket_transport: Option<&'a dyn WebSocketTransport>,
    pub base_url: Option<&'a str>,
    pub web_socket_url: Option<&'a str>,
    pub max_error_bytes: usize,
    pub max_message_bytes: usize,
}
impl Default for Options<'_> {
    fn default() -> Self {
        Self {
            auth: None,
            transport: None,
            web_socket_transport: None,
            base_url: None,
            web_socket_url: None,
            max_error_bytes: 1024 * 1024,
            max_message_bytes: 4 * 1024 * 1024,
        }
    }
}

/// Takes ownership of incremental input. Drop this future or the returned stream
/// to cancel, even between polls. Injected native backends own HTTP/WebSocket/TLS;
/// this crate imposes no executor or third-party networking dependency.
pub async fn synthesize(
    request: TtsRequest,
    options: Options<'_>,
) -> Result<Stream, TransportError> {
    let validate = validate_request(&request)?;
    let prepared = settings::prepare(request)?;
    let key = match options
        .auth
        .and_then(|auth| auth.camb.as_ref())
        .and_then(|entry| entry.api_key.as_ref())
    {
        Some(key) => key.clone(),
        None => match std::env::var("SPEECHSWITCH_CAMB_API_KEY") {
            Ok(key) => key,
            Err(std::env::VarError::NotPresent) => {
                std::env::var("CAMB_API_KEY").unwrap_or_default()
            }
            Err(_) => return Err(failure("Missing auth.camb.apiKey configuration")),
        },
    };
    if key.is_empty() {
        return Err(failure("Missing auth.camb.apiKey configuration"));
    }
    if options.max_error_bytes == 0 || options.max_message_bytes == 0 {
        return Err(failure("CAMB byte limits must be positive"));
    }
    match prepared {
        Prepared::Http(request) => {
            let transport = options
                .transport
                .ok_or_else(|| failure("CAMB HTTP transport is required"))?;
            let response = wire::stream_speech(
                &request,
                &key,
                options.base_url.unwrap_or(wire::DEFAULT_BASE_URL),
                transport,
            )
            .await?;
            Ok(Stream::http(response, options.max_error_bytes))
        }
        Prepared::Socket {
            start,
            input,
            timed,
        } => {
            let transport = options
                .web_socket_transport
                .ok_or_else(|| failure("CAMB WebSocket transport is required"))?;
            let url = socket_url(
                options
                    .web_socket_url
                    .unwrap_or(wire::DEFAULT_WEB_SOCKET_URL),
            )?;
            let first = wire::encode_message(&wire::ClientMessage::SessionStart(start))?;
            if first.len() > options.max_message_bytes {
                return Err(failure("CAMB message exceeds max_message_bytes"));
            }
            let mut socket = transport
                .connect(ConnectRequest {
                    url,
                    headers: vec![("x-api-key".into(), key)],
                    max_message_bytes: options.max_message_bytes,
                })
                .await?;
            socket.as_mut().start_send(Message::Text(first))?;
            Ok(Stream::socket(
                socket,
                input,
                timed,
                options.max_message_bytes,
                Box::new(validate),
            ))
        }
    }
}

fn failure(message: impl Into<String>) -> TransportError {
    Box::new(std::io::Error::other(message.into()))
}

fn socket_url(url: &str) -> Result<String, TransportError> {
    endpoint::validate(url, &["ws", "wss"])
        .ok_or_else(|| failure("Invalid CAMB WebSocket endpoint URL"))?;
    let Some((base, query)) = url.split_once('?') else {
        return Ok(url.into());
    };
    let mut retained = Vec::new();
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        let decode = |text: &str| -> Result<Vec<u8>, TransportError> {
            let mut bytes = text.bytes();
            let mut decoded = Vec::new();
            while let Some(byte) = bytes.next() {
                decoded.push(match byte {
                    b'+' => b' ',
                    b'%' => {
                        let high = bytes.next().and_then(|byte| (byte as char).to_digit(16));
                        let low = bytes.next().and_then(|byte| (byte as char).to_digit(16));
                        match (high, low) {
                            (Some(high), Some(low)) => (high * 16 + low) as u8,
                            _ => return Err(failure("Invalid CAMB WebSocket endpoint query")),
                        }
                    }
                    byte => byte,
                });
            }
            Ok(decoded)
        };
        let key = decode(key)?;
        decode(value)?;
        if key != b"api_key" && !pair.is_empty() {
            retained.push(pair);
        }
    }
    Ok(if retained.is_empty() {
        base.into()
    } else {
        format!("{base}?{}", retained.join("&"))
    })
}
