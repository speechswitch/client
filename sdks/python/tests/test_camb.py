import asyncio
import json
import unittest
from collections.abc import AsyncIterable, AsyncIterator
from typing import cast, NotRequired, TypedDict
from pathlib import Path
from unittest.mock import patch

from speechswitch.generated.camb import TtsRequest
from speechswitch.generated.camb_output import SynthesisItem
from speechswitch.http import HttpRequest, HttpResponse
from speechswitch.providers.camb import synthesize
from test_websocket import client_frame, server, upgrade


def request(text: str | AsyncIterable[str] = "Hello") -> TtsRequest:
    if isinstance(text, str):
        return {"model": "mars8.1-flash-beta", "voice": "00042", "language": "en-us", "text": text, "output": {"format": "mp3"}}
    return {"model": "mars8.1-flash-beta", "voice": "00042", "language": "en-us", "text": text, "output": {"format": "mp3"}}


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


class Input:
    def __init__(self, chunks: list[str]) -> None:
        self.chunks = list(chunks)
        self.acquired = self.reads = self.closes = 0
    def __aiter__(self) -> AsyncIterator[str]:
        self.acquired += 1
        return self
    async def __anext__(self) -> str:
        self.reads += 1
        if not self.chunks:
            raise StopAsyncIteration
        return self.chunks.pop(0)
    async def aclose(self) -> None:
        self.closes += 1


class Socket:
    def __init__(self, *, ready: bool = True, respond: bool = True) -> None:
        self.sent: list[dict[str, object]] = []
        self.incoming: asyncio.Queue[str | bytes | None] = asyncio.Queue()
        self.closed = False
        self.closes = 0
        self.ready, self.respond = ready, respond
        self.started = asyncio.Event()
    def put(self, message: dict[str, object]) -> None:
        self.incoming.put_nowait(json.dumps(message))
    async def send(self, message: str | bytes) -> None:
        assert isinstance(message, str)
        value: dict[str, object] = json.loads(message)
        self.sent.append(value)
        if value["type"] == "session.start":
            self.started.set()
            if self.ready:
                self.put({"type": "session.ready", "session_id": "test", "run_id": 1, "config": {}})
        elif self.respond and value["type"] == "text.chunk":
            self.put({"type": "segment.start", "segment_id": value["index"], "text": value["text"],
                      "word_timestamps": [{"word": value["text"], "start": 0.125, "end": 0.25}]})
            self.incoming.put_nowait(b"\x00\xff")
            self.put({"type": "segment.done", "segment_id": value["index"]})
        elif self.respond and value["type"] == "text.done":
            self.put({"type": "session.done"})
    async def receive(self) -> str | bytes:
        value = await self.incoming.get()
        if value is None:
            raise StopAsyncIteration
        return value
    async def aclose(self) -> None:
        if not self.closed:
            self.closed = True
            self.closes += 1


