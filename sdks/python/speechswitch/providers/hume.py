"""Hume's authored REST/NDJSON and native WebSocket synthesis protocols."""

import asyncio
import base64
import json
import os
import re
import sys
from collections.abc import AsyncGenerator, AsyncIterable, AsyncIterator, Awaitable, Callable, Mapping, Sequence
from contextlib import asynccontextmanager
from typing import Protocol, runtime_checkable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from speechswitch.generated.auth import Auth
from speechswitch.generated.hume import (
    TtsRequest,
    TtsRequestOctave1StreamingTextTextItem as TextInput,
    TtsRequestOctave1StreamingTurnsTurnsItem as TurnInput,
    TtsRequestOctave1TurnsContextBeforeTurnsTurnsItem as Turn,
    TtsRequestOctave1TurnsSpeakersItem as Speaker,
)
from speechswitch.generated.hume_output import HumeEnvelope, SynthesisItem
from speechswitch.generated.validators.hume import REQUEST_DEFAULTS, validate_request
from speechswitch.http import AudioStream, HttpRequest, HttpTransport
from speechswitch.validation import InputValidator, is_mapping, is_number, utf16_units
from speechswitch.websocket import WebSocketLike, connect_websocket

type Input = TextInput | TurnInput


class HumeError(Exception):
    def __init__(self, message: str, status_code: int | None, code: str | None) -> None:
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
        raise TypeError("Hume returned invalid JSON") from None


def _packet(value: object, metadata: bool) -> HumeEnvelope | None:
    if not is_mapping(value):
        raise TypeError("Hume returned an invalid event")
    if isinstance(value.get("error"), str) or value.get("type") == "error":
        message, error, code = value.get("message"), value.get("error"), value.get("code")
        raise HumeError(message if isinstance(message, str) else error if isinstance(error, str) else "Hume synthesis failed", None, code if isinstance(code, str) else None)
    generation, request, snippet = value.get("generation_id"), value.get("request_id"), value.get("snippet_id")
    if not isinstance(generation, str) or not isinstance(request, str) or not isinstance(snippet, str):
        raise TypeError("Hume returned invalid correlation identifiers")
    envelope: HumeEnvelope = {"correlation": "timeline", "correlation_id": snippet, "generation_id": generation, "request_id": request, "timestamps": []}
    if value.get("type") == "audio":
        audio, index, last, utterance = value.get("audio"), value.get("chunk_index"), value.get("is_last_chunk"), value.get("utterance_index")
        if (metadata and not isinstance(audio, str)) or ("audio" in value and not isinstance(audio, str)) or not is_number(index) or int(index) != index or not 0 <= index <= 9007199254740991 or not isinstance(last, bool) or (utterance is not None and (not is_number(utterance) or int(utterance) != utterance or not 0 <= utterance <= 9007199254740991)):
            raise TypeError("Hume returned an invalid audio event")
        # Binary mode's JSON metadata is not another copy of the audio.
        if not metadata:
            return None
        assert isinstance(audio, str)
        try:
            decoded = base64.b64decode(audio, validate=True)
        except (ValueError, UnicodeError):
            raise TypeError("Hume returned invalid base64 audio") from None
        envelope = {**envelope, "audio": decoded, "chunk_index": index, "is_last_chunk": last}
        if is_number(utterance):
            envelope = {**envelope, "input_group_id": str(int(utterance))}
        return envelope
    if value.get("type") == "timestamp":
        mark = value.get("timestamp")
        if not is_mapping(mark) or mark.get("type") not in ("word", "phoneme") or not isinstance(mark.get("text"), str) or not is_mapping(mark.get("time")):
            raise TypeError("Hume returned an invalid timestamp")
        time = mark["time"]
        assert is_mapping(time)
        start, end, text, kind = time.get("begin"), time.get("end"), mark["text"], mark["type"]
        if not is_number(start) or not is_number(end) or int(start) != start or int(end) != end or not 0 <= start <= end <= 9007199254740991:
            raise TypeError("Hume returned an invalid timestamp")
        assert isinstance(text, str) and kind in ("word", "phoneme")
        return {**envelope, "timestamps": [{"kind": kind, "value": text, "start_time_ms": start, "end_time_ms": end}]} if metadata else None
    raise TypeError("Hume returned an invalid event")


