//! Gradium's authored REST/NDJSON and WebSocket protocols, with generated types.
mod protocol;
mod settings;
mod stream;
#[cfg(test)]
mod tests;

pub use crate::generated::{
    gradium::{TtsRequest, TtsRequestTextAsyncIterableItem as Input},
    gradium_output::SynthesisItem,
};
use crate::{
    endpoint,
    generated::{auth::Auth, gradium::TtsRequestText, validators::gradium::validate_request},
    http::{HttpRequest, HttpTransport, TransportError},
    json,
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
    /// Owned, already-authenticated exclusive socket override.
    pub web_socket: Option<Socket>,
    pub base_url: Option<&'a str>,
    pub web_socket_url: Option<&'a str>,
    /// Presence selects WebSockets, including an explicit zero retry window.
    pub setup_retry_ms: Option<u64>,
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
            setup_retry_ms: None,
            max_json_bytes: 16 * 1024 * 1024,
            max_message_bytes: 4 * 1024 * 1024,
        }
    }
}

/// Always streaming. Drop the future or stream to cancel; executor timeouts can
/// bound the operation. Supplied transports and inputs must not block in poll or
/// Drop. HTTP/TLS and native WebSocket backends are injected, with no dependencies.
pub async fn synthesize(
    request: TtsRequest,
    options: Options<'_>,
) -> Result<Stream, TransportError> {
    let validate = validate_request(&request)?;
    if options.max_json_bytes == 0 || options.max_json_bytes > u32::MAX as usize {
        return Err(failure(
            "Gradium max_json_bytes must be a positive uint32 value",
        ));
    }
    if options.max_message_bytes == 0 || options.max_message_bytes > u32::MAX as usize {
        return Err(failure(
            "Gradium max_message_bytes must be a positive uint32 value",
        ));
    }
    let retry = options.setup_retry_ms.unwrap_or(0);
    if retry > 9007199254740991 {
        return Err(failure(
            "Gradium setup_retry_ms must be a non-negative safe integer",
        ));
    }
    let entry = options.auth.and_then(|v| v.gradium.as_ref());
    let mut key = entry.and_then(|v| v.api_key.clone());
    if key.is_none() {
        for name in ["SPEECHSWITCH_GRADIUM_API_KEY", "GRADIUM_API_KEY"] {
            match std::env::var(name) {
                Ok(value) => {
                    key = Some(value);
                    break;
                }
                Err(std::env::VarError::NotPresent) => {}
                Err(_) => return Err(failure("Invalid Gradium environment credential")),
            }
        }
    }
    let token = entry.and_then(|v| v.single_use_token.as_deref());
    let socket_mode = matches!(&request.text, TtsRequestText::AsyncIterable(_))
        || request.lexicon.is_some()
        || options.web_socket.is_some()
        || token.is_some()
        || options.setup_retry_ms.is_some();
    let key = key.unwrap_or_default();
    if key.is_empty()
        && !(socket_mode && (options.web_socket.is_some() || token.is_some_and(|v| !v.is_empty())))
    {
        return Err(failure("Missing auth.gradium.apiKey configuration"));
    }
    if !key.bytes().all(|b| (32..=126).contains(&b)) {
        return Err(failure("Invalid Gradium authentication header"));
    }
    let url = speech_url(
        options.base_url.unwrap_or("https://api.gradium.ai/api"),
        options.web_socket_url,
        socket_mode,
        token,
    )?;
    let timed = request.timestamp_granularity.is_some();
    let mut wire = settings::wire(&request);
    if socket_mode {
        wire.insert("type".into(), JsonValue::String("setup".into()));
        wire.insert("close_ws_on_eos".into(), JsonValue::Bool(true));
        wire.insert(
            "retry_for_s".into(),
            JsonValue::Number(retry as f64 / 1000.0),
        );
        if let Some(lexicon) = request.lexicon {
            wire.insert("pronunciation_id".into(), JsonValue::String(lexicon));
        }
        let socket = match options.web_socket {
            Some(socket) => socket,
            None => {
                options
                    .web_socket_transport
                    .ok_or_else(|| failure("Gradium WebSocket transport is required"))?
                    .connect(ConnectRequest {
                        url,
                        headers: if token.is_some_and(|v| !v.is_empty()) {
                            vec![]
                        } else {
                            vec![("x-api-key".into(), key)]
                        },
                        max_message_bytes: options.max_message_bytes,
                    })
                    .await?
            }
        };
        Ok(Stream::socket(
            socket,
            request.text,
            wire,
            timed,
            options.max_message_bytes,
            Box::new(validate),
        ))
    } else {
        let transport = options
            .transport
            .ok_or_else(|| failure("Gradium HTTP transport is required"))?;
        let mut config = String::new();
        json::write(&wire["json_config"], &mut config)?;
        wire.insert("json_config".into(), JsonValue::String(config));
        let TtsRequestText::String(text) = request.text else {
            unreachable!()
        };
        wire.insert("text".into(), JsonValue::String(text));
        wire.insert("only_audio".into(), JsonValue::Bool(!timed));
        let mut body = String::new();
        json::write(&JsonValue::Object(wire), &mut body)?;
        let mut response = transport
            .send(HttpRequest {
                method: "POST".into(),
                url,
                headers: vec![
                    ("x-api-key".into(), key),
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
                    return Err(failure("Gradium response exceeds max_json_bytes"));
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
            if let Some((digits, reason)) = message
                .strip_prefix("error from server ")
                .and_then(|v| v.split_once(": "))
            {
                if !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()) {
                    let digits = digits.trim_start_matches('0');
                    code = if digits.is_empty() {
                        Some(0)
                    } else {
                        digits
                            .parse::<i64>()
                            .ok()
                            .filter(|v| *v <= 9007199254740991)
                    };
                    message = reason.to_owned();
                }
            }
            return Err(Box::new(Error {
                message,
                status: Some(response.status),
                code,
            }));
        }
        Ok(Stream::http(response.body, timed, options.max_json_bytes))
    }
}

fn speech_url(
    base: &str,
    override_url: Option<&str>,
    socket: bool,
    token: Option<&str>,
) -> Result<String, TransportError> {
    let target = if socket {
        override_url.unwrap_or(base)
    } else {
        base
    };
    endpoint::validate(
        target,
        if socket {
            &["http", "https", "ws", "wss"]
        } else {
            &["http", "https"]
        },
    )
    .ok_or_else(|| failure("Invalid Gradium endpoint URL"))?;
    let mut bytes = target.bytes();
    while let Some(byte) = bytes.next() {
        if byte == b'%'
            && !(bytes.next().is_some_and(|b| b.is_ascii_hexdigit())
                && bytes.next().is_some_and(|b| b.is_ascii_hexdigit()))
        {
            return Err(failure("Invalid Gradium endpoint URL"));
        }
    }
    let (scheme, tail) = target.split_once("://").unwrap();
    let scheme = match scheme.to_ascii_lowercase().as_str() {
        "http" if socket => "ws",
        "https" if socket => "wss",
        _ => scheme,
    };
    let mut url = format!("{scheme}://{tail}");
    if !socket || override_url.is_none() {
        let (base, query) = url
            .split_once('?')
            .map_or((url.as_str(), String::new()), |(base, query)| {
                (base, format!("?{query}"))
            });
        let suffix = if socket {
            "/speech/tts"
        } else {
            "/post/speech/tts"
        };
        url = format!("{}{suffix}{query}", base.trim_end_matches('/'));
    }
    if socket {
        if let Some(token) = token.filter(|v| !v.is_empty()) {
            endpoint::set_query(&mut url, "token", token)
                .ok_or_else(|| failure("Invalid Gradium endpoint URL"))?;
        }
    }
    Ok(url)
}
