import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from contextlib import asynccontextmanager
import json
import os
from pathlib import Path
from typing import cast
import unittest
from unittest.mock import patch

from speechswitch.clients import google_grpc as proto
from speechswitch.generated.auth import Auth
from speechswitch.generated.google import TtsRequest, TtsRequestTurnsTurnsItem as Turn, TtsRequestObject8dbffa0cTurnsAsyncIterableItem as StreamTurn
from speechswitch.grpc import GrpcError
from speechswitch.http import HttpRequest, HttpResponse
from speechswitch.providers.google import GoogleError, synthesize
from test_google_protobuf import snake


AUTH: Auth = {"google": {"api_key": "key", "access_token": "token", "quota_project": "quota"}}


def request(**fields: object) -> TtsRequest:
    return cast(TtsRequest, {"model": "gemini-2.5-flash-tts", "voice": "Kore", "language": "en-US", "text": "hello", "output": {"format": "pcm"}, **fields})


class Source:
    def __init__(self, values: Sequence[object], stall: bool = False) -> None:
        self.values = iter(values)
        self.stall = stall
        self.acquired = self.pulls = self.closes = 0
        self.pending, self.closed = asyncio.Event(), asyncio.Event()
        self.close_gate: asyncio.Event | None = None

    def __aiter__(self) -> AsyncIterator[str | Turn]:
        self.acquired += 1
        return self

    async def __anext__(self) -> str | Turn:
        self.pulls += 1
        try:
            return cast(str | Turn, next(self.values))
        except StopIteration:
            if self.stall:
                self.pending.set()
                await asyncio.Future[None]()
            raise StopAsyncIteration from None

    async def aclose(self) -> None:
        self.closes += 1
        self.closed.set()
        if self.close_gate is not None:
            await self.close_gate.wait()


class Grpc:
    def __init__(self) -> None:
        self.sent: list[bytes] = []
        self.queue: asyncio.Queue[bytes | Exception | None] = asyncio.Queue()
        self.ends = self.closes = 0
        self.closed = asyncio.Event()
        self.on_send: Callable[[bytes], Awaitable[None]] | None = None
        self.close_error: Exception | None = None

    async def send(self, message: bytes) -> None:
        self.sent.append(message)
        if self.on_send is not None:
            await self.on_send(message)
        elif len(self.sent) > 1:
            self.queue.put_nowait(proto.encode_streaming_synthesize_response({"audio_content": b"audio"}))

    async def end(self) -> None:
        self.ends += 1
        self.queue.put_nowait(None)

    async def receive(self) -> bytes:
        value = await self.queue.get()
        if value is None:
            raise StopAsyncIteration
        if isinstance(value, Exception):
            raise value
        return value

    async def aclose(self) -> None:
        if self.closes == 0:
            self.closes = 1
            self.closed.set()
            self.queue.put_nowait(None)
        if self.close_error is not None:
            raise self.close_error


class Body:
    def __init__(self, data: bytes = b'{"audioContent":"YXVkaW8="}', stall: bool = False) -> None:
        self.parts = iter([data[:3], data[3:]])
        self.stall = stall
        self.closes = self.reads = 0
        self.pending = asyncio.Event()

    def __aiter__(self) -> AsyncIterator[bytes]:
        return self

    async def __anext__(self) -> bytes:
        self.reads += 1
        if self.stall:
            self.pending.set()
            await asyncio.Future[None]()
        try:
            return next(self.parts)
        except StopIteration:
            raise StopAsyncIteration from None

    async def aclose(self) -> None:
        self.closes += 1


class Http:
    def __init__(self, body: Body | None = None, status: int = 200) -> None:
        self.body = body if body is not None else Body()
        self.status = status
        self.calls: list[HttpRequest] = []

    async def send(self, request: HttpRequest) -> HttpResponse:
        self.calls.append(request)
        return HttpResponse(self.status, {}, self.body)


