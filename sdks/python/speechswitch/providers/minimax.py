"""MiniMax's handwritten HTTP SSE/JSON and bidirectional WebSocket protocols."""

import asyncio
import json
import os
import re
import uuid
from collections.abc import AsyncGenerator, AsyncIterable, AsyncIterator, Awaitable, Mapping, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Literal, Protocol, runtime_checkable
from urllib.parse import urlsplit, urlunsplit

from speechswitch.generated.auth import Auth
from speechswitch.generated.minimax import TtsRequest, TtsRequestStreamingText12421ea0TextItem as TtsInput
from speechswitch.generated.minimax_output import MiniMaxDoneEvent, MiniMaxEnvelope, MiniMaxTimestamp, SynthesisItem, Usage
from speechswitch.generated.validators.minimax import validate_request
from speechswitch.http import AudioStream, HttpRequest, HttpTransport
from speechswitch.sse import SseDecoder
from speechswitch.validation import InputValidator, is_mapping, is_number, is_sequence, utf16_units
from speechswitch.websocket import WebSocketLike, connect_websocket


class MiniMaxError(Exception):
    def __init__(self, message: str, code: int | None = None, status_code: int | None = None, retry_after: str | None = None) -> None:
        self.code, self.status_code, self.retry_after = code, status_code, retry_after
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


class _InvalidJson(TypeError):
    pass


def _json(text: str) -> object:
    def invalid(_: str) -> None:
        raise ValueError()
    try:
        return json.loads(text, parse_constant=invalid)
    except (ValueError, RecursionError):
        raise _InvalidJson("MiniMax returned invalid JSON") from None


def _object(value: object) -> Mapping[object, object]:
    if not is_mapping(value):
        raise TypeError("MiniMax returned an invalid response object")
    return value


def _string(value: object, field: str) -> str:
    if not isinstance(value, str):
        raise TypeError(f"MiniMax returned invalid {field}")
    return value


def _integer(value: object, field: str) -> int:
    if not is_number(value) or int(value) != value or not 0 <= value <= 9007199254740991:
        raise TypeError(f"MiniMax returned invalid {field}")
    return int(value)


def _usage(raw: object) -> Usage:
    extra = _object(raw)
    usage: Usage = {}
    if "audio_length" in extra: usage = {**usage, "duration_ms": _integer(extra["audio_length"], "audio_length")}
    if "audio_sample_rate" in extra: usage = {**usage, "sample_rate_hz": _integer(extra["audio_sample_rate"], "audio_sample_rate")}
    if "audio_size" in extra: usage = {**usage, "byte_length": _integer(extra["audio_size"], "audio_size")}
    if "bitrate" in extra: usage = {**usage, "bit_rate_bps": _integer(extra["bitrate"], "bitrate")}
    if "audio_channel" in extra: usage = {**usage, "channel_count": _integer(extra["audio_channel"], "audio_channel")}
    if "usage_characters" in extra: usage = {**usage, "billed_characters": _integer(extra["usage_characters"], "usage_characters")}
    if "word_count" in extra: usage = {**usage, "word_count": _integer(extra["word_count"], "word_count")}
    if "audio_format" in extra: usage = {**usage, "format": _string(extra["audio_format"], "audio_format")}
    if "invisible_character_ratio" in extra:
        ratio = extra["invisible_character_ratio"]
        if not is_number(ratio) or not 0 <= ratio <= 1: raise TypeError("MiniMax returned invalid invisible_character_ratio")
        usage = {**usage, "invalid_character_ratio": ratio}
    return usage


@dataclass(frozen=True)
class _Packet:
    code: int
    message: str
    event: str | None
    trace_id: str | None
    audio: bytes | None = None
    status: int | None = None
    subtitle_file: str | None = None
    final: bool | None = None
    session_id: str | None = None
    connection_id: str | None = None
    usage: Usage | None = None


