import asyncio
import json
import os
import unittest
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import cast
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from speechswitch.generated.auth import Auth
from speechswitch.generated.rime import TtsRequest, TtsRequestCodaStreamingTextVoice84ec2db1TextItem as Input
from speechswitch.generated.rime_output import SynthesisItem
from speechswitch.generated.validators.rime import validate_request
from speechswitch.http import HttpRequest, HttpResponse
from speechswitch.providers.rime import RimeError, synthesize
from speechswitch.websocket import WebSocketClosed, WebSocketError
from test_resemble import Body, Transport, python_names
from test_websocket import client_frame, server, upgrade

AUTH: Auth = {"rime": {"api_key": "fixture"}}
BASE: TtsRequest = {"model": "coda", "voice": "astra", "text": "Hello"}
FIXTURES = Path(__file__).parents[2] / "fixtures/rime.json"


class Socket:
    def __init__(self) -> None:
        self.sent: asyncio.Queue[dict[str, object]] = asyncio.Queue()
        self.messages: asyncio.Queue[str | bytes | Exception | None] = asyncio.Queue()
        self.closes = 0
        self.reading = asyncio.Event()

    async def send(self, message: str | bytes) -> None:
        self.sent.put_nowait(json.loads(message))

    async def receive(self) -> str | bytes:
        self.reading.set()
        value = await self.messages.get()
        if value is None:
            raise StopAsyncIteration
        if isinstance(value, Exception):
            raise value
        return value

    async def aclose(self) -> None:
        self.closes += 1

    def packet(self, value: object) -> None:
        self.messages.put_nowait(json.dumps(value))


class Source:
    def __init__(self) -> None:
        self.items: asyncio.Queue[Input | Exception | None] = asyncio.Queue()
        self.closed = asyncio.Event()
        self.reading = asyncio.Event()
        self.reads = 0

    def __aiter__(self) -> AsyncIterator[Input]:
        return self

    async def __anext__(self) -> Input:
        self.reads += 1
        self.reading.set()
        item = await self.items.get()
        if item is None:
            raise StopAsyncIteration
        if isinstance(item, Exception):
            raise item
        return item

    async def aclose(self) -> None:
        self.closed.set()


class RimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_inline_speeds_use_validated_indices(self) -> None:
        class Speeds(list[float]):
            def __iter__(self) -> Iterator[float]:
                raise AssertionError("unexpected iteration")

        request: TtsRequest = {"model": "mist-v3", "voice": "v", "text": "hi", "text_markup": {"speeds": Speeds([2, 0.5])}}
        transport = Transport([HttpResponse(200, {}, Body([b"audio"]))])
        async with synthesize(request, auth=AUTH, transport=transport) as stream:
            self.assertEqual([item async for item in stream], [b"audio", {"event": "done"}])
        sent, = transport.requests
        self.assertEqual(json.loads(sent.body), {"speaker": "v", "modelId": "mistv3", "lang": "en", "samplingRate": 24000,
            "timeScaleFactor": 1, "pauseBetweenBrackets": False, "phonemizeBetweenBrackets": False, "inlineSpeedAlpha": "0.5,2", "text": "hi"})

    async def test_buffered_http_allows_scheduled_cancellation(self) -> None:
        class BufferedBody(Body):
            async def __anext__(self) -> bytes:
                chunk = await super().__anext__()
                if self.reads == 1:
                    task = asyncio.current_task()
                    assert task is not None
                    loop = asyncio.get_running_loop()
                    loop.call_soon(loop.call_soon, task.cancel)
                return chunk

        body = BufferedBody([b"audio"] * 32)
        transport = Transport([HttpResponse(200, {}, body)])
        async def consume() -> list[SynthesisItem]:
            async with synthesize(BASE, auth=AUTH, transport=transport) as stream:
                return [item async for item in stream]
        task = asyncio.create_task(consume())
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertEqual(body.closes, 1)

    async def test_shared_requests_native_http_bytes_and_proxy_url(self) -> None:
        fixtures: dict[str, list[dict[str, object]]] = json.loads(FIXTURES.read_text())
        for fixture in fixtures["requests"]:
            with self.subTest(name=fixture["name"]):
                body = Body([b"", b"\0\xff", b"\x80"])
                transport = Transport([HttpResponse(200, {"CONTENT-Type": str(fixture["accept"])}, body)])
                async with synthesize(cast(TtsRequest, python_names(fixture["request"])), auth=AUTH, transport=transport, base_url="https://example.test/proxy%2Fraw/?tenant=a%2Bb") as stream:
                    self.assertEqual([item async for item in stream], [b"\0\xff", b"\x80", {"event": "done"}])
                sent, = transport.requests
                self.assertEqual((sent.method, sent.url, dict(sent.headers), json.loads(sent.body)),
                    ("POST", "https://example.test/proxy%2Fraw/v1/rime-tts?tenant=a%2Bb", {"Authorization": "Bearer fixture", "Content-Type": "application/json", "Accept": fixture["accept"]}, fixture["body"]))
                self.assertEqual(body.closes, 1)

    async def test_shared_invalid_frames_and_binary(self) -> None:
        fixtures: dict[str, list[dict[str, str]]] = json.loads(FIXTURES.read_text())
        cases: list[tuple[str | bytes, str]] = [(case["wire"], case["error"]) for case in fixtures["invalidFrames"]]
        cases.append((b"binary", "Rime returned a non-text WebSocket frame"))
        for wire, error in cases:
            with self.subTest(wire=wire):
                socket = Socket()
                socket.messages.put_nowait(wire)
                async with synthesize(BASE, auth=AUTH, web_socket=socket) as stream:
                    with self.assertRaises(TypeError) as caught:
                        await anext(stream)
                    self.assertEqual(str(caught.exception), error)
                self.assertEqual(socket.closes, 1)

    async def test_clear_filters_old_labels_not_unknown_labels_and_batches_are_not_flush_acks(self) -> None:
        source, socket = Source(), Socket()
        async with asyncio.timeout(2), synthesize({"model": "coda", "voice": "astra", "text": source, "segmentation": "manual", "timestamp_granularity": "word"}, auth=AUTH, web_socket=socket) as stream:
            next_item = asyncio.ensure_future(anext(stream))
            source.items.put_nowait("Hello")
            first = await socket.sent.get()
            old = str(first["contextId"])
            self.assertEqual(first, {"text": "Hello", "contextId": old})
            source.items.put_nowait({"command": "flush"})
            source.items.put_nowait({"command": "flush"})
            self.assertEqual(await socket.sent.get(), {"operation": "flush"})
            self.assertEqual(await socket.sent.get(), {"operation": "flush"})
            source.items.put_nowait({"command": "clear"})
            self.assertEqual(await next_item, {"event": "clear"})
            self.assertEqual(await socket.sent.get(), {"operation": "clear"})
            next_item = asyncio.ensure_future(anext(stream))
            source.items.put_nowait("Again")
            new = old[:-1] + "1"
            self.assertEqual(await socket.sent.get(), {"text": "Again", "contextId": new})
            for packet in [
                {"type": "chunk", "contextId": old, "data": "AQ=="},
                {"type": "timestamps", "contextId": old, "word_timestamps": {"words": ["stale"], "start": [0], "end": [1]}},
                {"type": "done", "contextId": old},
                {"type": "chunk", "contextId": new, "data": "AP8="},
            ]:
                socket.packet(packet)
            self.assertEqual(await next_item, {"correlation": "ordered", "timestamp_origin": "synthesis", "input_group_id": new, "audio": b"\0\xff", "timestamps": ()})
            # Independent timestamps may restart without a native done boundary.
            for word in ["Again", "Next"]:
                socket.packet({"type": "timestamps", "contextId": new, "word_timestamps": {"words": [word], "start": [0], "end": [0.125]}})
                self.assertEqual(await anext(stream), {"correlation": "ordered", "timestamp_origin": "synthesis", "input_group_id": new, "timestamps": ({"kind": "word", "value": word, "start_time_ms": 0, "end_time_ms": 125},)})
            socket.packet({"type": "done", "contextId": new})
            self.assertEqual(await anext(stream), {"event": "batch", "input_group_id": new})
            socket.packet({"type": "done", "contextId": "native-label"})
            self.assertEqual(await anext(stream), {"event": "batch", "input_group_id": "native-label"})
            source.items.put_nowait(None)
            next_item = asyncio.ensure_future(anext(stream))
            self.assertEqual(await socket.sent.get(), {"operation": "eos"})
            socket.messages.put_nowait(None)
            self.assertEqual(await next_item, {"event": "done"})
            self.assertEqual([item async for item in stream], [])
        self.assertEqual(socket.closes, 1)

    async def test_null_context_after_clear_is_ambiguous_and_native_errors_are_global(self) -> None:
        for packet, error_type, message in [
            ({"type": "chunk", "contextId": None, "data": "AQ=="}, TypeError, "Rime omitted context identity after clear; stale audio cannot be distinguished"),
            ({"type": "error", "message": "native failure"}, RimeError, "native failure"),
        ]:
            socket, source = Socket(), Source()
            source.items.put_nowait({"command": "clear"})
            async with synthesize({"model": "coda", "voice": "v", "text": source}, auth=AUTH, web_socket=socket) as stream:
                self.assertEqual(await anext(stream), {"event": "clear"})
                socket.packet(packet)
                with self.assertRaises(error_type) as caught:
                    await anext(stream)
                self.assertEqual(str(caught.exception), message)

    async def test_clean_eos_may_be_empty_but_done_is_only_a_batch(self) -> None:
        async def empty() -> AsyncIterator[Input]:
            if False:
                yield ""
        socket = Socket()
        async with synthesize({"model": "mist-v2", "voice": "v", "text": empty()}, auth=AUTH, web_socket=socket) as stream:
            pending = asyncio.ensure_future(anext(stream))
            self.assertEqual(await socket.sent.get(), {"operation": "eos"})
            socket.packet({"type": "done", "contextId": None})
            self.assertEqual(await pending, {"event": "batch"})
            socket.messages.put_nowait(None)
            self.assertEqual(await anext(stream), {"event": "done"})
        socket = Socket()
        async with synthesize({"model": "mist-v2", "voice": "v", "text": empty()}, auth=AUTH, web_socket=socket) as stream:
            pending = asyncio.ensure_future(anext(stream))
            self.assertEqual(await socket.sent.get(), {"operation": "eos"})
            socket.messages.put_nowait(None)
            self.assertEqual(await pending, {"event": "done"})

    async def test_early_and_abnormal_closure_cannot_turn_into_success(self) -> None:
        for close in [None, WebSocketClosed(1011, "failed")]:
            socket, source = Socket(), Source()
            async with synthesize({"model": "coda", "voice": "v", "text": source}, auth=AUTH, web_socket=socket) as stream:
                pending = asyncio.ensure_future(anext(stream))
                await socket.reading.wait()
                socket.messages.put_nowait(close)
                # Both lanes are ready together; processing EOF later must not relabel closure.
                source.items.put_nowait(None)
                with self.assertRaises(TypeError if close is None else WebSocketClosed) as caught:
                    await pending
                if close is None:
                    self.assertEqual(str(caught.exception), "Rime WebSocket closed before clean end-of-stream")
                else:
                    self.assertIs(caught.exception, close)

    async def test_native_socket_auth_query_masked_frames_and_eos_close(self) -> None:
        async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            line, headers = await upgrade(reader, writer)
            self.assertEqual(headers[b"authorization"], b"Bearer fixture")
            self.assertEqual(headers.get(b"sec-websocket-protocol"), None)
            url = urlsplit(line.decode().split(" ")[1])
            self.assertEqual(url.path, "/proxy%2Fraw/ws3")
            self.assertEqual(parse_qs(url.query), {"tenant": ["a+b"], "speaker": ["custom-uuid"], "modelId": ["mistv3"], "lang": ["es"], "samplingRate": ["48000"], "timeScaleFactor": ["0.5"], "pauseBetweenBrackets": ["true"], "inlineSpeedAlpha": ["0.5,2"], "audioFormat": ["ogg"], "segment": ["never"]})
            opcode, data = await client_frame(reader)
            self.assertEqual(opcode, 1)
            sent: dict[str, str] = json.loads(data)
            self.assertEqual(sent, {"text": "Hola 🚀", "contextId": sent["contextId"]})
            self.assertEqual(await client_frame(reader), (1, b'{"operation":"eos"}'))
            payload = json.dumps({"type": "chunk", "contextId": sent["contextId"], "data": "AP8="}, separators=(",", ":")).encode()
            self.assertLess(len(payload), 126)
            # Exercise the real frame parser across TCP fragmentation.
            for byte in bytes([0x81, len(payload)]) + payload + b"\x88\x02\x03\xe8":
                writer.write(bytes([byte]))
                await writer.drain()
            self.assertEqual(await client_frame(reader), (8, b"\x03\xe8"))
        async with server(handle) as url:
            request: TtsRequest = {"model": "mist-v3", "language": "es", "voice": "custom-uuid", "text": "Hola 🚀", "speed": 2, "segmentation": "manual", "text_markup": {"pauses": True, "speeds": [2, 0.5]}, "output": {"format": "ogg_opus", "sample_rate_hz": 48000}}
            async with synthesize(request, auth=AUTH, web_socket_url=url + "/proxy%2Fraw/ws3?tenant=a%2Bb&modelId=bad&modelId=also-bad") as stream:
                self.assertEqual([item async for item in stream], [b"\0\xff", {"event": "done"}])

    async def test_backpressured_write_still_reads_and_never_prefetches_input(self) -> None:
        release, writing = asyncio.Event(), asyncio.Event()
        class SlowSocket(Socket):
            async def send(self, message: str | bytes) -> None:
                await super().send(message)
                writing.set()
                await release.wait()
        socket, source = SlowSocket(), Source()
        source.items.put_nowait("hello")
        async with synthesize({"model": "coda", "voice": "v", "text": source}, auth=AUTH, web_socket=socket) as stream:
            pending = asyncio.ensure_future(anext(stream))
            await writing.wait()
            socket.packet({"type": "chunk", "contextId": None, "data": "AQ=="})
            self.assertEqual(await asyncio.wait_for(pending, 1), b"\x01")
            self.assertEqual(source.reads, 1)
        self.assertEqual(socket.closes, 1)
        await asyncio.wait_for(source.closed.wait(), 1)

    async def test_native_handshake_failure_does_not_acquire_input(self) -> None:
        source = Source()
        async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            await reader.readuntil(b"\r\n\r\n")
            writer.write(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n")
            await writer.drain()
            self.assertEqual(await reader.read(), b"")
        async with server(handle) as url:
            async with synthesize({"model": "coda", "voice": "v", "text": source}, auth=AUTH, web_socket_url=url + "/ws3") as stream:
                with self.assertRaises(WebSocketError) as caught:
                    await anext(stream)
                self.assertEqual(str(caught.exception), "WebSocket handshake was not accepted")
        self.assertEqual(source.reads, 0)

    async def test_send_error_after_clean_eos_close_is_not_hidden(self) -> None:
        failure = OSError("send failed")
        class FailedSocket(Socket):
            async def send(self, message: str | bytes) -> None:
                await super().send(message)
                if json.loads(message).get("operation") == "eos":
                    self.messages.put_nowait(None)
                    await asyncio.sleep(0)
                    raise failure
        socket = FailedSocket()
        async with synthesize(BASE, auth=AUTH, web_socket=socket) as stream:
            with self.assertRaises(OSError) as caught:
                await anext(stream)
            self.assertIs(caught.exception, failure)

    async def test_http_status_content_type_empty_and_read_failure_release_body(self) -> None:
        failure = OSError("body failed")
        cases: list[tuple[int, dict[str, str], list[bytes | Exception], type[Exception], str, int]] = [
            (429, {}, [b"secret"], RimeError, "Rime returned HTTP 429", 0),
            (302, {"location": "https://elsewhere.invalid"}, [b"secret"], RimeError, "Rime returned HTTP 302", 0),
            (200, {"content-type": "application/json"}, [b"secret"], TypeError, "Rime returned an unexpected content type", 0),
            (200, {}, [], TypeError, "Rime returned no audio", 1),
        ]
        for status, headers, chunks, kind, message, reads in cases:
            body = Body(chunks)
            async with synthesize(BASE, auth=AUTH, transport=Transport([HttpResponse(status, headers, body)])) as stream:
                with self.assertRaises(kind) as caught:
                    await anext(stream)
                self.assertEqual(str(caught.exception), message)
                if isinstance(caught.exception, RimeError):
                    self.assertEqual(caught.exception.status, status)
            self.assertEqual((body.reads, body.closes), (reads, 1))
        body = Body([failure], close_error=OSError("cleanup failed"))
        async with synthesize(BASE, auth=AUTH, transport=Transport([HttpResponse(200, {}, body)])) as stream:
            with self.assertRaises(OSError) as caught:
                await anext(stream)
            self.assertIs(caught.exception, failure)

    async def test_cancellation_deadline_and_early_break_own_resources(self) -> None:
        for cancel in [True, False]:
            body = Body([b"first"], stall=True)
            async with synthesize(BASE, auth=AUTH, transport=Transport([HttpResponse(200, {}, body)])) as stream:
                self.assertEqual(await anext(stream), b"first")
                if cancel:
                    pending = asyncio.ensure_future(anext(stream))
                    await body.reading.wait()
                    pending.cancel()
                    with self.assertRaises(asyncio.CancelledError):
                        await pending
            self.assertEqual(body.closes, 1)
        socket, source = Socket(), Source()
        with self.assertRaises(TimeoutError):
            async with synthesize({"model": "coda", "voice": "v", "text": source}, auth=AUTH, web_socket=socket, timeout_ms=20) as stream:
                await anext(stream)
        self.assertEqual(socket.closes, 1)
        await asyncio.wait_for(source.closed.wait(), 1)
        # An override is owned even if the caller never reads the stream.
        socket = Socket()
        async with synthesize(BASE, auth=AUTH, web_socket=socket):
            pass
        self.assertEqual(socket.closes, 1)

    async def test_uncooperative_source_cannot_hold_socket_cleanup_hostage(self) -> None:
        release = asyncio.Event()
        class StubbornSource(Source):
            async def __anext__(self) -> Input:
                self.reading.set()
                try:
                    await asyncio.Future[None]()
                except asyncio.CancelledError:
                    await release.wait()
                return "late"
        source, socket = StubbornSource(), Socket()
        try:
            async with synthesize({"model": "coda", "voice": "v", "text": source}, auth=AUTH, web_socket=socket) as stream:
                pending = asyncio.ensure_future(anext(stream))
                await source.reading.wait()
                pending.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await asyncio.wait_for(pending, 1)
            self.assertEqual(socket.closes, 1)
        finally:
            release.set()
        await asyncio.wait_for(source.closed.wait(), 1)

    async def test_input_validation_protocol_bounds_and_error_identity(self) -> None:
        for item in ["🚀" * 1001, cast(Input, {"command": "update"})]:
            source, socket = Source(), Socket()
            request: TtsRequest = {"model": "coda", "voice": "v", "text": source}
            if isinstance(item, str):
                expected = ("Rime WebSocket text frames are limited to 1000 code points",)
            else:
                check = validate_request(request)
                with self.assertRaises(TypeError) as invalid:
                    check(item)
                expected = invalid.exception.args
            source.items.put_nowait(item)
            async with synthesize(request, auth=AUTH, web_socket=socket) as stream:
                with self.assertRaises(TypeError) as caught:
                    await anext(stream)
                self.assertEqual(caught.exception.args, expected)
            self.assertEqual(socket.sent.qsize(), 0)
        failure = OSError("producer failed")
        source, socket = Source(), Socket()
        source.items.put_nowait(failure)
        async with synthesize({"model": "coda", "voice": "v", "text": source}, auth=AUTH, web_socket=socket) as stream:
            with self.assertRaises(OSError) as caught:
                await anext(stream)
            self.assertIs(caught.exception, failure)
        for speed in [0, -1, 5e-324]:
            with self.assertRaises(TypeError) as caught:
                async with synthesize({"model": "mist-v3", "voice": "v", "text": "hi", "text_markup": {"speeds": [speed]}}, auth=AUTH, web_socket=Socket()):
                    pass
            self.assertEqual(str(caught.exception), "Rime inline speeds must have a positive finite reciprocal")

    async def test_auth_precedence_and_preflight_perform_no_io(self) -> None:
        for auth, environment, expected in [
            (AUTH, {"SPEECHSWITCH_RIME_API_KEY": "scoped", "RIME_API_KEY": "legacy"}, "fixture"),
            (None, {"SPEECHSWITCH_RIME_API_KEY": "scoped", "RIME_API_KEY": "legacy"}, "scoped"),
            (None, {"RIME_API_KEY": "legacy"}, "legacy"),
        ]:
            transport = Transport([HttpResponse(200, {}, Body([b"x"]))])
            with patch.dict(os.environ, environment, clear=True):
                async with synthesize(BASE, auth=auth, transport=transport) as stream:
                    self.assertEqual([item async for item in stream], [b"x", {"event": "done"}])
            self.assertEqual(transport.requests[0].headers["Authorization"], f"Bearer {expected}")
        with patch.dict(os.environ, {"RIME_API_KEY": "legacy"}, clear=True):
            with self.assertRaises(TypeError) as caught:
                async with synthesize(BASE, auth={"rime": {"api_key": ""}}, transport=Transport([])):
                    pass
            self.assertEqual(str(caught.exception), "Missing auth.rime.apiKey configuration")
        transport = Transport([])
        with self.assertRaises(TimeoutError):
            async with synthesize(BASE, auth=AUTH, transport=transport, timeout_ms=0):
                pass
        self.assertEqual(transport.requests, [])

    async def test_http_header_cancellation_and_idle_deadline_release_transport(self) -> None:
        started, released = asyncio.Event(), asyncio.Event()
        class PendingTransport:
            async def send(self, request: HttpRequest) -> HttpResponse:
                started.set()
                try:
                    await asyncio.Future[None]()
                finally:
                    released.set()
                raise AssertionError("unreachable")
        async with synthesize(BASE, auth=AUTH, transport=PendingTransport()) as stream:
            pending = asyncio.ensure_future(anext(stream))
            await started.wait()
            pending.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await pending
        self.assertTrue(released.is_set())
        body = Body([b"first"], stall=True)
        with self.assertRaises(TimeoutError):
            async with synthesize(BASE, auth=AUTH, transport=Transport([HttpResponse(200, {}, body)]), timeout_ms=20) as stream:
                self.assertEqual(await anext(stream), b"first")
                await asyncio.Future[None]()
        self.assertEqual(body.closes, 1)

    async def test_generated_invalid_combinations_fail_before_input_or_network(self) -> None:
        source, socket, transport = Source(), Socket(), Transport([])
        for fields in [
            {"model": "mist-v2", "output": {"format": "wav"}},
            {"model": "mist-v3", "language": "es", "text_markup": {"phonemes": False}},
            {"model": "coda", "language": "fr", "timestamp_granularity": "word"},
            {"model": "mist-v3", "text_normalization": True},
            {"model": "coda", "reference_audio": b"audio"},
            {"model": "mist-v2", "output": {"format": "mp3", "sample_rate_hz": 48000}},
        ]:
            request = cast(TtsRequest, {"voice": "v", "text": source, **fields})
            with self.assertRaises(TypeError) as expected:
                validate_request(request)
            with self.assertRaises(TypeError) as caught:
                async with synthesize(request, auth=AUTH, web_socket=socket, transport=transport):
                    pass
            self.assertEqual(caught.exception.args, expected.exception.args)
        self.assertEqual((source.reads, socket.sent.qsize(), transport.requests), (0, 0, []))

    async def test_unicode_frame_limit_is_not_a_connection_total_and_empty_strings_skip(self) -> None:
        source, socket = Source(), Socket()
        async with synthesize({"model": "coda", "voice": "v", "text": source}, auth=AUTH, web_socket=socket) as stream:
            pending = asyncio.ensure_future(anext(stream))
            source.items.put_nowait("")
            source.items.put_nowait("🚀" * 1000)
            source.items.put_nowait("🚀" * 1000)
            first, second = await socket.sent.get(), await socket.sent.get()
            self.assertEqual(first, second)
            self.assertEqual(first["text"], "🚀" * 1000)
            socket.packet({"type": "timestamps", "contextId": None, "word_timestamps": {"words": ["hi"], "start": [0], "end": [1]}})
            socket.packet({"type": "chunk", "contextId": None, "data": ""})
            socket.packet({"type": "chunk", "contextId": None, "data": "AQ=="})
            self.assertEqual(await pending, b"\x01")

    async def test_message_caps_apply_to_injected_reads_and_encoded_writes(self) -> None:
        for incoming in [True, False]:
            socket = Socket()
            if incoming:
                socket.messages.put_nowait(" " * 100)
            async with synthesize(BASE, auth=AUTH, web_socket=socket, max_message_bytes=99 if incoming else 1) as stream:
                with self.assertRaises(TypeError) as caught:
                    await anext(stream)
                self.assertEqual(str(caught.exception), "Rime message exceeds max_message_bytes")
            self.assertEqual(socket.closes, 1)
