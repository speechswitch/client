use super::{
    settings::{self, Input, Settings},
    Error,
};
use crate::{
    base64,
    clients::{google_rest, google_rest_beta},
    grpc::Call,
    http::{HttpResponse, TransportError},
    http2::InputClosed,
    json::Raw,
    runtime::{InputStream, StreamingInput, ValidationError},
};
use std::{
    any::Any,
    pin::Pin,
    task::{Context, Poll},
};

type Validator = Box<dyn Fn(&dyn Any, Option<&str>) -> Result<(), ValidationError> + Send>;
type Next = Poll<Result<Option<Vec<u8>>, TransportError>>;
enum State {
    Http(HttpStream),
    Grpc(GrpcStream),
}
/// Owns both transport and producer. EOF, error and Drop release them promptly.
pub struct Stream {
    state: Option<State>,
}
impl Stream {
    pub(super) fn http(response: HttpResponse, limit: usize, beta: bool) -> Self {
        Self {
            state: Some(State::Http(HttpStream {
                body: Some(response.body),
                status: response.status,
                limit,
                beta,
                data: Vec::new(),
            })),
        }
    }
    pub(super) fn grpc(
        call: Call,
        settings: Settings,
        opening: Vec<u8>,
        limit: usize,
        validate: Validator,
    ) -> Self {
        Self {
            state: Some(State::Grpc(GrpcStream {
                call,
                settings,
                opening: Some(opening),
                limit,
                validate,
                writing: false,
                input_stopped: false,
                end_started: false,
                first: true,
                prefer_output: true,
            })),
        }
    }
}
impl InputStream<Vec<u8>> for Stream {
    fn poll_next(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Vec<u8>, TransportError>>> {
        let s = self.get_mut();
        let Some(state) = &mut s.state else {
            return Poll::Ready(None);
        };
        let result = match state {
            State::Http(s) => s.next(cx),
            State::Grpc(s) => s.next(cx),
        };
        match result {
            Poll::Pending => Poll::Pending,
            Poll::Ready(Ok(Some(bytes))) => {
                if matches!(state, State::Http(_)) {
                    s.state = None;
                }
                Poll::Ready(Some(Ok(bytes)))
            }
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
    body: Option<StreamingInput<Vec<u8>>>,
    status: u16,
    limit: usize,
    beta: bool,
    data: Vec<u8>,
}
impl HttpStream {
    fn next(&mut self, cx: &mut Context<'_>) -> Next {
        for _ in 0..32 {
            match self.body.as_mut().unwrap().as_mut().poll_next(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(Some(Err(error))) => return Poll::Ready(Err(error)),
                Poll::Ready(Some(Ok(bytes))) => {
                    if bytes.len() > self.limit - self.data.len() {
                        return Poll::Ready(Err(Error::Invalid(
                            "Google response exceeds max_json_bytes",
                        )
                        .into()));
                    }
                    self.data.extend(bytes);
                }
                Poll::Ready(None) => {
                    self.body = None;
                    if !(200..300).contains(&self.status) {
                        let text = String::from_utf8_lossy(
                            self.data
                                .strip_prefix(&[0xef, 0xbb, 0xbf])
                                .unwrap_or(&self.data),
                        );
                        let message = Raw::parse(&text)
                            .and_then(Raw::object)
                            .ok()
                            .and_then(|mut fields| fields.remove("error"))
                            .and_then(|error| error.object().ok())
                            .and_then(|mut fields| fields.remove("message"))
                            .and_then(|message| message.string().ok())
                            .unwrap_or_else(|| text.into_owned());
                        return Poll::Ready(Err(Error::Http {
                            status: self.status,
                            message,
                        }
                        .into()));
                    }
                    let response = if self.beta {
                        google_rest_beta::decode_synthesize_speech_response(&self.data)
                            .map(|r| r.audio_content)
                    } else {
                        google_rest::decode_synthesize_speech_response(&self.data)
                            .map(|r| r.audio_content)
                    };
                    let bytes = response
                        .ok()
                        .flatten()
                        .and_then(|value| base64::decode(&value));
                    return Poll::Ready(bytes.map(Some).ok_or_else(|| {
                        Error::Invalid("Google returned an invalid synthesis response").into()
                    }));
                }
            }
        }
        cx.waker().wake_by_ref();
        Poll::Pending
    }
}
struct GrpcStream {
    // Fields drop in order: abort the connection before dropping producer input.
    call: Call,
    settings: Settings,
    opening: Option<Vec<u8>>,
    limit: usize,
    validate: Validator,
    writing: bool,
    input_stopped: bool,
    end_started: bool,
    first: bool,
    prefer_output: bool,
}
impl GrpcStream {
    fn sent(&mut self, result: Result<(), TransportError>) -> Result<(), TransportError> {
        match result {
            Ok(()) => self.writing = true,
            Err(error) if error.is::<InputClosed>() => {
                // A server may reject input before its final status arrives.
                self.input_stopped = true;
                self.writing = false;
                self.settings.input = Input::Done;
            }
            Err(error) => return Err(error),
        }
        Ok(())
    }
    fn send(&mut self, bytes: Vec<u8>) -> Result<(), TransportError> {
        if bytes.len() > self.limit {
            return Err(Error::Invalid("Google gRPC message exceeds max_message_bytes").into());
        }
        let result = self.call.as_mut().start_send(bytes);
        self.sent(result)
    }
    fn produce(&mut self, cx: &mut Context<'_>) -> Result<bool, TransportError> {
        if self.input_stopped {
            return Ok(false);
        }
        if self.writing {
            match self.call.as_mut().poll_flush(cx) {
                Poll::Pending => return Ok(false),
                Poll::Ready(result) => {
                    self.sent(result)?;
                    self.writing = false;
                    return Ok(true);
                }
            }
        }
        if self.end_started {
            return Ok(false);
        }
        let (text, turns) = match &mut self.settings.input {
            Input::TextStream(input) => match input.as_mut().poll_next(cx) {
                Poll::Pending => return Ok(false),
                Poll::Ready(Some(item)) => {
                    let item = item?;
                    (self.validate)(&item, Some("text"))?;
                    settings::check_text(&item, self.settings.byte_limit)?;
                    (item, None)
                }
                Poll::Ready(None) => {
                    self.settings.input = Input::Done;
                    return Ok(true);
                }
            },
            Input::TurnStream(input) => match input.as_mut().poll_next(cx) {
                Poll::Pending => return Ok(false),
                Poll::Ready(Some(item)) => {
                    let item = item?;
                    (self.validate)(&item, Some("turns"))?;
                    self.settings.check_turns(std::slice::from_ref(&item))?;
                    (String::new(), Some(vec![item]))
                }
                Poll::Ready(None) => {
                    self.settings.input = Input::Done;
                    return Ok(true);
                }
            },
            Input::Text(_) | Input::Turns(_) => {
                match std::mem::replace(&mut self.settings.input, Input::Done) {
                    Input::Text(text) => (text, None),
                    Input::Turns(turns) => (String::new(), Some(turns)),
                    _ => unreachable!(),
                }
            }
            Input::Done => {
                let result = self.call.as_mut().start_end();
                // END_STREAM can reach the server while poll_flush is pending.
                self.end_started = result.is_ok();
                self.sent(result)?;
                return Ok(true);
            }
        };
        let bytes = self.settings.encode_input(text, turns, self.first)?;
        self.first = false;
        self.send(bytes)?;
        Ok(true)
    }
    fn next(&mut self, cx: &mut Context<'_>) -> Next {
        if let Some(opening) = self.opening.take() {
            self.send(opening)?;
        }
        let order = if self.prefer_output {
            [true, false]
        } else {
            [false, true]
        };
        self.prefer_output = !self.prefer_output;
        for _ in 0..32 {
            let mut progress = false;
            for output in order {
                if !output {
                    progress |= self.produce(cx)?;
                    continue;
                }
                match self.call.as_mut().poll_receive(cx) {
                    Poll::Pending => {}
                    Poll::Ready(None) => {
                        return Poll::Ready(if self.end_started {
                            Ok(None)
                        } else {
                            Err(Error::Invalid("Google gRPC ended before input completed").into())
                        })
                    }
                    Poll::Ready(Some(Err(error))) => return Poll::Ready(Err(error)),
                    Poll::Ready(Some(Ok(bytes))) => {
                        if bytes.len() > self.limit {
                            return Poll::Ready(Err(Error::Invalid(
                                "Google gRPC message exceeds max_message_bytes",
                            )
                            .into()));
                        }
                        if let Some(audio) = self.settings.decode_audio(&bytes)? {
                            return Poll::Ready(Ok(Some(audio)));
                        }
                        progress = true;
                    }
                }
            }
            if !progress {
                return Poll::Pending;
            }
        }
        cx.waker().wake_by_ref();
        Poll::Pending
    }
}