def _packet(raw: object) -> _Packet:
    packet = _object(raw)
    base = _object(packet["base_resp"]) if "base_resp" in packet else None
    code = _integer(base.get("status_code"), "base_resp.status_code") if base is not None else 0
    message = _string(base["status_msg"], "base_resp.status_msg") if base is not None and "status_msg" in base else ""
    event = _string(packet["event"], "event") if "event" in packet else None
    trace = _string(packet["trace_id"], "trace_id") if "trace_id" in packet else None
    # Error packets can contain null or invalid success data. Preserve the native error.
    if code: return _Packet(code, message, event, trace)
    data: Mapping[object, object] = _object(packet["data"]) if packet.get("data") is not None else {}
    audio: bytes | None = None
    if "audio" in data:
        hex_audio = _string(data["audio"], "data.audio")
        if len(hex_audio) % 2 or re.fullmatch(r"[0-9a-fA-F]*", hex_audio) is None:
            raise TypeError("MiniMax returned invalid hex audio")
        audio = bytes.fromhex(hex_audio)
    status = _integer(data["status"], "data.status") if "status" in data else None
    if status is not None and status not in (1, 2): raise TypeError("MiniMax returned invalid data.status")
    final = packet.get("is_final")
    if "is_final" in packet and not isinstance(final, bool): raise TypeError("MiniMax returned invalid is_final")
    return _Packet(code, message, event, trace, audio, status,
                   _string(data["subtitle_file"], "data.subtitle_file") if "subtitle_file" in data else None,
                   final if isinstance(final, bool) else None,
                   _string(packet["session_id"], "session_id") if "session_id" in packet else None,
                   _string(packet["connect_id"], "connect_id") if "connect_id" in packet else None,
                   _usage(packet["extra_info"]) if packet.get("extra_info") is not None else None)


def _subtitles(raw: object, kind: Literal["word", "sentence"]) -> list[MiniMaxTimestamp]:
    if not is_sequence(raw): raise TypeError("MiniMax subtitles must be a JSON array")
    result: list[MiniMaxTimestamp] = []
    for row in raw:
        item = _object(row)
        start, end = item.get("time_begin"), item.get("time_end")
        if not is_number(start) or start < 0: raise TypeError("MiniMax returned invalid subtitle time_begin")
        if not is_number(end) or end < 0: raise TypeError("MiniMax returned invalid subtitle time_end")
        if end < start: raise TypeError("MiniMax returned reversed subtitle timestamps")
        result.append({"kind": kind, "value": _string(item.get("text"), "subtitle text"), "start_time_ms": start, "end_time_ms": end})
    return result


_languages = {
    "zh": "Chinese", "yue": "Chinese,Yue", "en": "English", "ar": "Arabic", "ru": "Russian", "es": "Spanish", "fr": "French",
    "pt": "Portuguese", "de": "German", "tr": "Turkish", "nl": "Dutch", "uk": "Ukrainian", "vi": "Vietnamese", "id": "Indonesian",
    "ja": "Japanese", "it": "Italian", "ko": "Korean", "th": "Thai", "pl": "Polish", "ro": "Romanian", "el": "Greek", "cs": "Czech",
    "fi": "Finnish", "hi": "Hindi", "bg": "Bulgarian", "da": "Danish", "he": "Hebrew", "ms": "Malay", "fa": "Persian", "sk": "Slovak",
    "sv": "Swedish", "hr": "Croatian", "fil": "Filipino", "hu": "Hungarian", "no": "Norwegian", "sl": "Slovenian", "ca": "Catalan",
    "nn": "Nynorsk", "ta": "Tamil", "af": "Afrikaans", "auto": "auto",
}


