import asyncio
import json
import os
import re
import unittest
from collections.abc import AsyncIterable, AsyncIterator, Awaitable, Callable, Sequence
from pathlib import Path
from typing import Literal, TypedDict, cast
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from speechswitch.generated.auth import Auth
from speechswitch.generated.elevenlabs import TtsRequest, TtsRequestStreamingTextVoice5024de38TextItem as Input
from speechswitch.generated.elevenlabs_output import SynthesisItem
from speechswitch.generated.validators.elevenlabs import validate_request
from speechswitch.http import HttpRequest, HttpResponse
from speechswitch.providers.elevenlabs import ElevenLabsError, synthesize
from speechswitch.validation import is_mapping
from test_websocket import client_frame, server, upgrade

AUTH: Auth = {"elevenlabs": {"api_key": "test-key"}}


def request(text: str | AsyncIterable[Input] = "Hello") -> TtsRequest:
    if isinstance(text, str):
        return {"model": "flash-v2.5", "voice": "custom/id", "text": text, "output": {"format": "mp3"}}
    return {"model": "flash-v2.5", "voice": "custom/id", "text": text, "output": {"format": "mp3"}}


def normalized(value: object) -> object:
    if is_mapping(value):
        return {re.sub(r"[A-Z]", lambda m: "_" + m[0].lower(), str(k)): normalized(v) for k, v in value.items()}
    if isinstance(value, list):
        return [normalized(v) for v in cast(list[object], value)]
    return value


class HttpFixture(TypedDict):
    name: str
    request: dict[str, object]
    path: str
    query: dict[str, list[str]]
    body: dict[str, object]


class TimingFixture(TypedDict):
    protocol: Literal["http", "tts", "dialogue"]
    alignment: dict[str, object]
    timestamps: list[dict[str, object]]


class Fixtures(TypedDict):
    http: list[HttpFixture]
    timing: list[TimingFixture]


def fixtures() -> Fixtures:
    return json.loads((Path(__file__).parents[2] / "fixtures/elevenlabs.json").read_text())


class Body:
    def __init__(self, chunks: Sequence[bytes | Exception], stall: bool = False) -> None:
        self.chunks = list(chunks)
        self.stall = stall
        self.reads = 0
        self.closes = 0
        self.cancelled = 0
        self.waiting = asyncio.Event()
        self.close_error: Exception | None = None
    def __aiter__(self) -> AsyncIterator[bytes]:
        return self
    async def __anext__(self) -> bytes:
        self.reads += 1
        if self.chunks:
            value = self.chunks.pop(0)
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


class Http:
    def __init__(self, body: Body, status: int = 200) -> None:
        self.body, self.status = body, status
        self.requests: list[HttpRequest] = []
        self.pending = False
        self.cancelled = 0
        self.waiting = asyncio.Event()
    async def send(self, request: HttpRequest) -> HttpResponse:
        self.requests.append(request)
        if self.pending:
            self.waiting.set()
            try:
                await asyncio.Future[None]()
            except asyncio.CancelledError:
                self.cancelled += 1
                raise
        return HttpResponse(self.status, {"Request-Id": "trace"}, self.body)


class Source:
    def __init__(self, values: Sequence[Input | Exception], *, stall: bool = False, trace: list[str] | None = None) -> None:
        self.values = list(values)
        self.stall, self.trace = stall, trace
        self.pulls = 0
        self.closes = 0
        self.cancelled = 0
        self.waiting = asyncio.Event()
    def __aiter__(self) -> AsyncIterator[Input]:
        return self
    async def __anext__(self) -> Input:
        self.pulls += 1
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
        if self.trace is not None:
            self.trace.append("input")


