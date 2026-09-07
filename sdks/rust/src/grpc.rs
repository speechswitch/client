//! Byte-native, uncompressed protobuf gRPC over an injected native HTTP/2 backend.
//! The cataloged gRPC protocol defines framing; generated clients own protobufs.
use crate::{
    endpoint,
    http::TransportError,
    http2::{self, Event, Http2Transport, InputClosed},
};
use std::{
    pin::Pin,
    task::{Context, Poll},
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    Protocol(&'static str),
    HttpStatus(u16),
    Status { code: u8, message: String },
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Protocol(message) => f.write_str(message),
            Self::HttpStatus(status) => write!(f, "gRPC returned HTTP {status}"),
            Self::Status { message, .. } => f.write_str(message),
        }
    }
}
impl std::error::Error for Error {}

/// One already-authenticated call. Generated protobuf codecs sit above this
/// boundary. InputClosed from sending requires draining the final response status.
pub trait GrpcLike: Send {
    fn start_send(self: Pin<&mut Self>, message: Vec<u8>) -> Result<(), TransportError>;
    fn start_end(self: Pin<&mut Self>) -> Result<(), TransportError>;
    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), TransportError>>;
    fn poll_receive(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Vec<u8>, TransportError>>>;
}
pub type Call = Pin<Box<dyn GrpcLike>>;

/// Fully resolved configuration: providers own auth/env/default resolution.
pub struct ConnectRequest {
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub max_message_bytes: usize,
    pub max_header_bytes: usize,
}
const MAX_DATA_BYTES: usize = 64 * 1024;

pub async fn connect(
    transport: &dyn Http2Transport,
    options: ConnectRequest,
) -> Result<Stream, TransportError> {
    if options.max_message_bytes == 0
        || options.max_message_bytes > u32::MAX as usize
        || options.max_header_bytes == 0
        || options.max_header_bytes > u32::MAX as usize
    {
        return Err(Error::Protocol("gRPC byte limits must be positive uint32 values").into());
    }
    endpoint::validate(&options.url, &["http", "https"]).ok_or(Error::Protocol(
        "gRPC URL must be HTTP(S) without credentials or a fragment",
    ))?;
    let mut headers = vec![
        ("content-type".into(), "application/grpc".into()),
        ("te".into(), "trailers".into()),
        ("grpc-accept-encoding".into(), "identity".into()),
    ];
    for (key, value) in options.headers {
        let key = key.to_ascii_lowercase();
        if key.is_empty()
            || !key.bytes().all(|b| {
                b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'_' | b'-' | b'.')
            })
            || matches!(
                key.as_str(),
                "host"
                    | "connection"
                    | "upgrade"
                    | "transfer-encoding"
                    | "content-length"
                    | "content-type"
                    | "te"
            )
            || key.starts_with("grpc-") && key != "grpc-timeout"
            || !value.bytes().all(|b| (32..=126).contains(&b))
        {
            return Err(Error::Protocol("Invalid gRPC request header").into());
        }
        headers.push((key, value));
    }
    if let Some(timeout) = single(&headers, "grpc-timeout")? {
        let valid = timeout.len() >= 2
            && timeout.len() <= 9
            && matches!(
                timeout.as_bytes().last(),
                Some(b'H' | b'M' | b'S' | b'm' | b'u' | b'n')
            )
            && timeout.as_bytes()[..timeout.len() - 1]
                .iter()
                .all(u8::is_ascii_digit)
            && timeout[..timeout.len() - 1]
                .parse::<u32>()
                .is_ok_and(|value| value > 0);
        if !valid {
            return Err(Error::Protocol("Invalid gRPC timeout").into());
        }
    }
    let (scheme, rest) = options.url.split_once("://").unwrap();
    let boundary = rest.find(['/', '?']).unwrap_or(rest.len());
    let authority = &rest[..boundary];
    let path = &rest[boundary..];
    let implicit = [
        (":method".into(), "POST".into()),
        (":scheme".into(), scheme.into()),
        (":authority".into(), authority.into()),
        (
            ":path".into(),
            if path.starts_with('/') {
                path.into()
            } else {
                format!("/{path}")
            },
        ),
    ];
    let size = header_size(&headers).saturating_add(header_size(&implicit));
    if size > options.max_header_bytes {
        return Err(Error::Protocol("gRPC request headers exceed byte limit").into());
    }
    let socket = transport
        .connect(http2::ConnectRequest {
            url: options.url,
            method: "POST".into(),
            headers,
            max_header_bytes: options.max_header_bytes,
            max_data_bytes: MAX_DATA_BYTES,
        })
        .await?;
    Ok(Stream {
        socket: Some(socket),
        input: InputState::Ready,
        received_headers: false,
        pending: Vec::new(),
        cursor: 0,
        data_ended: false,
        prefix: [0; 5],
        prefix_used: 0,
        message: Vec::new(),
        message_len: None,
        max_message_bytes: options.max_message_bytes,
        max_header_bytes: options.max_header_bytes,
    })
}

