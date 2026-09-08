"""ElevenLabs' authored HTTP and TTS/dialogue WebSocket protocols."""

import asyncio
import base64
import json
import math
import os
import sys
import uuid
from collections.abc import AsyncGenerator, AsyncIterable, AsyncIterator, Awaitable, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Literal, NoReturn, Protocol, runtime_checkable
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

from speechswitch.generated.auth import Auth
from speechswitch.generated.elevenlabs import TtsRequest, TtsRequestStreamingTextVoice5024de38TextItem as Input
from speechswitch.generated.elevenlabs_output import CharacterTimestamp, SynthesisItem, TimestampedAudio
from speechswitch.generated.validators.elevenlabs import validate_request
from speechswitch.http import AudioStream, HttpRequest, HttpTransport
from speechswitch.validation import InputValidator, is_mapping, is_number, is_sequence
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


class ElevenLabsError(Exception):
    def __init__(self, payload: object, status_code: int | float, request_id: str | None = None) -> None:
        value: Mapping[object, object] = payload if is_mapping(payload) else {}
        detail = value.get("detail")
        fields = detail if is_mapping(detail) else value
        message = fields.get("message")
        if not isinstance(message, str):
            message = detail if isinstance(detail, str) else payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=True)
        code = fields.get("status")
        if not isinstance(code, str):
            code = value.get("error")
        self.status_code = status_code
        self.error_code = code if isinstance(code, str) else None
        self.request_id = request_id
        super().__init__(f"ElevenLabs {status_code:g}: {message}")


def _invalid_constant(_: str) -> NoReturn:
    raise TypeError("ElevenLabs returned invalid JSON")


def _load(text: str) -> object:
    try:
        return json.loads(text, parse_int=float, parse_constant=_invalid_constant)
    except (ValueError, RecursionError):
        raise TypeError("ElevenLabs returned invalid JSON") from None


def _audio(value: str) -> bytes:
    try:
        return base64.b64decode(value, validate=True)
    except (ValueError, UnicodeError):
        raise TypeError("ElevenLabs returned invalid base64 audio") from None


def _timestamps(raw: object, protocol: Literal["http", "tts", "dialogue"]) -> list[CharacterTimestamp]:
    if raw is None:
        return []
    if not is_mapping(raw):
        raise TypeError("Invalid ElevenLabs alignment")
    chars = raw.get("characters" if protocol == "http" else "chars")
    starts = raw.get("character_start_times_seconds" if protocol == "http" else "charStartTimesMs" if protocol == "tts" else "char_start_times_ms")
    durations = raw.get("character_end_times_seconds" if protocol == "http" else "charDurationsMs" if protocol == "tts" else "char_durations_ms")
    if not is_sequence(chars) or not is_sequence(starts) or not is_sequence(durations) or len(chars) != len(starts) or len(chars) != len(durations):
        raise TypeError("ElevenLabs returned incomplete or mismatched alignment arrays")
    result: list[CharacterTimestamp] = []
    for char, start, duration in zip(chars, starts, durations):
        if not isinstance(char, str) or not is_number(start) or not is_number(duration) or start < 0 or duration < (start if protocol == "http" else 0):
            raise TypeError("ElevenLabs returned invalid character timing")
        start_ms = start * 1000 if protocol == "http" else start
        end_ms = duration * 1000 if protocol == "http" else start + duration
        if not is_number(start_ms) or not is_number(end_ms):
            raise TypeError("ElevenLabs returned invalid character timing")
        result.append({"kind": "character", "value": char, "start_time_ms": start_ms, "end_time_ms": end_ms})
    return result


def _timestamped(raw: object, normalized: bool) -> TimestampedAudio:
    if not is_mapping(raw) or not isinstance(audio := raw.get("audio_base64"), str):
        raise TypeError("Invalid ElevenLabs timestamped audio chunk")
    return {"correlation": "chunk", "audio": _audio(audio), "timestamps": _timestamps(raw.get("normalized_alignment" if normalized else "alignment"), "http")}


