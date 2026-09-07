use super::{
    protocol::{self, failure, Wave},
    settings::{Map, Validator},
    Input,
};
use crate::{
    generated::inworld_output::*,
    http::TransportError,
    json,
    runtime::{InputStream, JsonValue, StreamingInput},
    websocket::{Message, Socket},
};
use std::{
    pin::Pin,
    task::{Context, Poll},
};

type Next = Poll<Result<Option<SynthesisItem>, TransportError>>;
enum State {
    Http(HttpStream),
    Socket(SocketStream),
    Single(Option<SynthesisItem>),
}
/// Owns input and network I/O. Drop cancels; terminal results release immediately.
pub struct Stream {
    state: Option<State>,
}
impl Stream {
    pub(super) fn single(item: Option<SynthesisItem>) -> Self {
        Self {
            state: Some(State::Single(item)),
        }
    }
    pub(super) fn http(
        body: StreamingInput<Vec<u8>>,
        timed: bool,
        chunk: bool,
        limit: usize,
    ) -> Self {
        Self {
            state: Some(State::Http(HttpStream {
                body,
                timed,
                chunk,
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
        input: StreamingInput<Input>,
        create: Map,
        context_id: String,
        timed: bool,
        chunk: bool,
        wav: bool,
        limit: usize,
        validate: Validator,
    ) -> Self {
        Self {
            state: Some(State::Socket(SocketStream {
                socket,
                input,
                timed,
                chunk,
                limit,
                create: Some(create),
                context_id,
                created: false,
                flush: 0,
                wave: wav.then(Wave::new),
                validate,
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
        let result = match state {
            State::Http(v) => v.next(cx),
            State::Socket(v) => v.next(cx),
            State::Single(v) => Poll::Ready(Ok(v.take())),
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
    chunk: bool,
    limit: usize,
    first: bool,
    ended: bool,
    line: Vec<u8>,
    pending: std::vec::IntoIter<u8>,
}
impl HttpStream {
    fn line(&mut self) -> Result<Option<SynthesisItem>, TransportError> {
        let data = std::mem::take(&mut self.line);
        let bytes = if self.first {
            data.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&data)
        } else {
            &data
        };
        self.first = false;
        let text =
            std::str::from_utf8(bytes).map_err(|_| failure("Inworld returned invalid UTF-8"))?;
        if text.trim().is_empty() {
            return Ok(None);
        }
        protocol::audio(&protocol::result(text)?, self.timed, self.chunk, None, None)
    }
    fn next(&mut self, cx: &mut Context<'_>) -> Next {
        for _ in 0..4096 {
            let item = if let Some(byte) = self.pending.next() {
                if byte != b'\n' {
                    if self.line.len() == self.limit {
                        return Poll::Ready(Err(failure(
                            "Inworld JSON line exceeds max_json_bytes",
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
                    Poll::Ready(Some(Err(e))) => return Poll::Ready(Err(e)),
                    Poll::Ready(Some(Ok(bytes))) => {
                        if bytes.is_empty() {
                            cx.waker().wake_by_ref();
                            return Poll::Pending;
                        }
                        self.pending = bytes.into_iter();
                        continue;
                    }
                }
            };
            if let Some(item) = item {
                return Poll::Ready(Ok(Some(item)));
            }
        }
        cx.waker().wake_by_ref();
        Poll::Pending
    }
}
struct SocketStream {
    create: Option<Map>,
    context_id: String,
    created: bool,
    flush: u64,
    wave: Option<Wave>,
    validate: Validator,
    // Drop order releases the connection before producer cleanup.
    socket: Socket,
    input: StreamingInput<Input>,
    timed: bool,
    chunk: bool,
    limit: usize,
    writing: bool,
    input_done: bool,
    prefer_output: bool,
}
enum Step {
    Continue,
    Item(SynthesisItem),
    Done,
}
impl SocketStream {
    fn send(&mut self, mut fields: Map) -> Result<(), TransportError> {
        fields.insert(
            "contextId".into(),
            JsonValue::String(self.context_id.clone()),
        );
        let mut data = String::new();
        json::write(&JsonValue::Object(fields), &mut data)?;
        if data.len() > self.limit {
            return Err(failure("Inworld message exceeds max_message_bytes"));
        }
        self.socket.as_mut().start_send(Message::Text(data))?;
        self.writing = true;
        Ok(())
    }
    fn next(&mut self, cx: &mut Context<'_>) -> Next {
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
                Poll::Ready(Err(e)) => return Poll::Ready(Err(e)),
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
                Poll::Ready(v) => v?,
            }
            self.writing = false;
            return Poll::Ready(Ok(Step::Continue));
        }
        if let Some(create) = self.create.take() {
            self.send(Map::from([("create".into(), JsonValue::Object(create))]))?;
            return Poll::Ready(Ok(Step::Continue));
        }
        if self.input_done {
            return Poll::Pending;
        }
        match self.input.as_mut().poll_next(cx) {
            Poll::Pending => Poll::Pending,
            Poll::Ready(Some(Err(e))) => Poll::Ready(Err(e)),
            Poll::Ready(Some(Ok(item))) => {
                (self.validate)(&item, None)?;
                match item {
                    Input::String(text) => {
                        if text.encode_utf16().count() > 2000 {
                            return Poll::Ready(Err(failure(
                                "Inworld text chunks must not exceed 2000 characters",
                            )));
                        }
                        if !text.is_empty() {
                            self.send(Map::from([(
                                "send_text".into(),
                                JsonValue::Object(Map::from([(
                                    "text".into(),
                                    JsonValue::String(text),
                                )])),
                            )]))?;
                        }
                    }
                    Input::Flush(_) => self.send(Map::from([(
                        "flush_context".into(),
                        JsonValue::Object(Map::new()),
                    )]))?,
                }
                Poll::Ready(Ok(Step::Continue))
            }
            Poll::Ready(None) => {
                // A normal close may arrive while the final write is still draining.
                self.input_done = true;
                self.send(Map::from([(
                    "close_context".into(),
                    JsonValue::Object(Map::new()),
                )]))?;
                Poll::Ready(Ok(Step::Continue))
            }
        }
    }
    fn receive(&mut self, cx: &mut Context<'_>) -> Poll<Result<Step, TransportError>> {
        let message = match self.socket.as_mut().poll_receive(cx) {
            Poll::Pending => return Poll::Pending,
            Poll::Ready(None) => {
                return Poll::Ready(Err(failure(
                    "Inworld WebSocket closed before contextClosed",
                )))
            }
            Poll::Ready(Some(v)) => v?,
        };

        let Message::Text(message) = message else {
            return Poll::Ready(Err(failure("Inworld returned a non-text WebSocket frame")));
        };
        if message.len() > self.limit {
            return Poll::Ready(Err(failure("Inworld message exceeds max_message_bytes")));
        }
        let fields = protocol::result(&message)?;
        if let Some(status) = fields.get("status") {
            protocol::status(
                &status
                    .object()
                    .map_err(|_| failure("Inworld returned an invalid object"))?,
            )?;
        }
        if fields
            .get("contextId")
            .and_then(|v| v.string().ok())
            .as_deref()
            != Some(self.context_id.as_str())
        {
            return Poll::Ready(Err(failure("Inworld returned an unexpected context ID")));
        }
        let kinds: Vec<_> = [
            "contextCreated",
            "audioChunk",
            "flushCompleted",
            "contextClosed",
        ]
        .into_iter()
        .filter(|k| fields.contains_key(*k))
        .collect();
        if kinds.len() != 1 {
            return Poll::Ready(Err(failure("Inworld returned an invalid context event")));
        }
        let kind = kinds[0];
        let value = fields[kind]
            .object()
            .map_err(|_| failure("Inworld returned an invalid object"))?;
        if kind == "contextCreated" {
            if self.created {
                return Poll::Ready(Err(failure("Inworld returned duplicate contextCreated")));
            }
            self.created = true;
            return Poll::Ready(Ok(Step::Continue));
        }
        if !self.created {
            return Poll::Ready(Err(failure(
                "Inworld returned output before contextCreated",
            )));
        }
        let group = format!("{}:{}", self.context_id, self.flush);
        match kind {
            "audioChunk" => {
                let item = protocol::audio(
                    &value,
                    self.timed,
                    self.chunk,
                    Some(group),
                    self.wave.as_mut(),
                )?;
                Poll::Ready(Ok(item.map_or(Step::Continue, Step::Item)))
            }
            "flushCompleted" => {
                if let Some(w) = &mut self.wave {
                    w.boundary()?;
                }
                let ordinal = self.flush.to_string();
                self.flush = self
                    .flush
                    .checked_add(1)
                    .ok_or_else(|| failure("Inworld flush ordinal overflow"))?;
                Poll::Ready(Ok(Step::Item(SynthesisItem::Flush(FlushEvent {
                    event: FlushEventEvent,
                    correlation_id: group,
                    input_group_id: Some(ordinal),
                }))))
            }
            _ => {
                if !self.input_done {
                    return Poll::Ready(Err(failure(
                        "Inworld completed before the input stream ended",
                    )));
                }
                if let Some(w) = &mut self.wave {
                    w.boundary()?;
                }
                Poll::Ready(Ok(Step::Done))
            }
        }
    }
}
