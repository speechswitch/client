"""Respeecher Space's handwritten protocol; public contracts come from schemas/."""

import asyncio
import base64
import json
import os
import uuid
from collections.abc import AsyncGenerator, AsyncIterable, AsyncIterator, Awaitable
from contextlib import AsyncExitStack, asynccontextmanager, nullcontext
from dataclasses import dataclass
from typing import Literal, NoReturn, Protocol, runtime_checkable
from urllib.parse import urlsplit, urlunsplit

from speechswitch.generated.auth import Auth
from speechswitch.generated.respeecher import TtsRequest, TtsRequestObjectTextAsyncIterableItem as Input
from speechswitch.generated.respeecher_output import SynthesisItem
from speechswitch.generated.validators.respeecher import validate_request
from speechswitch.http import AudioStream, HttpRequest, HttpTransport
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


class RespeecherError(Exception):
    def __init__(self, status_code: int, message: str, context_id: str | None = None) -> None:
        self.status_code, self.context_id = status_code, context_id
        super().__init__(message)


def _invalid_constant(_: str) -> NoReturn:
    raise TypeError("Respeecher returned invalid JSON")


@dataclass(frozen=True, slots=True)
class _Packet:
    kind: Literal["chunk", "done", "error"]
    context: str | None
    audio: bytes = b""
    error: RespeecherError | None = None


def _decode(frame: str | bytes, socket: bool) -> _Packet:
    if not isinstance(frame, str):
        raise TypeError("Respeecher returned a non-text WebSocket frame")
    try:
        value: object = json.loads(frame, parse_constant=_invalid_constant)
    except (ValueError, RecursionError):
        raise TypeError("Respeecher returned invalid JSON") from None
    if not is_mapping(value):
        raise TypeError("Invalid Respeecher response")
    raw_context = value.get("context_id")
    if "context_id" in value and not isinstance(raw_context, str):
        raise TypeError("Invalid Respeecher context ID")
    context = raw_context if isinstance(raw_context, str) else None
    kind = value.get("type")
    if kind == "error":
        status, message = value.get("status_code"), value.get("error")
        if not isinstance(message, str) or type(status) not in (int, float) or not isinstance(status, (int, float)) or not -9007199254740991 <= status <= 9007199254740991 or int(status) != status:
            raise TypeError("Invalid Respeecher error response")
        return _Packet("error", context, error=RespeecherError(int(status), message, context))
    if socket and context is None:
        raise TypeError("Respeecher omitted the native context ID")
    if kind == "done" and socket:
        return _Packet("done", context)
    data = value.get("data")
    if kind != "chunk" or not isinstance(data, str):
        raise TypeError("Invalid Respeecher audio response")
    try:
        audio = base64.b64decode(data, validate=True)
        if base64.b64encode(audio).decode("ascii") != data:
            raise ValueError
    except ValueError:
        raise TypeError("Invalid Respeecher audio response") from None
    return _Packet("chunk", context, audio)


def _settings(request: TtsRequest, wave: bool) -> dict[str, object]:
    sampling: dict[str, object] = {}
    fields: dict[str, object] = dict(request)
    for field, native in [("random_seed", "seed"), ("temperature", "temperature"), ("top_k", "top_k"), ("top_p", "top_p"),
                          ("min_p", "min_p"), ("presence_penalty", "presence_penalty"), ("frequency_penalty", "frequency_penalty"),
                          ("repetition_penalty", "repetition_penalty")]:
        if field in fields:
            value = fields[field]
            sampling[native] = -1 if field == "top_k" and value == 0 else value
    output = request.get("output")
    encoding = "pcm_f32le" if output is None or output.get("sample_encoding", "float_32") == "float_32" else "pcm_s16le"
    if output is not None and output["format"] == "mulaw":
        encoding = "pcm_mulaw"
    wire_output: dict[str, object] = {"sample_rate": 22050 if output is None else output.get("sample_rate_hz", 22050)}
    if not wave:
        wire_output["encoding"] = encoding
    return {"voice": {"id": request["voice"], "sampling_params": sampling}, "output_format": wire_output}


