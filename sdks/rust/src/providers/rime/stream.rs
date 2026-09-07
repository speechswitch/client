use super::{failure, Error};
use crate::{
    base64,
    generated::{rime::TtsRequestCodaStreamingTextVoice84ec2db1TextItem as Input, rime_output::*},
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

pub(super) enum Source {
    Whole(Option<String>),
    Streaming(StreamingInput<Input>),
}
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
        text: Source,
        prefix: String,
        timed: bool,
        limit: usize,
        validate: Validator,
    ) -> Self {
        Self {
            state: Some(State::Socket(Live {
                socket,
                source: Some(text),
                prefix,
                timed,
                limit,
                validate,
                writing: false,
                eos: false,
                closed: false,
                prefer_output: true,
                generation: 0,
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
                Err(failure("Rime returned no audio"))
            }),
            Poll::Ready(Some(Ok(bytes))) => {
                if bytes.is_empty() {
                    cx.waker().wake_by_ref();
                    Poll::Pending
                } else {
                    self.audio = true;
                    Poll::Ready(Ok(Some(SynthesisItem::Bytes(bytes))))
                }
            }
        }
    }
}

enum Payload {
    Chunk(Vec<u8>),
    Timestamps(Vec<RimeEnvelopeTimestampsItem>),
    Done,
}
struct Packet {
    context: Option<String>,
    payload: Payload,
}
fn decode(text: &str) -> Result<Packet, TransportError> {
    let raw = Raw::parse_exact(text).map_err(|_| failure("Rime returned invalid JSON"))?;
    let object = raw.object().map_err(|_| failure("Invalid Rime response"))?;
    let kind = object.get("type").and_then(|v| v.string().ok());
    if kind.as_deref() == Some("error") {
        if let Some(message) = object.get("message").and_then(|v| v.string().ok()) {
            return Err(Box::new(Error {
                message,
                status: None,
            }));
        }
    }
    let context = object
        .get("contextId")
        .ok_or_else(|| failure("Invalid Rime context ID"))?;
    let context = if context.is_null() {
        None
    } else {
        Some(
            context
                .string()
                .map_err(|_| failure("Invalid Rime context ID"))?,
        )
    };
    let payload = match kind.as_deref() {
        Some("done") => Payload::Done,
        Some("chunk") => {
            let data = object
                .get("data")
                .and_then(|v| v.string().ok())
                .ok_or_else(|| failure("Invalid Rime audio response"))?;
            let audio = base64::decode(&data)
                .filter(|bytes| base64::encode(bytes) == data)
                .ok_or_else(|| failure("Invalid Rime audio response"))?;
            Payload::Chunk(audio)
        }
        Some("timestamps") => {
            let marks = object
                .get("word_timestamps")
                .and_then(|v| v.object().ok())
                .ok_or_else(|| failure("Invalid Rime response"))?;
            let words = marks
                .get("words")
                .and_then(|v| v.array().ok())
                .ok_or_else(|| failure("Invalid Rime timestamp arrays"))?;
            let starts = marks
                .get("start")
                .and_then(|v| v.array().ok())
                .ok_or_else(|| failure("Invalid Rime timestamp arrays"))?;
            let ends = marks
                .get("end")
                .and_then(|v| v.array().ok())
                .ok_or_else(|| failure("Invalid Rime timestamp arrays"))?;
            if words.len() != starts.len() || words.len() != ends.len() {
                return Err(failure("Invalid Rime timestamp arrays"));
            }
            let mut timestamps = Vec::with_capacity(words.len());
            for ((word, start), end) in words.iter().zip(starts.iter()).zip(ends.iter()) {
                let word = word
                    .string()
                    .map_err(|_| failure("Invalid Rime timestamp interval"))?;
                let start = start
                    .number()
                    .map_err(|_| failure("Invalid Rime timestamp interval"))?
                    * 1000.0;
                let end = end
                    .number()
                    .map_err(|_| failure("Invalid Rime timestamp interval"))?
                    * 1000.0;
                if !start.is_finite() || !end.is_finite() || start < 0.0 || end < start {
                    return Err(failure("Invalid Rime timestamp interval"));
                }
                timestamps.push(RimeEnvelopeTimestampsItem {
                    value: word,
                    start_time_ms: start,
                    end_time_ms: Some(end),
                    kind: Default::default(),
                    source: None,
                });
            }
            Payload::Timestamps(timestamps)
        }
        _ => return Err(failure("Invalid Rime response")),
    };
    Ok(Packet { context, payload })
}

