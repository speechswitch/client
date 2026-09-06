"""Async's handwritten HTTP and incremental WebSocket synthesis protocols."""

import asyncio
import base64
import json
import math
import os
import uuid
from collections.abc import AsyncGenerator, AsyncIterable, AsyncIterator
from contextlib import aclosing, asynccontextmanager
from typing import Protocol, runtime_checkable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from speechswitch.generated.async_ import TtsRequest
from speechswitch.generated.async_output import SynthesisItem, TimestampedAudio, WordTimestamp
from speechswitch.generated.auth import Auth, AuthAsync
from speechswitch.generated.validators.async_ import validate_request
from speechswitch.http import AudioStream, HttpRequest, HttpTransport
from speechswitch.validation import InputValidator, is_mapping, is_sequence
from speechswitch.websocket import WebSocketLike, connect_websocket


def _settings(request: TtsRequest) -> dict[str, object]:
    output = request["output"]
    if output["format"] == "mp3":
        encoded: dict[str, object] = {"container": "mp3", "sample_rate": output["sample_rate_hz"], "bit_rate": output.get("bit_rate_bps", 192000)}
    else:
        encoded = {"container": "wav" if output["format"] == "wav" else "raw", "sample_rate": output["sample_rate_hz"],
                   "encoding": "pcm_mulaw" if output["format"] == "mulaw" else "pcm_f32le" if output.get("sample_encoding") == "float_32" else "pcm_s16le"}
    wire: dict[str, object] = {
        "model_id": {"castleflow-1.0": "async_flash_v1.0", "flash_v1.5": "async_flash_v1.5", "pro_v1.0": "async_pro_v1.0"}[request["model"]],
        "voice": {"mode": "id", "id": request["voice"]}, "output_format": encoded,
    }
    if "language" in request:
        wire["language"] = request["language"]
    if request["model"] == "castleflow-1.0":
        if "speed" in request:
            wire["speed_control"] = request["speed"]
        if "stability" in request:
            wire["stability"] = math.floor(request["stability"] * 100 + 0.5)
    return wire


def _audio_data(value: str) -> bytes:
    try:
        return base64.b64decode(value, validate=True)
    except (ValueError, UnicodeError):
        raise TypeError("Async returned invalid base64 audio") from None


def _timestamped(value: object) -> TimestampedAudio:
    if not is_mapping(value):
        raise TypeError("Async returned an invalid timestamp response")
    audio, alignment = value.get("audio_base64"), value.get("alignment")
    if not isinstance(audio, str) or not is_mapping(alignment):
        raise TypeError("Async returned incomplete timestamped audio")
    words, starts, ends = alignment.get("words"), alignment.get("word_start_times_milliseconds"), alignment.get("word_end_times_milliseconds")
    if not is_sequence(words) or not is_sequence(starts) or not is_sequence(ends) or len(words) != len(starts) or len(words) != len(ends):
        raise TypeError("Async returned mismatched word timestamp arrays")
    timestamps: list[WordTimestamp] = []
    for word, start, end in zip(words, starts, ends):
        if not isinstance(word, str) or isinstance(start, bool) or not isinstance(start, (float, int)) or not math.isfinite(start) or start < 0 or isinstance(end, bool) or not isinstance(end, (float, int)) or not math.isfinite(end) or end < start:
            raise TypeError("Async returned an invalid word timestamp")
        timestamps.append({"kind": "word", "value": word, "start_time_ms": start, "end_time_ms": end})
    return {"correlation": "chunk", "audio": _audio_data(audio), "timestamps": timestamps}


async def _response_text(body: AudioStream, limit: int) -> str:
    data = bytearray()
    async for chunk in body:
        if len(chunk) > limit - len(data):
            raise TypeError("Async response exceeds max_json_bytes")
        data.extend(chunk)
    return data.decode("utf-8-sig", errors="replace")


