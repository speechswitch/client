"""Fish Audio's HTTP MessagePack, timestamp SSE and native WebSocket protocols."""

import asyncio
import base64
import json
import math
import os
import sys
from collections.abc import AsyncGenerator, AsyncIterable, AsyncIterator, Awaitable
from contextlib import asynccontextmanager
from typing import Protocol, runtime_checkable
from urllib.parse import urlsplit, urlunsplit

from speechswitch.generated.auth import Auth
from speechswitch.generated.fish import TtsRequest, TtsRequestS1StreamingTextTextItem as Input
from speechswitch.generated.fish_output import SynthesisItem, TimelineOutput, SegmentTimestamp
from speechswitch.generated.validators.fish import REQUEST_DEFAULTS, validate_request
from speechswitch.http import AudioStream, HttpRequest, HttpTransport
from speechswitch.msgpack import encode, decode
from speechswitch.sse import SseDecoder
from speechswitch.validation import InputValidator, is_mapping, is_number, is_sequence
from speechswitch.websocket import WebSocketLike, connect_websocket


class FishError(Exception):
    def __init__(self, status_code: int, message: str, reason: str | None) -> None:
        self.status_code, self.reason = status_code, reason
        super().__init__(f"Fish {status_code}: {message}")


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
    speakers = request.get("speakers")
    references = request.get("reference_samples")
    # The schema cannot express nonempty byte buffers. Array cardinalities and
    # numeric bounds are generated; only the byte-level constraint lives here.
    groups = [speaker.get("reference_samples") for speaker in speakers] if speakers is not None else [references]
    if any(sample["audio"] == b"" for group in groups if group is not None for sample in group):
        raise TypeError("Fish reference audio must not be empty")
    inline = [{"audio": sample["audio"], "text": sample["text"]} for sample in references] if references is not None else None
    grouped = [[{"audio": sample["audio"], "text": sample["text"]} for sample in group] for group in groups if group is not None]
    return {
        "text": request["text"] if isinstance(request["text"], str) else "",
        "reference_id": [speaker.get("voice", str(index)) for index, speaker in enumerate(speakers)] if speakers is not None else request.get("voice"),
        "references": grouped if speakers is not None and grouped else None if speakers is not None else inline,
        "format": "opus" if output["format"] == "ogg_opus" else output["format"],
        "sample_rate": int(output.get("sample_rate_hz", 48000 if output["format"] == "ogg_opus" else 44100)),
        "mp3_bitrate": output.get("bit_rate_bps", 128000) // 1000 if output["format"] == "mp3" else 128,
        "opus_bitrate": output.get("bit_rate_bps", -1000) if output["format"] == "ogg_opus" else -1000,
        "prosody": {"speed": request.get("speed", REQUEST_DEFAULTS["speed"]), "volume": request.get("volume_db", REQUEST_DEFAULTS["volume_db"]), "normalize_loudness": request.get("loudness_normalization", True)},
        "temperature": request.get("temperature", REQUEST_DEFAULTS["temperature"]),
        "top_p": request.get("top_p", REQUEST_DEFAULTS["top_p"]),
        "chunk_length": int(request.get("text_chunk_length", REQUEST_DEFAULTS["text_chunk_length"])),
        "min_chunk_length": int(request.get("min_text_chunk_length", REQUEST_DEFAULTS["min_text_chunk_length"])),
        "max_new_tokens": int(request.get("max_audio_tokens", REQUEST_DEFAULTS["max_audio_tokens"])),
        "repetition_penalty": request.get("repetition_penalty", REQUEST_DEFAULTS["repetition_penalty"]),
        "condition_on_previous_chunks": request.get("condition_on_previous_chunks", REQUEST_DEFAULTS["condition_on_previous_chunks"]),
        "early_stop_threshold": request.get("early_stop_threshold", REQUEST_DEFAULTS["early_stop_threshold"]),
        "normalize": request.get("text_normalization", REQUEST_DEFAULTS["text_normalization"]),
        "latency": {"none": "normal", "moderate": "balanced", "aggressive": "low"}[str(request.get("latency_optimization", REQUEST_DEFAULTS["latency_optimization"]))],
        "features": list(request.get("features", [])),
    }


