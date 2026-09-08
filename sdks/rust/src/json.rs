//! Dependency-free wire JSON. Raw slices avoid constructing recursively owned
//! trees from untrusted responses; syntax scanning and request writing are iterative.
use crate::runtime::JsonValue;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Error;
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Invalid wire JSON")
    }
}
impl std::error::Error for Error {}

#[derive(Clone, Copy)]
pub(crate) struct Raw<'a>(&'a str);
impl<'a> Raw<'a> {
    pub fn parse(text: &'a str) -> Result<Self, Error> {
        let text = text.trim_matches([' ', '\t', '\r', '\n']);
        if scan(text, 0)? != text.len() {
            return Err(Error);
        }
        Ok(Self(text))
    }
    pub fn is_null(self) -> bool {
        self.0 == "null"
    }
    pub fn number(self) -> Result<f64, Error> {
        self.0.parse().map_err(|_| Error)
    }
    pub fn boolean(self) -> Result<bool, Error> {
        match self.0 {
            "true" => Ok(true),
            "false" => Ok(false),
            _ => Err(Error),
        }
    }
    pub fn string(self) -> Result<String, Error> {
        if self.0.as_bytes().first() != Some(&b'"') {
            return Err(Error);
        }
        let mut result = String::new();
        let bytes = self.0.as_bytes();
        let mut index = 1;
        while index < bytes.len() - 1 {
            if bytes[index] != b'\\' {
                let start = index;
                while index < bytes.len() - 1 && bytes[index] != b'\\' {
                    index += 1;
                }
                result.push_str(&self.0[start..index]);
                continue;
            }
            index += 1;
            let character = match bytes[index] {
                b'"' => '"',
                b'\\' => '\\',
                b'/' => '/',
                b'b' => '\x08',
                b'f' => '\x0c',
                b'n' => '\n',
                b'r' => '\r',
                b't' => '\t',
                b'u' => {
                    let high = u16::from_str_radix(&self.0[index + 1..index + 5], 16)
                        .map_err(|_| Error)?;
                    index += 4;
                    if (0xd800..=0xdbff).contains(&high)
                        && bytes.get(index + 1..index + 3) == Some(b"\\u")
                    {
                        let low = u16::from_str_radix(&self.0[index + 3..index + 7], 16)
                            .map_err(|_| Error)?;
                        if (0xdc00..=0xdfff).contains(&low) {
                            index += 6;
                            char::from_u32(
                                0x10000 + ((high as u32 - 0xd800) << 10) + low as u32 - 0xdc00,
                            )
                            .ok_or(Error)?
                        } else {
                            '\u{fffd}'
                        }
                    } else {
                        char::from_u32(high as u32).unwrap_or('\u{fffd}')
                    }
                }
                _ => return Err(Error),
            };
            result.push(character);
            index += 1;
        }
        Ok(result)
    }
    pub fn object(self) -> Result<BTreeMap<String, Self>, Error> {
        if !self.0.starts_with('{') {
            return Err(Error);
        }
        let mut fields = BTreeMap::new();
        let mut index = whitespace(self.0.as_bytes(), 1);
        while self.0.as_bytes()[index] != b'}' {
            let end = string_end(self.0.as_bytes(), index)?;
            let key = Self(&self.0[index..end]).string()?;
            index = whitespace(self.0.as_bytes(), end) + 1; // validated colon
            index = whitespace(self.0.as_bytes(), index);
            let end = scan(self.0, index)?;
            fields.insert(key, Self(&self.0[index..end])); // JSON's last-key-wins rule
            index = whitespace(self.0.as_bytes(), end);
            if self.0.as_bytes()[index] == b',' {
                index = whitespace(self.0.as_bytes(), index + 1);
            }
        }
        Ok(fields)
    }
    pub fn array(self) -> Result<Vec<Self>, Error> {
        if !self.0.starts_with('[') {
            return Err(Error);
        }
        let mut items = Vec::new();
        let mut index = whitespace(self.0.as_bytes(), 1);
        while self.0.as_bytes()[index] != b']' {
            let end = scan(self.0, index)?;
            items.push(Self(&self.0[index..end]));
            index = whitespace(self.0.as_bytes(), end);
            if self.0.as_bytes()[index] == b',' {
                index = whitespace(self.0.as_bytes(), index + 1);
            }
        }
        Ok(items)
    }
}

