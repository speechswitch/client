//! MiniMax's handwritten HTTP and bidirectional socket protocols with generated API types.
mod format;
mod http;
mod protocol;
mod settings;
mod socket;
#[cfg(test)]
mod tests;

pub use crate::generated::{
    minimax::{TtsRequest, TtsRequestStreamingText12421ea0TextItem as Input},
    minimax_output::SynthesisItem,
};
use crate::{
    entropy::Entropy,
    generated::{auth::Auth, validators::minimax::validate_request},
    http::{HttpRequest, HttpTransport, TransportError},
    json,
    runtime::{InputStream, JsonValue},
    websocket::{ConnectRequest, Socket, WebSocketTransport},
};
use protocol::failure;
pub use protocol::Error;
use std::{
    pin::Pin,
    task::{Context, Poll},
};

pub struct Options<'a> {
    pub auth: Option<&'a Auth>,
    pub transport: Option<&'a dyn HttpTransport>,
    pub web_socket_transport: Option<&'a dyn WebSocketTransport>,
    /// Exclusively owned, already-authenticated native socket override.
    pub web_socket: Option<Socket>,
    /// Overrides need OS entropy; otherwise use the native socket backend's entropy.
    pub entropy: Option<&'a dyn Entropy>,
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
            entropy: None,
            base_url: None,
            web_socket_url: None,
            max_json_bytes: 16 * 1024 * 1024,
            max_message_bytes: 4 * 1024 * 1024,
        }
    }
}
/// Drop the future or stream to cancel. An executor timeout can bound the entire
/// operation. Backends own TCP/TLS, must not block in poll/Drop, and must reject
/// redirects, retries and ambient credentials (especially on subtitle downloads).
pub async fn synthesize<'a>(
    request: TtsRequest,
    options: Options<'a>,
) -> Result<Stream<'a>, TransportError> {
    let validate = validate_request(&request)?;
    for (value, name) in [
        (options.max_json_bytes, "max_json_bytes"),
        (options.max_message_bytes, "max_message_bytes"),
    ] {
        if value == 0 || value > u32::MAX as usize {
            return Err(failure(&format!(
                "MiniMax {name} must be a positive uint32 value"
            )));
        }
    }
    let mut settings = settings::settings(request);
    let live = settings.input.is_some();
    if !live && (options.web_socket.is_some() || options.web_socket_url.is_some()) {
        return Err(failure(
            "MiniMax WebSocket overrides require streaming input",
        ));
    }
    let mut key = options
        .auth
        .and_then(|a| a.minimax.as_ref())
        .and_then(|a| a.api_key.clone());
    if key.is_none() {
        for name in ["SPEECHSWITCH_MINIMAX_API_KEY", "MINIMAX_API_KEY"] {
            match std::env::var(name) {
                Ok(value) => {
                    key = Some(value);
                    break;
                }
                Err(std::env::VarError::NotPresent) => {}
                Err(_) => return Err(failure("Invalid MiniMax environment credential")),
            }
        }
    }
    let key = key.unwrap_or_default();
    if key.is_empty() && options.web_socket.is_none() {
        return Err(failure("Missing auth.minimax.apiKey configuration"));
    }
    if !key.bytes().all(|b| (32..=126).contains(&b)) {
        return Err(failure("Invalid MiniMax authentication header"));
    }
    let base = url(
        options.base_url.unwrap_or("https://api.minimax.io"),
        "",
        false,
    )?;
    let mut headers = vec![("Authorization".into(), format!("Bearer {key}"))];
    if live {
        let target = if let Some(target) = options.web_socket_url {
            url(target, "", true)?
        } else {
            let (scheme, tail) = base.split_once("://").unwrap();
            url(
                &format!(
                    "{}://{tail}",
                    if scheme.eq_ignore_ascii_case("https") {
                        "wss"
                    } else {
                        "ws"
                    }
                ),
                "/ws/v1/t2a_v2_bidi",
                true,
            )?
        };
        let mut bytes = [0u8; 16];
        if let Some(entropy) = options.entropy {
            entropy.fill(&mut bytes)?;
        } else {
            options
                .web_socket_transport
                .ok_or_else(|| {
                    failure("MiniMax socket entropy source or WebSocket transport is required")
                })?
                .random_bytes(&mut bytes)?;
        }
        bytes[6] = (bytes[6] & 15) | 64;
        bytes[8] = (bytes[8] & 63) | 128;
        let session = bytes.iter().map(|v| format!("{v:02x}")).collect();
        let socket = match options.web_socket {
            Some(v) => v,
            None => {
                options
                    .web_socket_transport
                    .ok_or_else(|| failure("MiniMax WebSocket transport is required"))?
                    .connect(ConnectRequest {
                        url: target,
                        headers,
                        max_message_bytes: options.max_message_bytes,
                    })
                    .await?
            }
        };
        Ok(Stream {
            state: Some(State::Socket(socket::SocketStream::new(
                socket,
                settings,
                session,
                options.max_message_bytes,
                Box::new(validate),
            ))),
        })
    } else {
        let transport = options
            .transport
            .ok_or_else(|| failure("MiniMax HTTP transport is required"))?;
        settings.wire.insert(
            "text".into(),
            JsonValue::String(settings.text.take().unwrap()),
        );
        settings
            .wire
            .insert("stream".into(), JsonValue::Bool(settings.streaming));
        settings
            .wire
            .insert("output_format".into(), JsonValue::String("hex".into()));
        settings.wire.insert(
            "subtitle_enable".into(),
            JsonValue::Bool(settings.timing.is_some()),
        );
        if settings.streaming {
            settings.wire.insert(
                "stream_options".into(),
                JsonValue::Object(settings::Map::from([(
                    "exclude_aggregated_audio".into(),
                    JsonValue::Bool(true),
                )])),
            );
        }
        if let Some(kind) = settings.timing {
            settings
                .wire
                .insert("subtitle_type".into(), JsonValue::String(kind.into()));
        }
        let mut data = String::new();
        json::write(&JsonValue::Object(settings.wire), &mut data)?;
        headers.push(("Content-Type".into(), "application/json".into()));
        let response = transport
            .send(HttpRequest {
                method: "POST".into(),
                url: url(&base, "/v1/t2a_v2", false)?,
                headers,
                body: data.into_bytes(),
            })
            .await?;
        Ok(Stream {
            state: Some(State::Http(http::HttpStream::new(
                response,
                transport,
                settings.timing,
                options.max_json_bytes,
            )?)),
        })
    }
}

