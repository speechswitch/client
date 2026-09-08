import asyncio
import json
import re
import unittest
from collections.abc import AsyncIterable, AsyncIterator, Awaitable, Callable, Iterator, Mapping, Sequence
from pathlib import Path
from typing import Literal, cast
from unittest.mock import patch

from speechswitch.generated.auth import Auth
from speechswitch.generated.kugelaudio import TtsRequest, TtsRequestTextVoice, TtsRequestStreamingTextVoice
from speechswitch.generated.validators.kugelaudio import validate_request
from speechswitch.http import HttpRequest, HttpResponse
from speechswitch.providers.kugelaudio import Input, KugelAudioError, synthesize
from speechswitch.validation import is_mapping, is_sequence
from speechswitch.websocket import WebSocketError
from test_websocket import server, upgrade, client_frame

FIXTURE: dict[str, object] = json.loads((Path(__file__).parents[2] / "fixtures/kugelaudio.json").read_text())
AUTH: Auth = {"kugelaudio": {"api_key": "test-key"}}
SETTINGS = cast(dict[str, object], FIXTURE["settings"])
LIVE = {**SETTINGS, "word_timestamps": False, "speaker_prefix": True, "flush_timeout_ms": 500, "max_buffer_length": 10000}


def hydrate(value: object) -> object:
    if is_mapping(value):
        return {re.sub(r"[A-Z]", lambda m: "_" + m[0].lower(), str(key)): hydrate(item) for key, item in value.items()}
    if is_sequence(value):
        return [hydrate(item) for item in value]
    return value


def request() -> TtsRequestTextVoice:
    return {"text": "Hi", "voice": "existing-custom-voice", "output": {"format": "pcm"}}


def live(text: AsyncIterable[Input]) -> TtsRequestStreamingTextVoice:
    return {"text": text, "voice": "existing-custom-voice", "output": {"format": "pcm"}}


class Source[T]:
    def __init__(self, values: Sequence[T | Exception], stall: bool = False) -> None:
        self.values, self.stall = list(values), stall
        self.pulls = self.closes = 0
        self.waiting, self.closed = asyncio.Event(), asyncio.Event()
    def __aiter__(self) -> AsyncIterator[T]:
        return self
    async def __anext__(self) -> T:
        self.pulls += 1
        if self.values:
            value = self.values.pop(0)
            if isinstance(value, Exception):
                raise value
            return value
        if self.stall:
            self.waiting.set()
            await asyncio.Future[None]()
        raise StopAsyncIteration
    async def aclose(self) -> None:
        self.closes += 1
        self.closed.set()


class Transport:
    def __init__(self, body: Source[bytes], status: int = 200, headers: Mapping[str, str] = {}) -> None:
        self.body, self.status, self.headers = body, status, headers
        self.requests: list[HttpRequest] = []
    async def send(self, request: HttpRequest) -> HttpResponse:
        self.requests.append(request)
        return HttpResponse(self.status, self.headers, self.body)


class Socket:
    def __init__(self) -> None:
        self.incoming: asyncio.Queue[str | bytes | Exception] = asyncio.Queue()
        self.sent: list[dict[object, object]] = []
        self.closed = False
        self.on_send: Callable[[dict[object, object]], Awaitable[None]] | None = None
    def event(self, value: object) -> None:
        self.incoming.put_nowait(json.dumps(value))
    async def send(self, message: str | bytes) -> None:
        assert isinstance(message, str)
        raw: object = json.loads(message)
        assert is_mapping(raw)
        packet = dict(raw)
        self.sent.append(packet)
        if self.on_send is not None:
            await self.on_send(packet)
        else:
            if "text" in packet:
                self.event(FIXTURE["audio"])
                if "voice_id" in packet:
                    self.event({"final": True, "usage": FIXTURE["usage"]})
            if "flush" in packet:
                self.event({"final": True})
                self.event({"session_closed": True})
            if "cancel" in packet:
                self.event({"interrupted": True})
            if "update_settings" in packet:
                self.event({"settings_updated": True, "settings": packet["update_settings"]})
    async def receive(self) -> str | bytes:
        value = await self.incoming.get()
        if isinstance(value, Exception):
            raise value
        return value
    async def aclose(self) -> None:
        self.closed = True


class KugelAudioTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.deadline = asyncio.timeout(5)
        await self.deadline.__aenter__()
    async def asyncTearDown(self) -> None:
        await self.deadline.__aexit__(None, None, None)

    async def test_http_streams_before_eof_and_closes_unread(self) -> None:
        body = Source([b"", b"\x01", b"\x02"], stall=True)
        transport = Transport(body)
        async with synthesize(request(), auth=AUTH, transport=transport, base_url="https://proxy.invalid/root/?tenant=one") as stream:
            self.assertEqual(await anext(stream), b"\x01")
            self.assertEqual(await anext(stream), b"\x02")
            self.assertEqual(body.pulls, 3)
        self.assertEqual(body.closes, 1)
        sent = transport.requests[0]
        self.assertEqual((sent.method, sent.url, sent.headers), ("POST", "https://proxy.invalid/root/v1/tts/generate?tenant=one", {"Authorization": "Bearer test-key", "content-type": "application/json"}))
        self.assertEqual(json.loads(sent.body), {**SETTINGS, "temperature": 0.4, "text": "Hi"})
        body = Source([b"a"])
        async with synthesize(request(), auth=AUTH, transport=Transport(body)):
            pass
        self.assertEqual((body.pulls, body.closes), (0, 1))

    async def test_models_formats_and_full_settings(self) -> None:
        models: list[Literal["kugel-3", "kugel-2.5", "kugel-2-turbo", "kugel-2", "kugel-1", "kugel-1-turbo"]] = ["kugel-3", "kugel-2.5", "kugel-2-turbo", "kugel-2", "kugel-1", "kugel-1-turbo"]
        for model in models:
            for format, rate, encoding in [("pcm", 8000, "pcm_s16le"), ("pcm", 16000, "pcm_s16le"), ("pcm", 22050, "pcm_s16le"), ("pcm", 24000, "pcm_s16le"), ("pcm", 44100, "pcm_s16le"), ("mulaw", 8000, "mulaw"), ("alaw", 8000, "alaw")]:
                req = cast(TtsRequest, {**request(), "model": model, "output": {"format": format, "sample_rate_hz": rate}, "voice": 42, "temperature": 0,
                      "speed": 1.1, "text_normalization": False, "language": "de", "voice_guidance": 1.5, "max_audio_tokens": 3,
                      "pronunciation_dictionary_selection": {"scope": 10, "ids": [7, 9]}})
                transport = Transport(Source([b"ab"]), headers={"X-Sample-Rate": str(rate), "X-Audio-Format": encoding})
                async with synthesize(req, auth=AUTH, transport=transport) as stream:
                    self.assertEqual([v async for v in stream], [b"ab"])
                self.assertEqual(json.loads(transport.requests[0].body), {"voice_id": 42, "model_id": model, "cfg_scale": 1.5, "max_new_tokens": 3, "sample_rate": rate,
                      "normalize": False, "speed": 1.1, "text": "Hi", "temperature": 0, "language": "de", "project_id": 10, "dictionary_ids": [7, 9],
                      **({} if format == "pcm" else {"output_format": "ulaw_8000" if format == "mulaw" else "alaw_8000"})})

    async def test_dictionary_omission_is_not_empty_selection(self) -> None:
        selections: list[dict[str, object]] = [{"scope": 10}, {"scope": 10, "ids": []}, {"scope": 10, "ids": [7]}]
        for selection in selections:
            transport = Transport(Source([]))
            async with synthesize(cast(TtsRequest, {**request(), "pronunciation_dictionary_selection": selection}), auth=AUTH, transport=transport) as stream:
                self.assertEqual([v async for v in stream], [])
            self.assertEqual(json.loads(transport.requests[0].body), {**SETTINGS, "text": "Hi", "temperature": 0.4, "project_id": 10,
                             **({"dictionary_ids": selection["ids"]} if "ids" in selection else {})})

    async def test_dictionary_ids_use_validated_indexed_values(self) -> None:
        class Indexed(list[float]):
            def __iter__(self) -> Iterator[float]:
                raise AssertionError("custom iterator must not replace indexed dictionary IDs")

        r: TtsRequestTextVoice = {**request(), "pronunciation_dictionary_selection": {"scope": 10, "ids": Indexed([9, 7])}}
        transport = Transport(Source([]))
        async with synthesize(r, auth=AUTH, transport=transport) as stream:
            self.assertEqual([item async for item in stream], [])
        self.assertEqual(json.loads(transport.requests[0].body), {
            **SETTINGS, "text": "Hi", "temperature": 0.4, "project_id": 10, "dictionary_ids": [9, 7],
        })
        invalid: TtsRequestTextVoice = {**request(), "pronunciation_dictionary_selection": {"scope": 10, "ids": Indexed([1.5, 2.5])}}
        transport = Transport(Source([]))
        with self.assertRaises(TypeError) as expected:
            validate_request(invalid)
        with self.assertRaises(TypeError) as raised:
            async with synthesize(invalid, auth=AUTH, transport=transport):
                self.fail("invalid IDs entered")
        self.assertEqual(raised.exception.args, expected.exception.args)
        self.assertEqual(transport.requests, [])

    async def test_regions_environment_and_explicit_auth(self) -> None:
        for key, region, base, target in [("eu-test", None, None, "https://api.eu.kugelaudio.com"), ("eu-test", "global", None, "https://api.kugelaudio.com"),
                                         ("test", "eu", None, "https://api.eu.kugelaudio.com"), ("eu-test", "eu", "https://proxy.invalid", "https://proxy.invalid")]:
            transport = Transport(Source([]))
            async with synthesize(request(), auth={"kugelaudio": {"api_key": key}}, region=cast(Literal["eu", "global"] | None, region), base_url=base, transport=transport):
                pass
            self.assertEqual(transport.requests[0].url, target + "/v1/tts/generate")
            self.assertEqual(transport.requests[0].headers["Authorization"], "Bearer test")
        for env, expected in [({"KUGELAUDIO_API_KEY": "native"}, "native"), ({"KUGELAUDIO_API_KEY": "native", "SPEECHSWITCH_KUGELAUDIO_API_KEY": "scoped"}, "scoped")]:
            with patch.dict("os.environ", env, clear=True):
                transport = Transport(Source([]))
                async with synthesize(request(), transport=transport):
                    pass
                self.assertEqual(transport.requests[0].headers["Authorization"], "Bearer " + expected)
                with self.assertRaises(TypeError) as error:
                    async with synthesize(request(), auth={"kugelaudio": {"api_key": ""}}, transport=transport):
                        self.fail("empty explicit key accepted")
                self.assertEqual(str(error.exception), "Missing auth.kugelaudio.apiKey configuration")

    async def test_turns_wait_for_session_closed_and_keep_defaults(self) -> None:
        socket = Socket()
        source: Source[Input] = Source(["Hel", "lo", {"command": "flush"}, "!"])
        async with synthesize(live(source), web_socket=socket) as stream:
            self.assertEqual([v async for v in stream], [b"\x01\x02", b"\x01\x02", {"event": "flush", "correlation_id": "0", "input_group_id": "0"},
                                                       b"\x01\x02", {"event": "flush", "correlation_id": "1", "input_group_id": "1"}])
        self.assertEqual(socket.sent, [LIVE, {"text": "Hel"}, {"text": "lo"}, {"flush": True}, {"text": "!"}, {"flush": True}, {"close_socket": True}])
        self.assertTrue(socket.closed)
        await source.closed.wait()
        self.assertEqual(source.closes, 1)

    async def test_clear_draining_turn_discards_stale_frames(self) -> None:
        socket = Socket()
        canceled = asyncio.Event()
        async def send(packet: dict[object, object]) -> None:
            if "cancel" in packet:
                for value in [FIXTURE["audio"], FIXTURE["word"], {"final": True}, {"session_closed": True}]:
                    socket.event(value)
                canceled.set()
        socket.on_send = send
        source: Source[Input] = Source(["Old", {"command": "flush"}, {"command": "clear"}, "New"])
        async with synthesize({**live(source), "timestamp_granularity": "word"}, web_socket=socket) as stream:
            task = asyncio.ensure_future(anext(stream))
            await canceled.wait()
            self.assertEqual(socket.sent, [{**LIVE, "word_timestamps": True}, {"text": "Old"}, {"flush": True}, {"cancel": True}])
            socket.on_send = None
            socket.event({"interrupted": True})
            self.assertEqual(await task, {"event": "clear"})
            self.assertEqual([v async for v in stream], [{"correlation": "ordered", "correlation_id": "1:0", "input_group_id": "1", "chunk_id": 0,
                "audio": b"\x01\x02", "audio_timing": {"start_time_ms": 0, "end_time_ms": 1 / 24}, "timestamps": []}, {"event": "flush", "correlation_id": "1", "input_group_id": "1"}])

    async def test_updates_only_specified_settings_and_wait_for_ack(self) -> None:
        source: Source[Input] = Source([{"command": "update", "voice_guidance": 1.5, "temperature": 0, "max_audio_tokens": 3, "language": "de", "text_normalization": False, "speed": 1.1}])
        socket = Socket()
        async with synthesize(live(source), web_socket=socket) as stream:
            self.assertEqual([v async for v in stream], [{"event": "updated", "voice_guidance": 1.5, "temperature": 0, "max_audio_tokens": 3, "language": "de", "text_normalization": False, "speed": 1.1}])
        self.assertEqual(socket.sent, [LIVE, {"update_settings": {"cfg_scale": 1.5, "temperature": 0, "max_new_tokens": 3, "language": "de", "normalize": False, "speed": 1.1}}, {"close_socket": True}])

    async def test_static_socket_timestamp_correlation_and_usage_fixture(self) -> None:
        socket = Socket()
        async def send(_: dict[object, object]) -> None:
            for packet in [FIXTURE["audio"], FIXTURE["audio"], FIXTURE["word"], {"final": True, "usage": FIXTURE["usage"]}]:
                socket.event(packet)
        socket.on_send = send
        async with synthesize({**request(), "timestamp_granularity": "word"}, web_socket=socket) as stream:
            items = [v async for v in stream]
        group = {"correlation": "ordered", "correlation_id": "0:0", "input_group_id": "0", "chunk_id": 0}
        self.assertEqual(items, [{**group, "audio": b"\x01\x02", "audio_timing": {"start_time_ms": 0, "end_time_ms": 1 / 24}, "timestamps": []},
            {**group, "audio": b"\x01\x02", "audio_timing": {"start_time_ms": 1 / 24, "end_time_ms": 2 / 24}, "timestamps": []},
            {**group, "timestamps": hydrate(FIXTURE["timestamps"])}, {"event": "done", "usage": hydrate(FIXTURE["billing"])}])
        self.assertEqual(socket.sent, [{**SETTINGS, "temperature": 0.4, "text": "Hi", "word_timestamps": True, "speaker_prefix": True}])

    async def test_empty_input_and_idle_controls(self) -> None:
        cases: list[list[Input]] = [[], [""], [{"command": "flush"}], [{"command": "clear"}]]
        for values in cases:
            socket = Socket()
            source: Source[Input] = Source(values)
            async with synthesize(live(source), web_socket=socket) as stream:
                self.assertEqual([v async for v in stream], [{"event": "clear"}] if values == [{"command": "clear"}] else [])
            self.assertEqual(socket.sent[-1], {"close_socket": True})

    async def test_backpressured_send_does_not_block_audio(self) -> None:
        socket = Socket()
        blocked = asyncio.Event()
        async def send(packet: dict[object, object]) -> None:
            if "text" in packet:
                socket.event(FIXTURE["audio"])
                blocked.set()
                await asyncio.Future[None]()
        socket.on_send = send
        source: Source[Input] = Source(["Hi", "Later"])
        async with synthesize(live(source), web_socket=socket) as stream:
            self.assertEqual(await anext(stream), b"\x01\x02")
            self.assertTrue(blocked.is_set())
            self.assertEqual(source.pulls, 1)
        self.assertTrue(socket.closed)
        await source.closed.wait()

    async def test_native_header_auth_and_proxy_path(self) -> None:
        captured: list[tuple[bytes, dict[bytes, bytes]]] = []
        disconnected = asyncio.Event()
        async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            captured.append(await upgrade(reader, writer))
            for expected in [LIVE, {"text": "Hi"}, {"flush": True}, {"close_socket": True}]:
                opcode, data = await client_frame(reader)
                self.assertEqual((opcode, json.loads(data)), (1, expected))
                packets = [FIXTURE["audio"]] if expected == {"text": "Hi"} else [{"final": True}, {"session_closed": True}] if expected == {"flush": True} else []
                for packet in packets:
                    encoded = json.dumps(packet, separators=(",", ":")).encode()
                    self.assertLess(len(encoded), 126)
                    writer.write(bytes([0x81, len(encoded)]) + encoded)
                await writer.drain()
            await reader.read()
            disconnected.set()
        async with server(handle) as root:
            source: Source[Input] = Source(["Hi"])
            async with synthesize(live(source), auth={"kugelaudio": {"api_key": "eu-test-key"}}, web_socket_url=root + "/proxy%2Fsocket?tenant=one") as stream:
                self.assertEqual([v async for v in stream], [b"\x01\x02", {"event": "flush", "correlation_id": "0", "input_group_id": "0"}])
            await disconnected.wait()
        self.assertEqual(len(captured), 1)
        line, headers = captured[0]
        self.assertEqual(line, b"GET /proxy%2Fsocket?tenant=one HTTP/1.1")
        self.assertEqual(headers.get(b"authorization"), b"Bearer test-key")
        self.assertEqual(headers.get(b"sec-websocket-protocol"), None)

    async def test_cancellation_and_deadline_release_network(self) -> None:
        for timed in [False, True]:
            body: Source[bytes] = Source([], stall=True)
            with self.assertRaises(TimeoutError if timed else asyncio.CancelledError) as error:
                async with synthesize(request(), auth=AUTH, transport=Transport(body), timeout_ms=10 if timed else None) as stream:
                    task = asyncio.ensure_future(anext(stream))
                    await body.waiting.wait()
                    if not timed:
                        task.cancel()
                    await task
            if timed:
                self.assertEqual(str(error.exception), "KugelAudio synthesis deadline expired")
            self.assertEqual(body.closes, 1)
        source: Source[Input] = Source([], stall=True)
        socket = Socket()
        with self.assertRaises(TimeoutError) as error:
            async with synthesize(live(source), web_socket=socket, timeout_ms=10) as stream:
                await anext(stream)
        self.assertEqual(str(error.exception), "KugelAudio synthesis deadline expired")
        self.assertTrue(socket.closed)
        await source.closed.wait()

    async def test_http_errors_headers_and_limits(self) -> None:
        body = Source([b'{"error":"quota","error_code":"QUOTA"}'])
        with self.assertRaises(KugelAudioError) as error:
            async with synthesize(request(), auth=AUTH, transport=Transport(body, 429, {"Retry-After": "3"})):
                self.fail("HTTP error entered")
        self.assertEqual((str(error.exception), error.exception.status_code, error.exception.code, error.exception.retry_after), ("quota", 429, "QUOTA", "3"))
        self.assertEqual(body.closes, 1)
        for headers in [{"x-sample-rate": "8000"}, {"x-sample-rate": "NaN"}, {"x-audio-format": "mp3"}]:
            body = Source([b"a"])
            with self.assertRaises(TypeError) as error:
                async with synthesize(request(), auth=AUTH, transport=Transport(body, headers=headers)):
                    self.fail("invalid format entered")
            self.assertEqual(str(error.exception), "KugelAudio returned an unexpected audio format")
            self.assertEqual(body.closes, 1)
        with self.assertRaises(TypeError) as error:
            async with synthesize(request(), auth=AUTH, transport=Transport(Source([b"abcd"]), 500), max_json_bytes=3):
                self.fail("oversized error entered")
        self.assertEqual(str(error.exception), "KugelAudio response exceeds max_json_bytes")

    async def test_malformed_frames_and_native_error_identity(self) -> None:
        audio = cast(dict[str, object], FIXTURE["audio"])
        cases: list[tuple[object, str]] = [
            ({}, "KugelAudio returned an invalid event"),
            ({"final": False}, "KugelAudio returned an invalid event flag"),
            ({"session_closed": True}, "KugelAudio ended a turn before final"),
            ({"interrupted": True}, "KugelAudio returned an unsolicited interruption"),
            ({"settings_updated": True, "settings": {}}, "KugelAudio returned an unsolicited settings acknowledgement"),
            ({**audio, "samples": 2}, "KugelAudio audio size disagrees with its sample count"),
            ({**audio, "sr": True}, "KugelAudio returned an unexpected audio format"),
            ({**audio, "audio": "?"}, "KugelAudio returned invalid base64 audio"),
            ({"word_timestamps": [], "chunk_id": 0}, "KugelAudio returned unrequested timestamps"),
            ({"final": True, "usage": {"audio_seconds": 1, "characters": 2, "cost_cents": None}}, "KugelAudio omitted its cost-unavailable indicator"),
        ]
        for packet, expected in cases:
            socket = Socket()
            async def send(_: dict[object, object]) -> None:
                socket.event(packet)
            socket.on_send = send
            with self.assertRaises(TypeError) as error:
                async with synthesize(request(), web_socket=socket) as stream:
                    await anext(stream)
            self.assertEqual(str(error.exception), expected)
            self.assertTrue(socket.closed)
        socket = Socket()
        async def fail(_: dict[object, object]) -> None:
            socket.event({"error": "bad voice", "error_code": "VOICE_NOT_FOUND", "code": 404})
        socket.on_send = fail
        with self.assertRaises(KugelAudioError) as error:
            async with synthesize(request(), web_socket=socket) as stream:
                await anext(stream)
        self.assertEqual((str(error.exception), error.exception.status_code, error.exception.code), ("bad voice", 404, "VOICE_NOT_FOUND"))

    async def test_generated_validation_happens_before_io(self) -> None:
        for invalid in [{"output": {"format": "mp3"}}, {"output": {"format": "mulaw", "sample_rate_hz": 24000}}, {"voice_boost": "yes"}, {"temperature": 2}, {"text_flush_delay_ms": 1}]:
            transport = Transport(Source([]))
            r = cast(TtsRequest, {**request(), **invalid})
            with self.assertRaises(TypeError) as expected:
                validate_request(r)
            with self.assertRaises(TypeError) as error:
                async with synthesize(r, transport=transport):
                    self.fail("invalid request entered")
            self.assertEqual(error.exception.args, expected.exception.args)
            self.assertEqual(transport.requests, [])
        for value in [{"command": "update", "voice": "other"}, {"command": "update", "temperature": 2}, {"command": "bad"}]:
            socket = Socket()
            source = Source([cast(Input, value)])
            r = live(source)
            validate = validate_request(r)
            with self.assertRaises(TypeError) as expected:
                validate(value)
            with self.assertRaises(TypeError) as error:
                async with synthesize(r, web_socket=socket) as stream:
                    await anext(stream)
            self.assertEqual(error.exception.args, expected.exception.args)
            self.assertEqual(socket.sent, [LIVE])

    async def test_delayed_turn_and_update_acknowledgements(self) -> None:
        socket = Socket()
        flushed = asyncio.Event()
        async def send(packet: dict[object, object]) -> None:
            if "flush" in packet:
                socket.event({"final": True})
                flushed.set()
        socket.on_send = send
        source: Source[Input] = Source(["First", {"command": "flush"}, "Next"])
        async with synthesize(live(source), web_socket=socket) as stream:
            task = asyncio.ensure_future(anext(stream))
            await flushed.wait()
            # The lookahead may already hold Next, but it cannot cross this boundary.
            await asyncio.sleep(0)
            self.assertEqual(socket.sent, [LIVE, {"text": "First"}, {"flush": True}])
            socket.event({"session_closed": True})
            self.assertEqual(await task, {"event": "flush", "correlation_id": "0", "input_group_id": "0"})
            socket.on_send = None
            self.assertEqual([v async for v in stream], [b"\x01\x02", {"event": "flush", "correlation_id": "1", "input_group_id": "1"}])
        socket = Socket()
        updated = asyncio.Event()
        async def update(packet: dict[object, object]) -> None:
            if "update_settings" in packet:
                updated.set()
        socket.on_send = update
        source = Source([{"command": "update", "speed": 1.1}])
        async with synthesize(live(source), web_socket=socket) as stream:
            task = asyncio.ensure_future(anext(stream))
            await updated.wait()
            await asyncio.sleep(0)
            self.assertEqual(socket.sent, [LIVE, {"update_settings": {"speed": 1.1}}])
            socket.event({"settings_updated": True, "settings": {"speed": 1.1}})
            self.assertEqual(await task, {"event": "updated", "speed": 1.1})
            self.assertEqual([v async for v in stream], [])
            self.assertEqual(socket.sent[-1], {"close_socket": True})

    async def test_idle_auto_end_preserves_warning_and_next_turn(self) -> None:
        socket = Socket()
        resume = asyncio.Event()
        warnings: list[str] = []
        async def text() -> AsyncIterator[Input]:
            yield "First"
            await resume.wait()
            yield "Next"
        async def send(packet: dict[object, object]) -> None:
            if packet.get("text") == "First":
                for value in [{"warning": "idle"}, {"final": True}, {"session_closed": True, "usage": {"audio_seconds": 1, "characters": 5, "cost_cents": None, "cost_unavailable": True}}]:
                    socket.event(value)
        socket.on_send = send
        async with synthesize(live(text()), web_socket=socket, on_warning=warnings.append) as stream:
            self.assertEqual(await anext(stream), {"event": "flush", "correlation_id": "0", "input_group_id": "0", "usage": {"audio_seconds": 1, "characters": 5, "cost_cents": None}})
            self.assertEqual(warnings, ["idle"])
            socket.on_send = None
            resume.set()
            self.assertEqual([v async for v in stream], [b"\x01\x02", {"event": "flush", "correlation_id": "1", "input_group_id": "1"}])

    async def test_failure_identity_and_uncooperative_producer_cleanup(self) -> None:
        failure = RuntimeError("original failure")
        for source_failure in [True, False]:
            socket = Socket()
            source: Source[Input] = Source([failure] if source_failure else [], stall=True)
            if not source_failure:
                socket.incoming.put_nowait(failure)
            with self.assertRaises(RuntimeError) as error:
                async with synthesize(live(source), web_socket=socket) as stream:
                    await anext(stream)
            self.assertIs(error.exception, failure)
            self.assertTrue(socket.closed)
            await source.closed.wait()
        socket = Socket()
        release, waiting, closed = asyncio.Event(), asyncio.Event(), asyncio.Event()
        class Stubborn:
            def __aiter__(self) -> AsyncIterator[Input]:
                return self
            async def __anext__(self) -> Input:
                waiting.set()
                try:
                    await asyncio.Future[None]()
                except asyncio.CancelledError:
                    await release.wait()
                raise StopAsyncIteration
            async def aclose(self) -> None:
                closed.set()
        try:
            async with synthesize(live(Stubborn()), web_socket=socket) as stream:
                task = asyncio.ensure_future(anext(stream))
                await waiting.wait()
                socket.incoming.put_nowait(failure)
                with self.assertRaises(RuntimeError) as error:
                    await task
                self.assertIs(error.exception, failure)
            self.assertTrue(socket.closed)
            self.assertFalse(closed.is_set())
        finally:
            release.set()
        await closed.wait()

    async def test_socket_limits_utf16_input_and_unexpected_eof(self) -> None:
        for packet, expected in [(b"binary", "KugelAudio returned a non-text WebSocket frame"), ("NaN", "KugelAudio returned invalid JSON"),
                                 ("x" * 513, "KugelAudio message exceeds max_message_bytes"), (StopAsyncIteration(), "KugelAudio WebSocket closed before synthesis completed")]:
            socket = Socket()
            async def send(_: dict[object, object]) -> None:
                socket.incoming.put_nowait(packet)
            socket.on_send = send
            with self.assertRaises(TypeError) as error:
                async with synthesize(request(), web_socket=socket, max_message_bytes=512) as stream:
                    await anext(stream)
            self.assertEqual(str(error.exception), expected)
        source: Source[Input] = Source(["😀" * 5001])
        socket = Socket()
        with self.assertRaises(TypeError) as error:
            async with synthesize(live(source), web_socket=socket) as stream:
                await anext(stream)
        self.assertEqual(str(error.exception), "KugelAudio text fragments must not exceed 10000 characters")
        self.assertEqual(socket.sent, [LIVE])

    async def test_boundary_validation_and_unread_socket(self) -> None:
        socket = Socket()
        source: Source[Input] = Source(["Hi"])
        async with synthesize(live(source), web_socket=socket):
            pass
        self.assertEqual((socket.sent, socket.closed, source.pulls), ([], True, 0))
        for url in ["https://user:secret@host", "https://host:99999", "https://host/%xx", "https://host/#fragment", "https://host/\npath", "file:///tmp/provider"]:
            with self.assertRaises(TypeError) as error:
                async with synthesize(request(), auth=AUTH, base_url=url):
                    self.fail("invalid URL entered")
            self.assertEqual(str(error.exception), "Invalid KugelAudio endpoint URL")
        for invalid, expected in [({"voice": " "}, "KugelAudio voice must be a nonempty handle or an integer ID"),
                                  ({"voice": 1.5}, "KugelAudio voice must be a nonempty handle or an integer ID"),
                                  ({"max_audio_tokens": 1.5}, None),
                                  ({"pronunciation_dictionary_selection": {"scope": 10, "ids": list(range(51))}}, None)]:
            r = cast(TtsRequest, {**request(), **invalid})
            if expected is None:
                with self.assertRaises(TypeError) as generated:
                    validate_request(r)
                expected = str(generated.exception)
            with self.assertRaises(TypeError) as error:
                async with synthesize(r, auth=AUTH):
                    self.fail("invalid boundary value entered")
            self.assertEqual(str(error.exception), expected)

    async def test_native_rejection_never_acquires_input(self) -> None:
        disconnected = asyncio.Event()
        async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            await reader.readuntil(b"\r\n\r\n")
            writer.write(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
            await writer.drain()
            await reader.read()
            disconnected.set()
        source: Source[Input] = Source([], stall=True)
        async with server(handle) as root:
            with self.assertRaises(WebSocketError) as error:
                async with synthesize(live(source), auth=AUTH, web_socket_url=root):
                    self.fail("rejected socket entered")
            self.assertEqual(str(error.exception), "WebSocket handshake was not accepted")
            await disconnected.wait()
        self.assertEqual((source.pulls, source.closes), (0, 0))

    async def test_native_cancel_disconnects_stalled_input(self) -> None:
        configured, disconnected = asyncio.Event(), asyncio.Event()
        async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            await upgrade(reader, writer)
            opcode, data = await client_frame(reader)
            self.assertEqual((opcode, json.loads(data)), (1, LIVE))
            configured.set()
            self.assertEqual(await client_frame(reader), (8, b"\x03\xe8"))
            await reader.read()
            disconnected.set()
        source: Source[Input] = Source([], stall=True)
        async with server(handle) as root:
            async with synthesize(live(source), auth=AUTH, web_socket_url=root) as stream:
                task = asyncio.ensure_future(anext(stream))
                await configured.wait()
                await source.waiting.wait()
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task
            await disconnected.wait()
        await source.closed.wait()
        self.assertEqual(source.closes, 1)
