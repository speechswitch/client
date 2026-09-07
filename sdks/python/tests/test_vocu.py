import asyncio
from collections import UserList
import json
import os
from pathlib import Path
from types import MappingProxyType
from typing import Literal, cast
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit

from speechswitch.generated.auth import Auth
from speechswitch.generated.vocu import TtsRequest
from speechswitch.generated.vocu_output import SynthesisItem
from speechswitch.http import HttpRequest, HttpResponse
from speechswitch.providers.vocu import VocuError, synthesize
from test_mistral import python_names
from test_openai import Body
from test_websocket import server

AUTH: Auth = {"vocu": {"api_key": "fixture"}}
REQUEST: TtsRequest = {"voice": "market:owned", "text": "Hello"}
FIXTURES: dict[str, object] = json.loads((Path(__file__).parents[2] / "fixtures/vocu.json").read_text())
CASES = cast(list[dict[str, object]], FIXTURES["requests"])
HTTP = cast(dict[str, object], FIXTURES["httpMetadata"])
JOB = cast(dict[str, object], FIXTURES["generatedJob"])
AUDIO = bytes(cast(list[int], FIXTURES["audio"]))


def metadata(value: object) -> HttpResponse:
    return HttpResponse(200, {}, Body([json.dumps({"status": 200, "data": value}).encode()]))


class Transport:
    def __init__(self, *responses: HttpResponse) -> None:
        self.responses = iter(responses)
        self.requests: list[HttpRequest] = []

    async def send(self, request: HttpRequest) -> HttpResponse:
        self.requests.append(request)
        return next(self.responses)

class VocuTypes(unittest.TestCase):
    def test_markup_preserves_voice_and_zero_seed(self) -> None:
        request: TtsRequest = {"text": "{{happy}}Hello", "voice": "market:owned", "input_type": "markup", "voice_style": "existing-style", "random_seed": 0, "vivid_expression": False}
        self.assertEqual(request, {"text": "{{happy}}Hello", "voice": "market:owned", "input_type": "markup", "voice_style": "existing-style", "random_seed": 0, "vivid_expression": False})


