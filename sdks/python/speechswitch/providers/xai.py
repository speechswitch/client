"""Handwritten xAI HTTP/WebSocket protocol over TypeScript-generated contracts."""

import asyncio
import base64
import json
import math
import os
import re
from collections.abc import AsyncGenerator, AsyncIterable, AsyncIterator, Awaitable, Mapping, Sequence
from contextlib import AsyncExitStack, asynccontextmanager, nullcontext
from dataclasses import dataclass
from typing import NoReturn, Protocol, runtime_checkable
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

from speechswitch.generated.auth import Auth
from speechswitch.generated.xai import TtsRequest, TtsRequestStreamingTextTextItem as TtsInput
from speechswitch.generated.xai_output import CharacterTimestamp, DoneEvent, StreamEvent, SynthesisItem, TimestampedAudio, UpdatedEventReplacementsItem as Replacement, Voice
from speechswitch.generated.validators.xai import REQUEST_DEFAULTS, validate_request
from speechswitch.http import AudioStream, HttpRequest, HttpTransport
from speechswitch.validation import InputValidator, code_point_length, is_mapping, is_number, is_sequence
from speechswitch.websocket import WebSocketLike, connect_websocket


class XaiError(Exception):
    def __init__(self, status: int | None) -> None:
        self.status = status
        super().__init__("xAI reported a synthesis error" if status is None else f"xAI returned HTTP {status}")


@runtime_checkable
class _Closable(Protocol):
    def aclose(self) -> Awaitable[None]: ...


@asynccontextmanager
async def _closing[T: _Closable](resource: T) -> AsyncIterator[T]:
    try:
        yield resource
    except BaseException:
        try:
            await resource.aclose()
        except Exception:
            pass
        raise
    else:
        await resource.aclose()


def _key(auth: Auth | None) -> str:
    entry = auth.get("xai") if auth is not None else None
    key = entry["api_key"] if entry is not None and "api_key" in entry else os.environ.get("SPEECHSWITCH_XAI_API_KEY", os.environ.get("XAI_API_KEY"))
    if not key:
        raise TypeError("Missing auth.xai.apiKey configuration")
    if any(not 33 <= ord(c) <= 126 for c in key):
        raise TypeError("xAI API key must contain only visible ASCII characters")
    return key


def _url(base: str, path: str, socket: bool) -> str:
    try:
        url = urlsplit(base)
        if url.scheme not in ("http", "https", "ws", "wss") or not url.hostname or url.username is not None or url.password is not None or "#" in base or url.netloc.endswith(":") or any(c.isspace() or ord(c) < 32 or ord(c) == 127 or c == "\\" for c in base) or re.search(r"%(?![0-9a-fA-F]{2})", base):
            raise ValueError
        _ = url.port
    except ValueError:
        raise TypeError("xAI endpoint must be HTTP(S) or WS(S) without credentials, fragments or invalid escapes") from None
    scheme = ("ws" if socket else "http") if url.scheme in ("http", "ws") else ("wss" if socket else "https")
    return urlunsplit((scheme, url.netloc, url.path.rstrip("/") + path, url.query, ""))


def _limits(timeout_ms: int | None, limit: int, name: str) -> None:
    if type(limit) is not int or not 0 < limit <= 9007199254740991:
        raise TypeError(f"xAI {name} must be a positive safe integer")
    if timeout_ms is not None and (type(timeout_ms) is not int or not 0 <= timeout_ms <= 2147483647):
        raise TypeError("xAI timeout_ms must be an integer between 0 and 2147483647")
    if timeout_ms == 0:
        raise TimeoutError("xAI deadline expired")


def _replacements(values: Sequence[Replacement]) -> dict[str, str]:
    result: dict[str, str] = {}
    phrases: set[str] = set()
    for item in values:
        # Phrase equivalence is a wire invariant, not a duplicate schema bound.
        phrase = re.sub(r"[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+", " ", item["pattern"]).strip(" ").lower()
        if phrase in phrases:
            raise TypeError(f"Duplicate xAI replacement phrase: {item['pattern']}")
        phrases.add(phrase)
        result[item["pattern"]] = item["replacement"]
    return result


