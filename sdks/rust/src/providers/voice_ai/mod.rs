//! Handwritten Voice.ai wire protocols with TypeScript-generated public contracts.
mod protocol;
mod settings;
mod stream;
#[cfg(test)]
mod tests;
pub use crate::generated::{
    voice_ai::{TtsRequest, TtsRequestObject1ec54d36TextAsyncIterableItem as Input},
    voice_ai_output::SynthesisItem,
};
use crate::{
    entropy::Entropy,
    generated::{
        auth::Auth, validators::voice_ai::validate_request,
        voice_ai::TtsRequestObject1ec54d36Text as Text,
    },
    http::{HttpRequest, HttpTransport, TransportError},
    json,
    runtime::JsonValue,
    websocket::{ConnectRequest, Socket, WebSocketTransport},
};
pub use stream::Stream;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Protocol {
    Stream,
    Http,
    WebSocket,
}
pub struct Options<'a> {
    pub auth: Option<&'a Auth>,
    pub transport: Option<&'a dyn HttpTransport>,
    pub web_socket_transport: Option<&'a dyn WebSocketTransport>,
    /// Exclusive, already-authenticated override, dropped even on validation failure.
    pub web_socket: Option<Socket>,
    /// Overrides require OS entropy unless supplied by the native socket backend.
    pub entropy: Option<&'a dyn Entropy>,
    pub base_url: Option<&'a str>,
    /// Omission selects WebSocket for incremental input/paced output, streaming HTTP otherwise.
    pub protocol: Option<Protocol>,
    /// Incoming and outgoing JSON socket frame cap, never an HTTP audio cap.
    pub max_message_bytes: usize,
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
            protocol: None,
            max_message_bytes: 4 * 1024 * 1024,
        }
    }
}
#[derive(Debug, PartialEq, Eq)]
pub struct Error {
    pub status: Option<u16>,
    pub context_id: Option<String>,
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Some(status) = self.status {
            write!(f, "Voice.ai returned HTTP {status}")
        } else {
            f.write_str("Voice.ai reported a synthesis error")
        }
    }
}
impl std::error::Error for Error {}
fn failure(message: &str) -> TransportError {
    std::io::Error::new(std::io::ErrorKind::InvalidData, message).into()
}

