"""KugelAudio's handwritten native HTTP and turn-based WebSocket protocols."""

import asyncio
import base64
import json
import os
import re
import sys
from collections.abc import AsyncGenerator, AsyncIterable, AsyncIterator, Awaitable, Callable, Mapping, Sequence
from contextlib import asynccontextmanager
from typing import Literal, Protocol, runtime_checkable
from urllib.parse import urlsplit, urlunsplit

from speechswitch.generated.auth import Auth
from speechswitch.generated.kugelaudio import TtsRequest, TtsRequestStreamingTextVoiceTextItem as Input
from speechswitch.generated.kugelaudio_output import KugelAudioEnvelope, KugelAudioTimestamp, KugelAudioUsage, SynthesisItem, SynthesisItemUpdated
from speechswitch.generated.validators.kugelaudio import REQUEST_DEFAULTS, validate_request
from speechswitch.http import AudioStream, HttpRequest, HttpTransport
from speechswitch.validation import InputValidator, is_mapping, is_number, is_sequence, utf16_units
from speechswitch.websocket import WebSocketLike, connect_websocket


class KugelAudioError(Exception):
    def __init__(self, message: str, status_code: int | None, code: str | None, retry_after: str | None = None) -> None:
        self.status_code, self.code, self.retry_after = status_code, code, retry_after
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
    def invalid(_: str) -> None:
        raise ValueError()
    try:
        return json.loads(data, parse_constant=invalid)
    except (ValueError, RecursionError):
        raise TypeError("KugelAudio returned invalid JSON") from None


def _object(value: object) -> Mapping[object, object]:
    if not is_mapping(value):
        raise TypeError("KugelAudio returned an invalid object")
    return value


def _number(value: object, field: str, integer: bool = False) -> float:
    if not is_number(value) or value < 0 or (integer and (int(value) != value or value > 9007199254740991)):
        raise TypeError(f"KugelAudio returned invalid {field}")
    return value


def _usage(raw: object) -> KugelAudioUsage:
    value = _object(raw)
    if "currency" in value and value["currency"] != "eur":
        raise TypeError("KugelAudio returned an invalid usage currency")
    if "model_id" in value and not isinstance(value["model_id"], str):
        raise TypeError("KugelAudio returned an invalid usage model")
    cost = value.get("cost_cents")
    if cost is None and ("cost_cents" not in value or value.get("cost_unavailable") is not True):
        raise TypeError("KugelAudio omitted its cost-unavailable indicator")
    result: KugelAudioUsage = {"audio_seconds": _number(value.get("audio_seconds"), "usage audio_seconds"),
                              "characters": _number(value.get("characters"), "usage characters", True),
                              "cost_cents": None if cost is None else _number(cost, "usage cost_cents")}
    if "currency" in value:
        result = {**result, "currency": "eur"}
    model = value.get("model_id")
    if isinstance(model, str):
        result = {**result, "model": model}
    return result


def _updated(raw: object) -> SynthesisItemUpdated:
    value = _object(raw)
    result: SynthesisItemUpdated = {"event": "updated"}
    if "cfg_scale" in value:
        result = {**result, "voice_guidance": _number(value["cfg_scale"], "settings cfg_scale")}
    if "temperature" in value:
        result = {**result, "temperature": _number(value["temperature"], "settings temperature")}
    if "max_new_tokens" in value:
        result = {**result, "max_audio_tokens": _number(value["max_new_tokens"], "settings max_new_tokens", True)}
    if "speed" in value:
        result = {**result, "speed": _number(value["speed"], "settings speed")}
    if "language" in value:
        language = value["language"]
        if not isinstance(language, str):
            raise TypeError("KugelAudio returned invalid settings language")
        result = {**result, "language": language}
    if "normalize" in value:
        normalize = value["normalize"]
        if not isinstance(normalize, bool):
            raise TypeError("KugelAudio returned invalid settings normalize")
        result = {**result, "text_normalization": normalize}
    return result