fn url(base: &str, suffix: &str, socket: bool) -> Result<String, TransportError> {
    if crate::endpoint::validate(
        base,
        if socket {
            &["ws", "wss"]
        } else {
            &["http", "https"]
        },
    )
    .is_none()
    {
        return Err(failure("Invalid MiniMax endpoint URL"));
    }
    let bytes = base.as_bytes();
    for (i, b) in bytes.iter().enumerate() {
        if *b == b'%'
            && !bytes
                .get(i + 1..i + 3)
                .is_some_and(|v| v.iter().all(u8::is_ascii_hexdigit))
        {
            return Err(failure("Invalid MiniMax endpoint URL"));
        }
    }
    if suffix.is_empty() {
        return Ok(base.into());
    }
    let (path, query) = base
        .split_once('?')
        .map_or((base, String::new()), |(p, q)| (p, format!("?{q}")));
    Ok(format!("{}{suffix}{query}", path.trim_end_matches('/')))
}

enum State<'a> {
    Http(http::HttpStream<'a>),
    Socket(socket::SocketStream),
}
/// Owns network I/O and input. Terminal errors and done events release resources immediately.
pub struct Stream<'a> {
    state: Option<State<'a>>,
}
impl InputStream<SynthesisItem> for Stream<'_> {
    fn poll_next(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<SynthesisItem, TransportError>>> {
        let s = self.get_mut();
        let Some(state) = &mut s.state else {
            return Poll::Ready(None);
        };
        let (result, done) = match state {
            State::Http(v) => (v.next(cx), v.done),
            State::Socket(v) => (v.next(cx), v.done),
        };
        if done || matches!(result, Poll::Ready(Err(_)) | Poll::Ready(Ok(None))) {
            s.state = None;
        }
        match result {
            Poll::Pending => Poll::Pending,
            Poll::Ready(v) => Poll::Ready(v.transpose()),
        }
    }
}
