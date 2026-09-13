import asyncio
import json
import os
import re
import unittest
from collections.abc import AsyncIterator, Sequence
from email import policy
from email.parser import BytesParser
from pathlib import Path
from types import MappingProxyType
from typing import cast
from unittest.mock import patch
from urllib.parse import urlsplit

from speechswitch.generated.auth import Auth
from speechswitch.generated.resemble import TtsRequest
from speechswitch.generated.validators.resemble import validate_request
from speechswitch.generated.resemble_output import SynthesisItem
from speechswitch.http import HttpRequest, HttpResponse
from speechswitch.providers.resemble import ResembleError, synthesize
from speechswitch.validation import is_mapping, is_sequence


class Body:
    def __init__(self, chunks: Sequence[bytes | Exception], *, stall: bool = False, close_error: Exception | None = None) -> None:
        self.chunks = iter(chunks)
        self.reads = self.closes = 0
        self.stall, self.close_error = stall, close_error
        self.reading = asyncio.Event()

    def __aiter__(self) -> AsyncIterator[bytes]:
        return self

    async def __anext__(self) -> bytes:
        self.reads += 1
        value = next(self.chunks, None)
        if value is None:
            if self.stall:
                self.reading.set()
                await asyncio.Future[None]()
            raise StopAsyncIteration
        if isinstance(value, Exception):
            raise value
        return value

    async def aclose(self) -> None:
        self.closes += 1
        if self.close_error is not None:
            raise self.close_error


class Transport:
    def __init__(self, responses: list[HttpResponse | Exception]) -> None:
        self.responses = iter(responses)
        self.requests: list[HttpRequest] = []

    async def send(self, request: HttpRequest) -> HttpResponse:
        self.requests.append(request)
        response = next(self.responses)
        if isinstance(response, Exception):
            raise response
        return response


def response(value: bytes, content_type: str = "application/json", status: int = 200) -> HttpResponse:
    return HttpResponse(status, {"CONTENT-Type": content_type, "Retry-After": "7"}, Body([value]))


def complete(file: object = None) -> bytes:
    return ("event: complete\ndata: " + json.dumps([{"path": "/tmp/audio.wav"} if file is None else file]) + "\n\n").encode()


def python_names(value: object) -> object:
    if is_mapping(value):
        return {re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", str(key)).lower():
                bytes(cast(list[int], child)) if key == "referenceAudio" else python_names(child) for key, child in value.items()}
    if is_sequence(value):
        return [python_names(child) for child in value]
    return value


AUTH: Auth = {"resemble": {"token": "fixture"}}
BASE: TtsRequest = {"text": "Hello"}
SUBMIT = '{"event_id":"event/?#雪"}'.encode()
FIXTURES = Path(__file__).parents[2] / "fixtures/resemble.json"


