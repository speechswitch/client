use super::failure;
use crate::{endpoint, http::TransportError, json::Raw, runtime::JsonValue};
use std::collections::BTreeMap;

pub(super) fn origin(address: &str) -> Result<String, TransportError> {
    let invalid =
        || failure("Vocu URLs must be HTTP(S) without credentials, fragments or invalid escapes");
    endpoint::validate(address, &["http", "https"]).ok_or_else(invalid)?;
    let bytes = address.as_bytes();
    for (index, byte) in bytes.iter().enumerate() {
        if *byte == b'%'
            && (bytes
                .get(index + 1)
                .map_or(true, |v| !v.is_ascii_hexdigit())
                || bytes
                    .get(index + 2)
                    .map_or(true, |v| !v.is_ascii_hexdigit()))
        {
            return Err(invalid());
        }
    }
    let (scheme, tail) = address.split_once("://").ok_or_else(invalid)?;
    let scheme = scheme.to_ascii_lowercase();
    let authority = tail.split(['/', '?']).next().ok_or_else(invalid)?;
    let (host, port) = if authority.starts_with('[') {
        let (host, tail) = authority.split_once(']').ok_or_else(invalid)?;
        (format!("{host}]"), tail.strip_prefix(':'))
    } else {
        let (host, port) = authority
            .split_once(':')
            .map_or((authority, None), |(host, port)| (host, Some(port)));
        (host.to_ascii_lowercase(), port)
    };
    let port: Option<u16> = port
        .map(|value| value.parse().map_err(|_| invalid()))
        .transpose()?;
    Ok(
        if matches!(
            (scheme.as_str(), port),
            ("https", Some(443)) | ("http", Some(80))
        ) || port.is_none()
        {
            format!("{scheme}://{host}")
        } else {
            format!("{scheme}://{host}:{}", port.unwrap())
        },
    )
}

pub(super) fn audio_url(
    base: &str,
    address: &str,
    origins: &[String],
) -> Result<String, TransportError> {
    let invalid = || failure("Vocu returned an untrusted audio URL");
    if address
        .chars()
        .any(|ch| ch.is_whitespace() || ch.is_control() || matches!(ch, '#' | '\\'))
    {
        return Err(invalid());
    }
    let (scheme, tail) = base.split_once("://").ok_or_else(invalid)?;
    let base_origin = origin(base)?;
    let location = if address.contains("://") {
        address.into()
    } else if address.starts_with("//") {
        format!("{scheme}:{address}")
    } else {
        if address
            .split('/')
            .next()
            .unwrap_or("")
            .split('?')
            .next()
            .unwrap_or("")
            .contains(':')
        {
            return Err(invalid());
        }
        let path = tail.find('/').map_or("/", |index| &tail[index..]);
        if address.starts_with('/') {
            format!("{base_origin}{address}")
        } else if address.starts_with('?') {
            format!("{base_origin}{path}{address}")
        } else {
            let directory = path.rsplit_once('/').map_or("", |(directory, _)| directory);
            format!("{base_origin}{directory}/{address}")
        }
    };
    let origin = origin(&location).map_err(|_| invalid())?;
    if !origins.iter().any(|allowed| allowed == &origin) {
        return Err(invalid());
    }
    // Normalize relative dot segments without changing signed query bytes.
    let (_, tail) = location.split_once("://").ok_or_else(invalid)?;
    let path_start = tail.find(['/', '?']).unwrap_or(tail.len());
    let suffix = &tail[path_start..];
    let (path, query) = suffix
        .split_once('?')
        .map_or((suffix, None), |(path, query)| (path, Some(query)));
    let trailing = path.ends_with("/.") || path.ends_with("/..");
    let mut segments = Vec::new();
    for segment in path.split('/') {
        match segment {
            "." => {}
            ".." => {
                if segments.len() > 1 {
                    segments.pop();
                }
            }
            _ => segments.push(segment),
        }
    }
    let mut path = segments.join("/");
    if !path.starts_with('/') {
        path.insert(0, '/');
    }
    if trailing && !path.ends_with('/') {
        path.push('/');
    }
    Ok(format!(
        "{origin}{path}{}",
        query.map_or(String::new(), |value| format!("?{value}"))
    ))
}

pub(super) fn metadata(text: &str) -> Result<BTreeMap<String, JsonValue>, TransportError> {
    let raw = Raw::parse_exact(text).map_err(|_| failure("Invalid Vocu metadata"))?;
    if !raw.text().starts_with('{') {
        return Err(failure("Invalid Vocu response object"));
    }
    match value(raw, 0)? {
        JsonValue::Object(value) => Ok(value),
        _ => unreachable!(),
    }
}
fn value(raw: Raw<'_>, depth: usize) -> Result<JsonValue, TransportError> {
    // Owned JsonValue trees also recurse when dropped. Bound untrusted nesting
    // before construction so both decoding and consumer drop remain stack-safe.
    if depth > 128 {
        return Err(failure("Vocu metadata exceeds maximum nesting depth (128)"));
    }
    Ok(match raw.text().as_bytes()[0] {
        b'n' => JsonValue::Null,
        b't' | b'f' => JsonValue::Bool(raw.boolean()?),
        b'"' => JsonValue::String(raw.string()?),
        b'[' => {
            let values: Result<Vec<_>, TransportError> = raw
                .array()?
                .into_iter()
                .map(|child| value(child, depth + 1))
                .collect();
            JsonValue::Array(values?)
        }
        b'{' => {
            let values: Result<BTreeMap<_, _>, TransportError> = raw
                .object()?
                .into_iter()
                .map(|(key, child)| Ok((key, value(child, depth + 1)?)))
                .collect();
            JsonValue::Object(values?)
        }
        _ => {
            let number = raw.number()?;
            if !number.is_finite() {
                return Err(failure("Invalid Vocu metadata"));
            }
            JsonValue::Number(number)
        }
    })
}
