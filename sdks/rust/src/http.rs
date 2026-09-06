//! Streaming HTTP ownership shared by handwritten provider adapters.
//! Wire request construction and response codecs belong to the provider.

use crate::runtime::{InputStream, StreamingInput};
use std::{
    error::Error,
    fmt,
    future::Future,
    pin::Pin,
    task::{Context, Poll},
};

pub type TransportError = Box<dyn Error + Send + Sync>;

pub struct HttpRequest {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

pub struct HttpResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: StreamingInput<Vec<u8>>,
}

/// The transport owns HTTP/TLS. Dropping a pending send future must cancel the
/// request; dropping its response body must stop reading and release resources.
/// Do not forward credentials on cross-origin redirects. Neither sending nor
/// polling may block the executor, or buffer the complete response before returning.
pub trait HttpTransport: Send + Sync {
    fn send(
        &self,
        request: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>>;
}

#[derive(Debug, PartialEq, Eq)]
pub struct HttpStatusError {
    pub status: u16,
}

impl fmt::Display for HttpStatusError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "HTTP request failed with status {}", self.status)
    }
}
impl Error for HttpStatusError {}

/// Open a byte-native response. Framed JSON/SSE responses need a provider codec,
/// not this helper. Error bodies are closed without being buffered or exposed.
pub async fn open_audio(
    transport: &dyn HttpTransport,
    request: HttpRequest,
) -> Result<AudioStream, TransportError> {
    let response = transport.send(request).await?;
    if !(200..300).contains(&response.status) {
        return Err(Box::new(HttpStatusError {
            status: response.status,
        }));
    }
    Ok(AudioStream {
        body: Some(response.body),
    })
}

/// Pulling reads at most one transport chunk. Drop cancels unfinished audio.
/// EOF and read failure immediately release the body; an error is emitted once.
pub struct AudioStream {
    body: Option<StreamingInput<Vec<u8>>>,
}

impl InputStream<Vec<u8>> for AudioStream {
    fn poll_next(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
    ) -> Poll<Option<Result<Vec<u8>, TransportError>>> {
        let stream = self.get_mut();
        let Some(body) = &mut stream.body else {
            return Poll::Ready(None);
        };
        match body.as_mut().poll_next(context) {
            Poll::Ready(Some(Ok(bytes))) if bytes.is_empty() => {
                // Empty chunks aren't EOF. Yield to the executor instead of
                // spinning indefinitely on an immediately-ready producer.
                context.waker().wake_by_ref();
                Poll::Pending
            }
            result @ (Poll::Ready(None) | Poll::Ready(Some(Err(_)))) => {
                stream.body = None;
                result
            }
            result => result,
        }
    }
}
