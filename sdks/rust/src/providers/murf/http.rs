use super::{
    protocol::{self, failure, Audio, Error},
    url, SynthesisItem,
};
use crate::{
    generated::murf_output::*,
    http::{HttpRequest, HttpResponse, HttpTransport, TransportError},
    runtime::StreamingInput,
};
use std::{
    future::{poll_fn, Future},
    pin::Pin,
    task::{Context, Poll},
};

struct Completion {
    duration: f64,
    timestamps: Vec<MurfTimestamp>,
    done: DoneEvent,
}
struct Prepared {
    body: Option<StreamingInput<Vec<u8>>>,
    inline: Option<Vec<u8>>,
    completion: Option<Completion>,
}
type Preparation<'a> = Pin<Box<dyn Future<Output = Result<Prepared, TransportError>> + Send + 'a>>;
pub(super) struct HttpStream<'a> {
    prepare: Option<Preparation<'a>>,
    ready: Option<Prepared>,
    timed: bool,
    received: bool,
    timing_done: bool,
    pub done: bool,
}
impl<'a> HttpStream<'a> {
    pub fn new(
        response: HttpResponse,
        transport: &'a dyn HttpTransport,
        gen2: bool,
        timed: bool,
        inline: bool,
        limit: usize,
    ) -> Self {
        Self {
            prepare: Some(Box::pin(prepare(
                response, transport, gen2, timed, inline, limit,
            ))),
            ready: None,
            timed,
            received: false,
            timing_done: false,
            done: false,
        }
    }
    pub fn next(
        &mut self,
        cx: &mut Context<'_>,
    ) -> Poll<Result<Option<SynthesisItem>, TransportError>> {
        if let Some(future) = &mut self.prepare {
            let ready = match future.as_mut().poll(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(v) => v?,
            };
            self.prepare = None;
            self.ready = Some(ready);
        }
        let ready = self.ready.as_mut().unwrap();
        let data = if let Some(bytes) = ready.inline.take() {
            Some(bytes)
        } else if let Some(body) = &mut ready.body {
            match body.as_mut().poll_next(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(Some(Err(err))) => return Poll::Ready(Err(err)),
                Poll::Ready(Some(Ok(bytes))) if bytes.is_empty() => {
                    cx.waker().wake_by_ref();
                    return Poll::Pending;
                }
                Poll::Ready(Some(Ok(bytes))) => Some(bytes),
                Poll::Ready(None) => {
                    ready.body = None;
                    None
                }
            }
        } else {
            None
        };
        if let Some(bytes) = data.filter(|v| !v.is_empty()) {
            self.received = true;
            let item = if self.timed {
                let mut e = protocol::envelope(true);
                e.audio = Some(bytes);
                SynthesisItem::OrderedOrTimeline(e)
            } else {
                SynthesisItem::Bytes(bytes)
            };
            return Poll::Ready(Ok(Some(item)));
        }
        if !self.received {
            return Poll::Ready(Err(failure("Murf returned no audio")));
        }
        if self.timed && !self.timing_done {
            self.timing_done = true;
            let completion = ready.completion.as_mut().unwrap();
            let mut e = protocol::envelope(true);
            e.duration_ms = Some(completion.duration);
            e.timestamps = std::mem::take(&mut completion.timestamps);
            return Poll::Ready(Ok(Some(SynthesisItem::OrderedOrTimeline(e))));
        }
        let done = ready.completion.take().map_or(
            DoneEvent {
                event: Default::default(),
                remaining_characters: None,
                warning: None,
            },
            |c| c.done,
        );
        self.done = true;
        Poll::Ready(Ok(Some(SynthesisItem::Done(done))))
    }
}
async fn document(
    body: &mut StreamingInput<Vec<u8>>,
    limit: usize,
) -> Result<String, TransportError> {
    let mut data = Vec::new();
    poll_fn(|cx| {
        for _ in 0..128 {
            match body.as_mut().poll_next(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(Some(Err(e))) => return Poll::Ready(Err(e)),
                Poll::Ready(Some(Ok(bytes))) => {
                    if bytes.len() > limit - data.len() {
                        return Poll::Ready(Err(failure("Murf response exceeds max_json_bytes")));
                    }
                    data.extend(bytes);
                }
                Poll::Ready(None) => {
                    return Poll::Ready(Ok(String::from_utf8_lossy(
                        data.strip_prefix(&[239, 187, 191]).unwrap_or(&data),
                    )
                    .into_owned()))
                }
            }
        }
        cx.waker().wake_by_ref();
        Poll::Pending
    })
    .await
}
async fn check(response: &mut HttpResponse, limit: usize) -> Result<(), TransportError> {
    if !(200..300).contains(&response.status) {
        return Err(Box::new(Error {
            status: Some(response.status),
            body: document(&mut response.body, limit).await?,
            retry_after: response
                .headers
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case("retry-after"))
                .map(|(_, v)| v.clone()),
        }));
    }
    Ok(())
}
async fn prepare(
    mut response: HttpResponse,
    transport: &dyn HttpTransport,
    gen2: bool,
    timed: bool,
    inline: bool,
    limit: usize,
) -> Result<Prepared, TransportError> {
    check(&mut response, limit).await?;
    if !gen2 {
        let content_type = response
            .headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case("content-type"))
            .map_or("", |(_, v)| v.as_str())
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        if !content_type.is_empty()
            && !content_type.starts_with("audio/")
            && content_type != "application/octet-stream"
        {
            return Err(failure("Murf returned a non-audio streaming response"));
        }
        return Ok(Prepared {
            body: Some(response.body),
            inline: None,
            completion: None,
        });
    }
    let text = document(&mut response.body, limit).await?;
    drop(response);
    let g = protocol::generation(&text, timed, inline)?;
    let completion = Some(Completion {
        duration: g.duration,
        timestamps: g.timestamps,
        done: DoneEvent {
            event: Default::default(),
            remaining_characters: Some(g.remaining),
            warning: g.warning,
        },
    });
    match g.audio {
        Audio::Bytes(bytes) => Ok(Prepared {
            body: None,
            inline: Some(bytes),
            completion,
        }),
        Audio::Url(target) => {
            let target = url(&target, "", false)?;
            if !target
                .split_once("://")
                .unwrap()
                .0
                .eq_ignore_ascii_case("https")
            {
                return Err(failure("Murf returned an unsafe audio file URL"));
            }
            // Audio files are independent resources; never forward API credentials.
            let mut response = transport
                .send(HttpRequest {
                    method: "GET".into(),
                    url: target,
                    headers: vec![],
                    body: vec![],
                })
                .await?;
            check(&mut response, limit).await?;
            Ok(Prepared {
                body: Some(response.body),
                inline: None,
                completion,
            })
        }
    }
}
