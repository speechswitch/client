"""Inworld's handwritten HTTP/NDJSON and native WebSocket protocols."""

import asyncio
import base64
import json
import math
import os
import re
import struct
import sys
import uuid
from collections.abc import AsyncGenerator, AsyncIterable, AsyncIterator, Awaitable, Mapping
from contextlib import asynccontextmanager
from typing import Literal, Protocol, cast, runtime_checkable
from urllib.parse import urlsplit, urlunsplit

from speechswitch.generated.auth import Auth
from speechswitch.generated.inworld import TtsRequest, TtsRequestStreamingTextVoiceTextItem as Input
from speechswitch.generated.inworld_output import InworldTimestamp, InworldChunkEnvelope, InworldTimelineEnvelope, SynthesisItem
from speechswitch.generated.validators.inworld import REQUEST_DEFAULTS, validate_request
from speechswitch.http import AudioStream, HttpRequest, HttpTransport
from speechswitch.validation import InputValidator, is_mapping, is_number, is_sequence, utf16_units
from speechswitch.websocket import WebSocketLike, connect_websocket


class InworldError(Exception):
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


def _json(data: str) -> object:
    def invalid_constant(_: str) -> None:
        raise ValueError()
    try:
        return json.loads(data, parse_constant=invalid_constant)
    except (ValueError, RecursionError):
        raise TypeError("Inworld returned invalid JSON") from None


def _object(value: object) -> Mapping[object, object]:
    if not is_mapping(value):
        raise TypeError("Inworld returned an invalid object")
    return value


def _status(value: object, status_code: int | None = None) -> None:
    fields = _object(value)
    code, message = fields.get("code"), fields.get("message")
    if "code" in fields and (not is_number(code) or int(code) != code or abs(code) > 9007199254740991):
        raise TypeError("Inworld returned an invalid status code")
    if "message" in fields and not isinstance(message, str):
        raise TypeError("Inworld returned an invalid status message")
    if is_number(code) and code != 0:
        raise InworldError(message if isinstance(message, str) else f"Inworld status {int(code)}", status_code, int(code))


def _result(value: object) -> Mapping[object, object]:
    packet = _object(value)
    if "error" in packet:
        error = _object(packet["error"])
        _status(error)
        message = error.get("message")
        raise InworldError(message if isinstance(message, str) else "Inworld synthesis failed", None, None)
    return _object(packet.get("result"))


def _seconds(value: object) -> float:
    if not is_number(value) or value < 0 or not math.isfinite(value * 1000.0):
        raise TypeError("Inworld returned an invalid timestamp")
    return value * 1000.0


def _timestamps(value: object) -> list[InworldTimestamp]:
    info = _object(value)
    marks: list[InworldTimestamp] = []
    for kind in ("word", "character"):
        if f"{kind}Alignment" not in info:
            continue
        alignment = _object(info[f"{kind}Alignment"])
        values, starts, ends = alignment.get(f"{kind}s"), alignment.get(f"{kind}StartTimeSeconds"), alignment.get(f"{kind}EndTimeSeconds")
        if not is_sequence(values) or not is_sequence(starts) or not is_sequence(ends) or len(values) != len(starts) or len(values) != len(ends):
            raise TypeError("Inworld returned mismatched timestamp arrays")
        for index, token in enumerate(values):
            if not isinstance(token, str):
                raise TypeError("Inworld returned an invalid alignment token")
            start, end = _seconds(starts[index]), _seconds(ends[index])
            if end < start:
                raise TypeError("Inworld returned a reversed timestamp range")
            mark: InworldTimestamp = {"kind": kind, "value": token, "start_time_ms": start, "end_time_ms": end}
            marks.append({**mark, "word_index": index} if kind == "word" else mark)
        if kind != "word" or "phoneticDetails" not in alignment:
            continue
        details = alignment["phoneticDetails"]
        if not is_sequence(details):
            raise TypeError("Inworld returned invalid phonetic details")
        for raw in details:
            detail = _object(raw)
            index, phones = detail.get("wordIndex"), detail.get("phones")
            if not is_number(index) or int(index) != index or not 0 <= index < len(values) or not is_sequence(phones):
                raise TypeError("Inworld returned an invalid phonetic word index")
            for raw in phones:
                phone = _object(raw)
                symbol, viseme = phone.get("phoneSymbol"), phone.get("visemeSymbol")
                if not isinstance(symbol, str) or ("visemeSymbol" in phone and not isinstance(viseme, str)):
                    raise TypeError("Inworld returned an invalid phone or viseme")
                start = _seconds(phone.get("startTimeSeconds"))
                end = start + _seconds(phone.get("durationSeconds"))
                if not math.isfinite(end):
                    raise TypeError("Inworld returned an invalid timestamp")
                marks.append({"kind": "phoneme", "value": symbol, "start_time_ms": start, "end_time_ms": end, "word_index": index})
                if isinstance(viseme, str):
                    marks.append({"kind": "viseme", "value": viseme, "start_time_ms": start, "end_time_ms": end, "word_index": index})
    return marks


