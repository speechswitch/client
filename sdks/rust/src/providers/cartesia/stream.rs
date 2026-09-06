use super::{
    protocol::{self, failure, Packet},
    settings::Input,
    ContextIds,
};
use crate::{
    generated::cartesia_output::*,
    http::{HttpResponse, TransportError},
    json,
    runtime::{InputStream, StreamingInput, ValidationError},
    sse,
    websocket::{Message, Socket},
};
use std::{
    any::Any,
    collections::BTreeSet,
    pin::Pin,
    task::{Context, Poll},
};

type Validator = Box<dyn Fn(&dyn Any, Option<&str>) -> Result<(), ValidationError> + Send>;
type Next = Poll<Result<Option<SynthesisItem>, TransportError>>;
enum State {
    Http(HttpStream),
    Socket(SocketStream),
}
/// Owned body/socket and input. Drop cancels without another poll; failures and
/// completion immediately release resources and are terminal.
pub struct Stream {
    state: Option<State>,
}
impl Stream {
    pub(super) fn http(
        response: HttpResponse,
        id: Option<String>,
        max_json: usize,
        max_event: usize,
    ) -> Result<Self, TransportError> {
        Ok(Self {
            state: Some(State::Http(HttpStream {
                response,
                id,
                max_json,
                error_body: Vec::new(),
                decoder: sse::Decoder::new(max_event)?,
                pending: Vec::new(),
                position: 0,
            })),
        })
    }
    pub(super) fn socket(
        socket: Socket,
        input: StreamingInput<Input>,
        settings: String,
        timed: bool,
        ids: ContextIds,
        max_message: usize,
        validate: Validator,
    ) -> Self {
        Self {
            state: Some(State::Socket(SocketStream {
                socket,
                input: Some(input),
                settings,
                timed,
                ids,
                max_message,
                validate,
                writing: false,
                used: false,
                prefer_output: true,
                retired: BTreeSet::new(),
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
        let next = match state {
            State::Http(s) => s.next(cx),
            State::Socket(s) => s.next(cx),
        };
        match next {
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
    response: HttpResponse,
    id: Option<String>,
    max_json: usize,
    error_body: Vec<u8>,
    decoder: sse::Decoder,
    pending: Vec<u8>,
    position: usize,
}
impl HttpStream {
    fn next(&mut self, cx: &mut Context<'_>) -> Next {
        let failed = !(200..300).contains(&self.response.status);
        if self.position == self.pending.len() {
            self.pending = Vec::new();
            self.position = 0;
            match self.response.body.as_mut().poll_next(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(Some(Err(error))) => return Poll::Ready(Err(error)),
                Poll::Ready(None) => {
                    return Poll::Ready(if failed {
                        let text = String::from_utf8_lossy(&self.error_body);
                        let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
                        Err(Box::new(protocol::response_error(
                            text,
                            self.response.status as f64,
                        )))
                    } else if self.id.is_some() {
                        Err(failure("Cartesia SSE ended before the done event"))
                    } else {
                        Ok(None)
                    })
                }
                Poll::Ready(Some(Ok(bytes))) => {
                    if failed {
                        if bytes.len() > self.max_json - self.error_body.len() {
                            return Poll::Ready(Err(failure(
                                "Cartesia response exceeds max_json_bytes",
                            )));
                        }
                        self.error_body.extend(bytes);
                        cx.waker().wake_by_ref();
                        return Poll::Pending;
                    }
                    if bytes.is_empty() {
                        cx.waker().wake_by_ref();
                        return Poll::Pending;
                    }
                    if self.id.is_none() {
                        return Poll::Ready(Ok(Some(SynthesisItem::Bytes(bytes))));
                    }
                    self.pending = bytes;
                }
            }
        }
        while self.position < self.pending.len() {
            let event = self.decoder.push(self.pending[self.position])?;
            self.position += 1;
            if let Some(event) = event {
                let packet = protocol::decode(&event.data, false)?;
                let id = self
                    .id
                    .as_deref()
                    .expect("SSE context resolved at boundary");
                if packet.context().id.as_deref().is_some_and(|v| v != id) {
                    return Poll::Ready(Err(failure(
                        "Cartesia SSE returned an unexpected context",
                    )));
                }
                return Poll::Ready(protocol::output(packet, id, true));
            }
        }
        cx.waker().wake_by_ref();
        Poll::Pending
    }
}
struct SocketStream {
    // Drop native network ownership before releasing an unfinished producer.
    socket: Socket,
    input: Option<StreamingInput<Input>>,
    settings: String,
    timed: bool,
    ids: ContextIds,
    max_message: usize,
    validate: Validator,
    writing: bool,
    used: bool,
    prefer_output: bool,
    retired: BTreeSet<String>,
}
impl SocketStream {
    fn next(&mut self, cx: &mut Context<'_>) -> Next {
        // Poll both independent lanes when one is pending; alternate after a
        // ready event so sustained audio cannot starve barge-in or write errors.
        let lanes = if self.prefer_output {
            [true, false]
        } else {
            [false, true]
        };
        for output in lanes {
            let result = if output {
                self.receive(cx)
            } else {
                self.input(cx)
            };
            match result {
                Poll::Pending => {}
                Poll::Ready(Ok(Step::Continue)) => {
                    self.prefer_output = !output;
                    cx.waker().wake_by_ref();
                    return Poll::Pending;
                }
                Poll::Ready(Ok(Step::Item(item))) => {
                    self.prefer_output = !output;
                    return Poll::Ready(Ok(Some(item)));
                }
                Poll::Ready(Ok(Step::Done)) => return Poll::Ready(Ok(None)),
                Poll::Ready(Err(error)) => return Poll::Ready(Err(error)),
            }
        }
        Poll::Pending
    }
    fn send(&mut self, text: String) -> Result<(), TransportError> {
        if text.len() > self.max_message {
            return Err(failure("Cartesia message exceeds max_message_bytes"));
        }
        self.socket.as_mut().start_send(Message::Text(text))?;
        self.writing = true;
        Ok(())
    }
    fn generation(&self, text: &str, continued: bool, flush: bool) -> String {
        let mut value = self.settings.clone();
        value.pop();
        value.push_str(",\"context_id\":");
        json::quote(&self.ids.current, &mut value);
        value.push_str(",\"transcript\":");
        json::quote(text, &mut value);
        value.push_str(&format!(",\"continue\":{continued},\"flush\":{flush}}}"));
        value
    }
    fn rotate(&mut self) -> Result<(), TransportError> {
        self.retired.insert(self.ids.current.clone());
        self.ids.advance()?;
        self.used = false;
        Ok(())
    }
    fn receive(&mut self, cx: &mut Context<'_>) -> Poll<Result<Step, TransportError>> {
        let packet = match self.socket.as_mut().poll_receive(cx) {
            Poll::Pending => return Poll::Pending,
            Poll::Ready(None) => return Poll::Ready(Err(failure(
                "Cartesia WebSocket closed before context completion (idle connections expire after five minutes)",
            ))),
            Poll::Ready(Some(Err(error))) => return Poll::Ready(Err(error)),
            Poll::Ready(Some(Ok(Message::Binary(_)))) => return Poll::Ready(Err(failure(
                "Cartesia returned a non-text frame",
            ))),
            Poll::Ready(Some(Ok(Message::Text(text)))) => {
                if text.len() > self.max_message {
                    return Poll::Ready(Err(failure("Cartesia message exceeds max_message_bytes")));
                }
                protocol::decode(&text, true)?
            }
        };
        if let Some(id) = &packet.context().id {
            if self.retired.contains(id) {
                return Poll::Ready(Ok(Step::Continue));
            }
            if id != &self.ids.current {
                return Poll::Ready(Err(failure(
                    "Cartesia returned output for an unexpected context",
                )));
            }
        }
        if matches!(&packet, Packet::Done(_)) {
            if self.input.is_none() {
                return Poll::Ready(Ok(Step::Done));
            }
            self.rotate()?;
            return Poll::Ready(Ok(Step::Continue));
        }
        Poll::Ready(Ok(
            match protocol::output(packet, &self.ids.current, self.timed)? {
                Some(item) => Step::Item(item),
                None => Step::Continue,
            },
        ))
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
        let Some(input) = &mut self.input else {
            return Poll::Pending;
        };
        let value = match input.as_mut().poll_next(cx) {
            Poll::Pending => return Poll::Pending,
            Poll::Ready(Some(Err(error))) => return Poll::Ready(Err(error)),
            Poll::Ready(None) => {
                self.input = None;
                if !self.used {
                    return Poll::Ready(Ok(Step::Done));
                }
                self.send(self.generation("", false, false))?;
                return Poll::Ready(Ok(Step::Continue));
            }
            Poll::Ready(Some(Ok(value))) => value,
        };
        (self.validate)(&value, None)?;
        match value {
            Input::String(text) => {
                if !text.is_empty() {
                    self.used = true;
                    self.send(self.generation(&text, true, false))?;
                }
            }
            Input::Flush(_) => {
                if self.used {
                    self.send(self.generation("", true, true))?;
                }
            }
            Input::Clear(_) => {
                if self.used {
                    let mut value = String::from("{\"context_id\":");
                    json::quote(&self.ids.current, &mut value);
                    value.push_str(",\"cancel\":true}");
                    self.send(value)?;
                }
                self.rotate()?;
                return Poll::Ready(Ok(Step::Item(SynthesisItem::Clear(SynthesisItemClear {
                    event: Default::default(),
                }))));
            }
        }
        Poll::Ready(Ok(Step::Continue))
    }
}
enum Step {
    Continue,
    Item(SynthesisItem),
    Done,
}
