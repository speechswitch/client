import asyncio
import json
import re
import unittest
from collections.abc import AsyncIterable, AsyncIterator, Awaitable, Callable, Sequence
from pathlib import Path
from typing import cast
from unittest.mock import patch

from speechswitch.generated.auth import Auth
from speechswitch.generated.gradium import TtsRequest, TtsRequestTextAsyncIterableItem as Input
from speechswitch.generated.validators.gradium import validate_request
from speechswitch.http import HttpRequest, HttpResponse
from speechswitch.providers.gradium import GradiumError, synthesize
from speechswitch.validation import is_mapping, is_sequence
from test_websocket import server, upgrade, client_frame

AUTH: Auth = {"gradium": {"api_key": "test-key"}}


def request(text: str | AsyncIterable[Input] = "Hello") -> TtsRequest:
    return {"voice": "existing-custom", "text": text, "output": {"format": "pcm"}}


def hydrate(value: object, snake: bool = False) -> object:
    if is_mapping(value):
        if "$bytes" in value:
            return bytes(cast(Sequence[int], value["$bytes"]))
        return {(re.sub(r"[A-Z]", lambda m: "_" + m[0].lower(), str(key)) if snake else str(key)): hydrate(item, snake) for key, item in value.items()}
    if is_sequence(value):
        return [hydrate(item, snake) for item in value]
    return value


class Source[T]:
    def __init__(self, values: Sequence[T | Exception], stall: bool = False) -> None:
        self.values = list(values)
        self.stall = stall
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
    def __init__(self, body: Source[bytes], status: int = 200) -> None:
        self.body, self.status = body, status
        self.requests: list[HttpRequest] = []
    async def send(self, request: HttpRequest) -> HttpResponse:
        self.requests.append(request)
        return HttpResponse(self.status, {}, self.body)


class Socket:
    def __init__(self) -> None:
        self.incoming: asyncio.Queue[str | bytes | Exception] = asyncio.Queue()
        self.sent: list[dict[object, object]] = []
        self.closed = False
        self.on_send: Callable[[dict[object, object]], Awaitable[None]] | None = None
    async def send(self, message: str | bytes) -> None:
        assert isinstance(message, str)
        packet: object = json.loads(message)
        assert is_mapping(packet)
        value = dict(packet)
        self.sent.append(value)
        if self.on_send is not None:
            await self.on_send(value)
        elif value["type"] == "setup":
            self.put({"type": "ready", "request_id": "req"})
        elif value["type"] == "text":
            self.put({"type": "audio", "audio": "AP8="})
        elif value["type"] == "end_of_stream":
            self.put({"type": "end_of_stream"})
    def put(self, value: object) -> None:
        self.incoming.put_nowait(json.dumps(value))
    async def receive(self) -> str | bytes:
        value = await self.incoming.get()
        if isinstance(value, Exception):
            raise value
        return value
    async def aclose(self) -> None:
        self.closed = True


