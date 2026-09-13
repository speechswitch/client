"""Smallest.ai's handwritten HTTP/SSE/WebSocket protocol over generated contracts."""

import asyncio
import base64
import json
import math
import os
import uuid
from collections.abc import AsyncGenerator, AsyncIterable, AsyncIterator, Awaitable, Callable, Mapping
from contextlib import AsyncExitStack, asynccontextmanager, nullcontext
from dataclasses import dataclass
from typing import Literal, NoReturn, Protocol, runtime_checkable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from speechswitch.generated.auth import Auth
from speechswitch.generated.smallest_ai import TtsRequest, TtsRequestLightningV31ProStreamingTextVoice8f1b36fbTextItem as Input
from speechswitch.generated.smallest_ai_output import SmallestEnvelope, SmallestEnvelopeTimestampsItem, SynthesisItem
from speechswitch.generated.validators.smallest_ai import validate_request
from speechswitch.http import AudioStream, HttpRequest, HttpTransport
from speechswitch.sse import SseDecoder
from speechswitch.validation import InputValidator, is_mapping
from speechswitch.websocket import WebSocketLike, connect_websocket


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


class SmallestError(Exception):
    def __init__(self, message: str, status: int | None = None, code: str | None = None) -> None:
        self.status, self.code = status, code
        super().__init__(message)


def _invalid_constant(_: str) -> NoReturn:
    raise TypeError("Smallest.ai returned invalid JSON")


def _object(text: str) -> Mapping[object, object]:
    try:
        value: object = json.loads(text, parse_constant=_invalid_constant)
    except (ValueError, RecursionError):
        raise TypeError("Smallest.ai returned invalid JSON") from None
    if not is_mapping(value):
        raise TypeError("Invalid Smallest.ai response object")
    return value


def _audio(value: object) -> bytes:
    if not isinstance(value, str):
        raise TypeError("Invalid Smallest.ai base64 audio")
    try:
        audio = base64.b64decode(value, validate=True)
        if base64.b64encode(audio).decode("ascii") != value:
            raise ValueError
    except ValueError:
        raise TypeError("Invalid Smallest.ai base64 audio") from None
    return audio


@dataclass(frozen=True, slots=True)
class _Packet:
    kind: Literal["chunk", "word_timestamp", "complete"]
    request_id: str
    external_id: str | None
    audio: bytes = b""
    timestamp: SmallestEnvelopeTimestampsItem | None = None
    word_index: int = 0


def _decode(frame: str | bytes) -> _Packet | None:
    if not isinstance(frame, str):
        raise TypeError("Smallest.ai returned a non-text WebSocket frame")
    value = _object(frame)
    if value == {"type": "pong"}:
        return None
    kind = value.get("status")
    if kind == "error":
        error = value.get("error", value)
        if not is_mapping(error) or not isinstance(message := error.get("message"), str) or "code" in error and not isinstance(error["code"], str):
            raise TypeError("Invalid Smallest.ai error response")
        code = error.get("code")
        raise SmallestError(message, code=code if isinstance(code, str) else None)
    request_id, external = value.get("request_id"), value.get("external_request_id")
    if not isinstance(request_id, str) or not request_id or "external_request_id" in value and not isinstance(external, str):
        raise TypeError("Invalid Smallest.ai request identity")
    assert external is None or isinstance(external, str)
    if kind == "complete":
        return _Packet("complete", request_id, external)
    data = value.get("data")
    if not is_mapping(data):
        raise TypeError("Invalid Smallest.ai response object")
    if kind == "chunk":
        return _Packet("chunk", request_id, external, _audio(data.get("audio")))
    if kind != "word_timestamp":
        raise TypeError("Unknown Smallest.ai WebSocket status")
    index, word, start, end = data.get("id"), data.get("word"), data.get("start"), data.get("end")
    if not isinstance(index, (int, float)) or isinstance(index, bool) or not 0 <= index <= 9007199254740991 or index != int(index) or not isinstance(word, str) or not isinstance(start, (int, float)) or isinstance(start, bool) or not isinstance(end, (int, float)) or isinstance(end, bool):
        raise TypeError("Invalid Smallest.ai word timestamp")
    try:
        start_ms, end_ms = float(start) * 1000, float(end) * 1000
    except OverflowError:
        raise TypeError("Invalid Smallest.ai word timestamp") from None
    if not math.isfinite(start_ms) or not math.isfinite(end_ms) or start_ms < 0 or end_ms < start_ms:
        raise TypeError("Invalid Smallest.ai word timestamp")
    return _Packet("word_timestamp", request_id, external, timestamp={"kind": "word", "value": word,
        "start_time_ms": start_ms, "end_time_ms": end_ms}, word_index=int(index))


