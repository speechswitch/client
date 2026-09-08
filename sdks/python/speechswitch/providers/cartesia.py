"""Cartesia's authored protocol; its partial contracts are not wire-codegen input."""

import asyncio
import base64
import json
import math
import os
import re
import sys
import uuid
from collections.abc import AsyncGenerator, AsyncIterable, AsyncIterator, Awaitable, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Literal, NoReturn, Protocol, runtime_checkable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from speechswitch.generated.auth import Auth
from speechswitch.generated.cartesia import TtsRequest, TtsRequestStreamingTextVoice0bf53a99TextItem as Input
from speechswitch.generated.cartesia_output import SynthesisItem, TimelineOutput, Timestamp
from speechswitch.generated.validators.cartesia import validate_request
from speechswitch.http import AudioStream, HttpRequest, HttpTransport
from speechswitch.sse import SseDecoder
from speechswitch.validation import InputValidator, is_mapping, is_sequence
from speechswitch.websocket import WebSocketLike, connect_websocket

_VERSION = "2026-08-14"


@runtime_checkable
class _Closable(Protocol):
    def aclose(self) -> Awaitable[None]: ...


@asynccontextmanager
async def _closing[T: _Closable](resource: T) -> AsyncIterator[T]:
    try:
        yield resource
    except BaseException:
        # Cleanup must not replace a read/protocol failure or task cancellation.
        try:
            await resource.aclose()
        except Exception:
            pass
        raise
    else:
        await resource.aclose()


class CartesiaError(Exception):
    def __init__(self, payload: object, status_code: int) -> None:
        value: Mapping[object, object] = payload if is_mapping(payload) else {}
        title, message = value.get("title"), value.get("message")
        title = title if isinstance(title, str) else "Request failed"
        message = message if isinstance(message, str) else payload if isinstance(payload, str) else "Invalid error response"
        self.status_code = status_code
        code, request, doc, context = value.get("error_code"), value.get("request_id"), value.get("doc_url"), value.get("context_id")
        self.error_code = code if isinstance(code, str) else None
        self.request_id = request if isinstance(request, str) else None
        self.doc_url = doc if isinstance(doc, str) else None
        self.context_id = context if isinstance(context, str) else None
        super().__init__(f"Cartesia {status_code}: {title}: {message}")


def _settings(request: TtsRequest) -> dict[str, object]:
    output = request["output"]
    if output["format"] == "mp3":
        encoded: dict[str, object] = {"container": "mp3", "sample_rate": output["sample_rate_hz"], "bit_rate": output["bit_rate_bps"]}
    else:
        encoding = output["format"] if output["format"] in ("mulaw", "alaw") else output.get("sample_encoding", "signed_integer_16")
        encoded = {"container": "wav" if output["format"] == "wav" else "raw", "sample_rate": output["sample_rate_hz"],
                   "encoding": {"signed_integer_16": "pcm_s16le", "float_32": "pcm_f32le", "mulaw": "pcm_mulaw", "alaw": "pcm_alaw"}[encoding]}
    generation: dict[str, object] = {}
    for normalized, native in [("speed", "speed"), ("volume_scale", "volume"), ("emotion", "emotion")]:
        if normalized in request:
            generation[native] = request[normalized]
    wire: dict[str, object] = {"model_id": request["model"], "voice": request["voice"], "output_format": encoded, "generation_config": generation}
    if "language" in request:
        wire["locale" if request["model"] == "sonic-3.6" else "language"] = request["language"]
    for normalized, native in [("accent", "accent"), ("lexicon", "pronunciation_dict_id")]:
        if normalized in request:
            wire[native] = request[normalized]
    if "text_normalization" in request:
        normalization = request["text_normalization"]
        wire["normalization"] = ("auto" if normalization else "off") if isinstance(normalization, bool) else normalization["locale"]
    return wire


def _invalid_constant(_: str) -> NoReturn:
    raise TypeError("Cartesia returned invalid JSON")


def _load(text: str) -> object:
    try:
        return json.loads(text, parse_int=float, parse_float=float, parse_constant=_invalid_constant)
    except (ValueError, RecursionError, OverflowError):
        raise TypeError("Cartesia returned invalid JSON") from None