class _WaveStream:
    """Preserve one incremental WAV header across native flush boundaries."""
    def __init__(self) -> None:
        self._pending = bytearray()
        self._header = True
        self._format: bytes | None = None

    def boundary(self) -> None:
        if self._pending:
            raise TypeError("Inworld returned an incomplete WAV header")
        self._header = True

    def audio(self, value: bytes) -> bytes:
        if not self._header:
            return value
        self._pending.extend(value)
        data = self._pending
        if len(data) < 12:
            return b""
        if bytes(data[:4]) != b"RIFF" or bytes(data[8:12]) != b"WAVE":
            raise TypeError("Inworld returned an invalid WAV header")
        offset, format = 12, None
        while offset + 8 <= len(data):
            tag, size = bytes(data[offset:offset + 4]), int.from_bytes(data[offset + 4:offset + 8], "little")
            if tag == b"data":
                if format is None:
                    raise TypeError("Inworld WAV omitted its format")
                first = self._format is None
                if self._format is not None and self._format != format:
                    raise TypeError("Inworld changed WAV format between flushes")
                self._format, self._header, self._pending = format, False, bytearray()
                if not first:
                    return bytes(data[offset + 8:])
                struct.pack_into("<I", data, 4, 0xffffffff)
                struct.pack_into("<I", data, offset + 4, 0xffffffff)
                return bytes(data)
            if offset + 8 + size > 1048576:
                raise TypeError("Inworld WAV header is too large")
            if offset + 8 + size > len(data):
                return b""
            if tag == b"fmt ":
                if size < 16 or int.from_bytes(data[offset + 8:offset + 10], "little") != 1 or int.from_bytes(data[offset + 22:offset + 24], "little") != 16:
                    raise TypeError("Inworld returned an invalid PCM WAV format")
                channels = int.from_bytes(data[offset + 10:offset + 12], "little")
                if channels == 0 or int.from_bytes(data[offset + 20:offset + 22], "little") != channels * 2:
                    raise TypeError("Inworld returned an invalid PCM WAV format")
                format = bytes(data[offset + 8:offset + 8 + size])
            offset += 8 + size + size % 2
        return b""


def _output(raw: object, timed: bool, delivery: Literal["chunk", "trailing"], correlation_id: str | None, wave: _WaveStream | None) -> SynthesisItem | None:
    packet = _object(raw)
    if "status" in packet:
        _status(packet["status"])
    if not any(key in packet for key in ("audioContent", "timestampInfo", "usage")):
        raise TypeError("Inworld returned no audio or alignment")
    audio: bytes | None = None
    if "audioContent" in packet:
        encoded = packet["audioContent"]
        if not isinstance(encoded, str):
            raise TypeError("Inworld returned invalid audio content")
        try:
            audio = base64.b64decode(encoded, validate=True)
        except (ValueError, UnicodeError):
            raise TypeError("Inworld returned invalid base64 audio") from None
        if wave is not None:
            audio = wave.audio(audio)
    marks = _timestamps(packet["timestampInfo"]) if "timestampInfo" in packet else []
    if not timed:
        return audio if audio else None
    if audio is None and "timestampInfo" not in packet:
        return None
    if delivery == "chunk":
        if audio is None:
            raise TypeError("Inworld omitted audio from synchronized alignment")
        chunk: InworldChunkEnvelope = {"correlation": "chunk", "audio": audio, "timestamps": marks}
        return {**chunk, "correlation_id": correlation_id} if correlation_id is not None else chunk
    timeline: InworldTimelineEnvelope = {"correlation": "timeline", "timestamps": marks}
    if audio is not None:
        timeline = {**timeline, "audio": audio}
    return {**timeline, "correlation_id": correlation_id} if correlation_id is not None else timeline


