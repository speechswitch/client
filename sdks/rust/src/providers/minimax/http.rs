use super::{
    protocol::{self, failure, Error, Packet},
    url, SynthesisItem,
};
use crate::{
    generated::minimax_output::*,
    http::{HttpRequest, HttpResponse, HttpTransport, TransportError},
    runtime::StreamingInput,
    sse::Decoder,
};
use std::{
    future::{poll_fn, Future},
    pin::Pin,
    task::{Context, Poll},
};

type SubtitleFuture<'a> =
    Pin<Box<dyn Future<Output = Result<Vec<MiniMaxTimestamp>, TransportError>> + Send + 'a>>;
pub(super) struct HttpStream<'a> {
    transport: &'a dyn HttpTransport,
    body: Option<StreamingInput<Vec<u8>>>,
    status: u16,
    retry_after: Option<String>,
    decoder: Option<Decoder>,
    bytes: std::vec::IntoIter<u8>,
    document: Vec<u8>,
    limit: usize,
    timing: Option<&'static str>,
    final_packet: Option<Packet>,
    subtitle: Option<SubtitleFuture<'a>>,
    received: bool,
    subtitles_done: bool,
    pub done: bool,
}
impl<'a> HttpStream<'a> {
    pub fn new(
        response: HttpResponse,
        transport: &'a dyn HttpTransport,
        timing: Option<&'static str>,
        limit: usize,
    ) -> Result<Self, TransportError> {
        let sse = (200..300).contains(&response.status)
            && response.headers.iter().any(|(k, v)| {
                k.eq_ignore_ascii_case("content-type")
                    && v.split(';')
                        .next()
                        .unwrap_or("")
                        .trim()
                        .eq_ignore_ascii_case("text/event-stream")
            });
        let retry_after = response
            .headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case("retry-after"))
            .map(|(_, v)| v.clone());
        Ok(Self {
            transport,
            body: Some(response.body),
            status: response.status,
            retry_after,
            decoder: if sse {
                Some(Decoder::new(limit)?)
            } else {
                None
            },
            bytes: vec![].into_iter(),
            document: vec![],
            limit,
            timing,
            final_packet: None,
            subtitle: None,
            received: false,
            subtitles_done: false,
            done: false,
        })
    }
    fn error(&self, p: Packet) -> TransportError {
        Box::new(Error {
            message: if p.message.is_empty() {
                format!("MiniMax HTTP {}", self.status)
            } else {
                p.message
            },
            code: p.code,
            status: Some(self.status),
            retry_after: self.retry_after.clone(),
        })
    }
    fn accept(&mut self, mut p: Packet) -> Result<Option<SynthesisItem>, TransportError> {
        if p.code.is_some() {
            return Err(self.error(p));
        }
        if self.decoder.is_some() {
            if p.status.is_none() {
                return Err(failure("MiniMax SSE audio is missing data.status"));
            }
        } else if p.status != Some(2) {
            return Err(failure("MiniMax JSON synthesis did not report completion"));
        }
        let audio = p.audio.take().filter(|v| !v.is_empty());
        let trace = p.trace.clone();
        if p.status == Some(2) {
            self.final_packet = Some(p);
        }
        Ok(audio.map(|audio| {
            self.received = true;
            if self.timing.is_some() {
                let mut e = protocol::envelope(true, trace);
                e.audio = Some(audio);
                SynthesisItem::OrderedOrTimeline(e)
            } else {
                SynthesisItem::Bytes(audio)
            }
        }))
    }
    pub fn next(
        &mut self,
        cx: &mut Context<'_>,
    ) -> Poll<Result<Option<SynthesisItem>, TransportError>> {
        for _ in 0..4096 {
            if self.final_packet.is_some() {
                break;
            }
            if let Some(byte) = self.bytes.next() {
                if let Some(event) = self.decoder.as_mut().unwrap().push(byte)? {
                    if event.data == "[DONE]" {
                        return Poll::Ready(Err(failure(
                            "MiniMax HTTP stream ended before completion",
                        )));
                    }
                    let p = protocol::packet(&event.data)?;
                    if let Some(item) = self.accept(p)? {
                        return Poll::Ready(Ok(Some(item)));
                    }
                }
                continue;
            }
            match self.body.as_mut().unwrap().as_mut().poll_next(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(Some(Err(e))) => return Poll::Ready(Err(e)),
                Poll::Ready(Some(Ok(bytes))) => {
                    if self.decoder.is_some() {
                        self.bytes = bytes.into_iter();
                    } else {
                        if bytes.len() > self.limit - self.document.len() {
                            return Poll::Ready(Err(failure(
                                "MiniMax response exceeds max_json_bytes",
                            )));
                        }
                        self.document.extend(bytes);
                    }
                }
                Poll::Ready(None) => {
                    self.body = None;
                    if self.decoder.is_some() {
                        return Poll::Ready(Err(failure(
                            "MiniMax HTTP stream ended before completion",
                        )));
                    }
                    let text = protocol::text(&self.document)?;
                    if !(200..300).contains(&self.status) {
                        let p = match crate::json::Raw::parse(text) {
                            Ok(_) => protocol::packet(text)?,
                            Err(_) => Packet::default(),
                        };
                        return Poll::Ready(Err(self.error(p)));
                    }
                    let p = protocol::packet(text)?;
                    self.document = Vec::new();
                    if let Some(item) = self.accept(p)? {
                        return Poll::Ready(Ok(Some(item)));
                    }
                }
            }
        }
        let Some(final_packet) = &self.final_packet else {
            cx.waker().wake_by_ref();
            return Poll::Pending;
        };
        self.body = None;
        self.bytes = vec![].into_iter();
        if let Some(decoder) = &mut self.decoder {
            decoder.finish();
        }
        if !self.received {
            return Poll::Ready(Err(failure("MiniMax returned no audio")));
        }
        if let Some(kind) = self.timing.filter(|_| !self.subtitles_done) {
            if self.subtitle.is_none() {
                let target = final_packet
                    .subtitle
                    .as_deref()
                    .filter(|v| !v.is_empty())
                    .ok_or_else(|| failure("MiniMax omitted requested subtitles"))?;
                self.subtitle = Some(Box::pin(download(
                    self.transport,
                    url(target, "", false)?,
                    self.limit,
                    kind,
                )));
            }
            match self.subtitle.as_mut().unwrap().as_mut().poll(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(result) => {
                    self.subtitle = None;
                    let mut e = protocol::envelope(true, final_packet.trace.clone());
                    e.timestamps = result?;
                    self.subtitles_done = true;
                    return Poll::Ready(Ok(Some(SynthesisItem::OrderedOrTimeline(e))));
                }
            }
        }
        let p = self.final_packet.take().unwrap();
        self.done = true;
        Poll::Ready(Ok(Some(SynthesisItem::Done(MiniMaxDoneEvent {
            event: Default::default(),
            trace_id: p.trace,
            usage: p.usage,
        }))))
    }
}

async fn download(
    transport: &dyn HttpTransport,
    target: String,
    limit: usize,
    kind: &str,
) -> Result<Vec<MiniMaxTimestamp>, TransportError> {
    // Independent files must not inherit API credentials or transport cookies.
    let mut response = transport
        .send(HttpRequest {
            method: "GET".into(),
            url: target,
            headers: vec![],
            body: vec![],
        })
        .await?;
    if !(200..300).contains(&response.status) {
        return Err(Box::new(Error {
            message: "MiniMax subtitle download failed".into(),
            status: Some(response.status),
            code: None,
            retry_after: None,
        }));
    }
    let mut data = Vec::new();
    while let Some(chunk) = poll_fn(|cx| response.body.as_mut().poll_next(cx)).await {
        let chunk = chunk?;
        if chunk.len() > limit - data.len() {
            return Err(failure("MiniMax response exceeds max_json_bytes"));
        }
        data.extend(chunk);
        let mut yielded = false;
        poll_fn(|cx| {
            if yielded {
                Poll::Ready(())
            } else {
                yielded = true;
                cx.waker().wake_by_ref();
                Poll::Pending
            }
        })
        .await;
    }
    protocol::subtitles(protocol::text(&data)?, kind)
}
