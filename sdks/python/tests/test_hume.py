import asyncio
import json
import re
import unittest
from collections.abc import AsyncIterable, AsyncIterator, Awaitable, Callable, Sequence
from pathlib import Path
from typing import cast
from unittest.mock import patch
from urllib.parse import parse_qsl, urlsplit

from speechswitch.generated.auth import Auth
from speechswitch.generated.hume import TtsRequest, TtsRequestOctave2TextVoice, TtsRequestOctave2StreamingTextVoice
from speechswitch.http import HttpRequest, HttpResponse
from speechswitch.providers.hume import HumeError, Input, TextInput, TurnInput, synthesize
from speechswitch.validation import is_mapping, is_sequence
from speechswitch.websocket import WebSocketClosed, WebSocketError
from test_websocket import server, upgrade, client_frame

AUTH: Auth = {"hume": {"api_key": "test-key"}}


def request() -> TtsRequestOctave2TextVoice:
    return {"model": "octave-2", "text": "Hello", "voice": "saved", "output": {"format": "pcm"}}


def streaming(text: AsyncIterable[TextInput]) -> TtsRequestOctave2StreamingTextVoice:
    return {"model": "octave-2", "text": text, "voice": "saved", "output": {"format": "pcm"}}


def hydrate(value: object) -> object:
    if is_mapping(value):
        if "$bytes" in value:
            return bytes(cast(Sequence[int], value["$bytes"]))
        return {re.sub(r"[A-Z]", lambda m: "_" + m[0].lower(), str(key)): hydrate(item) for key, item in value.items()}
    if is_sequence(value):
        return [hydrate(item) for item in value]
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
        elif value.get("close"):
            self.incoming.put_nowait(StopAsyncIteration())
        elif "text" in value:
            self.incoming.put_nowait(b"\0\xff")
    async def receive(self) -> str | bytes:
        value = await self.incoming.get()
        if isinstance(value, Exception):
            raise value
        return value
    async def aclose(self) -> None:
        self.closed = True