class GoogleTests(unittest.IsolatedAsyncioTestCase):
    async def test_all_canonical_branches_are_typed_and_executable(self) -> None:
        async def text() -> AsyncIterator[str]:
            yield "hello"
        async def turns() -> AsyncIterator[StreamTurn]:
            yield {"speaker": "A", "text": "hello"}
        requests: list[TtsRequest] = [
            {"model": "gemini-2.5-flash-lite-preview-tts", "language": "es-419", "voice": "Kore", "text": "hello", "output": {"format": "mp3", "bit_rate_bps": 32000}},
            {"model": "gemini-3.1-flash-tts-preview", "language": "cmn-tw", "voice": "Kore", "text": text(), "output": {"format": "pcm", "sample_rate_hz": 24000}},
            {"model": "gemini-2.5-flash-tts", "language": "en-US", "speakers": [{"alias": "A", "voice": "Kore"}, {"alias": "B", "voice": "Puck"}], "text": "A: hello", "output": {"format": "wav"}},
            {"model": "gemini-2.5-pro-tts", "language": "en-US", "speakers": [{"alias": "A", "voice": "Kore"}, {"alias": "B", "voice": "Puck"}], "text": text(), "output": {"format": "alaw"}},
            {"model": "gemini-2.5-pro-tts", "language": "en-US", "speakers": [{"alias": "A", "voice": "Kore"}, {"alias": "B", "voice": "Puck"}], "turns": [{"speaker": "A", "text": "hello"}], "output": {"format": "wav", "sample_encoding": "mulaw"}},
            {"model": "gemini-2.5-pro-tts", "language": "en-US", "speakers": [{"alias": "A", "voice": "Kore"}, {"alias": "B", "voice": "Puck"}], "turns": turns(), "output": {"format": "ogg_opus"}},
            {"model": "chirp-3-hd", "language": "en-US", "voice": "Kore", "text": "hello", "input_type": "ssml", "output": {"format": "wav"}},
            {"model": "chirp-3-hd", "language": "ja-JP", "voice": "Kore", "text": text(), "input_type": "markup", "replacements": [{"pattern": "名前", "replacement": "ナマエ", "alphabet": "japanese_yomigana"}], "output": {"format": "pcm"}},
            {"model": "chirp-3-hd", "language": "bn-IN", "voice": "Kore", "text": "hello", "input_type": "ssml", "output": {"format": "mp3"}},
            {"model": "chirp-3-hd", "language": "bn-IN", "voice": "Kore", "text": text(), "input_type": "markup", "output": {"format": "mulaw"}},
            {"model": "chirp-3-hd", "language": "bg-BG", "voice": "Kore", "text": "hello", "input_type": "ssml", "output": {"format": "ogg_opus"}},
            {"model": "chirp-3-hd", "language": "bg-BG", "voice": "Kore", "text": text(), "output": {"format": "pcm"}},
            {"model": "chirp-3-instant-custom-voice", "language": "en-US", "voice": "existing-key", "text": "hello", "input_type": "markup", "output": {"format": "wav"}},
            {"model": "chirp-3-instant-custom-voice", "language": "cmn-CN", "voice": "existing-key", "text": text(), "input_type": "markup", "replacements": [{"pattern": "名", "replacement": "ming2", "alphabet": "pinyin"}], "output": {"format": "pcm"}},
            {"model": "chirp-3-instant-custom-voice", "language": "bn-IN", "voice": "existing-key", "text": "hello", "input_type": "markup", "output": {"format": "wav"}},
            {"model": "chirp-3-instant-custom-voice", "language": "bn-IN", "voice": "existing-key", "text": text(), "input_type": "markup", "output": {"format": "alaw"}},
        ]
        for normalized in requests:
            with self.subTest(model=normalized["model"], language=normalized["language"]):
                async with synthesize(normalized, auth=AUTH, grpc=Grpc(), transport=Http()) as audio:
                    self.assertEqual([chunk async for chunk in audio], [b"audio"])

    async def test_shared_normalized_wire_fixtures(self) -> None:
        fixtures = cast(list[dict[str, object]], json.loads((Path(__file__).parents[2] / "fixtures/google.json").read_text()))
        for fixture in fixtures:
            normalized = cast(TtsRequest, snake(fixture["request"]))
            grpc, http = Grpc(), Http()
            with self.subTest(name=fixture["name"]):
                async with synthesize(normalized, auth=AUTH, grpc=grpc, transport=http, base_url="https://proxy.invalid/google/?tenant=one") as audio:
                    self.assertEqual([chunk async for chunk in audio], [b"audio"])
                if "body" in fixture:
                    self.assertEqual(grpc.sent, [])
                    self.assertEqual(len(http.calls), 1)
                    call = http.calls[0]
                    self.assertEqual((call.method, call.url, dict(call.headers)), ("POST", f"https://proxy.invalid/google{fixture['path']}?tenant=one", {"x-goog-api-key": "key", "authorization": "Bearer token", "x-goog-user-project": "quota", "content-type": "application/json"}))
                    self.assertEqual(json.loads(call.body), fixture["body"])
                    self.assertEqual(http.body.closes, 1)
                else:
                    self.assertEqual(http.calls, [])
                    self.assertEqual(grpc.sent, [proto.encode_streaming_request(cast(proto.StreamingSynthesizeRequest, snake(item))) for item in cast(list[object], fixture["messages"])])
                    self.assertEqual((grpc.ends, grpc.closes), (1, 1))

    async def test_incremental_input_first_prompt_and_close_before_stalled_cleanup(self) -> None:
        source, grpc = Source(["one", "two"], stall=True), Grpc()
        source.close_gate = asyncio.Event()
        async with synthesize(request(text=source, instructions="Cheerful"), auth=AUTH, grpc=grpc) as audio:
            self.assertEqual(await anext(audio), b"audio")
            self.assertEqual(await anext(audio), b"audio")
            await source.pending.wait()
            self.assertEqual(grpc.ends, 0)
        await asyncio.wait_for(source.closed.wait(), 1)
        self.assertEqual((grpc.closes, source.acquired, source.closes), (1, 1, 1))
        self.assertEqual(grpc.sent[1:], [proto.encode_streaming_request({"input": {"text": "one", "prompt": "Cheerful"}}), proto.encode_streaming_request({"input": {"text": "two"}})])
        source.close_gate.set()
        await asyncio.sleep(0)

    async def test_output_continues_during_write_backpressure(self) -> None:
        grpc = Grpc()
        release = asyncio.Event()
        async def send(_: bytes) -> None:
            if len(grpc.sent) > 1:
                grpc.queue.put_nowait(proto.encode_streaming_synthesize_response({"audio_content": b"early"}))
                await release.wait()
        grpc.on_send = send
        async with synthesize(request(), auth=AUTH, grpc=grpc) as audio:
            self.assertEqual(await anext(audio), b"early")
            self.assertEqual(grpc.ends, 0)
            release.set()
            self.assertEqual([chunk async for chunk in audio], [])
        self.assertEqual(grpc.ends, 1)

    async def test_streamed_turns_validate_references_and_prompt_only_first(self) -> None:
        source, grpc = Source([{"speaker": "Sam", "text": "Hi"}, {"speaker": "Bob", "text": "Hello"}]), Grpc()
        normalized: TtsRequest = {"model": "gemini-2.5-pro-tts", "language": "en-US", "speakers": [{"alias": "Sam", "voice": "Kore"}, {"alias": "Bob", "voice": "Puck"}], "turns": cast(AsyncIterator[StreamTurn], source), "instructions": "Warmly", "output": {"format": "pcm"}}
        async with synthesize(normalized, auth=AUTH, grpc=grpc) as audio:
            self.assertEqual([chunk async for chunk in audio], [b"audio", b"audio"])
        self.assertEqual(grpc.sent[1:], [proto.encode_streaming_request({"input": {"multi_speaker_markup": {"turns": [{"speaker": "Sam", "text": "Hi"}]}, "prompt": "Warmly"}}), proto.encode_streaming_request({"input": {"multi_speaker_markup": {"turns": [{"speaker": "Bob", "text": "Hello"}]}}})])

    async def test_invalid_requests_use_generated_guards_before_io(self) -> None:
        for fields in [
            {"model": "gemini-2.5-flash-lite-tts"}, {"model": "chirp-3-hd", "instructions": "Happy"},
            {"model": "chirp-3-hd", "language": "bg-BG", "input_type": "markup"},
            {"model": "chirp-3-instant-custom-voice", "output": {"format": "mp3"}},
            {"output": {"format": "mp3", "bit_rate_bps": 128000}}, {"output": {"format": "pcm", "sample_rate_hz": 24000.5}},
            {"output": {"format": "pcm", "sample_rate_hz": True}}, {"speed": 2.1}, {"text_normalization": None},
            {"text": Source([]), "output": {"format": "wav"}}, {"text": Source([]), "volume_db": 0},
        ]:
            grpc, http = Grpc(), Http()
            with self.subTest(fields=fields), self.assertRaises(TypeError) as caught:
                async with synthesize(request(**fields), auth=AUTH, grpc=grpc, transport=http):
                    self.fail("accepted invalid request")
            self.assertEqual(str(caught.exception), "Invalid google TTS request")
            self.assertEqual((grpc.sent, http.calls), ([], []))

    async def test_protocol_invariants_and_utf8_limits(self) -> None:
        for fields, message in [
            ({"text": "😀" * 1001}, "Google input exceeds 4000 UTF-8 bytes"),
            ({"instructions": "😀" * 1001}, "Google input exceeds 4000 UTF-8 bytes"),
            ({"safety_settings": [{"category": "harassment", "threshold": "low"}] * 2}, "Google safety categories must be unique"),
        ]:
            with self.assertRaises(TypeError) as caught:
                async with synthesize(request(**fields), auth=AUTH):
                    self.fail("accepted invalid protocol value")
            self.assertEqual(str(caught.exception), message)
        for speakers, turns, message in [
            ([{"alias": "Sam", "voice": "Kore"}], [{"speaker": "Sam", "text": "Hi"}], "Invalid google TTS request"),
            ([{"alias": "Sam", "voice": "Kore"}] * 2, [{"speaker": "Sam", "text": "Hi"}], "Google dialogue requires exactly two distinct speaker aliases"),
            ([{"alias": "Sam", "voice": "Kore"}, {"alias": "Bob", "voice": "Puck"}], [], "Google dialogue turns must not be empty"),
            ([{"alias": "Sam", "voice": "Kore"}, {"alias": "Bob", "voice": "Puck"}], [{"speaker": "Unknown", "text": "Hi"}], "Google dialogue references an unknown speaker: Unknown"),
        ]:
            normalized = cast(TtsRequest, {"model": "gemini-2.5-pro-tts", "language": "en-US", "speakers": speakers, "turns": turns, "output": {"format": "pcm"}})
            with self.assertRaises(TypeError) as caught:
                async with synthesize(normalized, auth=AUTH):
                    self.fail("accepted invalid dialogue")
            self.assertEqual(str(caught.exception), message)
        async with synthesize(request(text="😀" * 1000, instructions="😀" * 1000), auth=AUTH, grpc=Grpc()) as audio:
            self.assertEqual([item async for item in audio], [b"audio"])

    async def test_invalid_items_and_early_completion_release_transport(self) -> None:
        for item in [None, {"command": "clear"}, {"command": "flush"}, "😀" * 1001]:
            source, grpc = Source([item]), Grpc()
            with self.assertRaises(TypeError) as caught:
                async with synthesize(request(text=source), auth=AUTH, grpc=grpc) as audio:
                    await anext(audio)
            self.assertEqual(str(caught.exception), "Google input exceeds 4000 UTF-8 bytes" if isinstance(item, str) else "Invalid google TTS input item")
            await asyncio.wait_for(source.closed.wait(), 1)
            self.assertEqual((len(grpc.sent), grpc.closes, source.closes), (1, 1, 1))
        grpc = Grpc()
        async def early(_: bytes) -> None:
            grpc.queue.put_nowait(None)
            await asyncio.Future[None]()
        grpc.on_send = early
        with self.assertRaises(TypeError) as caught:
            async with synthesize(request(), auth=AUTH, grpc=grpc) as audio:
                await anext(audio)
        self.assertEqual(str(caught.exception), "Google completed before the input stream ended")

    async def test_incremental_turn_references_and_commands_are_checked_before_send(self) -> None:
        for item, error in [({"speaker": "Unknown", "text": "hello"}, "Google dialogue references an unknown speaker: Unknown"), ({"command": "clear"}, "Invalid google TTS input item")]:
            source, grpc = Source([item]), Grpc()
            normalized = cast(TtsRequest, {"model": "gemini-2.5-pro-tts", "language": "en-US", "speakers": [{"alias": "A", "voice": "Kore"}, {"alias": "B", "voice": "Puck"}], "turns": source, "output": {"format": "pcm"}})
            with self.assertRaises(TypeError) as caught:
                async with synthesize(normalized, auth=AUTH, grpc=grpc) as audio:
                    await anext(audio)
            self.assertEqual(str(caught.exception), error)
            await asyncio.wait_for(source.closed.wait(), 1)
            self.assertEqual((len(grpc.sent), grpc.closes, source.closes), (1, 1, 1))

    async def test_config_input_and_response_byte_limits(self) -> None:
        for phase in ("config", "input", "response"):
            grpc = Grpc()
            limit = 1 if phase == "config" else 128
            if phase == "response":
                grpc.queue.put_nowait(proto.encode_streaming_synthesize_response({"audio_content": bytes(129)}))
            with self.assertRaises(TypeError) as caught:
                async with synthesize(request(text="x" * (129 if phase == "input" else 1)), auth=AUTH, grpc=grpc, max_message_bytes=limit) as audio:
                    await anext(audio)
            self.assertEqual(str(caught.exception), "Google gRPC message exceeds max_message_bytes")
            self.assertEqual(grpc.closes, 1)
            if phase != "response":
                self.assertEqual(len(grpc.sent), 0 if phase == "config" else 1)

    async def test_opening_cancellation_and_transport_errors_preserve_identity(self) -> None:
        for native in (False, True):
            closed = asyncio.Event()
            @asynccontextmanager
            async def opening(url: str, *, headers: dict[str, str], max_message_bytes: int) -> AsyncIterator[Grpc]:
                try:
                    await asyncio.Future[None]()
                    yield Grpc()
                finally:
                    closed.set()
            class PendingHttp:
                async def send(self, request: HttpRequest) -> HttpResponse:
                    try:
                        await asyncio.Future[None]()
                        raise AssertionError("unreachable")
                    finally:
                        closed.set()
            with patch("speechswitch.providers.google.connect_grpc", opening), self.assertRaises(TimeoutError) as caught:
                async with synthesize(request(output={"format": "pcm" if native else "wav"}), auth=AUTH, transport=PendingHttp(), timeout_ms=20):
                    self.fail("opened stalled transport")
            self.assertEqual(str(caught.exception), "Google synthesis deadline expired")
            self.assertTrue(closed.is_set())
        failure = TimeoutError("transport's own timeout")
        class FailedHttp:
            async def send(self, request: HttpRequest) -> HttpResponse:
                raise failure
        with self.assertRaises(TimeoutError) as caught:
            async with synthesize(request(output={"format": "wav"}), auth=AUTH, transport=FailedHttp(), timeout_ms=1000):
                self.fail("accepted failed transport")
        self.assertIs(caught.exception, failure)

    async def test_deadlines_own_pending_input_write_http_and_idle_context(self) -> None:
        for phase in ("input", "write", "idle"):
            source, grpc = Source([], stall=True), Grpc()
            if phase == "write":
                async def send(_: bytes) -> None:
                    await asyncio.Future[None]()
                grpc.on_send = send
            with self.assertRaises(TimeoutError) as caught:
                async with synthesize(request(text=source), auth=AUTH, grpc=grpc, timeout_ms=20) as audio:
                    if phase != "idle":
                        await anext(audio)
                    else:
                        await asyncio.Future[None]()
            self.assertEqual(str(caught.exception), "Google synthesis deadline expired")
            self.assertEqual(grpc.closes, 1)
        http = Http(Body(stall=True))
        with self.assertRaises(TimeoutError) as caught:
            async with synthesize(request(output={"format": "wav"}), auth=AUTH, transport=http, timeout_ms=20) as audio:
                await anext(audio)
        self.assertEqual(str(caught.exception), "Google synthesis deadline expired")
        self.assertEqual(http.body.closes, 1)

    async def test_errors_and_response_limits_preserve_identity(self) -> None:
        for body, status, error in [(b'{"error":{"message":"Denied"}}', 403, GoogleError(403, "Denied")), (b'{"audioContent":42}', 200, TypeError("Google returned an invalid synthesis response")), (b'{"audioContent":"!"}', 200, TypeError("Google returned an invalid synthesis response"))]:
            http = Http(Body(body), status)
            with self.assertRaises(type(error)) as caught:
                async with synthesize(request(output={"format": "wav"}), auth=AUTH, transport=http) as audio:
                    await anext(audio)
            self.assertEqual(str(caught.exception), str(error))
            self.assertEqual(http.body.closes, 1)
        http = Http()
        with self.assertRaises(TypeError) as caught:
            async with synthesize(request(output={"format": "wav"}), auth=AUTH, transport=http, max_json_bytes=4) as audio:
                await anext(audio)
        self.assertEqual(str(caught.exception), "Google response exceeds max_json_bytes")
        self.assertEqual(http.body.closes, 1)
        grpc = Grpc()
        failure = GrpcError(16, "Denied")
        grpc.queue.put_nowait(failure)
        grpc.close_error = RuntimeError("cleanup failed")
        with self.assertRaises(GrpcError) as caught:
            async with synthesize(request(), auth=AUTH, grpc=grpc) as audio:
                await anext(audio)
        self.assertIs(caught.exception, failure)

    async def test_environment_auth_priority_and_unread_http_cleanup(self) -> None:
        environment = {"SPEECHSWITCH_GOOGLE_API_KEY": "scoped", "GOOGLE_API_KEY": "fallback", "SPEECHSWITCH_GOOGLE_ACCESS_TOKEN": "token", "GOOGLE_OAUTH_ACCESS_TOKEN": "other", "SPEECHSWITCH_GOOGLE_QUOTA_PROJECT": "quota", "GOOGLE_CLOUD_QUOTA_PROJECT": "other"}
        with patch.dict(os.environ, environment, clear=True):
            http = Http()
            async with synthesize(request(output={"format": "wav"}), transport=http):
                self.assertEqual(http.body.reads, 0)
            self.assertEqual(dict(http.calls[0].headers), {"x-goog-api-key": "scoped", "authorization": "Bearer token", "x-goog-user-project": "quota", "content-type": "application/json"})
            self.assertEqual(http.body.closes, 1)
        with patch.dict(os.environ, {"GOOGLE_APPLICATION_CREDENTIALS": "/not-a-token.json"}, clear=True):
            with self.assertRaises(TypeError) as caught:
                async with synthesize(request()):
                    self.fail("accepted credentials file as token")
            self.assertEqual(str(caught.exception), "Missing auth.google.apiKey or auth.google.accessToken configuration")

    async def test_native_google_protocol_and_auth_using_independent_upstream_decoder(self) -> None:
        for model, version in (("gemini-2.5-flash-tts", "v1"), ("chirp-3-instant-custom-voice", "v1beta1")):
            process = await asyncio.create_subprocess_exec("node", str(Path(__file__).with_name("google-server.mjs")), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
            assert process.stdout is not None and process.stderr is not None
            try:
                async with asyncio.timeout(10):
                    port = int(await process.stdout.readline())
                    source = Source(["hello"], stall=True)
                    async with synthesize(request(model=model, voice="existing-key" if version == "v1beta1" else "Kore", text=source), auth=AUTH, grpc_url=f"http://127.0.0.1:{port}/prefix/?tenant=one") as audio:
                        headers = cast(dict[str, dict[str, str]], json.loads(await process.stdout.readline()))["headers"]
                        self.assertEqual(headers[":path"], f"/prefix/google.cloud.texttospeech.{version}.TextToSpeech/StreamingSynthesize?tenant=one")
                        self.assertEqual({key: headers[key] for key in ("authorization", "x-goog-api-key", "x-goog-user-project")}, {"authorization": "Bearer token", "x-goog-api-key": "key", "x-goog-user-project": "quota"})
                        self.assertEqual(await anext(audio), b"native-audio")
                        config = cast(dict[str, object], json.loads(await process.stdout.readline()))
                        voice = {"languageCode": "en-US", "voiceClone": {"voiceCloningKey": "existing-key"}} if version == "v1beta1" else {"languageCode": "en-US", "modelName": model, "name": "Kore"}
                        expected: dict[str, object] = {"voice": voice, "streamingAudioConfig": {"audioEncoding": "PCM", "speakingRate": 1}}
                        if version == "v1":
                            expected["advancedVoiceOptions"] = {"enableTextnorm": True}
                        self.assertEqual(config, {"request": {"streamingConfig": expected}})
                        self.assertEqual(json.loads(await process.stdout.readline()), {"request": {"input": {"text": "hello"}}})
                        await source.pending.wait()
                    self.assertEqual(await process.stdout.readline(), b'"closed"\n')
            finally:
                if process.returncode is None:
                    process.terminate()
                await process.wait()
                self.assertEqual(await process.stderr.read(), b"")