class VocuTests(unittest.IsolatedAsyncioTestCase):
    async def test_shared_native_payloads_and_completion_contract(self) -> None:
        for fixture in CASES:
            with self.subTest(name=fixture["name"]):
                request = cast(TtsRequest, python_names(fixture["request"]))
                mode = cast(Literal["stream", "http", "async"], fixture["mode"])
                audio = Body([b"", AUDIO[:1], AUDIO[1:]])
                response = HttpResponse(200, {"CONTENT-Type": "Audio/MPEG; charset=binary"}, audio)
                initial = metadata(JOB if mode == "async" else HTTP)
                transport = Transport(response) if mode == "stream" else Transport(initial, response)
                async with synthesize(request, auth=AUTH, transport=transport, mode=mode, base_url="https://proxy.test/base%2Fescaped") as stream:
                    items = [item async for item in stream]
                done: dict[str, object] = {"event": "done", "completion": "generated" if mode == "async" else "transport"}
                if mode != "stream":
                    done["metadata"] = JOB if mode == "async" else HTTP
                self.assertEqual(items, [AUDIO[:1], AUDIO[1:], done])
                first = transport.requests[0]
                self.assertEqual((first.method, first.url, first.headers, json.loads(first.body)),
                                 ("POST", "https://proxy.test/base%2Fescaped/api/tts/" + ("generate" if mode == "async" else "simple-generate"),
                                  {"Authorization": "Bearer fixture", "Content-Type": "application/json"}, fixture["wire"]))
                expected = [first]
                if mode != "stream":
                    address = cast(dict[str, str], JOB["metadata"])["audio"] if mode == "async" else cast(str, HTTP["streamUrl"])
                    expected.append(HttpRequest("GET", address, {}, b""))
                    self.assertEqual(cast(Body, initial.body).closes, 1)
                self.assertEqual(transport.requests, expected)
                self.assertEqual(audio.closes, 1)

    async def test_batch_auto_mode_polls_same_job_and_only_downloads_merged_audio(self) -> None:
        request = cast(TtsRequest, python_names(CASES[4]["request"]))
        pending = metadata({"id": "job_1", "status": "pending", "metadata": {"audio": "https://evil.test/early"}})
        processing = metadata({"id": "job_1", "status": "processing"})
        final = metadata(JOB)
        audio = Body([AUDIO])
        transport = Transport(HttpResponse(200, {"X-Vocu-App-Request-Id": "submit-trace"}, pending.body), processing,
                              HttpResponse(200, {"x-vocu-app-request-id": "poll-trace"}, final.body),
                              HttpResponse(200, {"x-vocu-app-request-id": "asset-trace"}, audio))
        async with synthesize(request, auth={"vocu": {"access_token": "session"}}, transport=transport, poll_interval_ms=0) as stream:
            self.assertEqual([item async for item in stream], [AUDIO, {"event": "done", "completion": "generated", "metadata": JOB, "request_id": "poll-trace"}])
        self.assertEqual([(r.method, r.url, r.headers) for r in transport.requests], [
            ("POST", "https://v1.vocu.ai/api/tts/generate", {"Authorization": "Bearer session", "Content-Type": "application/json"}),
            ("GET", "https://v1.vocu.ai/api/tts/generate/job_1", {"Authorization": "Bearer session"}),
            ("GET", "https://v1.vocu.ai/api/tts/generate/job_1", {"Authorization": "Bearer session"}),
            ("GET", "https://storage.vocu.ai/generate/merged.mp3", {})])
        self.assertEqual([cast(Body, response.body).closes for response in (pending, processing, final)], [1, 1, 1])
        self.assertEqual(audio.closes, 1)

    async def test_direct_header_metadata_and_subtitles_remain_opaque(self) -> None:
        native = {"billing_units": 0, "srt": [None, False, {"native_key": "opaque"}]}
        body = Body([AUDIO])
        transport = Transport(HttpResponse(200, {"x-reecho-response-data": json.dumps(native), "x-vocu-app-request-id": "trace"}, body))
        async with synthesize({"voice": "owned", "text": "Hello", "subtitle_format": "srt"}, auth=AUTH, transport=transport) as stream:
            self.assertEqual([item async for item in stream], [AUDIO, {"event": "done", "completion": "transport", "metadata": native, "request_id": "trace"}])
        self.assertEqual(json.loads(transport.requests[0].body)["srt"], True)
        self.assertEqual(body.closes, 1)

    async def test_mapping_and_sequence_inputs_preserve_splitter_inheritance(self) -> None:
        request = cast(TtsRequest, {"text": "[a]Hi", "text_splitter": {"placeholders": UserList([{"marker": "[a]", "voice": "owned"}]),
                                   "lookup": UserList([{"tags": UserList([UserList(["a", "sad"])]), "emotion_blend": MappingProxyType({"anger": 2.0})}])}})
        transport = Transport(metadata(JOB), HttpResponse(200, {}, Body([AUDIO])))
        async with synthesize(request, auth=AUTH, transport=transport) as stream:
            _ = [item async for item in stream]
        self.assertEqual(json.loads(transport.requests[0].body), {"text": "[a]Hi", "srt": False, "splitter": {"[a]": {"voiceId": "owned"},
                         "lookupTable": {"entry0": {"tags": [["a", "sad"]], "emo_switch": [2, 0, 0, 0, 0]}}}})

    async def test_explicit_auth_and_environment_precedence(self) -> None:
        environment = {"SPEECHSWITCH_VOCU_API_KEY": "preferred-key", "VOCU_API_KEY": "fallback-key",
                       "SPEECHSWITCH_VOCU_ACCESS_TOKEN": "preferred-token", "VOCU_ACCESS_TOKEN": "fallback-token"}
        cases: list[tuple[Auth, dict[str, str], Literal["stream", "async"], str]] = [
            (AUTH, environment, "stream", "fixture"), ({}, environment, "stream", "preferred-key"),
            ({}, {"VOCU_API_KEY": "fallback-key"}, "stream", "fallback-key"),
            ({"vocu": {"access_token": "explicit-token"}}, environment, "async", "explicit-token"),
            ({"vocu": {"api_key": "explicit-key", "access_token": "explicit-token"}}, environment, "async", "explicit-key"),
            ({}, environment, "async", "preferred-key"), ({}, {"SPEECHSWITCH_VOCU_ACCESS_TOKEN": "preferred-token", "VOCU_ACCESS_TOKEN": "fallback-token"}, "async", "preferred-token"),
            ({}, {"VOCU_ACCESS_TOKEN": "fallback-token"}, "async", "fallback-token")]
        for auth, env, mode, expected in cases:
            with self.subTest(expected=expected, mode=mode), patch.dict(os.environ, env, clear=True):
                response = HttpResponse(200, {}, Body([AUDIO]))
                transport = Transport(metadata(JOB), response) if mode == "async" else Transport(response)
                async with synthesize(REQUEST, auth=auth, transport=transport, mode=mode) as stream:
                    _ = [item async for item in stream]
                self.assertEqual(transport.requests[0].headers["Authorization"], "Bearer " + expected)

    async def test_missing_empty_or_unsafe_credentials_fail_before_io(self) -> None:
        cases: list[tuple[Auth, Literal["stream", "async"], str]] = [
            ({}, "stream", "Missing auth.vocu.apiKey configuration"),
            ({"vocu": {"access_token": "session"}}, "stream", "Missing auth.vocu.apiKey configuration"),
            ({}, "async", "Missing auth.vocu.apiKey or auth.vocu.accessToken configuration"),
            ({"vocu": {"api_key": ""}}, "async", "Missing auth.vocu.apiKey or auth.vocu.accessToken configuration"),
            ({"vocu": {"api_key": "a\r\nx: y"}}, "stream", "Vocu credential must contain only visible ASCII characters")]
        for auth, mode, message in cases:
            with self.subTest(auth=auth, mode=mode), patch.dict(os.environ, {}, clear=True):
                transport = Transport()
                with self.assertRaises(TypeError) as raised:
                    async with synthesize(REQUEST, auth=auth, transport=transport, mode=mode):
                        self.fail("invalid credentials accepted")
                self.assertEqual(str(raised.exception), message)
                self.assertEqual(transport.requests, [])
        with patch.dict(os.environ, {"VOCU_API_KEY": "env"}, clear=True):
            with self.assertRaises(TypeError) as raised:
                async with synthesize(REQUEST, auth={"vocu": {"api_key": ""}}, transport=Transport()):
                    self.fail("explicit empty key replaced")
            self.assertEqual(str(raised.exception), "Missing auth.vocu.apiKey configuration")

    async def test_generated_validation_rejects_invalid_requests_before_io(self) -> None:
        invalid: list[object] = [
            {**REQUEST, "model": "v3.5"}, {**REQUEST, "language": "en"}, {**REQUEST, "speed": 0.49},
            {**REQUEST, "random_seed": 0.1}, {**REQUEST, "emotion_blend": {"anger": 11}},
            {**REQUEST, "input_type": "markup", "subtitle_format": "srt"},
            {**REQUEST, "latency_optimization": "maximum", "subtitle_format": "srt"},
            {**REQUEST, "reference_emphasis": "expressive"}, {**REQUEST, "text": None},
            {**REQUEST, "output": {"format": "mp3", "sample_rate_hz": 44100}},
            {**REQUEST, "timestamp_granularity": "word"}, {"segments": []},
            {"text": "Hello", "text_splitter": {"id": "saved", "fallback": {"voice": "owned"}}},
            {"text": "Hello", "text_splitter": {"brackets": [{"open": "😀", "close": "]"}]}}]
        for request in invalid:
            with self.subTest(request=request):
                transport = Transport()
                with self.assertRaises(TypeError) as raised:
                    async with synthesize(cast(TtsRequest, request), auth=AUTH, transport=transport):
                        self.fail("invalid request accepted")
                self.assertEqual(str(raised.exception), "Invalid vocu TTS request")
                self.assertEqual(transport.requests, [])

    async def test_splitter_collisions_fail_before_submission(self) -> None:
        for marker in ("splitterMarks", "lookupTable", "fallbackConfig", "duplicate"):
            request: TtsRequest = {"text": "Hello", "text_splitter": {"placeholders": [
                {"marker": marker, "voice": "a"}, {"marker": marker, "voice": "b"}]}}
            transport = Transport()
            with self.assertRaises(TypeError) as raised:
                async with synthesize(request, auth=AUTH, transport=transport):
                    self.fail("marker collision accepted")
            self.assertEqual(str(raised.exception), "Vocu splitter markers must be unique and cannot use reserved protocol keys")
            self.assertEqual(transport.requests, [])

    async def test_mode_conflicts_are_checked_at_the_boundary(self) -> None:
        cases: list[tuple[TtsRequest, Literal["stream", "http", "async"], str]] = [
            ({"segments": [{"kind": "speech", "voice": "owned", "text": "Hello"}]}, "stream", "Vocu segments and text splitting require async synthesis"),
            ({"text": "Hello", "text_splitter": {"id": "saved"}}, "http", "Vocu segments and text splitting require async synthesis"),
            ({"text": "Hello", "voice": "owned", "latency_optimization": "maximum"}, "async", "Vocu async synthesis does not support flash latency optimization")]
        for request, mode, message in cases:
            transport = Transport()
            with self.assertRaises(TypeError) as raised:
                async with synthesize(request, auth=AUTH, transport=transport, mode=mode):
                    self.fail("mode conflict accepted")
            self.assertEqual(str(raised.exception), message)
            self.assertEqual(transport.requests, [])

    async def test_untrusted_audio_urls_never_receive_a_request(self) -> None:
        for address in ("https://evil.test/audio", "http://127.0.0.1/secret", "https://storage.vocu.ai.evil.test/audio",
                        "https://key:secret@storage.vocu.ai/audio", "https://storage.vocu.ai/audio#fragment",
                        "https://storage.vocu.ai/\nsecret", "https://storage.vocu.ai/%zz", "//evil.test/audio"):
            with self.subTest(address=address):
                response = metadata({"audio": address})
                transport = Transport(response)
                with self.assertRaises(TypeError) as raised:
                    async with synthesize(REQUEST, auth=AUTH, transport=transport, mode="http") as stream:
                        _ = [item async for item in stream]
                expected = "Vocu URLs must be HTTP(S) without credentials, fragments or invalid escapes" if "key:secret" in address or "%zz" in address else "Vocu returned an untrusted audio URL"
                self.assertEqual(str(raised.exception), expected)
                self.assertEqual(len(transport.requests), 1)
                self.assertEqual(cast(Body, response.body).closes, 1)

    async def test_relative_audio_and_explicit_trusted_origins_never_inherit_auth(self) -> None:
        for address, base, origins, expected in (
            ("relative.mp3", "https://v1.vocu.ai/base", (), "https://v1.vocu.ai/relative.mp3"),
            ("/audio.mp3", "https://proxy.test/base", ("https://proxy.test",), "https://proxy.test/audio.mp3"),
            ("http://127.0.0.1:8181/audio?token=fixture", "https://v1.vocu.ai", ("http://127.0.0.1:8181",), "http://127.0.0.1:8181/audio?token=fixture")):
            with self.subTest(address=address):
                transport = Transport(metadata({"audio": address}), HttpResponse(200, {}, Body([AUDIO])))
                async with synthesize(REQUEST, auth=AUTH, transport=transport, mode="http", base_url=base, audio_origins=origins) as stream:
                    _ = [item async for item in stream]
                self.assertEqual(transport.requests[-1], HttpRequest("GET", expected, {}, b""))

    async def test_job_identity_status_and_final_audio_fail_closed(self) -> None:
        cases: list[tuple[list[object], str]] = [
            ([{"id": "../bad", "status": "pending"}], "Invalid Vocu job ID"),
            ([{"id": "job\n", "status": "pending"}], "Invalid Vocu job ID"),
            ([{"id": "job", "status": "unknown"}], "Invalid Vocu job status"),
            ([{"id": "job", "status": "pending"}, {"id": "other", "status": "generated"}], "Vocu returned a different job ID while polling"),
            ([{"id": "job", "status": "generated", "metadata": {}}], "Vocu returned no audio URL"),
            ([{"id": "job", "status": "generated", "metadata": []}], "Invalid Vocu response object")]
        for jobs, message in cases:
            with self.subTest(message=message):
                responses = [metadata(job) for job in jobs]
                transport = Transport(*responses)
                with self.assertRaises(TypeError) as raised:
                    async with synthesize(REQUEST, auth=AUTH, transport=transport, mode="async", poll_interval_ms=0) as stream:
                        _ = [item async for item in stream]
                self.assertEqual(str(raised.exception), message)
                self.assertEqual(len(transport.requests), len(jobs))
                self.assertEqual([cast(Body, r.body).closes for r in responses], [1] * len(jobs))

    async def test_http_and_failed_job_errors_preserve_only_diagnostic_fields(self) -> None:
        for status in (302, 401, 429, 500):
            body = Body([b"private body that must not be read"], close_error=RuntimeError("close"))
            transport = Transport(HttpResponse(status, {"Location": "https://evil.test", "X-Vocu-App-Request-Id": "trace", "Retry-After": "7"}, body))
            with self.assertRaises(VocuError) as raised:
                async with synthesize(REQUEST, auth=AUTH, transport=transport) as stream:
                    _ = [item async for item in stream]
            error = raised.exception
            self.assertEqual((str(error), error.status, error.job_id, error.request_id, error.retry_after), (f"Vocu returned HTTP {status}", status, None, "trace", "7"))
            self.assertEqual((body.reads, body.closes, len(transport.requests)), (0, 1, 1))
        response = metadata({"id": "job", "status": "failed", "reason": "private text"})
        transport = Transport(HttpResponse(200, {"x-vocu-app-request-id": "trace"}, response.body))
        with self.assertRaises(VocuError) as raised:
            async with synthesize(REQUEST, auth=AUTH, transport=transport, mode="async") as stream:
                _ = [item async for item in stream]
        error = raised.exception
        self.assertEqual((str(error), error.status, error.job_id, error.request_id, error.retry_after), ("Vocu generation failed", None, "job", "trace", None))
        self.assertEqual(len(transport.requests), 1)

    async def test_metadata_is_bounded_finite_json_with_strict_utf8(self) -> None:
        cases = [(b"{", "Invalid Vocu metadata"), (b"\xff", "Invalid Vocu metadata UTF-8"),
                 (b"[]", "Invalid Vocu response object"), (b'{"status":200,"data":[]}', "Invalid Vocu response object"),
                 (b'{"status":201,"data":{}}', "Invalid Vocu response status"),
                 (b'{"status":200,"data":{"value":NaN}}', "Invalid Vocu response object"),
                 (b'{"status":200,"data":{"value":1e999}}', "Invalid Vocu response object")]
        for data, message in cases:
            with self.subTest(data=data):
                body = Body([data])
                with self.assertRaises(TypeError) as raised:
                    async with synthesize(REQUEST, auth=AUTH, transport=Transport(HttpResponse(200, {}, body)), mode="http") as stream:
                        _ = [item async for item in stream]
                self.assertEqual(str(raised.exception), message)
                self.assertEqual(body.closes, 1)
        for header in (False, True):
            body = Body([b"12345"])
            headers = {"x-reecho-response-data": '{"x":1}'} if header else {}
            with self.assertRaises(TypeError) as raised:
                async with synthesize(REQUEST, auth=AUTH, transport=Transport(HttpResponse(200, headers, body)), mode="stream" if header else "http", max_metadata_bytes=4) as stream:
                    _ = [item async for item in stream]
            self.assertEqual(str(raised.exception), "Vocu metadata exceeds max_metadata_bytes")
            self.assertEqual((body.reads, body.closes), (0 if header else 1, 1))

    async def test_audio_is_not_metadata_bounded_and_empty_or_wrong_media_fails(self) -> None:
        body = Body([AUDIO * 100])
        async with synthesize(REQUEST, auth=AUTH, transport=Transport(HttpResponse(200, {}, body)), max_metadata_bytes=1) as stream:
            self.assertEqual([item async for item in stream], [AUDIO * 100, {"event": "done", "completion": "transport"}])
        for headers, chunks, message, reads in (({}, [b""], "Vocu returned no audio", 2), ({"content-type": "application/json"}, [b"private"], "Vocu returned an unexpected audio content type", 0), ({"x-reecho-response-data": "bad"}, [AUDIO], "Invalid Vocu metadata", 0)):
            body = Body([*chunks])
            with self.assertRaises(TypeError) as raised:
                async with synthesize(REQUEST, auth=AUTH, transport=Transport(HttpResponse(200, headers, body))) as stream:
                    _ = [item async for item in stream]
            self.assertEqual(str(raised.exception), message)
            self.assertEqual((body.reads, body.closes), (reads, 1))

    async def test_early_close_and_read_errors_release_body_exactly_once(self) -> None:
        body = Body([AUDIO, RuntimeError("must not read ahead")])
        async with synthesize(REQUEST, auth=AUTH, transport=Transport(HttpResponse(200, {}, body))) as stream:
            self.assertEqual(await anext(stream), AUDIO)
        self.assertEqual((body.reads, body.closes), (1, 1))
        error = RuntimeError("read failed")
        body = Body([AUDIO, error], close_error=RuntimeError("close failed"))
        seen: list[SynthesisItem] = []
        with self.assertRaises(RuntimeError) as raised:
            async with synthesize(REQUEST, auth=AUTH, transport=Transport(HttpResponse(200, {}, body))) as stream:
                async for item in stream:
                    seen.append(item)
        self.assertIs(raised.exception, error)
        self.assertEqual((seen, body.reads, body.closes), ([AUDIO], 2, 1))

    async def test_cancellation_during_read_and_after_audio_suppresses_done(self) -> None:
        body = Body([], stall=True)
        async def consume() -> list[SynthesisItem]:
            async with synthesize(REQUEST, auth=AUTH, transport=Transport(HttpResponse(200, {}, body))) as stream:
                return [item async for item in stream]
        task = asyncio.create_task(consume())
        await body.reading.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertEqual(body.closes, 1)
        body = Body([AUDIO])
        seen: list[SynthesisItem] = []
        async def cancel_after_audio() -> None:
            async with synthesize(REQUEST, auth=AUTH, transport=Transport(HttpResponse(200, {}, body))) as stream:
                seen.append(await anext(stream))
                current = asyncio.current_task()
                assert current is not None
                current.cancel()
                seen.append(await anext(stream))
        with self.assertRaises(asyncio.CancelledError):
            await asyncio.create_task(cancel_after_audio())
        self.assertEqual((seen, body.closes), ([AUDIO], 1))

    async def test_deadline_covers_polling_body_and_consumer_idle(self) -> None:
        for phase in ("poll", "body", "idle"):
            with self.subTest(phase=phase):
                response = metadata({"id": "job", "status": "pending"}) if phase == "poll" else HttpResponse(200, {}, Body([AUDIO], stall=True))
                transport = Transport(response)
                with self.assertRaises(TimeoutError):
                    async with synthesize(REQUEST, auth=AUTH, transport=transport, mode="async" if phase == "poll" else "stream", timeout_ms=30, poll_interval_ms=1000) as stream:
                        if phase == "idle":
                            self.assertEqual(await anext(stream), AUDIO)
                            await asyncio.Future[None]()
                        else:
                            _ = [item async for item in stream]
                self.assertEqual(cast(Body, response.body).closes, 1)
                self.assertEqual(len(transport.requests), 1)
        transport = Transport()
        with self.assertRaises(TimeoutError) as raised:
            async with synthesize(REQUEST, auth=AUTH, transport=transport, timeout_ms=0):
                self.fail("expired operation accepted")
        self.assertEqual(str(raised.exception), "Vocu synthesis deadline expired")
        self.assertEqual(transport.requests, [])

    async def test_cancellation_before_headers_is_owned_by_the_transport(self) -> None:
        started = asyncio.Event()
        cleaned = asyncio.Event()
        class PendingTransport:
            async def send(self, request: HttpRequest) -> HttpResponse:
                started.set()
                try:
                    await asyncio.Future[None]()
                    raise AssertionError("unreachable")
                finally:
                    cleaned.set()
        async def consume() -> None:
            async with synthesize(REQUEST, auth=AUTH, transport=PendingTransport()) as stream:
                _ = await anext(stream)
        task = asyncio.create_task(consume())
        await started.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertTrue(cleaned.is_set())

    async def test_native_http_stream_is_incremental_and_early_exit_disconnects(self) -> None:
        disconnected = asyncio.Event()
        captured: list[tuple[bytes, dict[bytes, bytes], object]] = []

        async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            lines = (await reader.readuntil(b"\r\n\r\n"))[:-4].split(b"\r\n")
            headers = dict((key.lower(), value.strip()) for key, value in (line.split(b":", 1) for line in lines[1:]))
            captured.append((lines[0], headers, json.loads(await reader.readexactly(int(headers[b"content-length"])))))
            writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: audio/mpeg\r\nConnection: close\r\n\r\n" + AUDIO)
            await writer.drain()
            self.assertEqual(await reader.read(), b"")
            disconnected.set()

        class NativeBody:
            def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
                self.reader, self.writer, self.closes = reader, writer, 0

            def __aiter__(self) -> "NativeBody":
                return self

            async def __anext__(self) -> bytes:
                data = await self.reader.read(4096)
                if not data:
                    raise StopAsyncIteration
                return data

            async def aclose(self) -> None:
                self.closes += 1
                self.writer.close()
                await self.writer.wait_closed()

        class NativeTransport:
            def __init__(self) -> None:
                self.bodies: list[NativeBody] = []

            async def send(self, request: HttpRequest) -> HttpResponse:
                url = urlsplit(request.url)
                reader, writer = await asyncio.open_connection(url.hostname, url.port)
                try:
                    headers = {**request.headers, "Host": url.netloc, "Content-Length": str(len(request.body)), "Connection": "close"}
                    head = f"{request.method} {url.path} HTTP/1.1\r\n" + "".join(f"{key}: {value}\r\n" for key, value in headers.items()) + "\r\n"
                    writer.write(head.encode() + request.body)
                    await writer.drain()
                    lines = (await reader.readuntil(b"\r\n\r\n"))[:-4].split(b"\r\n")
                    body = NativeBody(reader, writer)
                    self.bodies.append(body)
                    return HttpResponse(int(lines[0].split()[1]), dict((key.decode(), value.decode().strip()) for key, value in (line.split(b":", 1) for line in lines[1:])), body)
                except BaseException:
                    writer.close()
                    await writer.wait_closed()
                    raise

        transport = NativeTransport()
        async with server(handle) as address:
            async with asyncio.timeout(5):
                async with synthesize(REQUEST, auth=AUTH, transport=transport, base_url=address.replace("ws://", "http://") + "/proxy") as stream:
                    self.assertEqual(await anext(stream), AUDIO)
                await disconnected.wait()
        self.assertEqual([body.closes for body in transport.bodies], [1])
        self.assertEqual([(line, headers[b"authorization"], payload) for line, headers, payload in captured],
                         [(b"POST /proxy/api/tts/simple-generate HTTP/1.1", b"Bearer fixture", CASES[0]["wire"])])

    async def test_invalid_endpoint_and_options_fail_before_io(self) -> None:
        transport = Transport()
        for address in ("ftp://host", "https://u:p@host", "https://host/#", "https://host/\nx", "https://host/%q", "https://host:99999", "https://host\\evil"):
            with self.subTest(address=address):
                with self.assertRaises(TypeError) as raised:
                    async with synthesize(REQUEST, auth=AUTH, transport=transport, base_url=address):
                        self.fail("invalid base URL accepted")
                self.assertEqual(str(raised.exception), "Vocu URLs must be HTTP(S) without credentials, fragments or invalid escapes")
        for address in ("https://host/path", "https://host/", "https://HOST", "https://host:443"):
            with self.assertRaises(TypeError) as raised:
                async with synthesize(REQUEST, auth=AUTH, transport=transport, audio_origins=[address]):
                    self.fail("noncanonical origin accepted")
            self.assertEqual(str(raised.exception), "Vocu audio_origins must contain HTTP(S) origins only")
        for value in (-1, True, 2147483648, cast(int, 0.5)):
            with self.assertRaises(TypeError) as raised:
                async with synthesize(REQUEST, auth=AUTH, transport=transport, poll_interval_ms=value):
                    self.fail("invalid polling interval accepted")
            self.assertEqual(str(raised.exception), "Vocu polling interval and timeout must be integers between 0 and 2147483647")
            with self.assertRaises(TypeError) as raised:
                async with synthesize(REQUEST, auth=AUTH, transport=transport, timeout_ms=value):
                    self.fail("invalid deadline accepted")
            self.assertEqual(str(raised.exception), "Vocu polling interval and timeout must be integers between 0 and 2147483647")
        for value in (0, True, 9007199254740992, cast(int, 0.5)):
            with self.assertRaises(TypeError) as raised:
                async with synthesize(REQUEST, auth=AUTH, transport=transport, max_metadata_bytes=value):
                    self.fail("invalid metadata limit accepted")
            self.assertEqual(str(raised.exception), "Vocu max_metadata_bytes must be a positive safe integer")
        with self.assertRaises(TypeError) as raised:
            async with synthesize(REQUEST, auth=AUTH, transport=transport, base_url="https://host/?"):
                self.fail("query delimiter accepted")
        self.assertEqual(str(raised.exception), "Vocu base URL must not contain a query")
        with self.assertRaises(TypeError) as raised:
            async with synthesize(REQUEST, auth=AUTH, transport=transport, mode=cast(Literal["stream"], "invalid")):
                self.fail("invalid mode accepted")
        self.assertEqual(str(raised.exception), "Invalid Vocu mode")
        self.assertEqual(transport.requests, [])

    async def test_fragmented_utf8_metadata_preserves_native_keys_and_nulls(self) -> None:
        native = {**HTTP, "native_key": "你好😀", "streamUrl": None}
        encoded = json.dumps({"status": 200, "data": native}, ensure_ascii=False).encode()
        body = Body([bytes([byte]) for byte in encoded])
        transport = Transport(HttpResponse(200, {}, body), HttpResponse(200, {}, Body([AUDIO])))
        async with synthesize(REQUEST, auth=AUTH, transport=transport, mode="http", max_metadata_bytes=len(encoded)) as stream:
            self.assertEqual([item async for item in stream], [AUDIO, {"event": "done", "completion": "transport", "metadata": native}])
        self.assertEqual(transport.requests[-1], HttpRequest("GET", cast(str, HTTP["audio"]), {}, b""))
        self.assertEqual(body.closes, 1)

    async def test_failed_asset_download_keeps_job_id_and_releases_bodies(self) -> None:
        initial = metadata(JOB)
        audio = Body([b"private"], close_error=RuntimeError("cleanup"))
        transport = Transport(initial, HttpResponse(503, {"x-vocu-app-request-id": "asset", "retry-after": "2"}, audio))
        with self.assertRaises(VocuError) as raised:
            async with synthesize(REQUEST, auth=AUTH, transport=transport, mode="async") as stream:
                _ = [item async for item in stream]
        error = raised.exception
        self.assertEqual((str(error), error.status, error.job_id, error.request_id, error.retry_after), ("Vocu returned HTTP 503", 503, "job_1", "asset", "2"))
        self.assertEqual((cast(Body, initial.body).closes, audio.reads, audio.closes), (1, 0, 1))
        self.assertEqual(transport.requests[-1].headers, {})
