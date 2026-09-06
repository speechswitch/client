"""CAMB synthesis using generated OpenAPI/AsyncAPI wire clients."""

import asyncio
import math
import os
from collections.abc import AsyncGenerator, AsyncIterable, AsyncIterator, Awaitable
from contextlib import aclosing, asynccontextmanager
from typing import Protocol, runtime_checkable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from speechswitch.clients import camb as wire
from speechswitch.generated.auth import Auth
from speechswitch.generated.camb import TtsRequest
from speechswitch.generated.camb_output import SynthesisItem, WordTimestamp
from speechswitch.generated.validators.camb import validate_request
from speechswitch.http import AudioStream, HttpTransport
from speechswitch.validation import InputValidator
from speechswitch.websocket import WebSocketLike, connect_websocket


@runtime_checkable
class _Closable(Protocol):
    async def aclose(self) -> None: ...


async def _live(text: AsyncIterable[str], start: wire.ClientMessage, socket: WebSocketLike,
                validate_input: InputValidator, timed: bool, max_message_bytes: int) -> AsyncGenerator[SynthesisItem]:
    source: AsyncIterator[str] | None = None
    pending_input: asyncio.Future[str] | None = None
    pending_output: asyncio.Future[str | bytes] | None = None
    pending_send: asyncio.Future[None] | None = None
    input_done = False
    segment: int | None = None
    seen: set[int] = set()
    index = 0

    async def send(message: wire.ClientMessage) -> None:
        encoded = wire.encode_message(message)
        if len(encoded.encode("utf-8")) > max_message_bytes:
            raise TypeError("CAMB message exceeds max_message_bytes")
        await socket.send(encoded)

    def decode(frame: str | bytes) -> wire.ServerMessage:
        if (len(frame.encode("utf-8")) if isinstance(frame, str) else len(frame)) > max_message_bytes:
            raise TypeError("CAMB message exceeds max_message_bytes")
        return wire.decode_message(frame)

    try:
        await send(start)
        try:
            ready = decode(await socket.receive())
        except StopAsyncIteration:
            raise TypeError("CAMB closed before session.ready") from None
        if not isinstance(ready, bytes) and ready["type"] == "session.error":
            raise TypeError(f"CAMB rejected session: {ready['error']}")
        if isinstance(ready, bytes) or ready["type"] != "session.ready":
            raise TypeError("CAMB did not acknowledge the session before sending output")
        source = aiter(text)
        pending_input = asyncio.ensure_future(anext(source))
        pending_output = asyncio.ensure_future(socket.receive())
        while True:
            tasks = [task for task in (pending_output, pending_input, pending_send) if task is not None]
            completed, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            if pending_output in completed:
                try:
                    message = decode(pending_output.result())
                except StopAsyncIteration:
                    raise TypeError("CAMB closed before session.done") from None
                if isinstance(message, bytes):
                    if segment is None:
                        raise TypeError("CAMB returned audio outside a segment")
                    if timed:
                        yield {"correlation": "ordered", "correlation_id": str(segment), "audio": message, "timestamps": []}
                    else:
                        yield message
                elif message["type"] == "segment.start":
                    identifier = message["segment_id"]
                    # Preserve IDs exactly across languages; JSON numbers in TS are doubles.
                    if not -9007199254740991 <= identifier <= 9007199254740991:
                        raise TypeError("CAMB returned an unsafe segment ID")
                    current = int(identifier)
                    if segment is not None or current in seen:
                        raise TypeError("CAMB returned an overlapping or reused segment")
                    seen.add(current)
                    segment = current
                    if timed:
                        timestamps: list[WordTimestamp] = []
                        for word in message.get("word_timestamps") or []:
                            begin, end = float(word["start"]) * 1000, float(word["end"]) * 1000
                            if not math.isfinite(begin) or not math.isfinite(end) or begin < 0 or end < begin:
                                raise TypeError("CAMB returned invalid word timing")
                            timestamps.append({"kind": "word", "value": word["word"], "start_time_ms": begin, "end_time_ms": end})
                        yield {"correlation": "ordered", "correlation_id": str(segment), "timestamps": timestamps}
                elif message["type"] == "segment.done":
                    if segment is None or message["segment_id"] != segment:
                        raise TypeError("CAMB completed an unexpected segment")
                    segment = None
                elif message["type"] == "segment.skipped":
                    raise TypeError(f"CAMB skipped segment {int(message['segment_id'])}: {message['text']}")
                elif message["type"] == "session.error":
                    raise TypeError(f"CAMB synthesis failed: {message['error']}")
                elif message["type"] == "session.done":
                    if not input_done or segment is not None:
                        raise TypeError("CAMB ended an incomplete session")
                    return
                else:
                    raise TypeError(f"Unexpected CAMB event: {message['type']}")
                pending_output = asyncio.ensure_future(socket.receive())
            elif pending_send is not None and pending_send in completed:
                pending_send.result()
                pending_send = None
                if not input_done:
                    pending_input = asyncio.ensure_future(anext(source))
            elif pending_input is not None:
                completed_input = pending_input
                pending_input = None
                try:
                    chunk = completed_input.result()
                except StopAsyncIteration:
                    input_done = True
                    pending_send = asyncio.ensure_future(send({"type": "text.done"}))
                else:
                    validate_input(chunk)
                    pending_send = asyncio.ensure_future(send({"type": "text.chunk", "text": chunk, "index": index}))
                    index += 1
    finally:
        # Close the network before cooperative producer cleanup can block.
        try:
            await socket.aclose()
        finally:
            cleanup: list[Awaitable[object]] = []
            for task in (pending_input, pending_output, pending_send):
                if task is not None:
                    task.cancel()
                    cleanup.append(task)
            await asyncio.gather(*cleanup, return_exceptions=True)
            if isinstance(source, _Closable):
                await source.aclose()