@dataclass(frozen=True, slots=True)
class _Context:
    context_id: str | None
    group_id: str | None


@dataclass(frozen=True, slots=True)
class _Chunk(_Context):
    data: str


@dataclass(frozen=True, slots=True)
class _Timing(_Context):
    timestamps: list[Timestamp]


@dataclass(frozen=True, slots=True)
class _Done(_Context):
    pass


@dataclass(frozen=True, slots=True)
class _Failure(_Context):
    error: CartesiaError


@dataclass(frozen=True, slots=True)
class _Flushed:
    context_id: str | None
    group_id: str


type _Packet = _Chunk | _Timing | _Done | _Failure | _Flushed


def _decode(frame: str | bytes, transport: Literal["sse", "websocket"]) -> _Packet:
    if not isinstance(frame, str):
        raise TypeError("Cartesia returned a non-text frame")
    value = _load(frame)
    if not is_mapping(value):
        raise TypeError("Cartesia returned an invalid frame")
    status = value.get("status_code")
    if not isinstance(status, float) or not math.isfinite(status) or not status.is_integer():
        raise TypeError("Cartesia returned an invalid status_code")
    context = value.get("context_id")
    if context is not None and not isinstance(context, str):
        raise TypeError("Cartesia returned an invalid context ID")
    group: str | None = None
    if "flush_id" in value:
        identifier = value["flush_id"]
        if not isinstance(identifier, float) or not 0 <= identifier <= 9007199254740991 or not identifier.is_integer():
            raise TypeError("Cartesia returned an invalid flush ID")
        group = str(int(identifier))
    kind = value.get("type")
    if kind == "error":
        return _Failure(context, group, CartesiaError(value, int(status)))
    if transport == "websocket" and context is None:
        raise TypeError("Cartesia WebSocket output lacks its context ID")
    done = value.get("done")
    if not isinstance(done, bool):
        raise TypeError("Cartesia returned an invalid completion flag")
    if kind == "done" and done:
        return _Done(context, group)
    if kind == "flush_done" and transport == "websocket" and value.get("flush_done") is True and group is not None:
        return _Flushed(context, group)
    data = value.get("data")
    if kind == "chunk" and isinstance(data, str):
        return _Chunk(context, group, data)
    if kind == "timestamps" or kind == "phoneme_timestamps":
        field = "word_timestamps" if kind == "timestamps" else "phoneme_timestamps"
        if field not in value and transport == "websocket":
            return _Timing(context, group, [])
        timing = value.get(field)
        if not is_mapping(timing):
            raise TypeError("Cartesia returned incomplete timestamps")
        labels, starts, ends = timing.get("words" if kind == "timestamps" else "phonemes"), timing.get("start"), timing.get("end")
        if not is_sequence(labels) or not is_sequence(starts) or not is_sequence(ends) or len(labels) != len(starts) or len(labels) != len(ends):
            raise TypeError("Cartesia returned mismatched timestamp arrays")
        timestamps: list[Timestamp] = []
        for label, start, end in zip(labels, starts, ends):
            if not isinstance(label, str) or not isinstance(start, float) or not isinstance(end, float) or not math.isfinite(start) or not math.isfinite(end) or start < 0 or end < start:
                raise TypeError("Cartesia returned an invalid timestamp")
            begin, finish = start * 1000, end * 1000
            if not math.isfinite(begin) or not math.isfinite(finish):
                raise TypeError("Cartesia returned an invalid timestamp")
            timestamps.append({"kind": "word" if kind == "timestamps" else "phoneme", "value": label, "start_time_ms": begin, "end_time_ms": finish})
        return _Timing(context, group, timestamps)
    raise TypeError(f"Unknown Cartesia event: {kind if kind is not None else 'undefined' if 'type' not in value else 'null'}")


