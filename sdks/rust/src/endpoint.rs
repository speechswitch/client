//! URL boundaries shared by generated wire clients and provider adapters.

pub(crate) fn validate<'a>(url: &'a str, schemes: &[&str]) -> Option<&'a str> {
    let (scheme, tail) = url.split_once("://")?;
    if !schemes
        .iter()
        .any(|candidate| scheme.eq_ignore_ascii_case(candidate))
        || url
            .chars()
            .any(|ch| ch.is_control() || ch.is_whitespace() || matches!(ch, '\\' | '#'))
    {
        return None;
    }
    let authority = tail.split(['/', '?']).next()?;
    if authority.is_empty() || authority.contains('@') {
        return None;
    }
    let port = if authority.starts_with('[') {
        let (address, tail) = authority[1..].split_once(']')?;
        address.parse::<std::net::Ipv6Addr>().ok()?;
        if tail.is_empty() {
            None
        } else {
            Some(tail.strip_prefix(':')?)
        }
    } else {
        let (host, port) = authority
            .split_once(':')
            .map_or((authority, None), |(host, port)| (host, Some(port)));
        if host.is_empty() || host.contains(['[', ']']) {
            return None;
        }
        port
    };
    if let Some(port) = port {
        if port.is_empty() || !port.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        port.parse::<u16>().ok()?;
    }
    Some(url)
}

pub(crate) fn append(base: &str, path: &str) -> Option<String> {
    validate(base, &["http", "https"])?;
    let (base, query) = base
        .split_once('?')
        .map_or((base, String::new()), |(base, query)| {
            (base, format!("?{query}"))
        });
    Some(format!("{}{path}{query}", base.trim_end_matches('/')))
}

/// Replace every occurrence of a query key without changing escaped proxy paths
/// or unrelated query pairs. Operates on a URL already validated at the boundary.
pub(crate) fn set_query(url: &mut String, key: &str, value: &str) -> Option<()> {
    fn encode(value: &str) -> String {
        let mut output = String::new();
        const HEX: &[u8; 16] = b"0123456789ABCDEF";
        for byte in value.bytes() {
            match byte {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'*' | b'-' | b'.' | b'_' => {
                    output.push(byte as char)
                }
                b' ' => output.push('+'),
                _ => {
                    output.push('%');
                    output.push(HEX[(byte >> 4) as usize] as char);
                    output.push(HEX[(byte & 15) as usize] as char);
                }
            }
        }
        output
    }
    let (base, query) = url.split_once('?').unwrap_or((url.as_str(), ""));
    let mut pairs = Vec::new();
    for pair in query.split('&').filter(|pair| !pair.is_empty()) {
        let encoded = pair.split_once('=').map_or(pair, |(key, _)| key);
        let mut bytes = encoded.bytes();
        let mut decoded = Vec::new();
        while let Some(byte) = bytes.next() {
            decoded.push(match byte {
                b'+' => b' ',
                b'%' => {
                    let high = (bytes.next()? as char).to_digit(16)?;
                    let low = (bytes.next()? as char).to_digit(16)?;
                    (high * 16 + low) as u8
                }
                _ => byte,
            });
        }
        if std::str::from_utf8(&decoded).ok()? != key {
            pairs.push(pair.to_owned());
        }
    }
    pairs.push(format!("{}={}", encode(key), encode(value)));
    *url = format!("{base}?{}", pairs.join("&"));
    Some(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_authorities_without_losing_path_or_query() {
        assert_eq!(
            append("https://proxy.test/a%20b/?trace=1", "/tts"),
            Some("https://proxy.test/a%20b/tts?trace=1".into())
        );
        assert_eq!(
            append("HTTPS://[::1]:8080/", "/tts"),
            Some("HTTPS://[::1]:8080/tts".into())
        );
        for value in [
            "http:///empty",
            "https://:80",
            "https://user:secret@host",
            "https://host/#fragment",
            "https://host/ a",
            "https://host\\path",
            "https://host:bad",
            "https://[no-ip]",
            "https://host:65536",
        ] {
            assert_eq!(append(value, "/tts"), None, "{value}");
        }
    }
    #[test]
    fn replaces_query_keys_with_form_encoding_and_preserves_other_pairs() {
        let mut url =
            "https://proxy.test/a%2Fb/?tenant=a%20b&%6cocale=old&locale=again&blank".to_owned();
        assert_eq!(set_query(&mut url, "locale", "日本 +/?~😀"), Some(()));
        assert_eq!(url, "https://proxy.test/a%2Fb/?tenant=a%20b&blank&locale=%E6%97%A5%E6%9C%AC+%2B%2F%3F%7E%F0%9F%98%80");
        assert_eq!(set_query(&mut url, "empty", ""), Some(()));
        assert_eq!(url, "https://proxy.test/a%2Fb/?tenant=a%20b&blank&locale=%E6%97%A5%E6%9C%AC+%2B%2F%3F%7E%F0%9F%98%80&empty=");
        for suffix in ["%", "%GG=x", "%FF=x"] {
            let original = format!("https://proxy.test/?{suffix}");
            let mut url = original.clone();
            assert_eq!(set_query(&mut url, "x", "y"), None);
            assert_eq!(url, original);
        }
    }
}
