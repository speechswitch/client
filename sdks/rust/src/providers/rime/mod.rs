//! Handwritten Rime protocol with TypeScript-generated public contracts.
mod settings;
mod stream;
#[cfg(test)]
mod tests;
pub use crate::generated::{rime::TtsRequest, rime_output::SynthesisItem};
use crate::{
    endpoint,
    entropy::Entropy,
    generated::{auth::Auth, validators::rime::validate_request},
    http::{HttpRequest, HttpTransport, TransportError},
    json,
    websocket::{ConnectRequest, Socket, WebSocketTransport},
};
use stream::Source;
pub use stream::Stream;

pub struct Options<'a> {
    pub auth: Option<&'a Auth>,
    pub transport: Option<&'a dyn HttpTransport>,
    pub web_socket_transport: Option<&'a dyn WebSocketTransport>,
    /// Exclusive, already-authenticated/query-configured override; dropped on every exit.
    pub web_socket: Option<Socket>,
    /// Required with a socket override; native backends otherwise provide OS entropy.
    pub entropy: Option<&'a dyn Entropy>,
    pub base_url: Option<&'a str>,
    pub web_socket_url: Option<&'a str>,
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
            max_message_bytes: 4 * 1024 * 1024,
        }
    }
}
#[derive(Debug, PartialEq, Eq)]
pub struct Error {
    pub message: String,
    /// Present for HTTP failures; native WebSocket errors have no HTTP status.
    pub status: Option<u16>,
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

/// Owns the request and socket override immediately. Drop the future or stream to
/// cancel; the host executor applies deadlines. The returned stream owns its
/// transport resources and does not borrow the request, backend or authentication.
pub async fn synthesize(
    request: TtsRequest,
    options: Options<'_>,
) -> Result<Stream, TransportError> {
    let validate = validate_request(&request)?;
    if options.max_message_bytes == 0 {
        return Err(failure("Rime max_message_bytes must be positive"));
    }
    let mut key = options
        .auth
        .and_then(|a| a.rime.as_ref())
        .and_then(|a| a.api_key.clone());
    if key.is_none() {
        for name in ["SPEECHSWITCH_RIME_API_KEY", "RIME_API_KEY"] {
            match std::env::var(name) {
                Ok(value) => {
                    key = Some(value);
                    break;
                }
                Err(std::env::VarError::NotPresent) => {}
                Err(_) => return Err(failure("Invalid Rime environment credential")),
            }
        }
    }
    let key = key
        .filter(|v| !v.is_empty())
        .ok_or_else(|| failure("Missing auth.rime.apiKey configuration"))?;
    if !key.bytes().all(|b| (32..=126).contains(&b)) {
        return Err(failure(
            "Rime API key must be a printable ASCII header value",
        ));
    }
    let prepared = settings::prepare(&request)?;
    let text = match request {
        TtsRequest::CodaStreamingTextVoice84ec2db1(v) => Source::Streaming(v.text),
        TtsRequest::CodaTextVoice50d85478(v) => Source::Whole(Some(v.text)),
        TtsRequest::CodaStreamingTextVoice33f4bd25(v) => Source::Streaming(v.text),
        TtsRequest::CodaTextVoicef75e9756(v) => Source::Whole(Some(v.text)),
        TtsRequest::MistV2StreamingTextVoice03cc8904(v) => Source::Streaming(v.text),
        TtsRequest::MistV2TextVoice20785ce4(v) => Source::Whole(Some(v.text)),
        TtsRequest::MistV2StreamingTextVoicec0dcaaf1(v) => Source::Streaming(v.text),
        TtsRequest::MistV2TextVoiceae274411(v) => Source::Whole(Some(v.text)),
        TtsRequest::MistV3StreamingTextVoice88a01d24(v) => Source::Streaming(v.text),
        TtsRequest::MistV3TextVoice2a5bc5c5(v) => Source::Whole(Some(v.text)),
        TtsRequest::MistV3StreamingTextVoice49f68e83(v) => Source::Streaming(v.text),
        TtsRequest::MistV3TextVoice7d020de1(v) => Source::Whole(Some(v.text)),
        TtsRequest::MistV3StreamingTextVoice3acf8862(v) => Source::Streaming(v.text),
        TtsRequest::MistV3TextVoice3fb6eaa2(v) => Source::Whole(Some(v.text)),
    };
    let socket_mode = matches!(text, Source::Streaming(_))
        || prepared.timed
        || prepared.explicit_segmentation
        || options.web_socket.is_some()
        || options.web_socket_url.is_some();
    let base = options.base_url.unwrap_or("https://users.rime.ai");
    endpoint::validate(base, &["http", "https"])
        .ok_or_else(|| failure("Invalid Rime endpoint URL"))?;
    if socket_mode {
        let mut bytes = [0; 16];
        if let Some(entropy) = options.entropy {
            entropy.fill(&mut bytes)?;
        } else if options.web_socket.is_none() {
            options
                .web_socket_transport
                .ok_or_else(|| failure("Rime WebSocket transport is required"))?
                .random_bytes(&mut bytes)?;
        } else {
            return Err(failure("Rime socket override entropy source is required"));
        }
        let mut prefix: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        prefix.push(':');
        let mut url = options
            .web_socket_url
            .unwrap_or("wss://users-ws.rime.ai/ws3")
            .to_owned();
        endpoint::validate(&url, &["ws", "wss"])
            .ok_or_else(|| failure("Invalid Rime endpoint URL"))?;
        for (key, value) in prepared.query {
            endpoint::set_query(&mut url, key, &value)
                .ok_or_else(|| failure("Invalid Rime endpoint query"))?;
        }
        let socket = match options.web_socket {
            Some(socket) => socket,
            None => {
                options
                    .web_socket_transport
                    .ok_or_else(|| failure("Rime WebSocket transport is required"))?
                    .connect(ConnectRequest {
                        url,
                        headers: vec![("Authorization".into(), format!("Bearer {key}"))],
                        max_message_bytes: options.max_message_bytes,
                    })
                    .await?
            }
        };
        Ok(Stream::socket(
            socket,
            text,
            prefix,
            prepared.timed,
            options.max_message_bytes,
            Box::new(validate),
        ))
    } else {
        let Source::Whole(Some(text)) = text else {
            unreachable!("whole text selects HTTP")
        };
        let transport = options
            .transport
            .ok_or_else(|| failure("Rime HTTP transport is required"))?;
        let url = endpoint::append(base, "/v1/rime-tts")
            .ok_or_else(|| failure("Invalid Rime endpoint URL"))?;
        let mut body = prepared.wire;
        body.pop();
        body.push_str(",\"text\":");
        json::quote(&text, &mut body);
        body.push('}');
        let accept = match prepared.format {
            "pcm" => "audio/L16",
            "wav" => "audio/wav",
            "mp3" => "audio/mpeg",
            "mulaw" => "audio/PCMU",
            "ogg_opus" => "audio/ogg;codecs=opus",
            "webm_opus" => "audio/webm;codecs=opus",
            _ => unreachable!("validated format"),
        };
        let response = transport
            .send(HttpRequest {
                method: "POST".into(),
                url,
                headers: vec![
                    ("Authorization".into(), format!("Bearer {key}")),
                    ("Content-Type".into(), "application/json".into()),
                    ("Accept".into(), accept.into()),
                ],
                body: body.into_bytes(),
            })
            .await?;
        if !(200..300).contains(&response.status) {
            return Err(Box::new(Error {
                status: Some(response.status),
                message: format!("Rime returned HTTP {}", response.status),
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
                && !media.starts_with("audio/")
                && media != "application/octet-stream"
            {
                return Err(failure("Rime returned an unexpected content type"));
            }
        }
        Ok(Stream::http(response.body))
    }
}
