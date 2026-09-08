import asyncio
import base64
import json
import re
import struct
import unittest
from collections.abc import AsyncIterable, AsyncIterator, Awaitable, Callable, Iterator, Sequence
from pathlib import Path
from typing import Literal, cast
from unittest.mock import patch

from speechswitch.generated.auth import Auth
from speechswitch.generated.inworld import TtsRequest, TtsRequestInworldTts2TextVoice, TtsRequestInworldTts2StreamingTextVoice
from speechswitch.generated.validators.inworld import validate_request
from speechswitch.http import HttpRequest, HttpResponse
from speechswitch.providers.inworld import InworldError, Input, synthesize
from speechswitch.validation import is_mapping, is_sequence
from speechswitch.websocket import WebSocketError
from test_websocket import server, upgrade, client_frame

AUTH: Auth = {"inworld": {"api_key": "test-key"}}


def request() -> TtsRequestInworldTts2TextVoice:
    return {"model": "inworld-tts-2", "text": "Hello", "voice": "custom-voice", "output": {"format": "pcm"}}


def streaming(text: AsyncIterable[Input]) -> TtsRequestInworldTts2StreamingTextVoice:
    return {"model": "inworld-tts-2", "text": text, "voice": "custom-voice", "output": {"format": "pcm"}}


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
    def event(self, **fields: object) -> None:
        self.incoming.put_nowait(json.dumps({"result": {"contextId": "ctx", **fields}}))
    async def send(self, message: str | bytes) -> None:
        assert isinstance(message, str)
        packet: object = json.loads(message)
        assert is_mapping(packet)
        value = dict(packet)
        self.sent.append(value)
        if self.on_send is not None:
            await self.on_send(value)
        elif "create" in value:
            self.event(contextCreated={})
        elif "send_text" in value:
            self.event(audioChunk={"audioContent": "AP8="})
        elif "flush_context" in value:
            self.event(flushCompleted={})
        elif "close_context" in value:
            self.event(contextClosed={})
    async def receive(self) -> str | bytes:
        value = await self.incoming.get()
        if isinstance(value, Exception):
            raise value
        return value
    async def aclose(self) -> None:
        self.closed = True


def wave(rate: int = 48000, extra: bytes = b"") -> bytes:
    fmt = struct.pack("<HHIIHH", 1, 1, rate, rate * 2, 2, 16)
    chunks = b"fmt " + struct.pack("<I", 16) + fmt + extra + b"data" + struct.pack("<I", 2) + b"\0\xff"
    return b"RIFF" + struct.pack("<I", len(chunks) + 4) + b"WAVE" + chunks


