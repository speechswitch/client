use std::{error::Error, fmt, pin::Pin, str::FromStr, task::{Context, Poll}};

/// JSON values retain explicit null and nested arrays/objects without a serde dependency.
#[derive(Clone, Debug, PartialEq)]
pub enum JsonValue {
    Null, Bool(bool), Number(f64), String(String),
    Array(Vec<JsonValue>), Object(std::collections::BTreeMap<String, JsonValue>),
}

/// Schema validation errors never include request contents or credentials.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ValidationError(pub &'static str);
impl fmt::Display for ValidationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result { formatter.write_str(self.0) }
}
impl Error for ValidationError {}

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
