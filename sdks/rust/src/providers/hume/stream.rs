use super::{
    protocol::{self, failure},
    settings::Map,
};
use crate::{
    generated::hume_output::SynthesisItem,
    http::TransportError,
    json,
    runtime::{InputStream, JsonValue, StreamingInput},
    websocket::{Message, Socket},
};
use std::{
    pin::Pin,
    task::{Context, Poll},
};

type Next = Poll<Result<Option<SynthesisItem>, TransportError>>;
enum State {
    Http(HttpStream),
    Socket(SocketStream),
}
/// Owns input and network I/O. Drop cancels; terminal results release immediately.
pub struct Stream {
    state: Option<State>,
}
impl Stream {
    pub(super) fn http(body: StreamingInput<Vec<u8>>, metadata: bool, limit: usize) -> Self {
        Self {
            state: Some(State::Http(HttpStream {
                body,
                metadata,
                limit,
                first: true,
                ended: false,
                line: Vec::new(),
                pending: Vec::new().into_iter(),
            })),
        }
    }
    pub(super) fn socket(
        socket: Socket,
        input: StreamingInput<Map>,
        metadata: bool,
        limit: usize,
    ) -> Self {
        Self {
            state: Some(State::Socket(SocketStream {
                socket,
                input,
                metadata,
                limit,
                writing: false,
                input_done: false,
                prefer_output: true,
            })),
        }
    }
}
impl InputStream<SynthesisItem> for Stream {
    fn poll_next(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<SynthesisItem, TransportError>>> {
        let s = self.get_mut();
        let Some(state) = &mut s.state else {
            return Poll::Ready(None);
        };
        let result = match state {
            State::Http(v) => v.next(cx),
            State::Socket(v) => v.next(cx),
        };
        match result {
            Poll::Pending => Poll::Pending,
            Poll::Ready(Ok(Some(item))) => Poll::Ready(Some(Ok(item))),
            Poll::Ready(Ok(None)) => {
                s.state = None;
                Poll::Ready(None)
            }
            Poll::Ready(Err(error)) => {
                s.state = None;
                Poll::Ready(Some(Err(error)))
            }
        }
    }
}
struct HttpStream {
    body: StreamingInput<Vec<u8>>,
    metadata: bool,
    limit: usize,
    first: bool,
    ended: bool,
    line: Vec<u8>,
    pending: std::vec::IntoIter<u8>,
}
impl HttpStream {
    fn line(&mut self) -> Result<Option<SynthesisItem>, TransportError> {
        let data = std::mem::take(&mut self.line);
        let bytes = if self.first {
            data.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&data)
        } else {
            &data
        };
        self.first = false;
        let text =
            std::str::from_utf8(bytes).map_err(|_| failure("Hume returned invalid UTF-8"))?;
        if text.trim().is_empty() {
            return Ok(None);
        }
        protocol::packet(text, true)
    }
    fn next(&mut self, cx: &mut Context<'_>) -> Next {
        for _ in 0..4096 {
            let item = if let Some(byte) = self.pending.next() {
                if byte != b'\n' {
                    if self.line.len() == self.limit {
                        return Poll::Ready(Err(failure("Hume JSON line exceeds max_json_bytes")));
                    }
                    self.line.push(byte);
                    continue;
                }
                self.line()?
            } else if self.ended {
                if self.line.is_empty() {
                    return Poll::Ready(Ok(None));
                }
                self.line()?
            } else {
                match self.body.as_mut().poll_next(cx) {
                    Poll::Pending => return Poll::Pending,
                    Poll::Ready(None) => {
                        self.ended = true;
                        continue;
                    }
                    Poll::Ready(Some(Err(e))) => return Poll::Ready(Err(e)),
                    Poll::Ready(Some(Ok(bytes))) => {
                        if bytes.is_empty() {
                            cx.waker().wake_by_ref();
                            return Poll::Pending;
                        }
                        if !self.metadata {
                            return Poll::Ready(Ok(Some(SynthesisItem::Bytes(bytes))));
                        }
                        self.pending = bytes.into_iter();
                        continue;
                    }
                }
            };
            if let Some(item) = item {
                return Poll::Ready(Ok(Some(item)));
            }
        }
        cx.waker().wake_by_ref();
        Poll::Pending
    }
}
struct SocketStream {
    // Drop order releases the connection before producer cleanup.
    socket: Socket,
    input: StreamingInput<Map>,
    metadata: bool,
    limit: usize,
    writing: bool,
    input_done: bool,
    prefer_output: bool,
}
enum Step {
    Continue,
    Item(SynthesisItem),
    Done,
}
impl SocketStream {
    fn send(&mut self, fields: Map) -> Result<(), TransportError> {
        let mut data = String::new();
        json::write(&JsonValue::Object(fields), &mut data)?;
        if data.len() > self.limit {
            return Err(failure("Hume message exceeds max_message_bytes"));
        }
        self.socket.as_mut().start_send(Message::Text(data))?;
        self.writing = true;
        Ok(())
    }
    fn next(&mut self, cx: &mut Context<'_>) -> Next {
        for output in if self.prefer_output {
            [true, false]
        } else {
            [false, true]
        } {
            match if output {
                self.receive(cx)
            } else {
                self.input(cx)
            } {
                Poll::Pending => {}
                Poll::Ready(Err(e)) => return Poll::Ready(Err(e)),
                Poll::Ready(Ok(Step::Done)) => return Poll::Ready(Ok(None)),
                Poll::Ready(Ok(step)) => {
                    self.prefer_output = !output;
                    if let Step::Item(item) = step {
                        return Poll::Ready(Ok(Some(item)));
                    }
                    cx.waker().wake_by_ref();
                    return Poll::Pending;
                }
            }
        }
        Poll::Pending
    }
    fn input(&mut self, cx: &mut Context<'_>) -> Poll<Result<Step, TransportError>> {
        if self.writing {
            match self.socket.as_mut().poll_flush(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(v) => v?,
            }
            self.writing = false;
            return Poll::Ready(Ok(Step::Continue));
        }
        if self.input_done {
            return Poll::Pending;
        }
        match self.input.as_mut().poll_next(cx) {
            Poll::Pending => Poll::Pending,
            Poll::Ready(Some(Err(e))) => Poll::Ready(Err(e)),
            Poll::Ready(Some(Ok(fields))) => {
                self.send(fields)?;
                Poll::Ready(Ok(Step::Continue))
            }
            Poll::Ready(None) => {
                // A normal close may arrive while the final write is still draining.
                self.input_done = true;
                self.send(Map::from([("close".into(), JsonValue::Bool(true))]))?;
                Poll::Ready(Ok(Step::Continue))
            }
        }
    }
    fn receive(&mut self, cx: &mut Context<'_>) -> Poll<Result<Step, TransportError>> {
        let message = match self.socket.as_mut().poll_receive(cx) {
            Poll::Pending => return Poll::Pending,
            Poll::Ready(None) => {
                return Poll::Ready(if self.input_done {
                    Ok(Step::Done)
                } else {
                    Err(failure(
                        "Hume WebSocket closed before the input stream ended",
                    ))
                })
            }
            Poll::Ready(Some(v)) => v?,
        };
        let size = match &message {
            Message::Text(v) => v.len(),
            Message::Binary(v) => v.len(),
        };
        if size > self.limit {
            return Poll::Ready(Err(failure("Hume message exceeds max_message_bytes")));
        }
        let item = match message {
            Message::Binary(v) => {
                if self.metadata {
                    return Poll::Ready(Err(failure("Hume returned binary audio in JSON mode")));
                }
                Some(SynthesisItem::Bytes(v))
            }
            Message::Text(v) => protocol::packet(&v, self.metadata)?,
        };
        Poll::Ready(Ok(item.map_or(Step::Continue, Step::Item)))
    }
}