def _settings(request: TtsRequest) -> dict[str, object]:
    voice: dict[str, object] = {}
    for field, native in [("stability", "stability"), ("voice_similarity", "similarity_boost"), ("style_exaggeration", "style"), ("voice_boost", "use_speaker_boost"), ("speed", "speed")]:
        if field in request:
            voice[native] = request[field]
    return voice


def _dictionaries(request: TtsRequest) -> dict[str, object]:
    if "pronunciation_dictionaries" not in request:
        return {}
    return {"pronunciation_dictionary_locators": [
        {"pronunciation_dictionary_id": item["id"], **({"version_id": item["version_id"]} if "version_id" in item else {})}
        for item in request["pronunciation_dictionaries"]
    ]}


def _normalization(request: TtsRequest) -> str:
    value = request.get("text_normalization", "auto")
    return "off" if request.get("latency_optimization") == "maximum" or value is False else "on" if value is True else "auto"


def _url(request: TtsRequest, base: str, socket_override: str | None, token: str | None, logging: bool) -> str:
    streaming = not isinstance(request["text"], str)
    endpoint = socket_override if streaming and socket_override is not None else base
    try:
        url = urlsplit(endpoint)
        if url.scheme not in (("http", "https", "ws", "wss") if streaming else ("http", "https")) or not url.hostname or url.username is not None or url.password is not None or url.fragment or any(c.isspace() or ord(c) < 32 or ord(c) == 127 or c == "\\" for c in endpoint):
            raise ValueError
        _ = url.port
    except ValueError:
        raise TypeError("Invalid ElevenLabs endpoint URL") from None
    output = request["output"]
    format = output["format"]
    rate = output.get("sample_rate_hz", 48000 if format == "ogg_opus" else 8000 if format in ("mulaw", "alaw") else 44100)
    native_format = "opus" if format == "ogg_opus" else "ulaw" if format == "mulaw" else format
    encoded = f"{native_format}_{int(rate)}"
    if format in ("mp3", "ogg_opus"):
        encoded += f"_{int(output.get('bit_rate_bps', 128000) / 1000)}"
    owned = {"output_format", "enable_logging", "optimize_streaming_latency", "model_id", "sync_alignment", "apply_text_normalization", "language_code", "seed", "single_use_token", "authorization", "xi-api-key", "xi_api_key", "api_key", "inactivity_timeout", "auto_mode", "enable_ssml_parsing"}
    query = [(k, v) for k, v in parse_qsl(url.query, keep_blank_values=True) if k not in owned]
    query.extend([("output_format", encoded), ("enable_logging", "true" if logging else "false")])
    path = url.path
    if streaming:
        if socket_override is None:
            path = path.rstrip("/") + ("/v1/text-to-dialogue/stream-input" if request["model"] == "eleven-v3" else f"/v1/text-to-speech/{quote(request['voice'], safe='')}/multi-stream-input")
        query.extend([("model_id", _MODELS[request["model"]]), ("sync_alignment", "true" if "timestamp_granularity" in request else "false"), ("apply_text_normalization", _normalization(request))])
        language = request.get("language")
        if language is not None:
            query.append(("language_code", language))
        if "random_seed" in request:
            query.append(("seed", str(int(request["random_seed"]))))
        if token is not None:
            query.append(("single_use_token", token))
        if request["model"] != "eleven-v3":
            query.extend([("inactivity_timeout", "20"), ("auto_mode", "true" if request.get("text_buffering") is False else "false"), ("enable_ssml_parsing", "true" if request.get("input_type") == "ssml" else "false")])
    else:
        path = path.rstrip("/") + f"/v1/text-to-speech/{quote(request['voice'], safe='')}"
        if format != "wav":
            path += "/stream"
        if "timestamp_granularity" in request:
            path += "/with-timestamps"
        latency = request.get("latency_optimization")
        if latency is not None:
            query.append(("optimize_streaming_latency", str(["none", "moderate", "strong", "aggressive", "maximum"].index(latency))))
    scheme = "wss" if streaming and url.scheme == "https" else "ws" if streaming and url.scheme == "http" else url.scheme
    return urlunsplit((scheme, url.netloc, path, urlencode(query), ""))