def _configuration(request: TtsRequest, socket: bool) -> tuple[dict[str, object], bool]:
    output = request.get("output")
    format = output["format"] if output is not None else "mp3"
    encoding = output.get("sample_encoding") if output is not None else None
    format = "opus" if format == "ogg_opus" else "pcmu_raw" if format == "mulaw" else "pcmu_wav" if format == "wav" and encoding == "mulaw" else format
    rate = output.get("sample_rate_hz", 8000 if format in ("pcmu_raw", "pcmu_wav") else 24000 if format == "opus" else 32000) if output is not None else 32000
    voice: dict[str, object] = {
        "voice_id": request.get("voice", ""), "speed": request.get("speed", 1), "vol": request.get("volume_scale", 1),
        "pitch": request.get("pitch_bias", 0), "latex_read": request.get("formula_reading") == "latex",
    }
    if "emotion" in request: voice["emotion"] = request["emotion"]
    voice["english_normalization" if socket else "text_normalization"] = request.get("language_text_normalization" if socket else "text_normalization", False)
    audio: dict[str, object] = {"format": format, "sample_rate": rate, "channel": output.get("channel_count", 1) if output is not None else 1}
    if format == "mp3":
        audio["bitrate"] = output.get("bit_rate_bps", 128000) if output is not None else 128000
        if not socket: audio["force_cbr"] = output.get("constant_bit_rate", False) if output is not None else False
    model = request.get("model", "speech-2.8-hd")
    config: dict[str, object] = {
        "model": model, "language_boost": _languages[request.get("language", "zh" if "formula_reading" in request else "auto")],
        "voice_setting": voice, "audio_setting": audio,
    }
    blend = request.get("voice_blend")
    if blend is not None: config["timbre_weights"] = [{"voice_id": v["voice"], "weight": v["weight"]} for v in blend]
    if "replacements" in request: config["pronunciation_dict"] = {"tone": [v["pattern"] + "/" + v["replacement"] for v in request["replacements"]]}
    transform = request.get("voice_transform")
    if transform is not None:
        effects: dict[str, object] = {}
        if "brightness" in transform: effects["pitch"] = transform["brightness"]
        if "softness" in transform: effects["intensity"] = transform["softness"]
        if "crispness" in transform: effects["timbre"] = transform["crispness"]
        if "effect" in transform: effects["sound_effects"] = "lofi_telephone" if transform["effect"] == "telephone" else transform["effect"]
        config["voice_modify"] = effects
    if socket and model in ("speech-2.8-hd", "speech-2.8-turbo"): config["continuous_sound"] = not request.get("split_turns", True)
    return config, format != "wav" and not ("voice_transform" in request and format == "flac")


def _url(base: str, path: str, socket: bool) -> str:
    try:
        url = urlsplit(base)
        if url.scheme not in (("ws", "wss") if socket else ("http", "https")) or not url.hostname or url.username is not None or url.password is not None or url.fragment or any(c.isspace() or ord(c) < 32 or ord(c) == 127 or c == "\\" for c in base) or re.search(r"%(?![0-9a-fA-F]{2})", base): raise ValueError()
        _ = url.port
        return urlunsplit((url.scheme, url.netloc, url.path.rstrip("/") + path if path else url.path, url.query, ""))
    except ValueError:
        raise TypeError("Invalid MiniMax endpoint URL") from None


async def _document(audio: AudioStream, limit: int) -> object:
    data = bytearray()
    async for chunk in audio:
        if len(chunk) > limit - len(data): raise TypeError("MiniMax response exceeds max_json_bytes")
        data.extend(chunk)
        await asyncio.sleep(0)
    try:
        return _json(data.decode("utf-8-sig"))
    except UnicodeDecodeError:
        raise _InvalidJson("MiniMax returned invalid JSON") from None


def _done(packet: _Packet) -> MiniMaxDoneEvent:
    done: MiniMaxDoneEvent = {"event": "done"}
    if packet.trace_id is not None: done = {**done, "trace_id": packet.trace_id}
    if packet.usage is not None: done = {**done, "usage": packet.usage}
    return done


