import asyncio
import json
import os
import unittest
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import Literal, cast
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from speechswitch.generated.auth import Auth
from speechswitch.generated.smallest_ai import TtsRequest, TtsRequestLightningV31ProStreamingTextVoice8f1b36fbTextItem as Input
from speechswitch.generated.smallest_ai import TtsRequestLightningV31ProTextVoice74d06326PronunciationDictionariesItem as Dictionary
from speechswitch.generated.smallest_ai_output import SynthesisItem
from speechswitch.generated.validators.smallest_ai import validate_request
from speechswitch.http import HttpRequest, HttpResponse
from speechswitch.providers.smallest_ai import SmallestError, synthesize
from speechswitch.websocket import WebSocketError
from test_resemble import Body, Transport, python_names
from test_rime import Socket
from test_websocket import client_frame, server, upgrade

AUTH: Auth = {"smallest_ai": {"api_key": "fixture"}}
BASE: TtsRequest = {"model": "lightning-v3.1", "voice": "custom_voice", "text": "Hello"}
SETTINGS: dict[str, object] = {"voice_id": "custom_voice", "model": "lightning_v3.1", "language": "auto", "sample_rate": 44100, "output_format": "pcm", "speed": 1, "math_notation": False}
FIXTURES = Path(__file__).parents[2] / "fixtures/smallest.json"


class Source[T]:
    def __init__(self) -> None:
        self.items: asyncio.Queue[T | Exception | None] = asyncio.Queue()
        self.closed = asyncio.Event()
        self.reading = asyncio.Event()
        self.reads = 0

    def __aiter__(self) -> AsyncIterator[T]:
        return self

    async def __anext__(self) -> T:
        self.reads += 1
        self.reading.set()
        value = await self.items.get()
        if value is None:
            raise StopAsyncIteration
        if isinstance(value, Exception):
            raise value
        return value

    async def aclose(self) -> None:
        self.closed.set()


class AutoSocket(Socket):
    async def send(self, message: str | bytes) -> None:
        await super().send(message)
        value: dict[str, object] = json.loads(message)
        if value.get("text"):
            self.packet({"status": "chunk", "request_id": "native", "data": {"audio": "AP+A"}})
        if value.get("flush") or value.get("text") and "continue" not in value:
            self.packet({"status": "complete", "request_id": "native"})


def sse(*values: object) -> bytes:
    return "".join("data: " + json.dumps(value) + "\n\n" for value in values).encode()

class SmallestTypes(unittest.TestCase):
    def test_pro_preserves_language_false_and_empty_dictionaries(self) -> None:
        request: TtsRequest = {"model": "lightning-v3.1-pro", "text": "こんにちは", "voice": "saved-voice", "language": "ja", "formula_reading": False, "pronunciation_dictionaries": []}
        self.assertEqual(request, {"model": "lightning-v3.1-pro", "text": "こんにちは", "voice": "saved-voice", "language": "ja", "formula_reading": False, "pronunciation_dictionaries": []})


