import asyncio
import json
import os
import unittest
from collections.abc import AsyncIterator
from pathlib import Path
from typing import cast
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from speechswitch.generated.auth import Auth
from speechswitch.generated.xai import TtsRequest, TtsRequestStreamingTextTextItem as Input
from speechswitch.http import HttpRequest, HttpResponse
from speechswitch.providers.xai import XaiError, synthesize, voice, voices
from speechswitch.websocket import WebSocketError
from test_resemble import Body, Transport, python_names
from test_rime import Socket
from test_smallest import Source
from test_websocket import client_frame, server, upgrade

AUTH: Auth = {"xai": {"api_key": "fixture"}}
FIXTURES = Path(__file__).parents[2] / "fixtures/xai.json"


class AutoSocket(Socket):
    async def send(self, message: str | bytes) -> None:
        await super().send(message)
        value: dict[str, object] = json.loads(message)
        if value["type"] == "session.update":
            self.packet({"type": "session.updated", "replace": value["replace"]})
        elif value["type"] == "text.clear":
            self.packet({"type": "audio.clear"})
        elif value["type"] == "text.done":
            self.packet({"type": "audio.delta", "delta": "AP+A"})
            self.packet({"type": "audio.done", "trace_id": "native"})


class XaiTests(unittest.IsolatedAsyncioTestCase):
    async def test_shared_http_requests_bytes_and_native_timestamps(self) -> None:
        fixtures: dict[str, object] = json.loads(FIXTURES.read_text())
        timing = cast(dict[str, object], fixtures["timestamped"])
        for case in cast(list[dict[str, object]], fixtures["requests"]):
            with self.subTest(name=case["name"]):
                request = cast(TtsRequest, python_names(case["request"]))
                timed = "timestamp_granularity" in request
                body = Body([json.dumps(timing["wire"]).encode()] if timed else [b"", b"\0\xff", b"\x80"])
                backend = Transport([HttpResponse(200, {"Content-TYPE": "application/json" if timed else "Audio/Mpeg; charset=binary"}, body)])
                async with synthesize(request, auth=AUTH, transport=backend, base_url="https://proxy.test/native%2Fpath/?tenant=a%2Bb") as stream:
                    items = [item async for item in stream]
                expected = cast(dict[str, object], python_names(timing["output"]))
                expected["audio"] = b"\0\xff\x80"
                self.assertEqual(items, [expected] if timed else [b"\0\xff", b"\x80"])
                sent, = backend.requests
                self.assertEqual((sent.method, sent.url, dict(sent.headers), json.loads(sent.body)),
                    ("POST", "https://proxy.test/native%2Fpath/v1/tts?tenant=a%2Bb", {"Authorization": "Bearer fixture", "Content-Type": "application/json", "Accept": "application/json" if timed else "audio/*, application/octet-stream"}, case["body"]))
                self.assertEqual(body.closes, 1)

    async def test_byte_stream_is_not_buffered_and_consumer_exit_closes_body(self) -> None:
        body = Body([b"first"], stall=True)
        async with synthesize({"text": "hello"}, auth=AUTH, transport=Transport([HttpResponse(200, {}, body)])) as stream:
            self.assertEqual(await anext(stream), b"first")
        self.assertEqual((body.reads, body.closes), (1, 1))

    async def test_http_failures_preserve_primary_error_without_reading_private_body(self) -> None:
        for status, media, error in [(401, "application/json", "xAI returned HTTP 401"), (307, "audio/mpeg", "xAI returned HTTP 307"), (200, "text/html", "xAI returned an unexpected content type")]:
            body = Body([b"private"], close_error=RuntimeError("cleanup"))
            async with synthesize({"text": "hello"}, auth=AUTH, transport=Transport([HttpResponse(status, {"Content-Type": media}, body)])) as stream:
                with self.assertRaises((XaiError, TypeError)) as caught:
                    await anext(stream)
                self.assertEqual(str(caught.exception), error)
                self.assertEqual([item async for item in stream], [])
            self.assertEqual((body.reads, body.closes), (0, 1))

    async def test_empty_body_and_failed_body_do_not_manufacture_done(self) -> None:
        cases: list[tuple[list[bytes | Exception], str]] = [([b""], "xAI returned no audio bytes"), ([RuntimeError("read failed")], "read failed")]
        for chunks, error in cases:
            body = Body(chunks)
            async with synthesize({"text": "hello"}, auth=AUTH, transport=Transport([HttpResponse(200, {}, body)])) as stream:
                with self.assertRaises((TypeError, RuntimeError)) as caught:
                    await anext(stream)
                self.assertEqual(str(caught.exception), error)
                self.assertEqual([item async for item in stream], [])
            self.assertEqual(body.closes, 1)

    async def test_initial_updates_empty_updates_and_multiple_utterances(self) -> None:
        source: Source[Input] = Source()
        inputs: list[Input | None] = ["first", {"command": "flush"}, {"command": "update", "replacements": []}, "second", None]
        for item in inputs:
            source.items.put_nowait(item)
        socket = AutoSocket()
        async with asyncio.timeout(2), synthesize({"text": source, "replacements": [{"pattern": "Acme", "replacement": "Ack me"}]}, auth=AUTH, web_socket=socket) as stream:
            items = [item async for item in stream]
        self.assertEqual([socket.sent.get_nowait() for _ in range(socket.sent.qsize())], [
            {"type": "session.update", "replace": {"Acme": "Ack me"}}, {"type": "text.delta", "delta": "first"},
            {"type": "text.done"}, {"type": "session.update", "replace": {}}, {"type": "text.delta", "delta": "second"}, {"type": "text.done"}])
        self.assertEqual(items, [{"event": "updated", "replacements": [{"pattern": "Acme", "replacement": "Ack me"}]},
            b"\0\xff\x80", {"event": "done", "trace_id": "native"}, {"event": "updated", "replacements": []}, b"\0\xff\x80", {"event": "done", "trace_id": "native"}])
        await source.closed.wait()
        self.assertEqual(socket.closes, 1)

    async def test_clear_during_flush_drops_stale_audio_and_gates_next_text(self) -> None:
        source: Source[Input] = Source()
        socket = Socket()
        source.items.put_nowait("old")
        async with asyncio.timeout(2), synthesize({"text": source}, auth=AUTH, web_socket=socket) as stream:
            pending = asyncio.ensure_future(anext(stream))
            self.assertEqual(await socket.sent.get(), {"type": "text.delta", "delta": "old"})
            source.items.put_nowait({"command": "flush"})
            self.assertEqual(await socket.sent.get(), {"type": "text.done"})
            source.items.put_nowait({"command": "clear"})
            self.assertEqual(await socket.sent.get(), {"type": "text.clear"})
            source.items.put_nowait("new")
            socket.packet({"type": "audio.delta", "delta": "AQ=="})
            socket.packet({"type": "audio.done"})
            await asyncio.sleep(0)
            await asyncio.sleep(0)
            self.assertEqual((socket.sent.qsize(), pending.done()), (0, False))
            socket.packet({"type": "audio.clear"})
            self.assertEqual(await pending, {"event": "clear"})
            pending = asyncio.ensure_future(anext(stream))
            self.assertEqual(await socket.sent.get(), {"type": "text.delta", "delta": "new"})
            source.items.put_nowait(None)
            self.assertEqual(await socket.sent.get(), {"type": "text.done"})
            socket.packet({"type": "audio.delta", "delta": "Ag=="})
            socket.packet({"type": "audio.done"})
            self.assertEqual(await pending, b"\2")
            self.assertEqual([item async for item in stream], [{"event": "done"}])
        self.assertEqual(socket.closes, 1)

    async def test_update_echo_is_native_and_eof_waits_for_ack(self) -> None:
        source: Source[Input] = Source()
        source.items.put_nowait({"command": "update", "replacements": [{"pattern": "Acme", "replacement": "local"}]})
        source.items.put_nowait(None)
        socket = Socket()
        async with asyncio.timeout(2), synthesize({"text": source}, auth=AUTH, web_socket=socket) as stream:
            pending = asyncio.ensure_future(anext(stream))
            self.assertEqual(await socket.sent.get(), {"type": "session.update", "replace": {"Acme": "local"}})
            await asyncio.sleep(0)
            self.assertFalse(pending.done())
            socket.packet({"type": "session.updated", "replace": {"Acme": "native"}})
            self.assertEqual(await pending, {"event": "updated", "replacements": [{"pattern": "Acme", "replacement": "native"}]})
            self.assertEqual([item async for item in stream], [])
        self.assertEqual(socket.closes, 1)

    async def test_shared_invalid_frames_and_invalid_json(self) -> None:
        fixtures: dict[str, list[dict[str, str]]] = json.loads(FIXTURES.read_text())
        cases: list[tuple[str | bytes, str]] = [(case["wire"], case["error"]) for case in fixtures["invalidFrames"]]
        cases.extend([(b"binary", "xAI returned a non-text WebSocket message"), ("{", "Invalid xAI JSON"), ('{"x":NaN}', "Invalid xAI JSON"), ('{"x":"\\ud800"}', "Invalid xAI JSON")])
        for frame, error in cases:
            with self.subTest(frame=frame):
                source: Source[Input] = Source()
                socket = Socket()
                socket.messages.put_nowait(frame)
                async with asyncio.timeout(2), synthesize({"text": source}, auth=AUTH, web_socket=socket) as stream:
                    with self.assertRaises(TypeError) as caught:
                        await anext(stream)
                    self.assertEqual(str(caught.exception), error)
                self.assertEqual(socket.closes, 1)

    async def test_unsolicited_acknowledgements_audio_and_premature_eof(self) -> None:
        cases: list[tuple[object, str]] = [({"type": "audio.clear"}, "Unexpected xAI audio.clear acknowledgement"),
            ({"type": "audio.done"}, "Unexpected xAI audio.done acknowledgement"),
            ({"type": "session.updated", "replace": {}}, "Unexpected xAI session.updated acknowledgement"),
            ({"type": "audio.delta", "delta": "AQ=="}, "xAI audio arrived outside an active utterance"),
            (None, "xAI WebSocket closed before pending synthesis or acknowledgements completed"),
            ({"type": "error", "message": "private upstream detail"}, "xAI reported a synthesis error")]
        for packet, error in cases:
            source: Source[Input] = Source()
            socket = Socket()
            socket.packet(packet) if packet is not None else socket.messages.put_nowait(None)
            async with asyncio.timeout(2), synthesize({"text": source}, auth=AUTH, web_socket=socket) as stream:
                with self.assertRaises((TypeError, XaiError)) as caught:
                    await anext(stream)
                self.assertEqual(str(caught.exception), error)
            self.assertEqual(socket.closes, 1)

    async def test_timestamp_validation_and_response_size(self) -> None:
        cases: list[tuple[object, str]] = [
            ({"audio": "AQ", "duration": 1}, "Invalid xAI base64 audio"),
            ({"audio": "AQ==", "duration": 1e308}, "Invalid xAI audio duration"),
            ({"audio": "AQ==", "audio_timestamps": None}, "Invalid xAI character timestamps"),
            ({"audio": "AQ==", "audio_timestamps": {"graph_chars": ["a"], "graph_times": [[0.2, 0.1]]}}, "Invalid xAI character timestamp interval"),
            ({"audio": "AQ==", "audio_timestamps": {"graph_chars": ["a"], "graph_times": [[True, 1]]}}, "Invalid xAI character timestamp interval"),
            ([], "Invalid xAI timestamped audio response")]
        for value, error in cases:
            body = Body([json.dumps(value).encode()])
            async with synthesize({"text": "hello", "timestamp_granularity": "character"}, auth=AUTH, transport=Transport([HttpResponse(200, {}, body)])) as stream:
                with self.assertRaises(TypeError) as caught:
                    await anext(stream)
                self.assertEqual(str(caught.exception), error)
            self.assertEqual(body.closes, 1)
        body = Body([b"1234", b"5"])
        async with synthesize({"text": "hello", "timestamp_granularity": "character"}, auth=AUTH, transport=Transport([HttpResponse(200, {}, body)]), max_response_bytes=4) as stream:
            with self.assertRaises(TypeError) as caught:
                await anext(stream)
            self.assertEqual(str(caught.exception), "xAI response exceeds max_response_bytes")

    async def test_cancel_pending_input_and_receive_and_idle_timeout(self) -> None:
        for idle in (False, True):
            source: Source[Input] = Source()
            socket = Socket()
            with self.assertRaises(TimeoutError):
                async with synthesize({"text": source}, auth=AUTH, web_socket=socket, timeout_ms=30) as stream:
                    if idle:
                        await asyncio.Future[None]()
                    else:
                        await anext(stream)
            self.assertEqual(socket.closes, 1)
            if not idle:
                await source.closed.wait()

    async def test_http_timeout_during_headers_and_body(self) -> None:
        class BlockedTransport:
            async def send(self, request: HttpRequest) -> HttpResponse:
                await asyncio.Future[None]()
                raise AssertionError("unreachable")
        with self.assertRaises(TimeoutError):
            async with synthesize({"text": "hi"}, auth=AUTH, transport=BlockedTransport(), timeout_ms=30) as stream:
                await anext(stream)
        body = Body([], stall=True)
        with self.assertRaises(TimeoutError):
            async with synthesize({"text": "hi"}, auth=AUTH, transport=Transport([HttpResponse(200, {}, body)]), timeout_ms=30) as stream:
                await anext(stream)
        self.assertEqual(body.closes, 1)

    async def test_failed_send_is_not_hidden_by_native_done(self) -> None:
        failure = RuntimeError("send failed")
        class FailingSocket(Socket):
            async def send(self, message: str | bytes) -> None:
                await super().send(message)
                value: dict[str, object] = json.loads(message)
                if value["type"] == "text.done":
                    self.packet({"type": "audio.done"})
                    await asyncio.sleep(0)
                    raise failure
        source: Source[Input] = Source()
        source.items.put_nowait("hello")
        source.items.put_nowait(None)
        socket = FailingSocket()
        async with asyncio.timeout(2), synthesize({"text": source}, auth=AUTH, web_socket=socket) as stream:
            with self.assertRaises(RuntimeError) as caught:
                await anext(stream)
            self.assertIs(caught.exception, failure)
        self.assertEqual(socket.closes, 1)

    async def test_discovery_paths_nullable_language_and_existing_custom_ids(self) -> None:
        body = Body([b'{"voices":[{"voice_id":"eve","name":"Eve","language":null},{"voice_id":"rex","name":"Rex"}]}'])
        backend = Transport([HttpResponse(200, {}, body)])
        self.assertEqual(await voices(auth=AUTH, transport=backend), [{"voice_id": "eve", "name": "Eve", "language": None}, {"voice_id": "rex", "name": "Rex"}])
        self.assertEqual((backend.requests[0].url, dict(backend.requests[0].headers), body.closes), ("https://api.x.ai/v1/tts/voices", {"Authorization": "Bearer fixture", "Accept": "application/json"}, 1))
        body = Body([b'{"voice_id":"custom","name":"Saved","language":"en"}'])
        backend = Transport([HttpResponse(200, {}, body)])
        self.assertEqual(await voice("../custom?#雪", auth=AUTH, transport=backend, base_url="https://proxy.test/prefix"), {"voice_id": "custom", "name": "Saved", "language": "en"})
        self.assertEqual(backend.requests[0].url, "https://proxy.test/prefix/v1/tts/voices/%2E%2E%2Fcustom%3F%23%E9%9B%AA")

    async def test_auth_precedence_and_explicit_empty_is_not_replaced_by_environment(self) -> None:
        with patch.dict(os.environ, {"SPEECHSWITCH_XAI_API_KEY": "primary", "XAI_API_KEY": "fallback"}, clear=True):
            backend = Transport([HttpResponse(200, {}, Body([b"x"]))])
            async with synthesize({"text": "hi"}, transport=backend) as stream:
                self.assertEqual([item async for item in stream], [b"x"])
            self.assertEqual(backend.requests[0].headers["Authorization"], "Bearer primary")
            for key, error in [("", "Missing auth.xai.apiKey configuration"), ("bad\nkey", "xAI API key must contain only visible ASCII characters")]:
                socket = Socket()
                source: Source[Input] = Source()
                with self.assertRaises(TypeError) as caught:
                    async with synthesize({"text": source}, auth={"xai": {"api_key": key}}, web_socket=socket):
                        self.fail("invalid auth accepted")
                self.assertEqual((str(caught.exception), socket.closes, source.reads), (error, 1, 0))

    async def test_schema_bounds_fail_before_io_and_commands_validate_when_pulled(self) -> None:
        cases: list[dict[str, object]] = [{"text": "😀" * 15001}, {"speed": 1.6}, {"language": "es"},
            {"model": "other"}, {"output": {"format": "pcm", "bit_rate_bps": 128000}},
            {"replacements": [{"pattern": "x" * 101, "replacement": "a"}]},
            {"replacements": [{"pattern": "x", "replacement": "😀" * 129}]},
            {"replacements": [{"pattern": str(i), "replacement": "a"} for i in range(201)]}]
        for fields in cases:
            source: Source[Input] = Source()
            socket = Socket()
            with self.assertRaises(TypeError) as caught:
                async with synthesize(cast(TtsRequest, {"text": source, **fields}), auth=AUTH, web_socket=socket):
                    self.fail("invalid request accepted")
            self.assertEqual((str(caught.exception), source.reads, socket.closes, socket.sent.qsize()), ("Invalid xai TTS request", 0, 1, 0))
        inputs: list[object] = [{"command": "update"}, {"command": "update", "replacements": [{"pattern": "x" * 101, "replacement": "a"}]},
            {"command": "unknown"}, {"command": False}, 42]
        for value in inputs:
            source: Source[Input] = Source()
            source.items.put_nowait(cast(Input, value))
            socket = Socket()
            async with asyncio.timeout(2), synthesize({"text": source}, auth=AUTH, web_socket=socket) as stream:
                with self.assertRaises(TypeError) as caught:
                    await anext(stream)
                self.assertEqual(str(caught.exception), "Invalid xai TTS input item")
            self.assertEqual((socket.closes, socket.sent.qsize()), (1, 0))
        backend = Transport([HttpResponse(200, {}, Body([b"x"]))])
        async with synthesize({"text": "😀" * 15000, "replacements": [{"pattern": "a" * 100, "replacement": "😀" * 128}]}, auth=AUTH, transport=backend) as stream:
            self.assertEqual([item async for item in stream], [b"x"])

    async def test_per_delta_limit_and_duplicate_phrase_equivalence(self) -> None:
        for value, error in [("😀" * 15001, "xAI text.delta exceeds 15000 characters"),
            ({"command": "update", "replacements": [{"pattern": " Acme\u00a0Mobile ", "replacement": "a"}, {"pattern": "acme mobile", "replacement": "b"}]}, "Duplicate xAI replacement phrase: acme mobile")]:
            source: Source[Input] = Source()
            source.items.put_nowait(cast(Input, value))
            socket = Socket()
            async with synthesize({"text": source}, auth=AUTH, web_socket=socket) as stream:
                with self.assertRaises(TypeError) as caught:
                    await anext(stream)
                self.assertEqual(str(caught.exception), error)
            self.assertEqual(socket.sent.qsize(), 0)

    async def test_native_socket_auth_query_and_fragmented_chunk_timestamps(self) -> None:
        source: Source[Input] = Source()
        source.items.put_nowait("Acme")
        source.items.put_nowait(None)
        async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            path, headers = await upgrade(reader, writer)
            self.assertEqual(headers[b"authorization"], b"Bearer fixture")
            self.assertEqual(headers.get(b"sec-websocket-protocol"), None)
            target = urlsplit(path.decode().split(" ")[1])
            self.assertEqual(target.path, "/proxy%2Fpath/v1/tts/")
            self.assertEqual(parse_qs(target.query), {"tenant": ["a+b"], "voice": ["existing-custom"], "language": ["auto"], "codec": ["mp3"], "sample_rate": ["24000"], "bit_rate": ["128000"], "speed": ["1"], "optimize_streaming_latency": ["2"], "text_normalization": ["false"], "with_timestamps": ["true"]})
            opcode, data = await client_frame(reader)
            self.assertEqual((opcode, json.loads(data)), (1, {"type": "session.update", "replace": {"Acme": "Ack me"}}))
            for expected in [{"type": "text.delta", "delta": "Acme"}, {"type": "text.done"}]:
                opcode, data = await client_frame(reader)
                self.assertEqual((opcode, json.loads(data)), (1, expected))
            frames = [{"type": "session.updated", "replace": {"Acme": "native"}},
                {"type": "audio.delta", "delta": "AP+A", "audio_duration": 0.25, "audio_timestamps": {"graph_chars": ["😀"], "graph_times": [[0, 0.25]]}},
                {"type": "audio.done", "trace_id": "native"}]
            for packet in frames:
                data = json.dumps(packet, ensure_ascii=False, separators=(",", ":")).encode()
                # Fragment at arbitrary byte boundaries, including within UTF-8.
                for index, byte in enumerate(data):
                    writer.write(bytes([0x81 if len(data) == 1 else 1 if index == 0 else 0x80 if index == len(data) - 1 else 0, 1, byte]))
                await writer.drain()
            await reader.read()
        async with server(handle) as url:
            async with synthesize({"text": source, "voice": "existing-custom", "output": {"format": "mp3", "sample_rate_hz": 24000, "bit_rate_bps": 128000}, "speed": 1.0,
                "latency_optimization": "aggressive", "text_normalization": False, "timestamp_granularity": "character", "replacements": [{"pattern": "Acme", "replacement": "Ack me"}]},
                auth=AUTH, web_socket_url=url + "/proxy%2Fpath/v1/tts/?tenant=a%2Bb&language=fr&voice=wrong") as stream:
                self.assertEqual([item async for item in stream], [{"event": "updated", "replacements": [{"pattern": "Acme", "replacement": "native"}]},
                    {"correlation": "chunk", "audio": b"\0\xff\x80", "duration_ms": 250, "timestamps": [{"kind": "character", "value": "😀", "start_time_ms": 0, "end_time_ms": 250}]}, {"event": "done", "trace_id": "native"}])

    async def test_rejected_native_upgrade_does_not_pull_input(self) -> None:
        source: Source[Input] = Source()
        async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            await reader.readuntil(b"\r\n\r\n")
            writer.write(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n")
            await writer.drain()
        async with server(handle) as url:
            async with synthesize({"text": source}, auth=AUTH, web_socket_url=url) as stream:
                with self.assertRaises(WebSocketError) as caught:
                    await anext(stream)
                self.assertEqual(str(caught.exception), "WebSocket handshake was not accepted")
        self.assertEqual(source.reads, 0)

    async def test_uncooperative_producer_does_not_hold_socket_cleanup(self) -> None:
        release, reading, closed = asyncio.Event(), asyncio.Event(), asyncio.Event()
        class Uncooperative:
            def __aiter__(self) -> AsyncIterator[Input]:
                return self
            async def __anext__(self) -> Input:
                reading.set()
                while not release.is_set():
                    try:
                        await release.wait()
                    except asyncio.CancelledError:
                        pass
                raise StopAsyncIteration
            async def aclose(self) -> None:
                closed.set()
        socket = Socket()
        try:
            async with asyncio.timeout(2), synthesize({"text": Uncooperative()}, auth=AUTH, web_socket=socket) as stream:
                pending = asyncio.ensure_future(anext(stream))
                await reading.wait()
                socket.packet({"type": "error", "message": "private"})
                with self.assertRaises(XaiError) as caught:
                    await pending
                self.assertEqual(str(caught.exception), "xAI reported a synthesis error")
            self.assertEqual(socket.closes, 1)
            self.assertFalse(closed.is_set())
        finally:
            release.set()
            await asyncio.wait_for(closed.wait(), 1)

    async def test_empty_flush_clear_only_and_empty_timestamps(self) -> None:
        cases: list[tuple[list[Input | None], list[object], list[object]]] = [
            (["", {"command": "flush"}, None], [], []),
            ([{"command": "clear"}, None], [{"event": "clear"}], [{"type": "text.clear"}]),
            (["hello", None], [{"correlation": "chunk", "audio": b"\0\xff\x80", "timestamps": []}, {"event": "done", "trace_id": "native"}], [{"type": "text.delta", "delta": "hello"}, {"type": "text.done"}])]
        for inputs, expected, sent in cases:
            source: Source[Input] = Source()
            for item in inputs:
                source.items.put_nowait(item)
            socket = AutoSocket()
            async with asyncio.timeout(2), synthesize({"text": source, "timestamp_granularity": "character"}, auth=AUTH, web_socket=socket) as stream:
                self.assertEqual([item async for item in stream], expected)
            self.assertEqual([socket.sent.get_nowait() for _ in range(socket.sent.qsize())], sent)
            self.assertEqual(socket.closes, 1)

    async def test_boundary_urls_limits_and_transport_conflicts(self) -> None:
        for url in ("", "ftp://host", "https://user:pass@host", "https://host/#", "https://host/%zz", "https://host:99999", "https://host\\path", "https://host:"):
            source: Source[Input] = Source()
            socket = Socket()
            with self.assertRaises(TypeError) as caught:
                async with synthesize({"text": source}, auth=AUTH, web_socket=socket, base_url=url):
                    self.fail("invalid URL accepted")
            self.assertEqual((str(caught.exception), socket.closes, source.reads), ("xAI endpoint must be HTTP(S) or WS(S) without credentials, fragments or invalid escapes", 1, 0))
        for limit in (0, -1, True, 2**53):
            socket = Socket()
            source: Source[Input] = Source()
            with self.assertRaises(TypeError) as caught:
                async with synthesize({"text": source}, auth=AUTH, web_socket=socket, max_message_bytes=limit):
                    self.fail("invalid limit accepted")
            self.assertEqual((str(caught.exception), socket.closes), ("xAI max_message_bytes must be a positive safe integer", 1))
        for timeout in (-1, True, 2147483648):
            with self.assertRaises(TypeError) as caught:
                async with synthesize({"text": "hi"}, auth=AUTH, timeout_ms=timeout):
                    self.fail("invalid timeout accepted")
            self.assertEqual(str(caught.exception), "xAI timeout_ms must be an integer between 0 and 2147483647")
        socket = Socket()
        with self.assertRaises(TypeError) as caught:
            async with synthesize({"text": "hi"}, auth=AUTH, web_socket=socket):
                self.fail("conflicting transport accepted")
        self.assertEqual((str(caught.exception), socket.closes), ("xAI socket overrides require streaming input", 1))
        with self.assertRaises(TypeError) as caught:
            async with synthesize({"text": "hi"}, auth=AUTH):
                self.fail("missing HTTP transport accepted")
        self.assertEqual(str(caught.exception), "xAI HTTP requires an injected transport")

    async def test_discovery_errors_validate_without_exposing_private_bodies(self) -> None:
        for value, error in [(b"[]", "Invalid xAI voice list"), (b'{"voices":null}', "Invalid xAI voice list"),
            (b'{"voices":[{}]}', "Invalid xAI voice"), (b'{"voices":[{"voice_id":"eve","name":"Eve","language":42}]}', "Invalid xAI voice language")]:
            body = Body([value])
            with self.assertRaises(TypeError) as caught:
                await voices(auth=AUTH, transport=Transport([HttpResponse(200, {}, body)]))
            self.assertEqual((str(caught.exception), body.closes), (error, 1))
        for status, media, error in [(403, "application/json", "xAI returned HTTP 403"), (200, "text/html", "xAI returned an unexpected content type")]:
            body = Body([b"private"])
            with self.assertRaises((XaiError, TypeError)) as caught:
                await voices(auth=AUTH, transport=Transport([HttpResponse(status, {"Content-Type": media}, body)]))
            self.assertEqual((str(caught.exception), body.reads, body.closes), (error, 0, 1))

    async def test_audio_progresses_during_pending_flush_write_and_done_waits(self) -> None:
        release = asyncio.Event()
        class PendingSocket(Socket):
            async def send(self, message: str | bytes) -> None:
                await super().send(message)
                value: dict[str, object] = json.loads(message)
                if value["type"] == "text.done":
                    self.packet({"type": "audio.delta", "delta": "AQ=="})
                    self.packet({"type": "audio.done"})
                    await release.wait()
        socket = PendingSocket()
        source: Source[Input] = Source()
        source.items.put_nowait("hello")
        source.items.put_nowait(None)
        async with asyncio.timeout(2), synthesize({"text": source}, auth=AUTH, web_socket=socket) as stream:
            self.assertEqual(await anext(stream), b"\1")
            pending = asyncio.ensure_future(anext(stream))
            await asyncio.sleep(0)
            await asyncio.sleep(0)
            self.assertFalse(pending.done())
            release.set()
            self.assertEqual(await pending, {"event": "done"})
            self.assertEqual([item async for item in stream], [])
        self.assertEqual(socket.closes, 1)
