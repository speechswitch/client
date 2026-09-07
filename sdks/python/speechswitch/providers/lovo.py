"""LOVO job orchestration over its OpenAPI-generated HTTP client."""

import asyncio
import json
import os
import re
from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import aclosing, asynccontextmanager
from typing import Literal
from urllib.parse import SplitResult, urlsplit

from speechswitch.clients import lovo as wire
from speechswitch.generated.auth import Auth
from speechswitch.generated.lovo import TtsRequest
from speechswitch.generated.lovo_output import SynthesisItem
from speechswitch.generated.validators.lovo import REQUEST_DEFAULTS, validate_request
from speechswitch.http import AudioStream, HttpRequest, HttpResponse, HttpTransport


class LovoError(Exception):
    def __init__(self, message: str, status_code: int | None, code: str | None,
                 job_id: str | None = None, retry_after: str | None = None) -> None:
        self.status_code, self.code = status_code, code
        self.job_id, self.retry_after = job_id, retry_after
        super().__init__(message)


def _url(value: str) -> SplitResult:
    try:
        url = urlsplit(value)
        if (url.scheme not in ("http", "https") or not url.hostname
                or url.username is not None or url.password is not None or url.fragment
                or any(ord(c) <= 32 or ord(c) == 127 or c == "\\" for c in value)
                or re.search(r"%(?![0-9a-fA-F]{2})", value)):
            raise ValueError()
        _ = url.port
        return url
    except ValueError:
        raise TypeError("LOVO URL must be HTTP(S) without credentials, fragments or invalid escapes") from None


async def _body_text(response: HttpResponse, limit: int) -> str:
    data = bytearray()
    async with aclosing(AudioStream(response.body)) as body:
        async for chunk in body:
            if len(chunk) > limit - len(data):
                raise TypeError("LOVO response exceeds max_json_bytes")
            data.extend(chunk)
            await asyncio.sleep(0)
    return data.decode("utf-8-sig", errors="replace")


async def _json(response: HttpResponse, status: int, limit: int) -> object:
    text = await _body_text(response, limit)
    if response.status != status:
        headers = {key.lower(): value for key, value in response.headers.items()}
        raise LovoError(text or f"LOVO returned HTTP {response.status}; expected {status}",
                        response.status, None, retry_after=headers.get("retry-after"))
    def invalid(_: str) -> None:
        raise ValueError()
    try:
        return json.loads(text, parse_constant=invalid)
    except (ValueError, RecursionError):
        raise TypeError("LOVO returned invalid JSON") from None


