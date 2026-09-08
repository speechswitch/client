"""Mistral Voxtral's documented protocol; its partial OpenAPI is not codegen input."""

import asyncio
import base64
import json
import math
import os
import re
from collections.abc import AsyncGenerator, AsyncIterator, Mapping
from contextlib import aclosing, asynccontextmanager
from typing import NoReturn, cast
from urllib.parse import urlsplit, urlunsplit

from speechswitch.generated.auth import Auth
from speechswitch.generated.mistral import TtsRequest
from speechswitch.generated.mistral_output import PromptTokensDetails, PromptTokensDetailsMessagesItem, SynthesisItem, Usage
from speechswitch.generated.validators.mistral import REQUEST_DEFAULTS, validate_request
from speechswitch.http import AudioStream, HttpRequest, HttpResponse, HttpTransport
from speechswitch.sse import SseDecoder
from speechswitch.validation import is_mapping, is_sequence


class MistralError(Exception):
    def __init__(self, status_code: int, body: str, retry_after: str | None) -> None:
        self.status_code = status_code
        self.body = body
        self.retry_after = retry_after
        super().__init__(f"Mistral synthesis failed ({status_code})")


def _object(value: object) -> Mapping[object, object]:
    if not is_mapping(value):
        raise TypeError("Mistral returned an invalid response object")
    return value


