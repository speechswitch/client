use super::failure;
use crate::{
    http::{HttpResponse, TransportError},
    json::Raw,
    runtime::{InputStream, StreamingInput},
};
use std::{
    collections::VecDeque,
    fmt,
    pin::Pin,
    task::{Context, Poll},
};

#[derive(Debug)]
pub struct Error {
    pub status_code: u16,
    pub generation_id: String,
    pub message: String,
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Deepdub returned HTTP {}: {}",
            self.status_code, self.message
        )
    }
}
impl std::error::Error for Error {}

/// Owned response; drop cancels without another poll. Error and EOF release it
/// immediately and are terminal. Returned chunks are owned byte vectors.
pub struct Stream {
    state: Option<State>,
}
struct State {
    body: StreamingInput<Vec<u8>>,
    status: u16,
    generation_id: String,
    max_error: usize,
    error_body: Vec<u8>,
    verified: bool,
    prefix: Vec<u8>,
    pending: VecDeque<Vec<u8>>,
}
impl Stream {
    pub(super) fn new(response: HttpResponse, id: String, opus: bool, max_error: usize) -> Self {
        let generation_id = response
            .headers
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case("x-generation-id"))
            .map_or(id, |(_, v)| v.clone());
        Self {
            state: Some(State {
                body: response.body,
                status: response.status,
                generation_id,
                max_error,
                error_body: Vec::new(),
                verified: !opus,
                prefix: Vec::new(),
                pending: VecDeque::new(),
            }),
        }
    }
}
impl InputStream<Vec<u8>> for Stream {
    fn poll_next(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Vec<u8>, TransportError>>> {
        let s = self.get_mut();
        let Some(state) = &mut s.state else {
            return Poll::Ready(None);
        };
        let result = state.next(cx);
        if matches!(&result, Poll::Ready(None) | Poll::Ready(Some(Err(_)))) {
            s.state = None;
        }
        result
    }
}
impl State {
    fn next(&mut self, cx: &mut Context<'_>) -> Poll<Option<Result<Vec<u8>, TransportError>>> {
        if self.verified {
            if let Some(chunk) = self.pending.pop_front() {
                return Poll::Ready(Some(Ok(chunk)));
            }
        }
        let failed = !(200..300).contains(&self.status);
        let chunk = match self.body.as_mut().poll_next(cx) {
            Poll::Pending => return Poll::Pending,
            Poll::Ready(Some(Err(error))) => return Poll::Ready(Some(Err(error))),
            Poll::Ready(None) => {
                if failed {
                    let text = String::from_utf8_lossy(&self.error_body);
                    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
                    let message = Raw::parse_exact(text)
                        .ok()
                        .and_then(|v| v.object().ok())
                        .and_then(|v| v.get("message").and_then(|v| v.string().ok()))
                        .unwrap_or_else(|| text.into());
                    return Poll::Ready(Some(Err(Box::new(Error {
                        status_code: self.status,
                        generation_id: self.generation_id.clone(),
                        message: if message.is_empty() {
                            "Request failed".into()
                        } else {
                            message
                        },
                    }))));
                }
                return Poll::Ready(if self.verified {
                    None
                } else {
                    Some(Err(failure("Deepdub returned a truncated Ogg Opus header")))
                });
            }
            Poll::Ready(Some(Ok(chunk))) => chunk,
        };
        if failed {
            if chunk.len() > self.max_error - self.error_body.len() {
                return Poll::Ready(Some(Err(failure(
                    "Deepdub response exceeds max_error_bytes",
                ))));
            }
            self.error_body.extend(chunk);
        } else if !chunk.is_empty() {
            if self.verified {
                return Poll::Ready(Some(Ok(chunk)));
            }
            self.prefix
                .extend_from_slice(&chunk[..chunk.len().min(290 - self.prefix.len())]);
            self.pending.push_back(chunk);
            if self.prefix.len() >= 27 {
                if &self.prefix[..5] != b"OggS\0" || self.prefix[26] == 0 {
                    return Poll::Ready(Some(Err(failure(
                        "Deepdub did not return an Ogg Opus stream",
                    ))));
                }
                let start = 27 + self.prefix[26] as usize;
                if self.prefix.len() >= start + 8 {
                    if &self.prefix[start..start + 8] != b"OpusHead" {
                        return Poll::Ready(Some(Err(failure("Deepdub returned a different Ogg codec (the trial API has returned Vorbis) for requested Opus audio"))));
                    }
                    self.verified = true;
                    self.prefix = Vec::new();
                    return Poll::Ready(self.pending.pop_front().map(Ok));
                }
            }
        }
        // One transport chunk per poll, even for always-ready empty/error bodies.
        cx.waker().wake_by_ref();
        Poll::Pending
    }
}
