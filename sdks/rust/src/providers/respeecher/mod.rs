//! Authored Respeecher Space wire protocol with TypeScript-derived public contracts.
mod settings;
mod stream;
#[cfg(test)]
mod tests;
pub use crate::generated::{respeecher::TtsRequest, respeecher_output::SynthesisItem};
use crate::{
    endpoint,
    entropy::Entropy,
    generated::{
        auth::Auth, respeecher::TtsRequestObjectText, validators::respeecher::validate_request,
    },
    http::{HttpRequest, HttpTransport, TransportError},
    json,
    websocket::{ConnectRequest, Socket, WebSocketTransport},
};
pub use stream::Stream;

pub struct Options<'a> {
    pub auth: Option<&'a Auth>,
    pub transport: Option<&'a dyn HttpTransport>,
    pub web_socket_transport: Option<&'a dyn WebSocketTransport>,
    /// Already authenticated, exclusively owned override, dropped on every exit.
    pub web_socket: Option<Socket>,
    /// Required with a socket override; native backends otherwise provide OS entropy.
    pub entropy: Option<&'a dyn Entropy>,
    pub base_url: Option<&'a str>,
    pub web_socket_url: Option<&'a str>,
    /// Omission selects WebSocket for PCM/mulaw and HTTP for WAV.
    pub protocol: Option<Protocol>,
    pub max_message_bytes: usize,
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Protocol {
    Http,
    WebSocket,
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
            protocol: None,
            max_message_bytes: 4 * 1024 * 1024,
        }
    }
}
#[derive(Debug, PartialEq, Eq)]
pub struct Error {
    pub status_code: i64,
    pub context_id: Option<String>,
    pub message: String,
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

/// Owns the request and socket override immediately. Drop the future or returned
/// stream to cancel; the host executor applies whole-operation deadlines. The
/// returned stream does not borrow the request, authentication or transport.
pub async fn synthesize(
    request: TtsRequest,
    options: Options<'_>,
) -> Result<Stream, TransportError> {
    let validate = validate_request(&request)?;
    if options.max_message_bytes == 0 {
        return Err(failure("Respeecher max_message_bytes must be positive"));
    }
    let mut key = options
        .auth
        .and_then(|a| a.respeecher.as_ref())
        .and_then(|a| a.api_key.clone());
    if key.is_none() {
        for name in ["SPEECHSWITCH_RESPEECHER_API_KEY", "RESPEECHER_API_KEY"] {
            match std::env::var(name) {
                Ok(value) => {
                    key = Some(value);
                    break;
                }
                Err(std::env::VarError::NotPresent) => {}
                Err(_) => return Err(failure("Invalid Respeecher environment credential")),
            }
        }
    }
    let key = key
        .filter(|v| !v.is_empty())
        .ok_or_else(|| failure("Missing auth.respeecher.apiKey configuration"))?;
    if !key.bytes().all(|b| (32..=126).contains(&b)) {
        return Err(failure(
            "Respeecher API key must be a printable ASCII header value",
        ));
    }
    let prepared = settings::prepare(&request);
    let socket_mode = options
        .protocol
        .map_or(!prepared.wave, |v| v == Protocol::WebSocket);
    let text = match request {
        TtsRequest::Object(v) => v.text,
        TtsRequest::TextVoice(v) => TtsRequestObjectText::String(v.text),
    };
    if prepared.wave && socket_mode {
        return Err(failure("Respeecher WAV output requires HTTP"));
    }
    if !socket_mode && matches!(text, TtsRequestObjectText::AsyncIterable(_)) {
        return Err(failure("Respeecher incremental text requires WebSocket"));
    }
    if !socket_mode && options.web_socket.is_some() {
        return Err(failure("Respeecher HTTP cannot use a WebSocket override"));
    }
    let default_base = format!(
        "https://api.respeecher.com/v1/public/tts/{}-rt",
        prepared.language
    );
    let base = options.base_url.unwrap_or(&default_base);
    endpoint::validate(base, &["http", "https"])
        .ok_or_else(|| failure("Invalid Respeecher endpoint URL"))?;
    if socket_mode {
        let mut bytes = [0; 16];
        if let Some(entropy) = options.entropy {
            entropy.fill(&mut bytes)?
        } else if options.web_socket.is_none() {
            options
                .web_socket_transport
                .ok_or_else(|| failure("Respeecher WebSocket transport is required"))?
                .random_bytes(&mut bytes)?
        } else {
            return Err(failure(
                "Respeecher socket override entropy source is required",
            ));
        }
        let mut prefix: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        prefix.push(':');
        let url = match options.web_socket_url {
            Some(v) => v.to_owned(),
            None => {
                let http = endpoint::append(base, "/tts/websocket")
                    .ok_or_else(|| failure("Invalid Respeecher endpoint URL"))?;
                let (scheme, tail) = http.split_once("://").expect("validated URL");
                format!(
                    "{}://{tail}",
                    if scheme.eq_ignore_ascii_case("https") {
                        "wss"
                    } else {
                        "ws"
                    }
                )
            }
        };
        endpoint::validate(&url, &["ws", "wss"])
            .ok_or_else(|| failure("Invalid Respeecher endpoint URL"))?;
        let socket = match options.web_socket {
            Some(socket) => socket,
            None => {
                options
                    .web_socket_transport
                    .ok_or_else(|| failure("Respeecher WebSocket transport is required"))?
                    .connect(ConnectRequest {
                        url,
                        headers: vec![("X-API-Key".into(), key)],
                        max_message_bytes: options.max_message_bytes,
                    })
                    .await?
            }
        };
        Ok(Stream::socket(
            socket,
            text,
            prepared.wire,
            prefix,
            options.max_message_bytes,
            Box::new(validate),
        ))
    } else {
        let TtsRequestObjectText::String(text) = text else {
            unreachable!("streaming HTTP rejected")
        };
        let transport = options
            .transport
            .ok_or_else(|| failure("Respeecher HTTP transport is required"))?;
        let url = endpoint::append(
            base,
            if prepared.wave {
                "/tts/bytes"
            } else {
                "/tts/sse"
            },
        )
        .ok_or_else(|| failure("Invalid Respeecher endpoint URL"))?;
        let mut body = prepared.wire;
        body.pop();
        body.push_str(",\"transcript\":");
        json::quote(&text, &mut body);
        body.push('}');
        let response = transport
            .send(HttpRequest {
                method: "POST".into(),
                url,
                headers: vec![
                    ("X-API-Key".into(), key),
                    ("Content-Type".into(), "application/json".into()),
                ],
                body: body.into_bytes(),
            })
            .await?;
        if !(200..300).contains(&response.status) {
            return Err(Box::new(Error {
                status_code: response.status as i64,
                context_id: None,
                message: format!("Respeecher returned HTTP {}", response.status),
            }));
        }
        if let Some((_, value)) = response
            .headers
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case("content-type"))
        {
            let media = value
                .split(';')
                .next()
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase();
            if !media.is_empty()
                && !(if prepared.wave {
                    media.starts_with("audio/") || media == "application/octet-stream"
                } else {
                    matches!(
                        media.as_str(),
                        "text/event-stream"
                            | "application/x-ndjson"
                            | "application/jsonl"
                            | "application/json"
                    )
                })
            {
                return Err(failure("Respeecher returned an unexpected content type"));
            }
        }
        Ok(Stream::http(
            response.body,
            prepared.wave,
            options.max_message_bytes,
        ))
    }
}
