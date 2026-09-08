use std::{error::Error, fmt, pin::Pin, str::FromStr, task::{Context, Poll}};

/// JSON values retain explicit null and nested arrays/objects without a serde dependency.
#[derive(Clone, Debug, PartialEq)]
pub enum JsonValue {
    Null, Bool(bool), Number(f64), String(String),
    Array(Vec<JsonValue>), Object(std::collections::BTreeMap<String, JsonValue>),
}

/// Schema validation errors describe paths and constraints, not field values.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ValidationError(pub String);
impl fmt::Display for ValidationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result { formatter.write_str(&self.0) }
}
impl Error for ValidationError {}

/// Borrowed request data used only on validation failure. Generated functions
/// retain all schema decisions; this tree contains values, never schema metadata.
#[doc(hidden)]
pub enum DiagnosticValue<'a> {
    Invalid, Null, Bool(bool), Number(f64), String(&'a str), BigInt, Bytes, Input,
    Array(Vec<DiagnosticValue<'a>>), Object(std::collections::BTreeMap<&'a str, DiagnosticValue<'a>>),
}
impl<'a> DiagnosticValue<'a> {
    pub fn from_json(value: &'a JsonValue) -> Self {
        enum Frame<'a> { Visit(&'a JsonValue), Array(usize), Object(Vec<&'a str>) }
        let mut pending = vec![Frame::Visit(value)];
        let mut values = Vec::new();
        while let Some(frame) = pending.pop() {
            match frame {
                Frame::Visit(value) => match value {
                    JsonValue::Null => values.push(Self::Null),
                    JsonValue::Bool(value) => values.push(Self::Bool(*value)),
                    JsonValue::Number(value) => values.push(Self::Number(*value)),
                    JsonValue::String(value) => values.push(Self::String(value)),
                    JsonValue::Array(value) => {
                        pending.push(Frame::Array(value.len()));
                        pending.extend(value.iter().rev().map(Frame::Visit));
                    },
                    JsonValue::Object(value) => {
                        pending.push(Frame::Object(value.keys().map(String::as_str).collect()));
                        pending.extend(value.values().rev().map(Frame::Visit));
                    },
                },
                Frame::Array(length) => {
                    let children = values.split_off(values.len() - length);
                    values.push(Self::Array(children));
                },
                Frame::Object(keys) => {
                    let children = values.split_off(values.len() - keys.len());
                    values.push(Self::Object(keys.into_iter().zip(children).collect()));
                },
            }
        }
        values.pop().unwrap()
    }
    pub fn from_any(value: &'a dyn std::any::Any) -> Self {
        if let Some(value) = value.downcast_ref::<String>() { Self::String(value) }
        else if let Some(value) = value.downcast_ref::<bool>() { Self::Bool(*value) }
        else if let Some(value) = value.downcast_ref::<f64>() { Self::Number(*value) }
        else if let Some(value) = value.downcast_ref::<JsonValue>() { Self::from_json(value) }
        else if value.is::<BigInt>() { Self::BigInt }
        else if value.is::<Vec<u8>>() { Self::Bytes }
        else { Self::Invalid }
    }
    pub fn is_json(&self) -> bool {
        let mut pending = vec![self];
        while let Some(value) = pending.pop() {
            match value {
                Self::Null | Self::Bool(_) | Self::String(_) => {},
                Self::Number(value) if value.is_finite() => {},
                Self::Array(values) => pending.extend(values),
                Self::Object(values) => pending.extend(values.values()),
                _ => return false,
            }
        }
        true
    }
}

/// JSON string escaping for canonical diagnostic paths, without a JSON dependency.
#[doc(hidden)]
pub fn diagnostic_key(key: &str) -> String {
    use std::fmt::Write;
    let mut result = String::from("\"");
    for character in key.chars() {
        match character {
            '"' => result.push_str("\\\""),
            '\\' => result.push_str("\\\\"),
            '\n' => result.push_str("\\n"),
            '\r' => result.push_str("\\r"),
            '\t' => result.push_str("\\t"),
            '\u{8}' => result.push_str("\\b"),
            '\u{c}' => result.push_str("\\f"),
            character if character < ' ' => { write!(&mut result, "\\u{:04x}", character as u32).unwrap(); },
            character => result.push(character),
        }
    }
    result.push('"');
    result
}

/// The owned JSON tree cannot contain cycles; only numbers need runtime checks.
/// Traverse explicitly so validation does not recurse with the input depth.
pub fn is_json_value(value: &JsonValue) -> bool {
    let mut pending = vec![value];
    while let Some(value) = pending.pop() {
        match value {
            JsonValue::Number(value) if !value.is_finite() => return false,
            JsonValue::Array(values) => pending.extend(values),
            JsonValue::Object(values) => pending.extend(values.values()),
            _ => {},
        }
    }
    true
}

/// A pull-based, fallible input stream. Dropping it releases the producer.
/// Implementations must not block in poll_next and must register the waker when pending.
pub trait InputStream<T>: Send {
    fn poll_next(self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<Option<Result<T, Box<dyn Error + Send + Sync>>>>;
}
pub type StreamingInput<T> = Pin<Box<dyn InputStream<T>>>;

/// Lossless arbitrary-precision integer storage without a fixed-width narrowing.
/// Arithmetic is deliberately not part of the schema runtime.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BigInt(String);

impl FromStr for BigInt {
    type Err = InvalidBigInt;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let digits = value.strip_prefix('-').unwrap_or(value);
        if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(InvalidBigInt);
        }
        let digits = digits.trim_start_matches('0');
        Ok(Self(if digits.is_empty() { "0".to_string() } else if value.starts_with('-') { format!("-{digits}") } else { digits.to_string() }))
    }
}
impl fmt::Display for BigInt {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result { formatter.write_str(&self.0) }
}
#[derive(Debug, PartialEq, Eq)]
pub struct InvalidBigInt;
impl fmt::Display for InvalidBigInt {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result { formatter.write_str("Expected a signed decimal integer") }
}
impl Error for InvalidBigInt {}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bigint_preserves_unbounded_values_and_normalizes_zero() {
        let text = "12345678901234567890123456789012345678901234567890";
        assert_eq!(text.parse::<BigInt>().unwrap().to_string(), text);
        assert_eq!("-000".parse::<BigInt>().unwrap().to_string(), "0");
        assert_eq!("-000123".parse::<BigInt>().unwrap().to_string(), "-123");
        for text in ["", "-", "+1", "1.0", " 1", "١"] { assert_eq!(text.parse::<BigInt>(), Err(InvalidBigInt)); }
    }
}
