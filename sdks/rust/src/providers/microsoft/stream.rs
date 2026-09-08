use super::{
    protocol::{self, failure},
    settings::Settings,
};
use crate::{
    generated::microsoft_output::*,
    http::TransportError,
    json,
    runtime::{InputStream, JsonValue, StreamingInput, ValidationError},
    websocket::{Message, Socket},
};
use std::{
    any::Any,
    collections::{BTreeMap, VecDeque},
    pin::Pin,
    sync::Arc,
    task::{Context, Poll, Wake, Waker},
};

type Validator = Box<dyn Fn(&dyn Any, Option<&str>) -> Result<(), ValidationError> + Send>;
type Next = Poll<Result<Option<SynthesisItem>, TransportError>>;
enum State {
    Http(StreamingInput<Vec<u8>>),
    Socket(SocketStream),
}
/// Owns I/O and input. Drop cancels; EOF/error releases resources immediately.
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
        settings: Settings,
        id: String,
        limit: usize,
        validate: Validator,
    ) -> Result<Self, TransportError> {
        let mut audio = BTreeMap::new();
        audio.insert(
            "outputFormat".into(),
            JsonValue::String(settings.format.clone()),
        );
        let mut metadata = BTreeMap::new();
        for (key, kind) in [
            ("wordBoundaryEnabled", "word"),
            ("sentenceBoundaryEnabled", "sentence"),
            ("bookmarkEnabled", "ssml"),
            ("visemeEnabled", "viseme"),
        ] {
            metadata.insert(key.into(), JsonValue::Bool(settings.tracks.contains(kind)));
        }
        metadata.insert("punctuationBoundaryEnabled".into(), JsonValue::Bool(false));
        metadata.insert("sessionEndEnabled".into(), JsonValue::Bool(true));
        audio.insert("metadataOptions".into(), JsonValue::Object(metadata));
        let mut synthesis = BTreeMap::from([
            ("audio".into(), JsonValue::Object(audio)),
            (
                "language".into(),
                JsonValue::Object(BTreeMap::from([(
                    "autoDetection".into(),
                    JsonValue::Bool(false),
                )])),
            ),
        ]);
        if settings.input.is_some() {
            synthesis.insert("input".into(), JsonValue::Object(settings.native.clone()));
        }
        let mut context = String::new();
        json::write(
            &JsonValue::Object(BTreeMap::from([(
                "synthesis".into(),
                JsonValue::Object(synthesis),
            )])),
            &mut context,
        )?;
        let mut initial=VecDeque::from([("speech.config",r#"{"context":{"system":{"name":"speechswitch","version":"0.0.0","build":"Rust"}}}"#.to_owned()),("synthesis.context",context)]);
        if settings.input.is_none() {
            initial.push_back(("ssml", settings.markup.clone()));
        }
        Ok(Self {
            state: Some(State::Socket(SocketStream {
                socket,
                settings,
                id,
                limit,
                validate,
                initial,
                writing: false,
                started: false,
                input_done: false,
                done: false,
                acknowledged: false,
                prefer_output: true,
                stream_id: None,
                duration: None,
            })),
        })
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
            State::Socket(socket) => socket.next(cx),
            State::Http(body) => match body.as_mut().poll_next(cx) {
                Poll::Pending => Poll::Pending,
                Poll::Ready(None) => Poll::Ready(Ok(None)),
                Poll::Ready(Some(Err(err))) => Poll::Ready(Err(err)),
                Poll::Ready(Some(Ok(bytes))) => {
                    if bytes.is_empty() {
                        cx.waker().wake_by_ref();
                        Poll::Pending
                    } else {
                        Poll::Ready(Ok(Some(SynthesisItem::Bytes(bytes))))
                    }
                }
            },
        };
        match result {
            Poll::Pending => Poll::Pending,
            Poll::Ready(Ok(Some(item))) => {
                if matches!(&item, SynthesisItem::Done(_)) {
                    s.state = None;
                }
                Poll::Ready(Some(Ok(item)))
            }
            Poll::Ready(Ok(None)) => {
                s.state = None;
                Poll::Ready(None)
            }
            Poll::Ready(Err(err)) => {
                s.state = None;
                Poll::Ready(Some(Err(err)))
            }
        }
    }
}
struct SocketStream {
    // Drop the network before producer cleanup, including cancellation between polls.
    socket: Socket,
    settings: Settings,
    id: String,
    limit: usize,
    validate: Validator,
    initial: VecDeque<(&'static str, String)>,
    writing: bool,
    started: bool,
    input_done: bool,
    done: bool,
    acknowledged: bool,
    prefer_output: bool,
    stream_id: Option<String>,
    duration: Option<f64>,
}
enum Step {
    Continue,
    Item(SynthesisItem),
}
impl SocketStream {
    fn send(&mut self, path: &str, body: String) -> Result<(), TransportError> {
        self.started = true;
        self.socket
            .as_mut()
            .start_send(protocol::encode(path, &self.id, body)?)?;
        self.writing = true;
        Ok(())
    }
    fn next(&mut self, cx: &mut Context<'_>) -> Next {
        if self.acknowledged && !self.writing {
            self.done = true;
            return Poll::Ready(Ok(Some(SynthesisItem::Done(MicrosoftDoneEvent {
                event: MicrosoftDoneEventEvent,
                request_id: self.id.clone(),
                duration_ms: self.duration,
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
                self.input(cx)
            } {
                Poll::Pending => {}
                Poll::Ready(Err(err)) => return Poll::Ready(Err(err)),
                Poll::Ready(Ok(step)) => {
                    self.prefer_output = !output;
                    match step {
                        Step::Item(item) => return Poll::Ready(Ok(Some(item))),
                        Step::Continue => {
                            cx.waker().wake_by_ref();
                            return Poll::Pending;
                        }
                    }
                }
            }
        }
        Poll::Pending
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
        if let Some((path, body)) = self.initial.pop_front() {
            if path == "ssml" {
                self.input_done = true;
            }
            self.send(path, body)?;
            return Poll::Ready(Ok(Step::Continue));
        }
        if self.input_done {
            return Poll::Pending;
        }
        let Some(input) = &mut self.settings.input else {
            return Poll::Pending;
        };
        let text = match input.as_mut().poll_next(cx) {
            Poll::Pending => return Poll::Pending,
            Poll::Ready(Some(Err(err))) => return Poll::Ready(Err(err)),
            Poll::Ready(None) => {
                self.settings.input = None;
                self.input_done = true;
                self.send("text.end", String::new())?;
                return Poll::Ready(Ok(Step::Continue));
            }
            Poll::Ready(Some(Ok(text))) => text,
        };
        (self.validate)(&text, None)?;
        self.send("text.piece", text)?;
        Poll::Ready(Ok(Step::Continue))
    }
    fn receive(&mut self, cx: &mut Context<'_>) -> Poll<Result<Step, TransportError>> {
        if self.acknowledged {
            return Poll::Pending;
        }
        let message = match self.socket.as_mut().poll_receive(cx) {
            Poll::Pending => return Poll::Pending,
            Poll::Ready(None) => {
                return Poll::Ready(Err(failure("Microsoft WebSocket closed before turn.end")))
            }
            Poll::Ready(Some(result)) => result?,
        };
        let frame = protocol::decode(message, self.limit)?;
        if !frame.request_id.eq_ignore_ascii_case(&self.id) {
            return Poll::Ready(Err(failure(
                "Microsoft returned an unexpected synthesis request ID",
            )));
        }
        match frame.path.as_str() {
            "turn.start" | "turn.end" => {
                if !matches!(frame.body, Message::Text(_)) {
                    return Poll::Ready(Err(failure("Microsoft turn event must be a text frame")));
                }
                if frame.path == "turn.end" {
                    if !self.input_done {
                        return Poll::Ready(Err(failure(
                            "Microsoft ended synthesis before text.end",
                        )));
                    }
                    self.acknowledged = true;
                }
            }
            "audio" => {
                let Message::Binary(audio) = frame.body else {
                    return Poll::Ready(Err(failure(
                        "Microsoft audio frame is missing binary audio or X-StreamId",
                    )));
                };
                let id = frame.stream_id.filter(|v| !v.is_empty()).ok_or_else(|| {
                    failure("Microsoft audio frame is missing binary audio or X-StreamId")
                })?;
                if !self
                    .stream_id
                    .as_ref()
                    .is_some_and(|v| v.eq_ignore_ascii_case(&id))
                {
                    return Poll::Ready(Err(failure(
                        "Microsoft returned audio for an unexpected stream",
                    )));
                }
                if !audio.is_empty() {
                    return Poll::Ready(Ok(Step::Item(if self.settings.timed {
                        SynthesisItem::Timeline(MicrosoftEnvelope {
                            correlation: MicrosoftEnvelopeCorrelation,
                            correlation_id: self.id.clone(),
                            stream_id: self.stream_id.clone(),
                            audio: Some(audio),
                            timestamps: vec![],
                            duration_ms: None,
                        })
                    } else {
                        SynthesisItem::Bytes(audio)
                    })));
                }
            }
            "response" | "audio.metadata" => {
                let Message::Text(data) = frame.body else {
                    return Poll::Ready(Err(failure(
                        "Microsoft synthesis metadata must be a text frame",
                    )));
                };
                let body = protocol::object(&data)?;
                if frame.path == "response" {
                    let audio = body
                        .get("audio")
                        .and_then(|v| v.object().ok())
                        .ok_or_else(|| failure("Microsoft returned an invalid synthesis object"))?;
                    let id = audio
                        .get("streamId")
                        .and_then(|v| v.string().ok())
                        .filter(|v| !v.is_empty())
                        .ok_or_else(|| {
                            failure("Microsoft synthesis response is missing audio.streamId")
                        })?;
                    if self.stream_id.as_ref().is_some_and(|v| v != &id) {
                        return Poll::Ready(Err(failure(
                            "Microsoft changed the audio stream within a synthesis turn",
                        )));
                    }
                    self.stream_id = Some(id);
                } else {
                    if frame.stream_id.as_ref().is_some_and(|id| {
                        !self
                            .stream_id
                            .as_ref()
                            .is_some_and(|v| v.eq_ignore_ascii_case(id))
                    }) {
                        return Poll::Ready(Err(failure(
                            "Microsoft returned metadata for an unexpected stream",
                        )));
                    }
                    let (mut marks, duration) = protocol::metadata(body)?;
                    if duration.is_some() {
                        self.duration = duration;
                    }
                    marks.retain(|v| self.settings.tracks.contains(v.kind.value()));
                    if self.settings.timed && (!marks.is_empty() || duration.is_some()) {
                        return Poll::Ready(Ok(Step::Item(SynthesisItem::Timeline(
                            MicrosoftEnvelope {
                                correlation: MicrosoftEnvelopeCorrelation,
                                correlation_id: self.id.clone(),
                                stream_id: self.stream_id.clone(),
                                audio: None,
                                timestamps: marks,
                                duration_ms: duration,
                            },
                        ))));
                    }
                }
            }
            _ => {}
        }
        Poll::Ready(Ok(Step::Continue))
    }
}
struct StopWake;
impl Wake for StopWake {
    fn wake(self: Arc<Self>) {}
}
impl Drop for SocketStream {
    fn drop(&mut self) {
        // start_send must never overwrite an unfinished frame. If the writer is busy,
        // aborting the owned connection is the cancellation mechanism.
        if self.started && !self.done && !self.writing {
            if let Ok(message) =
                protocol::encode("synthesis.control", &self.id, r#"{"action":"stop"}"#.into())
            {
                if self.socket.as_mut().start_send(message).is_ok() {
                    let waker = Waker::from(Arc::new(StopWake));
                    let _ = self
                        .socket
                        .as_mut()
                        .poll_flush(&mut Context::from_waker(&waker));
                }
            }
        }
    }
}
