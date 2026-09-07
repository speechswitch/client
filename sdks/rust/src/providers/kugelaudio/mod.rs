//! KugelAudio's handwritten native wire protocols with TypeScript-generated API types.
mod protocol;
mod settings;
mod stream;
#[cfg(test)]
mod tests;

pub use crate::generated::{
    kugelaudio::{TtsRequest, TtsRequestStreamingTextVoiceTextItem as Input},
    kugelaudio_output::SynthesisItem,
};
use crate::{
    endpoint,
    generated::{auth::Auth, validators::kugelaudio::validate_request},
    http::{HttpRequest, HttpTransport, TransportError},
    json::{self, Raw},
    runtime::JsonValue,
    websocket::{ConnectRequest, Socket, WebSocketTransport},
};
use protocol::failure;
pub use protocol::Error;
use std::{future::poll_fn, task::Poll};
pub use stream::Stream;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Region {
    Eu,
    Global,
}
pub struct Options<'a> {
    pub auth: Option<&'a Auth>,
    pub transport: Option<&'a dyn HttpTransport>,
    pub web_socket_transport: Option<&'a dyn WebSocketTransport>,
    /// Owned, exclusive, already-authenticated socket override.
    pub web_socket: Option<Socket>,
    pub base_url: Option<&'a str>,
    pub web_socket_url: Option<&'a str>,
    pub region: Option<Region>,
    pub on_warning: Option<Box<dyn FnMut(&str) + Send>>,
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
            region: None,
            on_warning: None,
            max_json_bytes: 16 * 1024 * 1024,
            max_message_bytes: 4 * 1024 * 1024,
        }
    }
}
/// Drop the future or stream to cancel. HTTP/TLS and native sockets are injected;
/// their polls/destructors must be nonblocking and never replay authentication.
pub async fn synthesize(
    request: TtsRequest,
    options: Options<'_>,
) -> Result<Stream, TransportError> {
    let validate = validate_request(&request)?;
    if options.max_json_bytes == 0 || options.max_json_bytes > u32::MAX as usize {
        return Err(failure(
            "KugelAudio max_json_bytes must be a positive uint32 value",
        ));
    }
    if options.max_message_bytes == 0 || options.max_message_bytes > u32::MAX as usize {
        return Err(failure(
            "KugelAudio max_message_bytes must be a positive uint32 value",
        ));
    }
    let mut c = settings::settings(request)?;
    let mut key = options
        .auth
        .and_then(|a| a.kugelaudio.as_ref())
        .and_then(|a| a.api_key.clone());
    if key.is_none() {
        for name in ["SPEECHSWITCH_KUGELAUDIO_API_KEY", "KUGELAUDIO_API_KEY"] {
            match std::env::var(name) {
                Ok(value) => {
                    key = Some(value);
                    break;
                }
                Err(std::env::VarError::NotPresent) => {}
                Err(_) => return Err(failure("Invalid KugelAudio environment credential")),
            }
        }
    }
    let key = key.unwrap_or_default();
    let eu = key.starts_with("eu-");
    let credential = key.strip_prefix("eu-").unwrap_or(&key);
    if credential.is_empty() && options.web_socket.is_none() {
        return Err(failure("Missing auth.kugelaudio.apiKey configuration"));
    }
    if !credential.bytes().all(|b| (32..=126).contains(&b)) {
        return Err(failure("Invalid KugelAudio authentication header"));
    }
    let authorization = format!("Bearer {credential}");
    let socket_mode = c.socket || options.web_socket.is_some() || options.web_socket_url.is_some();
    let region = options
        .region
        .unwrap_or(if eu { Region::Eu } else { Region::Global });
    let base = options.base_url.unwrap_or(if region == Region::Eu {
        "https://api.eu.kugelaudio.com"
    } else {
        "https://api.kugelaudio.com"
    });
    let url = speech_url(base, options.web_socket_url, socket_mode, c.input.is_some())?;
    if socket_mode {
        c.body
            .insert("word_timestamps".into(), JsonValue::Bool(c.timed));
        c.body
            .insert("speaker_prefix".into(), JsonValue::Bool(c.speaker));
        let socket = match options.web_socket {
            Some(socket) => socket,
            None => {
                options
                    .web_socket_transport
                    .ok_or_else(|| failure("KugelAudio WebSocket transport is required"))?
                    .connect(ConnectRequest {
                        url,
                        headers: vec![("authorization".into(), authorization)],
                        max_message_bytes: options.max_message_bytes,
                    })
                    .await?
            }
        };
        return Ok(Stream::socket(
            socket,
            c,
            options.max_message_bytes,
            Box::new(validate),
            options.on_warning.unwrap_or_else(|| Box::new(|_| {})),
        ));
    }
    let transport = options
        .transport
        .ok_or_else(|| failure("KugelAudio HTTP transport is required"))?;
    let mut body = String::new();
    json::write(&JsonValue::Object(c.body), &mut body)?;
    let mut response = transport
        .send(HttpRequest {
            method: "POST".into(),
            url,
            headers: vec![
                ("authorization".into(), authorization),
                ("content-type".into(), "application/json".into()),
            ],
            body: body.into_bytes(),
        })
        .await?;
    if !(200..300).contains(&response.status) {
        let mut data = Vec::new();
        while let Some(chunk) = poll_fn(|cx| response.body.as_mut().poll_next(cx)).await {
            let chunk = chunk?;
            if chunk.len() > options.max_json_bytes - data.len() {
                return Err(failure("KugelAudio response exceeds max_json_bytes"));
            }
            data.extend(chunk);
            let mut yielded = false;
            poll_fn(|cx| {
                if yielded {
                    Poll::Ready(())
                } else {
                    yielded = true;
                    cx.waker().wake_by_ref();
                    Poll::Pending
                }
            })
            .await;
        }
        let status = response.status as u64;
        let retry_after = response
            .headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case("retry-after"))
            .map(|(_, v)| v.clone());
        drop(response);
        let mut message =
            String::from_utf8_lossy(data.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&data))
                .into_owned();
        let mut code = None;
        if let Ok(fields) = Raw::parse_exact(&message).and_then(|v| v.object()) {
            code = fields.get("error_code").and_then(|v| v.string().ok());
            if let Some(value) = fields.get("error").and_then(|v| v.string().ok()) {
                message = value;
            }
        }
        return Err(Box::new(Error {
            message,
            status: Some(status),
            code,
            retry_after,
        }));
    }
    for (key, value) in &response.headers {
        if (key.eq_ignore_ascii_case("x-sample-rate") && value.trim().parse().ok() != Some(c.rate))
            || (key.eq_ignore_ascii_case("x-audio-format") && value != c.encoding)
        {
            return Err(failure("KugelAudio returned an unexpected audio format"));
        }
    }
    Ok(Stream::http(response.body))
}

