//! Cartesia's authored wire protocol with canonical generated requests/outputs.
mod protocol;
mod settings;
mod stream;
#[cfg(test)]
mod tests;

use crate::{
    endpoint,
    entropy::Entropy,
    generated::{auth::Auth, cartesia::TtsRequest, validators::cartesia::validate_request},
    http::{HttpRequest, HttpResponse, HttpTransport, TransportError},
    json::{self, Raw},
    websocket::{ConnectRequest, Socket, WebSocketTransport},
};
use protocol::failure;
pub use protocol::Error;
use settings::Text;
pub use stream::Stream;

const VERSION: &str = "2026-08-14";
pub struct Options<'a> {
    pub auth: Option<&'a Auth>,
    pub transport: Option<&'a dyn HttpTransport>,
    pub web_socket_transport: Option<&'a dyn WebSocketTransport>,
    /// An owned, already-authenticated socket; skips native token exchange.
    pub web_socket: Option<Socket>,
    /// Required for SSE and socket overrides. Native WebSockets otherwise use
    /// their backend's OS randomness. Untimed HTTP needs no entropy.
    pub entropy: Option<&'a dyn Entropy>,
    pub base_url: Option<&'a str>,
    pub web_socket_url: Option<&'a str>,
    pub max_json_bytes: usize,
    pub max_message_bytes: usize,
    pub max_event_bytes: usize,
}
impl Default for Options<'_> {
    fn default() -> Self {
        Self {
            auth: None,
            transport: None,
            web_socket_transport: None,
            web_socket: None,
            entropy: None,
            base_url: None,
            web_socket_url: None,
            max_json_bytes: 1024 * 1024,
            max_message_bytes: 4 * 1024 * 1024,
            max_event_bytes: 4 * 1024 * 1024,
        }
    }
}

/// Owns the request and any supplied socket. Drop this future or returned stream
/// to cancel pending I/O/input, including between polls. Native backends provide
/// HTTP/WebSocket/TLS; this crate imposes no executor or networking dependency.
pub async fn synthesize(
    request: TtsRequest,
    options: Options<'_>,
) -> Result<Stream, TransportError> {
    let validate = validate_request(&request)?;
    if options.max_json_bytes == 0 || options.max_message_bytes == 0 || options.max_event_bytes == 0
    {
        return Err(failure("Cartesia byte limits must be positive"));
    }
    let prepared = settings::prepare(request);
    let (key, token) =
        if options.web_socket.is_some() && matches!(&prepared.text, Text::Streaming(_)) {
            (None, None)
        } else {
            let entry = options.auth.and_then(|auth| auth.cartesia.as_ref());
            (
                credential(entry.and_then(|v| v.api_key.as_ref()), "API_KEY")?,
                credential(entry.and_then(|v| v.access_token.as_ref()), "ACCESS_TOKEN")?,
            )
        };
    let base = options.base_url.unwrap_or("https://api.cartesia.ai");
    match prepared.text {
        Text::Whole(text) => {
            let credential = key.or(token).filter(|v| !v.is_empty()).ok_or_else(|| {
                failure("Missing auth.cartesia.apiKey or auth.cartesia.accessToken configuration")
            })?;
            let transport = options
                .transport
                .ok_or_else(|| failure("Cartesia HTTP transport is required"))?;
            let id = if prepared.timed {
                let entropy = options
                    .entropy
                    .ok_or_else(|| failure("Cartesia SSE entropy source is required"))?;
                let mut bytes = [0; 16];
                entropy.fill(&mut bytes)?;
                Some(ContextIds::new(bytes).current)
            } else {
                None
            };
            let mut body = prepared.settings;
            body.pop();
            body.push_str(",\"transcript\":");
            json::quote(&text, &mut body);
            if let Some(id) = &id {
                body.push_str(",\"context_id\":");
                json::quote(id, &mut body);
            }
            body.push('}');
            let response = send(
                transport,
                base,
                if prepared.timed {
                    "/tts/sse"
                } else {
                    "/tts/bytes"
                },
                &credential,
                body,
            )
            .await?;
            Stream::http(
                response,
                id,
                options.max_json_bytes,
                options.max_event_bytes,
            )
        }
        Text::Streaming(input) => {
            let mut bytes = [0; 16];
            if let Some(entropy) = options.entropy {
                entropy.fill(&mut bytes)?;
            } else if options.web_socket.is_none() {
                options
                    .web_socket_transport
                    .ok_or_else(|| failure("Cartesia WebSocket transport is required"))?
                    .random_bytes(&mut bytes)?;
            } else {
                return Err(failure(
                    "Cartesia socket override entropy source is required",
                ));
            }
            let ids = ContextIds::new(bytes);
            let socket = match options.web_socket {
                Some(socket) => socket,
                None => {
                    let backend = options
                        .web_socket_transport
                        .ok_or_else(|| failure("Cartesia WebSocket transport is required"))?;
                    let token = match token.filter(|v| !v.is_empty()) {
                        Some(token) => token,
                        None => {
                            let key = key.filter(|v| !v.is_empty()).ok_or_else(|| {
                                failure("Missing auth.cartesia.apiKey or auth.cartesia.accessToken configuration")
                            })?;
                            let transport = options.transport.ok_or_else(|| {
                                failure("Cartesia HTTP transport is required for token exchange")
                            })?;
                            let response = send(
                                transport,
                                base,
                                "/access-token",
                                &key,
                                r#"{"grants":{"tts":true},"expires_in":60}"#.into(),
                            )
                            .await?;
                            let (status, text) =
                                response_text(response, options.max_json_bytes).await?;
                            if !(200..300).contains(&status) {
                                return Err(Box::new(protocol::response_error(
                                    &text,
                                    status as f64,
                                )));
                            }
                            let value = Raw::parse_exact(&text)
                                .map_err(|_| failure("Cartesia returned invalid JSON"))?;
                            value
                                .object()
                                .ok()
                                .and_then(|v| v.get("token").and_then(|v| v.string().ok()))
                                .filter(|v| !v.is_empty())
                                .ok_or_else(|| {
                                    failure("Cartesia returned an invalid access token")
                                })?
                        }
                    };
                    let url = socket_url(
                        options
                            .web_socket_url
                            .unwrap_or("wss://api.cartesia.ai/tts/websocket"),
                        &token,
                    )?;
                    backend
                        .connect(ConnectRequest {
                            url,
                            headers: Vec::new(),
                            max_message_bytes: options.max_message_bytes,
                        })
                        .await?
                }
            };
            Ok(Stream::socket(
                socket,
                input,
                prepared.settings,
                prepared.timed,
                ids,
                options.max_message_bytes,
                Box::new(validate),
            ))
        }
    }
}