def _alignment(data: str) -> TimelineOutput:
    def invalid_constant(_: str) -> None:
        raise ValueError("Non-JSON numeric constant")
    try:
        value: object = json.loads(data, parse_constant=invalid_constant)
    except (ValueError, RecursionError):
        raise TypeError("Fish returned invalid timestamp JSON") from None
    if not is_mapping(value):
        raise TypeError("Fish returned an invalid timestamp event")
    audio, content, seq, offset = value.get("audio_base64"), value.get("content"), value.get("chunk_seq"), value.get("chunk_audio_offset_sec")
    if not isinstance(audio, str) or not isinstance(content, str) or not is_number(seq) or int(seq) != seq or not 0 <= seq <= 9007199254740991 or not is_number(offset) or offset < 0 or not math.isfinite(float(offset) * 1000):
        raise TypeError("Fish returned an invalid timestamp event")
    try:
        decoded = base64.b64decode(audio, validate=True)
    except (ValueError, UnicodeError):
        raise TypeError("Fish returned invalid base64 audio") from None
    if "alignment" in value and value["alignment"] is None:
        return {"correlation": "timeline", "correlation_id": str(int(seq)), "timeline_offset_ms": float(offset) * 1000, "audio": decoded, "timestamps": []}
    snapshot = value.get("alignment")
    if not is_mapping(snapshot):
        raise TypeError("Fish returned an invalid alignment snapshot")
    segments, duration = snapshot.get("segments"), snapshot.get("audio_duration")
    if not is_sequence(segments) or not is_number(duration) or duration < 0 or not math.isfinite(float(duration) * 1000):
        raise TypeError("Fish returned an invalid alignment snapshot")
    timestamps: list[SegmentTimestamp] = []
    for segment in segments:
        if not is_mapping(segment):
            raise TypeError("Fish returned an invalid timing segment")
        text, start, end = segment.get("text"), segment.get("start"), segment.get("end")
        if not isinstance(text, str) or not is_number(start) or not is_number(end) or start < 0 or end < start or not math.isfinite(float(start) * 1000) or not math.isfinite(float(end) * 1000):
            raise TypeError("Fish returned an invalid timing segment")
        timestamps.append({"kind": "segment", "value": text, "start_time_ms": float(start) * 1000, "end_time_ms": float(end) * 1000})
    return {"correlation": "timeline", "correlation_id": str(int(seq)), "timeline_offset_ms": float(offset) * 1000, "audio": decoded, "timestamps": timestamps, "timestamp_update": "replace", "duration_ms": float(duration) * 1000}


async def _http(body: AudioStream, timed: bool, limit: int) -> AsyncGenerator[SynthesisItem]:
    decoder = SseDecoder(limit) if timed else None
    try:
        async for chunk in body:
            if decoder is None:
                yield chunk
            else:
                for index, byte in enumerate(chunk):
                    message = decoder.push(byte)
                    if message is not None:
                        yield _alignment(message["data"])
                    if index % 4096 == 0:
                        await asyncio.sleep(0)
            await asyncio.sleep(0)
    finally:
        if decoder is not None:
            decoder.finish()