_MODELS = {"flash-v2": "eleven_flash_v2", "flash-v2.5": "eleven_flash_v2_5", "multilingual-v2": "eleven_multilingual_v2", "eleven-v3": "eleven_v3"}


def _http_input(request: TtsRequest, text: str) -> dict[str, object]:
    result: dict[str, object] = {"text": text, "model_id": _MODELS[request["model"]], "voice_settings": _settings(request), **_dictionaries(request),
                                 "apply_text_normalization": _normalization(request), "apply_language_text_normalization": request.get("language_text_normalization", False)}
    for field, native in [("language", "language_code"), ("random_seed", "seed")]:
        if field in request:
            result[native] = request[field]
    for context, native in [(request.get("context_before"), "previous"), (request.get("context_after"), "next")]:
        if context is not None:
            context_text = context.get("text")
            if context_text is not None:
                result[native + "_text"] = context_text
            else:
                result[native + "_request_ids"] = context.get("request_ids")
    return result


async def _response_text(body: AudioStream, limit: int, errors: Literal["strict", "replace"]) -> str:
    data = bytearray()
    async for chunk in body:
        if len(chunk) > limit - len(data):
            raise TypeError("ElevenLabs response exceeds max_json_bytes")
        data.extend(chunk)
    return data.decode("utf-8-sig", errors=errors)


async def _http_items(body: AudioStream, timed: bool, wav: bool, normalized: bool, limit: int) -> AsyncGenerator[SynthesisItem]:
    if not timed:
        received = False
        async for chunk in body:
            received = True
            yield chunk
            await asyncio.sleep(0)
        if not received:
            raise TypeError("ElevenLabs returned no audio bytes")
    elif wav:
        yield _timestamped(_load(await _response_text(body, limit, "strict")), normalized)
    else:
        pending = bytearray()
        received = False
        first_record = True
        async for chunk in body:
            position = 0
            while position < len(chunk):
                end = chunk.find(b"\n", position)
                stop = len(chunk) if end < 0 else end
                if stop - position > limit - len(pending):
                    raise TypeError("ElevenLabs response exceeds max_json_bytes")
                pending.extend(chunk[position:stop])
                position = stop + 1
                if end >= 0:
                    line = pending.decode("utf-8-sig" if first_record else "utf-8")
                    first_record = False
                    pending.clear()
                    if line.strip():
                        received = True
                        yield _timestamped(_load(line), normalized)
                    await asyncio.sleep(0)
        if pending:
            line = pending.decode("utf-8-sig" if first_record else "utf-8")
            if line.strip():
                received = True
                yield _timestamped(_load(line), normalized)
        if not received:
            raise TypeError("ElevenLabs returned no timestamped audio chunks")


@dataclass(frozen=True, slots=True)
class _Packet:
    context_id: str | None
    audio: str | None
    alignment: object
    final: bool
    error: ElevenLabsError | None