def _output(packet: _Packet, context: str, timed: bool) -> SynthesisItem | None:
    if isinstance(packet, _Failure):
        raise packet.error
    if isinstance(packet, _Done):
        return None
    if isinstance(packet, _Flushed):
        return {"event": "flush", "correlation_id": context, "input_group_id": packet.group_id}
    envelope: TimelineOutput = {"correlation": "timeline", "correlation_id": context, "timestamps": [] if isinstance(packet, _Chunk) else packet.timestamps}
    if packet.group_id is not None:
        envelope = {**envelope, "input_group_id": packet.group_id}
    if isinstance(packet, _Chunk):
        if len(packet.data) % 4 or re.fullmatch(r"[A-Za-z0-9+/]*={0,2}", packet.data) is None:
            raise TypeError("Cartesia returned invalid base64 audio")
        audio = base64.b64decode(packet.data, validate=True)
        if not timed and packet.group_id is None:
            return audio
        envelope = {**envelope, "audio": audio}
    return envelope


def _endpoint(base: str, path: str) -> str:
    try:
        url = urlsplit(base)
        if url.scheme not in ("http", "https") or not url.hostname or url.username is not None or url.password is not None or url.fragment or any(ch.isspace() or ord(ch) < 32 or ch == "\\" for ch in base):
            raise ValueError
        _ = url.port
    except ValueError:
        raise TypeError("Cartesia base_url must be an HTTP(S) URL without credentials or a fragment") from None
    return urlunsplit((url.scheme, url.netloc, url.path.rstrip("/") + path, url.query, ""))


async def _response_text(body: AudioStream, limit: int) -> str:
    data = bytearray()
    async for chunk in body:
        if len(chunk) > limit - len(data):
            raise TypeError("Cartesia response exceeds max_json_bytes")
        data.extend(chunk)
    return data.decode("utf-8-sig", errors="replace")


async def _response_error(body: AudioStream, status: int, limit: int) -> CartesiaError:
    text = await _response_text(body, limit)
    try:
        payload = _load(text)
    except TypeError:
        payload = text
    return CartesiaError(payload, status)


async def _request(transport: HttpTransport, credential: str, url: str, body: dict[str, object]):
    return await transport.send(HttpRequest("POST", url, {"authorization": f"Bearer {credential}", "cartesia-version": _VERSION, "content-type": "application/json"},
                                            json.dumps(body, allow_nan=False, separators=(",", ":")).encode("utf-8")))


async def _token(transport: HttpTransport, key: str, base: str, limit: int) -> str:
    response = await _request(transport, key, _endpoint(base, "/access-token"), {"grants": {"tts": True}, "expires_in": 60})
    async with _closing(AudioStream(response.body)) as body:
        if not 200 <= response.status < 300:
            raise await _response_error(body, response.status, limit)
        value = _load(await _response_text(body, limit))
        token = value.get("token") if is_mapping(value) else None
        if not isinstance(token, str) or not token:
            raise TypeError("Cartesia returned an invalid access token")
        return token


async def _sse(body: AudioStream, context: str, limit: int) -> AsyncGenerator[SynthesisItem]:
    decoder = SseDecoder(limit)
    try:
        async for chunk in body:
            for byte in chunk:
                event = decoder.push(byte)
                if event is None:
                    continue
                packet = _decode(event["data"], "sse")
                if packet.context_id is not None and packet.context_id != context:
                    raise TypeError("Cartesia SSE returned an unexpected context")
                if isinstance(packet, _Done):
                    return
                item = _output(packet, context, True)
                if item is not None:
                    yield item
        raise TypeError("Cartesia SSE ended before the done event")
    finally:
        decoder.finish()


