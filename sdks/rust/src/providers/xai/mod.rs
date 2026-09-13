//! Handwritten xAI protocol with TypeScript-generated requests and outputs.
mod protocol;
mod settings;
mod stream;
#[cfg(test)]
mod tests;
mod voices;
pub use crate::generated::{
    xai::{TtsRequest, TtsRequestStreamingTextTextItem as Input},
    xai_output::SynthesisItem,
};
use crate::{
    generated::{auth::Auth, validators::xai::validate_request},
    http::{HttpRequest, HttpResponse, HttpTransport, TransportError},
    json,
    runtime::JsonValue,
    websocket::{ConnectRequest, Socket, WebSocketTransport},
};
pub use stream::Stream;
pub use voices::{voice, voices, VoiceOptions};

pub struct Options<'a> {
    pub auth: Option<&'a Auth>,
    pub transport: Option<&'a dyn HttpTransport>,
    pub web_socket_transport: Option<&'a dyn WebSocketTransport>,
    /// Exclusive, already-authenticated override; ownership transfers even on failure.
    pub web_socket: Option<Socket>,
    pub base_url: Option<&'a str>,
    /// Full endpoint override for incremental input, preserving its path and query.
    pub web_socket_url: Option<&'a str>,
    pub max_message_bytes: usize,
    /// Bounds timestamp JSON, not streaming raw audio.
    pub max_response_bytes: usize,
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
            max_message_bytes: 4 * 1024 * 1024,
            max_response_bytes: 16 * 1024 * 1024,
        }
    }
}
#[derive(Debug, PartialEq, Eq)]
pub struct Error {
    pub status: Option<u16>,
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self.status {
            Some(status) => write!(f, "xAI returned HTTP {status}"),
            None => f.write_str("xAI reported a synthesis error"),
        }
    }
}
impl std::error::Error for Error {}
fn failure(message: &str) -> TransportError {
    std::io::Error::new(std::io::ErrorKind::InvalidData, message).into()
}
fn credential(auth: Option<&Auth>) -> Result<String, TransportError> {
    let mut key = auth
        .and_then(|a| a.xai.as_ref())
        .and_then(|a| a.api_key.clone());
    if key.is_none() {
        for name in ["SPEECHSWITCH_XAI_API_KEY", "XAI_API_KEY"] {
            match std::env::var(name) {
                Ok(value) => {
                    key = Some(value);
                    break;
                }
                Err(std::env::VarError::NotPresent) => {}
                Err(_) => return Err(failure("Invalid xAI environment credential")),
            }
        }
    }
    let key = key
        .filter(|v| !v.is_empty())
        .ok_or_else(|| failure("Missing auth.xai.apiKey configuration"))?;
    if !key.bytes().all(|b| (33..=126).contains(&b)) {
        return Err(failure(
            "xAI API key must contain only visible ASCII characters",
        ));
    }
    Ok(key)
}
fn limit(value: usize, name: &str) -> Result<(), TransportError> {
    if value == 0 || value as u64 > 9007199254740991 {
        return Err(failure(&format!(
            "xAI {name} must be a positive safe integer"
        )));
    }
    Ok(())
}
fn endpoint(base: &str, path: &str, socket: bool) -> Result<String, TransportError> {
    crate::endpoint::validate(base, &["http", "https", "ws", "wss"])
        .ok_or_else(|| failure("Invalid xAI endpoint"))?;
    let bytes = base.as_bytes();
    for (i, byte) in bytes.iter().enumerate() {
        if *byte == b'%'
            && !bytes
                .get(i + 1..i + 3)
                .is_some_and(|v| v.iter().all(u8::is_ascii_hexdigit))
        {
            return Err(failure("Invalid xAI endpoint"));
        }
    }
    let (scheme, tail) = base.split_once("://").expect("validated scheme");
    let secure = scheme.eq_ignore_ascii_case("https") || scheme.eq_ignore_ascii_case("wss");
    let scheme = match (socket, secure) {
        (true, true) => "wss",
        (true, false) => "ws",
        (false, true) => "https",
        (false, false) => "http",
    };
    let (base, query) = tail
        .split_once('?')
        .map_or((tail, String::new()), |(b, q)| (b, format!("?{q}")));
    Ok(if path.is_empty() {
        format!("{scheme}://{base}{query}")
    } else {
        format!("{scheme}://{}{path}{query}", base.trim_end_matches('/'))
    })
}
fn content_type(response: &HttpResponse, timed: bool) -> Result<(), TransportError> {
    if !(200..300).contains(&response.status) {
        return Err(Box::new(Error {
            status: Some(response.status),
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
            && if timed {
                media != "application/json"
            } else {
                !media.starts_with("audio/") && media != "application/octet-stream"
            }
        {
            return Err(failure(if timed {
                "xAI returned an unexpected JSON content type"
            } else {
                "xAI returned an unexpected audio content type"
            }));
        }
    }
    Ok(())
}

/// Drop the acquisition future or returned stream to cancel. Deadlines belong to
/// the host executor. Injected backends must reject redirects, retries and ambient
/// credentials, and release I/O without blocking on drop.
pub async fn synthesize(
    request: TtsRequest,
    options: Options<'_>,
) -> Result<Stream, TransportError> {
    let validate = validate_request(&request)?;
    let settings::Settings {
        text,
        mut wire,
        initial,
        timed,
    } = settings::resolve(request)?;
    let key = credential(options.auth)?;
    limit(options.max_message_bytes, "max_message_bytes")?;
    limit(options.max_response_bytes, "max_response_bytes")?;
    let mut headers = vec![("Authorization".into(), format!("Bearer {key}"))];
    match text {
        settings::Text::Whole(text) => {
            if options.web_socket.is_some() || options.web_socket_url.is_some() {
                return Err(failure("xAI socket overrides require streaming input"));
            }
            let url = endpoint(
                options.base_url.unwrap_or("https://api.x.ai"),
                "/v1/tts",
                false,
            )?;
            wire.insert("text".into(), JsonValue::String(text));
            if let Some(map) = initial {
                wire.insert("replace".into(), JsonValue::Object(map));
            }
            let mut body = String::new();
            json::write(&JsonValue::Object(wire), &mut body)?;
            headers.push(("Content-Type".into(), "application/json".into()));
            headers.push((
                "Accept".into(),
                if timed {
                    "application/json"
                } else {
                    "audio/*, application/octet-stream"
                }
                .into(),
            ));
            let response = options
                .transport
                .ok_or_else(|| failure("xAI HTTP transport is required"))?
                .send(HttpRequest {
                    method: "POST".into(),
                    url,
                    headers,
                    body: body.into_bytes(),
                })
                .await?;
            content_type(&response, timed)?;
            Ok(Stream::http(
                response.body,
                timed,
                options.max_response_bytes,
            ))
        }
        settings::Text::Live(source) => {
            let mut url = match options.web_socket_url {
                Some(url) => endpoint(url, "", true)?,
                None => endpoint(
                    options.base_url.unwrap_or("https://api.x.ai"),
                    "/v1/tts",
                    true,
                )?,
            };
            for key in [
                "voice",
                "language",
                "codec",
                "sample_rate",
                "bit_rate",
                "speed",
                "optimize_streaming_latency",
                "text_normalization",
                "with_timestamps",
            ] {
                crate::endpoint::remove_query(&mut url, key)
                    .ok_or_else(|| failure("Invalid xAI endpoint query"))?;
            }
            if let Some(JsonValue::Object(output)) = wire.remove("output_format") {
                wire.extend(output);
            }
            if let Some(voice) = wire.remove("voice_id") {
                wire.insert("voice".into(), voice);
            }
            for (key, value) in wire {
                let value = match value {
                    JsonValue::String(v) => v,
                    JsonValue::Number(v) => v.to_string(),
                    JsonValue::Bool(v) => v.to_string(),
                    _ => unreachable!("resolved scalar query"),
                };
                crate::endpoint::set_query(&mut url, &key, &value)
                    .ok_or_else(|| failure("Invalid xAI endpoint query"))?;
            }
            let socket = match options.web_socket {
                Some(socket) => socket,
                None => {
                    options
                        .web_socket_transport
                        .ok_or_else(|| failure("xAI WebSocket transport is required"))?
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
                source,
                initial,
                timed,
                options.max_message_bytes,
                Box::new(validate),
            ))
        }
    }
}