struct Live {
    // Release the native socket before dropping application input.
    socket: Socket,
    source: Option<Source>,
    prefix: String,
    timed: bool,
    limit: usize,
    validate: Validator,
    writing: bool,
    eos: bool,
    closed: bool,
    prefer_output: bool,
    generation: u64,
}
enum Step {
    Continue,
    Item(SynthesisItem),
}
impl Live {
    fn next(&mut self, cx: &mut Context<'_>) -> Next {
        if self.closed && !self.writing {
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
    fn send(&mut self, message: String) -> Result<(), TransportError> {
        if message.len() > self.limit {
            return Err(failure("Rime message exceeds max_message_bytes"));
        }
        self.socket.as_mut().start_send(Message::Text(message))?;
        self.writing = true;
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
        if self.eos {
            return Poll::Pending;
        }
        if self.source.is_none() {
            // Observe buffered closure before sending EOS. Process at most one
            // incoming message per poll, including when untimed data is discarded.
            if let Poll::Ready(result) = self.receive(cx) {
                return Poll::Ready(result);
            }
            self.send("{\"operation\":\"eos\"}".into())?;
            self.eos = true;
            return Poll::Ready(Ok(Step::Continue));
        }
        let item = match self.source.as_mut().expect("source present") {
            Source::Whole(text) => text.take().map(|v| Ok(Input::String(v))),
            Source::Streaming(text) => match text.as_mut().poll_next(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(value) => {
                    if let Some(Ok(item)) = &value {
                        (self.validate)(item, None)?;
                    }
                    value
                }
            },
        };
        let Some(item) = item else {
            self.source = None;
            return Poll::Ready(Ok(Step::Continue));
        };
        match item? {
            Input::String(text) => {
                if text.chars().count() > 1000 {
                    return Poll::Ready(Err(failure(
                        "Rime WebSocket text frames are limited to 1000 code points",
                    )));
                }
                if !text.is_empty() {
                    let mut message = String::from("{\"text\":");
                    json::quote(&text, &mut message);
                    message.push_str(",\"contextId\":");
                    json::quote(&format!("{}{}", self.prefix, self.generation), &mut message);
                    message.push('}');
                    self.send(message)?;
                }
            }
            Input::Flush(_) => self.send("{\"operation\":\"flush\"}".into())?,
            Input::Clear(_) => {
                self.send("{\"operation\":\"clear\"}".into())?;
                self.generation = self
                    .generation
                    .checked_add(1)
                    .ok_or_else(|| failure("Rime context generation exhausted"))?;
                return Poll::Ready(Ok(Step::Item(SynthesisItem::Clear(ClearEvent {
                    event: Default::default(),
                }))));
            }
        }
        Poll::Ready(Ok(Step::Continue))
    }
    fn receive(&mut self, cx: &mut Context<'_>) -> Poll<Result<Step, TransportError>> {
        if self.closed {
            return Poll::Pending;
        }
        let packet = match self.socket.as_mut().poll_receive(cx) {
            Poll::Pending => return Poll::Pending,
            Poll::Ready(None) => {
                if !self.eos {
                    return Poll::Ready(Err(failure(
                        "Rime WebSocket closed before clean end-of-stream",
                    )));
                }
                self.closed = true;
                return Poll::Ready(Ok(Step::Continue));
            }
            Poll::Ready(Some(Err(e))) => return Poll::Ready(Err(e)),
            Poll::Ready(Some(Ok(Message::Binary(_)))) => {
                return Poll::Ready(Err(failure("Rime returned a non-text WebSocket frame")))
            }
            Poll::Ready(Some(Ok(Message::Text(text)))) => {
                if text.len() > self.limit {
                    return Poll::Ready(Err(failure("Rime message exceeds max_message_bytes")));
                }
                decode(&text)?
            }
        };
        if let Some(id) = &packet.context {
            let ordinal: Option<u64> = id.strip_prefix(&self.prefix).and_then(|v| v.parse().ok());
            if let Some(ordinal) = ordinal {
                if ordinal < self.generation && id == &format!("{}{ordinal}", self.prefix) {
                    return Poll::Ready(Ok(Step::Continue));
                }
            }
        }
        if self.generation > 0 && packet.context.is_none() {
            return Poll::Ready(Err(failure(
                "Rime omitted context identity after clear; stale audio cannot be distinguished",
            )));
        }
        let mut envelope = RimeEnvelope {
            input_group_id: packet.context,
            correlation: Default::default(),
            timestamp_origin: Default::default(),
            audio: None,
            timestamps: vec![],
        };
        let item = match packet.payload {
            Payload::Done => Some(SynthesisItem::Batch(RimeBatchEvent {
                event: Default::default(),
                input_group_id: envelope.input_group_id,
            })),
            Payload::Chunk(audio) => {
                if audio.is_empty() {
                    None
                } else if self.timed {
                    envelope.audio = Some(audio);
                    Some(SynthesisItem::Ordered(envelope))
                } else {
                    Some(SynthesisItem::Bytes(audio))
                }
            }
            Payload::Timestamps(timestamps) => {
                if self.timed {
                    envelope.timestamps = timestamps;
                    Some(SynthesisItem::Ordered(envelope))
                } else {
                    None
                }
            }
        };
        Poll::Ready(Ok(item.map_or(Step::Continue, Step::Item)))
    }
}
