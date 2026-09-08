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
}
