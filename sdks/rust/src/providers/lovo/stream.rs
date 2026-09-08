use super::{read, retry_after, Error, SynthesisItem};
use crate::{
    http::{HttpRequest, HttpTransport, TransportError},
    runtime::{InputStream, StreamingInput},
};
use std::{
    future::Future,
    pin::Pin,
    task::{Context, Poll},
};

pub(super) struct Asset {
    pub url: String,
    pub correlation_id: String,
    pub input_group_id: String,
}
type Pending<'a> =
    Pin<Box<dyn Future<Output = Result<StreamingInput<Vec<u8>>, TransportError>> + Send + 'a>>;
pub struct Stream<'a> {
    transport: &'a dyn HttpTransport,
    assets: Vec<Asset>,
    job_id: String,
    limit: usize,
    index: usize,
    pending: Option<Pending<'a>>,
    body: Option<StreamingInput<Vec<u8>>>,
    terminal: bool,
}
impl<'a> Stream<'a> {
    pub(super) fn new(
        transport: &'a dyn HttpTransport,
        assets: Vec<Asset>,
        job_id: String,
        limit: usize,
    ) -> Self {
        Self {
            transport,
            assets,
            job_id,
            limit,
            index: 0,
            pending: None,
            body: None,
            terminal: false,
        }
    }
    fn next(
        &mut self,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<SynthesisItem, TransportError>>> {
        let Some(asset) = self.assets.get(self.index) else {
            return Poll::Ready(None);
        };
        if self.body.is_none() {
            if self.pending.is_none() {
                self.pending = Some(Box::pin(open_asset(
                    self.transport,
                    asset.url.clone(),
                    self.job_id.clone(),
                    self.limit,
                )));
            }
            match self.pending.as_mut().unwrap().as_mut().poll(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(result) => {
                    self.pending = None;
                    self.body = Some(result?);
                }
            }
        }
        match self.body.as_mut().unwrap().as_mut().poll_next(cx) {
            Poll::Pending => Poll::Pending,
            Poll::Ready(Some(Err(error))) => Poll::Ready(Some(Err(error))),
            Poll::Ready(Some(Ok(audio))) if !audio.is_empty() => {
                Poll::Ready(Some(Ok(SynthesisItem {
                    audio,
                    correlation: Default::default(),
                    correlation_id: asset.correlation_id.clone(),
                    input_group_id: asset.input_group_id.clone(),
                    timestamps: [],
                })))
            }
            Poll::Ready(value) => {
                if value.is_none() {
                    self.body = None;
                    self.index += 1;
                }
                cx.waker().wake_by_ref();
                Poll::Pending
            }
        }
    }
}
impl InputStream<SynthesisItem> for Stream<'_> {
    fn poll_next(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<SynthesisItem, TransportError>>> {
        let s = self.get_mut();
        if s.terminal {
            return Poll::Ready(None);
        }
        let result = s.next(cx);
        if matches!(result, Poll::Ready(None) | Poll::Ready(Some(Err(_)))) {
            s.terminal = true;
            s.body = None;
            s.pending = None;
            s.assets = Vec::new();
        }
        result
    }
}
async fn open_asset(
    transport: &dyn HttpTransport,
    url: String,
    job_id: String,
    limit: usize,
) -> Result<StreamingInput<Vec<u8>>, TransportError> {
    // Asset URLs are validated before any download and never receive the API key.
    let response = transport
        .send(HttpRequest {
            method: "GET".into(),
            url,
            headers: Vec::new(),
            body: Vec::new(),
        })
        .await?;
    if (200..300).contains(&response.status) {
        return Ok(response.body);
    }
    let status = response.status;
    let retry_after = retry_after(&response);
    let message = read(response, limit).await?;
    Err(Box::new(Error {
        message: if message.is_empty() {
            format!("LOVO audio download returned HTTP {status}")
        } else {
            message
        },
        status_code: Some(status),
        job_id: Some(job_id),
        code: None,
        retry_after,
    }))
}
