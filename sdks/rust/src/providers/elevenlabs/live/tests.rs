use super::*;
use crate::{runtime::InputStream, websocket::WebSocketLike};
use std::{
    pin::Pin,
    sync::atomic::{AtomicUsize, Ordering},
};

struct Input {
    busy: bool,
    polls: Arc<AtomicUsize>,
    drops: Arc<Mutex<Vec<&'static str>>>,
    waker: Arc<Mutex<Option<Waker>>>,
}
impl InputStream<InputValue> for Input {
    fn poll_next(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<InputValue, TransportError>>> {
        self.polls.fetch_add(1, Ordering::SeqCst);
        *self.waker.lock().unwrap() = Some(cx.waker().clone());
        if self.busy {
            Poll::Ready(Some(Ok(InputValue::String(String::new()))))
        } else {
            Poll::Pending
        }
    }
}
impl Drop for Input {
    fn drop(&mut self) {
        self.drops.lock().unwrap().push("input");
    }
}
type InputValue = super::super::settings::Input;
struct FailedRotation {
    sends: usize,
    emitted: bool,
}
impl WebSocketLike for FailedRotation {
    fn start_send(mut self: Pin<&mut Self>, _: Message) -> Result<(), TransportError> {
        self.sends += 1;
        if self.sends == 2 {
            Err(failure("rotation write failed"))
        } else {
            Ok(())
        }
    }
    fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Result<(), TransportError>> {
        Poll::Ready(Ok(()))
    }
    fn poll_receive(
        mut self: Pin<&mut Self>,
        _: &mut Context<'_>,
    ) -> Poll<Option<Result<Message, TransportError>>> {
        if self.emitted {
            return Poll::Pending;
        }
        self.emitted = true;
        Poll::Ready(Some(Ok(Message::Text(format!(
            "{{\"context_id\":\"{}:0\",\"audio\":\"AQ==\",\"is_final\":true}}",
            "07".repeat(16)
        )))))
    }
}

#[test]
fn idle_rotation_error_does_not_overwrite_queued_audio() {
    let mut live = Live::new(Configuration {
        socket: Box::pin(FailedRotation {
            sends: 0,
            emitted: false,
        }),
        text: Text::Tts(Box::pin(Input {
            busy: false,
            polls: Arc::new(AtomicUsize::new(0)),
            drops: Arc::new(Mutex::new(vec![])),
            waker: Arc::new(Mutex::new(None)),
        })),
        voice: "custom".into(),
        settings: r#"{"voice_settings":{}}"#.into(),
        dialogue: false,
        timed: false,
        normalized: false,
        seed: [7; 16],
        max_message: 1024,
        heartbeat_interval: Duration::from_secs(10),
        validate: Box::new(|_, _| Ok(())),
    })
    .unwrap();
    let waker = Waker::from(live.shared.signal.clone());
    let mut cx = Context::from_waker(&waker);
    assert!(live.poll(&mut cx).is_pending());
    wait(|| live.shared.state.lock().unwrap().terminal);
    match live.poll(&mut cx) {
        Poll::Ready(Some(Ok(out::SynthesisItem::Bytes(bytes)))) => assert_eq!(bytes, vec![1]),
        _ => panic!("queued audio was lost"),
    }
    match live.poll(&mut cx) {
        Poll::Ready(Some(Err(error))) => assert_eq!(error.to_string(), "rotation write failed"),
        _ => panic!("rotation error was lost"),
    }
    assert!(matches!(live.poll(&mut cx), Poll::Ready(None)));
}

struct Backend {
    drops: Arc<Mutex<Vec<&'static str>>>,
    waker: Arc<Mutex<Option<Waker>>>,
}
impl WebSocketLike for Backend {
    fn start_send(self: Pin<&mut Self>, _: Message) -> Result<(), TransportError> {
        Ok(())
    }
    fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Result<(), TransportError>> {
        Poll::Ready(Ok(()))
    }
    fn poll_receive(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Message, TransportError>>> {
        *self.waker.lock().unwrap() = Some(cx.waker().clone());
        Poll::Pending
    }
}
impl Drop for Backend {
    fn drop(&mut self) {
        self.drops.lock().unwrap().push("socket");
    }
}
fn wait(mut predicate: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(3);
    while !predicate() {
        assert!(Instant::now() < deadline, "worker did not make progress");
        std::thread::sleep(Duration::from_millis(1));
    }
}

#[test]
fn drop_stops_unread_pending_and_always_ready_workers_without_waker_cycles() {
    for (read, busy) in [(false, false), (true, false), (true, true)] {
        let drops = Arc::new(Mutex::new(vec![]));
        let polls = Arc::new(AtomicUsize::new(0));
        let input_waker = Arc::new(Mutex::new(None));
        let socket_waker = Arc::new(Mutex::new(None));
        let mut live = Live::new(Configuration {
            socket: Box::pin(Backend {
                drops: drops.clone(),
                waker: socket_waker.clone(),
            }),
            text: Text::Tts(Box::pin(Input {
                busy,
                polls: polls.clone(),
                drops: drops.clone(),
                waker: input_waker.clone(),
            })),
            voice: "custom".into(),
            settings: r#"{"voice_settings":{}}"#.into(),
            dialogue: false,
            timed: false,
            normalized: false,
            seed: [7; 16],
            max_message: 1024,
            heartbeat_interval: Duration::from_secs(10),
            validate: Box::new(|_, _| Ok(())),
        })
        .unwrap();
        let weak = Arc::downgrade(&live.shared);
        if read {
            let waker = Waker::from(live.shared.signal.clone());
            assert!(live.poll(&mut Context::from_waker(&waker)).is_pending());
            wait(|| polls.load(Ordering::SeqCst) >= if busy { 1000 } else { 1 });
        }
        drop(live);
        assert_eq!(*drops.lock().unwrap(), vec!["socket", "input"]);
        wait(|| weak.upgrade().is_none());
        // Retaining a backend/producer waker must not retain the worker state.
        assert_eq!(input_waker.lock().unwrap().is_some(), read);
        assert_eq!(socket_waker.lock().unwrap().is_some(), read);
    }
}
