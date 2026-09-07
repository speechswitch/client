use super::{
    protocol::{self, failure},
    settings::{self, Map, Settings},
    Input, SynthesisItem,
};
use crate::{
    generated::murf_output::*,
    http::TransportError,
    json,
    runtime::{JsonValue, StreamingInput, ValidationError},
    websocket::{Message, Socket},
};
use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    task::{Context, Poll},
};
type Validator =
    Box<dyn Fn(&dyn std::any::Any, Option<&str>) -> Result<(), ValidationError> + Send + Sync>;
#[derive(Default)]
struct NativeContext {
    ended: bool,
    written: bool,
    flush: bool,
    audio: bool,
    final_: bool,
}
struct Write {
    fields: Map,
    end: Option<String>,
}
enum Step {
    Progress,
    Item(SynthesisItem),
}
pub(super) struct SocketStream {
    // Drop network I/O before the user producer.
    socket: Socket,
    input: StreamingInput<Input>,
    validate: Validator,
    voice: Map,
    contexts: BTreeMap<String, NativeContext>,
    order: Vec<String>,
    retired: BTreeSet<String>,
    current: Option<String>,
    session: String,
    sequence: u64,
    queue: VecDeque<Write>,
    writing: bool,
    writing_end: Option<String>,
    input_done: bool,
    limit: usize,
    prefer_output: bool,
    pub done: bool,
}
impl SocketStream {
    pub fn new(
        socket: Socket,
        mut settings: Settings,
        session: String,
        limit: usize,
        validate: Validator,
    ) -> Self {
        let queue = VecDeque::from([Write {
            fields: Map::from([
                (
                    "min_buffer_size".into(),
                    JsonValue::Number(settings.threshold),
                ),
                (
                    "max_buffer_delay_in_ms".into(),
                    JsonValue::Number(settings.delay),
                ),
            ]),
            end: None,
        }]);
        Self {
            socket,
            input: settings.input.take().unwrap(),
            validate,
            voice: settings.voice,
            contexts: BTreeMap::new(),
            order: vec![],
            retired: BTreeSet::new(),
            current: None,
            session,
            sequence: 0,
            queue,
            writing: false,
            writing_end: None,
            input_done: false,
            limit,
            prefer_output: false,
            done: false,
        }
    }
    fn end(&mut self, flush: bool) {
        if let Some(id) = self.current.take() {
            let c = self.contexts.get_mut(&id).unwrap();
            c.ended = true;
            c.flush = flush;
            self.queue.push_back(Write {
                fields: Map::from([
                    ("context_id".into(), JsonValue::String(id.clone())),
                    ("text".into(), JsonValue::String(String::new())),
                    ("end".into(), JsonValue::Bool(true)),
                ]),
                end: Some(id),
            });
        }
    }
    fn produce(&mut self, cx: &mut Context<'_>) -> Poll<Result<Step, TransportError>> {
        if self.writing {
            return Poll::Pending;
        }
        if let Some(write) = self.queue.pop_front() {
            let mut text = String::new();
            json::write(&JsonValue::Object(write.fields), &mut text)?;
            if text.len() > self.limit {
                return Poll::Ready(Err(failure("Murf message exceeds max_message_bytes")));
            }
            self.socket.as_mut().start_send(Message::Text(text))?;
            self.writing = true;
            self.writing_end = write.end;
            return Poll::Ready(Ok(Step::Progress));
        }
        if self.input_done {
            return Poll::Pending;
        }
        let item = match self.input.as_mut().poll_next(cx) {
            Poll::Pending => return Poll::Pending,
            Poll::Ready(Some(v)) => v?,
            Poll::Ready(None) => {
                self.input_done = true;
                self.end(false);
                return Poll::Ready(Ok(Step::Progress));
            }
        };
        (self.validate)(&item, Some("text"))?;
        match item {
            Input::String(text) => {
                if text.encode_utf16().count() > 3000 {
                    return Poll::Ready(Err(failure(
                        "Murf text messages must not exceed 3000 characters",
                    )));
                }
                if !text.is_empty() {
                    let id = self
                        .current
                        .get_or_insert_with(|| {
                            let id = format!("{}:{}", self.session, self.sequence);
                            self.sequence += 1;
                            self.contexts.insert(id.clone(), NativeContext::default());
                            self.order.push(id.clone());
                            id
                        })
                        .clone();
                    self.queue.push_back(Write {
                        fields: Map::from([
                            ("context_id".into(), JsonValue::String(id)),
                            ("voice_config".into(), JsonValue::Object(self.voice.clone())),
                            ("text".into(), JsonValue::String(text)),
                        ]),
                        end: None,
                    });
                }
            }
            Input::Flush(_) => self.end(true),
            Input::Clear(_) => {
                for id in self.order.drain(..) {
                    self.retired.insert(id.clone());
                    self.queue.push_back(Write {
                        fields: Map::from([
                            ("context_id".into(), JsonValue::String(id)),
                            ("clear".into(), JsonValue::Bool(true)),
                        ]),
                        end: None,
                    });
                }
                self.contexts.clear();
                self.current = None;
                // Local playback invalidation does not wait for a native clear write.
                return Poll::Ready(Ok(Step::Item(SynthesisItem::Clear(ClearEvent {
                    event: Default::default(),
                }))));
            }
            Input::Update(v) => {
                let (voice, buffering) = settings::update(v);
                self.voice.extend(voice);
                if let Some(id) = &self.current {
                    self.queue.push_back(Write {
                        fields: Map::from([
                            ("context_id".into(), JsonValue::String(id.clone())),
                            ("voice_config".into(), JsonValue::Object(self.voice.clone())),
                        ]),
                        end: None,
                    });
                }
                if !buffering.is_empty() {
                    self.queue.push_back(Write {
                        fields: buffering,
                        end: None,
                    });
                }
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
                    "Murf WebSocket closed before all contexts completed",
                )))
            }
        };
        let Message::Text(text) = message else {
            return Poll::Ready(Err(failure("Murf returned a non-text WebSocket message")));
        };
        if text.len() > self.limit {
            return Poll::Ready(Err(failure("Murf message exceeds max_message_bytes")));
        }
        let p = protocol::packet(&text)?;
        if self.retired.contains(&p.context) {
            return Poll::Ready(Ok(Step::Progress));
        }
        let c = self
            .contexts
            .get_mut(&p.context)
            .ok_or_else(|| failure("Murf returned an unknown context ID"))?;
        if !p.audio.is_empty() {
            c.audio = true;
        }
        if p.final_ {
            if !c.ended {
                return Poll::Ready(Err(failure(
                    "Murf completed a context before its text ended",
                )));
            }
            if !c.audio {
                return Poll::Ready(Err(failure("Murf completed a context without audio")));
            }
            c.final_ = true;
        }
        if p.audio.is_empty() {
            return Poll::Ready(Ok(Step::Progress));
        }
        let mut e = protocol::envelope(false);
        e.audio = Some(p.audio);
        e.correlation_id = Some(p.context);
        Poll::Ready(Ok(Step::Item(SynthesisItem::OrderedOrTimeline(e))))
    }
    pub fn next(
        &mut self,
        cx: &mut Context<'_>,
    ) -> Poll<Result<Option<SynthesisItem>, TransportError>> {
        for _ in 0..128 {
            // A failed end write must win over any native final received meanwhile.
            if self.writing {
                if let Poll::Ready(v) = self.socket.as_mut().poll_flush(cx) {
                    v?;
                    self.writing = false;
                    if let Some(id) = self.writing_end.take() {
                        if let Some(c) = self.contexts.get_mut(&id) {
                            c.written = true;
                        }
                    }
                }
            }
            if let Some(index) = self.order.iter().position(|id| {
                let c = &self.contexts[id];
                c.written && c.final_
            }) {
                let id = self.order.remove(index);
                let c = self.contexts.remove(&id).unwrap();
                if c.flush {
                    return Poll::Ready(Ok(Some(SynthesisItem::Flush(FlushEvent {
                        event: Default::default(),
                        correlation_id: id.clone(),
                        input_group_id: id,
                    }))));
                }
                continue;
            }
            if self.input_done && self.contexts.is_empty() && !self.writing && self.queue.is_empty()
            {
                self.done = true;
                return Poll::Ready(Ok(Some(SynthesisItem::Done(DoneEvent {
                    event: Default::default(),
                    remaining_characters: None,
                    warning: None,
                }))));
            }
            let first = if self.prefer_output {
                self.receive(cx)
            } else {
                self.produce(cx)
            };
            let step = match first {
                Poll::Ready(v) => {
                    self.prefer_output = !self.prefer_output;
                    v?
                }
                Poll::Pending => match if self.prefer_output {
                    self.produce(cx)
                } else {
                    self.receive(cx)
                } {
                    Poll::Pending => return Poll::Pending,
                    Poll::Ready(v) => v?,
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