def _wire(request: TtsRequest, initial: dict[str, str] | None) -> dict[str, object]:
    wire: dict[str, object] = {"language": request.get("language", REQUEST_DEFAULTS["language"])}
    if "voice" in request:
        wire["voice_id"] = request["voice"]
    if "output" in request:
        output = request["output"]
        native: dict[str, object] = {"codec": output["format"]}
        if "sample_rate_hz" in output:
            native["sample_rate"] = output["sample_rate_hz"]
        if output["format"] == "mp3" and "bit_rate_bps" in output:
            native["bit_rate"] = output["bit_rate_bps"]
        wire["output_format"] = native
    if "speed" in request:
        wire["speed"] = request["speed"]
    if "latency_optimization" in request:
        wire["optimize_streaming_latency"] = {"none": 0, "moderate": 1, "aggressive": 2}[request["latency_optimization"]]
    if "text_normalization" in request:
        wire["text_normalization"] = request["text_normalization"]
    if initial is not None:
        wire["replace"] = initial
    if request.get("timestamp_granularity") == "character":
        wire["with_timestamps"] = True
    return wire


def _socket_url(url: str, wire: Mapping[str, object]) -> str:
    target = urlsplit(url)
    values: dict[str, object] = {key: value for key, value in wire.items() if key not in ("replace", "voice_id", "output_format")}
    if "voice_id" in wire:
        values["voice"] = wire["voice_id"]
    output = wire.get("output_format")
    if is_mapping(output):
        for key in ("codec", "sample_rate", "bit_rate"):
            if key in output:
                values[key] = output[key]
    managed = {"language", "voice", "codec", "sample_rate", "bit_rate", "speed", "optimize_streaming_latency", "text_normalization", "with_timestamps"}
    query = [(key, value) for key, value in parse_qsl(target.query, keep_blank_values=True) if key not in managed]
    for key, value in values.items():
        encoded = "true" if value is True else "false" if value is False else str(int(value)) if isinstance(value, float) and value.is_integer() else str(value)
        query.append((key, encoded))
    return urlunsplit((target.scheme, target.netloc, target.path, urlencode(query), ""))


def _invalid_constant(_: str) -> NoReturn:
    raise ValueError("Non-JSON number")


def _json(data: str | bytes | bytearray) -> object:
    try:
        if not isinstance(data, str):
            data = data.decode("utf-8-sig")
        value: object = json.loads(data, parse_constant=_invalid_constant)
        pending = [value]
        while pending:
            item = pending.pop()
            if isinstance(item, str):
                item.encode("utf-8")
            elif is_mapping(item):
                pending.extend(item.keys())
                pending.extend(item.values())
            elif is_sequence(item):
                pending.extend(item)
        return value
    except (ValueError, RecursionError):
        raise TypeError("Invalid xAI JSON") from None


def _milliseconds(value: object, message: str) -> float:
    if not is_number(value) or value < 0:
        raise TypeError(message)
    result = value * 1000.0
    if not math.isfinite(result):
        raise TypeError(message)
    return result


def _audio(value: Mapping[object, object], key: str, duration: str) -> TimestampedAudio:
    encoded = value.get(key)
    try:
        if not isinstance(encoded, str):
            raise ValueError
        audio = base64.b64decode(encoded, validate=True)
        if base64.b64encode(audio).decode("ascii") != encoded:
            raise ValueError
    except ValueError:
        raise TypeError("Invalid xAI base64 audio") from None
    timestamps: list[CharacterTimestamp] = []
    if "audio_timestamps" in value:
        raw = value["audio_timestamps"]
        if not is_mapping(raw):
            raise TypeError("Invalid xAI character timestamps")
        chars, times = raw.get("graph_chars"), raw.get("graph_times")
        if not is_sequence(chars) or not is_sequence(times) or len(chars) != len(times):
            raise TypeError("xAI returned incomplete or mismatched character timestamps")
        for char, time in zip(chars, times):
            if not isinstance(char, str) or not is_sequence(time) or len(time) != 2:
                raise TypeError("Invalid xAI character timestamp interval")
            start, end = (_milliseconds(v, "Invalid xAI character timestamp interval") for v in time)
            if end < start:
                raise TypeError("Invalid xAI character timestamp interval")
            timestamps.append({"kind": "character", "value": char, "start_time_ms": start, "end_time_ms": end})
    result: TimestampedAudio = {"correlation": "chunk", "audio": audio, "timestamps": timestamps}
    if duration in value:
        return {**result, "duration_ms": _milliseconds(value[duration], "Invalid xAI audio duration")}
    return result


@dataclass(frozen=True, slots=True)
class _Audio:
    item: TimestampedAudio