def _alignment(raw: object) -> list[KugelAudioTimestamp]:
    if not is_sequence(raw):
        raise TypeError("KugelAudio returned invalid word timestamps")
    result: list[KugelAudioTimestamp] = []
    for item in raw:
        word = _object(item)
        text = word.get("word")
        if not isinstance(text, str):
            raise TypeError("KugelAudio returned an invalid word")
        start, end = _number(word.get("start_ms"), "start_ms"), _number(word.get("end_ms"), "end_ms")
        first, last = _number(word.get("char_start"), "char_start", True), _number(word.get("char_end"), "char_end", True)
        if end < start or last < first:
            raise TypeError("KugelAudio returned reversed alignment bounds")
        mark: KugelAudioTimestamp = {"kind": "word", "value": text, "start_time_ms": start, "end_time_ms": end, "source": {"start": first, "end": last}}
        if "score" in word:
            mark = {**mark, "confidence": _number(word["score"], "score")}
        result.append(mark)
    return result


_cleanup_tasks: set[asyncio.Task[None]] = set()


def _observe_cleanup(task: asyncio.Task[None]) -> None:
    _cleanup_tasks.discard(task)
    if not task.cancelled():
        task.exception()


async def _cleanup(tasks: Sequence[Awaitable[object]], source: AsyncIterator[Input] | None) -> None:
    await asyncio.gather(*tasks, return_exceptions=True)
    if isinstance(source, _Closable):
        await source.aclose()


class _End:
    pass


type _State = Literal["idle", "active", "flushing", "clearing"]


class _Input:
    def __init__(self, source: AsyncIterator[Input], validate: InputValidator) -> None:
        self.source, self.validate = source, validate
        self.held: Input | _End | None = None

    async def pull(self) -> Input | _End:
        try:
            item = await anext(self.source)
        except StopAsyncIteration:
            return _End()
        self.validate(item)
        return item

    def take(self, state: _State) -> tuple[dict[str, object] | None, _State, bool, int]:
        value, self.held = self.held, None
        if isinstance(value, _End):
            return ({"flush": True}, "flushing", True, 0) if state == "active" else (None, state, True, 0)
        if isinstance(value, str):
            # Collection-element length annotations are not expressible in specgen yet.
            if len(utf16_units(value)) > 10000:
                raise TypeError("KugelAudio text fragments must not exceed 10000 characters")
            return ({"text": value}, "active", False, 0) if value else (None, state, False, 0)
        assert value is not None
        if value["command"] == "clear":
            return {"cancel": True}, "clearing", False, 0
        if value["command"] == "flush":
            return ({"flush": True}, "flushing", False, 0) if state == "active" else (None, state, False, 0)
        settings: dict[str, object] = {}
        if "voice_guidance" in value:
            settings["cfg_scale"] = value["voice_guidance"]
        if "temperature" in value:
            settings["temperature"] = value["temperature"]
        if "max_audio_tokens" in value:
            settings["max_new_tokens"] = value["max_audio_tokens"]
        if "language" in value:
            settings["language"] = value["language"]
        if "text_normalization" in value:
            settings["normalize"] = value["text_normalization"]
        if "speed" in value:
            settings["speed"] = value["speed"]
        return {"update_settings": settings}, state, False, 1


