import asyncio
import json
import unittest
from pathlib import Path
from collections.abc import AsyncIterable, AsyncIterator
from typing import NotRequired, TypedDict, cast
from urllib.parse import parse_qs, urlsplit

from speechswitch.generated.async_ import TtsRequest
from speechswitch.http import HttpRequest, HttpResponse
from speechswitch.providers.async_ import synthesize
from test_websocket import client_frame, server, upgrade


def request(text: str | AsyncIterable[str] = "Hello") -> TtsRequest:
    if isinstance(text, str):
        return {"model": "castleflow-1.0", "voice": "owned", "text": text, "output": {"format": "pcm", "sample_rate_hz": 24000}}
    return {"model": "castleflow-1.0", "voice": "owned", "text": text, "output": {"format": "pcm", "sample_rate_hz": 24000}}


class Body:
    def __init__(self, chunks: list[bytes]) -> None:
        self.chunks = list(chunks)
        self.reads = 0
        self.closes = 0
    def __aiter__(self) -> AsyncIterator[bytes]:
        return self
    async def __anext__(self) -> bytes:
        self.reads += 1
        if not self.chunks:
            raise StopAsyncIteration
        return self.chunks.pop(0)
    async def aclose(self) -> None:
        self.closes += 1


class Transport:
    def __init__(self, body: Body, status: int = 200) -> None:
        self.body, self.status = body, status
        self.requests: list[HttpRequest] = []
    async def send(self, request: HttpRequest) -> HttpResponse:
        self.requests.append(request)
        return HttpResponse(self.status, {}, self.body)


class Socket:
    def __init__(self, mode: str = "normal") -> None:
        self.sent: list[dict[str, object]] = []
        self.incoming: asyncio.Queue[str | bytes] = asyncio.Queue()
        self.closes = 0
        self.closed = False
        self.mode = mode
    async def send(self, message: str | bytes) -> None:
        assert isinstance(message, str)
        value: dict[str, object] = json.loads(message)
        self.sent.append(value)
        if value.get("close_context") is True:
            self.incoming.put_nowait(json.dumps({"context_id": value["context_id"], "audio": "", "final": True}))
        elif value.get("transcript"):
            packet: str | bytes = json.dumps({"context_id": "wrong" if self.mode == "context" else value["context_id"], "audio": "AP+A", "final": self.mode == "early"})
            if self.mode == "binary":
                packet = b"binary"
            elif self.mode == "error":
                packet = json.dumps({"error_code": "quota", "message": "exhausted"})
            self.incoming.put_nowait(packet)
    async def receive(self) -> str | bytes:
        return await self.incoming.get()
    async def aclose(self) -> None:
        if not self.closed:
            self.closed = True
            self.closes += 1


