use super::{failure, Error};
use crate::{
    base64,
    generated::{
        respeecher::{
            TtsRequestObjectText as Text, TtsRequestObjectTextAsyncIterableItem as Input,
        },
        respeecher_output::*,
    },
    http::TransportError,
    json::{self, Raw},
    runtime::{InputStream, StreamingInput, ValidationError},
    websocket::{Message, Socket},
};
use std::{
    any::Any,
    collections::{BTreeMap, VecDeque},
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
    pub(super) fn http(body: StreamingInput<Vec<u8>>, wave: bool, limit: usize) -> Self {
        Self {
            state: Some(State::Http(Http {
                body,
                wave,
                limit,
                chunk: Vec::new(),
                position: 0,
                line: Vec::new(),
                first: true,
                eof: false,
                audio: false,
            })),
        }
    }
    pub(super) fn socket(
        socket: Socket,
        text: Text,
        settings: String,
        prefix: String,
        limit: usize,
        validate: Validator,
    ) -> Self {
        let source = match text {
            Text::String(v) => Source::Whole(Some(v)),
            Text::AsyncIterable(v) => Source::Streaming(v),
        };
        Self {
            state: Some(State::Socket(Live {
                socket,
                source: Some(source),
                settings,
                prefix,
                limit,
                validate,
                writing: false,
                prefer_output: false,
                queued: VecDeque::new(),
                contexts: BTreeMap::new(),
                current: None,
                sequence: 0,
                cleared: None,
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

enum Packet {
    Chunk {
        context: Option<String>,
        audio: Vec<u8>,
    },
    Done(String),
    Failure(Error),
}
fn decode(text: &str, socket: bool) -> Result<Packet, TransportError> {
    let raw = Raw::parse_exact(text).map_err(|_| failure("Respeecher returned invalid JSON"))?;
    let object = raw
        .object()
        .map_err(|_| failure("Invalid Respeecher response"))?;
    let context = object
        .get("context_id")
        .map(|v| {
            v.string()
                .map_err(|_| failure("Invalid Respeecher context ID"))
        })
        .transpose()?;
    let kind = object.get("type").and_then(|v| v.string().ok());
    if kind.as_deref() == Some("error") {
        let status = object
            .get("status_code")
            .and_then(|v| v.number().ok())
            .filter(|v| v.is_finite() && v.trunc() == *v && v.abs() <= 9007199254740991.0)
            .ok_or_else(|| failure("Invalid Respeecher error response"))?;
        let message = object
            .get("error")
            .and_then(|v| v.string().ok())
            .ok_or_else(|| failure("Invalid Respeecher error response"))?;
        return Ok(Packet::Failure(Error {
            status_code: status as i64,
            context_id: context,
            message,
        }));
    }
    if socket && context.is_none() {
        return Err(failure("Respeecher omitted the native context ID"));
    }
    if kind.as_deref() == Some("done") && socket {
        return Ok(Packet::Done(context.expect("socket context checked")));
    }
    if kind.as_deref() != Some("chunk") {
        return Err(failure("Invalid Respeecher audio response"));
    }
    let data = object
        .get("data")
        .and_then(|v| v.string().ok())
        .ok_or_else(|| failure("Invalid Respeecher audio response"))?;
    let audio = base64::decode(&data)
        .filter(|bytes| base64::encode(bytes) == data)
        .ok_or_else(|| failure("Invalid Respeecher audio response"))?;
    Ok(Packet::Chunk { context, audio })
}

struct Http {
    body: StreamingInput<Vec<u8>>,
    wave: bool,
    limit: usize,
    chunk: Vec<u8>,
    position: usize,
    line: Vec<u8>,
    first: bool,
    eof: bool,
    audio: bool,
}
impl Http {
    fn line(&mut self) -> Result<Option<SynthesisItem>, TransportError> {
        let bytes = std::mem::take(&mut self.line);
        let text = std::str::from_utf8(&bytes)
            .map_err(|_| failure("Respeecher returned invalid UTF-8"))?;
        let text = if self.first {
            text.strip_prefix('\u{feff}').unwrap_or(text)
        } else {
            text
        };
        self.first = false;
        if text.trim().is_empty() {
            return Ok(None);
        }
        match decode(text, false)? {
            Packet::Failure(error) => Err(Box::new(error)),
            Packet::Chunk { audio, .. } => {
                if audio.is_empty() {
                    Ok(None)
                } else {
                    self.audio = true;
                    Ok(Some(SynthesisItem::Bytes(audio)))
                }
            }
            Packet::Done(_) => unreachable!("HTTP decoder rejects done"),
        }
    }
    fn next(&mut self, cx: &mut Context<'_>) -> Next {
        if self.eof {
            if !self.line.is_empty() {
                if let Some(item) = self.line()? {
                    return Poll::Ready(Ok(Some(item)));
                }
            }
            return Poll::Ready(if self.audio {
                Ok(None)
            } else {
                Err(failure("Respeecher returned no audio"))
            });
        }
        if self.position == self.chunk.len() {
            self.chunk = Vec::new();
            self.position = 0;
            match self.body.as_mut().poll_next(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(Some(Err(e))) => return Poll::Ready(Err(e)),
                Poll::Ready(None) => {
                    self.eof = true;
                    return self.next(cx);
                }
                Poll::Ready(Some(Ok(bytes))) => {
                    if bytes.is_empty() {
                        cx.waker().wake_by_ref();
                        return Poll::Pending;
                    }
                    if self.wave {
                        self.audio = true;
                        return Poll::Ready(Ok(Some(SynthesisItem::Bytes(bytes))));
                    };
                    self.chunk = bytes;
                }
            }
        }
        let end = self.chunk.len().min(self.position.saturating_add(8192));
        while self.position < end {
            let byte = self.chunk[self.position];
            self.position += 1;
            if byte == b'\n' {
                if let Some(item) = self.line()? {
                    return Poll::Ready(Ok(Some(item)));
                }
            } else {
                if self.line.len() == self.limit {
                    return Poll::Ready(Err(failure("Respeecher line exceeds max_message_bytes")));
                };
                self.line.push(byte)
            }
        }
        cx.waker().wake_by_ref();
        Poll::Pending
    }
}

enum Source {
    Whole(Option<String>),
    Streaming(StreamingInput<Input>),
}
struct SynthesisContext {
    ended: bool,
    flush: bool,
    audio: bool,
}
struct Live {
    // Socket ownership drops before the application producer.
    socket: Socket,
    source: Option<Source>,
    settings: String,
    prefix: String,
    limit: usize,
    validate: Validator,
    writing: bool,
    prefer_output: bool,
    queued: VecDeque<String>,
    contexts: BTreeMap<String, SynthesisContext>,
    current: Option<String>,
    sequence: u64,
    cleared: Option<u64>,
}
enum Step {
    Continue,
    Item(SynthesisItem),
}
impl Live {
    fn next(&mut self, cx: &mut Context<'_>) -> Next {
        if self.source.is_none()
            && self.contexts.is_empty()
            && !self.writing
            && self.queued.is_empty()
        {
            return Poll::Ready(Ok(None));
        }
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
                Poll::Ready(Err(e)) => return Poll::Ready(Err(e)),
                Poll::Ready(Ok(step)) => {
                    self.prefer_output = !output;
                    return match step {
                        Step::Continue => {
                            cx.waker().wake_by_ref();
                            Poll::Pending
                        }
                        Step::Item(item) => Poll::Ready(Ok(Some(item))),
                    };
                }
            }
        }
        Poll::Pending
    }
    fn generation(&self, id: &str, text: &str, continued: bool) -> String {
        let mut message = self.settings.clone();
        message.pop();
        message.push_str(",\"context_id\":");
        json::quote(id, &mut message);
        message.push_str(",\"transcript\":");
        json::quote(text, &mut message);
        message.push_str(if continued {
            ",\"continue\":true}"
        } else {
            ",\"continue\":false}"
        });
        message
    }
    fn send(&mut self, message: String) -> Result<(), TransportError> {
        if message.len() > self.limit {
            return Err(failure("Respeecher message exceeds max_message_bytes"));
        };
        self.socket.as_mut().start_send(Message::Text(message))?;
        self.writing = true;
        Ok(())
    }
    fn end(&mut self, flush: bool) -> Result<(), TransportError> {
        if let Some(id) = self.current.take() {
            let context = self.contexts.get_mut(&id).expect("current context exists");
            context.ended = true;
            context.flush = flush;
            self.send(self.generation(&id, "", false))?;
        }
        Ok(())
    }
    fn input(&mut self, cx: &mut Context<'_>) -> Poll<Result<Step, TransportError>> {
        if self.writing {
            match self.socket.as_mut().poll_flush(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(result) => result?,
            };
            self.writing = false;
            return Poll::Ready(Ok(Step::Continue));
        }
        if let Some(message) = self.queued.pop_front() {
            self.send(message)?;
            return Poll::Ready(Ok(Step::Continue));
        }
        let Some(source) = &mut self.source else {
            return Poll::Pending;
        };
        let item = match source {
            Source::Whole(value) => value.take().map(|v| Ok(Input::String(v))),
            Source::Streaming(value) => match value.as_mut().poll_next(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(value) => {
                    if let Some(Ok(item)) = &value {
                        (self.validate)(item, None)?
                    };
                    value
                }
            },
        };
        let Some(item) = item else {
            self.source = None;
            self.end(false)?;
            return Poll::Ready(Ok(Step::Continue));
        };
        match item? {
            Input::String(text) => {
                if !text.is_empty() {
                    if self.current.is_none() {
                        let id = format!("{}{}", self.prefix, self.sequence);
                        self.sequence = self
                            .sequence
                            .checked_add(1)
                            .ok_or_else(|| failure("Respeecher context ID exhausted"))?;
                        self.contexts.insert(
                            id.clone(),
                            SynthesisContext {
                                ended: false,
                                flush: false,
                                audio: false,
                            },
                        );
                        self.current = Some(id)
                    }
                    self.send(self.generation(
                        self.current.as_deref().expect("allocated context"),
                        &text,
                        true,
                    ))?;
                }
            }
            Input::Flush(_) => self.end(true)?,
            Input::Clear(_) => {
                for id in self.contexts.keys() {
                    let mut message = String::from("{\"context_id\":");
                    json::quote(id, &mut message);
                    message.push_str(",\"cancel\":true}");
                    self.queued.push_back(message)
                }
                self.cleared = self.sequence.checked_sub(1);
                self.contexts.clear();
                self.current = None;
                if let Some(message) = self.queued.pop_front() {
                    self.send(message)?;
                }
                return Poll::Ready(Ok(Step::Item(SynthesisItem::Clear(ClearEvent {
                    event: Default::default(),
                }))));
            }
        }
        Poll::Ready(Ok(Step::Continue))
    }
    fn receive(&mut self, cx: &mut Context<'_>) -> Poll<Result<Step, TransportError>> {
        let packet = match self.socket.as_mut().poll_receive(cx) {
            Poll::Pending => return Poll::Pending,
            Poll::Ready(None) => {
                return Poll::Ready(Err(failure(
                    "Respeecher WebSocket closed before synthesis completed",
                )))
            }
            Poll::Ready(Some(Err(e))) => return Poll::Ready(Err(e)),
            Poll::Ready(Some(Ok(Message::Binary(_)))) => {
                return Poll::Ready(Err(failure(
                    "Respeecher returned a non-text WebSocket frame",
                )))
            }
            Poll::Ready(Some(Ok(Message::Text(text)))) => {
                if text.len() > self.limit {
                    return Poll::Ready(Err(failure(
                        "Respeecher message exceeds max_message_bytes",
                    )));
                };
                decode(&text, true)?
            }
        };
        let id = match &packet {
            Packet::Chunk { context, .. } => context.as_deref(),
            Packet::Done(id) => Some(id.as_str()),
            Packet::Failure(e) => e.context_id.as_deref(),
        };
        if let (Some(id), Some(cleared)) = (id, self.cleared) {
            let ordinal: Option<u64> = id.strip_prefix(&self.prefix).and_then(|v| v.parse().ok());
            if let Some(ordinal) = ordinal {
                if ordinal <= cleared && id == format!("{}{ordinal}", self.prefix) {
                    return Poll::Ready(Ok(Step::Continue));
                }
            }
        }
        if let Packet::Failure(error) = packet {
            return Poll::Ready(Err(Box::new(error)));
        }
        let id = id
            .ok_or_else(|| failure("Respeecher omitted the native context ID"))?
            .to_owned();
        let context = self
            .contexts
            .get_mut(&id)
            .ok_or_else(|| failure("Respeecher returned an unknown context ID"))?;
        match packet {
            Packet::Chunk { audio, .. } => {
                if audio.is_empty() {
                    return Poll::Ready(Ok(Step::Continue));
                };
                context.audio = true;
                Poll::Ready(Ok(Step::Item(SynthesisItem::Ordered(AudioEnvelope {
                    audio,
                    correlation: Default::default(),
                    correlation_id: id,
                    timestamps: [],
                }))))
            }
            Packet::Done(_) => {
                if !context.ended {
                    return Poll::Ready(Err(failure(
                        "Respeecher completed a context before its text ended",
                    )));
                };
                if !context.audio {
                    return Poll::Ready(Err(failure(
                        "Respeecher completed a context without audio",
                    )));
                }
                let flush = context.flush;
                self.contexts.remove(&id);
                Poll::Ready(Ok(if flush {
                    Step::Item(SynthesisItem::Flush(FlushEvent {
                        event: Default::default(),
                        correlation_id: id.clone(),
                        input_group_id: id,
                    }))
                } else {
                    Step::Continue
                }))
            }
            Packet::Failure(_) => unreachable!("failure handled above"),
        }
    }
}
