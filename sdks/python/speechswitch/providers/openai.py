"""OpenAI speech: normalized schema types over the generated speech wire client."""

import asyncio
import base64
import json
import os
import re
from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import aclosing, asynccontextmanager
from typing import NoReturn

from speechswitch.clients.openai import DEFAULT_BASE_URL, SPEECH_STATUS, SpeechRequest, create_speech, decode_speech_event
from speechswitch.generated.auth import Auth
from speechswitch.generated.openai import TtsRequest
from speechswitch.generated.openai_output import DoneEvent, SynthesisItem
from speechswitch.generated.validators.openai import REQUEST_DEFAULTS, validate_request
from speechswitch.http import AudioStream, HttpResponse, HttpTransport
from speechswitch.sse import SseDecoder


class OpenaiError(Exception):
    def __init__(self, status_code: int, body: str, request_id: str | None, retry_after: str | None) -> None:
        self.status_code = status_code
        self.body = body
        self.request_id = request_id
        self.retry_after = retry_after
        super().__init__(f"OpenAI speech failed ({status_code})")


def _invalid_constant(value: str) -> NoReturn:
    raise TypeError("OpenAI returned invalid JSON")


async def _items(response: HttpResponse, body: AudioStream, include_usage: bool,
                 max_event_bytes: int, max_json_bytes: int) -> AsyncGenerator[SynthesisItem, None]:
    headers = {name.lower(): value for name, value in response.headers.items()}
    request_id = headers.get("x-request-id")
    if response.status != SPEECH_STATUS:
        data = bytearray()
        async for chunk in body:
            if len(data) + len(chunk) > max_json_bytes:
                raise TypeError("OpenAI response exceeds max_json_bytes")
            data.extend(chunk)
        raise OpenaiError(response.status, data.decode("utf-8", errors="replace"), request_id, headers.get("retry-after"))
    content_type = headers.get("content-type", "").split(";", 1)[0].strip().lower()
    done: DoneEvent = {"event": "done"}
    if request_id is not None:
        done = {**done, "request_id": request_id}
    received_audio = False
    if include_usage:
        if content_type != "text/event-stream":
            raise TypeError("OpenAI returned no SSE usage stream")
        decoder = SseDecoder(max_event_bytes)
        try:
            async for chunk in body:
                for byte in chunk:
                    message = decoder.push(byte)
                    if message is None:
                        continue
                    value: object = json.loads(message["data"], parse_constant=_invalid_constant)
                    event = decode_speech_event(value)
                    if message["event"] != "message" and message["event"] != event["type"]:
                        raise TypeError("OpenAI returned conflicting SSE event types")
                    if event["type"] == "speech.audio.delta":
                        if re.fullmatch(r"(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?", event["audio"]) is None:
                            raise TypeError("OpenAI returned invalid base64 audio")
                        audio = base64.b64decode(event["audio"], validate=True)
                        if audio:
                            received_audio = True
                            yield audio
                    else:
                        if not received_audio:
                            raise TypeError("OpenAI returned no audio")
                        usage = event["usage"]
                        await body.aclose()
                        yield {**done, "usage": {"input_tokens": usage["input_tokens"], "output_tokens": usage["output_tokens"], "total_tokens": usage["total_tokens"]}}
                        return
            raise TypeError("OpenAI speech stream ended before speech.audio.done")
        finally:
            decoder.finish()
    if content_type and content_type != "application/octet-stream" and not content_type.startswith("audio/"):
        raise TypeError("OpenAI returned a non-audio response")
    async for audio in body:
        received_audio = True
        yield audio
    if not received_audio:
        raise TypeError("OpenAI returned no audio")
    yield done


@asynccontextmanager
async def synthesize(request: TtsRequest, *, transport: HttpTransport, auth: Auth | None = None,
                     base_url: str = DEFAULT_BASE_URL, timeout_ms: int | None = None,
                     max_event_bytes: int = 4 * 1024 * 1024, max_json_bytes: int = 16 * 1024 * 1024) -> AsyncIterator[AsyncIterator[SynthesisItem]]:
    """Use async with for deterministic cleanup, including early loop exit.

    The injected HTTP transport returns at headers, honors task cancellation,
    and rejects redirects and automatic retries. Deadlines cover the full context.
    Whole text is required; the speech endpoint has no native clear protocol.
    """
    validate_request(request)
    key = (auth or {}).get("openai", {}).get("api_key")
    if key is None:
        key = os.environ.get("SPEECHSWITCH_OPENAI_API_KEY", os.environ.get("OPENAI_API_KEY"))
    if not key:
        raise TypeError("Missing auth.openai.apiKey configuration")
    if timeout_ms is not None and (type(timeout_ms) is not int or not 0 <= timeout_ms <= 2147483647):
        raise TypeError("OpenAI timeout_ms must be an integer between 0 and 2147483647")
    if timeout_ms == 0:
        raise TimeoutError("OpenAI speech deadline expired")
    for name, limit in [("max_event_bytes", max_event_bytes), ("max_json_bytes", max_json_bytes)]:
        if type(limit) is not int or limit <= 0:
            raise TypeError(f"OpenAI {name} must be a positive integer")
    output = request.get("output")
    include_usage = request.get("include_usage", False)
    payload: SpeechRequest = {
        "model": request.get("model", "tts-1"), "input": request["text"],
        "voice": {"id": request["voice"]} if request.get("voice_source") == "custom" else request["voice"],
        "speed": request.get("speed", REQUEST_DEFAULTS["speed"]),
        "response_format": output["format"] if output is not None else "pcm",
        "stream_format": "sse" if include_usage else "audio",
    }
    instructions = request.get("instructions")
    if instructions is not None:
        payload["instructions"] = instructions
    async with asyncio.timeout(None if timeout_ms is None else timeout_ms / 1000):
        response = await create_speech(payload, api_key=key, base_url=base_url, transport=transport)
        body = AudioStream(response.body)
        try:
            async with aclosing(_items(response, body, include_usage, max_event_bytes, max_json_bytes)) as items:
                yield items
        except BaseException:
            try:
                await body.aclose()
            except Exception:
                pass
            raise
        finally:
            await body.aclose()
