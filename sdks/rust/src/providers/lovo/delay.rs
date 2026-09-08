use crate::http::TransportError;
use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Condvar, Mutex},
    task::{Context, Poll, Waker},
    time::{Duration, Instant},
};

struct State {
    ready: bool,
    stopped: bool,
    waker: Option<Waker>,
}
struct Shared {
    state: Mutex<State>,
    changed: Condvar,
}
pub(super) struct Delay {
    shared: Arc<Shared>,
    yielded: bool,
}
impl Delay {
    pub fn new(milliseconds: u32) -> Result<Self, TransportError> {
        let shared = Arc::new(Shared {
            state: Mutex::new(State {
                ready: milliseconds == 0,
                stopped: false,
                waker: None,
            }),
            changed: Condvar::new(),
        });
        if milliseconds != 0 {
            let deadline = Instant::now()
                .checked_add(Duration::from_millis(milliseconds.into()))
                .ok_or_else(|| {
                    super::failure("LOVO polling interval exceeds the monotonic clock range")
                })?;
            let shared = shared.clone();
            // No executor dependency. Drop wakes this worker instead of leaving
            // an abandoned polling timer asleep for its entire interval.
            std::thread::Builder::new()
                .name("speechswitch-lovo-poll".into())
                .spawn(move || {
                    let mut state = shared.state.lock().unwrap();
                    loop {
                        if state.stopped {
                            return;
                        }
                        let remaining = deadline.saturating_duration_since(Instant::now());
                        if remaining.is_zero() {
                            state.ready = true;
                            let waker = state.waker.take();
                            drop(state);
                            if let Some(waker) = waker {
                                waker.wake();
                            }
                            return;
                        }
                        state = shared.changed.wait_timeout(state, remaining).unwrap().0;
                    }
                })?;
        }
        Ok(Self {
            shared,
            yielded: false,
        })
    }
}
impl Future for Delay {
    type Output = ();
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
        let this = self.get_mut();
        if !this.yielded {
            this.yielded = true;
            cx.waker().wake_by_ref();
            return Poll::Pending;
        }
        let mut state = this.shared.state.lock().unwrap();
        if state.ready {
            Poll::Ready(())
        } else {
            state.waker = Some(cx.waker().clone());
            Poll::Pending
        }
    }
}
impl Drop for Delay {
    fn drop(&mut self) {
        let mut state = self.shared.state.lock().unwrap();
        state.stopped = true;
        state.waker = None;
        self.shared.changed.notify_one();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn drop_releases_a_long_lived_timer() {
        let delay = Delay::new(60000).unwrap();
        let shared = Arc::downgrade(&delay.shared);
        drop(delay);
        let deadline = Instant::now() + Duration::from_secs(3);
        while shared.upgrade().is_some() {
            assert!(
                Instant::now() < deadline,
                "timer worker retained canceled state"
            );
            std::thread::sleep(Duration::from_millis(1));
        }
        assert_eq!(shared.strong_count(), 0);
    }
}
