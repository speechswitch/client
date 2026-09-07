"""Chatterbox's deployed Gradio upload, queue and completed-file protocol."""

import asyncio
import json
import os
import re
import secrets
from collections.abc import AsyncGenerator, AsyncIterator, Mapping
from contextlib import aclosing, asynccontextmanager
from typing import NoReturn
from urllib.parse import SplitResult, quote, urljoin, urlsplit

from speechswitch.generated.auth import Auth
from speechswitch.generated.resemble import TtsRequest
from speechswitch.generated.resemble_output import SynthesisItem
from speechswitch.generated.validators.resemble import REQUEST_DEFAULTS, validate_request
from speechswitch.http import AudioStream, HttpRequest, HttpResponse, HttpTransport
from speechswitch.sse import SseDecoder
from speechswitch.validation import is_mapping, is_sequence


class ResembleError(Exception):
    def __init__(self, status_code: int | None, body: str, request_id: str | None,
                 retry_after: str | None = None) -> None:
        self.status_code, self.body = status_code, body
        self.request_id, self.retry_after = request_id, retry_after
        super().__init__("Resemble Chatterbox generation failed" if status_code is None
                         else f"Resemble Chatterbox returned HTTP {status_code}")


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
        raise TypeError("Invalid Resemble deployment or audio URL") from None


def _endpoint(base: SplitResult, path: str) -> str:
    return base._replace(path=base.path.rstrip("/") + "/gradio_api/" + path).geturl()


def _invalid_constant(_: str) -> NoReturn:
    raise ValueError()


def _json(text: str) -> object:
    try:
        return json.loads(text, parse_constant=_invalid_constant)
    except (ValueError, RecursionError):
        raise TypeError("Resemble returned invalid JSON") from None


async def _text(body: AudioStream, limit: int) -> str:
    data = bytearray()
    async for chunk in body:
        if len(chunk) > limit - len(data):
            raise TypeError("Resemble response exceeds max_json_bytes")
        data.extend(chunk)
        await asyncio.sleep(0)
    return data.decode("utf-8-sig", errors="replace")


@asynccontextmanager
async def _response(transport: HttpTransport, request: HttpRequest, request_id: str | None,
                    limit: int) -> AsyncIterator[tuple[HttpResponse, AudioStream]]:
    response = await transport.send(request)
    body = AudioStream(response.body)
    try:
        if not 200 <= response.status < 300:
            headers = {key.lower(): value for key, value in response.headers.items()}
            raise ResembleError(response.status, await _text(body, limit), request_id, headers.get("retry-after"))
        yield response, body
    except BaseException:
        try:
            await body.aclose()
        except Exception:
            pass
        raise
    finally:
        await body.aclose()


def _file(value: object) -> tuple[str, str | None]:
    if not is_mapping(value):
        raise TypeError("Resemble returned an invalid audio file")
    path, url, meta = value.get("path"), value.get("url"), value.get("meta")
    if (not isinstance(path, str) or not path or (url is not None and not isinstance(url, str))
            or ("is_stream" in value and value["is_stream"] is not False)
            or ("meta" in value and (not is_mapping(meta) or meta.get("_type") != "gradio.FileData"))):
        raise TypeError("Resemble returned an invalid audio file")
    return path, url


def _default_reference(info: object) -> str:
    if is_mapping(info):
        endpoints = info.get("named_endpoints")
        generate = endpoints.get("/generate") if is_mapping(endpoints) else None
        parameters = generate.get("parameters") if is_mapping(generate) else None
        if is_sequence(parameters) and len(parameters) > 1:
            parameter = parameters[1]
            if is_mapping(parameter) and parameter.get("parameter_name") == "audio_prompt_path" and "parameter_default" in parameter:
                # /info replaces the URL with a generic sample. Only its cached
                # path identifies this deployment's current reference recording.
                return _file(parameter["parameter_default"])[0]
    raise TypeError("Resemble returned no default reference recording")


