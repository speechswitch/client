import asyncio
import json
import os
import re
import unittest
from collections.abc import AsyncIterator, Sequence
from pathlib import Path
from types import MappingProxyType
from typing import cast
from unittest.mock import patch

from speechswitch.clients.openai import decode_speech_event, is_speech_request
from speechswitch.generated.auth import Auth
from speechswitch.generated.openai import TtsRequest
from speechswitch.generated.openai_output import SynthesisItem
from speechswitch.generated.validators.openai import validate_request
from speechswitch.http import HttpRequest, HttpResponse
from speechswitch.providers.openai import OpenaiError, synthesize
from speechswitch.validation import is_mapping, is_sequence


class Body:
    def __init__(self, chunks: Sequence[bytes | Exception], *, stall: bool = False, close_error: Exception | None = None) -> None:
        self.chunks = iter(chunks)
        self.reads = 0
        self.closes = 0
        self.stall = stall
        self.close_error = close_error
        self.reading = asyncio.Event()

    def __aiter__(self) -> AsyncIterator[bytes]:
        return self

    async def __anext__(self) -> bytes:
        self.reads += 1
        value = next(self.chunks, None)
        if value is None:
            if self.stall:
                self.reading.set()
                await asyncio.Future[None]()
            raise StopAsyncIteration
        if isinstance(value, Exception):
            raise value
        return value

    async def aclose(self) -> None:
        self.closes += 1
        if self.close_error is not None:
            raise self.close_error


class Transport:
    def __init__(self, body: Body, *, content_type: str | None = "application/octet-stream", status: int = 200, request_id: str | None = "req-test") -> None:
        self.body = body
        self.content_type = content_type
        self.status = status
        self.request_id = request_id
        self.requests: list[HttpRequest] = []

    async def send(self, request: HttpRequest) -> HttpResponse:
        self.requests.append(request)
        headers = {"Retry-After": "7"}
        if self.content_type is not None:
            headers["CONTENT-Type"] = self.content_type
        if self.request_id is not None:
            headers["X-Request-ID"] = self.request_id
        return HttpResponse(self.status, headers, self.body)