fn whitespace(bytes: &[u8], mut index: usize) -> usize {
    while matches!(bytes.get(index), Some(b' ' | b'\n' | b'\r' | b'\t')) {
        index += 1;
    }
    index
}
fn string_end(bytes: &[u8], mut index: usize) -> Result<usize, Error> {
    if bytes.get(index) != Some(&b'"') {
        return Err(Error);
    }
    index += 1;
    loop {
        match bytes.get(index).ok_or(Error)? {
            b'"' => return Ok(index + 1),
            0..=31 => return Err(Error),
            b'\\' => {
                index += 1;
                match bytes.get(index).ok_or(Error)? {
                    b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't' => {}
                    b'u' => {
                        let hex = bytes.get(index + 1..index + 5).ok_or(Error)?;
                        if !hex.iter().all(u8::is_ascii_hexdigit) {
                            return Err(Error);
                        }
                        index += 4;
                    }
                    _ => return Err(Error),
                }
            }
            _ => {}
        }
        index += 1;
    }
}
fn scan(text: &str, mut index: usize) -> Result<usize, Error> {
    enum Step {
        Value,
        ArrayFirst,
        ArrayRest,
        ObjectFirst,
        ObjectKey,
        ObjectRest,
    }
    let bytes = text.as_bytes();
    let mut pending = vec![Step::Value];
    while let Some(step) = pending.pop() {
        index = whitespace(bytes, index);
        let byte = *bytes.get(index).ok_or(Error)?;
        match step {
            Step::Value => match byte {
                b'{' => {
                    index += 1;
                    pending.push(Step::ObjectFirst);
                }
                b'[' => {
                    index += 1;
                    pending.push(Step::ArrayFirst);
                }
                b'"' => index = string_end(bytes, index)?,
                b't' | b'f' | b'n' => {
                    let literal = match byte {
                        b't' => "true",
                        b'f' => "false",
                        _ => "null",
                    };
                    if !text[index..].starts_with(literal) {
                        return Err(Error);
                    }
                    index += literal.len();
                }
                b'-' | b'0'..=b'9' => {
                    if byte == b'-' {
                        index += 1;
                    }
                    match bytes.get(index) {
                        Some(b'0') => index += 1,
                        Some(b'1'..=b'9') => {
                            while matches!(bytes.get(index), Some(b'0'..=b'9')) {
                                index += 1;
                            }
                        }
                        _ => return Err(Error),
                    }
                    if bytes.get(index) == Some(&b'.') {
                        index += 1;
                        let start = index;
                        while matches!(bytes.get(index), Some(b'0'..=b'9')) {
                            index += 1;
                        }
                        if start == index {
                            return Err(Error);
                        }
                    }
                    if matches!(bytes.get(index), Some(b'e' | b'E')) {
                        index += 1;
                        if matches!(bytes.get(index), Some(b'+' | b'-')) {
                            index += 1;
                        }
                        let start = index;
                        while matches!(bytes.get(index), Some(b'0'..=b'9')) {
                            index += 1;
                        }
                        if start == index {
                            return Err(Error);
                        }
                    }
                }
                _ => return Err(Error),
            },
            Step::ArrayFirst => {
                if byte == b']' {
                    index += 1;
                } else {
                    pending.extend([Step::ArrayRest, Step::Value]);
                }
            }
            Step::ArrayRest => match byte {
                b']' => index += 1,
                b',' => {
                    index += 1;
                    pending.extend([Step::ArrayRest, Step::Value]);
                }
                _ => return Err(Error),
            },
            Step::ObjectFirst => {
                if byte == b'}' {
                    index += 1;
                } else {
                    pending.push(Step::ObjectKey);
                }
            }
            Step::ObjectKey => {
                index = whitespace(bytes, string_end(bytes, index)?);
                if bytes.get(index) != Some(&b':') {
                    return Err(Error);
                }
                index += 1;
                pending.extend([Step::ObjectRest, Step::Value]);
            }
            Step::ObjectRest => match byte {
                b'}' => index += 1,
                b',' => {
                    index += 1;
                    pending.push(Step::ObjectKey);
                }
                _ => return Err(Error),
            },
        }
    }
    Ok(index)
}

