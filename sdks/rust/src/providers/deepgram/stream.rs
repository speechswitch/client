use super::{failure, settings::Input};
use crate::{
    generated::deepgram_output::*,
    http::TransportError,
    json::{self, Raw},
    runtime::{InputStream, StreamingInput, ValidationError},
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
    Http {
        body: StreamingInput<Vec<u8>>,
        received: bool,
    },
    Socket(SocketStream),
}
/// Owns the transport and producer. EOF/error drops both immediately and is
/// terminal; dropping an unread or partially consumed stream also cancels both.
pub struct Stream {
    state: Option<State>,
}
impl Stream {
    pub(super) fn http(body: StreamingInput<Vec<u8>>) -> Self {
        Self {
            state: Some(State::Http {
                body,
                received: false,
            }),
        }
    }
    pub(super) fn socket(
        socket: Socket,
        input: StreamingInput<Input>,
        max_message: usize,
        validate: Validator,
    ) -> Self {
        Self {
            state: Some(State::Socket(SocketStream {
                socket,
                input: Some(input),
                held: None,
                validate,
                max_message,
                writing: false,
                closing: false,
                has_text: false,
                flushing: false,
                clearing: false,
                prefer_output: true,
                trace: None,
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
            State::Socket(socket) => socket.next(cx),
            State::Http { body, received } => match body.as_mut().poll_next(cx) {
                Poll::Pending => Poll::Pending,
                Poll::Ready(Some(Err(error))) => Poll::Ready(Err(error)),
                Poll::Ready(Some(Ok(bytes))) if bytes.is_empty() => {
                    cx.waker().wake_by_ref();
                    Poll::Pending
                }
                Poll::Ready(Some(Ok(bytes))) => {
                    *received = true;
                    Poll::Ready(Ok(Some(SynthesisItem::Bytes(bytes))))
                }
                Poll::Ready(None) if *received => Poll::Ready(Ok(None)),
                Poll::Ready(None) => {
                    Poll::Ready(Err(failure("Deepgram returned an empty audio response")))
                }
            },
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
struct SocketStream {
    // Release the native connection before the unfinished producer.
    socket: Socket,
    input: Option<StreamingInput<Input>>,
    held: Option<Input>,
    validate: Validator,
    max_message: usize,
    writing: bool,
    closing: bool,
    has_text: bool,
    flushing: bool,
    clearing: bool,
    prefer_output: bool,
    trace: Option<String>,
}
enum Step {
    Continue,
    Item(SynthesisItem),
    Done,
}
impl SocketStream {
    fn next(&mut self, cx: &mut Context<'_>) -> Next {
        // Alternation keeps input controls/write errors live during sustained
        // audio. A pending write must never block the independent read lane.
        for output in if self.prefer_output {
            [true, false]
        } else {
            [false, true]
        } {
            let result = if output {
                self.receive(cx)
            } else {
                self.input(cx)
            };
            match result {
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
    fn send(&mut self, text: String) -> Result<(), TransportError> {
        if text.len() > self.max_message {
            return Err(failure("Deepgram message exceeds max_message_bytes"));
        }
        self.socket.as_mut().start_send(Message::Text(text))?;
        self.writing = true;
        Ok(())
    }
    fn input(&mut self, cx: &mut Context<'_>) -> Poll<Result<Step, TransportError>> {
        if self.writing {
            match self.socket.as_mut().poll_flush(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(result) => result?,
            }
            self.writing = false;
            return Poll::Ready(Ok(if self.closing {
                Step::Done
            } else {
                Step::Continue
            }));
        }
        if self.clearing {
            return Poll::Pending;
        }
        if self.held.is_none() {
            if let Some(input) = &mut self.input {
                match input.as_mut().poll_next(cx) {
                    Poll::Pending => return Poll::Pending,
                    Poll::Ready(Some(Err(error))) => return Poll::Ready(Err(error)),
                    Poll::Ready(Some(Ok(value))) => {
                        (self.validate)(&value, None)?;
                        self.held = Some(value);
                    }
                    Poll::Ready(None) => self.input = None,
                }
            }
        }
        // One held item preserves source ordering/backpressure while permitting
        // a clear immediately after flush to interrupt that outstanding flush.
        if self.flushing && !matches!(&self.held, Some(Input::Clear(_))) {
            return Poll::Pending;
        }
        match self.held.take() {
            Some(Input::String(text)) => {
                if !text.is_empty() {
                    let mut message = String::from("{\"type\":\"Speak\",\"text\":");
                    json::quote(&text, &mut message);
                    message.push('}');
                    self.has_text = true;
                    self.send(message)?;
                }
            }
            Some(Input::Clear(_)) => {
                self.has_text = false;
                self.clearing = true;
                self.send(r#"{"type":"Clear"}"#.into())?;
            }
            Some(Input::Flush(_)) => {
                if self.has_text {
                    self.has_text = false;
                    self.flushing = true;
                    self.send(r#"{"type":"Flush"}"#.into())?;
                }
            }
            None => {
                if self.has_text {
                    self.has_text = false;
                    self.flushing = true;
                    self.send(r#"{"type":"Flush"}"#.into())?;
                } else {
                    self.closing = true;
                    self.send(r#"{"type":"Close"}"#.into())?;
                }
            }
        }
        Poll::Ready(Ok(Step::Continue))
    }
    fn receive(&mut self, cx: &mut Context<'_>) -> Poll<Result<Step, TransportError>> {
        let message = match self.socket.as_mut().poll_receive(cx) {
            Poll::Pending => return Poll::Pending,
            Poll::Ready(Some(Err(error))) => return Poll::Ready(Err(error)),
            Poll::Ready(None) if self.closing => return Poll::Ready(Ok(Step::Done)),
            Poll::Ready(None) => {
                return Poll::Ready(Err(failure(
                    "Deepgram WebSocket closed before input completion",
                )))
            }
            Poll::Ready(Some(Ok(message))) => message,
        };
        let text = match message {
            Message::Binary(bytes) => {
                if bytes.len() > self.max_message {
                    return Poll::Ready(Err(failure("Deepgram message exceeds max_message_bytes")));
                }
                return Poll::Ready(Ok(if self.clearing || bytes.is_empty() {
                    Step::Continue
                } else {
                    Step::Item(SynthesisItem::Bytes(bytes))
                }));
            }
            Message::Text(text) => text,
        };
        if text.len() > self.max_message {
            return Poll::Ready(Err(failure("Deepgram message exceeds max_message_bytes")));
        }
        let raw = Raw::parse_exact(&text).map_err(|_| failure("Deepgram returned invalid JSON"))?;
        let value = raw
            .object()
            .map_err(|_| failure("Deepgram returned an invalid WebSocket event"))?;
        let kind = value.get("type").and_then(|v| v.string().ok());
        match kind.as_deref() {
            Some(kind @ ("Warning" | "Error")) => {
                let code = value.get("code").and_then(|v| v.string().ok());
                let description = value.get("description").and_then(|v| v.string().ok());
                let (Some(code), Some(description)) = (code, description) else {
                    return Poll::Ready(Err(failure("Deepgram returned an invalid error event")));
                };
                Poll::Ready(Err(Box::new(std::io::Error::other(format!(
                    "Deepgram {kind} {code}: {description}"
                )))))
            }
            Some("Metadata") => {
                self.trace = Some(
                    value
                        .get("request_id")
                        .and_then(|v| v.string().ok())
                        .ok_or_else(|| failure("Deepgram returned an invalid WebSocket event"))?,
                );
                Poll::Ready(Ok(Step::Continue))
            }
            Some(kind @ ("Flushed" | "Cleared")) => {
                let sequence = value
                    .get("sequence_id")
                    .and_then(|v| v.number().ok())
                    .filter(|v| {
                        v.is_finite() && *v >= 0.0 && *v <= 9007199254740991.0 && v.fract() == 0.0
                    })
                    .ok_or_else(|| failure("Deepgram returned an invalid WebSocket event"))?;
                if kind == "Cleared" {
                    if !self.clearing {
                        return Poll::Ready(Err(failure(
                            "Deepgram returned an unexpected Cleared acknowledgement",
                        )));
                    }
                    self.clearing = false;
                    self.flushing = false;
                    Poll::Ready(Ok(Step::Item(SynthesisItem::Clear(ClearEvent {
                        event: Default::default(),
                        sequence_id: sequence,
                    }))))
                } else if self.clearing {
                    Poll::Ready(Ok(Step::Continue))
                } else {
                    if !self.flushing {
                        return Poll::Ready(Err(failure(
                            "Deepgram returned an unexpected Flushed acknowledgement",
                        )));
                    }
                    self.flushing = false;
                    Poll::Ready(Ok(Step::Item(SynthesisItem::Done(DoneEvent {
                        event: Default::default(),
                        sequence_id: sequence,
                        trace_id: self.trace.clone(),
                    }))))
                }
            }
            _ => Poll::Ready(Err(failure("Deepgram returned an invalid WebSocket event"))),
        }
    }
}