async def _audio(body: AudioStream, check_quota: bool) -> AsyncGenerator[bytes]:
    marker = b"--ERROR:QUOTA_EXCEEDED--"
    pending = b""
    async for chunk in body:
        if not check_quota:
            yield chunk
            continue
        data = pending + chunk
        index = data.find(marker)
        if index >= 0:
            if index:
                yield data[:index]
            raise TypeError("Async streaming quota exceeded")
        retained = min(len(data), len(marker) - 1)
        while retained and data[-retained:] != marker[:retained]:
            retained -= 1
        safe = len(data) - retained
        if safe:
            yield data[:safe]
        pending = data[safe:]
    if pending:
        yield pending


@runtime_checkable
class _Closable(Protocol):
    async def aclose(self) -> None: ...


async def _incremental(text: AsyncIterable[str], wire: dict[str, object], socket: WebSocketLike, force: bool, validate_input: InputValidator, max_message_bytes: int) -> AsyncGenerator[bytes]:
    context_id = str(uuid.uuid4())
    source: AsyncIterator[str] | None = None
    pending_input: asyncio.Future[str] | None = None
    pending_output: asyncio.Future[str | bytes] | None = None
    input_done, context_started = False, False
    async def send_message(value: dict[str, object]) -> None:
        encoded = json.dumps(value, separators=(",", ":"), allow_nan=False)
        if len(encoded.encode("utf-8")) > max_message_bytes:
            raise TypeError("Async message exceeds max_message_bytes")
        await socket.send(encoded)
    try:
        await send_message(wire)
        source = aiter(text)
        pending_input = asyncio.ensure_future(anext(source))
        pending_output = asyncio.ensure_future(socket.receive())
        while True:
            tasks = [task for task in (pending_output, pending_input) if task is not None]
            completed, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            # Read output first when both are ready: input cannot starve audio.
            if pending_output in completed:
                try:
                    frame = pending_output.result()
                except StopAsyncIteration:
                    raise TypeError("Async WebSocket closed before final output") from None
                if not isinstance(frame, str):
                    raise TypeError("Async returned a non-text WebSocket frame")
                if len(frame.encode("utf-8")) > max_message_bytes:
                    raise TypeError("Async message exceeds max_message_bytes")
                value: object = json.loads(frame)
                if not is_mapping(value):
                    raise TypeError("Async returned an invalid WebSocket message")
                code, message = value.get("error_code"), value.get("message")
                if isinstance(code, str) and isinstance(message, str):
                    raise TypeError(f"Async synthesis failed ({code}): {message}")
                audio, final = value.get("audio"), value.get("final")
                if not isinstance(value.get("context_id"), str) or not isinstance(audio, str) or type(final) is not bool:
                    raise TypeError("Async returned an unknown WebSocket message")
                if value["context_id"] != context_id:
                    raise TypeError("Async returned output for an unexpected context")
                if final and not input_done:
                    raise TypeError("Async finalized the context before input completed")
                if final:
                    await socket.aclose()
                if audio:
                    yield _audio_data(audio)
                if final:
                    return
                pending_output = asyncio.ensure_future(socket.receive())
            elif pending_input is not None:
                try:
                    chunk = pending_input.result()
                except StopAsyncIteration:
                    input_done = True
                    pending_input = None
                    if not context_started:
                        return
                    await send_message({"context_id": context_id, "transcript": "", "close_context": True})
                else:
                    validate_input(chunk)
                    if chunk:
                        context_started = True
                        # ECMAScript whitespace, matching the TypeScript adapter.
                        transcript = chunk.rstrip(" \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff") + " "
                        await send_message({"context_id": context_id, "transcript": transcript, "force": force})
                    pending_input = asyncio.ensure_future(anext(source))
    finally:
        # Release the network before waiting for cooperative producer cleanup.
        try:
            await socket.aclose()
        finally:
            tasks = [task for task in (pending_input, pending_output) if task is not None]
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            if isinstance(source, _Closable):
                await source.aclose()