pub(crate) fn quote(text: &str, output: &mut String) {
    use std::fmt::Write;
    output.push('"');
    for character in text.chars() {
        match character {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            '\0'..='\x1f' => {
                write!(output, "\\u{:04x}", character as u32).unwrap();
            }
            _ => output.push(character),
        }
    }
    output.push('"');
}

pub(crate) fn write(value: &JsonValue, output: &mut String) -> Result<(), Error> {
    enum Step<'a> {
        Value(&'a JsonValue),
        Token(&'a str),
        String(&'a str),
    }
    let mut pending = vec![Step::Value(value)];
    while let Some(step) = pending.pop() {
        match step {
            Step::Token(token) => output.push_str(token),
            Step::String(text) => quote(text, output),
            Step::Value(value) => match value {
                JsonValue::Null => output.push_str("null"),
                JsonValue::Bool(value) => output.push_str(if *value { "true" } else { "false" }),
                JsonValue::Number(value) => {
                    if !value.is_finite() {
                        return Err(Error);
                    }
                    output.push_str(&value.to_string());
                }
                JsonValue::String(value) => quote(value, output),
                JsonValue::Array(values) => {
                    output.push('[');
                    pending.push(Step::Token("]"));
                    for (index, value) in values.iter().enumerate().rev() {
                        pending.push(Step::Value(value));
                        if index != 0 {
                            pending.push(Step::Token(","));
                        }
                    }
                }
                JsonValue::Object(values) => {
                    output.push('{');
                    pending.push(Step::Token("}"));
                    for (index, (key, value)) in values.iter().enumerate().rev() {
                        pending.extend([Step::Value(value), Step::Token(":"), Step::String(key)]);
                        if index != 0 {
                            pending.push(Step::Token(","));
                        }
                    }
                }
            },
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_json_grammar_and_strings() {
        for text in [
            "",
            "[1,]",
            "{\"a\":1,}",
            "{a:1}",
            "[01]",
            "--1",
            "1.",
            "1e+",
            "true false",
            "\"\\u000z\"",
            "\"raw\nline\"",
            "\"\\x20\"",
            "[",
            "{",
            "null\u{a0}",
        ] {
            assert!(matches!(Raw::parse(text), Err(Error)), "{text:?}");
        }
        for (text, expected) in [
            (r#""hello\n\t\b\f\r\/\\\"""#, "hello\n\t\x08\x0c\r/\\\""),
            (r#""\ud83d\ude80""#, "🚀"),
            (r#""\ud800x\udc00""#, "�x�"),
            (r#""\ud800\u0061""#, "�a"),
            (r#""π界""#, "π界"),
        ] {
            assert_eq!(Raw::parse(text).unwrap().string().unwrap(), expected);
        }
        let fields = Raw::parse(r#" {"a": 1, "\u0061": 2, "nested": [true, null, {}]} "#)
            .unwrap()
            .object()
            .unwrap();
        assert_eq!(fields.len(), 2);
        assert_eq!(fields["a"].number(), Ok(2.0));
        assert_eq!(fields["nested"].array().unwrap().len(), 3);
        assert_eq!(Raw::parse("1e400").unwrap().number(), Ok(f64::INFINITY));
    }
    #[test]
    fn nesting_does_not_recurse_and_writing_preserves_values() {
        let text = format!("{}0{}", "[".repeat(50000), "]".repeat(50000));
        assert!(Raw::parse(&text).is_ok());
        let value = JsonValue::Object(BTreeMap::from([
            (
                "KeepCase".into(),
                JsonValue::Array(vec![
                    JsonValue::Null,
                    JsonValue::Bool(false),
                    JsonValue::Number(0.0),
                    JsonValue::String("\0\n🚀".into()),
                ]),
            ),
            ("empty".into(), JsonValue::Object(BTreeMap::new())),
        ]));
        let mut output = String::new();
        write(&value, &mut output).unwrap();
        assert_eq!(
            output,
            "{\"KeepCase\":[null,false,0,\"\\u0000\\n🚀\"],\"empty\":{}}"
        );
        assert_eq!(
            write(&JsonValue::Number(f64::NAN), &mut String::new()),
            Err(Error)
        );
    }
}
