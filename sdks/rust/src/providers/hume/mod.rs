//! Hume's handwritten streaming protocols, with TypeScript-generated schemas.
mod protocol;
mod settings;
mod stream;
#[cfg(test)]
mod tests;

pub use crate::generated::{
    hume::{
        TtsRequest, TtsRequestOctave1StreamingTextTextItem as TextInput,
        TtsRequestOctave1StreamingTurnsTurnsItem as DirectedTurnInput,
        TtsRequestOctave2StreamingTurnsTurnsItem as TurnInput,
    },
    hume_output::SynthesisItem,
};
use crate::{
    endpoint,
    generated::{auth::Auth, validators::hume::validate_request},
    http::{HttpRequest, HttpTransport, TransportError},
    json::{self, Raw},
    runtime::JsonValue,
    websocket::{ConnectRequest, Socket, WebSocketTransport},
};
use protocol::failure;
pub use protocol::Error;
use std::{future::poll_fn, task::Poll};
pub use stream::Stream;

pub struct Options<'a> {
    pub auth: Option<&'a Auth>,
    pub transport: Option<&'a dyn HttpTransport>,
    pub web_socket_transport: Option<&'a dyn WebSocketTransport>,
    /// Owned, already-authenticated exclusive socket override; streaming input only.
    pub web_socket: Option<Socket>,
    pub base_url: Option<&'a str>,
    pub web_socket_url: Option<&'a str>,
    pub include_metadata: bool,
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
            include_metadata: false,
            max_json_bytes: 16 * 1024 * 1024,
            max_message_bytes: 4 * 1024 * 1024,
        }
    }
}