class ResembleTests(unittest.IsolatedAsyncioTestCase):
    async def test_shared_requests_exact_positional_inputs_upload_and_model_routes(self) -> None:
        fixtures: dict[str, list[dict[str, object]]] = json.loads(FIXTURES.read_text())
        for fixture in fixtures["requests"]:
            with self.subTest(name=fixture["name"]):
                request = cast(TtsRequest, python_names(fixture["request"]))
                replies: list[HttpResponse | Exception] = []
                paths: list[str] = []
                if "reference_audio" in request:
                    replies.append(response(b'["/uploaded/reference"]'))
                    paths.append("/gradio_api/upload")
                elif request.get("model") == "chatterbox-turbo":
                    info = {"named_endpoints": {"/generate": {"parameters": [None, {"parameter_name": "audio_prompt_path", "parameter_default": {"path": "/current/cache/reference.wav", "url": "https://wrong.example/generic.wav"}}]}}}
                    replies.append(response(json.dumps(info).encode()))
                    paths.append("/gradio_api/info")
                replies.extend([response(SUBMIT), response(complete({"path": "/tmp/gradio/file with?#雪.wav"}), " Text/Event-Stream ; charset=utf-8"), response(b"\x00\xff\x80", "audio/wav")])
                transport = Transport(replies)
                async with synthesize(request, transport=transport, auth=AUTH) as audio:
                    output = [item async for item in audio]
                self.assertEqual(output, [b"\x00\xff\x80", {"event": "done", "request_id": "event/?#雪"}])
                api = fixture["api"]
                paths.extend([f"/gradio_api/call/{api}", f"/gradio_api/call/{api}/event%2F%3F%23%E9%9B%AA", "/gradio_api/file=%2Ftmp%2Fgradio%2Ffile%20with%3F%23%E9%9B%AA.wav"])
                self.assertEqual([urlsplit(call.url).hostname for call in transport.requests], [fixture["host"]] * len(paths))
                self.assertEqual([urlsplit(call.url).path for call in transport.requests], paths)
                self.assertEqual([call.method for call in transport.requests], (["POST"] if "reference_audio" in request else ["GET"] if request.get("model") == "chatterbox-turbo" else []) + ["POST", "GET", "GET"])
                self.assertEqual(json.loads(transport.requests[-3].body), fixture["wire"])
                for call in transport.requests:
                    self.assertEqual(call.headers.get("Authorization"), "Bearer fixture")
                if "reference_audio" in request:
                    call = transport.requests[0]
                    mime = BytesParser(policy=policy.default).parsebytes(("Content-Type: " + call.headers["Content-Type"] + "\r\n\r\n").encode() + call.body)
                    parts = list(mime.iter_parts())
                    self.assertEqual(len(parts), 1)
                    self.assertEqual(parts[0].get_param("name", header="Content-Disposition"), "files")
                    self.assertEqual(parts[0].get_filename(), "reference.audio")
                    self.assertEqual(parts[0].get_content_type(), "application/octet-stream")
                    self.assertEqual(parts[0].get_payload(decode=True), request["reference_audio"])
                self.assertEqual([cast(Body, item.body).closes for item in replies if isinstance(item, HttpResponse)], [1] * len(paths))

    async def test_shared_queue_streams_every_byte_split(self) -> None:
        fixtures: dict[str, list[dict[str, object]]] = json.loads(FIXTURES.read_text())
        for fixture in fixtures["streams"]:
            data = cast(str, fixture["body"]).encode()
            for split in range(len(data) + 1):
                with self.subTest(name=fixture["name"], split=split):
                    queue = Body([data[:split], data[split:]])
                    download = Body([b"\x00\xff\x80"])
                    transport = Transport([response(SUBMIT), HttpResponse(200, {"Content-Type": "text/event-stream"}, queue), HttpResponse(200, {}, download)])
                    output: list[object] = []
                    error: str | None = None
                    try:
                        async with synthesize(BASE, transport=transport, auth=AUTH) as audio:
                            async for item in audio:
                                output.append({"audio": list(item)} if isinstance(item, bytes) else item)
                    except TypeError as failure:
                        error = str(failure)
                    self.assertEqual(output, python_names(fixture["output"]))
                    self.assertEqual(error, fixture["error"])
                    self.assertEqual(queue.closes, 1)
                    self.assertEqual(download.closes, 1 if error is None else 0)
                    self.assertEqual(len(transport.requests), 3 if error is None else 2)

    async def test_live_metadata_path_only_not_generic_url(self) -> None:
        info: dict[str, dict[str, dict[str, list[dict[str, object]]]]] = json.loads((Path(__file__).parents[3] / "schemas/sources/resemble/02-gradio-schema.json").read_text())
        parameter = info["named_endpoints"]["/generate"]["parameters"][1]
        sample = cast(dict[str, object], parameter["parameter_default"])
        sample["path"] = "/new-cache/current.wav"
        transport = Transport([response(json.dumps(info).encode()), response(SUBMIT), response(complete(), "text/event-stream"), response(b"wav", "audio/wav")])
        async with synthesize({"text": "Hello", "model": "chatterbox-turbo"}, transport=transport, auth=AUTH) as audio:
            self.assertEqual([item async for item in audio], [b"wav", {"event": "done", "request_id": "event/?#雪"}])
        self.assertEqual(json.loads(transport.requests[1].body)["data"][1], {"path": "/new-cache/current.wav", "meta": {"_type": "gradio.FileData"}})

    async def test_complete_closes_queue_before_download_and_streams_before_eof(self) -> None:
        queue, download = Body([complete() + b"invalid tail"], stall=True), Body([b"", b"first", b"second"], stall=True)
        transport = Transport([response(SUBMIT), HttpResponse(200, {"Content-Type": "text/event-stream"}, queue), HttpResponse(200, {}, download)])
        async with synthesize(BASE, transport=transport, auth=AUTH) as audio:
            self.assertEqual(await anext(audio), b"first")
            self.assertEqual((queue.reads, queue.closes, download.reads, download.closes), (1, 1, 2, 0))
        self.assertEqual((download.reads, download.closes), (2, 1))

    async def test_unused_context_has_no_io_and_done_releases_download(self) -> None:
        transport = Transport([])
        async with synthesize(BASE, transport=transport, auth=AUTH):
            pass
        self.assertEqual(transport.requests, [])
        download = Body([b"audio"])
        transport = Transport([response(SUBMIT), response(complete(), "text/event-stream"), HttpResponse(200, {}, download)])
        async with synthesize(BASE, transport=transport, auth=AUTH) as audio:
            self.assertEqual(await anext(audio), b"audio")
            self.assertEqual(await anext(audio), {"event": "done", "request_id": "event/?#雪"})
            self.assertEqual(download.closes, 1)
            self.assertEqual([item async for item in audio], [])

    async def test_asset_origin_auth_and_proxy_url_semantics(self) -> None:
        cases = [
            (None, "https://proxy.test/root/gradio_api/file=%2Ftmp%2Fa%20%3F%23%E9%9B%AA.wav?tenant=one;two&x=%2F", True),
            ("gradio_api/file=audio.wav?signature=one;two&x=%2F", "https://proxy.test/root/gradio_api/file=audio.wav?signature=one;two&x=%2F", True),
            ("https://PROXY.test:443/audio", "https://PROXY.test:443/audio", True),
            ("https://cdn.test/audio?sig=%2F", "https://cdn.test/audio?sig=%2F", False),
            ("//cdn.test/audio", "https://cdn.test/audio", False),
            ("https://proxy.test:0/audio", "https://proxy.test:0/audio", False),
        ]
        for url, expected, authorized in cases:
            transport = Transport([response(SUBMIT), response(complete({"path": "/tmp/a ?#雪.wav", "url": url}), "text/event-stream"), response(b"wav", "audio/wav")])
            async with synthesize(BASE, transport=transport, auth=AUTH, base_url="https://proxy.test/root?tenant=one;two&x=%2F") as audio:
                self.assertEqual([item async for item in audio], [b"wav", {"event": "done", "request_id": "event/?#雪"}])
            self.assertEqual([call.url for call in transport.requests], ["https://proxy.test/root/gradio_api/call/generate_tts_audio?tenant=one;two&x=%2F", "https://proxy.test/root/gradio_api/call/generate_tts_audio/event%2F%3F%23%E9%9B%AA?tenant=one;two&x=%2F", expected])
            self.assertEqual(transport.requests[-1].headers, {"Authorization": "Bearer fixture"} if authorized else {})
            self.assertEqual(transport.requests[-1].body, b"")

    async def test_asset_urls_reject_unsafe_schemes_credentials_and_invalid_urls(self) -> None:
        for url in ["file:///tmp/a.wav", "http://cdn.test/audio", "https://user:pass@cdn.test/audio", "https://cdn.test/%wrong", "https://cdn.test/audio#fragment", "\\\\cdn.test\\audio", "\nhttps://cdn.test/audio"]:
            transport = Transport([response(SUBMIT), response(complete({"path": "audio", "url": url}), "text/event-stream")])
            with self.assertRaises(TypeError) as error:
                async with synthesize(BASE, transport=transport, auth=AUTH) as audio:
                    await anext(audio)
            self.assertEqual(str(error.exception), "Resemble returned an unsafe audio URL" if url == "http://cdn.test/audio" else "Invalid Resemble deployment or audio URL")
            self.assertEqual(len(transport.requests), 2)
        transport = Transport([response(SUBMIT), response(complete({"path": "audio", "url": "/audio.wav"}), "text/event-stream"), response(b"wav", "audio/wav")])
        async with synthesize(BASE, transport=transport, auth=AUTH, base_url="http://localhost:8080/root") as audio:
            self.assertEqual([item async for item in audio], [b"wav", {"event": "done", "request_id": "event/?#雪"}])
        self.assertEqual(transport.requests[-1].headers, {"Authorization": "Bearer fixture"})

    async def test_http_errors_at_every_stage_keep_body_identity_and_retry(self) -> None:
        for stage in ["upload", "info", "submit", "queue", "download"]:
            for status in [302, 401, 429, 503]:
                replies: list[HttpResponse | Exception] = []
                request: TtsRequest = BASE
                if stage == "upload":
                    request = {"text": "Hello", "reference_audio": b"audio"}
                elif stage == "info":
                    request = {"text": "Hello", "model": "chatterbox-turbo"}
                if stage in ("queue", "download"):
                    replies.append(response(SUBMIT))
                if stage == "download":
                    replies.append(response(complete(), "text/event-stream"))
                failure = response(b"quota \xff", "text/plain", status)
                replies.append(failure)
                transport = Transport(replies)
                with self.assertRaises(ResembleError) as error:
                    async with synthesize(request, transport=transport, auth=AUTH) as audio:
                        await anext(audio)
                self.assertEqual((error.exception.status_code, error.exception.body, error.exception.request_id, error.exception.retry_after), (status, "quota �", "event/?#雪" if stage in ("queue", "download") else None, "7"))
                self.assertEqual(str(error.exception), f"Resemble Chatterbox returned HTTP {status}")
                self.assertEqual(cast(Body, failure.body).closes, 1)
                self.assertEqual(len(transport.requests), len(replies))

    async def test_queue_error_is_not_a_done_event(self) -> None:
        body = Body([b'event: error\ndata: "GPU quota exhausted"\n\n'], stall=True)
        transport = Transport([response(SUBMIT), HttpResponse(200, {"Content-Type": "text/event-stream"}, body)])
        with self.assertRaises(ResembleError) as error:
            async with synthesize(BASE, transport=transport, auth=AUTH) as audio:
                await anext(audio)
        self.assertEqual((str(error.exception), error.exception.status_code, error.exception.body, error.exception.request_id, error.exception.retry_after), ("Resemble Chatterbox generation failed", None, '"GPU quota exhausted"', "event/?#雪", None))
        self.assertEqual((body.reads, body.closes), (1, 1))

    async def test_invalid_protocol_data_and_content_types(self) -> None:
        cases: list[tuple[TtsRequest, list[HttpResponse | Exception], str]] = []
        for value in [[], [""], [None], ["one", "two"], {"path": "x"}]:
            cases.append(({"text": "Hello", "reference_audio": b"audio"}, [response(json.dumps(value).encode())], "Resemble returned an invalid upload path"))
        for value in [{}, {"event_id": ""}, {"event_id": "."}, {"event_id": ".."}, {"event_id": 0}]:
            cases.append((BASE, [response(json.dumps(value).encode())], "Resemble returned an invalid event ID"))
        invalid_metadata: list[object] = [{}, {"named_endpoints": {}}, {"named_endpoints": {"/generate": {"parameters": []}}}, {"named_endpoints": {"/generate": {"parameters": [None, {"parameter_name": "wrong", "parameter_default": {"path": "x"}}]}}}]
        for value in invalid_metadata:
            cases.append(({"text": "Hello", "model": "chatterbox-turbo"}, [response(json.dumps(value).encode())], "Resemble returned no default reference recording"))
        for value in [b"{", b"NaN", b"[" * 2000, b"\xff"]:
            cases.append((BASE, [response(value)], "Resemble returned invalid JSON"))
        for file in [{"path": ""}, {"path": 1}, {"path": "a", "url": 3}, {"path": "a", "meta": None}, {"path": "a", "meta": {"_type": "wrong"}}, {"path": "a", "is_stream": 0}]:
            cases.append((BASE, [response(SUBMIT), response(complete(file), "text/event-stream")], "Resemble returned an invalid audio file"))
        cases.extend([
            (BASE, [response(SUBMIT), response(complete(), "application/json")], "Resemble returned no event stream"),
            (BASE, [response(SUBMIT), response(complete(), "text/event-stream"), response(b"{}")], "Resemble returned no audio stream"),
            (BASE, [response(SUBMIT), response(complete(), "text/event-stream"), response(b"", "audio/wav")], "Resemble returned empty audio"),
        ])
        for request, replies, expected in cases:
            with self.subTest(expected=expected, replies=replies):
                transport = Transport(replies)
                with self.assertRaises(TypeError) as error:
                    async with synthesize(request, transport=transport, auth=AUTH) as audio:
                        await anext(audio)
                self.assertEqual(str(error.exception), expected)
                self.assertEqual([cast(Body, item.body).closes for item in replies if isinstance(item, HttpResponse)], [1] * len(replies))

    async def test_schema_validation_rejects_capability_mismatch_before_io(self) -> None:
        requests: list[object] = [
            {"text": "Hello", "voice": "saved"}, {"text": ["Hello"]}, {"text": "Hello", "language": "en"},
            {"text": "Hello", "temperature": 0}, {"text": "Hello", "temperature": float("nan")},
            {"text": "Hello", "random_seed": True}, {"text": "Hello", "temperature": None},
            {"text": "Hello", "model": "chatterbox-turbo", "voice_guidance": 0.5},
            {"text": "Hello", "model": "chatterbox-turbo", "temperature": 5},
            {"text": "Hello", "model": "chatterbox-turbo", "reference_audio_trimming": False},
            {"text": "Hello", "model": "chatterbox-multilingual", "language": "auto"},
            {"text": "Hello", "model": "chatterbox-multilingual", "min_p": 0},
            {"text": "Hello", "output": {"format": "wav", "sample_rate_hz": 24000}},
            {"text": "Hello", "output": {"format": "mp3"}}, {"text": "😀" * 301},
        ]
        for request in requests:
            transport = Transport([])
            with self.assertRaises(TypeError) as expected:
                validate_request(request)
            with self.assertRaises(TypeError) as error:
                async with synthesize(cast(TtsRequest, request), transport=transport, auth=AUTH):
                    self.fail("invalid request was accepted")
            self.assertEqual(error.exception.args, expected.exception.args)
            self.assertEqual(transport.requests, [])
        request = cast(TtsRequest, MappingProxyType({"text": "😀" * 300, "output": MappingProxyType({"format": "wav"})}))
        transport = Transport([response(SUBMIT), response(complete(), "text/event-stream"), response(b"wav", "audio/wav")])
        async with synthesize(request, transport=transport, auth=AUTH) as audio:
            self.assertEqual([item async for item in audio], [b"wav", {"event": "done", "request_id": "event/?#雪"}])
        self.assertEqual(json.loads(transport.requests[0].body)["data"][0], "😀" * 300)

    async def test_auth_precedence_explicit_empty_and_public_access(self) -> None:
        cases: list[tuple[Auth | None, dict[str, str], str | None]] = [
            (AUTH, {"SPEECHSWITCH_RESEMBLE_TOKEN": "scoped", "HF_TOKEN": "vendor"}, "Bearer fixture"),
            (None, {"SPEECHSWITCH_RESEMBLE_TOKEN": "scoped", "HF_TOKEN": "vendor"}, "Bearer scoped"),
            (None, {"HF_TOKEN": "vendor"}, "Bearer vendor"),
            ({"resemble": {"token": ""}}, {"HF_TOKEN": "vendor"}, None),
            (None, {"SPEECHSWITCH_RESEMBLE_TOKEN": "", "HF_TOKEN": "vendor"}, None), (None, {}, None),
        ]
        for auth, environment, expected in cases:
            transport = Transport([response(SUBMIT), response(complete(), "text/event-stream"), response(b"wav", "audio/wav")])
            with patch.dict(os.environ, environment, clear=True):
                async with synthesize(BASE, transport=transport, auth=auth) as audio:
                    self.assertEqual([item async for item in audio], [b"wav", {"event": "done", "request_id": "event/?#雪"}])
            self.assertEqual([call.headers.get("Authorization") for call in transport.requests], [expected] * 3)

    async def test_boundary_configuration_errors_before_io(self) -> None:
        for url in ["ws://api.test", "https://user:pass@api.test", "https://api.test/#fragment", "relative/path", "https://", "https://api.test:99999", "https://api.test/%bad%", "\nhttps://api.test"]:
            transport = Transport([])
            with self.assertRaises(TypeError) as error:
                async with synthesize(BASE, transport=transport, auth=AUTH, base_url=url):
                    self.fail("invalid URL was accepted")
            self.assertEqual(str(error.exception), "Invalid Resemble deployment or audio URL")
            self.assertEqual(transport.requests, [])
        for token in ["a\rb", "a\nb", "雪", "a\0b", "a\x7fb"]:
            with self.assertRaises(TypeError) as error:
                async with synthesize(BASE, transport=Transport([]), auth={"resemble": {"token": token}}):
                    self.fail("unsafe token was accepted")
            self.assertEqual(str(error.exception), "Invalid Resemble token")
        for timeout in [-1, True, 1.5, 2147483648]:
            with self.assertRaises(TypeError) as error:
                async with synthesize(BASE, transport=Transport([]), timeout_ms=cast(int, timeout), auth=AUTH):
                    self.fail("invalid timeout was accepted")
            self.assertEqual(str(error.exception), "Resemble timeout_ms must be an integer between 0 and 2147483647")
        for field in ["max_json_bytes", "max_event_bytes"]:
            for limit in [0, -1, True, 1.5]:
                with self.assertRaises(TypeError) as error:
                    async with synthesize(BASE, transport=Transport([]), auth=AUTH,
                                          max_json_bytes=cast(int, limit) if field == "max_json_bytes" else 1024,
                                          max_event_bytes=cast(int, limit) if field == "max_event_bytes" else 1024):
                        self.fail("invalid limit was accepted")
                self.assertEqual(str(error.exception), f"Resemble {field} must be a positive integer")
        with self.assertRaises(TimeoutError) as error:
            async with synthesize(BASE, transport=Transport([]), auth=AUTH, timeout_ms=0):
                self.fail("zero deadline was accepted")
        self.assertEqual(str(error.exception), "Resemble synthesis deadline expired")

    async def test_multipart_boundary_never_collides_with_reference(self) -> None:
        reference = b"\r\n--speechswitch-fixed\r\nContent-Type: fake\r\n"
        transport = Transport([response(b'["/uploaded"]'), response(SUBMIT), response(complete(), "text/event-stream"), response(b"wav", "audio/wav")])
        with patch("speechswitch.providers.resemble.secrets.token_hex", return_value="fixed"):
            async with synthesize({"text": "Hello", "reference_audio": reference}, transport=transport, auth=AUTH) as audio:
                self.assertEqual([item async for item in audio], [b"wav", {"event": "done", "request_id": "event/?#雪"}])
        self.assertEqual(transport.requests[0].headers["Content-Type"], "multipart/form-data; boundary=speechswitch-fixed-")
        self.assertEqual(transport.requests[0].body, b'--speechswitch-fixed-\r\nContent-Disposition: form-data; name="files"; filename="reference.audio"\r\nContent-Type: application/octet-stream\r\n\r\n' + reference + b"\r\n--speechswitch-fixed---\r\n")

    async def test_cancellation_and_deadlines_at_each_response_stage(self) -> None:
        for stage in ["upload", "info", "submit", "queue", "download", "error"]:
            for deadline in [False, True]:
                body = Body([], stall=True, close_error=OSError("cleanup"))
                request: TtsRequest = {"text": "Hello", "reference_audio": b"audio"} if stage == "upload" else {"text": "Hello", "model": "chatterbox-turbo"} if stage == "info" else BASE
                replies: list[HttpResponse | Exception] = []
                if stage in ("queue", "download"):
                    replies.append(response(SUBMIT))
                if stage == "download":
                    replies.append(response(complete(), "text/event-stream"))
                replies.append(HttpResponse(503 if stage == "error" else 200, {"Content-Type": "text/event-stream" if stage == "queue" else "application/octet-stream" if stage == "download" else "application/json"}, body))
                transport = Transport(replies)
                async def consume() -> list[SynthesisItem]:
                    async with synthesize(request, transport=transport, auth=AUTH, timeout_ms=20 if deadline else None) as audio:
                        return [item async for item in audio]
                task = asyncio.create_task(consume())
                await asyncio.wait_for(body.reading.wait(), 1)
                if not deadline:
                    task.cancel("stop")
                with self.assertRaises(TimeoutError if deadline else asyncio.CancelledError):
                    await task
                self.assertEqual(body.closes, 1)
                self.assertEqual(len(transport.requests), len(replies))

    async def test_buffered_responses_allow_scheduled_cancellation(self) -> None:
        class BufferedBody(Body):
            async def __anext__(self) -> bytes:
                chunk = await super().__anext__()
                if self.reads == 1:
                    task = asyncio.current_task()
                    assert task is not None
                    loop = asyncio.get_running_loop()
                    loop.call_soon(loop.call_soon, task.cancel)
                return chunk

        for stage, chunks in [
            ("submit", [b" "] * 32 + [SUBMIT]),
            ("error", [b"error"] * 32),
            ("queue", [b":\n\n"] * 32 + [complete()]),
            ("queue", [b":\n\n" * 16384 + complete()]),
            ("download", [b"wav"] * 32),
        ]:
            with self.subTest(stage=stage, chunks=len(chunks)):
                body = BufferedBody(chunks)
                replies: list[HttpResponse | Exception] = []
                if stage in ("queue", "download"):
                    replies.append(response(SUBMIT))
                if stage == "download":
                    replies.append(response(complete(), "text/event-stream"))
                replies.append(HttpResponse(503 if stage == "error" else 200,
                    {"Content-Type": "text/event-stream" if stage == "queue" else "audio/wav" if stage == "download" else "application/json"}, body))
                transport = Transport(replies)
                async def consume() -> list[SynthesisItem]:
                    async with synthesize(BASE, transport=transport, auth=AUTH) as audio:
                        return [item async for item in audio]
                task = asyncio.create_task(consume())
                with self.assertRaises(asyncio.CancelledError):
                    await task
                self.assertEqual(body.closes, 1)
                self.assertEqual(len(transport.requests), len(replies))

    async def test_pending_headers_cancel_without_retries(self) -> None:
        class PendingTransport:
            def __init__(self) -> None:
                self.started = asyncio.Event()
                self.released = self.calls = 0

            async def send(self, request: HttpRequest) -> HttpResponse:
                self.calls += 1
                self.started.set()
                try:
                    await asyncio.Future[None]()
                    raise AssertionError("unreachable")
                finally:
                    self.released += 1

        for deadline in [False, True]:
            transport = PendingTransport()
            async def consume() -> None:
                async with synthesize(BASE, transport=transport, auth=AUTH, timeout_ms=20 if deadline else None) as audio:
                    await anext(audio)
            task = asyncio.create_task(consume())
            await asyncio.wait_for(transport.started.wait(), 1)
            if not deadline:
                task.cancel()
            with self.assertRaises(TimeoutError if deadline else asyncio.CancelledError):
                await task
            self.assertEqual((transport.calls, transport.released), (1, 1))

    async def test_read_and_consumer_errors_survive_cleanup_failure(self) -> None:
        for stage in ["submit", "queue", "download", "consumer"]:
            original = RuntimeError("original")
            body = Body([b"first"] if stage == "consumer" else [original], close_error=OSError("cleanup"))
            replies: list[HttpResponse | Exception] = []
            if stage != "submit":
                replies.append(response(SUBMIT))
            if stage in ("download", "consumer"):
                replies.append(response(complete(), "text/event-stream"))
            replies.append(HttpResponse(200, {"Content-Type": "text/event-stream" if stage == "queue" else "application/octet-stream"}, body))
            with self.assertRaises(RuntimeError) as error:
                async with synthesize(BASE, transport=Transport(replies), auth=AUTH) as audio:
                    if stage == "consumer":
                        self.assertEqual(await anext(audio), b"first")
                        raise original
                    await anext(audio)
            self.assertIs(error.exception, original)
            self.assertEqual(body.closes, 1)
        original = OSError("network")
        with self.assertRaises(OSError) as error:
            async with synthesize(BASE, transport=Transport([original]), auth=AUTH) as audio:
                await anext(audio)
        self.assertIs(error.exception, original)

    async def test_json_and_sse_resource_limits(self) -> None:
        for stage in ["submit", "error", "info", "upload"]:
            body = Body([b"abcd", b"efgh"], stall=True)
            transport = Transport([HttpResponse(500 if stage == "error" else 200, {}, body)])
            request: TtsRequest = {"text": "Hello", "model": "chatterbox-turbo"} if stage == "info" else {"text": "Hello", "reference_audio": b"audio"} if stage == "upload" else BASE
            with self.assertRaises(TypeError) as error:
                async with synthesize(request, transport=transport, auth=AUTH, max_json_bytes=7) as audio:
                    await anext(audio)
            self.assertEqual(str(error.exception), "Resemble response exceeds max_json_bytes")
            self.assertEqual((body.reads, body.closes), (2, 1))
        queue = Body([b":" + b"a" * 100], stall=True)
        with self.assertRaises(ValueError) as limit_error:
            async with synthesize(BASE, transport=Transport([response(SUBMIT), HttpResponse(200, {"Content-Type": "text/event-stream"}, queue)]), auth=AUTH, max_event_bytes=100) as audio:
                await anext(audio)
        self.assertEqual(str(limit_error.exception), "SSE event exceeds byte limit")
        self.assertEqual((queue.reads, queue.closes), (1, 1))


if __name__ == "__main__":
    unittest.main()
