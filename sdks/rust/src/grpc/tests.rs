use super::*;
use std::{
    collections::VecDeque,
    future::Future,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    task::{Wake, Waker},
};

#[derive(Default)]
struct State {
    events: Mutex<VecDeque<Result<Event, TransportError>>>,
    requests: Mutex<Vec<http2::ConnectRequest>>,
    writes: Mutex<Vec<(Vec<u8>, bool)>>,
    stall_receive: AtomicBool,
    stall_flush: AtomicBool,
    close_send: AtomicBool,
    close_flush: AtomicBool,
    fail_send: AtomicBool,
    reads: AtomicUsize,
    drops: AtomicUsize,
    wakes: AtomicUsize,
    receive_waker: Mutex<Option<Waker>>,
    flush_waker: Mutex<Option<Waker>>,
}
impl Wake for State {
    fn wake(self: Arc<Self>) {
        self.wakes.fetch_add(1, Ordering::SeqCst);
    }
    fn wake_by_ref(self: &Arc<Self>) {
        self.wakes.fetch_add(1, Ordering::SeqCst);
    }
}
#[derive(Debug)]
struct Marker;
impl std::fmt::Display for Marker {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("native failure")
    }
}
impl std::error::Error for Marker {}
struct Socket(Arc<State>);
impl http2::Http2Like for Socket {
    fn start_send(
        self: Pin<&mut Self>,
        bytes: Vec<u8>,
        end_stream: bool,
    ) -> Result<(), TransportError> {
        if self.0.close_send.load(Ordering::SeqCst) {
            return Err(InputClosed.into());
        }
        if self.0.fail_send.load(Ordering::SeqCst) {
            return Err(Marker.into());
        }
        self.0.writes.lock().unwrap().push((bytes, end_stream));
        Ok(())
    }
    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), TransportError>> {
        if self.0.close_flush.load(Ordering::SeqCst) {
            return Poll::Ready(Err(InputClosed.into()));
        }
        if self.0.stall_flush.load(Ordering::SeqCst) {
            *self.0.flush_waker.lock().unwrap() = Some(cx.waker().clone());
            Poll::Pending
        } else {
            Poll::Ready(Ok(()))
        }
    }
    fn poll_receive(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Event, TransportError>>> {
        self.0.reads.fetch_add(1, Ordering::SeqCst);
        if let Some(event) = self.0.events.lock().unwrap().pop_front() {
            return Poll::Ready(Some(event));
        }
        if self.0.stall_receive.load(Ordering::SeqCst) {
            *self.0.receive_waker.lock().unwrap() = Some(cx.waker().clone());
            Poll::Pending
        } else {
            Poll::Ready(None)
        }
    }
}
impl Drop for Socket {
    fn drop(&mut self) {
        self.0.drops.fetch_add(1, Ordering::SeqCst);
        if let Some(waker) = self.0.receive_waker.lock().unwrap().take() {
            waker.wake();
        }
        if let Some(waker) = self.0.flush_waker.lock().unwrap().take() {
            waker.wake();
        }
    }
}
struct Transport(Arc<State>);
impl Http2Transport for Transport {
    fn connect(
        &self,
        request: http2::ConnectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<http2::Stream, TransportError>> + Send + '_>> {
        self.0.requests.lock().unwrap().push(request);
        Box::pin(async { Ok(Box::pin(Socket(self.0.clone())) as http2::Stream) })
    }
}
fn ready<F: Future>(future: F) -> F::Output {
    let waker = Arc::new(State::default()).into();
    match Box::pin(future)
        .as_mut()
        .poll(&mut Context::from_waker(&waker))
    {
        Poll::Ready(value) => value,
        Poll::Pending => panic!("unexpected pending future"),
    }
}
fn options() -> ConnectRequest {
    ConnectRequest {
        url: "https://proxy.invalid/g%2Fp/Service/Speak?tenant=one".into(),
        headers: vec![
            ("Authorization".into(), "Bearer test".into()),
            ("x-goog-api-key".into(), "test-key".into()),
        ],
        max_message_bytes: 1024,
        max_header_bytes: 4096,
    }
}
fn open(events: Vec<Event>) -> (Pin<Box<Stream>>, Arc<State>) {
    let state = Arc::new(State {
        events: Mutex::new(events.into_iter().map(Ok).collect()),
        ..Default::default()
    });
    let stream = ready(connect(&Transport(state.clone()), options())).unwrap();
    (Box::pin(stream), state)
}
fn headers() -> Event {
    Event::Headers {
        status: 200,
        headers: vec![(
            "content-type".into(),
            "application/grpc+proto; charset=utf-8".into(),
        )],
        end_stream: false,
    }
}
fn data(bytes: &[u8]) -> Event {
    Event::Data {
        bytes: bytes.into(),
        end_stream: false,
    }
}
fn trailers(code: &str) -> Event {
    Event::Trailers(vec![("grpc-status".into(), code.into())])
}
fn receive(stream: &mut Pin<Box<Stream>>) -> Option<Result<Vec<u8>, TransportError>> {
    let waker = Arc::new(State::default()).into();
    match stream
        .as_mut()
        .poll_receive(&mut Context::from_waker(&waker))
    {
        Poll::Ready(value) => value,
        Poll::Pending => panic!("unexpected pending receive"),
    }
}
fn flush(stream: &mut Pin<Box<Stream>>) -> Result<(), TransportError> {
    let waker = Arc::new(State::default()).into();
    match stream.as_mut().poll_flush(&mut Context::from_waker(&waker)) {
        Poll::Ready(value) => value,
        Poll::Pending => panic!("unexpected pending flush"),
    }
}