async def _http(body: AudioStream, timed: bool, delivery: Literal["chunk", "trailing"], limit: int) -> AsyncGenerator[SynthesisItem]:
    pending = bytearray()
    first = True
    def line(data: bytearray) -> SynthesisItem | None:
        nonlocal first
        try:
            text = data.decode("utf-8-sig" if first else "utf-8")
        except UnicodeError:
            raise TypeError("Inworld returned invalid UTF-8") from None
        first = False
        return _output(_result(_json(text)), timed, delivery, None, None) if text.strip() else None
    async for chunk in body:
        offset = 0
        while offset < len(chunk):
            end = chunk.find(b"\n", offset)
            stop = len(chunk) if end < 0 else end
            if stop - offset > limit - len(pending):
                raise TypeError("Inworld JSON line exceeds max_json_bytes")
            pending.extend(chunk[offset:stop])
            if end < 0:
                break
            item = line(pending)
            pending.clear()
            if item is not None:
                yield item
            offset = end + 1
            await asyncio.sleep(0)
        await asyncio.sleep(0)
    if pending:
        item = line(pending)
        if item is not None:
            yield item


_cleanup_tasks: set[asyncio.Task[None]] = set()


def _observe_cleanup(task: asyncio.Task[None]) -> None:
    _cleanup_tasks.discard(task)
    if not task.cancelled():
        task.exception()


async def _cleanup(producer: asyncio.Task[None], receiver: asyncio.Task[str | bytes], source: AsyncIterator[Input] | None) -> None:
    await asyncio.gather(producer, receiver, return_exceptions=True)
    if isinstance(source, _Closable):
        await source.aclose()


async def _live(input: AsyncIterable[Input], socket: WebSocketLike, create: dict[str, object], context_id: str,
                timed: bool, delivery: Literal["chunk", "trailing"], wave: _WaveStream | None, limit: int, validate: InputValidator) -> AsyncGenerator[SynthesisItem]:
    source: AsyncIterator[Input] | None = None
    input_done = False
    async def send(packet: dict[str, object]) -> None:
        frame = json.dumps({**packet, "contextId": context_id}, separators=(",", ":"), allow_nan=False)
        if len(frame) > limit:
            raise TypeError("Inworld message exceeds max_message_bytes")
        await socket.send(frame)
    async def produce() -> None:
        nonlocal source, input_done
        await send({"create": create})
        source = aiter(input)
        async for item in source:
            validate(item)
            if isinstance(item, str):
                # Bare async strings cannot yet carry specgen item annotations.
                if len(utf16_units(item)) > 2000:
                    raise TypeError("Inworld text chunks must not exceed 2000 characters")
                if item:
                    await send({"send_text": {"text": item}})
            else:
                await send({"flush_context": {}})
            await asyncio.sleep(0)
        input_done = True
        await send({"close_context": {}})
    producer = asyncio.create_task(produce())
    receiver = asyncio.create_task(socket.receive())
    producer_done, created, flush = False, False, 0
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
                    raise TypeError("Inworld WebSocket closed before contextClosed") from None
                if not isinstance(frame, str):
                    raise TypeError("Inworld returned a non-text WebSocket frame")
                if len(frame.encode("utf-8", "surrogatepass")) > limit:
                    raise TypeError("Inworld message exceeds max_message_bytes")
                result = _result(_json(frame))
                if "status" in result:
                    _status(result["status"])
                if result.get("contextId") != context_id:
                    raise TypeError("Inworld returned an unexpected context ID")
                kinds = [kind for kind in ("contextCreated", "audioChunk", "flushCompleted", "contextClosed") if kind in result]
                if len(kinds) != 1:
                    raise TypeError("Inworld returned an invalid context event")
                kind = kinds[0]
                _object(result[kind])
                if kind == "contextCreated":
                    if created:
                        raise TypeError("Inworld returned duplicate contextCreated")
                    created = True
                else:
                    if not created:
                        raise TypeError("Inworld returned output before contextCreated")
                    group = f"{context_id}:{flush}"
                    if kind == "audioChunk":
                        item = _output(result[kind], timed, delivery, group, wave)
                        if item is not None:
                            yield item
                    elif kind == "flushCompleted":
                        if wave is not None:
                            wave.boundary()
                        yield {"event": "flush", "correlation_id": group, "input_group_id": str(flush)}
                        flush += 1
                    else:
                        if not input_done:
                            raise TypeError("Inworld completed before the input stream ended")
                        if wave is not None:
                            wave.boundary()
                        return
                receiver = asyncio.create_task(socket.receive())
    finally:
        producer.cancel()
        receiver.cancel()
        cleanup = asyncio.create_task(_cleanup(producer, receiver, source))
        _cleanup_tasks.add(cleanup)
        cleanup.add_done_callback(_observe_cleanup)
        failed = sys.exc_info()[0] is not None
        try:
            await socket.aclose()
        except Exception:
            if not failed:
                raise


