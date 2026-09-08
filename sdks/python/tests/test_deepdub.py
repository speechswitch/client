import asyncio
import json
import os
import re
import unittest
import uuid
from collections.abc import AsyncGenerator, AsyncIterator, Sequence
from pathlib import Path
from typing import TypedDict, cast
from unittest.mock import patch

from speechswitch.generated.auth import Auth
from speechswitch.generated.deepdub import TtsRequest
from speechswitch.generated.validators.deepdub import validate_request
from speechswitch.http import HttpRequest, HttpResponse
from speechswitch.providers.deepdub import DeepdubError, synthesize
from speechswitch.validation import is_mapping


AUTH: Auth = {"deepdub": {"api_key": "test-key"}}


def request() -> TtsRequest:
    return {"model": "phantom-x-3.2", "voice": "custom", "text": "Hello", "language": "en-US", "output": {"format": "mp3"}}


def normalized(value: object) -> object:
    if is_mapping(value):
        return {re.sub(r"[A-Z]", lambda m: "_" + m[0].lower(), str(key)): normalized(item) for key, item in value.items()}
    return value


class Fixture(TypedDict):
    name: str
    request: dict[str, object]
    wire: dict[str, object]


class Body:
    def __init__(self, values: Sequence[bytes | Exception], *, stall: bool = False) -> None:
        self.values = list(values)
        self.stall = stall
        self.reads: int = 0
        self.closes: int = 0
        self.cancelled: int = 0
        self.waiting = asyncio.Event()
        self.close_error: Exception | None = None
    def __aiter__(self) -> AsyncIterator[bytes]:
        return self
    async def __anext__(self) -> bytes:
        self.reads += 1
        if self.values:
            value = self.values.pop(0)
            if isinstance(value, Exception):
                raise value
            return value
        if self.stall:
            self.waiting.set()
            try:
                await asyncio.Future[None]()
            except asyncio.CancelledError:
                self.cancelled += 1
                raise
        raise StopAsyncIteration
    async def aclose(self) -> None:
        self.closes += 1
        if self.close_error is not None:
            raise self.close_error


class Transport:
    def __init__(self, body: Body, status: int = 200, headers: dict[str, str] | None = None) -> None:
        self.body, self.status = body, status
        self.headers = {} if headers is None else headers
        self.requests: list[HttpRequest] = []
        self.stall = False
        self.waiting = asyncio.Event()
        self.cancelled = 0
    async def send(self, request: HttpRequest) -> HttpResponse:
        self.requests.append(request)
        if self.stall:
            self.waiting.set()
            try:
                await asyncio.Future[None]()
            except asyncio.CancelledError:
                self.cancelled += 1
                raise
        return HttpResponse(self.status, self.headers, self.body)


def ogg(signature: bytes = b"OpusHead", segments: int = 1) -> bytes:
    signature = signature.ljust(8, b"\x00")
    prefix = bytearray(27 + segments)
    prefix[:4] = b"OggS"
    prefix[26] = segments
    prefix[27] = len(signature)
    return bytes(prefix) + signature


