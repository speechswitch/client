use super::{
    live,
    protocol::{self, failure},
};
use crate::{
    generated::elevenlabs_output::SynthesisItem,
    http::TransportError,
    runtime::{InputStream, StreamingInput},
};
use std::{
    pin::Pin,
    task::{Context, Poll},
};

enum State {
    Http(Http),
    Socket(live::Live),
}
pub struct Stream {
    state: Option<State>,
}
impl Stream {
    pub(super) fn http(
        body: StreamingInput<Vec<u8>>,
        timed: bool,
        wav: bool,
        normalized: bool,
        limit: usize,
    ) -> Self {
        Self {
            state: Some(State::Http(Http {
                body: Some(body),
                timed,
                wav,
                normalized,
                limit,
                pending: Vec::new(),
                position: 0,
                record: Vec::new(),
                first: true,
                received: false,
            })),
        }
    }
    pub(super) fn socket(config: live::Configuration) -> Result<Self, TransportError> {
        Ok(Self {
            state: Some(State::Socket(live::Live::new(config)?)),
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
        let next = match state {
            State::Http(s) => s.poll(cx),
            State::Socket(s) => s.poll(cx),
        };
        if matches!(next, Poll::Ready(None) | Poll::Ready(Some(Err(_)))) {
            s.state = None;
        }
        next
    }
}
struct Http {
    body: Option<StreamingInput<Vec<u8>>>,
    timed: bool,
    wav: bool,
    normalized: bool,
    limit: usize,
    pending: Vec<u8>,
    position: usize,
    record: Vec<u8>,
    first: bool,
    received: bool,
}
impl Http {
    fn line(&mut self) -> Result<Option<SynthesisItem>, TransportError> {
        let data = std::mem::take(&mut self.record);
        let data = if self.first {
            self.first = false;
            data.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&data)
        } else {
            &data
        };
        let text =
            std::str::from_utf8(data).map_err(|_| failure("ElevenLabs returned invalid JSON"))?;
        if text.trim().is_empty() {
            return Ok(None);
        }
        let item = protocol::timestamped(text, self.normalized)?;
        self.received = true;
        Ok(Some(item))
    }
    fn poll(
        &mut self,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<SynthesisItem, TransportError>>> {
        for _ in 0..64 {
            if self.position == self.pending.len() {
                let Some(body) = &mut self.body else {
                    return Poll::Ready(None);
                };
                match body.as_mut().poll_next(cx) {
                    Poll::Pending => return Poll::Pending,
                    Poll::Ready(Some(Err(error))) => return Poll::Ready(Some(Err(error))),
                    Poll::Ready(None) => {
                        self.body = None;
                        if self.timed {
                            if self.wav {
                                let data = self
                                    .record
                                    .strip_prefix(&[0xef, 0xbb, 0xbf])
                                    .unwrap_or(&self.record);
                                return Poll::Ready(Some(
                                    std::str::from_utf8(data)
                                        .map_err(|_| failure("ElevenLabs returned invalid JSON"))
                                        .and_then(|v| protocol::timestamped(v, self.normalized)),
                                ));
                            }
                            if !self.record.is_empty() {
                                match self.line() {
                                    Ok(Some(item)) => return Poll::Ready(Some(Ok(item))),
                                    Err(error) => return Poll::Ready(Some(Err(error))),
                                    _ => {}
                                }
                            }
                        }
                        return if self.received {
                            Poll::Ready(None)
                        } else {
                            Poll::Ready(Some(Err(failure(if self.timed {
                                "ElevenLabs returned no timestamped audio chunks"
                            } else {
                                "ElevenLabs returned no audio bytes"
                            }))))
                        };
                    }
                    Poll::Ready(Some(Ok(chunk))) => {
                        if chunk.is_empty() {
                            cx.waker().wake_by_ref();
                            return Poll::Pending;
                        }
                        if !self.timed {
                            self.received = true;
                            return Poll::Ready(Some(Ok(SynthesisItem::Bytes(chunk))));
                        }
                        self.pending = chunk;
                        self.position = 0;
                    }
                }
            }
            let end = if self.wav {
                None
            } else {
                self.pending[self.position..]
                    .iter()
                    .position(|v| *v == b'\n')
                    .map(|v| v + self.position)
            };
            let stop = end.unwrap_or(self.pending.len());
            if stop - self.position > self.limit - self.record.len() {
                return Poll::Ready(Some(Err(failure(
                    "ElevenLabs response exceeds max_json_bytes",
                ))));
            }
            self.record
                .extend_from_slice(&self.pending[self.position..stop]);
            self.position = stop;
            if end.is_some() {
                self.position += 1;
                match self.line() {
                    Ok(Some(item)) => return Poll::Ready(Some(Ok(item))),
                    Err(error) => return Poll::Ready(Some(Err(error))),
                    _ => {}
                }
            }
        }
        cx.waker().wake_by_ref();
        Poll::Pending
    }
}