class CambTests(unittest.IsolatedAsyncioTestCase):
    async def test_shared_protocol_fixtures(self) -> None:
        class Frame(TypedDict):
            json: NotRequired[dict[str, object]]
            audio: NotRequired[list[int]]
        class Fixture(TypedDict):
            name: str
            frames: list[Frame]
            items: list[object]
            error: NotRequired[str]
        fixtures: list[Fixture] = json.loads((Path(__file__).resolve().parents[2] / "fixtures/camb.json").read_text())
        for fixture in fixtures:
            class FixtureSocket(Socket):
                async def send(self, message: str | bytes) -> None:
                    await super().send(message)
                    assert isinstance(message, str)
                    if json.loads(message)["type"] == "text.done":
                        for frame in fixture["frames"]:
                            if "audio" in frame:
                                self.incoming.put_nowait(bytes(frame["audio"]))
                            elif "json" in frame:
                                self.put(frame["json"])
                            else:
                                raise AssertionError("fixture frame lacks JSON and audio")
                        self.put({"type": "session.done"})
            socket = FixtureSocket(respond=False)
            value: TtsRequest = {"text": "Hello", "voice": "42", "model": "mars8.1-flash-beta", "language": "en-us", "output": {"format": "mp3"}, "timestamp_granularity": "word"}
            items: list[object] = []
            failure: str | None = None
            try:
                async with synthesize(value, web_socket=socket, auth={"camb": {"api_key": "test"}}) as stream:
                    async for item in stream:
                        if isinstance(item, bytes):
                            items.append(list(item))
                        else:
                            items.append({"correlation": item["correlation"], "correlationId": item["correlation_id"],
                                          **({"audio": list(item["audio"])} if "audio" in item else {}),
                                          "timestamps": [{"kind": word["kind"], "value": word["value"], "startTimeMs": word["start_time_ms"], "endTimeMs": word["end_time_ms"]} for word in item["timestamps"]]})
            except TypeError as error:
                failure = str(error)
            self.assertEqual((items, failure), (fixture["items"], fixture.get("error")), fixture["name"])
            self.assertEqual(socket.closes, 1)

    async def test_http_models_formats_options_and_ownership(self) -> None:
        models = {"mars8-flash": "mars-flash", "mars8-instruct": "mars-instruct", "mars8-pro": "mars-pro",
                  "mars8.1-flash-beta": "mars-8.1-flash-beta", "mars8.1-pro-beta": "mars-8.1-pro-beta"}
        formats: list[tuple[dict[str, object], str]] = [({"format": value}, "adts" if value == "aac" else value) for value in ["mp3", "wav", "flac", "aac"]]
        for encoding, prefix in [("signed_integer_16", "s16"), ("signed_integer_32", "s32"), ("float_32", "f32")]:
            for order, suffix in [("little_endian", "le"), ("big_endian", "be")]:
                formats.append(({"format": "pcm", "sample_encoding": encoding, "byte_order": order}, f"pcm_{prefix}{suffix}"))
        for model, native in models.items():
            for output, format in formats:
                value = cast(TtsRequest, {**request(), "model": model, "output": {**output, "sample_rate_hz": 24000},
                                         "speed": 1.5, "audio_enhancement": False, "reference_audio_enhancement": False,
                                         "accent_preservation": True, "named_entity_pronunciation_enhancement": False})
                body = Body([b"\0\xff", b"later"])
                transport = Transport(body)
                async with synthesize(value, transport=transport, auth={"camb": {"api_key": "test"}}, base_url="https://proxy.test/api/?a=1") as stream:
                    self.assertEqual(body.reads, 0)
                    self.assertEqual(await anext(stream), b"\0\xff")
                    self.assertEqual(body.reads, 1)
                self.assertEqual(body.closes, 1)
                sent = transport.requests[0]
                self.assertEqual((sent.method, sent.url, dict(sent.headers)), ("POST", "https://proxy.test/api/tts-stream?a=1", {"x-api-key": "test", "content-type": "application/json"}))
                self.assertEqual(json.loads(sent.body), {"text": "Hello", "voice_id": 42, "language": "en-us", "speech_model": native,
                    "enhance_named_entities_pronunciation": False, "output_configuration": {"format": format, "sample_rate": 24000, "apply_enhancement": False},
                    "voice_settings": {"speaking_rate": 1.5, "enhance_reference_audio_quality": False, "maintain_source_accent": True}})

    async def test_http_errors_and_limit_at_every_split(self) -> None:
        data = b" quota exceeded "
        for split in range(len(data) + 1):
            body = Body([data[:split], data[split:]])
            with self.assertRaises(TypeError) as error:
                async with synthesize(request(), transport=Transport(body, 429), auth={"camb": {"api_key": "test"}}):
                    self.fail("error response must not open")
            self.assertEqual(str(error.exception), "CAMB returned HTTP 429: quota exceeded")
            self.assertEqual(body.closes, 1)
        body = Body([b"1234"])
        with self.assertRaises(TypeError) as error:
            async with synthesize(request(), transport=Transport(body, 500), auth={"camb": {"api_key": "test"}}, max_error_bytes=3):
                self.fail("oversized error response must not open")
        self.assertEqual(str(error.exception), "CAMB response exceeds max_error_bytes")
        self.assertEqual(body.closes, 1)

    async def test_incremental_and_timed_whole_text_preserve_segments(self) -> None:
        for whole in [False, True]:
            source = Input(["Hello", ""])
            value = cast(TtsRequest, {**request("Hello" if whole else source), "timestamp_granularity": "word", "text_flush_delay_ms": 0,
                                     "inference_steps": 10, "speed": 1.5, "audio_enhancement": False, "output": {"format": "aac", "sample_rate_hz": 24000}})
            socket = Socket()
            async with synthesize(value, web_socket=socket, auth={"camb": {"api_key": "test"}}) as stream:
                items = [item async for item in stream]
            expected: list[SynthesisItem] = []
            for index, text in enumerate(["Hello"] if whole else ["Hello", ""]):
                expected.extend([{"correlation": "ordered", "correlation_id": str(index), "timestamps": [{"kind": "word", "value": text, "start_time_ms": 125, "end_time_ms": 250}]},
                                 {"correlation": "ordered", "correlation_id": str(index), "audio": b"\0\xff", "timestamps": []}])
            self.assertEqual(items, expected)
            self.assertEqual(socket.sent, [{"type": "session.start", "voice_id": 42, "language": "en-us", "output_format": "aac",
                "word_timestamps": True, "idle_timeout": 0, "inference_steps": 10, "speaking_rate": 1.5, "apply_enhancement": False, "sample_rate": 24000,
                "enhance_named_entities_pronunciation": False, "enhance_reference_audio_quality": False, "maintain_source_accent": False},
                *[{"type": "text.chunk", "text": text, "index": index} for index, text in enumerate(["Hello"] if whole else ["Hello", ""])], {"type": "text.done"}])
            self.assertEqual((socket.closes, source.closes), (1, 0 if whole else 1))

    async def test_ready_gates_input_and_cancellation(self) -> None:
        source, socket = Input(["Hello"]), Socket(ready=False)
        async with synthesize(request(source), web_socket=socket, auth={"camb": {"api_key": "test"}}) as stream:
            task = asyncio.ensure_future(anext(stream))
            await socket.started.wait()
            self.assertEqual((source.acquired, source.reads), (0, 0))
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
        self.assertEqual((socket.closes, source.acquired), (1, 0))

    async def test_output_progresses_during_backpressured_write(self) -> None:
        sending = asyncio.Event()
        class Backpressured(Socket):
            async def send(self, message: str | bytes) -> None:
                await super().send(message)
                assert isinstance(message, str)
                if json.loads(message)["type"] == "text.chunk":
                    sending.set()
                    await asyncio.Event().wait()
        source, socket = Input(["Hello", "not pulled"]), Backpressured()
        async with asyncio.timeout(2):
            async with synthesize(request(source), web_socket=socket, auth={"camb": {"api_key": "test"}}) as stream:
                self.assertEqual(await anext(stream), b"\0\xff")
                self.assertEqual((sending.is_set(), source.reads), (True, 1))
        self.assertEqual((socket.closes, source.closes), (1, 1))

    async def test_input_errors_and_cancellation_release_network_and_source(self) -> None:
        failure = RuntimeError("producer failed")
        for fail in [False, True]:
            reading = asyncio.Event()
            class Pending(Input):
                async def __anext__(self) -> str:
                    reading.set()
                    if fail:
                        raise failure
                    await asyncio.Event().wait()
                    raise AssertionError("pending input should be canceled")
            source, socket = Pending([]), Socket(respond=False)
            async with synthesize(request(source), web_socket=socket, auth={"camb": {"api_key": "test"}}) as stream:
                task = asyncio.ensure_future(anext(stream))
                await reading.wait()
                if fail:
                    with self.assertRaises(RuntimeError) as caught:
                        await task
                    self.assertIs(caught.exception, failure)
                else:
                    task.cancel()
                    with self.assertRaises(asyncio.CancelledError):
                        await task
            self.assertEqual((socket.closes, source.closes), (1, 1))

    async def test_handshake_errors_and_injected_frame_limits(self) -> None:
        for frame, expected in [(None, "CAMB closed before session.ready"),
                                ('{"type":"session.error","error":"auth"}', "CAMB rejected session: auth"),
                                (b"audio", "CAMB did not acknowledge the session before sending output"),
                                ("x" * 1001, "CAMB message exceeds max_message_bytes")]:
            source, socket = Input(["Hello"]), Socket(ready=False)
            socket.incoming.put_nowait(frame)
            with self.assertRaises(TypeError) as error:
                async with synthesize(request(source), web_socket=socket, auth={"camb": {"api_key": "test"}}, max_message_bytes=1000) as stream:
                    await anext(stream)
            self.assertEqual(str(error.exception), expected)
            self.assertEqual((socket.closes, source.acquired), (1, 0))

    async def test_generated_input_validation_and_outgoing_limits(self) -> None:
        for chunk, expected in [(cast(str, {"command": "clear"}), "Invalid camb TTS input item"),
                                ("x" * 1001, "CAMB message exceeds max_message_bytes")]:
            source, socket = Input([chunk]), Socket()
            with self.assertRaises(TypeError) as error:
                async with synthesize(request(source), web_socket=socket, auth={"camb": {"api_key": "test"}}, max_message_bytes=1000) as stream:
                    await anext(stream)
            self.assertEqual(str(error.exception), expected)
            self.assertEqual([value["type"] for value in socket.sent], ["session.start"])
            self.assertEqual((socket.closes, source.closes), (1, 1))

    async def test_protocol_errors_are_terminal(self) -> None:
        start: dict[str, object] = {"type": "segment.start", "segment_id": 2, "text": "hi"}
        cases: list[tuple[list[str | bytes | dict[str, object] | None], str]] = [
            ([b"audio"], "CAMB returned audio outside a segment"),
            ([start, start], "CAMB returned an overlapping or reused segment"),
            ([start, {"type": "segment.done", "segment_id": 2}, start], "CAMB returned an overlapping or reused segment"),
            ([{"type": "segment.done", "segment_id": 2}], "CAMB completed an unexpected segment"),
            ([start, {"type": "segment.done", "segment_id": 3}], "CAMB completed an unexpected segment"),
            ([{"type": "segment.skipped", "segment_id": 2, "text": "hi"}], "CAMB skipped segment 2: hi"),
            ([{"type": "session.error", "error": "quota"}], "CAMB synthesis failed: quota"),
            ([{"type": "session.done"}], "CAMB ended an incomplete session"),
            ([None], "CAMB closed before session.done"),
            ([{"type": "unknown"}], "Invalid CAMB WebSocket message"),
            ([{**start, "segment_id": True}], "Invalid CAMB WebSocket message"),
            ([{**start, "segment_id": 9007199254740992}], "CAMB returned an unsafe segment ID"),
            ([{**start, "word_timestamps": [{"word": "hi", "start": 1, "end": 0}]}], "CAMB returned invalid word timing"),
            ([{**start, "word_timestamps": [{"word": "hi", "start": 1e308, "end": 1e308}]}], "CAMB returned invalid word timing"),
        ]
        for messages, expected in cases:
            source, socket = Input(["Hello"]), Socket(respond=False)
            class Errors(Socket):
                async def send(self, message: str | bytes) -> None:
                    await super().send(message)
                    assert isinstance(message, str)
                    if json.loads(message)["type"] == "session.start":
                        for value in messages:
                            self.incoming.put_nowait(json.dumps(value) if isinstance(value, dict) else value)
            socket = Errors(respond=False)
            value = cast(TtsRequest, {**request(source), "timestamp_granularity": "word"})
            async with asyncio.timeout(2):
                with self.assertRaises(TypeError) as error:
                    async with synthesize(value, web_socket=socket, auth={"camb": {"api_key": "test"}}) as stream:
                        _ = [item async for item in stream]
                self.assertEqual(str(error.exception), expected)
            self.assertEqual((socket.closes, source.closes), (1, 1))

    async def test_invalid_requests_and_wire_constraints_before_io(self) -> None:
        for extra, expected in [({"voice": "0"}, "CAMB voice must be a positive integer ID"),
                                ({"voice": "9007199254740992"}, "CAMB voice must be a positive integer ID"),
                                ({"model": "invented"}, "Invalid camb TTS request"),
                                ({"output": {"format": "mp3", "sample_rate_hz": 24000.5}}, "Invalid camb TTS request"),
                                ({"output": {"format": "mp3", "sample_rate_hz": 9007199254740992}}, "Invalid camb TTS request")]:
            transport = Transport(Body([]))
            with self.assertRaises(TypeError) as error:
                async with synthesize(cast(TtsRequest, {**request(), **extra}), transport=transport, auth={"camb": {"api_key": "test"}}):
                    self.fail("invalid request must not open")
            self.assertEqual(str(error.exception), expected)
            self.assertEqual(transport.requests, [])

        source, socket = Input(["Hello"]), Socket()
        with self.assertRaises(TypeError) as error:
            async with synthesize(cast(TtsRequest, {**request(source), "inference_steps": 1.5}), web_socket=socket, auth={"camb": {"api_key": "test"}}):
                self.fail("fractional inference steps must not open")
        self.assertEqual(str(error.exception), "Invalid camb TTS request")
        self.assertEqual((socket.sent, source.acquired), ([], 0))

    async def test_env_auth_and_explicit_empty(self) -> None:
        with patch.dict("os.environ", {"SPEECHSWITCH_CAMB_API_KEY": "scoped", "CAMB_API_KEY": "native"}, clear=True):
            transport = Transport(Body([]))
            async with synthesize(request(), transport=transport):
                pass
            self.assertEqual(transport.requests[0].headers["x-api-key"], "scoped")
            with self.assertRaises(TypeError) as error:
                async with synthesize(request(), transport=transport, auth={"camb": {"api_key": ""}}):
                    self.fail("explicit empty auth must not fall back")
            self.assertEqual(str(error.exception), "Missing auth.camb.apiKey configuration")
            self.assertEqual(len(transport.requests), 1)

    async def test_native_socket_uses_header_auth(self) -> None:
        async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            path, headers = await upgrade(reader, writer)
            self.assertEqual(path, b"GET /live?trace=1 HTTP/1.1")
            self.assertEqual(headers[b"x-api-key"], b"native-test")
            _, data = await client_frame(reader)
            self.assertEqual(json.loads(data)["type"], "session.start")
            def send(value: dict[str, object]) -> None:
                encoded = json.dumps(value).encode()
                assert len(encoded) < 126
                writer.write(bytes([0x81, len(encoded)]) + encoded)
            send({"type": "session.ready", "session_id": "test", "run_id": 1, "config": {}})
            _, data = await client_frame(reader)
            self.assertEqual(json.loads(data), {"type": "text.chunk", "text": "Hello", "index": 0})
            send({"type": "segment.start", "segment_id": 7, "text": "Hello"})
            writer.write(b"\x82\x02\0\xff")
            send({"type": "segment.done", "segment_id": 7})
            _, data = await client_frame(reader)
            self.assertEqual(json.loads(data), {"type": "text.done"})
            send({"type": "session.done"})
            await writer.drain()
            await reader.read()
        async with server(handle) as url:
            async with synthesize(request(Input(["Hello"])), auth={"camb": {"api_key": "native-test"}}, web_socket_url=url + "/live?api_key=stale&trace=1") as stream:
                self.assertEqual([item async for item in stream], [b"\0\xff"])


if __name__ == "__main__":
    unittest.main()