def _endpoint(base: str, path: str, socket: bool = False) -> str:
    try:
        url = urlsplit(base)
        if url.scheme not in (("ws", "wss") if socket else ("http", "https")) or not url.hostname or url.username is not None or url.password is not None or url.fragment or any(c.isspace() or ord(c) < 32 or c == "\\" for c in base):
            raise ValueError
        _ = url.port
    except ValueError:
        raise TypeError("Respeecher endpoint must be an HTTP(S) or WS(S) URL without credentials or a fragment") from None
    return urlunsplit((url.scheme, url.netloc, url.path.rstrip("/") + path if path else url.path, url.query, ""))


async def _jsonl(body: AudioStream, limit: int) -> AsyncGenerator[_Packet]:
    pending = bytearray()
    first = True
    async for chunk in body:
        for start in range(0, len(chunk), 8192):
            # Bound processing even when a backend delivers a huge chunk of blank lines.
            for byte in chunk[start:start + 8192]:
                if byte != 10:
                    if len(pending) == limit:
                        raise TypeError("Respeecher line exceeds max_message_bytes")
                    pending.append(byte)
                    continue
                line = pending.decode("utf-8-sig" if first else "utf-8")
                pending.clear()
                first = False
                if line.strip():
                    yield _decode(line, False)
            await asyncio.sleep(0)
    if pending:
        line = pending.decode("utf-8-sig" if first else "utf-8")
        if line.strip():
            yield _decode(line, False)


@dataclass(slots=True)
class _Context:
    ended: bool = False
    flush: bool = False
    audio: bool = False


def _observe[T](task: asyncio.Future[T]) -> None:
    if not task.cancelled():
        task.exception()


