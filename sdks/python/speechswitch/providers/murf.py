"""Murf's authored Falcon HTTP/WebSocket and Gen2 generation protocols."""

import asyncio
import base64
import binascii
import json
import os
import re
import uuid
from collections.abc import AsyncGenerator, AsyncIterable, AsyncIterator, Awaitable, Mapping, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Protocol, runtime_checkable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from speechswitch.generated.auth import Auth
from speechswitch.generated.murf import TtsRequest, TtsRequestStreamingTextVoiceTextItem as TtsInput
from speechswitch.generated.murf_output import ClearEvent, DoneEvent, MurfTimestamp, SynthesisItem
from speechswitch.generated.validators.murf import validate_request
from speechswitch.http import AudioStream, HttpRequest, HttpResponse, HttpTransport
from speechswitch.validation import InputValidator, is_mapping, is_number, is_sequence, utf16_units
from speechswitch.websocket import WebSocketLike, connect_websocket


class MurfError(Exception):
    def __init__(self, status_code: int | None, body: str, retry_after: str | None = None) -> None:
        self.status_code, self.body, self.retry_after = status_code, body, retry_after
        super().__init__("Murf WebSocket synthesis failed" if status_code is None else f"Murf synthesis failed ({status_code})")


@runtime_checkable
class _Closable(Protocol):
    def aclose(self) -> Awaitable[None]: ...


@asynccontextmanager
async def _closing[T: _Closable](resource: T) -> AsyncIterator[T]:
    try:
        yield resource
    except BaseException:
        try: await resource.aclose()
        except Exception: pass
        raise
    else:
        await resource.aclose()


def _json(text: str) -> object:
    def invalid(_: str) -> None: raise ValueError()
    try: return json.loads(text, parse_constant=invalid)
    except (ValueError, RecursionError): raise TypeError("Murf returned invalid JSON") from None


def _object(value: object) -> Mapping[object, object]:
    if not is_mapping(value): raise TypeError("Murf returned an invalid response object")
    return value


def _audio(value: object) -> bytes:
    if not isinstance(value, str) or re.fullmatch(r"(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?", value) is None:
        raise TypeError("Murf returned invalid base64 audio")
    try: return base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error): raise TypeError("Murf returned invalid base64 audio") from None


@dataclass(frozen=True)
class _Packet:
    context: str
    audio: bytes | None
    final: bool


def _packet(data: str | bytes) -> _Packet:
    if not isinstance(data, str): raise TypeError("Murf returned a non-text WebSocket message")
    value = _object(_json(data))
    if "error" in value: raise MurfError(None, data)
    context = value.get("context_id")
    if not isinstance(context, str) or not context: raise TypeError("Murf returned audio or completion without the requested context ID")
    if "final" in value and not isinstance(value["final"], bool): raise TypeError("Murf returned an invalid final flag")
    if "audio" not in value and "final" not in value: raise TypeError("Murf returned an unsupported WebSocket message")
    return _Packet(context, _audio(value["audio"]) if "audio" in value else None, value.get("final") is True)


@dataclass(frozen=True)
class _Generation:
    audio: bytes | str
    duration: float
    remaining: float
    warning: str | None
    timestamps: list[MurfTimestamp]


def _generation(raw: object, timestamps: bool, inline: bool) -> _Generation:
    value = _object(raw)
    duration, remaining = value.get("audioLengthInSeconds"), value.get("remainingCharacterCount")
    if not is_number(duration) or duration < 0 or not is_number(duration * 1000): raise TypeError("Murf returned an invalid audio duration")
    if not is_number(remaining) or int(remaining) != remaining or abs(remaining) > 9007199254740991: raise TypeError("Murf returned an invalid remaining character count")
    warning = value.get("warning")
    if "warning" in value and not isinstance(warning, str): raise TypeError("Murf returned an invalid warning")
    marks: list[MurfTimestamp] = []
    if timestamps:
        words = value.get("wordDurations")
        if not is_sequence(words): raise TypeError("Murf returned no word durations")
        for raw in words:
            mark = _object(raw)
            word, start, end = mark.get("word"), mark.get("startMs"), mark.get("endMs")
            if not isinstance(word, str) or not is_number(start) or not is_number(end) or int(start) != start or int(end) != end or not 0 <= start <= end <= 9007199254740991:
                raise TypeError("Murf returned an invalid word duration")
            marks.append({"kind": "word", "value": word, "start_time_ms": start, "end_time_ms": end})
    audio = _audio(value.get("encodedAudio")) if inline else value.get("audioFile")
    if not inline and (not isinstance(audio, str) or not audio): raise TypeError("Murf returned no audio file URL")
    assert isinstance(audio, (str, bytes))
    return _Generation(audio, duration * 1000, remaining, warning if isinstance(warning, str) else None, marks)


