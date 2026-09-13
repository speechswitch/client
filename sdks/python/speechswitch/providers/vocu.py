"""Vocu's native HTTP protocol, with TypeScript-generated public contracts."""

import asyncio
import json
import os
import re
from collections.abc import AsyncGenerator, AsyncIterator, Mapping, Sequence
from contextlib import aclosing, asynccontextmanager
from dataclasses import dataclass
from typing import Literal, cast
from urllib.parse import urljoin, urlsplit, urlunsplit

from speechswitch.generated.auth import Auth
from speechswitch.generated.vocu import TtsRequest
from speechswitch.generated.vocu_output import SynthesisItem, VocuDoneEvent
from speechswitch.generated.validators.vocu import validate_request
from speechswitch.http import AudioStream, HttpRequest, HttpTransport
from speechswitch.json import JsonValue
from speechswitch.validation import is_json_value, is_mapping


class VocuError(Exception):
    def __init__(self, status: int | None, job_id: str | None, request_id: str | None, retry_after: str | None) -> None:
        self.status, self.job_id, self.request_id, self.retry_after = status, job_id, request_id, retry_after
        super().__init__("Vocu generation failed" if status is None else f"Vocu returned HTTP {status}")


def _wire_binding(request: Mapping[str, object]) -> dict[str, object]:
    # Only called after generated validation. Bindings deliberately do not receive
    # utterance defaults: omission retains the native splitter's inherited state.
    wire: dict[str, object] = {}
    for source, target in (("voice", "voiceId"), ("voice_style", "promptId"), ("vivid_expression", "vivid"),
                           ("long_text_mode", "infinite_mode"), ("audio_processing_profile", "post_processing")):
        if source in request:
            wire[target] = request[source]
    if "delivery_mode" in request:
        wire["preset"] = "balance" if request["delivery_mode"] == "balanced" else request["delivery_mode"]
    if "language" in request:
        language = request["language"]
        wire["language"] = "en-us" if language == "en-US" else "fr-fr" if language == "fr-FR" else language
    if "speed" in request:
        wire["speechRate"] = 1 / cast(float, request["speed"])
    if "random_seed" in request:
        wire["seed"] = int(cast(float, request["random_seed"]))
    if "emotion_source" in request:
        wire["break_clone"] = request["emotion_source"] == "text"
    if "emotion_blend" in request:
        blend = cast(Mapping[str, float], request["emotion_blend"])
        wire["emo_switch"] = [int(blend.get(key, 0)) for key in ("anger", "happiness", "neutral", "sadness", "contextual")]
    if "input_type" in request:
        wire["instruct_mode"] = request["input_type"] == "markup"
        if "reference_emphasis" in request:
            wire["reference_mode"] = request["reference_emphasis"]
    return wire


def _wire_speech(request: Mapping[str, object]) -> dict[str, object]:
    return {**_wire_binding({"voice_style": "default", "delivery_mode": "balanced", "language": "auto",
                            "vivid_expression": False, "speed": 1, "random_seed": -1, **request}), "text": request["text"]}


def _wire_splitter(splitter: Mapping[str, object]) -> dict[str, object]:
    if "id" in splitter:
        return {"splitterId": splitter["id"]}
    native: dict[str, object] = {}
    placeholders = cast(Sequence[Mapping[str, object]], splitter.get("placeholders", ()))
    for index in range(len(placeholders)):
        rule = placeholders[index]
        marker = cast(str, rule["marker"])
        if marker in ("splitterMarks", "lookupTable", "fallbackConfig") or marker in native:
            raise TypeError("Vocu splitter markers must be unique and cannot use reserved protocol keys")
        native[marker] = _wire_binding(rule)
    if "brackets" in splitter:
        brackets = cast(Sequence[Mapping[str, str]], splitter["brackets"])
        native["splitterMarks"] = [brackets[index]["open"] + brackets[index]["close"] for index in range(len(brackets))]
    if "fallback" in splitter:
        native["fallbackConfig"] = _wire_binding(cast(Mapping[str, object], splitter["fallback"]))
    if "lookup" in splitter:
        rules = cast(Sequence[Mapping[str, object]], splitter["lookup"])
        lookup: dict[str, object] = {}
        for index in range(len(rules)):
            rule = rules[index]
            tags = cast(Sequence[str | Sequence[str]], rule["tags"])
            native_tags: list[str | list[str]] = []
            for tag_index in range(len(tags)):
                tag = tags[tag_index]
                native_tags.append(tag if isinstance(tag, str) else [tag[item] for item in range(len(tag))])
            lookup[f"entry{index}"] = {**_wire_binding(rule), "tags": native_tags}
        native["lookupTable"] = lookup
    return {"splitter": native}


def _object(value: object) -> Mapping[str, JsonValue]:
    if not is_mapping(value) or not is_json_value(value):
        raise TypeError("Invalid Vocu response object")
    return cast(Mapping[str, JsonValue], value)


def _metadata(text: str) -> Mapping[str, JsonValue]:
    try:
        value: object = json.loads(text)
    except (ValueError, RecursionError):
        raise TypeError("Invalid Vocu metadata") from None
    return _object(value)


