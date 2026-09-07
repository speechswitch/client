"""Rime's handwritten HTTP/JSON WebSocket protocol, with schema-generated contracts."""

import asyncio
import base64
import json
import math
import os
import uuid
from collections.abc import AsyncGenerator, AsyncIterable, AsyncIterator, Awaitable
from contextlib import AsyncExitStack, asynccontextmanager, nullcontext
from dataclasses import dataclass
from typing import Literal, NoReturn, Protocol, runtime_checkable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from speechswitch.generated.auth import Auth
from speechswitch.generated.rime import TtsRequest, TtsRequestCodaStreamingTextVoice84ec2db1TextItem as Input
from speechswitch.generated.rime_output import RimeEnvelope, RimeEnvelopeTimestampsItem, RimeBatchEvent, SynthesisItem
from speechswitch.generated.validators.rime import validate_request
from speechswitch.http import AudioStream, HttpRequest, HttpTransport
from speechswitch.validation import InputValidator, is_mapping, is_sequence
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


class RimeError(Exception):
    def __init__(self, message: str, status: int | None = None) -> None:
        self.status = status
        super().__init__(message)


def _invalid_constant(_: str) -> NoReturn:
    raise TypeError("Rime returned invalid JSON")


@dataclass(frozen=True, slots=True)
class _Packet:
    kind: Literal["chunk", "timestamps", "done"]
    context: str | None
    audio: bytes = b""
    timestamps: tuple[RimeEnvelopeTimestampsItem, ...] = ()


def _decode(frame: str | bytes) -> _Packet:
    if not isinstance(frame, str):
        raise TypeError("Rime returned a non-text WebSocket frame")
    try:
        value: object = json.loads(frame, parse_constant=_invalid_constant)
    except (ValueError, RecursionError):
        raise TypeError("Rime returned invalid JSON") from None
    if not is_mapping(value):
        raise TypeError("Invalid Rime response")
    kind = value.get("type")
    if kind == "error" and isinstance(message := value.get("message"), str):
        raise RimeError(message)
    context = value.get("contextId")
    if "contextId" not in value or context is not None and not isinstance(context, str):
        raise TypeError("Invalid Rime context ID")
    if kind == "done":
        return _Packet("done", context)
    if kind == "chunk":
        data = value.get("data")
        if not isinstance(data, str):
            raise TypeError("Invalid Rime audio response")
        try:
            audio = base64.b64decode(data, validate=True)
            if base64.b64encode(audio).decode("ascii") != data:
                raise ValueError
        except ValueError:
            raise TypeError("Invalid Rime audio response") from None
        return _Packet("chunk", context, audio)
    marks = value.get("word_timestamps")
    if kind != "timestamps" or not is_mapping(marks):
        raise TypeError("Invalid Rime response")
    words, starts, ends = marks.get("words"), marks.get("start"), marks.get("end")
    if not is_sequence(words) or not is_sequence(starts) or not is_sequence(ends) or len(words) != len(starts) or len(words) != len(ends):
        raise TypeError("Invalid Rime timestamp arrays")
    timestamps: list[RimeEnvelopeTimestampsItem] = []
    for word, start, end in zip(words, starts, ends):
        if not isinstance(word, str) or type(start) not in (int, float) or type(end) not in (int, float) or not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            raise TypeError("Invalid Rime timestamp interval")
        try:
            start_ms, end_ms = float(start) * 1000, float(end) * 1000
        except OverflowError:
            raise TypeError("Invalid Rime timestamp interval") from None
        if not math.isfinite(start_ms) or not math.isfinite(end_ms) or start_ms < 0 or end_ms < start_ms:
            raise TypeError("Invalid Rime timestamp interval")
        timestamps.append({"kind": "word", "value": word, "start_time_ms": start_ms, "end_time_ms": end_ms})
    return _Packet("timestamps", context, timestamps=tuple(timestamps))


def _number(value: float) -> str:
    return str(int(value)) if value.is_integer() else str(value)