def _decode(frame: str | bytes, dialogue: bool, normalized: bool, limit: int) -> _Packet:
    if not isinstance(frame, str):
        raise TypeError("ElevenLabs returned a non-text WebSocket frame")
    if len(frame.encode("utf-8")) > limit:
        raise TypeError("ElevenLabs message exceeds max_message_bytes")
    value = _load(frame)
    if not is_mapping(value):
        raise TypeError("Invalid ElevenLabs WebSocket frame")
    if "context_id" in value and "contextId" in value and value["context_id"] != value["contextId"]:
        raise TypeError("Conflicting ElevenLabs context identifiers")
    context = value.get("context_id", value.get("contextId"))
    if context is not None and not isinstance(context, str):
        raise TypeError("Invalid ElevenLabs context identifier")
    if "error" in value or "detail" in value:
        code = value.get("code")
        return _Packet(context, None, None, False, ElevenLabsError(value, code if is_number(code) else 0))
    if "is_final" in value and "isFinal" in value and value["is_final"] != value["isFinal"]:
        raise TypeError("Conflicting ElevenLabs final flags")
    final = value.get("is_final", value.get("isFinal", False))
    if type(final) is not bool:
        raise TypeError("Invalid ElevenLabs final flag")
    audio = value.get("audio")
    if audio is not None and not isinstance(audio, str):
        raise TypeError("Invalid ElevenLabs audio payload")
    turn_final = value.get("is_final_audio_for_turn", False) if dialogue else False
    if type(turn_final) is not bool:
        raise TypeError("Invalid ElevenLabs turn-final flag")
    if audio is None and not final and not turn_final:
        raise TypeError("Unknown ElevenLabs WebSocket message")
    if not dialogue and context is None:
        raise TypeError("ElevenLabs multi-context output lacks its context identifier")
    alignment = value.get(("normalized_alignment" if dialogue else "normalizedAlignment") if normalized else "alignment")
    return _Packet(context, audio, alignment, final, None)


@dataclass(frozen=True, slots=True)
class _Configuration:
    voice: str
    dialogue: bool
    normalized: bool
    timed: bool
    settings: dict[str, object]