def _url(base: str, suffix: str, socket: bool) -> str:
    try:
        url = urlsplit(base)
        if url.scheme not in (("ws", "wss") if socket else ("http", "https")) or not url.hostname or url.username is not None or url.password is not None or "#" in base or any(c.isspace() or ord(c) < 32 or ord(c) == 127 or c == "\\" for c in base) or re.search(r"%(?![0-9a-fA-F]{2})", base): raise ValueError()
        _ = url.port
        return urlunsplit((url.scheme, url.netloc, url.path.rstrip("/") + suffix if suffix else url.path, url.query, ""))
    except ValueError: raise TypeError("Invalid Murf endpoint URL") from None


async def _text(audio: AudioStream, limit: int) -> str:
    data = bytearray()
    async for chunk in audio:
        if len(chunk) > limit - len(data): raise TypeError("Murf response exceeds max_json_bytes")
        data.extend(chunk)
        await asyncio.sleep(0)
    return data.decode("utf-8-sig", errors="replace")


async def _response_error(response: HttpResponse, audio: AudioStream, limit: int) -> None:
    if not 200 <= response.status < 300:
        retry = next((v for k, v in response.headers.items() if k.lower() == "retry-after"), None)
        raise MurfError(response.status, await _text(audio, limit), retry)


def _configuration(request: TtsRequest) -> tuple[str, int, str, dict[str, object]]:
    gen2 = request.get("model") == "gen2"
    output = request.get("output")
    format = output["format"] if output is not None else "pcm"
    format = "ULAW" if format == "mulaw" else format.upper()
    rate = output.get("sample_rate_hz", 44100 if gen2 else 24000) if output is not None else 44100 if gen2 else 24000
    channel = "STEREO" if output is not None and output.get("channel_count") == 2 else "MONO"
    fields: dict[str, object] = {"voiceId": request["voice"], "rate": request.get("speed_bias", 0), "pitch": request.get("pitch_bias", 0), "format": format, "sampleRate": rate, "channelType": channel}
    if "language" in request: fields["locale"] = request["language"]
    if "voice_style" in request: fields["style"] = request["voice_style"]
    if "model" in request and request["model"] == "gen2":
        fields.update({"modelVersion": "GEN2", "variation": int(float(request.get("delivery_variance", 0.2)) * 5), "encodeAsBase64": request.get("audio_retention") is False, "wordDurationsAsOriginalText": request.get("timestamp_text") == "original"})
        if "target_duration_ms" in request: fields["audioDuration"] = request["target_duration_ms"] / 1000
    else: fields["model"] = "falcon-2"
    return format, rate, channel, fields


async def _http_items(request: TtsRequest, transport: HttpTransport, wire: HttpRequest, limit: int) -> AsyncGenerator[SynthesisItem]:
    response = await transport.send(wire)
    gen2 = request.get("model") == "gen2"
    timed = request.get("timestamp_granularity") == "word"
    received = False
    generation: _Generation | None = None
    async with _closing(AudioStream(response.body)) as audio:
        await _response_error(response, audio, limit)
        if gen2:
            generation = _generation(_json(await _text(audio, limit)), timed, request.get("audio_retention") is False)
        else:
            content_type = next((v for k, v in response.headers.items() if k.lower() == "content-type"), "").split(";", 1)[0].strip().lower()
            if content_type and not content_type.startswith("audio/") and content_type != "application/octet-stream": raise TypeError("Murf returned a non-audio streaming response")
            async for chunk in audio:
                received = True
                yield chunk
    if generation is not None:
        if isinstance(generation.audio, bytes):
            if generation.audio:
                received = True
                yield {"correlation": "timeline", "audio": generation.audio, "timestamps": []} if timed else generation.audio
        else:
            target = _url(generation.audio, "", False)
            if urlsplit(target).scheme != "https": raise TypeError("Murf returned an unsafe audio file URL")
            asset = await transport.send(HttpRequest("GET", target, {}, b""))
            async with _closing(AudioStream(asset.body)) as audio:
                await _response_error(asset, audio, limit)
                async for chunk in audio:
                    received = True
                    yield {"correlation": "timeline", "audio": chunk, "timestamps": []} if timed else chunk
        if not received: raise TypeError("Murf returned no audio")
        if timed: yield {"correlation": "timeline", "duration_ms": generation.duration, "timestamps": generation.timestamps}
        done: DoneEvent = {"event": "done", "remaining_characters": generation.remaining}
        if generation.warning is not None: done = {**done, "warning": generation.warning}
        yield done
    else:
        if not received: raise TypeError("Murf returned no audio")
        yield {"event": "done"}


@dataclass
class _Context:
    ended: bool = False
    written: bool = False
    flush: bool = False
    audio: bool = False
    final: bool = False


