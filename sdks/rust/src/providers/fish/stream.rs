use super::{
    protocol::{self, failure, Packet},
    settings::Input,
};
use crate::{
    generated::fish_output::SynthesisItem,
    http::TransportError,
    msgpack::{self, Value},
    runtime::{InputStream, StreamingInput, ValidationError},
    sse,
    websocket::{Message, Socket},
};
use std::{
    any::Any,
    collections::BTreeMap,
    pin::Pin,
    task::{Context, Poll},
};

type Validator = Box<dyn Fn(&dyn Any, Option<&str>) -> Result<(), ValidationError> + Send>;
type Next = Poll<Result<Option<SynthesisItem>, TransportError>>;
enum State {
    Http(HttpStream),
    Socket(SocketStream),
}
/// Owns network and input. Terminal events release both immediately; dropping
/// an unread/pending stream also cancels them without requiring another poll.
pub struct Stream {
    state: Option<State>,
}
impl Stream {
    pub(super) fn http(
        body: StreamingInput<Vec<u8>>,
        timed: bool,
        limit: usize,
    ) -> Result<Self, TransportError> {
        let decoder = if timed {
            Some(sse::Decoder::new(limit)?)
        } else {
            None
        };
        Ok(Self {
            state: Some(State::Http(HttpStream {
                body,
                decoder,
                pending: Vec::new().into_iter(),
            })),
        })
    }
    pub(super) fn socket(
        socket: Socket,
        input: StreamingInput<Input>,
        wire: Value,
        limit: usize,
        validate: Validator,
    ) -> Self {
        Self {
            state: Some(State::Socket(SocketStream {
                socket,
                input,
                initial: Some(wire),
                limit,
                validate,
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
            State::Http(s) => s.next(cx),
            State::Socket(s) => s.next(cx),
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
    decoder: Option<sse::Decoder>,
    pending: std::vec::IntoIter<u8>,
}
impl HttpStream {
    fn next(&mut self, cx: &mut Context<'_>) -> Next {
        // Bounded framing work remains cooperative for large chunks/comments.
        for _ in 0..4096 {
            if let Some(byte) = self.pending.next() {
                if let Some(message) = self.decoder.as_mut().unwrap().push(byte)? {
                    return Poll::Ready(protocol::alignment(&message.data).map(Some));
                }
                continue;
            }
            match self.body.as_mut().poll_next(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(None) => return Poll::Ready(Ok(None)),
                Poll::Ready(Some(Err(error))) => return Poll::Ready(Err(error)),
                Poll::Ready(Some(Ok(bytes))) => {
                    if bytes.is_empty() {
                        cx.waker().wake_by_ref();
                        return Poll::Pending;
                    }
                    if self.decoder.is_none() {
                        return Poll::Ready(Ok(Some(SynthesisItem::Bytes(bytes))));
                    }
                    self.pending = bytes.into_iter();
                }
            }
        }
        cx.waker().wake_by_ref();
        Poll::Pending
    }
}
struct SocketStream {
    // Rust drops fields in declaration order: connection before producer cleanup.
    socket: Socket,
    input: StreamingInput<Input>,
    initial: Option<Value>,
    limit: usize,
    validate: Validator,
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
    fn send(&mut self, fields: BTreeMap<String, Value>) -> Result<(), TransportError> {
        let bytes = msgpack::encode(&Value::Map(fields))?;
        if bytes.len() > self.limit {
            return Err(failure("Fish message exceeds max_message_bytes"));
        }
        self.socket.as_mut().start_send(Message::Binary(bytes))?;
        self.writing = true;
        Ok(())
    }
    fn next(&mut self, cx: &mut Context<'_>) -> Next {
        if let Some(wire) = self.initial.take() {
            self.send(BTreeMap::from([
                ("event".into(), Value::String("start".into())),
                ("request".into(), wire),
            ]))?;
            cx.waker().wake_by_ref();
            return Poll::Pending;
        }
        // Both lanes get an opportunity; a pending write never prevents audio.
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
                Poll::Ready(Err(error)) => return Poll::Ready(Err(error)),
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
                Poll::Ready(result) => result?,
            }
            self.writing = false;
            return Poll::Ready(Ok(Step::Continue));
        }
        if self.input_done {
            return Poll::Pending;
        }
        let value = match self.input.as_mut().poll_next(cx) {
            Poll::Pending => return Poll::Pending,
            Poll::Ready(Some(Err(error))) => return Poll::Ready(Err(error)),
            Poll::Ready(None) => {
                self.input_done = true;
                self.send(BTreeMap::from([(
                    "event".into(),
                    Value::String("stop".into()),
                )]))?;
                return Poll::Ready(Ok(Step::Continue));
            }
            Poll::Ready(Some(Ok(value))) => value,
        };
        (self.validate)(&value, None)?;
        let fields = match value {
            Input::String(text) => BTreeMap::from([
                ("event".into(), Value::String("text".into())),
                ("text".into(), Value::String(text)),
            ]),
            Input::Flush(_) => BTreeMap::from([("event".into(), Value::String("flush".into()))]),
        };
        self.send(fields)?;
        Poll::Ready(Ok(Step::Continue))
    }
    fn receive(&mut self, cx: &mut Context<'_>) -> Poll<Result<Step, TransportError>> {
        let message = match self.socket.as_mut().poll_receive(cx) {
            Poll::Pending => return Poll::Pending,
            Poll::Ready(None) => {
                return Poll::Ready(Err(failure(
                    "Fish WebSocket closed before session completion",
                )))
            }
            Poll::Ready(Some(result)) => result?,
        };
        Poll::Ready(match protocol::packet(message, self.limit)? {
            Packet::Ignored => Ok(Step::Continue),
            Packet::Audio(bytes) => Ok(Step::Item(SynthesisItem::Bytes(bytes))),
            Packet::Finish if self.input_done => Ok(Step::Done),
            Packet::Finish => Err(failure("Fish finished before the input stream ended")),
        })
    }
}