class GradiumTests(unittest.IsolatedAsyncioTestCase):
    async def test_shared_settings_fixtures_on_both_transports(self) -> None:
        fixtures = json.loads((Path(__file__).parents[2] / "fixtures/gradium.json").read_text())
        for case in fixtures["http"]:
            r = cast(TtsRequest, hydrate(case["request"], True))
            body = Source([b"\0\xff"])
            transport = Transport(body)
            async with synthesize(r, auth=AUTH, transport=transport, base_url="https://proxy.test/a%2Fb/api/?tenant=one") as stream:
                self.assertEqual(body.pulls, 0)
                self.assertEqual([item async for item in stream], [b"\0\xff"])
            self.assertEqual(body.closes, 1)
            wire = transport.requests[0]
            self.assertEqual((wire.method, wire.url, wire.headers), ("POST", "https://proxy.test/a%2Fb/api/post/speech/tts?tenant=one", {"x-api-key": "test-key", "content-type": "application/json"}))
            self.assertEqual(json.loads(wire.body), {**case["settings"], "json_config": json.dumps(case["settings"]["json_config"], separators=(",", ":")), "text": "Hello", "only_audio": True})
            socket = Socket()
            async with synthesize(r, web_socket=socket) as stream:
                self.assertEqual([item async for item in stream], [b"\0\xff"])
            self.assertEqual(socket.sent, [{"type": "setup", **case["settings"], "close_ws_on_eos": True, "retry_for_s": 0}, {"type": "text", "text": "Hello"}, {"type": "end_of_stream"}])
            self.assertTrue(socket.closed)

    async def test_all_formats_and_normalization_defaults(self) -> None:
        outputs: list[tuple[object, str]] = [({"format": "wav", "sample_rate_hz": 48000}, "wav"), ({"format": "ogg_opus"}, "opus"), ({"format": "mulaw", "sample_rate_hz": 8000}, "ulaw_8000"), ({"format": "alaw"}, "alaw_8000")]
        outputs.extend(({"format": "pcm", "sample_rate_hz": rate}, f"pcm_{rate}") for rate in [8000,16000,22050,24000,44100,48000])
        outputs.append(({"format": "pcm", "sample_rate_hz": 8000.0}, "pcm_8000"))
        for output, native in outputs:
            r = cast(TtsRequest, {**request(), "output": output, "text_normalization": "auto"})
            socket = Socket()
            async with synthesize(r, web_socket=socket) as stream:
                _ = [item async for item in stream]
            self.assertEqual(socket.sent[0]["output_format"], native)
            self.assertEqual(socket.sent[0]["json_config"], {"temp": 0.7, "cfg_coef": 2, "padding_bonus": 0})

    async def test_shared_token_buffering_flush_and_empty_input(self) -> None:
        fixtures = json.loads((Path(__file__).parents[2] / "fixtures/gradium.json").read_text())
        source: Source[Input] = Source(fixtures["text"]["input"])
        socket = Socket()
        async with synthesize(request(source), web_socket=socket) as stream:
            self.assertEqual([item async for item in stream], [b"\0\xff"] * 5)
        self.assertEqual(socket.sent[1:], fixtures["text"]["messages"])
        await asyncio.wait_for(source.closed.wait(), 1)
        self.assertEqual(source.closes, 1)
        empty: Source[Input] = Source([])
        socket = Socket()
        async with synthesize(request(empty), web_socket=socket) as stream:
            self.assertEqual([item async for item in stream], [])
        self.assertEqual([item["type"] for item in socket.sent], ["setup", "end_of_stream"])

    async def test_every_utf8_split_and_http_eof_or_optional_terminal(self) -> None:
        fixtures = json.loads((Path(__file__).parents[2] / "fixtures/gradium.json").read_text())
        expected = [hydrate(case["item"], True) for case in fixtures["timeline"]]
        for eos in [False, True]:
            packets = [case["packet"] for case in fixtures["timeline"]] + ([{"type":"end_of_stream"}] if eos else [])
            data = b"\xef\xbb\xbf" + "\r\n".join(json.dumps(packet, ensure_ascii=False) for packet in packets).encode()
            for split in range(len(data) + 1):
                body = Source([data[:split], b"", data[split:]])
                transport = Transport(body)
                async with synthesize({**request(), "timestamp_granularity": "segment"}, auth=AUTH, transport=transport) as stream:
                    self.assertEqual([item async for item in stream], expected)
                self.assertEqual(body.closes, 1)
                self.assertEqual(json.loads(transport.requests[0].body)["only_audio"], False)

    async def test_independent_socket_timelines_and_reserved_flush_ack(self) -> None:
        fixtures = json.loads((Path(__file__).parents[2] / "fixtures/gradium.json").read_text())
        socket = Socket()
        async def sent(value: dict[object, object]) -> None:
            if value["type"] == "setup":
                socket.put({"type": "ready", "request_id": "req"})
                socket.put({"type": "flushed"})
                for case in fixtures["timeline"]:
                    socket.put(case["packet"])
            elif value["type"] == "end_of_stream":
                socket.put({"type": "end_of_stream"})
        socket.on_send = sent
        async with synthesize({**request(), "timestamp_granularity": "segment"}, web_socket=socket) as stream:
            self.assertEqual([item async for item in stream], [hydrate(case["item"], True) for case in fixtures["timeline"]])

    async def test_generated_request_and_input_checks(self) -> None:
        changes: list[dict[str, object]] = [{"model":"tts"}, {"speed":1}, {"voice":""}, {"temperature":1.51}, {"temperature":True}, {"pacing_bias":-5.1}, {"voice_guidance":0.99}, {"output":{"format":"mp3"}}, {"output":{"format":"wav","sample_rate_hz":24000}}, {"output":{"format":"ogg_opus","sample_rate_hz":48000}}, {"text_normalization":{"rules":[]}}, {"text_normalization":{"locale":"en","rules":["NumberEn"]}}]
        for change in changes:
            transport = Transport(Source([]))
            invalid = cast(TtsRequest, {**request(), **change})
            with self.assertRaises(TypeError) as expected:
                validate_request(invalid)
            with self.assertRaises(TypeError) as raised:
                async with synthesize(invalid, auth=AUTH, transport=transport):
                    self.fail("invalid request entered")
            self.assertEqual(raised.exception.args, expected.exception.args)
            self.assertEqual(transport.requests, [])
        for item, diagnostic in [(None, "text item: expected object"), ({"command":"clear"}, 'text item["command"]: expected "flush"'), ({"command":1}, 'text item["command"]: expected "flush"')]:
            source: Source[Input] = Source([cast(Input,item)])
            socket = Socket()
            with self.assertRaises(TypeError) as raised:
                async with synthesize(request(source), web_socket=socket) as stream:
                    await anext(stream)
            self.assertEqual(str(raised.exception), f"Invalid gradium TTS input item:\ntext item: expected string\n{diagnostic}")
            self.assertEqual([v["type"] for v in socket.sent], ["setup"])
            self.assertTrue(socket.closed)

    async def test_lexicon_and_retry_select_socket_with_complete_text(self) -> None:
        socket = Socket()
        async with synthesize({**request(), "lexicon":"dictionary"}, web_socket=socket, setup_retry_ms=250) as stream:
            _ = [item async for item in stream]
        self.assertEqual(socket.sent[0], {"type":"setup","model_name":"default","voice_id":"existing-custom","output_format":"pcm_48000","json_config":{"temp":0.7,"cfg_coef":2,"padding_bonus":0},"close_ws_on_eos":True,"retry_for_s":0.25,"pronunciation_id":"dictionary"})

    async def test_http_errors_preserve_native_codes_and_release(self) -> None:
        for data, message, code in [(b"error from server 1008: denied", "denied", 1008), (b"\xef\xbb\xbfproxy \xff", "proxy �", None), (b"error from server 1011: line\nnext", "line\nnext", 1011)]:
            body = Source([data[:3], data[3:]])
            with self.assertRaises(GradiumError) as raised:
                async with synthesize(request(), auth=AUTH, transport=Transport(body,500)):
                    self.fail("HTTP error entered")
            self.assertEqual((str(raised.exception),raised.exception.status_code,raised.exception.code),(message,500,code))
            self.assertEqual(body.closes,1)
        original = RuntimeError("read failed")
        body: Source[bytes] = Source([original])
        with self.assertRaises(RuntimeError) as raised:
            async with synthesize(request(),auth=AUTH,transport=Transport(body,403)):
                self.fail("error entered")
        self.assertIs(raised.exception,original)
        self.assertEqual(body.closes,1)

    async def test_exact_packet_errors_and_terminal_cleanup(self) -> None:
        cases: list[tuple[object,str]] = [
            ({"type":"audio","audio":"!"},"Gradium returned invalid base64 audio"),
            ({"type":"audio","audio":"AA==","stream_id":True},"Gradium returned an invalid stream ID"),
            ({"type":"audio","audio":"AA==","stream_id":-1},"Gradium returned an invalid stream ID"),
            ({"type":"audio","audio":"AA==","start_s":0},"Gradium returned an invalid time range"),
            ({"type":"audio","audio":"AA==","start_s":1,"stop_s":0},"Gradium returned an invalid time range"),
            ({"type":"text","text":"hi","start_s":0,"stop_s":1e308},"Gradium returned an invalid time range"),
            ({"type":"text","text":"hi"},"Gradium returned an invalid time range"),
            ({"type":"ready","request_id":"r","client_req_id":None},"Gradium returned an unexpected multiplexed request ID"),
            ({"type":"error","message":"bad","code":True},"Gradium returned an invalid event"),
            ({"type":"unknown"},"Gradium returned an invalid event"),
        ]
        for packet, expected in cases:
            body = Source([json.dumps(packet).encode()])
            with self.assertRaises(TypeError) as raised:
                async with synthesize({**request(),"timestamp_granularity":"segment"},auth=AUTH,transport=Transport(body)) as stream:
                    await anext(stream)
            self.assertEqual(str(raised.exception),expected)
            self.assertEqual(body.closes,1)

    async def test_socket_protocol_order_and_original_errors(self) -> None:
        for events, expected in [
            ([{"type":"audio","audio":"AA=="}],"Gradium returned output before ready"),
            ([{"type":"ready","request_id":"a"},{"type":"ready","request_id":"b"}],"Gradium returned duplicate ready"),
            ([{"type":"ready","request_id":"a"},{"type":"end_of_stream"}],"Gradium completed before the input stream ended"),
        ]:
            source: Source[Input] = Source([],True)
            socket = Socket()
            async def sent(_: dict[object,object]) -> None:
                for packet in events:
                    socket.put(packet)
            socket.on_send = sent
            with self.assertRaises(TypeError) as raised:
                async with synthesize(request(source),web_socket=socket) as stream:
                    await anext(stream)
            self.assertEqual(str(raised.exception),expected)
            self.assertTrue(socket.closed)
        for stage in ["input","receive","send"]:
            original=RuntimeError("original")
            source: Source[Input] = Source([original] if stage=="input" else [],True)
            socket=Socket()
            if stage=="receive":
                socket.incoming.put_nowait(original)
            if stage=="send":
                async def fail(_: dict[object,object]) -> None:
                    raise original
                socket.on_send=fail
            with self.assertRaises(RuntimeError) as raised:
                async with synthesize(request(source),web_socket=socket) as stream:
                    await anext(stream)
            self.assertIs(raised.exception,original)
            self.assertTrue(socket.closed)

    async def test_stalled_input_and_stalled_write_do_not_block_audio(self) -> None:
        for blocked_write in [False,True]:
            source: Source[Input] = Source(["Hello "],True)
            socket=Socket()
            async def send(value: dict[object,object]) -> None:
                if value["type"]=="setup":
                    socket.put({"type":"ready","request_id":"req"})
                if value["type"]=="text":
                    socket.put({"type":"audio","audio":"AP8="})
                    if blocked_write:
                        await asyncio.Future[None]()
            socket.on_send=send
            async with synthesize(request(source),web_socket=socket,timeout_ms=1000) as stream:
                self.assertEqual(await anext(stream),b"\0\xff")
            self.assertTrue(socket.closed)
            await asyncio.wait_for(source.closed.wait(),1)

    async def test_native_header_and_single_use_token_auth_early_audio(self) -> None:
        for token in [False,True]:
            disconnected=asyncio.Event()
            async def handler(reader:asyncio.StreamReader,writer:asyncio.StreamWriter) -> None:
                path,headers=await upgrade(reader,writer)
                suffix=b"&token=a+%2B%2F%3F%26" if token else b""
                self.assertEqual(path,b"GET /a%2Fb/api/speech/tts?tenant=one"+suffix+b" HTTP/1.1")
                self.assertEqual(headers.get(b"x-api-key"),None if token else b"test-key")
                opcode,setup=await client_frame(reader)
                self.assertEqual(opcode,1)
                self.assertEqual(json.loads(setup)["voice_id"],"existing-custom")
                self.assertEqual(await client_frame(reader),(1,b'{"type":"text","text":"Hello"}'))
                for packet in [{"type":"ready","request_id":"req"},{"type":"audio","audio":"AP8="}]:
                    data=json.dumps(packet).encode()
                    writer.write(bytes([0x81,len(data)])+data)
                await writer.drain()
                self.assertEqual((await client_frame(reader))[0],8)
                disconnected.set()
            async with server(handler) as url:
                source: Source[Input] = Source(["Hello "],True)
                auth:Auth={"gradium":{"single_use_token":"a +/?&"}} if token else AUTH
                async with synthesize(request(source),auth=auth,base_url=url+"/a%2Fb/api/?tenant=one",timeout_ms=1000) as stream:
                    self.assertEqual(await anext(stream),b"\0\xff")
                await disconnected.wait()

    async def test_pending_setup_releases_without_acquiring_input(self) -> None:
        source: Source[Input] = Source(["Hello "], True)
        socket = Socket()
        cancelled = asyncio.Event()
        async def send(_: dict[object, object]) -> None:
            socket.put({"type": "error", "message": "unavailable", "code": 1013})
            try:
                await asyncio.Future[None]()
            finally:
                cancelled.set()
        socket.on_send = send
        with self.assertRaises(GradiumError) as raised:
            async with synthesize(request(source), web_socket=socket, timeout_ms=1000) as stream:
                await anext(stream)
        self.assertEqual((str(raised.exception), raised.exception.code), ("unavailable", 1013))
        self.assertEqual((source.pulls, source.closes, socket.closed), (0, 0, True))
        await asyncio.wait_for(cancelled.wait(), 1)

    async def test_slow_input_cleanup_does_not_hold_connection(self) -> None:
        started, release, finished = asyncio.Event(), asyncio.Event(), asyncio.Event()
        class SlowSource(Source[Input]):
            async def aclose(self) -> None:
                started.set()
                await release.wait()
                await super().aclose()
                finished.set()
        source = SlowSource(["Hello "], True)
        socket = Socket()
        try:
            async with asyncio.timeout(1):
                async with synthesize(request(source), web_socket=socket) as stream:
                    self.assertEqual(await anext(stream), b"\0\xff")
                self.assertTrue(socket.closed)
                await started.wait()
                self.assertFalse(finished.is_set())
        finally:
            release.set()
            await asyncio.wait_for(finished.wait(), 1)
        self.assertEqual(source.closes, 1)

    async def test_ready_input_cannot_starve_terminal_error(self) -> None:
        source: Source[Input] = Source(["Hello "] * 1000)
        socket = Socket()
        async def send(value: dict[object, object]) -> None:
            if value["type"] == "setup":
                socket.put({"type": "ready", "request_id": "req"})
            elif value["type"] == "text":
                socket.put({"type": "error", "message": "stop", "code": 1008})
        socket.on_send = send
        with self.assertRaises(GradiumError) as raised:
            async with synthesize(request(source), web_socket=socket, timeout_ms=1000) as stream:
                await anext(stream)
        self.assertEqual((str(raised.exception), raised.exception.code), ("stop", 1008))
        self.assertLess(source.pulls, 20)
        self.assertTrue(socket.closed)
        await asyncio.wait_for(source.closed.wait(), 1)

    async def test_socket_message_and_input_buffer_bounds(self) -> None:
        for tokens, limit, expected in [(["Hello "], 1, "Gradium message exceeds max_message_bytes"), (["x" * 1025], 1024, "Gradium text buffer exceeds max_message_bytes"), (["\u0000" * 200 + " "], 1024, "Gradium message exceeds max_message_bytes")]:
            source: Source[Input] = Source(tokens)
            socket = Socket()
            with self.assertRaises(TypeError) as raised:
                async with synthesize(request(source), web_socket=socket, max_message_bytes=limit) as stream:
                    await anext(stream)
            self.assertEqual(str(raised.exception), expected)
            self.assertTrue(socket.closed)
        socket = Socket()
        async def send(_: dict[object, object]) -> None:
            socket.incoming.put_nowait("\u00e9" * 513)
        socket.on_send = send
        with self.assertRaises(TypeError) as raised:
            async with synthesize(request(), web_socket=socket, max_message_bytes=1024) as stream:
                await anext(stream)
        self.assertEqual(str(raised.exception), "Gradium message exceeds max_message_bytes")
        self.assertTrue(socket.closed)

    async def test_unread_http_socket_and_pending_read_close(self) -> None:
        for read in [False,True]:
            body=Source([b"one"],True)
            async with synthesize(request(),auth=AUTH,transport=Transport(body)) as stream:
                if read:
                    self.assertEqual(await anext(stream),b"one")
            self.assertEqual(body.closes,1)
        source:Source[Input]=Source([],True)
        socket=Socket()
        async with synthesize(request(source),web_socket=socket):
            pass
        self.assertEqual(source.pulls,0)
        self.assertEqual(socket.sent,[])
        self.assertTrue(socket.closed)

    async def test_timeout_covers_error_body_and_idle_context(self) -> None:
        for status in [200,500]:
            body:Source[bytes]=Source([],True)
            with self.assertRaises(TimeoutError) as raised:
                async with synthesize(request(),auth=AUTH,transport=Transport(body,status),timeout_ms=10) as stream:
                    await anext(stream)
            self.assertEqual(str(raised.exception),"Gradium synthesis deadline expired")
            self.assertEqual(body.closes,1)
        socket=Socket()
        with self.assertRaises(TimeoutError) as raised:
            async with synthesize(request(),web_socket=socket,timeout_ms=10):
                await asyncio.Future[None]()
        self.assertEqual(str(raised.exception),"Gradium synthesis deadline expired")
        self.assertTrue(socket.closed)

    async def test_credentials_precedence_and_options_validation(self) -> None:
        with patch.dict("os.environ",{"GRADIUM_API_KEY":"fallback","SPEECHSWITCH_GRADIUM_API_KEY":"scoped"},clear=True):
            for auth,expected in [(AUTH,"test-key"),(None,"scoped")]:
                transport=Transport(Source([]))
                async with synthesize(request(),auth=auth,transport=transport):
                    pass
                self.assertEqual(transport.requests[0].headers["x-api-key"],expected)
            with self.assertRaises(TypeError) as raised:
                async with synthesize(request(),auth={"gradium":{"api_key":""}}):
                    self.fail("empty credential entered")
            self.assertEqual(str(raised.exception),"Missing auth.gradium.apiKey configuration")
        with patch.dict("os.environ",{"GRADIUM_API_KEY":"fallback"},clear=True):
            transport=Transport(Source([]))
            async with synthesize(request(),transport=transport):
                pass
            self.assertEqual(transport.requests[0].headers["x-api-key"],"fallback")
        for url in ["https://user:secret@host", "https://host/#fragment", "https://host:99999", "https://host/%xx"]:
            with self.assertRaises(TypeError) as raised:
                async with synthesize(request(),auth=AUTH,base_url=url):
                    self.fail("invalid URL entered")
            self.assertEqual(str(raised.exception),"Invalid Gradium endpoint URL")

    async def test_json_bounds_and_malformed_utf8(self) -> None:
        for data,limit,expected in [(b"xxx",2,"Gradium JSON line exceeds max_json_bytes"),(b"\xff",100,"Gradium returned invalid UTF-8"),(b'{"x":NaN}',100,"Gradium returned invalid JSON"),(b'{} trailing',100,"Gradium returned invalid JSON")]:
            body=Source([data])
            with self.assertRaises(TypeError) as raised:
                async with synthesize({**request(),"timestamp_granularity":"segment"},auth=AUTH,transport=Transport(body),max_json_bytes=limit) as stream:
                    await anext(stream)
            self.assertEqual(str(raised.exception),expected)
            self.assertEqual(body.closes,1)
        body=Source([b"123"])
        with self.assertRaises(TypeError) as raised:
            async with synthesize(request(),auth=AUTH,transport=Transport(body,500),max_json_bytes=2):
                self.fail("oversized error entered")
        self.assertEqual(str(raised.exception),"Gradium response exceeds max_json_bytes")