def _settings(request: TtsRequest) -> dict[str, object]:
    output = request.get("output")
    format = output["format"] if output is not None else "pcm"
    wire: dict[str, object] = {
        "voice_id": request["voice"], "model": "lightning_v3.1" if request["model"] == "lightning-v3.1" else "lightning_v3.1_pro",
        "language": request.get("language", "en" if "timestamp_granularity" in request else "auto"),
        "sample_rate": output.get("sample_rate_hz", 44100) if output is not None else 44100,
        "output_format": "ulaw" if format == "mulaw" else format,
        "speed": request.get("speed", 1), "math_notation": request.get("formula_reading") == "plain_text",
    }
    if "number_pronunciation_language" in request:
        wire["number_pronunciation_language"] = request["number_pronunciation_language"]
    if "session_id" in request:
        wire["session_id"] = request["session_id"]
    if "request_id" in request:
        wire["request_id"] = request["request_id"]
    dictionaries = request.get("pronunciation_dictionaries")
    if dictionaries is not None:
        wire["pronunciation_dicts"] = [dictionaries[index]["id"] for index in range(len(dictionaries))]
    if "timestamp_granularity" in request:
        wire["word_timestamps"] = True
    return wire


def _endpoint(base: str, path: str, socket: bool = False) -> str:
    try:
        url = urlsplit(base)
        if url.scheme not in (("ws", "wss") if socket else ("http", "https")) or not url.hostname or url.username is not None or url.password is not None or url.fragment or any(c.isspace() or ord(c) < 32 or c == "\\" for c in base):
            raise ValueError
        _ = url.port
    except ValueError:
        raise TypeError("Smallest.ai endpoint must be an HTTP(S) or WS(S) URL without credentials or a fragment") from None
    return urlunsplit((url.scheme, url.netloc, url.path.rstrip("/") + path if path else url.path, url.query, ""))


def _observe[T](task: asyncio.Future[T]) -> None:
    if not task.cancelled():
        task.exception()