fn header_size(headers: &[(String, String)]) -> usize {
    headers.iter().fold(0usize, |total, (key, value)| {
        total
            .saturating_add(key.len())
            .saturating_add(value.len())
            .saturating_add(32)
    })
}
fn single<'a>(headers: &'a [(String, String)], name: &str) -> Result<Option<&'a str>, Error> {
    let mut values = headers
        .iter()
        .filter(|(key, _)| key.eq_ignore_ascii_case(name));
    let value = values.next().map(|(_, value)| value.as_str());
    if values.next().is_some() {
        return Err(Error::Protocol("gRPC returned duplicate protocol headers"));
    }
    Ok(value)
}
fn status(headers: &[(String, String)]) -> Result<(), Error> {
    let raw = single(headers, "grpc-status")?
        .ok_or(Error::Protocol("gRPC response lacks a valid final status"))?;
    let code = raw
        .parse::<u8>()
        .ok()
        .filter(|code| *code <= 16 && code.to_string() == raw)
        .ok_or(Error::Protocol("gRPC response lacks a valid final status"))?;
    let message = single(headers, "grpc-message")?;
    if code == 0 {
        return Ok(());
    }
    let Some(message) = message else {
        return Err(Error::Status {
            code,
            message: format!("gRPC failed with status {code}"),
        });
    };
    // Malformed percent encoding or UTF-8 must preserve the raw status message.
    let decode = || -> Option<String> {
        let mut bytes = message.bytes();
        let mut decoded = Vec::new();
        while let Some(byte) = bytes.next() {
            decoded.push(if byte == b'%' {
                let high = (bytes.next()? as char).to_digit(16)?;
                let low = (bytes.next()? as char).to_digit(16)?;
                (high * 16 + low) as u8
            } else {
                byte
            });
        }
        String::from_utf8(decoded).ok()
    };
    Err(Error::Status {
        code,
        message: decode().unwrap_or_else(|| message.into()),
    })
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum InputState {
    Ready,
    Flushing,
    Ending,
    Ended,
    Closed,
}

pub struct Stream {
    socket: Option<http2::Stream>,
    input: InputState,
    received_headers: bool,
    pending: Vec<u8>,
    cursor: usize,
    data_ended: bool,
    prefix: [u8; 5],
    prefix_used: usize,
    message: Vec<u8>,
    message_len: Option<usize>,
    max_message_bytes: usize,
    max_header_bytes: usize,
}
impl Stream {
    fn terminate(&mut self) {
        self.socket = None;
        self.input = InputState::Closed;
        self.pending = Vec::new();
        self.message = Vec::new();
    }
    fn failed_send(&mut self, error: TransportError) -> TransportError {
        if error.is::<InputClosed>() {
            self.input = InputState::Closed;
        } else {
            self.terminate();
        }
        error
    }
    fn receive(&mut self, cx: &mut Context<'_>) -> Poll<Result<Option<Vec<u8>>, TransportError>> {
        if self.socket.is_none() {
            return Poll::Ready(Ok(None));
        }
        // Bound work even if a backend repeatedly returns immediately-ready empty
        // frames. DATA allocations are bounded independently of message size.
        for _ in 0..32 {
            if self.cursor < self.pending.len() || self.message_len == Some(0) {
                if self.prefix_used < 5 {
                    let count = (5 - self.prefix_used).min(self.pending.len() - self.cursor);
                    self.prefix[self.prefix_used..self.prefix_used + count]
                        .copy_from_slice(&self.pending[self.cursor..self.cursor + count]);
                    self.prefix_used += count;
                    self.cursor += count;
                }
                if self.prefix_used == 5 {
                    if self.message_len.is_none() {
                        if self.prefix[0] != 0 {
                            return Poll::Ready(Err(Error::Protocol(
                                "Compressed gRPC messages are not supported",
                            )
                            .into()));
                        }
                        let length =
                            u32::from_be_bytes(self.prefix[1..].try_into().unwrap()) as usize;
                        if length > self.max_message_bytes {
                            return Poll::Ready(Err(Error::Protocol(
                                "gRPC message exceeds byte limit",
                            )
                            .into()));
                        }
                        self.message_len = Some(length);
                    }
                    let length = self.message_len.unwrap();
                    let count = (length - self.message.len()).min(self.pending.len() - self.cursor);
                    self.message
                        .extend_from_slice(&self.pending[self.cursor..self.cursor + count]);
                    self.cursor += count;
                    if self.message.len() == length {
                        self.prefix_used = 0;
                        self.message_len = None;
                        let message = std::mem::take(&mut self.message);
                        if self.cursor == self.pending.len() {
                            self.pending = Vec::new();
                            self.cursor = 0;
                        }
                        return Poll::Ready(Ok(Some(message)));
                    }
                }
            }
            self.pending = Vec::new();
            self.cursor = 0;
            if self.data_ended {
                return Poll::Ready(Err(Error::Protocol(if self.prefix_used != 0 {
                    "Truncated gRPC message"
                } else {
                    "gRPC response lacks a valid final status"
                })
                .into()));
            }
            let event = match self.socket.as_mut().unwrap().as_mut().poll_receive(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(Some(Ok(event))) => event,
                Poll::Ready(Some(Err(error))) => return Poll::Ready(Err(error)),
                Poll::Ready(None) => {
                    return Poll::Ready(Err(Error::Protocol(if self.prefix_used != 0 {
                        "Truncated gRPC message"
                    } else if self.received_headers {
                        "gRPC response lacks a valid final status"
                    } else {
                        "gRPC closed before response headers"
                    })
                    .into()))
                }
            };
            match event {
                Event::Headers {
                    status: http_status,
                    headers,
                    end_stream,
                } => {
                    if self.received_headers {
                        return Poll::Ready(Err(Error::Protocol(
                            "gRPC returned multiple response header blocks",
                        )
                        .into()));
                    }
                    if header_size(&headers).saturating_add(42) > self.max_header_bytes {
                        return Poll::Ready(Err(Error::Protocol(
                            "gRPC response headers exceed byte limit",
                        )
                        .into()));
                    }
                    if http_status != 200 {
                        return Poll::Ready(Err(Error::HttpStatus(http_status).into()));
                    }
                    let content_type = single(&headers, "content-type")?
                        .unwrap_or("")
                        .split(';')
                        .next()
                        .unwrap()
                        .trim();
                    if !matches!(content_type, "application/grpc" | "application/grpc+proto") {
                        return Poll::Ready(Err(Error::Protocol(
                            "gRPC returned an invalid content type",
                        )
                        .into()));
                    }
                    if !matches!(
                        single(&headers, "grpc-encoding")?,
                        None | Some("identity") | Some("")
                    ) {
                        return Poll::Ready(Err(Error::Protocol(
                            "Compressed gRPC messages are not supported",
                        )
                        .into()));
                    }
                    self.received_headers = true;
                    if end_stream {
                        return Poll::Ready(status(&headers).map(|()| None).map_err(Into::into));
                    }
                    if single(&headers, "grpc-status")?.is_some() {
                        return Poll::Ready(Err(Error::Protocol(
                            "gRPC final status arrived before end of stream",
                        )
                        .into()));
                    }
                }
                Event::Data { bytes, end_stream } => {
                    if !self.received_headers {
                        return Poll::Ready(Err(Error::Protocol(
                            "gRPC data arrived before response headers",
                        )
                        .into()));
                    }
                    if bytes.len() > MAX_DATA_BYTES {
                        return Poll::Ready(Err(Error::Protocol(
                            "HTTP/2 data exceeds chunk byte limit",
                        )
                        .into()));
                    }
                    self.pending = bytes;
                    self.data_ended = end_stream;
                }
                Event::Trailers(headers) => {
                    if !self.received_headers {
                        return Poll::Ready(Err(Error::Protocol(
                            "gRPC trailers arrived before response headers",
                        )
                        .into()));
                    }
                    if self.prefix_used != 0 {
                        return Poll::Ready(Err(Error::Protocol("Truncated gRPC message").into()));
                    }
                    if header_size(&headers) > self.max_header_bytes {
                        return Poll::Ready(Err(Error::Protocol(
                            "gRPC trailers exceed byte limit",
                        )
                        .into()));
                    }
                    return Poll::Ready(status(&headers).map(|()| None).map_err(Into::into));
                }
            }
        }
        cx.waker().wake_by_ref();
        Poll::Pending
    }
}
impl GrpcLike for Stream {
    fn start_send(self: Pin<&mut Self>, message: Vec<u8>) -> Result<(), TransportError> {
        let stream = self.get_mut();
        if stream.input == InputState::Closed {
            return Err(InputClosed.into());
        }
        if stream.input != InputState::Ready {
            return Err(Error::Protocol("gRPC input is not ready").into());
        }
        if message.len() > stream.max_message_bytes {
            return Err(Error::Protocol("gRPC message exceeds byte limit").into());
        }
        let capacity = message
            .len()
            .checked_add(5)
            .ok_or(Error::Protocol("gRPC message exceeds byte limit"))?;
        let mut frame = Vec::with_capacity(capacity);
        frame.push(0);
        frame.extend_from_slice(&(message.len() as u32).to_be_bytes());
        frame.extend(message);
        match stream
            .socket
            .as_mut()
            .unwrap()
            .as_mut()
            .start_send(frame, false)
        {
            Ok(()) => {
                stream.input = InputState::Flushing;
                Ok(())
            }
            Err(error) => Err(stream.failed_send(error)),
        }
    }
    fn start_end(self: Pin<&mut Self>) -> Result<(), TransportError> {
        let stream = self.get_mut();
        if matches!(stream.input, InputState::Ending | InputState::Ended) {
            return Ok(());
        }
        if stream.input == InputState::Closed {
            return Err(InputClosed.into());
        }
        if stream.input != InputState::Ready {
            return Err(Error::Protocol("gRPC input is not ready").into());
        }
        match stream
            .socket
            .as_mut()
            .unwrap()
            .as_mut()
            .start_send(Vec::new(), true)
        {
            Ok(()) => {
                stream.input = InputState::Ending;
                Ok(())
            }
            Err(error) => Err(stream.failed_send(error)),
        }
    }
    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), TransportError>> {
        let stream = self.get_mut();
        if matches!(stream.input, InputState::Ready | InputState::Ended) {
            return Poll::Ready(Ok(()));
        }
        if stream.input == InputState::Closed {
            return Poll::Ready(Err(InputClosed.into()));
        }
        match stream.socket.as_mut().unwrap().as_mut().poll_flush(cx) {
            Poll::Ready(Ok(())) => {
                stream.input = if stream.input == InputState::Ending {
                    InputState::Ended
                } else {
                    InputState::Ready
                };
                Poll::Ready(Ok(()))
            }
            Poll::Ready(Err(error)) => Poll::Ready(Err(stream.failed_send(error))),
            Poll::Pending => Poll::Pending,
        }
    }
    fn poll_receive(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Vec<u8>, TransportError>>> {
        let stream = self.get_mut();
        match stream.receive(cx) {
            Poll::Ready(Ok(Some(message))) => Poll::Ready(Some(Ok(message))),
            Poll::Ready(Ok(None)) => {
                stream.terminate();
                Poll::Ready(None)
            }
            Poll::Ready(Err(error)) => {
                stream.terminate();
                Poll::Ready(Some(Err(error)))
            }
            Poll::Pending => Poll::Pending,
        }
    }
}

#[cfg(test)]
mod tests;