async def _http(body: AudioStream, metadata: bool, limit: int) -> AsyncGenerator[SynthesisItem]:
    pending = bytearray()
    first = True
    def line(data: bytes | bytearray) -> HumeEnvelope | None:
        nonlocal first
        try:
            text = data.decode("utf-8-sig" if first else "utf-8")
        except UnicodeError:
            raise TypeError("Hume returned invalid UTF-8") from None
        first = False
        return _packet(_json(text), True) if text.strip() else None
    async for chunk in body:
        if not metadata:
            yield chunk
        else:
            offset = 0
            while offset < len(chunk):
                end = chunk.find(b"\n", offset)
                stop = len(chunk) if end < 0 else end
                if stop - offset > limit - len(pending):
                    raise TypeError("Hume JSON line exceeds max_json_bytes")
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
    if metadata and pending:
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


async def _live(input: AsyncIterable[Input], field: str, socket: WebSocketLike, metadata: bool,
                limit: int, utterance: Callable[[str | Turn], dict[str, object]], validate: InputValidator) -> AsyncGenerator[SynthesisItem]:
    source: AsyncIterator[Input] | None = None
    ended = False
    async def send(packet: dict[str, object]) -> None:
        frame = json.dumps(packet, separators=(",", ":"), allow_nan=False)
        if len(frame) > limit:
            raise TypeError("Hume message exceeds max_message_bytes")
        await socket.send(frame)
    async def produce() -> None:
        nonlocal source, ended
        source = aiter(input)
        async for item in source:
            validate(item, field)
            # Bare async string bounds cannot yet be represented by specgen.
            if isinstance(item, str) and len(utf16_units(item)) > 5000:
                raise TypeError("Hume text must not exceed 5000 characters per utterance")
            packet: dict[str, object] = {"flush": True} if not isinstance(item, str) and "command" in item else utterance(item)
            await send(packet)
            await asyncio.sleep(0)
        # Normal close may arrive while the final write is draining.
        ended = True
        await send({"close": True})
    producer = asyncio.create_task(produce())
    receiver = asyncio.create_task(socket.receive())
    producer_done = False
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
                    if not ended:
                        raise TypeError("Hume WebSocket closed before the input stream ended") from None
                    return
                if len(frame.encode("utf-8", "surrogatepass") if isinstance(frame, str) else frame) > limit:
                    raise TypeError("Hume message exceeds max_message_bytes")
                if isinstance(frame, bytes):
                    if metadata:
                        raise TypeError("Hume returned binary audio in JSON mode")
                    yield frame
                else:
                    item = _packet(_json(frame), metadata)
                    if item is not None:
                        yield item
                receiver = asyncio.create_task(socket.receive())
    finally:
        producer.cancel()
        receiver.cancel()
        cleanup = asyncio.create_task(_cleanup(producer, receiver, source))
        _cleanup_tasks.add(cleanup)
        cleanup.add_done_callback(_observe_cleanup)
        # Network lifetime never depends on an uncooperative producer/cleanup.
        failed = sys.exc_info()[0] is not None
        try:
            await socket.aclose()
        except Exception:
            if not failed:
                raise


