import asyncio
import json
import os
import unittest
from collections.abc import AsyncIterable, AsyncIterator, Awaitable, Callable
from pathlib import Path
from typing import NotRequired, TypedDict, cast
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from speechswitch.generated.cartesia import TtsRequest, TtsRequestStreamingTextVoice0bf53a99TextItem as InputItem
from speechswitch.generated.cartesia_output import SynthesisItem
from speechswitch.generated.auth import Auth
from speechswitch.generated.validators.cartesia import validate_request
from speechswitch.http import HttpRequest, HttpResponse
from speechswitch.providers.cartesia import CartesiaError, synthesize
from speechswitch.validation import is_mapping, is_sequence
from test_websocket import client_frame, server, upgrade


def request(text: str | AsyncIterable[InputItem] = "Hello") -> TtsRequest:
    if isinstance(text, str):
        return {"text": text, "voice": "saved-custom", "model": "sonic-3.5", "output": {"format": "pcm", "sample_rate_hz": 24000, "sample_encoding": "signed_integer_16", "byte_order": "little_endian"}}
    return {"text": text, "voice": "saved-custom", "model": "sonic-3.5", "output": {"format": "pcm", "sample_rate_hz": 24000, "sample_encoding": "signed_integer_16", "byte_order": "little_endian"}}


def canonical(value: object) -> object:
    names = {"correlation_id": "correlationId", "input_group_id": "inputGroupId", "start_time_ms": "startTimeMs", "end_time_ms": "endTimeMs"}
    if isinstance(value, bytes):
        return list(value)
    if is_mapping(value):
        return {names.get(key, key) if isinstance(key, str) else key: canonical(item) for key, item in value.items()}
    if is_sequence(value):
        return [canonical(item) for item in value]
    return value


class Body:
    def __init__(self, chunks: list[bytes], stall: bool = False) -> None:
        self.chunks = list(chunks)
        self.stall = stall
        self.reads = self.closes = 0
        self.waiting = asyncio.Event()
    def __aiter__(self) -> AsyncIterator[bytes]:
        return self
    async def __anext__(self) -> bytes:
        self.reads += 1
        if self.chunks:
            return self.chunks.pop(0)
        if self.stall:
            self.waiting.set()
            await asyncio.Future[None]()
        raise StopAsyncIteration
    async def aclose(self) -> None:
        self.closes += 1


class Transport:
    def __init__(self, body: Body, status: int = 200) -> None:
        self.body, self.status = body, status
        self.requests: list[HttpRequest] = []
    async def send(self, request: HttpRequest) -> HttpResponse:
        self.requests.append(request)
        return HttpResponse(self.status, {}, self.body)


class Input:
    def __init__(self, values: list[InputItem], stall: bool = False, trace: list[str] | None = None) -> None:
        self.values = list(values)
        self.stall = stall
        self.acquired = self.reads = self.closes = self.cancelled = 0
        self.waiting = asyncio.Event()
        self.trace = trace
    def __aiter__(self) -> AsyncIterator[InputItem]:
        self.acquired += 1
        return self
    async def __anext__(self) -> InputItem:
        self.reads += 1
        if self.values:
            return self.values.pop(0)
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
        self.closes = 0
        self.closed = False
        self.trace = trace
        self.on_send: Callable[[dict[str, object]], Awaitable[None]] | None = None
    def put(self, context: object, value: dict[str, object]) -> None:
        self.incoming.put_nowait(json.dumps({"status_code": 200, "done": False, "context_id": context, **value}))
    async def send(self, message: str | bytes) -> None:
        assert isinstance(message, str)
        if self.closed:
            raise AssertionError("late send")
        wire: dict[str, object] = json.loads(message)
        self.sent.append(wire)
        if self.on_send is not None:
            await self.on_send(wire)
        elif wire.get("continue") is False:
            self.put(wire["context_id"], {"type": "done", "done": True})
        elif wire.get("flush") is True:
            self.put(wire["context_id"], {"type": "flush_done", "flush_done": True, "done": True, "flush_id": 1})
        elif wire.get("transcript"):
            self.put(wire["context_id"], {"type": "chunk", "data": "AP8="})
    async def receive(self) -> str | bytes:
        value = await self.incoming.get()
        if isinstance(value, BaseException):
            raise value
        return value
    async def aclose(self) -> None:
        if not self.closed:
            self.closed = True
            self.closes += 1
            if self.trace is not None:
                self.trace.append("socket")


