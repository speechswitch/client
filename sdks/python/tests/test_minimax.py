import asyncio
import json
import os
import re
import struct
import unittest
from collections.abc import AsyncIterator, Callable, Iterator, Mapping
from pathlib import Path
from typing import cast
from unittest.mock import patch

from speechswitch.generated.auth import Auth
from speechswitch.generated.minimax import TtsRequest
from speechswitch.generated.validators.minimax import validate_request
from speechswitch.http import HttpRequest, HttpResponse
from speechswitch.providers.minimax import MiniMaxError, TtsInput, synthesize
from speechswitch.websocket import WebSocketError
from test_websocket import client_frame, server, upgrade

AUTH: Auth = {"minimax": {"api_key": "test-key"}}
FIXTURE: dict[str, object] = json.loads((Path(__file__).parents[2] / "fixtures/minimax.json").read_text())


def snake(value: object) -> object:
    if isinstance(value, dict):
        return {re.sub(r"([A-Z])", lambda m: "_" + m[1].lower(), str(key)): snake(item) for key, item in cast(dict[object, object], value).items()}
    if isinstance(value, list): return [snake(item) for item in cast(list[object], value)]
    return value


class Source[T]:
    def __init__(self, values: list[T], stall: bool = False, error: Exception | None = None) -> None:
        self.values, self.stall, self.error = list(values), stall, error
        self.reads, self.closes = 0, 0
        self.waiting, self.closed = asyncio.Event(), asyncio.Event()
    def __aiter__(self) -> AsyncIterator[T]: return self
    async def __anext__(self) -> T:
        self.reads += 1
        if self.values: return self.values.pop(0)
        if self.error is not None: raise self.error
        if self.stall:
            self.waiting.set()
            await asyncio.Future[None]()
        raise StopAsyncIteration
    async def aclose(self) -> None:
        self.closes += 1
        self.closed.set()


class Transport:
    def __init__(self, *responses: HttpResponse) -> None:
        self.responses = list(responses)
        self.requests: list[HttpRequest] = []
    async def send(self, request: HttpRequest) -> HttpResponse:
        self.requests.append(request)
        return self.responses.pop(0)


def response(packet: object, status: int = 200, headers: Mapping[str, str] = {}) -> HttpResponse:
    return HttpResponse(status, headers, Source([json.dumps(packet).encode()]))


def success() -> HttpResponse:
    return response({"data": {"status": 2, "audio": "00ff80"}, "trace_id": "trace"})


def event(packet: object) -> bytes:
    return ("data: " + json.dumps(packet) + "\r\n\r\n").encode()


async def items(*values: TtsInput) -> AsyncIterator[TtsInput]:
    for value in values: yield value


class Socket:
    def __init__(self) -> None:
        self.incoming: asyncio.Queue[str | bytes | Exception] = asyncio.Queue()
        self.sent: list[dict[str, object]] = []
        self.session = ""
        self.closes = 0
        self.closed = asyncio.Event()
        self.on_send: Callable[[dict[str, object]], None] = self.respond
        self.incoming.put_nowait('{"event":"connected_success","connect_id":"connection"}')
    def push(self, value: dict[str, object]) -> None:
        self.incoming.put_nowait(json.dumps({"session_id": self.session, "connect_id": "connection", **value}))
    def respond(self, value: dict[str, object]) -> None:
        if value["event"] == "task_continue":
            self.push({"data": {"audio": "00ff80"}, "is_final": True, "trace_id": "native-request"})
        if value["event"] == "task_finish": self.push({"event": "task_finished"})
        if value["event"] == "task_flush": self.push({"event": "task_flushed", "trace_id": "flush"})
        if value["event"] == "task_cancel": self.push({"event": "task_canceled"})
    async def send(self, message: str | bytes) -> None:
        assert isinstance(message, str)
        value: dict[str, object] = json.loads(message)
        self.sent.append(value)
        if value["event"] == "task_start":
            assert isinstance(value["session_id"], str)
            self.session = value["session_id"]
            self.push({"event": "task_started"})
        self.on_send(value)
    async def receive(self) -> str | bytes:
        value = await self.incoming.get()
        if isinstance(value, Exception): raise value
        return value
    async def aclose(self) -> None:
        self.closes += 1
        self.closed.set()


