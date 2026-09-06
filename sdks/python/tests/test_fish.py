import asyncio
import json
import math
import re
import unittest
from collections.abc import AsyncIterable, AsyncIterator, Awaitable, Callable, Sequence
from pathlib import Path
from typing import cast
from unittest.mock import patch

from speechswitch.generated.auth import Auth
from speechswitch.generated.fish import TtsRequest, TtsRequestS1StreamingTextTextItem as Input
from speechswitch.http import HttpRequest, HttpResponse
from speechswitch.msgpack import encode, decode
from speechswitch.providers.fish import synthesize, FishError
from speechswitch.validation import is_mapping, is_sequence
from test_websocket import server, upgrade, client_frame

AUTH: Auth = {"fish": {"api_key": "test-key"}}


def hydrate(value: object, snake: bool = False) -> object:
    if is_mapping(value):
        if "$bytes" in value:
            return bytes(cast(Sequence[int], value["$bytes"]))
        return {(re.sub(r"[A-Z]", lambda m: "_" + m[0].lower(), str(k)) if snake else str(k)): hydrate(v, snake) for k, v in value.items()}
    if is_sequence(value):
        return [hydrate(v, snake) for v in value]
    return value


def request(text: str | AsyncIterable[Input] = "hello") -> TtsRequest:
    if isinstance(text, str):
        return {"model": "s2-pro", "voice": "custom-voice", "text": text, "output": {"format": "mp3"}}
    return {"model": "s2-pro", "voice": "custom-voice", "text": text, "output": {"format": "mp3"}}


class Source[T]:
    def __init__(self, values: Sequence[T | Exception], stall: bool = False, trace: list[str] | None = None) -> None:
        self.values = list(values)
        self.stall, self.trace = stall, trace
        self.pulls = self.closes = self.cancelled = 0
        self.waiting = asyncio.Event()
    def __aiter__(self) -> AsyncIterator[T]:
        return self
    async def __anext__(self) -> T:
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


class Transport:
    def __init__(self, body: Source[bytes], status: int = 200) -> None:
        self.body, self.status = body, status
        self.requests: list[HttpRequest] = []
        self.stall = False
        self.cancelled = 0
        self.waiting = asyncio.Event()
    async def send(self, request: HttpRequest) -> HttpResponse:
        self.requests.append(request)
        if self.stall:
            self.waiting.set()
            try:
                await asyncio.Future[None]()
            except asyncio.CancelledError:
                self.cancelled += 1
                raise
        return HttpResponse(self.status, {}, self.body)


class Socket:
    def __init__(self, trace: list[str] | None = None) -> None:
        self.incoming: asyncio.Queue[str | bytes | Exception] = asyncio.Queue()
        self.sent: list[dict[object, object]] = []
        self.closed = False
        self.trace = trace
        self.on_send: Callable[[dict[object, object]], Awaitable[None]] | None = None
        self.close_error: Exception | None = None
    async def send(self, message: str | bytes) -> None:
        assert isinstance(message, bytes)
        value = decode(message)
        assert is_mapping(value)
        value = dict(value)
        self.sent.append(value)
        if self.on_send is not None:
            await self.on_send(value)
        elif value["event"] == "text":
            self.incoming.put_nowait(encode({"event": "audio", "audio": b"\x00\xff"}))
        elif value["event"] == "stop":
            self.incoming.put_nowait(encode({"event": "finish", "reason": "stop"}))
    async def receive(self) -> str | bytes:
        value = await self.incoming.get()
        if isinstance(value, Exception):
            raise value
        return value
    async def aclose(self) -> None:
        if not self.closed:
            self.closed = True
            if self.trace is not None:
                self.trace.append("socket")
        if self.close_error is not None:
            raise self.close_error


