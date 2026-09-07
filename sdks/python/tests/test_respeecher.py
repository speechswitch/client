import asyncio
import json
import os
import re
import unittest
from collections.abc import AsyncIterator, Awaitable
from pathlib import Path
from typing import cast
from unittest.mock import patch

from speechswitch.generated.auth import Auth
from speechswitch.generated.respeecher import TtsRequest, TtsRequestObjectTextAsyncIterableItem as Input
from speechswitch.generated.respeecher_output import SynthesisItem
from speechswitch.http import HttpRequest, HttpResponse
from speechswitch.providers.respeecher import RespeecherError, synthesize
from speechswitch.validation import is_mapping, is_sequence
from test_resemble import Body, Transport
from test_websocket import client_frame, server, upgrade

AUTH: Auth = {"respeecher": {"api_key": "fixture"}}
REQUEST: TtsRequest = {"text": "Hello", "voice": "custom"}
FIXTURES = Path(__file__).parents[2] / "fixtures/respeecher.json"


def python_names(value: object) -> object:
    if is_mapping(value):
        return {re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", str(key)).lower(): python_names(child) for key, child in value.items()}
    if is_sequence(value):
        return [python_names(child) for child in value]
    return value


class Socket:
    def __init__(self) -> None:
        self.messages: asyncio.Queue[str | bytes | Exception] = asyncio.Queue()
        self.sent: asyncio.Queue[dict[str, object]] = asyncio.Queue()
        self.closes = 0

    async def send(self, message: str | bytes) -> None:
        self.sent.put_nowait(json.loads(message))

    async def receive(self) -> str | bytes:
        value = await self.messages.get()
        if isinstance(value, Exception):
            raise value
        return value

    async def aclose(self) -> None:
        self.closes += 1

    def packet(self, value: object) -> None:
        self.messages.put_nowait(json.dumps(value))


class Source:
    def __init__(self) -> None:
        self.items: asyncio.Queue[Input | None] = asyncio.Queue()
        self.closed = asyncio.Event()
        self.reading = asyncio.Event()

    def __aiter__(self) -> AsyncIterator[Input]:
        return self

    async def __anext__(self) -> Input:
        self.reading.set()
        item = await self.items.get()
        if item is None:
            raise StopAsyncIteration
        return item

    async def aclose(self) -> None:
        self.closed.set()


class RespeecherTests(unittest.IsolatedAsyncioTestCase):
    async def test_shared_requests(self) -> None:
        fixtures: dict[str, list[dict[str, object]]] = json.loads(FIXTURES.read_text())
        for fixture in fixtures["requests"]:
            with self.subTest(name=fixture["name"]):
                wave = str(fixture["path"]).endswith("bytes")
                body = Body([b"\0\xff" if wave else b'{"type":"chunk","data":"AP8="}\n'])
                transport = Transport([HttpResponse(200, {"Content-Type": "audio/wav" if wave else "text/event-stream"}, body)])
                async with synthesize(cast(TtsRequest, python_names(fixture["request"])), auth=AUTH, transport=transport, protocol="http") as stream:
                    self.assertEqual([item async for item in stream], [b"\0\xff", {"event": "done"}])
                sent, = transport.requests
                self.assertEqual((sent.method, sent.url, dict(sent.headers), json.loads(sent.body)),
                    ("POST", "https://api.respeecher.com/v1/public/tts" + str(fixture["path"]), {"X-API-Key": "fixture", "Content-Type": "application/json"}, fixture["body"]))
                self.assertEqual(body.closes, 1)

    async def test_shared_jsonl_at_every_byte_split(self) -> None:
        fixtures: dict[str, list[dict[str, object]]] = json.loads(FIXTURES.read_text())
        for fixture in fixtures["jsonl"]:
            wire = str(fixture["wire"]).encode()
            for split in range(len(wire) + 1):
                with self.subTest(name=fixture["name"], split=split):
                    body = Body([wire[:split], wire[split:]])
                    transport = Transport([HttpResponse(200, {}, body)])
                    values: list[SynthesisItem] = []
                    error: Exception | None = None
                    try:
                        async with synthesize(REQUEST, auth=AUTH, transport=transport, protocol="http") as stream:
                            async for item in stream:
                                values.append(item)
                    except Exception as caught:
                        error = caught
                    expected: list[SynthesisItem] = [bytes(value) for value in cast(list[list[int]], fixture["audio"])]
                    if fixture["error"] is None:
                        expected.append({"event": "done"})
                    self.assertEqual(values, expected)
                    self.assertEqual(str(error) if error is not None else None, fixture["error"])
                    if isinstance(error, RespeecherError):
                        self.assertEqual((error.status_code, error.context_id), (429, "native"))
                    self.assertEqual(body.closes, 1)

    async def test_incremental_flush_overlapping_clear_and_late_output(self) -> None:
        socket, source = Socket(), Source()
        async with asyncio.timeout(3):
            async with synthesize({"text": source, "voice": "custom"}, auth=AUTH, web_socket=socket) as stream:
                pending = asyncio.ensure_future(anext(stream))
                source.items.put_nowait("First")
                first = await socket.sent.get()
                one = first["context_id"]
                self.assertEqual({key: value for key, value in first.items() if key != "context_id"}, {
                    "transcript": "First", "continue": True, "voice": {"id": "custom", "sampling_params": {}},
                    "output_format": {"sample_rate": 22050, "encoding": "pcm_f32le"}})
                source.items.put_nowait({"command": "flush"})
                self.assertEqual(await socket.sent.get(), {**first, "transcript": "", "continue": False})
                source.items.put_nowait("Second")
                second = await socket.sent.get()
                two = second["context_id"]
                self.assertNotEqual(one, two)
                socket.packet({"type": "chunk", "context_id": one, "data": "AQ=="})
                self.assertEqual(await pending, {"correlation": "ordered", "correlation_id": one, "audio": b"\1", "timestamps": ()})
                pending = asyncio.ensure_future(anext(stream))
                source.items.put_nowait({"command": "clear"})
                self.assertEqual(await pending, {"event": "clear"})
                self.assertEqual(await socket.sent.get(), {"context_id": one, "cancel": True})
                self.assertEqual(await socket.sent.get(), {"context_id": two, "cancel": True})
                socket.packet({"type": "error", "context_id": one, "status_code": 499, "error": "canceled"})
                socket.packet({"type": "chunk", "context_id": two, "data": "AP8="})
                socket.packet({"type": "done", "context_id": one})
                pending = asyncio.ensure_future(anext(stream))
                source.items.put_nowait("Third")
                third = await socket.sent.get()
                three = third["context_id"]
                source.items.put_nowait({"command": "flush"})
                self.assertEqual(await socket.sent.get(), {**third, "transcript": "", "continue": False})
                socket.packet({"type": "chunk", "context_id": three, "data": "Ag=="})
                self.assertEqual(await pending, {"correlation": "ordered", "correlation_id": three, "audio": b"\2", "timestamps": ()})
                socket.packet({"type": "done", "context_id": three})
                self.assertEqual(await anext(stream), {"event": "flush", "correlation_id": three, "input_group_id": three})
                source.items.put_nowait(None)
                self.assertEqual(await anext(stream), {"event": "done"})
            self.assertEqual(socket.closes, 1)

    async def test_native_header_auth_and_whole_text_socket_eof(self) -> None:
        finished = asyncio.Event()
        async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            path, headers = await upgrade(reader, writer)
            self.assertEqual(path, b"GET /proxy/tts/websocket?route=uk HTTP/1.1")
            self.assertEqual(headers[b"x-api-key"], b"fixture")
            first = json.loads((await client_frame(reader))[1])
            final = json.loads((await client_frame(reader))[1])
            self.assertEqual(final, {**first, "transcript": "", "continue": False})
            for value in [{"type": "chunk", "context_id": first["context_id"], "data": "AP8="}, {"type": "done", "context_id": first["context_id"]}]:
                encoded = json.dumps(value, separators=(",", ":")).encode()
                self.assertLess(len(encoded), 126)
                writer.write(bytes([129, len(encoded)]) + encoded)
            await writer.drain()
            await reader.read()
            finished.set()
        async with server(handle) as url:
            async with synthesize(REQUEST, auth=AUTH, base_url=url.replace("ws:", "http:") + "/proxy?route=uk") as stream:
                values = [item async for item in stream]
                self.assertEqual(len(values), 2)
                audio = values[0]
                assert not isinstance(audio, bytes) and "audio" in audio
                self.assertEqual((audio["correlation"], audio["audio"], audio["timestamps"], values[1]), ("ordered", b"\0\xff", (), {"event": "done"}))
            await finished.wait()

    async def test_deadlines_and_early_exit_close_input_and_socket(self) -> None:
        for mode in ("timeout", "cancel", "break"):
            socket, source = Socket(), Source()
            async def consume() -> None:
                async with synthesize({"text": source, "voice": "custom"}, auth=AUTH, web_socket=socket,
                                      timeout_ms=25 if mode == "timeout" else None) as stream:
                    await anext(stream)
            task = asyncio.create_task(consume())
            await source.reading.wait()
            if mode == "cancel":
                task.cancel()
            elif mode == "break":
                source.items.put_nowait({"command": "clear"})
            if mode == "break":
                await task
            else:
                with self.assertRaises(TimeoutError if mode == "timeout" else asyncio.CancelledError):
                    await task
            async with asyncio.timeout(1):
                await source.closed.wait()
            self.assertEqual(socket.closes, 1)

    async def test_http_lifecycle_status_content_type_and_read_identity(self) -> None:
        failure = RuntimeError("read failed")
        cases: list[tuple[int, dict[str, str], Body, str]] = [(403, {}, Body([b"secret"]), "Respeecher returned HTTP 403"),
                 (200, {"Content-Type": "text/html"}, Body([b"secret"]), "Respeecher returned an unexpected content type"),
                 (200, {}, Body([failure], close_error=RuntimeError("cleanup")), "read failed"),
                 (200, {}, Body([b"x" * 65]), "Respeecher line exceeds max_message_bytes")]
        for status, headers, body, expected in cases:
            with self.subTest(expected=expected):
                transport = Transport([HttpResponse(status, headers, body)])
                with self.assertRaises(Exception) as caught:
                    async with synthesize(REQUEST, auth=AUTH, transport=transport, protocol="http", max_message_bytes=64) as stream:
                        await anext(stream)
                self.assertEqual(str(caught.exception), expected)
                if expected == "read failed":
                    self.assertIs(caught.exception, failure)
                self.assertEqual(body.closes, 1)
                if expected != "read failed" and status == 403:
                    self.assertEqual(body.reads, 0)
        for mode in ("timeout", "cancel", "break"):
            body = Body([b"audio"] if mode == "break" else [], stall=True)
            transport = Transport([HttpResponse(200, {}, body)])
            async def consume() -> None:
                async with synthesize({"text": "Hi", "voice": "v", "output": {"format": "wav"}}, auth=AUTH,
                                      transport=transport, timeout_ms=25 if mode == "timeout" else None) as stream:
                    await anext(stream)
            task = asyncio.create_task(consume())
            if mode == "cancel":
                await body.reading.wait()
                task.cancel()
            if mode == "break":
                await task
            else:
                with self.assertRaises(TimeoutError if mode == "timeout" else asyncio.CancelledError):
                    await task
            self.assertEqual(body.closes, 1)

    async def test_schema_and_boundary_errors_precede_io(self) -> None:
        socket = Socket()
        for request in [{"text": "Hi", "voice": "v", "top_p": 0}, {"text": "Hi", "voice": "v", "top_k": -1},
                        {"text": "Hi", "voice": "v", "output": {"format": "mulaw", "sample_encoding": "float_32"}}]:
            with self.assertRaises(TypeError):
                async with synthesize(cast(TtsRequest, request), auth=AUTH, web_socket=socket):
                    self.fail("invalid request accepted")
        self.assertEqual((socket.sent.qsize(), socket.closes), (0, 0))
        for timeout in (-1, True, 2147483648):
            with self.assertRaises(TypeError) as caught:
                async with synthesize(REQUEST, auth=AUTH, timeout_ms=timeout):
                    self.fail("invalid timeout accepted")
            self.assertEqual(str(caught.exception), "Respeecher timeout_ms must be an integer between 0 and 2147483647")
        with self.assertRaises(TimeoutError) as caught:
            async with synthesize(REQUEST, auth=AUTH, timeout_ms=0):
                self.fail("zero timeout accepted")
        self.assertEqual(str(caught.exception), "Respeecher synthesis deadline expired")

    async def test_auth_precedence_prefix_query_and_lazy_io(self) -> None:
        for auth, expected in [(AUTH, "fixture"), (None, "scoped")]:
            transport = Transport([HttpResponse(200, {}, Body([b'{"type":"chunk","data":"AQ=="}']))])
            with patch.dict(os.environ, {"SPEECHSWITCH_RESPEECHER_API_KEY": "scoped", "RESPEECHER_API_KEY": "legacy"}):
                async with synthesize(REQUEST, auth=auth, transport=transport, protocol="http", base_url="https://proxy.example/prefix?route=uk") as stream:
                    self.assertEqual(transport.requests, [])
                    await anext(stream)
            self.assertEqual(transport.requests[0].url, "https://proxy.example/prefix/tts/sse?route=uk")
            self.assertEqual(transport.requests[0].headers["X-API-Key"], expected)
        transport = Transport([])
        async with synthesize(REQUEST, auth=AUTH, transport=transport, protocol="http"):
            pass
        self.assertEqual(transport.requests, [])
        with patch.dict(os.environ, {"SPEECHSWITCH_RESPEECHER_API_KEY": "fallback"}):
            with self.assertRaises(TypeError) as caught:
                async with synthesize(REQUEST, auth={"respeecher": {"api_key": ""}}):
                    self.fail("empty explicit key accepted")
        self.assertEqual(str(caught.exception), "Missing auth.respeecher.apiKey configuration")

    async def test_unread_override_is_owned(self) -> None:
        socket = Socket()
        async with synthesize(REQUEST, auth=AUTH, web_socket=socket):
            self.assertEqual(socket.closes, 0)
        self.assertEqual((socket.closes, socket.sent.qsize()), (1, 0))

    async def test_socket_protocol_errors_exactly(self) -> None:
        cases: list[tuple[object, str]] = [
            ([], "Invalid Respeecher response"),
            ({"type": "chunk", "context_id": None, "data": "AQ=="}, "Invalid Respeecher context ID"),
            ({"type": "chunk", "data": "AQ=="}, "Respeecher omitted the native context ID"),
            ({"type": "chunk", "context_id": "wrong", "data": "AQ=="}, "Respeecher returned an unknown context ID"),
            ({"type": "error", "status_code": True, "error": "secret"}, "Invalid Respeecher error response"),
            ({"type": "error", "status_code": 429.5, "error": "secret"}, "Invalid Respeecher error response"),
            ({"type": "error", "status_code": 429, "error": "quota"}, "quota"),
        ]
        for packet, expected in cases:
            socket, source = Socket(), Source()
            socket.packet(packet)
            with self.assertRaises(Exception) as caught:
                async with synthesize({"text": source, "voice": "v"}, auth=AUTH, web_socket=socket) as stream:
                    await anext(stream)
            self.assertEqual(str(caught.exception), expected)
            self.assertEqual(socket.closes, 1)
        for ended, expected in [(False, "Respeecher completed a context before its text ended"), (True, "Respeecher completed a context without audio")]:
            socket, source = Socket(), Source()
            async with synthesize({"text": source, "voice": "v"}, auth=AUTH, web_socket=socket) as stream:
                pending = asyncio.ensure_future(anext(stream))
                source.items.put_nowait("Hello")
                message = await socket.sent.get()
                if ended:
                    source.items.put_nowait(None)
                    await socket.sent.get()
                socket.packet({"type": "done", "context_id": message["context_id"]})
                with self.assertRaises(TypeError) as caught:
                    await pending
                self.assertEqual(str(caught.exception), expected)
            self.assertEqual(socket.closes, 1)

    async def test_receive_continues_during_send_backpressure(self) -> None:
        class Backpressure(Socket):
            async def send(self, message: str | bytes) -> None:
                await super().send(message)
                await asyncio.Future[None]()
        socket = Backpressure()
        async with synthesize(REQUEST, auth=AUTH, web_socket=socket) as stream:
            pending = asyncio.ensure_future(anext(stream))
            message = await socket.sent.get()
            socket.packet({"type": "chunk", "context_id": message["context_id"], "data": "AQ=="})
            async with asyncio.timeout(1):
                self.assertEqual(await pending, {"correlation": "ordered", "correlation_id": message["context_id"], "audio": b"\1", "timestamps": ()})
        self.assertEqual(socket.closes, 1)

    async def test_uncooperative_producer_does_not_hold_cancellation(self) -> None:
        release = asyncio.Event()
        class Uncooperative(Source):
            async def __anext__(self) -> Input:
                self.reading.set()
                try:
                    await asyncio.Future[None]()
                except asyncio.CancelledError:
                    await release.wait()
                raise StopAsyncIteration
        source, socket = Uncooperative(), Socket()
        async def consume() -> None:
            async with synthesize({"text": source, "voice": "v"}, auth=AUTH, web_socket=socket) as stream:
                await anext(stream)
        task = asyncio.create_task(consume())
        try:
            await source.reading.wait()
            task.cancel()
            async with asyncio.timeout(1):
                with self.assertRaises(asyncio.CancelledError):
                    await task
            self.assertEqual(socket.closes, 1)
        finally:
            release.set()
            async with asyncio.timeout(1):
                await source.closed.wait()

    async def test_pending_http_headers_are_canceled(self) -> None:
        started, canceled = asyncio.Event(), asyncio.Event()
        class Pending:
            async def send(self, request: HttpRequest) -> HttpResponse:
                started.set()
                try:
                    await asyncio.Future[None]()
                    raise AssertionError("unreachable")
                finally:
                    canceled.set()
        async def consume() -> None:
            async with synthesize(REQUEST, auth=AUTH, protocol="http", transport=Pending()) as stream:
                await anext(stream)
        task = asyncio.create_task(consume())
        await started.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertTrue(canceled.is_set())

    async def test_synchronous_producer_cleanup_cannot_replace_input_failure(self) -> None:
        failure = RuntimeError("input failed")
        closed = asyncio.Event()
        class FailingSource:
            def __aiter__(self) -> AsyncIterator[Input]:
                return self
            async def __anext__(self) -> Input:
                raise failure
            def aclose(self) -> Awaitable[None]:
                closed.set()
                raise RuntimeError("cleanup failed synchronously")
        socket = Socket()
        with self.assertRaises(RuntimeError) as caught:
            async with synthesize({"text": FailingSource(), "voice": "v"}, auth=AUTH, web_socket=socket) as stream:
                await anext(stream)
        self.assertIs(caught.exception, failure)
        async with asyncio.timeout(1):
            await closed.wait()
        self.assertEqual(socket.closes, 1)