async def _live(config: _Configuration, text: AsyncIterable[Input], socket: WebSocketLike, validate: InputValidator, limit: int) -> AsyncGenerator[SynthesisItem]:
    dialogue, normalized, timed = config.dialogue, config.normalized, config.timed
    context = str(uuid.uuid4())
    retired: set[str] = set()
    used, input_done, initialized = False, False, False
    source: AsyncIterator[Input] | None = None
    pending_input: asyncio.Future[Input] | None = None
    pending_output: asyncio.Future[str | bytes] | None = None
    pending_send: asyncio.Future[None] | None = None
    heartbeat: asyncio.Future[None] | None = None
    writing = asyncio.Lock()

    async def send_one(message: dict[str, object]) -> None:
        encoded = json.dumps(message, separators=(",", ":"), allow_nan=False)
        if len(encoded.encode("utf-8")) > limit:
            raise TypeError("ElevenLabs message exceeds max_message_bytes")
        await socket.send(encoded)

    async def send(messages: list[dict[str, object]], ready_context: str | None = None) -> None:
        nonlocal initialized
        async with writing:
            for message in messages:
                await send_one(message)
            if ready_context == context:
                initialized = True

    def initialize() -> dict[str, object]:
        if dialogue:
            return {"voices": [config.voice], **config.settings}
        return {"text": " ", "context_id": context, **config.settings}

    async def restart(previous: asyncio.Future[None] | None, identifier: str, message: dict[str, object]) -> None:
        if previous is not None:
            await previous
        await send([message], identifier)

    async def keep_alive() -> None:
        try:
            while True:
                await asyncio.sleep(10)
                async with writing:
                    if input_done:
                        return
                    if initialized:
                        await send_one({"keep_alive": True} if dialogue else {"context_id": context, "text": ""})
        except asyncio.CancelledError:
            raise
        except BaseException:
            # Even between consumer pulls, a failed keepalive releases the network.
            try:
                await socket.aclose()
            except Exception:
                pass
            raise

    try:
        source = aiter(text)
        pending_send = asyncio.ensure_future(send([initialize()], context))
        pending_output = asyncio.ensure_future(socket.receive())
        heartbeat = asyncio.ensure_future(keep_alive())
        prefer_output = True
        while True:
            if pending_send is None and pending_input is None and not input_done:
                pending_input = asyncio.ensure_future(anext(source))
            tasks = [task for task in (pending_output, pending_send, pending_input if pending_send is None else None, heartbeat) if task is not None]
            completed, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            if heartbeat in completed:
                heartbeat.result()
                heartbeat = None
            lanes = [("output", pending_output), ("send", pending_send), ("input", pending_input)] if prefer_output else [("send", pending_send), ("input", pending_input), ("output", pending_output)]
            ready = next(((kind, task) for kind, task in lanes if task is not None and task in completed and (kind != "input" or pending_send is None)), None)
            if ready is None:
                continue
            kind, task = ready
            prefer_output = kind != "output"
            if kind == "send":
                task.result()
                pending_send = None
            elif kind == "input":
                assert pending_input is not None
                completed_input, pending_input = pending_input, None
                try:
                    item = completed_input.result()
                except StopAsyncIteration:
                    input_done = True
                    if not used:
                        return
                    messages: list[dict[str, object]] = []
                    if not dialogue:
                        messages.append({"context_id": context, "text": " ", "flush": True})
                    messages.append({"close_socket": True})
                    pending_send = asyncio.ensure_future(send(messages))
                else:
                    validate(item)
                    if isinstance(item, str):
                        if item:
                            used = True
                            pending_send = asyncio.ensure_future(send([{"inputs": [{"text": item, "voice_id": config.voice}]} if dialogue else {"context_id": context, "text": item}]))
                    elif item["command"] == "flush":
                        if used:
                            pending_send = asyncio.ensure_future(send([{"flush": True} if dialogue else {"context_id": context, "text": " ", "flush": True}]))
                    else:
                        old = context
                        retired.add(old)
                        context = str(uuid.uuid4())
                        used, initialized = False, False
                        pending_send = asyncio.ensure_future(send([{"context_id": old, "close_context": True}, initialize()], context))
                        yield {"event": "clear"}
            else:
                assert pending_output is not None
                try:
                    frame = pending_output.result()
                except StopAsyncIteration:
                    raise TypeError("ElevenLabs WebSocket closed before final output") from None
                packet = _decode(frame, dialogue, normalized, limit)
                pending_output = asyncio.ensure_future(socket.receive())
                if packet.context_id in retired:
                    continue
                if packet.error is not None:
                    raise packet.error
                if not dialogue and packet.context_id != context:
                    raise TypeError("ElevenLabs returned an unexpected context identifier")
                if packet.final:
                    if input_done or dialogue:
                        if heartbeat is not None:
                            heartbeat.cancel()
                        await socket.aclose()
                    else:
                        retired.add(context)
                        context = str(uuid.uuid4())
                        used, initialized = False, False
                        # Start retirement/reinitialization before yielding final
                        # audio; consumer backpressure must not keep the old ID live.
                        pending_send = asyncio.ensure_future(restart(pending_send, context, initialize()))
                if packet.audio is not None:
                    audio = _audio(packet.audio)
                    if timed:
                        yield {"correlation": "chunk", "audio": audio, "timestamps": _timestamps(packet.alignment, "dialogue" if dialogue else "tts")}
                    else:
                        yield audio
                if packet.final:
                    if input_done:
                        return
                    if dialogue:
                        raise TypeError("ElevenLabs dialogue ended before input completed")
    finally:
        original = sys.exception()
        cleanup_error: BaseException | None = None
        if heartbeat is not None and heartbeat.done() and not heartbeat.cancelled():
            cleanup_error = heartbeat.exception()
        try:
            await socket.aclose()
        except BaseException as error:
            cleanup_error = error
        tasks = [task for task in (pending_input, pending_output, pending_send, heartbeat) if task is not None]
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
                     web_socket: WebSocketLike | None = None, base_url: str = "https://api.elevenlabs.io",
                     web_socket_url: str | None = None, request_logging: bool = True, timeout_ms: int | None = None,
                     max_json_bytes: int = 16 * 1024 * 1024, max_message_bytes: int = 4 * 1024 * 1024) -> AsyncIterator[AsyncIterator[SynthesisItem]]:
    """Use async with for deterministic ownership, including early/idle exits.

    HTTP is injected; native sockets use header auth or single-use tokens. Socket
    overrides accept payload auth. Transports and producers must honor cancellation.
    """
    validate = validate_request(request)
    if timeout_ms is not None and (type(timeout_ms) is not int or not 0 <= timeout_ms <= 2147483647):
        raise TypeError("ElevenLabs timeout_ms must be an integer between 0 and 2147483647")
    if timeout_ms == 0:
        raise TimeoutError("ElevenLabs synthesis deadline expired")
    if type(request_logging) is not bool:
        raise TypeError("ElevenLabs request_logging must be a boolean")
    for name, limit in [("max_json_bytes", max_json_bytes), ("max_message_bytes", max_message_bytes)]:
        if type(limit) is not int or limit <= 0:
            raise TypeError(f"ElevenLabs {name} must be a positive integer")
    entry = auth.get("elevenlabs") if auth is not None else None
    key = entry["api_key"] if entry is not None and "api_key" in entry else os.environ.get("SPEECHSWITCH_ELEVENLABS_API_KEY", os.environ.get("ELEVENLABS_API_KEY"))
    token = entry.get("single_use_token") if entry is not None else None
    text = request["text"]
    if isinstance(text, str):
        if not key:
            raise TypeError("Missing auth.elevenlabs.apiKey configuration")
    elif not (token if token is not None else key):
        raise TypeError("Missing auth.elevenlabs.apiKey or singleUseToken configuration")
    target = _url(request, base_url, web_socket_url, token, request_logging)
    settings: dict[str, object] = {"voice_settings": _settings(request), **_dictionaries(request)}
    if web_socket is not None and token is None and key is not None:
        settings["xi_api_key"] = key
    if request["model"] != "eleven-v3" and request.get("text_buffering") is not False:
        settings["generation_config"] = {"chunk_length_schedule": list(request.get("text_buffer_thresholds", [120, 160, 250, 290]))}
    config = _Configuration(request["voice"], request["model"] == "eleven-v3", request.get("timestamp_text") == "normalized", "timestamp_granularity" in request, settings)
    deadline = asyncio.timeout(None if timeout_ms is None else timeout_ms / 1000)
    try:
        async with deadline:
            if isinstance(text, str):
                if transport is None:
                    raise TypeError("ElevenLabs HTTP transport is required")
                assert key is not None
                response = await transport.send(HttpRequest("POST", target, {"xi-api-key": key, "content-type": "application/json"}, json.dumps(_http_input(request, text), separators=(",", ":"), allow_nan=False).encode("utf-8")))
                async with _closing(AudioStream(response.body)) as body:
                    if not 200 <= response.status < 300:
                        raw = await _response_text(body, max_json_bytes, "replace")
                        try:
                            payload = _load(raw)
                        except TypeError:
                            payload = raw
                        request_id = next((v for k, v in response.headers.items() if k.lower() == "request-id"), None)
                        raise ElevenLabsError(payload, response.status, request_id)
                    async with _closing(_http_items(body, "timestamp_granularity" in request, request["output"]["format"] == "wav", request.get("timestamp_text") == "normalized", max_json_bytes)) as items:
                        yield items
            elif web_socket is not None:
                async with _closing(web_socket):
                    async with _closing(_live(config, text, web_socket, validate, max_message_bytes)) as items:
                        yield items
            else:
                headers = {"xi-api-key": key} if token is None and key is not None else {}
                async with connect_websocket(target, headers=headers, max_message_bytes=max_message_bytes) as socket:
                    async with _closing(_live(config, text, socket, validate, max_message_bytes)) as items:
                        yield items
    except TimeoutError:
        if deadline.expired():
            raise TimeoutError("ElevenLabs synthesis deadline expired") from None
        raise
