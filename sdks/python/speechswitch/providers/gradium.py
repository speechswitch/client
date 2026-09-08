"""Gradium's authored REST/NDJSON and native WebSocket synthesis protocols."""

import asyncio
import base64
import json
import math
import os
import re
import sys
from collections.abc import AsyncGenerator, AsyncIterable, AsyncIterator, Awaitable
from contextlib import asynccontextmanager
from typing import Protocol, runtime_checkable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from speechswitch.generated.auth import Auth
from speechswitch.generated.gradium import TtsRequest, TtsRequestTextAsyncIterableItem as Input
from speechswitch.generated.gradium_output import SynthesisItem, TimelineOutput
from speechswitch.generated.validators.gradium import REQUEST_DEFAULTS, validate_request
from speechswitch.http import AudioStream, HttpRequest, HttpTransport
from speechswitch.validation import InputValidator, is_mapping, is_number
from speechswitch.websocket import WebSocketLike, connect_websocket


class GradiumError(Exception):
    def __init__(self, message: str, status_code: int | None, code: int | None) -> None:
        self.status_code, self.code = status_code, code
        super().__init__(message)


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
    output = request["output"]
    format = output["format"]
    native = "opus" if format == "ogg_opus" else "ulaw_8000" if format == "mulaw" else "alaw_8000" if format == "alaw" else f"pcm_{int(output.get('sample_rate_hz', 48000))}" if format == "pcm" else "wav"
    config: dict[str, object] = {
        "temp": request.get("temperature", REQUEST_DEFAULTS["temperature"]),
        "cfg_coef": request.get("voice_guidance", REQUEST_DEFAULTS["voice_guidance"]),
        "padding_bonus": request.get("pacing_bias", REQUEST_DEFAULTS["pacing_bias"]),
    }
    normalization = request.get("text_normalization")
    if normalization is False:
        config["rewrite_rules"] = "none"
    elif normalization is not None and normalization != "auto":
        locale = normalization.get("locale")
        if locale is not None:
            config["rewrite_rules"] = locale
        else:
            rules = normalization.get("rules")
            assert rules is not None
            config["rewrite_rules"] = ",".join(rules)
    return {"model_name": request.get("model", REQUEST_DEFAULTS["model"]), "voice_id": request["voice"], "output_format": native, "json_config": config}


def _json(data: str) -> object:
    def invalid_constant(_: str) -> None:
        raise ValueError()
    try:
        return json.loads(data, parse_constant=invalid_constant)
    except (ValueError, RecursionError):
        raise TypeError("Gradium returned invalid JSON") from None


def _packet(value: object, timed: bool) -> tuple[str, SynthesisItem | None]:
    if not is_mapping(value):
        raise TypeError("Gradium returned an invalid event")
    if "client_req_id" in value:
        raise TypeError("Gradium returned an unexpected multiplexed request ID")
    kind = value.get("type")
    if kind == "ready" and isinstance(value.get("request_id"), str):
        return "ready", None
    if kind in ("end_of_stream", "flushed"):
        return str(kind), None
    if kind == "error":
        message, code = value.get("message"), value.get("code")
        if not isinstance(message, str) or ("code" in value and (not is_number(code) or int(code) != code or abs(code) > 9007199254740991)):
            raise TypeError("Gradium returned an invalid event")
        raise GradiumError(message, None, int(code) if is_number(code) else None)
    audio, text = value.get("audio"), value.get("text")
    if not (kind == "audio" and isinstance(audio, str) or kind == "text" and isinstance(text, str)):
        raise TypeError("Gradium returned an invalid event")
    stream_id, start, stop = value.get("stream_id"), value.get("start_s"), value.get("stop_s")
    if "stream_id" in value and (not is_number(stream_id) or int(stream_id) != stream_id or not 0 <= stream_id <= 9007199254740991):
        raise TypeError("Gradium returned an invalid stream ID")
    has_range = kind == "text" or "start_s" in value or "stop_s" in value
    if has_range and (not is_number(start) or not is_number(stop) or start < 0 or stop < start or not math.isfinite(float(start) * 1000) or not math.isfinite(float(stop) * 1000)):
        raise TypeError("Gradium returned an invalid time range")
    envelope: TimelineOutput = {"correlation": "timeline", "timestamps": []}
    if is_number(stream_id):
        envelope = {**envelope, "correlation_id": str(int(stream_id))}
    if kind == "audio":
        assert isinstance(audio, str)
        try:
            decoded = base64.b64decode(audio, validate=True)
        except (ValueError, UnicodeError):
            raise TypeError("Gradium returned invalid base64 audio") from None
        if not timed:
            return "audio", decoded
        envelope = {**envelope, "audio": decoded}
        if has_range:
            assert is_number(start) and is_number(stop)
            envelope = {**envelope, "audio_timing": {"start_time_ms": float(start) * 1000, "end_time_ms": float(stop) * 1000}}
        return "audio", envelope
    if not timed:
        return "text", None
    assert isinstance(text, str) and is_number(start) and is_number(stop)
    return "text", {**envelope, "timestamps": [{"kind": "segment", "value": text, "start_time_ms": float(start) * 1000, "end_time_ms": float(stop) * 1000}]}


