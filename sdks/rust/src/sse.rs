//! Incremental SSE data-event framing; no JSON, reconnection or provider semantics.
//! https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream
use crate::generated::transport::SseMessage;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecodeError { InvalidLimit, EventTooLarge, Closed }

impl std::fmt::Display for DecodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::InvalidLimit => "SSE event limit must be positive",
            Self::EventTooLarge => "SSE event exceeds byte limit",
            Self::Closed => "SSE decoder is closed",
        })
    }
}
impl std::error::Error for DecodeError {}

/// Push response bytes in order, dispatching each returned message immediately.
/// Counts raw bytes per block with line endings normalized to one byte; the blank
/// separator is excluded. Includes comments, unknown fields and a leading BOM.
/// A limit error is terminal. Finish at EOF; unfinished data is never dispatched.
pub struct Decoder {
    limit: usize,
    size: usize,
    line: Vec<u8>,
    data: String,
    event: String,
    first: bool,
    skip_lf: bool,
    closed: bool,
}

impl Decoder {
    pub fn new(max_event_bytes: usize) -> Result<Self, DecodeError> {
        if max_event_bytes == 0 { return Err(DecodeError::InvalidLimit); }
        Ok(Self { limit: max_event_bytes, size: 0, line: Vec::new(), data: String::new(),
            event: String::new(), first: true, skip_lf: false, closed: false })
    }

    pub fn push(&mut self, byte: u8) -> Result<Option<SseMessage>, DecodeError> {
        if self.closed { return Err(DecodeError::Closed); }
        if self.skip_lf {
            self.skip_lf = false;
            if byte == b'\n' { return Ok(None); }
        }
        let newline = byte == b'\r' || byte == b'\n';
        // Dispatch on CR immediately, without waiting for another network read.
        self.skip_lf = byte == b'\r';
        if !newline || !self.line.is_empty() {
            if self.size == self.limit {
                self.finish();
                return Err(DecodeError::EventTooLarge);
            }
            self.size += 1;
        }
        if !newline { self.line.push(byte); return Ok(None); }
        let line = String::from_utf8_lossy(&self.line);
        let line = if self.first { line.strip_prefix('\u{feff}').unwrap_or(&line) } else { &line };
        self.first = false;
        if line.is_empty() {
            self.line.clear();
            self.size = 0;
            let event = std::mem::take(&mut self.event);
            if self.data.is_empty() { return Ok(None); }
            self.data.pop(); // Only the LF appended by a data field.
            return Ok(Some(SseMessage {
                event: if event.is_empty() { "message".into() } else { event },
                data: std::mem::take(&mut self.data),
            }));
        }
        let (field, value) = line.split_once(':').unwrap_or((line, ""));
        let value = value.strip_prefix(' ').unwrap_or(value);
        match field {
            "data" => { self.data.push_str(value); self.data.push('\n'); }
            "event" => { self.event.clear(); self.event.push_str(value); }
            _ => {}
        }
        self.line.clear();
        Ok(None)
    }

    /// Idempotent EOF/consumer-exit cleanup. Does not synthesize a done event.
    pub fn finish(&mut self) {
        self.closed = true;
        self.line = Vec::new();
        self.data = String::new();
        self.event = String::new();
    }
}
