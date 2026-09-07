use super::{
    failure,
    protocol::{self, Payload},
    settings::{Map, Settings},
    Input, SynthesisItem,
};
use crate::{
    generated::{voice_ai::TtsRequestObject1ec54d36Text as Text, voice_ai_output::*},
    http::TransportError,
    json,
    runtime::{InputStream, JsonValue, StreamingInput, ValidationError},
    websocket::{Message, Socket},
};
use std::{
    any::Any,
    collections::{BTreeMap, BTreeSet, VecDeque},
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
    pub(super) fn http(body: StreamingInput<Vec<u8>>) -> Self {
        Self {
            state: Some(State::Http(Http { body, audio: false })),
        }
    }
    pub(super) fn socket(
        socket: Socket,
        settings: Settings,
        prefix: String,
        limit: usize,
        validate: Validator,
    ) -> Self {
        let source = match settings.text {
            Text::String(text) => Source::Whole(Some(text)),
            Text::AsyncIterable(input) => Source::Commands(input),
        };
        Self {
            state: Some(State::Socket(Live {
                socket,
                source,
                settings: settings.wire,
                prefix: format!("{prefix}:"),
                limit,
                validate,
                contexts: BTreeMap::new(),
                clears: VecDeque::new(),
                current: None,
                sequence: 0,
                retired_through: 0,
                queue: VecDeque::new(),
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
                    trace_id: None,
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
    body: StreamingInput<Vec<u8>>,
    audio: bool,
}
impl Http {
    fn next(&mut self, cx: &mut Context<'_>) -> Next {
        match self.body.as_mut().poll_next(cx) {
            Poll::Pending => Poll::Pending,
            Poll::Ready(Some(Err(e))) => Poll::Ready(Err(e)),
            Poll::Ready(None) => Poll::Ready(if self.audio {
                Ok(None)
            } else {
                Err(failure("Voice.ai returned no audio bytes"))
            }),
            Poll::Ready(Some(Ok(bytes))) if bytes.is_empty() => {
                cx.waker().wake_by_ref();
                Poll::Pending
            }
            Poll::Ready(Some(Ok(bytes))) => {
                self.audio = true;
                Poll::Ready(Ok(Some(SynthesisItem::Bytes(bytes))))
            }
        }
    }
}
enum Source {
    Whole(Option<String>),
    Commands(StreamingInput<Input>),
}
#[derive(Default)]
struct NativeContext {
    flushing: bool,
    cleared: bool,
    audio: bool,
    finished: bool,
}
struct Write {
    wire: Map,
    flush: Option<String>,
}
enum Step {
    Progress,
    Item(SynthesisItem),
}
struct Live {
    // Release the connection before dropping the application producer.
    socket: Socket,
    source: Source,
    settings: Map,
    prefix: String,
    limit: usize,
    validate: Validator,
    contexts: BTreeMap<String, NativeContext>,
    clears: VecDeque<BTreeSet<String>>,
    current: Option<String>,
    sequence: u64,
    retired_through: u64,
    queue: VecDeque<Write>,
    writing: bool,
    input_done: bool,
    prefer_output: bool,
}
impl Live {
    fn flush(&mut self) {
        if let Some(id) = self.current.take() {
            self.queue.push_back(Write {
                wire: Map::from([
                    ("context_id".into(), JsonValue::String(id.clone())),
                    ("text".into(), JsonValue::String(String::new())),
                    ("flush".into(), JsonValue::Bool(true)),
                    ("auto_close".into(), JsonValue::Bool(true)),
                ]),
                flush: Some(id),
            });
        }
    }
    fn produce(&mut self, cx: &mut Context<'_>) -> Poll<Result<Step, TransportError>> {
        if self.writing {
            return Poll::Pending;
        }
        if let Some(write) = self.queue.pop_front() {
            let mut text = String::new();
            json::write(&JsonValue::Object(write.wire), &mut text)?;
            if text.len() > self.limit {
                return Poll::Ready(Err(failure("Voice.ai message exceeds MaxMessageBytes")));
            }
            self.socket.as_mut().start_send(Message::Text(text))?;
            if let Some(id) = write.flush {
                self.contexts.get_mut(&id).expect("queued context").flushing = true;
            }
            self.writing = true;
            return Poll::Ready(Ok(Step::Progress));
        }
        if self.input_done {
            return Poll::Pending;
        }
        let item = match &mut self.source {
            Source::Whole(text) => text.take().map(Input::String),
            Source::Commands(input) => match input.as_mut().poll_next(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(Some(item)) => {
                    let item = item?;
                    (self.validate)(&item, Some("text"))?;
                    Some(item)
                }
                Poll::Ready(None) => None,
            },
        };
        match item {
            None => {
                self.input_done = true;
                self.flush();
            }
            Some(Input::String(text)) => {
                if !text.is_empty() {
                    let wire = if let Some(id) = &self.current {
                        Map::from([
                            ("context_id".into(), JsonValue::String(id.clone())),
                            ("text".into(), JsonValue::String(text)),
                        ])
                    } else {
                        self.sequence = self
                            .sequence
                            .checked_add(1)
                            .filter(|v| *v <= 9007199254740991)
                            .ok_or_else(|| failure("Voice.ai context identity exhausted"))?;
                        let id = format!("{}{}", self.prefix, self.sequence);
                        self.contexts.insert(id.clone(), NativeContext::default());
                        self.current = Some(id.clone());
                        let mut wire = self.settings.clone();
                        wire.insert("context_id".into(), JsonValue::String(id));
                        wire.insert("text".into(), JsonValue::String(text));
                        wire
                    };
                    self.queue.push_back(Write { wire, flush: None });
                }
            }
            Some(Input::Flush(_)) => self.flush(),
            Some(Input::Clear(_)) => {
                self.retired_through = self.sequence;
                self.clears
                    .push_back(self.contexts.keys().cloned().collect());
                for (id, context) in &mut self.contexts {
                    if !context.cleared {
                        context.cleared = true;
                        // A flushing context already has auto_close; a second
                        // close_context may race its native completion.
                        if !context.flushing {
                            self.queue.push_back(Write {
                                wire: Map::from([
                                    ("context_id".into(), JsonValue::String(id.clone())),
                                    ("close_context".into(), JsonValue::Bool(true)),
                                ]),
                                flush: None,
                            });
                        }
                    }
                }
                self.current = None;
            }
        }
        Poll::Ready(Ok(Step::Progress))
    }
    fn receive(&mut self, cx: &mut Context<'_>) -> Poll<Result<Step, TransportError>> {
        let message = match self.socket.as_mut().poll_receive(cx) {
            Poll::Pending => return Poll::Pending,
            Poll::Ready(Some(v)) => v?,
            Poll::Ready(None) => {
                return Poll::Ready(Err(failure(
                    "Voice.ai closed before input and contexts completed",
                )))
            }
        };
        // Interpret immediately against current protocol state, before polling
        // more input or exposing the message to consumer backpressure.
        let packet = protocol::decode(message, self.limit)?;
        let Some(context) = self.contexts.get_mut(&packet.id) else {
            if let Some(suffix) = packet.id.strip_prefix(&self.prefix) {
                if let Ok(ordinal) = suffix.parse::<u64>() {
                    if ordinal > 0
                        && ordinal <= self.retired_through
                        && ordinal.to_string() == suffix
                    {
                        return Poll::Ready(Ok(Step::Progress));
                    }
                }
            }
            return Poll::Ready(Err(failure(
                "Voice.ai returned an unknown or completed context",
            )));
        };
        let item = match packet.payload {
            Payload::Audio(bytes) => {
                if context.cleared {
                    None
                } else {
                    if !context.flushing || context.finished {
                        return Poll::Ready(Err(failure(
                            "Voice.ai audio arrived outside an active flush",
                        )));
                    }
                    if bytes.is_empty() {
                        None
                    } else {
                        context.audio = true;
                        Some(SynthesisItem::Ordered(VoiceAiEnvelope {
                            audio: bytes,
                            correlation: Default::default(),
                            correlation_id: packet.id,
                            timestamps: [],
                        }))
                    }
                }
            }
            Payload::Flush => {
                if context.cleared {
                    None
                } else {
                    if !context.flushing || context.finished || !context.audio {
                        return Poll::Ready(Err(failure(
                            "Voice.ai returned an unexpected or empty flush completion",
                        )));
                    }
                    context.finished = true;
                    Some(SynthesisItem::Flush(FlushEvent {
                        event: Default::default(),
                        correlation_id: packet.id,
                        input_group_id: None,
                    }))
                }
            }
            Payload::Closed => {
                if !context.cleared && !context.finished {
                    return Poll::Ready(Err(failure(
                        "Voice.ai context closed before flush completion",
                    )));
                }
                self.contexts.remove(&packet.id);
                for clear in &mut self.clears {
                    clear.remove(&packet.id);
                }
                None
            }
        };
        Poll::Ready(Ok(item.map_or(Step::Progress, Step::Item)))
    }
    fn next(&mut self, cx: &mut Context<'_>) -> Next {
        for _ in 0..128 {
            // Native closure cannot hide a write failure still pending locally.
            if self.writing {
                if let Poll::Ready(result) = self.socket.as_mut().poll_flush(cx) {
                    result?;
                    self.writing = false;
                }
            }
            if self.clears.front().is_some_and(|ids| ids.is_empty()) {
                self.clears.pop_front();
                return Poll::Ready(Ok(Some(SynthesisItem::Clear(ClearEvent {
                    event: Default::default(),
                }))));
            }
            if self.input_done && self.contexts.is_empty() && !self.writing && self.queue.is_empty()
            {
                return Poll::Ready(Ok(None));
            }
            let first = if self.prefer_output {
                self.receive(cx)
            } else {
                self.produce(cx)
            };
            let step = match first {
                Poll::Ready(step) => {
                    self.prefer_output = !self.prefer_output;
                    step?
                }
                Poll::Pending => match if self.prefer_output {
                    self.produce(cx)
                } else {
                    self.receive(cx)
                } {
                    Poll::Pending => return Poll::Pending,
                    Poll::Ready(step) => step?,
                },
            };
            if let Step::Item(item) = step {
                return Poll::Ready(Ok(Some(item)));
            }
        }
        cx.waker().wake_by_ref();
        Poll::Pending
    }
}
