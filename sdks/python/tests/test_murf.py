import asyncio
import json
import os
import unittest
from collections.abc import AsyncIterator, Callable, Mapping
from pathlib import Path
from typing import cast
from unittest.mock import patch

from speechswitch.generated.auth import Auth
from speechswitch.generated.murf import TtsRequest
from speechswitch.generated.validators.murf import validate_request
from speechswitch.http import HttpRequest, HttpResponse
from speechswitch.providers.murf import MurfError, TtsInput, synthesize
from speechswitch.websocket import WebSocketError
from test_websocket import client_frame, server, upgrade

AUTH: Auth = {"murf": {"api_key": "test-key"}}
FIXTURE: dict[str, object] = json.loads((Path(__file__).parents[2] / "fixtures/murf.json").read_text())


class Source[T]:
    def __init__(self, values: list[T], *, stall: bool = False, error: Exception | None = None) -> None:
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


class Socket:
    def __init__(self) -> None:
        self.incoming: asyncio.Queue[str | bytes | Exception] = asyncio.Queue()
        self.sent: list[dict[str, object]] = []
        self.closes = 0
        self.closed = asyncio.Event()
        self.on_send: Callable[[dict[str, object]], None] = self.respond
    def respond(self, value: dict[str, object]) -> None:
        if value.get("text"):
            self.incoming.put_nowait(json.dumps({"context_id": value["context_id"], "audio": "AP+A"}))
        if value.get("end"):
            self.incoming.put_nowait(json.dumps({"context_id": value["context_id"], "final": True}))
        if value.get("clear"):
            self.incoming.put_nowait(json.dumps({"context_id": value["context_id"], "audio": "3q0=", "final": True}))
    async def send(self, message: str | bytes) -> None:
        value: dict[str, object] = json.loads(message)
        self.sent.append(value)
        self.on_send(value)
    async def receive(self) -> str | bytes:
        value = await self.incoming.get()
        if isinstance(value, Exception): raise value
        return value
    async def aclose(self) -> None:
        self.closes += 1
        self.closed.set()


async def items(*values: TtsInput) -> AsyncIterator[TtsInput]:
    for value in values: yield value


