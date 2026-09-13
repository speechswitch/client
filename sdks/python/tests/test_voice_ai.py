import asyncio
import json
import os
import unittest
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Literal, cast
from unittest.mock import patch

from speechswitch.generated.auth import Auth
from speechswitch.generated.stream import FlushEvent
from speechswitch.generated.voice_ai import TtsRequest, TtsRequestObject1ec54d36TextAsyncIterableItem as Input
from speechswitch.generated.voice_ai_output import SynthesisItem
from speechswitch.generated.validators.voice_ai import validate_request
from speechswitch.http import HttpRequest, HttpResponse
from speechswitch.providers.voice_ai import VoiceAiError, synthesize
from speechswitch.websocket import WebSocketError
from test_resemble import Body, Transport, python_names
from test_rime import Socket
from test_smallest import Source
from test_websocket import client_frame, server, upgrade

AUTH: Auth = {"voice_ai": {"api_key": "fixture"}}
BASE: TtsRequest = {"text": "Hello"}
SETTINGS: dict[str, object] = {"model": "voiceai-tts-v1-latest", "language": "en", "audio_format": "mp3", "temperature": 1, "top_p": 0.8}
FIXTURES = Path(__file__).parents[2] / "fixtures/voice_ai.json"


def reply(socket: Socket, context: str, audio: str = "AP+A") -> None:
    socket.packet({"context_id": context, "audio": audio})
    socket.packet({"context_id": context, "is_last": True})
    socket.packet({"context_id": context, "context_closed": True})


class AutoSocket(Socket):
    async def send(self, message: str | bytes) -> None:
        await super().send(message)
        value: dict[str, object] = json.loads(message)
        if value.get("flush"):
            reply(self, str(value["context_id"]))


def envelope(context: str, audio: bytes = b"\0\xff\x80") -> SynthesisItem:
    return {"correlation": "ordered", "correlation_id": context, "audio": audio, "timestamps": ()}


class VoiceAiTypes(unittest.TestCase):
    def test_existing_voice_zero_settings_and_numeric_dictionary_revision(self) -> None:
        request: TtsRequest = {"text": "Hello", "voice": "cloned", "model": "voiceai-tts-lite-v1-latest", "temperature": 0,
                               "pronunciation_dictionaries": [{"id": "owned-dictionary", "version": 2}]}
        self.assertEqual(request, {"text": "Hello", "voice": "cloned", "model": "voiceai-tts-lite-v1-latest", "temperature": 0,
                                   "pronunciation_dictionaries": [{"id": "owned-dictionary", "version": 2}]})
        flush: FlushEvent = {"event": "flush", "correlation_id": "context"}
        self.assertEqual(flush, {"event": "flush", "correlation_id": "context"})