class Socket:
    def __init__(self, trace: list[str] | None = None) -> None:
        self.incoming: asyncio.Queue[str | bytes | BaseException] = asyncio.Queue()
        self.sent: list[dict[str, object]] = []
        self.closed = False
        self.trace = trace
        self.context = ""
        self.on_send: Callable[[dict[str, object]], Awaitable[None]] | None = None
    async def send(self, message: str | bytes) -> None:
        assert isinstance(message, str)
        assert not self.closed, "late send"
        value: dict[str, object] = json.loads(message)
        self.sent.append(value)
        if self.on_send is not None:
            await self.on_send(value)
        elif "voice_settings" in value:
            self.context = str(value.get("context_id", ""))
        elif value.get("close_socket"):
            self.receive_json({"context_id": self.context, "is_final": True})
        elif value.get("text") not in (None, "", " ") or "inputs" in value:
            self.receive_json({"context_id": self.context, "audio": "AP8="})
    def receive_json(self, value: object) -> None:
        self.incoming.put_nowait(json.dumps(value))
    async def receive(self) -> str | bytes:
        if self.closed:
            raise StopAsyncIteration
        value = await self.incoming.get()
        if isinstance(value, BaseException):
            raise value
        return value
    async def aclose(self) -> None:
        if not self.closed:
            self.closed = True
            self.incoming.put_nowait(StopAsyncIteration())
            if self.trace is not None:
                self.trace.append("socket")


