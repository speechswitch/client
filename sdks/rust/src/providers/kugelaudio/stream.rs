use super::{
    protocol::{self, failure},
    settings::{self, Map, Settings, Validator},
    Input,
};
use crate::{
    generated::kugelaudio_output::*,
    http::TransportError,
    json,
    runtime::{InputStream, JsonValue, StreamingInput},
    websocket::{Message, Socket},
};
use std::{
    collections::BTreeMap,
    pin::Pin,
    task::{Context, Poll},
};

enum State {
    Http(StreamingInput<Vec<u8>>),
    Socket(SocketStream),
}
enum Step {
    Continue,
    Item(SynthesisItem),
    Final(SynthesisItem),
    Done,
}
type Next = Poll<Result<Step, TransportError>>;
/// Owns input and network I/O. Drop cancels; terminal items release I/O immediately.
pub struct Stream {
    state: Option<State>,
}
impl Stream {
    pub(super) fn http(body: StreamingInput<Vec<u8>>) -> Self {
        Self {
            state: Some(State::Http(body)),
        }
    }
    pub(super) fn socket(
        socket: Socket,
        c: Settings,
        limit: usize,
        validate: Validator,
        warning: Box<dyn FnMut(&str) + Send>,
    ) -> Self {
        let live = c.input.is_some();
        Self {
            state: Some(State::Socket(SocketStream {
                socket,
                input: c.input,
                create: Some(c.body),
                rate: c.rate,
                encoding: c.encoding,
                timed: c.timed,
                live,
                limit,
                validate,
                warning,
                phase: if live { Phase::Idle } else { Phase::Active },
                held: None,
                input_done: !live,
                writing: false,
                closing: false,
                prefer_output: true,
                final_seen: false,
                turn: 0,
                updates: 0,
                samples: BTreeMap::new(),
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
            State::Http(body) => match body.as_mut().poll_next(cx) {
                Poll::Pending => Poll::Pending,
                Poll::Ready(None) => Poll::Ready(Ok(Step::Done)),
                Poll::Ready(Some(Err(e))) => Poll::Ready(Err(e)),
                Poll::Ready(Some(Ok(bytes))) => Poll::Ready(Ok(if bytes.is_empty() {
                    Step::Continue
                } else {
                    Step::Item(SynthesisItem::Bytes(bytes))
                })),
            },
            State::Socket(socket) => socket.next(cx),
        };
        match result {
            Poll::Pending => Poll::Pending,
            Poll::Ready(Ok(Step::Continue)) => {
                cx.waker().wake_by_ref();
                Poll::Pending
            }
            Poll::Ready(Ok(Step::Item(item))) => Poll::Ready(Some(Ok(item))),
            Poll::Ready(Ok(Step::Final(item))) => {
                s.state = None;
                Poll::Ready(Some(Ok(item)))
            }
            Poll::Ready(Ok(Step::Done)) => {
                s.state = None;
                Poll::Ready(None)
            }
            Poll::Ready(Err(e)) => {
                s.state = None;
                Poll::Ready(Some(Err(e)))
            }
        }
    }
}
#[derive(PartialEq, Eq)]
enum Phase {
    Idle,
    Active,
    Flushing,
    Clearing,
}
struct SocketStream {
    // Field order drops the socket before the owned producer.
    socket: Socket,
    input: Option<StreamingInput<Input>>,
    create: Option<Map>,
    validate: Validator,
    warning: Box<dyn FnMut(&str) + Send>,
    rate: f64,
    encoding: &'static str,
    timed: bool,
    live: bool,
    limit: usize,
    phase: Phase,
    held: Option<Input>,
    input_done: bool,
    writing: bool,
    closing: bool,
    prefer_output: bool,
    final_seen: bool,
    turn: u64,
    updates: u64,
    samples: BTreeMap<u64, u64>,
}
impl SocketStream {
    fn send(&mut self, fields: Map) -> Result<(), TransportError> {
        let mut data = String::new();
        json::write(&JsonValue::Object(fields), &mut data)?;
        if data.len() > self.limit {
            return Err(failure("KugelAudio message exceeds max_message_bytes"));
        }
        self.socket.as_mut().start_send(Message::Text(data))?;
        self.writing = true;
        Ok(())
    }
    fn next(&mut self, cx: &mut Context<'_>) -> Next {
        if let Some(create) = self.create.take() {
            self.send(create)?;
            return Poll::Ready(Ok(Step::Continue));
        }
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
                Poll::Ready(value) => {
                    self.prefer_output = !output;
                    return Poll::Ready(value);
                }
            }
        }
        Poll::Pending
    }
    fn input(&mut self, cx: &mut Context<'_>) -> Next {
        if self.writing {
            match self.socket.as_mut().poll_flush(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(value) => value?,
            }
            self.writing = false;
            return Poll::Ready(Ok(if self.closing {
                Step::Done
            } else {
                Step::Continue
            }));
        }
        if self.live && self.input_done && self.phase == Phase::Idle && self.updates == 0 {
            self.closing = true;
            self.send(Map::from([("close_socket".into(), JsonValue::Bool(true))]))?;
            return Poll::Ready(Ok(Step::Continue));
        }
        if self.input_done {
            return Poll::Pending;
        }
        if self.held.is_none() {
            let input = self.input.as_mut().expect("live input");
            match input.as_mut().poll_next(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(Some(Err(e))) => return Poll::Ready(Err(e)),
                Poll::Ready(Some(Ok(item))) => {
                    (self.validate)(&item, None)?;
                    self.held = Some(item);
                }
                Poll::Ready(None) => {
                    self.input_done = true;
                    if self.phase == Phase::Active {
                        self.phase = Phase::Flushing;
                        self.send(Map::from([("flush".into(), JsonValue::Bool(true))]))?;
                    }
                    return Poll::Ready(Ok(Step::Continue));
                }
            }
        }
        let ready = self.phase == Phase::Idle
            || self.phase == Phase::Active
            || (self.phase != Phase::Clearing
                && matches!(self.held, Some(Input::Clear(_) | Input::Update(_))));
        if !ready {
            return Poll::Pending;
        }
        match self.held.take().unwrap() {
            Input::String(text) => {
                if text.encode_utf16().count() > 10000 {
                    return Poll::Ready(Err(failure(
                        "KugelAudio text fragments must not exceed 10000 characters",
                    )));
                }
                if !text.is_empty() {
                    self.phase = Phase::Active;
                    self.send(Map::from([("text".into(), JsonValue::String(text))]))?;
                }
            }
            Input::Clear(_) => {
                self.phase = Phase::Clearing;
                self.send(Map::from([("cancel".into(), JsonValue::Bool(true))]))?;
            }
            Input::Flush(_) => {
                if self.phase == Phase::Active {
                    self.phase = Phase::Flushing;
                    self.send(Map::from([("flush".into(), JsonValue::Bool(true))]))?;
                }
            }
            Input::Update(value) => {
                self.updates = self
                    .updates
                    .checked_add(1)
                    .ok_or_else(|| failure("KugelAudio update count overflow"))?;
                self.send(settings::update(value))?;
            }
        }
        Poll::Ready(Ok(Step::Continue))
    }
    fn reset_turn(&mut self) -> Result<(), TransportError> {
        self.phase = Phase::Idle;
        self.final_seen = false;
        self.samples.clear();
        self.turn = self
            .turn
            .checked_add(1)
            .ok_or_else(|| failure("KugelAudio turn ordinal overflow"))?;
        Ok(())
    }
    fn receive(&mut self, cx: &mut Context<'_>) -> Next {
        let message = match self.socket.as_mut().poll_receive(cx) {
            Poll::Pending => return Poll::Pending,
            Poll::Ready(None) => {
                return Poll::Ready(if self.closing {
                    Ok(Step::Done)
                } else {
                    Err(failure(
                        "KugelAudio WebSocket closed before synthesis completed",
                    ))
                })
            }
            Poll::Ready(Some(value)) => value?,
        };
        let Message::Text(message) = message else {
            return Poll::Ready(Err(failure(
                "KugelAudio returned a non-text WebSocket frame",
            )));
        };
        if message.len() > self.limit {
            return Poll::Ready(Err(failure("KugelAudio message exceeds max_message_bytes")));
        }
        let f = protocol::decode(&message)?;
        let kinds: Vec<_> = [
            "error",
            "audio",
            "word_timestamps",
            "generation_started",
            "chunk_complete",
            "interrupted",
            "settings_updated",
            "warning",
            "final",
            "session_closed",
        ]
        .into_iter()
        .filter(|k| f.contains_key(*k))
        .collect();
        if kinds.len() != 1 {
            return Poll::Ready(Err(failure("KugelAudio returned an invalid event")));
        }
        let kind = kinds[0];
        if matches!(
            kind,
            "generation_started"
                | "chunk_complete"
                | "interrupted"
                | "settings_updated"
                | "final"
                | "session_closed"
        ) && f[kind].boolean().ok() != Some(true)
        {
            return Poll::Ready(Err(failure("KugelAudio returned an invalid event flag")));
        }
        match kind {
            "error" => {
                let message = f["error"]
                    .string()
                    .map_err(|_| failure("KugelAudio returned an invalid error"))?;
                let code = f
                    .get("error_code")
                    .and_then(|v| v.string().ok())
                    .ok_or_else(|| failure("KugelAudio returned an invalid error"))?;
                return Poll::Ready(Err(Box::new(protocol::Error {
                    message,
                    code: Some(code),
                    status: Some(protocol::number(&f, "code", true)? as u64),
                    retry_after: None,
                })));
            }
            "warning" => {
                let message = f["warning"]
                    .string()
                    .map_err(|_| failure("KugelAudio returned an invalid warning"))?;
                (self.warning)(&message);
                return Poll::Ready(Ok(Step::Continue));
            }
            "settings_updated" => {
                if self.updates == 0 {
                    return Poll::Ready(Err(failure(
                        "KugelAudio returned an unsolicited settings acknowledgement",
                    )));
                }
                self.updates -= 1;
                return Poll::Ready(Ok(Step::Item(protocol::updated(f.get("settings"))?)));
            }
            "interrupted" => {
                if self.phase != Phase::Clearing {
                    return Poll::Ready(Err(failure(
                        "KugelAudio returned an unsolicited interruption",
                    )));
                }
                self.reset_turn()?;
                return Poll::Ready(Ok(Step::Item(SynthesisItem::Clear(SynthesisItemClear {
                    event: SynthesisItemClearEvent,
                }))));
            }
            _ => {}
        }
        if self.phase == Phase::Clearing {
            return Poll::Ready(Ok(Step::Continue));
        }
        match kind {
            "final" => {
                if self.phase == Phase::Idle || self.final_seen {
                    return Poll::Ready(Err(failure("KugelAudio returned an unexpected final")));
                }
                if !self.live {
                    return Poll::Ready(Ok(Step::Final(SynthesisItem::Done(
                        KugelAudioDoneEvent {
                            event: KugelAudioDoneEventEvent,
                            usage: protocol::usage(&f)?,
                        },
                    ))));
                }
                self.final_seen = true;
                self.phase = Phase::Flushing;
                return Poll::Ready(Ok(Step::Continue));
            }
            "session_closed" => {
                if !self.live || !self.final_seen {
                    return Poll::Ready(Err(failure("KugelAudio ended a turn before final")));
                }
                let event = KugelAudioTurnEvent {
                    event: KugelAudioTurnEventEvent,
                    correlation_id: self.turn.to_string(),
                    input_group_id: self.turn.to_string(),
                    usage: protocol::usage(&f)?,
                };
                self.reset_turn()?;
                return Poll::Ready(Ok(Step::Item(SynthesisItem::Flush(event))));
            }
            _ => {}
        }
        if self.phase == Phase::Idle || self.final_seen {
            return Poll::Ready(Err(failure(
                "KugelAudio returned output outside an active turn",
            )));
        }
        let id = protocol::number(&f, "chunk_id", true)? as u64;
        let mut group = KugelAudioEnvelope {
            correlation: KugelAudioEnvelopeCorrelation,
            correlation_id: format!("{}:{id}", self.turn),
            input_group_id: self.turn.to_string(),
            chunk_id: id as f64,
            audio: None,
            audio_timing: None,
            timestamps: vec![],
        };
        match kind {
            "audio" => {
                let (audio, count) = protocol::audio(&f, self.encoding, self.rate)?;
                let start = *self.samples.get(&id).unwrap_or(&0);
                let end = start + count;
                if end > 9007199254740991 {
                    return Poll::Ready(Err(failure("KugelAudio audio sample count overflow")));
                }
                self.samples.insert(id, end);
                if !self.timed {
                    return Poll::Ready(Ok(Step::Item(SynthesisItem::Bytes(audio))));
                }
                group.audio = Some(audio);
                group.audio_timing = Some(KugelAudioEnvelopeAudioTiming {
                    start_time_ms: start as f64 / self.rate * 1000.0,
                    end_time_ms: end as f64 / self.rate * 1000.0,
                });
                Poll::Ready(Ok(Step::Item(SynthesisItem::Ordered(group))))
            }
            "word_timestamps" => {
                group.timestamps = protocol::alignment(f["word_timestamps"])?;
                if !self.timed {
                    return Poll::Ready(Err(failure("KugelAudio returned unrequested timestamps")));
                }
                Poll::Ready(Ok(Step::Item(SynthesisItem::Ordered(group))))
            }
            "generation_started" => {
                f.get("text")
                    .and_then(|v| v.string().ok())
                    .ok_or_else(|| failure("KugelAudio returned invalid generated text"))?;
                Poll::Ready(Ok(Step::Continue))
            }
            _ => {
                protocol::number(&f, "audio_seconds", false)?;
                protocol::number(&f, "gen_ms", false)?;
                Poll::Ready(Ok(Step::Continue))
            }
        }
    }
}