class HumeTests(unittest.IsolatedAsyncioTestCase):
    async def test_shared_http_settings_and_all_formats(self) -> None:
        fixtures = json.loads((Path(__file__).parents[2] / "fixtures/hume.json").read_text())
        for case in fixtures["http"]:
            r = cast(TtsRequest, hydrate(case["request"]))
            body = Source([b"\0\xff"])
            transport = Transport(body)
            async with synthesize(r, auth=AUTH, transport=transport, base_url="https://proxy.test/a%2Fb/?tenant=one") as stream:
                self.assertEqual(body.pulls, 0)
                self.assertEqual([item async for item in stream], [b"\0\xff"])
            self.assertEqual(body.closes, 1)
            wire = transport.requests[0]
            self.assertEqual((wire.method, wire.url, wire.headers), ("POST", "https://proxy.test/a%2Fb/v0/tts/stream/file?tenant=one", {"X-Hume-Api-Key": "test-key", "content-type": "application/json"}))
            self.assertEqual(json.loads(wire.body), case["body"])

    async def test_shared_timeline_every_utf8_byte_split(self) -> None:
        fixtures = json.loads((Path(__file__).parents[2] / "fixtures/hume.json").read_text())["timeline"]
        data = ("\ufeff\r\n" + "\r\n".join(json.dumps(v["packet"], ensure_ascii=False) for v in fixtures)).encode()
        expected = [hydrate(v["item"]) for v in fixtures]
        for split in range(len(data) + 1):
            body = Source([data[:split], data[split:]])
            transport = Transport(body)
            async with synthesize({**request(), "timestamp_granularity": ["word", "phoneme"]}, auth=AUTH, transport=transport) as stream:
                self.assertEqual([item async for item in stream], expected, f"split {split}")
            self.assertEqual(body.closes, 1)
            self.assertEqual(urlsplit(transport.requests[0].url).path, "/v0/tts/stream/json")
            self.assertEqual(json.loads(transport.requests[0].body)["include_timestamp_types"], ["word", "phoneme"])

    async def test_all_seven_voice_model_shapes_over_streaming_input(self) -> None:
        fixtures = json.loads((Path(__file__).parents[2] / "fixtures/hume.json").read_text())["http"]
        self.assertEqual(len(fixtures),7)
        for case in fixtures:
            r = cast(dict[str,object],hydrate(case["request"]))
            r.pop("context_before",None)
            r.pop("split_turns",None)
            field = "text" if "text" in r else "turns"
            source = Source(cast(Sequence[Input],[r[field]] if field == "text" else r[field]))
            r[field] = source
            socket = Socket()
            async with synthesize(cast(TtsRequest,r),web_socket=socket) as stream:
                self.assertEqual([item async for item in stream],[b"\0\xff"]*len(case["body"]["utterances"]))
            self.assertEqual(socket.sent,[*case["body"]["utterances"],{"close":True}])
            await asyncio.wait_for(source.closed.wait(),1)

    async def test_early_bytes_metadata_and_http_cancellation(self) -> None:
        packet = {"type":"audio", "audio":"AP8=", "chunk_index":0, "is_last_chunk":True, "generation_id":"g", "request_id":"r", "snippet_id":"s"}
        for metadata in [False, True]:
            body = Source([json.dumps(packet).encode() + b"\n" if metadata else b"\0\xff"], True)
            transport = Transport(body)
            async with synthesize({**request(), "model": "octave-1"}, auth=AUTH, transport=transport, include_metadata=metadata) as stream:
                self.assertEqual(await anext(stream), {"correlation":"timeline", "correlation_id":"s", "generation_id":"g", "request_id":"r", "audio":b"\0\xff", "timestamps":[], "chunk_index":0, "is_last_chunk":True} if metadata else b"\0\xff")
                pending = asyncio.ensure_future(anext(stream))
                await body.waiting.wait()
                pending.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await pending
                self.assertEqual(body.closes, 1)
            self.assertEqual(body.closes, 1)
        body = Source([b"unread"])
        async with synthesize(request(), auth=AUTH, transport=Transport(body)):
            pass
        self.assertEqual((body.pulls, body.closes), (0, 1))

    async def test_socket_text_flush_and_dialogue_keep_delivery(self) -> None:
        source: Source[TextInput] = Source(["Hel", "lo", {"command":"flush"}])
        socket = Socket()
        async with synthesize(streaming(source), web_socket=socket) as stream:
            self.assertEqual([item async for item in stream], [b"\0\xff", b"\0\xff"])
        self.assertEqual(socket.sent, [{"text":"Hel", "voice":{"id":"saved", "provider":"CUSTOM_VOICE"}, "speed":1, "trailing_silence":0}, {"text":"lo", "voice":{"id":"saved", "provider":"CUSTOM_VOICE"}, "speed":1, "trailing_silence":0}, {"flush":True}, {"close":True}])
        await asyncio.wait_for(source.closed.wait(), 1)
        self.assertTrue(socket.closed)
        turns: Source[TurnInput] = Source([{"speaker":"a", "text":"Hi", "instructions":"", "trailing_silence_ms":0}, {"command":"flush"}])
        socket = Socket()
        async with synthesize({"model":"octave-1", "output":{"format":"mp3"}, "speakers":[{"alias":"a", "voice_name":"Ava", "voice_source":"catalog"}], "turns":turns, "speed":1.5, "trailing_silence_ms":1000}, web_socket=socket) as stream:
            self.assertEqual([item async for item in stream], [b"\0\xff"])
        self.assertEqual(socket.sent, [{"text":"Hi", "voice":{"name":"Ava", "provider":"HUME_AI"}, "description":"", "speed":1.5, "trailing_silence":0}, {"flush":True}, {"close":True}])

    async def test_socket_timeline_and_binary_metadata_are_not_duplicated(self) -> None:
        fixtures = json.loads((Path(__file__).parents[2] / "fixtures/hume.json").read_text())["timeline"]
        for metadata in [False, True]:
            socket = Socket()
            for case in fixtures:
                socket.incoming.put_nowait(json.dumps(case["packet"]))
            if not metadata:
                socket.incoming.put_nowait(b"\0\xff")
            empty: Source[TextInput] = Source([])
            async with synthesize(streaming(empty), web_socket=socket, include_metadata=metadata) as stream:
                self.assertEqual([item async for item in stream], [hydrate(v["item"]) for v in fixtures] if metadata else [b"\0\xff"])
            self.assertEqual(socket.sent, [{"close":True}])
            self.assertTrue(socket.closed)

    async def test_stalled_writes_input_and_close_drain(self) -> None:
        for blocked in ["input", "text", "close"]:
            source: Source[TextInput] = Source(["Hi"], blocked == "input")
            socket = Socket()
            async def send(packet: dict[object,object]) -> None:
                if "text" in packet:
                    socket.incoming.put_nowait(b"\0\xff")
                    if blocked == "text":
                        await asyncio.Future[None]()
                if "close" in packet:
                    socket.incoming.put_nowait(StopAsyncIteration())
                    if blocked == "close":
                        await asyncio.Future[None]()
            socket.on_send = send
            async with synthesize(streaming(source), web_socket=socket, timeout_ms=1000) as stream:
                self.assertEqual(await anext(stream), b"\0\xff")
                if blocked == "close":
                    self.assertEqual([item async for item in stream], [])
            await asyncio.wait_for(source.closed.wait(), 1)
            self.assertTrue(socket.closed)

    async def test_original_errors_and_premature_socket_close(self) -> None:
        for stage in ["input", "send", "receive"]:
            original = RuntimeError("original")
            source: Source[TextInput] = Source([original] if stage == "input" else ["Hi"], True)
            socket = Socket()
            if stage == "send":
                async def fail(_: dict[object,object]) -> None:
                    raise original
                socket.on_send = fail
            if stage == "receive":
                socket.incoming.put_nowait(original)
            with self.assertRaises(RuntimeError) as raised:
                async with synthesize(streaming(source), web_socket=socket) as stream:
                    await anext(stream)
            self.assertIs(raised.exception, original)
            self.assertTrue(socket.closed)
        socket = Socket()
        socket.incoming.put_nowait(StopAsyncIteration())
        source: Source[TextInput] = Source([], True)
        with self.assertRaises(TypeError) as raised:
            async with synthesize(streaming(source), web_socket=socket) as stream:
                await anext(stream)
        self.assertEqual(str(raised.exception), "Hume WebSocket closed before the input stream ended")
        self.assertTrue(socket.closed)

    async def test_native_errors_preserve_code_status_and_body_ownership(self) -> None:
        for data, expected, code in [(b'\xef\xbb\xbf{"code":"denied","message":"refus\xc3\xa9"}', "refusé", "denied"), (b'{"error":"no"}', "no", None), (b'proxy \xff', "proxy �", None)]:
            body = Source([bytes([v]) for v in data])
            with self.assertRaises(HumeError) as raised:
                async with synthesize(request(), auth=AUTH, transport=Transport(body, 403)):
                    self.fail("HTTP error entered")
            self.assertEqual((str(raised.exception), raised.exception.status_code, raised.exception.code), (expected, 403, code))
            self.assertEqual(body.closes, 1)
        original = RuntimeError("body")
        body: Source[bytes] = Source([original])
        with self.assertRaises(RuntimeError) as raised:
            async with synthesize(request(), auth=AUTH, transport=Transport(body, 403)):
                self.fail("HTTP error entered")
        self.assertIs(raised.exception, original)
        self.assertEqual(body.closes, 1)
        socket = Socket()
        socket.incoming.put_nowait('{"type":"error","message":"quota","code":"limit"}')
        source: Source[TextInput] = Source([], True)
        with self.assertRaises(HumeError) as raised:
            async with synthesize(streaming(source), web_socket=socket) as stream:
                await anext(stream)
        self.assertEqual((str(raised.exception), raised.exception.status_code, raised.exception.code), ("quota", None, "limit"))
        self.assertTrue(socket.closed)

    async def test_native_socket_query_auth_and_clean_close(self) -> None:
        for token in [False, True]:
            captured: list[tuple[bytes, dict[bytes,bytes]]] = []
            messages: list[object] = []
            disconnected = asyncio.Event()
            async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
                captured.append(await upgrade(reader, writer))
                for _ in range(3):
                    opcode, data = await client_frame(reader)
                    self.assertEqual(opcode, 1)
                    messages.append(json.loads(data))
                    if "text" in cast(dict[str,object], messages[-1]):
                        writer.write(b"\x82\x02\x00\xff")
                        await writer.drain()
                writer.write(b"\x88\x02\x03\xe8")
                await writer.drain()
                await reader.read()
                disconnected.set()
            async with server(handle) as root:
                source: Source[TextInput] = Source(["Hi", {"command":"flush"}])
                async with synthesize({**streaming(source), "context_before":{"request_ids":["prior"]}, "temperature":0.1}, auth={"hume":{"api_key":"key +/?", "access_token":"token +/?" if token else ""}}, web_socket_url=root + "/proxy%2Fsocket?%61pi_key=old&access_token=old&temperature=0.5&context_generation_id=old&tenant=one") as stream:
                    self.assertEqual([item async for item in stream], [b"\0\xff"])
                await disconnected.wait()
            request_line, headers = captured[0]
            target = urlsplit(request_line.decode().split(" ")[1])
            self.assertEqual(target.path, "/proxy%2Fsocket")
            self.assertEqual(parse_qsl(target.query), [("tenant","one"), ("access_token" if token else "api_key", "token +/?" if token else "key +/?"), ("format_type","pcm"), ("version","2"), ("instant_mode","true"), ("no_binary","false"), ("strip_headers","true"), ("context_generation_id","prior"), ("temperature","0.1")])
            self.assertEqual({k:v for k,v in headers.items() if k in (b"authorization", b"x-hume-api-key")}, {})
            self.assertEqual(messages, [{"text":"Hi", "voice":{"id":"saved","provider":"CUSTOM_VOICE"}, "speed":1, "trailing_silence":0}, {"flush":True}, {"close":True}])

    async def test_rejected_handshake_never_acquires_input(self) -> None:
        disconnected = asyncio.Event()
        async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            await reader.readuntil(b"\r\n\r\n")
            writer.write(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
            await writer.drain()
            await reader.read()
            disconnected.set()
        source: Source[TextInput] = Source([], True)
        async with server(handle) as root:
            with self.assertRaises(WebSocketError) as raised:
                async with synthesize(streaming(source), auth=AUTH, web_socket_url=root + "/tts"):
                    self.fail("rejected handshake entered")
            self.assertEqual(str(raised.exception), "WebSocket handshake was not accepted")
            await disconnected.wait()
        self.assertEqual((source.pulls, source.closes), (0, 0))

    async def test_validation_relational_checks_and_endpoint_safety(self) -> None:
        invalid: list[tuple[object,str]] = [
            ({**request(), "instructions":"unsupported"}, "Invalid hume TTS request"),
            ({**request(), "output":{"format":"pcm","sample_rate_hz":24000}}, "Invalid hume TTS request"),
            ({**request(), "context_before":{"request_ids":[""]}}, "Hume continuation requires a non-empty generation ID"),
            ({"model":"octave-2","output":{"format":"pcm"},"speakers":[{"alias":"a","voice":"one"},{"alias":"a","voice":"two"}],"turns":[{"speaker":"a","text":"Hi"}]}, "Hume speaker aliases must be unique"),
            ({"model":"octave-2","output":{"format":"pcm"},"speakers":[{"alias":"a","voice":"one"}],"turns":[{"speaker":"unknown","text":"Hi"}]}, "Unknown Hume speaker: unknown"),
        ]
        for value, expected in invalid:
            transport = Transport(Source([b"unused"]))
            with self.assertRaises(TypeError) as raised:
                async with synthesize(cast(TtsRequest,value), auth=AUTH, transport=transport):
                    self.fail("invalid entered")
            self.assertEqual(str(raised.exception), expected)
            self.assertEqual(transport.requests, [])
        for url in ["https://user:secret@host", "https://host:99999", "https://host/%xx", "https://host/?q=%xx", "https://host/#fragment", "https://host/space here"]:
            with self.assertRaises(TypeError) as raised:
                async with synthesize(request(), auth=AUTH, base_url=url):
                    self.fail("invalid URL entered")
            self.assertEqual(str(raised.exception), "Invalid Hume endpoint URL")

    async def test_timeouts_idle_streams_and_unread_socket_cleanup(self) -> None:
        body = Source([b"unused"])
        transport = Transport(body)
        with self.assertRaises(TimeoutError) as raised:
            async with synthesize(request(), auth=AUTH, transport=transport, timeout_ms=0):
                self.fail("zero deadline entered")
        self.assertEqual(str(raised.exception), "Hume synthesis deadline expired")
        self.assertEqual(transport.requests, [])
        for read in [False, True]:
            source: Source[TextInput] = Source([], True)
            socket = Socket()
            with self.assertRaises(TimeoutError) as raised:
                async with synthesize(streaming(source), web_socket=socket, timeout_ms=50) as stream:
                    if read:
                        await anext(stream)
                    else:
                        await asyncio.Future[None]()
            self.assertEqual(str(raised.exception), "Hume synthesis deadline expired")
            self.assertTrue(socket.closed)
            if read:
                await asyncio.wait_for(source.closed.wait(),1)
            else:
                self.assertEqual(source.pulls, 0)

    async def test_exact_malformed_packets_and_byte_limits(self) -> None:
        ids = {"generation_id":"g", "request_id":"r", "snippet_id":"s"}
        audio = {**ids,"type":"audio","audio":"AA==","chunk_index":0,"is_last_chunk":True}
        cases: list[tuple[object,str]] = [
            ([],"Hume returned an invalid event"),
            ({"type":"audio"},"Hume returned invalid correlation identifiers"),
            ({**audio,"audio":"!"},"Hume returned invalid base64 audio"),
            ({**audio,"chunk_index":True},"Hume returned an invalid audio event"),
            ({**audio,"utterance_index":-1},"Hume returned an invalid audio event"),
            ({**ids,"type":"timestamp","timestamp":{"type":"word","text":"hi","time":{"begin":0,"end":0.5}}},"Hume returned an invalid timestamp"),
            ({**ids,"type":"timestamp","timestamp":{"type":"phoneme","text":"h","time":{"begin":2,"end":1}}},"Hume returned an invalid timestamp"),
        ]
        for packet, expected in cases:
            body = Source([json.dumps(packet).encode()])
            with self.assertRaises(TypeError) as raised:
                async with synthesize(request(),auth=AUTH,transport=Transport(body),include_metadata=True) as stream:
                    await anext(stream)
            self.assertEqual(str(raised.exception),expected)
            self.assertEqual(body.closes,1)
        for data, limit, expected in [(b"123",2,"Hume JSON line exceeds max_json_bytes"),(b"\xff",10,"Hume returned invalid UTF-8"),(b"{} extra",100,"Hume returned invalid JSON")]:
            with self.assertRaises(TypeError) as raised:
                async with synthesize(request(),auth=AUTH,transport=Transport(Source([data])),include_metadata=True,max_json_bytes=limit) as stream:
                    await anext(stream)
            self.assertEqual(str(raised.exception),expected)
        for value, limit, expected in [("😀"*2501,100000,"Hume text must not exceed 5000 characters per utterance"),("Hi",1,"Hume message exceeds max_message_bytes"),({"command":"clear"},1000,"Invalid hume TTS input item")]:
            source = Source([cast(TextInput,value)])
            socket = Socket()
            with self.assertRaises(TypeError) as raised:
                async with synthesize(streaming(source),web_socket=socket,max_message_bytes=limit) as stream:
                    await anext(stream)
            self.assertEqual(str(raised.exception),expected)
            self.assertTrue(socket.closed)

    async def test_auth_precedence_and_token_headers(self) -> None:
        for env, auth, expected in [
            ({"HUME_API_KEY":"native"},None,{"X-Hume-Api-Key":"native"}),
            ({"HUME_API_KEY":"native","SPEECHSWITCH_HUME_API_KEY":"scoped"},None,{"X-Hume-Api-Key":"scoped"}),
            ({"SPEECHSWITCH_HUME_API_KEY":"scoped"},AUTH,{"X-Hume-Api-Key":"test-key"}),
            ({},{"hume":{"api_key":"ignored","access_token":"token"}},{"Authorization":"Bearer token"}),
        ]:
            transport = Transport(Source([b"audio"]))
            with patch.dict("os.environ",env,clear=True):
                async with synthesize(request(),auth=cast(Auth | None,auth),transport=transport) as stream:
                    self.assertEqual([item async for item in stream],[b"audio"])
            self.assertEqual(transport.requests[0].headers,{**expected,"content-type":"application/json"})
        with patch.dict("os.environ",{"HUME_API_KEY":"native"},clear=True):
            with self.assertRaises(TypeError) as raised:
                async with synthesize(request(),auth={"hume":{"api_key":""}}):
                    self.fail("empty key entered")
            self.assertEqual(str(raised.exception),"Missing auth.hume.apiKey configuration")

    async def test_slow_input_cleanup_cannot_hold_socket_or_consumer(self) -> None:
        release = asyncio.Event()
        cleaning = asyncio.Event()
        class Slow(Source[TextInput]):
            async def aclose(self) -> None:
                cleaning.set()
                await release.wait()
                await super().aclose()
        source = Slow(["Hi"], True)
        socket = Socket()
        try:
            async with asyncio.timeout(1):
                async with synthesize(streaming(source),web_socket=socket) as stream:
                    self.assertEqual(await anext(stream),b"\0\xff")
                self.assertTrue(socket.closed)
                await cleaning.wait()
                self.assertFalse(source.closed.is_set())
        finally:
            release.set()
            await asyncio.wait_for(source.closed.wait(),1)

    async def test_native_pending_receive_cancellation_disconnects(self) -> None:
        connected, disconnected = asyncio.Event(), asyncio.Event()
        async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            await upgrade(reader,writer)
            connected.set()
            try:
                self.assertEqual(await client_frame(reader),(8,b"\x03\xe8"))
            except asyncio.IncompleteReadError as error:
                self.assertEqual(error.partial,b"")
            self.assertEqual(await reader.read(),b"")
            disconnected.set()
        source: Source[TextInput] = Source([],True)
        async with server(handle) as root:
            async with synthesize(streaming(source),auth=AUTH,base_url=root) as stream:
                pending=asyncio.ensure_future(anext(stream))
                await connected.wait()
                await source.waiting.wait()
                pending.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await pending
                await disconnected.wait()
        await asyncio.wait_for(source.closed.wait(),1)

    async def test_socket_byte_bounds_binary_modes_and_abnormal_close(self) -> None:
        for frame, metadata, limit, expected in [(b"audio",True,100,"Hume returned binary audio in JSON mode"),("é"*51,False,100,"Hume message exceeds max_message_bytes"),("{\"a\":NaN}",False,100,"Hume returned invalid JSON")]:
            socket=Socket()
            socket.incoming.put_nowait(frame)
            source: Source[TextInput] = Source([],True)
            with self.assertRaises(TypeError) as raised:
                async with synthesize(streaming(source),web_socket=socket,include_metadata=metadata,max_message_bytes=limit) as stream:
                    await anext(stream)
            self.assertEqual(str(raised.exception),expected)
            self.assertTrue(socket.closed)
        socket=Socket()
        original=WebSocketClosed(1011,"provider failed")
        socket.incoming.put_nowait(original)
        with self.assertRaises(WebSocketClosed) as raised:
            async with synthesize(streaming(Source([])),web_socket=socket) as stream:
                await anext(stream)
        self.assertIs(raised.exception,original)
        self.assertTrue(socket.closed)

    async def test_option_limits_error_body_limit_and_http_deadline(self) -> None:
        for limit in [0,-1,4294967296]:
            with self.assertRaises(TypeError) as raised:
                async with synthesize(request(),max_json_bytes=limit):
                    self.fail("invalid limit entered")
            self.assertEqual(str(raised.exception),"Hume max_json_bytes must be a positive uint32 value")
        body=Source([b"long"])
        with self.assertRaises(TypeError) as raised:
            async with synthesize(request(),auth=AUTH,transport=Transport(body,500),max_json_bytes=3):
                self.fail("oversized error entered")
        self.assertEqual(str(raised.exception),"Hume response exceeds max_json_bytes")
        self.assertEqual(body.closes,1)
        body: Source[bytes] = Source([],True)
        with self.assertRaises(TimeoutError) as raised:
            async with synthesize(request(),auth=AUTH,transport=Transport(body),timeout_ms=50) as stream:
                await anext(stream)
        self.assertEqual(str(raised.exception),"Hume synthesis deadline expired")
        self.assertEqual(body.closes,1)
