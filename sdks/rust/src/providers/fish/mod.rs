//! Fish Audio's authored binary and SSE protocols with generated schema checks.
mod protocol;
mod settings;
mod stream;
#[cfg(test)]
mod tests;

use crate::{
    endpoint,
    generated::{auth::Auth, fish::TtsRequest, validators::fish::validate_request},
    http::{HttpRequest, HttpTransport, TransportError},
    json::Raw,
    msgpack,
    websocket::{ConnectRequest, Socket, WebSocketTransport},
};
use protocol::failure;
pub use protocol::Error;
use settings::Text;
use std::future::poll_fn;
pub use stream::Stream;

pub struct Options<'a> {
    pub auth: Option<&'a Auth>,
    pub transport: Option<&'a dyn HttpTransport>,
    pub web_socket_transport: Option<&'a dyn WebSocketTransport>,
    /// Owned, already-authenticated native socket override.
    pub web_socket: Option<Socket>,
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
            web_socket: None,
            base_url: None,
            web_socket_url: None,
            max_json_bytes: 16 * 1024 * 1024,
            max_message_bytes: 4 * 1024 * 1024,
        }
    }
}

/// Always streaming. Drop the future or stream to cancel owned input and I/O.
/// Applications supply HTTP/TLS, native socket and executor backends; no runtime
/// dependency, buffering, retry or synthetic clear acknowledgement is introduced.
pub async fn synthesize(
    request: TtsRequest,
    options: Options<'_>,
) -> Result<Stream, TransportError> {
    let validate = validate_request(&request)?;
    if options.max_json_bytes == 0 || options.max_message_bytes == 0 {
        return Err(failure("Fish byte limits must be positive"));
    }
    let c = settings::prepare(request);
    let mut key = options
        .auth
        .and_then(|v| v.fish.as_ref())
        .and_then(|v| v.api_key.clone());
    if key.is_none() {
        for name in ["SPEECHSWITCH_FISH_API_KEY", "FISH_API_KEY"] {
            match std::env::var(name) {
                Ok(value) => {
                    key = Some(value);
                    break;
                }
                Err(std::env::VarError::NotPresent) => {}
                Err(_) => return Err(failure("Invalid Fish environment credential")),
            }
        }
    }
    let streaming = matches!(&c.text, Text::Streaming(_));
    let key = key.unwrap_or_default();
    if key.is_empty() && !(streaming && options.web_socket.is_some()) {
        return Err(failure("Missing auth.fish.apiKey configuration"));
    }
    let url = speech_url(
        options.base_url.unwrap_or("https://api.fish.audio"),
        options.web_socket_url,
        streaming,
        c.timed,
    )?;
    let wire = settings::wire(&c)?;
    let headers = vec![
        ("authorization".into(), format!("Bearer {key}")),
        ("model".into(), c.model.into()),
    ];
    match c.text {
        Text::Streaming(input) => {
            let socket = match options.web_socket {
                Some(socket) => socket,
                None => {
                    options
                        .web_socket_transport
                        .ok_or_else(|| failure("Fish WebSocket transport is required"))?
                        .connect(ConnectRequest {
                            url,
                            headers,
                            max_message_bytes: options.max_message_bytes,
                        })
                        .await?
                }
            };
            Ok(Stream::socket(
                socket,
                input,
                wire,
                options.max_message_bytes,
                Box::new(validate),
            ))
        }
        Text::Whole(_) => {
            let transport = options
                .transport
                .ok_or_else(|| failure("Fish HTTP transport is required"))?;
            let mut headers = headers;
            headers.push(("content-type".into(), "application/msgpack".into()));
            let mut response = transport
                .send(HttpRequest {
                    method: "POST".into(),
                    url,
                    headers,
                    body: msgpack::encode(&wire)?,
                })
                .await?;
            if !(200..300).contains(&response.status) {
                let mut data = Vec::new();
                while let Some(chunk) = poll_fn(|cx| response.body.as_mut().poll_next(cx)).await {
                    let chunk = chunk?;
                    if chunk.len() > options.max_json_bytes - data.len() {
                        return Err(failure("Fish response exceeds max_json_bytes"));
                    }
                    data.extend(chunk);
                    // A ready stream of empty chunks must not monopolize its executor.
                    let mut yielded = false;
                    poll_fn(|cx| {
                        if yielded {
                            std::task::Poll::Ready(())
                        } else {
                            yielded = true;
                            cx.waker().wake_by_ref();
                            std::task::Poll::Pending
                        }
                    })
                    .await;
                }
                let text = String::from_utf8_lossy(
                    data.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&data),
                )
                .into_owned();
                let fields = Raw::parse(&text).and_then(Raw::object).ok();
                let reason = fields
                    .as_ref()
                    .and_then(|v| v.get("reason"))
                    .and_then(|v| v.string().ok());
                let message = fields
                    .as_ref()
                    .and_then(|v| v.get("message"))
                    .and_then(|v| v.string().ok())
                    .unwrap_or(text);
                return Err(Box::new(Error {
                    status: response.status,
                    message,
                    reason,
                }));
            }
            Stream::http(response.body, c.timed, options.max_json_bytes)
        }
    }
}

fn speech_url(
    base: &str,
    override_url: Option<&str>,
    streaming: bool,
    timed: bool,
) -> Result<String, TransportError> {
    let target = if streaming {
        override_url.unwrap_or(base)
    } else {
        base
    };
    endpoint::validate(
        target,
        if streaming {
            &["http", "https", "ws", "wss"]
        } else {
            &["http", "https"]
        },
    )
    .ok_or_else(|| failure("Invalid Fish endpoint URL"))?;
    let mut bytes = target.bytes();
    while let Some(byte) = bytes.next() {
        if byte == b'%'
            && !(bytes.next().is_some_and(|b| b.is_ascii_hexdigit())
                && bytes.next().is_some_and(|b| b.is_ascii_hexdigit()))
        {
            return Err(failure("Invalid Fish endpoint escape"));
        }
    }
    let (scheme, tail) = target.split_once("://").unwrap();
    let scheme = match scheme.to_ascii_lowercase().as_str() {
        "http" if streaming => "ws",
        "https" if streaming => "wss",
        _ => scheme,
    };
    let mut url = format!("{scheme}://{tail}");
    if !streaming || override_url.is_none() {
        let (base, query) = url
            .split_once('?')
            .map_or((url.as_str(), String::new()), |(b, q)| (b, format!("?{q}")));
        let suffix = if streaming {
            "/v1/tts/live"
        } else if timed {
            "/v1/tts/stream/with-timestamp"
        } else {
            "/v1/tts"
        };
        url = format!("{}{suffix}{query}", base.trim_end_matches('/'));
    }
    Ok(url)
}