async def _live(text: AsyncIterable[Input], wire: dict[str, object], socket: WebSocketLike, validate: InputValidator, limit: int) -> AsyncGenerator[SynthesisItem]:
    source: AsyncIterator[Input] | None = None
    pending_input: asyncio.Future[Input] | None = None
    pending_output: asyncio.Future[str | bytes] | None = None
    pending_send: asyncio.Future[None] | None = None
    input_done, prefer_output = False, True

    async def send(value: dict[str, object]) -> None:
        message = encode(value)
        if len(message) > limit:
            raise TypeError("Fish message exceeds max_message_bytes")
        await socket.send(message)

    try:
        source = aiter(text)
        pending_send = asyncio.ensure_future(send({"event": "start", "request": wire}))
        pending_output = asyncio.ensure_future(socket.receive())
        while True:
            tasks = [task for task in (pending_input, pending_output, pending_send) if task is not None]
            completed, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            order = [("output", pending_output), ("input", pending_input)] if prefer_output else [("input", pending_input), ("output", pending_output)]
            kind = next(name for name, task in [("send", pending_send), *order] if task is not None and task in completed)
            if kind == "send":
                assert pending_send is not None
                pending_send.result()
                pending_send = None
                if not input_done:
                    pending_input = asyncio.ensure_future(anext(source))
            elif kind == "input":
                prefer_output = True
                assert pending_input is not None
                completed_input, pending_input = pending_input, None
                try:
                    item = completed_input.result()
                except StopAsyncIteration:
                    input_done = True
                    pending_send = asyncio.ensure_future(send({"event": "stop"}))
                else:
                    validate(item)
                    pending_send = asyncio.ensure_future(send({"event": "text", "text": item} if isinstance(item, str) else {"event": "flush"}))
            else:
                prefer_output = False
                assert pending_output is not None
                try:
                    frame = pending_output.result()
                except StopAsyncIteration:
                    raise TypeError("Fish WebSocket closed before session completion") from None
                if not isinstance(frame, bytes):
                    raise TypeError("Fish returned a non-binary WebSocket frame")
                if len(frame) > limit:
                    raise TypeError("Fish message exceeds max_message_bytes")
                packet = decode(frame)
                if not is_mapping(packet) or not isinstance(packet.get("event"), str):
                    raise TypeError("Fish returned an invalid WebSocket event")
                event = packet["event"]
                if event == "finish":
                    reason = packet.get("reason")
                    if reason == "error":
                        raise FishError(0, "Streaming synthesis failed", "error")
                    if reason != "stop":
                        raise TypeError("Fish returned an invalid WebSocket event")
                    if not input_done:
                        raise TypeError("Fish finished before the input stream ended")
                    return
                if event == "audio":
                    audio = packet.get("audio")
                    if not isinstance(audio, bytes):
                        raise TypeError("Fish returned an invalid WebSocket event")
                    yield audio
                pending_output = asyncio.ensure_future(socket.receive())
            await asyncio.sleep(0)
    finally:
        original = sys.exception()
        cleanup_error: BaseException | None = None
        try:
            await socket.aclose()
        except BaseException as error:
            cleanup_error = error
        tasks = [task for task in (pending_input, pending_output, pending_send) if task is not None]
        for task in tasks:
            task.cancel()
        cleanup: list[Awaitable[object]] = list(tasks)
        await asyncio.gather(*cleanup, return_exceptions=True)
        if isinstance(source, _Closable):
            try:
                await source.aclose()
            except BaseException as error:
                if cleanup_error is None:
                    cleanup_error = error
        if original is None and cleanup_error is not None:
            raise cleanup_error