/// Drop the future or stream to cancel; use the host executor for deadlines.
/// Backends must not block in poll/Drop and must reject redirects, retries and
/// ambient credentials. No producer is polled before a successful socket handshake.
pub async fn synthesize(
    request: TtsRequest,
    options: Options<'_>,
) -> Result<Stream, TransportError> {
    let validate = validate_request(&request)?;
    let mut settings = settings::resolve(request);
    let mut key = options
        .auth
        .and_then(|a| a.voice_ai.as_ref())
        .and_then(|a| a.api_key.clone());
    if key.is_none() {
        for name in ["SPEECHSWITCH_VOICE_AI_API_KEY", "VOICE_AI_API_KEY"] {
            match std::env::var(name) {
                Ok(value) => {
                    key = Some(value);
                    break;
                }
                Err(std::env::VarError::NotPresent) => {}
                Err(_) => return Err(failure("Invalid Voice.ai environment credential")),
            }
        }
    }
    let key = key
        .filter(|v| !v.is_empty())
        .ok_or_else(|| failure("Missing auth.voice.ai.apiKey configuration"))?;
    if !key.bytes().all(|b| (33..=126).contains(&b)) {
        return Err(failure(
            "Voice.ai API key must contain only visible ASCII characters",
        ));
    }
    if options.max_message_bytes == 0 || options.max_message_bytes as u64 > 9007199254740991 {
        return Err(failure(
            "Voice.ai max_message_bytes must be a positive safe integer",
        ));
    }
    let required = matches!(settings.text, Text::AsyncIterable(_)) || settings.paced;
    let protocol = options
        .protocol
        .unwrap_or(if required || options.web_socket.is_some() {
            Protocol::WebSocket
        } else {
            Protocol::Stream
        });
    if protocol != Protocol::WebSocket && required {
        return Err(failure(
            "Voice.ai incremental input and paced delivery require WebSocket",
        ));
    }
    if protocol != Protocol::WebSocket && options.web_socket.is_some() {
        return Err(failure(
            "Voice.ai WebSocket override requires WebSocket transport",
        ));
    }
    if protocol == Protocol::WebSocket && settings.legacy {
        return Err(failure(
            "Voice.ai legacy API does not document WebSocket synthesis",
        ));
    }
    let path = if settings.legacy {
        settings.wire.insert(
            "streaming".into(),
            JsonValue::Bool(protocol == Protocol::Stream),
        );
        "/tts/v2/audio/speech"
    } else {
        match protocol {
            Protocol::Http => "/api/v1/tts/speech",
            Protocol::Stream => "/api/v1/tts/speech/stream",
            Protocol::WebSocket => "/api/v1/tts/multi-stream",
        }
    };
    let url = endpoint(
        options.base_url.unwrap_or(if settings.legacy {
            "https://api.voice.ai"
        } else {
            "https://dev.voice.ai"
        }),
        path,
        protocol == Protocol::WebSocket,
    )?;
    let mut headers = vec![("Authorization".into(), format!("Bearer {key}"))];
    if protocol == Protocol::WebSocket {
        settings.wire.insert(
            "delivery_mode".into(),
            JsonValue::String(if settings.paced { "paced" } else { "raw" }.into()),
        );
        let mut bytes = [0u8; 16];
        if let Some(entropy) = options.entropy {
            entropy.fill(&mut bytes)?;
        } else {
            options
                .web_socket_transport
                .ok_or_else(|| {
                    failure("Voice.ai socket entropy source or WebSocket transport is required")
                })?
                .random_bytes(&mut bytes)?;
        }
        let prefix = bytes.iter().map(|b| format!("{b:02x}")).collect();
        let socket = match options.web_socket {
            Some(socket) => socket,
            None => {
                options
                    .web_socket_transport
                    .ok_or_else(|| failure("Voice.ai WebSocket transport is required"))?
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
            settings,
            prefix,
            options.max_message_bytes,
            Box::new(validate),
        ))
    } else {
        let Text::String(text) = settings.text else {
            unreachable!("streaming HTTP rejected")
        };
        settings.wire.insert("text".into(), JsonValue::String(text));
        let mut body = String::new();
        json::write(&JsonValue::Object(settings.wire), &mut body)?;
        headers.push(("Content-Type".into(), "application/json".into()));
        headers.push(("Accept".into(), "audio/*, application/octet-stream".into()));
        let response = options
            .transport
            .ok_or_else(|| failure("Voice.ai HTTP transport is required"))?
            .send(HttpRequest {
                method: "POST".into(),
                url,
                headers,
                body: body.into_bytes(),
            })
            .await?;
        if !(200..300).contains(&response.status) {
            return Err(Box::new(Error {
                status: Some(response.status),
                context_id: None,
            }));
        }
        for (_, value) in response
            .headers
            .iter()
            .filter(|(key, _)| key.eq_ignore_ascii_case("content-type"))
        {
            let media = value
                .split(';')
                .next()
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase();
            if !media.is_empty()
                && !media.starts_with("audio/")
                && media != "application/octet-stream"
            {
                return Err(failure(
                    "Voice.ai returned an unexpected audio content type",
                ));
            }
        }
        Ok(Stream::http(response.body))
    }
}
fn endpoint(base: &str, path: &str, socket: bool) -> Result<String, TransportError> {
    let invalid = || {
        failure("Voice.ai BaseURL must be an HTTP or WebSocket base without credentials, query or fragment")
    };
    crate::endpoint::validate(base, &["http", "https", "ws", "wss"]).ok_or_else(invalid)?;
    if base.contains('?') {
        return Err(invalid());
    }
    let (scheme, tail) = base.split_once("://").expect("validated URL");
    let secure = scheme.eq_ignore_ascii_case("https") || scheme.eq_ignore_ascii_case("wss");
    let scheme = match (socket, secure) {
        (true, true) => "wss",
        (true, false) => "ws",
        (false, true) => "https",
        (false, false) => "http",
    };
    Ok(format!("{scheme}://{}{path}", tail.trim_end_matches('/')))
}