async def _live(text: AsyncIterable[Input], wire: dict[str, object], socket: WebSocketLike,
                validate: InputValidator, timed: bool, limit: int) -> AsyncGenerator[SynthesisItem]:
    context = str(uuid.uuid4())
    used, input_done = False, False
    prefer_output = True
    retired: set[str] = set()
    source: AsyncIterator[Input] | None = None
    pending_input: asyncio.Future[Input] | None = None
    pending_output: asyncio.Future[str | bytes] | None = None
    pending_send: asyncio.Future[None] | None = None

    async def send(value: dict[str, object]) -> None:
        encoded = json.dumps(value, allow_nan=False, separators=(",", ":"))
        if len(encoded.encode("utf-8")) > limit:
            raise TypeError("Cartesia message exceeds max_message_bytes")
        await socket.send(encoded)

    def generation(transcript: str, continued: bool, flush: bool) -> dict[str, object]:
        return {**wire, "context_id": context, "transcript": transcript, "continue": continued, "flush": flush}

    try:
        source = aiter(text)
        pending_input = asyncio.ensure_future(anext(source))
        pending_output = asyncio.ensure_future(socket.receive())
        while True:
            tasks = [task for task in (pending_output, pending_input, pending_send) if task is not None]
            completed, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            # Receive while writes are backpressured, but do not let a steady
            # audio stream starve a ready clear/flush command or a failed write.
            candidates = (pending_output, pending_send, pending_input) if prefer_output else (pending_send, pending_input, pending_output)
            ready = next(task for task in candidates if task is not None and task in completed)
            prefer_output = ready is not pending_output
            if ready is pending_output:
                try:
                    frame = pending_output.result()
                except StopAsyncIteration:
                    raise TypeError("Cartesia WebSocket closed before context completion (idle connections expire after five minutes)") from None
                if (len(frame.encode("utf-8")) if isinstance(frame, str) else len(frame)) > limit:
                    raise TypeError("Cartesia message exceeds max_message_bytes")
                packet = _decode(frame, "websocket")
                if packet.context_id is not None and packet.context_id in retired:
                    pending_output = asyncio.ensure_future(socket.receive())
                    continue
                if packet.context_id is not None and packet.context_id != context:
                    raise TypeError("Cartesia returned output for an unexpected context")
                if isinstance(packet, _Done):
                    if input_done:
                        return
                    retired.add(context)
                    context, used = str(uuid.uuid4()), False
                else:
                    item = _output(packet, context, timed)
                    if item is not None:
                        yield item
                pending_output = asyncio.ensure_future(socket.receive())
            elif pending_send is not None and ready is pending_send:
                pending_send.result()
                pending_send = None
                if not input_done:
                    pending_input = asyncio.ensure_future(anext(source))
            elif pending_input is not None:
                completed_input, pending_input = pending_input, None
                try:
                    value = completed_input.result()
                except StopAsyncIteration:
                    input_done = True
                    if not used:
                        return
                    pending_send = asyncio.ensure_future(send(generation("", False, False)))
                else:
                    validate(value)
                    if isinstance(value, str):
                        if value:
                            used = True
                            pending_send = asyncio.ensure_future(send(generation(value, True, False)))
                    elif value["command"] == "flush":
                        if used:
                            pending_send = asyncio.ensure_future(send(generation("", True, True)))
                    else:
                        if used:
                            pending_send = asyncio.ensure_future(send({"context_id": context, "cancel": True}))
                        retired.add(context)
                        context, used = str(uuid.uuid4()), False
                        # Local playback boundary, never a synthesized server acknowledgement.
                        yield {"event": "clear"}
                    if pending_send is None:
                        pending_input = asyncio.ensure_future(anext(source))
    finally:
        failure: Exception | None = None
        try:
            await socket.aclose()
        except Exception as error:
            failure = error
        finally:
            cleanup: list[Awaitable[object]] = []
            for task in (pending_input, pending_output, pending_send):
                if task is not None:
                    task.cancel()
                    cleanup.append(task)
            await asyncio.gather(*cleanup, return_exceptions=True)
            if isinstance(source, _Closable):
                try:
                    await source.aclose()
                except Exception as error:
                    if failure is None:
                        failure = error
        if failure is not None and sys.exception() is None:
            raise failure