@asynccontextmanager
async def synthesize(request: TtsRequest, *, auth: Auth | None = None,
                     transport: HttpTransport | None = None, web_socket: WebSocketLike | None = None,
                     base_url: str = "https://api.hume.ai", web_socket_url: str | None = None,
                     include_metadata: bool = False, timeout_ms: int | None = None,
                     max_json_bytes: int = 16 * 1024 * 1024, max_message_bytes: int = 4 * 1024 * 1024) -> AsyncIterator[AsyncIterator[SynthesisItem]]:
    """Always use async with, including for unread streams. HTTP/TLS is injected;
    WebSockets are native unless overridden. Transport cancellation must close I/O.
    """
    validate = validate_request(request)
    for value, name in [(max_json_bytes, "max_json_bytes"), (max_message_bytes, "max_message_bytes")]:
        if type(value) is not int or not 1 <= value <= 4294967295:
            raise TypeError(f"Hume {name} must be a positive uint32 value")
    if timeout_ms is not None and (type(timeout_ms) is not int or not 0 <= timeout_ms <= 2147483647):
        raise TypeError("Hume timeout_ms must be an integer between 0 and 2147483647")
    if type(include_metadata) is not bool:
        raise TypeError("Hume include_metadata must be a boolean")
    prior = request.get("context_before")
    prior_ids = prior.get("request_ids") if prior is not None else None
    if prior_ids is not None and not prior_ids[0]:
        raise TypeError("Hume continuation requires a non-empty generation ID")
    speakers: dict[str, Speaker] = {}
    for speaker in request.get("speakers", []):
        if speaker["alias"] in speakers:
            raise TypeError("Hume speaker aliases must be unique")
        speakers[speaker["alias"]] = speaker
    speed = request.get("speed", REQUEST_DEFAULTS["speed"])
    silence = request.get("trailing_silence_ms", REQUEST_DEFAULTS["trailing_silence_ms"])
    def utterance(value: str | Turn) -> dict[str, object]:
        selection: TtsRequest | Speaker = request
        if not isinstance(value, str):
            speaker = speakers.get(value["speaker"])
            if speaker is None:
                raise TypeError(f"Unknown Hume speaker: {value['speaker']}")
            selection = speaker
        delivery = request if isinstance(value, str) else value
        result: dict[str, object] = {"text": value if isinstance(value, str) else value["text"], "speed": delivery.get("speed", speed), "trailing_silence": delivery.get("trailing_silence_ms", silence) / 1000}
        voice, name = selection.get("voice"), selection.get("voice_name")
        provider = "HUME_AI" if selection.get("voice_source") == "catalog" else "CUSTOM_VOICE"
        if voice is not None:
            result["voice"] = {"id": voice, "provider": provider}
        elif name is not None:
            result["voice"] = {"name": name, "provider": provider}
        description = request.get("voice_description") if isinstance(value, str) else None
        if description is None:
            description = delivery.get("instructions")
        if description is not None:
            result["description"] = description
        return result
    text, turns = request.get("text"), request.get("turns")
    static = [utterance(text)] if isinstance(text, str) else [utterance(turn) for turn in turns] if isinstance(turns, Sequence) else None
    input = text if isinstance(text, AsyncIterable) else turns if isinstance(turns, AsyncIterable) else None
    if web_socket is not None and static is not None:
        raise TypeError("Hume web_socket overrides require streaming input")
    context: dict[str, object] | None = None
    if prior_ids is not None:
        context = {"generation_id": prior_ids[0]}
    elif prior is not None:
        before, before_turns = prior.get("text"), prior.get("turns")
        context = {"utterances": [utterance(before)]} if before is not None else {"utterances": [utterance(turn) for turn in before_turns]} if before_turns is not None else None
    entry = auth.get("hume") if auth is not None else None
    key = entry["api_key"] if entry is not None and "api_key" in entry else os.environ.get("SPEECHSWITCH_HUME_API_KEY", os.environ.get("HUME_API_KEY"))
    token = entry.get("access_token") if entry is not None else None
    if not key and not token and web_socket is None:
        raise TypeError("Missing auth.hume.apiKey configuration")
    credential = token if token else key or ""
    if static is not None and not all(32 <= ord(c) <= 126 for c in credential):
        raise TypeError("Invalid Hume authentication header")
    metadata = include_metadata or "timestamp_granularity" in request
    kinds = request.get("timestamp_granularity", [])
    kinds = [kinds] if isinstance(kinds, str) else kinds
    version = "1" if request["model"] == "octave-1" else "2"
    instant = request.get("latency_optimization") != "none" and ("voice" in request or "voice_name" in request or "speakers" in request)
    raw_url = web_socket_url if input is not None and web_socket_url is not None else base_url
    try:
        url = urlsplit(raw_url)
        if url.scheme not in (("http", "https", "ws", "wss") if input is not None else ("http", "https")) or not url.hostname or url.username is not None or url.password is not None or url.fragment or any(c.isspace() or ord(c) < 32 or ord(c) == 127 or c == "\\" for c in raw_url) or re.search(r"%(?![0-9a-fA-F]{2})", raw_url):
            raise ValueError()
        _ = url.port
        query = url.query
        if input is not None:
            managed = {"api_key", "access_token", "format_type", "version", "instant_mode", "no_binary", "strip_headers", "include_timestamp_types", "context_generation_id", "temperature"}
            params = [(k, v) for k, v in parse_qsl(query, keep_blank_values=True, errors="strict") if k not in managed]
            params += [("access_token" if token else "api_key", credential), ("format_type", request["output"]["format"]), ("version", version), ("instant_mode", str(instant).lower()), ("no_binary", str(metadata).lower()), ("strip_headers", "true")]
            params.extend(("include_timestamp_types", kind) for kind in kinds)
            if prior_ids is not None:
                params.append(("context_generation_id", prior_ids[0]))
            if "temperature" in request:
                params.append(("temperature", str(request["temperature"])))
            query = urlencode(params)
    except (ValueError, UnicodeError):
        raise TypeError("Invalid Hume endpoint URL") from None
    path = url.path if input is not None and web_socket_url is not None else url.path.rstrip("/") + "/v0/tts/stream/" + ("input" if input is not None else "json" if metadata else "file")
    scheme = {"https": "wss", "http": "ws"}.get(url.scheme, url.scheme) if input is not None else url.scheme
    target = urlunsplit((scheme, url.netloc, path, query, ""))
    if timeout_ms == 0:
        raise TimeoutError("Hume synthesis deadline expired")
    deadline = asyncio.timeout(None if timeout_ms is None else timeout_ms / 1000)
    try:
        async with deadline:
            if input is not None:
                if web_socket is not None:
                    async with _closing(web_socket):
                        async with _closing(_live(input, "text" if text is not None else "turns", web_socket, metadata, max_message_bytes, utterance, validate)) as stream:
                            yield stream
                else:
                    async with connect_websocket(target, headers={}, max_message_bytes=max_message_bytes) as socket:
                        async with _closing(_live(input, "text" if text is not None else "turns", socket, metadata, max_message_bytes, utterance, validate)) as stream:
                            yield stream
            else:
                if transport is None:
                    raise TypeError("Hume HTTP transport is required")
                body: dict[str, object] = {"utterances": static, "version": version, "format": {"type": request["output"]["format"]}, "include_timestamp_types": kinds, "num_generations": 1, "split_utterances": request.get("split_turns", True), "strip_headers": True, "instant_mode": instant}
                if context is not None:
                    body["context"] = context
                if "temperature" in request:
                    body["temperature"] = request["temperature"]
                response = await transport.send(HttpRequest("POST", target, {**({"Authorization": f"Bearer {token}"} if token else {"X-Hume-Api-Key": key or ""}), "content-type": "application/json"}, json.dumps(body, separators=(",", ":"), allow_nan=False).encode("utf-8")))
                async with _closing(AudioStream(response.body)) as audio:
                    if not 200 <= response.status < 300:
                        data = bytearray()
                        async for chunk in audio:
                            if len(chunk) > max_json_bytes - len(data):
                                raise TypeError("Hume response exceeds max_json_bytes")
                            data.extend(chunk)
                            await asyncio.sleep(0)
                        message = data.decode("utf-8-sig", errors="replace")
                        try:
                            detail = _json(message)
                        except TypeError:
                            detail = None
                        fields: Mapping[object, object] = detail if is_mapping(detail) else {}
                        description, error, code = fields.get("message"), fields.get("error"), fields.get("code")
                        raise HumeError(description if isinstance(description, str) else error if isinstance(error, str) else message, response.status, code if isinstance(code, str) else None)
                    async with _closing(_http(audio, metadata, max_json_bytes)) as stream:
                        yield stream
    except TimeoutError:
        if deadline.expired():
            raise TimeoutError("Hume synthesis deadline expired") from None
        raise
