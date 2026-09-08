import asyncio
import json
import re
import struct
import unittest
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import cast
from unittest.mock import patch

from speechswitch.generated.auth import Auth
from speechswitch.generated.microsoft import TtsRequest
from speechswitch.generated.validators.microsoft import validate_request
from speechswitch.http import HttpRequest, HttpResponse
from speechswitch.providers.microsoft import MicrosoftError, synthesize
from speechswitch.validation import is_mapping, is_sequence
from speechswitch.websocket import WebSocketError
from test_websocket import server, upgrade, client_frame

FIXTURE: dict[str, object] = json.loads((Path(__file__).parents[2] / "fixtures/microsoft.json").read_text())
AUTH: Auth = {"microsoft": {"api_key": "test-key", "region": "eastus"}}


def hydrate(value: object) -> object:
    if is_mapping(value): return {re.sub(r"[A-Z]", lambda m: "_" + m[0].lower(), str(key)): hydrate(item) for key, item in value.items()}
    if is_sequence(value): return [hydrate(item) for item in value]
    return value


def request(**changes: object) -> TtsRequest:
    return cast(TtsRequest, {"text": "Hi", "voice": "en-US-AvaNeural", **changes})


class Source[T]:
    def __init__(self, values: Sequence[T | Exception], stall: bool = False) -> None:
        self.values, self.stall = list(values), stall
        self.pulls = self.closes = self.acquisitions = 0
        self.waiting, self.closed = asyncio.Event(), asyncio.Event()
    def __aiter__(self) -> AsyncIterator[T]:
        self.acquisitions += 1
        return self
    async def __anext__(self) -> T:
        self.pulls += 1
        if self.values:
            value = self.values.pop(0)
            if isinstance(value, Exception): raise value
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


def text_frame(path: str, request_id: str, body: object = {}) -> str:
    return f"Path: {path}\r\nX-RequestId: {request_id}\r\n\r\n{json.dumps(body)}"


def audio_frame(request_id: str, stream_id: str = "stream") -> bytes:
    headers = f"Path: audio\r\nX-RequestId: {request_id}\r\nX-StreamId: {stream_id}\r\n".encode()
    return len(headers).to_bytes(2, "big") + headers + b"\x00\xff\x80"


@dataclass(frozen=True)
class Frame:
    path: str
    request_id: str
    body: str


def _frame(message: str) -> Frame:
    headers, body = message.split("\r\n\r\n", 1)
    fields = dict(line.split(": ", 1) for line in headers.split("\r\n"))
    return Frame(fields["Path"], fields["X-RequestId"], body)


class Socket:
    def __init__(self, auto: bool = True) -> None:
        self.incoming: asyncio.Queue[str | bytes | Exception] = asyncio.Queue()
        self.sent: list[str] = []
        self.closes = 0
        self.auto, self.responded = auto, False
        self.closed = asyncio.Event()
        self.on_send: Callable[[str], Awaitable[None]] | None = None
    async def send(self, message: str | bytes) -> None:
        assert isinstance(message, str)
        value = message
        self.sent.append(value)
        if self.on_send is not None: await self.on_send(value)
        frame = _frame(value)
        if self.auto and frame.path in ("ssml", "text.piece") and not self.responded:
            self.responded = True
            self.incoming.put_nowait(text_frame("response", frame.request_id, {"audio": {"streamId": "stream"}}))
            self.incoming.put_nowait(text_frame("audio.metadata", frame.request_id, FIXTURE["metadata"]))
            self.incoming.put_nowait(audio_frame(frame.request_id))
        if self.auto and frame.path in ("ssml", "text.end"):
            self.incoming.put_nowait(text_frame("turn.end", frame.request_id))
    async def receive(self) -> str | bytes:
        value = await self.incoming.get()
        if isinstance(value, Exception): raise value
        return value
    async def aclose(self) -> None:
        self.closes += 1
        self.closed.set()