class DeepdubTests(unittest.IsolatedAsyncioTestCase):
    async def test_streaming_input_and_invalid_public_options_never_start_http(self) -> None:
        reads = 0
        async def text() -> AsyncGenerator[str, None]:
            nonlocal reads
            reads += 1
            yield "Hello"
        source = text()
        transport = Transport(Body([]))
        invalid = cast(TtsRequest, {**request(), "text": source})
        with self.assertRaises(TypeError) as expected:
            validate_request(invalid)
        with self.assertRaises(TypeError) as caught:
            async with synthesize(invalid, auth=AUTH, transport=transport):
                self.fail("streaming input accepted")
        self.assertEqual(caught.exception.args, expected.exception.args)
        self.assertEqual((reads, transport.requests), (0, []))
        await source.aclose()
        for timeout in [-1, True, 2147483648]:
            with self.assertRaises(TypeError) as caught:
                async with synthesize(request(), auth=AUTH, transport=transport, timeout_ms=timeout):
                    self.fail("invalid timeout accepted")
            self.assertEqual(str(caught.exception), "Deepdub timeout_ms must be an integer between 0 and 2147483647")
        for limit in [0, -1, True]:
            with self.assertRaises(TypeError) as caught:
                async with synthesize(request(), auth=AUTH, transport=transport, max_error_bytes=limit):
                    self.fail("invalid limit accepted")
            self.assertEqual(str(caught.exception), "Deepdub max_error_bytes must be a positive integer")
        for url in ["ftp://example.test", "https://key@example.test", "https://example.test/#fragment"]:
            with self.assertRaises(TypeError) as caught:
                async with synthesize(request(), auth=AUTH, transport=transport, base_url=url):
                    self.fail("invalid endpoint accepted")
            self.assertEqual(str(caught.exception), "Deepdub base_url must be an HTTP(S) URL without credentials or a fragment")
        with self.assertRaises(TimeoutError) as caught:
            async with synthesize(request(), auth=AUTH, transport=transport, timeout_ms=0):
                self.fail("zero deadline accepted")
        self.assertEqual(str(caught.exception), "Deepdub synthesis deadline expired")
        self.assertEqual(transport.requests, [])

    async def test_ready_audio_and_error_bodies_do_not_starve_deadlines(self) -> None:
        class ReadyBody(Body):
            async def __anext__(self) -> bytes:
                self.reads += 1
                return b"x"
        for status in [200, 400]:
            body = ReadyBody([])
            with self.assertRaises(TimeoutError):
                async with synthesize(request(), auth=AUTH, transport=Transport(body, status), timeout_ms=10) as audio:
                    async for _ in audio:
                        pass
            self.assertEqual(body.closes, 1)
            self.assertGreater(body.reads, 0)

    async def test_shared_wire_fixtures_preserve_all_eight_request_shapes(self) -> None:
        fixtures: list[Fixture] = json.loads((Path(__file__).parents[2] / "fixtures/deepdub.json").read_text())
        for fixture in fixtures:
            with self.subTest(fixture=fixture["name"]):
                raw = dict(fixture["request"])
                if "referenceAudio" in raw:
                    raw["referenceAudio"] = bytes(cast(list[int], raw["referenceAudio"]))
                body = Body([b"\x00\xff", b"later"])
                transport = Transport(body)
                async with synthesize(cast(TtsRequest, normalized(raw)), auth=AUTH, transport=transport,
                                      request_id="trace", base_url="https://proxy.test/prefix%20path/?tenant=1") as audio:
                    self.assertEqual(body.reads, 0)
                    self.assertEqual(await anext(audio), b"\x00\xff")
                    self.assertEqual(body.reads, 1)
                    self.assertEqual([chunk async for chunk in audio], [b"later"])
                    with self.assertRaises(StopAsyncIteration):
                        await anext(audio)
                self.assertEqual(body.closes, 1)
                self.assertEqual(len(transport.requests), 1)
                wire = transport.requests[0]
                self.assertEqual((wire.method, wire.url, wire.headers), ("POST", "https://proxy.test/prefix%20path/tts?tenant=1", {"x-api-key": "test-key", "content-type": "application/json"}))
                self.assertEqual(json.loads(wire.body), fixture["wire"])

    async def test_all_formats_rates_and_codec_splits(self) -> None:
        for format in ["mp3", "mulaw", "ogg_opus"]:
            for rate in [8000, 16000, 22050, 24000, 32000, 36000, 44100, 48000]:
                body = Body([ogg() if format == "ogg_opus" else b"audio"])
                transport = Transport(body)
                value = cast(TtsRequest, {**request(), "output": {"format": format, "sample_rate_hz": rate}})
                async with synthesize(value, auth=AUTH, transport=transport) as audio:
                    self.assertEqual([chunk async for chunk in audio], [ogg() if format == "ogg_opus" else b"audio"])
                wire = json.loads(transport.requests[0].body)
                self.assertEqual((wire["format"], wire["sampleRate"]), ("opus" if format == "ogg_opus" else format, rate))
                self.assertEqual(uuid.UUID(wire["generationId"]).version, 4)
        value = cast(TtsRequest, {**request(), "output": {"format": "ogg_opus"}})
        for segments in [1, 255]:
            header = ogg(segments=segments)
            for split in range(len(header) + 1):
                chunks = [header[:split], header[split:]]
                body = Body(chunks, stall=True)
                async with synthesize(value, auth=AUTH, transport=Transport(body)) as audio:
                    for expected in filter(None, chunks):
                        self.assertEqual(await anext(audio), expected)
                    self.assertFalse(body.waiting.is_set())
                self.assertEqual(body.closes, 1)

    async def test_codec_failure_never_exposes_mislabeled_audio(self) -> None:
        for data, message in [
            (ogg(b"\x01vorbis"), "Deepdub returned a different Ogg codec (the trial API has returned Vorbis) for requested Opus audio"),
            (bytes(40), "Deepdub did not return an Ogg Opus stream"),
            (b"Ogg", "Deepdub returned a truncated Ogg Opus header"),
            (b"", "Deepdub returned a truncated Ogg Opus header"),
        ]:
            for split in range(len(data) + 1):
                body = Body([data[:split], data[split:]])
                if len(data) >= 27:
                    body.close_error = RuntimeError("secondary cleanup")
                value = cast(TtsRequest, {**request(), "output": {"format": "ogg_opus"}})
                with self.assertRaises(TypeError) as caught:
                    async with synthesize(value, auth=AUTH, transport=Transport(body)) as audio:
                        await anext(audio)
                self.assertEqual(str(caught.exception), message)
                self.assertEqual(body.closes, 1)

    async def test_generated_constraints_and_only_unrepresentable_byte_check_precede_io(self) -> None:
        for invalid in [
            {"speed": -0.1}, {"speed": 2.1}, {"speed": 1, "target_duration_ms": 1},
            {"target_duration_ms": 0}, {"model": "og-1.1", "random_seed": 1.5},
            {"model": "og-1.1", "random_seed": 9007199254740992}, {"random_seed": 42},
            {"output": {"format": "mp3", "sample_rate_hz": 12000}}, {"output": {"format": "mp3", "sample_rate_hz": 24000.5}},
            {"output": {"format": "wav"}}, {"voice": None}, {"voice": ""}, {"reference_audio": "base64"},
            {"temperature": float("nan")}, {"temperature": True}, {"accent_blend": {"base_locale": "en-US"}},
        ]:
            transport = Transport(Body([]))
            value = cast(TtsRequest, {**request(), **invalid})
            with self.assertRaises(TypeError) as expected:
                validate_request(value)
            with self.assertRaises(TypeError) as caught:
                async with synthesize(value, auth=AUTH, transport=transport):
                    self.fail("invalid request accepted")
            self.assertEqual(caught.exception.args, expected.exception.args)
            self.assertEqual(transport.requests, [])
        transport = Transport(Body([]))
        with self.assertRaises(TypeError) as caught:
            async with synthesize(cast(TtsRequest, {**request(), "reference_audio": b""}), auth=AUTH, transport=transport):
                self.fail("empty reference accepted")
        self.assertEqual(str(caught.exception), "Deepdub reference_audio must not be empty")
        self.assertEqual(transport.requests, [])

    async def test_errors_keep_generation_id_status_and_original_failures(self) -> None:
        for status in [400, 401, 402, 403, 404, 429, 500, 599]:
            for headers, expected in [({}, "trace"), ({"X-Generation-ID": "server"}, "server"), ({"x-generation-id": ""}, "")]:
                body = Body([b'{"message":"denied"}'])
                transport = Transport(body, status, headers)
                with self.assertRaises(DeepdubError) as caught:
                    async with synthesize(request(), auth=AUTH, transport=transport, request_id="trace") as audio:
                        await anext(audio)
                self.assertEqual((caught.exception.status_code, caught.exception.generation_id, str(caught.exception)), (status, expected, f"Deepdub returned HTTP {status}: denied"))
                self.assertEqual(body.closes, 1)
                self.assertEqual(len(transport.requests), 1)
        for data, expected in [(b"oops", "oops"), (b"", "Bad Gateway"), (b'{"message":2}', '{"message":2}')]:
            with self.assertRaises(DeepdubError) as caught:
                async with synthesize(request(), auth=AUTH, transport=Transport(Body([data]), 502)) as audio:
                    await anext(audio)
            self.assertEqual(str(caught.exception), "Deepdub returned HTTP 502: " + expected)
        original = RuntimeError("original read failure")
        body = Body([original])
        body.close_error = RuntimeError("secondary cleanup")
        with self.assertRaises(RuntimeError) as caught:
            async with synthesize(request(), auth=AUTH, transport=Transport(body)) as audio:
                await anext(audio)
        self.assertIs(caught.exception, original)
        self.assertEqual(body.closes, 1)

    async def test_limits_timeouts_and_pending_cancellation_release_ownership(self) -> None:
        for phase in ["headers", "body", "idle", "prefix", "error"]:
            body = Body([b"Ogg"] if phase == "prefix" else [], stall=True)
            transport = Transport(body, 400 if phase == "error" else 200)
            transport.stall = phase == "headers"
            value = cast(TtsRequest, {**request(), "output": {"format": "ogg_opus"}}) if phase == "prefix" else request()
            with self.assertRaises(TimeoutError):
                async with synthesize(value, auth=AUTH, transport=transport, timeout_ms=10) as audio:
                    if phase == "idle":
                        await asyncio.Future[None]()
                    else:
                        await anext(audio)
            self.assertEqual(transport.cancelled, int(phase == "headers"))
            self.assertEqual(body.closes, int(phase != "headers"))
            self.assertEqual(body.cancelled, int(phase not in ("headers", "idle")))
        body = Body([b"too", b"long"])
        with self.assertRaises(TypeError) as caught:
            async with synthesize(request(), auth=AUTH, transport=Transport(body, 400), max_error_bytes=3) as audio:
                await anext(audio)
        self.assertEqual(str(caught.exception), "Deepdub response exceeds max_error_bytes")
        self.assertEqual(body.closes, 1)
        body = Body([], stall=True)
        async def consume() -> None:
            async with synthesize(request(), auth=AUTH, transport=Transport(body)) as audio:
                await anext(audio)
        task = asyncio.create_task(consume())
        await body.waiting.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertEqual((body.cancelled, body.closes), (1, 1))

    async def test_early_exit_and_unread_context_close_once(self) -> None:
        for read in [False, True]:
            body = Body([b"first", b"second"], stall=True)
            async with synthesize(request(), auth=AUTH, transport=Transport(body)) as audio:
                if read:
                    self.assertEqual(await anext(audio), b"first")
            self.assertEqual((body.reads, body.closes), (int(read), 1))

    async def test_auth_presence_precedence_and_empty_request_id(self) -> None:
        for scoped, native, explicit, expected in [
            (None, "native", None, "native"), ("scoped", "native", None, "scoped"),
            ("scoped", "native", "explicit", "explicit"), ("", "native", None, ""),
            ("scoped", "native", "", ""), (None, None, None, ""),
        ]:
            environment = dict(os.environ)
            for key in ["SPEECHSWITCH_DEEPDUB_API_KEY", "DEEPDUB_API_KEY"]:
                environment.pop(key, None)
            if scoped is not None:
                environment["SPEECHSWITCH_DEEPDUB_API_KEY"] = scoped
            if native is not None:
                environment["DEEPDUB_API_KEY"] = native
            transport = Transport(Body([]))
            auth: Auth | None = {"deepdub": {"api_key": explicit}} if explicit is not None else None
            with patch.dict(os.environ, environment, clear=True):
                if expected:
                    async with synthesize(request(), auth=auth, transport=transport, request_id=""):
                        pass
                    self.assertEqual(transport.requests[0].headers["x-api-key"], expected)
                    self.assertEqual(json.loads(transport.requests[0].body)["generationId"], "")
                else:
                    with self.assertRaises(TypeError) as caught:
                        async with synthesize(request(), auth=auth, transport=transport):
                            self.fail("missing auth accepted")
                    self.assertEqual(str(caught.exception), "Missing auth.deepdub.apiKey configuration")
                    self.assertEqual(transport.requests, [])
