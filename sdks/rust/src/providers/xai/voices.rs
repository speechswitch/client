use super::{content_type, credential, endpoint, failure, limit};
use crate::{
    generated::{
        auth::Auth,
        xai_output::{Voice, VoiceLanguage},
    },
    http::{HttpRequest, HttpTransport, TransportError},
    json::Raw,
};

pub struct VoiceOptions<'a> {
    pub auth: Option<&'a Auth>,
    pub transport: Option<&'a dyn HttpTransport>,
    pub base_url: Option<&'a str>,
    pub max_response_bytes: usize,
}
impl Default for VoiceOptions<'_> {
    fn default() -> Self {
        Self {
            auth: None,
            transport: None,
            base_url: None,
            max_response_bytes: 4 * 1024 * 1024,
        }
    }
}
async fn fetch(path: &str, options: VoiceOptions<'_>) -> Result<String, TransportError> {
    let key = credential(options.auth)?;
    limit(options.max_response_bytes, "max_response_bytes")?;
    let url = endpoint(options.base_url.unwrap_or("https://api.x.ai"), path, false)?;
    let mut response = options
        .transport
        .ok_or_else(|| failure("xAI HTTP transport is required"))?
        .send(HttpRequest {
            method: "GET".into(),
            url,
            headers: vec![
                ("Authorization".into(), format!("Bearer {key}")),
                ("Accept".into(), "application/json".into()),
            ],
            body: Vec::new(),
        })
        .await?;
    content_type(&response, true)?;
    let mut bytes = Vec::new();
    let mut budget = 0;
    while let Some(chunk) = std::future::poll_fn(|cx| {
        if budget == 128 {
            budget = 0;
            cx.waker().wake_by_ref();
            return std::task::Poll::Pending;
        }
        budget += 1;
        response.body.as_mut().poll_next(cx)
    })
    .await
    {
        let chunk = chunk?;
        if chunk.len() > options.max_response_bytes - bytes.len() {
            return Err(failure("xAI response exceeds max_response_bytes"));
        }
        bytes.extend(chunk);
    }
    let text = String::from_utf8(bytes).map_err(|_| failure("Invalid xAI JSON"))?;
    Ok(text.strip_prefix('\u{feff}').unwrap_or(&text).to_owned())
}
fn parse(raw: Raw<'_>) -> Result<Voice, TransportError> {
    let fields = raw.object().map_err(|_| failure("Invalid xAI voice"))?;
    let name = fields
        .get("name")
        .and_then(|v| v.string().ok())
        .ok_or_else(|| failure("Invalid xAI voice"))?;
    let voice_id = fields
        .get("voice_id")
        .and_then(|v| v.string().ok())
        .ok_or_else(|| failure("Invalid xAI voice"))?;
    let language = fields
        .get("language")
        .map(|v| {
            if v.is_null() {
                Ok(VoiceLanguage::Null(Default::default()))
            } else {
                v.string()
                    .map(VoiceLanguage::String)
                    .map_err(|_| failure("Invalid xAI voice"))
            }
        })
        .transpose()?;
    Ok(Voice {
        name,
        voice_id,
        language,
    })
}
/// Discover built-in voices. Existing custom IDs need no discovery round trip.
pub async fn voices(options: VoiceOptions<'_>) -> Result<Vec<Voice>, TransportError> {
    let text = fetch("/v1/tts/voices", options).await?;
    let raw = Raw::parse_exact(&text).map_err(|_| failure("Invalid xAI JSON"))?;
    let fields = raw
        .object()
        .map_err(|_| failure("Invalid xAI voices response"))?;
    let values = fields
        .get("voices")
        .and_then(|v| v.array().ok())
        .ok_or_else(|| failure("Invalid xAI voices response"))?;
    values.into_iter().map(parse).collect()
}
pub async fn voice(id: &str, options: VoiceOptions<'_>) -> Result<Voice, TransportError> {
    if id.is_empty() {
        return Err(failure("xAI voice ID must not be empty"));
    }
    let mut encoded = String::new();
    for byte in id.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'~') {
            encoded.push(byte as char);
        } else {
            use std::fmt::Write;
            write!(encoded, "%{byte:02X}").expect("String write");
        }
    }
    let text = fetch(&format!("/v1/tts/voices/{encoded}"), options).await?;
    parse(Raw::parse_exact(&text).map_err(|_| failure("Invalid xAI JSON"))?)
}
