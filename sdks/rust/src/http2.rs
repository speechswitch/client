//! Executor-independent native HTTP/2 boundary for bidirectional calls.
use crate::http::TransportError;
use std::{
    future::Future,
    pin::Pin,
    task::{Context, Poll},
};

pub struct ConnectRequest {
    pub url: String,
    pub method: String,
    pub headers: Vec<(String, String)>,
    /// Bound each decoded header block before allocating it, including HPACK.
    pub max_header_bytes: usize,
    /// Split DATA into bounded chunks, preserving END_STREAM on the last chunk.
    pub max_data_bytes: usize,
}

pub enum Event {
    /// The final (non-informational) initial response header block.
    Headers {
        status: u16,
        headers: Vec<(String, String)>,
        end_stream: bool,
    },
    Data {
        bytes: Vec<u8>,
        end_stream: bool,
    },
    /// The final trailing header block, which must carry END_STREAM.
    Trailers(Vec<(String, String)>),
}

/// The peer stopped accepting input, but its response/status may still be read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InputClosed;
impl std::fmt::Display for InputClosed {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("HTTP/2 input is closed")
    }
}
impl std::error::Error for InputClosed {}

/// One reader and writer progress independently. Pending registers the caller's
/// waker. Drop aborts outstanding I/O promptly, including between consumer polls.
/// Wake pending readers/writers on termination. Both sending methods may return
/// InputClosed without closing the receive side.
pub trait Http2Like: Send {
    /// Accept one owned payload after the previous flush. Do not wait for network
    /// capacity or queue another payload; split frames according to peer limits.
    /// An empty final payload sends an empty DATA frame with END_STREAM.
    fn start_send(
        self: Pin<&mut Self>,
        bytes: Vec<u8>,
        end_stream: bool,
    ) -> Result<(), TransportError>;
    /// InputClosed is recoverable on the receive side; other errors abort the call.
    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), TransportError>>;
    /// May be polled while flushing. EOF is transport EOF, not application success.
    fn poll_receive(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Event, TransportError>>>;
}
pub type Stream = Pin<Box<dyn Http2Like>>;

/// Backend owns TCP/TLS, HTTP/2 framing, HPACK, flow control and stream resets.
/// Verify certificates and HTTP/2 negotiation before sending credentials; never
/// redirect or retry requests. Enforce response header/DATA limits before returning
/// events. Do not include credential-bearing URLs or headers in transport errors.
pub trait Http2Transport: Send + Sync {
    /// Return once input can be sent, without waiting for response headers (the
    /// server may wait for the first input message). Drop cancels a pending open.
    fn connect(
        &self,
        request: ConnectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<Stream, TransportError>> + Send + '_>>;
}
