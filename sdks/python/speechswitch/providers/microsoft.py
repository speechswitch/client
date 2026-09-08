"""Azure Speech's handwritten SSML HTTP and byte-native WebSocket protocols."""

import asyncio
import json
import os
import re
import uuid
from collections.abc import AsyncGenerator, AsyncIterable, AsyncIterator, Awaitable, Mapping, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Protocol, runtime_checkable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from speechswitch.generated.auth import Auth
from speechswitch.generated.microsoft import TtsRequest
from speechswitch.generated.microsoft_output import MicrosoftTimestamp, MicrosoftEnvelope, MicrosoftDoneEvent, SynthesisItem
from speechswitch.generated.validators.microsoft import validate_request
from speechswitch.http import AudioStream, HttpRequest, HttpTransport
from speechswitch.validation import InputValidator, is_mapping, is_number, is_sequence
from speechswitch.websocket import WebSocketLike, connect_websocket


class MicrosoftError(Exception):
    def __init__(self, message: str, status_code: int, retry_after: str | None) -> None:
        self.status_code, self.retry_after = status_code, retry_after
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


def _format(request: TtsRequest) -> str:
    output = request.get("output")
    if output is None:
        return "raw-24khz-16bit-mono-pcm"
    sample_rate = int(output["sample_rate_hz"])
    rate = f"{sample_rate}hz" if sample_rate in (22050, 44100) else f"{sample_rate // 1000}khz"
    match output["format"]:
        case "mp3": return f'audio-{rate}-{int(output["bit_rate_bps"]) // 1000}kbitrate-mono-mp3'
        case "pcm": return f"raw-{rate}-16bit-mono-pcm"
        case "wav":
            encoding = output.get("sample_encoding")
            return f"riff-8khz-8bit-mono-{encoding}" if encoding in ("alaw", "mulaw") else f"riff-{rate}-16bit-mono-pcm"
        case "alaw" | "mulaw": return f'raw-8khz-8bit-mono-{output["format"]}'
        case "ogg_opus": return f"ogg-{rate}-16bit-mono-opus"
        case "opus": return f'audio-{rate}-16bit-{int(output["bit_rate_bps"]) // 1000}kbps-mono-opus'
        case "webm_opus":
            bits = output.get("bit_rate_bps")
            return f'webm-{rate}-16bit-{str(int(bits) // 1000) + "kbps-" if bits is not None else ""}mono-opus'
        case "truesilk": return f"raw-{rate}-16bit-mono-truesilk"
        case "amr_wb": return "amr-wb-16000hz"
        case "g722": return "g722-16khz-64kbps"