def _url(address: str) -> tuple[str, str]:
    try:
        url = urlsplit(address)
        if url.scheme not in ("http", "https") or not url.hostname or url.username is not None or url.password is not None or "#" in address or any(c.isspace() or ord(c) < 32 or ord(c) == 127 or c == "\\" for c in address) or re.search(r"%(?![0-9a-fA-F]{2})", address):
            raise ValueError
        port = url.port
        host = f"[{url.hostname}]" if ":" in url.hostname else url.hostname.encode("idna").decode("ascii")
        origin = f"{url.scheme}://{host}"
        if port is not None and port != (443 if url.scheme == "https" else 80):
            origin += f":{port}"
        return urlunsplit((url.scheme, origin.split("://", 1)[1], url.path, url.query, "")), origin
    except (ValueError, UnicodeError):
        raise TypeError("Vocu URLs must be HTTP(S) without credentials, fragments or invalid escapes") from None


@dataclass
class _Session:
    transport: HttpTransport
    base_url: str
    endpoint: str
    token: str
    limit: int
    poll_ms: int
    audio_origins: set[str]
    request_id: str | None = None
    job_id: str | None = None

    @asynccontextmanager
    async def send(self, url: str, payload: Mapping[str, object] | None, *, authenticated: bool) -> AsyncIterator[tuple[Mapping[str, str], AudioStream]]:
        headers = {"Authorization": f"Bearer {self.token}"} if authenticated else {}
        encoded = b""
        if payload is not None:
            headers["Content-Type"] = "application/json"
            encoded = json.dumps(payload, allow_nan=False, separators=(",", ":")).encode("utf-8")
        response = await self.transport.send(HttpRequest("GET" if payload is None else "POST", url, headers, encoded))
        body = AudioStream(response.body)
        try:
            headers = {key.lower(): value for key, value in response.headers.items()}
            if not 200 <= response.status < 300:
                raise VocuError(response.status, self.job_id, headers.get("x-vocu-app-request-id"), headers.get("retry-after"))
            if authenticated:
                self.request_id = headers.get("x-vocu-app-request-id", self.request_id)
            yield headers, body
        except BaseException:
            try:
                await body.aclose()
            except Exception:
                pass
            raise
        finally:
            await body.aclose()

    async def metadata(self, body: AudioStream) -> Mapping[str, JsonValue]:
        data = bytearray()
        async for chunk in body:
            if len(chunk) > self.limit - len(data):
                raise TypeError("Vocu metadata exceeds max_metadata_bytes")
            data.extend(chunk)
            await asyncio.sleep(0)
        try:
            result = _metadata(data.decode("utf-8-sig"))
        except UnicodeError:
            raise TypeError("Invalid Vocu metadata UTF-8") from None
        if result.get("status") != 200:
            raise TypeError("Invalid Vocu response status")
        return _object(result.get("data"))

    def audio_url(self, address: JsonValue | None) -> str:
        if not isinstance(address, str) or not address.strip():
            raise TypeError("Vocu returned no audio URL")
        # Check the original spelling before urljoin can erase controls or a fragment.
        if "#" in address or any(c.isspace() or ord(c) < 32 or ord(c) == 127 or c == "\\" for c in address):
            raise TypeError("Vocu returned an untrusted audio URL")
        url, origin = _url(urljoin(self.base_url, address))
        if origin not in self.audio_origins:
            raise TypeError("Vocu returned an untrusted audio URL")
        return url


async def _audio(headers: Mapping[str, str], body: AudioStream) -> AsyncGenerator[bytes]:
    media = headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if media and media not in ("audio/mpeg", "application/octet-stream"):
        raise TypeError("Vocu returned an unexpected audio content type")
    received = False
    async for chunk in body:
        received = True
        yield chunk
        await asyncio.sleep(0)
    if not received:
        raise TypeError("Vocu returned no audio")


async def _items(session: _Session, payload: Mapping[str, object], mode: Literal["stream", "http", "async"]) -> AsyncGenerator[SynthesisItem]:
    result: Mapping[str, JsonValue] | None = None
    completion: Literal["transport", "generated"] = "transport"
    async with session.send(session.endpoint + ("generate" if mode == "async" else "simple-generate"), payload, authenticated=True) as (headers, body):
        if mode == "stream":
            header = headers.get("x-reecho-response-data")
            if header is not None:
                if len(header.encode("utf-8")) > session.limit:
                    raise TypeError("Vocu metadata exceeds max_metadata_bytes")
                result = _metadata(header)
            async with aclosing(_audio(headers, body)) as audio:
                async for chunk in audio:
                    yield chunk
        else:
            result = await session.metadata(body)
    if mode == "async":
        assert result is not None
        job_id = result.get("id")
        if not isinstance(job_id, str) or re.fullmatch(r"[A-Za-z0-9_-]+", job_id) is None:
            raise TypeError("Invalid Vocu job ID")
        session.job_id = job_id
        while True:
            if result.get("id") != job_id:
                raise TypeError("Vocu returned a different job ID while polling")
            status = result.get("status")
            if status == "failed":
                raise VocuError(None, job_id, session.request_id, None)
            if status == "generated":
                break
            if status not in ("pending", "processing"):
                raise TypeError("Invalid Vocu job status")
            await asyncio.sleep(session.poll_ms / 1000)
            async with session.send(session.endpoint + "generate/" + job_id, None, authenticated=True) as (_, body):
                result = await session.metadata(body)
        completion = "generated"
    if mode != "stream":
        assert result is not None
        address = _object(result.get("metadata")).get("audio") if mode == "async" else result.get("streamUrl")
        if mode == "http" and address is None:
            address = result.get("audio")
        async with session.send(session.audio_url(address), None, authenticated=False) as (headers, body):
            async with aclosing(_audio(headers, body)) as audio:
                async for chunk in audio:
                    yield chunk
    await asyncio.sleep(0)
    done: VocuDoneEvent = {"event": "done", "completion": completion}
    if result is not None:
        done = {**done, "metadata": result}
    if session.request_id is not None:
        done = {**done, "request_id": session.request_id}
    yield done