async def _http_items(request: TtsRequest, transport: HttpTransport, wire: HttpRequest, limit: int) -> AsyncGenerator[SynthesisItem]:
    response = await transport.send(wire)
    headers = {key.lower(): value for key, value in response.headers.items()}
    timed = request.get("timestamp_granularity")
    final: _Packet | None = None
    received = False
    async with _closing(AudioStream(response.body)) as audio:
        content_type = headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if not 200 <= response.status < 300 or content_type != "text/event-stream":
            try:
                document = await _document(audio, limit)
            except _InvalidJson:
                if not 200 <= response.status < 300:
                    raise MiniMaxError(f"MiniMax HTTP {response.status}", status_code=response.status, retry_after=headers.get("retry-after")) from None
                raise
            final = _packet(document)
            if not 200 <= response.status < 300 or final.code:
                raise MiniMaxError(final.message or f"MiniMax HTTP {response.status}", final.code or None, response.status, headers.get("retry-after"))
            if final.status != 2: raise TypeError("MiniMax JSON synthesis did not report completion")
            if final.audio:
                received = True
                envelope: MiniMaxEnvelope = {"correlation": "timeline", "audio": final.audio, "timestamps": []}
                if final.trace_id is not None: envelope = {**envelope, "trace_id": final.trace_id}
                yield envelope if timed is not None else final.audio
        else:
            decoder = SseDecoder(limit)
            terminal = False
            try:
                async for chunk in audio:
                    for byte in chunk:
                        event = decoder.push(byte)
                        if event is None: continue
                        if event["data"] == "[DONE]":
                            terminal = True
                            break
                        packet = _packet(_json(event["data"]))
                        if packet.code: raise MiniMaxError(packet.message, packet.code, response.status, headers.get("retry-after"))
                        if packet.status not in (1, 2): raise TypeError("MiniMax SSE audio is missing data.status")
                        if packet.audio:
                            received = True
                            envelope = {"correlation": "timeline", "audio": packet.audio, "timestamps": []}
                            if packet.trace_id is not None: envelope = {**envelope, "trace_id": packet.trace_id}
                            yield envelope if timed is not None else packet.audio
                        if packet.status == 2:
                            final, terminal = packet, True
                            break
                    if terminal: break
                    await asyncio.sleep(0)
            finally:
                decoder.finish()
    if final is None: raise TypeError("MiniMax HTTP stream ended before completion")
    if not received: raise TypeError("MiniMax returned no audio")
    if timed is not None:
        if not final.subtitle_file: raise TypeError("MiniMax omitted requested subtitles")
        subtitle_url = _url(final.subtitle_file, "", False)
        subtitles = await transport.send(HttpRequest("GET", subtitle_url, {}, b""))
        async with _closing(AudioStream(subtitles.body)) as audio:
            if not 200 <= subtitles.status < 300: raise MiniMaxError("MiniMax subtitle download failed", status_code=subtitles.status)
            marks = _subtitles(await _document(audio, limit), timed)
        envelope = {"correlation": "timeline", "timestamps": marks}
        if final.trace_id is not None: envelope = {**envelope, "trace_id": final.trace_id}
        yield envelope
    yield _done(final)


_cleanup_tasks: set[asyncio.Task[None]] = set()


def _observe(task: asyncio.Task[None]) -> None:
    _cleanup_tasks.discard(task)
    if not task.cancelled(): task.exception()


async def _cleanup(tasks: Sequence[Awaitable[object]], source: AsyncIterator[TtsInput] | None) -> None:
    await asyncio.gather(*tasks, return_exceptions=True)
    if isinstance(source, _Closable): await source.aclose()


