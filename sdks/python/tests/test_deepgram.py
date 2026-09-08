import asyncio
import json
import os
import re
import unittest
from collections.abc import AsyncIterable, AsyncIterator, Awaitable, Callable, Sequence
from pathlib import Path
from typing import TypedDict, cast
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from speechswitch.generated.auth import Auth
from speechswitch.generated.deepgram import TtsRequest, TtsRequestAura1StreamingTextVoiceTextItem as Input
from speechswitch.generated.deepgram_output import SynthesisItem
from speechswitch.generated.validators.deepgram import validate_request
from speechswitch.http import HttpRequest, HttpResponse
from speechswitch.providers.deepgram import synthesize
from speechswitch.validation import is_mapping
from test_websocket import client_frame, server, upgrade

AUTH: Auth = {"deepgram": {"api_key": "test-key"}}


def request(text: str | AsyncIterable[Input] = "Hello") -> TtsRequest:
    if isinstance(text, str):
        return {"model": "aura-1", "language": "en", "voice": "asteria", "text": text, "output": {"format": "pcm", "sample_rate_hz": 24000}}
    return {"model": "aura-1", "language": "en", "voice": "asteria", "text": text, "output": {"format": "pcm", "sample_rate_hz": 24000}}


def normalized(value: object) -> object:
    if is_mapping(value):
        return {re.sub(r"[A-Z]", lambda m: "_" + m[0].lower(), str(k)): normalized(v) for k, v in value.items()}
    return value


class HttpFixture(TypedDict):
    name: str
    request: dict[str, object]
    query: dict[str, list[str]]


class Step(TypedDict):
    send: dict[str, object]
    receive: list[dict[str, object] | list[int]]


class StreamFixture(TypedDict):
    name: str
    input: list[Input]
    steps: list[Step]
    items: list[dict[str, object] | list[int]]


class Fixtures(TypedDict):
    http: list[HttpFixture]
    stream: list[StreamFixture]


def fixtures() -> Fixtures:
    return json.loads((Path(__file__).parents[2] / "fixtures/deepgram.json").read_text())


class Body:
    def __init__(self, chunks: list[bytes | Exception], *, stall: bool = False) -> None:
        self.chunks = list(chunks)
        self.stall = stall
        self.reads = 0
        self.closes = 0
        self.cancelled = 0
        self.waiting = asyncio.Event()
        self.close_error: Exception | None = None
    def __aiter__(self) -> AsyncIterator[bytes]:
        return self
    async def __anext__(self) -> bytes:
        self.reads += 1
        if self.chunks:
            chunk = self.chunks.pop(0)
            if isinstance(chunk, Exception):
                raise chunk
            return chunk
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
        if self.close_error is not None:
            raise self.close_error


class Transport:
    def __init__(self, body: Body, status: int = 200, content_type: str = "audio/l16") -> None:
        self.body, self.status, self.content_type = body, status, content_type
        self.requests: list[HttpRequest] = []
        self.stall = False
        self.cancelled = 0
        self.waiting = asyncio.Event()
        self.error: Exception | None = None
    async def send(self, request: HttpRequest) -> HttpResponse:
        self.requests.append(request)
        if self.error is not None:
            raise self.error
        if self.stall:
            self.waiting.set()
            try:
                await asyncio.Future[None]()
            except asyncio.CancelledError:
                self.cancelled += 1
                raise
        return HttpResponse(self.status, {"Content-Type": self.content_type}, self.body)