def _decode(frame: str | bytes, limit: int) -> _Audio | StreamEvent:
    if not isinstance(frame, str):
        raise TypeError("xAI returned a non-text WebSocket message")
    try:
        length = len(frame.encode("utf-8"))
    except UnicodeError:
        raise TypeError("Invalid xAI JSON") from None
    if length > limit:
        raise TypeError("xAI message exceeds max_message_bytes")
    event = _json(frame)
    if not is_mapping(event):
        raise TypeError("xAI returned an invalid WebSocket event")
    kind = event.get("type")
    if kind == "audio.delta":
        return _Audio(_audio(event, "delta", "audio_duration"))
    if kind == "audio.done":
        if "trace_id" in event:
            trace = event["trace_id"]
            if not isinstance(trace, str):
                raise TypeError("Invalid xAI trace identifier")
            return {"event": "done", "trace_id": trace}
        return {"event": "done"}
    if kind == "audio.clear":
        return {"event": "clear"}
    if kind == "session.updated":
        raw = event.get("replace")
        if not is_mapping(raw):
            raise TypeError("xAI session.updated event has no valid replacement map")
        replacements: list[Replacement] = []
        for pattern, replacement in raw.items():
            if not isinstance(pattern, str) or not isinstance(replacement, str):
                raise TypeError("xAI session.updated event has no valid replacement map")
            replacements.append({"pattern": pattern, "replacement": replacement})
        return {"event": "updated", "replacements": replacements}
    if kind == "error":
        if not isinstance(event.get("message"), str):
            raise TypeError("xAI error event has no message")
        raise XaiError(None)
    raise TypeError("xAI returned an unknown WebSocket event")


@dataclass(slots=True)
class _State:
    has_text: bool = False
    flushing: bool = False
    clearing: bool = False
    updates: int = 0


_cleanup_tasks: set[asyncio.Task[None]] = set()


def _observe(task: asyncio.Task[None]) -> None:
    _cleanup_tasks.discard(task)
    if not task.cancelled():
        task.exception()


async def _cleanup(tasks: Sequence[Awaitable[object]], source: AsyncIterator[TtsInput] | None) -> None:
    await asyncio.gather(*tasks, return_exceptions=True)
    if isinstance(source, _Closable):
        await source.aclose()