async def _socket_items(input: AsyncIterable[TtsInput], socket: WebSocketLike, config: dict[str, object],
                        validate: InputValidator, limit: int) -> AsyncGenerator[SynthesisItem]:
    session = uuid.uuid4().hex
    source: AsyncIterator[TtsInput] | None = None
    tasks: list[asyncio.Task[object]] = []
    done, finishing, clearing, stopping = False, False, False, False
    resume = asyncio.Event()
    resume.set()
    async def send(packet: dict[str, object]) -> None:
        await socket.send(json.dumps(packet, ensure_ascii=True, allow_nan=False, separators=(",", ":")))
    async def receive() -> _Packet:
        try: raw = await socket.receive()
        except StopAsyncIteration: raise TypeError("MiniMax WebSocket closed before task_finished") from None
        if not isinstance(raw, str): raise TypeError("MiniMax WebSocket messages must be JSON text")
        if len(raw.encode("utf-8", errors="surrogatepass")) > limit: raise TypeError("MiniMax message exceeds max_message_bytes")
        packet = _packet(_json(raw))
        if packet.code: raise MiniMaxError(packet.message, packet.code)
        return packet
    try:
        connected = await receive()
        if connected.event != "connected_success": raise TypeError("MiniMax did not acknowledge the connection")
        connection_id = connected.connection_id if connected.connection_id is not None else connected.session_id
        await send({**config, "event": "task_start", "session_id": session, "subtitle_enable": False})
        started = await receive()
        if started.event != "task_started": raise TypeError("MiniMax did not acknowledge task_start")
        if started.session_id is not None and started.session_id != session: raise TypeError("MiniMax returned an unexpected session ID")
        if connection_id is not None and started.connection_id is not None and started.connection_id != connection_id: raise TypeError("MiniMax returned an unexpected connection ID")
        source = aiter(input)
        async def produce() -> None:
            nonlocal clearing, finishing
            whitespace = ""
            assert source is not None
            while not stopping:
                # Keep at most one pull outstanding, including while cancellation is acknowledged.
                try: item = await anext(source)
                except StopAsyncIteration:
                    await resume.wait()
                    if stopping: return
                    finishing = True
                    await send({"event": "task_finish"})
                    return
                validate(item)
                await resume.wait()
                if stopping: return
                if isinstance(item, str):
                    part = utf16_units(item)
                    if len(part) >= 10000: raise TypeError("MiniMax text pieces must contain fewer than 10000 UTF-16 code units")
                    text, whitespace = whitespace + part, ""
                    # Match JavaScript trim rather than Python's broader Unicode whitespace set.
                    if not text.strip(" \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"):
                        if len(text) >= 10000: raise TypeError("MiniMax pending whitespace exceeds a native message")
                        whitespace = text
                    else:
                        while text:
                            length = min(9999, len(text))
                            if length < len(text) and 0xd800 <= ord(text[length - 1]) <= 0xdbff: length -= 1
                            piece, text = text[:length], text[length:]
                            if piece.strip(" \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"):
                                await send({"event": "task_continue", "text": piece.encode("utf-16-le", errors="surrogatepass").decode("utf-16-le", errors="surrogatepass")})
                            elif text: raise TypeError("MiniMax pending whitespace exceeds a native message")
                            else: whitespace = piece
                else:
                    whitespace = ""
                    if item["command"] == "clear":
                        clearing = True
                        resume.clear()
                        await send({"event": "task_cancel"})
                    else:
                        await send({"event": "task_flush"})
                await asyncio.sleep(0)
        producer = asyncio.create_task(produce())
        receiver = asyncio.create_task(receive())
        tasks = [producer, receiver]
        producer_done = False
        while True:
            completed, _ = await asyncio.wait([receiver] if producer_done else [producer, receiver], return_when=asyncio.FIRST_COMPLETED)
            if producer in completed:
                producer.result()
                producer_done = True
            if receiver not in completed: continue
            packet = receiver.result()
            if packet.session_id is not None and packet.session_id != session: raise TypeError("MiniMax returned an unexpected session ID")
            if connection_id is not None and packet.connection_id is not None and packet.connection_id != connection_id: raise TypeError("MiniMax returned an unexpected connection ID")
            event = packet.event if packet.event is not None else "task_continued" if packet.audio is not None or packet.final is not None else None
            if event == "task_failed": raise MiniMaxError(packet.message or "MiniMax synthesis task failed", packet.code)
            if event == "task_finished" and clearing: raise TypeError("MiniMax ended the session before acknowledging cancellation")
            if event == "task_canceled":
                if not clearing: raise TypeError("MiniMax returned an unsolicited cancel acknowledgement")
                clearing = False
                resume.set()
                yield {"event": "clear"}
            elif not clearing:
                if event == "task_finished":
                    if not finishing: raise TypeError("MiniMax ended the session before task_finish")
                    await producer  # An acknowledgement cannot hide a failed final write.
                    done = True
                    yield _done(packet)
                    return
                if event == "task_flushed":
                    yield {"event": "flush", "correlation_id": packet.trace_id if packet.trace_id is not None else session, "input_group_id": session}
                else:
                    envelope: MiniMaxEnvelope = {"correlation": "ordered", "input_group_id": session, "timestamps": []}
                    if packet.trace_id is not None: envelope = {**envelope, "correlation_id": packet.trace_id, "trace_id": packet.trace_id}
                    if event in ("sentence_start", "sentence_end"):
                        yield {**envelope, "sentence_boundary": "start" if event == "sentence_start" else "end"}
                    elif event == "task_continued" and (packet.audio or packet.final or packet.usage is not None):
                        if packet.audio: envelope = {**envelope, "audio": packet.audio}
                        if packet.final: envelope = {**envelope, "request_complete": True}
                        if packet.usage is not None: envelope = {**envelope, "usage": packet.usage}
                        yield envelope
            receiver = asyncio.create_task(receive())
            tasks = [producer, receiver]
    finally:
        stopping = True
        for task in tasks: task.cancel()
        stop: asyncio.Task[None] | None = None
        try:
            if not done:
                stop = asyncio.create_task(send({"event": "task_cancel"}))
                tasks.append(stop)
                await asyncio.sleep(0)
        finally:
            if stop is not None and not stop.done(): stop.cancel()
            cleanup = asyncio.create_task(_cleanup(tasks, source))
            _cleanup_tasks.add(cleanup)
            cleanup.add_done_callback(_observe)