#[test]
fn auth_native_options_byte_framing_and_half_close_before_response_headers() {
    let (mut stream, state) = open(vec![headers(), trailers("0")]);
    assert_eq!(state.reads.load(Ordering::SeqCst), 0);
    let requests = state.requests.lock().unwrap();
    assert_eq!(requests.len(), 1);
    assert_eq!(
        requests[0].url,
        "https://proxy.invalid/g%2Fp/Service/Speak?tenant=one"
    );
    assert_eq!(requests[0].method, "POST");
    assert_eq!(
        requests[0].headers,
        [
            ("content-type".into(), "application/grpc".into()),
            ("te".into(), "trailers".into()),
            ("grpc-accept-encoding".into(), "identity".into()),
            ("authorization".into(), "Bearer test".into()),
            ("x-goog-api-key".into(), "test-key".into()),
        ]
    );
    assert_eq!(requests[0].max_data_bytes, 65536);
    assert_eq!(requests[0].max_header_bytes, 4096);
    drop(requests);
    stream.as_mut().start_send(vec![0, 255, 128]).unwrap();
    assert_eq!(
        stream.as_mut().start_send(vec![]).unwrap_err().to_string(),
        "gRPC input is not ready"
    );
    assert_eq!(
        stream.as_mut().start_end().unwrap_err().to_string(),
        "gRPC input is not ready"
    );
    flush(&mut stream).unwrap();
    stream.as_mut().start_send(vec![]).unwrap();
    flush(&mut stream).unwrap();
    stream.as_mut().start_end().unwrap();
    flush(&mut stream).unwrap();
    stream.as_mut().start_end().unwrap();
    assert_eq!(
        state.writes.lock().unwrap().as_slice(),
        [
            (vec![0, 0, 0, 0, 3, 0, 255, 128], false),
            (vec![0, 0, 0, 0, 0], false),
            (vec![], true),
        ]
    );
    assert_eq!(
        stream.as_mut().start_send(vec![1]).unwrap_err().to_string(),
        "gRPC input is not ready"
    );
    assert!(receive(&mut stream).is_none());
    assert_eq!(state.drops.load(Ordering::SeqCst), 1);
    drop(stream);
    assert_eq!(state.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn every_two_chunk_split_preserves_multiple_messages_and_empty_payloads() {
    let wire = [0, 0, 0, 0, 3, 1, 2, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 128];
    for split in 0..=wire.len() {
        let (mut stream, state) = open(vec![
            headers(),
            data(&wire[..split]),
            data(&[]),
            data(&wire[split..]),
            trailers("0"),
        ]);
        let mut output = Vec::new();
        while let Some(value) = receive(&mut stream) {
            output.push(value.unwrap());
        }
        assert_eq!(
            output,
            [vec![1, 2, 255], vec![], vec![128]],
            "split {split}"
        );
        assert_eq!(state.drops.load(Ordering::SeqCst), 1);
    }
    let mut events = vec![headers()];
    events.extend(wire.iter().map(|byte| data(&[*byte])));
    events.push(trailers("0"));
    let (mut stream, _) = open(events);
    assert_eq!(receive(&mut stream).unwrap().unwrap(), vec![1, 2, 255]);
    assert_eq!(receive(&mut stream).unwrap().unwrap(), vec![]);
    assert_eq!(receive(&mut stream).unwrap().unwrap(), vec![128]);
    assert!(receive(&mut stream).is_none());
}

#[test]
fn audio_is_delivered_before_a_final_error_and_status_messages_preserve_invalid_encoding() {
    for (raw, expected) in [
        ("denied%20%E6%97%A5%E6%9C%AC+%2B", "denied 日本++"),
        ("%FF%20bad", "%FF%20bad"),
        ("bad%2", "bad%2"),
        ("", ""),
    ] {
        let (mut stream, state) = open(vec![
            headers(),
            data(&[0, 0, 0, 0, 1, 255]),
            Event::Trailers(vec![
                ("grpc-status".into(), "7".into()),
                ("grpc-message".into(), raw.into()),
            ]),
        ]);
        assert_eq!(receive(&mut stream).unwrap().unwrap(), vec![255]);
        assert_eq!(state.drops.load(Ordering::SeqCst), 0);
        let error = receive(&mut stream).unwrap().unwrap_err();
        assert_eq!(
            error.downcast_ref::<Error>(),
            Some(&Error::Status {
                code: 7,
                message: expected.into()
            })
        );
        assert!(receive(&mut stream).is_none());
        assert_eq!(state.drops.load(Ordering::SeqCst), 1);
    }
    let (mut stream, _) = open(vec![Event::Headers {
        status: 200,
        headers: vec![
            ("content-type".into(), "application/grpc".into()),
            ("grpc-status".into(), "16".into()),
        ],
        end_stream: true,
    }]);
    assert_eq!(
        receive(&mut stream)
            .unwrap()
            .unwrap_err()
            .downcast_ref::<Error>(),
        Some(&Error::Status {
            code: 16,
            message: "gRPC failed with status 16".into()
        })
    );
}

#[test]
fn malformed_framing_and_protocol_order_fail_once_and_release_the_call() {
    let cases = vec![
        (vec![], "gRPC closed before response headers"),
        (vec![data(&[])], "gRPC data arrived before response headers"),
        (
            vec![trailers("0")],
            "gRPC trailers arrived before response headers",
        ),
        (vec![headers()], "gRPC response lacks a valid final status"),
        (
            vec![headers(), headers()],
            "gRPC returned multiple response header blocks",
        ),
        (
            vec![headers(), data(&[0]), trailers("0")],
            "Truncated gRPC message",
        ),
        (
            vec![headers(), data(&[0, 0, 0, 0, 2, 1])],
            "Truncated gRPC message",
        ),
        (
            vec![headers(), data(&[1, 0, 0, 0, 0])],
            "Compressed gRPC messages are not supported",
        ),
        (
            vec![headers(), data(&[0, 0, 0, 4, 1])],
            "gRPC message exceeds byte limit",
        ),
        (
            vec![
                headers(),
                Event::Data {
                    bytes: vec![],
                    end_stream: true,
                },
            ],
            "gRPC response lacks a valid final status",
        ),
        (
            vec![
                headers(),
                Event::Data {
                    bytes: vec![0],
                    end_stream: true,
                },
            ],
            "Truncated gRPC message",
        ),
        (
            vec![headers(), data(&vec![0; MAX_DATA_BYTES + 1])],
            "HTTP/2 data exceeds chunk byte limit",
        ),
        (
            vec![Event::Headers {
                status: 200,
                headers: vec![("content-type".into(), "text/html".into())],
                end_stream: false,
            }],
            "gRPC returned an invalid content type",
        ),
        (
            vec![Event::Headers {
                status: 200,
                headers: vec![
                    ("content-type".into(), "application/grpc".into()),
                    ("grpc-encoding".into(), "gzip".into()),
                ],
                end_stream: false,
            }],
            "Compressed gRPC messages are not supported",
        ),
        (
            vec![Event::Headers {
                status: 200,
                headers: vec![
                    ("content-type".into(), "application/grpc".into()),
                    ("grpc-status".into(), "0".into()),
                ],
                end_stream: false,
            }],
            "gRPC final status arrived before end of stream",
        ),
        (
            vec![
                headers(),
                Event::Trailers(vec![
                    ("grpc-status".into(), "0".into()),
                    ("grpc-status".into(), "1".into()),
                ]),
            ],
            "gRPC returned duplicate protocol headers",
        ),
    ];
    for (events, expected) in cases {
        let (mut stream, state) = open(events);
        assert_eq!(
            receive(&mut stream).unwrap().unwrap_err().to_string(),
            expected
        );
        assert!(receive(&mut stream).is_none());
        assert_eq!(state.drops.load(Ordering::SeqCst), 1);
    }
    for code in ["", "-1", "00", "01", "+1", "17", "256", " 0", "0 "] {
        let (mut stream, _) = open(vec![headers(), trailers(code)]);
        assert_eq!(
            receive(&mut stream).unwrap().unwrap_err().to_string(),
            "gRPC response lacks a valid final status"
        );
    }
    let (mut stream, _) = open(vec![Event::Headers {
        status: 403,
        headers: vec![],
        end_stream: true,
    }]);
    assert_eq!(
        receive(&mut stream)
            .unwrap()
            .unwrap_err()
            .downcast_ref::<Error>(),
        Some(&Error::HttpStatus(403))
    );
}

#[test]
fn data_end_stream_does_not_turn_a_complete_message_into_success() {
    let (mut stream, _) = open(vec![
        headers(),
        Event::Data {
            bytes: vec![0, 0, 0, 0, 1, 5],
            end_stream: true,
        },
    ]);
    assert_eq!(receive(&mut stream).unwrap().unwrap(), vec![5]);
    assert_eq!(
        receive(&mut stream).unwrap().unwrap_err().to_string(),
        "gRPC response lacks a valid final status"
    );
}

#[test]
fn receive_progresses_while_flush_is_pending_and_peer_input_close_preserves_status() {
    for in_flush in [false, true] {
        let (mut stream, state) = open(vec![headers(), data(&[0, 0, 0, 0, 1, 42]), trailers("7")]);
        state.stall_flush.store(true, Ordering::SeqCst);
        let waker = state.clone().into();
        if in_flush {
            stream.as_mut().start_send(vec![1]).unwrap();
            assert!(stream
                .as_mut()
                .poll_flush(&mut Context::from_waker(&waker))
                .is_pending());
            assert_eq!(receive(&mut stream).unwrap().unwrap(), vec![42]);
            state.close_flush.store(true, Ordering::SeqCst);
            state.flush_waker.lock().unwrap().take().unwrap().wake();
            assert!(flush(&mut stream).unwrap_err().is::<InputClosed>());
        } else {
            state.close_send.store(true, Ordering::SeqCst);
            assert!(stream
                .as_mut()
                .start_send(vec![1])
                .unwrap_err()
                .is::<InputClosed>());
            assert_eq!(receive(&mut stream).unwrap().unwrap(), vec![42]);
        }
        assert_eq!(state.drops.load(Ordering::SeqCst), 0);
        assert_eq!(
            receive(&mut stream)
                .unwrap()
                .unwrap_err()
                .downcast_ref::<Error>(),
            Some(&Error::Status {
                code: 7,
                message: "gRPC failed with status 7".into()
            })
        );
        assert_eq!(state.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn stalled_reads_do_not_block_writes_and_drop_cancels_both_directions() {
    let (mut stream, state) = open(vec![headers()]);
    state.stall_receive.store(true, Ordering::SeqCst);
    state.stall_flush.store(true, Ordering::SeqCst);
    let waker = state.clone().into();
    assert!(stream
        .as_mut()
        .poll_receive(&mut Context::from_waker(&waker))
        .is_pending());
    stream.as_mut().start_send(vec![1]).unwrap();
    assert!(stream
        .as_mut()
        .poll_flush(&mut Context::from_waker(&waker))
        .is_pending());
    assert!(state.receive_waker.lock().unwrap().is_some());
    assert!(state.flush_waker.lock().unwrap().is_some());
    drop(stream);
    assert_eq!(state.drops.load(Ordering::SeqCst), 1);
    assert_eq!(state.wakes.load(Ordering::SeqCst), 2);
}

#[test]
fn native_failures_preserve_identity_and_release_resources() {
    let (mut stream, state) = open(vec![]);
    state.events.lock().unwrap().push_back(Err(Marker.into()));
    assert!(receive(&mut stream).unwrap().unwrap_err().is::<Marker>());
    assert_eq!(state.drops.load(Ordering::SeqCst), 1);
    let (mut stream, state) = open(vec![]);
    state.fail_send.store(true, Ordering::SeqCst);
    assert!(stream
        .as_mut()
        .start_send(vec![0])
        .unwrap_err()
        .is::<Marker>());
    assert_eq!(state.drops.load(Ordering::SeqCst), 1);
    assert!(receive(&mut stream).is_none());
}

#[test]
fn cooperative_polling_and_header_limits_are_enforced() {
    let mut events = vec![headers()];
    events.extend((0..40).map(|_| data(&[])));
    events.push(trailers("0"));
    let (mut stream, state) = open(events);
    let waker = state.clone().into();
    assert!(stream
        .as_mut()
        .poll_receive(&mut Context::from_waker(&waker))
        .is_pending());
    assert_eq!(state.reads.load(Ordering::SeqCst), 32);
    assert_eq!(state.wakes.load(Ordering::SeqCst), 1);
    assert!(receive(&mut stream).is_none());
    for (event, expected) in [
        (
            Event::Headers {
                status: 200,
                headers: vec![("x".into(), "a".repeat(4096))],
                end_stream: false,
            },
            "gRPC response headers exceed byte limit",
        ),
        (
            Event::Trailers(vec![("x".into(), "a".repeat(4096))]),
            "gRPC trailers exceed byte limit",
        ),
    ] {
        let events = if matches!(event, Event::Headers { .. }) {
            vec![event]
        } else {
            vec![headers(), event]
        };
        let (mut stream, _) = open(events);
        assert_eq!(
            receive(&mut stream).unwrap().unwrap_err().to_string(),
            expected
        );
    }
}

#[test]
fn invalid_configuration_never_opens_a_native_connection() {
    let state = Arc::new(State::default());
    let transport = Transport(state.clone());
    for url in [
        "https://user:pass@host",
        "https://host/#fragment",
        "ftp://host",
        "https://host\\path",
        "/relative",
    ] {
        let mut request = options();
        request.url = url.into();
        assert_eq!(
            ready(connect(&transport, request))
                .err()
                .unwrap()
                .to_string(),
            "gRPC URL must be HTTP(S) without credentials or a fragment"
        );
    }
    for (key, value) in [
        ("Authorization", "test\nkey"),
        (":path", "/other"),
        ("Host", "other"),
        ("content-type", "application/json"),
        ("grpc-status", "0"),
        ("bad key", "x"),
        ("grpc-encoding", "gzip"),
    ] {
        let mut request = options();
        request.headers = vec![(key.into(), value.into())];
        assert_eq!(
            ready(connect(&transport, request))
                .err()
                .unwrap()
                .to_string(),
            "Invalid gRPC request header"
        );
    }
    for zero_messages in [false, true] {
        let mut request = options();
        if zero_messages {
            request.max_message_bytes = 0;
        } else {
            request.max_header_bytes = 0;
        }
        assert_eq!(
            ready(connect(&transport, request))
                .err()
                .unwrap()
                .to_string(),
            "gRPC byte limits must be positive uint32 values"
        );
    }
    let mut request = options();
    request.max_header_bytes = 1;
    assert_eq!(
        ready(connect(&transport, request))
            .err()
            .unwrap()
            .to_string(),
        "gRPC request headers exceed byte limit"
    );
    assert_eq!(state.requests.lock().unwrap().len(), 0);
}

#[test]
fn timeout_syntax_and_exact_message_limits() {
    let state = Arc::new(State::default());
    let backend = Transport(state.clone());
    for timeout in ["", "1", "0S", "123456789S", "-1S", "1.5S", "1s", " 1S"] {
        let mut request = options();
        request
            .headers
            .push(("grpc-timeout".into(), timeout.into()));
        assert_eq!(
            ready(connect(&backend, request)).err().unwrap().to_string(),
            "Invalid gRPC timeout"
        );
    }
    assert_eq!(state.requests.lock().unwrap().len(), 0);
    for timeout in ["1H", "2M", "3S", "4m", "5u", "6n", "99999999S"] {
        let mut request = options();
        request
            .headers
            .push(("grpc-timeout".into(), timeout.into()));
        drop(ready(connect(&backend, request)).unwrap());
    }
    let (mut stream, state) = open(vec![
        headers(),
        data(&[0, 0, 0, 0, 3, 0, 255, 128]),
        trailers("0"),
    ]);
    stream.max_message_bytes = 3;
    assert_eq!(
        stream
            .as_mut()
            .start_send(vec![0; 4])
            .unwrap_err()
            .to_string(),
        "gRPC message exceeds byte limit"
    );
    assert_eq!(state.writes.lock().unwrap().len(), 0);
    stream.as_mut().start_send(vec![0; 3]).unwrap();
    flush(&mut stream).unwrap();
    assert_eq!(receive(&mut stream).unwrap().unwrap(), vec![0, 255, 128]);
    assert!(receive(&mut stream).is_none());
}

#[test]
fn google_stable_and_beta_protobufs_remain_byte_native() {
    use crate::clients::{google_grpc as wire, google_grpc_beta as beta};
    for beta_version in [false, true] {
        let state = Arc::new(State {
            events: Mutex::new(
                vec![
                    Ok(headers()),
                    Ok(data(&[0, 0, 0, 0, 5, 10, 3, 0, 255, 128])),
                    Ok(trailers("0")),
                ]
                .into(),
            ),
            ..Default::default()
        });
        let (path, request) = if beta_version {
            (
                beta::STREAMING_SYNTHESIZE_PATH,
                beta::encode_streaming_request(&beta::StreamingSynthesizeRequest {
                    streaming_request: Some(
                        beta::StreamingSynthesizeRequestStreamingRequest::Input(
                            beta::StreamingSynthesisInput {
                                input_source: Some(beta::StreamingSynthesisInputInputSource::Text(
                                    "hi".into(),
                                )),
                                prompt: None,
                            },
                        ),
                    ),
                })
                .unwrap(),
            )
        } else {
            (
                wire::STREAMING_SYNTHESIZE_PATH,
                wire::encode_streaming_request(&wire::StreamingSynthesizeRequest {
                    streaming_request: Some(
                        wire::StreamingSynthesizeRequestStreamingRequest::Input(
                            wire::StreamingSynthesisInput {
                                input_source: Some(wire::StreamingSynthesisInputInputSource::Text(
                                    "hi".into(),
                                )),
                                prompt: None,
                            },
                        ),
                    ),
                })
                .unwrap(),
            )
        };
        let mut request_options = options();
        request_options.url = format!("https://texttospeech.googleapis.com{path}");
        let mut stream =
            Box::pin(ready(connect(&Transport(state.clone()), request_options)).unwrap());
        stream.as_mut().start_send(request).unwrap();
        flush(&mut stream).unwrap();
        assert_eq!(
            state.writes.lock().unwrap()[0],
            (vec![0, 0, 0, 0, 6, 18, 4, 10, 2, 104, 105], false)
        );
        let message = receive(&mut stream).unwrap().unwrap();
        let audio = if beta_version {
            beta::decode_streaming_response(&message)
                .unwrap()
                .audio_content
        } else {
            wire::decode_streaming_response(&message)
                .unwrap()
                .audio_content
        };
        assert_eq!(audio, Some(vec![0, 255, 128]));
        assert!(receive(&mut stream).is_none());
    }
}

struct PendingOpen(Arc<State>);
impl Future for PendingOpen {
    type Output = Result<http2::Stream, TransportError>;
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        *self.0.receive_waker.lock().unwrap() = Some(cx.waker().clone());
        Poll::Pending
    }
}
impl Drop for PendingOpen {
    fn drop(&mut self) {
        self.0.drops.fetch_add(1, Ordering::SeqCst);
    }
}
struct PendingTransport(Arc<State>);
impl Http2Transport for PendingTransport {
    fn connect(
        &self,
        _: http2::ConnectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<http2::Stream, TransportError>> + Send + '_>> {
        Box::pin(PendingOpen(self.0.clone()))
    }
}
#[test]
fn dropping_connect_cancels_a_pending_native_handshake() {
    let state = Arc::new(State::default());
    let backend = PendingTransport(state.clone());
    let mut future = Box::pin(connect(&backend, options()));
    let waker = state.clone().into();
    assert!(future
        .as_mut()
        .poll(&mut Context::from_waker(&waker))
        .is_pending());
    assert_eq!(state.drops.load(Ordering::SeqCst), 0);
    drop(future);
    assert_eq!(state.drops.load(Ordering::SeqCst), 1);
}
