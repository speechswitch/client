use super::{
    protocol::{self, failure},
    settings::{DialogueInput, Input, Text},
};
#[cfg(test)]
mod tests;
use crate::{
    generated::elevenlabs_output as out,
    http::TransportError,
    json,
    runtime::ValidationError,
    websocket::{Message, Socket},
};
use std::{
    any::Any,
    collections::{BTreeSet, VecDeque},
    sync::{Arc, Condvar, Mutex},
    task::{Context, Poll, Wake, Waker},
    time::{Duration, Instant},
};

pub(super) type Validator =
    Box<dyn Fn(&dyn Any, Option<&str>) -> Result<(), ValidationError> + Send>;
pub(super) struct Configuration {
    pub socket: Socket,
    pub text: Text,
    pub voice: String,
    pub settings: String,
    pub dialogue: bool,
    pub timed: bool,
    pub normalized: bool,
    pub seed: [u8; 16],
    pub max_message: usize,
    pub heartbeat_interval: Duration,
    pub validate: Validator,
}
struct Signal {
    generation: Mutex<u64>,
    changed: Condvar,
}
impl Wake for Signal {
    fn wake(self: Arc<Self>) {
        self.wake_by_ref()
    }
    fn wake_by_ref(self: &Arc<Self>) {
        let mut generation = self.generation.lock().unwrap();
        *generation = generation.wrapping_add(1);
        self.changed.notify_one();
    }
}
struct Shared {
    state: Mutex<State>,
    signal: Arc<Signal>,
}
struct State {
    machine: Option<Machine>,
    item: Option<Result<out::SynthesisItem, TransportError>>,
    next_error: Option<TransportError>,
    terminal: bool,
    demand: bool,
    consumer: Option<Waker>,
}
pub(super) struct Live {
    shared: Arc<Shared>,
}
impl Live {
    pub fn new(c: Configuration) -> Result<Self, TransportError> {
        let signal = Arc::new(Signal {
            generation: Mutex::new(0),
            changed: Condvar::new(),
        });
        let prefix = c
            .seed
            .iter()
            .map(|v| format!("{v:02x}"))
            .collect::<String>();
        let shared = Arc::new(Shared {
            signal,
            state: Mutex::new(State {
                machine: Some(Machine {
                    socket: Some(c.socket),
                    input: Some(c.text),
                    voice: c.voice,
                    settings: c.settings,
                    dialogue: c.dialogue,
                    timed: c.timed,
                    normalized: c.normalized,
                    context: format!("{prefix}:0"),
                    prefix,
                    index: 0,
                    retired: BTreeSet::new(),
                    max_message: c.max_message,
                    validate: c.validate,
                    started: false,
                    initialized: false,
                    input_done: false,
                    used: false,
                    prefer_output: true,
                    queue: VecDeque::new(),
                    writing: None,
                    interval: c.heartbeat_interval,
                    next_tick: Instant::now() + c.heartbeat_interval,
                }),
                item: None,
                next_error: None,
                terminal: false,
                demand: false,
                consumer: None,
            }),
        });
        let worker = shared.clone();
        // The backend/input contracts are Send and nonblocking. One interruptible
        // worker drives writes and heartbeats even when the consumer is idle.
        std::thread::Builder::new()
            .name("speechswitch-elevenlabs".into())
            .spawn(move || run(worker))?;
        Ok(Self { shared })
    }
    pub fn poll(
        &mut self,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<out::SynthesisItem, TransportError>>> {
        let mut state = self.shared.state.lock().unwrap();
        if let Some(item) = state.item.take() {
            return Poll::Ready(Some(item));
        }
        if let Some(error) = state.next_error.take() {
            return Poll::Ready(Some(Err(error)));
        }
        if state.terminal {
            return Poll::Ready(None);
        }
        state.demand = true;
        state.consumer = Some(cx.waker().clone());
        drop(state);
        self.shared.signal.wake_by_ref();
        Poll::Pending
    }
}
impl Drop for Live {
    fn drop(&mut self) {
        let mut state = self.shared.state.lock().unwrap();
        state.terminal = true;
        state.consumer = None;
        state.item = None;
        state.next_error = None;
        let machine = state.machine.take();
        drop(state);
        // Release native I/O before producer destruction; no new poll is needed.
        drop(machine);
        self.shared.signal.wake_by_ref();
    }
}
fn run(shared: Arc<Shared>) {
    let waker = Waker::from(shared.signal.clone());
    let mut cx = Context::from_waker(&waker);
    let mut ready_steps = 0;
    loop {
        let generation = *shared.signal.generation.lock().unwrap();
        let mut state = shared.state.lock().unwrap();
        let demand = state.demand;
        let Some(machine) = &mut state.machine else {
            return;
        };
        let step = machine.step(&mut cx, demand);
        let wait = if machine.started && !machine.input_done {
            Some(machine.next_tick.saturating_duration_since(Instant::now()))
        } else {
            None
        };
        let mut progress = false;
        let mut consumer = None;
        match step {
            Ok(Step::Pending) => {}
            Ok(Step::Progress) => progress = true,
            Ok(Step::Item(item)) => {
                state.item = Some(Ok(item));
                state.demand = false;
                consumer = state.consumer.take();
                progress = true;
            }
            Ok(Step::Final(item, error)) => {
                // Drop socket before publishing final audio or completion.
                state.machine = None;
                state.terminal = true;
                state.demand = false;
                if let Some(item) = item {
                    state.item = Some(Ok(item));
                    state.next_error = error
                } else {
                    state.item = error.map(Err)
                }
                consumer = state.consumer.take();
                progress = true;
            }
            Err(error) => {
                state.machine = None;
                state.terminal = true;
                if state.item.is_some() {
                    state.next_error = Some(error)
                } else {
                    state.item = Some(Err(error))
                }
                state.demand = false;
                consumer = state.consumer.take();
                progress = true;
            }
        }
        drop(state);
        if let Some(waker) = consumer {
            waker.wake()
        }
        if progress {
            ready_steps += 1;
            if ready_steps == 64 {
                ready_steps = 0;
                std::thread::yield_now();
            }
            continue;
        }
        ready_steps = 0;
        let guard = shared.signal.generation.lock().unwrap();
        if *guard != generation {
            continue;
        }
        if let Some(wait) = wait {
            drop(shared.signal.changed.wait_timeout(guard, wait).unwrap())
        } else {
            drop(shared.signal.changed.wait(guard).unwrap())
        }
    }
}
enum Step {
    Pending,
    Progress,
    Item(out::SynthesisItem),
    Final(Option<out::SynthesisItem>, Option<TransportError>),
}
enum Command {
    Text(String),
    Flush,
    Clear,
}
struct Machine {
    socket: Option<Socket>,
    input: Option<Text>,
    voice: String,
    settings: String,
    dialogue: bool,
    timed: bool,
    normalized: bool,
    context: String,
    prefix: String,
    index: u64,
    retired: BTreeSet<String>,
    max_message: usize,
    validate: Validator,
    started: bool,
    initialized: bool,
    input_done: bool,
    used: bool,
    prefer_output: bool,
    queue: VecDeque<(String, Option<String>)>,
    writing: Option<Option<String>>,
    interval: Duration,
    next_tick: Instant,
}
impl Drop for Machine {
    fn drop(&mut self) {
        drop(self.socket.take());
        drop(self.input.take());
    }
}
impl Machine {
    fn initialize(&mut self) {
        let mut text = self.settings.clone();
        text.pop();
        if self.dialogue {
            text.push_str(",\"voices\":[");
            json::quote(&self.voice, &mut text);
            text.push_str("]}")
        } else {
            text.push_str(",\"text\":\" \",\"context_id\":");
            json::quote(&self.context, &mut text);
            text.push('}')
        }
        self.queue.push_back((text, Some(self.context.clone())));
    }
    fn rotate(&mut self) -> Result<String, TransportError> {
        self.index = self
            .index
            .checked_add(1)
            .ok_or_else(|| failure("ElevenLabs context counter exhausted"))?;
        let old = std::mem::replace(&mut self.context, format!("{}:{}", self.prefix, self.index));
        self.retired.insert(old.clone());
        self.initialized = false;
        self.used = false;
        Ok(old)
    }
    fn text_message(&self, text: &str, flush: bool) -> String {
        let mut result = String::from("{\"context_id\":");
        json::quote(&self.context, &mut result);
        result.push_str(",\"text\":");
        json::quote(text, &mut result);
        if flush {
            result.push_str(",\"flush\":true")
        };
        result.push('}');
        result
    }
    fn step(&mut self, cx: &mut Context<'_>, demand: bool) -> Result<Step, TransportError> {
        if !self.started {
            if !demand {
                return Ok(Step::Pending);
            }
            self.started = true;
            self.next_tick = Instant::now() + self.interval;
            self.initialize();
            return Ok(Step::Progress);
        }
        if Instant::now() >= self.next_tick {
            self.next_tick = Instant::now() + self.interval;
            if !self.input_done
                && self.initialized
                && self.queue.is_empty()
                && self.writing.is_none()
            {
                let text = if self.dialogue {
                    r#"{"keep_alive":true}"#.into()
                } else {
                    self.text_message("", false)
                };
                self.queue.push_back((text, None));
            }
        }
        if self.writing.is_some() {
            match self.socket.as_mut().unwrap().as_mut().poll_flush(cx) {
                Poll::Ready(result) => {
                    result?;
                    if self
                        .writing
                        .take()
                        .flatten()
                        .is_some_and(|id| id == self.context)
                    {
                        self.initialized = true
                    }
                    return Ok(Step::Progress);
                }
                Poll::Pending => {}
            }
        } else if let Some((text, ready)) = self.queue.pop_front() {
            if text.len() > self.max_message {
                return Err(failure("ElevenLabs message exceeds max_message_bytes"));
            }
            self.socket
                .as_mut()
                .unwrap()
                .as_mut()
                .start_send(Message::Text(text))?;
            self.writing = Some(ready);
            return Ok(Step::Progress);
        }
        if !demand {
            return Ok(Step::Pending);
        }
        let order = if self.prefer_output {
            [true, false]
        } else {
            [false, true]
        };
        for output in order {
            let result = if output {
                self.read(cx)?
            } else {
                self.read_input(cx)?
            };
            if !matches!(result, Step::Pending) {
                self.prefer_output = !output;
                return Ok(result);
            }
        }
        Ok(Step::Pending)
    }
    fn read_input(&mut self, cx: &mut Context<'_>) -> Result<Step, TransportError> {
        if self.input_done || self.writing.is_some() || !self.queue.is_empty() {
            return Ok(Step::Pending);
        }
        let item = match self.input.as_mut().unwrap() {
            Text::Tts(input) => match input.as_mut().poll_next(cx) {
                Poll::Pending => return Ok(Step::Pending),
                Poll::Ready(None) => None,
                Poll::Ready(Some(value)) => {
                    let value = value?;
                    (self.validate)(&value, None)?;
                    Some(match value {
                        Input::String(value) => Command::Text(value),
                        Input::Flush(_) => Command::Flush,
                        Input::Clear(_) => Command::Clear,
                    })
                }
            },
            Text::Dialogue(input) => match input.as_mut().poll_next(cx) {
                Poll::Pending => return Ok(Step::Pending),
                Poll::Ready(None) => None,
                Poll::Ready(Some(value)) => {
                    let value = value?;
                    (self.validate)(&value, None)?;
                    Some(match value {
                        DialogueInput::String(value) => Command::Text(value),
                        DialogueInput::Flush(_) => Command::Flush,
                    })
                }
            },
            Text::Whole(_) => unreachable!("HTTP input cannot enter a socket worker"),
        };
        match item {
            None => {
                self.input_done = true;
                if !self.used {
                    return Ok(Step::Final(None, None));
                }
                if !self.dialogue {
                    self.queue.push_back((self.text_message(" ", true), None));
                }
                self.queue
                    .push_back((r#"{"close_socket":true}"#.into(), None));
            }
            Some(Command::Clear) => {
                let old = self.rotate()?;
                let mut text = String::from("{\"close_context\":true,\"context_id\":");
                json::quote(&old, &mut text);
                text.push('}');
                self.queue.push_back((text, None));
                self.initialize();
                return Ok(Step::Item(out::SynthesisItem::Clear(out::ClearEvent {
                    event: Default::default(),
                })));
            }
            Some(Command::Flush) => {
                if self.used {
                    self.queue.push_back((
                        if self.dialogue {
                            r#"{"flush":true}"#.into()
                        } else {
                            self.text_message(" ", true)
                        },
                        None,
                    ));
                }
            }
            Some(Command::Text(text)) => {
                if !text.is_empty() {
                    self.used = true;
                    let message = if self.dialogue {
                        let mut value = String::from("{\"inputs\":[{\"text\":");
                        json::quote(&text, &mut value);
                        value.push_str(",\"voice_id\":");
                        json::quote(&self.voice, &mut value);
                        value.push_str("}]}");
                        value
                    } else {
                        self.text_message(&text, false)
                    };
                    self.queue.push_back((message, None));
                }
            }
        }
        Ok(Step::Progress)
    }
    fn read(&mut self, cx: &mut Context<'_>) -> Result<Step, TransportError> {
        let text = match self.socket.as_mut().unwrap().as_mut().poll_receive(cx) {
            Poll::Pending => return Ok(Step::Pending),
            Poll::Ready(None) => {
                return Err(failure("ElevenLabs WebSocket closed before final output"))
            }
            Poll::Ready(Some(value)) => match value? {
                Message::Text(value) => value,
                _ => return Err(failure("ElevenLabs returned a non-text WebSocket frame")),
            },
        };
        if text.len() > self.max_message {
            return Err(failure("ElevenLabs message exceeds max_message_bytes"));
        }
        let packet = protocol::decode(&text, self.dialogue, self.normalized)?;
        if packet
            .context
            .as_ref()
            .is_some_and(|id| self.retired.contains(id))
        {
            return Ok(Step::Progress);
        }
        if let Some(error) = packet.error {
            return Err(Box::new(error));
        }
        if !self.dialogue && packet.context.as_deref() != Some(&self.context) {
            return Err(failure(
                "ElevenLabs returned an unexpected context identifier",
            ));
        }
        let item = packet
            .audio
            .map(|value| -> Result<_, TransportError> {
                let audio = protocol::audio(&value)?;
                Ok(if self.timed {
                    out::SynthesisItem::Chunk(out::TimestampedAudio {
                        correlation: Default::default(),
                        audio,
                        timestamps: protocol::timestamps(
                            packet.alignment,
                            if self.dialogue { "dialogue" } else { "tts" },
                        )?,
                    })
                } else {
                    out::SynthesisItem::Bytes(audio)
                })
            })
            .transpose()?;
        if packet.final_ {
            if self.input_done || self.dialogue {
                return Ok(Step::Final(
                    item,
                    if self.input_done {
                        None
                    } else {
                        Some(failure("ElevenLabs dialogue ended before input completed"))
                    },
                ));
            }
            self.rotate()?;
            self.initialize();
        }
        Ok(item.map_or(Step::Progress, Step::Item))
    }
}