@asynccontextmanager
async def synthesize(request: TtsRequest, *, auth: Auth | None = None, transport: HttpTransport | None = None,
                     web_socket: WebSocketLike | None = None, base_url: str | None = None, web_socket_url: str | None = None,
                     timeout_ms: int | None = None, max_json_bytes: int = 16 * 1024 * 1024,
                     max_message_bytes: int = 4 * 1024 * 1024) -> AsyncIterator[AsyncIterator[SynthesisItem]]:
    """Use async with; cancellation and deadlines cover input, I/O and subtitles.

    Injected HTTP must reject redirects/retries and avoid ambient credentials,
    including on subtitle downloads. Native sockets authenticate in upgrade headers.
    """
    validate = validate_request(request)
    for value, name in ((max_json_bytes, "max_json_bytes"), (max_message_bytes, "max_message_bytes")):
        if type(value) is not int or not 1 <= value <= 4294967295: raise TypeError(f"MiniMax {name} must be a positive uint32 value")
    if timeout_ms is not None and (type(timeout_ms) is not int or not 0 <= timeout_ms <= 2147483647):
        raise TypeError("MiniMax timeout_ms must be an integer between 0 and 2147483647")
    text = request["text"]
    socket_mode = not isinstance(text, str) or web_socket is not None or web_socket_url is not None
    async def whole() -> AsyncIterator[TtsInput]:
        assert isinstance(text, str)
        yield text
    input = whole() if isinstance(text, str) else text
    if socket_mode and isinstance(text, str): validate = validate_request({**request, "text": input})
    config, streaming = _configuration(request, socket_mode)
    entry = auth.get("minimax") if auth is not None else None
    key = entry["api_key"] if entry is not None and "api_key" in entry else os.environ.get("SPEECHSWITCH_MINIMAX_API_KEY", os.environ.get("MINIMAX_API_KEY", ""))
    if not key and web_socket is None: raise TypeError("Missing auth.minimax.apiKey configuration")
    if any(not 32 <= ord(c) <= 126 for c in key): raise TypeError("Invalid MiniMax authentication header")
    base = _url(base_url if base_url is not None else "https://api.minimax.io", "", False)
    if socket_mode:
        url = _url(web_socket_url, "", True) if web_socket_url is not None else _url(("wss" if base.startswith("https:") else "ws") + base[base.index(":"):], "/ws/v1/t2a_v2_bidi", True)
    else:
        if transport is None: raise TypeError("MiniMax HTTP transport is required")
        url = _url(base, "/v1/t2a_v2", False)
    if timeout_ms == 0: raise TimeoutError("MiniMax synthesis deadline expired")
    deadline = asyncio.timeout(None if timeout_ms is None else timeout_ms / 1000)
    try:
        async with deadline:
            if socket_mode:
                if web_socket is not None:
                    async with _closing(web_socket), _closing(_socket_items(input, web_socket, config, validate, max_message_bytes)) as stream:
                        yield stream
                else:
                    async with connect_websocket(url, headers={"Authorization": "Bearer " + key}, max_message_bytes=max_message_bytes) as socket:
                        async with _closing(_socket_items(input, socket, config, validate, max_message_bytes)) as stream:
                            yield stream
            else:
                assert transport is not None
                body: dict[str, object] = {**config, "text": text, "stream": streaming, "output_format": "hex", "subtitle_enable": "timestamp_granularity" in request}
                if streaming: body["stream_options"] = {"exclude_aggregated_audio": True}
                timing = request.get("timestamp_granularity")
                if timing is not None: body["subtitle_type"] = timing
                wire = HttpRequest("POST", url, {"Authorization": "Bearer " + key, "Content-Type": "application/json"}, json.dumps(body, allow_nan=False).encode())
                async with _closing(_http_items(request, transport, wire, max_json_bytes)) as stream:
                    yield stream
    except TimeoutError:
        if deadline.expired(): raise TimeoutError("MiniMax synthesis deadline expired") from None
        raise
