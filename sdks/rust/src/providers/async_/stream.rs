use super::{
    protocol::{self, failure},
    settings::Mode,
};
use crate::{
    generated::async_output::*,
    http::{HttpResponse, TransportError},
    runtime::{InputStream, StreamingInput, ValidationError},
    websocket::{Message, Socket},
};
use std::{
    any::Any,
    pin::Pin,
    task::{Context, Poll},
};

type Validator = Box<dyn Fn(&dyn Any, Option<&str>) -> Result<(), ValidationError> + Send>;
enum State {
    Http(HttpStream),
    Socket(SocketStream),
}

/// Owns the response/socket and input. Dropping also cancels between pulls;
/// completion/errors release resources immediately and are terminal.
pub struct Stream {
    state: Option<State>,
}
impl Stream {
    pub(super) fn http(response: HttpResponse, mode: Mode, max_json: usize) -> Self {
        Self {
            state: Some(State::Http(HttpStream {
                response,
                mode,
                max_json,
                buffer: Vec::new(),
                quota: false,
                eof: false,
            })),
        }
    }
    pub(super) fn socket(
        socket: Socket,
        input: StreamingInput<String>,
        id: String,
        force: bool,
        max_message: usize,
        validate: Validator,
    ) -> Self {
        Self {
            state: Some(State::Socket(SocketStream {
                socket,
                input: Some(input),
                id,
                force,
                max_message,
                validate,
                initialized: false,
                writing: true,
                started: false,
            })),
        }
    }
}
impl InputStream<SynthesisItem> for Stream {
    fn poll_next(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<SynthesisItem, TransportError>>> {
        let stream = self.get_mut();
        let Some(state) = &mut stream.state else {
            return Poll::Ready(None);
        };
        let result = match state {
            State::Http(stream) => stream.next(cx),
            State::Socket(stream) => stream.next(cx),
        };
        match result {
            Poll::Pending => Poll::Pending,
            Poll::Ready(Err(error)) => {
                stream.state = None;
                Poll::Ready(Some(Err(error)))
            }
            Poll::Ready(Ok((item, done))) => {
                if done {
                    stream.state = None;
                }
                Poll::Ready(item.map(Ok))
            }
        }
    }
}

type Next = Poll<Result<(Option<SynthesisItem>, bool), TransportError>>;
const QUOTA: &[u8] = b"--ERROR:QUOTA_EXCEEDED--";
struct HttpStream {
    response: HttpResponse,
    mode: Mode,
    max_json: usize,
    buffer: Vec<u8>,
    quota: bool,
    eof: bool,
}
impl HttpStream {
    fn next(&mut self, cx: &mut Context<'_>) -> Next {
        if self.quota {
            return Poll::Ready(Err(failure("Async streaming quota exceeded")));
        }
        if self.eof {
            return Poll::Ready(Ok((None, true)));
        }
        let json = !(200..300).contains(&self.response.status) || self.mode == Mode::Timestamped;
        match self.response.body.as_mut().poll_next(cx) {
            Poll::Pending => Poll::Pending,
            Poll::Ready(Some(Err(error))) => Poll::Ready(Err(error)),
            Poll::Ready(None) => {
                self.eof = true;
                if json {
                    let text = String::from_utf8_lossy(&self.buffer);
                    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
                    if !(200..300).contains(&self.response.status) {
                        return Poll::Ready(Err(failure(format!(
                            "Async returned HTTP {}: {}",
                            self.response.status,
                            text.trim_matches(protocol::WHITESPACE)
                        ))));
                    }
                    let audio = protocol::timestamped(text)?;
                    Poll::Ready(Ok((Some(SynthesisItem::Chunk(audio)), true)))
                } else if self.buffer.is_empty() {
                    Poll::Ready(Ok((None, true)))
                } else {
                    Poll::Ready(Ok((
                        Some(SynthesisItem::Bytes(std::mem::take(&mut self.buffer))),
                        true,
                    )))
                }
            }
            Poll::Ready(Some(Ok(chunk))) => {
                if json {
                    if chunk.len() > self.max_json - self.buffer.len() {
                        return Poll::Ready(Err(failure("Async response exceeds max_json_bytes")));
                    }
                    self.buffer.extend(chunk);
                } else if !chunk.is_empty() {
                    if self.mode == Mode::Plain {
                        return Poll::Ready(Ok((Some(SynthesisItem::Bytes(chunk)), false)));
                    }
                    self.buffer.extend(chunk);
                    if let Some(index) = self
                        .buffer
                        .windows(QUOTA.len())
                        .position(|value| value == QUOTA)
                    {
                        self.quota = true;
                        if index == 0 {
                            return Poll::Ready(Err(failure("Async streaming quota exceeded")));
                        }
                        self.buffer.truncate(index);
                        return Poll::Ready(Ok((
                            Some(SynthesisItem::Bytes(std::mem::take(&mut self.buffer))),
                            false,
                        )));
                    }
                    let mut retained = self.buffer.len().min(QUOTA.len() - 1);
                    while retained > 0
                        && self.buffer[self.buffer.len() - retained..] != QUOTA[..retained]
                    {
                        retained -= 1;
                    }
                    let safe = self.buffer.len() - retained;
                    if safe > 0 {
                        let pending = self.buffer[safe..].to_vec();
                        let mut audio = std::mem::replace(&mut self.buffer, pending);
                        audio.truncate(safe);
                        return Poll::Ready(Ok((Some(SynthesisItem::Bytes(audio)), false)));
                    }
                }
                // Bound work per poll even for endlessly ready empty chunks.
                cx.waker().wake_by_ref();
                Poll::Pending
            }
        }
    }
}

struct SocketStream {
    // Fields drop in declaration order: release the network before the producer.
    socket: Socket,
    input: Option<StreamingInput<String>>,
    id: String,
    force: bool,
    max_message: usize,
    validate: Validator,
    initialized: bool,
    writing: bool,
    started: bool,
}
impl SocketStream {
    fn next(&mut self, cx: &mut Context<'_>) -> Next {
        if !self.initialized {
            match self.socket.as_mut().poll_flush(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(result) => result?,
            }
            self.initialized = true;
            self.writing = false;
        }
        // Read before progressing either input or a backpressured write.
        match self.socket.as_mut().poll_receive(cx) {
            Poll::Pending => {}
            Poll::Ready(None) => {
                return Poll::Ready(Err(failure("Async WebSocket closed before final output")))
            }
            Poll::Ready(Some(Err(error))) => return Poll::Ready(Err(error)),
            Poll::Ready(Some(Ok(message))) => {
                let Message::Text(text) = message else {
                    return Poll::Ready(Err(failure("Async returned a non-text WebSocket frame")));
                };
                if text.len() > self.max_message {
                    return Poll::Ready(Err(failure("Async message exceeds max_message_bytes")));
                }
                let (audio, done) = protocol::socket_audio(&text, &self.id, self.input.is_none())?;
                if !audio.is_empty() {
                    return Poll::Ready(Ok((Some(SynthesisItem::Bytes(audio)), done)));
                }
                if done {
                    return Poll::Ready(Ok((None, true)));
                }
                cx.waker().wake_by_ref();
                return Poll::Pending;
            }
        }
        if self.writing {
            match self.socket.as_mut().poll_flush(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(result) => result?,
            }
            self.writing = false;
        }
        let Some(input) = &mut self.input else {
            return Poll::Pending;
        };
        let message = match input.as_mut().poll_next(cx) {
            Poll::Pending => return Poll::Pending,
            Poll::Ready(Some(Err(error))) => return Poll::Ready(Err(error)),
            Poll::Ready(None) => {
                self.input = None;
                if !self.started {
                    return Poll::Ready(Ok((None, true)));
                }
                protocol::text_message(&self.id, "", false, true)
            }
            Poll::Ready(Some(Ok(text))) => {
                (self.validate)(&text, None)?;
                if text.is_empty() {
                    cx.waker().wake_by_ref();
                    return Poll::Pending;
                }
                self.started = true;
                protocol::text_message(
                    &self.id,
                    &format!("{} ", text.trim_end_matches(protocol::WHITESPACE)),
                    self.force,
                    false,
                )
            }
        };
        if message.len() > self.max_message {
            return Poll::Ready(Err(failure("Async message exceeds max_message_bytes")));
        }
        self.socket.as_mut().start_send(Message::Text(message))?;
        self.writing = true;
        // Register flush I/O now; receiving gets priority again on the next poll.
        if let Poll::Ready(result) = self.socket.as_mut().poll_flush(cx) {
            result?;
            self.writing = false;
        }
        cx.waker().wake_by_ref();
        Poll::Pending
    }
}
