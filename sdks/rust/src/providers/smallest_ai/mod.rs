//! Handwritten Smallest.ai wire protocol with TypeScript-generated public contracts.
mod protocol;
mod settings;
mod stream;
#[cfg(test)]
mod tests;
pub use crate::generated::{smallest_ai::TtsRequest, smallest_ai_output::SynthesisItem};
use crate::{
    endpoint,
    entropy::Entropy,
    generated::{auth::Auth, validators::smallest_ai::validate_request},
    http::{HttpRequest, HttpTransport, TransportError},
    json,
    websocket::{ConnectRequest, Socket, WebSocketTransport},
};
use stream::Source;
pub use stream::Stream;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Protocol {
    Http,
    Sse,
    WebSocket,
}
pub struct Options<'a> {
    pub auth: Option<&'a Auth>,
    pub transport: Option<&'a dyn HttpTransport>,
    pub web_socket_transport: Option<&'a dyn WebSocketTransport>,
    /// Exclusive, already-authenticated/configured override; dropped on every exit.
    pub web_socket: Option<Socket>,
    /// Required for new request identities with an override; native backends supply OS entropy.
    pub entropy: Option<&'a dyn Entropy>,
    pub base_url: Option<&'a str>,
    pub web_socket_url: Option<&'a str>,
    /// Omission selects SSE for whole text, WebSocket for incremental input/timestamps.
    pub protocol: Option<Protocol>,
    /// Capped at 180; heartbeats use half this timeout, including with overrides.
    pub idle_timeout_seconds: u64,
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
            web_socket_url: None,
            protocol: None,
            idle_timeout_seconds: 60,
            max_message_bytes: 4 * 1024 * 1024,
        }
    }
}
#[derive(Debug, PartialEq, Eq)]
pub struct Error {
    pub message: String,
    pub status: Option<u16>,
    pub code: Option<String>,
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

/// Owns the request and override immediately. Drop the future or stream to cancel;
/// the host executor applies deadlines. Continuations drain until dropped, never
/// inferring final context completion from a segment, silence or socket closure.
pub async fn synthesize(
    mut request: TtsRequest,
    options: Options<'_>,
) -> Result<Stream, TransportError> {
    settings::trim(&mut request);
    let validate = validate_request(&request)?;
    let settings = settings::prepare(&request);
    if options.max_message_bytes == 0 {
        return Err(failure("Smallest.ai max_message_bytes must be positive"));
    }
    if options.idle_timeout_seconds == 0 || options.idle_timeout_seconds > 9007199254740991 {
        return Err(failure(
            "Smallest.ai idle_timeout_seconds must be a positive safe integer",
        ));
    }
    let idle_timeout_seconds = options.idle_timeout_seconds.min(180);
    let mut key = options
        .auth
        .and_then(|a| a.smallest_ai.as_ref())
        .and_then(|a| a.api_key.clone());
    if key.is_none() {
        for name in ["SPEECHSWITCH_SMALLEST_API_KEY", "SMALLEST_API_KEY"] {
            match std::env::var(name) {
                Ok(value) => {
                    key = Some(value);
                    break;
                }
                Err(std::env::VarError::NotPresent) => {}
                Err(_) => return Err(failure("Invalid Smallest.ai environment credential")),
            }
        }
    }
    let key = key
        .filter(|v| !v.is_empty())
        .ok_or_else(|| failure("Missing auth.smallest.ai.apiKey configuration"))?;
    if !key.bytes().all(|b| (32..=126).contains(&b)) {
        return Err(failure(
            "Smallest.ai API key must be a printable ASCII header value",
        ));
    }
    let source = match request {
        TtsRequest::LightningV31ProStreamingTextVoice8f1b36fb(v) => Source::Commands(v.text),
        TtsRequest::LightningV31ProStreamingTextVoiced206187f(v) => Source::Text(v.text),
        TtsRequest::LightningV31ProTextVoice74d06326(v) => Source::Whole(Some(v.text)),
        TtsRequest::LightningV31ProStreamingTextVoice4f8c2395(v) => Source::Commands(v.text),
        TtsRequest::LightningV31ProStreamingTextVoice2da2f6d9(v) => Source::Text(v.text),
        TtsRequest::LightningV31ProTextVoice3c7c5185(v) => Source::Whole(Some(v.text)),
        TtsRequest::LightningV31StreamingTextVoicebf9ab904(v) => Source::Commands(v.text),
        TtsRequest::LightningV31StreamingTextVoiced272850b(v) => Source::Text(v.text),
        TtsRequest::LightningV31TextVoice5e2ae2e5(v) => Source::Whole(Some(v.text)),
        TtsRequest::LightningV31StreamingTextVoice90b1878c(v) => Source::Commands(v.text),
        TtsRequest::LightningV31StreamingTextVoicea9844e06(v) => Source::Text(v.text),
        TtsRequest::LightningV31TextVoice727240a7(v) => Source::Whole(Some(v.text)),
    };
    let required = !matches!(source, Source::Whole(_))
        || settings.timed
        || options.web_socket.is_some()
        || options.web_socket_url.is_some();
    let protocol = options.protocol.unwrap_or(if required {
        Protocol::WebSocket
    } else {
        Protocol::Sse
    });
    if protocol != Protocol::WebSocket && required {
        return Err(failure("Smallest.ai incremental text, timestamps and socket overrides require WebSocket transport"));
    }
    if protocol == Protocol::WebSocket && settings.dictionaries {
        return Err(failure(
            "Smallest.ai pronunciation dictionaries are documented only for HTTP/SSE",
        ));
    }
    let base = options.base_url.unwrap_or("https://api.smallest.ai");
    let mut url = endpoint::append(
        base,
        if protocol == Protocol::Http {
            "/waves/v1/tts"
        } else {
            "/waves/v1/tts/live"
        },
    )
    .ok_or_else(|| failure("Invalid Smallest.ai endpoint URL"))?;
    endpoint::validate(&url, &["http", "https"])
        .ok_or_else(|| failure("Invalid Smallest.ai endpoint URL"))?;
    let mut headers = vec![("Authorization".into(), format!("Bearer {key}"))];
    if settings.retention {
        headers.push(("x-expire-content".into(), "true".into()));
    }
    if protocol == Protocol::WebSocket {
        if let Some(explicit) = options.web_socket_url {
            url = explicit.to_owned();
        } else {
            let (scheme, tail) = url.split_once("://").expect("validated URL");
            url = format!(
                "{}://{tail}",
                if scheme.eq_ignore_ascii_case("https") {
                    "wss"
                } else {
                    "ws"
                }
            );
        }
        endpoint::validate(&url, &["ws", "wss"])
            .ok_or_else(|| failure("Invalid Smallest.ai endpoint URL"))?;
        endpoint::set_query(
            &mut url,
            "timeout",
            &idle_timeout_seconds.to_string(),
        )
        .ok_or_else(|| failure("Invalid Smallest.ai endpoint query"))?;
        let mut prefix = String::new();
        if settings.request_id.is_none() || settings.continuation.is_some() {
            let mut bytes = [0; 16];
            if let Some(entropy) = options.entropy {
                entropy.fill(&mut bytes)?;
            } else if options.web_socket.is_none() {
                options
                    .web_socket_transport
                    .ok_or_else(|| failure("Smallest.ai WebSocket transport is required"))?
                    .random_bytes(&mut bytes)?;
            } else {
                return Err(failure(
                    "Smallest.ai socket override entropy source is required",
                ));
            }
            prefix = bytes.iter().map(|b| format!("{b:02x}")).collect();
        }
        let socket = match options.web_socket {
            Some(socket) => socket,
            None => {
                options
                    .web_socket_transport
                    .ok_or_else(|| failure("Smallest.ai WebSocket transport is required"))?
                    .connect(ConnectRequest {
                        url,
                        headers,
                        max_message_bytes: options.max_message_bytes,
                    })
                    .await?
            }
        };
        Stream::socket(
            socket,
            source,
            settings,
            prefix,
            options.max_message_bytes,
            Box::new(validate),
            std::time::Duration::from_millis(idle_timeout_seconds * 500),
        )
    } else {
        let Source::Whole(Some(text)) = source else {
            unreachable!("streaming HTTP rejected")
        };
        let mut wire = settings.wire;
        wire.pop();
        wire.push_str(",\"text\":");
        json::quote(&text, &mut wire);
        if let Some(id) = settings.request_id {
            wire.push_str(",\"request_id\":");
            json::quote(&id, &mut wire);
        }
        wire.push('}');
        headers.push(("Content-Type".into(), "application/json".into()));
        headers.push((
            "Accept".into(),
            if protocol == Protocol::Http {
                "audio/wav"
            } else {
                "text/event-stream"
            }
            .into(),
        ));
        let response = options
            .transport
            .ok_or_else(|| failure("Smallest.ai HTTP transport is required"))?
            .send(HttpRequest {
                method: "POST".into(),
                url,
                headers,
                body: wire.into_bytes(),
            })
            .await?;
        if !(200..300).contains(&response.status) {
            return Err(Box::new(Error {
                message: format!("Smallest.ai returned HTTP {}", response.status),
                status: Some(response.status),
                code: None,
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
                && !(if protocol == Protocol::Http {
                    media.starts_with("audio/") || media == "application/octet-stream"
                } else {
                    media == "text/event-stream"
                })
            {
                return Err(failure("Smallest.ai returned an unexpected content type"));
            }
        }
        Stream::http(
            response.body,
            protocol == Protocol::Sse,
            options.max_message_bytes,
        )
    }
}
