//! Inworld's handwritten wire protocols with TypeScript-generated API types.
mod protocol;
mod settings;
mod stream;
#[cfg(test)]
mod tests;

pub use crate::generated::{
    inworld::{TtsRequest, TtsRequestStreamingTextVoiceTextItem as Input},
    inworld_output::SynthesisItem,
};
use crate::{
    endpoint,
    generated::{auth::Auth, validators::inworld::validate_request},
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
pub enum HttpMode {
    Stream,
    Single,
}
pub struct Options<'a> {
    pub auth: Option<&'a Auth>,
    pub transport: Option<&'a dyn HttpTransport>,
    pub web_socket_transport: Option<&'a dyn WebSocketTransport>,
    /// Owned, exclusively used, already-authenticated socket override.
    pub web_socket: Option<Socket>,
    pub base_url: Option<&'a str>,
    pub web_socket_url: Option<&'a str>,
    pub http_mode: Option<HttpMode>,
    /// Omission obtains random bytes from web_socket_transport, even for an override.
    pub context_id: Option<&'a str>,
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
            http_mode: None,
            context_id: None,
            max_json_bytes: 16 * 1024 * 1024,
            max_message_bytes: 4 * 1024 * 1024,
        }
    }
}

/// Drop the synthesis future or stream to cancel; executor timeouts can bound the
/// operation. Injected backends own TCP/TLS and must never retry or redirect
/// authenticated synthesis. Poll methods and destructors must not block.
pub async fn synthesize(
    request: TtsRequest,
    options: Options<'_>,
) -> Result<Stream, TransportError> {
    let validate = validate_request(&request)?;
    if options.max_json_bytes == 0 || options.max_json_bytes > u32::MAX as usize {
        return Err(failure(
            "Inworld max_json_bytes must be a positive uint32 value",
        ));
    }
    if options.max_message_bytes == 0 || options.max_message_bytes > u32::MAX as usize {
        return Err(failure(
            "Inworld max_message_bytes must be a positive uint32 value",
        ));
    }
    let mut c = settings::settings(request)?;
    let live = c.input.is_some();
    if !live
        && (options.web_socket.is_some()
            || options.web_socket_url.is_some()
            || options.context_id.is_some())
    {
        return Err(failure("Inworld WebSocket options require streaming input"));
    }
    if live && options.http_mode.is_some() {
        return Err(failure("Inworld http_mode requires static text"));
    }
    let mode = options.http_mode.unwrap_or(HttpMode::Stream);
    if mode == HttpMode::Single {
        if let Some(JsonValue::String(text)) = c.body.get("text") {
            if text.encode_utf16().count() > 2000 {
                return Err(failure(
                    "Inworld single-response text must not exceed 2000 characters",
                ));
            }
        }
    }
    let entry = options.auth.and_then(|v| v.inworld.as_ref());
    let token = entry
        .and_then(|v| v.access_token.as_deref())
        .filter(|v| !v.is_empty());
    let mut key = entry.and_then(|v| v.api_key.clone());
    if key.is_none() && token.is_none() {
        for name in ["SPEECHSWITCH_INWORLD_API_KEY", "INWORLD_API_KEY"] {
            match std::env::var(name) {
                Ok(value) => {
                    key = Some(value);
                    break;
                }
                Err(std::env::VarError::NotPresent) => {}
                Err(_) => return Err(failure("Invalid Inworld environment credential")),
            }
        }
    }
    let key = key.unwrap_or_default();
    let credential = token.unwrap_or(&key);
    if credential.is_empty() && options.web_socket.is_none() {
        return Err(failure("Missing auth.inworld.apiKey configuration"));
    }
    if !credential.bytes().all(|b| (32..=126).contains(&b)) {
        return Err(failure("Invalid Inworld authentication header"));
    }
    let authorization = format!(
        "{} {credential}",
        if token.is_some() { "Bearer" } else { "Basic" }
    );
    let url = speech_url(
        options.base_url.unwrap_or("https://api.inworld.ai"),
        options.web_socket_url,
        live,
        mode,
    )?;
    if live || mode == HttpMode::Stream {
        c.body.insert(
            "timestampTransportStrategy".into(),
            JsonValue::String(if c.chunk { "SYNC" } else { "ASYNC" }.into()),
        );
    }
    if let Some(input) = c.input {
        let id = match options.context_id {
            Some("") => return Err(failure("Inworld context_id must not be empty")),
            Some(id) => id.to_owned(),
            None => {
                let backend = options.web_socket_transport.ok_or_else(|| {
                    failure("Inworld context_id or WebSocket entropy source is required")
                })?;
                let mut bytes = [0; 16];
                backend.random_bytes(&mut bytes)?;
                bytes.iter().map(|v| format!("{v:02x}")).collect()
            }
        };
        let socket = match options.web_socket {
            Some(socket) => socket,
            None => {
                options
                    .web_socket_transport
                    .ok_or_else(|| failure("Inworld WebSocket transport is required"))?
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
            input,
            c.body,
            id,
            c.timed,
            c.chunk,
            c.format == "wav",
            options.max_message_bytes,
            Box::new(validate),
        ));
    }
    let transport = options
        .transport
        .ok_or_else(|| failure("Inworld HTTP transport is required"))?;
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
    if mode == HttpMode::Single || !(200..300).contains(&response.status) {
        let mut data = Vec::new();
        while let Some(chunk) = poll_fn(|cx| response.body.as_mut().poll_next(cx)).await {
            let chunk = chunk?;
            if chunk.len() > options.max_json_bytes - data.len() {
                return Err(failure("Inworld response exceeds max_json_bytes"));
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
        let status = response.status;
        drop(response);
        let mut message =
            String::from_utf8_lossy(data.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&data))
                .into_owned();
        if !(200..300).contains(&status) {
            let mut code = None;
            if let Ok(fields) = Raw::parse_exact(&message).and_then(|v| v.object()) {
                code = fields
                    .get("code")
                    .and_then(|v| v.number().ok())
                    .filter(|v| v.is_finite() && v.fract() == 0.0 && v.abs() <= 9007199254740991.0)
                    .map(|v| v as i64);
                if let Some(value) = fields.get("message").and_then(|v| v.string().ok()) {
                    message = value;
                }
            }
            return Err(Box::new(Error {
                message,
                status: Some(status),
                code,
            }));
        }
        let fields = protocol::decode(&message)?;
        protocol::status(&fields)?;
        if fields
            .get("audioContent")
            .and_then(|v| v.string().ok())
            .is_none()
        {
            return Err(failure("Inworld single response omitted audio"));
        }
        return Ok(Stream::single(protocol::audio(
            &fields, c.timed, true, None, None,
        )?));
    }
    Ok(Stream::http(
        response.body,
        c.timed,
        c.chunk,
        options.max_json_bytes,
    ))
}

fn speech_url(
    base: &str,
    override_url: Option<&str>,
    live: bool,
    mode: HttpMode,
) -> Result<String, TransportError> {
    let target = if live {
        override_url.unwrap_or(base)
    } else {
        base
    };
    let invalid = || failure("Invalid Inworld endpoint URL");
    endpoint::validate(
        target,
        if live {
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
        "http" if live => "ws",
        "https" if live => "wss",
        v => v,
    };
    let (path, query) = tail.split_once('?').unwrap_or((tail, ""));
    let mut url = format!("{scheme}://{path}");
    if !live || override_url.is_none() {
        url.truncate(url.trim_end_matches('/').len());
        url.push_str("/tts/v1/voice");
        if live {
            url.push_str(":streamBidirectional")
        } else if mode == HttpMode::Stream {
            url.push_str(":stream")
        }
    }
    if tail.contains('?') {
        url.push('?');
        url.push_str(query);
    }
    Ok(url)
}
