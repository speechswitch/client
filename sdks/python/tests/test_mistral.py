import asyncio
import json
import os
from pathlib import Path
import re
from types import MappingProxyType
from typing import cast
import unittest
from collections.abc import AsyncIterator
from unittest.mock import patch

from speechswitch.generated.auth import Auth
from speechswitch.generated.mistral import TtsRequest
from speechswitch.generated.mistral_output import SynthesisItem
from speechswitch.http import HttpRequest, HttpResponse
from speechswitch.providers.mistral import MistralError, synthesize
from speechswitch.validation import is_mapping, is_sequence


class Body:
    def __init__(self, chunks: list[bytes | Exception], stall: bool = False) -> None:
        self.chunks = iter(chunks)
        self.reads = 0
        self.closes = 0
        self.stall = stall
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


class Transport:
    def __init__(self, body: Body, content_type: str = "text/event-stream", status: int = 200) -> None:
        self.body = body
        self.content_type = content_type
        self.status = status
        self.requests: list[HttpRequest] = []

    async def send(self, request: HttpRequest) -> HttpResponse:
        self.requests.append(request)
        return HttpResponse(self.status, {"Content-Type": self.content_type, "Retry-After": "7"}, self.body)


def python_names(value: object) -> object:
    if is_mapping(value):
        return {re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", str(key)).lower(): python_names(child) for key, child in value.items()}
    if is_sequence(value):
        return [python_names(child) for child in value]
    return value


AUTH: Auth = {"mistral": {"api_key": "test"}}
DELTA = b'data: {"type":"speech.audio.delta","audio_data":"AP+A"}\n\n'
DONE = b'data: {"type":"speech.audio.done","usage":{}}\n\n'


class MistralTests(unittest.IsolatedAsyncioTestCase):
    async def test_all_formats_and_schema_rejection_before_transport(self) -> None:
        requests: list[TtsRequest] = [
            {"text": "Hello", "output": {"format": "pcm"}},
            {"text": "Hello", "output": {"format": "wav"}},
            {"text": "Hello", "output": {"format": "mp3"}},
            {"text": "Hello", "output": {"format": "flac"}},
            {"text": "Hello", "output": {"format": "opus"}},
        ]
        for request in requests:
            transport = Transport(Body([]))
            async with synthesize(request, transport=transport, auth=AUTH):
                pass
            self.assertEqual(json.loads(transport.requests[0].body)["response_format"], request.get("output", {"format": "pcm"})["format"])
        invalid_requests: list[object] = [{"text": []}, {"text": "Hello", "speed": 1}, {"text": "Hello", "metadata": {"number": float("nan")}}, {"text": "Hello", "output": {"format": "mp3", "sample_rate_hz": 24000}}]
        for invalid in invalid_requests:
            transport = Transport(Body([]))
            with self.assertRaises(TypeError) as caught:
                async with synthesize(cast(TtsRequest, invalid), transport=transport, auth=AUTH):
                    self.fail("invalid request reached transport")
            self.assertEqual(str(caught.exception), "Invalid mistral TTS request")
            self.assertEqual(transport.requests, [])

    async def test_send_cancellation_propagates_to_the_transport(self) -> None:
        started = asyncio.Event()
        released = asyncio.Event()
        class PendingTransport:
            async def send(self, request: HttpRequest) -> HttpResponse:
                started.set()
                try:
                    await asyncio.Future[None]()
                    raise AssertionError("unexpected response")
                finally:
                    released.set()
        async def consume() -> None:
            async with synthesize({"text": "Hello"}, transport=PendingTransport(), auth=AUTH):
                self.fail("no headers received")
        task = asyncio.create_task(consume())
        await started.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertTrue(released.is_set())

    async def test_read_error_identity_is_preserved(self) -> None:
        failure = OSError("reader failed")
        body = Body([failure])
        with self.assertRaises(OSError) as caught:
            async with synthesize({"text": "Hello"}, transport=Transport(body), auth=AUTH) as audio:
                await anext(audio)
        self.assertIs(caught.exception, failure)
        self.assertEqual(body.closes, 1)

    async def test_shared_protocol_fixtures_at_every_byte_split(self) -> None:
        fixtures: list[dict[str, object]] = json.loads((Path(__file__).parents[2] / "fixtures/mistral.json").read_text())
        for fixture in fixtures:
            text, content_type = fixture["body"], fixture["contentType"]
            assert isinstance(text, str) and isinstance(content_type, str)
            data = text.encode()
            for split in range(len(data) + 1):
                with self.subTest(name=fixture["name"], split=split):
                    body = Body([data[:split], data[split:]])
                    output: list[object] = []
                    failure: str | None = None
                    try:
                        async with synthesize({"text": "Hello"}, transport=Transport(body, content_type), auth=AUTH) as audio:
                            async for item in audio:
                                output.append({"audio": list(item)} if isinstance(item, bytes) else item)
                    except TypeError as error:
                        failure = str(error)
                    self.assertEqual(output, python_names(fixture["output"]))
                    self.assertEqual(failure, fixture.get("error"))
                    self.assertEqual(body.closes, 1)

    async def test_request_conversion_preserves_voice_reference_and_json_values(self) -> None:
        body = Body([DELTA, DONE], stall=True)
        transport = Transport(body)
        async with synthesize({"text": "Hello", "voice": "owned", "reference_audio": bytes([0, 255, 128]),
                               "metadata": MappingProxyType({"KeepCase": (None, False, 0)}), "prompt_cache_key": "", "output": {"format": "pcm", "sample_rate_hz": 24000}},
                              transport=transport, auth=AUTH, base_url="https://proxy.test/prefix/?a=1") as audio:
            self.assertEqual(await anext(audio), bytes([0, 255, 128]))
            self.assertEqual(body.reads, 1)
            self.assertEqual(await anext(audio), {"event": "done", "usage": {}})
            self.assertEqual(body.closes, 1)
        wire = transport.requests[0]
        self.assertEqual(wire.url, "https://proxy.test/prefix/v1/audio/speech?a=1")
        self.assertEqual(wire.method, "POST")
        self.assertEqual(wire.headers, {"Authorization": "Bearer test", "Content-Type": "application/json", "Accept": "text/event-stream, application/json"})
        self.assertEqual(json.loads(wire.body), {"model": "voxtral-mini-tts-2603", "input": "Hello", "stream": True, "response_format": "pcm", "voice_id": "owned", "ref_audio": "AP+A", "metadata": {"KeepCase": [None, False, 0]}, "prompt_cache_key": ""})

    async def test_early_exit_and_unread_stream_close_once_without_buffering(self) -> None:
        for read in [False, True]:
            body = Body([DELTA], stall=True)
            async with synthesize({"text": "Hello"}, transport=Transport(body), auth=AUTH) as audio:
                if read:
                    self.assertEqual(await anext(audio), bytes([0, 255, 128]))
            self.assertEqual(body.reads, int(read))
            self.assertEqual(body.closes, 1)

    async def test_cancellation_and_deadline_release_a_pending_read(self) -> None:
        for deadline in [False, True]:
            body = Body([], stall=True)
            async def consume() -> list[SynthesisItem]:
                async with synthesize({"text": "Hello"}, transport=Transport(body), auth=AUTH, timeout_ms=20 if deadline else None) as audio:
                    return [item async for item in audio]
            task = asyncio.create_task(consume())
            await body.reading.wait()
            if not deadline:
                task.cancel()
            with self.assertRaises(TimeoutError if deadline else asyncio.CancelledError):
                await task
            self.assertEqual(body.closes, 1)

    async def test_status_errors_retain_opaque_details(self) -> None:
        body = Body([b"private detail"])
        with self.assertRaises(MistralError) as caught:
            async with synthesize({"text": "Hello"}, transport=Transport(body, "application/json", 429), auth=AUTH) as audio:
                await anext(audio)
        self.assertEqual(str(caught.exception), "Mistral synthesis failed (429)")
        self.assertEqual((caught.exception.status_code, caught.exception.body, caught.exception.retry_after), (429, "private detail", "7"))
        self.assertEqual(body.closes, 1)

    async def test_auth_precedence_and_explicit_empty_key(self) -> None:
        with patch.dict(os.environ, {"MISTRAL_API_KEY": "native", "SPEECHSWITCH_MISTRAL_API_KEY": "namespaced"}, clear=True):
            for auth, expected in [(AUTH, "test"), (None, "namespaced")]:
                transport = Transport(Body([]))
                async with synthesize({"text": "Hello"}, transport=transport, auth=auth):
                    pass
                self.assertEqual(transport.requests[0].headers["Authorization"], f"Bearer {expected}")
            transport = Transport(Body([]))
            with self.assertRaises(TypeError) as caught:
                async with synthesize({"text": "Hello"}, transport=transport, auth={"mistral": {"api_key": ""}}):
                    self.fail("empty key accepted")
            self.assertEqual(str(caught.exception), "Missing auth.mistral.apiKey configuration")
            self.assertEqual(transport.requests, [])

    async def test_zero_deadline_and_frame_bounds(self) -> None:
        transport = Transport(Body([]))
        with self.assertRaises(TimeoutError):
            async with synthesize({"text": "Hello"}, transport=transport, auth=AUTH, timeout_ms=0):
                self.fail("zero deadline reached transport")
        self.assertEqual(transport.requests, [])
        for content_type, data, expected in [("text/event-stream", DELTA, "SSE event exceeds byte limit"), ("application/json", b'{"audio_data":"AQ=="}', "Mistral response exceeds max_json_bytes")]:
            body = Body([data])
            with self.assertRaises((ValueError, TypeError)) as caught:
                async with synthesize({"text": "Hello"}, transport=Transport(body, content_type), auth=AUTH, max_event_bytes=8, max_json_bytes=8) as audio:
                    await anext(audio)
            self.assertEqual(str(caught.exception), expected)
            self.assertEqual(body.closes, 1)
