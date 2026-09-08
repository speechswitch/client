//! Deepgram's handwritten Aura HTTP/WebSocket protocol, with generated schemas.
mod settings;
mod stream;
#[cfg(test)]
mod tests;

use crate::{
    endpoint,
    generated::{auth::Auth, deepgram::TtsRequest, validators::deepgram::validate_request},
    http::{HttpRequest, HttpStatusError, HttpTransport, TransportError},
    json,
    websocket::{ConnectRequest, Socket, WebSocketTransport},
};
use settings::Text;
pub use stream::Stream;

pub struct Options<'a> {
    pub auth: Option<&'a Auth>,
    pub transport: Option<&'a dyn HttpTransport>,
    pub web_socket_transport: Option<&'a dyn WebSocketTransport>,
    /// Owned, already-authenticated socket override.
    pub web_socket: Option<Socket>,
    pub base_url: Option<&'a str>,
    pub web_socket_url: Option<&'a str>,
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
            max_message_bytes: 4 * 1024 * 1024,
        }
    }
}

/// Complete text uses HTTP; streaming text uses byte-native WebSockets. Drop the
/// future or stream to cancel input and I/O. Applications supply the HTTP/TLS,
/// WebSocket and executor backends; no runtime dependency or retry is introduced.
pub async fn synthesize(
    request: TtsRequest,
    options: Options<'_>,
) -> Result<Stream, TransportError> {
    let validate = validate_request(&request)?;
    if options.max_message_bytes == 0 {
        return Err(failure("Deepgram max_message_bytes must be positive"));
    }
    let prepared = settings::prepare(request);
    let mut key = options
        .auth
        .and_then(|v| v.deepgram.as_ref())
        .and_then(|v| v.api_key.clone());
    if key.is_none() {
        for name in ["SPEECHSWITCH_DEEPGRAM_API_KEY", "DEEPGRAM_API_KEY"] {
            match std::env::var(name) {
                Ok(value) => {
                    key = Some(value);
                    break;
                }
                Err(std::env::VarError::NotPresent) => {}
                Err(_) => return Err(failure("Invalid Deepgram environment credential")),
            }
        }
    }
    let key = key
        .filter(|v| !v.is_empty())
        .ok_or_else(|| failure("Missing auth.deepgram.apiKey configuration"))?;
    match prepared.text {
        Text::Whole(text) => {
            let base = endpoint::append(
                options.base_url.unwrap_or("https://api.deepgram.com"),
                "/v1/speak",
            )
            .ok_or_else(|| failure("Invalid Deepgram endpoint URL"))?;
            let url = speech_url(&base, false, prepared.query)?;
            let transport = options
                .transport
                .ok_or_else(|| failure("Deepgram HTTP transport is required"))?;
            let mut body = String::from("{\"text\":");
            json::quote(&text, &mut body);
            body.push('}');
            let response = transport
                .send(HttpRequest {
                    method: "POST".into(),
                    url,
                    headers: vec![
                        ("authorization".into(), format!("Token {key}")),
                        ("content-type".into(), "application/json".into()),
                    ],
                    body: body.into_bytes(),
                })
                .await?;
            if !(200..300).contains(&response.status) {
                return Err(Box::new(HttpStatusError {
                    status: response.status,
                }));
            }
            let content_type = response
                .headers
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case("content-type"))
                .map_or("", |(_, v)| v.split(';').next().unwrap_or("").trim());
            let content_type = content_type.to_ascii_lowercase();
            if !content_type.is_empty()
                && !content_type.starts_with("audio/")
                && content_type != "application/octet-stream"
            {
                return Err(failure(
                    "Deepgram returned an unexpected audio content type",
                ));
            }
            Ok(Stream::http(response.body))
        }
        Text::Streaming(input) => {
            let url = speech_url(
                options
                    .web_socket_url
                    .unwrap_or("wss://api.deepgram.com/v1/speak"),
                true,
                prepared.query,
            )?;
            let socket = match options.web_socket {
                Some(socket) => socket,
                None => {
                    options
                        .web_socket_transport
                        .ok_or_else(|| failure("Deepgram WebSocket transport is required"))?
                        .connect(ConnectRequest {
                            url,
                            headers: vec![("authorization".into(), format!("Token {key}"))],
                            max_message_bytes: options.max_message_bytes,
                        })
                        .await?
                }
            };
            Ok(Stream::socket(
                socket,
                input,
                options.max_message_bytes,
                Box::new(validate),
            ))
        }
    }
}

fn speech_url(
    base: &str,
    streaming: bool,
    query: Vec<(&str, String)>,
) -> Result<String, TransportError> {
    endpoint::validate(
        base,
        if streaming {
            &["ws", "wss"]
        } else {
            &["http", "https"]
        },
    )
    .ok_or_else(|| failure("Invalid Deepgram endpoint URL"))?;
    let (base, old_query) = base.split_once('?').unwrap_or((base, ""));
    let mut pairs = Vec::new();
    for pair in old_query.split('&').filter(|v| !v.is_empty()) {
        let key = pair.split('=').next().unwrap_or("");
        let mut decoded = Vec::new();
        let mut bytes = key.bytes();
        while let Some(byte) = bytes.next() {
            decoded.push(match byte {
                b'+' => b' ',
                b'%' => {
                    let high = bytes.next().and_then(|v| (v as char).to_digit(16));
                    let low = bytes.next().and_then(|v| (v as char).to_digit(16));
                    match (high, low) {
                        (Some(high), Some(low)) => (high * 16 + low) as u8,
                        _ => return Err(failure("Invalid Deepgram endpoint query")),
                    }
                }
                v => v,
            });
        }
        if ![
            "model",
            "encoding",
            "container",
            "sample_rate",
            "bit_rate",
            "speed",
            "mip_opt_out",
            "tag",
            "api_key",
            "access_token",
        ]
        .iter()
        .any(|v| v.as_bytes() == decoded)
        {
            pairs.push(pair.to_owned());
        }
    }
    for (key, value) in query {
        let mut pair = format!("{key}=");
        for byte in value.bytes() {
            if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
                pair.push(byte as char);
            } else {
                pair.push_str(&format!("%{byte:02X}"));
            }
        }
        pairs.push(pair);
    }
    Ok(format!("{base}?{}", pairs.join("&")))
}
fn failure(message: &'static str) -> TransportError {
    Box::new(std::io::Error::other(message))
}
