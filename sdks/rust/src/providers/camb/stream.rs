use super::{failure, settings::Input};
use crate::{
    clients::camb as wire,
    generated::camb_output::*,
    http::{HttpResponse, TransportError},
    runtime::{InputStream, ValidationError},
    websocket::{Message, Socket},
};
use std::{
    any::Any,
    collections::BTreeSet,
    pin::Pin,
    task::{Context, Poll},
};

type Validator = Box<dyn Fn(&dyn Any, Option<&str>) -> Result<(), ValidationError> + Send>;
enum State {
    Http(HttpStream),
    Socket(SocketStream),
}

/// Owns the body/socket and producer. EOF and failure release them immediately;
/// dropping cancels unfinished work, including between consumer polls.
pub struct Stream {
    state: Option<State>,
}
impl Stream {
    pub(super) fn http(response: HttpResponse, max_error: usize) -> Self {
        Self {
            state: Some(State::Http(HttpStream {
                response,
                max_error,
                error_body: Vec::new(),
            })),
        }
    }
    pub(super) fn socket(
        socket: Socket,
        input: Input,
        timed: bool,
        max_message: usize,
        validate: Validator,
    ) -> Self {
        Self {
            state: Some(State::Socket(SocketStream {
                socket,
                input: Some(input),
                timed,
                max_message,
                validate,
                ready: false,
                writing: true,
                segment: None,
                seen: BTreeSet::new(),
                index: 0,
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
            Poll::Ready(Ok(None)) => {
                stream.state = None;
                Poll::Ready(None)
            }
            Poll::Ready(Ok(Some(item))) => Poll::Ready(Some(Ok(item))),
        }
    }
}
type Next = Poll<Result<Option<SynthesisItem>, TransportError>>;
struct HttpStream {
    response: HttpResponse,
    max_error: usize,
    error_body: Vec<u8>,
}
impl HttpStream {
    fn next(&mut self, cx: &mut Context<'_>) -> Next {
        let failed = !(200..300).contains(&self.response.status);
        match self.response.body.as_mut().poll_next(cx) {
            Poll::Pending => Poll::Pending,
            Poll::Ready(Some(Err(error))) => Poll::Ready(Err(error)),
            Poll::Ready(None) if failed => {
                let text = String::from_utf8_lossy(&self.error_body);
                let text = text.strip_prefix('\u{feff}').unwrap_or(&text).trim();
                Poll::Ready(Err(failure(format!(
                    "CAMB returned HTTP {}: {text}",
                    self.response.status
                ))))
            }
            Poll::Ready(None) => Poll::Ready(Ok(None)),
            Poll::Ready(Some(Ok(bytes))) => {
                if failed {
                    if bytes.len() > self.max_error - self.error_body.len() {
                        return Poll::Ready(Err(failure("CAMB response exceeds max_error_bytes")));
                    }
                    self.error_body.extend(bytes);
                } else if !bytes.is_empty() {
                    return Poll::Ready(Ok(Some(SynthesisItem::Bytes(bytes))));
                }
                cx.waker().wake_by_ref();
                Poll::Pending
            }
        }
    }
}

struct SocketStream {
    // Declaration order releases the native connection before producer cleanup.
    socket: Socket,
    input: Option<Input>,
    timed: bool,
    max_message: usize,
    validate: Validator,
    ready: bool,
    writing: bool,
    segment: Option<i64>,
    seen: BTreeSet<i64>,
    index: u64,
}
impl SocketStream {
    fn next(&mut self, cx: &mut Context<'_>) -> Next {
        // The socket remains readable during a backpressured write. Always give
        // native output priority; only one input chunk can be outstanding.
        match self.socket.as_mut().poll_receive(cx) {
            Poll::Pending => {}
            Poll::Ready(None) => {
                return Poll::Ready(Err(failure(if self.ready {
                    "CAMB closed before session.done"
                } else {
                    "CAMB closed before session.ready"
                })))
            }
            Poll::Ready(Some(Err(error))) => return Poll::Ready(Err(error)),
            Poll::Ready(Some(Ok(frame))) => {
                let size = match &frame {
                    Message::Text(text) => text.len(),
                    Message::Binary(bytes) => bytes.len(),
                };
                if size > self.max_message {
                    return Poll::Ready(Err(failure("CAMB message exceeds max_message_bytes")));
                }
                let message = wire::decode_message(frame)?;
                if !self.ready {
                    match message {
                        wire::ServerMessage::SessionReady(_) => self.ready = true,
                        wire::ServerMessage::SessionError(error) => {
                            return Poll::Ready(Err(failure(format!(
                                "CAMB rejected session: {}",
                                error.error
                            ))))
                        }
                        _ => {
                            return Poll::Ready(Err(failure(
                                "CAMB did not acknowledge the session before sending output",
                            )))
                        }
                    }
                } else {
                    match message {
                        wire::ServerMessage::AudioChunk(bytes) => {
                            let id = self
                                .segment
                                .ok_or_else(|| failure("CAMB returned audio outside a segment"))?;
                            return Poll::Ready(Ok(Some(if self.timed {
                                SynthesisItem::Ordered(SegmentOutput {
                                    correlation: Default::default(),
                                    correlation_id: id.to_string(),
                                    audio: Some(bytes),
                                    timestamps: Vec::new(),
                                })
                            } else {
                                SynthesisItem::Bytes(bytes)
                            })));
                        }
                        wire::ServerMessage::SegmentStart(message) => {
                            if message.segment_id.abs() > 9007199254740991.0 {
                                return Poll::Ready(Err(failure(
                                    "CAMB returned an unsafe segment ID",
                                )));
                            }
                            let id = message.segment_id as i64;
                            if self.segment.is_some() || !self.seen.insert(id) {
                                return Poll::Ready(Err(failure(
                                    "CAMB returned an overlapping or reused segment",
                                )));
                            }
                            self.segment = Some(id);
                            if self.timed {
                                let mut timestamps = Vec::new();
                                for word in message.word_timestamps.flatten().unwrap_or_default() {
                                    let (start, end) = (word.start * 1000.0, word.end * 1000.0);
                                    if !start.is_finite()
                                        || !end.is_finite()
                                        || start < 0.0
                                        || end < start
                                    {
                                        return Poll::Ready(Err(failure(
                                            "CAMB returned invalid word timing",
                                        )));
                                    }
                                    timestamps.push(WordTimestamp {
                                        kind: Default::default(),
                                        value: word.word,
                                        start_time_ms: start,
                                        end_time_ms: end,
                                    });
                                }
                                return Poll::Ready(Ok(Some(SynthesisItem::Ordered(
                                    SegmentOutput {
                                        correlation: Default::default(),
                                        correlation_id: id.to_string(),
                                        audio: None,
                                        timestamps,
                                    },
                                ))));
                            }
                        }
                        wire::ServerMessage::SegmentDone(message) => {
                            if self.segment.map(|id| id as f64) != Some(message.segment_id) {
                                return Poll::Ready(Err(failure(
                                    "CAMB completed an unexpected segment",
                                )));
                            }
                            self.segment = None;
                        }
                        wire::ServerMessage::SegmentSkipped(message) => {
                            return Poll::Ready(Err(failure(format!(
                                "CAMB skipped segment {}: {}",
                                message.segment_id, message.text
                            ))))
                        }
                        wire::ServerMessage::SessionError(message) => {
                            return Poll::Ready(Err(failure(format!(
                                "CAMB synthesis failed: {}",
                                message.error
                            ))))
                        }
                        wire::ServerMessage::SessionReady(_) => {
                            return Poll::Ready(Err(failure(
                                "Unexpected CAMB event: session.ready",
                            )))
                        }
                        wire::ServerMessage::SessionDone(_) => {
                            if self.input.is_some() || self.segment.is_some() {
                                return Poll::Ready(Err(failure(
                                    "CAMB ended an incomplete session",
                                )));
                            }
                            return Poll::Ready(Ok(None));
                        }
                    }
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
        if !self.ready {
            return Poll::Pending;
        }
        let Some(input) = &mut self.input else {
            return Poll::Pending;
        };
        let text = match input {
            Input::Whole(text) => text.take(),
            Input::Streaming(input) => match input.as_mut().poll_next(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(Some(Err(error))) => return Poll::Ready(Err(error)),
                Poll::Ready(None) => None,
                Poll::Ready(Some(Ok(text))) => {
                    (self.validate)(&text, None)?;
                    Some(text)
                }
            },
        };
        let message = match text {
            Some(text) => {
                if self.index > 9007199254740991 {
                    return Poll::Ready(Err(failure(
                        "CAMB text index exceeds the exact integer range",
                    )));
                }
                let index = self.index as f64;
                self.index += 1;
                wire::ClientMessage::TextChunk(wire::TextChunk {
                    type_: "text.chunk".into(),
                    text,
                    index: Some(Some(index)),
                    ..Default::default()
                })
            }
            None => {
                self.input = None;
                wire::ClientMessage::TextDone(wire::TextDone {
                    type_: "text.done".into(),
                    ..Default::default()
                })
            }
        };
        let text = wire::encode_message(&message)?;
        if text.len() > self.max_message {
            return Poll::Ready(Err(failure("CAMB message exceeds max_message_bytes")));
        }
        self.socket.as_mut().start_send(Message::Text(text))?;
        self.writing = true;
        if let Poll::Ready(result) = self.socket.as_mut().poll_flush(cx) {
            result?;
            self.writing = false;
        }
        cx.waker().wake_by_ref();
        Poll::Pending
    }
}
