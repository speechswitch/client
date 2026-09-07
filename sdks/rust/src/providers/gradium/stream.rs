use super::{
    protocol::{self, failure, Packet, TextBuffer},
    Input,
};
use crate::{
    generated::{gradium::TtsRequestText, gradium_output::SynthesisItem},
    http::TransportError,
    json,
    runtime::{InputStream, JsonValue, StreamingInput, ValidationError},
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

/// Owns all I/O and input. EOF/error release them immediately; Drop cancels even
/// unread streams. Transports and producer destructors must release nonblockingly.
pub struct Stream {
    state: Option<State>,
}
impl Stream {
    pub(super) fn http(body: StreamingInput<Vec<u8>>, timed: bool, limit: usize) -> Self {
        Self {
            state: Some(State::Http(HttpStream {
                body,
                timed,
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
        text: TtsRequestText,
        setup: BTreeMap<String, JsonValue>,
        timed: bool,
        limit: usize,
        validate: Validator,
    ) -> Self {
        Self {
            state: Some(State::Socket(SocketStream {
                socket,
                text,
                initial: Some(setup),
                timed,
                limit,
                validate,
                buffer: TextBuffer {
                    pending: String::new(),
                    limit,
                },
                ready: false,
                writing: false,
                finishing: false,
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
    timed: bool,
    limit: usize,
    first: bool,
    ended: bool,
    line: Vec<u8>,
    pending: std::vec::IntoIter<u8>,
}
impl HttpStream {
    fn line(&mut self) -> Result<Packet, TransportError> {
        let data = std::mem::take(&mut self.line);
        let line = if self.first {
            data.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&data)
        } else {
            &data
        };
        self.first = false;
        let text =
            std::str::from_utf8(line).map_err(|_| failure("Gradium returned invalid UTF-8"))?;
        if text.trim().is_empty() {
            return Ok(Packet::Ignored);
        }
        protocol::packet(text, true)
    }
    fn next(&mut self, cx: &mut Context<'_>) -> Next {
        for _ in 0..4096 {
            let packet = if let Some(byte) = self.pending.next() {
                if byte != b'\n' {
                    if self.line.len() == self.limit {
                        return Poll::Ready(Err(failure(
                            "Gradium JSON line exceeds max_json_bytes",
                        )));
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
                    Poll::Ready(Some(Err(error))) => return Poll::Ready(Err(error)),
                    Poll::Ready(Some(Ok(bytes))) => {
                        if bytes.is_empty() {
                            cx.waker().wake_by_ref();
                            return Poll::Pending;
                        }
                        if !self.timed {
                            return Poll::Ready(Ok(Some(SynthesisItem::Bytes(bytes))));
                        }
                        self.pending = bytes.into_iter();
                        continue;
                    }
                }
            };
            match packet {
                Packet::End => return Poll::Ready(Ok(None)),
                Packet::Item(item) => return Poll::Ready(Ok(Some(item))),
                Packet::Ready | Packet::Ignored => {}
            }
        }
        cx.waker().wake_by_ref();
        Poll::Pending
    }
}

struct SocketStream {
    // Field drop order releases the network before producer cleanup.
    socket: Socket,
    text: TtsRequestText,
    initial: Option<BTreeMap<String, JsonValue>>,
    timed: bool,
    limit: usize,
    validate: Validator,
    buffer: TextBuffer,
    ready: bool,
    writing: bool,
    finishing: bool,
    input_done: bool,
    prefer_output: bool,
}
enum Step {
    Continue,
    Item(SynthesisItem),
    Done,
}
impl SocketStream {
    fn send(&mut self, fields: BTreeMap<String, JsonValue>) -> Result<(), TransportError> {
        let mut data = String::new();
        json::write(&JsonValue::Object(fields), &mut data)?;
        if data.len() > self.limit {
            return Err(failure("Gradium message exceeds max_message_bytes"));
        }
        self.socket.as_mut().start_send(Message::Text(data))?;
        self.writing = true;
        Ok(())
    }
    fn send_text(&mut self, text: String) -> Result<(), TransportError> {
        self.send(BTreeMap::from([
            ("type".into(), JsonValue::String("text".into())),
            ("text".into(), JsonValue::String(text)),
        ]))
    }
    fn end_input(&mut self) -> Result<(), TransportError> {
        // EOS acknowledgement may arrive while its write is still draining.
        self.input_done = true;
        self.send(BTreeMap::from([(
            "type".into(),
            JsonValue::String("end_of_stream".into()),
        )]))
    }
    fn next(&mut self, cx: &mut Context<'_>) -> Next {
        if let Some(setup) = self.initial.take() {
            self.send(setup)?;
            cx.waker().wake_by_ref();
            return Poll::Pending;
        }
        // Give both lanes an opportunity, including when a write is stalled.
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
        if self.finishing {
            self.end_input()?;
            return Poll::Ready(Ok(Step::Continue));
        }
        let value = match &mut self.text {
            TtsRequestText::String(text) => {
                let text = std::mem::take(text);
                self.finishing = true;
                if text.is_empty() {
                    self.end_input()?;
                } else {
                    self.send_text(text)?;
                }
                return Poll::Ready(Ok(Step::Continue));
            }
            TtsRequestText::AsyncIterable(input) => match input.as_mut().poll_next(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(Some(Err(error))) => return Poll::Ready(Err(error)),
                Poll::Ready(None) => {
                    self.finishing = true;
                    let text = std::mem::take(&mut self.buffer.pending);
                    if text.is_empty() {
                        self.end_input()?;
                    } else {
                        self.send_text(text)?;
                    }
                    return Poll::Ready(Ok(Step::Continue));
                }
                Poll::Ready(Some(Ok(value))) => value,
            },
        };
        (self.validate)(&value, None)?;
        let text = match value {
            Input::String(text) => self.buffer.push(&text)?,
            Input::Flush(_) => format!("{} <flush>", std::mem::take(&mut self.buffer.pending)),
        };
        if !text.is_empty() {
            self.send_text(text)?;
        }
        Poll::Ready(Ok(Step::Continue))
    }
    fn receive(&mut self, cx: &mut Context<'_>) -> Poll<Result<Step, TransportError>> {
        let message = match self.socket.as_mut().poll_receive(cx) {
            Poll::Pending => return Poll::Pending,
            Poll::Ready(None) => {
                return Poll::Ready(Err(failure(
                    "Gradium WebSocket closed before end_of_stream",
                )))
            }
            Poll::Ready(Some(result)) => result?,
        };
        let Message::Text(data) = message else {
            return Poll::Ready(Err(failure("Gradium returned a non-text WebSocket frame")));
        };
        if data.len() > self.limit {
            return Poll::Ready(Err(failure("Gradium message exceeds max_message_bytes")));
        }
        let packet = protocol::packet(&data, self.timed)?;
        if let Packet::Ready = packet {
            if self.ready {
                return Poll::Ready(Err(failure("Gradium returned duplicate ready")));
            }
            self.ready = true;
            return Poll::Ready(Ok(Step::Continue));
        }
        if !self.ready {
            return Poll::Ready(Err(failure("Gradium returned output before ready")));
        }
        Poll::Ready(match packet {
            Packet::Ready => unreachable!(),
            Packet::Ignored => Ok(Step::Continue),
            Packet::Item(item) => Ok(Step::Item(item)),
            Packet::End if self.input_done => Ok(Step::Done),
            Packet::End => Err(failure("Gradium completed before the input stream ended")),
        })
    }
}