async def _stream(text: str | AsyncIterable[Input], config: dict[str, object], socket: WebSocketLike,
                  timed: bool, encoding: str, rate: float, limit: int, warning: Callable[[str], None],
                  validate: InputValidator) -> AsyncGenerator[SynthesisItem]:
    live = not isinstance(text, str)
    source: AsyncIterator[Input] | None = None
    producer: asyncio.Task[Input | _End] | None = None
    receiver: asyncio.Task[str | bytes] | None = None
    writer: asyncio.Task[None] | None = None
    input_done = not live
    state: _State = "idle" if live else "active"
    final_seen = False
    updates, turn = 0, 0
    samples: dict[int, int] = {}

    async def send(value: dict[str, object]) -> None:
        data = json.dumps(value, separators=(",", ":"), allow_nan=False)
        if len(data.encode()) > limit:
            raise TypeError("KugelAudio message exceeds max_message_bytes")
        await socket.send(data)

    try:
        await send(config)
        input = _Input(aiter(text), validate) if not isinstance(text, str) else None
        if input is not None:
            source = input.source
            producer = asyncio.create_task(input.pull())
        receiver = asyncio.create_task(socket.receive())
        while True:
            if writer is None:
                if live and input_done and state == "idle" and updates == 0:
                    await send({"close_socket": True})
                    return
                held = input.held if input is not None else None
                ready = isinstance(held, _End) or state in ("idle", "active") or (state != "clearing" and held is not None and not isinstance(held, (str, _End)) and held["command"] != "flush")
                if input is not None and held is not None and ready:
                    message, state, input_done, update = input.take(state)
                    updates += update
                    if message is not None:
                        writer = asyncio.create_task(send(message))
                    elif not input_done:
                        producer = asyncio.create_task(input.pull())
                    else:
                        continue
            tasks = [task for task in (receiver, producer, writer) if task is not None]
            completed, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            # Service all ready lanes: neither a hot producer nor a blocked send
            # can starve incoming audio. Keep only one lookahead input item.
            if writer is not None and writer in completed:
                writer.result()
                writer = None
                if not input_done and input is not None:
                    producer = asyncio.create_task(input.pull())
            if producer is not None and producer in completed:
                completed_input = producer
                producer = None
                assert input is not None
                input.held = completed_input.result()
            if receiver not in completed:
                continue
            try:
                frame = receiver.result()
            except StopAsyncIteration:
                raise TypeError("KugelAudio WebSocket closed before synthesis completed") from None
            if not isinstance(frame, str):
                raise TypeError("KugelAudio returned a non-text WebSocket frame")
            if len(frame.encode()) > limit:
                raise TypeError("KugelAudio message exceeds max_message_bytes")
            packet = _object(_json(frame))
            kinds = [key for key in ("error", "audio", "word_timestamps", "generation_started", "chunk_complete", "interrupted", "settings_updated", "warning", "final", "session_closed") if key in packet]
            if len(kinds) != 1:
                raise TypeError("KugelAudio returned an invalid event")
            kind = kinds[0]
            if kind in ("generation_started", "chunk_complete", "interrupted", "settings_updated", "final", "session_closed") and packet[kind] is not True:
                raise TypeError("KugelAudio returned an invalid event flag")
            if kind == "error":
                error, code = packet["error"], packet.get("error_code")
                if not isinstance(error, str) or not isinstance(code, str):
                    raise TypeError("KugelAudio returned an invalid error")
                raise KugelAudioError(error, int(_number(packet.get("code"), "error code", True)), code)
            if kind == "warning":
                advisory = packet["warning"]
                if not isinstance(advisory, str):
                    raise TypeError("KugelAudio returned an invalid warning")
                warning(advisory)
            elif kind == "settings_updated":
                if updates == 0:
                    raise TypeError("KugelAudio returned an unsolicited settings acknowledgement")
                updates -= 1
                yield _updated(packet.get("settings"))
            elif kind == "interrupted":
                if state != "clearing":
                    raise TypeError("KugelAudio returned an unsolicited interruption")
                state, final_seen = "idle", False
                samples.clear()
                turn += 1
                yield {"event": "clear"}
            elif state != "clearing":
                if kind == "final":
                    if state == "idle" or final_seen:
                        raise TypeError("KugelAudio returned an unexpected final")
                    if not live:
                        yield {"event": "done", "usage": _usage(packet["usage"])} if "usage" in packet else {"event": "done"}
                        return
                    final_seen, state = True, "flushing"
                elif kind == "session_closed":
                    if not live or not final_seen:
                        raise TypeError("KugelAudio ended a turn before final")
                    yield {"event": "flush", "correlation_id": str(turn), "input_group_id": str(turn), "usage": _usage(packet["usage"])} if "usage" in packet else {"event": "flush", "correlation_id": str(turn), "input_group_id": str(turn)}
                    state, final_seen = "idle", False
                    samples.clear()
                    turn += 1
                else:
                    if state == "idle" or final_seen:
                        raise TypeError("KugelAudio returned output outside an active turn")
                    chunk_id = int(_number(packet.get("chunk_id"), "chunk_id", True))
                    group: KugelAudioEnvelope = {"correlation": "ordered", "correlation_id": f"{turn}:{chunk_id}", "input_group_id": str(turn), "chunk_id": chunk_id, "timestamps": []}
                    if kind == "audio":
                        raw = packet["audio"]
                        if not isinstance(raw, str) or packet.get("enc") != encoding or not is_number(packet.get("sr")) or packet["sr"] != rate:
                            raise TypeError("KugelAudio returned an unexpected audio format")
                        _number(packet.get("idx"), "idx", True)
                        count = int(_number(packet.get("samples"), "samples", True))
                        try:
                            audio = base64.b64decode(raw, validate=True)
                        except (ValueError, UnicodeError):
                            raise TypeError("KugelAudio returned invalid base64 audio") from None
                        if len(audio) != count * (2 if encoding == "pcm_s16le" else 1):
                            raise TypeError("KugelAudio audio size disagrees with its sample count")
                        start = samples.get(chunk_id, 0)
                        end = start + count
                        if end > 9007199254740991:
                            raise TypeError("KugelAudio audio sample count overflow")
                        samples[chunk_id] = end
                        yield {**group, "audio": audio, "audio_timing": {"start_time_ms": start / rate * 1000, "end_time_ms": end / rate * 1000}} if timed else audio
                    elif kind == "word_timestamps":
                        marks = _alignment(packet["word_timestamps"])
                        if not timed:
                            raise TypeError("KugelAudio returned unrequested timestamps")
                        yield {**group, "timestamps": marks}
                    elif kind == "generation_started":
                        if not isinstance(packet.get("text"), str):
                            raise TypeError("KugelAudio returned invalid generated text")
                    else:
                        _number(packet.get("audio_seconds"), "audio_seconds")
                        _number(packet.get("gen_ms"), "gen_ms")
            receiver = asyncio.create_task(socket.receive())
    finally:
        pending = [task for task in (producer, receiver, writer) if task is not None]
        for task in pending:
            task.cancel()
        cleanup = asyncio.create_task(_cleanup(pending, source))
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
                     web_socket: WebSocketLike | None = None, base_url: str | None = None, web_socket_url: str | None = None,
                     region: Literal["eu", "global"] | None = None, timeout_ms: int | None = None,
                     on_warning: Callable[[str], None] | None = None, max_json_bytes: int = 16 * 1024 * 1024,
                     max_message_bytes: int = 4 * 1024 * 1024) -> AsyncIterator[AsyncIterator[SynthesisItem]]:
    """Own one stream with async with. HTTP needs an injected async transport;
    WebSockets default to the local native transport with Bearer header auth.
    """
    validate = validate_request(request)
    for value, name in [(max_json_bytes, "max_json_bytes"), (max_message_bytes, "max_message_bytes")]:
        if type(value) is not int or not 1 <= value <= 4294967295:
            raise TypeError(f"KugelAudio {name} must be a positive uint32 value")
    if timeout_ms is not None and (type(timeout_ms) is not int or not 0 <= timeout_ms <= 2147483647):
        raise TypeError("KugelAudio timeout_ms must be an integer between 0 and 2147483647")
    if region not in (None, "eu", "global"):
        raise TypeError("Invalid KugelAudio region")
    voice = request["voice"]
    if (isinstance(voice, str) and not voice.strip(" \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")) or (is_number(voice) and (int(voice) != voice or abs(voice) > 9007199254740991)):
        raise TypeError("KugelAudio voice must be a nonempty handle or an integer ID")
    dictionaries = request.get("pronunciation_dictionary_selection")
    entry = auth.get("kugelaudio") if auth is not None else None
    key = entry["api_key"] if entry is not None and "api_key" in entry else os.environ.get("SPEECHSWITCH_KUGELAUDIO_API_KEY", os.environ.get("KUGELAUDIO_API_KEY", ""))
    eu = key.startswith("eu-")
    key = key[3:] if eu else key
    if not key and web_socket is None:
        raise TypeError("Missing auth.kugelaudio.apiKey configuration")
    if not all(32 <= ord(c) <= 126 for c in key):
        raise TypeError("Invalid KugelAudio authentication header")
    text, output = request["text"], request["output"]
    live, timed = not isinstance(text, str), "timestamp_granularity" in request
    socket_mode = live or timed or "voice_boost" in request or web_socket is not None or web_socket_url is not None
    base = base_url if base_url is not None else ("https://api.eu.kugelaudio.com" if (region or ("eu" if eu else "global")) == "eu" else "https://api.kugelaudio.com")
    raw_url = web_socket_url if socket_mode and web_socket_url is not None else base
    try:
        url = urlsplit(raw_url)
        if url.scheme not in (("http", "https", "ws", "wss") if socket_mode else ("http", "https")) or not url.hostname or url.username is not None or url.password is not None or url.fragment or any(c.isspace() or ord(c) < 32 or ord(c) == 127 or c == "\\" for c in raw_url) or re.search(r"%(?![0-9a-fA-F]{2})", raw_url):
            raise ValueError()
        _ = url.port
    except (ValueError, UnicodeError):
        raise TypeError("Invalid KugelAudio endpoint URL") from None
    path = url.path if socket_mode and web_socket_url is not None else url.path.rstrip("/") + ("/ws/tts/stream" if live else "/ws/tts" if socket_mode else "/v1/tts/generate")
    scheme = {"http": "ws", "https": "wss"}.get(url.scheme, url.scheme) if socket_mode else url.scheme
    target = urlunsplit((scheme, url.netloc, path, url.query, ""))
    format = output["format"]
    rate = output.get("sample_rate_hz", 24000 if format == "pcm" else 8000)
    encoding = "pcm_s16le" if format == "pcm" else format
    settings: dict[str, object] = {"voice_id": voice, "model_id": request.get("model", REQUEST_DEFAULTS["model"]),
                                  "cfg_scale": request.get("voice_guidance", REQUEST_DEFAULTS["voice_guidance"]),
                                  "max_new_tokens": request.get("max_audio_tokens", REQUEST_DEFAULTS["max_audio_tokens"]),
                                  "sample_rate": rate, "normalize": request.get("text_normalization", REQUEST_DEFAULTS["text_normalization"]),
                                  "speed": request.get("speed", REQUEST_DEFAULTS["speed"])}
    if "temperature" in request:
        settings["temperature"] = request["temperature"]
    elif not live:
        settings["temperature"] = 0.4
    if format != "pcm":
        settings["output_format"] = "ulaw_8000" if format == "mulaw" else "alaw_8000"
    if "language" in request:
        settings["language"] = request["language"]
    if dictionaries is not None:
        settings["project_id"] = dictionaries["scope"]
        if "ids" in dictionaries:
            settings["dictionary_ids"] = list(dictionaries["ids"])
    if socket_mode:
        settings.update({"word_timestamps": timed, "speaker_prefix": request.get("voice_boost", True)})
    if live:
        settings.update({"flush_timeout_ms": request.get("text_flush_delay_ms", 500), "max_buffer_length": request.get("text_buffer_threshold", 10000)})
    else:
        settings["text"] = text
    if timeout_ms == 0:
        raise TimeoutError("KugelAudio synthesis deadline expired")
    def warning(message: str) -> None:
        if on_warning is not None:
            on_warning(message)
    deadline = asyncio.timeout(None if timeout_ms is None else timeout_ms / 1000)
    try:
        async with deadline:
            if socket_mode:
                if web_socket is not None:
                    async with _closing(web_socket):
                        async with _closing(_stream(text, settings, web_socket, timed, encoding, rate, max_message_bytes, warning, validate)) as stream:
                            yield stream
                else:
                    async with connect_websocket(target, headers={"Authorization": f"Bearer {key}"}, max_message_bytes=max_message_bytes) as socket:
                        async with _closing(_stream(text, settings, socket, timed, encoding, rate, max_message_bytes, warning, validate)) as stream:
                            yield stream
            else:
                if transport is None:
                    raise TypeError("KugelAudio HTTP transport is required")
                response = await transport.send(HttpRequest("POST", target, {"Authorization": f"Bearer {key}", "content-type": "application/json"},
                                                            json.dumps(settings, separators=(",", ":"), allow_nan=False).encode()))
                async with _closing(AudioStream(response.body)) as audio:
                    headers = {name.lower(): value for name, value in response.headers.items()}
                    if not 200 <= response.status < 300:
                        data = bytearray()
                        async for chunk in audio:
                            if len(chunk) > max_json_bytes - len(data):
                                raise TypeError("KugelAudio response exceeds max_json_bytes")
                            data.extend(chunk)
                            await asyncio.sleep(0)
                        message = data.decode("utf-8-sig", errors="replace")
                        try:
                            detail = _json(message)
                        except TypeError:
                            detail = None
                        fields: Mapping[object, object] = detail if is_mapping(detail) else {}
                        description, code = fields.get("error"), fields.get("error_code")
                        raise KugelAudioError(description if isinstance(description, str) else message, response.status, code if isinstance(code, str) else None, headers.get("retry-after"))
                    if "x-sample-rate" in headers:
                        try:
                            received_rate = float(headers["x-sample-rate"])
                        except ValueError:
                            received_rate = -1
                        if received_rate != rate:
                            raise TypeError("KugelAudio returned an unexpected audio format")
                    if "x-audio-format" in headers and headers["x-audio-format"] != encoding:
                        raise TypeError("KugelAudio returned an unexpected audio format")
                    yield audio
    except TimeoutError:
        if deadline.expired():
            raise TimeoutError("KugelAudio synthesis deadline expired") from None
        raise
