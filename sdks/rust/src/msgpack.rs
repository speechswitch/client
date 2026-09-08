//! Bounded MessagePack wire values. Binary is deliberately distinct from JSON.
use crate::http::TransportError;
use std::collections::BTreeMap;

#[derive(Debug, PartialEq)]
pub(crate) enum Value {
    Nil,
    Bool(bool),
    Number(f64),
    String(String),
    Binary(Vec<u8>),
    Array(Vec<Value>),
    Map(BTreeMap<String, Value>),
}

fn failure(message: &str) -> TransportError {
    Box::new(std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        message,
    ))
}

pub(crate) fn encode(value: &Value) -> Result<Vec<u8>, TransportError> {
    fn header(output: &mut Vec<u8>, marker: u8, width: usize, value: u64) {
        output.push(marker);
        output.extend_from_slice(&value.to_be_bytes()[8 - width..]);
    }
    fn length(value: usize) -> Result<u32, TransportError> {
        u32::try_from(value).map_err(|_| failure("MessagePack value exceeds 32-bit length"))
    }
    fn write(value: &Value, output: &mut Vec<u8>, depth: usize) -> Result<(), TransportError> {
        if depth > 64 {
            return Err(failure("MessagePack nesting exceeds 64 levels"));
        }
        match value {
            Value::Nil => output.push(0xc0),
            Value::Bool(v) => output.push(if *v { 0xc3 } else { 0xc2 }),
            Value::Number(v) => {
                if !v.is_finite() {
                    return Err(failure("MessagePack numbers must be finite"));
                }
                if v.fract() == 0.0 && (0.0..=127.0).contains(v) {
                    output.push(*v as u8);
                } else if v.fract() == 0.0 && (-32.0..0.0).contains(v) {
                    output.push(*v as i8 as u8);
                } else if v.fract() == 0.0 && (0.0..=255.0).contains(v) {
                    header(output, 0xcc, 1, *v as u64);
                } else if v.fract() == 0.0 && (0.0..=65535.0).contains(v) {
                    header(output, 0xcd, 2, *v as u64);
                } else if v.fract() == 0.0 && (0.0..=4294967295.0).contains(v) {
                    header(output, 0xce, 4, *v as u64);
                } else if v.fract() == 0.0 && (-2147483648.0..0.0).contains(v) {
                    header(output, 0xd2, 4, *v as i32 as u32 as u64);
                } else {
                    header(output, 0xcb, 8, v.to_bits());
                }
            }
            Value::String(v) => {
                let n = length(v.len())?;
                match n {
                    0..32 => output.push(0xa0 | n as u8),
                    32..=255 => header(output, 0xd9, 1, n.into()),
                    256..=65535 => header(output, 0xda, 2, n.into()),
                    _ => header(output, 0xdb, 4, n.into()),
                }
                output.extend_from_slice(v.as_bytes());
            }
            Value::Binary(v) => {
                let n = length(v.len())?;
                match n {
                    0..=255 => header(output, 0xc4, 1, n.into()),
                    256..=65535 => header(output, 0xc5, 2, n.into()),
                    _ => header(output, 0xc6, 4, n.into()),
                }
                output.extend_from_slice(v);
            }
            Value::Array(v) => {
                let n = length(v.len())?;
                match n {
                    0..16 => output.push(0x90 | n as u8),
                    16..=65535 => header(output, 0xdc, 2, n.into()),
                    _ => header(output, 0xdd, 4, n.into()),
                }
                for child in v {
                    write(child, output, depth + 1)?;
                }
            }
            Value::Map(v) => {
                let n = length(v.len())?;
                match n {
                    0..16 => output.push(0x80 | n as u8),
                    16..=65535 => header(output, 0xde, 2, n.into()),
                    _ => header(output, 0xdf, 4, n.into()),
                }
                for (key, child) in v {
                    write(&Value::String(key.clone()), output, depth + 1)?;
                    write(child, output, depth + 1)?;
                }
            }
        }
        Ok(())
    }
    let mut output = Vec::new();
    write(value, &mut output, 0)?;
    Ok(output)
}