class MicrosoftTests(unittest.IsolatedAsyncioTestCase):
    async def test_shared_ssml_formats_early_audio_and_existing_deployment(self) -> None:
        for output, expected in cast(list[tuple[object, str]], FIXTURE["formats"]):
            body = Source([b"\x01"], stall=True)
            transport = Transport(body)
            r = cast(TtsRequest, {**cast(dict[str, object], hydrate(FIXTURE["request"])), "output": hydrate(output)})
            async with synthesize(r, auth=AUTH, transport=transport, base_url="https://proxy.invalid/a%2Fb/?tenant=one", deployment_id="custom/1") as stream:
                self.assertEqual(await anext(stream), b"\x01")
                self.assertEqual(body.pulls, 1)
            self.assertEqual(body.closes, 1)
            self.assertEqual(transport.requests, [HttpRequest("POST", "https://proxy.invalid/a%2Fb/cognitiveservices/v1?tenant=one&deploymentId=custom%2F1", {"Ocp-Apim-Subscription-Key": "test-key", "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": expected, "User-Agent": "speechswitch"}, str(FIXTURE["ssml"]).encode())])

    async def test_model_suffixes_sampling_and_raw_ssml(self) -> None:
        for model, suffix, parameters in [("dragon-hd", ":DragonHDLatestNeural", ' parameters="temperature=1"'), ("dragon-hd-omni", ":DragonHDOmniLatestNeural", ' parameters="temperature=0.7"'), ("dragon-hd-flash", ":DragonHDFlashLatestNeural", ""), ("mai-voice-2", ":MAI-Voice-2", ""), ("mai-voice-2-flash", ":MAI-Voice-2-Flash", "")]:
            transport = Transport(Source([b"a"]))
            async with synthesize(request(model=model, voice="en-US-Ava"), auth=AUTH, transport=transport) as stream:
                self.assertEqual([v async for v in stream], [b"a"])
            self.assertEqual(transport.requests[0].body.decode(), f'<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US"><voice name="en-US-Ava{suffix}"{parameters}>Hi</voice></speak>')
        for r, expected in [
            (request(model="dragon-hd-omni", voice="en-US-Ava", language="fr-FR", temperature=0.8, top_p=0.9, top_k=20, voice_guidance=1.2), '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US"><voice name="en-US-Ava:DragonHDOmniLatestNeural" parameters="temperature=0.8;top_p=0.9;top_k=20;cfg_scale=1.2"><lang xml:lang="fr-FR">Hi</lang></voice></speak>'),
            (cast(TtsRequest, {"text": "<speak>custom lexicon and voice</speak>", "input_type": "ssml"}), "<speak>custom lexicon and voice</speak>"),
        ]:
            transport = Transport(Source([b"a"]))
            async with synthesize(r, auth=AUTH, transport=transport) as stream: await anext(stream)
            self.assertEqual(transport.requests[0].body.decode(), expected)

    async def test_integral_json_numbers_keep_exact_format_tokens(self) -> None:
        for output, expected in cast(list[tuple[dict[str, object], str]], FIXTURE["formats"]):
            floating = {key: float(value) if isinstance(value, int) else value for key, value in output.items()}
            transport = Transport(Source([b"a"]))
            async with synthesize(request(output=hydrate(floating)), auth=AUTH, transport=transport) as stream:
                self.assertEqual(await anext(stream), b"a")
            self.assertEqual(transport.requests[0].headers["X-Microsoft-OutputFormat"], expected)

    async def test_explicit_empty_streaming_controls_are_not_omitted(self) -> None:
        socket = Socket()
        r: TtsRequest = {"text": Source(["Hi"]), "voice": "en-US-AvaNeural", "lexicon_url": "", "preferred_languages": []}
        async with synthesize(r, web_socket=socket) as stream:
            items = [v async for v in stream]
        self.assertEqual(json.loads(_frame(socket.sent[1]).body)["synthesis"]["input"], {
            "bidirectionalStreamingMode": True, "voiceName": "en-US-AvaNeural", "language": "en-US",
            "customLexiconUrl": "", "preferLocales": "",
        })
        self.assertEqual(items, [b"\x00\xff\x80", {"event": "done", "request_id": _frame(socket.sent[0]).request_id, "duration_ms": 10}])

    async def test_streaming_controls_and_independent_timeline_envelopes(self) -> None:
        socket = Socket()
        source = Source(["Hi"], stall=True)
        async with synthesize(request(text=source, timestamp_granularity=["word", "sentence"], lexicon_url="https://example.com/lexicon", preferred_languages=["en-US", "zh-CN"]), web_socket=socket) as stream:
            marks = await anext(stream)
            audio = await anext(stream)
            request_id = _frame(socket.sent[0]).request_id
            expected = cast(list[object], hydrate(FIXTURE["timestamps"]))[:2]
            self.assertEqual(marks, {"correlation": "timeline", "correlation_id": request_id, "stream_id": "stream", "timestamps": expected, "duration_ms": 10})
            self.assertEqual(audio, {"correlation": "timeline", "correlation_id": request_id, "stream_id": "stream", "audio": b"\x00\xff\x80", "timestamps": []})
            self.assertEqual(json.loads(_frame(socket.sent[1]).body)["synthesis"]["input"], FIXTURE["streamingInput"])
        await asyncio.wait_for(source.closed.wait(), 1)
        self.assertEqual(socket.closes, 1)
        self.assertEqual([_frame(v).path for v in socket.sent], ["speech.config", "synthesis.context", "text.piece", "synthesis.control"])

    async def test_indexed_controls_preserve_validated_locales_and_timestamps(self) -> None:
        class Indexed(list[str]):
            def __iter__(self) -> Iterator[str]:
                raise AssertionError("custom iteration must not replace indexed values")
            def __contains__(self, value: object) -> bool:
                raise AssertionError("custom membership must not replace indexed values")

        socket = Socket()
        async with synthesize(request(text=Source(["Hi"]),
                                      preferred_languages=Indexed(["en-US", "zh-CN"]),
                                      timestamp_granularity=Indexed(["word", "sentence"])),
                              web_socket=socket) as stream:
            items = [item async for item in stream]
        context = json.loads(_frame(socket.sent[1]).body)["synthesis"]
        self.assertEqual(context["input"]["preferLocales"], "en-US,zh-CN")
        self.assertEqual(context["audio"]["metadataOptions"], {
            "wordBoundaryEnabled": True, "sentenceBoundaryEnabled": True,
            "punctuationBoundaryEnabled": False, "bookmarkEnabled": False,
            "visemeEnabled": False, "sessionEndEnabled": True,
        })
        self.assertEqual(cast(Mapping[str, object], items[0])["timestamps"], cast(list[object], hydrate(FIXTURE["timestamps"]))[:2])
        source = Source(["Hi"])
        unused = Socket()
        with self.assertRaises(TypeError) as error:
            async with synthesize(request(text=source, preferred_languages=Indexed(["en-US,zh-CN"])), web_socket=unused):
                pass
        self.assertEqual(str(error.exception), "Microsoft preferred languages cannot contain commas or line breaks")
        self.assertEqual(source.acquisitions, 0)
        self.assertEqual(unused.sent, [])

    async def test_whole_ssml_metadata_and_done_keep_animation_false(self) -> None:
        socket = Socket()
        async with synthesize(cast(TtsRequest, {"text": "<speak/>", "input_type": "ssml", "timestamp_granularity": ["word", "sentence", "viseme", "ssml"]}), web_socket=socket) as stream:
            items = [v async for v in stream]
        request_id = _frame(socket.sent[0]).request_id
        self.assertEqual(items, [
            {"correlation": "timeline", "correlation_id": request_id, "stream_id": "stream", "timestamps": hydrate(FIXTURE["timestamps"]), "duration_ms": 10},
            {"correlation": "timeline", "correlation_id": request_id, "stream_id": "stream", "timestamps": [], "audio": b"\x00\xff\x80"},
            {"event": "done", "request_id": request_id, "duration_ms": 10},
        ])
        self.assertEqual([_frame(v).path for v in socket.sent], ["speech.config", "synthesis.context", "ssml"])
        self.assertEqual(socket.closes, 1)

    async def test_generated_validation_and_delimiter_checks_precede_io(self) -> None:
        for change in [{"model": "dragon-hd-omni", "top_k": 1.5}, {"model": "dragon-hd", "speed": 1.2}, {"volume_scale": 1.1}, {"model": "dragon-hd-flash", "language": "fr-FR"}, {"lexicon_url": "url"}, {"preferred_languages": ["en-US"]}]:
            body = Source([b"a"])
            invalid = request(**change)
            with self.assertRaises(TypeError) as expected:
                validate_request(invalid)
            with self.assertRaises(TypeError) as error:
                async with synthesize(invalid, transport=Transport(body)): pass
            self.assertEqual(error.exception.args, expected.exception.args)
            self.assertEqual(body.pulls, 0)
        source = Source(["Hi"])
        for languages in [["en-US,zh-CN"], ["en\nUS"]]:
            with self.assertRaises(TypeError) as error:
                async with synthesize(request(text=source, preferred_languages=languages), web_socket=Socket()): pass
            self.assertEqual(str(error.exception), "Microsoft preferred languages cannot contain commas or line breaks")
        self.assertEqual(source.acquisitions, 0)

    def test_candidate_count_diagnostics_match_shared_fixture(self) -> None:
        template = (Path(__file__).parents[2] / "fixtures/microsoft-invalid-top-k.txt").read_text().removesuffix("\n")
        for top_k, detail in [(1.5, "expected safe integer"), (0, "expected number >= 1"),
                              (51, "expected number <= 50"), (float("nan"), "expected finite number")]:
            with self.assertRaises(TypeError) as error:
                validate_request(request(text="Hello", voice="en-US-Ava", model="dragon-hd-omni", top_k=top_k))
            self.assertEqual(str(error.exception), template.replace("{{constraint}}", detail))

    async def test_streaming_command_is_rejected_without_sending_it(self) -> None:
        source = Source([{"command": "clear"}])
        socket = Socket(auto=False)
        with self.assertRaises(TypeError) as error:
            async with synthesize(request(text=source), web_socket=socket) as stream: await anext(stream)
        self.assertEqual(str(error.exception), 'Invalid microsoft TTS input item:\ntext item: expected string')
        self.assertEqual([_frame(v).path for v in socket.sent], ["speech.config", "synthesis.context", "synthesis.control"])
        self.assertEqual(socket.closes, 1)
        await asyncio.wait_for(source.closed.wait(), 1)

    async def test_http_failures_bounds_content_type_and_body_error_identity(self) -> None:
        for status, data, limit, expected in [(429, b"quota", 1024, "Microsoft synthesis failed (429): quota"), (307, b"", 1024, "Microsoft synthesis failed (307): "), (500, b"abcd", 3, "Microsoft response exceeds max_json_bytes")]:
            body = Source([data])
            with self.assertRaises(Exception) as error:
                async with synthesize(request(), auth=AUTH, transport=Transport(body, status, {"Retry-After": "3"}), max_json_bytes=limit) as stream: await anext(stream)
            self.assertEqual(str(error.exception), expected)
            self.assertEqual(body.closes, 1)
            if isinstance(error.exception, MicrosoftError): self.assertEqual((error.exception.status_code, error.exception.retry_after), (status, "3"))
        body = Source([b"{}"])
        with self.assertRaises(TypeError) as error:
            async with synthesize(request(), auth=AUTH, transport=Transport(body, headers={"content-type": "application/json"})) as stream: await anext(stream)
        self.assertEqual(str(error.exception), "Microsoft returned a non-audio response")
        self.assertEqual((body.pulls, body.closes), (0, 1))
        original = RuntimeError("original")
        failed: Source[bytes] = Source([original])
        with self.assertRaises(RuntimeError) as error:
            async with synthesize(request(), auth=AUTH, transport=Transport(failed)) as stream: await anext(stream)
        self.assertIs(error.exception, original)
        self.assertEqual(failed.closes, 1)

    async def test_auth_environment_domains_and_explicit_empty(self) -> None:
        with patch.dict("os.environ", {"SPEECHSWITCH_MICROSOFT_API_KEY": "scoped", "AZURE_SPEECH_KEY": "vendor", "SPEECHSWITCH_MICROSOFT_REGION": "chinaeast2"}, clear=True):
            for auth, host, headers in [(None, "chinaeast2.tts.speech.azure.cn", {"Ocp-Apim-Subscription-Key": "scoped"}), ({"microsoft": {"access_token": "token", "api_key": "key", "region": "usgovvirginia"}}, "usgovvirginia.tts.speech.azure.us", {"Authorization": "Bearer token"})]:
                transport = Transport(Source([b"a"]))
                async with synthesize(request(), auth=cast(Auth | None, auth), transport=transport) as stream: await anext(stream)
                self.assertEqual(transport.requests[0].url, f"https://{host}/cognitiveservices/v1")
                self.assertEqual(dict(transport.requests[0].headers), {**headers, "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": "raw-24khz-16bit-mono-pcm", "User-Agent": "speechswitch"})
            with self.assertRaises(TypeError) as error:
                async with synthesize(request(), auth={"microsoft": {"api_key": ""}}, transport=Transport(Source([b"a"]))): pass
            self.assertEqual(str(error.exception), "Missing auth.microsoft.apiKey or auth.microsoft.accessToken configuration")

    async def test_unread_override_closes_without_acquiring_text(self) -> None:
        source = Source(["Hi"])
        socket = Socket()
        async with synthesize(request(text=source), web_socket=socket): pass
        self.assertEqual((source.acquisitions, source.pulls, socket.closes, socket.sent), (0, 0, 1, []))

    async def test_cancel_and_deadline_release_pending_http(self) -> None:
        for timeout in [None, 10]:
            body: Source[bytes] = Source([], stall=True)
            async def consume() -> None:
                async with synthesize(request(), auth=AUTH, transport=Transport(body), timeout_ms=timeout) as stream: await anext(stream)
            task = asyncio.create_task(consume())
            await body.waiting.wait()
            if timeout is None: task.cancel()
            with self.assertRaises(asyncio.CancelledError if timeout is None else TimeoutError) as error: await asyncio.wait_for(task, 1)
            if timeout is not None: self.assertEqual(str(error.exception), "Microsoft synthesis deadline expired")
            self.assertEqual(body.closes, 1)

    async def test_protocol_failures_are_exact_and_close_socket(self) -> None:
        cases: list[tuple[Callable[[str], str | bytes], str]] = [
            (lambda id: text_frame("turn.end", "wrong"), "Microsoft returned an unexpected synthesis request ID"),
            (lambda id: audio_frame(id), "Microsoft returned audio for an unexpected stream"),
            (lambda id: text_frame("response", id, {"audio": {}}), "Microsoft synthesis response is missing audio.streamId"),
            (lambda id: text_frame("audio.metadata", id, {"Metadata": [{"Type": "WordBoundary", "Data": {"Offset": True}}]}), "Microsoft returned invalid metadata Offset"),
            (lambda id: b"\x00", "Microsoft binary frame is missing its header length"),
            (lambda id: b"\x00\x03ab", "Microsoft binary frame has a truncated header"),
            (lambda id: b"\x00\x01\xff", "Microsoft binary frame has invalid UTF-8 headers"),
            (lambda id: f"Path: response\r\npath: audio\r\nX-RequestId: {id}\r\n\r\n{{}}", "Microsoft frame repeats header path"),
            (lambda id: "missing separator", "Microsoft text frame is missing its header separator"),
            (lambda id: text_frame("response", id, []), "Microsoft returned an invalid synthesis object"),
        ]
        for packet, expected in cases:
            socket = Socket(auto=False)
            async def inject(value: str) -> None:
                frame = _frame(value)
                if frame.path == "ssml": socket.incoming.put_nowait(packet(frame.request_id))
            socket.on_send = inject
            with self.assertRaises(TypeError) as error:
                async with synthesize(request(), web_socket=socket) as stream: await anext(stream)
            self.assertEqual(str(error.exception), expected)
            self.assertEqual(socket.closes, 1)

    async def test_producer_error_identity_and_premature_socket_close(self) -> None:
        original = RuntimeError("producer failed")
        for failure in [original, StopAsyncIteration()]:
            source: Source[str] = Source([original] if failure is original else [], stall=True)
            socket = Socket(auto=False)
            if failure is not original: socket.incoming.put_nowait(failure)
            with self.assertRaises(RuntimeError if failure is original else TypeError) as error:
                async with synthesize(request(text=source), web_socket=socket) as stream: await anext(stream)
            if failure is original: self.assertIs(error.exception, original)
            else: self.assertEqual(str(error.exception), "Microsoft WebSocket closed before turn.end")
            self.assertEqual(socket.closes, 1)
            await asyncio.wait_for(source.closed.wait(), 1)

    async def test_native_auth_paths_and_complete_turn(self) -> None:
        for live, credential in [(False, "token"), (True, "token"), (True, "key")]:
            captured: list[tuple[bytes, dict[bytes, bytes]]] = []
            disconnected = asyncio.Event()
            async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
                captured.append(await upgrade(reader, writer))
                while True:
                    opcode, payload = await client_frame(reader)
                    if opcode == 8: break
                    self.assertEqual(opcode, 1)
                    frame = _frame(payload.decode())
                    if frame.path == ("text.end" if live else "ssml"):
                        for message in [text_frame("response", frame.request_id, {"audio": {"streamId": "stream"}}), audio_frame(frame.request_id), text_frame("turn.end", frame.request_id)]:
                            data = message.encode() if isinstance(message, str) else message
                            writer.write(bytes([0x81 if isinstance(message, str) else 0x82, 126]) + struct.pack("!H", len(data)) + data if len(data) >= 126 else bytes([0x81 if isinstance(message, str) else 0x82, len(data)]) + data)
                        await writer.drain()
                disconnected.set()
            async with server(handle) as endpoint:
                auth: Auth = {"microsoft": {"access_token": "token"}} if credential == "token" else {"microsoft": {"api_key": "key"}}
                async with synthesize(request(text=Source(["Hi"]) if live else "Hi", timestamp_granularity="word"), auth=auth, base_url=endpoint.replace("ws:", "http:") + "/proxy%2Fpath?tenant=one", deployment_id="existing/1") as stream:
                    items = [v async for v in stream]
                await disconnected.wait()
            path = "cognitiveservices/websocket/v2" if live else "tts/cognitiveservices/websocket/v1"
            self.assertEqual(captured[0][0], f"GET /proxy%2Fpath/{path}?tenant=one&deploymentId=existing%2F1 HTTP/1.1".encode())
            self.assertEqual(captured[0][1].get(b"authorization"), b"Bearer token" if credential == "token" else None)
            self.assertEqual(captured[0][1].get(b"ocp-apim-subscription-key"), b"key" if credential == "key" else None)
            self.assertEqual(captured[0][1].get(b"sec-websocket-protocol"), None)
            self.assertEqual(len(items), 2)

    async def test_native_rejection_does_not_acquire_input(self) -> None:
        source = Source(["Hi"])
        async def reject(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            await reader.readuntil(b"\r\n\r\n")
            writer.write(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n")
            await writer.drain()
        async with server(reject) as endpoint:
            with self.assertRaises(WebSocketError):
                async with synthesize(request(text=source), auth=AUTH, web_socket_url=endpoint): pass
        self.assertEqual((source.acquisitions, source.pulls, source.closes), (0, 0, 0))

    async def test_cancel_does_not_wait_for_uncooperative_producer(self) -> None:
        release = asyncio.Event()
        class Stubborn(Source[str]):
            async def __anext__(self) -> str:
                self.waiting.set()
                try: await release.wait()
                except asyncio.CancelledError: await release.wait()
                return "late text"
        source = Stubborn([])
        socket = Socket(auto=False)
        async def consume() -> None:
            async with synthesize(request(text=source), web_socket=socket) as stream: await anext(stream)
        task = asyncio.create_task(consume())
        try:
            await asyncio.wait_for(source.waiting.wait(), 1)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError): await asyncio.wait_for(task, 1)
            self.assertEqual(socket.closes, 1)
        finally:
            release.set()
            await asyncio.wait_for(source.closed.wait(), 1)
        self.assertEqual([_frame(v).path for v in socket.sent], ["speech.config", "synthesis.context", "synthesis.control"])

    async def test_stalled_stop_send_cannot_block_close(self) -> None:
        socket = Socket()
        async def stall(value: str) -> None:
            if _frame(value).path == "synthesis.control": await asyncio.Future[None]()
        socket.on_send = stall
        source = Source(["Hi"], stall=True)
        async with asyncio.timeout(1):
            async with synthesize(request(text=source), web_socket=socket) as stream:
                self.assertEqual(await anext(stream), b"\x00\xff\x80")
        self.assertEqual(socket.closes, 1)
        await asyncio.wait_for(source.closed.wait(), 1)

    async def test_repeated_cancellation_during_stop_still_cleans_up(self) -> None:
        socket = Socket(auto=False)
        source: Source[str] = Source([], stall=True)
        async def consume() -> None:
            async with synthesize(request(text=source), web_socket=socket) as stream: await anext(stream)
        task = asyncio.create_task(consume())
        async def cancel_again(value: str) -> None:
            if _frame(value).path == "synthesis.control":
                task.cancel()
                await asyncio.Future[None]()
        socket.on_send = cancel_again
        await asyncio.wait_for(source.waiting.wait(), 1)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError): await asyncio.wait_for(task, 1)
        await asyncio.wait_for(source.closed.wait(), 1)
        self.assertEqual((socket.closes, source.closes, task.cancelling()), (1, 1, 2))