def _settings(request: TtsRequest) -> tuple[dict[str, object], str]:
    output = request.get("output")
    format = output["format"] if output is not None else "pcm"
    legacy = request["model"] == "mist-v2"
    rate = output.get("sample_rate_hz") if output is not None else None
    if rate is None:
        rate = (22050 if format == "mp3" else 8000 if format == "mulaw" else 16000) if legacy else 24000
    language = request.get("language", "en")
    scale = 1 / request.get("speed", 1)
    if not math.isfinite(scale):
        raise TypeError("Rime speed cannot be represented as a finite time scale")
    wire: dict[str, object] = {"speaker": request["voice"], "modelId": {"coda": "coda", "mist-v3": "mistv3", "mist-v2": "mistv2"}[request["model"]],
        "lang": {"en": "eng", "es": "spa", "fr": "fra", "de": "ger"}[language] if legacy else language,
        "samplingRate": int(rate)}
    if legacy:
        wire.update(speedAlpha=scale, noTextNormalization=not request.get("text_normalization", True))
    else:
        wire["timeScaleFactor"] = scale
    markup = request.get("text_markup")
    if request["model"] != "coda":
        wire["pauseBetweenBrackets"] = markup.get("pauses", False) if markup is not None else False
    if legacy or request["model"] == "mist-v3" and language == "en":
        wire["phonemizeBetweenBrackets"] = markup.get("phonemes", False) if markup is not None else False
    if markup is not None and "speeds" in markup:
        speeds: list[str] = []
        for speed in markup["speeds"]:
            # Numeric item annotations cannot express a strictly positive finite reciprocal.
            if speed <= 0 or not math.isfinite(reciprocal := 1 / speed):
                raise TypeError("Rime inline speeds must have a positive finite reciprocal")
            speeds.append(_number(reciprocal))
        wire["inlineSpeedAlpha"] = ",".join(speeds)
    return wire, format


def _endpoint(base: str, path: str, socket: bool = False) -> str:
    try:
        url = urlsplit(base)
        if url.scheme not in (("ws", "wss") if socket else ("http", "https")) or not url.hostname or url.username is not None or url.password is not None or url.fragment or any(c.isspace() or ord(c) < 32 or c == "\\" for c in base):
            raise ValueError
        _ = url.port
    except ValueError:
        raise TypeError("Rime endpoint must be an HTTP(S) or WS(S) URL without credentials or a fragment") from None
    return urlunsplit((url.scheme, url.netloc, url.path.rstrip("/") + path if path else url.path, url.query, ""))


def _observe[T](task: asyncio.Future[T]) -> None:
    if not task.cancelled():
        task.exception()