def _xml(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;").replace("'", "&apos;")


def _number_text(value: int | float) -> str:
    return str(int(value)) if int(value) == value else str(value)


def _settings(request: TtsRequest) -> tuple[dict[str, object], str | None]:
    model = request.get("model", "neural")
    suffix = {"dragon-hd": ":DragonHDLatestNeural", "dragon-hd-omni": ":DragonHDOmniLatestNeural", "dragon-hd-flash": ":DragonHDFlashLatestNeural", "mai-voice-2": ":MAI-Voice-2", "mai-voice-2-flash": ":MAI-Voice-2-Flash"}.get(model, "")
    voice = request.get("voice", "") + suffix
    language = request.get("language", "en-US")
    input: dict[str, object] = {"bidirectionalStreamingMode": True, "voiceName": voice, "language": language}
    parameters: list[str] = []
    temperature = request.get("temperature", 1 if model == "dragon-hd" else 0.7 if model == "dragon-hd-omni" else None)
    if temperature is not None:
        input["temperature"] = _number_text(temperature)
        parameters.append(f"temperature={_number_text(temperature)}")
    for field, wire in (("top_p", "top_p"), ("top_k", "top_k"), ("voice_guidance", "cfg_scale")):
        value = request.get(field)
        if is_number(value):
            parameters.append(f"{wire}={_number_text(value)}")
    enhancement = request.get("named_entity_pronunciation_enhancement")
    if enhancement is not None:
        parameters.append(f"enhancePronunciation={str(enhancement).lower()}")
    rate, pitch, volume, style = request.get("speed"), request.get("pitch_semitones"), request.get("volume_scale"), request.get("emotion")
    if rate is not None: input["rate"] = _number_text(rate)
    if pitch is not None: input["pitch"] = f'{"+" if pitch >= 0 else ""}{_number_text(pitch)}st'
    if volume is not None: input["volume"] = _number_text(volume * 100)
    if style is not None: input["style"] = style
    lexicon, languages = request.get("lexicon_url"), request.get("preferred_languages")
    if lexicon is not None: input["customLexiconUrl"] = lexicon
    if languages is not None: input["preferLocales"] = ",".join(languages[index] for index in range(len(languages)))
    text = request["text"]
    if not isinstance(text, str): return input, None
    if request.get("input_type") == "ssml": return input, text
    hd = model in ("dragon-hd", "dragon-hd-omni", "dragon-hd-flash")
    body = _xml(text)
    if hd and "language" in request: body = f'<lang xml:lang="{_xml(language)}">{body}</lang>'
    prosody = "".join(f' {key}="{value}"' for key in ("rate", "pitch", "volume") if (value := input.get(key)) is not None)
    if prosody: body = f"<prosody{prosody}>{body}</prosody>"
    if style is not None: body = f'<mstts:express-as style="{_xml(style)}">{body}</mstts:express-as>'
    parameter_text = f' parameters="{_xml(";".join(parameters))}"' if parameters else ""
    return input, f'<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="{_xml("en-US" if hd else language)}"><voice name="{_xml(voice)}"{parameter_text}>{body}</voice></speak>'


def _encode(path: str, request_id: str, body: str, timestamp: str | None = None) -> str:
    stamp = timestamp if timestamp is not None else datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    content_type = "application/ssml+xml" if path == "ssml" else "text/plain" if path in ("text.piece", "text.end") else "application/json"
    return f"Path: {path}\r\nX-RequestId: {request_id}\r\nX-Timestamp: {stamp}\r\nContent-Type: {content_type}\r\n\r\n{body}"


@dataclass(frozen=True)
class _Frame:
    path: str
    request_id: str
    stream_id: str | None
    body: str | bytes


def _frame(data: str | bytes) -> _Frame:
    if isinstance(data, str):
        if "\r\n\r\n" not in data: raise TypeError("Microsoft text frame is missing its header separator")
        headers, body = data.split("\r\n\r\n", 1)
    else:
        if len(data) < 2: raise TypeError("Microsoft binary frame is missing its header length")
        length = int.from_bytes(data[:2], "big")
        if length > len(data) - 2: raise TypeError("Microsoft binary frame has a truncated header")
        try: headers = data[2:length + 2].decode("utf-8")
        except UnicodeDecodeError: raise TypeError("Microsoft binary frame has invalid UTF-8 headers") from None
        body = data[length + 2:]
    fields: dict[str, str] = {}
    for line in headers.split("\r\n"):
        if not line: continue
        name, separator, value = line.partition(":")
        name, value = name.strip().lower(), value.strip()
        if not separator or not re.fullmatch("[a-z0-9-]+", name) or "\r" in value or "\n" in value:
            raise TypeError("Microsoft frame contains an invalid header")
        if name in fields: raise TypeError(f"Microsoft frame repeats header {name}")
        fields[name] = value
    if not fields.get("path") or not fields.get("x-requestid"): raise TypeError("Microsoft frame is missing Path or X-RequestId")
    return _Frame(fields["path"].lower(), fields["x-requestid"], fields.get("x-streamid"), body)


def _object(value: object) -> Mapping[object, object]:
    if not is_mapping(value): raise TypeError("Microsoft returned an invalid synthesis object")
    return value


def _json(text: str) -> Mapping[object, object]:
    def invalid(_: str) -> None: raise ValueError()
    try: value: object = json.loads(text, parse_constant=invalid)
    except (ValueError, RecursionError): raise TypeError("Microsoft returned invalid JSON") from None
    return _object(value)


def _ticks(value: object, name: str) -> int:
    if not is_number(value) or int(value) != value or not 0 <= value <= 9007199254740991:
        raise TypeError(f"Microsoft returned invalid {name}")
    return int(value)


def _metadata(value: Mapping[object, object]) -> tuple[list[MicrosoftTimestamp], float | None]:
    rows = value.get("Metadata")
    if not is_sequence(rows): raise TypeError("Microsoft returned invalid synthesis Metadata")
    timestamps: list[MicrosoftTimestamp] = []
    duration: float | None = None
    for row in rows:
        row = _object(row)
        kind = row.get("Type")
        if not isinstance(kind, str): raise TypeError("Microsoft returned an invalid metadata type")
        if kind not in ("WordBoundary", "SentenceBoundary", "Bookmark", "Viseme", "SessionEnd"): continue
        data = _object(row.get("Data"))
        raw_offset = _ticks(data.get("Offset"), "metadata Offset")
        offset = raw_offset / 10000
        if kind == "SessionEnd":
            if duration is not None: raise TypeError("Microsoft returned duplicate SessionEnd metadata")
            duration = offset
            continue
        if kind in ("WordBoundary", "SentenceBoundary"):
            text = _object(data.get("text"))
            word, boundary = text.get("Text"), text.get("BoundaryType")
            if not isinstance(word, str) or ("BoundaryType" in text and not isinstance(boundary, str)): raise TypeError("Microsoft returned invalid boundary text")
            length = _ticks(data.get("Duration"), "metadata Duration")
            if raw_offset + length > 9007199254740991: raise TypeError("Microsoft metadata timing overflow")
            mark: MicrosoftTimestamp = {"kind": "word" if kind == "WordBoundary" else "sentence", "value": word, "start_time_ms": offset, "end_time_ms": offset + length / 10000}
            if isinstance(boundary, str): mark = {**mark, "boundary_type": boundary}
        elif kind == "Bookmark":
            bookmark = data.get("Bookmark")
            if not isinstance(bookmark, str): raise TypeError("Microsoft returned an invalid bookmark")
            mark = {"kind": "ssml", "value": bookmark, "start_time_ms": offset}
        else:
            viseme, animation, last = data.get("VisemeId"), data.get("AnimationChunk"), data.get("IsLastAnimation")
            if not is_number(viseme) or int(viseme) != viseme or not 0 <= viseme <= 9007199254740991 or ("AnimationChunk" in data and not isinstance(animation, str)) or ("IsLastAnimation" in data and not isinstance(last, bool)):
                raise TypeError("Microsoft returned invalid viseme metadata")
            mark = {"kind": "viseme", "value": str(int(viseme)), "start_time_ms": offset}
            if isinstance(animation, str): mark = {**mark, "animation_chunk": animation}
            if isinstance(last, bool): mark = {**mark, "is_last_animation": last}
        timestamps.append(mark)
    return timestamps, duration


_cleanup_tasks: set[asyncio.Task[None]] = set()


def _observe(task: asyncio.Task[None]) -> None:
    _cleanup_tasks.discard(task)
    if not task.cancelled(): task.exception()


async def _cleanup(tasks: Sequence[Awaitable[object]], source: AsyncIterator[str] | None) -> None:
    await asyncio.gather(*tasks, return_exceptions=True)
    if isinstance(source, _Closable): await source.aclose()


async def _socket_items(text: str | AsyncIterable[str], socket: WebSocketLike, input: dict[str, object], markup: str | None,
                        format: str, requested: Sequence[str], validate: InputValidator, limit: int) -> AsyncGenerator[SynthesisItem]:
    request_id = uuid.uuid4().hex
    source: AsyncIterator[str] | None = None
    tasks: list[asyncio.Task[object]] = []
    done, input_done, stopping = False, False, False
    async def send(path: str, value: str) -> None: await socket.send(_encode(path, request_id, value))
    try:
        await send("speech.config", json.dumps({"context": {"system": {"name": "speechswitch", "version": "0.0.0", "build": "Python"}}}))
        synthesis: dict[str, object] = {"audio": {"outputFormat": format, "metadataOptions": {
            "wordBoundaryEnabled": "word" in requested, "sentenceBoundaryEnabled": "sentence" in requested,
            "punctuationBoundaryEnabled": False, "bookmarkEnabled": "ssml" in requested, "visemeEnabled": "viseme" in requested, "sessionEndEnabled": True,
        }}, "language": {"autoDetection": False}}
        if markup is None: synthesis["input"] = input
        await send("synthesis.context", json.dumps({"synthesis": synthesis}))
        if markup is not None:
            await send("ssml", markup)
            input_done = True
        else:
            assert not isinstance(text, str)
            source = aiter(text)
        async def produce() -> None:
            nonlocal input_done
            if source is None: return
            async for item in source:
                if stopping: return
                validate(item)
                await send("text.piece", item)
                await asyncio.sleep(0)
            if stopping: return
            await send("text.end", "")
            input_done = True
        producer = asyncio.create_task(produce())
        receiver = asyncio.create_task(socket.receive())
        tasks = [producer, receiver]
        producer_done = False
        stream_id: str | None = None
        duration: float | None = None
        while True:
            completed, _ = await asyncio.wait([receiver] if producer_done else [producer, receiver], return_when=asyncio.FIRST_COMPLETED)
            if producer in completed:
                producer.result()
                producer_done = True
            if receiver not in completed: continue
            try: raw = receiver.result()
            except StopAsyncIteration: raise TypeError("Microsoft WebSocket closed before turn.end") from None
            if len(raw.encode("utf-8", "surrogatepass") if isinstance(raw, str) else raw) > limit: raise TypeError("Microsoft message exceeds max_message_bytes")
            frame = _frame(raw)
            if frame.request_id.lower() != request_id: raise TypeError("Microsoft returned an unexpected synthesis request ID")
            if frame.path in ("turn.start", "turn.end"):
                if not isinstance(frame.body, str): raise TypeError("Microsoft turn event must be a text frame")
                if frame.path == "turn.end":
                    if not input_done: raise TypeError("Microsoft ended synthesis before text.end")
                    done = True
                    event: MicrosoftDoneEvent = {"event": "done", "request_id": request_id}
                    yield event if duration is None else {**event, "duration_ms": duration}
                    return
            elif frame.path == "audio":
                if not isinstance(frame.body, bytes) or not frame.stream_id: raise TypeError("Microsoft audio frame is missing binary audio or X-StreamId")
                if stream_id is None or frame.stream_id.lower() != stream_id.lower(): raise TypeError("Microsoft returned audio for an unexpected stream")
                if frame.body:
                    yield {"correlation": "timeline", "correlation_id": request_id, "stream_id": stream_id, "audio": frame.body, "timestamps": []} if requested else frame.body
            elif frame.path in ("response", "audio.metadata"):
                if not isinstance(frame.body, str): raise TypeError("Microsoft synthesis metadata must be a text frame")
                packet = _json(frame.body)
                if frame.path == "response":
                    identity = _object(packet.get("audio")).get("streamId")
                    if not isinstance(identity, str) or not identity: raise TypeError("Microsoft synthesis response is missing audio.streamId")
                    if stream_id is not None and stream_id != identity: raise TypeError("Microsoft changed the audio stream within a synthesis turn")
                    stream_id = identity
                else:
                    if frame.stream_id is not None and (stream_id is None or frame.stream_id.lower() != stream_id.lower()): raise TypeError("Microsoft returned metadata for an unexpected stream")
                    marks, elapsed = _metadata(packet)
                    if elapsed is not None: duration = elapsed
                    marks = [mark for mark in marks if mark["kind"] in requested]
                    if requested and (marks or elapsed is not None):
                        envelope: MicrosoftEnvelope = {"correlation": "timeline", "correlation_id": request_id, "timestamps": marks}
                        if stream_id is not None: envelope = {**envelope, "stream_id": stream_id}
                        if elapsed is not None: envelope = {**envelope, "duration_ms": elapsed}
                        yield envelope
            receiver = asyncio.create_task(socket.receive())
            tasks = [producer, receiver]
    finally:
        stopping = True
        for task in tasks: task.cancel()
        stop: asyncio.Task[None] | None = None
        try:
            if not done:
                # Best effort only: stop must not wait for a stuck writer to release
                # its lock. The owned connection is closed immediately afterwards.
                stop = asyncio.create_task(send("synthesis.control", '{"action":"stop"}'))
                tasks.append(stop)
                await asyncio.sleep(0)
        finally:
            if stop is not None and not stop.done(): stop.cancel()
            cleanup = asyncio.create_task(_cleanup(tasks, source))
            _cleanup_tasks.add(cleanup)
            cleanup.add_done_callback(_observe)


def _url(base: str, path: str, deployment: str | None, socket: bool) -> str:
    try:
        url = urlsplit(base)
        if url.scheme not in (("ws", "wss") if socket else ("http", "https")) or not url.hostname or url.username is not None or url.password is not None or url.fragment or any(c.isspace() or ord(c) < 32 or ord(c) == 127 or c == "\\" for c in base) or re.search(r"%(?![0-9a-fA-F]{2})", base): raise ValueError()
        _ = url.port
        query = url.query
        if deployment is not None:
            pairs = [(key, value) for key, value in parse_qsl(query, keep_blank_values=True) if key != "deploymentId"]
            query = urlencode([*pairs, ("deploymentId", deployment)], safe="")
        return urlunsplit((url.scheme, url.netloc, url.path.rstrip("/") + path, query, ""))
    except ValueError: raise TypeError("Invalid Microsoft endpoint URL") from None


async def _http_items(transport: HttpTransport, request: HttpRequest, limit: int) -> AsyncGenerator[SynthesisItem]:
    response = await transport.send(request)
    headers = {key.lower(): value for key, value in response.headers.items()}
    async with _closing(AudioStream(response.body)) as audio:
        if not 200 <= response.status < 300:
            data = bytearray()
            async for chunk in audio:
                if len(chunk) > limit - len(data): raise TypeError("Microsoft response exceeds max_json_bytes")
                data.extend(chunk)
                await asyncio.sleep(0)
            raise MicrosoftError(f"Microsoft synthesis failed ({response.status}): {data.decode('utf-8-sig', errors='replace')}", response.status, headers.get("retry-after"))
        content_type = headers.get("content-type", "audio/unknown").split(";", 1)[0].strip().lower()
        if not content_type.startswith("audio/") and content_type != "application/octet-stream": raise TypeError("Microsoft returned a non-audio response")
        async for chunk in audio:
            yield chunk
            await asyncio.sleep(0)


@asynccontextmanager
async def synthesize(request: TtsRequest, *, auth: Auth | None = None, transport: HttpTransport | None = None,
                     web_socket: WebSocketLike | None = None, base_url: str | None = None, web_socket_url: str | None = None,
                     deployment_id: str | None = None, timeout_ms: int | None = None,
                     max_json_bytes: int = 16 * 1024 * 1024, max_message_bytes: int = 4 * 1024 * 1024) -> AsyncIterator[AsyncIterator[SynthesisItem]]:
    """Use async with. HTTP/TLS is injected; native sockets authenticate in headers.
    Cancellation stops one synthesis turn, not a reusable clear/ack session.
    """
    validate = validate_request(request)
    for value, name in ((max_json_bytes, "max_json_bytes"), (max_message_bytes, "max_message_bytes")):
        if type(value) is not int or not 1 <= value <= 4294967295: raise TypeError(f"Microsoft {name} must be a positive uint32 value")
    if timeout_ms is not None and (type(timeout_ms) is not int or not 0 <= timeout_ms <= 2147483647): raise TypeError("Microsoft timeout_ms must be an integer between 0 and 2147483647")
    languages = request.get("preferred_languages")
    if languages is not None and any(re.search(r"[,\r\n]", languages[index]) for index in range(len(languages))): raise TypeError("Microsoft preferred languages cannot contain commas or line breaks")
    text = request["text"]
    input, markup = _settings(request)
    tracks = request.get("timestamp_granularity", [])
    requested = [tracks] if isinstance(tracks, str) else [tracks[index] for index in range(len(tracks))]
    socket_mode = not isinstance(text, str) or "timestamp_granularity" in request or web_socket is not None or web_socket_url is not None
    output = request.get("output")
    if socket_mode and output is not None and output["format"] == "wav": raise TypeError("Microsoft WAV output requires the REST transport")
    entry = auth.get("microsoft") if auth is not None else None
    if entry is not None and ("api_key" in entry or "access_token" in entry):
        key, token = entry.get("api_key"), entry.get("access_token")
    else:
        key, token = os.environ.get("SPEECHSWITCH_MICROSOFT_API_KEY", os.environ.get("AZURE_SPEECH_KEY")), os.environ.get("SPEECHSWITCH_MICROSOFT_ACCESS_TOKEN")
    region = entry["region"] if entry is not None and "region" in entry else os.environ.get("SPEECHSWITCH_MICROSOFT_REGION", os.environ.get("AZURE_SPEECH_REGION"))
    if not key and not token and web_socket is None: raise TypeError("Missing auth.microsoft.apiKey or auth.microsoft.accessToken configuration")
    if not region and base_url is None and web_socket_url is None and web_socket is None: raise TypeError("Missing auth.microsoft.region configuration")
    if region is not None and not re.fullmatch("[a-z0-9-]+", region): raise TypeError("Invalid Microsoft Speech region")
    headers = {"Authorization": f"Bearer {token}"} if token else {"Ocp-Apim-Subscription-Key": key} if key else {}
    if any(any(not 32 <= ord(c) <= 126 for c in value) for value in headers.values()): raise TypeError("Invalid Microsoft authentication header")
    resolved_region = region or "unused"
    base = base_url if base_url is not None else f'https://{resolved_region}.{"voice" if deployment_id else "tts"}.speech.{"azure.cn" if resolved_region.startswith("china") else "azure.us" if resolved_region.startswith("usgov") else "microsoft.com"}'
    format = _format(request)
    if socket_mode:
        if web_socket_url is not None:
            url = _url(web_socket_url, "", deployment_id, True)
        else:
            base = _url(base, "", None, False)
            scheme = "wss" if base.startswith("https:") else "ws"
            url = _url(scheme + base[base.index(":"):], "/cognitiveservices/websocket/v2" if markup is None else "/tts/cognitiveservices/websocket/v1", deployment_id, True)
        headers = {**headers, "X-ConnectionId": uuid.uuid4().hex}
    else:
        if transport is None: raise TypeError("Microsoft HTTP transport is required")
        url = _url(base, "/cognitiveservices/v1", deployment_id, False)
    if timeout_ms == 0: raise TimeoutError("Microsoft synthesis deadline expired")
    deadline = asyncio.timeout(None if timeout_ms is None else timeout_ms / 1000)
    try:
        async with deadline:
            if socket_mode:
                if web_socket is not None:
                    async with _closing(web_socket), _closing(_socket_items(text, web_socket, input, markup, format, requested, validate, max_message_bytes)) as stream:
                        yield stream
                else:
                    async with connect_websocket(url, headers=headers, max_message_bytes=max_message_bytes) as socket:
                        async with _closing(_socket_items(text, socket, input, markup, format, requested, validate, max_message_bytes)) as stream:
                            yield stream
            else:
                assert transport is not None and markup is not None
                wire = HttpRequest("POST", url, {**headers, "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": format, "User-Agent": "speechswitch"}, markup.encode("utf-8"))
                async with _closing(_http_items(transport, wire, max_json_bytes)) as stream:
                    yield stream
    except TimeoutError:
        if deadline.expired(): raise TimeoutError("Microsoft synthesis deadline expired") from None
        raise