class AsyncTests(unittest.IsolatedAsyncioTestCase):
    async def test_shared_http_fixtures_at_every_byte_split(self) -> None:
        class Fixture(TypedDict):
            name: str
            mode: str
            status: int
            bodyBytes: NotRequired[list[int]]
            bodyText: NotRequired[str]
            audio: list[int]
            envelopes: list[object]
            error: NotRequired[str]
        fixtures: list[Fixture] = json.loads((Path(__file__).resolve().parents[2] / "fixtures/async.json").read_text())
        for fixture in fixtures:
            data = bytes(fixture["bodyBytes"]) if "bodyBytes" in fixture else fixture.get("bodyText", "").encode()
            value: TtsRequest = request("Hi")
            if fixture["mode"] == "plain":
                value = {"model": "castleflow-1.0", "voice": "owned", "text": "Hi", "output": {"format": "wav", "sample_rate_hz": 24000}}
            elif fixture["mode"] == "timestamped":
                value = {"model": "castleflow-1.0", "voice": "owned", "text": "Hi", "output": {"format": "pcm", "sample_rate_hz": 24000}, "timestamp_granularity": "word"}
            for split in range(len(data) + 1):
                body = Body([data[:split], data[split:]])
                audio = bytearray()
                envelopes: list[object] = []
                failure: str | None = None
                try:
                    async with synthesize(value, transport=Transport(body, fixture["status"]), auth={"async_": {"api_key": "test"}}) as stream:
                        async for item in stream:
                            if isinstance(item, bytes):
                                audio.extend(item)
                            else:
                                envelopes.append({"correlation": item["correlation"], "audio": list(item["audio"]), "timestamps": [{"kind": value["kind"], "value": value["value"], "startTimeMs": value["start_time_ms"], "endTimeMs": value["end_time_ms"]} for value in item["timestamps"]]})
                except TypeError as error:
                    failure = str(error)
                self.assertEqual((list(audio), envelopes, failure), (fixture["audio"], fixture["envelopes"], fixture.get("error")), f"{fixture['name']} split {split}")
                self.assertEqual(body.closes, 1)

    async def test_http_settings_routes_and_early_cleanup(self) -> None:
        cases: list[tuple[TtsRequest, str, dict[str, object]]] = [
            ({"model": "castleflow-1.0", "voice": "owned", "text": "Hello", "language": "ja", "stability": 0.005, "speed": 0.7, "output": {"format": "pcm", "sample_rate_hz": 8000, "sample_encoding": "float_32"}}, "/text_to_speech/streaming", {"model_id": "async_flash_v1.0", "voice": {"mode": "id", "id": "owned"}, "output_format": {"container": "raw", "sample_rate": 8000, "encoding": "pcm_f32le"}, "language": "ja", "stability": 1, "speed_control": 0.7, "transcript": "Hello"}),
            ({"model": "flash_v1.5", "voice": "custom", "text": "Hello", "output": {"format": "wav", "sample_rate_hz": 48000}}, "/text_to_speech", {"model_id": "async_flash_v1.5", "voice": {"mode": "id", "id": "custom"}, "output_format": {"container": "wav", "sample_rate": 48000, "encoding": "pcm_s16le"}, "transcript": "Hello"}),
            ({"model": "pro_v1.0", "voice": "owned", "text": "Hello", "output": {"format": "mp3", "sample_rate_hz": 24000}}, "/text_to_speech/streaming", {"model_id": "async_pro_v1.0", "voice": {"mode": "id", "id": "owned"}, "output_format": {"container": "mp3", "sample_rate": 24000, "bit_rate": 192000}, "transcript": "Hello"}),
            ({"model": "castleflow-1.0", "voice": "owned", "text": "Hello", "stability": 0, "output": {"format": "mulaw", "sample_rate_hz": 8000}}, "/text_to_speech/streaming", {"model_id": "async_flash_v1.0", "voice": {"mode": "id", "id": "owned"}, "stability": 0, "output_format": {"container": "raw", "sample_rate": 8000, "encoding": "pcm_mulaw"}, "transcript": "Hello"}),
        ]
        for value, path, expected in cases:
            body = Body([b"\0\xff", b"later"])
            transport = Transport(body)
            async with synthesize(value, transport=transport, auth={"async_": {"api_key": "test"}}, base_url="https://proxy.test/prefix%20path/?a=1") as stream:
                self.assertEqual(body.reads, 0)
                self.assertEqual(await anext(stream), b"\0\xff")
                self.assertEqual(body.reads, 1)
            self.assertEqual(body.closes, 1)
            wire = transport.requests[0]
            self.assertEqual(wire.url, f"https://proxy.test/prefix%20path{path}?a=1")
            self.assertEqual(wire.headers, {"x-api-key": "test", "version": "v1", "content-type": "application/json"})
            self.assertEqual(json.loads(wire.body), expected)

    async def test_quota_marker_at_every_byte_split_and_partial_prefix_eof(self) -> None:
        data = b"\0\xff--ERROR:QUOTA_EXCEEDED--discard"
        for split in range(len(data) + 1):
            body = Body([data[:split], data[split:]])
            output: list[bytes] = []
            with self.assertRaises(TypeError) as caught:
                async with synthesize(request(), transport=Transport(body), auth={"async_": {"api_key": "test"}}) as stream:
                    async for item in stream:
                        assert isinstance(item, bytes)
                        output.append(item)
            self.assertEqual(str(caught.exception), "Async streaming quota exceeded")
            self.assertEqual(b"".join(output), b"\0\xff")
            self.assertEqual(body.closes, 1)
        for data in [b"--ERR", b"abc--EX", b"--ERROR:QUOTA_EXCEEDED-"]:
            async with synthesize(request(), transport=Transport(Body([data])), auth={"async_": {"api_key": "test"}}) as stream:
                parts: list[bytes] = []
                async for item in stream:
                    assert isinstance(item, bytes)
                    parts.append(item)
            self.assertEqual(b"".join(parts), data)

    async def test_timestamp_association_and_exact_errors(self) -> None:
        value: TtsRequest = {"model": "flash_v1.5", "voice": "owned", "text": "Hi", "output": {"format": "mp3", "sample_rate_hz": 24000, "bit_rate_bps": 32000}, "timestamp_granularity": "word"}
        data = json.dumps({"audio_base64": "AP+A", "alignment": {"words": ["Hi"], "word_start_times_milliseconds": [0], "word_end_times_milliseconds": [1.5]}}).encode()
        for split in range(len(data) + 1):
            body = Body([data[:split], data[split:]])
            transport = Transport(body)
            async with synthesize(value, transport=transport, auth={"async_": {"api_key": "test"}}) as stream:
                self.assertEqual([item async for item in stream], [{"correlation": "chunk", "audio": b"\0\xff\x80", "timestamps": [{"kind": "word", "value": "Hi", "start_time_ms": 0, "end_time_ms": 1.5}]}])
            self.assertEqual(transport.requests[0].url, "https://api.async.com/text_to_speech/with_timestamps")
            self.assertEqual(body.closes, 1)
        failures: list[tuple[object, str]] = [
            ([], "Async returned an invalid timestamp response"),
            ({"audio_base64": "AA=="}, "Async returned incomplete timestamped audio"),
            ({"audio_base64": "AA==", "alignment": {"words": ["Hi"], "word_start_times_milliseconds": [], "word_end_times_milliseconds": []}}, "Async returned mismatched word timestamp arrays"),
            ({"audio_base64": "AA==", "alignment": {"words": ["Hi"], "word_start_times_milliseconds": [False], "word_end_times_milliseconds": [1]}}, "Async returned an invalid word timestamp"),
        ]
        for payload, expected in failures:
            with self.assertRaises(TypeError) as caught:
                async with synthesize(value, transport=Transport(Body([json.dumps(payload).encode()])), auth={"async_": {"api_key": "test"}}) as stream:
                    await anext(stream)
            self.assertEqual(str(caught.exception), expected)

    async def test_incremental_wire_flow_and_source_cleanup(self) -> None:
        closed = asyncio.Event()
        async def text() -> AsyncIterator[str]:
            try:
                for chunk in ["", "hello\ufeff", "world\u0085"]:
                    yield chunk
            finally:
                closed.set()
        value: TtsRequest = {"model": "pro_v1.0", "voice": "custom", "text": text(), "output": {"format": "pcm", "sample_rate_hz": 24000}, "segmentation": "immediate"}
        socket = Socket()
        async with synthesize(value, auth={"async_": {"api_key": "test"}}, web_socket=socket) as stream:
            self.assertEqual([item async for item in stream], [b"\0\xff\x80", b"\0\xff\x80"])
        self.assertEqual(socket.sent[0], {"model_id": "async_pro_v1.0", "voice": {"mode": "id", "id": "custom"}, "output_format": {"container": "raw", "sample_rate": 24000, "encoding": "pcm_s16le"}})
        context_id = socket.sent[1]["context_id"]
        self.assertEqual(socket.sent[1:], [{"context_id": context_id, "transcript": "hello ", "force": True}, {"context_id": context_id, "transcript": "world\u0085 ", "force": True}, {"context_id": context_id, "transcript": "", "close_context": True}])
        self.assertEqual((closed.is_set(), socket.closes), (True, 1))

    async def test_incremental_failures_cancel_stalled_input(self) -> None:
        for mode, expected in [("context", "Async returned output for an unexpected context"), ("early", "Async finalized the context before input completed"), ("binary", "Async returned a non-text WebSocket frame"), ("error", "Async synthesis failed (quota): exhausted")]:
            closed = asyncio.Event()
            async def text() -> AsyncIterator[str]:
                try:
                    yield "hello"
                    await asyncio.Event().wait()
                finally:
                    closed.set()
            socket = Socket(mode)
            async with asyncio.timeout(1):
                with self.assertRaises(TypeError) as caught:
                    async with synthesize(request(text()), auth={"async_": {"api_key": "test"}}, web_socket=socket) as stream:
                        await anext(stream)
            self.assertEqual(str(caught.exception), expected)
            self.assertEqual((closed.is_set(), socket.closes), (True, 1))

    async def test_native_socket_auth_context_and_completion(self) -> None:
        completed = asyncio.Event()
        async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            path, _ = await upgrade(reader, writer)
            target = urlsplit(path.decode().split(" ")[1])
            self.assertEqual(target.path, "/socket")
            self.assertEqual(parse_qs(target.query), {"keep": ["value"], "api_key": ["native + key"], "version": ["v1"]})
            _, settings = await client_frame(reader)
            self.assertEqual(json.loads(settings)["voice"], {"mode": "id", "id": "owned"})
            _, first = await client_frame(reader)
            chunk = json.loads(first)
            self.assertEqual(chunk["transcript"], "hello ")
            _, final = await client_frame(reader)
            self.assertEqual(json.loads(final), {"context_id": chunk["context_id"], "transcript": "", "close_context": True})
            payload = json.dumps({"context_id": chunk["context_id"], "audio": "AP+A", "final": True}, separators=(",", ":")).encode()
            writer.write(bytes([0x81, len(payload)]) + payload)
            await writer.drain()
            await reader.read()
            completed.set()
        async def text() -> AsyncIterator[str]:
            yield "hello"
        async with server(handle) as url:
            async with synthesize(request(text()), auth={"async_": {"api_key": "native + key"}}, web_socket_url=url + "/socket?keep=value&api_key=old&version=old") as stream:
                self.assertEqual([item async for item in stream], [b"\0\xff\x80"])
            await completed.wait()

    async def test_generated_rejection_precedes_network_and_iteration(self) -> None:
        class Text:
            def __aiter__(self) -> AsyncIterator[str]:
                raise AssertionError("input acquired")
        socket = Socket()
        invalid = cast(TtsRequest, {"model": "pro_v1.0", "voice": "owned", "text": Text(), "output": {"format": "wav", "sample_rate_hz": 24000}})
        with self.assertRaises(TypeError) as caught:
            async with synthesize(invalid, auth={"async_": {"api_key": "test"}}, web_socket=socket):
                self.fail("invalid request accepted")
        self.assertEqual(str(caught.exception), "Invalid async TTS request")
        self.assertEqual((socket.sent, socket.closes), ([], 0))
        async def text() -> AsyncIterator[str]:
            yield cast(str, 42)
        with self.assertRaises(TypeError) as caught:
            async with synthesize(request(text()), auth={"async_": {"api_key": "test"}}, web_socket=socket) as stream:
                await anext(stream)
        self.assertEqual(str(caught.exception), "Invalid async TTS input item")
        self.assertEqual(len(socket.sent), 1)
        self.assertEqual(socket.closes, 1)

    async def test_unread_exit_and_failed_initialization_do_not_acquire_input(self) -> None:
        class Text:
            def __aiter__(self) -> AsyncIterator[str]:
                raise AssertionError("input acquired")
        socket = Socket()
        async with synthesize(request(Text()), auth={"async_": {"api_key": "test"}}, web_socket=socket):
            pass
        self.assertEqual((socket.sent, socket.closes), ([], 1))
        cause = RuntimeError("initialization failed")
        class FailedSocket(Socket):
            async def send(self, message: str | bytes) -> None:
                raise cause
        socket = FailedSocket()
        with self.assertRaises(RuntimeError) as caught:
            async with synthesize(request(Text()), auth={"async_": {"api_key": "test"}}, web_socket=socket) as stream:
                await anext(stream)
        self.assertIs(caught.exception, cause)
        self.assertEqual(socket.closes, 1)
        body = Body([b"unread"])
        async with synthesize(request(), transport=Transport(body), auth={"async_": {"api_key": "test"}}):
            pass
        self.assertEqual((body.reads, body.closes), (0, 1))
        socket = Socket()
        with self.assertRaises(TypeError) as caught:
            async with synthesize(request(Text()), auth={"async_": {"api_key": "test"}}, web_socket=socket, max_message_bytes=1) as stream:
                await anext(stream)
        self.assertEqual(str(caught.exception), "Async message exceeds max_message_bytes")
        self.assertEqual((socket.sent, socket.closes), ([], 1))

    async def test_early_exit_and_cancellation_release_stalled_input(self) -> None:
        for cancel in (False, True):
            closed, started = asyncio.Event(), asyncio.Event()
            async def text() -> AsyncIterator[str]:
                try:
                    yield "hello"
                    started.set()
                    await asyncio.Event().wait()
                finally:
                    closed.set()
            socket = Socket()
            async def run() -> None:
                async with synthesize(request(text()), auth={"async_": {"api_key": "test"}}, web_socket=socket) as stream:
                    self.assertEqual(await anext(stream), b"\0\xff\x80")
                    if cancel:
                        await anext(stream)
            async with asyncio.timeout(1):
                task = asyncio.create_task(run())
                await started.wait()
                if cancel:
                    task.cancel()
                    with self.assertRaises(asyncio.CancelledError):
                        await task
                else:
                    await task
            self.assertEqual((socket.closes, closed.is_set()), (1, True))

    async def test_http_errors_limits_and_input_error_identity(self) -> None:
        body = Body([b"too large"])
        with self.assertRaises(TypeError) as caught:
            async with synthesize(request(), transport=Transport(body, 500), auth={"async_": {"api_key": "test"}}, max_json_bytes=2) as stream:
                await anext(stream)
        self.assertEqual(str(caught.exception), "Async response exceeds max_json_bytes")
        self.assertEqual(body.closes, 1)
        cause = RuntimeError("input failed")
        async def text() -> AsyncIterator[str]:
            raise cause
            yield "unreachable"
        socket = Socket()
        with self.assertRaises(RuntimeError) as caught:
            async with synthesize(request(text()), auth={"async_": {"api_key": "test"}}, web_socket=socket) as stream:
                await anext(stream)
        self.assertIs(caught.exception, cause)
        self.assertEqual(socket.closes, 1)

    async def test_empty_incremental_input_does_not_start_a_context(self) -> None:
        async def text() -> AsyncIterator[str]:
            yield ""
        socket = Socket()
        async with synthesize(request(text()), auth={"async_": {"api_key": "test"}}, web_socket=socket) as stream:
            self.assertEqual([item async for item in stream], [])
        self.assertEqual(len(socket.sent), 1)
        self.assertEqual(socket.closes, 1)