async def _http(body: AudioStream, timed: bool, limit: int) -> AsyncGenerator[SynthesisItem]:
    pending = bytearray()
    first = True
    def line(data: bytes | bytearray) -> tuple[str, SynthesisItem | None]:
        nonlocal first
        try:
            text = data.decode("utf-8-sig" if first else "utf-8")
        except UnicodeError:
            raise TypeError("Gradium returned invalid UTF-8") from None
        first = False
        return _packet(_json(text), True) if text.strip() else ("blank", None)
    async for chunk in body:
        if not timed:
            yield chunk
        else:
            offset = 0
            while offset < len(chunk):
                end = chunk.find(b"\n", offset)
                stop = len(chunk) if end < 0 else end
                if stop - offset > limit - len(pending):
                    raise TypeError("Gradium JSON line exceeds max_json_bytes")
                pending.extend(chunk[offset:stop])
                if end < 0:
                    break
                kind, item = line(pending)
                pending.clear()
                if kind == "end_of_stream":
                    return
                if item is not None:
                    yield item
                offset = end + 1
                await asyncio.sleep(0)
        await asyncio.sleep(0)
    if timed and pending:
        _, item = line(pending)
        if item is not None:
            yield item


# ECMAScript whitespace, matching the TypeScript adapter (not Python's wider isspace).
_SPACE = "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"


class _TextBuffer:
    def __init__(self, limit: int) -> None:
        self.pending = ""
        self.limit = limit

    def push(self, item: Input) -> str:
        if not isinstance(item, str):
            text, self.pending = self.pending + " <flush>", ""
            return text
        self.pending += item
        if len(self.pending.encode("utf-8", "surrogatepass")) > self.limit:
            raise TypeError("Gradium text buffer exceeds max_message_bytes")
        in_tag, boundary = False, -1
        for index, character in enumerate(self.pending):
            if character == "<":
                in_tag = True
            elif character == ">":
                in_tag = False
                if self.pending[max(0, index - 6):index + 1] == "<flush>":
                    boundary = index + 1
            elif not in_tag and character in _SPACE:
                boundary = index + 1
        if boundary < 0:
            return ""
        text, self.pending = self.pending[:boundary].rstrip(_SPACE), self.pending[boundary:]
        return text


_cleanup_tasks: set[asyncio.Task[None]] = set()


def _observe_cleanup(task: asyncio.Task[None]) -> None:
    _cleanup_tasks.discard(task)
    if not task.cancelled():
        task.exception()


async def _cleanup(producer: asyncio.Task[None], receiver: asyncio.Task[str | bytes], source: AsyncIterator[Input] | None) -> None:
    await asyncio.gather(producer, receiver, return_exceptions=True)
    if isinstance(source, _Closable):
        await source.aclose()


