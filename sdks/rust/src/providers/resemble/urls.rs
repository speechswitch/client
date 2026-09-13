use super::failure;
use crate::{endpoint, http::TransportError};

pub(super) struct Url {
    pub(super) scheme: String,
    authority: String,
    path: String,
    query: Option<String>,
}
impl Url {
    pub fn parse(value: &str) -> Result<Self, TransportError> {
        endpoint::validate(value, &["http", "https"])
            .ok_or_else(|| failure("Invalid Resemble deployment or audio URL"))?;
        let mut bytes = value.bytes();
        while let Some(byte) = bytes.next() {
            if byte == b'%'
                && (!bytes.next().is_some_and(|b| b.is_ascii_hexdigit())
                    || !bytes.next().is_some_and(|b| b.is_ascii_hexdigit()))
            {
                return Err(failure("Invalid Resemble deployment or audio URL"));
            }
        }
        let (scheme, tail) = value.split_once("://").unwrap();
        let end = tail.find(['/', '?']).unwrap_or(tail.len());
        let (path, query) = tail[end..]
            .split_once('?')
            .map_or((&tail[end..], None), |(path, query)| {
                (path, Some(query.to_owned()))
            });
        Ok(Self {
            scheme: scheme.to_ascii_lowercase(),
            authority: tail[..end].to_owned(),
            path: if path.is_empty() {
                "/".into()
            } else {
                path.into()
            },
            query,
        })
    }
    pub fn root(&mut self) {
        self.path = format!("{}/", self.path.trim_end_matches('/'));
    }
    pub fn text(&self) -> String {
        format!(
            "{}://{}{}{}",
            self.scheme,
            self.authority,
            self.path,
            self.query
                .as_ref()
                .map_or(String::new(), |q| format!("?{q}"))
        )
    }
    pub fn endpoint(&self, path: &str) -> String {
        format!(
            "{}://{}{}/gradio_api/{}{}",
            self.scheme,
            self.authority,
            self.path.trim_end_matches('/'),
            path,
            self.query
                .as_ref()
                .map_or(String::new(), |q| format!("?{q}"))
        )
    }
    fn origin(&self) -> (String, String, u16) {
        let (host, port) = if self.authority.starts_with('[') {
            let (address, rest) = self.authority[1..].split_once(']').unwrap();
            (
                address.parse::<std::net::Ipv6Addr>().unwrap().to_string(),
                rest.strip_prefix(':'),
            )
        } else {
            self.authority.split_once(':').map_or(
                (self.authority.to_ascii_lowercase(), None),
                |(host, port)| (host.to_ascii_lowercase(), Some(port)),
            )
        };
        (
            self.scheme.clone(),
            host,
            port.map_or(if self.scheme == "https" { 443 } else { 80 }, |p| {
                p.parse().unwrap()
            }),
        )
    }
    pub fn same_origin(&self, other: &Self) -> bool {
        self.origin() == other.origin()
    }
    pub fn resolve(&self, reference: &str) -> Result<Self, TransportError> {
        if reference
            .chars()
            .any(|c| c.is_control() || c.is_whitespace() || matches!(c, '\\' | '#'))
        {
            return Err(failure("Invalid Resemble deployment or audio URL"));
        }
        if reference.starts_with("//") {
            return Self::parse(&format!("{}:{reference}", self.scheme));
        }
        if reference
            .split(['/', '?'])
            .next()
            .unwrap_or("")
            .contains(':')
        {
            return Self::parse(reference);
        }
        let (path, query) = reference
            .split_once('?')
            .map_or((reference, None), |(path, query)| {
                (path, Some(query.to_owned()))
            });
        let path = if path.is_empty() {
            self.path.clone()
        } else if path.starts_with('/') {
            path.to_owned()
        } else {
            format!("{}{path}", self.path)
        };
        let mut segments = Vec::new();
        for segment in path.split('/').skip(1) {
            match segment {
                "." => {}
                ".." => {
                    segments.pop();
                }
                _ => segments.push(segment),
            }
        }
        if path.ends_with("/.") || path.ends_with("/..") {
            segments.push("");
        }
        let resolved = Self {
            scheme: self.scheme.clone(),
            authority: self.authority.clone(),
            path: format!("/{}", segments.join("/")),
            query: if reference.is_empty() {
                self.query.clone()
            } else {
                query
            },
        };
        Self::parse(&resolved.text())
    }
}

pub(super) fn component(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut result = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric()
            || matches!(
                byte,
                b'-' | b'_' | b'.' | b'~' | b'!' | b'*' | b'\'' | b'(' | b')'
            )
        {
            result.push(byte as char);
        } else {
            result.push('%');
            result.push(HEX[(byte >> 4) as usize] as char);
            result.push(HEX[(byte & 15) as usize] as char);
        }
    }
    result
}