fn speech_url(
    base: &str,
    override_url: Option<&str>,
    socket: bool,
    live: bool,
) -> Result<String, TransportError> {
    let target = override_url.unwrap_or(base);
    let invalid = || failure("Invalid KugelAudio endpoint URL");
    endpoint::validate(
        target,
        if socket {
            &["http", "https", "ws", "wss"]
        } else {
            &["http", "https"]
        },
    )
    .ok_or_else(invalid)?;
    let mut bytes = target.bytes();
    while let Some(b) = bytes.next() {
        if b == b'%'
            && !(bytes.next().is_some_and(|b| b.is_ascii_hexdigit())
                && bytes.next().is_some_and(|b| b.is_ascii_hexdigit()))
        {
            return Err(invalid());
        }
    }
    let (scheme, tail) = target.split_once("://").unwrap();
    let lower = scheme.to_ascii_lowercase();
    let scheme = match lower.as_str() {
        "http" if socket => "ws",
        "https" if socket => "wss",
        v => v,
    };
    let (path, query) = tail.split_once('?').unwrap_or((tail, ""));
    let mut url = format!("{scheme}://{path}");
    if override_url.is_none() {
        url.truncate(url.trim_end_matches('/').len());
        url.push_str(if live {
            "/ws/tts/stream"
        } else if socket {
            "/ws/tts"
        } else {
            "/v1/tts/generate"
        });
    }
    if tail.contains('?') {
        url.push('?');
        url.push_str(query);
    }
    Ok(url)
}