class VoiceAiTests(unittest.IsolatedAsyncioTestCase):
    async def test_buffered_http_audio_allows_scheduled_cancellation(self) -> None:
        protocol: Literal["stream", "http"]
        for legacy in (False, True):
            for protocol in ("stream", "http"):
                with self.subTest(legacy=legacy, protocol=protocol):
                    class BufferedBody(Body):
                        async def __anext__(self) -> bytes:
                            chunk = await super().__anext__()
                            if self.reads == 1:
                                task = asyncio.current_task()
                                assert task is not None
                                asyncio.get_running_loop().call_soon(task.cancel)
                            return chunk

                    body = BufferedBody([b"audio"] * 32)
                    backend = Transport([HttpResponse(200, {}, body)])
                    request: TtsRequest = {"text": "Hello", "api_version": "tts-v2", "voice": "owned"} if legacy else BASE
                    output: list[SynthesisItem] = []

                    async def consume() -> None:
                        async with synthesize(request, auth=AUTH, transport=backend, protocol=protocol) as stream:
                            async for item in stream:
                                output.append(item)

                    with self.assertRaises(asyncio.CancelledError):
                        await asyncio.create_task(consume())
                    self.assertEqual(output, [b"audio"])
                    self.assertEqual((body.reads, body.closes, len(backend.requests)), (1, 1, 1))

    async def test_nine_shared_variants_preserve_native_payload_and_output(self) -> None:
        fixtures: dict[str, object] = json.loads(FIXTURES.read_text())
        for fixture in cast(list[dict[str, object]], fixtures["requests"]):
            with self.subTest(name=fixture["name"]):
                socket, body = AutoSocket(), Body([b"", b"\0\xff\x80"])
                backend = Transport([HttpResponse(200, {"Content-TYPE": "Audio/Mpeg; charset=binary"}, body)])
                request = cast(TtsRequest, python_names(fixture["request"]))
                protocol = cast(Literal["stream", "http", "websocket"], fixture["protocol"])
                async with asyncio.timeout(2), synthesize(request, auth=AUTH, transport=backend, protocol=protocol,
                    web_socket=socket if protocol == "websocket" else None, base_url="https://proxy.test/native%2Fpath") as stream:
                    items = [item async for item in stream]
                if protocol == "websocket":
                    first, last = await socket.sent.get(), await socket.sent.get()
                    context = str(first["context_id"])
                    self.assertEqual([first, last], [{**cast(dict[str, object], fixture["body"]), "context_id": context}, {"context_id": context, "text": "", "flush": True, "auto_close": True}])
                    self.assertEqual(items, [envelope(context), {"event": "flush", "correlation_id": context}, {"event": "done"}])
                    self.assertEqual((socket.closes, backend.requests), (1, []))
                else:
                    self.assertEqual(items, [b"\0\xff\x80", {"event": "done"}])
                    sent, = backend.requests
                    self.assertEqual((sent.method, sent.url, dict(sent.headers), json.loads(sent.body)),
                        ("POST", "https://proxy.test/native%2Fpath" + str(fixture["path"]), {"Authorization": "Bearer fixture", "Content-Type": "application/json", "Accept": "audio/*, application/octet-stream"}, fixture["body"]))
                    self.assertEqual(body.closes, 1)

    async def test_default_routes_legacy_modes_and_every_output_mapping(self) -> None:
        for request, protocol, url, expected in [
            (BASE, None, "https://dev.voice.ai/api/v1/tts/speech/stream", {**SETTINGS, "text": "Hello"}),
            ({"text": "Hello", "api_version": "tts-v2", "voice": "owned"}, "http", "https://api.voice.ai/tts/v2/audio/speech", {"text": "Hello", "voice": "owned", "audio_format": "mp3", "streaming": False}),
        ]:
            backend = Transport([HttpResponse(200, {}, Body([b"x"]))])
            async with synthesize(cast(TtsRequest, request), auth=AUTH, transport=backend, protocol=cast(Literal["http"] | None, protocol)) as stream:
                self.assertEqual([item async for item in stream], [b"x", {"event": "done"}])
            self.assertEqual((backend.requests[0].url, json.loads(backend.requests[0].body)), (url, expected))
        cases: list[tuple[dict[str, object], str]] = [
            ({"format": "mp3"}, "mp3"), ({"format": "wav"}, "wav"), ({"format": "pcm"}, "pcm_32000"),
            ({"format": "mp3", "sample_rate_hz": 22050}, "mp3_22050_32"), ({"format": "mp3", "sample_rate_hz": 24000}, "mp3_24000_48"),
            ({"format": "mulaw"}, "ulaw_8000"), ({"format": "alaw"}, "alaw_8000"),
            ({"format": "pcm", "sample_rate_hz": 32000.0}, "pcm_32000"),
            ({"format": "mp3", "sample_rate_hz": 44100.0, "bit_rate_bps": 192000.0}, "mp3_44100_192"),
        ]
        for bitrate in (32000, 64000, 96000, 128000, 192000):
            cases.extend([({"format": "mp3", "sample_rate_hz": 44100, "bit_rate_bps": bitrate}, f"mp3_44100_{bitrate // 1000}"),
                          ({"format": "opus", "bit_rate_bps": bitrate}, f"opus_48000_{bitrate // 1000}")])
        cases.extend(({"format": "pcm", "sample_rate_hz": rate}, f"pcm_{rate}") for rate in (8000, 16000, 22050, 24000, 32000, 44100, 48000))
        cases.extend(({"format": "wav", "sample_rate_hz": rate}, f"wav_{rate}" if rate != 32000 else "wav") for rate in (16000, 22050, 24000, 32000))
        for output, expected in cases:
            body = Body([b"\0\xff"], stall=True)
            backend = Transport([HttpResponse(200, {}, body)])
            async with synthesize(cast(TtsRequest, {"text": "Hello", "output": output}), auth=AUTH, transport=backend) as stream:
                self.assertEqual(await anext(stream), b"\0\xff")
            self.assertEqual((json.loads(backend.requests[0].body)["audio_format"], body.reads, body.closes), (expected, 1, 1))

    async def test_http_failures_do_not_read_or_expose_error_bodies(self) -> None:
        for status, media, expected in [(401, "application/json", "Voice.ai returned HTTP 401"), (307, "audio/mpeg", "Voice.ai returned HTTP 307"), (200, "application/json", "Voice.ai returned an unexpected audio content type")]:
            body = Body([b"private"])
            backend = Transport([HttpResponse(status, {"Content-Type": media}, body)])
            async with synthesize(BASE, auth=AUTH, transport=backend) as stream:
                with self.assertRaises((VoiceAiError, TypeError)) as caught:
                    await anext(stream)
                self.assertEqual(str(caught.exception), expected)
                if isinstance(caught.exception, VoiceAiError):
                    self.assertEqual((caught.exception.status, caught.exception.context_id), (status, None))
                self.assertEqual([item async for item in stream], [])
            self.assertEqual((body.reads, body.closes), (0, 1))

    async def test_empty_audio_and_read_failure_never_yield_done(self) -> None:
        body = Body([b""])
        async with synthesize(BASE, auth=AUTH, transport=Transport([HttpResponse(200, {}, body)])) as stream:
            with self.assertRaises(TypeError) as caught:
                await anext(stream)
            self.assertEqual(str(caught.exception), "Voice.ai returned no audio bytes")
        failure = RuntimeError("read failure")
        body = Body([b"first", failure], close_error=RuntimeError("cleanup failure"))
        async with synthesize(BASE, auth=AUTH, transport=Transport([HttpResponse(200, {}, body)])) as stream:
            self.assertEqual(await anext(stream), b"first")
            with self.assertRaises(RuntimeError) as caught:
                await anext(stream)
            self.assertIs(caught.exception, failure)
            self.assertEqual([item async for item in stream], [])
        self.assertEqual(body.closes, 1)

    async def test_shared_invalid_frames_and_extra_framing_errors(self) -> None:
        fixtures: dict[str, list[dict[str, str]]] = json.loads(FIXTURES.read_text())
        cases: list[tuple[str | bytes, str]] = [(f["wire"], f["error"]) for f in fixtures["invalidFrames"]]
        cases.extend([(b"binary", "Voice.ai expected a JSON text frame"), ("{", "Invalid Voice.ai JSON"), ('{"x":NaN}', "Invalid Voice.ai JSON"), ("\ud800", "Invalid Voice.ai JSON")])
        for frame, expected in cases:
            socket = Socket()
            socket.messages.put_nowait(frame)
            async with asyncio.timeout(2), synthesize(BASE, auth=AUTH, web_socket=socket) as stream:
                with self.assertRaises(TypeError) as caught:
                    await anext(stream)
                self.assertEqual(str(caught.exception), expected)
                self.assertEqual([item async for item in stream], [])
            self.assertEqual(socket.closes, 1)

    async def test_concurrent_flushes_keep_context_identity_and_require_closure(self) -> None:
        source: Source[Input] = Source()
        socket = Socket()
        for part in ("first", {"command": "flush"}, "second", {"command": "flush"}, None):
            source.items.put_nowait(cast(Input | None, part))
        async with asyncio.timeout(2), synthesize({"text": source}, auth=AUTH, web_socket=socket) as stream:
            pending = asyncio.ensure_future(anext(stream))
            first = await socket.sent.get()
            one = str(first["context_id"])
            self.assertEqual(first, {**SETTINGS, "delivery_mode": "raw", "context_id": one, "text": "first"})
            self.assertEqual(await socket.sent.get(), {"context_id": one, "text": "", "flush": True, "auto_close": True})
            second = await socket.sent.get()
            two = str(second["context_id"])
            self.assertNotEqual(one, two)
            self.assertEqual(second, {**SETTINGS, "delivery_mode": "raw", "context_id": two, "text": "second"})
            self.assertEqual(await socket.sent.get(), {"context_id": two, "text": "", "flush": True, "auto_close": True})
            socket.packet({"context_id": two, "audio": "Ag=="})
            socket.packet({"context_id": one, "audio": "AQ=="})
            socket.packet({"context_id": two, "is_last": True})
            socket.packet({"context_id": one, "is_last": True})
            self.assertEqual(await pending, envelope(two, b"\2"))
            self.assertEqual(await anext(stream), envelope(one, b"\1"))
            self.assertEqual(await anext(stream), {"event": "flush", "correlation_id": two})
            self.assertEqual(await anext(stream), {"event": "flush", "correlation_id": one})
            pending = asyncio.ensure_future(anext(stream))
            await asyncio.sleep(0)
            self.assertFalse(pending.done())
            socket.packet({"context_id": one, "context_closed": True})
            socket.packet({"context_id": two, "context_closed": True})
            self.assertEqual(await pending, {"event": "done"})
            self.assertEqual([item async for item in stream], [])
        self.assertEqual(socket.closes, 1)

    async def test_clear_waits_for_closures_and_suppresses_retired_contexts(self) -> None:
        for flushing in (False, True):
            source: Source[Input] = Source()
            socket = Socket()
            source.items.put_nowait("old")
            async with asyncio.timeout(2), synthesize({"text": source}, auth=AUTH, web_socket=socket) as stream:
                pending = asyncio.ensure_future(anext(stream))
                first = await socket.sent.get()
                old = str(first["context_id"])
                if flushing:
                    source.items.put_nowait({"command": "flush"})
                    self.assertEqual(await socket.sent.get(), {"context_id": old, "text": "", "flush": True, "auto_close": True})
                source.items.put_nowait({"command": "clear"})
                source.items.put_nowait({"command": "clear"})
                source.items.put_nowait("new")
                if not flushing:
                    self.assertEqual(await socket.sent.get(), {"context_id": old, "close_context": True})
                second = await socket.sent.get()
                new = str(second["context_id"])
                self.assertEqual(second, {**SETTINGS, "delivery_mode": "raw", "context_id": new, "text": "new"})
                self.assertFalse(pending.done())
                socket.packet({"context_id": old, "audio": "AQ=="})
                socket.packet({"context_id": old, "is_last": True})
                socket.packet({"context_id": old, "context_closed": True})
                self.assertEqual(await pending, {"event": "clear"})
                self.assertEqual(await anext(stream), {"event": "clear"})
                source.items.put_nowait(None)
                pending = asyncio.ensure_future(anext(stream))
                self.assertEqual(await socket.sent.get(), {"context_id": new, "text": "", "flush": True, "auto_close": True})
                reply(socket, old, "AQ==")
                reply(socket, new, "Ag==")
                self.assertEqual(await pending, envelope(new, b"\2"))
                self.assertEqual([item async for item in stream], [{"event": "flush", "correlation_id": new}, {"event": "done"}])
            self.assertEqual((socket.closes, socket.sent.qsize()), (1, 0))

    async def test_empty_input_empty_flush_and_clear_are_local_noops(self) -> None:
        async def text() -> AsyncIterator[Input]:
            yield ""
            yield {"command": "flush"}
            yield {"command": "clear"}
            yield {"command": "clear"}
        socket = Socket()
        async with asyncio.timeout(2), synthesize({"text": text()}, auth=AUTH, web_socket=socket) as stream:
            self.assertEqual([item async for item in stream], [{"event": "clear"}, {"event": "clear"}, {"event": "done"}])
        self.assertEqual((socket.sent.qsize(), socket.closes), (0, 1))

    async def test_protocol_state_errors_do_not_become_success(self) -> None:
        for packet, flushing, expected in [
            ({"audio": "AQ=="}, False, "Voice.ai audio arrived outside an active flush"),
            ({"is_last": True}, False, "Voice.ai returned an unexpected or empty flush completion"),
            ({"is_last": True}, True, "Voice.ai returned an unexpected or empty flush completion"),
            ({"context_closed": True}, True, "Voice.ai context closed before flush completion"),
            ({"audio": "AQ==", "context_id": "foreign"}, True, "Voice.ai returned an unknown or completed context"),
        ]:
            source: Source[Input] = Source()
            source.items.put_nowait("hello")
            socket = Socket()
            async with asyncio.timeout(2), synthesize({"text": source}, auth=AUTH, web_socket=socket) as stream:
                pending = asyncio.ensure_future(anext(stream))
                first = await socket.sent.get()
                if flushing:
                    source.items.put_nowait({"command": "flush"})
                    await socket.sent.get()
                socket.packet({"context_id": first["context_id"], **packet})
                with self.assertRaises(TypeError) as caught:
                    await pending
                self.assertEqual(str(caught.exception), expected)
                self.assertEqual([item async for item in stream], [])
            await source.closed.wait()
            self.assertEqual(socket.closes, 1)

    async def test_native_socket_auth_framed_audio_and_rejected_upgrade(self) -> None:
        finished = asyncio.Event()
        async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            path, headers = await upgrade(reader, writer)
            self.assertEqual(path, b"GET /proxy%2Fraw/api/v1/tts/multi-stream HTTP/1.1")
            self.assertEqual(headers[b"authorization"], b"Bearer fixture")
            self.assertEqual(headers.get(b"sec-websocket-protocol"), None)
            opcode, raw = await client_frame(reader)
            self.assertEqual(opcode, 1)
            initial: dict[str, object] = json.loads(raw)
            self.assertEqual(initial, {**SETTINGS, "text": "Hello", "delivery_mode": "raw", "context_id": initial["context_id"]})
            opcode, raw = await client_frame(reader)
            self.assertEqual((opcode, json.loads(raw)), (1, {"context_id": initial["context_id"], "text": "", "flush": True, "auto_close": True}))
            for packet in ({"audio": "AP+A"}, {"is_last": True}, {"context_closed": True}):
                frame = json.dumps({"context_id": initial["context_id"], **packet}, separators=(",", ":")).encode()
                writer.write(bytes([1, 10]) + frame[:10] + bytes([128, len(frame) - 10]) + frame[10:])
                await writer.drain()
            await reader.read()
            finished.set()
        async with server(handle) as url:
            async with synthesize(BASE, auth=AUTH, base_url=url + "/proxy%2Fraw", protocol="websocket") as stream:
                items = [item async for item in stream]
            first = cast(dict[str, object], items[0])
            context = str(first["correlation_id"])
            self.assertEqual(items, [envelope(context), {"event": "flush", "correlation_id": context}, {"event": "done"}])
            await finished.wait()
        async def reject(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            await reader.readuntil(b"\r\n\r\n")
            writer.write(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n")
            await writer.drain()
        source: Source[Input] = Source()
        async with server(reject) as url:
            async with synthesize({"text": source}, auth=AUTH, base_url=url) as stream:
                with self.assertRaises(WebSocketError):
                    await anext(stream)
        self.assertEqual(source.reads, 0)

    async def test_auth_and_boundary_validation_precede_network(self) -> None:
        for entry, scoped, native, expected in [(AUTH, "scoped", "native", "fixture"), (None, "scoped", "native", "scoped"), (None, None, "native", "native"), (None, "", "native", ""), ({"voice_ai": {"api_key": ""}}, "scoped", "native", ""), (None, None, None, "")]:
            env: dict[str, str] = {}
            if scoped is not None:
                env["SPEECHSWITCH_VOICE_AI_API_KEY"] = scoped
            if native is not None:
                env["VOICE_AI_API_KEY"] = native
            backend = Transport([HttpResponse(200, {}, Body([b"x"]))])
            with patch.dict(os.environ, env, clear=True):
                if expected:
                    async with synthesize(BASE, auth=cast(Auth | None, entry), transport=backend) as stream:
                        self.assertEqual([item async for item in stream], [b"x", {"event": "done"}])
                    self.assertEqual(backend.requests[0].headers["Authorization"], "Bearer " + expected)
                else:
                    socket = Socket()
                    with self.assertRaises(TypeError) as caught:
                        async with synthesize(BASE, auth=cast(Auth | None, entry), web_socket=socket):
                            pass
                    self.assertEqual(str(caught.exception), "Missing auth.voice.ai.apiKey configuration")
                    self.assertEqual(socket.closes, 1)

    async def test_generated_validation_rejects_invalid_requests_and_input_commands(self) -> None:
        invalid: list[dict[str, object]] = [{"text": None}, {"temperature": float("nan")}, {"temperature": 2.1}, {"top_p": -0.1}, {"pronunciation_dictionaries": []}, {"pronunciation_dictionaries": [{"id": "d", "version": 1.5}]}, {"pronunciation_dictionaries": [{"id": "d", "version_id": "2"}]}, {"output": {"format": "opus"}}, {"audio_delivery": "paced", "output": {"format": "mp3"}}, {"model": "voiceai-tts-v1-latest", "language": "fr"}, {"model": "voiceai-tts-multilingual-v1-latest"}, {"api_version": "tts-v2", "voice": "owned", "temperature": 0}, {"api_version": "tts-v2", "voice": "owned", "model": "v1"}]
        for fields in invalid:
            socket = Socket()
            request = cast(TtsRequest, {**BASE, **fields})
            with self.assertRaises(TypeError) as expected:
                validate_request(request)
            with self.assertRaises(TypeError) as caught:
                async with synthesize(request, auth=AUTH, web_socket=socket):
                    pass
            self.assertEqual(caught.exception.args, expected.exception.args)
            self.assertEqual((socket.closes, socket.sent.qsize()), (1, 0))
        invalid_items: list[object] = [{"command": "update", "replace": {}}, {"command": False}, 42]
        for part in invalid_items:
            source: Source[Input] = Source()
            source.items.put_nowait(cast(Input, part))
            socket = Socket()
            with self.assertRaises(TypeError) as expected:
                validate_request({"text": source})(part)
            async with synthesize({"text": source}, auth=AUTH, web_socket=socket) as stream:
                with self.assertRaises(TypeError) as caught:
                    await anext(stream)
                self.assertEqual(caught.exception.args, expected.exception.args)
            await source.closed.wait()
            self.assertEqual((socket.sent.qsize(), socket.closes), (0, 1))

    async def test_deadlines_cancel_headers_body_input_and_idle_consumer(self) -> None:
        closed = asyncio.Event()
        class Pending:
            async def send(self, request: HttpRequest) -> HttpResponse:
                try:
                    await asyncio.Future[None]()
                    raise AssertionError
                finally:
                    closed.set()
        with self.assertRaises(TimeoutError):
            async with synthesize(BASE, auth=AUTH, transport=Pending(), timeout_ms=10) as stream:
                await anext(stream)
        self.assertTrue(closed.is_set())
        body = Body([], stall=True)
        with self.assertRaises(TimeoutError):
            async with synthesize(BASE, auth=AUTH, transport=Transport([HttpResponse(200, {}, body)]), timeout_ms=10) as stream:
                await anext(stream)
        self.assertEqual(body.closes, 1)
        source: Source[Input] = Source()
        socket = Socket()
        with self.assertRaises(TimeoutError):
            async with synthesize({"text": source}, auth=AUTH, web_socket=socket, timeout_ms=10) as stream:
                await anext(stream)
        await source.closed.wait()
        self.assertEqual(socket.closes, 1)
        socket = AutoSocket()
        with self.assertRaises(TimeoutError):
            async with synthesize(BASE, auth=AUTH, web_socket=socket, timeout_ms=50) as stream:
                first = await anext(stream)
                self.assertEqual(cast(dict[str, object], first)["audio"], b"\0\xff\x80")
                await asyncio.sleep(1)
        self.assertEqual(socket.closes, 1)

    async def test_failures_preserve_identity_and_do_not_wait_for_blocked_producers(self) -> None:
        failure = RuntimeError("input failure")
        source: Source[Input] = Source()
        source.items.put_nowait(failure)
        socket = Socket()
        async with synthesize({"text": source}, auth=AUTH, web_socket=socket) as stream:
            with self.assertRaises(RuntimeError) as caught:
                await anext(stream)
            self.assertIs(caught.exception, failure)
        await source.closed.wait()
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
                socket.packet({"error": "private details", "context_id": "native"})
                with self.assertRaises(VoiceAiError) as caught:
                    await pending
                self.assertEqual((str(caught.exception), caught.exception.status, caught.exception.context_id), ("Voice.ai reported a synthesis error", None, "native"))
            self.assertEqual(socket.closes, 1)
            self.assertFalse(closed.is_set())
        finally:
            release.set()
            await asyncio.wait_for(closed.wait(), 1)

    async def test_audio_progresses_during_pending_flush_write_and_write_failure_wins(self) -> None:
        for fail in (False, True):
            release, closed = asyncio.Event(), asyncio.Event()
            failure = RuntimeError("send failure")
            class PendingSocket(Socket):
                async def send(self, message: str | bytes) -> None:
                    await super().send(message)
                    value: dict[str, object] = json.loads(message)
                    if value.get("flush"):
                        reply(self, str(value["context_id"]))
                        try:
                            await release.wait()
                            if fail:
                                raise failure
                        finally:
                            closed.set()
            socket = PendingSocket()
            async with asyncio.timeout(2), synthesize(BASE, auth=AUTH, web_socket=socket) as stream:
                first = cast(dict[str, object], await anext(stream))
                context = str(first["correlation_id"])
                self.assertEqual(first, envelope(context))
                self.assertFalse(closed.is_set())
                self.assertEqual(await anext(stream), {"event": "flush", "correlation_id": context})
                pending = asyncio.ensure_future(anext(stream))
                await asyncio.sleep(0)
                self.assertFalse(pending.done())
                release.set()
                if fail:
                    with self.assertRaises(RuntimeError) as caught:
                        await pending
                    self.assertIs(caught.exception, failure)
                else:
                    self.assertEqual(await pending, {"event": "done"})
            self.assertEqual(socket.closes, 1)

    async def test_boundaries_limits_and_transport_conflicts_fail_without_io(self) -> None:
        for base in ("", "https://user:pass@host", "https://host/?", "https://host/#", "https://host/%zz", "ftp://host", "https://host\\path", "https://host:99999", "https://[invalid]"):
            socket = Socket()
            with self.assertRaises(TypeError) as caught:
                async with synthesize(BASE, auth=AUTH, web_socket=socket, base_url=base):
                    pass
            self.assertEqual(str(caught.exception), "Voice.ai base_url must be an HTTP or WebSocket base without credentials, query or fragment")
            self.assertEqual((socket.closes, socket.sent.qsize()), (1, 0))
        for limit in (0, -1, True, 2**53):
            socket = Socket()
            with self.assertRaises(TypeError) as caught:
                async with synthesize(BASE, auth=AUTH, web_socket=socket, max_message_bytes=limit):
                    pass
            self.assertEqual(str(caught.exception), "Voice.ai max_message_bytes must be a positive safe integer")
            self.assertEqual(socket.closes, 1)
        for timeout in (-1, True, 2147483648):
            socket = Socket()
            with self.assertRaises(TypeError) as caught:
                async with synthesize(BASE, auth=AUTH, web_socket=socket, timeout_ms=timeout):
                    pass
            self.assertEqual(str(caught.exception), "Voice.ai timeout_ms must be an integer between 0 and 2147483647")
            self.assertEqual(socket.closes, 1)
        for key in ("Bearer key", "key\r\nx-injected:secret", "秘密", "key\0"):
            socket = Socket()
            with self.assertRaises(TypeError) as caught:
                async with synthesize(BASE, auth={"voice_ai": {"api_key": key}}, web_socket=socket):
                    pass
            self.assertEqual(str(caught.exception), "Voice.ai API key must contain only visible ASCII characters")
            self.assertEqual(socket.closes, 1)
        for request, protocol, override, expected in [
            ({"text": "Hello", "audio_delivery": "paced", "output": {"format": "pcm"}}, "stream", False, "Voice.ai incremental input and paced delivery require WebSocket"),
            ({"text": "Hello", "api_version": "tts-v2", "voice": "owned"}, "websocket", True, "Voice.ai legacy API does not document WebSocket synthesis"),
            (BASE, "http", True, "Voice.ai web_socket override requires WebSocket transport"),
            (BASE, "sse", True, "Invalid Voice.ai protocol"),
        ]:
            backend, socket = Transport([]), Socket()
            with self.assertRaises(TypeError) as caught:
                async with synthesize(cast(TtsRequest, request), auth=AUTH, transport=backend, web_socket=socket if override else None, protocol=cast(Literal["stream", "http", "websocket"], protocol)):
                    pass
            self.assertEqual(str(caught.exception), expected)
            self.assertEqual((backend.requests, socket.closes, socket.sent.qsize()), ([], int(override), 0))
        socket = Socket()
        with self.assertRaises(TimeoutError) as caught:
            async with synthesize(BASE, auth=AUTH, web_socket=socket, timeout_ms=0):
                pass
        self.assertEqual(str(caught.exception), "Voice.ai synthesis deadline expired")
        self.assertEqual((socket.closes, socket.sent.qsize()), (1, 0))

    async def test_frame_limits_count_utf8_bytes_and_never_bound_raw_http_audio(self) -> None:
        socket = AutoSocket()
        with self.assertRaises(TypeError) as caught:
            async with synthesize(BASE, auth=AUTH, web_socket=socket, max_message_bytes=1) as stream:
                await anext(stream)
        self.assertEqual(str(caught.exception), "Voice.ai message exceeds max_message_bytes")
        self.assertEqual((socket.closes, socket.sent.qsize()), (1, 0))
        for exceeds in (True, False):
            socket = Socket()
            frame = json.dumps({"error": "😀" * 60}, ensure_ascii=False, separators=(",", ":"))
            # 12 ASCII bytes of syntax plus 240 UTF-8 bytes; keep the exact
            # boundary independent of code-point count and provider encoding.
            size = len(frame.encode())
            socket.messages.put_nowait(frame)
            async with synthesize(BASE, auth=AUTH, web_socket=socket, max_message_bytes=size - int(exceeds)) as stream:
                with self.assertRaises((TypeError, VoiceAiError)) as caught:
                    await anext(stream)
                self.assertEqual(str(caught.exception), "Voice.ai message exceeds max_message_bytes" if exceeds else "Voice.ai reported a synthesis error")
            self.assertEqual(socket.closes, 1)
        body = Body([b"x" * 10000])
        async with synthesize(BASE, auth=AUTH, transport=Transport([HttpResponse(200, {}, body)]), max_message_bytes=1) as stream:
            self.assertEqual([item async for item in stream], [b"x" * 10000, {"event": "done"}])

    async def test_duplicate_and_post_flush_packets_are_not_retired_without_clear(self) -> None:
        for packet, expected in [
            ({"audio": "Ag=="}, "Voice.ai audio arrived outside an active flush"),
            ({"is_last": True}, "Voice.ai returned an unexpected or empty flush completion"),
            ({"context_closed": True}, "Voice.ai returned an unknown or completed context"),
        ]:
            source: Source[Input] = Source()
            source.items.put_nowait("first")
            source.items.put_nowait({"command": "flush"})
            socket = Socket()
            async with asyncio.timeout(2), synthesize({"text": source}, auth=AUTH, web_socket=socket) as stream:
                pending = asyncio.ensure_future(anext(stream))
                first = await socket.sent.get()
                context = str(first["context_id"])
                await socket.sent.get()
                socket.packet({"context_id": context, "audio": "AQ=="})
                socket.packet({"context_id": context, "is_last": True})
                self.assertEqual(await pending, envelope(context, b"\1"))
                self.assertEqual(await anext(stream), {"event": "flush", "correlation_id": context})
                if "context_closed" in packet:
                    socket.packet({"context_id": context, "context_closed": True})
                socket.packet({"context_id": context, **packet})
                with self.assertRaises(TypeError) as caught:
                    await anext(stream)
                self.assertEqual(str(caught.exception), expected)
            await source.closed.wait()

    async def test_early_socket_close_and_input_acquisition_failures_release_resources(self) -> None:
        socket = Socket()
        socket.messages.put_nowait(None)
        async with synthesize(BASE, auth=AUTH, web_socket=socket) as stream:
            with self.assertRaises(TypeError) as caught:
                await anext(stream)
            self.assertEqual(str(caught.exception), "Voice.ai closed before input and contexts completed")
        failure = RuntimeError("acquire")
        class Broken:
            def __aiter__(self) -> AsyncIterator[Input]:
                raise failure
        socket = Socket()
        async with synthesize({"text": Broken()}, auth=AUTH, web_socket=socket) as stream:
            with self.assertRaises(RuntimeError) as caught:
                await anext(stream)
            self.assertIs(caught.exception, failure)
        self.assertEqual(socket.closes, 1)