async def _live(text: str | AsyncIterable[Input], wire: dict[str, object], socket: WebSocketLike,
                validate: InputValidator, limit: int) -> AsyncGenerator[SynthesisItem]:
    prefix, sequence, cleared = f"{uuid.uuid4()}:", 0, -1
    contexts: dict[str, _Context] = {}
    current: str | None = None
    source: AsyncIterator[Input] | None = None
    pending_input: asyncio.Future[Input] | None = None
    pending_output: asyncio.Future[str | bytes] | None = None
    pending_send: asyncio.Future[None] | None = None
    input_done, prefer_output = False, False

    async def send(messages: list[dict[str, object]]) -> None:
        for message in messages:
            encoded = json.dumps(message, allow_nan=False, separators=(",", ":"), ensure_ascii=False)
            if len(encoded.encode("utf-8")) > limit:
                raise TypeError("Respeecher message exceeds max_message_bytes")
            await socket.send(encoded)

    async def whole_text() -> AsyncGenerator[Input]:
        if isinstance(text, str):
            yield text

    try:
        source = whole_text() if isinstance(text, str) else aiter(text)
        pending_input = asyncio.ensure_future(anext(source))
        pending_output = asyncio.ensure_future(socket.receive())
        while not input_done or contexts or pending_send is not None:
            tasks = [task for task in (pending_input, pending_output, pending_send) if task is not None]
            completed, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            candidates = (pending_output, pending_send, pending_input) if prefer_output else (pending_send, pending_input, pending_output)
            ready = next(task for task in candidates if task is not None and task in completed)
            prefer_output = ready is not pending_output
            if ready is pending_output:
                try:
                    frame = pending_output.result()
                except StopAsyncIteration:
                    raise TypeError("Respeecher WebSocket closed before synthesis completed") from None
                if (len(frame.encode("utf-8")) if isinstance(frame, str) else len(frame)) > limit:
                    raise TypeError("Respeecher message exceeds max_message_bytes")
                packet = _decode(frame, True)
                pending_output = asyncio.ensure_future(socket.receive())
                context_id = packet.context
                ordinal = context_id[len(prefix):] if context_id is not None and context_id.startswith(prefix) else ""
                if ordinal.isascii() and ordinal.isdecimal() and len(ordinal) <= 16 and str(int(ordinal)) == ordinal and int(ordinal) <= cleared:
                    continue
                if packet.error is not None:
                    raise packet.error
                context = contexts.get(context_id) if context_id is not None else None
                if context is None or context_id is None:
                    raise TypeError("Respeecher returned an unknown context ID")
                if packet.kind == "chunk":
                    if packet.audio:
                        context.audio = True
                        yield {"correlation": "ordered", "correlation_id": context_id, "audio": packet.audio, "timestamps": ()}
                else:
                    if not context.ended:
                        raise TypeError("Respeecher completed a context before its text ended")
                    if not context.audio:
                        raise TypeError("Respeecher completed a context without audio")
                    del contexts[context_id]
                    if context.flush:
                        yield {"event": "flush", "correlation_id": context_id, "input_group_id": context_id}
            elif pending_send is not None and ready is pending_send:
                pending_send.result()
                pending_send = None
                if not input_done:
                    pending_input = asyncio.ensure_future(anext(source))
            elif pending_input is not None:
                finished, pending_input = pending_input, None
                try:
                    item = finished.result()
                except StopAsyncIteration:
                    input_done = True
                    item = {"command": "flush"}
                else:
                    if not isinstance(text, str):
                        validate(item)
                messages: list[dict[str, object]] = []
                if isinstance(item, str):
                    if item:
                        if current is None:
                            current = f"{prefix}{sequence}"
                            sequence += 1
                            contexts[current] = _Context()
                        messages.append({**wire, "context_id": current, "transcript": item, "continue": True})
                elif item["command"] == "clear":
                    messages = [{"context_id": identifier, "cancel": True} for identifier in contexts]
                    cleared, current = sequence - 1, None
                    contexts.clear()
                elif current is not None:
                    contexts[current].ended, contexts[current].flush = True, not input_done
                    messages.append({**wire, "context_id": current, "transcript": "", "continue": False})
                    current = None
                if messages:
                    pending_send = asyncio.ensure_future(send(messages))
                elif not input_done:
                    pending_input = asyncio.ensure_future(anext(source))
                if not isinstance(item, str) and item["command"] == "clear":
                    # Local playback invalidation; Respeecher does not acknowledge cancel.
                    yield {"event": "clear"}
        yield {"event": "done"}
    finally:
        # A producer may ignore cancellation. Detach its cleanup instead of making
        # operation cancellation depend on arbitrary application input code.
        async def close_source() -> None:
            if isinstance(source, _Closable):
                # Defer even synchronous failures from a custom aclose method.
                await source.aclose()

        for task in (pending_input, pending_output, pending_send):
            if task is not None:
                task.cancel()
                task.add_done_callback(_observe)
        if isinstance(source, _Closable) and not input_done:
            if pending_input is not None and not pending_input.done():
                pending_input.add_done_callback(lambda _: asyncio.ensure_future(close_source()).add_done_callback(_observe))
            else:
                asyncio.ensure_future(close_source()).add_done_callback(_observe)