_cleanup_tasks: set[asyncio.Task[None]] = set()


def _observe(task: asyncio.Task[None]) -> None:
    _cleanup_tasks.discard(task)
    if not task.cancelled(): task.exception()


async def _cleanup(tasks: Sequence[Awaitable[object]], source: AsyncIterator[TtsInput] | None) -> None:
    await asyncio.gather(*tasks, return_exceptions=True)
    if isinstance(source, _Closable): await source.aclose()


async def _socket_items(request: TtsRequest, input: AsyncIterable[TtsInput], socket: WebSocketLike, validate: InputValidator, limit: int) -> AsyncGenerator[SynthesisItem]:
    contexts: dict[str, _Context] = {}
    retired: set[str] = set()
    source: AsyncIterator[TtsInput] | None = None
    current: str | None = None
    sequence = 0
    session = str(uuid.uuid4())
    stopping = False
    notices: asyncio.Queue[ClearEvent | None] = asyncio.Queue(1)
    voice: dict[str, object] = {"voice_id": request["voice"], "rate": request.get("speed_bias", 0), "pitch": request.get("pitch_bias", 0)}
    if "voice_style" in request: voice["style"] = request["voice_style"]
    if "language" in request: voice["locale"] = request["language"]
    async def send(value: dict[str, object]) -> None:
        if stopping: return
        await socket.send(json.dumps(value, ensure_ascii=True, allow_nan=False, separators=(",", ":")))
    async def end(flush: bool) -> None:
        nonlocal current
        if current is None: return
        id, current = current, None
        context = contexts[id]
        context.ended, context.flush = True, flush
        await send({"context_id": id, "text": "", "end": True})
        context.written = True
        await notices.put(None)
    async def produce() -> None:
        nonlocal source, current, sequence
        await send({"min_buffer_size": request.get("text_buffer_threshold", 40), "max_buffer_delay_in_ms": request.get("max_buffer_delay_ms", 300)})
        if stopping: return
        source = aiter(input)
        while not stopping:
            try: item = await anext(source)
            except StopAsyncIteration:
                await end(False)
                return
            if stopping: return
            validate(item)
            if isinstance(item, str):
                if len(utf16_units(item)) > 3000: raise TypeError("Murf text messages must not exceed 3000 characters")
                if item:
                    if current is None:
                        current = f"{session}:{sequence}"
                        sequence += 1
                        contexts[current] = _Context()
                    await send({"context_id": current, "voice_config": dict(voice), "text": item})
            elif item["command"] == "flush": await end(True)
            elif item["command"] == "clear":
                ids = list(contexts)
                retired.update(ids)
                contexts.clear()
                current = None
                # Invalidate local playback immediately, even if a native clear write stalls.
                await notices.put({"event": "clear"})
                for id in ids: await send({"context_id": id, "clear": True})
            else:
                if "voice" in item: voice["voice_id"] = item["voice"]
                if "voice_style" in item: voice["style"] = item["voice_style"]
                if "language" in item: voice["locale"] = item["language"]
                if "speed_bias" in item: voice["rate"] = item["speed_bias"]
                if "pitch_bias" in item: voice["pitch"] = item["pitch_bias"]
                if current is not None: await send({"context_id": current, "voice_config": dict(voice)})
                settings: dict[str, object] = {}
                if "text_buffer_threshold" in item: settings["min_buffer_size"] = item["text_buffer_threshold"]
                if "max_buffer_delay_ms" in item: settings["max_buffer_delay_in_ms"] = item["max_buffer_delay_ms"]
                if settings: await send(settings)
            await asyncio.sleep(0)
    async def receive() -> _Packet:
        try: data = await socket.receive()
        except StopAsyncIteration: raise TypeError("Murf WebSocket closed before all contexts completed") from None
        if len(data.encode("utf-8", errors="surrogatepass") if isinstance(data, str) else data) > limit: raise TypeError("Murf message exceeds max_message_bytes")
        return _packet(data)
    producer = asyncio.create_task(produce())
    receiver = asyncio.create_task(receive())
    notice = asyncio.create_task(notices.get())
    producer_done = False
    try:
        while True:
            for id, context in list(contexts.items()):
                if context.final and context.written and contexts.get(id) is context:
                    del contexts[id]
                    if context.flush: yield {"event": "flush", "correlation_id": id, "input_group_id": id}
            if producer_done and not contexts and notices.empty() and not notice.done(): break
            completed, _ = await asyncio.wait([receiver, notice] if producer_done else [producer, receiver, notice], return_when=asyncio.FIRST_COMPLETED)
            if producer in completed:
                producer.result()
                producer_done = True
            if notice in completed:
                value = notice.result()
                notice = asyncio.create_task(notices.get())
                if value is not None: yield value
            if receiver in completed:
                packet = receiver.result()
                receiver = asyncio.create_task(receive())
                if packet.context in retired: continue
                context = contexts.get(packet.context)
                if context is None: raise TypeError("Murf returned an unknown context ID")
                if packet.audio:
                    context.audio = True
                    yield {"correlation": "ordered", "correlation_id": packet.context, "audio": packet.audio, "timestamps": []}
                if packet.final and contexts.get(packet.context) is context:
                    if not context.ended: raise TypeError("Murf completed a context before its text ended")
                    if not context.audio: raise TypeError("Murf completed a context without audio")
                    context.final = True
        yield {"event": "done"}
    finally:
        stopping = True
        tasks: list[asyncio.Task[object]] = [producer, receiver, notice]
        for task in tasks: task.cancel()
        cleanup = asyncio.create_task(_cleanup(tasks, source))
        _cleanup_tasks.add(cleanup)
        cleanup.add_done_callback(_observe)


