use super::{
    failure, protocol,
    settings::{replacement_map, Map},
    Input, SynthesisItem,
};
use crate::{
    generated::xai_output::DoneEvent,
    http::TransportError,
    json::{self, Raw},
    runtime::{InputStream, JsonValue, StreamingInput, ValidationError},
    websocket::{Message, Socket},
};
use std::{
    any::Any,
    pin::Pin,
    task::{Context, Poll},
};
type Validator = Box<dyn Fn(&dyn Any, Option<&str>) -> Result<(), ValidationError> + Send>;
type Next = Poll<Result<Option<SynthesisItem>, TransportError>>;
enum State {
    Http(Http),
    Socket(Live),
}
pub struct Stream {
    state: Option<State>,
}
impl Stream {
    pub(super) fn http(body: StreamingInput<Vec<u8>>, timed: bool, limit: usize) -> Self {
        Self {
            state: Some(State::Http(Http {
                body: Some(body),
                timed,
                limit,
                data: Vec::new(),
                received: false,
            })),
        }
    }
    pub(super) fn socket(
        socket: Socket,
        source: StreamingInput<Input>,
        initial: Option<Map>,
        timed: bool,
        limit: usize,
        validate: Validator,
    ) -> Self {
        Self {
            state: Some(State::Socket(Live {
                socket,
                source,
                initial,
                timed,
                limit,
                validate,
                has_text: false,
                flushing: false,
                clearing: false,
                updates: 0,
                writing: false,
                held: None,
                waiting_done: None,
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
        match match state {
            State::Http(v) => v.next(cx),
            State::Socket(v) => v.next(cx),
        } {
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
struct Http {
    body: Option<StreamingInput<Vec<u8>>>,
    timed: bool,
    limit: usize,
    data: Vec<u8>,
    received: bool,
}
impl Http {
    fn next(&mut self, cx: &mut Context<'_>) -> Next {
        let Some(body) = &mut self.body else {
            return Poll::Ready(Ok(None));
        };
        for _ in 0..128 {
            match body.as_mut().poll_next(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(Some(Err(error))) => return Poll::Ready(Err(error)),
                Poll::Ready(Some(Ok(bytes))) => {
                    if self.timed {
                        if bytes.len() > self.limit - self.data.len() {
                            return Poll::Ready(Err(failure(
                                "xAI response exceeds max_response_bytes",
                            )));
                        }
                        self.data.extend(bytes);
                    } else if !bytes.is_empty() {
                        self.received = true;
                        return Poll::Ready(Ok(Some(SynthesisItem::Bytes(bytes))));
                    }
                }
                Poll::Ready(None) => {
                    self.body = None;
                    return Poll::Ready(if self.timed {
                        let text = std::str::from_utf8(&self.data)
                            .map_err(|_| failure("Invalid xAI JSON"))?;
                        let raw = Raw::parse_exact(text.strip_prefix('\u{feff}').unwrap_or(text))
                            .map_err(|_| failure("Invalid xAI JSON"))?;
                        let fields = raw.object().map_err(|_| failure("Invalid xAI JSON"))?;
                        Ok(Some(SynthesisItem::Chunk(protocol::audio(
                            &fields, "audio", "duration",
                        )?)))
                    } else if self.received {
                        Ok(None)
                    } else {
                        Err(failure("xAI returned no audio bytes"))
                    });
                }
            }
        }
        cx.waker().wake_by_ref();
        Poll::Pending
    }
}
enum Held {
    Item(Input),
    Eof,
}
enum Step {
    Progress,
    Item(SynthesisItem),
}
struct Live {
    // Release native I/O before dropping the application producer.
    socket: Socket,
    source: StreamingInput<Input>,
    initial: Option<Map>,
    timed: bool,
    limit: usize,
    validate: Validator,
    has_text: bool,
    flushing: bool,
    clearing: bool,
    updates: usize,
    writing: bool,
    held: Option<Held>,
    // A completion received during a pending write cannot hide a write failure.
    waiting_done: Option<DoneEvent>,
    input_done: bool,
    prefer_output: bool,
}
impl Live {
    fn send(
        &mut self,
        kind: &str,
        payload: Option<(&str, JsonValue)>,
    ) -> Result<(), TransportError> {
        let mut wire = Map::from([("type".into(), JsonValue::String(kind.into()))]);
        if let Some((key, value)) = payload {
            wire.insert(key.into(), value);
        }
        let mut text = String::new();
        json::write(&JsonValue::Object(wire), &mut text)?;
        if text.len() > self.limit {
            return Err(failure("xAI message exceeds max_message_bytes"));
        }
        self.socket.as_mut().start_send(Message::Text(text))?;
        self.writing = true;
        Ok(())
    }
    fn update(&mut self, map: Map) -> Result<(), TransportError> {
        let count = self
            .updates
            .checked_add(1)
            .ok_or_else(|| failure("xAI update count exhausted"))?;
        self.send("session.update", Some(("replace", JsonValue::Object(map))))?;
        self.updates = count;
        Ok(())
    }
    fn flush(&mut self) -> Result<(), TransportError> {
        if self.has_text {
            self.send("text.done", None)?;
            self.has_text = false;
            self.flushing = true;
        }
        Ok(())
    }
    fn produce(&mut self, cx: &mut Context<'_>) -> Poll<Result<Step, TransportError>> {
        if self.writing {
            return Poll::Pending;
        }
        if let Some(map) = self.initial.take() {
            self.update(map)?;
            return Poll::Ready(Ok(Step::Progress));
        }
        if self.input_done {
            return Poll::Pending;
        }
        let item = if self.held.is_some() {
            if self.flushing || self.clearing {
                return Poll::Pending;
            }
            self.held.take().expect("held input")
        } else {
            match self.source.as_mut().poll_next(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(None) => Held::Eof,
                Poll::Ready(Some(item)) => {
                    let item = item?;
                    (self.validate)(&item, Some("text"))?;
                    Held::Item(item)
                }
            }
        };
        if self.clearing
            || self.flushing
                && matches!(
                    item,
                    Held::Eof | Held::Item(Input::String(_) | Input::Flush(_))
                )
        {
            self.held = Some(item);
            return Poll::Ready(Ok(Step::Progress));
        }
        match item {
            Held::Eof => {
                self.input_done = true;
                self.flush()?;
            }
            Held::Item(Input::String(text)) => {
                // The upstream cap is per delta, not the lifetime of an iterator.
                if text.chars().count() > 15000 {
                    return Poll::Ready(Err(failure(
                        "xAI text.delta exceeds 15000 Unicode code points",
                    )));
                }
                if !text.is_empty() {
                    self.send("text.delta", Some(("delta", JsonValue::String(text))))?;
                    self.has_text = true;
                }
            }
            Held::Item(Input::Update(item)) => self.update(replacement_map(item.replacements)?)?,
            Held::Item(Input::Flush(_)) => self.flush()?,
            Held::Item(Input::Clear(_)) => {
                self.send("text.clear", None)?;
                self.clearing = true;
                self.has_text = false;
            }
        }
        Poll::Ready(Ok(Step::Progress))
    }
    fn receive(&mut self, cx: &mut Context<'_>) -> Poll<Result<Step, TransportError>> {
        if self.waiting_done.is_some() {
            return Poll::Pending;
        }
        let message = match self.socket.as_mut().poll_receive(cx) {
            Poll::Pending => return Poll::Pending,
            Poll::Ready(None) => {
                return Poll::Ready(Err(failure("xAI socket closed before synthesis completed")))
            }
            Poll::Ready(Some(message)) => message?,
        };
        let item = protocol::decode(message, self.limit)?;
        match item {
            SynthesisItem::Chunk(chunk) => {
                if self.clearing {
                    return Poll::Ready(Ok(Step::Progress));
                }
                if !self.has_text && !self.flushing {
                    return Poll::Ready(Err(failure(
                        "xAI returned audio without an active utterance",
                    )));
                }
                return Poll::Ready(Ok(Step::Item(if self.timed {
                    SynthesisItem::Chunk(chunk)
                } else {
                    SynthesisItem::Bytes(chunk.audio)
                })));
            }
            SynthesisItem::Clear(_) => {
                if !self.clearing {
                    return Poll::Ready(Err(failure("Unexpected xAI audio.clear acknowledgement")));
                }
                self.clearing = false;
                self.flushing = false;
            }
            SynthesisItem::Done(done) => {
                if self.clearing {
                    return Poll::Ready(Ok(Step::Progress));
                }
                if !self.flushing {
                    return Poll::Ready(Err(failure("Unexpected xAI audio.done acknowledgement")));
                }
                self.flushing = false;
                if self.writing {
                    self.waiting_done = Some(done);
                    return Poll::Ready(Ok(Step::Progress));
                }
                return Poll::Ready(Ok(Step::Item(SynthesisItem::Done(done))));
            }
            SynthesisItem::Updated(_) => {
                if self.updates == 0 {
                    return Poll::Ready(Err(failure(
                        "Unexpected xAI session.updated acknowledgement",
                    )));
                }
                self.updates -= 1;
            }
            SynthesisItem::Bytes(_) => unreachable!("wire decoder returns chunk envelopes"),
        }
        Poll::Ready(Ok(Step::Item(item)))
    }
    fn next(&mut self, cx: &mut Context<'_>) -> Next {
        for _ in 0..128 {
            if self.writing {
                match self.socket.as_mut().poll_flush(cx) {
                    Poll::Pending => {}
                    Poll::Ready(result) => {
                        result?;
                        self.writing = false;
                    }
                }
            }
            if !self.writing {
                if let Some(done) = self.waiting_done.take() {
                    return Poll::Ready(Ok(Some(SynthesisItem::Done(done))));
                }
            }
            if self.input_done
                && !self.has_text
                && !self.flushing
                && !self.clearing
                && self.updates == 0
                && !self.writing
            {
                return Poll::Ready(Ok(None));
            }
            let output_first = self.prefer_output;
            self.prefer_output = !output_first;
            let first = if output_first {
                self.receive(cx)
            } else {
                self.produce(cx)
            };
            let step = if first.is_pending() {
                if output_first {
                    self.produce(cx)
                } else {
                    self.receive(cx)
                }
            } else {
                first
            };
            match step {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(Err(error)) => return Poll::Ready(Err(error)),
                Poll::Ready(Ok(Step::Progress)) => {}
                Poll::Ready(Ok(Step::Item(item))) => return Poll::Ready(Ok(Some(item))),
            }
        }
        cx.waker().wake_by_ref();
        Poll::Pending
    }
}