async def _live(text: str | AsyncIterable[Input], setup: dict[str, object], socket: WebSocketLike,
                timed: bool, limit: int, validate: InputValidator) -> AsyncGenerator[SynthesisItem]:
    source: AsyncIterator[Input] | None = None
    ended = False
    async def send(packet: dict[str, object]) -> None:
        frame = json.dumps(packet, separators=(",", ":"), allow_nan=False)
        if len(frame) > limit:
            raise TypeError("Gradium message exceeds max_message_bytes")
        await socket.send(frame)
    async def send_text(value: str) -> None:
        if value:
            await send({"type": "text", "text": value})
    async def produce() -> None:
        nonlocal source, ended
        await send(setup)
        if isinstance(text, str):
            await send_text(text)
        else:
            source = aiter(text)
            buffer = _TextBuffer(limit)
            async for item in source:
                validate(item)
                await send_text(buffer.push(item))
                await asyncio.sleep(0)
            await send_text(buffer.pending)
        # The peer can acknowledge EOS while the transport's drain is pending.
        ended = True
        await send({"type": "end_of_stream"})
    producer = asyncio.create_task(produce())
    receiver = asyncio.create_task(socket.receive())
    ready, producer_done = False, False
    try:
        while True:
            tasks: list[asyncio.Task[object]] = [receiver] if producer_done else [producer, receiver]
            completed, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            if producer in completed:
                producer.result()
                producer_done = True
            if receiver in completed:
                try:
                    frame = receiver.result()
                except StopAsyncIteration:
                    raise TypeError("Gradium WebSocket closed before end_of_stream") from None
                if not isinstance(frame, str):
                    raise TypeError("Gradium returned a non-text WebSocket frame")
                if len(frame.encode("utf-8", "surrogatepass")) > limit:
                    raise TypeError("Gradium message exceeds max_message_bytes")
                kind, item = _packet(_json(frame), timed)
                if kind == "ready":
                    if ready:
                        raise TypeError("Gradium returned duplicate ready")
                    ready = True
                else:
                    if not ready:
                        raise TypeError("Gradium returned output before ready")
                    if kind == "end_of_stream":
                        if not ended:
                            raise TypeError("Gradium completed before the input stream ended")
                        return
                    if item is not None:
                        yield item
                receiver = asyncio.create_task(socket.receive())
            await asyncio.sleep(0)
    finally:
        original = sys.exception()
        close_error: BaseException | None = None
        try:
            await socket.aclose()
        except BaseException as error:
            close_error = error
        producer.cancel()
        receiver.cancel()
        cleanup = asyncio.create_task(_cleanup(producer, receiver, source))
        _cleanup_tasks.add(cleanup)
        cleanup.add_done_callback(_observe_cleanup)
        if original is None and close_error is not None:
            raise close_error


