//! Azure Speech's authored SSML HTTP and WebSocket v1/v2 protocols.
mod protocol;
mod settings;
mod stream;
#[cfg(test)]
mod tests;
pub use crate::generated::{microsoft::TtsRequest, microsoft_output::SynthesisItem};
use crate::{
    endpoint,
    entropy::Entropy,
    generated::{auth::Auth, validators::microsoft::validate_request},
    http::{HttpRequest, HttpTransport, TransportError},
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
    /// Exclusively owned, already-authenticated socket override.
    pub web_socket: Option<Socket>,
    /// Overrides need OS entropy; native sockets otherwise use their backend.
    pub entropy: Option<&'a dyn Entropy>,
    pub base_url: Option<&'a str>,
    pub web_socket_url: Option<&'a str>,
    pub deployment_id: Option<&'a str>,
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
            deployment_id: None,
            max_json_bytes: 16 * 1024 * 1024,
            max_message_bytes: 4 * 1024 * 1024,
        }
    }
}

/// Always streaming. Drop the future or stream to cancel; an executor timeout
/// can bound the operation. Injected backends own HTTP/TLS and native sockets,
/// and must not block in poll or Drop. No executor/runtime dependency is imposed.
pub async fn synthesize(
    request: TtsRequest,
    options: Options<'_>,
) -> Result<Stream, TransportError> {
    let validate = validate_request(&request)?;
    for (value, name) in [
        (options.max_json_bytes, "max_json_bytes"),
        (options.max_message_bytes, "max_message_bytes"),
    ] {
        if value == 0 || value > u32::MAX as usize {
            return Err(failure(&format!(
                "Microsoft {name} must be a positive uint32 value"
            )));
        }
    }
    let settings = settings::settings(request)?;
    let socket_mode = settings.input.is_some()
        || settings.timed
        || options.web_socket.is_some()
        || options.web_socket_url.is_some();
    if socket_mode && settings.wave {
        return Err(failure("Microsoft WAV output requires the REST transport"));
    }
    let entry = options.auth.and_then(|v| v.microsoft.as_ref());
    let (key, token) =
        if let Some(entry) = entry.filter(|v| v.api_key.is_some() || v.access_token.is_some()) {
            (entry.api_key.clone(), entry.access_token.clone())
        } else {
            (
                environment(&["SPEECHSWITCH_MICROSOFT_API_KEY", "AZURE_SPEECH_KEY"])?,
                environment(&["SPEECHSWITCH_MICROSOFT_ACCESS_TOKEN"])?,
            )
        };
    let region = match entry.and_then(|v| v.region.clone()) {
        Some(value) => Some(value),
        None => environment(&["SPEECHSWITCH_MICROSOFT_REGION", "AZURE_SPEECH_REGION"])?,
    };
    if key.as_deref().unwrap_or("").is_empty()
        && token.as_deref().unwrap_or("").is_empty()
        && options.web_socket.is_none()
    {
        return Err(failure(
            "Missing auth.microsoft.apiKey or auth.microsoft.accessToken configuration",
        ));
    }
    if region.as_deref().unwrap_or("").is_empty()
        && options.base_url.is_none()
        && options.web_socket_url.is_none()
        && options.web_socket.is_none()
    {
        return Err(failure("Missing auth.microsoft.region configuration"));
    }
    if region.as_ref().is_some_and(|v| {
        v.is_empty()
            || !v
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    }) {
        return Err(failure("Invalid Microsoft Speech region"));
    }
    let mut headers = if let Some(token) = token.filter(|v| !v.is_empty()) {
        vec![("Authorization".into(), format!("Bearer {token}"))]
    } else if let Some(key) = key.filter(|v| !v.is_empty()) {
        vec![("Ocp-Apim-Subscription-Key".into(), key)]
    } else {
        vec![]
    };
    if headers
        .iter()
        .any(|(_, value)| !value.bytes().all(|b| (32..=126).contains(&b)))
    {
        return Err(failure("Invalid Microsoft authentication header"));
    }
    let region = region.as_deref().unwrap_or("unused");
    let domain = if region.starts_with("china") {
        "azure.cn"
    } else if region.starts_with("usgov") {
        "azure.us"
    } else {
        "microsoft.com"
    };
    let service = if options.deployment_id.is_some_and(|v| !v.is_empty()) {
        "voice"
    } else {
        "tts"
    };
    let default_url = format!("https://{region}.{service}.speech.{domain}");
    let base = options.base_url.unwrap_or(&default_url);
    let url = speech_url(
        base,
        options.web_socket_url,
        options.deployment_id,
        socket_mode,
        settings.input.is_some(),
    )?;
    if socket_mode {
        let mut bytes = [0u8; 32];
        if let Some(entropy) = options.entropy {
            entropy.fill(&mut bytes)?;
        } else {
            options
                .web_socket_transport
                .ok_or_else(|| {
                    failure("Microsoft socket entropy source or WebSocket transport is required")
                })?
                .random_bytes(&mut bytes)?;
        }
        for offset in [0, 16] {
            bytes[offset + 6] = (bytes[offset + 6] & 15) | 64;
            bytes[offset + 8] = (bytes[offset + 8] & 63) | 128;
        }
        let connection_id: String = bytes[..16].iter().map(|b| format!("{b:02x}")).collect();
        let request_id: String = bytes[16..].iter().map(|b| format!("{b:02x}")).collect();
        headers.push(("X-ConnectionId".into(), connection_id));
        let socket = match options.web_socket {
            Some(socket) => socket,
            None => {
                options
                    .web_socket_transport
                    .ok_or_else(|| failure("Microsoft WebSocket transport is required"))?
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
            settings,
            request_id,
            options.max_message_bytes,
            Box::new(validate),
        )
    } else {
        let transport = options
            .transport
            .ok_or_else(|| failure("Microsoft HTTP transport is required"))?;
        headers.extend([
            ("Content-Type".into(), "application/ssml+xml".into()),
            ("X-Microsoft-OutputFormat".into(), settings.format),
            ("User-Agent".into(), "speechswitch".into()),
        ]);
        let mut response = transport
            .send(HttpRequest {
                method: "POST".into(),
                url,
                headers,
                body: settings.markup.into_bytes(),
            })
            .await?;
        if !(200..300).contains(&response.status) {
            let mut data = Vec::new();
            while let Some(chunk) = poll_fn(|cx| response.body.as_mut().poll_next(cx)).await {
                let chunk = chunk?;
                if chunk.len() > options.max_json_bytes - data.len() {
                    return Err(failure("Microsoft response exceeds max_json_bytes"));
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
            let text =
                String::from_utf8_lossy(data.strip_prefix(&[239, 187, 191]).unwrap_or(&data));
            return Err(Box::new(Error {
                message: format!("Microsoft synthesis failed ({}): {text}", response.status),
                status: Some(response.status),
                retry_after: response
                    .headers
                    .iter()
                    .find(|(key, _)| key.eq_ignore_ascii_case("retry-after"))
                    .map(|(_, v)| v.clone()),
            }));
        }
        if let Some((_, content_type)) = response
            .headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case("content-type"))
        {
            let mime = content_type
                .split(';')
                .next()
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase();
            if !mime.starts_with("audio/") && mime != "application/octet-stream" {
                return Err(failure("Microsoft returned a non-audio response"));
            }
        }
        Ok(Stream::http(response.body))
    }
}
fn environment(names: &[&str]) -> Result<Option<String>, TransportError> {
    for name in names {
        match std::env::var(name) {
            Ok(value) => return Ok(Some(value)),
            Err(std::env::VarError::NotPresent) => {}
            Err(_) => return Err(failure("Invalid Microsoft environment configuration")),
        }
    }
    Ok(None)
}
fn speech_url(
    base: &str,
    override_url: Option<&str>,
    deployment: Option<&str>,
    socket: bool,
    live: bool,
) -> Result<String, TransportError> {
    let explicit = socket && override_url.is_some();
    let target = if socket {
        override_url.unwrap_or(base)
    } else {
        base
    };
    endpoint::validate(
        target,
        if explicit {
            &["ws", "wss"]
        } else {
            &["http", "https"]
        },
    )
    .ok_or_else(|| failure("Invalid Microsoft endpoint URL"))?;
    let mut bytes = target.bytes();
    while let Some(byte) = bytes.next() {
        if byte == b'%'
            && !(bytes.next().is_some_and(|v| v.is_ascii_hexdigit())
                && bytes.next().is_some_and(|v| v.is_ascii_hexdigit()))
        {
            return Err(failure("Invalid Microsoft endpoint URL"));
        }
    }
    let (scheme, tail) = target.split_once("://").unwrap();
    let scheme = if socket && !explicit {
        if scheme.eq_ignore_ascii_case("https") {
            "wss"
        } else {
            "ws"
        }
    } else {
        scheme
    };
    let (base, query) = tail
        .split_once('?')
        .map_or((tail, String::new()), |(base, query)| {
            (base, format!("?{query}"))
        });
    let path = if explicit {
        ""
    } else if !socket {
        "/cognitiveservices/v1"
    } else if live {
        "/cognitiveservices/websocket/v2"
    } else {
        "/tts/cognitiveservices/websocket/v1"
    };
    let mut url = format!("{scheme}://{}{path}{query}", base.trim_end_matches('/'));
    if let Some(id) = deployment {
        endpoint::set_query(&mut url, "deploymentId", id)
            .ok_or_else(|| failure("Invalid Microsoft endpoint URL"))?;
    }
    Ok(url)
}
