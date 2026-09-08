use speechswitch_types::{http::*, runtime::InputStream};
use std::{
    collections::VecDeque,
    future::Future,
    io,
    pin::Pin,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    task::{Context, Poll, Wake, Waker},
};

#[derive(Default)]
struct Counts {
    reads: AtomicUsize,
    drops: AtomicUsize,
    wakes: AtomicUsize,
}
impl Wake for Counts {
    fn wake(self: Arc<Self>) {
        self.wakes.fetch_add(1, Ordering::SeqCst);
    }
    fn wake_by_ref(self: &Arc<Self>) {
        self.wakes.fetch_add(1, Ordering::SeqCst);
    }
}

struct Body {
    counts: Arc<Counts>,
    chunks: VecDeque<Result<Vec<u8>, TransportError>>,
}
impl Drop for Body {
    fn drop(&mut self) {
        self.counts.drops.fetch_add(1, Ordering::SeqCst);
    }
}
impl InputStream<Vec<u8>> for Body {
    fn poll_next(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
    ) -> Poll<Option<Result<Vec<u8>, TransportError>>> {
        let body = self.get_mut();
        body.counts.reads.fetch_add(1, Ordering::SeqCst);
        Poll::Ready(body.chunks.pop_front())
    }
}

struct Transport {
    response: Mutex<Option<HttpResponse>>,
    requests: Mutex<Vec<HttpRequest>>,
}
impl HttpTransport for Transport {
    fn send(
        &self,
        request: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        self.requests.lock().unwrap().push(request);
        let response = self.response.lock().unwrap().take().unwrap();
        Box::pin(async move { Ok(response) })
    }
}

fn request() -> HttpRequest {
    HttpRequest {
        method: "POST".into(),
        url: "https://example.invalid/tts".into(),
        headers: vec![("Authorization".into(), "test credential".into())],
        body: vec![0, 255],
    }
}

fn transport(
    status: u16,
    chunks: Vec<Result<Vec<u8>, TransportError>>,
    counts: &Arc<Counts>,
) -> Transport {
    Transport {
        response: Mutex::new(Some(HttpResponse {
            status,
            headers: vec![],
            body: Box::pin(Body {
                counts: counts.clone(),
                chunks: chunks.into(),
            }),
        })),
        requests: Mutex::new(vec![]),
    }
}

fn ready<T>(future: impl Future<Output = T>, context: &mut Context<'_>) -> T {
    match std::pin::pin!(future).as_mut().poll(context) {
        Poll::Ready(value) => value,
        Poll::Pending => panic!("Expected ready future"),
    }
}

fn bytes(stream: &mut AudioStream, context: &mut Context<'_>) -> Vec<u8> {
    match Pin::new(stream).poll_next(context) {
        Poll::Ready(Some(Ok(bytes))) => bytes,
        _ => panic!("Expected audio"),
    }
}

#[test]
fn audio_is_pulled_without_buffering_and_eof_releases_body_once() {
    let counts = Arc::new(Counts::default());
    let waker = Waker::from(counts.clone());
    let mut cx = Context::from_waker(&waker);
    let transport = transport(200, vec![Ok(vec![0, 255]), Ok(vec![1, 2])], &counts);
    let mut audio = ready(open_audio(&transport, request()), &mut cx).unwrap();
    assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
    let sent = transport.requests.lock().unwrap();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].method, "POST");
    assert_eq!(sent[0].url, "https://example.invalid/tts");
    assert_eq!(
        sent[0].headers,
        vec![("Authorization".into(), "test credential".into())]
    );
    assert_eq!(sent[0].body, vec![0, 255]);
    assert_eq!(bytes(&mut audio, &mut cx), vec![0, 255]);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 0);
    assert_eq!(bytes(&mut audio, &mut cx), vec![1, 2]);
    assert!(matches!(
        Pin::new(&mut audio).poll_next(&mut cx),
        Poll::Ready(None)
    ));
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert!(matches!(
        Pin::new(&mut audio).poll_next(&mut cx),
        Poll::Ready(None)
    ));
    assert_eq!(counts.reads.load(Ordering::SeqCst), 3);
    drop(audio);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn early_drop_and_unread_response_release_body() {
    for read_first in [false, true] {
        let counts = Arc::new(Counts::default());
        let waker = Waker::from(counts.clone());
        let mut cx = Context::from_waker(&waker);
        let transport = transport(200, vec![Ok(vec![7]), Ok(vec![8])], &counts);
        let mut audio = ready(open_audio(&transport, request()), &mut cx).unwrap();
        if read_first {
            assert_eq!(bytes(&mut audio, &mut cx), vec![7]);
        }
        drop(audio);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(counts.reads.load(Ordering::SeqCst), usize::from(read_first));
    }
}