def _count(value: object, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 9007199254740991 or not math.isfinite(value) or value % 1 != 0:
        raise TypeError(f"Mistral returned invalid {field}")
    return int(value)


def _audio_data(value: object) -> bytes:
    if not isinstance(value, str) or re.fullmatch(r"(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?", value) is None:
        raise TypeError("Mistral returned invalid base64 audio")
    return base64.b64decode(value, validate=True)


def _usage_message(value: object) -> PromptTokensDetailsMessagesItem:
    message = _object(value)
    role = message.get("role")
    if role != "system" and role != "user" and role != "assistant" and role != "tool":
        raise TypeError("Mistral returned invalid usage message role")
    truncated = message.get("truncated")
    if "truncated" in message and not isinstance(truncated, bool):
        raise TypeError("Mistral returned invalid usage truncated flag")
    return cast(PromptTokensDetailsMessagesItem, {
        "role": role,
        **({"total_tokens": None if message["total_tokens"] is None else _count(message["total_tokens"], "total_tokens")} if "total_tokens" in message else {}),
        **({"truncated": truncated} if isinstance(truncated, bool) else {}),
        **({"usage_count": _count(message["usage_count"], "usage_count")} if "usage_count" in message else {}),
    })


def _prompt_details(value: object) -> PromptTokensDetails:
    details = _object(value)
    messages = details.get("messages")
    if "messages" in details and not is_sequence(messages):
        raise TypeError("Mistral returned invalid usage messages")
    return cast(PromptTokensDetails, {
        **({"cached_tokens": _count(details["cached_tokens"], "cached_tokens")} if "cached_tokens" in details else {}),
        **({"audio_tokens": _count(details["audio_tokens"], "audio_tokens")} if "audio_tokens" in details else {}),
        **({"messages": [_usage_message(message) for message in messages]} if is_sequence(messages) else {}),
    })


def _usage(value: object) -> Usage:
    usage = _object(value)
    completion = usage.get("completion_tokens_details")
    details = None if completion is None else _object(completion)
    return cast(Usage, {
        **({"prompt_tokens": _count(usage["prompt_tokens"], "prompt_tokens")} if "prompt_tokens" in usage else {}),
        **({"completion_tokens": None if usage["completion_tokens"] is None else _count(usage["completion_tokens"], "completion_tokens")} if "completion_tokens" in usage else {}),
        **({"total_tokens": _count(usage["total_tokens"], "total_tokens")} if "total_tokens" in usage else {}),
        **({"prompt_audio_seconds": None if usage["prompt_audio_seconds"] is None else _count(usage["prompt_audio_seconds"], "prompt_audio_seconds")} if "prompt_audio_seconds" in usage else {}),
        **({"request_count": None if usage["request_count"] is None else _count(usage["request_count"], "request_count")} if "request_count" in usage else {}),
        **({"cached_tokens": None if usage["num_cached_tokens"] is None else _count(usage["num_cached_tokens"], "num_cached_tokens")} if "num_cached_tokens" in usage else {}),
        **({"prompt_tokens_details": None if usage["prompt_tokens_details"] is None else _prompt_details(usage["prompt_tokens_details"])} if "prompt_tokens_details" in usage else {}),
        **({"prompt_token_details": None if usage["prompt_token_details"] is None else _prompt_details(usage["prompt_token_details"])} if "prompt_token_details" in usage else {}),
        **({"completion_tokens_details": None if details is None else {**({"reasoning_tokens": _count(details["reasoning_tokens"], "reasoning_tokens")} if "reasoning_tokens" in details else {})}} if "completion_tokens_details" in usage else {}),
    })


def _invalid_constant(value: str) -> NoReturn:
    raise TypeError("Mistral returned invalid JSON")


async def _items(response: HttpResponse, body: AudioStream, max_event_bytes: int, max_json_bytes: int) -> AsyncGenerator[SynthesisItem, None]:
    headers = {name.lower(): value for name, value in response.headers.items()}
    content_type = headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if not 200 <= response.status < 300 or content_type == "application/json":
        data = bytearray()
        async for chunk in body:
            if len(data) + len(chunk) > max_json_bytes:
                raise TypeError("Mistral response exceeds max_json_bytes")
            data.extend(chunk)
        text = data.decode("utf-8", errors="replace")
        if not 200 <= response.status < 300:
            raise MistralError(response.status, text, headers.get("retry-after"))
        value: object = json.loads(text, parse_constant=_invalid_constant)
        audio = _audio_data(_object(value).get("audio_data"))
        if not audio:
            raise TypeError("Mistral returned no audio")
        yield audio
        yield {"event": "done"}
        return
    if content_type != "text/event-stream":
        raise TypeError("Mistral returned an unsupported response content type")
    decoder = SseDecoder(max_event_bytes)
    received_audio = False
    try:
        async for chunk in body:
            for byte in chunk:
                message = decoder.push(byte)
                if message is None:
                    continue
                value: object = json.loads(message["data"], parse_constant=_invalid_constant)
                packet = _object(value)
                kind = packet.get("type")
                if kind is None:
                    kind = message["event"]
                if message["event"] != "message" and message["event"] != kind:
                    raise TypeError("Mistral returned conflicting SSE event types")
                if kind == "speech.audio.delta":
                    audio = _audio_data(packet.get("audio_data"))
                    if audio:
                        received_audio = True
                        yield audio
                elif kind == "speech.audio.done":
                    usage = _usage(packet.get("usage"))
                    if not received_audio:
                        raise TypeError("Mistral returned no audio")
                    await body.aclose()
                    yield {"event": "done", "usage": usage}
                    return
                else:
                    raise TypeError("Mistral returned an unsupported speech event")
        raise TypeError("Mistral speech stream ended before speech.audio.done")
    finally:
        decoder.finish()


def _json_container(value: object) -> object:
    if is_mapping(value):
        return dict(value)
    if is_sequence(value):
        return list(value)
    raise TypeError("Mistral request contains unsupported JSON data")


@asynccontextmanager
async def synthesize(request: TtsRequest, *, transport: HttpTransport, auth: Auth | None = None,
                     base_url: str = "https://api.mistral.ai", timeout_ms: int | None = None,
                     max_event_bytes: int = 4 * 1024 * 1024, max_json_bytes: int = 16 * 1024 * 1024) -> AsyncIterator[AsyncIterator[SynthesisItem]]:
    """Use async with for deterministic cleanup, including early loop exit.

    The injected transport must return at headers, honor task cancellation and
    never redirect credential-bearing requests across origins. Deadlines cover
    the whole context, not just HTTP headers. Audio is always returned as bytes.
    """
    validate_request(request)
    key = (auth or {}).get("mistral", {}).get("api_key")
    if key is None:
        key = os.environ.get("SPEECHSWITCH_MISTRAL_API_KEY", os.environ.get("MISTRAL_API_KEY"))
    if not key:
        raise TypeError("Missing auth.mistral.apiKey configuration")
    if timeout_ms is not None and (type(timeout_ms) is not int or not 0 <= timeout_ms <= 2147483647):
        raise TypeError("Mistral timeout_ms must be an integer between 0 and 2147483647")
    if timeout_ms == 0:
        raise TimeoutError("Mistral synthesis deadline expired")
    for name, limit in [("max_event_bytes", max_event_bytes), ("max_json_bytes", max_json_bytes)]:
        if type(limit) is not int or limit <= 0:
            raise TypeError(f"Mistral {name} must be a positive integer")
    url = urlsplit(base_url)
    if url.scheme not in ("http", "https") or not url.hostname or url.username is not None or url.password is not None or url.fragment:
        raise TypeError("Mistral base_url must be an HTTP(S) URL without credentials or a fragment")
    target = urlunsplit((url.scheme, url.netloc, url.path.rstrip("/") + "/v1/audio/speech", url.query, ""))
    output = request.get("output")
    payload: dict[str, object] = {
        "model": request.get("model", REQUEST_DEFAULTS["model"]), "input": request["text"], "stream": True,
        "response_format": output["format"] if output is not None else "pcm",
        **({"voice_id": request["voice"]} if "voice" in request else {}),
        **({"ref_audio": base64.b64encode(request["reference_audio"]).decode("ascii")} if "reference_audio" in request else {}),
        **({"metadata": request["metadata"]} if "metadata" in request else {}),
        **({"prompt_cache_key": request["prompt_cache_key"]} if "prompt_cache_key" in request else {}),
    }
    wire = HttpRequest("POST", target, {"Authorization": f"Bearer {key}", "Content-Type": "application/json", "Accept": "text/event-stream, application/json"}, json.dumps(payload, allow_nan=False, default=_json_container, separators=(",", ":")).encode("utf-8"))
    async with asyncio.timeout(None if timeout_ms is None else timeout_ms / 1000):
        response = await transport.send(wire)
        body = AudioStream(response.body)
        try:
            async with aclosing(_items(response, body, max_event_bytes, max_json_bytes)) as items:
                yield items
        except BaseException:
            try:
                await body.aclose()
            except Exception:
                pass
            raise
        finally:
            await body.aclose()