def python_names(value: object) -> object:
    if is_mapping(value):
        return {re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", str(key)).lower(): python_names(child) for key, child in value.items()}
    if is_sequence(value):
        return [python_names(child) for child in value]
    return value


AUTH: Auth = {"openai": {"api_key": "test"}}
LEGACY: TtsRequest = {"text": "Hello", "voice": "alloy"}
MINI: TtsRequest = {"text": "Hello", "voice": "cedar", "model": "gpt-4o-mini-tts", "include_usage": True}
DELTA = b'data: {"type":"speech.audio.delta","audio":"AP+A"}\n\n'
DONE = b'data: {"type":"speech.audio.done","usage":{"input_tokens":0,"output_tokens":1,"total_tokens":1}}\n\n'


class OpenaiTests(unittest.IsolatedAsyncioTestCase):
    async def test_shared_requests_and_native_conversion(self) -> None:
        fixtures: dict[str, list[dict[str, object]]] = json.loads((Path(__file__).parents[2] / "fixtures/openai.json").read_text())
        for fixture in fixtures["requests"]:
            request = cast(TtsRequest, python_names(fixture["request"]))
            transport = Transport(Body([DELTA, DONE] if request.get("include_usage") else [b"\x00\xff\x80"]), content_type="text/event-stream" if request.get("include_usage") else "audio/pcm")
            async with synthesize(request, transport=transport, auth=AUTH, base_url="https://proxy.test/prefix/v1/?tenant=one;two&x=%2F") as audio:
                result = [item async for item in audio]
            self.assertEqual(result[0], bytes([0, 255, 128]))
            wire = transport.requests[0]
            self.assertEqual(json.loads(wire.body), fixture["wire"])
            self.assertEqual(wire.url, "https://proxy.test/prefix/v1/audio/speech?tenant=one;two&x=%2F")
            self.assertEqual(wire.method, "POST")
            self.assertEqual(wire.headers, {"Authorization": "Bearer test", "Content-Type": "application/json", "Accept": "application/octet-stream, text/event-stream"})
            self.assertEqual(transport.body.closes, 1)

    async def test_shared_streams_at_every_byte_split(self) -> None:
        fixtures: dict[str, list[dict[str, object]]] = json.loads((Path(__file__).parents[2] / "fixtures/openai.json").read_text())
        for fixture in fixtures["streams"]:
            text = fixture["body"]
            assert isinstance(text, str)
            data = text.encode()
            for split in range(len(data) + 1):
                with self.subTest(name=fixture["name"], split=split):
                    body = Body([data[:split], data[split:]])
                    output: list[object] = []
                    error: str | None = None
                    try:
                        async with synthesize(MINI, transport=Transport(body, content_type="text/event-stream", request_id=""), auth=AUTH) as audio:
                            async for item in audio:
                                output.append({"audio": list(item)} if isinstance(item, bytes) else item)
                    except TypeError as failure:
                        error = str(failure)
                    self.assertEqual(output, python_names(fixture["output"]))
                    self.assertEqual(error, fixture["error"])
                    self.assertEqual(body.closes, 1)

    async def test_binary_streams_before_eof_and_closes_early(self) -> None:
        for read in [False, True]:
            body = Body([b"", b"first"], stall=True)
            async with synthesize(LEGACY, transport=Transport(body), auth=AUTH) as audio:
                if read:
                    self.assertEqual(await anext(audio), b"first")
                    self.assertEqual(body.reads, 2)
            self.assertEqual(body.reads, 2 if read else 0)
            self.assertEqual(body.closes, 1)

    async def test_done_closes_without_waiting_for_socket_eof_or_reading_tail(self) -> None:
        body = Body([DELTA + DONE + b"broken trailing data"], stall=True)
        async with synthesize(MINI, transport=Transport(body, content_type="text/event-stream"), auth=AUTH) as audio:
            self.assertEqual(await anext(audio), b"\x00\xff\x80")
            self.assertEqual(body.closes, 0)
            self.assertEqual(await anext(audio), {"event": "done", "request_id": "req-test", "usage": {"input_tokens": 0, "output_tokens": 1, "total_tokens": 1}})
            self.assertEqual(body.closes, 1)
            self.assertEqual([item async for item in audio], [])
        self.assertEqual(body.reads, 1)

    async def test_all_formats_and_explicit_pcm_traits(self) -> None:
        for format in ["pcm", "mp3", "wav", "flac", "aac", "opus"]:
            request = cast(TtsRequest, {"text": "Hello", "voice": "alloy", "output": {"format": format}})
            body = Body([b"audio"])
            transport = Transport(body)
            async with synthesize(request, transport=transport, auth=AUTH) as audio:
                self.assertEqual([item async for item in audio], [b"audio", {"event": "done", "request_id": "req-test"}])
            self.assertEqual(json.loads(transport.requests[0].body)["response_format"], format)
        transport = Transport(Body([]))
        async with synthesize({"text": "Hello", "voice": "alloy", "output": {"format": "pcm", "sample_rate_hz": 24000, "sample_encoding": "signed_integer_16", "byte_order": "little_endian", "channel_count": 1}}, transport=transport, auth=AUTH):
            pass
        self.assertEqual(json.loads(transport.requests[0].body), {"model": "tts-1", "input": "Hello", "voice": "alloy", "response_format": "pcm", "speed": 1, "stream_format": "audio"})

    async def test_schema_rejects_model_capabilities_before_io(self) -> None:
        invalid: list[object] = [
            {**LEGACY, "instructions": "Whisper"}, {**LEGACY, "include_usage": False},
            {**LEGACY, "voice": "cedar"}, {**LEGACY, "voice_source": "custom"},
            {**LEGACY, "text": ["Hello"]}, {**LEGACY, "model": "unknown"},
            {**LEGACY, "speed": True}, {**LEGACY, "speed": 0}, {**LEGACY, "speed": 4.01},
            {**LEGACY, "speed": float("nan")}, {**LEGACY, "speed": None},
            {**LEGACY, "output": {"format": "pcm", "sample_rate_hz": 48000}},
            {**LEGACY, "output": {"format": "mp3", "sample_rate_hz": 24000}},
            {**LEGACY, "text": "😀" * 4097}, {**MINI, "instructions": "a" * 4097},
            {**MINI, "voice": "saved-id"}, {**MINI, "language": "auto"},
            {**MINI, "timestamp_granularity": "word"}, {**MINI, "reference_audio": b"audio"},
        ]
        for request in invalid:
            transport = Transport(Body([]))
            with self.assertRaises(TypeError) as expected:
                validate_request(request)
            with self.assertRaises(TypeError) as error:
                async with synthesize(cast(TtsRequest, request), transport=transport, auth=AUTH):
                    self.fail("invalid request reached transport")
            self.assertEqual(error.exception.args, expected.exception.args)
            self.assertEqual(transport.requests, [])

    async def test_code_point_limit_and_readonly_mappings(self) -> None:
        request = cast(TtsRequest, MappingProxyType({"model": "gpt-4o-mini-tts", "text": "😀" * 4096, "voice": "unprefixed", "voice_source": "custom", "instructions": "", "include_usage": False, "output": MappingProxyType({"format": "pcm"})}))
        transport = Transport(Body([]))
        async with synthesize(request, transport=transport, auth=AUTH):
            pass
        self.assertEqual(json.loads(transport.requests[0].body), {"model": "gpt-4o-mini-tts", "input": "😀" * 4096, "voice": {"id": "unprefixed"}, "instructions": "", "response_format": "pcm", "speed": 1, "stream_format": "audio"})

    async def test_auth_precedence_empty_values_and_missing_configuration(self) -> None:
        cases: list[tuple[Auth | None, dict[str, str], str | None]] = [
            (AUTH, {"SPEECHSWITCH_OPENAI_API_KEY": "scoped", "OPENAI_API_KEY": "legacy"}, "test"),
            (None, {"SPEECHSWITCH_OPENAI_API_KEY": "scoped", "OPENAI_API_KEY": "legacy"}, "scoped"),
            (None, {"OPENAI_API_KEY": "legacy"}, "legacy"),
            ({"openai": {"api_key": ""}}, {"OPENAI_API_KEY": "legacy"}, None),
            (None, {"SPEECHSWITCH_OPENAI_API_KEY": "", "OPENAI_API_KEY": "legacy"}, None),
            (None, {}, None),
        ]
        for auth, environment, expected in cases:
            transport = Transport(Body([]))
            with patch.dict(os.environ, environment, clear=True):
                if expected is None:
                    with self.assertRaises(TypeError) as error:
                        async with synthesize(LEGACY, transport=transport, auth=auth):
                            self.fail("missing auth reached transport")
                    self.assertEqual(str(error.exception), "Missing auth.openai.apiKey configuration")
                    self.assertEqual(transport.requests, [])
                else:
                    async with synthesize(LEGACY, transport=transport, auth=auth):
                        pass
                    self.assertEqual(transport.requests[0].headers["Authorization"], f"Bearer {expected}")

    async def test_invalid_url_and_limits_before_io(self) -> None:
        for url in ["ws://api.test", "https://user:pass@api.test", "https://api.test/#fragment", "relative/path", "https://"]:
            transport = Transport(Body([]))
            with self.assertRaises(TypeError) as error:
                async with synthesize(LEGACY, transport=transport, auth=AUTH, base_url=url):
                    self.fail("invalid URL reached transport")
            self.assertEqual(str(error.exception), "Invalid OpenAI base_url")
            self.assertEqual(transport.requests, [])
        for timeout in [-1, True, 1.5, 2147483648]:
            transport = Transport(Body([]))
            with self.assertRaises(TypeError) as error:
                async with synthesize(LEGACY, transport=transport, auth=AUTH, timeout_ms=cast(int, timeout)):
                    self.fail("invalid timeout reached transport")
            self.assertEqual(str(error.exception), "OpenAI timeout_ms must be an integer between 0 and 2147483647")
            self.assertEqual(transport.requests, [])
        for limit in [0, -1, True, 1.5]:
            transport = Transport(Body([]))
            for field in ["max_event_bytes", "max_json_bytes"]:
                with self.assertRaises(TypeError) as error:
                    async with synthesize(LEGACY, transport=transport, auth=AUTH,
                                          max_event_bytes=cast(int, limit) if field == "max_event_bytes" else 1024,
                                          max_json_bytes=cast(int, limit) if field == "max_json_bytes" else 1024):
                        self.fail("invalid limit reached transport")
                self.assertEqual(str(error.exception), f"OpenAI {field} must be a positive integer")
            self.assertEqual(transport.requests, [])

    async def test_zero_deadline_prevents_io(self) -> None:
        transport = Transport(Body([]))
        with self.assertRaises(TimeoutError) as error:
            async with synthesize(LEGACY, transport=transport, auth=AUTH, timeout_ms=0):
                self.fail("zero deadline reached transport")
        self.assertEqual(str(error.exception), "OpenAI speech deadline expired")
        self.assertEqual(transport.requests, [])

    async def test_pending_headers_cancel_and_deadline(self) -> None:
        for deadline in [False, True]:
            started, released = asyncio.Event(), asyncio.Event()
            class PendingTransport:
                async def send(self, request: HttpRequest) -> HttpResponse:
                    started.set()
                    try:
                        await asyncio.Future[None]()
                        raise AssertionError("unexpected headers")
                    finally:
                        released.set()
            async def consume() -> None:
                async with synthesize(LEGACY, transport=PendingTransport(), auth=AUTH, timeout_ms=20 if deadline else None):
                    self.fail("unexpected context")
            task = asyncio.create_task(consume())
            await started.wait()
            if not deadline:
                task.cancel()
            with self.assertRaises(TimeoutError if deadline else asyncio.CancelledError):
                await task
            self.assertTrue(released.is_set())

    async def test_pending_body_cancel_and_deadline_in_binary_sse_and_error(self) -> None:
        for request, content_type, status in [(LEGACY, "audio/pcm", 200), (MINI, "text/event-stream", 200), (LEGACY, "application/json", 429)]:
            for deadline in [False, True]:
                body = Body([], stall=True)
                async def consume() -> list[SynthesisItem]:
                    async with synthesize(request, transport=Transport(body, content_type=content_type, status=status), auth=AUTH, timeout_ms=20 if deadline else None) as audio:
                        return [item async for item in audio]
                task = asyncio.create_task(consume())
                await body.reading.wait()
                if not deadline:
                    task.cancel()
                with self.assertRaises(TimeoutError if deadline else asyncio.CancelledError):
                    await task
                self.assertEqual(body.closes, 1)

    async def test_deadline_covers_consumer_pause_and_closes_unread_body(self) -> None:
        body = Body([])
        with self.assertRaises(TimeoutError):
            async with synthesize(LEGACY, transport=Transport(body), auth=AUTH, timeout_ms=20):
                await asyncio.Future[None]()
        self.assertEqual((body.reads, body.closes), (0, 1))

    async def test_buffered_responses_allow_scheduled_cancellation(self) -> None:
        class BufferedBody(Body):
            async def __anext__(self) -> bytes:
                chunk = await super().__anext__()
                if self.reads == 1:
                    task = asyncio.current_task()
                    assert task is not None
                    loop = asyncio.get_running_loop()
                    loop.call_soon(loop.call_soon, task.cancel)
                return chunk

        for request, content_type, status, chunks in [
            (LEGACY, "audio/pcm", 200, [b"audio"] * 32),
            (LEGACY, "application/json", 429, [b"error"] * 32),
            (MINI, "text/event-stream", 200, [b":\n\n"] * 32 + [DELTA, DONE]),
            (MINI, "text/event-stream", 200, [b":\n\n" * 16384 + DELTA + DONE]),
        ]:
            with self.subTest(content_type=content_type, chunks=len(chunks)):
                body = BufferedBody(chunks)
                async def consume() -> list[SynthesisItem]:
                    async with synthesize(request, transport=Transport(body, content_type=content_type, status=status), auth=AUTH) as audio:
                        return [item async for item in audio]
                task = asyncio.create_task(consume())
                with self.assertRaises(asyncio.CancelledError):
                    await task
                self.assertEqual(body.closes, 1)

    async def test_read_error_and_consumer_error_survive_cleanup_failure(self) -> None:
        for reading in [False, True]:
            failure = OSError("original failure")
            body = Body([failure], close_error=OSError("cleanup failure"))
            with self.assertRaises(OSError) as error:
                async with synthesize(LEGACY, transport=Transport(body), auth=AUTH) as audio:
                    if reading:
                        await anext(audio)
                    else:
                        raise failure
            self.assertIs(error.exception, failure)
            self.assertEqual(body.closes, 1)

    async def test_exact_status_error_metadata_and_bounded_body(self) -> None:
        for status in [201, 302, 401, 429, 500]:
            body = Body([b"native ", b"\xfferror"])
            with self.assertRaises(OpenaiError) as error:
                async with synthesize(LEGACY, transport=Transport(body, status=status), auth=AUTH) as audio:
                    await anext(audio)
            self.assertEqual((str(error.exception), error.exception.status_code, error.exception.body, error.exception.request_id, error.exception.retry_after), (f"OpenAI speech failed ({status})", status, "native \ufffderror", "req-test", "7"))
            self.assertEqual(body.closes, 1)
        body = Body([b"123", b"45"], stall=True)
        with self.assertRaises(TypeError) as error:
            async with synthesize(LEGACY, transport=Transport(body, status=400), auth=AUTH, max_json_bytes=4) as audio:
                await anext(audio)
        self.assertEqual(str(error.exception), "OpenAI response exceeds max_json_bytes")
        self.assertEqual((body.reads, body.closes), (2, 1))

    async def test_content_type_no_audio_and_missing_request_id(self) -> None:
        for content_type in [None, "application/octet-stream", "AUDIO/PCM; charset=binary"]:
            async with synthesize(LEGACY, transport=Transport(Body([b"audio"]), content_type=content_type, request_id=None), auth=AUTH) as audio:
                self.assertEqual([item async for item in audio], [b"audio", {"event": "done"}])
        cases: list[tuple[TtsRequest, str, list[bytes | Exception], str]] = [
            (LEGACY, "application/json", [b"{}"], "OpenAI returned a non-audio response"),
            (MINI, "audio/pcm", [b"audio"], "OpenAI returned no SSE usage stream"),
            (LEGACY, "audio/pcm", [b""], "OpenAI returned no audio"),
        ]
        for request, content_type, chunks, message in cases:
            body = Body(chunks)
            with self.assertRaises(TypeError) as error:
                async with synthesize(request, transport=Transport(body, content_type=content_type), auth=AUTH) as audio:
                    await anext(audio)
            self.assertEqual(str(error.exception), message)
            self.assertEqual(body.closes, 1)

    async def test_event_limit_counts_comments_and_ignores_trailing_data_after_done(self) -> None:
        body = Body([b":" + b"x" * 32])
        with self.assertRaises(ValueError) as error:
            async with synthesize(MINI, transport=Transport(body, content_type="text/event-stream"), auth=AUTH, max_event_bytes=16) as audio:
                await anext(audio)
        self.assertEqual(str(error.exception), "SSE event exceeds byte limit")
        self.assertEqual(body.closes, 1)

    async def test_invalid_json_and_unknown_events_release_response(self) -> None:
        for text, message in [(b'NaN', "OpenAI returned invalid JSON"), (b'{"type":"unknown"}', "Invalid OpenAI speech event"), (b'null', "Invalid OpenAI speech event"), (b'[]', "Invalid OpenAI speech event")]:
            body = Body([b"data: " + text + b"\n\n"])
            with self.assertRaises(TypeError) as error:
                async with synthesize(MINI, transport=Transport(body, content_type="text/event-stream"), auth=AUTH) as audio:
                    await anext(audio)
            self.assertEqual(str(error.exception), message)
            self.assertEqual(body.closes, 1)
        body = Body([b"data: {broken}\n\n"])
        with self.assertRaises(json.JSONDecodeError):
            async with synthesize(MINI, transport=Transport(body, content_type="text/event-stream"), auth=AUTH) as audio:
                await anext(audio)
        self.assertEqual(body.closes, 1)

    def test_generated_wire_checks_types_without_inventing_undocumented_bounds(self) -> None:
        for count in [True, None, 0.5, float("nan"), float("inf"), 9007199254740992]:
            with self.assertRaises(TypeError) as error:
                decode_speech_event({"type": "speech.audio.done", "usage": {"input_tokens": count, "output_tokens": 1, "total_tokens": 1}})
            self.assertEqual(str(error.exception), "Invalid OpenAI speech event")
        event = {"type": "speech.audio.done", "usage": {"input_tokens": -1, "output_tokens": 1.0, "total_tokens": 0}, "future": True}
        self.assertEqual(decode_speech_event(event), event)
        self.assertFalse(is_speech_request({"input": "Hello", "model": "tts-1", "voice": "alloy", "instructions": None}))
        self.assertTrue(is_speech_request({"input": "\ud83d\ude00" * 4096, "model": "future-model", "voice": {"id": "saved"}}))


if __name__ == "__main__":
    unittest.main()