async def _live(request: TtsRequest, text: str | AsyncIterable[Input], wire: dict[str, object],
                socket: WebSocketLike, validate: InputValidator, limit: int, heartbeat_interval: float,
                close_transport: Callable[[], Awaitable[None]]) -> AsyncGenerator[SynthesisItem]:
    continuation = request.get("continuation")
    external_id = request.get("request_id", str(uuid.uuid4()))
    stale: set[str] = set()
    source: AsyncIterator[Input] | None = None
    pending_input: asyncio.Future[Input] | None = None
    pending_output: asyncio.Future[_Packet] | None = None
    pending_send: asyncio.Future[None] | None = None
    heartbeat: asyncio.Future[None] | None = None
    heartbeat_failure: BaseException | None = None
    writing = asyncio.Lock()
    input_done = ended = sent_text = received_audio = False
    prefer_output = True

    async def send(message: dict[str, object], final: bool) -> None:
        nonlocal ended
        encoded = json.dumps(message, allow_nan=False, ensure_ascii=False, separators=(",", ":"))
        if len(encoded.encode("utf-8")) > limit:
            raise TypeError("Smallest.ai message exceeds max_message_bytes")
        async with writing:
            if final:
                ended = True
            await socket.send(encoded)

    def stop_heartbeat() -> None:
        nonlocal heartbeat
        if heartbeat is not None and heartbeat_failure is None:
            heartbeat.cancel()
            heartbeat.add_done_callback(_observe)
            heartbeat = None

    async def keep_alive() -> None:
        nonlocal heartbeat_failure
        try:
            while True:
                await asyncio.sleep(heartbeat_interval)
                await send({"type": "ping"}, False)
        except asyncio.CancelledError:
            raise
        except BaseException as error:
            heartbeat_failure = error
            try:
                await close_transport()
            except BaseException:
                pass
            raise

    async def receive() -> _Packet:
        try:
            while True:
                try:
                    frame = await socket.receive()
                except StopAsyncIteration:
                    raise TypeError("Smallest.ai continuation closed without a context-complete marker" if continuation is not None else "Smallest.ai WebSocket closed before completion") from None
                if (len(frame.encode("utf-8")) if isinstance(frame, str) else len(frame)) > limit:
                    raise TypeError("Smallest.ai message exceeds max_message_bytes")
                packet = _decode(frame)
                if packet is None:
                    await asyncio.sleep(0)
                    continue
                # Observe completion before a later input EOF can relabel it.
                if packet.kind == "complete" and continuation is None:
                    stop_heartbeat()
                    if not ended:
                        raise TypeError("Smallest.ai completed before input ended")
                return packet
        except BaseException:
            stop_heartbeat()
            raise

    async def whole_text() -> AsyncGenerator[Input]:
        if isinstance(text, str):
            yield text

    try:
        source = whole_text() if isinstance(text, str) else aiter(text)
        pending_input = asyncio.ensure_future(anext(source))
        pending_output = asyncio.ensure_future(receive())
        heartbeat = asyncio.ensure_future(keep_alive())
        while True:
            tasks = [task for task in (pending_input, pending_output, pending_send, heartbeat) if task is not None]
            completed, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            if heartbeat_failure is not None:
                raise heartbeat_failure
            candidates = (pending_output, pending_send, pending_input) if prefer_output else (pending_send, pending_input, pending_output)
            ready = next(task for task in candidates if task is not None and task in completed)
            prefer_output = ready is not pending_output
            if ready is pending_output:
                packet = pending_output.result()
                if stale:
                    if not packet.external_id:
                        raise TypeError("Smallest.ai omitted external request identity after clear")
                    if packet.external_id in stale:
                        pending_output = asyncio.ensure_future(receive())
                        continue
                    if packet.external_id != external_id:
                        raise TypeError("Smallest.ai returned an unknown external request identity after clear")
                if packet.kind == "complete" and continuation is None:
                    if pending_send is not None:
                        await pending_send
                    if not received_audio:
                        raise TypeError("Smallest.ai returned no audio")
                    return
                pending_output = asyncio.ensure_future(receive())
                if packet.kind == "complete":
                    yield {"event": "batch", "request_id": packet.request_id}
                elif packet.kind == "chunk":
                    if packet.audio:
                        received_audio = True
                        if "timestamp_granularity" in request:
                            yield {"correlation": "ordered", "correlation_id": packet.request_id, "audio": packet.audio, "timestamps": []}
                        else:
                            yield packet.audio
                elif "timestamp_granularity" in request:
                    assert packet.timestamp is not None
                    yield {"correlation": "ordered", "correlation_id": packet.request_id,
                           "timestamps": [packet.timestamp], "word_index": packet.word_index}
            elif pending_send is not None and ready is pending_send:
                pending_send.result()
                pending_send = None
                if not input_done:
                    pending_input = asyncio.ensure_future(anext(source))
            elif pending_input is not None:
                finished, pending_input = pending_input, None
                message: dict[str, object] | None = None
                final = clear = False
                try:
                    item = finished.result()
                except StopAsyncIteration:
                    input_done = True
                    if not sent_text and continuation is None:
                        return
                    if not isinstance(text, str):
                        final = True
                        message = {"context_id": continuation["id"], "voice_id": request["voice"], "continue": False} if continuation is not None else {
                            **wire, "text": "", "request_id": external_id, "continue": False, "flush": True,
                            "max_buffer_flush_ms": request.get("max_buffer_delay_ms", 0), "complete_backoff_ms": request.get("completion_delay_ms", 4000)}
                else:
                    if not isinstance(text, str):
                        validate(item)
                    if isinstance(item, str):
                        if item:
                            sent_text = True
                            message = {**wire, "text": item, "request_id": external_id}
                            if continuation is not None:
                                message.update(context_id=continuation["id"], **{"continue": True}, max_buffer_delay_ms=continuation.get("max_buffer_delay_ms", 3000))
                            elif not isinstance(text, str):
                                message.update(**{"continue": True}, max_buffer_flush_ms=request.get("max_buffer_delay_ms", 0), complete_backoff_ms=request.get("completion_delay_ms", 4000))
                            else:
                                final = True
                    else:
                        assert continuation is not None
                        message = {"context_id": continuation["id"], "cancel_request": True}
                        stale.add(external_id)
                        external_id = str(uuid.uuid4())
                        clear = True
                if message is not None:
                    pending_send = asyncio.ensure_future(send(message, final))
                elif not input_done:
                    pending_input = asyncio.ensure_future(anext(source))
                if clear:
                    yield {"event": "clear"}
    finally:
        async def close_source() -> None:
            if isinstance(source, _Closable):
                await source.aclose()
        for task in (pending_input, pending_output, pending_send, heartbeat):
            if task is not None:
                task.cancel()
                task.add_done_callback(_observe)
        if isinstance(source, _Closable) and not input_done:
            if pending_input is not None and not pending_input.done():
                pending_input.add_done_callback(lambda _: asyncio.ensure_future(close_source()).add_done_callback(_observe))
            else:
                asyncio.ensure_future(close_source()).add_done_callback(_observe)


