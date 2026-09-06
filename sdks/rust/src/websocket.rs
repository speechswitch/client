//! Executor-independent ownership contract for native WebSocket backends.
//! Providers construct authentication and explicitly encode/decode their messages.
use crate::http::TransportError;
use std::{
    future::Future,
    pin::Pin,
    task::{Context, Poll},
};

#[derive(Debug, PartialEq, Eq)]
pub enum Message {
    Text(String),
    Binary(Vec<u8>),
}

pub struct ConnectRequest {
    pub url: String,
    pub headers: Vec<(String, String)>,
    /// Enforce before allocating a complete message, including fragmentation.
    pub max_message_bytes: usize,
}

/// One reader and one writer may progress independently. All methods are
/// nonblocking; Pending must register the caller's waker. Drop aborts the native
/// connection and all outstanding I/O promptly, including between consumer polls.
pub trait WebSocketLike: Send {
    /// Accept one owned message. Called only after the previous flush completed.
    /// Must not wait for network capacity or enqueue more than this one message.
    fn start_send(self: Pin<&mut Self>, message: Message) -> Result<(), TransportError>;
    fn poll_flush(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
    ) -> Poll<Result<(), TransportError>>;
    /// None denotes normal close; abnormal closes and I/O errors are errors.
    /// Must remain usable while poll_flush is pending, and vice versa.
    fn poll_receive(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
    ) -> Poll<Option<Result<Message, TransportError>>>;
}
pub type Socket = Pin<Box<dyn WebSocketLike>>;

/// Backend owns TCP/TLS, RFC6455 framing, masking, ping/pong, bounded handshake
/// parsing and UTF-8/close validation. Verify certificates, do not redirect
/// credential-bearing handshakes, and never include their URLs in error messages.
/// Dropping a pending connect future must abort the handshake. No SDK runtime
/// dependency or executor is imposed; this is the same boundary as HttpTransport.
pub trait WebSocketTransport: Send + Sync {
    fn connect(
        &self,
        request: ConnectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<Socket, TransportError>> + Send + '_>>;
    /// Fill from the backend's OS cryptographic entropy source, never a clock,
    /// fixed seed or application PRNG. Used for provider correlation UUIDs.
    fn random_bytes(&self, output: &mut [u8]) -> Result<(), TransportError>;
}