class SmallestTests(unittest.IsolatedAsyncioTestCase):
    async def test_dictionaries_use_validated_indices(self) -> None:
        class Dictionaries(list[Dictionary]):
            def __iter__(self) -> Iterator[Dictionary]:
                raise AssertionError("unexpected iteration")

        request: TtsRequest = {"model": "lightning-v3.1", "voice": "custom_voice", "text": "Hello",
            "pronunciation_dictionaries": Dictionaries([{"id": "one"}, {"id": "two"}])}
        backend = Transport([HttpResponse(200, {}, Body([b"audio"]))])
        async with synthesize(request, auth=AUTH, transport=backend, protocol="http") as stream:
            self.assertEqual([item async for item in stream], [b"audio", {"event": "done"}])
        sent, = backend.requests
        self.assertEqual(json.loads(sent.body), {**SETTINGS, "text": "Hello", "pronunciation_dicts": ["one", "two"]})

    async def test_buffered_http_and_sse_allow_scheduled_cancellation(self) -> None:
        class BufferedBody(Body):
            async def __anext__(self) -> bytes:
                chunk = await super().__anext__()
                if self.reads == 1:
                    task = asyncio.current_task()
                    assert task is not None
                    loop = asyncio.get_running_loop()
                    loop.call_soon(loop.call_soon, task.cancel)
                return chunk

        complete = sse({"status": "200", "done": True, "audio": "AQ=="})
        packet = sse({"status": "206", "done": False, "audio": "AQ=="})
        cases: list[tuple[Literal["http", "sse"], list[bytes]]] = [
            ("http", [b"audio"] * 32), ("sse", [packet * 32 + complete]),
            ("sse", [b"\n"] * 32 + [complete]), ("sse", [b"\n" * 32768 + complete]),
        ]
        for protocol, chunks in cases:
            with self.subTest(protocol=protocol, chunks=len(chunks)):
                body = BufferedBody(chunks)
                backend = Transport([HttpResponse(200, {}, body)])
                async def consume(selected: Literal["http", "sse"]) -> list[SynthesisItem]:
                    async with synthesize(BASE, auth=AUTH, transport=backend, protocol=selected) as stream:
                        return [item async for item in stream]
                task = asyncio.create_task(consume(protocol))
                with self.assertRaises(asyncio.CancelledError):
                    await task
                self.assertEqual(body.closes, 1)

    async def test_shared_requests_exact_sse_payloads_headers_and_completion(self) -> None:
        fixtures: dict[str, object] = json.loads(FIXTURES.read_text())
        for f in cast(list[dict[str, object]], fixtures["requests"]):
            with self.subTest(name=f["name"]):
                request = cast(TtsRequest, python_names(f["request"]))
                body = Body([str(fixtures["sse"]).encode()], stall=True)
                backend = Transport([HttpResponse(200, {"Content-Type": "Text/Event-Stream; charset=utf-8"}, body)])
                async with synthesize(request, auth=AUTH, transport=backend, base_url="https://example.test/proxy%2Fraw/?tenant=a%2Bb") as stream:
                    self.assertEqual([v async for v in stream], [b"\0\xff\x80", b"\1\2", {"event": "done"}])
                sent, = backend.requests
                headers = {"Authorization": "Bearer fixture", "Content-Type": "application/json", "Accept": "text/event-stream"}
                if "content_retention_days" in request:
                    headers["x-expire-content"] = "true"
                self.assertEqual((sent.method, sent.url, dict(sent.headers), json.loads(sent.body)),
                    ("POST", "https://example.test/proxy%2Fraw/waves/v1/tts/live?tenant=a%2Bb", headers, f["body"]))
                self.assertEqual((body.reads, body.closes), (1, 1))

    async def test_sse_at_every_byte_split_and_final_audio_before_done(self) -> None:
        fixtures: dict[str, object] = json.loads(FIXTURES.read_text())
        wire = str(fixtures["sse"]).encode()
        for split in range(len(wire) + 1):
            body = Body([wire[:split], wire[split:]], stall=True)
            backend = Transport([HttpResponse(200, {}, body)])
            async with synthesize(BASE, auth=AUTH, transport=backend) as stream:
                self.assertEqual([v async for v in stream], [b"\0\xff\x80", b"\1\2", {"event": "done"}])
                self.assertEqual(body.closes, 1)

    async def test_every_http_format_preserves_native_bytes_and_early_exit(self) -> None:
        for format in ("pcm", "wav", "mp3", "mulaw", "alaw"):
            body = Body([b"", b"\0\xff", b"\x80"], stall=True)
            backend = Transport([HttpResponse(200, {"content-type": "audio/wav"}, body)])
            request = cast(TtsRequest, {**BASE, "text": "\ufeffHello\u3000", "output": {"format": format, "sample_rate_hz": 8000}})
            async with synthesize(request, auth=AUTH, transport=backend, protocol="http") as stream:
                self.assertEqual(await anext(stream), b"\0\xff")
                self.assertEqual(body.reads, 2)
            self.assertEqual(body.closes, 1)
            sent, = backend.requests
            self.assertEqual((sent.url, sent.headers["Accept"], json.loads(sent.body)),
                ("https://api.smallest.ai/waves/v1/tts", "audio/wav", {**SETTINGS, "sample_rate": 8000, "output_format": "ulaw" if format == "mulaw" else format, "text": "Hello"}))

    async def test_http_errors_status_and_content_type_do_not_read_body(self) -> None:
        for status, media, protocol, message in [
            (403, "application/json", "sse", "Smallest.ai returned HTTP 403"),
            (307, "application/json", "http", "Smallest.ai returned HTTP 307"),
            (200, "application/json", "sse", "Smallest.ai returned an unexpected content type"),
            (200, "text/event-stream", "http", "Smallest.ai returned an unexpected content type"),
        ]:
            body = Body([b"private"])
            backend = Transport([HttpResponse(status, {"content-type": media}, body)])
            async with synthesize(BASE, auth=AUTH, transport=backend, protocol=cast(Literal["http", "sse"], protocol)) as stream:
                with self.assertRaises((SmallestError, TypeError)) as caught:
                    await anext(stream)
                self.assertEqual(str(caught.exception), message)
                if isinstance(caught.exception, SmallestError):
                    self.assertEqual((caught.exception.status, caught.exception.code), (status, None))
            self.assertEqual((body.reads, body.closes), (0, 1))

    async def test_sse_malformed_status_audio_and_truncation_are_terminal(self) -> None:
        for wire, error in [
            (sse({"status": "206", "done": False, "audio": "AA=="}), "Smallest.ai SSE ended before completion"),
            (sse({"status": "200", "done": True}), "Smallest.ai returned no audio"),
            (sse({"status": "200", "done": False}), "Invalid Smallest.ai SSE status"),
            (sse({"status": 200, "done": True}), "Invalid Smallest.ai SSE status"),
            (sse({"status": "206", "done": False}), "Smallest.ai SSE chunk omitted audio"),
            (sse({"status": "206", "done": False, "audio": "AB=="}), "Invalid Smallest.ai base64 audio"),
            (sse({"status": "error", "error": {"message": "secret"}}), "Smallest.ai SSE returned an error"),
            (b"data: {\n\n", "Smallest.ai returned invalid JSON"),
            (b"data: []\n\n", "Invalid Smallest.ai response object"),
        ]:
            body = Body([wire])
            backend = Transport([HttpResponse(200, {}, body)])
            async with synthesize(BASE, auth=AUTH, transport=backend) as stream:
                with self.assertRaises((SmallestError, TypeError)) as caught:
                    _ = [v async for v in stream]
                self.assertEqual(str(caught.exception), error)
                self.assertEqual([v async for v in stream], [])
            self.assertEqual(body.closes, 1)

    async def test_shared_invalid_frames_and_binary_are_terminal(self) -> None:
        fixtures: dict[str, list[dict[str, str]]] = json.loads(FIXTURES.read_text())
        cases: list[tuple[str | bytes, str]] = [(f["wire"], f["error"]) for f in fixtures["invalidFrames"]]
        cases += [(b"binary", "Smallest.ai returned a non-text WebSocket frame"), ("{", "Smallest.ai returned invalid JSON")]
        for wire, message in cases:
            socket = Socket()
            socket.messages.put_nowait(wire)
            async with synthesize(BASE, auth=AUTH, web_socket=socket) as stream:
                with self.assertRaises(TypeError) as caught:
                    await anext(stream)
                self.assertEqual(str(caught.exception), message)
            self.assertEqual(socket.closes, 1)

    async def test_all_twelve_request_branches_and_independent_timestamps(self) -> None:
        for model in ("lightning-v3.1", "lightning-v3.1-pro"):
            for timed in (False, True):
                for mode in ("whole", "stream", "continuation"):
                    source: Source[Input] = Source()
                    source.items.put_nowait("Hello")
                    source.items.put_nowait(None)
                    raw: dict[str, object] = {"model": model, "voice": "meher" if timed else "custom_voice", "text": "Hello" if mode == "whole" else source}
                    if timed:
                        raw["timestamp_granularity"] = "word"
                    if mode == "continuation":
                        raw["continuation"] = {"id": "context.1", "max_buffer_delay_ms": 0}
                    socket = Socket()
                    async with synthesize(cast(TtsRequest, raw), auth=AUTH, web_socket=socket) as stream:
                        pending = asyncio.ensure_future(anext(stream))
                        sent = await socket.sent.get()
                        expected: dict[str, object] = {**SETTINGS, "model": "lightning_v3.1" if model == "lightning-v3.1" else "lightning_v3.1_pro", "text": "Hello", "request_id": sent["request_id"], "voice_id": raw["voice"]}
                        if timed:
                            expected.update(language="en", word_timestamps=True)
                        if mode == "continuation":
                            expected.update(context_id="context.1", **{"continue": True}, max_buffer_delay_ms=0)
                        elif mode == "stream":
                            expected.update(**{"continue": True}, max_buffer_flush_ms=0, complete_backoff_ms=4000)
                        self.assertEqual(sent, expected)
                        socket.packet({"status": "chunk", "request_id": "native-1", "data": {"audio": "AP+A"}})
                        self.assertEqual(await pending, {"correlation": "ordered", "correlation_id": "native-1", "audio": b"\0\xff\x80", "timestamps": []} if timed else b"\0\xff\x80")
                        pending = asyncio.ensure_future(anext(stream))
                        if mode != "whole":
                            close = await socket.sent.get()
                            self.assertEqual(close, {"context_id": "context.1", "voice_id": raw["voice"], "continue": False} if mode == "continuation" else {**expected, "text": "", "continue": False, "flush": True})
                        if timed:
                            socket.packet({"status": "word_timestamp", "request_id": "native-2", "data": {"id": 5, "word": "$100", "start": 0, "end": 0.125}})
                            self.assertEqual(await pending, {"correlation": "ordered", "correlation_id": "native-2", "word_index": 5, "timestamps": [{"kind": "word", "value": "$100", "start_time_ms": 0, "end_time_ms": 125}]})
                            pending = asyncio.ensure_future(anext(stream))
                        socket.packet({"status": "complete", "request_id": "native-2"})
                        self.assertEqual(await pending, {"event": "batch", "request_id": "native-2"} if mode == "continuation" else {"event": "done"})
                    self.assertEqual(socket.closes, 1)

    async def test_empty_input_completes_locally_without_empty_request(self) -> None:
        source: Source[str] = Source()
        source.items.put_nowait("")
        source.items.put_nowait(None)
        socket = Socket()
        async with synthesize({"model": "lightning-v3.1", "voice": "custom_voice", "text": source}, auth=AUTH, web_socket=socket) as stream:
            self.assertEqual([v async for v in stream], [{"event": "done"}])
        self.assertEqual((socket.sent.qsize(), socket.closes), (0, 1))

    async def test_premature_buffered_completion_does_not_become_success_at_eof(self) -> None:
        source: Source[str] = Source()
        source.items.put_nowait("Hello")
        socket = Socket()
        async with synthesize({"model": "lightning-v3.1", "voice": "custom_voice", "text": source}, auth=AUTH, web_socket=socket) as stream:
            pending = asyncio.ensure_future(anext(stream))
            await socket.sent.get()
            socket.packet({"status": "chunk", "request_id": "native", "data": {"audio": "AA=="}})
            self.assertEqual(await pending, b"\0")
            socket.packet({"status": "complete", "request_id": "native"})
            await asyncio.sleep(0)
            source.items.put_nowait(None)
            with self.assertRaises(TypeError) as caught:
                await anext(stream)
            self.assertEqual(str(caught.exception), "Smallest.ai completed before input ended")

    async def test_continuation_clear_filters_old_frames_and_never_infers_done(self) -> None:
        source: Source[Input] = Source()
        source.items.put_nowait("Before")
        socket = Socket()
        request: TtsRequest = {"model": "lightning-v3.1-pro", "voice": "meher", "text": source, "continuation": {"id": "ctx"}, "timestamp_granularity": "word", "request_id": "external"}
        async with synthesize(request, auth=AUTH, web_socket=socket) as stream:
            pending = asyncio.ensure_future(anext(stream))
            first = await socket.sent.get()
            self.assertEqual(first["request_id"], "external")
            source.items.put_nowait({"command": "clear"})
            self.assertEqual(await pending, {"event": "clear"})
            pending = asyncio.ensure_future(anext(stream))
            self.assertEqual(await socket.sent.get(), {"context_id": "ctx", "cancel_request": True})
            source.items.put_nowait("After")
            fresh = await socket.sent.get()
            self.assertNotEqual(fresh["request_id"], "external")
            for status, data in [("chunk", {"audio": "AQ=="}), ("word_timestamp", {"id": 0, "word": "Before", "start": 0, "end": 1}), ("complete", {})]:
                socket.packet({"status": status, "request_id": "old-native", "external_request_id": "external", "data": data})
            socket.packet({"status": "chunk", "request_id": "fresh-native", "external_request_id": fresh["request_id"], "data": {"audio": "AP8="}})
            self.assertEqual(await pending, {"correlation": "ordered", "correlation_id": "fresh-native", "audio": b"\0\xff", "timestamps": []})
            pending = asyncio.ensure_future(anext(stream))
            source.items.put_nowait(None)
            self.assertEqual(await socket.sent.get(), {"context_id": "ctx", "voice_id": "meher", "continue": False})
            for native in ("fresh-native", "another-native"):
                socket.packet({"status": "complete", "request_id": native, "external_request_id": fresh["request_id"]})
                self.assertEqual(await pending, {"event": "batch", "request_id": native})
                pending = asyncio.ensure_future(anext(stream))
            await asyncio.sleep(0)
            self.assertFalse(pending.done())
            socket.messages.put_nowait(None)
            with self.assertRaises(TypeError) as caught:
                await pending
            self.assertEqual(str(caught.exception), "Smallest.ai continuation closed without a context-complete marker")
        self.assertEqual(socket.closes, 1)

    async def test_ambiguous_identity_after_clear_fails_and_native_errors_are_global(self) -> None:
        for extra, message in [({}, "Smallest.ai omitted external request identity after clear"),
                               ({"external_request_id": "unknown"}, "Smallest.ai returned an unknown external request identity after clear"),
                               ({"status": "error", "error": {"message": "native failure", "code": "QUOTA"}}, "native failure")]:
            source: Source[Input] = Source()
            source.items.put_nowait({"command": "clear"})
            socket = Socket()
            request: TtsRequest = {"model": "lightning-v3.1", "voice": "saved", "text": source, "continuation": {"id": "ctx"}}
            async with synthesize(request, auth=AUTH, web_socket=socket) as stream:
                self.assertEqual(await anext(stream), {"event": "clear"})
                await socket.sent.get()
                socket.packet({"status": "chunk", "request_id": "native", "data": {"audio": "AA=="}, **extra})
                with self.assertRaises((TypeError, SmallestError)) as caught:
                    await anext(stream)
                self.assertEqual(str(caught.exception), message)
                if isinstance(caught.exception, SmallestError):
                    self.assertEqual((caught.exception.status, caught.exception.code), (None, "QUOTA"))

    async def test_backpressured_send_reads_audio_without_pulling_ahead(self) -> None:
        class Backpressured(Socket):
            async def send(self, message: str | bytes) -> None:
                await super().send(message)
                await asyncio.Future[None]()
        socket = Backpressured()
        source: Source[str] = Source()
        source.items.put_nowait("Hello")
        source.items.put_nowait("Later")
        async with synthesize({"model": "lightning-v3.1", "voice": "custom_voice", "text": source}, auth=AUTH, web_socket=socket) as stream:
            pending = asyncio.ensure_future(anext(stream))
            await socket.sent.get()
            socket.packet({"status": "chunk", "request_id": "native", "data": {"audio": "AA=="}})
            self.assertEqual(await pending, b"\0")
            self.assertEqual(source.reads, 1)
        await asyncio.wait_for(source.closed.wait(), 1)
        self.assertEqual(socket.closes, 1)

    async def test_final_write_failure_cannot_be_hidden_by_native_complete(self) -> None:
        failure = RuntimeError("final send")
        class FinalSend(Socket):
            async def send(self, message: str | bytes) -> None:
                await super().send(message)
                value: dict[str, object] = json.loads(message)
                if value.get("text"):
                    self.packet({"status": "chunk", "request_id": "n", "data": {"audio": "AA=="}})
                if value.get("flush"):
                    self.packet({"status": "complete", "request_id": "n"})
                    await release.wait()
                    raise failure
        source: Source[str] = Source()
        source.items.put_nowait("Hello")
        source.items.put_nowait(None)
        socket, release = FinalSend(), asyncio.Event()
        async with synthesize({"model": "lightning-v3.1", "voice": "custom_voice", "text": source}, auth=AUTH, web_socket=socket) as stream:
            self.assertEqual(await anext(stream), b"\0")
            pending = asyncio.ensure_future(anext(stream))
            await socket.sent.get()
            await socket.sent.get()
            await asyncio.sleep(0)
            self.assertFalse(pending.done())
            release.set()
            with self.assertRaises(RuntimeError) as caught:
                await pending
            self.assertIs(caught.exception, failure)

    async def test_native_socket_auth_proxy_path_fragmentation_and_rejection(self) -> None:
        for model in ("lightning-v3.1", "lightning-v3.1-pro"):
            finished = asyncio.Event()
            async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
                path, headers = await upgrade(reader, writer)
                self.assertEqual(path, b"GET /proxy%2Fraw/waves/v1/tts/live?tenant=a%2Bb&timeout=7 HTTP/1.1")
                self.assertEqual(headers[b"authorization"], b"Bearer fixture")
                self.assertEqual(headers[b"x-expire-content"], b"true")
                opcode, data = await client_frame(reader)
                self.assertEqual(opcode, 1)
                sent: dict[str, object] = json.loads(data)
                self.assertEqual(sent, {**SETTINGS, "model": "lightning_v3.1" if model == "lightning-v3.1" else "lightning_v3.1_pro", "text": "Hello", "request_id": sent["request_id"]})
                wire = b'{"status":"chunk","request_id":"native","data":{"audio":"AP8="}}'
                writer.write(bytes([1, 20]) + wire[:20] + bytes([128, len(wire) - 20]) + wire[20:])
                done = b'{"status":"complete","request_id":"native"}'
                writer.write(bytes([129, len(done)]) + done)
                await writer.drain()
                await reader.read()
                finished.set()
            async with server(handle) as url:
                async with synthesize(cast(TtsRequest, {**BASE, "model": model, "content_retention_days": 7}), auth=AUTH,
                    base_url=url.replace("ws:", "http:") + "/proxy%2Fraw?tenant=a%2Bb&timeout=99", protocol="websocket", idle_timeout_seconds=7) as stream:
                    self.assertEqual([v async for v in stream], [b"\0\xff", {"event": "done"}])
                await finished.wait()
        async def reject(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            await reader.readuntil(b"\r\n\r\n")
            writer.write(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n")
            await writer.drain()
        source: Source[str] = Source()
        async with server(reject) as url:
            async with synthesize({"model": "lightning-v3.1", "voice": "custom_voice", "text": source}, auth=AUTH, web_socket_url=url) as stream:
                with self.assertRaises(WebSocketError):
                    await anext(stream)
        self.assertEqual(source.reads, 0)

    async def test_deadlines_release_idle_socket_and_pending_http_headers_or_body(self) -> None:
        socket = Socket()
        with self.assertRaises(TimeoutError):
            async with synthesize(BASE, auth=AUTH, web_socket=socket, timeout_ms=5):
                await asyncio.sleep(1)
        self.assertEqual(socket.closes, 1)
        class Pending:
            async def send(self, request: HttpRequest) -> HttpResponse:
                try:
                    await asyncio.Future[None]()
                    raise AssertionError
                finally:
                    closed.set()
        closed = asyncio.Event()
        with self.assertRaises(TimeoutError):
            async with synthesize(BASE, auth=AUTH, transport=Pending(), timeout_ms=5) as stream:
                await anext(stream)
        self.assertTrue(closed.is_set())
        body = Body([], stall=True)
        backend = Transport([HttpResponse(200, {}, body)])
        with self.assertRaises(TimeoutError):
            async with synthesize(BASE, auth=AUTH, transport=backend, timeout_ms=5) as stream:
                await anext(stream)
        self.assertEqual(body.closes, 1)

    async def test_auth_precedence_and_preflight_cleanup(self) -> None:
        empty: Auth = {"smallest_ai": {"api_key": ""}}
        for entry, scoped, legacy, expected in [(AUTH, "scoped", "legacy", "fixture"), (None, "scoped", "legacy", "scoped"), (None, None, "legacy", "legacy"), (None, "", "legacy", ""), (empty, "scoped", "legacy", "")]:
            env = {"SMALLEST_API_KEY": legacy}
            if scoped is not None:
                env["SPEECHSWITCH_SMALLEST_API_KEY"] = scoped
            backend = Transport([HttpResponse(200, {}, Body([b"a"]))])
            with patch.dict(os.environ, env, clear=True):
                if expected:
                    async with synthesize(BASE, auth=entry, transport=backend, protocol="http") as stream:
                        self.assertEqual([v async for v in stream], [b"a", {"event": "done"}])
                    self.assertEqual(backend.requests[0].headers["Authorization"], "Bearer " + expected)
                else:
                    socket = Socket()
                    with self.assertRaises(TypeError) as caught:
                        async with synthesize(BASE, auth=entry, web_socket=socket):
                            pass
                    self.assertEqual(str(caught.exception), "Missing auth.smallest.ai.apiKey configuration")
                    self.assertEqual(socket.closes, 1)

    async def test_generated_validation_rejects_invalid_combinations_before_io(self) -> None:
        for fields, normalized_text in [
            ({"language": "ja"}, "Hello"), ({"text": " \ufeff "}, ""), ({"speed": 0}, "Hello"),
            ({"text": "a" * 8001}, "a" * 8001), ({"reference_audio": b"x"}, "Hello"),
            ({"voice": "saved", "timestamp_granularity": "word"}, "Hello"),
        ]:
            socket = Socket()
            request = cast(TtsRequest, {**BASE, **fields})
            with self.assertRaises(TypeError) as expected:
                validate_request({**request, "text": normalized_text})
            with self.assertRaises(TypeError) as caught:
                async with synthesize(request, auth=AUTH, web_socket=socket):
                    pass
            self.assertEqual(caught.exception.args, expected.exception.args)
            self.assertEqual((socket.closes, socket.sent.qsize()), (1, 0))

    async def test_limits_input_and_transport_failures_preserve_identity(self) -> None:
        failure = RuntimeError("body")
        body = Body([failure], close_error=RuntimeError("cleanup"))
        backend = Transport([HttpResponse(200, {}, body)])
        with self.assertRaises(RuntimeError) as caught:
            async with synthesize(BASE, auth=AUTH, transport=backend) as stream:
                await anext(stream)
        self.assertIs(caught.exception, failure)
        source: Source[str] = Source()
        source.items.put_nowait(failure)
        socket = Socket()
        with self.assertRaises(RuntimeError) as caught:
            async with synthesize({"model": "lightning-v3.1", "voice": "custom_voice", "text": source}, auth=AUTH, web_socket=socket) as stream:
                await anext(stream)
        self.assertIs(caught.exception, failure)
        for limit in (1, 30):
            socket = AutoSocket()
            with self.assertRaises(TypeError) as caught:
                async with synthesize(BASE, auth=AUTH, web_socket=socket, max_message_bytes=limit) as stream:
                    await anext(stream)
            self.assertEqual(str(caught.exception), "Smallest.ai message exceeds max_message_bytes")
        body = Body([b":" + b"x" * 100])
        backend = Transport([HttpResponse(200, {}, body)])
        with self.assertRaises(ValueError) as caught:
            async with synthesize(BASE, auth=AUTH, transport=backend, max_message_bytes=30) as stream:
                await anext(stream)
        self.assertEqual(str(caught.exception), "SSE event exceeds byte limit")

    async def test_stream_fragments_preserve_whitespace_without_whole_text_limit(self) -> None:
        source: Source[str] = Source()
        source.items.put_nowait(" " + "🚀" * 8001 + "\n")
        source.items.put_nowait(None)
        socket = AutoSocket()
        async with synthesize({"model": "lightning-v3.1", "voice": "custom_voice", "text": source,
                              "max_buffer_delay_ms": 0, "completion_delay_ms": 0}, auth=AUTH, web_socket=socket) as stream:
            self.assertEqual([v async for v in stream], [b"\0\xff\x80", {"event": "done"}])
        sent = await socket.sent.get()
        self.assertEqual(sent["text"], " " + "🚀" * 8001 + "\n")
        self.assertEqual((sent["max_buffer_flush_ms"], sent["complete_backoff_ms"]), (0, 0))

    async def test_generated_input_validation_and_protocol_mismatches(self) -> None:
        source: Source[Input] = Source()
        source.items.put_nowait({"command": "clear"})
        socket = Socket()
        request = cast(TtsRequest, {"model": "lightning-v3.1", "voice": "custom_voice", "text": source})
        validate = validate_request(request)
        with self.assertRaises(TypeError) as expected:
            validate({"command": "clear"})
        async with synthesize(request, auth=AUTH, web_socket=socket) as stream:
            with self.assertRaises(TypeError) as caught:
                await anext(stream)
            self.assertEqual(caught.exception.args, expected.exception.args)
        self.assertEqual(socket.sent.qsize(), 0)
        for request, protocol, error in [
            (BASE, "http", "Smallest.ai incremental text, timestamps and socket overrides require WebSocket transport"),
            (cast(TtsRequest, {**BASE, "pronunciation_dictionaries": []}), "websocket", "Smallest.ai pronunciation dictionaries are documented only for HTTP/SSE"),
        ]:
            socket = Socket()
            with self.assertRaises(TypeError) as caught:
                async with synthesize(request, auth=AUTH, web_socket=socket, protocol=cast(Literal["http", "websocket"], protocol)):
                    pass
            self.assertEqual(str(caught.exception), error)
            self.assertEqual(socket.closes, 1)

    async def test_empty_continuation_closes_input_but_still_requires_caller_exit(self) -> None:
        source: Source[Input] = Source()
        source.items.put_nowait(None)
        socket = Socket()
        with self.assertRaises(TimeoutError):
            async with synthesize({"model": "lightning-v3.1", "voice": "custom_voice", "text": source,
                                  "continuation": {"id": "ctx"}}, auth=AUTH, web_socket=socket, timeout_ms=10) as stream:
                pending = asyncio.ensure_future(anext(stream))
                self.assertEqual(await socket.sent.get(), {"context_id": "ctx", "voice_id": "custom_voice", "continue": False})
                await pending
        self.assertEqual(socket.closes, 1)

    async def test_cancellation_does_not_wait_for_uncooperative_input(self) -> None:
        blocked, release, cleaned = asyncio.Event(), asyncio.Event(), asyncio.Event()
        async def source() -> AsyncIterator[str]:
            try:
                yield "Hello"
                blocked.set()
                try:
                    await asyncio.Future[None]()
                except asyncio.CancelledError:
                    await release.wait()
            finally:
                cleaned.set()
        socket = AutoSocket()
        try:
            async with synthesize({"model": "lightning-v3.1", "voice": "custom_voice", "text": source()}, auth=AUTH, web_socket=socket) as stream:
                self.assertEqual(await anext(stream), b"\0\xff\x80")
                pending = asyncio.ensure_future(anext(stream))
                await blocked.wait()
                pending.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await pending
            self.assertEqual(socket.closes, 1)
            self.assertFalse(cleaned.is_set())
        finally:
            release.set()
            await asyncio.wait_for(cleaned.wait(), 1)

    async def test_socket_errors_and_premature_close_keep_failure_identity(self) -> None:
        failure = RuntimeError("socket")
        class FailingSend(Socket):
            async def send(self, message: str | bytes) -> None:
                raise failure
        for socket in (Socket(), FailingSend()):
            if not isinstance(socket, FailingSend):
                socket.messages.put_nowait(failure)
            with self.assertRaises(RuntimeError) as caught:
                async with synthesize(BASE, auth=AUTH, web_socket=socket) as stream:
                    await anext(stream)
            self.assertIs(caught.exception, failure)
            self.assertEqual(socket.closes, 1)
        socket = Socket()
        socket.messages.put_nowait(None)
        with self.assertRaises(TypeError) as caught:
            async with synthesize(BASE, auth=AUTH, web_socket=socket) as stream:
                await anext(stream)
        self.assertEqual(str(caught.exception), "Smallest.ai WebSocket closed before completion")
        body = Body([])
        with self.assertRaises(TypeError) as caught:
            async with synthesize(BASE, auth=AUTH, transport=Transport([HttpResponse(200, {}, body)]), protocol="http") as stream:
                await anext(stream)
        self.assertEqual(str(caught.exception), "Smallest.ai returned no audio")