@asynccontextmanager
async def synthesize(request: TtsRequest, *, auth: Auth | None = None, transport: HttpTransport | None = None,
                     web_socket: WebSocketLike | None = None, base_url: str = "https://api.fish.audio",
                     web_socket_url: str | None = None, timeout_ms: int | None = None,
                     max_json_bytes: int = 16 * 1024 * 1024, max_message_bytes: int = 4 * 1024 * 1024) -> AsyncIterator[AsyncIterator[SynthesisItem]]:
    """Use async with: its lifetime owns unread/idle resources as well as reads.

    Complete text needs an injected async HTTP transport. Incremental text opens a
    native header-authenticated socket, or accepts an authenticated override.
    Transport and input work must honor task cancellation and close idempotently.
    """
    validate = validate_request(request)
    for name, limit in [("max_json_bytes", max_json_bytes), ("max_message_bytes", max_message_bytes)]:
        if type(limit) is not int or limit <= 0:
            raise TypeError(f"Fish {name} must be a positive integer")
    if timeout_ms is not None and (type(timeout_ms) is not int or not 0 <= timeout_ms <= 2147483647):
        raise TypeError("Fish timeout_ms must be an integer between 0 and 2147483647")
    if timeout_ms == 0:
        raise TimeoutError("Fish synthesis deadline expired")
    text = request["text"]
    streaming = not isinstance(text, str)
    entry = auth.get("fish") if auth is not None else None
    key = entry["api_key"] if entry is not None and "api_key" in entry else os.environ.get("SPEECHSWITCH_FISH_API_KEY", os.environ.get("FISH_API_KEY"))
    if not key and not (streaming and web_socket is not None):
        raise TypeError("Missing auth.fish.apiKey configuration")
    raw_url = web_socket_url if streaming and web_socket_url is not None else base_url
    try:
        url = urlsplit(raw_url)
        allowed = ("http", "https", "ws", "wss") if streaming else ("http", "https")
        if url.scheme not in allowed or not url.hostname or url.username is not None or url.password is not None or url.fragment or any(c.isspace() or ord(c) < 32 or c == "\\" for c in raw_url):
            raise ValueError()
        _ = url.port
    except ValueError:
        raise TypeError("Invalid Fish endpoint URL") from None
    timed = "timestamp_granularity" in request
    path = url.path if streaming and web_socket_url is not None else url.path.rstrip("/") + ("/v1/tts/live" if streaming else "/v1/tts/stream/with-timestamp" if timed else "/v1/tts")
    scheme = {"https": "wss", "http": "ws"}.get(url.scheme, url.scheme) if streaming else url.scheme
    target = urlunsplit((scheme, url.netloc, path, url.query, ""))
    wire = _settings(request)
    encoded = encode(wire) if not streaming else b""
    deadline = asyncio.timeout(None if timeout_ms is None else timeout_ms / 1000)
    try:
        async with deadline:
            if isinstance(text, str):
                if transport is None:
                    raise TypeError("Fish HTTP transport is required")
                response = await transport.send(HttpRequest("POST", target, {"authorization": f"Bearer {key}", "model": request["model"], "content-type": "application/msgpack"}, encoded))
                async with _closing(AudioStream(response.body)) as body:
                    if not 200 <= response.status < 300:
                        data = bytearray()
                        async for chunk in body:
                            if len(chunk) > max_json_bytes - len(data):
                                raise TypeError("Fish response exceeds max_json_bytes")
                            data.extend(chunk)
                            await asyncio.sleep(0)
                        message = data.decode("utf-8-sig", errors="replace")
                        reason = None
                        try:
                            value: object = json.loads(message)
                            if is_mapping(value):
                                candidate = value.get("message")
                                if isinstance(candidate, str):
                                    message = candidate
                                candidate = value.get("reason")
                                if isinstance(candidate, str):
                                    reason = candidate
                        except (ValueError, RecursionError):
                            pass
                        raise FishError(response.status, message, reason)
                    async with _closing(_http(body, timed, max_json_bytes)) as items:
                        yield items
            elif web_socket is not None:
                async with _closing(web_socket):
                    async with _closing(_live(text, wire, web_socket, validate, max_message_bytes)) as items:
                        yield items
            else:
                async with connect_websocket(target, headers={"Authorization": f"Bearer {key}", "model": request["model"]}, max_message_bytes=max_message_bytes) as socket:
                    async with _closing(_live(text, wire, socket, validate, max_message_bytes)) as items:
                        yield items
    except TimeoutError:
        if deadline.expired():
            raise TimeoutError("Fish synthesis deadline expired") from None
        raise