@asynccontextmanager
async def synthesize(
    request: TtsRequest,
    *,
    transport: HttpTransport | None = None,
    auth: Auth | None = None,
    web_socket: WebSocketLike | None = None,
    base_url: str = "https://api.async.com",
    web_socket_url: str = "wss://api.async.com/text_to_speech/websocket/ws",
    max_json_bytes: int = 16 * 1024 * 1024,
    max_message_bytes: int = 4 * 1024 * 1024,
) -> AsyncIterator[AsyncIterator[SynthesisItem]]:
    """Own one synthesis stream. HTTP needs an injected async transport.

    Incremental input creates a native WebSocket unless web_socket overrides it.
    Injected sockets must close idempotently; inputs must honor task cancellation.
    """
    validate_input = validate_request(request)
    entry: AuthAsync = auth.get("async_", {}) if auth is not None else {}
    key = entry["api_key"] if "api_key" in entry else os.environ.get("SPEECHSWITCH_ASYNC_API_KEY", os.environ.get("ASYNC_API_KEY"))
    if not key:
        raise TypeError("Missing auth.async.apiKey configuration")
    for name, limit in [("max_json_bytes", max_json_bytes), ("max_message_bytes", max_message_bytes)]:
        if type(limit) is not int or limit <= 0:
            raise TypeError(f"Async {name} must be a positive integer")
    wire = _settings(request)
    text = request["text"]
    if isinstance(text, str):
        if transport is None:
            raise TypeError("Async HTTP transport is required")
        path = "/text_to_speech/with_timestamps" if request.get("timestamp_granularity") == "word" else "/text_to_speech" if request["output"]["format"] == "wav" else "/text_to_speech/streaming"
        url = urlsplit(base_url)
        if url.scheme not in ("http", "https") or not url.hostname or url.username is not None or url.password is not None or url.fragment:
            raise TypeError("Async base_url must be an HTTP(S) URL without credentials or a fragment")
        target = urlunsplit((url.scheme, url.netloc, url.path.rstrip("/") + path, url.query, ""))
        response = await transport.send(HttpRequest("POST", target, {"x-api-key": key, "version": "v1", "content-type": "application/json"}, json.dumps({**wire, "transcript": text}, separators=(",", ":"), allow_nan=False).encode("utf-8")))
        body = AudioStream(response.body)
        async def items() -> AsyncGenerator[SynthesisItem]:
            if not 200 <= response.status < 300:
                raise TypeError(f"Async returned HTTP {response.status}: {(await _response_text(body, max_json_bytes)).strip()}")
            if request.get("timestamp_granularity") == "word":
                value: object = json.loads(await _response_text(body, max_json_bytes), parse_int=float)
                yield _timestamped(value)
            else:
                async with aclosing(_audio(body, path == "/text_to_speech/streaming")) as audio:
                    async for chunk in audio:
                        yield chunk
        try:
            async with aclosing(items()) as stream:
                yield stream
        finally:
            await body.aclose()
    else:
        async def streaming(socket: WebSocketLike) -> AsyncGenerator[SynthesisItem]:
            async with aclosing(_incremental(text, wire, socket, request.get("segmentation") == "immediate", validate_input, max_message_bytes)) as audio:
                async for chunk in audio:
                    yield chunk
        if web_socket is not None:
            try:
                async with aclosing(streaming(web_socket)) as stream:
                    yield stream
            finally:
                await web_socket.aclose()
        else:
            url = urlsplit(web_socket_url)
            query = [(name, value) for name, value in parse_qsl(url.query, keep_blank_values=True) if name not in ("api_key", "version")]
            query.extend([("api_key", key), ("version", "v1")])
            target = urlunsplit((url.scheme, url.netloc, url.path, urlencode(query), url.fragment))
            async with connect_websocket(target, max_message_bytes=max_message_bytes) as socket:
                async with aclosing(streaming(socket)) as stream:
                    yield stream