async def _completed_file(body: AudioStream, request_id: str, limit: int) -> tuple[str, str | None]:
    decoder = SseDecoder(limit)
    try:
        async for chunk in body:
            for index, byte in enumerate(chunk):
                if index and index % 8192 == 0:
                    await asyncio.sleep(0)
                message = decoder.push(byte)
                if message is None or message["event"] == "heartbeat":
                    continue
                if message["event"] == "error":
                    raise ResembleError(None, message["data"], request_id)
                if message["event"] != "complete":
                    raise TypeError(f"Unexpected Resemble event: {message['event']}")
                output = _json(message["data"])
                if not is_sequence(output) or len(output) != 1:
                    raise TypeError("Resemble returned an invalid output list")
                return _file(output[0])
            await asyncio.sleep(0)
        raise TypeError("Resemble event stream ended before completion")
    finally:
        decoder.finish()


async def _items(data: list[object], reference_audio: bytes | None, needs_reference: bool,
                 api_name: str, base: SplitResult, headers: Mapping[str, str],
                 transport: HttpTransport, max_event_bytes: int, max_json_bytes: int) -> AsyncGenerator[SynthesisItem, None]:
    reference: str | None = None
    if reference_audio is not None:
        boundary = "speechswitch-" + secrets.token_hex(16)
        while boundary.encode() in reference_audio:
            boundary += "-"
        upload = (f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="reference.audio"\r\n'
                  'Content-Type: application/octet-stream\r\n\r\n').encode() + reference_audio + f"\r\n--{boundary}--\r\n".encode()
        async with _response(transport, HttpRequest("POST", _endpoint(base, "upload"),
                             {**headers, "Content-Type": f"multipart/form-data; boundary={boundary}"}, upload), None, max_json_bytes) as (_, body):
            uploaded = _json(await _text(body, max_json_bytes))
        if not is_sequence(uploaded) or len(uploaded) != 1 or not isinstance(uploaded[0], str) or not uploaded[0]:
            raise TypeError("Resemble returned an invalid upload path")
        reference = uploaded[0]
    elif needs_reference:
        async with _response(transport, HttpRequest("GET", _endpoint(base, "info"), headers, b""), None, max_json_bytes) as (_, body):
            reference = _default_reference(_json(await _text(body, max_json_bytes)))
    if reference is not None:
        data[1] = {"path": reference, "meta": {"_type": "gradio.FileData"}}
    payload = json.dumps({"data": data}, separators=(",", ":"), allow_nan=False).encode()
    async with _response(transport, HttpRequest("POST", _endpoint(base, f"call/{api_name}"),
                         {**headers, "Content-Type": "application/json"}, payload), None, max_json_bytes) as (_, body):
        submitted = _json(await _text(body, max_json_bytes))
    request_id = submitted.get("event_id") if is_mapping(submitted) else None
    if not isinstance(request_id, str) or not request_id or request_id in (".", ".."):
        raise TypeError("Resemble returned an invalid event ID")
    queue_url = _endpoint(base, "call/" + api_name + "/" + quote(request_id, safe="~!*().'"))
    async with _response(transport, HttpRequest("GET", queue_url, headers, b""), request_id, max_json_bytes) as (response, body):
        response_headers = {key.lower(): value for key, value in response.headers.items()}
        if response_headers.get("content-type", "").split(";", 1)[0].strip().lower() != "text/event-stream":
            raise TypeError("Resemble returned no event stream")
        path, url = await _completed_file(body, request_id, max_event_bytes)
    # Close the queue before opening the completed file; queue EOF is not needed.
    if url and any(ord(c) <= 32 or ord(c) == 127 or c == "\\" for c in url):
        raise TypeError("Invalid Resemble deployment or audio URL")
    asset = _url(urljoin(base.geturl(), url) if url else _endpoint(base, "file=" + quote(path, safe="~!*().'")))
    same_origin = (asset.scheme, asset.hostname, asset.port if asset.port is not None else (443 if asset.scheme == "https" else 80)) == (
        base.scheme, base.hostname, base.port if base.port is not None else (443 if base.scheme == "https" else 80))
    if asset.scheme != "https" and not same_origin:
        raise TypeError("Resemble returned an unsafe audio URL")
    async with _response(transport, HttpRequest("GET", asset.geturl(), headers if same_origin else {}, b""), request_id, max_json_bytes) as (response, body):
        response_headers = {key.lower(): value for key, value in response.headers.items()}
        content_type = response_headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if content_type and content_type != "application/octet-stream" and not content_type.startswith("audio/"):
            raise TypeError("Resemble returned no audio stream")
        received = False
        async for audio in body:
            received = True
            yield audio
            await asyncio.sleep(0)
        if not received:
            raise TypeError("Resemble returned empty audio")
    yield {"event": "done", "request_id": request_id}