async def _live(text: str | AsyncIterable[Input], socket: WebSocketLike, validate: InputValidator,
                timed: bool, limit: int) -> AsyncGenerator[SynthesisItem]:
    prefix, generation = f"{uuid.uuid4()}:", 0
    source: AsyncIterator[Input] | None = None
    pending_input: asyncio.Future[Input] | None = None
    pending_output: asyncio.Future[str | bytes] | None = None
    pending_send: asyncio.Future[None] | None = None
    input_done, eos_started, prefer_output = False, False, False

    async def send(message: dict[str, object]) -> None:
        nonlocal eos_started
        encoded = json.dumps(message, allow_nan=False, ensure_ascii=False, separators=(",", ":"))
        if len(encoded.encode("utf-8")) > limit:
            raise TypeError("Rime message exceeds max_message_bytes")
        if message.get("operation") == "eos":
            eos_started = True
        await socket.send(encoded)

    async def receive() -> str | bytes:
        try:
            return await socket.receive()
        except StopAsyncIteration:
            # Capture ordering here, not when the consumer later processes closure.
            if not eos_started:
                raise TypeError("Rime WebSocket closed before clean end-of-stream") from None
            raise

    async def whole_text() -> AsyncGenerator[Input]:
        if isinstance(text, str):
            yield text

    try:
        source = whole_text() if isinstance(text, str) else aiter(text)
        pending_input = asyncio.ensure_future(anext(source))
        pending_output = asyncio.ensure_future(receive())
        while True:
            tasks = [task for task in (pending_input, pending_output, pending_send) if task is not None]
            completed, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            candidates = (pending_output, pending_send, pending_input) if prefer_output else (pending_send, pending_input, pending_output)
            ready = next(task for task in candidates if task is not None and task in completed)
            prefer_output = ready is not pending_output
            if ready is pending_output:
                try:
                    frame = pending_output.result()
                except StopAsyncIteration:
                    # Finish the EOS write too: a clean read close must not hide a send error.
                    if pending_send is not None:
                        await pending_send
                    yield {"event": "done"}
                    return
                if (len(frame.encode("utf-8")) if isinstance(frame, str) else len(frame)) > limit:
                    raise TypeError("Rime message exceeds max_message_bytes")
                packet = _decode(frame)
                pending_output = asyncio.ensure_future(receive())
                context = packet.context
                ordinal = context[len(prefix):] if context is not None and context.startswith(prefix) else ""
                if ordinal.isascii() and ordinal.isdecimal() and len(ordinal) <= 16 and str(int(ordinal)) == ordinal and int(ordinal) < generation:
                    continue
                if generation > 0 and context is None:
                    raise TypeError("Rime omitted context identity after clear; stale audio cannot be distinguished")
                if packet.kind == "done":
                    batch: RimeBatchEvent = {"event": "batch"}
                    if context is not None:
                        batch = {**batch, "input_group_id": context}
                    yield batch
                elif packet.kind == "chunk" and not timed:
                    if packet.audio:
                        yield packet.audio
                elif timed and (packet.kind == "timestamps" or packet.audio):
                    envelope: RimeEnvelope = {"correlation": "ordered", "timestamp_origin": "synthesis", "timestamps": packet.timestamps}
                    if context is not None:
                        envelope = {**envelope, "input_group_id": context}
                    if packet.kind == "chunk":
                        envelope = {**envelope, "audio": packet.audio}
                    yield envelope
            elif pending_send is not None and ready is pending_send:
                pending_send.result()
                pending_send = None
                if not input_done:
                    pending_input = asyncio.ensure_future(anext(source))
            elif pending_input is not None:
                finished, pending_input = pending_input, None
                message: dict[str, object] | None = None
                clear = False
                try:
                    item = finished.result()
                except StopAsyncIteration:
                    input_done = True
                    message = {"operation": "eos"}
                else:
                    if not isinstance(text, str):
                        validate(item)
                    if isinstance(item, str):
                        if len(item) > 1000:
                            raise TypeError("Rime WebSocket text frames are limited to 1000 code points")
                        if item:
                            message = {"text": item, "contextId": f"{prefix}{generation}"}
                    else:
                        message = {"operation": item["command"]}
                        if item["command"] == "clear":
                            generation += 1
                            clear = True
                if message is not None:
                    pending_send = asyncio.ensure_future(send(message))
                elif not input_done:
                    pending_input = asyncio.ensure_future(anext(source))
                if clear:
                    # Native clear is not hard cancellation or a server acknowledgement.
                    yield {"event": "clear"}
    finally:
        async def close_source() -> None:
            if isinstance(source, _Closable):
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
                     web_socket: WebSocketLike | None = None, base_url: str | None = None,
                     web_socket_url: str | None = None, timeout_ms: int | None = None,
                     max_message_bytes: int = 4 * 1024 * 1024) -> AsyncIterator[AsyncIterator[SynthesisItem]]:
    """Own synthesis with async with. Whole text uses byte-native HTTP; incremental
    input, timestamps, segmentation or a socket override select JSON WebSockets.
    Overrides are exclusive, already authenticated/configured and closed on exit.
    HTTP requires an injected cancellation-safe transport that rejects redirects.
    The deadline includes connection, producer waits and consumer backpressure.
    """
    validate = validate_request(request)
    entry = auth.get("rime") if auth is not None else None
    key = entry["api_key"] if entry is not None and "api_key" in entry else os.environ.get("SPEECHSWITCH_RIME_API_KEY", os.environ.get("RIME_API_KEY"))
    if not key:
        raise TypeError("Missing auth.rime.apiKey configuration")
    if any(ord(c) < 32 or ord(c) > 126 for c in key):
        raise TypeError("Rime API key must be a printable ASCII header value")
    if timeout_ms is not None and (type(timeout_ms) is not int or not 0 <= timeout_ms <= 2147483647):
        raise TypeError("Rime timeout_ms must be an integer between 0 and 2147483647")
    if type(max_message_bytes) is not int or max_message_bytes <= 0:
        raise TypeError("Rime max_message_bytes must be a positive integer")
    if timeout_ms == 0:
        raise TimeoutError("Rime synthesis deadline expired")
    text = request["text"]
    socket_mode = not isinstance(text, str) or "timestamp_granularity" in request or "segmentation" in request or web_socket is not None or web_socket_url is not None
    if not socket_mode and transport is None:
        raise TypeError("Rime HTTP requires an injected transport")
    wire, format = _settings(request)
    http_url = _endpoint(base_url if base_url is not None else "https://users.rime.ai", "/v1/rime-tts")
    url = urlsplit(_endpoint(web_socket_url if web_socket_url is not None else "wss://users-ws.rime.ai/ws3", "", True))
    query = {name: str(value).lower() if isinstance(value, bool) else _number(value) if isinstance(value, float) else str(value) for name, value in wire.items()}
    query["audioFormat"] = {"ogg_opus": "ogg", "webm_opus": "webm"}.get(format, format)
    query["segment"] = {"sentence": "bySentence", "immediate": "immediate", "manual": "never"}[request.get("segmentation", "sentence")]
    socket_url = urlunsplit((url.scheme, url.netloc, url.path, urlencode([*(pair for pair in parse_qsl(url.query, keep_blank_values=True) if pair[0] not in query), *query.items()]), ""))
    headers = {"Authorization": f"Bearer {key}"}

    async def run() -> AsyncGenerator[SynthesisItem]:
        if socket_mode:
            async with nullcontext(web_socket) if web_socket is not None else connect_websocket(socket_url, headers=headers, max_message_bytes=max_message_bytes) as socket:
                async with _closing(_live(text, socket, validate, request.get("timestamp_granularity") == "word", max_message_bytes)) as stream:
                    async for item in stream:
                        yield item
            return
        assert transport is not None
        accept = {"pcm": "audio/L16", "wav": "audio/wav", "mp3": "audio/mpeg", "mulaw": "audio/PCMU", "ogg_opus": "audio/ogg;codecs=opus", "webm_opus": "audio/webm;codecs=opus"}[format]
        response = await transport.send(HttpRequest("POST", http_url, {**headers, "Content-Type": "application/json", "Accept": accept},
            json.dumps({**wire, "text": text}, allow_nan=False, ensure_ascii=False, separators=(",", ":")).encode("utf-8")))
        async with _closing(AudioStream(response.body)) as body:
            if not 200 <= response.status < 300:
                raise RimeError(f"Rime returned HTTP {response.status}", response.status)
            content_type = next((value.split(";", 1)[0].strip().lower() for name, value in response.headers.items() if name.lower() == "content-type"), "")
            if content_type and not content_type.startswith("audio/") and content_type != "application/octet-stream":
                raise TypeError("Rime returned an unexpected content type")
            received = False
            async for audio in body:
                received = True
                yield audio
            if not received:
                raise TypeError("Rime returned no audio")
            yield {"event": "done"}

    async with asyncio.timeout(None if timeout_ms is None else timeout_ms / 1000), AsyncExitStack() as stack:
        if web_socket is not None:
            await stack.enter_async_context(_closing(web_socket))
        async with _closing(run()) as stream:
            yield stream