@asynccontextmanager
async def synthesize(request: TtsRequest, *, auth: Auth | None = None, transport: HttpTransport | None = None,
                     web_socket: WebSocketLike | None = None, base_url: str = "https://api.gradium.ai/api",
                     web_socket_url: str | None = None, timeout_ms: int | None = None, setup_retry_ms: int | None = None,
                     max_json_bytes: int = 16 * 1024 * 1024, max_message_bytes: int = 4 * 1024 * 1024) -> AsyncIterator[AsyncIterator[SynthesisItem]]:
    """Use async with: the context owns setup, unread/idle output and cancellation.

    REST requires an injected asynchronous HTTP transport. WebSockets use native
    header auth, a supplied single-use token, or an owned authenticated override.
    Input cleanup does not delay socket release. Transports must close promptly.
    """
    validate = validate_request(request)
    for name, limit in [("max_json_bytes", max_json_bytes), ("max_message_bytes", max_message_bytes)]:
        if type(limit) is not int or not 0 < limit <= 4294967295:
            raise TypeError(f"Gradium {name} must be a positive uint32 value")
    if timeout_ms is not None and (type(timeout_ms) is not int or not 0 <= timeout_ms <= 2147483647):
        raise TypeError("Gradium timeout_ms must be an integer between 0 and 2147483647")
    if setup_retry_ms is not None and (type(setup_retry_ms) is not int or not 0 <= setup_retry_ms <= 9007199254740991):
        raise TypeError("Gradium setup_retry_ms must be a non-negative safe integer")
    if timeout_ms == 0:
        raise TimeoutError("Gradium synthesis deadline expired")
    entry = auth.get("gradium") if auth is not None else None
    key = entry["api_key"] if entry is not None and "api_key" in entry else os.environ.get("SPEECHSWITCH_GRADIUM_API_KEY", os.environ.get("GRADIUM_API_KEY"))
    token = entry.get("single_use_token") if entry is not None else None
    text = request["text"]
    socket_mode = not isinstance(text, str) or "lexicon" in request or web_socket is not None or token is not None or setup_retry_ms is not None
    if not key and not (socket_mode and (web_socket is not None or token)):
        raise TypeError("Missing auth.gradium.apiKey configuration")
    if key and not all(32 <= ord(c) <= 126 for c in key):
        raise TypeError("Invalid Gradium authentication header")
    raw_url = web_socket_url if socket_mode and web_socket_url is not None else base_url
    try:
        url = urlsplit(raw_url)
        allowed = ("http", "https", "ws", "wss") if socket_mode else ("http", "https")
        if url.scheme not in allowed or not url.hostname or url.username is not None or url.password is not None or url.fragment or any(c.isspace() or ord(c) < 32 or ord(c) == 127 or c == "\\" for c in raw_url) or re.search(r"%(?![0-9a-fA-F]{2})", raw_url):
            raise ValueError()
        _ = url.port
        query = urlencode([(k, v) for k, v in parse_qsl(url.query, keep_blank_values=True, errors="strict") if k != "token"] + [("token", token)]) if socket_mode and token else url.query
    except (ValueError, UnicodeError):
        raise TypeError("Invalid Gradium endpoint URL") from None
    path = url.path if socket_mode and web_socket_url is not None else url.path.rstrip("/") + ("/speech/tts" if socket_mode else "/post/speech/tts")
    scheme = {"https": "wss", "http": "ws"}.get(url.scheme, url.scheme) if socket_mode else url.scheme
    target = urlunsplit((scheme, url.netloc, path, query, ""))
    timed = "timestamp_granularity" in request
    settings = _settings(request)
    setup = {"type": "setup", **settings, "close_ws_on_eos": True, "retry_for_s": (setup_retry_ms if setup_retry_ms is not None else 0) / 1000}
    if "lexicon" in request:
        setup["pronunciation_id"] = request["lexicon"]
    deadline = asyncio.timeout(None if timeout_ms is None else timeout_ms / 1000)
    try:
        async with deadline:
            if socket_mode:
                if web_socket is not None:
                    async with _closing(web_socket):
                        async with _closing(_live(text, setup, web_socket, timed, max_message_bytes, validate)) as items:
                            yield items
                else:
                    async with connect_websocket(target, headers={} if token else {"x-api-key": key or ""}, max_message_bytes=max_message_bytes) as socket:
                        async with _closing(_live(text, setup, socket, timed, max_message_bytes, validate)) as items:
                            yield items
            else:
                if transport is None:
                    raise TypeError("Gradium HTTP transport is required")
                body = json.dumps({**settings, "json_config": json.dumps(settings["json_config"], separators=(",", ":"), allow_nan=False), "text": text, "only_audio": not timed}, separators=(",", ":"), allow_nan=False).encode("utf-8")
                response = await transport.send(HttpRequest("POST", target, {"x-api-key": key or "", "content-type": "application/json"}, body))
                async with _closing(AudioStream(response.body)) as audio:
                    if not 200 <= response.status < 300:
                        data = bytearray()
                        async for chunk in audio:
                            if len(chunk) > max_json_bytes - len(data):
                                raise TypeError("Gradium response exceeds max_json_bytes")
                            data.extend(chunk)
                            await asyncio.sleep(0)
                        message = data.decode("utf-8-sig", errors="replace")
                        upstream = re.fullmatch(r"error from server ([0-9]+): ([\s\S]*)", message)
                        code = int(upstream[1]) if upstream is not None and len(upstream[1]) <= 16 and int(upstream[1]) <= 9007199254740991 else None
                        raise GradiumError(upstream[2] if upstream is not None else message, response.status, code)
                    async with _closing(_http(audio, timed, max_json_bytes)) as items:
                        yield items
    except TimeoutError:
        if deadline.expired():
            raise TimeoutError("Gradium synthesis deadline expired") from None
        raise