@asynccontextmanager
async def synthesize(request: TtsRequest, *, auth: Auth | None = None, transport: HttpTransport | None = None,
                     protocol: Literal["http", "websocket"] | None = None, web_socket: WebSocketLike | None = None,
                     base_url: str | None = None, web_socket_url: str | None = None, timeout_ms: int | None = None,
                     max_message_bytes: int = 4 * 1024 * 1024) -> AsyncIterator[AsyncIterator[SynthesisItem]]:
    """Own synthesis with async with. HTTP requires an injected, cancellation-safe transport.

    PCM/mulaw default to native header-authenticated WebSockets; WAV uses bytes HTTP.
    The deadline includes connection, producer waits and consumption. Socket overrides
    are already authenticated, exclusive to this operation and closed on exit.
    """
    validate = validate_request(request)
    entry = auth.get("respeecher") if auth is not None else None
    key = entry["api_key"] if entry is not None and "api_key" in entry else os.environ.get("SPEECHSWITCH_RESPEECHER_API_KEY", os.environ.get("RESPEECHER_API_KEY"))
    if not key:
        raise TypeError("Missing auth.respeecher.apiKey configuration")
    if any(ord(c) < 32 or ord(c) > 126 for c in key):
        raise TypeError("Respeecher API key must be a printable ASCII header value")
    if protocol not in (None, "http", "websocket"):
        raise TypeError("Respeecher protocol must be http or websocket")
    if timeout_ms is not None and (type(timeout_ms) is not int or not 0 <= timeout_ms <= 2147483647):
        raise TypeError("Respeecher timeout_ms must be an integer between 0 and 2147483647")
    if type(max_message_bytes) is not int or max_message_bytes <= 0:
        raise TypeError("Respeecher max_message_bytes must be a positive integer")
    if timeout_ms == 0:
        raise TimeoutError("Respeecher synthesis deadline expired")
    output = request.get("output")
    wave = output is not None and output["format"] == "wav"
    socket_mode = protocol == "websocket" if protocol is not None else not wave
    text = request["text"]
    if wave and socket_mode:
        raise TypeError("Respeecher WAV output requires HTTP")
    if not socket_mode and not isinstance(text, str):
        raise TypeError("Respeecher incremental text requires WebSocket")
    if not socket_mode and web_socket is not None:
        raise TypeError("Respeecher HTTP cannot use a WebSocket override")
    if not socket_mode and transport is None:
        raise TypeError("Respeecher HTTP requires an injected transport")
    base = _endpoint(base_url if base_url is not None else f"https://api.respeecher.com/v1/public/tts/{'ua' if request.get('language', 'en') == 'uk' else 'en'}-rt", "")
    url = urlsplit(_endpoint(base, "/tts/websocket"))
    socket_url = _endpoint(web_socket_url if web_socket_url is not None else urlunsplit(("wss" if url.scheme == "https" else "ws", url.netloc, url.path, url.query, "")), "", True)
    wire = _settings(request, wave)

    async def run() -> AsyncGenerator[SynthesisItem]:
        if socket_mode:
            async with nullcontext(web_socket) if web_socket is not None else connect_websocket(socket_url, headers={"X-API-Key": key}, max_message_bytes=max_message_bytes) as socket:
                async with _closing(_live(text, wire, socket, validate, max_message_bytes)) as stream:
                    async for item in stream:
                        yield item
            return
        assert transport is not None
        response = await transport.send(HttpRequest("POST", _endpoint(base, "/tts/bytes" if wave else "/tts/sse"),
            {"X-API-Key": key, "Content-Type": "application/json"}, json.dumps({**wire, "transcript": text}, allow_nan=False, ensure_ascii=False, separators=(",", ":")).encode("utf-8")))
        async with _closing(AudioStream(response.body)) as body:
            if not 200 <= response.status < 300:
                raise RespeecherError(response.status, f"Respeecher returned HTTP {response.status}")
            content_type = next((value.split(";", 1)[0].strip().lower() for name, value in response.headers.items() if name.lower() == "content-type"), "")
            if content_type and (not content_type.startswith("audio/") and content_type != "application/octet-stream" if wave else content_type not in ("text/event-stream", "application/x-ndjson", "application/jsonl", "application/json")):
                raise TypeError("Respeecher returned an unexpected content type")
            received = False
            if wave:
                async for audio in body:
                    received = True
                    yield audio
            else:
                async with _closing(_jsonl(body, max_message_bytes)) as packets:
                    async for packet in packets:
                        if packet.error is not None:
                            raise packet.error
                        if packet.audio:
                            received = True
                            yield packet.audio
            if not received:
                raise TypeError("Respeecher returned no audio")
            yield {"event": "done"}

    async with asyncio.timeout(None if timeout_ms is None else timeout_ms / 1000), AsyncExitStack() as stack:
        if web_socket is not None:
            await stack.enter_async_context(_closing(web_socket))
        async with _closing(run()) as stream:
            yield stream
