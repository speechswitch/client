"""Incremental SSE framing, not JSON/audio decoding or an EventSource client.

https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream
"""

from speechswitch.generated.transport import SseMessage


class SseDecoder:
    """Push bytes in order; immediately consume each returned data event.

    The positive limit counts raw block bytes, including comments/unknown fields
    and a leading BOM, with line endings normalized to one byte and the blank
    separator excluded. Errors are terminal; finish discards unfinished data.
    This single-consumer decoder does not own the HTTP response.
    """

    def __init__(self, max_event_bytes: int) -> None:
        if type(max_event_bytes) is not int or max_event_bytes <= 0:
            raise ValueError("SSE event limit must be positive")
        self._limit = max_event_bytes
        self._size = 0
        self._line = bytearray()
        self._data: list[str] = []
        self._event = ""
        self._first = True
        self._skip_lf = False
        self._closed = False

    def push(self, byte: int) -> SseMessage | None:
        if self._closed:
            raise ValueError("SSE decoder is closed")
        if type(byte) is not int or not 0 <= byte <= 255:
            self.finish()
            raise ValueError("SSE input must be a byte")
        if self._skip_lf:
            self._skip_lf = False
            if byte == 10:
                return None
        newline = byte in (10, 13)
        self._skip_lf = byte == 13
        if not newline or self._line:
            if self._size == self._limit:
                self.finish()
                raise ValueError("SSE event exceeds byte limit")
            self._size += 1
        if not newline:
            self._line.append(byte)
            return None
        # Newline bytes cannot appear inside UTF-8 sequences. Decoding complete
        # lines preserves split characters and replaces malformed prefixes once.
        line = self._line.decode("utf-8", errors="replace")
        self._line.clear()
        if self._first:
            line = line.removeprefix("\ufeff")
            self._first = False
        if not line:
            self._size = 0
            event, self._event = self._event, ""
            if not self._data:
                return None
            data, self._data = self._data, []
            return {"event": event or "message", "data": "\n".join(data)}
        field, _, value = line.partition(":")
        value = value.removeprefix(" ")
        if field == "data":
            self._data.append(value)
        elif field == "event":
            self._event = value
        return None

    def finish(self) -> None:
        """Idempotent EOF/consumer-exit cleanup; never manufacture completion."""
        self._closed = True
        self._line.clear()
        self._data.clear()
        self._event = ""
