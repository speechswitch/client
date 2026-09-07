"""Voice.ai's native HTTP and multi-context socket protocol over generated types."""

import asyncio
import base64
import json
import os
import re
import uuid
from collections import deque
from collections.abc import AsyncGenerator, AsyncIterable, AsyncIterator, Awaitable, Sequence
from contextlib import AsyncExitStack, asynccontextmanager, nullcontext
from dataclasses import dataclass
from typing import Literal, Protocol, runtime_checkable
from urllib.parse import urlsplit, urlunsplit

from speechswitch.generated.auth import Auth
from speechswitch.generated.voice_ai import TtsRequest, TtsRequestObject1ec54d36TextAsyncIterableItem as TtsInput
from speechswitch.generated.voice_ai_output import SynthesisItem
from speechswitch.generated.validators.voice_ai import validate_request
from speechswitch.http import AudioStream, HttpRequest, HttpTransport
from speechswitch.validation import InputValidator, is_mapping
from speechswitch.websocket import WebSocketLike, connect_websocket


class VoiceAiError(Exception):
    def __init__(self, status: int | None, context_id: str | None) -> None:
        self.status, self.context_id = status, context_id
        super().__init__("Voice.ai reported a synthesis error" if status is None else f"Voice.ai returned HTTP {status}")


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


def _settings(request: TtsRequest) -> dict[str, object]:
    output = request.get("output")
    format = output["format"] if output is not None else "mp3"
    rate = int(output.get("sample_rate_hz", 32000)) if output is not None else 32000
    bitrate = int(output.get("bit_rate_bps", 32000 if rate == 22050 else 48000)) if output is not None else 48000
    if format == "pcm":
        format = f"pcm_{rate}"
    elif format == "wav" and rate != 32000:
        format = f"wav_{rate}"
    elif format in ("mulaw", "alaw"):
        format = "ulaw_8000" if format == "mulaw" else "alaw_8000"
    elif format == "opus":
        format = f"opus_48000_{bitrate // 1000}"
    elif format == "mp3" and rate != 32000:
        format = f"mp3_{rate}_{bitrate // 1000}"
    language = request.get("language", "en")
    model = request.get("model", "auto")
    wire: dict[str, object] = {
        "model": ("voiceai-tts-v1-latest" if language == "en" else "voiceai-tts-multilingual-v1-latest") if model == "auto" else model,
        "language": language, "audio_format": format,
        "temperature": request.get("temperature", 1), "top_p": request.get("top_p", 0.8),
    }
    if "voice" in request:
        wire["voice_id"] = request["voice"]
    dictionaries = request.get("pronunciation_dictionaries")
    if dictionaries is not None:
        wire["dictionary_id"] = dictionaries[0]["id"]
        if "version" in dictionaries[0]:
            wire["dictionary_version"] = dictionaries[0]["version"]
    return wire


def _endpoint(base: str, path: str, socket: bool) -> str:
    try:
        url = urlsplit(base)
        if url.scheme not in ("http", "https", "ws", "wss") or not url.hostname or url.username is not None or url.password is not None or "?" in base or "#" in base or any(c.isspace() or ord(c) < 32 or ord(c) == 127 or c == "\\" for c in base) or re.search(r"%(?![0-9a-fA-F]{2})", base):
            raise ValueError
        _ = url.port
    except ValueError:
        raise TypeError("Voice.ai base_url must be an HTTP or WebSocket base without credentials, query or fragment") from None
    scheme = ("ws" if socket else "http") if url.scheme in ("http", "ws") else ("wss" if socket else "https")
    return urlunsplit((scheme, url.netloc, url.path.rstrip("/") + path, "", ""))


@dataclass(frozen=True, slots=True)
class _Packet:
    kind: Literal["audio", "flush", "closed"]
    context_id: str
    audio: bytes = b""