async def _items(request: TtsRequest, transport: HttpTransport, api_key: str, base_url: str,
                 origin: tuple[str, str, int], mode: Literal["sync", "async"],
                 interval: int, limit: int) -> AsyncGenerator[SynthesisItem, None]:
    input: wire.CreateSpeechInput = {"text": request["text"], "speaker": request["voice"],
                                    "speed": request.get("speed", REQUEST_DEFAULTS["speed"])}
    if "voice_style" in request:
        input["speakerStyle"] = request["voice_style"]
    completed: wire.CreateSpeechResponse | wire.GetSpeechJobResponse | None = None
    job: wire.CreateSpeechResponse | wire.GetSpeechJobResponse | wire.CreateSpeechJobResponse
    if mode == "sync":
        completed = wire.decode_create_speech(await _json(
            await wire.create_speech(input, api_key=api_key, base_url=base_url, transport=transport),
            wire.CREATE_SPEECH_STATUS, limit))
        job = completed
    else:
        async_input: wire.CreateSpeechJobInput = {"text": input["text"], "speaker": input["speaker"]}
        if "speed" in input:
            async_input["speed"] = input["speed"]
        if "speakerStyle" in input:
            async_input["speakerStyle"] = input["speakerStyle"]
        job = wire.decode_create_speech_job(await _json(
            await wire.create_speech_job(async_input, api_key=api_key, base_url=base_url, transport=transport),
            wire.CREATE_SPEECH_JOB_STATUS, limit))
    job_id = job["id"]
    if not job_id or job_id in (".", ".."):
        raise TypeError("LOVO returned an invalid job ID")
    while True:
        if job["id"] != job_id:
            raise TypeError("LOVO returned a different job ID while polling")
        if job["type"] not in ("tts", "simple_tts"):
            raise TypeError("LOVO returned a non-TTS job")
        if "error" in job:
            error = job["error"]
            raise LovoError(error["message"], None, error["code"], job_id)
        if job["status"] == "done":
            break
        await asyncio.sleep(interval / 1000)
        completed = wire.decode_get_speech_job(await _json(
            await wire.get_speech_job({"jobId": job_id}, api_key=api_key, base_url=base_url, transport=transport),
            wire.GET_SPEECH_JOB_STATUS, limit))
        job = completed
    # Async creation does not define data, even when it reports completion.
    if completed is None:
        completed = wire.decode_get_speech_job(await _json(
            await wire.get_speech_job({"jobId": job_id}, api_key=api_key, base_url=base_url, transport=transport),
            wire.GET_SPEECH_JOB_STATUS, limit))
    if completed["id"] != job_id or completed["status"] != "done" or completed["type"] not in ("tts", "simple_tts"):
        raise TypeError("LOVO returned an inconsistent completed job")
    if "error" in completed:
        error = completed["error"]
        raise LovoError(error["message"], None, error["code"], job_id)
    if not completed["data"]:
        raise TypeError("LOVO completed without audio outputs")
    assets: list[tuple[str, int, int]] = []
    # Validate every output before downloading any, preserving separate files.
    for output_index, output in enumerate(completed["data"]):
        if "error" in output:
            error = output["error"]
            raise LovoError(error["message"], None, error["code"], job_id)
        if output["status"] == "failed":
            raise LovoError("LOVO speech output failed", None, None, job_id)
        urls = output.get("urls")
        if output["status"] != "succeeded" or not urls:
            raise TypeError("LOVO completed without usable audio URLs")
        for index, value in enumerate(urls):
            url = _url(value)
            if url.scheme != "https" and (url.scheme, url.hostname, 80 if url.port is None else url.port) != origin:
                raise TypeError("LOVO returned an unsafe audio URL")
            assets.append((value, output_index, index))
    for url, output_index, index in assets:
        # No API key, cookies, redirects or retries on provider-supplied assets.
        response = await transport.send(HttpRequest("GET", url, {}, b""))
        if not 200 <= response.status < 300:
            text = await _body_text(response, limit)
            headers = {key.lower(): value for key, value in response.headers.items()}
            raise LovoError(text or f"LOVO audio download returned HTTP {response.status}",
                            response.status, None, job_id, headers.get("retry-after"))
        async with aclosing(AudioStream(response.body)) as body:
            async for audio in body:
                yield {"correlation": "ordered", "correlation_id": f"{job_id}:{output_index}:{index}",
                       "input_group_id": f"{job_id}:{output_index}", "audio": audio, "timestamps": ()}
                await asyncio.sleep(0)


@asynccontextmanager
async def synthesize(request: TtsRequest, *, transport: HttpTransport, auth: Auth | None = None,
                     base_url: str = wire.DEFAULT_BASE_URL, mode: Literal["sync", "async"] = "sync",
                     poll_interval_ms: int = 1000, timeout_ms: int | None = None,
                     max_json_bytes: int = 16 * 1024 * 1024) -> AsyncIterator[AsyncIterator[SynthesisItem]]:
    """Use async with. Canceling stops polling/downloads, not the remote job.

    The injected transport must cooperate with cancellation, never follow
    redirects or retry requests, and not add cookies to asset downloads.
    """
    validate_request(request)
    if mode not in ("sync", "async"):
        raise TypeError("Invalid LOVO mode")
    for value in (poll_interval_ms, *(() if timeout_ms is None else (timeout_ms,))):
        if type(value) is not int or not 0 <= value <= 2147483647:
            raise TypeError("LOVO polling interval and timeout must be integers between 0 and 2147483647")
    if type(max_json_bytes) is not int or not 1 <= max_json_bytes <= 4294967295:
        raise TypeError("LOVO max_json_bytes must be a positive uint32 value")
    entry = auth.get("lovo") if auth is not None else None
    key = entry["api_key"] if entry is not None and "api_key" in entry else os.environ.get("SPEECHSWITCH_LOVO_API_KEY", os.environ.get("LOVO_API_KEY"))
    if not key:
        raise TypeError("Missing auth.lovo.apiKey configuration")
    if any(not 32 <= ord(c) <= 126 for c in key):
        raise TypeError("Invalid LOVO authentication header")
    base = _url(base_url)
    assert base.hostname is not None
    origin = (base.scheme, base.hostname, (443 if base.scheme == "https" else 80) if base.port is None else base.port)
    if timeout_ms == 0:
        raise TimeoutError("LOVO synthesis deadline expired")
    async with asyncio.timeout(None if timeout_ms is None else timeout_ms / 1000):
        async with aclosing(_items(request, transport, key, base_url, origin, mode, poll_interval_ms, max_json_bytes)) as items:
            yield items
