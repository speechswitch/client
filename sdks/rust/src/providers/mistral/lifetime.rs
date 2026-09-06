use crate::{http::TransportError, runtime::StreamingInput};
use std::{
    sync::{Arc, Condvar, Mutex},
    task::{Context, Poll, Waker},
    time::{Duration, Instant},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DeadlineExpired;
impl std::fmt::Display for DeadlineExpired {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Mistral synthesis deadline expired")
    }
}
impl std::error::Error for DeadlineExpired {}

struct State {
    body: Option<StreamingInput<Vec<u8>>>,
    expired: bool,
    stopped: bool,
    waker: Option<Waker>,
}
struct Shared {
    state: Mutex<State>,
    changed: Condvar,
}
pub(super) struct Lifetime {
    shared: Arc<Shared>,
}
impl Lifetime {
    pub fn new(timeout: Option<Duration>) -> Result<Self, TransportError> {
        let shared = Arc::new(Shared {
            state: Mutex::new(State {
                body: None,
                expired: false,
                stopped: false,
                waker: None,
            }),
            changed: Condvar::new(),
        });
        if let Some(timeout) = timeout {
            if timeout.is_zero() {
                return Err(Box::new(DeadlineExpired));
            }
            let deadline = Instant::now().checked_add(timeout).ok_or_else(|| {
                super::protocol::failure("Mistral timeout exceeds the monotonic clock range")
            })?;
            let shared = shared.clone();
            // No executor dependency: one interruptible timer thread per explicit
            // timeout. It also releases an idle response between consumer polls.
            std::thread::Builder::new()
                .name("speechswitch-deadline".into())
                .spawn(move || {
                    let mut state = shared.state.lock().unwrap();
                    loop {
                        if state.stopped {
                            return;
                        }
                        let remaining = deadline.saturating_duration_since(Instant::now());
                        if remaining.is_zero() {
                            state.expired = true;
                            let body = state.body.take();
                            let waker = state.waker.take();
                            drop(state);
                            drop(body);
                            if let Some(waker) = waker {
                                waker.wake();
                            }
                            return;
                        }
                        state = shared.changed.wait_timeout(state, remaining).unwrap().0;
                    }
                })?;
        }
        Ok(Self { shared })
    }
    pub fn check(&self, context: &Context<'_>) -> Result<(), TransportError> {
        let mut state = self.shared.state.lock().unwrap();
        if state.expired {
            return Err(Box::new(DeadlineExpired));
        }
        if state
            .waker
            .as_ref()
            .map_or(true, |waker| !waker.will_wake(context.waker()))
        {
            state.waker = Some(context.waker().clone());
        }
        Ok(())
    }
    pub fn set_body(&self, body: StreamingInput<Vec<u8>>) -> Result<(), TransportError> {
        let mut state = self.shared.state.lock().unwrap();
        if state.expired {
            return Err(Box::new(DeadlineExpired));
        }
        state.body = Some(body);
        Ok(())
    }
    pub fn poll_body(
        &self,
        context: &mut Context<'_>,
    ) -> Poll<Option<Result<Vec<u8>, TransportError>>> {
        let mut state = self.shared.state.lock().unwrap();
        if state.expired {
            return Poll::Ready(Some(Err(Box::new(DeadlineExpired))));
        }
        let result = match &mut state.body {
            Some(body) => body.as_mut().poll_next(context),
            None => Poll::Ready(None),
        };
        if matches!(result, Poll::Ready(None) | Poll::Ready(Some(Err(_)))) {
            let body = state.body.take();
            drop(state);
            drop(body);
        }
        result
    }
    pub fn finish(&self) {
        let mut state = self.shared.state.lock().unwrap();
        state.stopped = true;
        state.waker = None;
        let body = state.body.take();
        self.shared.changed.notify_one();
        drop(state);
        drop(body);
    }
}
impl Drop for Lifetime {
    fn drop(&mut self) {
        self.finish();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dropping_cancels_the_timer_without_waiting_for_its_deadline() {
        let lifetime = Lifetime::new(Some(Duration::from_secs(60))).unwrap();
        let shared = Arc::downgrade(&lifetime.shared);
        drop(lifetime);
        let limit = Instant::now() + Duration::from_secs(3);
        while shared.upgrade().is_some() {
            assert!(
                Instant::now() < limit,
                "deadline worker retained canceled state"
            );
            std::thread::sleep(Duration::from_millis(1));
        }
        assert_eq!(shared.strong_count(), 0);
    }
}