/// Always streaming. Drop the future or stream to cancel; executor timeouts can
/// bound the operation. Injected transports and producers must not block in poll
/// or Drop. No HTTP/TLS backend, executor or third-party dependency is imposed.
pub async fn synthesize(
    request: TtsRequest,
    options: Options<'_>,
) -> Result<Stream, TransportError> {
    let validate = validate_request(&request)?;
    if options.max_json_bytes == 0 || options.max_json_bytes > u32::MAX as usize {
        return Err(failure(
            "Hume max_json_bytes must be a positive uint32 value",
        ));
    }
    if options.max_message_bytes == 0 || options.max_message_bytes > u32::MAX as usize {
        return Err(failure(
            "Hume max_message_bytes must be a positive uint32 value",
        ));
    }
    let mut c = settings::settings(request, Box::new(validate))?;
    c.metadata |= options.include_metadata;
    if options.web_socket.is_some() && c.input.is_none() {
        return Err(failure("Hume WebSocket overrides require streaming input"));
    }
    let entry = options.auth.and_then(|v| v.hume.as_ref());
    let token = entry
        .and_then(|v| v.access_token.as_deref())
        .filter(|v| !v.is_empty());
    let mut key = entry.and_then(|v| v.api_key.clone());
    if key.is_none() && token.is_none() {
        for name in ["SPEECHSWITCH_HUME_API_KEY", "HUME_API_KEY"] {
            match std::env::var(name) {
                Ok(value) => {
                    key = Some(value);
                    break;
                }
                Err(std::env::VarError::NotPresent) => {}
                Err(_) => return Err(failure("Invalid Hume environment credential")),
            }
        }
    }
    let key = key.unwrap_or_default();
    let credential = token.unwrap_or(&key);
    if credential.is_empty() && options.web_socket.is_none() {
        return Err(failure("Missing auth.hume.apiKey configuration"));
    }
    if c.input.is_none() && !credential.bytes().all(|b| (32..=126).contains(&b)) {
        return Err(failure("Invalid Hume authentication header"));
    }
    let url = speech_url(
        options.base_url.unwrap_or("https://api.hume.ai"),
        options.web_socket_url,
        &c,
        credential,
        token.is_some(),
    )?;
    if let Some(input) = c.input {
        let socket = match options.web_socket {
            Some(socket) => socket,
            None => {
                options
                    .web_socket_transport
                    .ok_or_else(|| failure("Hume WebSocket transport is required"))?
                    .connect(ConnectRequest {
                        url,
                        headers: vec![],
                        max_message_bytes: options.max_message_bytes,
                    })
                    .await?
            }
        };
        return Ok(Stream::socket(
            socket,
            input,
            c.metadata,
            options.max_message_bytes,
        ));
    }
    let transport = options
        .transport
        .ok_or_else(|| failure("Hume HTTP transport is required"))?;
    let mut body = String::new();
    json::write(&JsonValue::Object(c.body), &mut body)?;
    let mut response = transport
        .send(HttpRequest {
            method: "POST".into(),
            url,
            headers: vec![
                if token.is_some() {
                    ("authorization".into(), format!("Bearer {credential}"))
                } else {
                    ("x-hume-api-key".into(), key)
                },
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
                return Err(failure("Hume response exceeds max_json_bytes"));
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
        let mut message =
            String::from_utf8_lossy(data.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&data))
                .into_owned();
        let mut code = None;
        if let Ok(fields) = Raw::parse_exact(&message).and_then(|v| v.object()) {
            code = fields.get("code").and_then(|v| v.string().ok());
            if let Some(value) = fields
                .get("message")
                .and_then(|v| v.string().ok())
                .or_else(|| fields.get("error").and_then(|v| v.string().ok()))
            {
                message = value;
            }
        }
        return Err(Box::new(Error {
            message,
            status: Some(response.status),
            code,
        }));
    }
    Ok(Stream::http(
        response.body,
        c.metadata,
        options.max_json_bytes,
    ))
}

fn speech_url(
    base: &str,
    override_url: Option<&str>,
    c: &settings::Settings,
    credential: &str,
    token: bool,
) -> Result<String, TransportError> {
    let socket = c.input.is_some();
    let target = if socket {
        override_url.unwrap_or(base)
    } else {
        base
    };
    let invalid = || failure("Invalid Hume endpoint URL");
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
    while let Some(byte) = bytes.next() {
        if byte == b'%'
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
    if !socket || override_url.is_none() {
        url.truncate(url.trim_end_matches('/').len());
        url.push_str(if socket {
            "/v0/tts/stream/input"
        } else if c.metadata {
            "/v0/tts/stream/json"
        } else {
            "/v0/tts/stream/file"
        });
    }
    let mut pairs = Vec::new();
    for pair in query.split('&').filter(|v| !v.is_empty()) {
        let key = pair.split_once('=').map_or(pair, |(key, _)| key);
        let mut bytes = key.bytes();
        let mut decoded = Vec::new();
        while let Some(byte) = bytes.next() {
            decoded.push(match byte {
                b'+' => b' ',
                b'%' => {
                    ((bytes.next().unwrap() as char).to_digit(16).unwrap() * 16
                        + (bytes.next().unwrap() as char).to_digit(16).unwrap())
                        as u8
                }
                v => v,
            });
        }
        let name = std::str::from_utf8(&decoded).map_err(|_| invalid())?;
        if !socket
            || ![
                "api_key",
                "access_token",
                "format_type",
                "version",
                "instant_mode",
                "no_binary",
                "strip_headers",
                "include_timestamp_types",
                "context_generation_id",
                "temperature",
            ]
            .contains(&name)
        {
            pairs.push(pair);
        }
    }
    if !pairs.is_empty() {
        url.push('?');
        url.push_str(&pairs.join("&"));
    }
    if socket {
        for (name, value) in [
            (
                if token { "access_token" } else { "api_key" },
                credential.to_owned(),
            ),
            ("format_type", c.format.into()),
            ("version", c.version.into()),
            ("instant_mode", c.instant.to_string()),
            ("no_binary", c.metadata.to_string()),
            ("strip_headers", "true".into()),
        ] {
            endpoint::set_query(&mut url, name, &value).ok_or_else(invalid)?;
        }
        if let Some(id) = &c.prior_id {
            endpoint::set_query(&mut url, "context_generation_id", id).ok_or_else(invalid)?;
        }
        if let Some(t) = c.temperature {
            endpoint::set_query(&mut url, "temperature", &t.to_string()).ok_or_else(invalid)?;
        }
        for kind in &c.kinds {
            url.push_str("&include_timestamp_types=");
            url.push_str(kind);
        }
    }
    Ok(url)
}
