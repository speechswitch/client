//! Async's authored HTTP and incremental WebSocket protocol. Canonical request
//! and output types and all request constraints are generated from schemas/.
mod protocol;
mod settings;
mod stream;
#[cfg(test)]
mod tests;

use crate::{
    generated::{async_::TtsRequest, auth::Auth, validators::async_::validate_request},
    http::{HttpRequest, HttpTransport, TransportError},
    json,
    websocket::{ConnectRequest, Message, WebSocketTransport},
};
use protocol::failure;
use settings::{Mode, Text};
pub use stream::Stream;

pub struct Options<'a> {
    pub auth: Option<&'a Auth>,
    pub transport: Option<&'a dyn HttpTransport>,
    pub web_socket_transport: Option<&'a dyn WebSocketTransport>,
    pub base_url: Option<&'a str>,
    pub web_socket_url: Option<&'a str>,
    pub max_json_bytes: usize,
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
            max_json_bytes: 16 * 1024 * 1024,
            max_message_bytes: 4 * 1024 * 1024,
        }
    }
}

/// Takes ownership of the request, including incremental input. Drop the future
/// or returned stream to cancel, even without polling again. Injected backends
/// supply production HTTP/WebSocket/TLS; this crate ships no networking dependency.
pub async fn synthesize(
    request: TtsRequest,
    options: Options<'_>,
) -> Result<Stream, TransportError> {
    let validate = validate_request(&request)?;
    let key = match options
        .auth
        .and_then(|auth| auth.async_.as_ref())
        .and_then(|entry| entry.api_key.as_ref())
    {
        Some(key) => key.clone(),
        None => match std::env::var("SPEECHSWITCH_ASYNC_API_KEY") {
            Ok(key) => key,
            Err(std::env::VarError::NotPresent) => {
                std::env::var("ASYNC_API_KEY").unwrap_or_default()
            }
            Err(_) => return Err(failure("Missing auth.async.apiKey configuration")),
        },
    };
    if key.is_empty() {
        return Err(failure("Missing auth.async.apiKey configuration"));
    }
    if options.max_json_bytes == 0 || options.max_message_bytes == 0 {
        return Err(failure("Async byte limits must be positive"));
    }
    let wire = settings::settings(request);
    match wire.text {
        Text::Whole(text) => {
            let transport = options
                .transport
                .ok_or_else(|| failure("Async HTTP transport is required"))?;
            let base = protocol::validate_url(
                options.base_url.unwrap_or("https://api.async.com"),
                &["http://", "https://"],
            )?;
            let path = match wire.mode {
                Mode::Plain => "/text_to_speech",
                Mode::Streaming => "/text_to_speech/streaming",
                Mode::Timestamped => "/text_to_speech/with_timestamps",
            };
            let (base, query) = base
                .split_once('?')
                .map_or((base, String::new()), |(base, query)| {
                    (base, format!("?{query}"))
                });
            let url = format!("{}{path}{query}", base.trim_end_matches('/'));
            let mut body = wire.settings;
            body.pop();
            body.push_str(",\"transcript\":");
            json::quote(&text, &mut body);
            body.push('}');
            let response = transport
                .send(HttpRequest {
                    method: "POST".into(),
                    url,
                    headers: vec![
                        ("x-api-key".into(), key),
                        ("version".into(), "v1".into()),
                        ("content-type".into(), "application/json".into()),
                    ],
                    body: body.into_bytes(),
                })
                .await?;
            Ok(Stream::http(response, wire.mode, options.max_json_bytes))
        }
        Text::Streaming(input) => {
            let transport = options
                .web_socket_transport
                .ok_or_else(|| failure("Async WebSocket transport is required"))?;
            let url = protocol::socket_url(
                options
                    .web_socket_url
                    .unwrap_or("wss://api.async.com/text_to_speech/websocket/ws"),
                &key,
            )?;
            if wire.settings.len() > options.max_message_bytes {
                return Err(failure("Async message exceeds max_message_bytes"));
            }
            let mut id = [0u8; 16];
            transport.random_bytes(&mut id)?;
            id[6] = id[6] & 15 | 64;
            id[8] = id[8] & 63 | 128;
            let id = format!("{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}", id[0], id[1], id[2], id[3], id[4], id[5], id[6], id[7], id[8], id[9], id[10], id[11], id[12], id[13], id[14], id[15]);
            let mut socket = transport
                .connect(ConnectRequest {
                    url,
                    headers: Vec::new(),
                    max_message_bytes: options.max_message_bytes,
                })
                .await?;
            socket.as_mut().start_send(Message::Text(wire.settings))?;
            Ok(Stream::socket(
                socket,
                input,
                id,
                wire.force,
                options.max_message_bytes,
                Box::new(validate),
            ))
        }
    }
}