@asynccontextmanager
async def synthesize(request: TtsRequest, *, auth: Auth | None = None, transport: HttpTransport | None = None,
                     web_socket: WebSocketLike | None = None, base_url: str | None = None, web_socket_url: str | None = None,
                     timeout_ms: int | None = None, max_json_bytes: int = 16 * 1024 * 1024,
                     max_message_bytes: int = 4 * 1024 * 1024) -> AsyncIterator[AsyncIterator[SynthesisItem]]:
    """Use async with. Injected HTTP must honor cancellation and reject redirects,
    retries, cookies and ambient auth; native sockets authenticate through headers.
    """
    validate = validate_request(request)
    for value, name in ((max_json_bytes, "max_json_bytes"), (max_message_bytes, "max_message_bytes")):
        if type(value) is not int or not 1 <= value <= 4294967295: raise TypeError(f"Murf {name} must be a positive uint32 value")
    if timeout_ms is not None and (type(timeout_ms) is not int or not 0 <= timeout_ms <= 2147483647): raise TypeError("Murf timeout_ms must be an integer between 0 and 2147483647")
    input = request["text"]
    live = not isinstance(input, str)
    if not live and (web_socket is not None or web_socket_url is not None): raise TypeError("Murf WebSocket overrides require streaming input")
    entry = auth.get("murf") if auth is not None else None
    key = entry["api_key"] if entry is not None and "api_key" in entry else os.environ.get("SPEECHSWITCH_MURF_API_KEY", os.environ.get("MURF_API_KEY", ""))
    if not key and web_socket is None: raise TypeError("Missing auth.murf.apiKey configuration")
    if any(not 32 <= ord(c) <= 126 for c in key): raise TypeError("Invalid Murf authentication header")
    gen2 = request.get("model") == "gen2"
    base = _url(base_url if base_url is not None else "https://api.murf.ai" if gen2 else "https://global.api.murf.ai", "", False)
    format, rate, channel, fields = _configuration(request)
    if live:
        target = _url(web_socket_url, "", True) if web_socket_url is not None else _url(("wss" if base.startswith("https:") else "ws") + base[base.index(":"):], "/v1/speech/stream-input", True)
        parts = urlsplit(target)
        query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k not in ("model", "format", "sample_rate", "channel_type", "api_key")]
        query.extend((("model", "falcon-2"), ("format", format), ("sample_rate", str(rate)), ("channel_type", channel)))
        target = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), ""))
    else:
        if transport is None: raise TypeError("Murf HTTP transport is required")
        target = _url(base, "/v1/speech/generate" if gen2 else "/v1/speech/stream", False)
    if timeout_ms == 0: raise TimeoutError("Murf synthesis deadline expired")
    deadline = asyncio.timeout(None if timeout_ms is None else timeout_ms / 1000)
    try:
        async with deadline:
            if not isinstance(input, str):
                if web_socket is not None:
                    async with _closing(web_socket), _closing(_socket_items(request, input, web_socket, validate, max_message_bytes)) as stream: yield stream
                else:
                    async with connect_websocket(target, headers={"api_key": key}, max_message_bytes=max_message_bytes) as socket:
                        async with _closing(_socket_items(request, input, socket, validate, max_message_bytes)) as stream: yield stream
            else:
                assert transport is not None
                fields["text"] = input
                wire = HttpRequest("POST", target, {"api-key": key, "Content-Type": "application/json", "Accept": "application/json" if gen2 else "audio/*, application/octet-stream"}, json.dumps(fields, ensure_ascii=True, allow_nan=False).encode())
                async with _closing(_http_items(request, transport, wire, max_json_bytes)) as stream: yield stream
    except TimeoutError:
        if deadline.expired(): raise TimeoutError("Murf synthesis deadline expired") from None
        raise
