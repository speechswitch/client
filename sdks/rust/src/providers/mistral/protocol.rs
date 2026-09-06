use crate::{
    base64,
    generated::{mistral_output::*, transport::SseMessage},
    http::TransportError,
    json::Raw,
};
use std::collections::BTreeMap;

#[derive(Debug)]
pub struct Error {
    pub status_code: u16,
    pub body: String,
    pub retry_after: Option<String>,
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Mistral synthesis failed ({})", self.status_code)
    }
}
impl std::error::Error for Error {}

#[derive(Debug)]
struct ProtocolError(String);
impl std::fmt::Display for ProtocolError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for ProtocolError {}
pub(super) fn failure(message: &str) -> TransportError {
    Box::new(ProtocolError(message.into()))
}
type Object<'a> = BTreeMap<String, Raw<'a>>;
fn object(value: Raw<'_>) -> Result<Object<'_>, TransportError> {
    value
        .object()
        .map_err(|_| failure("Mistral returned an invalid response object"))
}
fn parse(text: &str) -> Result<Object<'_>, TransportError> {
    object(Raw::parse(text).map_err(|_| failure("Mistral returned an invalid response object"))?)
}
fn audio(value: Option<Raw<'_>>) -> Result<Vec<u8>, TransportError> {
    value
        .and_then(|value| value.string().ok())
        .and_then(|text| base64::decode(&text))
        .ok_or_else(|| failure("Mistral returned invalid base64 audio"))
}
fn count(value: Raw<'_>, field: &str) -> Result<f64, TransportError> {
    match value.number() {
        Ok(value)
            if value.is_finite()
                && value >= 0.0
                && value <= 9007199254740991.0
                && value.fract() == 0.0 =>
        {
            Ok(value)
        }
        _ => Err(failure(&format!("Mistral returned invalid {field}"))),
    }
}
fn optional_count(value: &Object<'_>, field: &str) -> Result<Option<f64>, TransportError> {
    value
        .get(field)
        .map(|value| count(*value, field))
        .transpose()
}
fn nullable_count(
    value: &Object<'_>,
    field: &str,
) -> Result<Option<PromptTokensDetailsMessagesItemTotalTokens>, TransportError> {
    value
        .get(field)
        .map(|value| {
            if value.is_null() {
                Ok(PromptTokensDetailsMessagesItemTotalTokens::Null(
                    PromptTokensDetailsMessagesItemTotalTokensNull,
                ))
            } else {
                count(*value, field).map(PromptTokensDetailsMessagesItemTotalTokens::Number)
            }
        })
        .transpose()
}
fn prompt_details(raw: Raw<'_>) -> Result<PromptTokensDetails, TransportError> {
    let value = object(raw)?;
    let messages = value
        .get("messages")
        .map(|raw| -> Result<Vec<_>, TransportError> {
            raw.array()
                .map_err(|_| failure("Mistral returned invalid usage messages"))?
                .into_iter()
                .map(|raw| {
                    let value = object(raw)?;
                    let role = match value
                        .get("role")
                        .and_then(|value| value.string().ok())
                        .as_deref()
                    {
                        Some("system") => PromptTokensDetailsMessagesItemRole::System(
                            PromptTokensDetailsMessagesItemRoleSystem,
                        ),
                        Some("user") => PromptTokensDetailsMessagesItemRole::User(
                            PromptTokensDetailsMessagesItemRoleUser,
                        ),
                        Some("assistant") => PromptTokensDetailsMessagesItemRole::Assistant(
                            PromptTokensDetailsMessagesItemRoleAssistant,
                        ),
                        Some("tool") => PromptTokensDetailsMessagesItemRole::Tool(
                            PromptTokensDetailsMessagesItemRoleTool,
                        ),
                        _ => return Err(failure("Mistral returned invalid usage message role")),
                    };
                    let truncated = value
                        .get("truncated")
                        .map(|value| match value.boolean() {
                            Ok(true) => Ok(PromptTokensDetailsMessagesItemTruncated::True(
                                PromptTokensDetailsMessagesItemTruncatedTrue,
                            )),
                            Ok(false) => Ok(PromptTokensDetailsMessagesItemTruncated::False(
                                PromptTokensDetailsMessagesItemTruncatedFalse,
                            )),
                            Err(_) => Err(failure("Mistral returned invalid usage truncated flag")),
                        })
                        .transpose()?;
                    Ok(PromptTokensDetailsMessagesItem {
                        role,
                        truncated,
                        total_tokens: nullable_count(&value, "total_tokens")?,
                        usage_count: optional_count(&value, "usage_count")?,
                    })
                })
                .collect()
        })
        .transpose()?;
    Ok(PromptTokensDetails {
        messages,
        cached_tokens: optional_count(&value, "cached_tokens")?,
        audio_tokens: optional_count(&value, "audio_tokens")?,
    })
}
fn optional_prompt_details(
    value: &Object<'_>,
    field: &str,
) -> Result<Option<UsagePromptTokenDetails>, TransportError> {
    value
        .get(field)
        .map(|value| {
            if value.is_null() {
                Ok(UsagePromptTokenDetails::Null(
                    PromptTokensDetailsMessagesItemTotalTokensNull,
                ))
            } else {
                prompt_details(*value).map(UsagePromptTokenDetails::Object)
            }
        })
        .transpose()
}
fn usage(raw: Option<Raw<'_>>) -> Result<Usage, TransportError> {
    let value = object(raw.ok_or_else(|| failure("Mistral returned an invalid response object"))?)?;
    let completion_tokens_details = value
        .get("completion_tokens_details")
        .map(|value| -> Result<_, TransportError> {
            if value.is_null() {
                Ok(UsageCompletionTokensDetails::Null(
                    PromptTokensDetailsMessagesItemTotalTokensNull,
                ))
            } else {
                Ok(UsageCompletionTokensDetails::Object(
                    UsageCompletionTokensDetailsObject {
                        reasoning_tokens: optional_count(&object(*value)?, "reasoning_tokens")?,
                    },
                ))
            }
        })
        .transpose()?;
    Ok(Usage {
        prompt_tokens: optional_count(&value, "prompt_tokens")?,
        completion_tokens: nullable_count(&value, "completion_tokens")?,
        total_tokens: optional_count(&value, "total_tokens")?,
        prompt_audio_seconds: nullable_count(&value, "prompt_audio_seconds")?,
        request_count: nullable_count(&value, "request_count")?,
        cached_tokens: nullable_count(&value, "num_cached_tokens")?,
        prompt_tokens_details: optional_prompt_details(&value, "prompt_tokens_details")?,
        prompt_token_details: optional_prompt_details(&value, "prompt_token_details")?,
        completion_tokens_details,
    })
}
pub(super) fn decode_json(text: &str) -> Result<Vec<u8>, TransportError> {
    audio(parse(text)?.get("audio_data").copied())
}
pub(super) fn decode_event(message: SseMessage) -> Result<SynthesisItem, TransportError> {
    let data = parse(&message.data)?;
    let kind = match data.get("type") {
        Some(value) if !value.is_null() => value.string().ok(),
        _ => Some(message.event.clone()),
    };
    if message.event != "message" && kind.as_deref() != Some(&message.event) {
        return Err(failure("Mistral returned conflicting SSE event types"));
    }
    match kind.as_deref() {
        Some("speech.audio.delta") => {
            audio(data.get("audio_data").copied()).map(SynthesisItem::Bytes)
        }
        Some("speech.audio.done") => Ok(SynthesisItem::Done(DoneEvent {
            event: DoneEventEvent,
            usage: Some(usage(data.get("usage").copied())?),
        })),
        _ => Err(failure("Mistral returned an unsupported speech event")),
    }
}