def _decode(frame: str | bytes, limit: int) -> _Packet:
    if not isinstance(frame, str):
        raise TypeError("Voice.ai expected a JSON text frame")
    try:
        size = len(frame.encode("utf-8"))
    except UnicodeError:
        raise TypeError("Invalid Voice.ai JSON") from None
    if size > limit:
        raise TypeError("Voice.ai message exceeds max_message_bytes")
    def invalid(_: str) -> None:
        raise ValueError
    try:
        value: object = json.loads(frame, parse_constant=invalid)
    except (ValueError, RecursionError):
        raise TypeError("Invalid Voice.ai JSON") from None
    if not is_mapping(value):
        raise TypeError("Invalid Voice.ai message")
    kinds = [key for key in ("audio", "is_last", "context_closed", "error") if key in value]
    if len(kinds) != 1:
        raise TypeError("Invalid Voice.ai message variant")
    kind, context_id = kinds[0], value.get("context_id")
    if kind == "error":
        if not isinstance(value["error"], str) or context_id is not None and not isinstance(context_id, str):
            raise TypeError("Invalid Voice.ai error message")
        raise VoiceAiError(None, context_id)
    if not isinstance(context_id, str) or not context_id:
        raise TypeError("Voice.ai omitted context_id")
    if kind == "audio":
        audio = value["audio"]
        try:
            if not isinstance(audio, str):
                raise ValueError
            decoded = base64.b64decode(audio, validate=True)
            if base64.b64encode(decoded).decode("ascii") != audio:
                raise ValueError
        except ValueError:
            raise TypeError("Invalid Voice.ai base64 audio") from None
        return _Packet("audio", context_id, decoded)
    if value[kind] is not True:
        raise TypeError("Invalid Voice.ai completion flag")
    return _Packet("flush" if kind == "is_last" else "closed", context_id)


@dataclass(slots=True)
class _Context:
    flushing: bool = False
    cleared: bool = False
    audio: bool = False
    finished: bool = False


_cleanup_tasks: set[asyncio.Task[None]] = set()


def _observe(task: asyncio.Task[None]) -> None:
    _cleanup_tasks.discard(task)
    if not task.cancelled():
        task.exception()


async def _cleanup(tasks: Sequence[Awaitable[object]], source: AsyncIterator[TtsInput] | None) -> None:
    await asyncio.gather(*tasks, return_exceptions=True)
    if isinstance(source, _Closable):
        await source.aclose()