async def _sse(body: AudioStream, limit: int) -> AsyncGenerator[bytes]:
    decoder = SseDecoder(limit)
    try:
        async for chunk in body:
            for start in range(0, len(chunk), 8192):
                for byte in chunk[start:start + 8192]:
                    event = decoder.push(byte)
                    if event is None:
                        continue
                    value = _object(event["data"])
                    if event["event"] == "error" or value.get("status") == "error" or "error" in value:
                        raise SmallestError("Smallest.ai SSE returned an error")
                    done = value.get("done")
                    if type(done) is not bool or value.get("status") not in ("206", "200") or done != (value["status"] == "200"):
                        raise TypeError("Invalid Smallest.ai SSE status")
                    if "audio" in value:
                        audio = _audio(value["audio"])
                        if audio:
                            yield audio
                    elif not done:
                        raise TypeError("Smallest.ai SSE chunk omitted audio")
                    if done:
                        return
                await asyncio.sleep(0)
        raise TypeError("Smallest.ai SSE ended before completion")
    finally:
        decoder.finish()


@asynccontextmanager
async def synthesize(request: TtsRequest, *, auth: Auth | None = None, transport: HttpTransport | None = None,
                     protocol: Literal["http", "sse", "websocket"] | None = None, web_socket: WebSocketLike | None = None,
                     base_url: str | None = None, web_socket_url: str | None = None, timeout_ms: int | None = None,
                     idle_timeout_seconds: int = 60, max_message_bytes: int = 4 * 1024 * 1024) -> AsyncIterator[AsyncIterator[SynthesisItem]]:
    """Own the operation with async with. HTTP/SSE requires an injected async
    transport; native WebSockets use upgrade-header auth. Continuations never
    finish successfully: consume until context exit, task cancellation or deadline.
    Deadlines include producer waits and consumer backpressure. Socket overrides
    are exclusively owned, already authenticated/configured and closed on exit.
    """
    async with AsyncExitStack() as resources:
        if web_socket is not None:
            await resources.enter_async_context(_closing(web_socket))
        text = request["text"]
        if isinstance(text, str):
            # Match ECMAScript trim, including BOM but excluding Python-only C0 separators.
            text = text.strip("\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
        validate = validate_request({**request, "text": text})
        entry = auth.get("smallest_ai") if auth is not None else None
        key = entry["api_key"] if entry is not None and "api_key" in entry else os.environ.get("SPEECHSWITCH_SMALLEST_API_KEY", os.environ.get("SMALLEST_API_KEY"))
        if not key:
            raise TypeError("Missing auth.smallest.ai.apiKey configuration")
        if any(ord(c) < 32 or ord(c) > 126 for c in key):
            raise TypeError("Smallest.ai API key must be a printable ASCII header value")
        if timeout_ms is not None and (type(timeout_ms) is not int or not 0 <= timeout_ms <= 2147483647):
            raise TypeError("Smallest.ai timeout_ms must be an integer between 0 and 2147483647")
        if type(idle_timeout_seconds) is not int or not 0 < idle_timeout_seconds <= 9007199254740991:
            raise TypeError("Smallest.ai idle_timeout_seconds must be a positive safe integer")
        idle_timeout_seconds = min(idle_timeout_seconds, 180)
        if type(max_message_bytes) is not int or max_message_bytes <= 0:
            raise TypeError("Smallest.ai max_message_bytes must be a positive integer")
        if timeout_ms == 0:
            raise TimeoutError("Smallest.ai synthesis deadline expired")
        required = not isinstance(text, str) or "timestamp_granularity" in request
        socket_override = web_socket is not None or web_socket_url is not None
        selected = protocol if protocol is not None else "websocket" if required or socket_override else "sse"
        if selected not in ("http", "sse", "websocket"):
            raise TypeError("Invalid Smallest.ai protocol")
        if selected != "websocket" and (required or socket_override):
            raise TypeError("Smallest.ai incremental text, timestamps and socket overrides require WebSocket transport")
        if selected == "websocket" and "pronunciation_dictionaries" in request:
            raise TypeError("Smallest.ai pronunciation dictionaries are documented only for HTTP/SSE")
        if selected != "websocket" and transport is None:
            raise TypeError("Smallest.ai HTTP/SSE requires an injected transport")
        http_url = _endpoint(base_url if base_url is not None else "https://api.smallest.ai", "/waves/v1/tts" + ("" if selected == "http" else "/live"))
        url = urlsplit(http_url)
        socket_base = urlunsplit(("wss" if url.scheme == "https" else "ws", url.netloc, url.path, url.query, ""))
        url = urlsplit(_endpoint(web_socket_url if web_socket_url is not None else socket_base, "", True))
        socket_url = urlunsplit((url.scheme, url.netloc, url.path, urlencode([*(pair for pair in parse_qsl(url.query, keep_blank_values=True) if pair[0] != "timeout"), ("timeout", str(idle_timeout_seconds))]), ""))
        wire = _settings(request)
        headers = {"Authorization": f"Bearer {key}"}
        if "content_retention_days" in request:
            headers["x-expire-content"] = "true"

        async def run() -> AsyncGenerator[SynthesisItem]:
            if selected == "websocket":
                socket = web_socket if web_socket is not None else await resources.enter_async_context(connect_websocket(socket_url, headers=headers, max_message_bytes=max_message_bytes))
                async with _closing(_live(request, text, wire, socket, validate, max_message_bytes, idle_timeout_seconds / 2, resources.aclose)) as items:
                    async for item in items:
                        yield item
                await resources.aclose()
            else:
                assert transport is not None
                response = await transport.send(HttpRequest("POST", http_url,
                    {**headers, "Content-Type": "application/json", "Accept": "audio/wav" if selected == "http" else "text/event-stream"},
                    json.dumps({**wire, "text": text}, allow_nan=False, ensure_ascii=False, separators=(",", ":")).encode("utf-8")))
                async with _closing(AudioStream(response.body)) as body:
                    if not 200 <= response.status < 300:
                        raise SmallestError(f"Smallest.ai returned HTTP {response.status}", response.status)
                    media = next((value.split(";", 1)[0].strip().lower() for name, value in response.headers.items() if name.lower() == "content-type"), "")
                    if media and (not media.startswith("audio/") and media != "application/octet-stream" if selected == "http" else media != "text/event-stream"):
                        raise TypeError("Smallest.ai returned an unexpected content type")
                    received = False
                    async with _closing(_sse(body, max_message_bytes)) if selected == "sse" else nullcontext(body) as audio:
                        async for chunk in audio:
                            received = True
                            yield chunk
                            await asyncio.sleep(0)
                    if not received:
                        raise TypeError("Smallest.ai returned no audio")
            yield {"event": "done"}

        async with asyncio.timeout(None if timeout_ms is None else timeout_ms / 1000), _closing(run()) as stream:
            yield stream
