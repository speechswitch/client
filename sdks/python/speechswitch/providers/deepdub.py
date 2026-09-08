"""Deepdub's HTTP protocol; its partial OpenAPI is not wire-codegen input."""

import asyncio
import base64
import json
import os
import uuid
from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import aclosing, asynccontextmanager
from http import HTTPStatus
from urllib.parse import urlsplit, urlunsplit

from speechswitch.generated.auth import Auth
from speechswitch.generated.deepdub import TtsRequest
from speechswitch.generated.validators.deepdub import REQUEST_DEFAULTS, validate_request
from speechswitch.http import AudioStream, HttpRequest, HttpResponse, HttpTransport
from speechswitch.validation import is_mapping


class DeepdubError(Exception):
    def __init__(self, status_code: int, generation_id: str, message: str) -> None:
        self.status_code = status_code
        self.generation_id = generation_id
        super().__init__(f"Deepdub returned HTTP {status_code}: {message}")


async def _items(response: HttpResponse, body: AudioStream, opus: bool, generation_id: str,
                 max_error_bytes: int) -> AsyncGenerator[bytes, None]:
    if not 200 <= response.status < 300:
        data = bytearray()
        async for chunk in body:
            if len(chunk) > max_error_bytes - len(data):
                raise TypeError("Deepdub response exceeds max_error_bytes")
            data.extend(chunk)
            await asyncio.sleep(0)
        text = data.decode("utf-8-sig", errors="replace")
        message = text
        try:
            value: object = json.loads(text)
            candidate = value.get("message") if is_mapping(value) else None
            if isinstance(candidate, str):
                message = candidate
        except (ValueError, RecursionError):
            pass
        if not message:
            try:
                message = HTTPStatus(response.status).phrase
            except ValueError:
                message = ""
        headers = {key.lower(): value for key, value in response.headers.items()}
        raise DeepdubError(response.status, headers.get("x-generation-id", generation_id), message)
    prefix = bytearray()
    pending: list[bytes] = []
    verified = not opus
    async for chunk in body:
        if verified:
            yield chunk
            await asyncio.sleep(0)
            continue
        pending.append(chunk)
        prefix.extend(chunk[:290 - len(prefix)])
        if len(prefix) < 27:
            await asyncio.sleep(0)
            continue
        if bytes(prefix[:5]) != b"OggS\x00" or prefix[26] == 0:
            raise TypeError("Deepdub did not return an Ogg Opus stream")
        start = 27 + prefix[26]
        if len(prefix) < start + 8:
            await asyncio.sleep(0)
            continue
        if bytes(prefix[start:start + 8]) != b"OpusHead":
            raise TypeError("Deepdub returned a different Ogg codec (the trial API has returned Vorbis) for requested Opus audio")
        verified = True
        # Retain native chunk boundaries; inspect only the bounded codec prefix,
        # never buffer the synthesized body. This is not a full Ogg validator.
        for audio in pending:
            yield audio
            await asyncio.sleep(0)
        pending.clear()
    if not verified:
        raise TypeError("Deepdub returned a truncated Ogg Opus header")


@asynccontextmanager
async def synthesize(request: TtsRequest, *, transport: HttpTransport, auth: Auth | None = None,
                     base_url: str = "https://restapi.deepdub.ai/api/v1", request_id: str | None = None,
                     timeout_ms: int | None = None, max_error_bytes: int = 1024 * 1024) -> AsyncIterator[AsyncIterator[bytes]]:
    """Use async with to release the response even on early exit or cancellation.

    Text must be complete. Deadlines cover the whole context, not only HTTP
    headers. Transport send/read/close must cooperate with task cancellation.
    No redirects, retries, file buffering or fake incremental input are added.
    """
    validate_request(request)
    if "reference_audio" in request and len(request["reference_audio"]) == 0:
        raise TypeError("Deepdub reference_audio must not be empty")
    if timeout_ms is not None and (type(timeout_ms) is not int or not 0 <= timeout_ms <= 2147483647):
        raise TypeError("Deepdub timeout_ms must be an integer between 0 and 2147483647")
    if timeout_ms == 0:
        raise TimeoutError("Deepdub synthesis deadline expired")
    if type(max_error_bytes) is not int or max_error_bytes <= 0:
        raise TypeError("Deepdub max_error_bytes must be a positive integer")
    entry = auth.get("deepdub") if auth is not None else None
    key = entry["api_key"] if entry is not None and "api_key" in entry else os.environ.get("SPEECHSWITCH_DEEPDUB_API_KEY", os.environ.get("DEEPDUB_API_KEY"))
    if not key:
        raise TypeError("Missing auth.deepdub.apiKey configuration")
    url = urlsplit(base_url)
    if url.scheme not in ("http", "https") or not url.hostname or url.username is not None or url.password is not None or url.fragment:
        raise TypeError("Deepdub base_url must be an HTTP(S) URL without credentials or a fragment")
    target = urlunsplit((url.scheme, url.netloc, url.path.rstrip("/") + "/tts", url.query, ""))
    generation_id = str(uuid.uuid4()) if request_id is None else request_id
    output = request["output"]
    format = "opus" if output["format"] == "ogg_opus" else output["format"]
    wire: dict[str, object] = {
        "generationId": generation_id,
        "model": {"og-1.1": "dd-etts-1.1", "lightning-2.5": "dd-etts-2.5", "phantom-x-3.2": "dd-etts-3.2"}[request["model"]],
        "targetText": request["text"], "locale": request["language"], "format": format,
        "sampleRate": int(output.get("sample_rate_hz", 8000 if format == "mulaw" else 48000)),
        "cleanAudio": request.get("audio_enhancement", REQUEST_DEFAULTS["audio_enhancement"]),
        "autoGain": request.get("automatic_gain_control", REQUEST_DEFAULTS["automatic_gain_control"]),
    }
    for normalized, native in [
        ("voice", "voicePromptId"), ("delivery_reference", "performanceReferencePromptId"),
        ("speed", "tempo"), ("delivery_variance", "variance"), ("temperature", "temperature"),
        ("random_seed", "seed"), ("voice_boost", "promptBoost"), ("duration_stretching", "superStretch"),
        ("speaker_gender", "targetGender"),
    ]:
        if normalized in request:
            wire[native] = request[normalized]
    if "reference_audio" in request:
        wire["voiceReference"] = base64.b64encode(request["reference_audio"]).decode("ascii")
    duration = request.get("target_duration_ms")
    if duration is not None:
        wire["targetDuration"] = duration / 1000
    if "processing_priority" in request:
        wire["realtime"] = request["processing_priority"] == "realtime"
    if "accent_blend" in request:
        accent = request["accent_blend"]
        wire["accentControl"] = {"accentBaseLocale": accent["base_locale"], "accentLocale": accent["target_locale"], "accentRatio": accent["ratio"]}
    encoded = json.dumps(wire, allow_nan=False, separators=(",", ":")).encode("utf-8")
    async with asyncio.timeout(None if timeout_ms is None else timeout_ms / 1000):
        response = await transport.send(HttpRequest("POST", target, {"x-api-key": key, "content-type": "application/json"}, encoded))
        body = AudioStream(response.body)
        try:
            async with aclosing(_items(response, body, format == "opus", generation_id, max_error_bytes)) as items:
                yield items
        except BaseException:
            try:
                await body.aclose()
            except Exception:
                pass
            raise
        finally:
            await body.aclose()
