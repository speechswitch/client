use super::{
    failure,
    protocol::{self, Packet, Payload},
    settings::Settings,
};
use crate::{
    generated::{
        smallest_ai::TtsRequestLightningV31ProStreamingTextVoice8f1b36fbTextItem as Input,
        smallest_ai_output::*,
    },
    http::TransportError,
    json,
    runtime::{InputStream, StreamingInput, ValidationError},
    sse,
    websocket::{Message, Socket},
};
use std::{
    any::Any,
    collections::BTreeSet,
    fmt::Write,
    pin::Pin,
    task::{Context, Poll},
};
type Validator = Box<dyn Fn(&dyn Any, Option<&str>) -> Result<(), ValidationError> + Send>;
type Next = Poll<Result<Option<SynthesisItem>, TransportError>>;
pub(super) enum Source {
    Whole(Option<String>),
    Text(StreamingInput<String>),
    Commands(StreamingInput<Input>),
}
enum State {
    Http(Http),
    Socket(Live),
}
pub struct Stream {
    state: Option<State>,
}
impl Stream {
    pub(super) fn http(
        body: StreamingInput<Vec<u8>>,
        sse: bool,
        limit: usize,
    ) -> Result<Self, TransportError> {
        Ok(Self {
            state: Some(State::Http(Http {
                body: Some(body),
                decoder: if sse {
                    Some(sse::Decoder::new(limit)?)
                } else {
                    None
                },
                chunk: Vec::new(),
                position: 0,
                audio: false,
                finished: false,
            })),
        })
    }
    pub(super) fn socket(
        socket: Socket,
        source: Source,
        mut settings: Settings,
        prefix: String,
        limit: usize,
        validate: Validator,
    ) -> Self {
        let request_id = settings
            .request_id
            .take()
            .unwrap_or_else(|| format!("{prefix}-0"));
        Self {
            state: Some(State::Socket(Live {
                socket,
                source: Some(source),
                settings,
                prefix,
                request_id,
                sequence: 0,
                stale: BTreeSet::new(),
                limit,
                validate,
                writing: false,
                ended: false,
                sent_text: false,
                audio: false,
                complete: false,
                prefer_output: true,
                buffered: None,
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
            State::Http(v) => v.next(cx),
            State::Socket(v) => v.next(cx),
        };
        match next {
            Poll::Pending => Poll::Pending,
            Poll::Ready(Ok(Some(item))) => Poll::Ready(Some(Ok(item))),
            Poll::Ready(Ok(None)) => {
                s.state = None;
                Poll::Ready(Some(Ok(SynthesisItem::Done(DoneEvent {
                    event: Default::default(),
                }))))
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
    decoder: Option<sse::Decoder>,
    chunk: Vec<u8>,
    position: usize,
    audio: bool,
    finished: bool,
}
impl Http {
    fn next(&mut self, cx: &mut Context<'_>) -> Next {
        if self.finished {
            return Poll::Ready(if self.audio {
                Ok(None)
            } else {
                Err(failure("Smallest.ai returned no audio"))
            });
        }
        if self.position == self.chunk.len() {
            self.chunk = Vec::new();
            self.position = 0;
            match self
                .body
                .as_mut()
                .expect("active HTTP body")
                .as_mut()
                .poll_next(cx)
            {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(Some(Err(e))) => return Poll::Ready(Err(e)),
                Poll::Ready(None) => {
                    self.body = None;
                    if let Some(decoder) = &mut self.decoder {
                        decoder.finish();
                        return Poll::Ready(Err(failure(
                            "Smallest.ai SSE ended before completion",
                        )));
                    }
                    self.finished = true;
                    return self.next(cx);
                }
                Poll::Ready(Some(Ok(bytes))) => {
                    if bytes.is_empty() {
                        cx.waker().wake_by_ref();
                        return Poll::Pending;
                    }
                    if self.decoder.is_none() {
                        self.audio = true;
                        return Poll::Ready(Ok(Some(SynthesisItem::Bytes(bytes))));
                    }
                    self.chunk = bytes;
                }
            }
        }
        let decoder = self.decoder.as_mut().expect("SSE decoder");
        let end = self.chunk.len().min(self.position.saturating_add(8192));
        while self.position < end {
            let byte = self.chunk[self.position];
            self.position += 1;
            if let Some(event) = decoder.push(byte)? {
                let (done, bytes) = protocol::sse(event)?;
                if done {
                    self.finished = true;
                    self.body = None;
                    decoder.finish();
                }
                if !bytes.is_empty() {
                    self.audio = true;
                    return Poll::Ready(Ok(Some(SynthesisItem::Bytes(bytes))));
                }
                if done {
                    return Poll::Ready(if self.audio {
                        Ok(None)
                    } else {
                        Err(failure("Smallest.ai returned no audio"))
                    });
                }
            }
        }
        cx.waker().wake_by_ref();
        Poll::Pending
    }
}
struct Live {
    // Native transport is dropped before the application producer.
    socket: Socket,
    source: Option<Source>,
    settings: Settings,
    prefix: String,
    request_id: String,
    sequence: u64,
    stale: BTreeSet<String>,
    limit: usize,
    validate: Validator,
    writing: bool,
    ended: bool,
    sent_text: bool,
    audio: bool,
    complete: bool,
    prefer_output: bool,
    buffered: Option<Packet>,
}
enum Step {
    Continue,
    Item(SynthesisItem),
    Done,
}
impl Live {
    fn next(&mut self, cx: &mut Context<'_>) -> Next {
        if self.complete {
            if self.writing {
                match self.socket.as_mut().poll_flush(cx) {
                    Poll::Pending => return Poll::Pending,
                    Poll::Ready(Err(e)) => return Poll::Ready(Err(e)),
                    Poll::Ready(Ok(())) => self.writing = false,
                }
            }
            return Poll::Ready(if self.audio {
                Ok(None)
            } else {
                Err(failure("Smallest.ai returned no audio"))
            });
        }
        // Observe output before advancing input, even on input's fairness turn.
        // A paused consumer must not let later EOF relabel buffered native completion.
        if self.buffered.is_none() {
            match self.socket.as_mut().poll_receive(cx) {
                Poll::Pending => {}
                Poll::Ready(Some(Err(e))) => return Poll::Ready(Err(e)),
                Poll::Ready(None) => {
                    return Poll::Ready(Err(failure(if self.settings.continuation.is_some() {
                        "Smallest.ai continuation closed without a context-complete marker"
                    } else {
                        "Smallest.ai WebSocket closed before completion"
                    })))
                }
                Poll::Ready(Some(Ok(message))) => {
                    let Message::Text(text) = message else {
                        return Poll::Ready(Err(failure(
                            "Smallest.ai returned a non-text WebSocket frame",
                        )));
                    };
                    if text.len() > self.limit {
                        return Poll::Ready(Err(failure(
                            "Smallest.ai message exceeds max_message_bytes",
                        )));
                    }
                    let packet = protocol::decode(&text)?;
                    if matches!(packet.payload, Payload::Complete)
                        && self.settings.continuation.is_none()
                        && !self.ended
                    {
                        return Poll::Ready(Err(failure(
                            "Smallest.ai completed before input ended",
                        )));
                    }
                    self.buffered = Some(packet);
                }
            }
        }
        for output in if self.prefer_output {
            [true, false]
        } else {
            [false, true]
        } {
            let step = if output {
                match self.buffered.take() {
                    Some(packet) => Poll::Ready(self.receive(packet)),
                    None => Poll::Pending,
                }
            } else {
                self.input(cx)
            };
            match step {
                Poll::Pending => {}
                Poll::Ready(Err(e)) => return Poll::Ready(Err(e)),
                Poll::Ready(Ok(step)) => {
                    self.prefer_output = !output;
                    return match step {
                        Step::Continue => {
                            cx.waker().wake_by_ref();
                            Poll::Pending
                        }
                        Step::Item(item) => Poll::Ready(Ok(Some(item))),
                        Step::Done => Poll::Ready(Ok(None)),
                    };
                }
            }
        }
        Poll::Pending
    }
    fn receive(&mut self, packet: Packet) -> Result<Step, TransportError> {
        if !self.stale.is_empty() {
            let id = packet
                .external_id
                .as_deref()
                .filter(|v| !v.is_empty())
                .ok_or_else(|| {
                    failure("Smallest.ai omitted external request identity after clear")
                })?;
            if self.stale.contains(id) {
                return Ok(Step::Continue);
            }
            if id != self.request_id {
                return Err(failure(
                    "Smallest.ai returned an unknown external request identity after clear",
                ));
            }
        }
        Ok(match packet.payload {
            Payload::Complete if self.settings.continuation.is_some() => {
                Step::Item(SynthesisItem::Batch(SmallestBatchEvent {
                    event: Default::default(),
                    request_id: packet.request_id,
                }))
            }
            Payload::Complete => {
                self.complete = true;
                Step::Continue
            }
            Payload::Chunk(bytes) => {
                if bytes.is_empty() {
                    Step::Continue
                } else {
                    self.audio = true;
                    Step::Item(if self.settings.timed {
                        SynthesisItem::Ordered(SmallestEnvelope {
                            correlation: Default::default(),
                            correlation_id: packet.request_id,
                            audio: Some(bytes),
                            timestamps: Vec::new(),
                            word_index: None,
                        })
                    } else {
                        SynthesisItem::Bytes(bytes)
                    })
                }
            }
            Payload::Word { index, timestamp } => {
                if self.settings.timed {
                    Step::Item(SynthesisItem::Ordered(SmallestEnvelope {
                        correlation: Default::default(),
                        correlation_id: packet.request_id,
                        audio: None,
                        timestamps: vec![timestamp],
                        word_index: Some(index),
                    }))
                } else {
                    Step::Continue
                }
            }
        })
    }
    fn send(&mut self, text: String, final_input: bool) -> Result<(), TransportError> {
        if text.len() > self.limit {
            return Err(failure("Smallest.ai message exceeds max_message_bytes"));
        }
        if final_input {
            self.ended = true;
        }
        self.socket.as_mut().start_send(Message::Text(text))?;
        self.writing = true;
        Ok(())
    }
    fn input(&mut self, cx: &mut Context<'_>) -> Poll<Result<Step, TransportError>> {
        if self.writing {
            match self.socket.as_mut().poll_flush(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(Err(e)) => return Poll::Ready(Err(e)),
                Poll::Ready(Ok(())) => self.writing = false,
            }
        }
        let whole = matches!(self.source, Some(Source::Whole(_)));
        let next = match &mut self.source {
            None => return Poll::Pending,
            Some(Source::Whole(text)) => Poll::Ready(text.take().map(|v| Ok(Input::String(v)))),
            Some(Source::Text(text)) => match text.as_mut().poll_next(cx) {
                Poll::Ready(Some(Ok(text))) => {
                    (self.validate)(&text, None)?;
                    Poll::Ready(Some(Ok(Input::String(text))))
                }
                Poll::Ready(Some(Err(e))) => Poll::Ready(Some(Err(e))),
                Poll::Ready(None) => Poll::Ready(None),
                Poll::Pending => Poll::Pending,
            },
            Some(Source::Commands(text)) => match text.as_mut().poll_next(cx) {
                Poll::Ready(Some(Ok(item))) => {
                    (self.validate)(&item, None)?;
                    Poll::Ready(Some(Ok(item)))
                }
                other => other,
            },
        };
        let item = match next {
            Poll::Pending => return Poll::Pending,
            Poll::Ready(Some(Err(e))) => return Poll::Ready(Err(e)),
            Poll::Ready(value) => value,
        };
        let item = match item {
            None => {
                self.source = None;
                if !self.sent_text && self.settings.continuation.is_none() {
                    return Poll::Ready(Ok(Step::Done));
                }
                if !whole {
                    let message = if let Some(context) = &self.settings.continuation {
                        let mut message = String::from("{\"context_id\":");
                        json::quote(context, &mut message);
                        message.push_str(",\"voice_id\":");
                        json::quote(&self.settings.voice, &mut message);
                        message.push_str(",\"continue\":false}");
                        message
                    } else {
                        self.text_message("", false)
                    };
                    self.send(message, true)?;
                }
                return Poll::Ready(Ok(Step::Continue));
            }
            Some(item) => item?,
        };
        match item {
            Input::String(text) => {
                if !text.is_empty() {
                    self.sent_text = true;
                    let message = if whole {
                        let mut message = self.settings.wire.clone();
                        message.pop();
                        message.push_str(",\"text\":");
                        json::quote(&text, &mut message);
                        message.push_str(",\"request_id\":");
                        json::quote(&self.request_id, &mut message);
                        message.push('}');
                        message
                    } else {
                        self.text_message(&text, true)
                    };
                    self.send(message, whole)?;
                }
                Poll::Ready(Ok(Step::Continue))
            }
            Input::Clear(_) => {
                let context = self
                    .settings
                    .continuation
                    .as_ref()
                    .expect("generated continuation input");
                let mut message = String::from("{\"context_id\":");
                json::quote(context, &mut message);
                message.push_str(",\"cancel_request\":true}");
                self.stale.insert(self.request_id.clone());
                loop {
                    self.sequence = self
                        .sequence
                        .checked_add(1)
                        .ok_or_else(|| failure("Smallest.ai request identity counter exhausted"))?;
                    self.request_id = format!("{}-{}", self.prefix, self.sequence);
                    if !self.stale.contains(&self.request_id) {
                        break;
                    }
                }
                self.send(message, false)?;
                Poll::Ready(Ok(Step::Item(SynthesisItem::Clear(ClearEvent {
                    event: Default::default(),
                }))))
            }
        }
    }
    fn text_message(&self, text: &str, continued: bool) -> String {
        let mut message = self.settings.wire.clone();
        message.pop();
        message.push_str(",\"text\":");
        json::quote(text, &mut message);
        message.push_str(",\"request_id\":");
        json::quote(&self.request_id, &mut message);
        if let Some(context) = &self.settings.continuation {
            message.push_str(",\"context_id\":");
            json::quote(context, &mut message);
            write!(
                message,
                ",\"continue\":true,\"max_buffer_delay_ms\":{}",
                self.settings.buffer_delay
            )
            .unwrap();
        } else {
            write!(
                message,
                ",\"continue\":{continued},\"max_buffer_flush_ms\":{},\"complete_backoff_ms\":{}",
                self.settings.buffer_delay, self.settings.completion_delay
            )
            .unwrap();
            if !continued {
                message.push_str(",\"flush\":true");
            }
        }
        message.push('}');
        message
    }
}