class Tests(unittest.IsolatedAsyncioTestCase):
    async def test_http_configuration_and_shared_fixtures(self) -> None:
        transport = Transport(success())
        async with synthesize({"voice": "existing-voice", "text": "Hello"}, auth=AUTH, transport=transport,
                              base_url="https://proxy.invalid/a%2Fb/?tenant=one") as audio:
            self.assertEqual([item async for item in audio], [b"\x00\xff\x80", {"event": "done", "trace_id": "trace"}])
        self.assertEqual(len(transport.requests), 1)
        wire = transport.requests[0]
        self.assertEqual((wire.method, wire.url, wire.headers), ("POST", "https://proxy.invalid/a%2Fb/v1/t2a_v2?tenant=one",
                         {"Authorization": "Bearer test-key", "Content-Type": "application/json"}))
        self.assertEqual(json.loads(wire.body), {**cast(dict[str, object], FIXTURE["configuration"]), "text": "Hello",
                         "stream": True, "output_format": "hex", "stream_options": {"exclude_aggregated_audio": True}, "subtitle_enable": False})

    async def test_indexed_blends_and_replacements_preserve_validated_wire_values(self) -> None:
        class Indexed[T](list[T]):
            def __iter__(self) -> Iterator[T]:
                raise AssertionError("custom iteration must not replace indexed values")

        for live in [False, True]:
            transport, socket = Transport(success()), Socket()
            request = cast(TtsRequest, {
                "text": items("Hi") if live else "Hi",
                "voice_blend": Indexed([{"voice": "first", "weight": 20}, {"voice": "second", "weight": 80}]),
                "replacements": Indexed([{"pattern": "Acme", "replacement": "Ack mee"}, {"pattern": "API", "replacement": "A P I"}]),
            })
            async with synthesize(request, auth=AUTH, transport=transport, web_socket=socket if live else None) as audio:
                _ = [item async for item in audio]
            wire = socket.sent[0] if live else json.loads(transport.requests[0].body)
            self.assertEqual(wire["timbre_weights"], [{"voice_id": "first", "weight": 20}, {"voice_id": "second", "weight": 80}])
            self.assertEqual(wire["pronunciation_dict"], {"tone": ["Acme/Ack mee", "API/A P I"]})

    async def test_formats_and_effect_transport_constraints(self) -> None:
        cases: list[tuple[dict[str, object], dict[str, object] | None, str, int, bool]] = [
            ({"format": "mp3", "constant_bit_rate": True}, None, "mp3", 32000, True),
            ({"format": "pcm"}, None, "pcm", 32000, True),
            ({"format": "flac"}, None, "flac", 32000, True),
            ({"format": "wav"}, None, "wav", 32000, False),
            ({"format": "mulaw"}, None, "pcmu_raw", 8000, True),
            ({"format": "wav", "sample_encoding": "mulaw"}, None, "pcmu_wav", 8000, True),
            ({"format": "ogg_opus"}, None, "opus", 24000, True),
            ({"format": "flac"}, {}, "flac", 32000, False),
            ({"format": "wav"}, {}, "wav", 32000, False),
        ]
        for output, effects, format, rate, streaming in cases:
            fields: dict[str, object] = {"voice": "voice", "text": "Hi", "output": output}
            if effects is not None: fields["voice_transform"] = effects
            transport = Transport(success())
            async with synthesize(cast(TtsRequest, fields), auth=AUTH, transport=transport) as audio:
                _ = [item async for item in audio]
            wire = json.loads(transport.requests[0].body)
            self.assertEqual((wire["audio_setting"]["format"], wire["audio_setting"]["sample_rate"], wire["stream"]), (format, rate, streaming))
            self.assertEqual("stream_options" in wire, streaming)

    async def test_all_models_single_blended_http_and_socket(self) -> None:
        for model in ["speech-01-hd", "speech-01-turbo", "speech-02-hd", "speech-02-turbo", "speech-2.6-hd", "speech-2.6-turbo", "speech-2.8-hd", "speech-2.8-turbo"]:
            for blended in [False, True]:
                for live in [False, True]:
                    fields: dict[str, object] = {"model": model, "text": items("Hi") if live else "Hi"}
                    fields.update({"voice_blend": [{"voice": "one", "weight": 75}, {"voice": "two", "weight": 100}]} if blended else {"voice": "custom"})
                    transport, socket = Transport(success()), Socket()
                    async with synthesize(cast(TtsRequest, fields), auth=AUTH, transport=transport, web_socket=socket if live else None) as audio:
                        _ = [item async for item in audio]
                    wire = socket.sent[0] if live else json.loads(transport.requests[0].body)
                    self.assertEqual(wire["model"], model)
                    self.assertEqual("continuous_sound" in wire, live and model.startswith("speech-2.8"))
                    voice = cast(dict[str, object], wire["voice_setting"])
                    self.assertEqual(voice["voice_id"], "" if blended else "custom")
                    self.assertEqual("timbre_weights" in wire, blended)

    async def test_normalization_formula_effects_and_presence(self) -> None:
        request: TtsRequest = {"text": "$$1+1$$", "voice_blend": [{"voice": "one", "weight": 100}], "formula_reading": "latex",
                              "voice_transform": {"brightness": 0, "softness": -100, "crispness": 100, "effect": "telephone"},
                              "pitch_bias": 0, "replacements": [{"pattern": "Acme", "replacement": "Ack me"}], "text_normalization": False}
        transport = Transport(success())
        async with synthesize(request, auth=AUTH, transport=transport) as audio: _ = [item async for item in audio]
        wire = json.loads(transport.requests[0].body)
        self.assertEqual(wire["language_boost"], "Chinese")
        self.assertEqual(wire["voice_modify"], {"pitch": 0, "intensity": -100, "timbre": 100, "sound_effects": "lofi_telephone"})
        self.assertEqual(wire["pronunciation_dict"], {"tone": ["Acme/Ack me"]})
        self.assertEqual(wire["voice_setting"], {"voice_id": "", "speed": 1, "vol": 1, "pitch": 0, "latex_read": True, "text_normalization": False})

    async def test_sse_early_audio_trailing_subtitles_and_cleanup(self) -> None:
        packets = event({"data": {"status": 1, "audio": "00ff"}}) + event({
            "data": {"status": 2, "subtitle_file": "https://files.invalid/subtitle?signature=one"}, "trace_id": "trace", "extra_info": FIXTURE["usage"]})
        body = Source([bytes([b]) for b in packets], stall=True)
        transport = Transport(HttpResponse(200, {"Content-Type": "text/event-stream; charset=utf-8"}, body), response(FIXTURE["subtitles"]))
        async with synthesize({"voice": "voice", "text": "Hi", "timestamp_granularity": "word"}, auth=AUTH, transport=transport) as audio:
            self.assertEqual(await anext(audio), {"correlation": "timeline", "audio": b"\x00\xff", "timestamps": []})
            self.assertLess(body.reads, len(packets))
            self.assertEqual(await anext(audio), {"correlation": "timeline", "trace_id": "trace", "timestamps": snake(FIXTURE["timestamps"])})
            self.assertEqual(body.closes, 1)
            self.assertEqual(await anext(audio), {"event": "done", "trace_id": "trace", "usage": snake(FIXTURE["normalizedUsage"])})
            self.assertEqual([item async for item in audio], [])
        self.assertEqual(transport.requests[1], HttpRequest("GET", "https://files.invalid/subtitle?signature=one", {}, b""))

    async def test_clear_flush_boundaries_and_native_identity(self) -> None:
        socket = Socket()
        def respond(value: dict[str, object]) -> None:
            if value["event"] == "task_continue" and value["text"] == "New":
                socket.push({"event": "sentence_start", "trace_id": "request"})
                socket.push({"data": {"audio": "01"}, "is_final": True, "trace_id": "request"})
                socket.push({"event": "sentence_end", "trace_id": "request"})
            if value["event"] == "task_cancel":
                socket.push({"data": {"audio": "dead"}})
                socket.push({"event": "task_flushed"})
                socket.push({"event": "task_canceled"})
            if value["event"] == "task_finish": socket.push({"event": "task_finished"})
        socket.on_send = respond
        async with synthesize({"voice": "voice", "text": items("Old", {"command": "flush"}, {"command": "clear"}, "New")}, web_socket=socket) as audio:
            actual = [item async for item in audio]
        group: dict[str, object] = {"correlation": "ordered", "input_group_id": socket.session, "correlation_id": "request", "trace_id": "request", "timestamps": []}
        self.assertEqual(actual, [{"event": "clear"}, {**group, "sentence_boundary": "start"},
                         {**group, "audio": b"\x01", "request_complete": True}, {**group, "sentence_boundary": "end"}, {"event": "done"}])
        self.assertEqual(socket.sent[1:], [{"event": "task_continue", "text": "Old"}, {"event": "task_flush"}, {"event": "task_cancel"},
                         {"event": "task_continue", "text": "New"}, {"event": "task_finish"}])
        self.assertEqual(socket.closes, 1)

    async def test_whitespace_and_flush_acknowledgement(self) -> None:
        socket = Socket()
        async with synthesize({"voice": "voice", "text": items("Hello", " ", "\n", "world", " ", {"command": "flush"})}, web_socket=socket) as audio:
            actual = [item async for item in audio]
        self.assertEqual(socket.sent[1:], [{"event": "task_continue", "text": "Hello"}, {"event": "task_continue", "text": " \nworld"},
                         {"event": "task_flush"}, {"event": "task_finish"}])
        self.assertEqual(actual[-2:], [{"event": "flush", "correlation_id": "flush", "input_group_id": socket.session}, {"event": "done"}])

    async def test_utf16_piece_limits_and_surrogate_safe_splitting(self) -> None:
        for values, expected in [
            (["x" * 10000], "MiniMax text pieces must contain fewer than 10000 UTF-16 code units"),
            (["😀" * 5000], "MiniMax text pieces must contain fewer than 10000 UTF-16 code units"),
            ([" " * 9999, " x"], "MiniMax pending whitespace exceeds a native message"),
        ]:
            socket = Socket()
            with self.assertRaises(TypeError) as error:
                async with synthesize({"voice": "voice", "text": items(*values)}, web_socket=socket) as audio: _ = [item async for item in audio]
            self.assertEqual(str(error.exception), expected)
            self.assertEqual(socket.closes, 1)
        socket = Socket()
        async with synthesize({"voice": "voice", "text": items(" ", "x" * 9997 + "😀")}, web_socket=socket) as audio: _ = [item async for item in audio]
        self.assertEqual(socket.sent[1:], [{"event": "task_continue", "text": " " + "x" * 9997}, {"event": "task_continue", "text": "😀"}, {"event": "task_finish"}])

    async def test_schema_validation_and_override_restrictions(self) -> None:
        cases: list[dict[str, object]] = [
            {"volume_scale": 0}, {"pitch_bias": 0.5}, {"voice_transform": {"softness": 0.5}},
            {"voice": None, "voice_blend": []}, {"model": "speech-2.8-hd", "emotion": "whisper"},
            {"model": "speech-02-hd", "language": "fa"}, {"formula_reading": "latex", "language": "en"},
            {"text": items("Hi"), "timestamp_granularity": "word"}, {"text": items("Hi"), "output": {"format": "wav"}},
        ]
        for fields in cases:
            request = cast(TtsRequest, {"voice": "voice", "text": "Hi", **fields})
            with self.assertRaises(TypeError) as expected:
                validate_request(request)
            with self.assertRaises(TypeError) as error:
                async with synthesize(request): pass
            self.assertEqual(error.exception.args, expected.exception.args)
        for fields in [{"text_normalization": True}, {"output": {"format": "wav"}}, {"timestamp_granularity": "word"}]:
            socket = Socket()
            request = cast(TtsRequest, {"voice": "voice", "text": "Hi", **fields})
            with self.assertRaises(TypeError) as expected:
                validate_request({**request, "text": items()})
            with self.assertRaises(TypeError) as error:
                async with synthesize(request, web_socket=socket): pass
            self.assertEqual(error.exception.args, expected.exception.args)
            self.assertEqual(socket.sent, [])

    async def test_http_errors_bounds_and_transport_error_identity(self) -> None:
        for status in [307, 429]:
            body = Source([b"<html>gateway</html>"])
            transport = Transport(HttpResponse(status, {"Retry-After": "2"}, body))
            with self.assertRaises(MiniMaxError) as error:
                async with synthesize({"voice": "voice", "text": "Hi"}, auth=AUTH, transport=transport) as audio:
                    _ = [item async for item in audio]
            self.assertEqual((str(error.exception), error.exception.code, error.exception.status_code, error.exception.retry_after), (f"MiniMax HTTP {status}", None, status, "2"))
            self.assertEqual(body.closes, 1)
        body = Source([b"x" * 5])
        with self.assertRaises(TypeError) as error:
            async with synthesize({"voice": "voice", "text": "Hi"}, auth=AUTH, transport=Transport(HttpResponse(200, {}, body)), max_json_bytes=4) as audio:
                _ = [item async for item in audio]
        self.assertEqual(str(error.exception), "MiniMax response exceeds max_json_bytes")
        self.assertEqual(body.closes, 1)
        sentinel = RuntimeError("body read")
        body = Source[bytes]([], error=sentinel)
        with self.assertRaises(RuntimeError) as error:
            async with synthesize({"voice": "voice", "text": "Hi"}, auth=AUTH, transport=Transport(HttpResponse(200, {}, body))) as audio:
                _ = [item async for item in audio]
        self.assertIs(error.exception, sentinel)
        self.assertEqual(body.closes, 1)

    async def test_socket_protocol_failures_and_native_error_codes(self) -> None:
        cases: list[tuple[dict[str, object], str]] = [
            ({"event": "task_finished"}, "MiniMax ended the session before task_finish"),
            ({"event": "task_canceled"}, "MiniMax returned an unsolicited cancel acknowledgement"),
            ({"session_id": "other", "data": {"audio": "00"}}, "MiniMax returned an unexpected session ID"),
            ({"connect_id": "other", "data": {"audio": "00"}}, "MiniMax returned an unexpected connection ID"),
        ]
        for packet, expected in cases:
            socket = Socket()
            socket.on_send = lambda value: socket.push(packet) if value["event"] == "task_continue" else None
            source = Source[TtsInput](["Hi"], stall=True)
            with self.assertRaises(TypeError) as error:
                async with synthesize({"voice": "voice", "text": source}, web_socket=socket) as audio: _ = [item async for item in audio]
            self.assertEqual(str(error.exception), expected)
            await asyncio.wait_for(source.closed.wait(), 1)
            self.assertEqual((socket.closes, source.closes), (1, 1))
        for code in [2204, 2205]:
            socket = Socket()
            socket.on_send = lambda value: socket.push({"base_resp": {"status_code": code, "status_msg": "queue"}, "data": None, "extra_info": "unavailable"}) if value["event"] == "task_continue" else None
            with self.assertRaises(MiniMaxError) as error:
                async with synthesize({"voice": "voice", "text": Source[TtsInput](["Hi"], stall=True)}, web_socket=socket) as audio: _ = [item async for item in audio]
            self.assertEqual((str(error.exception), error.exception.code, error.exception.status_code), ("queue", code, None))

    async def test_cancel_and_unread_socket_close(self) -> None:
        socket = Socket()
        async with synthesize({"voice": "voice", "text": items("Hi")}, web_socket=socket): pass
        self.assertEqual((socket.closes, socket.sent), (1, []))
        socket = Socket()
        source = Source[TtsInput]([], stall=True)
        async def consume() -> None:
            async with synthesize({"voice": "voice", "text": source}, web_socket=socket) as audio: _ = [item async for item in audio]
        task = asyncio.create_task(consume())
        await asyncio.wait_for(source.waiting.wait(), 1)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError): await task
        await asyncio.wait_for(source.closed.wait(), 1)
        self.assertEqual(socket.sent[-1], {"event": "task_cancel"})
        self.assertEqual((socket.closes, source.closes), (1, 1))

    async def test_native_authenticated_socket_and_rejected_handshake(self) -> None:
        captured: list[tuple[bytes, dict[bytes, bytes]]] = []
        closed = asyncio.Event()
        async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            captured.append(await upgrade(reader, writer))
            def write(packet: object) -> None:
                data = json.dumps(packet).encode()
                writer.write(b"\x81" + (bytes([len(data)]) if len(data) < 126 else b"\x7e" + struct.pack("!H", len(data))) + data)
            write({"event": "connected_success", "connect_id": "connection"})
            await writer.drain()
            session = ""
            while True:
                opcode, data = await client_frame(reader)
                if opcode == 8: break
                self.assertEqual(opcode, 1)
                packet = json.loads(data)
                if packet["event"] == "task_start":
                    session = packet["session_id"]
                    write({"event": "task_started", "session_id": session})
                if packet["event"] == "task_continue":
                    write({"session_id": session, "data": {"audio": "00ff80"}, "trace_id": "trace"})
                if packet["event"] == "task_finish": write({"event": "task_finished", "session_id": session})
                await writer.drain()
            closed.set()
        async with server(handle) as endpoint:
            async with synthesize({"voice": "voice", "text": items("Hi")}, auth=AUTH,
                                  base_url=endpoint.replace("ws:", "http:") + "/proxy%2Fpath/?tenant=one") as audio:
                actual = [item async for item in audio]
            await closed.wait()
        self.assertEqual(captured[0][0], b"GET /proxy%2Fpath/ws/v1/t2a_v2_bidi?tenant=one HTTP/1.1")
        self.assertEqual(captured[0][1][b"authorization"], b"Bearer test-key")
        self.assertEqual(captured[0][1].get(b"sec-websocket-protocol"), None)
        self.assertEqual(len(actual), 2)
        self.assertEqual(actual[-1], {"event": "done"})
        source = Source[TtsInput](["Hi"])
        async def reject(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            await reader.readuntil(b"\r\n\r\n")
            writer.write(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n")
            await writer.drain()
        async with server(reject) as endpoint:
            with self.assertRaises(WebSocketError):
                async with synthesize({"voice": "voice", "text": source}, auth=AUTH, web_socket_url=endpoint): pass
        self.assertEqual((source.reads, source.closes), (0, 0))

    async def test_cancel_releases_stubborn_producer_and_writer(self) -> None:
        for lane in ["producer", "writer"]:
            release, waiting = asyncio.Event(), asyncio.Event()
            class Stubborn(Source[TtsInput]):
                async def __anext__(self) -> TtsInput:
                    waiting.set()
                    while not release.is_set():
                        try: await release.wait()
                        except asyncio.CancelledError: pass
                    return "late"
            class StubbornSocket(Socket):
                async def send(self, message: str | bytes) -> None:
                    packet = json.loads(message)
                    if packet["event"] in ("task_continue", "task_cancel"):
                        waiting.set()
                        while not release.is_set():
                            try: await release.wait()
                            except asyncio.CancelledError: pass
                    await super().send(message)
            source = Stubborn([]) if lane == "producer" else Source[TtsInput](["Hi"], stall=True)
            socket = Socket() if lane == "producer" else StubbornSocket()
            async def consume() -> None:
                async with synthesize({"voice": "voice", "text": source}, web_socket=socket) as audio: _ = [item async for item in audio]
            task = asyncio.create_task(consume())
            try:
                await asyncio.wait_for(waiting.wait(), 1)
                task.cancel()
                with self.assertRaises(asyncio.CancelledError): await asyncio.wait_for(task, 1)
                self.assertEqual(socket.closes, 1)
            finally:
                release.set()
                await asyncio.wait_for(source.closed.wait(), 1)
            self.assertEqual(source.closes, 1)

    async def test_error_while_clearing_and_pending_final_write(self) -> None:
        sentinel = RuntimeError("producer")
        source = Source[TtsInput]([{"command": "clear"}], error=sentinel)
        socket = Socket()
        socket.on_send = lambda _: None
        with self.assertRaises(RuntimeError) as error:
            async with synthesize({"voice": "voice", "text": source}, web_socket=socket) as audio: _ = [item async for item in audio]
        self.assertIs(error.exception, sentinel)
        await asyncio.wait_for(source.closed.wait(), 1)
        self.assertEqual(socket.closes, 1)
        sentinel = RuntimeError("final write")
        class LateFailure(Socket):
            async def send(self, message: str | bytes) -> None:
                await super().send(message)
                if json.loads(message)["event"] == "task_finish":
                    await asyncio.sleep(0)
                    raise sentinel
        socket = LateFailure()
        with self.assertRaises(RuntimeError) as error:
            async with synthesize({"voice": "voice", "text": items()}, web_socket=socket) as audio: _ = [item async for item in audio]
        self.assertIs(error.exception, sentinel)
        self.assertEqual(socket.closes, 1)

    async def test_body_and_subtitle_cancellation_and_forbidden_urls(self) -> None:
        for subtitle in [False, True]:
            body = Source[bytes]([], stall=True)
            transport = Transport(*([response({"data": {"audio": "00", "status": 2, "subtitle_file": "https://files.invalid/path/"}})] if subtitle else []),
                                  HttpResponse(200, {}, body))
            async def consume() -> None:
                async with synthesize({"voice": "voice", "text": "Hi", "timestamp_granularity": "word"}, auth=AUTH, transport=transport) as audio: _ = [item async for item in audio]
            task = asyncio.create_task(consume())
            await asyncio.wait_for(body.waiting.wait(), 1)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError): await task
            self.assertEqual(body.closes, 1)
            if subtitle:
                self.assertEqual(transport.requests[-1], HttpRequest("GET", "https://files.invalid/path/", {}, b""))
        for url in ["ftp://files.invalid/a", "https://user:pass@files.invalid/a", "https://files.invalid/%xx", "https://files.invalid/a#fragment"]:
            transport = Transport(response({"data": {"audio": "00", "status": 2, "subtitle_file": url}}))
            with self.assertRaises(TypeError) as error:
                async with synthesize({"voice": "voice", "text": "Hi", "timestamp_granularity": "word"}, auth=AUTH, transport=transport) as audio: _ = [item async for item in audio]
            self.assertEqual(str(error.exception), "Invalid MiniMax endpoint URL")
            self.assertEqual(len(transport.requests), 1)

    async def test_malformed_packets_and_premature_http_eof(self) -> None:
        cases: list[tuple[object, str]] = [
            (None, "MiniMax returned an invalid response object"),
            ({"base_resp": {"status_code": True}}, "MiniMax returned invalid base_resp.status_code"),
            ({"data": {"status": True}}, "MiniMax returned invalid data.status"),
            ({"is_final": "true"}, "MiniMax returned invalid is_final"),
            ({"extra_info": {"audio_length": 0.5}}, "MiniMax returned invalid audio_length"),
            ({"extra_info": {"invisible_character_ratio": 2}}, "MiniMax returned invalid invisible_character_ratio"),
            ({"data": {"status": 1, "audio": "00"}}, "MiniMax JSON synthesis did not report completion"),
            ({"data": {"status": 2}}, "MiniMax returned no audio"),
        ]
        cases.extend(({"data": {"audio": value}}, "MiniMax returned invalid hex audio") for value in ["0", "001", "0g", "0x01", "AA BB", "AA\n", "ＡＡ", "AQI="])
        for packet, expected in cases:
            with self.assertRaises(TypeError) as error:
                async with synthesize({"voice": "voice", "text": "Hi"}, auth=AUTH, transport=Transport(response(packet))) as audio: _ = [item async for item in audio]
            self.assertEqual(str(error.exception), expected)
        for data in [b"", b"data: [DONE]\n\n", event({"data": {"status": 1, "audio": "00"}})]:
            body = Source([data])
            with self.assertRaises(TypeError) as error:
                async with synthesize({"voice": "voice", "text": "Hi"}, auth=AUTH, transport=Transport(HttpResponse(200, {"content-type": "text/event-stream"}, body))) as audio: _ = [item async for item in audio]
            self.assertEqual(str(error.exception), "MiniMax HTTP stream ended before completion")
            self.assertEqual(body.closes, 1)

    async def test_environment_precedence_and_deadline(self) -> None:
        with patch.dict(os.environ, {"SPEECHSWITCH_MINIMAX_API_KEY": "scoped", "MINIMAX_API_KEY": "legacy"}):
            for auth, key in [(None, "scoped"), (AUTH, "test-key")]:
                transport = Transport(success())
                async with synthesize({"voice": "voice", "text": "Hi"}, auth=auth, transport=transport) as audio: _ = [item async for item in audio]
                self.assertEqual(transport.requests[0].headers["Authorization"], "Bearer " + key)
            with self.assertRaises(TypeError) as error:
                async with synthesize({"voice": "voice", "text": "Hi"}, auth={"minimax": {"api_key": ""}}): pass
            self.assertEqual(str(error.exception), "Missing auth.minimax.apiKey configuration")
        socket = Socket()
        source = Source[TtsInput]([], stall=True)
        with self.assertRaises(TimeoutError) as error:
            async with synthesize({"voice": "voice", "text": source}, web_socket=socket, timeout_ms=10) as audio: _ = [item async for item in audio]
        self.assertEqual(str(error.exception), "MiniMax synthesis deadline expired")
        await asyncio.wait_for(source.closed.wait(), 1)
        self.assertEqual(socket.closes, 1)


if __name__ == "__main__":
    unittest.main()