@asynccontextmanager
async def synthesize(
    request: TtsRequest, *, transport: HttpTransport | None = None, auth: Auth | None = None,
    web_socket: WebSocketLike | None = None, base_url: str = wire.DEFAULT_BASE_URL,
    web_socket_url: str = wire.DEFAULT_WEB_SOCKET_URL, max_message_bytes: int = 4 * 1024 * 1024,
    max_error_bytes: int = 1024 * 1024,
) -> AsyncIterator[AsyncIterator[SynthesisItem]]:
    """Use async with to own the response/socket, including on early exit.

    Whole text streams HTTP audio through the injected transport. Incremental
    or timestamped text uses a native, header-authenticated WebSocket unless
    web_socket overrides it. Inputs and injected transports must honor cancellation.
    """
    validate_input = validate_request(request)
    entry = auth.get("camb") if auth is not None else None
    key = entry["api_key"] if entry is not None and "api_key" in entry else os.environ.get("SPEECHSWITCH_CAMB_API_KEY", os.environ.get("CAMB_API_KEY"))
    if not key:
        raise TypeError("Missing auth.camb.apiKey configuration")
    for name, limit in [("max_message_bytes", max_message_bytes), ("max_error_bytes", max_error_bytes)]:
        if type(limit) is not int or limit <= 0:
            raise TypeError(f"CAMB {name} must be a positive integer")
    # Voice is a decimal public identifier; the wire protocol requires a number.
    decimal = request["voice"].lstrip("0")
    if len(decimal) > 16 or not decimal or int(decimal) > 9007199254740991:
        raise TypeError("CAMB voice must be a positive integer ID")
    voice = int(decimal)
    text, output = request["text"], request["output"]
    if isinstance(text, str) and request.get("timestamp_granularity") is None:
        if transport is None:
            raise TypeError("CAMB HTTP transport is required")
        if output["format"] == "pcm":
            format = {
                "signed_integer_16": {"little_endian": "pcm_s16le", "big_endian": "pcm_s16be"},
                "signed_integer_32": {"little_endian": "pcm_s32le", "big_endian": "pcm_s32be"},
                "float_32": {"little_endian": "pcm_f32le", "big_endian": "pcm_f32be"},
            }[output["sample_encoding"]][output["byte_order"]]
        else:
            format = "adts" if output["format"] == "aac" else output["format"]
        body: dict[str, object] = {
            "text": text, "voice_id": voice, "language": request["language"],
            "speech_model": {"mars8-flash": "mars-flash", "mars8-instruct": "mars-instruct", "mars8-pro": "mars-pro",
                             "mars8.1-flash-beta": "mars-8.1-flash-beta", "mars8.1-pro-beta": "mars-8.1-pro-beta"}[request["model"]],
            "output_configuration": {"format": format, **({"sample_rate": output["sample_rate_hz"]} if "sample_rate_hz" in output else {}),
                                     **({"apply_enhancement": request["audio_enhancement"]} if "audio_enhancement" in request else {})},
            "voice_settings": {**({"speaking_rate": request["speed"]} if "speed" in request else {}),
                               **({"enhance_reference_audio_quality": request["reference_audio_enhancement"]} if "reference_audio_enhancement" in request else {}),
                               **({"maintain_source_accent": request["accent_preservation"]} if "accent_preservation" in request else {})},
        }
        if "named_entity_pronunciation_enhancement" in request:
            body["enhance_named_entities_pronunciation"] = request["named_entity_pronunciation_enhancement"]
        if not wire.is_http_input(body):
            raise TypeError("Invalid CAMB HTTP synthesis request")
        response = await wire.stream_speech(body, api_key=key, base_url=base_url, transport=transport)
        audio = AudioStream(response.body)
        try:
            if not 200 <= response.status < 300:
                data = bytearray()
                async for chunk in audio:
                    if len(chunk) > max_error_bytes - len(data):
                        raise TypeError("CAMB response exceeds max_error_bytes")
                    data.extend(chunk)
                raise TypeError(f"CAMB returned HTTP {response.status}: {data.decode('utf-8-sig', errors='replace').strip()}")
            yield audio
        finally:
            await audio.aclose()
        return
    timed = request.get("timestamp_granularity") == "word"
    start: dict[str, object] = {
        "type": "session.start", "voice_id": voice, "language": request["language"], "output_format": output["format"],
        "word_timestamps": timed, "idle_timeout": request.get("text_flush_delay_ms", 1000) / 1000,
        "enhance_named_entities_pronunciation": request.get("named_entity_pronunciation_enhancement", False),
        "enhance_reference_audio_quality": request.get("reference_audio_enhancement", False),
        "maintain_source_accent": request.get("accent_preservation", False),
    }
    if "sample_rate_hz" in output:
        start["sample_rate"] = output["sample_rate_hz"]
    for normalized, native in [("inference_steps", "inference_steps"), ("speed", "speaking_rate"), ("audio_enhancement", "apply_enhancement")]:
        if normalized in request:
            start[native] = request[normalized]
    if not wire.is_client_message(start):
        raise TypeError("Invalid CAMB WebSocket input")
    if isinstance(text, str):
        async def whole() -> AsyncGenerator[str]:
            yield text
        source = whole()
        validate_input = validate_request({**request, "text": source})
    else:
        source = text
    if web_socket is not None:
        try:
            async with aclosing(_live(source, start, web_socket, validate_input, timed, max_message_bytes)) as stream:
                yield stream
        finally:
            await web_socket.aclose()
    else:
        url = urlsplit(web_socket_url)
        # Header auth is supported natively; do not retain a stale query credential.
        query = [(name, value) for name, value in parse_qsl(url.query, keep_blank_values=True) if name != "api_key"]
        target = urlunsplit((url.scheme, url.netloc, url.path, urlencode(query), url.fragment))
        async with connect_websocket(target, headers={"x-api-key": key}, max_message_bytes=max_message_bytes) as socket:
            async with aclosing(_live(source, start, socket, validate_input, timed, max_message_bytes)) as stream:
                yield stream