@asynccontextmanager
async def synthesize(request: TtsRequest, *, transport: HttpTransport, auth: Auth | None = None,
                     base_url: str | None = None, timeout_ms: int | None = None,
                     max_event_bytes: int = 4 * 1024 * 1024, max_json_bytes: int = 16 * 1024 * 1024) -> AsyncIterator[AsyncIterator[SynthesisItem]]:
    """Use async with. Generation completes before incremental file download.

    Supply a cancellation-cooperative HTTP transport that rejects redirects and
    retries, and adds no cookies or credentials to off-origin file requests.
    Task cancellation/deadlines release local requests, not the remote GPU job.
    """
    validate_request(request)
    model = request.get("model", "chatterbox")
    base = _url(base_url if base_url is not None else (
        "https://resembleai-chatterbox.hf.space" if model == "chatterbox" else
        "https://resembleai-chatterbox-multilingual-tts-v3.hf.space" if model == "chatterbox-multilingual" else
        "https://resembleai-chatterbox-turbo-demo.hf.space"))
    base = base._replace(path=base.path.rstrip("/") + "/")
    token = (auth or {}).get("resemble", {}).get("token")
    if token is None:
        token = os.environ.get("SPEECHSWITCH_RESEMBLE_TOKEN", os.environ.get("HF_TOKEN", ""))
    if any(ord(c) < 32 or ord(c) > 126 for c in token):
        raise TypeError("Invalid Resemble token")
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    if timeout_ms is not None and (type(timeout_ms) is not int or not 0 <= timeout_ms <= 2147483647):
        raise TypeError("Resemble timeout_ms must be an integer between 0 and 2147483647")
    if timeout_ms == 0:
        raise TimeoutError("Resemble synthesis deadline expired")
    for name, limit in [("max_event_bytes", max_event_bytes), ("max_json_bytes", max_json_bytes)]:
        if type(limit) is not int or limit <= 0:
            raise TypeError(f"Resemble {name} must be a positive integer")
    temperature, seed = request.get("temperature", REQUEST_DEFAULTS["temperature"]), request.get("random_seed", REQUEST_DEFAULTS["random_seed"])
    data: list[object]
    if model == "chatterbox-turbo":
        data = [request["text"], None, temperature, seed, request.get("min_p", 0), request.get("top_p", 0.95),
                request.get("top_k", 1000), request.get("repetition_penalty", 1.2), request.get("loudness_normalization", True)]
    elif model == "chatterbox-multilingual":
        data = [request["text"], None, request.get("language", "en"), request.get("style_exaggeration", 0.5), temperature, seed, request.get("voice_guidance", 0.5)]
    else:
        data = [request["text"], None, request.get("style_exaggeration", 0.5), temperature, seed, request.get("voice_guidance", 0.5), request.get("reference_audio_trimming", False)]
    async with asyncio.timeout(None if timeout_ms is None else timeout_ms / 1000):
        async with aclosing(_items(data, request.get("reference_audio"), model == "chatterbox-turbo",
                                  "generate" if model == "chatterbox-turbo" else "generate_tts_audio", base, headers,
                                  transport, max_event_bytes, max_json_bytes)) as items:
            yield items