async def _live(text: str | AsyncIterable[TtsInput], wire: dict[str, object], socket: WebSocketLike,
                validate: InputValidator, limit: int) -> AsyncGenerator[SynthesisItem]:
    contexts: dict[str, _Context] = {}
    clears: deque[set[str]] = deque()
    current: str | None = None
    prefix = str(uuid.uuid4())
    sequence = retired_through = 0
    input_done = False
    source: AsyncIterator[TtsInput] | None = None
    pending_input: asyncio.Future[TtsInput] | None = None
    pending_output: asyncio.Future[_Packet] | None = None
    pending_send: asyncio.Future[None] | None = None
    prefer_output = True

    async def send(messages: list[dict[str, object]]) -> None:
        for message in messages:
            encoded = json.dumps(message, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
            if len(encoded.encode("utf-8")) > limit:
                raise TypeError("Voice.ai message exceeds max_message_bytes")
            await socket.send(encoded)

    async def receive() -> _Packet:
        try:
            packet = _decode(await socket.receive(), limit)
        except StopAsyncIteration:
            raise TypeError("Voice.ai closed before input and contexts completed") from None
        context = contexts.get(packet.context_id)
        if context is None:
            suffix = packet.context_id.removeprefix(prefix + ":")
            if packet.context_id.startswith(prefix + ":") and suffix.isascii() and suffix.isdecimal() and len(suffix) <= 16:
                ordinal = int(suffix)
                if str(ordinal) == suffix and 0 < ordinal <= min(retired_through, 9007199254740991):
                    return packet
            raise TypeError("Voice.ai returned an unknown or completed context")
        # Validate at receipt, before consumer backpressure or a later input
        # task can relabel a premature native completion as valid.
        if not context.cleared:
            if packet.kind == "audio":
                if not context.flushing or context.finished:
                    raise TypeError("Voice.ai audio arrived outside an active flush")
                context.audio |= bool(packet.audio)
            elif packet.kind == "flush":
                if not context.flushing or context.finished or not context.audio:
                    raise TypeError("Voice.ai returned an unexpected or empty flush completion")
                context.finished = True
            elif not context.finished:
                raise TypeError("Voice.ai context closed before flush completion")
        return packet

    async def whole() -> AsyncGenerator[TtsInput]:
        if isinstance(text, str):
            yield text

    try:
        source = whole() if isinstance(text, str) else aiter(text)
        pending_input = asyncio.ensure_future(anext(source))
        pending_output = asyncio.ensure_future(receive())
        while True:
            while clears and not clears[0]:
                clears.popleft()
                yield {"event": "clear"}
            if input_done and not contexts and pending_send is None:
                return
            tasks = [task for task in (pending_input, pending_output, pending_send) if task is not None]
            completed, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            candidates = (pending_send, pending_output, pending_input) if prefer_output else (pending_send, pending_input, pending_output)
            ready = next(task for task in candidates if task is not None and task in completed)
            prefer_output = ready is not pending_output
            if ready is pending_send and pending_send is not None:
                pending_send.result()
                pending_send = None
                if not input_done:
                    pending_input = asyncio.ensure_future(anext(source))
            elif ready is pending_output:
                packet = pending_output.result()
                context = contexts.get(packet.context_id)
                if context is not None:
                    if packet.kind == "closed":
                        del contexts[packet.context_id]
                        for pending in clears:
                            pending.discard(packet.context_id)
                    elif not context.cleared:
                        if packet.kind == "audio" and packet.audio:
                            yield {"correlation": "ordered", "correlation_id": packet.context_id, "audio": packet.audio, "timestamps": ()}
                        elif packet.kind == "flush":
                            yield {"event": "flush", "correlation_id": packet.context_id}
                pending_output = asyncio.ensure_future(receive())
            elif pending_input is not None:
                finished, pending_input = pending_input, None
                messages: list[dict[str, object]] = []
                try:
                    part = finished.result()
                except StopAsyncIteration:
                    input_done = True
                    part = {"command": "flush"}
                else:
                    if not isinstance(text, str):
                        validate(part)
                if isinstance(part, str):
                    if part:
                        if current is None:
                            sequence += 1
                            current = f"{prefix}:{sequence}"
                            contexts[current] = _Context()
                            messages.append({**wire, "context_id": current, "text": part})
                        else:
                            messages.append({"context_id": current, "text": part})
                elif part["command"] == "flush":
                    if current is not None:
                        contexts[current].flushing = True
                        messages.append({"context_id": current, "text": "", "flush": True, "auto_close": True})
                        current = None
                else:
                    retired_through = sequence
                    clears.append(set(contexts))
                    for context_id, context in contexts.items():
                        if not context.cleared:
                            context.cleared = True
                            if not context.flushing:
                                messages.append({"context_id": context_id, "close_context": True})
                    current = None
                if messages:
                    pending_send = asyncio.ensure_future(send(messages))
                elif not input_done:
                    pending_input = asyncio.ensure_future(anext(source))
    finally:
        tasks = [task for task in (pending_input, pending_output, pending_send) if task is not None]
        for task in tasks:
            task.cancel()
        cleanup = asyncio.create_task(_cleanup(tasks, source if not input_done else None))
        _cleanup_tasks.add(cleanup)
        cleanup.add_done_callback(_observe)


@asynccontextmanager
async def synthesize(request: TtsRequest, *, auth: Auth | None = None, transport: HttpTransport | None = None,
                     protocol: Literal["stream", "http", "websocket"] | None = None, web_socket: WebSocketLike | None = None,
                     base_url: str | None = None, timeout_ms: int | None = None,
                     max_message_bytes: int = 4 * 1024 * 1024) -> AsyncIterator[AsyncIterator[SynthesisItem]]:
    """Use async with, including early exit. HTTP requires an injected transport
    that rejects redirects/retries/ambient credentials. Native sockets authenticate
    the upgrade. The lifetime deadline includes input waits and consumer idle time;
    local cancellation does not guarantee canceled inference or stopped billing.
    An injected socket is exclusively owned and closed even on boundary failure.
    """
    async with AsyncExitStack() as resources:
        if web_socket is not None:
            await resources.enter_async_context(_closing(web_socket))
        validate = validate_request(request)
        entry = auth.get("voice_ai") if auth is not None else None
        key = entry["api_key"] if entry is not None and "api_key" in entry else os.environ.get("SPEECHSWITCH_VOICE_AI_API_KEY", os.environ.get("VOICE_AI_API_KEY"))
        if not key:
            raise TypeError("Missing auth.voice.ai.apiKey configuration")
        if any(not 33 <= ord(c) <= 126 for c in key):
            raise TypeError("Voice.ai API key must contain only visible ASCII characters")
        if type(max_message_bytes) is not int or not 0 < max_message_bytes <= 9007199254740991:
            raise TypeError("Voice.ai max_message_bytes must be a positive safe integer")
        if timeout_ms is not None and (type(timeout_ms) is not int or not 0 <= timeout_ms <= 2147483647):
            raise TypeError("Voice.ai timeout_ms must be an integer between 0 and 2147483647")
        legacy = request.get("api_version") == "tts-v2"
        text = request["text"]
        required = not legacy and (not isinstance(text, str) or request.get("audio_delivery") == "paced")
        selected = protocol if protocol is not None else "websocket" if required or web_socket is not None else "stream"
        if selected not in ("stream", "http", "websocket"):
            raise TypeError("Invalid Voice.ai protocol")
        if selected != "websocket" and required:
            raise TypeError("Voice.ai incremental input and paced delivery require WebSocket")
        if selected != "websocket" and web_socket is not None:
            raise TypeError("Voice.ai web_socket override requires WebSocket transport")
        if selected == "websocket" and legacy:
            raise TypeError("Voice.ai legacy API does not document WebSocket synthesis")
        path = "/api/v1/tts/multi-stream" if selected == "websocket" else "/tts/v2/audio/speech" if legacy else "/api/v1/tts/speech" + ("/stream" if selected == "stream" else "")
        url = _endpoint(base_url if base_url is not None else "https://api.voice.ai" if legacy else "https://dev.voice.ai", path, selected == "websocket")
        if selected != "websocket" and transport is None:
            raise TypeError("Voice.ai HTTP requires an injected transport")
        if timeout_ms == 0:
            raise TimeoutError("Voice.ai synthesis deadline expired")
        headers = {"Authorization": f"Bearer {key}"}
        if "api_version" in request and request["api_version"] == "tts-v2":
            wire: dict[str, object] = {
                "text": text, "voice": request["voice"], "audio_format": request["output"]["format"] if "output" in request else "mp3", "streaming": selected == "stream",
                **({"temperature": request["temperature"]} if "temperature" in request else {}),
                **({"top_p": request["top_p"]} if "top_p" in request else {}),
            }
        else:
            wire = _settings(request)

        async def run() -> AsyncGenerator[SynthesisItem]:
            if selected == "websocket":
                async with nullcontext(web_socket) if web_socket is not None else connect_websocket(url, headers=headers, max_message_bytes=max_message_bytes) as socket:
                    async with _closing(_live(text, {**wire, "delivery_mode": "paced" if request.get("audio_delivery") == "paced" else "raw"}, socket, validate, max_message_bytes)) as items:
                        async for item in items:
                            yield item
                await resources.aclose()
            else:
                assert transport is not None
                response = await transport.send(HttpRequest("POST", url, {**headers, "Content-Type": "application/json", "Accept": "audio/*, application/octet-stream"},
                    json.dumps(wire if legacy else {**wire, "text": text}, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")))
                async with _closing(AudioStream(response.body)) as audio:
                    if not 200 <= response.status < 300:
                        raise VoiceAiError(response.status, None)
                    media = next((value.split(";", 1)[0].strip().lower() for name, value in response.headers.items() if name.lower() == "content-type"), "")
                    if media and not media.startswith("audio/") and media != "application/octet-stream":
                        raise TypeError("Voice.ai returned an unexpected audio content type")
                    received = False
                    async for chunk in audio:
                        received = True
                        yield chunk
                    if not received:
                        raise TypeError("Voice.ai returned no audio bytes")
            yield {"event": "done"}

        async with asyncio.timeout(None if timeout_ms is None else timeout_ms / 1000), _closing(run()) as stream:
            yield stream
