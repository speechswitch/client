use super::{
    protocol::{self, failure, Error, Packet},
    settings::{Map, Settings, Validator},
    Input, SynthesisItem,
};
use crate::{
    generated::minimax_output::*,
    http::TransportError,
    json,
    runtime::{JsonValue, StreamingInput},
    websocket::{Message, Socket},
};
use std::{
    collections::VecDeque,
    sync::Arc,
    task::{Context, Poll, Wake, Waker},
};

pub(super) struct SocketStream {
    // Drop the socket before producer cleanup.
    socket: Socket,
    input: StreamingInput<Input>,
    validate: Validator,
    create: Option<Map>,
    session: String,
    connection: Option<String>,
    limit: usize,
    connected: bool,
    started: bool,
    acknowledged: bool,
    writing: bool,
    finishing: bool,
    clearing: bool,
    queued: Option<Option<Input>>,
    pieces: VecDeque<String>,
    whitespace: String,
    final_packet: Option<Packet>,
    prefer_output: bool,
    pub done: bool,
}
enum Step {
    Progress,
    Item(SynthesisItem),
}
impl SocketStream {
    pub fn new(
        socket: Socket,
        mut settings: Settings,
        session: String,
        limit: usize,
        validate: Validator,
    ) -> Self {
        settings
            .wire
            .insert("event".into(), JsonValue::String("task_start".into()));
        settings
            .wire
            .insert("session_id".into(), JsonValue::String(session.clone()));
        settings
            .wire
            .insert("subtitle_enable".into(), JsonValue::Bool(false));
        Self {
            socket,
            input: settings.input.take().unwrap(),
            validate,
            create: Some(settings.wire),
            session,
            connection: None,
            limit,
            connected: false,
            started: false,
            acknowledged: false,
            writing: false,
            finishing: false,
            clearing: false,
            queued: None,
            pieces: VecDeque::new(),
            whitespace: String::new(),
            final_packet: None,
            prefer_output: true,
            done: false,
        }
    }
    fn send(&mut self, fields: Map) -> Result<(), TransportError> {
        let mut data = String::new();
        json::write(&JsonValue::Object(fields), &mut data)?;
        self.socket.as_mut().start_send(Message::Text(data))?;
        self.writing = true;
        Ok(())
    }
    pub fn next(
        &mut self,
        cx: &mut Context<'_>,
    ) -> Poll<Result<Option<SynthesisItem>, TransportError>> {
        if self.final_packet.is_some() {
            if self.writing {
                match self.socket.as_mut().poll_flush(cx) {
                    Poll::Pending => return Poll::Pending,
                    Poll::Ready(v) => v?,
                }
                self.writing = false;
            }
            let p = self.final_packet.take().unwrap();
            self.done = true;
            return Poll::Ready(Ok(Some(SynthesisItem::Done(MiniMaxDoneEvent {
                event: Default::default(),
                trace_id: p.trace,
                usage: p.usage,
            }))));
        }
        for output in if self.prefer_output {
            [true, false]
        } else {
            [false, true]
        } {
            match if output {
                self.receive(cx)
            } else {
                self.produce(cx)
            } {
                Poll::Pending => {}
                Poll::Ready(Err(e)) => return Poll::Ready(Err(e)),
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
    fn produce(&mut self, cx: &mut Context<'_>) -> Poll<Result<Step, TransportError>> {
        if self.writing {
            match self.socket.as_mut().poll_flush(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(v) => v?,
            }
            self.writing = false;
            return Poll::Ready(Ok(Step::Progress));
        }
        if !self.connected {
            return Poll::Pending;
        }
        if let Some(create) = self.create.take() {
            self.started = true;
            self.send(create)?;
            return Poll::Ready(Ok(Step::Progress));
        }
        if !self.acknowledged || self.finishing {
            return Poll::Pending;
        }
        if let Some(piece) = self.pieces.pop_front() {
            self.send(Map::from([
                ("event".into(), JsonValue::String("task_continue".into())),
                ("text".into(), JsonValue::String(piece)),
            ]))?;
            return Poll::Ready(Ok(Step::Progress));
        }
        if self.queued.is_none() {
            match self.input.as_mut().poll_next(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(Some(Err(e))) => return Poll::Ready(Err(e)),
                Poll::Ready(item) => {
                    let item = item.transpose()?;
                    if let Some(item) = &item {
                        (self.validate)(item, Some("text"))?;
                    }
                    self.queued = Some(item);
                }
            }
        }
        // One prefetched input lets a producer error interrupt a stalled cancel acknowledgement.
        if self.clearing {
            return Poll::Pending;
        }
        let Some(item) = self.queued.take().unwrap() else {
            self.finishing = true;
            self.send(Map::from([(
                "event".into(),
                JsonValue::String("task_finish".into()),
            )]))?;
            return Poll::Ready(Ok(Step::Progress));
        };
        match item {
            Input::String(value) => {
                if value.encode_utf16().count() >= 10000 {
                    return Poll::Ready(Err(failure(
                        "MiniMax text pieces must contain fewer than 10000 UTF-16 code units",
                    )));
                }
                let mut text = std::mem::take(&mut self.whitespace);
                text.push_str(&value);
                if text.trim_matches(WHITESPACE).is_empty() {
                    if text.encode_utf16().count() >= 10000 {
                        return Poll::Ready(Err(failure(
                            "MiniMax pending whitespace exceeds a native message",
                        )));
                    }
                    self.whitespace = text;
                } else {
                    let mut rest = text.as_str();
                    while !rest.is_empty() {
                        let mut end = 0;
                        let mut units = 0;
                        for (i, c) in rest.char_indices() {
                            if units + c.len_utf16() > 9999 {
                                break;
                            }
                            units += c.len_utf16();
                            end = i + c.len_utf8();
                        }
                        let (piece, tail) = rest.split_at(end);
                        if piece.trim_matches(WHITESPACE).is_empty() {
                            if !tail.is_empty() {
                                return Poll::Ready(Err(failure(
                                    "MiniMax pending whitespace exceeds a native message",
                                )));
                            }
                            self.whitespace = piece.into();
                        } else {
                            self.pieces.push_back(piece.into());
                        }
                        rest = tail;
                    }
                }
            }
            Input::Clear(_) => {
                self.whitespace.clear();
                self.clearing = true;
                self.send(Map::from([(
                    "event".into(),
                    JsonValue::String("task_cancel".into()),
                )]))?;
            }
            Input::Flush(_) => {
                self.whitespace.clear();
                self.send(Map::from([(
                    "event".into(),
                    JsonValue::String("task_flush".into()),
                )]))?;
            }
        }
        Poll::Ready(Ok(Step::Progress))
    }
    fn receive(&mut self, cx: &mut Context<'_>) -> Poll<Result<Step, TransportError>> {
        let data = match self.socket.as_mut().poll_receive(cx) {
            Poll::Pending => return Poll::Pending,
            Poll::Ready(None) => {
                return Poll::Ready(Err(failure(
                    "MiniMax WebSocket closed before task_finished",
                )))
            }
            Poll::Ready(Some(Err(e))) => return Poll::Ready(Err(e)),
            Poll::Ready(Some(Ok(Message::Binary(_)))) => {
                return Poll::Ready(Err(failure("MiniMax WebSocket messages must be JSON text")))
            }
            Poll::Ready(Some(Ok(Message::Text(v)))) => v,
        };
        if data.len() > self.limit {
            return Poll::Ready(Err(failure("MiniMax message exceeds max_message_bytes")));
        }
        let p = protocol::packet(&data)?;
        if p.code.is_some() {
            return Poll::Ready(Err(Box::new(Error {
                message: p.message,
                code: p.code,
                status: None,
                retry_after: None,
            })));
        }
        if !self.connected {
            if p.event.as_deref() != Some("connected_success") {
                return Poll::Ready(Err(failure("MiniMax did not acknowledge the connection")));
            }
            self.connection = p.connection.or(p.session);
            self.connected = true;
            return Poll::Ready(Ok(Step::Progress));
        }
        if p.session.as_ref().is_some_and(|v| v != &self.session) {
            return Poll::Ready(Err(failure("MiniMax returned an unexpected session ID")));
        }
        if p.connection
            .as_ref()
            .zip(self.connection.as_ref())
            .is_some_and(|(a, b)| a != b)
        {
            return Poll::Ready(Err(failure("MiniMax returned an unexpected connection ID")));
        }
        if !self.acknowledged {
            if !self.started || p.event.as_deref() != Some("task_started") {
                return Poll::Ready(Err(failure("MiniMax did not acknowledge task_start")));
            }
            self.acknowledged = true;
            return Poll::Ready(Ok(Step::Progress));
        }
        let event = p
            .event
            .as_deref()
            .unwrap_or(if p.audio.is_some() || p.final_audio.is_some() {
                "task_continued"
            } else {
                ""
            });
        if event == "task_failed" {
            return Poll::Ready(Err(Box::new(Error {
                message: if p.message.is_empty() {
                    "MiniMax synthesis task failed".into()
                } else {
                    p.message
                },
                code: p.code,
                status: None,
                retry_after: None,
            })));
        }
        if event == "task_finished" && self.clearing {
            return Poll::Ready(Err(failure(
                "MiniMax ended the session before acknowledging cancellation",
            )));
        }
        if event == "task_canceled" {
            if !self.clearing {
                return Poll::Ready(Err(failure(
                    "MiniMax returned an unsolicited cancel acknowledgement",
                )));
            }
            self.clearing = false;
            return Poll::Ready(Ok(Step::Item(SynthesisItem::Clear(ClearEvent {
                event: Default::default(),
            }))));
        }
        if self.clearing {
            return Poll::Ready(Ok(Step::Progress));
        }
        match event {
            "task_finished" => {
                if !self.finishing {
                    return Poll::Ready(Err(failure(
                        "MiniMax ended the session before task_finish",
                    )));
                }
                self.final_packet = Some(p);
                Poll::Ready(Ok(Step::Progress))
            }
            "task_flushed" => Poll::Ready(Ok(Step::Item(SynthesisItem::Flush(FlushEvent {
                event: Default::default(),
                correlation_id: p.trace.unwrap_or_else(|| self.session.clone()),
                input_group_id: Some(self.session.clone()),
            })))),
            "task_continued" | "sentence_start" | "sentence_end" => {
                let mut e = protocol::envelope(false, p.trace.clone());
                e.input_group_id = Some(self.session.clone());
                e.correlation_id = p.trace;
                match event {
                    "sentence_start" => {
                        e.sentence_boundary =
                            Some(MiniMaxEnvelopeSentenceBoundary::Start(Default::default()))
                    }
                    "sentence_end" => {
                        e.sentence_boundary =
                            Some(MiniMaxEnvelopeSentenceBoundary::End(Default::default()))
                    }
                    _ => {
                        e.audio = p.audio.filter(|v| !v.is_empty());
                        if p.final_audio == Some(true) {
                            e.request_complete =
                                Some(MiniMaxEnvelopeRequestComplete::True(Default::default()));
                        }
                        e.usage = p.usage;
                        if e.audio.is_none() && e.request_complete.is_none() && e.usage.is_none() {
                            return Poll::Ready(Ok(Step::Progress));
                        }
                    }
                }
                Poll::Ready(Ok(Step::Item(SynthesisItem::OrderedOrTimeline(e))))
            }
            _ => Poll::Ready(Ok(Step::Progress)),
        }
    }
}
// Match ECMAScript trim rather than Rust's broader Unicode whitespace definition.
const WHITESPACE: &[char] = &[
    ' ', '\t', '\n', '\r', '\u{b}', '\u{c}', '\u{a0}', '\u{1680}', '\u{2000}', '\u{2001}',
    '\u{2002}', '\u{2003}', '\u{2004}', '\u{2005}', '\u{2006}', '\u{2007}', '\u{2008}', '\u{2009}',
    '\u{200a}', '\u{2028}', '\u{2029}', '\u{202f}', '\u{205f}', '\u{3000}', '\u{feff}',
];
impl Drop for SocketStream {
    fn drop(&mut self) {
        // Never overlap an outstanding write, block Drop, or claim a delivered cancellation.
        if self.started && !self.done && !self.writing {
            if self
                .socket
                .as_mut()
                .start_send(Message::Text("{\"event\":\"task_cancel\"}".into()))
                .is_ok()
            {
                struct Noop;
                impl Wake for Noop {
                    fn wake(self: Arc<Self>) {}
                }
                let waker = Waker::from(Arc::new(Noop));
                let _ = self
                    .socket
                    .as_mut()
                    .poll_flush(&mut Context::from_waker(&waker));
            }
        }
    }
}