class InworldTests(unittest.IsolatedAsyncioTestCase):
    async def test_shared_settings_all_models_and_formats(self) -> None:
        fixtures = json.loads((Path(__file__).parents[2] / "fixtures/inworld.json").read_text())
        for case in fixtures["http"]:
            r = cast(TtsRequest, hydrate(case["request"]))
            body = Source([b'{"result":{"audioContent":"AP8="}}\n'])
            transport = Transport(body)
            async with synthesize(r, auth=AUTH, transport=transport, base_url="https://proxy.test/a%2Fb/?tenant=one") as stream:
                self.assertEqual(body.pulls, 0)
                self.assertEqual([item async for item in stream], [{"correlation":"chunk", "audio":b"\0\xff", "timestamps":[]}] if r.get("timestamp_granularity") else [b"\0\xff"])
            self.assertEqual(body.closes, 1)
            wire = transport.requests[0]
            self.assertEqual((wire.method, wire.url, wire.headers), ("POST", "https://proxy.test/a%2Fb/tts/v1/voice:stream?tenant=one", {"Authorization":"Basic test-key", "content-type":"application/json"}))
            self.assertEqual(json.loads(wire.body), case["body"])

    async def test_preceding_context_uses_validated_indexed_values(self) -> None:
        class Indexed(list[str]):
            def __iter__(self) -> Iterator[str]:
                raise AssertionError("custom iterator must not replace indexed context")

        transport = Transport(Source([]))
        async with synthesize({**request(), "context_before": {"texts": Indexed(["First", "Second"])}}, auth=AUTH, transport=transport) as stream:
            self.assertEqual([item async for item in stream], [])
        self.assertEqual(json.loads(transport.requests[0].body)["synthesisContext"], {
            "previousRequests": [{"text": "First"}, {"text": "Second"}],
        })
        transport = Transport(Source([]))
        with self.assertRaises(TypeError) as raised:
            async with synthesize({**request(), "context_before": {"texts": Indexed(["🙂" * 600, "🙂" * 401])}}, auth=AUTH, transport=transport):
                self.fail("oversized context entered")
        self.assertEqual(str(raised.exception), "Inworld preceding context must not exceed 2000 characters")
        self.assertEqual(transport.requests, [])

    async def test_shared_timeline_every_utf8_byte_split(self) -> None:
        fixtures = json.loads((Path(__file__).parents[2] / "fixtures/inworld.json").read_text())["timeline"]
        data = ("\ufeff\r\n" + "\r\n".join(json.dumps(v["packet"], ensure_ascii=False) for v in fixtures)).encode()
        for split in range(len(data) + 1):
            body = Source([data[:split], data[split:]])
            async with synthesize({**request(), "timestamp_granularity":"word"}, auth=AUTH, transport=Transport(body)) as stream:
                self.assertEqual([item async for item in stream], [hydrate(v["item"]) for v in fixtures], f"split {split}")
            self.assertEqual(body.closes, 1)

    async def test_single_response_is_chunk_associated(self) -> None:
        body = Source([b'{"audioContent":"AP8=","timestampInfo":{"characterAlignment":{"characters":["H"],"characterStartTimeSeconds":[0],"characterEndTimeSeconds":[0.1]}}}'])
        transport = Transport(body)
        async with synthesize({**request(), "timestamp_granularity":"character"}, auth=AUTH, transport=transport, http_mode="single") as stream:
            self.assertEqual([item async for item in stream], [{"correlation":"chunk", "audio":b"\0\xff", "timestamps":[{"kind":"character","value":"H","start_time_ms":0,"end_time_ms":100}]}])
        self.assertEqual(transport.requests[0].url, "https://api.inworld.ai/tts/v1/voice")
        expected = json.loads((Path(__file__).parents[2] / "fixtures/inworld.json").read_text())["http"][0]["body"]
        del expected["timestampTransportStrategy"]
        expected["timestampType"] = "CHARACTER"
        self.assertEqual(json.loads(transport.requests[0].body), expected)

    async def test_socket_pipelining_flush_groups_and_all_models(self) -> None:
        for model in ["inworld-tts-2", "inworld-tts-2-flash", "inworld-tts-1.5-max", "inworld-tts-1.5-mini"]:
            source: Source[Input] = Source(["Hel", "", {"command":"flush"}, "lo"])
            socket = Socket()
            # Delay contextCreated until text arrives: clients must pipeline.
            async def send(packet: dict[object,object]) -> None:
                if packet.get("send_text") == {"text":"Hel"}:
                    socket.event(contextCreated={})
                if "send_text" in packet:
                    socket.event(audioChunk={"audioContent":"AP8="})
                if "flush_context" in packet:
                    socket.event(flushCompleted={})
                if "close_context" in packet:
                    socket.event(contextClosed={})
            socket.on_send = send
            r = cast(TtsRequest, {**streaming(source), "model":model, "timestamp_granularity":"word", "text_buffer_threshold":0})
            async with synthesize(r, web_socket=socket, context_id="ctx", timeout_ms=1000) as stream:
                self.assertEqual([item async for item in stream], [{"correlation":"timeline","correlation_id":"ctx:0","audio":b"\0\xff","timestamps":[]}, {"event":"flush","correlation_id":"ctx:0","input_group_id":"0"}, {"correlation":"timeline","correlation_id":"ctx:1","audio":b"\0\xff","timestamps":[]}])
            expected = {"voiceId":"custom-voice","modelId":model,"audioConfig":{"audioEncoding":"PCM","sampleRateHertz":48000,"speakingRate":1},"applyTextNormalization":"APPLY_TEXT_NORMALIZATION_UNSPECIFIED","timestampType":"WORD","timestampTransportStrategy":"ASYNC","maxBufferDelayMs":0,"bufferCharThreshold":1000,"autoMode":False, **({"deliveryMode":"BALANCED"} if model == "inworld-tts-2" else {"temperature":1})}
            self.assertEqual(socket.sent, [{"create":expected,"contextId":"ctx"},{"send_text":{"text":"Hel"},"contextId":"ctx"},{"flush_context":{},"contextId":"ctx"},{"send_text":{"text":"lo"},"contextId":"ctx"},{"close_context":{},"contextId":"ctx"}])
            await asyncio.wait_for(source.closed.wait(), 1)
            self.assertTrue(socket.closed)

    async def test_wav_header_all_splits_and_native_auto_flush(self) -> None:
        data = wave(extra=b"JUNK\x01\0\0\0x\0")
        expected = bytearray(data)
        struct.pack_into("<I", expected, 4, 0xffffffff)
        struct.pack_into("<I", expected, len(data) - 6, 0xffffffff)
        for split in range(len(data) + 1):
            socket = Socket()
            async def send(packet: dict[object,object]) -> None:
                if "create" in packet:
                    socket.event(contextCreated={})
                    for chunk in [data[:split], data[split:]]:
                        socket.event(audioChunk={"audioContent":base64.b64encode(chunk).decode()})
                    socket.event(flushCompleted={})
                    socket.event(audioChunk={"audioContent":base64.b64encode(data).decode()})
                if "close_context" in packet:
                    socket.event(contextClosed={})
            socket.on_send = send
            source: Source[Input] = Source([])
            async with synthesize({**streaming(source), "output":{"format":"wav"}}, web_socket=socket, context_id="ctx") as stream:
                items = [item async for item in stream]
            self.assertEqual(b"".join(item for item in items if isinstance(item,bytes)), bytes(expected) + b"\0\xff", f"split {split}")
            self.assertEqual([item for item in items if not isinstance(item,bytes)], [{"event":"flush","correlation_id":"ctx:0","input_group_id":"0"}])

    async def test_early_http_audio_unread_and_cancelled_reads(self) -> None:
        body = Source([b'{"result":{"audioContent":"AP8="}}\n'], True)
        async with synthesize(request(), auth=AUTH, transport=Transport(body)) as stream:
            self.assertEqual(await anext(stream), b"\0\xff")
            pending = asyncio.ensure_future(anext(stream))
            await body.waiting.wait()
            pending.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await pending
            self.assertEqual(body.closes, 1)
        body = Source([b"unread"])
        async with synthesize(request(), auth=AUTH, transport=Transport(body)):
            pass
        self.assertEqual((body.pulls,body.closes), (0,1))

    async def test_stalled_input_writes_and_close_do_not_block_output(self) -> None:
        for blocked in ["input", "text", "close"]:
            source: Source[Input] = Source(["Hi"], blocked == "input")
            socket = Socket()
            async def send(packet: dict[object,object]) -> None:
                if "create" in packet:
                    socket.event(contextCreated={})
                if "send_text" in packet:
                    socket.event(audioChunk={"audioContent":"AP8="})
                    if blocked == "text":
                        await asyncio.Future[None]()
                if "close_context" in packet:
                    socket.event(contextClosed={})
                    if blocked == "close":
                        await asyncio.Future[None]()
            socket.on_send = send
            async with synthesize(streaming(source), web_socket=socket, context_id="ctx", timeout_ms=1000) as stream:
                self.assertEqual(await anext(stream), b"\0\xff")
                if blocked == "close":
                    self.assertEqual([item async for item in stream], [])
            await asyncio.wait_for(source.closed.wait(), 1)
            self.assertTrue(socket.closed)

    async def test_http_native_errors_bounds_and_read_identity(self) -> None:
        for status, data, expected in [(403,b'{"code":7,"message":"denied"}',(403,7,"denied")),(200,b'{"error":{"code":8,"message":"quota"}}\n',(None,8,"quota")),(200,b'{"result":{"audioContent":"","status":{"code":3,"message":"invalid"}}}\n',(None,3,"invalid"))]:
            body = Source([data])
            with self.assertRaises(InworldError) as failure:
                async with synthesize(request(), auth=AUTH, transport=Transport(body,status)) as stream:
                    await anext(stream)
            self.assertEqual((failure.exception.status_code,failure.exception.code,str(failure.exception)),expected)
            self.assertEqual(body.closes,1)
        error = OSError("read failed")
        body: Source[bytes] = Source([error])
        with self.assertRaises(OSError) as failure:
            async with synthesize(request(), auth=AUTH, transport=Transport(body)) as stream:
                await anext(stream)
        self.assertIs(failure.exception,error)
        self.assertEqual(body.closes,1)
        for status, mode in [(200,"stream"),(200,"single"),(403,"stream")]:
            body = Source([b"12345"])
            with self.assertRaises(TypeError) as failure:
                async with synthesize(request(), auth=AUTH, transport=Transport(body,status),http_mode=cast(AnyMode,mode),max_json_bytes=4) as stream:
                    await anext(stream)
            self.assertEqual(str(failure.exception),"Inworld JSON line exceeds max_json_bytes" if status == 200 and mode == "stream" else "Inworld response exceeds max_json_bytes")
            self.assertEqual(body.closes,1)


    async def test_native_header_auth_and_no_token_replay(self) -> None:
        for token in [False, True]:
            captured: list[tuple[bytes,dict[bytes,bytes]]] = []
            disconnected = asyncio.Event()
            async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
                captured.append(await upgrade(reader,writer))
                for kind in ["create", "send_text", "close_context"]:
                    opcode, data = await client_frame(reader)
                    self.assertEqual(opcode,1)
                    packet = json.loads(data)
                    self.assertEqual(sorted(packet), sorted([kind,"contextId"]))
                    event: dict[str,object] = {"contextCreated":{}} if kind == "create" else {"audioChunk":{"audioContent":"AP8="}} if kind == "send_text" else {"contextClosed":{}}
                    response = json.dumps({"result":{"contextId":"ctx",**event}},separators=(",",":")).encode()
                    self.assertLess(len(response),126)
                    writer.write(bytes([0x81,len(response)]) + response)
                    await writer.drain()
                await reader.read()
                disconnected.set()
            async with server(handle) as root:
                source: Source[Input] = Source(["Hi"])
                async with synthesize(streaming(source),auth={"inworld":{"api_key":"native-key","access_token":"once" if token else ""}},web_socket_url=root + "/proxy%2Fsocket?tenant=one",context_id="ctx") as stream:
                    self.assertEqual([item async for item in stream],[b"\0\xff"])
                await disconnected.wait()
            self.assertEqual(len(captured),1)
            line, headers = captured[0]
            self.assertEqual(line,b"GET /proxy%2Fsocket?tenant=one HTTP/1.1")
            self.assertEqual(headers.get(b"authorization"),b"Bearer once" if token else b"Basic native-key")
            self.assertEqual(headers.get(b"sec-websocket-protocol"),None)

    async def test_rejected_handshake_never_acquires_input(self) -> None:
        disconnected = asyncio.Event()
        async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            await reader.readuntil(b"\r\n\r\n")
            writer.write(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
            await writer.drain()
            await reader.read()
            disconnected.set()
        source: Source[Input] = Source([],True)
        async with server(handle) as root:
            with self.assertRaises(WebSocketError) as failure:
                async with synthesize(streaming(source),auth={"inworld":{"access_token":"once"}},web_socket_url=root):
                    self.fail("rejected handshake entered")
            self.assertEqual(str(failure.exception),"WebSocket handshake was not accepted")
            await disconnected.wait()
        self.assertEqual((source.pulls,source.closes),(0,0))

    async def test_native_pending_receive_cancellation_disconnects(self) -> None:
        created, disconnected = asyncio.Event(), asyncio.Event()
        async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            await upgrade(reader,writer)
            opcode, data = await client_frame(reader)
            self.assertEqual(opcode,1)
            self.assertEqual(sorted(json.loads(data)),["contextId","create"])
            created.set()
            try:
                self.assertEqual(await client_frame(reader),(8,b"\x03\xe8"))
            except asyncio.IncompleteReadError as error:
                self.assertEqual(error.partial,b"")
            self.assertEqual(await reader.read(),b"")
            disconnected.set()
        source: Source[Input] = Source([],True)
        async with server(handle) as root:
            async with synthesize(streaming(source),auth=AUTH,base_url=root) as stream:
                pending = asyncio.ensure_future(anext(stream))
                await created.wait()
                await source.waiting.wait()
                pending.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await pending
                await disconnected.wait()
        await asyncio.wait_for(source.closed.wait(),1)

    async def test_exact_protocol_state_errors(self) -> None:
        cases: list[tuple[list[object],str]] = [
            ([{"audioChunk":{"audioContent":"AP8="}}],"Inworld returned output before contextCreated"),
            ([{"contextCreated":{}},{"contextCreated":{}}],"Inworld returned duplicate contextCreated"),
            ([{"contextId":"wrong","contextCreated":{}}],"Inworld returned an unexpected context ID"),
            ([{"contextCreated":{},"audioChunk":{}}],"Inworld returned an invalid context event"),
            ([{"contextCreated":[] }],"Inworld returned an invalid object"),
            ([{"contextCreated":{}},{"contextClosed":{}}],"Inworld completed before the input stream ended"),
            ([StopAsyncIteration()],"Inworld WebSocket closed before contextClosed"),
            ([b"audio"],"Inworld returned a non-text WebSocket frame"),
        ]
        for frames, message in cases:
            socket = Socket()
            for frame in frames:
                if isinstance(frame,(bytes,Exception)):
                    socket.incoming.put_nowait(frame)
                else:
                    socket.incoming.put_nowait(json.dumps({"result":{"contextId":"ctx",**cast(dict[str,object],frame)}}))
            source: Source[Input] = Source([],True)
            with self.assertRaises(TypeError) as failure:
                async with synthesize(streaming(source),web_socket=socket,context_id="ctx") as stream:
                    await anext(stream)
            self.assertEqual(str(failure.exception),message)
            self.assertTrue(socket.closed)

    async def test_malformed_wire_audio_alignment_and_utf8(self) -> None:
        cases: list[tuple[bytes,str]] = [
            (b"\xff\n","Inworld returned invalid UTF-8"),
            (b'{"result":{"audioContent":NaN}}\n',"Inworld returned invalid JSON"),
            (b'{"result":{"audioContent":"%%%="}}\n',"Inworld returned invalid base64 audio"),
            (b'{"result":{"audioContent":[]}}\n',"Inworld returned invalid audio content"),
            (b'{"result":{}}\n',"Inworld returned no audio or alignment"),
            (b'{"result":{"status":{"code":true},"usage":{}}}\n',"Inworld returned an invalid status code"),
            (b'{"result":{"timestampInfo":{"wordAlignment":{"words":["Hi"],"wordStartTimeSeconds":[],"wordEndTimeSeconds":[]}}}}\n',"Inworld returned mismatched timestamp arrays"),
            (b'{"result":{"timestampInfo":{"wordAlignment":{"words":["Hi"],"wordStartTimeSeconds":[1],"wordEndTimeSeconds":[0]}}}}\n',"Inworld returned a reversed timestamp range"),
        ]
        for data, expected in cases:
            body = Source([data])
            with self.assertRaises(TypeError) as failure:
                async with synthesize({**request(),"timestamp_granularity":"word"},auth=AUTH,transport=Transport(body)) as stream:
                    await anext(stream)
            self.assertEqual(str(failure.exception),expected)
            self.assertEqual(body.closes,1)
        with self.assertRaises(TypeError) as failure:
            async with synthesize({**request(),"timestamp_granularity":"word","timestamp_delivery":"chunk"},auth=AUTH,transport=Transport(Source([b'{"result":{"timestampInfo":{}}}\n']))) as stream:
                await anext(stream)
        self.assertEqual(str(failure.exception),"Inworld omitted audio from synchronized alignment")

    async def test_wav_rejects_truncation_changes_and_oversized_headers(self) -> None:
        cases = [([wave(),wave(24000)],"Inworld changed WAV format between flushes"),([b"RIFF"],"Inworld returned an incomplete WAV header"),([b"RIFF\0\0\0\0WAVEJUNK\xff\xff\xff\xff"],"Inworld WAV header is too large"),([b"RIFF\0\0\0\0WAVEdata\0\0\0\0"],"Inworld WAV omitted its format")]
        for parts, expected in cases:
            socket = Socket()
            async def send(packet: dict[object,object]) -> None:
                if "create" in packet:
                    socket.event(contextCreated={})
                    for part in parts:
                        socket.event(audioChunk={"audioContent":base64.b64encode(part).decode()})
                        socket.event(flushCompleted={})
                if "close_context" in packet:
                    socket.event(contextClosed={})
            socket.on_send = send
            source: Source[Input] = Source([])
            with self.assertRaises(TypeError) as failure:
                async with synthesize({**streaming(source),"output":{"format":"wav"}},web_socket=socket,context_id="ctx") as stream:
                    _ = [item async for item in stream]
            self.assertEqual(str(failure.exception),expected)
            self.assertTrue(socket.closed)

    async def test_generated_validation_and_relational_bounds_before_io(self) -> None:
        invalid: list[tuple[object,str | None]] = [
            ({**request(),"temperature":1},None),
            ({**request(),"model":"inworld-tts-2-flash","delivery_mode":"stable"},None),
            ({**request(),"model":"inworld-tts-2-flash","instructions":"quiet"},None),
            ({**request(),"output":{"format":"mp3","sample_rate_hz":8000}},None),
            ({**request(),"text":"🙂"*2001},None),
            ({**request(),"context_before":{"texts":["🙂"*600,"🙂"*401]}},"Inworld preceding context must not exceed 2000 characters"),
        ]
        for value, message in invalid:
            if message is None:
                with self.assertRaises(TypeError) as generated:
                    validate_request(value)
                message = str(generated.exception)
            transport = Transport(Source([b"unused"]))
            with self.assertRaises(TypeError) as failure:
                async with synthesize(cast(TtsRequest,value),auth=AUTH,transport=transport):
                    self.fail("invalid entered")
            self.assertEqual(str(failure.exception),message)
            self.assertEqual(transport.requests,[])
        for item, expected in [({"command":"clear"},'Invalid inworld TTS input item:\ntext item: expected string\ntext item["command"]: expected "flush"'),("🙂"*1001,"Inworld text chunks must not exceed 2000 characters")]:
            source: Source[Input] = Source([cast(Input,item)])
            socket = Socket()
            with self.assertRaises(TypeError) as failure:
                async with synthesize(streaming(source),web_socket=socket,context_id="ctx") as stream:
                    await anext(stream)
            self.assertEqual(str(failure.exception),expected)
            self.assertEqual(len(socket.sent),1)
            await asyncio.wait_for(source.closed.wait(),1)
        with self.assertRaises(TypeError) as failure:
            async with synthesize({**request(),"text":"🙂"*1001},auth=AUTH,http_mode="single"):
                self.fail("oversized entered")
        self.assertEqual(str(failure.exception),"Inworld single-response text must not exceed 2000 characters")

    async def test_auth_environment_and_endpoint_safety(self) -> None:
        for env, auth, expected in [({"INWORLD_API_KEY":"native"},None,"Basic native"),({"INWORLD_API_KEY":"native","SPEECHSWITCH_INWORLD_API_KEY":"scoped"},None,"Basic scoped"),({},AUTH,"Basic test-key"),({}, {"inworld":{"api_key":"key","access_token":"once"}},"Bearer once")]:
            transport = Transport(Source([b'{"result":{"audioContent":""}}']))
            with patch.dict("os.environ",env,clear=True):
                async with synthesize(request(),auth=cast(Auth|None,auth),transport=transport) as stream:
                    self.assertEqual([item async for item in stream],[])
            self.assertEqual(transport.requests[0].headers["Authorization"],expected)
        with patch.dict("os.environ",{"INWORLD_API_KEY":"native"},clear=True):
            with self.assertRaises(TypeError) as failure:
                async with synthesize(request(),auth={"inworld":{"api_key":""}}):
                    self.fail("missing key entered")
            self.assertEqual(str(failure.exception),"Missing auth.inworld.apiKey configuration")
        for url in ["https://user:secret@host", "https://host:99999", "https://host/%xx", "https://host/?q=%xx", "https://host/#fragment", "https://host/space here"]:
            with self.assertRaises(TypeError) as failure:
                async with synthesize(request(),auth=AUTH,base_url=url):
                    self.fail("invalid URL entered")
            self.assertEqual(str(failure.exception),"Invalid Inworld endpoint URL")

    async def test_uncooperative_input_cleanup_does_not_hold_socket(self) -> None:
        release, cleaning = asyncio.Event(), asyncio.Event()
        class SlowSource(Source[Input]):
            async def aclose(self) -> None:
                cleaning.set()
                await release.wait()
                await super().aclose()
        source = SlowSource(["Hi"],True)
        socket = Socket()
        try:
            async with synthesize(streaming(source),web_socket=socket,context_id="ctx",timeout_ms=1000) as stream:
                self.assertEqual(await anext(stream),b"\0\xff")
                await source.waiting.wait()
            self.assertTrue(socket.closed)
            await asyncio.wait_for(cleaning.wait(),1)
            self.assertEqual(source.closes,0)
        finally:
            release.set()
        await asyncio.wait_for(source.closed.wait(),1)

    async def test_cancellation_before_headers_and_original_timeout_identity(self) -> None:
        waiting, released = asyncio.Event(), asyncio.Event()
        class PendingTransport:
            async def send(self, request: HttpRequest) -> HttpResponse:
                waiting.set()
                try:
                    await asyncio.Future[None]()
                finally:
                    released.set()
                raise AssertionError("unreachable")
        async def consume() -> None:
            async with synthesize(request(),auth=AUTH,transport=PendingTransport()) as stream:
                await anext(stream)
        task = asyncio.create_task(consume())
        await waiting.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertTrue(released.is_set())
        error = TimeoutError("backend timeout")
        body: Source[bytes] = Source([error])
        with self.assertRaises(TimeoutError) as failure:
            async with synthesize(request(),auth=AUTH,transport=Transport(body),timeout_ms=1000) as stream:
                await anext(stream)
        self.assertIs(failure.exception,error)

    async def test_socket_limits_and_producer_error_identity(self) -> None:
        source: Source[Input] = Source([],True)
        socket = Socket()
        with self.assertRaises(TypeError) as failure:
            async with synthesize(streaming(source),web_socket=socket,context_id="ctx",max_message_bytes=10) as stream:
                await anext(stream)
        self.assertEqual(str(failure.exception),"Inworld message exceeds max_message_bytes")
        self.assertEqual((socket.sent,source.pulls),([],0))
        self.assertTrue(socket.closed)
        socket = Socket()
        socket.incoming.put_nowait("é"*301)
        with self.assertRaises(TypeError) as failure:
            async with synthesize(streaming(Source([])),web_socket=socket,context_id="ctx",max_message_bytes=600) as stream:
                await anext(stream)
        self.assertEqual(str(failure.exception),"Inworld message exceeds max_message_bytes")
        error = OSError("producer failed")
        source = Source([error])
        socket = Socket()
        with self.assertRaises(OSError) as raised:
            async with synthesize(streaming(source),web_socket=socket,context_id="ctx") as stream:
                await anext(stream)
        self.assertIs(raised.exception,error)
        await asyncio.wait_for(source.closed.wait(),1)
        self.assertTrue(socket.closed)

    async def test_deadlines_own_unread_and_active_streams(self) -> None:
        transport = Transport(Source([b"unused"]))
        with self.assertRaises(TimeoutError) as failure:
            async with synthesize(request(),auth=AUTH,transport=transport,timeout_ms=0):
                self.fail("expired entered")
        self.assertEqual(str(failure.exception),"Inworld synthesis deadline expired")
        self.assertEqual(transport.requests,[])
        for read in [False,True]:
            source: Source[Input] = Source([],True)
            socket = Socket()
            with self.assertRaises(TimeoutError) as failure:
                async with synthesize(streaming(source),web_socket=socket,context_id="ctx",timeout_ms=30) as stream:
                    if read:
                        await anext(stream)
                    else:
                        await asyncio.Future[None]()
            self.assertEqual(str(failure.exception),"Inworld synthesis deadline expired")
            self.assertTrue(socket.closed)
            if read:
                await asyncio.wait_for(source.closed.wait(),1)
            else:
                self.assertEqual(source.pulls,0)
        body: Source[bytes] = Source([],True)
        with self.assertRaises(TimeoutError) as failure:
            async with synthesize(request(),auth=AUTH,transport=Transport(body),timeout_ms=30) as stream:
                await anext(stream)
        self.assertEqual(str(failure.exception),"Inworld synthesis deadline expired")
        self.assertEqual(body.closes,1)


type AnyMode = Literal["single", "stream"]