class Tests(unittest.IsolatedAsyncioTestCase):
    async def test_falcon_native_bytes_and_shared_configuration(self) -> None:
        body = Source([b"\0\xff\x80"], stall=True)
        transport = Transport(HttpResponse(200, {"Content-Type": "audio/pcm"}, body))
        async with synthesize({"voice": "existing-voice", "text": "Hello"}, auth=AUTH, transport=transport, base_url="https://proxy.invalid/a%2Fb/?tenant=one") as audio:
            self.assertEqual(await anext(audio), b"\0\xff\x80")
            self.assertEqual(body.reads, 1)
        self.assertEqual(body.closes, 1)
        self.assertEqual(json.loads(transport.requests[0].body), FIXTURE["falcon"])
        self.assertEqual(transport.requests[0].url, "https://proxy.invalid/a%2Fb/v1/speech/stream?tenant=one")
        self.assertEqual(transport.requests[0].headers, {"api-key": "test-key", "Content-Type": "application/json", "Accept": "audio/*, application/octet-stream"})

    async def test_gen2_download_and_inline_timing(self) -> None:
        for inline in [False, True]:
            transport = Transport(response(FIXTURE["generation"]), HttpResponse(200, {}, Source([b"\0\xff\x80"])))
            request: TtsRequest = {"voice": "existing-voice", "text": "Hello", "model": "gen2", "audio_retention": not inline, "timestamp_granularity": "word"}
            async with synthesize(request, auth=AUTH, transport=transport) as audio:
                self.assertEqual([v async for v in audio], [
                    {"correlation": "timeline", "audio": b"\0\xff\x80", "timestamps": []},
                    {"correlation": "timeline", "duration_ms": 500, "timestamps": [{"kind": "word", "value": "Hello", "start_time_ms": 0, "end_time_ms": 500}]},
                    {"event": "done", "remaining_characters": 0, "warning": ""},
                ])
            expected = {**cast(dict[str, object], FIXTURE["gen2"]), "encodeAsBase64": inline}
            self.assertEqual(json.loads(transport.requests[0].body), expected)
            self.assertEqual(len(transport.requests), 1 if inline else 2)
            if not inline: self.assertEqual(transport.requests[1], HttpRequest("GET", "https://files.invalid/audio/?signed=one", {}, b""))

    async def test_clear_flush_and_live_updates(self) -> None:
        socket = Socket()
        flushed, second_audio = asyncio.Event(), asyncio.Event()
        async def input() -> AsyncIterator[TtsInput]:
            yield "Hello"
            yield {"command": "update", "voice": "custom", "voice_style": "Conversation", "language": "en-US", "speed_bias": 0, "pitch_bias": -5, "max_buffer_delay_ms": 0}
            yield {"command": "flush"}
            await flushed.wait()
            yield "Another"
            await second_audio.wait()
            yield {"command": "clear"}
            yield "Replacement"
        kinds: list[str] = []
        async with synthesize({"voice": "Gordon", "text": input()}, web_socket=socket) as audio:
            async with asyncio.timeout(2):
                async for value in audio:
                    self.assertNotIsInstance(value, bytes)
                    if isinstance(value, bytes): continue
                    kind = value["event"] if "event" in value else "audio"
                    kinds.append(kind)
                    if kind == "flush": flushed.set()
                    if kinds.count("audio") == 2: second_audio.set()
        self.assertEqual(kinds, ["audio", "flush", "audio", "clear", "audio", "done"])
        self.assertEqual(socket.sent[0], {"min_buffer_size": 40, "max_buffer_delay_in_ms": 300})
        updated = socket.sent[2]
        self.assertEqual(updated["voice_config"], {"voice_id": "custom", "style": "Conversation", "locale": "en-US", "rate": 0, "pitch": -5})
        self.assertEqual(socket.sent[3], {"max_buffer_delay_in_ms": 0})
        contexts = [v["context_id"] for v in socket.sent if v.get("text")]
        self.assertEqual(len(set(contexts)), 3)
        self.assertEqual(socket.closes, 1)

    async def test_input_failure_escapes_a_stalled_flush(self) -> None:
        original = RuntimeError("producer failure")
        input = Source[TtsInput](["Hello", {"command": "flush"}], error=original)
        socket = Socket()
        socket.on_send = lambda value: socket.respond(value) if not value.get("end") else None
        with self.assertRaises(RuntimeError) as raised:
            async with synthesize({"text": input, "voice": "v"}, web_socket=socket) as audio:
                async with asyncio.timeout(1): _ = [v async for v in audio]
        self.assertIs(raised.exception, original)
        await asyncio.wait_for(input.closed.wait(), 1)
        self.assertEqual((input.closes, socket.closes), (1, 1))

    async def test_bad_shapes_and_limits_release_http_body(self) -> None:
        cases: list[tuple[int, dict[str, str], bytes, str, bool, int]] = [
            (200, {"Content-Type": "application/json"}, b"{}", "Murf returned a non-audio streaming response", False, 100),
            (200, {}, b"", "Murf returned no audio", False, 100),
            (200, {}, b"xxxxxxxxxx", "Murf response exceeds max_json_bytes", True, 4),
        ]
        for status, headers, data, error, gen2, limit in cases:
            body = Source([data])
            transport = Transport(HttpResponse(status, headers, body))
            request: TtsRequest = {"text": "Hi", "voice": "v", "model": "gen2"} if gen2 else {"text": "Hi", "voice": "v"}
            with self.assertRaises(TypeError) as raised:
                async with synthesize(request, auth=AUTH, transport=transport, max_json_bytes=limit) as audio: _ = [v async for v in audio]
            self.assertEqual(str(raised.exception), error)
            self.assertEqual(body.closes, 1)

    async def test_http_status_error_preserves_body_and_retry(self) -> None:
        body = Source([b"gateway"])
        transport = Transport(HttpResponse(429, {"Retry-After": "2"}, body))
        with self.assertRaises(MurfError) as raised:
            async with synthesize({"text": "Hi", "voice": "v"}, auth=AUTH, transport=transport) as audio: _ = [v async for v in audio]
        self.assertEqual((raised.exception.status_code, raised.exception.body, raised.exception.retry_after), (429, "gateway", "2"))
        self.assertEqual(body.closes, 1)

    async def test_auth_precedence_and_empty_credentials(self) -> None:
        cases: list[tuple[Auth | None, str]] = [(None, "scoped"), (AUTH, "test-key"), ({"murf": {}}, "scoped")]
        for auth, expected in cases:
            transport = Transport(HttpResponse(200, {}, Source([b"a"])))
            with patch.dict(os.environ, {"SPEECHSWITCH_MURF_API_KEY": "scoped", "MURF_API_KEY": "legacy"}):
                async with synthesize({"text": "Hi", "voice": "v"}, auth=auth, transport=transport) as audio: _ = [v async for v in audio]
            self.assertEqual(transport.requests[0].headers["api-key"], expected)
        with patch.dict(os.environ, {"SPEECHSWITCH_MURF_API_KEY": "scoped"}):
            with self.assertRaises(TypeError) as raised:
                async with synthesize({"text": "Hi", "voice": "v"}, auth={"murf": {"api_key": ""}}): pass
            self.assertEqual(str(raised.exception), "Missing auth.murf.apiKey configuration")

    async def test_generated_validation_owns_model_constraints_and_text_limit(self) -> None:
        cases: list[dict[str, object]] = [
            {"model": "gen2", "text": items("Hi")}, {"target_duration_ms": 0},
            {"timestamp_granularity": "word"}, {"speed_bias": 0.5},
            {"model": "gen2", "delivery_variance": 0.3},
            {"model": "gen2", "output": {"format": "pcm", "sample_rate_hz": 16000}},
            {"model": "gen2", "timestamp_text": "original", "timestamp_granularity": "word", "language": "fr-FR"},
            {"text": "x" * 3001}, {"text": "🚀" * 1501},
        ]
        for fields in cases:
            transport = Transport()
            request = cast(TtsRequest, {"voice": "v", "text": "Hi", **fields})
            with self.assertRaises(TypeError) as expected:
                validate_request(request)
            with self.assertRaises(TypeError) as raised:
                async with synthesize(request, auth=AUTH, transport=transport): pass
            self.assertEqual(raised.exception.args, expected.exception.args)
            self.assertEqual(transport.requests, [])
        for text in ["x" * 3000, "🚀" * 1500, "line\n" * 600]:
            transport = Transport(HttpResponse(200, {}, Source([b"a"])))
            async with synthesize({"text": text, "voice": "v"}, auth=AUTH, transport=transport) as audio:
                self.assertEqual([v async for v in audio], [b"a", {"event": "done"}])

    async def test_stream_validation_prevents_invalid_writes(self) -> None:
        for item, error in [("🚀" * 1501, "Murf text messages must not exceed 3000 characters"),
                            ({"command": "update", "pitch_bias": 0.5}, "")]:
            socket = Socket()
            if not isinstance(item, str):
                check = validate_request({"text": items(), "voice": "v"})
                with self.assertRaises(TypeError) as expected:
                    check(item)
                error = str(expected.exception)
            with self.assertRaises(TypeError) as raised:
                async with synthesize({"text": items(cast(TtsInput, item)), "voice": "v"}, web_socket=socket) as audio:
                    async with asyncio.timeout(1): _ = [v async for v in audio]
            self.assertEqual(str(raised.exception), error)
            self.assertEqual(socket.sent, [{"min_buffer_size": 40, "max_buffer_delay_in_ms": 300}])
            self.assertEqual(socket.closes, 1)

    async def test_malformed_socket_packets_preserve_exact_errors(self) -> None:
        cases: list[tuple[str | bytes | Exception, str]] = [
            (b"{}", "Murf returned a non-text WebSocket message"),
            ("{", "Murf returned invalid JSON"), ("[]", "Murf returned an invalid response object"),
            ('{"context_id":""}', "Murf returned audio or completion without the requested context ID"),
            ('{"context_id":"x","final":1}', "Murf returned an invalid final flag"),
            ('{"context_id":"x"}', "Murf returned an unsupported WebSocket message"),
            ('{"context_id":"x","audio":"!!!"}', "Murf returned invalid base64 audio"),
            ('{"context_id":"x","audio":"AQ=="}', "Murf returned an unknown context ID"),
            (StopAsyncIteration(), "Murf WebSocket closed before all contexts completed"),
        ]
        for packet, error in cases:
            socket = Socket()
            socket.on_send = lambda _: None
            socket.incoming.put_nowait(packet)
            with self.assertRaises(TypeError) as raised:
                async with synthesize({"text": items("Hi"), "voice": "v"}, web_socket=socket) as audio:
                    async with asyncio.timeout(1): _ = [v async for v in audio]
            self.assertEqual(str(raised.exception), error)
            self.assertEqual(socket.closes, 1)
        socket = Socket()
        raw = '{"error":{"code":429,"message":"quota"}}'
        socket.incoming.put_nowait(raw)
        with self.assertRaises(MurfError) as raised:
            async with synthesize({"text": items("Hi"), "voice": "v"}, web_socket=socket) as audio: _ = [v async for v in audio]
        self.assertEqual((raised.exception.status_code, raised.exception.body), (None, raw))

    async def test_final_requires_ended_text_and_audio(self) -> None:
        for premature in [False, True]:
            socket = Socket()
            input = Source[TtsInput](["Hi"], stall=premature)
            socket.on_send = lambda v: socket.incoming.put_nowait(json.dumps({"context_id": v["context_id"], "final": True})) if v.get("text" if premature else "end") else None
            with self.assertRaises(TypeError) as raised:
                async with synthesize({"text": input, "voice": "v"}, web_socket=socket) as audio:
                    async with asyncio.timeout(1): _ = [v async for v in audio]
            self.assertEqual(str(raised.exception), "Murf completed a context before its text ended" if premature else "Murf completed a context without audio")
            await asyncio.wait_for(input.closed.wait(), 1)

    async def test_clear_invalidates_before_stalled_native_write(self) -> None:
        entered = asyncio.Event()
        class StalledClear(Socket):
            async def send(self, message: str | bytes) -> None:
                await super().send(message)
                if self.sent[-1].get("clear"):
                    entered.set()
                    await asyncio.Future[None]()
        socket = StalledClear()
        socket.on_send = lambda _: None
        input = Source[TtsInput](["Hi", {"command": "clear"}], stall=True)
        async with synthesize({"text": input, "voice": "v"}, web_socket=socket) as audio:
            self.assertEqual(await asyncio.wait_for(anext(audio), 1), {"event": "clear"})
            await asyncio.wait_for(entered.wait(), 1)
        await asyncio.wait_for(input.closed.wait(), 1)
        self.assertEqual((input.closes, socket.closes), (1, 1))

    async def test_clear_cancels_an_unacknowledged_flush(self) -> None:
        socket = Socket()
        def respond(value: dict[str, object]) -> None:
            if value.get("text") == "replacement" or value.get("clear") or value.get("end") and len(socket.sent) > 4:
                socket.respond(value)
        socket.on_send = respond
        async with synthesize({"text": items("old", {"command": "flush"}, {"command": "clear"}, "replacement"), "voice": "v"}, web_socket=socket) as audio:
            async with asyncio.timeout(1): actual = [v async for v in audio]
        self.assertEqual(actual, [
            {"event": "clear"},
            {"correlation": "ordered", "correlation_id": socket.sent[4]["context_id"], "audio": b"\0\xff\x80", "timestamps": []},
            {"event": "done"},
        ])
        self.assertNotEqual(socket.sent[1]["context_id"], socket.sent[4]["context_id"])

    async def test_clear_while_consumer_holds_final_audio_retires_the_context(self) -> None:
        clear, cleared = asyncio.Event(), asyncio.Event()
        async def input() -> AsyncIterator[TtsInput]:
            yield "Hi"
            yield {"command": "flush"}
            await clear.wait()
            yield {"command": "clear"}
        socket = Socket()
        def respond(value: dict[str, object]) -> None:
            if value.get("end"):
                socket.incoming.put_nowait(json.dumps({"context_id": value["context_id"], "audio": "AP+A", "final": True}))
            if value.get("clear"): cleared.set()
        socket.on_send = respond
        async with synthesize({"text": input(), "voice": "v"}, web_socket=socket) as audio:
            self.assertEqual(await asyncio.wait_for(anext(audio), 1), {"correlation": "ordered", "correlation_id": socket.sent[1]["context_id"], "audio": b"\0\xff\x80", "timestamps": []})
            clear.set()
            await asyncio.wait_for(cleared.wait(), 1)
            async with asyncio.timeout(1): self.assertEqual([v async for v in audio], [{"event": "clear"}, {"event": "done"}])

    async def test_failed_end_write_cannot_be_masked_by_native_final(self) -> None:
        release, entered = asyncio.Event(), asyncio.Event()
        original = RuntimeError("end write failed")
        class FailedEnd(Socket):
            async def send(self, message: str | bytes) -> None:
                await super().send(message)
                if self.sent[-1].get("end"):
                    entered.set()
                    await release.wait()
                    raise original
        socket = FailedEnd()
        async with synthesize({"text": items("Hi", {"command": "flush"}), "voice": "v"}, web_socket=socket) as audio:
            first = await asyncio.wait_for(anext(audio), 1)
            self.assertEqual(first, {"correlation": "ordered", "correlation_id": socket.sent[1]["context_id"], "audio": b"\0\xff\x80", "timestamps": []})
            await entered.wait()
            pending = asyncio.ensure_future(anext(audio))
            await asyncio.sleep(0)
            self.assertFalse(pending.done())
            release.set()
            with self.assertRaises(RuntimeError) as raised: await asyncio.wait_for(pending, 1)
            self.assertIs(raised.exception, original)
        self.assertEqual(socket.closes, 1)

    async def test_unread_context_does_not_acquire_input_or_write(self) -> None:
        input = Source[TtsInput](["Hi"])
        socket = Socket()
        async with synthesize({"text": input, "voice": "v"}, web_socket=socket): pass
        self.assertEqual((input.reads, input.closes, socket.sent, socket.closes), (0, 0, [], 1))

    async def test_cancellation_while_waiting_for_input_or_initial_write(self) -> None:
        for setup in [False, True]:
            entered = asyncio.Event()
            class StalledSetup(Socket):
                async def send(self, message: str | bytes) -> None:
                    entered.set()
                    await asyncio.Future[None]()
            socket = StalledSetup() if setup else Socket()
            input = Source[TtsInput]([], stall=True)
            async def run() -> None:
                async with synthesize({"text": input, "voice": "v"}, web_socket=socket) as audio: _ = [v async for v in audio]
            task = asyncio.create_task(run())
            await asyncio.wait_for((entered if setup else input.waiting).wait(), 1)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError): await asyncio.wait_for(task, 1)
            if not setup: await asyncio.wait_for(input.closed.wait(), 1)
            self.assertEqual(input.closes, 0 if setup else 1)
            self.assertEqual(socket.closes, 1)

    async def test_uncooperative_input_does_not_hold_socket_open_or_send_late_text(self) -> None:
        release, ignored = asyncio.Event(), asyncio.Event()
        class StubbornInput(Source[TtsInput]):
            async def __anext__(self) -> TtsInput:
                self.waiting.set()
                try: await asyncio.Future[None]()
                except asyncio.CancelledError:
                    ignored.set()
                    await release.wait()
                    return "late text"
                raise AssertionError("unreachable")
        input = StubbornInput([])
        socket = Socket()
        async def run() -> None:
            async with synthesize({"text": input, "voice": "v"}, web_socket=socket) as audio: _ = [v async for v in audio]
        task = asyncio.create_task(run())
        try:
            await asyncio.wait_for(input.waiting.wait(), 1)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError): await asyncio.wait_for(task, 1)
            await asyncio.wait_for(ignored.wait(), 1)
            self.assertEqual((socket.closes, input.closes), (1, 0))
        finally:
            release.set()
        await asyncio.wait_for(input.closed.wait(), 1)
        self.assertEqual(socket.sent, [{"min_buffer_size": 40, "max_buffer_delay_in_ms": 300}])
        self.assertEqual(input.closes, 1)

    async def test_native_socket_header_auth_and_proxy_query(self) -> None:
        async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            path, headers = await upgrade(reader, writer)
            self.assertEqual(path, b"GET /prefix%2Froute?tenant=a%2Bb&model=falcon-2&format=PCM&sample_rate=24000&channel_type=MONO HTTP/1.1")
            self.assertEqual(headers[b"api_key"], b"test-key")
            self.assertNotIn(b"api-key", headers)
            opcode, raw = await client_frame(reader)
            self.assertEqual((opcode, json.loads(raw)), (1, {"min_buffer_size": 40, "max_buffer_delay_in_ms": 300}))
            _, raw = await client_frame(reader)
            text: dict[str, object] = json.loads(raw)
            self.assertEqual(text["text"], "Hi")
            _, raw = await client_frame(reader)
            self.assertEqual(json.loads(raw), {"context_id": text["context_id"], "text": "", "end": True})
            packet = json.dumps({"context_id": text["context_id"], "audio": "AP+A", "final": True}, separators=(",", ":")).encode()
            self.assertLess(len(packet), 126)
            writer.write(bytes([0x81, len(packet)]) + packet)
            await writer.drain()
            await reader.read()
        async with server(handle) as url:
            async with synthesize({"text": items("Hi"), "voice": "v"}, auth=AUTH, web_socket_url=url + "/prefix%2Froute?tenant=a%2Bb&api_key=discard&model=gen2") as audio:
                actual = [v async for v in audio]
                self.assertEqual(len(actual), 2)
                self.assertEqual(actual[-1], {"event": "done"})

    async def test_rejected_native_handshake_does_not_consume_input(self) -> None:
        async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            await reader.readuntil(b"\r\n\r\n")
            writer.write(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n")
            await writer.drain()
            await reader.read()
        input = Source[TtsInput](["Hi"])
        async with server(handle) as url:
            with self.assertRaises(WebSocketError) as raised:
                async with synthesize({"text": input, "voice": "v"}, auth=AUTH, web_socket_url=url): pass
            self.assertEqual(str(raised.exception), "WebSocket handshake was not accepted")
        self.assertEqual((input.reads, input.closes), (0, 0))

    async def test_formats_discrete_variance_and_original_alignment(self) -> None:
        for model in ["falcon-2", "gen2"]:
            for format, native in [("pcm", "PCM"), ("wav", "WAV"), ("mp3", "MP3"), ("flac", "FLAC"), ("ogg", "OGG"), ("alaw", "ALAW"), ("mulaw", "ULAW")]:
                transport = Transport(response(FIXTURE["generation"]) if model == "gen2" else HttpResponse(200, {}, Source([b"a"])), HttpResponse(200, {}, Source([b"a"])))
                request = cast(TtsRequest, {"text": "Hi", "voice": "v", "model": model, "output": {"format": format, "sample_rate_hz": 48000, "channel_count": 2}})
                async with synthesize(request, auth=AUTH, transport=transport) as audio: _ = [v async for v in audio]
                wire = json.loads(transport.requests[0].body)
                self.assertEqual((wire["format"], wire["sampleRate"], wire["channelType"]), (native, 48000, "STEREO"))
        for value, native in [(0, 0), (0.2, 1), (0.4, 2), (0.6, 3), (0.8, 4), (1, 5)]:
            transport = Transport(response(FIXTURE["generation"]))
            request = cast(TtsRequest, {"text": "Hi", "voice": "v", "model": "gen2", "delivery_variance": value, "audio_retention": False, "target_duration_ms": 0, "timestamp_text": "original", "timestamp_granularity": "word", "language": "en-US"})
            async with synthesize(request, auth=AUTH, transport=transport) as audio: _ = [v async for v in audio]
            wire = json.loads(transport.requests[0].body)
            self.assertEqual((wire["variation"], wire["audioDuration"], wire["wordDurationsAsOriginalText"], wire["locale"]), (native, 0, True, "en-US"))

    async def test_gen2_rejects_malformed_metadata_and_unsafe_asset_urls(self) -> None:
        cases: list[tuple[dict[str, object], str]] = [
            ({"audioLengthInSeconds": True}, "Murf returned an invalid audio duration"),
            ({"remainingCharacterCount": 0.5}, "Murf returned an invalid remaining character count"),
            ({"warning": None}, "Murf returned an invalid warning"),
            ({"wordDurations": None}, "Murf returned no word durations"),
            ({"wordDurations": [{"word": "Hi", "startMs": 2, "endMs": 1}]}, "Murf returned an invalid word duration"),
            ({"audioFile": "http://files.invalid/audio"}, "Murf returned an unsafe audio file URL"),
            ({"audioFile": "https://user:secret@files.invalid/audio"}, "Invalid Murf endpoint URL"),
        ]
        for fields, error in cases:
            body = Source([json.dumps({**cast(dict[str, object], FIXTURE["generation"]), **fields}).encode()])
            transport = Transport(HttpResponse(200, {}, body))
            with self.assertRaises(TypeError) as raised:
                async with synthesize({"text": "Hi", "voice": "v", "model": "gen2", "timestamp_granularity": "word"}, auth=AUTH, transport=transport) as audio: _ = [v async for v in audio]
            self.assertEqual(str(raised.exception), error)
            self.assertEqual((body.closes, len(transport.requests)), (1, 1))

    async def test_cancellation_during_http_headers_metadata_audio_and_download(self) -> None:
        for stage in ["headers", "audio", "metadata", "download"]:
            entered, released = asyncio.Event(), asyncio.Event()
            body = Source[bytes]([], stall=True)
            class PendingHeaders:
                async def send(self, request: HttpRequest) -> HttpResponse:
                    entered.set()
                    try: await asyncio.Future[None]()
                    finally: released.set()
                    raise AssertionError("unreachable")
            transport = PendingHeaders() if stage == "headers" else Transport(response(FIXTURE["generation"]), HttpResponse(200, {}, body)) if stage == "download" else Transport(HttpResponse(200, {}, body))
            request: TtsRequest = {"text": "Hi", "voice": "v", "model": "gen2"} if stage in ("metadata", "download") else {"text": "Hi", "voice": "v"}
            async def run() -> None:
                async with synthesize(request, auth=AUTH, transport=transport) as audio: _ = [v async for v in audio]
            task = asyncio.create_task(run())
            await asyncio.wait_for((entered if stage == "headers" else body.waiting).wait(), 1)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError): await asyncio.wait_for(task, 1)
            self.assertEqual(body.closes, 0 if stage == "headers" else 1)
            if stage == "headers": self.assertTrue(released.is_set())

    async def test_endpoint_deadline_and_message_limits(self) -> None:
        for url in ["https://user:pass@proxy.invalid", "https://proxy.invalid#", "https://proxy.invalid/%zz", "https://proxy.invalid:99999", "https://proxy.invalid/ bad"]:
            transport = Transport()
            with self.assertRaises(TypeError) as raised:
                async with synthesize({"text": "Hi", "voice": "v"}, auth=AUTH, transport=transport, base_url=url): pass
            self.assertEqual(str(raised.exception), "Invalid Murf endpoint URL")
            self.assertEqual(transport.requests, [])
        transport = Transport()
        with self.assertRaises(TimeoutError) as raised:
            async with synthesize({"text": "Hi", "voice": "v"}, auth=AUTH, transport=transport, timeout_ms=0): pass
        self.assertEqual(str(raised.exception), "Murf synthesis deadline expired")
        self.assertEqual(transport.requests, [])
        socket = Socket()
        socket.incoming.put_nowait("x" * 5)
        with self.assertRaises(TypeError) as raised:
            async with synthesize({"text": items("Hi"), "voice": "v"}, web_socket=socket, max_message_bytes=4) as audio: _ = [v async for v in audio]
        self.assertEqual(str(raised.exception), "Murf message exceeds max_message_bytes")
        self.assertEqual(socket.closes, 1)