class ElevenLabsTests(unittest.IsolatedAsyncioTestCase):
    async def test_native_pending_handshake_cancels_before_input(self) -> None:
        headers_received, disconnected = asyncio.Event(), asyncio.Event()
        source = Source(["unread"])
        async def handle(reader: asyncio.StreamReader, _: asyncio.StreamWriter) -> None:
            await reader.readuntil(b"\r\n\r\n")
            headers_received.set()
            self.assertEqual(await reader.read(), b"")
            disconnected.set()
        async with server(handle) as url:
            async def connect() -> None:
                async with synthesize(request(source), auth=AUTH, web_socket_url=url):
                    self.fail("pending handshake completed")
            task = asyncio.create_task(connect())
            await headers_received.wait()
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            await disconnected.wait()
        self.assertEqual(source.pulls, 0)

    async def test_boundary_snapshots_custom_buffer_schedule(self) -> None:
        schedule = [50.0, 500.0]
        r: TtsRequest = {"model":"flash-v2.5","voice":"v","text":Source(["hi"]),"output":{"format":"mp3"},"text_buffer_thresholds":schedule}
        socket = Socket()
        async with synthesize(r, auth=AUTH, web_socket=socket) as audio:
            schedule[0] = 1
            self.assertEqual([item async for item in audio], [b"\0\xff"])
        self.assertEqual(socket.sent[0]["generation_config"], {"chunk_length_schedule":[50,500]})

    async def test_malformed_socket_frames_and_original_io_errors(self) -> None:
        cases: list[tuple[object, str]] = [
            ([], "Invalid ElevenLabs WebSocket frame"),
            ({"context_id":"a","contextId":"b"}, "Conflicting ElevenLabs context identifiers"),
            ({"context_id":12}, "Invalid ElevenLabs context identifier"),
            ({"is_final":True,"isFinal":False}, "Conflicting ElevenLabs final flags"),
            ({"is_final":12}, "Invalid ElevenLabs final flag"),
            ({"audio":12}, "Invalid ElevenLabs audio payload"),
            ({"other":True}, "Unknown ElevenLabs WebSocket message"),
            ({"audio":"AQ=="}, "ElevenLabs multi-context output lacks its context identifier"),
            ({"context_id":"wrong","audio":"AQ=="}, "ElevenLabs returned an unexpected context identifier"),
        ]
        for packet, expected in cases:
            socket, source = Socket(), Source([], stall=True)
            socket.receive_json(packet)
            with self.assertRaises(TypeError) as caught:
                async with synthesize(request(source), auth=AUTH, web_socket=socket) as audio:
                    await anext(audio)
            self.assertEqual(str(caught.exception), expected)
            self.assertTrue(socket.closed)
            self.assertEqual(source.closes, 1)
        for lane in ["input", "read", "write"]:
            original = RuntimeError(lane)
            socket = Socket()
            source = Source([original] if lane == "input" else ["hi"], stall=True)
            if lane == "read":
                socket.incoming.put_nowait(original)
            if lane == "write":
                async def failed(_: dict[str, object]) -> None:
                    raise original
                socket.on_send = failed
            with self.assertRaises(RuntimeError) as caught_io:
                async with synthesize(request(source), auth=AUTH, web_socket=socket) as audio:
                    await anext(audio)
            self.assertIs(caught_io.exception, original)
            self.assertTrue(socket.closed)
            self.assertEqual(source.closes, 1)

    async def test_timing_validation_rejects_mismatch_and_conversion_overflow(self) -> None:
        for alignment in [
            {"characters":["x"],"character_start_times_seconds":[],"character_end_times_seconds":[1]},
            {"characters":["x"],"character_start_times_seconds":[True],"character_end_times_seconds":[1]},
            {"characters":["x"],"character_start_times_seconds":[1],"character_end_times_seconds":[0]},
            {"characters":["x"],"character_start_times_seconds":[1e308],"character_end_times_seconds":[1e308]},
        ]:
            body = Body([json.dumps({"audio_base64":"AQ==","alignment":alignment}).encode()])
            r: TtsRequest = {"model":"eleven-v3","voice":"v","text":"hi","output":{"format":"wav","sample_rate_hz":16000},"timestamp_granularity":"character"}
            with self.assertRaises(TypeError) as caught:
                async with synthesize(r, auth=AUTH, transport=Http(body)) as audio:
                    await anext(audio)
            self.assertEqual(str(caught.exception), "ElevenLabs returned incomplete or mismatched alignment arrays" if alignment["character_start_times_seconds"] == [] else "ElevenLabs returned invalid character timing")
            self.assertEqual(body.closes, 1)
        socket = Socket()
        async def sent(value: dict[str, object]) -> None:
            if value.get("text") == "hi":
                socket.receive_json({"contextId":value["context_id"], "audio":"AQ==", "alignment":{"chars":["x"],"charStartTimesMs":[1e308],"charDurationsMs":[1e308]}})
        socket.on_send = sent
        r = {"model":"flash-v2.5","voice":"v","text":Source(["hi"], stall=True),"output":{"format":"mp3"},"timestamp_granularity":"character"}
        with self.assertRaises(TypeError) as caught:
            async with synthesize(r, auth=AUTH, web_socket=socket) as audio:
                await anext(audio)
        self.assertEqual(str(caught.exception), "ElevenLabs returned invalid character timing")
        self.assertTrue(socket.closed)

    async def test_context_final_reinitializes_before_consumer_resumes(self) -> None:
        socket = Socket()
        contexts: list[str] = []
        reinitialized = asyncio.Event()
        async def sent(value: dict[str, object]) -> None:
            if "voice_settings" in value:
                contexts.append(str(value["context_id"]))
                if len(contexts) == 2:
                    reinitialized.set()
            elif value.get("text") == "hi":
                socket.receive_json({"contextId":contexts[0],"audio":"AQ==","isFinal":True})
        socket.on_send = sent
        async with synthesize(request(Source(["hi"], stall=True)), auth=AUTH, web_socket=socket) as audio:
            self.assertEqual(await anext(audio), b"\1")
            await asyncio.wait_for(reinitialized.wait(), 1)
            self.assertEqual(len(contexts), 2)
            self.assertNotEqual(contexts[0], contexts[1])
        self.assertTrue(socket.closed)

    async def test_heartbeat_runs_while_consumer_is_idle_and_failure_closes_socket(self) -> None:
        real_sleep = asyncio.sleep
        for dialogue in [False, True]:
            for fail in [False, True]:
                tick, sent_tick = asyncio.Event(), asyncio.Event()
                async def sleep(delay: float) -> None:
                    if delay == 10:
                        await tick.wait()
                        tick.clear()
                    else:
                        await real_sleep(delay)
                socket = Socket()
                context = ""
                original = RuntimeError("heartbeat write")
                async def sent(value: dict[str, object]) -> None:
                    nonlocal context
                    if "voice_settings" in value:
                        context = str(value.get("context_id", ""))
                    elif value.get("text") == "hi" or "inputs" in value:
                        socket.receive_json({"context_id":context,"audio":"AQ=="})
                    elif value.get("text") == "" or value.get("keep_alive"):
                        self.assertEqual(value, {"keep_alive":True} if dialogue else {"context_id":context,"text":""})
                        sent_tick.set()
                        if fail:
                            raise original
                socket.on_send = sent
                source = Source(["hi"], stall=True)
                r = cast(TtsRequest, {**request(source), "model":"eleven-v3" if dialogue else "flash-v2.5"})
                with patch("speechswitch.providers.elevenlabs.asyncio.sleep", sleep):
                    async with synthesize(r, auth=AUTH, web_socket=socket) as audio:
                        self.assertEqual(await anext(audio), b"\1")
                        tick.set()
                        await asyncio.wait_for(sent_tick.wait(), 1)
                        if fail:
                            with self.assertRaises(RuntimeError) as caught:
                                await anext(audio)
                            self.assertIs(caught.exception, original)
                            self.assertTrue(socket.closed)
                self.assertTrue(socket.closed)

    async def test_empty_stream_limits_endpoints_and_unread_socket(self) -> None:
        for read in [False, True]:
            socket = Socket()
            source = Source([])
            async with synthesize(request(source), auth=AUTH, web_socket=socket) as audio:
                if read:
                    self.assertEqual([item async for item in audio], [])
            self.assertTrue(socket.closed)
            self.assertEqual(source.pulls, int(read))
            self.assertEqual(source.closes, int(read))
        for endpoint in ["https://user:key@host", "https://host:65536", "https://host/#fragment", "https://host/ a", "file:///tmp/audio"]:
            with self.assertRaises(TypeError) as caught:
                async with synthesize(request(), auth=AUTH, base_url=endpoint):
                    self.fail("invalid endpoint opened")
            self.assertEqual(str(caught.exception), "Invalid ElevenLabs endpoint URL")
        socket = Socket()
        with self.assertRaises(TypeError) as caught:
            async with synthesize(request(Source(["hi"])), auth=AUTH, web_socket=socket, max_message_bytes=16) as audio:
                await anext(audio)
        self.assertEqual(str(caught.exception), "ElevenLabs message exceeds max_message_bytes")
        self.assertEqual(socket.sent, [])
        self.assertTrue(socket.closed)

    async def test_shared_http_fixtures(self) -> None:
        alignment = fixtures()["timing"][0]["alignment"]
        for fixture in fixtures()["http"]:
            with self.subTest(fixture=fixture["name"]):
                r = cast(TtsRequest, normalized(fixture["request"]))
                payload = json.dumps({"audio_base64": "AP8=", "alignment": alignment, "normalized_alignment": alignment}, ensure_ascii=False).encode()
                if "timestamp_granularity" not in r:
                    payload = b"\0\xff"
                elif r["output"]["format"] != "wav":
                    payload += b"\r\n"
                body = Body([payload[:1], b"", payload[1:]])
                transport = Http(body)
                async with synthesize(r, auth=AUTH, transport=transport) as audio:
                    self.assertEqual(body.reads, 0)
                    items = [item async for item in audio]
                if "timestamp_granularity" not in r:
                    self.assertEqual(items, [b"\0", b"\xff"])
                else:
                    self.assertEqual(items, [{"correlation": "chunk", "audio": b"\0\xff", "timestamps": normalized(fixtures()["timing"][0]["timestamps"])}])
                wire = transport.requests[0]
                self.assertEqual(wire.method, "POST")
                self.assertEqual(wire.headers, {"xi-api-key": "test-key", "content-type": "application/json"})
                self.assertEqual(urlsplit(wire.url).path, fixture["path"])
                self.assertEqual(parse_qs(urlsplit(wire.url).query), fixture["query"])
                self.assertEqual(json.loads(wire.body), fixture["body"])
                self.assertEqual(body.closes, 1)

    async def test_ndjson_every_utf8_split_and_record_boundary(self) -> None:
        alignment = fixtures()["timing"][0]["alignment"]
        line = json.dumps({"audio_base64": "AQ==", "alignment": alignment}, ensure_ascii=False).encode()
        data = b"\xef\xbb\xbf\r\n" + line + b"\r\n\n" + line
        r: TtsRequest = {"model": "flash-v2.5", "voice": "v", "text": "hi", "output": {"format": "mp3"}, "timestamp_granularity": "character"}
        expected = {"correlation": "chunk", "audio": b"\1", "timestamps": normalized(fixtures()["timing"][0]["timestamps"])}
        for split in range(len(data) + 1):
            body = Body([data[:split], data[split:]])
            async with synthesize(r, auth=AUTH, transport=Http(body), max_json_bytes=len(line) + 1) as audio:
                self.assertEqual([item async for item in audio], [expected, expected])
            self.assertEqual(body.closes, 1)

    async def test_http_first_chunk_before_completion_and_unread_close(self) -> None:
        for read in [False, True]:
            body = Body([b"first"], stall=True)
            async with synthesize(request(), auth=AUTH, transport=Http(body)) as audio:
                if read:
                    self.assertEqual(await anext(audio), b"first")
                self.assertEqual(body.reads, int(read))
            self.assertEqual(body.closes, 1)

    async def test_http_errors_and_bounded_records(self) -> None:
        body = Body([b'{"detail":{"status":"quota_exceeded","message":"No quota"}}'])
        with self.assertRaises(ElevenLabsError) as caught:
            async with synthesize(request(), auth=AUTH, transport=Http(body, 429)):
                self.fail("error response opened")
        self.assertEqual((str(caught.exception), caught.exception.status_code, caught.exception.error_code, caught.exception.request_id), ("ElevenLabs 429: No quota", 429, "quota_exceeded", "trace"))
        self.assertEqual(body.closes, 1)
        for data, expected in [(b"x" * 33, "ElevenLabs response exceeds max_json_bytes"), (b'{"audio_base64":"!"}\n', "ElevenLabs returned invalid base64 audio"), (b"\n", "ElevenLabs returned no timestamped audio chunks")]:
            body = Body([data])
            r: TtsRequest = {"model": "flash-v2.5", "voice": "v", "text": "hi", "output": {"format": "mp3"}, "timestamp_granularity": "character"}
            with self.assertRaises(TypeError) as caught_type:
                async with synthesize(r, auth=AUTH, transport=Http(body), max_json_bytes=32) as audio:
                    await anext(audio)
            self.assertEqual(str(caught_type.exception), expected)
            self.assertEqual(body.closes, 1)

    async def test_http_pending_setup_and_read_cancellation(self) -> None:
        for setup in [True, False]:
            body = Body([], stall=True)
            transport = Http(body)
            transport.pending = setup
            async def consume() -> None:
                async with synthesize(request(), auth=AUTH, transport=transport) as audio:
                    await anext(audio)
            task = asyncio.create_task(consume())
            await asyncio.wait_for((transport if setup else body).waiting.wait(), 1)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            self.assertEqual(transport.cancelled if setup else body.cancelled, 1)
            self.assertEqual(body.closes, 0 if setup else 1)

    async def test_socket_default_protocol_and_input_spelling(self) -> None:
        for model in ["flash-v2", "flash-v2.5", "multilingual-v2", "eleven-v3"]:
            source = Source(["Hel", "lo", {"command": "flush"}])
            socket = Socket()
            r = cast(TtsRequest, {**request(source), "model": model})
            async with synthesize(r, auth=AUTH, web_socket=socket) as audio:
                self.assertEqual(source.pulls, 0)
                self.assertEqual([item async for item in audio], [b"\0\xff", b"\0\xff"])
            if model == "eleven-v3":
                self.assertEqual(socket.sent, [
                    {"voices": ["custom/id"], "xi_api_key": "test-key", "voice_settings": {}},
                    {"inputs": [{"text": "Hel", "voice_id": "custom/id"}]},
                    {"inputs": [{"text": "lo", "voice_id": "custom/id"}]}, {"flush": True}, {"close_socket": True},
                ])
            else:
                context = socket.sent[0]["context_id"]
                self.assertEqual(socket.sent, [
                    {"text": " ", "context_id": context, "xi_api_key": "test-key", "voice_settings": {}, "generation_config": {"chunk_length_schedule": [120,160,250,290]}},
                    {"context_id": context, "text": "Hel"}, {"context_id": context, "text": "lo"},
                    {"context_id": context, "text": " ", "flush": True}, {"context_id": context, "text": " ", "flush": True}, {"close_socket": True},
                ])
            self.assertTrue(socket.closed)
            self.assertEqual(source.closes, 1)

    async def test_clear_retires_old_audio_final_and_error_packets(self) -> None:
        socket = Socket()
        contexts: list[str] = []
        async def sent(value: dict[str, object]) -> None:
            if "voice_settings" in value:
                contexts.append(str(value["context_id"]))
            elif value.get("close_context"):
                for packet in [{"audio":"AQ=="}, {"isFinal":True}, {"error":"late", "code":500}]:
                    socket.receive_json({"contextId": contexts[0], **packet})
            elif value.get("text") == "new":
                socket.receive_json({"context_id": contexts[1], "audio": "Ag=="})
            elif value.get("close_socket"):
                socket.receive_json({"contextId": contexts[1], "audio": "Aw==", "isFinal": True})
        socket.on_send = sent
        source = Source(["old", {"command": "clear"}, "new"])
        async with synthesize(request(source), auth=AUTH, web_socket=socket) as audio:
            self.assertEqual([item async for item in audio], [{"event": "clear"}, b"\2", b"\3"])
        self.assertEqual(len(contexts), 2)
        self.assertNotEqual(contexts[0], contexts[1])
        self.assertTrue(socket.closed)
        self.assertEqual(source.closes, 1)

    async def test_shared_socket_timings_and_final_audio(self) -> None:
        for fixture in fixtures()["timing"][1:]:
            for normalized_text in [False, True] if fixture["protocol"] == "tts" else [False]:
                socket = Socket()
                context = ""
                async def sent(value: dict[str, object]) -> None:
                    nonlocal context
                    if "voice_settings" in value:
                        context = str(value.get("context_id", ""))
                    elif value.get("close_socket"):
                        socket.receive_json({"context_id": context, "audio": "AP8=", "is_final": True, "normalizedAlignment" if normalized_text else "alignment": fixture["alignment"]})
                socket.on_send = sent
                r = cast(TtsRequest, {**request(Source(["hi"])), "model": "eleven-v3" if fixture["protocol"] == "dialogue" else "flash-v2.5", "timestamp_granularity": "character", "timestamp_text": "normalized" if normalized_text else "original"})
                async with synthesize(r, auth=AUTH, web_socket=socket) as audio:
                    self.assertEqual(await anext(audio), {"correlation": "chunk", "audio": b"\0\xff", "timestamps": normalized(fixture["timestamps"])})
                    self.assertTrue(socket.closed)
                    self.assertEqual([item async for item in audio], [])

    async def test_pending_write_does_not_block_audio_or_prefetch(self) -> None:
        socket = Socket()
        source = Source(["hi", "unread"])
        blocked, cancelled = asyncio.Event(), asyncio.Event()
        async def sent(value: dict[str, object]) -> None:
            if value.get("text") == "hi":
                socket.receive_json({"context_id": value["context_id"], "audio": "AQ=="})
                blocked.set()
                try:
                    await asyncio.Future[None]()
                except asyncio.CancelledError:
                    cancelled.set()
                    raise
        socket.on_send = sent
        async with synthesize(request(source), auth=AUTH, web_socket=socket) as audio:
            self.assertEqual(await asyncio.wait_for(anext(audio), 1), b"\1")
            await blocked.wait()
            self.assertEqual(source.pulls, 1)
        self.assertTrue(cancelled.is_set())
        self.assertTrue(socket.closed)
        self.assertEqual(source.closes, 1)

    async def test_socket_cancellation_releases_network_before_input(self) -> None:
        trace: list[str] = []
        source = Source([], stall=True, trace=trace)
        socket = Socket(trace)
        async def consume() -> None:
            async with synthesize(request(source), auth=AUTH, web_socket=socket) as audio:
                await anext(audio)
        task = asyncio.create_task(consume())
        await asyncio.wait_for(source.waiting.wait(), 1)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertEqual(trace, ["socket", "input"])
        self.assertEqual(source.cancelled, 1)

    async def test_deadline_also_covers_idle_consumer(self) -> None:
        socket = Socket()
        source = Source(["hi"], stall=True)
        with self.assertRaises(TimeoutError) as caught:
            async with synthesize(request(source), auth=AUTH, web_socket=socket, timeout_ms=25) as audio:
                self.assertEqual(await anext(audio), b"\0\xff")
                await asyncio.sleep(1)
        self.assertEqual(str(caught.exception), "ElevenLabs synthesis deadline expired")
        self.assertTrue(socket.closed)
        self.assertEqual(source.closes, 1)

    async def test_schema_and_options_precede_network_or_input(self) -> None:
        for fields in [{"random_seed":0.5}, {"text_buffer_thresholds":[50.5]}, {"text_buffering":False,"text_buffer_thresholds":[50]}, {"model":"eleven-v3","speed":1}]:
            source = Source(["unread"])
            socket = Socket()
            invalid = cast(TtsRequest, {**request(source), **fields})
            with self.assertRaises(TypeError) as expected:
                validate_request(invalid)
            with self.assertRaises(TypeError) as caught:
                async with synthesize(invalid, auth=AUTH, web_socket=socket):
                    self.fail("invalid request opened")
            self.assertEqual(caught.exception.args, expected.exception.args)
            self.assertEqual(socket.sent, [])
            self.assertEqual(source.pulls, 0)
        source = Source([{"command":"clear"}])
        socket = Socket()
        invalid = cast(TtsRequest, {**request(source), "model":"eleven-v3"})
        validate_input = validate_request(invalid)
        with self.assertRaises(TypeError) as expected:
            validate_input({"command":"clear"})
        with self.assertRaises(TypeError) as caught:
            async with synthesize(invalid, auth=AUTH, web_socket=socket) as audio:
                await anext(audio)
        self.assertEqual(caught.exception.args, expected.exception.args)
        self.assertEqual(socket.sent, [{"voices":["custom/id"],"voice_settings":{},"xi_api_key":"test-key"}])
        self.assertEqual(source.closes, 1)

    async def test_native_header_and_single_use_token_auth(self) -> None:
        for dialogue in [False, True]:
            for token in [False, True]:
                received = asyncio.Event()
                async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
                    path, headers = await upgrade(reader, writer)
                    target = urlsplit(path.decode().split(" ")[1])
                    query = parse_qs(target.query)
                    expected_query = {"seed":["4294967295"], "model_id":["eleven_v3" if dialogue else "eleven_flash_v2_5"],
                        "output_format":["pcm_24000"], "sync_alignment":["false"], "enable_logging":["false"],
                        "apply_text_normalization":["off"], "language_code":["ja"]}
                    if token:
                        expected_query["single_use_token"] = ["short+token"]
                    if not dialogue:
                        expected_query.update({"auto_mode":["true"],"enable_ssml_parsing":["true"],"inactivity_timeout":["20"]})
                    self.assertEqual(query, expected_query)
                    self.assertEqual(headers.get(b"xi-api-key"), None if token else b"test-key")
                    self.assertEqual(query.get("api_key"), None)
                    opcode, payload = await client_frame(reader)
                    self.assertEqual(opcode, 1)
                    initial: dict[str, object] = json.loads(payload)
                    context = initial.get("context_id")
                    voice_settings = {"stability":0} if dialogue else {"stability":0,"similarity_boost":0,"style":0,"speed":0.7,"use_speaker_boost":False}
                    self.assertEqual(initial, {**({"voices":["custom/id"]} if dialogue else {"text":" ","context_id":context}),
                        "voice_settings":voice_settings, "pronunciation_dictionary_locators":[{"pronunciation_dictionary_id":"lex","version_id":"version"}]})
                    while True:
                        opcode, payload = await client_frame(reader)
                        self.assertEqual(opcode, 1)
                        value: dict[str, object] = json.loads(payload)
                        if value.get("close_socket"):
                            break
                    final = json.dumps({"context_id": context, "is_final": True, "audio":"AQ=="}).encode()
                    writer.write(bytes([0x81, len(final)]) + final)
                    await writer.drain()
                    await reader.read()
                    received.set()
                async with server(handle) as url:
                    r = cast(TtsRequest, {**request(Source(["hi"])), "model":"eleven-v3" if dialogue else "flash-v2.5", "random_seed":4294967295,
                        "output":{"format":"pcm","sample_rate_hz":24000}, "language":"ja", "text_normalization":False,
                        "stability":0, "pronunciation_dictionaries":[{"id":"lex","version_id":"version"}],
                        **({} if dialogue else {"text_buffering":False,"input_type":"ssml","voice_similarity":0,"style_exaggeration":0,"speed":0.7,"voice_boost":False})})
                    auth: Auth = {"elevenlabs":{"single_use_token":"short+token"}} if token else AUTH
                    async with synthesize(r, auth=auth, web_socket_url=url + "/socket?api_key=stale", timeout_ms=1000, request_logging=False) as audio:
                        self.assertEqual([item async for item in audio], [b"\1"])
                    await received.wait()

    async def test_auth_precedence_and_owned_url_fields(self) -> None:
        cases: list[tuple[Auth | None, str | None]] = [(None, "scoped"), (AUTH, "test-key"), ({"elevenlabs":{"api_key":""}}, None)]
        for auth, expected in cases:
            body = Body([b"x"])
            http = Http(body)
            with patch.dict(os.environ, {"SPEECHSWITCH_ELEVENLABS_API_KEY":"scoped", "ELEVENLABS_API_KEY":"native"}):
                if expected is None:
                    with self.assertRaises(TypeError) as caught:
                        async with synthesize(request(), auth=auth, transport=http):
                            self.fail("empty auth accepted")
                    self.assertEqual(str(caught.exception), "Missing auth.elevenlabs.apiKey configuration")
                    self.assertEqual(http.requests, [])
                else:
                    async with synthesize(request(), auth=auth, transport=http, base_url="https://proxy.test/p%20x/?trace=1&seed=42&single_use_token=old&api_key=old&output_format=wav_8000&optimize_streaming_latency=4", request_logging=False) as audio:
                        self.assertEqual([item async for item in audio], [b"x"])
                    self.assertEqual(http.requests[0].headers["xi-api-key"], expected)
                    self.assertEqual(urlsplit(http.requests[0].url).path, "/p%20x/v1/text-to-speech/custom%2Fid/stream")
                    self.assertEqual(parse_qs(urlsplit(http.requests[0].url).query), {"trace":["1"],"output_format":["mp3_44100_128"],"enable_logging":["false"]})