async def _live(text: AsyncIterable[TtsInput], initial: dict[str, str] | None, socket: WebSocketLike,
                validate: InputValidator, timed: bool, limit: int) -> AsyncGenerator[SynthesisItem]:
    state = _State()
    source: AsyncIterator[TtsInput] | None = None
    pending_input: asyncio.Future[TtsInput] | None = None
    pending_output: asyncio.Future[_Audio | StreamEvent] | None = None
    pending_send: asyncio.Future[None] | None = None
    held: TtsInput | None = None
    held_eof = input_done = False
    waiting_done: DoneEvent | None = None
    prefer_output = True

    async def send(message: dict[str, object]) -> None:
        encoded = json.dumps(message, allow_nan=False, separators=(",", ":"))
        if len(encoded.encode("utf-8")) > limit:
            raise TypeError("xAI message exceeds max_message_bytes")
        await socket.send(encoded)

    async def receive() -> _Audio | StreamEvent:
        try:
            packet = _decode(await socket.receive(), limit)
        except StopAsyncIteration:
            raise TypeError("xAI WebSocket closed before pending synthesis or acknowledgements completed") from None
        # Validate at receipt, not after later input or consumer backpressure.
        if isinstance(packet, _Audio):
            if not state.clearing and not state.has_text and not state.flushing:
                raise TypeError("xAI audio arrived outside an active utterance")
        elif packet["event"] == "clear":
            if not state.clearing:
                raise TypeError("Unexpected xAI audio.clear acknowledgement")
        elif packet["event"] == "done":
            if not state.clearing and not state.flushing:
                raise TypeError("Unexpected xAI audio.done acknowledgement")
        elif not state.updates:
            raise TypeError("Unexpected xAI session.updated acknowledgement")
        return packet

    try:
        source = aiter(text)
        pending_output = asyncio.ensure_future(receive())
        if initial is not None:
            state.updates += 1
            pending_send = asyncio.ensure_future(send({"type": "session.update", "replace": initial}))
        else:
            pending_input = asyncio.ensure_future(anext(source))
        while True:
            if waiting_done is not None and pending_send is None:
                yield waiting_done
                waiting_done = None
                pending_output = asyncio.ensure_future(receive())
            if input_done and not state.has_text and not state.flushing and not state.clearing and state.updates == 0 and pending_send is None:
                return
            available = (held is not None or held_eof) and not state.clearing and not state.flushing and pending_send is None
            completed: set[asyncio.Future[None] | asyncio.Future[_Audio | StreamEvent] | asyncio.Future[TtsInput]] = set()
            if not available:
                tasks = [task for task in (pending_send, pending_output, pending_input) if task is not None]
                done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                completed.update(done)
            candidates = (pending_send, pending_output, pending_input) if prefer_output else (pending_send, pending_input, pending_output)
            ready = next((task for task in candidates if task is not None and task in completed), None)
            prefer_output = ready is not pending_output
            if ready is pending_send and pending_send is not None:
                pending_send.result()
                pending_send = None
                if not input_done and held is None and not held_eof:
                    pending_input = asyncio.ensure_future(anext(source))
                continue
            if ready is pending_output and pending_output is not None:
                packet = pending_output.result()
                pending_output = None
                if isinstance(packet, _Audio):
                    if not state.clearing:
                        yield packet.item if timed else packet.item["audio"]
                elif packet["event"] == "clear":
                    state.clearing = state.flushing = False
                    yield packet
                elif packet["event"] == "done":
                    if not state.clearing:
                        state.flushing = False
                        if pending_send is not None:
                            waiting_done = packet
                            continue
                        yield packet
                else:
                    state.updates -= 1
                    yield packet
                pending_output = asyncio.ensure_future(receive())
                continue
            part, eof = held, held_eof
            held, held_eof = None, False
            if not available:
                assert pending_input is not None
                finished, pending_input = pending_input, None
                try:
                    part = finished.result()
                    validate(part)
                except StopAsyncIteration:
                    eof = True
            if state.clearing or state.flushing and (eof or isinstance(part, str) or part is not None and part["command"] == "flush"):
                held, held_eof = part, eof
                continue
            message: dict[str, object] | None = None
            if eof:
                input_done = True
                if state.has_text:
                    state.has_text = False
                    state.flushing = True
                    message = {"type": "text.done"}
            elif isinstance(part, str):
                # This limit is per wire frame, not the total async text stream.
                if code_point_length(part) > 15000:
                    raise TypeError("xAI text.delta exceeds 15000 characters")
                if part:
                    state.has_text = True
                    message = {"type": "text.delta", "delta": part}
            elif part is not None:
                if part["command"] == "update":
                    state.updates += 1
                    message = {"type": "session.update", "replace": _replacements(part["replacements"])}
                elif part["command"] == "clear":
                    state.clearing = True
                    state.has_text = False
                    message = {"type": "text.clear"}
                elif state.has_text:
                    state.has_text = False
                    state.flushing = True
                    message = {"type": "text.done"}
            if message is not None:
                pending_send = asyncio.ensure_future(send(message))
            elif not input_done:
                pending_input = asyncio.ensure_future(anext(source))
    finally:
        tasks = [task for task in (pending_input, pending_output, pending_send) if task is not None]
        for task in tasks:
            task.cancel()
        cleanup = asyncio.create_task(_cleanup(tasks, source))
        _cleanup_tasks.add(cleanup)
        cleanup.add_done_callback(_observe)


async def _read_json(body: AudioStream, limit: int) -> object:
    data = bytearray()
    async for chunk in body:
        if len(data) + len(chunk) > limit:
            raise TypeError("xAI response exceeds max_response_bytes")
        data.extend(chunk)
    return _json(data)