class FishTests(unittest.IsolatedAsyncioTestCase):
    async def test_live_conditioning_branches_share_http_settings(self) -> None:
        fixtures = json.loads((Path(__file__).parents[2] / "fixtures/fish.json").read_text())
        for case in fixtures["http"]:
            source: Source[Input] = Source(["hi"])
            r = cast(TtsRequest, {**cast(dict[str, object], hydrate(case["request"], True)), "text": source})
            socket = Socket()
            async with synthesize(r, web_socket=socket) as stream:
                self.assertEqual([item async for item in stream], [b"\x00\xff"])
            self.assertEqual(socket.sent[0], {"event": "start", "request": hydrate({**fixtures["defaults"], **case["wire"], "text": ""})})
            self.assertEqual(source.closes, 1)

    async def test_empty_input_and_invalid_clear(self) -> None:
        empty: Source[Input] = Source([])
        socket = Socket()
        async with synthesize(request(empty), web_socket=socket) as stream:
            self.assertEqual([item async for item in stream], [])
        self.assertEqual([value["event"] for value in socket.sent], ["start", "stop"])
        self.assertEqual(empty.closes, 1)
        invalid: Source[Input] = Source([cast(Input, {"command": "clear"})])
        socket = Socket()
        with self.assertRaises(TypeError) as raised:
            async with synthesize(request(invalid), web_socket=socket) as stream:
                await anext(stream)
        self.assertEqual(str(raised.exception), "Invalid fish TTS input item")
        self.assertEqual([value["event"] for value in socket.sent], ["start"])
        self.assertEqual(invalid.closes, 1)

    async def test_sse_bound_and_non_json_constants_release_body(self) -> None:
        cases = [(b"data: " + b"x" * 33 + b"\n\n", 32, ValueError, "SSE event exceeds byte limit"),
                 (b'data: {"extra":NaN}\n\n', 1024, TypeError, "Fish returned invalid timestamp JSON")]
        for data, limit, error_type, message in cases:
            body = Source([data])
            r = cast(TtsRequest, {**request(), "timestamp_granularity": "segment"})
            with self.assertRaises(error_type) as raised:
                async with synthesize(r, auth=AUTH, transport=Transport(body), max_json_bytes=limit) as stream:
                    await anext(stream)
            self.assertEqual(str(raised.exception), message)
            self.assertEqual(body.closes, 1)

    async def test_native_pending_handshake_cancellation_never_pulls_input(self) -> None:
        waiting, disconnected = asyncio.Event(), asyncio.Event()
        async def handle(reader: asyncio.StreamReader, _: asyncio.StreamWriter) -> None:
            await reader.readuntil(b"\r\n\r\n")
            waiting.set()
            self.assertEqual(await reader.read(), b"")
            disconnected.set()
        async with server(handle) as endpoint:
            source: Source[Input] = Source(["unread"])
            async def run() -> None:
                async with synthesize(request(source), auth=AUTH, base_url=endpoint):
                    self.fail("unfinished handshake accepted")
            task = asyncio.create_task(run())
            await waiting.wait()
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            await disconnected.wait()
            self.assertEqual((source.pulls, source.closes), (0, 0))

    async def test_invalid_options_endpoints_and_auth_fail_before_io(self) -> None:
        transport = Transport(Source([b"x"]))
        with self.assertRaises(TypeError) as raised:
            async with synthesize(request(), auth={"fish": {"api_key": ""}}, transport=transport):
                pass
        self.assertEqual(str(raised.exception), "Missing auth.fish.apiKey configuration")
        for target in ["file:///tts", "https://user:pass@host", "https://host/#fragment", "https://host:bad", "https://host/a b"]:
            with self.assertRaises(TypeError) as raised:
                async with synthesize(request(), auth=AUTH, transport=transport, base_url=target):
                    pass
            self.assertEqual(str(raised.exception), "Invalid Fish endpoint URL")
        for value in [0, -1, True]:
            with self.assertRaises(TypeError) as raised:
                async with synthesize(request(), auth=AUTH, transport=transport, max_message_bytes=value):
                    pass
            self.assertEqual(str(raised.exception), "Fish max_message_bytes must be a positive integer")
        with self.assertRaises(TimeoutError) as raised:
            async with synthesize(request(), auth=AUTH, transport=transport, timeout_ms=0):
                pass
        self.assertEqual(str(raised.exception), "Fish synthesis deadline expired")
        self.assertEqual(transport.requests, [])

    async def test_nonempty_reference_bytes_remain_a_protocol_check(self) -> None:
        transport = Transport(Source([b"x"]))
        r: TtsRequest = {"model": "s1", "text": "hi", "output": {"format": "mp3"}, "reference_samples": [{"audio": b"", "text": "voice"}]}
        with self.assertRaises(TypeError) as raised:
            async with synthesize(r, auth=AUTH, transport=transport):
                pass
        self.assertEqual(str(raised.exception), "Fish reference audio must not be empty")
        self.assertEqual(transport.requests, [])

    async def test_shared_http_fixtures_and_first_byte(self) -> None:
        fixtures = json.loads((Path(__file__).parents[2] / "fixtures/fish.json").read_text())
        for case in fixtures["http"]:
            with self.subTest(name=case["name"]):
                body = Source([b"\x00", b"", b"\xff"], stall=True)
                transport = Transport(body)
                r = cast(TtsRequest, hydrate(case["request"], True))
                async with synthesize(r, auth=AUTH, transport=transport, base_url="https://proxy.test/p%20x?tenant=one") as stream:
                    self.assertEqual(body.pulls, 0)
                    self.assertEqual(await anext(stream), b"\x00")
                    self.assertEqual(await anext(stream), b"\xff")
                self.assertEqual(body.closes, 1)
                self.assertEqual(len(transport.requests), 1)
                sent = transport.requests[0]
                self.assertEqual(sent.url, "https://proxy.test/p%20x/v1/tts?tenant=one")
                self.assertEqual(sent.method, "POST")
                self.assertEqual(sent.headers, {"authorization": "Bearer test-key", "model": r["model"], "content-type": "application/msgpack"})
                self.assertEqual(decode(sent.body), hydrate({**fixtures["defaults"], **case["wire"]}))

    async def test_shared_timeline_revisions_at_every_utf8_split(self) -> None:
        cases = json.loads((Path(__file__).parents[2] / "fixtures/fish.json").read_text())["timeline"]
        data = b"\xef\xbb\xbf" + "".join("data: " + json.dumps(case["packet"], ensure_ascii=False) + "\r\n\r\n" for case in cases).encode()
        r: TtsRequest = {"model": "s2-pro", "voice": "custom-voice", "text": "hello", "output": {"format": "mp3"}, "timestamp_granularity": "segment"}
        for split in range(len(data) + 1):
            body = Source([data[:split], data[split:]])
            transport = Transport(body)
            async with synthesize(r, auth=AUTH, transport=transport) as stream:
                self.assertEqual([item async for item in stream], [hydrate(case["item"], True) for case in cases])
            self.assertEqual(transport.requests[0].url, "https://api.fish.audio/v1/tts/stream/with-timestamp")
            self.assertEqual(body.closes, 1)

    async def test_http_errors_and_json_bound(self) -> None:
        for payload, limit, error in [(b'{"message":"No balance","reason":"balance"}', 1024, "Fish 402: No balance"), (b"x" * 33, 32, "Fish response exceeds max_json_bytes")]:
            body = Source([payload])
            with self.assertRaises((TypeError, FishError)) as raised:
                async with synthesize(request(), auth=AUTH, transport=Transport(body, 402), max_json_bytes=limit):
                    self.fail("error response accepted")
            self.assertEqual(str(raised.exception), error)
            if isinstance(raised.exception, FishError):
                self.assertEqual((raised.exception.status_code, raised.exception.reason), (402, "balance"))
            self.assertEqual(body.closes, 1)

    async def test_pending_http_headers_body_and_idle_timeout_cancel(self) -> None:
        for phase in ["headers", "body", "idle"]:
            body = Source([b"x"] if phase == "idle" else [], stall=True)
            transport = Transport(body)
            transport.stall = phase == "headers"
            with self.assertRaises(TimeoutError) as raised:
                async with synthesize(request(), auth=AUTH, transport=transport, timeout_ms=10) as stream:
                    await anext(stream)
                    await asyncio.Future[None]()
            self.assertEqual(str(raised.exception), "Fish synthesis deadline expired")
            self.assertEqual(transport.cancelled, int(phase == "headers"))
            self.assertEqual(body.cancelled, int(phase == "body"))
            self.assertEqual(body.closes, int(phase != "headers"))

    async def test_binary_socket_text_flush_stop_and_unknown_events(self) -> None:
        source: Source[Input] = Source(["Hel", {"command": "flush"}, "lo"])
        socket = Socket()
        socket.incoming.put_nowait(encode({"event": "future-extension"}))
        async with synthesize(request(source), web_socket=socket) as stream:
            self.assertEqual(source.pulls, 0)
            self.assertEqual([item async for item in stream], [b"\x00\xff", b"\x00\xff"])
        defaults = json.loads((Path(__file__).parents[2] / "fixtures/fish.json").read_text())["defaults"]
        self.assertEqual(socket.sent, [{"event": "start", "request": {**defaults, "text": ""}}, {"event": "text", "text": "Hel"}, {"event": "flush"}, {"event": "text", "text": "lo"}, {"event": "stop"}])
        self.assertTrue(socket.closed)
        self.assertEqual(source.closes, 1)

    async def test_blocked_write_does_not_block_audio_or_prefetch(self) -> None:
        trace: list[str] = []
        source: Source[Input] = Source(["hi", "unread"], trace=trace)
        socket = Socket(trace)
        cancelled = asyncio.Event()
        async def send(value: dict[object, object]) -> None:
            if value["event"] == "text":
                socket.incoming.put_nowait(encode({"event": "audio", "audio": b"x"}))
                try:
                    await asyncio.Future[None]()
                except asyncio.CancelledError:
                    cancelled.set()
                    raise
        socket.on_send = send
        async with asyncio.timeout(1):
            async with synthesize(request(source), web_socket=socket) as stream:
                self.assertEqual(await anext(stream), b"x")
                self.assertEqual(source.pulls, 1)
        self.assertEqual(trace, ["socket", "input"])
        self.assertTrue(cancelled.is_set())

    async def test_unread_socket_close_and_idle_deadline(self) -> None:
        source: Source[Input] = Source(["unread"])
        socket = Socket()
        async with synthesize(request(source), web_socket=socket):
            pass
        self.assertTrue(socket.closed)
        self.assertEqual((source.pulls, source.closes, socket.sent), (0, 0, []))
        source = Source(["hi"], stall=True)
        socket = Socket()
        with self.assertRaises(TimeoutError) as raised:
            async with synthesize(request(source), web_socket=socket, timeout_ms=10) as stream:
                await anext(stream)
                await asyncio.Future[None]()
        self.assertEqual(str(raised.exception), "Fish synthesis deadline expired")
        self.assertTrue(socket.closed)
        self.assertEqual(source.closes, 1)

    async def test_protocol_and_producer_errors_preserve_original(self) -> None:
        for origin in ["input", "read", "write"]:
            error = RuntimeError(origin)
            source: Source[Input] = Source([error] if origin == "input" else [], stall=True)
            socket = Socket()
            socket.close_error = RuntimeError("cleanup must not replace the original")
            if origin == "read":
                socket.incoming.put_nowait(error)
            if origin == "write":
                async def send(_: dict[object, object]) -> None:
                    raise error
                socket.on_send = send
            with self.assertRaises(RuntimeError) as raised:
                async with synthesize(request(source), web_socket=socket) as stream:
                    await anext(stream)
            self.assertIs(raised.exception, error)
            self.assertTrue(socket.closed)
            self.assertEqual(source.closes, 1)

    async def test_malformed_finish_and_frame_errors(self) -> None:
        for packet, error in [
            ("not binary", "Fish returned a non-binary WebSocket frame"),
            (encode({"event": "audio", "audio": "not bytes"}), "Fish returned an invalid WebSocket event"),
            (encode({"event": "finish", "reason": "future"}), "Fish returned an invalid WebSocket event"),
            (encode({"event": "finish", "reason": "stop"}), "Fish finished before the input stream ended"),
            (encode({"event": "finish", "reason": "error"}), "Fish 0: Streaming synthesis failed"),
            (encode({"event": "audio", "audio": b"x" * 1024}), "Fish message exceeds max_message_bytes"),
        ]:
            source: Source[Input] = Source([], stall=True)
            socket = Socket()
            socket.incoming.put_nowait(packet)
            with self.assertRaises((TypeError, FishError)) as raised:
                async with synthesize(request(source), web_socket=socket, max_message_bytes=1024) as stream:
                    await anext(stream)
            self.assertEqual(str(raised.exception), error)
            self.assertTrue(socket.closed)
            self.assertEqual(source.closes, 1)

    async def test_invalid_schema_values_fail_before_io(self) -> None:
        cases: list[dict[str, object]] = [{"text_chunk_length": 100.5}, {"max_audio_tokens": 1.5}, {"min_text_chunk_length": math.nan}, {"reference_samples": []}, {"output": {"format": "pcm", "sample_rate_hz": 24000.5}}]
        for changes in cases:
            transport = Transport(Source([b"x"]))
            with self.assertRaises(TypeError) as raised:
                async with synthesize(cast(TtsRequest, {**request(), **changes}), transport=transport, auth=AUTH):
                    pass
            self.assertEqual(str(raised.exception), "Invalid fish TTS request")
            self.assertEqual(transport.requests, [])

    async def test_invalid_timing_and_numeric_overflow(self) -> None:
        base = {"audio_base64": "AQ==", "content": "hi", "chunk_seq": 0, "chunk_audio_offset_sec": 0, "alignment": None}
        cases: list[tuple[dict[str, object], str]] = [
            ({"chunk_seq": True}, "Fish returned an invalid timestamp event"),
            ({"chunk_audio_offset_sec": 1e308}, "Fish returned an invalid timestamp event"),
            ({"alignment": {"audio_duration": 1e308, "segments": []}}, "Fish returned an invalid alignment snapshot"),
            ({"alignment": {"audio_duration": 1, "segments": [{"text": "x", "start": 1e308, "end": 1e308}]}}, "Fish returned an invalid timing segment"),
            ({"audio_base64": "!"}, "Fish returned invalid base64 audio"),
        ]
        for changes, error in cases:
            body = Source([("data: " + json.dumps({**base, **changes}) + "\n\n").encode()])
            r = cast(TtsRequest, {**request(), "timestamp_granularity": "segment"})
            with self.assertRaises(TypeError) as raised:
                async with synthesize(r, auth=AUTH, transport=Transport(body)) as stream:
                    await anext(stream)
            self.assertEqual(str(raised.exception), error)
            self.assertEqual(body.closes, 1)

    async def test_native_header_auth_models_binary_frames_and_completion(self) -> None:
        for model in ["s1", "s2-pro", "s2.1-pro", "s2.1-pro-free"]:
            async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
                line, headers = await upgrade(reader, writer)
                self.assertEqual(line, b"GET /p%20x/v1/tts/live?tenant=one HTTP/1.1")
                self.assertEqual(headers[b"authorization"], b"Bearer native-key")
                self.assertEqual(headers[b"model"], model.encode())
                for event in ["start", "text", "stop"]:
                    opcode, payload = await client_frame(reader)
                    self.assertEqual(opcode, 2)
                    value = decode(payload)
                    assert is_mapping(value)
                    self.assertEqual(value["event"], event)
                    if event == "text":
                        audio = encode({"event": "audio", "audio": b"\x00\xff"})
                        writer.write(bytes([0x82, len(audio)]) + audio)
                        await writer.drain()
                final = encode({"event": "finish", "reason": "stop"})
                writer.write(bytes([0x82, len(final)]) + final)
                await writer.drain()
                await reader.read()
            async with server(handle) as endpoint:
                source: Source[Input] = Source(["hi"])
                r = cast(TtsRequest, {**request(source), "model": model})
                with patch.dict("os.environ", {"SPEECHSWITCH_FISH_API_KEY": "native-key", "FISH_API_KEY": "wrong-key"}):
                    async with synthesize(r, base_url=endpoint + "/p%20x?tenant=one") as stream:
                        self.assertEqual([item async for item in stream], [b"\x00\xff"])
                self.assertEqual(source.closes, 1)
