//! ElevenLabs' authored protocols with canonical generated requests and outputs.
mod live;
mod protocol;
mod settings;
mod stream;
#[cfg(test)]
mod tests;

use crate::{
    endpoint,
    entropy::Entropy,
    generated::{auth::Auth, elevenlabs::TtsRequest, validators::elevenlabs::validate_request},
    http::{HttpRequest, HttpTransport, TransportError},
    json,
    runtime::JsonValue,
    websocket::{ConnectRequest, Socket, WebSocketTransport},
};
use protocol::failure;
pub use protocol::Error;
use settings::Text;
use std::{collections::BTreeMap, future::poll_fn, time::Duration};
pub use stream::Stream;

pub struct Options<'a> {
    pub auth: Option<&'a Auth>,
    pub transport: Option<&'a dyn HttpTransport>,
    pub web_socket_transport: Option<&'a dyn WebSocketTransport>,
    pub web_socket: Option<Socket>,
    /// OS cryptographic entropy override, required for an injected TTS socket.
    pub entropy: Option<&'a dyn Entropy>,
    pub base_url: Option<&'a str>,
    pub web_socket_url: Option<&'a str>,
    pub request_logging: bool,
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
            request_logging: true,
            max_json_bytes: 16 * 1024 * 1024,
            max_message_bytes: 4 * 1024 * 1024,
        }
    }
}
/// Drop the future or stream to cancel. Backends own HTTP/TLS and native framing;
/// the socket worker owns idle heartbeats and never polls input without demand.
pub async fn synthesize(
    request: TtsRequest,
    options: Options<'_>,
) -> Result<Stream, TransportError> {
    let validate = validate_request(&request)?;
    if options.max_json_bytes == 0 || options.max_message_bytes == 0 {
        return Err(failure("ElevenLabs byte limits must be positive"));
    }
    let c = settings::prepare(request);
    let entry = options.auth.and_then(|v| v.elevenlabs.as_ref());
    let mut key = entry.and_then(|v| v.api_key.clone());
    if key.is_none() {
        for name in ["SPEECHSWITCH_ELEVENLABS_API_KEY", "ELEVENLABS_API_KEY"] {
            match std::env::var(name) {
                Ok(value) => {
                    key = Some(value);
                    break;
                }
                Err(std::env::VarError::NotPresent) => {}
                Err(_) => return Err(failure("Invalid ElevenLabs environment credential")),
            }
        }
    }
    let token = entry.and_then(|v| v.single_use_token.as_deref());
    let streaming = !matches!(&c.text, Text::Whole(_));
    if !streaming && key.as_deref().map_or(true, str::is_empty) {
        return Err(failure("Missing auth.elevenlabs.apiKey configuration"));
    }
    if streaming && token.or(key.as_deref()).map_or(true, str::is_empty) {
        return Err(failure(
            "Missing auth.elevenlabs.apiKey or singleUseToken configuration",
        ));
    }
    let format = settings::output_format(&c.output);
    let model = match c.model {
        "flash-v2" => "eleven_flash_v2",
        "flash-v2.5" => "eleven_flash_v2_5",
        "multilingual-v2" => "eleven_multilingual_v2",
        _ => "eleven_v3",
    };
    let url = speech_url(
        &c,
        options.base_url.unwrap_or("https://api.elevenlabs.io"),
        options.web_socket_url,
        &format,
        model,
        token,
        options.request_logging,
    )?;
    let mut voice = BTreeMap::new();
    for (name, value) in [
        ("stability", c.stability),
        ("similarity_boost", c.similarity),
        ("style", c.style),
        ("speed", c.speed),
    ] {
        if let Some(value) = value {
            voice.insert(name.into(), JsonValue::Number(value));
        }
    }
    if let Some(value) = c.boost {
        voice.insert("use_speaker_boost".into(), JsonValue::Bool(value));
    }
    let mut body = BTreeMap::from([("voice_settings".into(), JsonValue::Object(voice))]);
    if let Some(value) = c.dictionaries {
        body.insert("pronunciation_dictionary_locators".into(), value);
    }
    match c.text {
        Text::Whole(text) => {
            let transport = options
                .transport
                .ok_or_else(|| failure("ElevenLabs HTTP transport is required"))?;
            body.insert("text".into(), JsonValue::String(text));
            body.insert("model_id".into(), JsonValue::String(model.into()));
            body.insert(
                "apply_text_normalization".into(),
                JsonValue::String(c.normalization.into()),
            );
            body.insert(
                "apply_language_text_normalization".into(),
                JsonValue::Bool(c.language_normalization),
            );
            if let Some(value) = c.language {
                body.insert("language_code".into(), JsonValue::String(value));
            }
            if let Some(value) = c.seed {
                body.insert("seed".into(), JsonValue::Number(value));
            }
            if let Some(value) = c.before {
                settings::context_fields(value, "previous", &mut body)
            }
            if let Some(value) = c.after {
                settings::context_fields(value, "next", &mut body)
            }
            let mut encoded = String::new();
            json::write(&JsonValue::Object(body), &mut encoded)?;
            let mut response = transport
                .send(HttpRequest {
                    method: "POST".into(),
                    url,
                    headers: vec![
                        ("xi-api-key".into(), key.unwrap()),
                        ("content-type".into(), "application/json".into()),
                    ],
                    body: encoded.into_bytes(),
                })
                .await?;
            if !(200..300).contains(&response.status) {
                let mut data = Vec::new();
                while let Some(chunk) = poll_fn(|cx| response.body.as_mut().poll_next(cx)).await {
                    let chunk = chunk?;
                    if chunk.len() > options.max_json_bytes - data.len() {
                        return Err(failure("ElevenLabs response exceeds max_json_bytes"));
                    }
                    data.extend(chunk);
                    // An always-ready empty backend must not monopolize a poll.
                    let mut yielded = false;
                    poll_fn(|cx| {
                        if yielded {
                            std::task::Poll::Ready(())
                        } else {
                            yielded = true;
                            cx.waker().wake_by_ref();
                            std::task::Poll::Pending
                        }
                    })
                    .await;
                }
                let text = String::from_utf8_lossy(&data);
                let mut error = protocol::response_error(
                    text.trim_start_matches('\u{feff}'),
                    response.status as f64,
                );
                error.request_id = response
                    .headers
                    .iter()
                    .find(|(k, _)| k.eq_ignore_ascii_case("request-id"))
                    .map(|(_, v)| v.clone());
                return Err(Box::new(error));
            }
            Ok(Stream::http(
                response.body,
                c.timed,
                format.starts_with("wav_"),
                c.normalized,
                options.max_json_bytes,
            ))
        }
        text => {
            let dialogue = matches!(&text, Text::Dialogue(_));
            let mut seed = [0; 16];
            if !dialogue {
                if let Some(entropy) = options.entropy {
                    entropy.fill(&mut seed)?
                } else if options.web_socket.is_none() {
                    options
                        .web_socket_transport
                        .ok_or_else(|| failure("ElevenLabs WebSocket transport is required"))?
                        .random_bytes(&mut seed)?
                } else {
                    return Err(failure(
                        "ElevenLabs socket override entropy source is required",
                    ));
                }
                if !c.unbuffered {
                    body.insert(
                        "generation_config".into(),
                        JsonValue::Object(BTreeMap::from([(
                            "chunk_length_schedule".into(),
                            JsonValue::Array(
                                c.schedule
                                    .unwrap_or_else(|| vec![120.0, 160.0, 250.0, 290.0])
                                    .into_iter()
                                    .map(JsonValue::Number)
                                    .collect(),
                            ),
                        )])),
                    );
                }
            }
            let socket = if let Some(socket) = options.web_socket {
                if token.is_none() {
                    body.insert("xi_api_key".into(), JsonValue::String(key.unwrap()));
                }
                socket
            } else {
                let backend = options
                    .web_socket_transport
                    .ok_or_else(|| failure("ElevenLabs WebSocket transport is required"))?;
                backend
                    .connect(ConnectRequest {
                        url,
                        headers: if token.is_none() {
                            vec![("xi-api-key".into(), key.unwrap())]
                        } else {
                            vec![]
                        },
                        max_message_bytes: options.max_message_bytes,
                    })
                    .await?
            };
            let mut encoded = String::new();
            json::write(&JsonValue::Object(body), &mut encoded)?;
            Stream::socket(live::Configuration {
                socket,
                text,
                voice: c.voice,
                settings: encoded,
                dialogue,
                timed: c.timed,
                normalized: c.normalized,
                seed,
                max_message: options.max_message_bytes,
                heartbeat_interval: Duration::from_secs(10),
                validate: Box::new(validate),
            })
        }
    }
}
fn encode(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
            encoded.push(byte as char)
        } else {
            encoded.push_str(&format!("%{byte:02X}"))
        }
    }
    encoded
}
fn speech_url(
    c: &settings::Prepared,
    base: &str,
    override_: Option<&str>,
    format: &str,
    model: &str,
    token: Option<&str>,
    logging: bool,
) -> Result<String, TransportError> {
    let streaming = !matches!(&c.text, Text::Whole(_));
    let target = if streaming {
        override_.unwrap_or(base)
    } else {
        base
    };
    endpoint::validate(
        target,
        if streaming {
            &["http", "https", "ws", "wss"]
        } else {
            &["http", "https"]
        },
    )
    .ok_or_else(|| failure("Invalid ElevenLabs endpoint URL"))?;
    let (target, query) = target.split_once('?').unwrap_or((target, ""));
    let mut pairs = Vec::new();
    for pair in query.split('&').filter(|v| !v.is_empty()) {
        let mut decoded = Vec::new();
        let mut bytes = pair.split('=').next().unwrap().bytes();
        while let Some(byte) = bytes.next() {
            decoded.push(match byte {
                b'+' => b' ',
                b'%' => {
                    let high = bytes.next().and_then(|v| (v as char).to_digit(16));
                    let low = bytes.next().and_then(|v| (v as char).to_digit(16));
                    match (high, low) {
                        (Some(h), Some(l)) => (h * 16 + l) as u8,
                        _ => return Err(failure("Invalid ElevenLabs endpoint query")),
                    }
                }
                v => v,
            });
        }
        if ![
            "output_format",
            "enable_logging",
            "optimize_streaming_latency",
            "model_id",
            "sync_alignment",
            "apply_text_normalization",
            "language_code",
            "seed",
            "single_use_token",
            "authorization",
            "xi-api-key",
            "xi_api_key",
            "api_key",
            "inactivity_timeout",
            "auto_mode",
            "enable_ssml_parsing",
        ]
        .iter()
        .any(|v| v.as_bytes() == decoded)
        {
            pairs.push(pair.to_owned());
        }
    }
    pairs.extend([
        format!("output_format={format}"),
        format!("enable_logging={logging}"),
    ]);
    let mut target = target.to_owned();
    if streaming {
        if override_.is_none() {
            target = format!(
                "{}{}",
                target.trim_end_matches('/'),
                if c.model == "eleven-v3" {
                    "/v1/text-to-dialogue/stream-input".into()
                } else {
                    format!("/v1/text-to-speech/{}/multi-stream-input", encode(&c.voice))
                }
            );
        }
        let (scheme, tail) = target.split_once("://").unwrap();
        target = format!(
            "{}://{tail}",
            if scheme.eq_ignore_ascii_case("https") {
                "wss"
            } else if scheme.eq_ignore_ascii_case("http") {
                "ws"
            } else {
                scheme
            }
        );
        pairs.extend([
            format!("model_id={model}"),
            format!("sync_alignment={}", c.timed),
            format!("apply_text_normalization={}", c.normalization),
        ]);
        if let Some(value) = &c.language {
            pairs.push(format!("language_code={}", encode(value)))
        }
        if let Some(value) = c.seed {
            pairs.push(format!("seed={value}"))
        }
        if let Some(value) = token {
            pairs.push(format!("single_use_token={}", encode(value)))
        }
        if c.model != "eleven-v3" {
            pairs.extend([
                "inactivity_timeout=20".into(),
                format!("auto_mode={}", c.unbuffered),
                format!("enable_ssml_parsing={}", c.ssml),
            ]);
        }
    } else {
        target = format!(
            "{}/v1/text-to-speech/{}{}{}",
            target.trim_end_matches('/'),
            encode(&c.voice),
            if format.starts_with("wav_") {
                ""
            } else {
                "/stream"
            },
            if c.timed { "/with-timestamps" } else { "" }
        );
        if let Some(latency) = c.latency {
            pairs.push(format!(
                "optimize_streaming_latency={}",
                match latency {
                    "none" => 0,
                    "moderate" => 1,
                    "strong" => 2,
                    "aggressive" => 3,
                    _ => 4,
                }
            ));
        }
    }
    Ok(format!("{target}?{}", pairs.join("&")))
}
