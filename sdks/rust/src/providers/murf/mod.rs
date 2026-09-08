//! Murf's handwritten Falcon HTTP/WebSocket and Gen2 generation protocols.
mod http;
mod protocol;
mod settings;
mod socket;
#[cfg(test)]
mod tests;

pub use crate::generated::{
    murf::{TtsRequest, TtsRequestStreamingTextVoiceTextItem as Input},
    murf_output::SynthesisItem,
};
use crate::{
    entropy::Entropy,
    generated::{auth::Auth, validators::murf::validate_request},
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
    /// Exclusively owned, already-authenticated socket override.
    pub web_socket: Option<Socket>,
    /// Overrides need OS entropy; otherwise use the native socket backend's source.
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
/// Drop the future or stream to cancel; an executor timeout can bound the operation.
/// Backends own TCP/TLS, must not block in poll/Drop, and must reject redirects,
/// retries and ambient credentials, including on independent audio downloads.
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
                "Murf {name} must be a positive uint32 value"
            )));
        }
    }
    let settings = settings::settings(request);
    let live = settings.input.is_some();
    if !live && (options.web_socket.is_some() || options.web_socket_url.is_some()) {
        return Err(failure("Murf WebSocket overrides require streaming input"));
    }
    let mut key = options
        .auth
        .and_then(|a| a.murf.as_ref())
        .and_then(|a| a.api_key.clone());
    if key.is_none() {
        for name in ["SPEECHSWITCH_MURF_API_KEY", "MURF_API_KEY"] {
            match std::env::var(name) {
                Ok(value) => {
                    key = Some(value);
                    break;
                }
                Err(std::env::VarError::NotPresent) => {}
                Err(_) => return Err(failure("Invalid Murf environment credential")),
            }
        }
    }
    let key = key.unwrap_or_default();
    if key.is_empty() && options.web_socket.is_none() {
        return Err(failure("Missing auth.murf.apiKey configuration"));
    }
    if !key.bytes().all(|b| (32..=126).contains(&b)) {
        return Err(failure("Invalid Murf authentication header"));
    }
    let base = url(
        options.base_url.unwrap_or(if settings.gen2 {
            "https://api.murf.ai"
        } else {
            "https://global.api.murf.ai"
        }),
        "",
        false,
    )?;
    if live {
        let mut target = if let Some(target) = options.web_socket_url {
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
                "/v1/speech/stream-input",
                true,
            )?
        };
        crate::endpoint::remove_query(&mut target, "api_key")
            .ok_or_else(|| failure("Invalid Murf endpoint URL"))?;
        for (key, value) in [
            ("model", "falcon-2"),
            ("format", settings.format.as_str()),
            ("sample_rate", &settings.rate.to_string()),
            ("channel_type", settings.channel),
        ] {
            crate::endpoint::set_query(&mut target, key, value)
                .ok_or_else(|| failure("Invalid Murf endpoint URL"))?;
        }
        let mut bytes = [0u8; 16];
        if let Some(entropy) = options.entropy {
            entropy.fill(&mut bytes)?;
        } else {
            options
                .web_socket_transport
                .ok_or_else(|| {
                    failure("Murf socket entropy source or WebSocket transport is required")
                })?
                .random_bytes(&mut bytes)?;
        }
        let session = bytes.iter().map(|b| format!("{b:02x}")).collect();
        let socket = match options.web_socket {
            Some(socket) => socket,
            None => {
                options
                    .web_socket_transport
                    .ok_or_else(|| failure("Murf WebSocket transport is required"))?
                    .connect(ConnectRequest {
                        url: target,
                        headers: vec![("api_key".into(), key)],
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
            .ok_or_else(|| failure("Murf HTTP transport is required"))?;
        let mut body = String::new();
        json::write(&JsonValue::Object(settings.wire), &mut body)?;
        let response = transport
            .send(HttpRequest {
                method: "POST".into(),
                url: url(
                    &base,
                    if settings.gen2 {
                        "/v1/speech/generate"
                    } else {
                        "/v1/speech/stream"
                    },
                    false,
                )?,
                headers: vec![
                    ("api-key".into(), key),
                    ("Content-Type".into(), "application/json".into()),
                    (
                        "Accept".into(),
                        if settings.gen2 {
                            "application/json"
                        } else {
                            "audio/*, application/octet-stream"
                        }
                        .into(),
                    ),
                ],
                body: body.into_bytes(),
            })
            .await?;
        Ok(Stream {
            state: Some(State::Http(http::HttpStream::new(
                response,
                transport,
                settings.gen2,
                settings.timed,
                settings.inline,
                options.max_json_bytes,
            ))),
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
        return Err(failure("Invalid Murf endpoint URL"));
    }
    let bytes = base.as_bytes();
    for (i, b) in bytes.iter().enumerate() {
        if *b == b'%'
            && !bytes
                .get(i + 1..i + 3)
                .is_some_and(|v| v.iter().all(u8::is_ascii_hexdigit))
        {
            return Err(failure("Invalid Murf endpoint URL"));
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
/// Owns input and network resources. Completion and errors release them immediately.
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