#[test]
fn non_success_status_does_not_read_or_expose_error_body() {
    for status in [199, 300, 401, 429, 500] {
        let counts = Arc::new(Counts::default());
        let waker = Waker::from(counts.clone());
        let mut cx = Context::from_waker(&waker);
        let transport = transport(status, vec![Ok(b"private error body".to_vec())], &counts);
        let error = ready(open_audio(&transport, request()), &mut cx)
            .err()
            .unwrap();
        assert_eq!(
            error.downcast_ref::<HttpStatusError>(),
            Some(&HttpStatusError { status })
        );
        assert_eq!(
            error.to_string(),
            format!("HTTP request failed with status {status}")
        );
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn read_error_is_emitted_once_and_empty_chunks_yield_without_becoming_eof() {
    let counts = Arc::new(Counts::default());
    let waker = Waker::from(counts.clone());
    let mut cx = Context::from_waker(&waker);
    let transport = transport(
        200,
        vec![
            Ok(vec![]),
            Ok(vec![255]),
            Err(Box::new(io::Error::new(
                io::ErrorKind::ConnectionReset,
                "broken stream",
            ))),
            Ok(vec![9]),
        ],
        &counts,
    );
    let mut audio = ready(open_audio(&transport, request()), &mut cx).unwrap();
    assert!(Pin::new(&mut audio).poll_next(&mut cx).is_pending());
    assert_eq!(counts.wakes.load(Ordering::SeqCst), 1);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    assert_eq!(bytes(&mut audio, &mut cx), vec![255]);
    match Pin::new(&mut audio).poll_next(&mut cx) {
        Poll::Ready(Some(Err(error))) => assert_eq!(error.to_string(), "broken stream"),
        _ => panic!("Expected read failure"),
    }
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert!(matches!(
        Pin::new(&mut audio).poll_next(&mut cx),
        Poll::Ready(None)
    ));
    assert_eq!(counts.reads.load(Ordering::SeqCst), 3);
}

struct PendingSend(Arc<Counts>);
impl Future for PendingSend {
    type Output = Result<HttpResponse, TransportError>;
    fn poll(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Self::Output> {
        Poll::Pending
    }
}
impl Drop for PendingSend {
    fn drop(&mut self) {
        self.0.drops.fetch_add(1, Ordering::SeqCst);
    }
}
struct PendingTransport(Arc<Counts>);
impl HttpTransport for PendingTransport {
    fn send(
        &self,
        _: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        Box::pin(PendingSend(self.0.clone()))
    }
}

#[test]
fn canceling_before_headers_drops_the_transport_future() {
    let counts = Arc::new(Counts::default());
    let waker = Waker::from(counts.clone());
    let mut cx = Context::from_waker(&waker);
    let transport = PendingTransport(counts.clone());
    let mut opening = Box::pin(open_audio(&transport, request()));
    assert!(opening.as_mut().poll(&mut cx).is_pending());
    assert_eq!(counts.drops.load(Ordering::SeqCst), 0);
    drop(opening);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

struct PendingBody {
    counts: Arc<Counts>,
    waker: Option<Waker>,
}
impl InputStream<Vec<u8>> for PendingBody {
    fn poll_next(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
    ) -> Poll<Option<Result<Vec<u8>, TransportError>>> {
        let body = self.get_mut();
        body.counts.reads.fetch_add(1, Ordering::SeqCst);
        body.waker = Some(context.waker().clone());
        Poll::Pending
    }
}
impl Drop for PendingBody {
    fn drop(&mut self) {
        self.counts.drops.fetch_add(1, Ordering::SeqCst);
    }
}

#[test]
fn dropping_during_pending_read_releases_body() {
    let counts = Arc::new(Counts::default());
    let waker = Waker::from(counts.clone());
    let mut cx = Context::from_waker(&waker);
    let transport = Transport {
        response: Mutex::new(Some(HttpResponse {
            status: 200,
            headers: vec![],
            body: Box::pin(PendingBody {
                counts: counts.clone(),
                waker: None,
            }),
        })),
        requests: Mutex::new(vec![]),
    };
    let mut audio = ready(open_audio(&transport, request()), &mut cx).unwrap();
    assert!(Pin::new(&mut audio).poll_next(&mut cx).is_pending());
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 0);
    drop(audio);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

struct FailedTransport;
impl HttpTransport for FailedTransport {
    fn send(
        &self,
        _: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        Box::pin(async {
            Err(Box::new(io::Error::new(
                io::ErrorKind::ConnectionRefused,
                "connection failed",
            )) as TransportError)
        })
    }
}

#[test]
fn send_failure_is_not_replaced_by_a_status_error() {
    let counts = Arc::new(Counts::default());
    let waker = Waker::from(counts);
    let mut cx = Context::from_waker(&waker);
    let error = ready(open_audio(&FailedTransport, request()), &mut cx)
        .err()
        .unwrap();
    assert_eq!(
        error.downcast_ref::<io::Error>().unwrap().kind(),
        io::ErrorKind::ConnectionRefused
    );
    assert_eq!(error.to_string(), "connection failed");
}