pub(crate) fn decode(data: &[u8]) -> Result<Value, TransportError> {
    let mut reader = Reader { data };
    let value = reader.read(0)?;
    if !reader.data.is_empty() {
        return Err(failure("MessagePack frame contains trailing data"));
    }
    Ok(value)
}
struct Reader<'a> {
    data: &'a [u8],
}
impl<'a> Reader<'a> {
    fn take(&mut self, length: u64) -> Result<&'a [u8], TransportError> {
        if length > self.data.len() as u64 {
            return Err(failure("Truncated MessagePack value"));
        }
        let (value, rest) = self.data.split_at(length as usize);
        self.data = rest;
        Ok(value)
    }
    fn integer(&mut self, width: usize) -> Result<u64, TransportError> {
        let mut bytes = [0; 8];
        bytes[8 - width..].copy_from_slice(self.take(width as u64)?);
        Ok(u64::from_be_bytes(bytes))
    }
    fn string(&mut self, length: u64) -> Result<Value, TransportError> {
        Ok(Value::String(
            std::str::from_utf8(self.take(length)?)
                .map_err(|_| failure("MessagePack string is not valid UTF-8"))?
                .into(),
        ))
    }
    fn array(&mut self, length: u64, depth: usize) -> Result<Value, TransportError> {
        if length > self.data.len() as u64 {
            return Err(failure("Truncated MessagePack value"));
        }
        let mut result = Vec::with_capacity(length as usize);
        for _ in 0..length {
            result.push(self.read(depth + 1)?);
        }
        Ok(Value::Array(result))
    }
    fn map(&mut self, length: u64, depth: usize) -> Result<Value, TransportError> {
        if length > (self.data.len() / 2) as u64 {
            return Err(failure("Truncated MessagePack value"));
        }
        let mut result = BTreeMap::new();
        for _ in 0..length {
            let Value::String(key) = self.read(depth + 1)? else {
                return Err(failure("MessagePack map key is not a string"));
            };
            if result.contains_key(&key) {
                return Err(failure("MessagePack map contains duplicate keys"));
            }
            result.insert(key, self.read(depth + 1)?);
        }
        Ok(Value::Map(result))
    }
    fn read(&mut self, depth: usize) -> Result<Value, TransportError> {
        if depth > 64 {
            return Err(failure("MessagePack nesting exceeds 64 levels"));
        }
        let marker = self.integer(1)? as u8;
        match marker {
            0..=127 => Ok(Value::Number(marker.into())),
            0xe0..=0xff => Ok(Value::Number((marker as i8).into())),
            0xa0..=0xbf => self.string((marker & 31).into()),
            0x90..=0x9f => self.array((marker & 15).into(), depth),
            0x80..=0x8f => self.map((marker & 15).into(), depth),
            0xc0 => Ok(Value::Nil),
            0xc2 | 0xc3 => Ok(Value::Bool(marker == 0xc3)),
            0xc4..=0xc6 | 0xd9..=0xdf => {
                let width = match marker {
                    0xc4 | 0xd9 => 1,
                    0xc5 | 0xda | 0xdc | 0xde => 2,
                    _ => 4,
                };
                let n = self.integer(width)?;
                match marker {
                    0xc4..=0xc6 => Ok(Value::Binary(self.take(n)?.to_vec())),
                    0xd9..=0xdb => self.string(n),
                    0xdc | 0xdd => self.array(n, depth),
                    _ => self.map(n, depth),
                }
            }
            0xca => Ok(Value::Number(
                f32::from_bits(self.integer(4)? as u32).into(),
            )),
            0xcb => Ok(Value::Number(f64::from_bits(self.integer(8)?))),
            0xcc..=0xd3 => {
                let width = 1 << ((marker - 0xcc) % 4);
                let raw = self.integer(width)?;
                let value = if marker >= 0xd0 {
                    let shift = 64 - width * 8;
                    let signed = ((raw << shift) as i64) >> shift;
                    if !(-9007199254740991..=9007199254740991).contains(&signed) {
                        return Err(failure(
                            "MessagePack integer exceeds the safe integer range",
                        ));
                    }
                    signed as f64
                } else {
                    if raw > 9007199254740991 {
                        return Err(failure(
                            "MessagePack integer exceeds the safe integer range",
                        ));
                    }
                    raw as f64
                };
                Ok(Value::Number(value))
            }
            _ => Err(failure(&format!(
                "Unsupported MessagePack marker: 0x{marker:x}"
            ))),
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::json::Raw;

    pub(crate) fn fixture(raw: Raw<'_>) -> Value {
        match raw.text().as_bytes()[0] {
            b'n' => Value::Nil,
            b't' | b'f' => Value::Bool(raw.boolean().unwrap()),
            b'"' => Value::String(raw.string().unwrap()),
            b'[' => Value::Array(raw.array().unwrap().into_iter().map(fixture).collect()),
            b'{' => {
                let fields = raw.object().unwrap();
                if let Some(bytes) = fields.get("$bytes") {
                    Value::Binary(
                        bytes
                            .array()
                            .unwrap()
                            .iter()
                            .map(|v| v.number().unwrap() as u8)
                            .collect(),
                    )
                } else {
                    Value::Map(fields.into_iter().map(|(k, v)| (k, fixture(v))).collect())
                }
            }
            _ => Value::Number(raw.number().unwrap()),
        }
    }
    fn unhex(hex: &str) -> Vec<u8> {
        hex.as_bytes()
            .chunks_exact(2)
            .map(|v| u8::from_str_radix(std::str::from_utf8(v).unwrap(), 16).unwrap())
            .collect()
    }
    #[test]
    fn shared_goldens() {
        let groups = Raw::parse_exact(include_str!("../../fixtures/msgpack.json"))
            .unwrap()
            .object()
            .unwrap();
        for (group, cases) in groups {
            for test in cases.array().unwrap() {
                let test = test.object().unwrap();
                let hex = test["hex"].string().unwrap();
                let wire = unhex(&hex);
                if group == "invalid" {
                    assert_eq!(
                        decode(&wire).unwrap_err().to_string(),
                        test["error"].string().unwrap()
                    );
                    continue;
                }
                let expected = fixture(test["value"]);
                assert_eq!(decode(&wire).unwrap(), expected, "{hex}");
                if group == "valid" {
                    let bytes = encode(&expected).unwrap();
                    if matches!(expected, Value::Map(_)) {
                        assert_eq!(decode(&bytes).unwrap(), expected);
                    } else {
                        assert_eq!(bytes, wire);
                    }
                }
            }
        }
        let value = Value::Map(BTreeMap::from([
            ("event".into(), Value::String("audio".into())),
            ("audio".into(), Value::Binary(vec![0, 255])),
        ]));
        assert_eq!(
            encode(&value).unwrap(),
            unhex("82a5617564696fc40200ffa56576656e74a5617564696f")
        );
    }
    #[test]
    fn boundaries_and_ownership() {
        for value in [
            Value::String("a".repeat(70000)),
            Value::Binary(vec![255; 70000]),
            Value::Array((0..65536).map(|_| Value::Nil).collect()),
            Value::Map(
                (0..65536)
                    .map(|n| (n.to_string(), Value::Bool(true)))
                    .collect(),
            ),
        ] {
            let bytes = encode(&value).unwrap();
            assert_eq!(decode(&bytes).unwrap(), value);
            for end in [0, 1, 2, 3, bytes.len() - 1] {
                assert!(decode(&bytes[..end]).is_err());
            }
        }
        for number in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert_eq!(
                encode(&Value::Number(number)).unwrap_err().to_string(),
                "MessagePack numbers must be finite"
            );
        }
        assert_eq!(
            decode(&[0xa1, 0xff]).unwrap_err().to_string(),
            "MessagePack string is not valid UTF-8"
        );
        let mut bytes = vec![0xc4, 2, 1, 2];
        let value = decode(&bytes).unwrap();
        bytes[2] = 9;
        assert_eq!(value, Value::Binary(vec![1, 2]));
        let mut bytes = vec![0x91; 66];
        bytes.push(0);
        assert_eq!(
            decode(&bytes).unwrap_err().to_string(),
            "MessagePack nesting exceeds 64 levels"
        );
        let mut value = Value::Nil;
        for _ in 0..66 {
            value = Value::Array(vec![value]);
        }
        assert_eq!(
            encode(&value).unwrap_err().to_string(),
            "MessagePack nesting exceeds 64 levels"
        );
    }
}