@asynccontextmanager
async def synthesize(
    request: TtsRequest, *, transport: HttpTransport | None = None, auth: Auth | None = None,
    web_socket: WebSocketLike | None = None, base_url: str = "https://api.cartesia.ai",
    web_socket_url: str = "wss://api.cartesia.ai/tts/websocket", timeout_ms: int | None = None,
    max_message_bytes: int = 4 * 1024 * 1024, max_event_bytes: int = 4 * 1024 * 1024,
    max_json_bytes: int = 1024 * 1024,
) -> AsyncIterator[AsyncIterator[SynthesisItem]]:
    """Use async with to own HTTP bodies, sockets and input, including early exits.

    Deadlines span token exchange, connection, input waits and output consumption.
    Native WebSockets use short-lived access tokens; overrides are authenticated.
    HTTP transports, socket overrides and producers must cooperate with cancellation.
    """
    validate = validate_request(request)
    if timeout_ms is not None and (type(timeout_ms) is not int or not 0 <= timeout_ms <= 2147483647):
        raise TypeError("Cartesia timeout_ms must be an integer between 0 and 2147483647")
    if timeout_ms == 0:
        raise TimeoutError("Cartesia synthesis deadline expired")
    for name, limit in [("max_message_bytes", max_message_bytes), ("max_event_bytes", max_event_bytes), ("max_json_bytes", max_json_bytes)]:
        if type(limit) is not int or limit <= 0:
            raise TypeError(f"Cartesia {name} must be a positive integer")
    entry = auth.get("cartesia") if auth is not None else None
    key = entry["api_key"] if entry is not None and "api_key" in entry else os.environ.get("SPEECHSWITCH_CARTESIA_API_KEY", os.environ.get("CARTESIA_API_KEY"))
    token = entry["access_token"] if entry is not None and "access_token" in entry else os.environ.get("SPEECHSWITCH_CARTESIA_ACCESS_TOKEN", os.environ.get("CARTESIA_ACCESS_TOKEN"))
    wire = _settings(request)
    text = request["text"]
    selection = request.get("timestamp_granularity", ())
    timed = "timestamp_granularity" in request
    timing: dict[str, object] = {"add_timestamps": "word" in selection, "add_phoneme_timestamps": "phoneme" in selection, "use_normalized_timestamps": request.get("timestamp_text") == "normalized"}
    deadline = asyncio.timeout(None if timeout_ms is None else timeout_ms / 1000)
    try:
        async with deadline:
            if isinstance(text, str):
                credential = key if key is not None else token
                if not credential:
                    raise TypeError("Missing auth.cartesia.apiKey or auth.cartesia.accessToken configuration")
                if transport is None:
                    raise TypeError("Cartesia HTTP transport is required")
                context = str(uuid.uuid4())
                payload = {**wire, "transcript": text, **({"context_id": context, **timing} if timed else {})}
                response = await _request(transport, credential, _endpoint(base_url, "/tts/sse" if timed else "/tts/bytes"), payload)
                async with _closing(AudioStream(response.body)) as body:
                    if not 200 <= response.status < 300:
                        raise await _response_error(body, response.status, max_json_bytes)
                    if timed:
                        async with _closing(_sse(body, context, max_event_bytes)) as items:
                            yield items
                    else:
                        yield body
            else:
                live = {**wire, **timing, "max_buffer_delay_ms": request.get("max_buffer_delay_ms", 3000)}
                if web_socket is not None:
                    async with _closing(web_socket):
                        async with _closing(_live(text, live, web_socket, validate, timed, max_message_bytes)) as items:
                            yield items
                else:
                    if not token:
                        if not key:
                            raise TypeError("Missing auth.cartesia.apiKey or auth.cartesia.accessToken configuration")
                        if transport is None:
                            raise TypeError("Cartesia HTTP transport is required for token exchange")
                        token = await _token(transport, key, base_url, max_json_bytes)
                    target = urlsplit(web_socket_url)
                    query = [(name, value) for name, value in parse_qsl(target.query, keep_blank_values=True) if name not in ("access_token", "cartesia_version", "api_key")]
                    query.extend([("cartesia_version", _VERSION), ("access_token", token)])
                    url = urlunsplit((target.scheme, target.netloc, target.path, urlencode(query), target.fragment))
                    async with connect_websocket(url, max_message_bytes=max_message_bytes) as socket:
                        async with _closing(_live(text, live, socket, validate, timed, max_message_bytes)) as items:
                            yield items
    except TimeoutError:
        if deadline.expired():
            raise TimeoutError("Cartesia synthesis deadline expired") from None
        raise