@asynccontextmanager
async def synthesize(request: TtsRequest, *, transport: HttpTransport, auth: Auth | None = None,
                     base_url: str = "https://v1.vocu.ai", mode: Literal["stream", "http", "async"] | None = None,
                     timeout_ms: int | None = None, poll_interval_ms: int = 1000,
                     max_metadata_bytes: int = 4 * 1024 * 1024, audio_origins: Sequence[str] = ()) -> AsyncIterator[AsyncIterator[SynthesisItem]]:
    """Use async with, even for early exit; the deadline covers the entire context.

    The injected transport must return at headers, honor cancellation, never
    follow redirects/retry requests, and send neither cookies nor implicit auth.
    Stopping polling does not cancel an accepted server job or its billing.
    """
    validate_request(request)
    batch, splitter = request.get("segments"), request.get("text_splitter")
    selected = mode if mode is not None else "async" if batch is not None or splitter is not None else "stream"
    if selected not in ("stream", "http", "async"):
        raise TypeError("Invalid Vocu mode")
    if (batch is not None or splitter is not None) and selected != "async":
        raise TypeError("Vocu segments and text splitting require async synthesis")
    if selected == "async" and request.get("latency_optimization") == "maximum":
        raise TypeError("Vocu async synthesis does not support flash latency optimization")
    credentials = (auth or {}).get("vocu", {})
    api_key = credentials.get("api_key")
    if api_key is None:
        api_key = os.environ.get("SPEECHSWITCH_VOCU_API_KEY", os.environ.get("VOCU_API_KEY"))
    token = credentials.get("api_key", credentials.get("access_token", api_key)) if selected == "async" else api_key
    if selected == "async" and token is None:
        token = os.environ.get("SPEECHSWITCH_VOCU_ACCESS_TOKEN", os.environ.get("VOCU_ACCESS_TOKEN"))
    if not token:
        raise TypeError("Missing auth.vocu.apiKey or auth.vocu.accessToken configuration" if selected == "async" else "Missing auth.vocu.apiKey configuration")
    if any(ord(c) < 33 or ord(c) > 126 for c in token):
        raise TypeError("Vocu credential must contain only visible ASCII characters")
    base, _ = _url(base_url)
    if "?" in base_url:
        raise TypeError("Vocu base URL must not contain a query")
    for value in (poll_interval_ms, timeout_ms if timeout_ms is not None else 0):
        if type(value) is not int or not 0 <= value <= 2147483647:
            raise TypeError("Vocu polling interval and timeout must be integers between 0 and 2147483647")
    if type(max_metadata_bytes) is not int or not 0 < max_metadata_bytes <= 9007199254740991:
        raise TypeError("Vocu max_metadata_bytes must be a positive safe integer")
    origins = {"https://storage.vocu.ai", "https://storage.vocu.studio", "https://v1.vocu.ai", "https://v1.vocu.studio"}
    for address in audio_origins:
        _, origin = _url(address)
        if origin != address:
            raise TypeError("Vocu audio_origins must contain HTTP(S) origins only")
        origins.add(origin)
    payload: dict[str, object]
    if selected == "async":
        payload = {"text": request.get("text"), **_wire_splitter(splitter)} if splitter is not None else {"contents": [{"type": "text", **_wire_speech(batch[index])} for index in range(len(batch))] if batch is not None else [{"type": "text", **_wire_speech(request)}]}
        payload["srt"] = request.get("subtitle_format") == "srt"
    else:
        payload = {**_wire_speech(request), "flash": request.get("latency_optimization") == "maximum", "srt": request.get("subtitle_format") == "srt", "stream": True, "direct_stream": selected == "stream"}
    if timeout_ms == 0:
        raise TimeoutError("Vocu synthesis deadline expired")
    session = _Session(transport, base, base.rstrip("/") + "/api/tts/", token, max_metadata_bytes, poll_interval_ms, origins)
    async with asyncio.timeout(None if timeout_ms is None else timeout_ms / 1000):
        async with aclosing(_items(session, payload, selected)) as items:
            yield items