class Source:
    def __init__(self, values: Sequence[Input | Exception], *, stall: bool = False, trace: list[str] | None = None) -> None:
        self.values = list(values)
        self.stall = stall
        self.trace = trace
        self.pulls = 0
        self.closes = 0
        self.cancelled = 0
        self.waiting = asyncio.Event()
    def __aiter__(self) -> AsyncIterator[Input]:
        return self
    async def __anext__(self) -> Input:
        self.pulls += 1
        if self.values:
            value = self.values.pop(0)
            if isinstance(value, Exception):
                raise value
            return value
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
        self.closed = False
        self.closes = 0
        self.trace = trace
        self.on_send: Callable[[dict[str, object]], Awaitable[None]] | None = None
        self.close_error: Exception | None = None
    async def send(self, message: str | bytes) -> None:
        assert isinstance(message, str)
        if self.closed:
            raise AssertionError("late send")
        wire: dict[str, object] = json.loads(message)
        self.sent.append(wire)
        if self.on_send is not None:
            await self.on_send(wire)
        elif wire["type"] == "Speak":
            self.incoming.put_nowait(b"\0\xff")
        elif wire["type"] == "Flush":
            self.incoming.put_nowait('{"type":"Flushed","sequence_id":1}')
        elif wire["type"] == "Clear":
            self.incoming.put_nowait('{"type":"Cleared","sequence_id":2}')
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
            if self.close_error is not None:
                raise self.close_error