@asynccontextmanager
async def synthesize(request: TtsRequest, *, auth: Auth | None = None, transport: HttpTransport | None = None,
                     web_socket: WebSocketLike | None = None, base_url: str = "https://api.inworld.ai", web_socket_url: str | None = None,
                     http_mode: Literal["stream", "single"] | None = None, context_id: str | None = None, timeout_ms: int | None = None,
                     max_json_bytes: int = 16 * 1024 * 1024, max_message_bytes: int = 4 * 1024 * 1024) -> AsyncIterator[AsyncIterator[SynthesisItem]]:
    """Always use async with, including unread streams. HTTP/TLS is injected;
    native WebSockets use header auth. Cancellation and deadlines release I/O.
    """
    validate = validate_request(request)
    for value, name in [(max_json_bytes, "max_json_bytes"), (max_message_bytes, "max_message_bytes")]:
        if type(value) is not int or not 1 <= value <= 4294967295:
            raise TypeError(f"Inworld {name} must be a positive uint32 value")
    if timeout_ms is not None and (type(timeout_ms) is not int or not 0 <= timeout_ms <= 2147483647):
        raise TypeError("Inworld timeout_ms must be an integer between 0 and 2147483647")
    text = request["text"]
    live = not isinstance(text, str)
    if not live and (web_socket is not None or web_socket_url is not None or context_id is not None):
        raise TypeError("Inworld WebSocket options require streaming input")
    if live and http_mode is not None:
        raise TypeError("Inworld http_mode requires static text")
    if http_mode not in (None, "single", "stream"):
        raise TypeError("Invalid Inworld http_mode")
    mode = http_mode or "stream"
    if mode == "single" and isinstance(text, str) and len(utf16_units(text)) > 2000:
        raise TypeError("Inworld single-response text must not exceed 2000 characters")
    prior = request.get("context_before")
    if prior is not None and sum(len(utf16_units(prior["texts"][index])) for index in range(len(prior["texts"]))) > 2000:
        raise TypeError("Inworld preceding context must not exceed 2000 characters")
    context = context_id if context_id is not None else str(uuid.uuid4()) if live else ""
    if live and (type(context) is not str or not context):
        raise TypeError("Inworld context_id must be a non-empty string")
    entry = auth.get("inworld") if auth is not None else None
    key = entry["api_key"] if entry is not None and "api_key" in entry else os.environ.get("SPEECHSWITCH_INWORLD_API_KEY", os.environ.get("INWORLD_API_KEY"))
    token = entry.get("access_token") if entry is not None else None
    if not key and not token and web_socket is None:
        raise TypeError("Missing auth.inworld.apiKey configuration")
    credential = token if token else key or ""
    if not all(32 <= ord(c) <= 126 for c in credential):
        raise TypeError("Invalid Inworld authentication header")
    authorization = f"Bearer {token}" if token else f"Basic {key or ''}"
    raw_url = web_socket_url if live and web_socket_url is not None else base_url
    try:
        url = urlsplit(raw_url)
        if url.scheme not in (("http", "https", "ws", "wss") if live else ("http", "https")) or not url.hostname or url.username is not None or url.password is not None or url.fragment or any(c.isspace() or ord(c) < 32 or ord(c) == 127 or c == "\\" for c in raw_url) or re.search(r"%(?![0-9a-fA-F]{2})", raw_url):
            raise ValueError()
        _ = url.port
    except (ValueError, UnicodeError):
        raise TypeError("Invalid Inworld endpoint URL") from None
    path = url.path if live and web_socket_url is not None else url.path.rstrip("/") + "/tts/v1/voice" + (":streamBidirectional" if live else ":stream" if mode == "stream" else "")
    scheme = {"http": "ws", "https": "wss"}.get(url.scheme, url.scheme) if live else url.scheme
    target = urlunsplit((scheme, url.netloc, path, url.query, ""))
    output = request["output"]
    format = output["format"]
    audio_config: dict[str, object] = {"audioEncoding": {"pcm": "PCM", "wav": "WAV", "mp3": "MP3", "ogg_opus": "OGG_OPUS", "mulaw": "MULAW", "alaw": "ALAW", "flac": "FLAC"}[format],
                                "sampleRateHertz": output.get("sample_rate_hz", 8000 if format in ("mulaw", "alaw") else 48000), "speakingRate": request.get("speed", REQUEST_DEFAULTS["speed"])}
    if format in ("mp3", "ogg_opus"):
        audio_config["bitRate"] = output.get("bit_rate_bps", 128000)
    normalized = request.get("text_normalization", REQUEST_DEFAULTS["text_normalization"])
    granularity = request.get("timestamp_granularity")
    timed = granularity is not None
    delivery = request.get("timestamp_delivery", cast(Literal["chunk", "trailing"], REQUEST_DEFAULTS["timestamp_delivery"]))
    settings: dict[str, object] = {"voiceId": request["voice"], "modelId": request["model"], "audioConfig": audio_config,
                                  "applyTextNormalization": "ON" if normalized is True else "OFF" if normalized is False else "APPLY_TEXT_NORMALIZATION_UNSPECIFIED",
                                  "timestampType": "WORD" if granularity == "word" else "CHARACTER" if granularity == "character" else "TIMESTAMP_TYPE_UNSPECIFIED"}
    if request["model"] == "inworld-tts-2":
        settings["deliveryMode"] = {"stable": "STABLE", "balanced": "BALANCED", "creative": "CREATIVE"}[request.get("delivery_mode", "balanced")]
    else:
        settings["temperature"] = request.get("temperature") or 1
    if "language" in request:
        settings["language"] = request["language"]
    if live or mode == "stream":
        settings["timestampTransportStrategy"] = "SYNC" if delivery == "chunk" else "ASYNC"
    if timeout_ms == 0:
        raise TimeoutError("Inworld synthesis deadline expired")
    deadline = asyncio.timeout(None if timeout_ms is None else timeout_ms / 1000)
    try:
        async with deadline:
            if not isinstance(text, str):
                settings.update({"maxBufferDelayMs": request.get("text_flush_delay_ms", 0), "bufferCharThreshold": request.get("text_buffer_threshold") or 1000, "autoMode": request.get("automatic_text_flushing", False)})
                wave = _WaveStream() if format == "wav" else None
                if web_socket is not None:
                    async with _closing(web_socket):
                        async with _closing(_live(text, web_socket, settings, context, timed, delivery, wave, max_message_bytes, validate)) as stream:
                            yield stream
                else:
                    async with connect_websocket(target, headers={"Authorization": authorization}, max_message_bytes=max_message_bytes) as socket:
                        async with _closing(_live(text, socket, settings, context, timed, delivery, wave, max_message_bytes, validate)) as stream:
                            yield stream
            else:
                if transport is None:
                    raise TypeError("Inworld HTTP transport is required")
                settings.update({"text": text, "enhanceGeneration": request.get("audio_enhancement", False)})
                if "instructions" in request:
                    settings["instruction"] = request.get("instructions")
                if prior is not None:
                    settings["synthesisContext"] = {"previousRequests": [{"text": prior["texts"][index]} for index in range(len(prior["texts"]))]}
                response = await transport.send(HttpRequest("POST", target, {"Authorization": authorization, "content-type": "application/json"}, json.dumps(settings, separators=(",", ":"), allow_nan=False).encode()))
                async with _closing(AudioStream(response.body)) as audio:
                    if mode == "single" or not 200 <= response.status < 300:
                        data = bytearray()
                        async for chunk in audio:
                            if len(chunk) > max_json_bytes - len(data):
                                raise TypeError("Inworld response exceeds max_json_bytes")
                            data.extend(chunk)
                            await asyncio.sleep(0)
                        message = data.decode("utf-8-sig", errors="replace")
                        if not 200 <= response.status < 300:
                            try:
                                detail = _json(message)
                            except TypeError:
                                detail = None
                            fields: Mapping[object, object] = detail if is_mapping(detail) else {}
                            description, code = fields.get("message"), fields.get("code")
                            raise InworldError(description if isinstance(description, str) else message, response.status, int(code) if is_number(code) and int(code) == code and abs(code) <= 9007199254740991 else None)
                        packet = _object(_json(message))
                        _status(packet)
                        if not isinstance(packet.get("audioContent"), str):
                            raise TypeError("Inworld single response omitted audio")
                        async def single() -> AsyncGenerator[SynthesisItem]:
                            item = _output(packet, timed, "chunk", None, None)
                            if item is not None:
                                yield item
                        async with _closing(single()) as stream:
                            yield stream
                    else:
                        async with _closing(_http(audio, timed, delivery, max_json_bytes)) as stream:
                            yield stream
    except TimeoutError:
        if deadline.expired():
            raise TimeoutError("Inworld synthesis deadline expired") from None
        raise
