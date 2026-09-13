use super::{Live, Next};
use crate::http::TransportError;
use std::{
    sync::{Arc, Condvar, Mutex},
    task::{Context, Poll, Wake, Waker},
    time::Instant,
};

struct Signal {
    generation: Mutex<u64>,
    changed: Condvar,
}
impl Wake for Signal {
    fn wake(self: Arc<Self>) {
        self.wake_by_ref();
    }
    fn wake_by_ref(self: &Arc<Self>) {
        let mut generation = self.generation.lock().unwrap();
        *generation = generation.wrapping_add(1);
        self.changed.notify_one();
    }
}
struct State {
    live: Option<Live>,
    error: Option<TransportError>,
    consumer: Option<Waker>,
}
struct Shared {
    state: Mutex<State>,
    signal: Arc<Signal>,
}
pub(super) struct Driver {
    shared: Arc<Shared>,
}
impl Driver {
    pub(super) fn new(live: Live) -> Result<Self, TransportError> {
        let shared = Arc::new(Shared {
            state: Mutex::new(State {
                live: Some(live),
                error: None,
                consumer: None,
            }),
            signal: Arc::new(Signal {
                generation: Mutex::new(0),
                changed: Condvar::new(),
            }),
        });
        let worker = shared.clone();
        std::thread::Builder::new()
            .name("speechswitch-smallest".into())
            .spawn(move || run(worker))?;
        Ok(Self { shared })
    }
    pub(super) fn next(&mut self, cx: &mut Context<'_>) -> Next {
        let mut state = self.shared.state.lock().unwrap();
        if let Some(error) = state.error.take() {
            return Poll::Ready(Err(error));
        }
        state.consumer = Some(cx.waker().clone());
        // Only consumer demand may poll the application input. The worker owns
        // no output queue and buffers at most one native packet in Live.
        let next = state.live.as_mut().expect("active socket driver").next(cx);
        if matches!(next, Poll::Ready(Err(_)) | Poll::Ready(Ok(None))) {
            state.live = None;
        }
        drop(state);
        self.shared.signal.wake_by_ref();
        next
    }
}
impl Drop for Driver {
    fn drop(&mut self) {
        let mut state = self.shared.state.lock().unwrap();
        let live = state.live.take();
        state.consumer = None;
        drop(state);
        // Abort socket I/O before dropping the application producer, without
        // requiring another consumer poll or an executor-specific task handle.
        drop(live);
        self.shared.signal.wake_by_ref();
    }
}
fn run(shared: Arc<Shared>) {
    let waker = Waker::from(shared.signal.clone());
    let mut cx = Context::from_waker(&waker);
    loop {
        let generation = *shared.signal.generation.lock().unwrap();
        let mut state = shared.state.lock().unwrap();
        let Some(live) = &mut state.live else {
            return;
        };
        let progress = background(live, &mut cx);
        // A blocked write must wait for its waker, not spin on an expired tick.
        let wait = if live.writing {
            None
        } else {
            live.heartbeat_at
                .map(|at| at.saturating_duration_since(Instant::now()))
        };
        let consumer = match progress {
            Ok(false) => None,
            Ok(true) => state.consumer.clone(),
            Err(error) => {
                state.error = Some(error);
                state.live = None;
                state.consumer.take()
            }
        };
        let terminal = state.live.is_none();
        drop(state);
        if let Some(consumer) = consumer {
            consumer.wake();
        }
        if terminal {
            return;
        }
        let guard = shared.signal.generation.lock().unwrap();
        if *guard != generation {
            std::thread::yield_now();
            continue;
        }
        if let Some(wait) = wait {
            drop(shared.signal.changed.wait_timeout(guard, wait).unwrap());
        } else {
            drop(shared.signal.changed.wait(guard).unwrap());
        }
    }
}
fn background(live: &mut Live, cx: &mut Context<'_>) -> Result<bool, TransportError> {
    let mut progress = live.poll_incoming(cx)?;
    if live.writing {
        match live.socket.as_mut().poll_flush(cx) {
            Poll::Pending => return Ok(progress),
            Poll::Ready(result) => {
                result?;
                live.writing = false;
                progress = true;
            }
        }
    }
    if live.heartbeat_at.is_some_and(|at| Instant::now() >= at) {
        live.send(r#"{"type":"ping"}"#.into(), false)?;
        live.heartbeat_at = Some(Instant::now() + live.heartbeat_interval);
        // Register flush readiness immediately; start_send need not wake us.
        match live.socket.as_mut().poll_flush(cx) {
            Poll::Pending => {}
            Poll::Ready(result) => {
                result?;
                live.writing = false;
            }
        }
        progress = true;
    }
    Ok(progress)
}