class DeepgramTests(unittest.IsolatedAsyncioTestCase):
    async def test_shared_http_fixtures(self) -> None:
        for fixture in fixtures()["http"]:
            with self.subTest(fixture=fixture["name"]):
                r = cast(TtsRequest, normalized(fixture["request"]))
                transport = Transport(Body([b"\0\xff", b"later"]))
                async with synthesize(r, auth=AUTH, transport=transport, base_url="https://proxy.test/prefix%20path/?keep=value&sample_rate=12000&container=bad&tag=old&api_key=stale&access_token=stale&speed=9") as audio:
                    self.assertEqual(transport.body.reads, 0)
                    self.assertEqual([v async for v in audio], [b"\0\xff", b"later"])
                self.assertEqual(transport.body.closes, 1)
                self.assertEqual(len(transport.requests), 1)
                sent = transport.requests[0]
                target = urlsplit(sent.url)
                self.assertEqual((sent.method, target.path), ("POST", "/prefix%20path/v1/speak"))
                self.assertEqual(parse_qs(target.query, keep_blank_values=True), {"keep": ["value"], **fixture["query"]})
                self.assertEqual(sent.headers, {"authorization": "Token test-key", "content-type": "application/json"})
                self.assertEqual(json.loads(sent.body), {"text": r["text"]})

    async def test_shared_stream_fixtures(self) -> None:
        for fixture in fixtures()["stream"]:
            with self.subTest(fixture=fixture["name"]):
                socket = Socket()
                source = Source(fixture["input"])
                steps = iter(fixture["steps"])
                async def send(wire: dict[str, object]) -> None:
                    step = next(steps)
                    self.assertEqual(wire, step["send"])
                    for frame in step["receive"]:
                        socket.incoming.put_nowait(bytes(frame) if isinstance(frame, list) else json.dumps(frame))
                socket.on_send = send
                async with asyncio.timeout(1):
                    async with synthesize(request(source), auth=AUTH, web_socket=socket) as audio:
                        actual = [list(v) if isinstance(v, bytes) else v async for v in audio]
                self.assertEqual(actual, [normalized(v) for v in fixture["items"]])
                self.assertEqual(socket.sent, [v["send"] for v in fixture["steps"]])
                self.assertEqual((socket.closes, source.closes), (1, 1))

    async def test_http_failure_and_cleanup_never_read_error_bodies(self) -> None:
        for status, content_type, expected in [(429,"audio/mpeg","Deepgram returned HTTP 429"), (302,"audio/mpeg","Deepgram returned HTTP 302"), (200,"application/json","Deepgram returned an unexpected audio content type")]:
            transport = Transport(Body([], stall=True), status, content_type)
            with self.assertRaises(TypeError) as caught:
                async with synthesize(request(), auth=AUTH, transport=transport):
                    self.fail("accepted invalid response")
            self.assertEqual(str(caught.exception), expected)
            self.assertEqual((transport.body.reads, transport.body.closes), (0,1))
        transport = Transport(Body([b"",b""]))
        with self.assertRaises(TypeError) as caught:
            async with synthesize(request(), auth=AUTH, transport=transport) as audio:
                await anext(audio)
        self.assertEqual(str(caught.exception), "Deepgram returned no audio bytes")
        self.assertEqual(transport.body.closes,1)
        for content_type in ["", "application/octet-stream", "Audio/Wav; rate=8000"]:
            transport = Transport(Body([b"a",b"b"]), content_type=content_type)
            async with synthesize(request(), auth=AUTH, transport=transport) as audio:
                self.assertEqual(await anext(audio), b"a")
            self.assertEqual((transport.body.reads,transport.body.closes),(1,1))
        transport = Transport(Body([]))
        async with synthesize(request(), auth=AUTH, transport=transport):
            pass
        self.assertEqual((transport.body.reads,transport.body.closes),(0,1))

    async def test_original_http_errors_survive_cleanup(self) -> None:
        original = RuntimeError("original")
        transport = Transport(Body([original]))
        transport.body.close_error = RuntimeError("cleanup")
        with self.assertRaises(RuntimeError) as caught:
            async with synthesize(request(), auth=AUTH, transport=transport) as audio:
                await anext(audio)
        self.assertIs(caught.exception,original)
        transport = Transport(Body([]))
        transport.error = original
        with self.assertRaises(RuntimeError) as caught:
            async with synthesize(request(), auth=AUTH, transport=transport):
                pass
        self.assertIs(caught.exception,original)

    async def test_deadline_covers_headers_reads_and_idle_context(self) -> None:
        for phase in ["headers","reads","idle"]:
            transport = Transport(Body([],stall=phase == "reads"))
            transport.stall = phase == "headers"
            with self.assertRaises(TimeoutError) as caught:
                async with synthesize(request(), auth=AUTH, transport=transport, timeout_ms=10) as audio:
                    if phase == "idle":
                        await asyncio.Future[None]()
                    else:
                        await anext(audio)
            self.assertEqual(str(caught.exception), "Deepgram synthesis deadline expired")
            self.assertEqual((transport.cancelled,transport.body.cancelled,transport.body.closes), (1,0,0) if phase == "headers" else (0,1,1) if phase == "reads" else (0,0,1))

    async def test_generated_request_and_item_validation_precedes_wire_io(self) -> None:
        for change in [{"voice":"thalia"}, {"language":"es"}, {"speed":0.6}, {"speed":float("nan")}, {"output":{"format":"mp3","sample_rate_hz":24000}}]:
            transport = Transport(Body([]))
            invalid = cast(TtsRequest,{**request(),**change})
            with self.assertRaises(TypeError) as expected:
                validate_request(invalid)
            with self.assertRaises(TypeError) as caught:
                async with synthesize(invalid, auth=AUTH, transport=transport):
                    self.fail("invalid request accepted")
            self.assertEqual(caught.exception.args,expected.exception.args)
            self.assertEqual(transport.requests,[])
        source = Source([])
        socket = Socket()
        invalid = cast(TtsRequest,{**request(source),"output":{"format":"mp3"}})
        with self.assertRaises(TypeError) as expected:
            validate_request(invalid)
        with self.assertRaises(TypeError) as caught:
            async with synthesize(invalid, auth=AUTH, web_socket=socket):
                self.fail("streaming MP3 accepted")
        self.assertEqual(caught.exception.args,expected.exception.args)
        self.assertEqual((source.pulls,socket.sent),(0,[]))
        source = Source([cast(Input,{"command":"unknown"})])
        validate_input = validate_request(request(source))
        with self.assertRaises(TypeError) as expected:
            validate_input({"command":"unknown"})
        with self.assertRaises(TypeError) as caught:
            async with synthesize(request(source), auth=AUTH, web_socket=socket) as audio:
                await anext(audio)
        self.assertEqual(caught.exception.args,expected.exception.args)
        self.assertEqual((source.closes,socket.closes,socket.sent),(1,1,[]))

    async def test_malformed_and_unexpected_server_messages_are_terminal(self) -> None:
        for frame, expected in [
            ('null',"Deepgram returned an invalid WebSocket event"),
            ('{',"Deepgram returned invalid JSON"),
            ('{"type":"Metadata","request_id":false}',"Deepgram returned an invalid WebSocket event"),
            ('{"type":"Flushed","sequence_id":true}',"Deepgram returned an invalid WebSocket event"),
            ('{"type":"Cleared","sequence_id":-1}',"Deepgram returned an invalid WebSocket event"),
            ('{"type":"Flushed","sequence_id":0.5}',"Deepgram returned an invalid WebSocket event"),
            ('{"type":"Flushed","sequence_id":9007199254740992}',"Deepgram returned an invalid WebSocket event"),
            ('{"type":"Flushed","sequence_id":NaN}',"Deepgram returned invalid JSON"),
            ('{"type":"Warning","code":"limit","description":"wait"}',"Deepgram Warning limit: wait"),
            ('{"type":"Error","code":0,"description":"wait"}',"Deepgram returned an invalid error event"),
            ('{"type":"Flushed","sequence_id":0}',"Unexpected Deepgram Flushed acknowledgement"),
            ('{"type":"Cleared","sequence_id":0}',"Unexpected Deepgram Cleared acknowledgement"),
        ]:
            with self.subTest(frame=frame):
                source = Source([],stall=True)
                socket = Socket()
                socket.incoming.put_nowait(frame)
                with self.assertRaises(TypeError) as caught:
                    async with synthesize(request(source),auth=AUTH,web_socket=socket) as audio:
                        await anext(audio)
                self.assertEqual(str(caught.exception),expected)
                self.assertEqual((source.closes,socket.closes),(1,1))

    async def test_read_output_while_send_and_input_are_pending(self) -> None:
        source = Source(["Hello"],stall=True)
        socket = Socket()
        waiting = asyncio.Event()
        async def send(_: dict[str,object]) -> None:
            socket.incoming.put_nowait(b"audio")
            waiting.set()
            await asyncio.Future[None]()
        socket.on_send = send
        async with asyncio.timeout(1):
            async with synthesize(request(source),auth=AUTH,web_socket=socket) as audio:
                self.assertEqual(await anext(audio),b"audio")
                self.assertTrue(waiting.is_set())
                self.assertEqual(source.pulls,1)
        self.assertEqual((source.closes,socket.closes),(1,1))
        source = Source([],stall=True)
        socket = Socket()
        socket.incoming.put_nowait(b"audio")
        async with synthesize(request(source),auth=AUTH,web_socket=socket) as audio:
            self.assertEqual(await anext(audio),b"audio")
        self.assertEqual((source.closes,socket.closes),(1,1))

    async def test_socket_cancellation_releases_network_before_source(self) -> None:
        trace: list[str] = []
        socket = Socket(trace)
        source = Source([],stall=True,trace=trace)
        async def run() -> None:
            async with synthesize(request(source),auth=AUTH,web_socket=socket) as audio:
                await anext(audio)
        task = asyncio.create_task(run())
        await source.waiting.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertEqual(trace,["socket","input"])
        self.assertEqual(source.cancelled,1)
        socket = Socket()
        source = Source([])
        async with synthesize(request(source),auth=AUTH,web_socket=socket):
            pass
        self.assertEqual((socket.closes,source.pulls,source.closes),(1,0,0))

    async def test_native_header_auth_and_masked_frames(self) -> None:
        completed = asyncio.Event()
        async def handle(reader: asyncio.StreamReader,writer: asyncio.StreamWriter) -> None:
            path,headers = await upgrade(reader,writer)
            target = urlsplit(path.decode().split(" ")[1])
            self.assertEqual(target.path,"/v1/speak")
            self.assertEqual(headers[b"authorization"],b"Token test-key")
            self.assertEqual(parse_qs(target.query),{"keep":["value"],"model":["aura-asteria-en"],"encoding":["linear16"],"sample_rate":["24000"]})
            opcode,payload = await client_frame(reader)
            self.assertEqual((opcode,json.loads(payload)),(1,{"type":"Speak","text":"Hello"}))
            writer.write(b"\x82\x02\x00\xff")
            await writer.drain()
            opcode,payload = await client_frame(reader)
            self.assertEqual((opcode,json.loads(payload)),(1,{"type":"Flush"}))
            final = b'{"type":"Flushed","sequence_id":0}'
            writer.write(bytes([0x81,len(final)])+final)
            await writer.drain()
            opcode,payload = await client_frame(reader)
            self.assertEqual((opcode,json.loads(payload)),(1,{"type":"Close"}))
            await reader.read()
            completed.set()
        async with server(handle) as url:
            async with synthesize(request(Source(["Hello"])),auth=AUTH,web_socket_url=url+"/v1/speak?keep=value&api_key=stale&container=bad") as audio:
                self.assertEqual([v async for v in audio],[b"\0\xff",{"event":"done","sequence_id":0}])
            await completed.wait()

    async def test_auth_precedence_and_explicit_empty(self) -> None:
        cases: list[tuple[dict[str,str], Auth | None, str | None]] = [
            ({"DEEPGRAM_API_KEY":"native"},None,"native"),
            ({"DEEPGRAM_API_KEY":"native","SPEECHSWITCH_DEEPGRAM_API_KEY":"scoped"},None,"scoped"),
            ({"DEEPGRAM_API_KEY":"native"},AUTH,"test-key"),
            ({"DEEPGRAM_API_KEY":"native","SPEECHSWITCH_DEEPGRAM_API_KEY":""},None,None),
            ({"DEEPGRAM_API_KEY":"native"},{"deepgram":{"api_key":""}},None),
            ({},None,None),
        ]
        for environment,auth,key in cases:
            transport = Transport(Body([]))
            with patch.dict(os.environ,environment,clear=True):
                if key is None:
                    with self.assertRaises(TypeError) as caught:
                        async with synthesize(request(),auth=auth,transport=transport):
                            self.fail("missing auth accepted")
                    self.assertEqual(str(caught.exception),"Missing auth.deepgram.apiKey configuration")
                    self.assertEqual(transport.requests,[])
                else:
                    async with synthesize(request(),auth=auth,transport=transport):
                        pass
                    self.assertEqual(transport.requests[0].headers["authorization"],f"Token {key}")

    async def test_socket_failures_preserve_original_errors_and_close(self) -> None:
        original = RuntimeError("original")
        for phase in ["input","send","receive","close"]:
            source = Source([original] if phase == "input" else ["Hello"],stall=True)
            socket = Socket()
            if phase == "receive":
                socket.incoming.put_nowait(original)
            elif phase == "close":
                socket.incoming.put_nowait(StopAsyncIteration())
            elif phase == "send":
                async def send(_: dict[str,object]) -> None:
                    raise original
                socket.on_send = send
            socket.close_error = RuntimeError("cleanup")
            with self.assertRaises((TypeError,RuntimeError)) as caught:
                async with asyncio.timeout(1):
                    async with synthesize(request(source),auth=AUTH,web_socket=socket) as audio:
                        async for _ in audio:
                            pass
            if phase == "close":
                self.assertEqual(str(caught.exception),"Deepgram WebSocket closed before input or pending synthesis completed")
            else:
                self.assertIs(caught.exception,original)
            self.assertEqual((source.closes,socket.closes),(1,1))

    async def test_message_limits_apply_to_injected_socket_reads_and_writes(self) -> None:
        for frame in [b"12345","12345",None]:
            source = Source([] if frame is not None else ["long text"],stall=True)
            socket = Socket()
            if frame is not None:
                socket.incoming.put_nowait(frame)
            with self.assertRaises(TypeError) as caught:
                async with synthesize(request(source),auth=AUTH,web_socket=socket,max_message_bytes=4) as audio:
                    await anext(audio)
            self.assertEqual(str(caught.exception),"Deepgram message exceeds max_message_bytes")
            self.assertEqual((source.closes,socket.closes),(1,1))
            self.assertEqual(socket.sent,[])

    async def test_socket_deadline_owns_pending_input_and_idle_time(self) -> None:
        for phase in ["input","idle","send"]:
            source = Source(["Hello"] if phase != "input" else [],stall=True)
            socket = Socket()
            if phase == "send":
                async def send(_: dict[str,object]) -> None:
                    await asyncio.Future[None]()
                socket.on_send = send
            with self.assertRaises(TimeoutError) as caught:
                async with synthesize(request(source),auth=AUTH,web_socket=socket,timeout_ms=10) as audio:
                    await anext(audio)
                    await asyncio.Future[None]()
            self.assertEqual(str(caught.exception),"Deepgram synthesis deadline expired")
            self.assertEqual((source.closes,socket.closes),(1,1))
        peer_closed = asyncio.Event()
        async def handshake(reader: asyncio.StreamReader,writer: asyncio.StreamWriter) -> None:
            await reader.readuntil(b"\r\n\r\n")
            await reader.read()
            peer_closed.set()
        async with server(handshake) as url:
            source = Source(["Hello"])
            with self.assertRaises(TimeoutError) as caught:
                async with synthesize(request(source),auth=AUTH,web_socket_url=url,timeout_ms=10):
                    self.fail("accepted unfinished upgrade")
            self.assertEqual(str(caught.exception),"Deepgram synthesis deadline expired")
            await peer_closed.wait()
            self.assertEqual(source.pulls,0)

    async def test_invalid_options_fail_before_network_or_iteration(self) -> None:
        for limit in [0,-1,True,0.5]:
            socket = Socket()
            source = Source([])
            with self.assertRaises(TypeError) as caught:
                async with synthesize(request(source),auth=AUTH,web_socket=socket,max_message_bytes=cast(int,limit)):
                    self.fail("invalid limit accepted")
            self.assertEqual(str(caught.exception),"Deepgram max_message_bytes must be a positive integer")
            self.assertEqual((source.pulls,socket.sent),(0,[]))
        for timeout in [-1,True,0.5,2147483648]:
            with self.assertRaises(TypeError) as caught:
                async with synthesize(request(),auth=AUTH,timeout_ms=cast(int,timeout)):
                    self.fail("invalid timeout accepted")
            self.assertEqual(str(caught.exception),"Deepgram timeout_ms must be an integer between 0 and 2147483647")
        with self.assertRaises(TimeoutError) as caught:
            async with synthesize(request(),auth=AUTH,timeout_ms=0):
                self.fail("expired deadline accepted")
        self.assertEqual(str(caught.exception),"Deepgram synthesis deadline expired")
        for url in ["", "wss://host", "https://user:key@host", "https://host:bad", "https://host/#fragment", "https://host/ space"]:
            with self.assertRaises(TypeError) as caught:
                async with synthesize(request(),auth=AUTH,base_url=url):
                    self.fail("invalid endpoint accepted")
            self.assertEqual(str(caught.exception),"Invalid Deepgram endpoint URL")
        with self.assertRaises(TypeError) as caught:
            async with synthesize(request(),auth=AUTH):
                self.fail("missing HTTP transport accepted")
        self.assertEqual(str(caught.exception),"Deepgram HTTP transport is required")

    async def test_unicode_and_integral_floats_survive_wire_conversion(self) -> None:
        text = "雪\n\ud800"
        r = cast(TtsRequest,{**request(text),"output":{"format":"pcm","sample_rate_hz":24000.0},"speed":1.0})
        transport = Transport(Body([]))
        async with synthesize(r,auth=AUTH,transport=transport):
            pass
        self.assertEqual(json.loads(transport.requests[0].body),{"text":text})
        self.assertEqual(parse_qs(urlsplit(transport.requests[0].url).query),{"model":["aura-asteria-en"],"encoding":["linear16"],"container":["none"],"sample_rate":["24000"],"speed":["1"]})
        socket = Socket()
        async with synthesize(request(Source([text])),auth=AUTH,web_socket=socket) as audio:
            self.assertEqual([v async for v in audio],[b"\0\xff",{"event":"done","sequence_id":1}])
        self.assertEqual(socket.sent[0],{"type":"Speak","text":text})