fn credential(value: Option<&String>, name: &str) -> Result<Option<String>, TransportError> {
    if let Some(value) = value {
        return Ok(Some(value.clone()));
    }
    for key in [
        format!("SPEECHSWITCH_CARTESIA_{name}"),
        format!("CARTESIA_{name}"),
    ] {
        match std::env::var(key) {
            Ok(value) => return Ok(Some(value)),
            Err(std::env::VarError::NotPresent) => {}
            Err(_) => return Err(failure("Invalid Cartesia environment credential")),
        }
    }
    Ok(None)
}
async fn send(
    transport: &dyn HttpTransport,
    base: &str,
    path: &str,
    credential: &str,
    body: String,
) -> Result<HttpResponse, TransportError> {
    let url = endpoint::append(base, path)
        .ok_or_else(|| failure("Invalid Cartesia HTTP endpoint URL"))?;
    transport
        .send(HttpRequest {
            method: "POST".into(),
            url,
            headers: vec![
                ("authorization".into(), format!("Bearer {credential}")),
                ("cartesia-version".into(), VERSION.into()),
                ("content-type".into(), "application/json".into()),
            ],
            body: body.into_bytes(),
        })
        .await
}
async fn response_text(
    mut response: HttpResponse,
    limit: usize,
) -> Result<(u16, String), TransportError> {
    let mut data = Vec::new();
    while let Some(bytes) = std::future::poll_fn(|cx| response.body.as_mut().poll_next(cx)).await {
        let bytes = bytes?;
        if bytes.len() > limit - data.len() {
            return Err(failure("Cartesia response exceeds max_json_bytes"));
        }
        data.extend(bytes);
        // An always-ready body must still yield cooperatively between chunks.
        let mut yielded = false;
        std::future::poll_fn(|cx| {
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
    let text = String::from_utf8_lossy(&data);
    Ok((
        response.status,
        text.strip_prefix('\u{feff}').unwrap_or(&text).into(),
    ))
}

fn socket_url(url: &str, token: &str) -> Result<String, TransportError> {
    endpoint::validate(url, &["ws", "wss"])
        .ok_or_else(|| failure("Invalid Cartesia WebSocket endpoint URL"))?;
    let (base, query) = url.split_once('?').unwrap_or((url, ""));
    let mut retained = Vec::new();
    for pair in query.split('&').filter(|v| !v.is_empty()) {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        let decode = |text: &str| -> Result<Vec<u8>, TransportError> {
            let mut bytes = text.bytes();
            let mut result = Vec::new();
            while let Some(byte) = bytes.next() {
                result.push(match byte {
                    b'+' => b' ',
                    b'%' => {
                        let high = bytes.next().and_then(|v| (v as char).to_digit(16));
                        let low = bytes.next().and_then(|v| (v as char).to_digit(16));
                        match (high, low) {
                            (Some(h), Some(l)) => (h * 16 + l) as u8,
                            _ => return Err(failure("Invalid Cartesia WebSocket endpoint query")),
                        }
                    }
                    byte => byte,
                });
            }
            Ok(result)
        };
        let key = decode(key)?;
        decode(value)?;
        if key != b"api_key" && key != b"access_token" && key != b"cartesia_version" {
            retained.push(pair.to_owned());
        }
    }
    let mut encoded = String::new();
    for byte in token.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    retained.push(format!("cartesia_version={VERSION}"));
    retained.push(format!("access_token={encoded}"));
    Ok(format!("{base}?{}", retained.join("&")))
}

struct ContextIds {
    prefix: String,
    current: String,
    index: u64,
}
impl ContextIds {
    fn new(mut bytes: [u8; 16]) -> Self {
        bytes[6] = bytes[6] & 15 | 64;
        bytes[8] = bytes[8] & 63 | 128;
        let prefix: String = bytes.iter().map(|v| format!("{v:02x}")).collect();
        Self {
            current: format!("{prefix}:0"),
            prefix,
            index: 0,
        }
    }
    fn advance(&mut self) -> Result<(), TransportError> {
        self.index = self
            .index
            .checked_add(1)
            .ok_or_else(|| failure("Cartesia context counter exhausted"))?;
        // Cartesia accepts arbitrary unique strings, not only UUIDs. The seed
        // is cryptographic; this counter distinguishes contexts in one operation.
        self.current = format!("{}:{}", self.prefix, self.index);
        Ok(())
    }
}
