//! The speech protocols use the standard alphabet and complete, padded groups.
pub(crate) fn encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    for group in bytes.chunks(3) {
        let word = (group[0] as u32) << 16
            | (group.get(1).copied().unwrap_or(0) as u32) << 8
            | group.get(2).copied().unwrap_or(0) as u32;
        result.push(ALPHABET[(word >> 18) as usize] as char);
        result.push(ALPHABET[((word >> 12) & 63) as usize] as char);
        result.push(if group.len() > 1 {
            ALPHABET[((word >> 6) & 63) as usize] as char
        } else {
            '='
        });
        result.push(if group.len() > 2 {
            ALPHABET[(word & 63) as usize] as char
        } else {
            '='
        });
    }
    result
}
pub(crate) fn decode(text: &str) -> Option<Vec<u8>> {
    fn digit(byte: u8) -> Option<u8> {
        match byte {
            b'A'..=b'Z' => Some(byte - b'A'),
            b'a'..=b'z' => Some(byte - b'a' + 26),
            b'0'..=b'9' => Some(byte - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    if text.len() % 4 != 0 {
        return None;
    }
    let mut output = Vec::new();
    for (index, group) in text.as_bytes().chunks(4).enumerate() {
        let a = digit(group[0])?;
        let b = digit(group[1])?;
        output.push(a << 2 | b >> 4);
        if group[2] == b'=' {
            if group[3] != b'=' || (index + 1) * 4 != text.len() {
                return None;
            }
        } else {
            let c = digit(group[2])?;
            output.push(b << 4 | c >> 2);
            if group[3] == b'=' {
                if (index + 1) * 4 != text.len() {
                    return None;
                }
            } else {
                output.push(c << 6 | digit(group[3])?);
            }
        }
    }
    Some(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_vectors_and_rejections() {
        for (bytes, encoded) in [
            (vec![], ""),
            (vec![0], "AA=="),
            (vec![0, 255], "AP8="),
            (vec![0, 255, 128], "AP+A"),
            (b"hello".to_vec(), "aGVsbG8="),
        ] {
            assert_eq!(encode(&bytes), encoded);
            assert_eq!(decode(encoded), Some(bytes));
        }
        // Native TypeScript/Python decoders also accept noncanonical pad bits.
        assert_eq!(decode("Af=="), Some(vec![1]));
        for invalid in [
            "A",
            "AA",
            "AAA",
            "A===",
            "AA=A",
            "AA==AA==",
            "AA==\n",
            "AA==\u{2028}",
            "AA-_",
            "====",
            "éé",
        ] {
            assert_eq!(decode(invalid), None, "{invalid:?}");
        }
        for len in 0..1024 {
            let bytes: Vec<_> = (0..len).map(|i| (i % 256) as u8).collect();
            assert_eq!(decode(&encode(&bytes)), Some(bytes));
        }
    }
}