class CartesiaTests(unittest.IsolatedAsyncioTestCase):
    async def test_shared_sse_fixtures_at_every_byte_split(self) -> None:
        class Fixture(TypedDict):
            name: str
            frames: list[dict[str, object]]
            items: list[object]
            error: NotRequired[str]
        fixtures: list[Fixture] = json.loads((Path(__file__).resolve().parents[2] / "fixtures/cartesia.json").read_text())
        for fixture in fixtures:
            data = "".join("data: " + json.dumps(frame, ensure_ascii=False) + "\n\n" for frame in fixture["frames"]).encode()
            for split in range(len(data) + 1):
                body = Body([data[:split], data[split:]])
                items: list[object] = []
                failure: str | None = None
                value = cast(TtsRequest, {**request(), "timestamp_granularity": ["word", "phoneme"]})
                try:
                    with patch("speechswitch.providers.cartesia.uuid.uuid4", return_value="context"):
                        async with synthesize(value, transport=Transport(body), auth={"cartesia": {"api_key": "key"}}) as stream:
                            async for item in stream:
                                items.append(canonical(item))
                except (TypeError, CartesiaError) as error:
                    failure = str(error)
                self.assertEqual((items, failure), (fixture["items"], fixture.get("error")), f"{fixture['name']} split {split}")
                self.assertEqual(body.closes, 1)

    async def test_http_models_formats_independent_controls_and_ownership(self) -> None:
        formats: list[tuple[dict[str, object], dict[str, object]]] = [
            ({"format": "mp3", "sample_rate_hz": 44100, "bit_rate_bps": 128000}, {"container": "mp3", "sample_rate": 44100, "bit_rate": 128000}),
            ({"format": "pcm", "sample_rate_hz": 24000, "sample_encoding": "float_32", "byte_order": "little_endian"}, {"container": "raw", "sample_rate": 24000, "encoding": "pcm_f32le"}),
            ({"format": "mulaw", "sample_rate_hz": 8000}, {"container": "raw", "sample_rate": 8000, "encoding": "pcm_mulaw"}),
            ({"format": "alaw", "sample_rate_hz": 8000}, {"container": "raw", "sample_rate": 8000, "encoding": "pcm_alaw"}),
        ]
        for encoding, native in [("signed_integer_16", "pcm_s16le"), ("float_32", "pcm_f32le"), ("mulaw", "pcm_mulaw"), ("alaw", "pcm_alaw")]:
            formats.append(({"format": "wav", "sample_rate_hz": 48000, "sample_encoding": encoding}, {"container": "wav", "sample_rate": 48000, "encoding": native}))
        for model in ["sonic-3", "sonic-3.5", "sonic-3.6"]:
            for output, encoded in formats:
                value = cast(TtsRequest, {**request(), "model": model, "language": "en-GB" if model == "sonic-3.6" else "en", "output": output,
                                         "accent": "fr", "text_normalization": {"locale": "en-IN"}, "speed": 0.6, "volume_scale": 0.5, "emotion": "nostalgic", "lexicon": "dictionary"})
                body = Body([b"\0\xff", b"later"])
                transport = Transport(body)
                async with synthesize(value, transport=transport, auth={"cartesia": {"access_token": "token"}}, base_url="https://proxy.test/prefix%20path/?keep=1") as stream:
                    self.assertEqual(body.reads, 0)
                    self.assertEqual(await anext(stream), b"\0\xff")
                    self.assertEqual(body.reads, 1)
                self.assertEqual(body.closes, 1)
                wire = transport.requests[0]
                self.assertEqual((wire.method, wire.url, wire.headers), ("POST", "https://proxy.test/prefix%20path/tts/bytes?keep=1", {"authorization": "Bearer token", "cartesia-version": "2026-08-14", "content-type": "application/json"}))
                self.assertEqual(json.loads(wire.body), {"model_id": model, "voice": "saved-custom", "transcript": "Hello", "output_format": encoded,
                    "generation_config": {"speed": 0.6, "volume": 0.5, "emotion": "nostalgic"}, "locale" if model == "sonic-3.6" else "language": "en-GB" if model == "sonic-3.6" else "en",
                    "accent": "fr", "normalization": "en-IN", "pronunciation_dict_id": "dictionary"})

    async def test_http_errors_and_json_limits(self) -> None:
        for code in [None, "future_code"]:
            body = Body([json.dumps({"error_code": code, "title": "Quota", "message": "exhausted", "request_id": "req", "doc_url": "docs"}).encode()])
            with self.assertRaises(CartesiaError) as caught:
                async with synthesize(request(), transport=Transport(body, 429), auth={"cartesia": {"api_key": "key"}}):
                    self.fail("failed HTTP opened")
            error = caught.exception
            self.assertEqual((str(error), error.status_code, error.error_code, error.request_id, error.doc_url, error.context_id), ("Cartesia 429: Quota: exhausted", 429, code, "req", "docs", None))
            self.assertEqual(body.closes, 1)
        for data, limit, expected in [(b"unavailable", 100, "Cartesia 502: Request failed: unavailable"), (b"large", 4, "Cartesia response exceeds max_json_bytes")]:
            body = Body([data])
            try:
                async with synthesize(request(), transport=Transport(body, 502), auth={"cartesia": {"api_key": "key"}}, max_json_bytes=limit):
                    self.fail("failed response opened")
            except (TypeError, CartesiaError) as error:
                self.assertEqual(str(error), expected)
            self.assertEqual(body.closes, 1)

    async def test_live_clear_flush_late_retired_packets_and_verbatim_text(self) -> None:
        text = Input(["before ", {"command": "flush"}, {"command": "clear"}, " after"])
        socket = Socket()
        async def send(wire: dict[str, object]) -> None:
            context = wire["context_id"]
            if wire.get("cancel") is True:
                socket.put(context, {"type": "chunk", "data": "////"})
                socket.put(context, {"type": "timestamps", "word_timestamps": {"words": ["old"], "start": [0], "end": [1]}})
                socket.put(context, {"type": "error", "status_code": 500, "message": "old error"})
                socket.put(context, {"type": "done", "done": True})
            elif wire.get("flush") is True:
                socket.put(context, {"type": "flush_done", "flush_done": True, "done": True, "flush_id": 1})
            elif wire.get("continue") is False:
                socket.put(context, {"type": "timestamps", "word_timestamps": {"words": ["after"], "start": [0.5], "end": [1]}, "flush_id": 2})
                socket.put(context, {"type": "done", "done": True})
            else:
                socket.put(context, {"type": "chunk", "data": "AQ==" if wire["transcript"] == "before " else "Ag==", "flush_id": 1 if wire["transcript"] == "before " else 2})
        socket.on_send = send
        value = cast(TtsRequest, {**request(text), "timestamp_granularity": ["word", "phoneme"], "timestamp_text": "normalized", "max_buffer_delay_ms": 0, "text_normalization": False})
        async with synthesize(value, web_socket=socket) as stream:
            items = [canonical(item) async for item in stream]
        first, second = socket.sent[0]["context_id"], socket.sent[-1]["context_id"]
        self.assertNotEqual(first, second)
        self.assertEqual(items, [
            {"correlation": "timeline", "correlationId": first, "inputGroupId": "1", "audio": [1], "timestamps": []},
            {"event": "flush", "correlationId": first, "inputGroupId": "1"}, {"event": "clear"},
            {"correlation": "timeline", "correlationId": second, "inputGroupId": "2", "audio": [2], "timestamps": []},
            {"correlation": "timeline", "correlationId": second, "inputGroupId": "2", "timestamps": [{"kind": "word", "value": "after", "startTimeMs": 500, "endTimeMs": 1000}]},
        ])
        self.assertEqual(socket.sent[2], {"context_id": first, "cancel": True})
        self.assertEqual([(wire.get("transcript"), wire.get("continue"), wire.get("flush")) for wire in socket.sent], [("before ", True, False), ("", True, True), (None, None, None), (" after", True, False), ("", False, False)])
        self.assertEqual({key: value for key, value in socket.sent[0].items() if key not in ("context_id", "transcript", "continue", "flush")}, {
            "model_id": "sonic-3.5", "voice": "saved-custom", "output_format": {"container": "raw", "sample_rate": 24000, "encoding": "pcm_s16le"}, "generation_config": {},
            "normalization": "off", "add_timestamps": True, "add_phoneme_timestamps": True, "use_normalized_timestamps": True, "max_buffer_delay_ms": 0,
        })
        self.assertEqual((text.closes, socket.closes), (1, 1))

    async def test_audio_continues_during_backpressured_send_without_input_prefetch(self) -> None:
        trace: list[str] = []
        text, socket = Input(["first", "later"], trace=trace), Socket(trace)
        blocked = asyncio.Event()
        async def send(wire: dict[str, object]) -> None:
            socket.put(wire["context_id"], {"type": "chunk", "data": "AQ=="})
            await blocked.wait()
        socket.on_send = send
        async with synthesize(request(text), web_socket=socket) as stream:
            self.assertEqual(await anext(stream), b"\1")
            self.assertEqual(text.reads, 1)
            socket.put(socket.sent[0]["context_id"], {"type": "chunk", "data": "Ag=="})
            self.assertEqual(await anext(stream), b"\2")
            self.assertEqual((text.reads, len(socket.sent)), (1, 1))
        self.assertEqual(trace, ["socket", "input"])

    async def test_queued_audio_cannot_starve_clear_or_a_failed_write(self) -> None:
        for failed_write in [False, True]:
            original = RuntimeError("write failure")
            text, socket = Input(["before", {"command": "clear"}]), Socket()
            async def send(wire: dict[str, object]) -> None:
                if wire.get("transcript"):
                    for _ in range(100):
                        socket.put(wire["context_id"], {"type": "chunk", "data": "AQ=="})
                    if failed_write:
                        raise original
            socket.on_send = send
            items: list[SynthesisItem] = []
            try:
                async with synthesize(request(text), web_socket=socket) as stream:
                    async for item in stream:
                        items.append(item)
            except RuntimeError as error:
                self.assertIs(error, original)
            self.assertEqual(items, [b"\1"] if failed_write else [b"\1", b"\1", {"event": "clear"}])
            self.assertEqual((text.closes, socket.closes), (1, 1))

    async def test_observed_done_rotates_context_and_flush_ids_survive_without_timing(self) -> None:
        text, socket = Input(["first", "second"]), Socket()
        async def send(wire: dict[str, object]) -> None:
            socket.put(wire["context_id"], {"type": "chunk", "data": "AQ==", "flush_id": 0})
            socket.put(wire["context_id"], {"type": "done", "done": True})
        socket.on_send = send
        async with synthesize(request(text), web_socket=socket) as stream:
            items = [item async for item in stream]
        self.assertEqual(len(socket.sent), 2)
        self.assertNotEqual(socket.sent[0]["context_id"], socket.sent[1]["context_id"])
        self.assertEqual([canonical(item) for item in items], [{"correlation": "timeline", "correlationId": wire["context_id"], "inputGroupId": "0", "audio": [1], "timestamps": []} for wire in socket.sent])

    async def test_empty_input_flush_clear_and_unread_stream_cleanup(self) -> None:
        for unread in [False, True]:
            text, socket = Input(["", {"command": "flush"}, {"command": "clear"}]), Socket()
            async with synthesize(request(text), web_socket=socket) as stream:
                if not unread:
                    self.assertEqual([item async for item in stream], [{"event": "clear"}])
            self.assertEqual((socket.sent, socket.closes, text.acquired, text.closes), ([], 1, 0 if unread else 1, 0 if unread else 1))

    async def test_deadlines_cover_response_input_and_token_exchange(self) -> None:
        body = Body([], stall=True)
        with self.assertRaises(TimeoutError) as caught:
            async with synthesize(request(), transport=Transport(body), auth={"cartesia": {"api_key": "key"}}, timeout_ms=20) as stream:
                await anext(stream)
        self.assertEqual(str(caught.exception), "Cartesia synthesis deadline expired")
        self.assertEqual(body.closes, 1)
        text, socket = Input([], stall=True), Socket()
        with self.assertRaises(TimeoutError) as caught:
            async with synthesize(request(text), web_socket=socket, timeout_ms=20) as stream:
                await anext(stream)
        self.assertEqual(str(caught.exception), "Cartesia synthesis deadline expired")
        self.assertEqual((text.cancelled, text.closes, socket.closes), (1, 1, 1))
        token = Body([], stall=True)
        text = Input(["unread"])
        with self.assertRaises(TimeoutError) as caught:
            async with synthesize(request(text), transport=Transport(token), auth={"cartesia": {"api_key": "key"}}, timeout_ms=20):
                self.fail("token wait completed")
        self.assertEqual(str(caught.exception), "Cartesia synthesis deadline expired")
        self.assertEqual((token.closes, text.acquired), (1, 0))

    async def test_operation_options_and_wire_limits(self) -> None:
        invalid: list[tuple[int | None, int, int, int, str]] = [
            (-1, 1000, 1000, 1000, "Cartesia timeout_ms must be an integer between 0 and 2147483647"),
            (2147483648, 1000, 1000, 1000, "Cartesia timeout_ms must be an integer between 0 and 2147483647"),
            (True, 1000, 1000, 1000, "Cartesia timeout_ms must be an integer between 0 and 2147483647"),
            (None, 0, 1000, 1000, "Cartesia max_message_bytes must be a positive integer"),
            (None, 1000, -1, 1000, "Cartesia max_event_bytes must be a positive integer"),
            (None, 1000, 1000, True, "Cartesia max_json_bytes must be a positive integer"),
        ]
        for timeout, message, event, limit, expected in invalid:
            text, socket = Input(["unread"]), Socket()
            with self.assertRaises(TypeError) as caught:
                async with synthesize(request(text), web_socket=socket, timeout_ms=timeout, max_message_bytes=message, max_event_bytes=event, max_json_bytes=limit):
                    self.fail("invalid operation options accepted")
            self.assertEqual(str(caught.exception), expected)
            self.assertEqual((text.acquired, socket.sent, socket.closes), (0, [], 0))
        text, socket = Input(["unread"]), Socket()
        with self.assertRaises(TimeoutError) as caught:
            async with synthesize(request(text), web_socket=socket, timeout_ms=0):
                self.fail("zero deadline opened a stream")
        self.assertEqual(str(caught.exception), "Cartesia synthesis deadline expired")
        self.assertEqual((text.acquired, socket.sent, socket.closes), (0, [], 0))
        for outgoing in [True, False]:
            text, socket = Input(["hello"]), Socket()
            async def send(wire: dict[str, object]) -> None:
                socket.put(wire["context_id"], {"type": "chunk", "data": "A" * 5000})
            socket.on_send = send
            with self.assertRaises(TypeError) as caught:
                async with synthesize(request(text), web_socket=socket, max_message_bytes=10 if outgoing else 4096) as stream:
                    await anext(stream)
            self.assertEqual(str(caught.exception), "Cartesia message exceeds max_message_bytes")
            self.assertEqual((text.closes, socket.closes, len(socket.sent)), (1, 1, 0 if outgoing else 1))
        body = Body([b": comment\n\n"])
        with self.assertRaises(ValueError) as caught:
            async with synthesize(cast(TtsRequest, {**request(), "timestamp_granularity": "word"}), transport=Transport(body), auth={"cartesia": {"api_key": "key"}}, max_event_bytes=2) as stream:
                await anext(stream)
        self.assertEqual(str(caught.exception), "SSE event exceeds byte limit")
        self.assertEqual(body.closes, 1)

    async def test_schema_and_dependency_failures_precede_network_and_iterator_acquisition(self) -> None:
        for changes in [{"model": "sonic-3", "language": "en-GB"}, {"speed": 0.5}, {"max_buffer_delay_ms": 5001}, {"output": {"format": "mp3", "sample_rate_hz": 44100, "bit_rate_bps": 128000}}]:
            text, socket = Input(["unread"]), Socket()
            invalid = cast(TtsRequest, {**request(text), **changes})
            with self.assertRaises(TypeError) as expected:
                validate_request(invalid)
            with self.assertRaises(TypeError) as caught:
                async with synthesize(invalid, web_socket=socket):
                    self.fail("invalid request opened")
            self.assertEqual(caught.exception.args, expected.exception.args)
            self.assertEqual((text.acquired, socket.sent, socket.closes), (0, [], 0))
        text, socket = Input([cast(InputItem, {"command": "update"})]), Socket()
        with self.assertRaises(TypeError) as caught:
            async with synthesize(request(text), web_socket=socket) as stream:
                await anext(stream)
        self.assertEqual(str(caught.exception), 'Invalid cartesia TTS input item:\ntext item: expected string\ntext item["command"]: expected "clear"\ntext item["command"]: expected "flush"')
        self.assertEqual((socket.sent, socket.closes, text.closes), ([], 1, 1))

    async def test_native_token_exchange_and_masked_socket_frames(self) -> None:
        token_body = Body([b'{"token":"short + token"}'])
        transport = Transport(token_body)
        received = asyncio.Event()
        async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            path, headers = await upgrade(reader, writer)
            target = urlsplit(path.split(b" ")[1].decode())
            self.assertEqual(target.path, "/tts/websocket")
            self.assertEqual(parse_qs(target.query), {"keep": ["1"], "access_token": ["short + token"], "cartesia_version": ["2026-08-14"]})
            self.assertEqual(headers.get(b"authorization"), None)
            opcode, first = await client_frame(reader)
            self.assertEqual(opcode, 1)
            wire: dict[str, object] = json.loads(first)
            self.assertEqual(wire["transcript"], "hello")
            opcode, last = await client_frame(reader)
            self.assertEqual(opcode, 1)
            final: dict[str, object] = json.loads(last)
            self.assertEqual((final["continue"], final["context_id"]), (False, wire["context_id"]))
            message = json.dumps({"type": "done", "done": True, "status_code": 200, "context_id": wire["context_id"]}, separators=(",", ":")).encode()
            self.assertLess(len(message), 126)
            writer.write(bytes([0x81, len(message)]) + message)
            await writer.drain()
            received.set()
            await reader.read()
        async with server(handle) as url:
            async with synthesize(request(Input(["hello"])), transport=transport, auth={"cartesia": {"api_key": "secret"}}, base_url="https://proxy.test/cartesia/?tenant=1",
                                  web_socket_url=url + "/tts/websocket?keep=1&api_key=old&%61pi_key=other&access_token=old&cartesia_version=old") as stream:
                self.assertEqual([item async for item in stream], [])
            await received.wait()
        wire = transport.requests[0]
        self.assertEqual((wire.url, wire.headers, json.loads(wire.body)), ("https://proxy.test/cartesia/access-token?tenant=1", {"authorization": "Bearer secret", "cartesia-version": "2026-08-14", "content-type": "application/json"}, {"grants": {"tts": True}, "expires_in": 60}))
        self.assertEqual(token_body.closes, 1)

    async def test_original_errors_and_cancellation_survive_failed_cleanup(self) -> None:
        cleanup = RuntimeError("cleanup failure")
        class FailingBody(Body):
            async def aclose(self) -> None:
                await super().aclose()
                raise cleanup
        class FailingInput(Input):
            async def aclose(self) -> None:
                await super().aclose()
                raise cleanup
        class FailingSocket(Socket):
            async def aclose(self) -> None:
                await super().aclose()
                raise cleanup

        for stage in ["input", "send", "receive", "consumer"]:
            original = RuntimeError(stage)
            class BrokenInput(FailingInput):
                async def __anext__(self) -> InputItem:
                    if stage == "input":
                        raise original
                    return await super().__anext__()
            text, socket = BrokenInput(["hello"], stall=True), FailingSocket()
            async def send(wire: dict[str, object]) -> None:
                if stage == "send":
                    raise original
                if stage == "receive":
                    socket.incoming.put_nowait(original)
                else:
                    socket.put(wire["context_id"], {"type": "chunk", "data": "AA=="})
            socket.on_send = send
            with self.assertRaises(RuntimeError) as caught:
                async with synthesize(request(text), web_socket=socket) as stream:
                    await anext(stream)
                    raise original
            self.assertIs(caught.exception, original)
            self.assertEqual((text.closes, socket.closes), (1, 1))

        for live in [False, True]:
            text, socket, body = FailingInput([], stall=True), FailingSocket(), FailingBody([], stall=True)
            async def consume() -> None:
                async with synthesize(request(text) if live else request(), web_socket=socket, transport=Transport(body), auth={"cartesia": {"api_key": "key"}}) as stream:
                    await anext(stream)
            task = asyncio.create_task(consume())
            await (text.waiting if live else body.waiting).wait()
            task.cancel("caller cancellation")
            with self.assertRaises(asyncio.CancelledError) as caught:
                await task
            self.assertEqual(caught.exception.args, ("caller cancellation",))
            self.assertEqual((text.closes, socket.closes, body.closes), (1, 1, 0) if live else (0, 0, 1))

        for live in [False, True]:
            text, socket, body = FailingInput([], stall=True), FailingSocket(), FailingBody([], stall=True)
            with self.assertRaises(TimeoutError) as caught:
                async with synthesize(request(text) if live else request(), web_socket=socket, transport=Transport(body), auth={"cartesia": {"api_key": "key"}}, timeout_ms=10) as stream:
                    await anext(stream)
            self.assertEqual(str(caught.exception), "Cartesia synthesis deadline expired")
            self.assertEqual((text.closes, socket.closes, body.closes), (1, 1, 0) if live else (0, 0, 1))

        # A protocol error can occur after a successful body read; its identity
        # must survive cleanup too, not just transport read exceptions.
        body = FailingBody([b'data: []\n\n'])
        with self.assertRaises(TypeError) as caught:
            async with synthesize(cast(TtsRequest, {**request(), "timestamp_granularity": "word"}), transport=Transport(body), auth={"cartesia": {"api_key": "key"}}) as stream:
                await anext(stream)
        self.assertEqual(str(caught.exception), "Cartesia returned an invalid frame")
        self.assertEqual(body.closes, 1)

        # With no primary failure, report cleanup errors to the caller.
        body = FailingBody([b"unread"])
        with self.assertRaises(RuntimeError) as caught:
            async with synthesize(request(), transport=Transport(body), auth={"cartesia": {"api_key": "key"}}):
                pass
        self.assertIs(caught.exception, cleanup)

    async def test_socket_protocol_errors_are_terminal_and_release_input(self) -> None:
        cases: list[tuple[object, str]] = [
            (b"binary", "Cartesia returned a non-text frame"),
            ("{", "Cartesia returned invalid JSON"), ("[]", "Cartesia returned an invalid frame"),
            ({"status_code": True}, "Cartesia returned an invalid status_code"),
            ({"status_code": 1e309}, "Cartesia returned invalid JSON"),
            ({"context_id": 1}, "Cartesia returned an invalid context ID"),
            ({"context_id": None}, "Cartesia WebSocket output lacks its context ID"),
            ({"context_id": "wrong"}, "Cartesia returned output for an unexpected context"),
            ({"done": None}, "Cartesia returned an invalid completion flag"),
            ({"flush_id": -1}, "Cartesia returned an invalid flush ID"),
            ({"flush_id": True}, "Cartesia returned an invalid flush ID"),
            ({"flush_id": None}, "Cartesia returned an invalid flush ID"),
            ({"flush_id": 1.5}, "Cartesia returned an invalid flush ID"),
            ({"data": "!"}, "Cartesia returned invalid base64 audio"),
            ({"type": "future"}, "Unknown Cartesia event: future"),
            ({"type": "timestamps", "word_timestamps": None}, "Cartesia returned incomplete timestamps"),
            ({"type": "timestamps", "word_timestamps": {"words": ["x"], "start": [True], "end": [1]}}, "Cartesia returned an invalid timestamp"),
            ({"type": "done", "done": False}, "Unknown Cartesia event: done"),
            (StopAsyncIteration(), "Cartesia WebSocket closed before context completion (idle connections expire after five minutes)"),
        ]
        for malformed, expected in cases:
            text, socket = Input(["hello"], stall=True), Socket()
            async def send(wire: dict[str, object]) -> None:
                if is_mapping(malformed):
                    values = {key: value for key, value in malformed.items() if isinstance(key, str)}
                    socket.put(wire["context_id"], {"type": "chunk", "data": "AA==", **values})
                elif isinstance(malformed, (str, bytes, BaseException)):
                    socket.incoming.put_nowait(malformed)
                else:
                    self.fail("invalid test case")
            socket.on_send = send
            with self.assertRaises(TypeError) as caught:
                async with synthesize(request(text), web_socket=socket) as stream:
                    await anext(stream)
            self.assertEqual(str(caught.exception), expected)
            self.assertEqual((text.closes, socket.closes), (1, 1))

    async def test_auth_precedence_and_token_failures_before_input(self) -> None:
        cases: list[tuple[dict[str, str], Auth | None, str | None]] = [
            ({"CARTESIA_API_KEY": "native"}, None, "native"),
            ({"CARTESIA_API_KEY": "native", "SPEECHSWITCH_CARTESIA_API_KEY": "scoped"}, None, "scoped"),
            ({"SPEECHSWITCH_CARTESIA_API_KEY": "env"}, {"cartesia": {"api_key": "explicit"}}, "explicit"),
            ({"CARTESIA_ACCESS_TOKEN": "native-token"}, None, "native-token"),
            ({"CARTESIA_ACCESS_TOKEN": "native", "SPEECHSWITCH_CARTESIA_ACCESS_TOKEN": "scoped"}, None, "scoped"),
            ({"SPEECHSWITCH_CARTESIA_ACCESS_TOKEN": "env"}, {"cartesia": {"access_token": "explicit"}}, "explicit"),
            ({}, {"cartesia": {"api_key": "key", "access_token": "token"}}, "key"),
            ({"CARTESIA_API_KEY": "native"}, {"cartesia": {"api_key": ""}}, None),
            ({"CARTESIA_API_KEY": "native", "SPEECHSWITCH_CARTESIA_API_KEY": ""}, None, None),
            ({}, None, None),
        ]
        for environment, auth, credential in cases:
            transport = Transport(Body([b"audio"]))
            with patch.dict(os.environ, environment, clear=True):
                if credential is None:
                    with self.assertRaises(TypeError) as caught:
                        async with synthesize(request(), transport=transport, auth=auth):
                            self.fail("missing auth accepted")
                    self.assertEqual(str(caught.exception), "Missing auth.cartesia.apiKey or auth.cartesia.accessToken configuration")
                    self.assertEqual(transport.requests, [])
                else:
                    async with synthesize(request(), transport=transport, auth=auth):
                        pass
                    self.assertEqual(transport.requests[0].headers["authorization"], f"Bearer {credential}")
        for payload in [b'{}', b'[]', b'{"token":""}', b'{"token":null}', b'{"token":1}']:
            body, text = Body([payload]), Input(["unread"])
            with self.assertRaises(TypeError) as caught:
                with patch.dict(os.environ, {}, clear=True):
                    async with synthesize(request(text), transport=Transport(body), auth={"cartesia": {"api_key": "key"}}):
                        self.fail("invalid token accepted")
            self.assertEqual(str(caught.exception), "Cartesia returned an invalid access token")
            self.assertEqual((body.closes, text.acquired), (1, 0))

    async def test_native_access_token_skips_exchange_and_connect_deadline_owns_socket(self) -> None:
        acquired = asyncio.Event()
        async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            path, _ = await upgrade(reader, writer)
            self.assertEqual(parse_qs(urlsplit(path.split(b" ")[1].decode()).query), {"cartesia_version": ["2026-08-14"], "access_token": ["scoped-token"]})
            acquired.set()
            await reader.read()
        transport, text = Transport(Body([])), Input(["unread"])
        async with server(handle) as url:
            with patch.dict(os.environ, {"CARTESIA_API_KEY": "key", "CARTESIA_ACCESS_TOKEN": "native", "SPEECHSWITCH_CARTESIA_ACCESS_TOKEN": "scoped-token"}, clear=True):
                async with synthesize(request(text), transport=transport, web_socket_url=url):
                    await acquired.wait()
        self.assertEqual((transport.requests, text.acquired, text.closes), ([], 0, 0))

        disconnected = asyncio.Event()
        async def no_upgrade(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            await reader.readuntil(b"\r\n\r\n")
            self.assertEqual(await reader.read(), b"")
            disconnected.set()
        async with server(no_upgrade) as url:
            with self.assertRaises(TimeoutError) as caught:
                async with synthesize(request(text), auth={"cartesia": {"access_token": "token"}}, web_socket_url=url, timeout_ms=20):
                    self.fail("handshake deadline ignored")
            self.assertEqual(str(caught.exception), "Cartesia synthesis deadline expired")
            await disconnected.wait()
        self.assertEqual((text.acquired, text.closes), (0, 0))


if __name__ == "__main__":
    unittest.main()