@asynccontextmanager
async def synthesize(request: TtsRequest, *, auth: Auth | None = None, transport: HttpTransport | None = None,
                     web_socket: WebSocketLike | None = None, base_url: str = "https://api.x.ai", web_socket_url: str | None = None,
                     timeout_ms: int | None = None, max_message_bytes: int = 4 * 1024 * 1024,
                     max_response_bytes: int = 16 * 1024 * 1024) -> AsyncIterator[AsyncIterator[SynthesisItem]]:
    """Use async with. Whole text uses HTTP; iterables use native authenticated WS.

    Timeouts include idle consumer time. Overrides are exclusively owned. HTTP
    transports must return at headers and reject redirects/retries/ambient auth.
    """
    async with AsyncExitStack() as resources:
        if web_socket is not None:
            await resources.enter_async_context(_closing(web_socket))
        validate = validate_request(request)
        key = _key(auth)
        _limits(timeout_ms, max_message_bytes, "max_message_bytes")
        _limits(timeout_ms, max_response_bytes, "max_response_bytes")
        text = request["text"]
        if isinstance(text, str) and (web_socket is not None or web_socket_url is not None):
            raise TypeError("xAI socket overrides require streaming input")
        if isinstance(text, str) and transport is None:
            raise TypeError("xAI HTTP requires an injected transport")
        initial = _replacements(request["replacements"]) if "replacements" in request else None
        wire = _wire(request, initial)
        timed = request.get("timestamp_granularity") == "character"
        url = _url(base_url, "/v1/tts", not isinstance(text, str))
        if not isinstance(text, str):
            url = _socket_url(_url(web_socket_url, "", True) if web_socket_url is not None else url, wire)
        headers = {"Authorization": f"Bearer {key}"}

        async def run() -> AsyncGenerator[SynthesisItem]:
            if not isinstance(text, str):
                async with nullcontext(web_socket) if web_socket is not None else connect_websocket(url, headers=headers, max_message_bytes=max_message_bytes) as socket:
                    async with _closing(_live(text, initial, socket, validate, timed, max_message_bytes)) as items:
                        async for item in items:
                            yield item
                await resources.aclose()
            else:
                assert transport is not None
                response = await transport.send(HttpRequest("POST", url, {**headers, "Content-Type": "application/json", "Accept": "application/json" if timed else "audio/*, application/octet-stream"}, json.dumps({**wire, "text": text}, allow_nan=False, separators=(",", ":")).encode("utf-8")))
                async with _closing(AudioStream(response.body)) as body:
                    if not 200 <= response.status < 300:
                        raise XaiError(response.status)
                    media = next((value.split(";", 1)[0].strip().lower() for name, value in response.headers.items() if name.lower() == "content-type"), "")
                    if media and (media != "application/json" if timed else not media.startswith("audio/") and media != "application/octet-stream"):
                        raise TypeError("xAI returned an unexpected content type")
                    if timed:
                        value = await _read_json(body, max_response_bytes)
                        if not is_mapping(value):
                            raise TypeError("Invalid xAI timestamped audio response")
                        yield _audio(value, "audio", "duration")
                    else:
                        received = False
                        async for chunk in body:
                            received = True
                            yield chunk
                        if not received:
                            raise TypeError("xAI returned no audio bytes")

        async with asyncio.timeout(None if timeout_ms is None else timeout_ms / 1000), _closing(run()) as stream:
            yield stream


def _voice(value: object) -> Voice:
    if not is_mapping(value):
        raise TypeError("Invalid xAI voice")
    voice_id, name = value.get("voice_id"), value.get("name")
    if not isinstance(voice_id, str) or not isinstance(name, str):
        raise TypeError("Invalid xAI voice")
    result: Voice = {"voice_id": voice_id, "name": name}
    if "language" in value:
        language = value["language"]
        if language is not None and not isinstance(language, str):
            raise TypeError("Invalid xAI voice language")
        return {**result, "language": language}
    return result


async def _discovery(path: str, transport: HttpTransport, auth: Auth | None, base_url: str, timeout_ms: int | None, max_response_bytes: int) -> object:
    key = _key(auth)
    _limits(timeout_ms, max_response_bytes, "max_response_bytes")
    url = _url(base_url, path, False)
    async with asyncio.timeout(None if timeout_ms is None else timeout_ms / 1000):
        response = await transport.send(HttpRequest("GET", url, {"Authorization": f"Bearer {key}", "Accept": "application/json"}, b""))
        async with _closing(AudioStream(response.body)) as body:
            if not 200 <= response.status < 300:
                raise XaiError(response.status)
            media = next((value.split(";", 1)[0].strip().lower() for name, value in response.headers.items() if name.lower() == "content-type"), "")
            if media and media != "application/json":
                raise TypeError("xAI returned an unexpected content type")
            return await _read_json(body, max_response_bytes)


async def voices(*, transport: HttpTransport, auth: Auth | None = None, base_url: str = "https://api.x.ai", timeout_ms: int | None = None, max_response_bytes: int = 4 * 1024 * 1024) -> Sequence[Voice]:
    """List built-in voices; existing custom IDs can be used directly in synthesis."""
    value = await _discovery("/v1/tts/voices", transport, auth, base_url, timeout_ms, max_response_bytes)
    if not is_mapping(value):
        raise TypeError("Invalid xAI voice list")
    items = value.get("voices")
    if not is_sequence(items):
        raise TypeError("Invalid xAI voice list")
    return [_voice(item) for item in items]


async def voice(voice_id: str, *, transport: HttpTransport, auth: Auth | None = None, base_url: str = "https://api.x.ai", timeout_ms: int | None = None, max_response_bytes: int = 4 * 1024 * 1024) -> Voice:
    if not voice_id:
        raise TypeError("xAI voice_id must be a nonempty string")
    encoded = quote(voice_id, safe="").replace(".", "%2E")
    return _voice(await _discovery("/v1/tts/voices/" + encoded, transport, auth, base_url, timeout_ms, max_response_bytes))
