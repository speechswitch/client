import asyncio
from collections import UserList
import json
import math
import os
from pathlib import Path
from typing import Literal, cast
from unittest.mock import patch
from urllib.parse import urlsplit
import unittest
from speechswitch.generated.auth import Auth
from speechswitch.generated.typecast import TtsRequest, TtsRequestSsfmV30TextVoicec9d5257e
from speechswitch.generated.typecast_output import SynthesisItem, TypecastEnvelopeTimestampsItem
from speechswitch.http import HttpRequest, HttpResponse
from speechswitch.providers.typecast import TypecastError, synthesize
from test_mistral import python_names
from test_openai import Body, Transport
from test_websocket import server

AUTH: Auth = {"typecast": {"api_key": "fixture"}}
REQUEST: TtsRequestSsfmV30TextVoicec9d5257e = {"model": "ssfm-v30", "text": "Hi", "voice": "uc_voice"}
FIXTURES: dict[str, object] = json.loads((Path(__file__).parents[2] / "fixtures/typecast.json").read_text())
RESPONSE = cast(dict[str, object], FIXTURES["timestampResponse"])
MARKS = cast(list[TypecastEnvelopeTimestampsItem], python_names(FIXTURES["timestamps"]))


class TypecastTests(unittest.IsolatedAsyncioTestCase):
    async def test_native_http_header_auth_first_chunk_and_early_close(self) -> None:
        disconnected = asyncio.Event()
        captured: list[tuple[bytes, dict[bytes, bytes], object]] = []

        async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            lines = (await reader.readuntil(b"\r\n\r\n"))[:-4].split(b"\r\n")
            headers = dict((name.lower(), value.strip()) for name, value in (line.split(b":", 1) for line in lines[1:]))
            data = await reader.readexactly(int(headers[b"content-length"]))
            captured.append((lines[0], headers, json.loads(data)))
            writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: audio/wav\r\nConnection: close\r\n\r\nRIFF")
            await writer.drain()
            self.assertEqual(await reader.read(), b"")
            disconnected.set()

        class NativeBody:
            def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
                self.reader, self.writer = reader, writer
                self.closes = 0

            def __aiter__(self) -> "NativeBody":
                return self

            async def __anext__(self) -> bytes:
                chunk = await self.reader.read(4096)
                if not chunk:
                    raise StopAsyncIteration
                return chunk

            async def aclose(self) -> None:
                self.closes += 1
                self.writer.close()
                await self.writer.wait_closed()

        class NativeTransport:
            bodies: list[NativeBody]

            def __init__(self) -> None:
                self.bodies = []

            async def send(self, request: HttpRequest) -> HttpResponse:
                url = urlsplit(request.url)
                reader, writer = await asyncio.open_connection(url.hostname, url.port)
                try:
                    headers = {**request.headers, "Host": url.netloc, "Content-Length": str(len(request.body)), "Connection": "close"}
                    head = f"{request.method} {url.path}?{url.query} HTTP/1.1\r\n" + "".join(f"{name}: {value}\r\n" for name, value in headers.items()) + "\r\n"
                    writer.write(head.encode() + request.body)
                    await writer.drain()
                    lines = (await reader.readuntil(b"\r\n\r\n"))[:-4].split(b"\r\n")
                    body = NativeBody(reader, writer)
                    self.bodies.append(body)
                    return HttpResponse(int(lines[0].split()[1]), dict((name.decode(), value.decode().strip()) for name, value in (line.split(b":", 1) for line in lines[1:])), body)
                except BaseException:
                    writer.close()
                    await writer.wait_closed()
                    raise

        transport = NativeTransport()
        async with server(handle) as url:
            async with synthesize(REQUEST, auth=AUTH, transport=transport, base_url=url.replace("ws://", "http://") + "/proxy?tenant=one") as stream:
                self.assertEqual(await anext(stream), b"RIFF")
            await disconnected.wait()
        (line, headers, payload), = captured
        self.assertEqual(line, b"POST /proxy/v1/text-to-speech/stream?tenant=one HTTP/1.1")
        self.assertEqual({key: value for key, value in headers.items() if key not in (b"host", b"content-length", b"connection")},
                         {b"x-api-key": b"fixture", b"content-type": b"application/json", b"accept": b"audio/wav"})
        self.assertEqual(payload, {"model": "ssfm-v30", "voice_id": "uc_voice", "text": "Hi", "prompt": {"emotion_type": "preset", "emotion_preset": "normal", "emotion_intensity": 1}, "output": {"audio_format": "wav", "audio_pitch": 0, "audio_tempo": 1}})
        self.assertEqual([body.closes for body in transport.bodies], [1])

    async def test_shared_request_and_timestamp_fixtures(self) -> None:
        for fixture in cast(list[dict[str, object]], FIXTURES["requests"]):
            with self.subTest(name=fixture["name"]):
                request = cast(TtsRequest, python_names(fixture["request"]))
                timed = fixture["accept"] == "application/json"
                body = Body([json.dumps(RESPONSE, ensure_ascii=False).encode() if timed else b"\0\xff"])
                transport = Transport(body, content_type=str(fixture["accept"]))
                async with synthesize(request, auth=AUTH, transport=transport) as stream:
                    items = [item async for item in stream]
                selected = request.get("timestamp_granularity", ())
                wanted = [selected] if isinstance(selected, str) else selected
                expected: SynthesisItem = {"correlation": "chunk", "audio": b"\0\xff", "duration_ms": 500,
                    "timestamps": tuple(mark for mark in MARKS if mark["kind"] in wanted)} if timed else b"\0\xff"
                self.assertEqual(items, [expected, {"event": "done"}])
                sent, = transport.requests
                self.assertEqual((sent.method, sent.url, dict(sent.headers), json.loads(sent.body)),
                    ("POST", "https://api.typecast.ai/v1/text-to-speech" + str(fixture["path"]),
                     {"X-API-KEY": "fixture", "Content-Type": "application/json", "Accept": fixture["accept"]}, fixture["body"]))
                self.assertEqual(body.closes, 1)

    async def test_utf8_timestamp_json_every_byte_split(self) -> None:
        wire = json.dumps(RESPONSE, ensure_ascii=False).encode()
        for split in range(len(wire) + 1):
            body = Body([wire[:split], b"", wire[split:]])
            async with synthesize({**REQUEST, "timestamp_granularity": ["word", "character"]}, auth=AUTH,
                                  transport=Transport(body, content_type="Application/JSON; charset=utf-8"),
                                  max_timestamp_response_bytes=len(wire)) as stream:
                self.assertEqual(await anext(stream), {"correlation": "chunk", "audio": b"\0\xff", "duration_ms": 500, "timestamps": tuple(MARKS)})
                self.assertEqual(body.closes, 1)
                self.assertEqual([item async for item in stream], [{"event": "done"}])

    async def test_timestamp_queries_preserve_proxy_and_remove_stale_filters(self) -> None:
        cases: list[tuple[object, str, tuple[TypecastEnvelopeTimestampsItem, ...]]] = [
            ("word", "&granularity=word", tuple(MARKS[:1])), ("character", "&granularity=char", tuple(MARKS[1:])),
            (UserList(["word", "character"]), "", tuple(MARKS)), (("word", "word"), "&granularity=word", tuple(MARKS[:1])),
        ]
        for selection, query, marks in cases:
            body = Body([json.dumps(RESPONSE).encode()])
            transport = Transport(body, content_type=None)
            async with synthesize(cast(TtsRequest, {**REQUEST, "timestamp_granularity": selection}), auth=AUTH, transport=transport,
                                  base_url="https://example.test/proxy/?tenant=one&granularity=old&granularity=stale&empty=") as stream:
                self.assertEqual([item async for item in stream], [{"correlation": "chunk", "audio": b"\0\xff", "duration_ms": 500, "timestamps": marks}, {"event": "done"}])
            self.assertEqual(transport.requests[0].url, "https://example.test/proxy/v1/text-to-speech/with-timestamps?tenant=one&empty=" + query)

    async def test_strict_timestamp_wire_errors_never_emit_done(self) -> None:
        cases: list[tuple[object, str]] = [
            ([], "Invalid Typecast timestamp response"), ({**RESPONSE, "audio_duration": True}, "Invalid Typecast timestamp audio metadata"),
            ({**RESPONSE, "audio_duration": -1}, "Invalid Typecast timestamp audio metadata"),
            ({**RESPONSE, "audio_duration": 1e308}, "Invalid Typecast timestamp audio metadata"),
            ({**RESPONSE, "audio_duration": 10 ** 1000}, "Invalid Typecast timestamp audio metadata"),
            ({**RESPONSE, "audio_format": "mp3"}, "Invalid Typecast timestamp audio metadata"),
            ({**RESPONSE, "audio": ""}, "Invalid Typecast base64 audio"),
            ({**RESPONSE, "audio": "AP9="}, "Invalid Typecast base64 audio"),
            ({**RESPONSE, "audio": "AP8=\n"}, "Invalid Typecast base64 audio"),
            ({**RESPONSE, "audio": "é"}, "Invalid Typecast base64 audio"),
            ({**RESPONSE, "audio": 123}, "Invalid Typecast base64 audio"),
            ({key: value for key, value in RESPONSE.items() if key != "characters"}, "Typecast omitted characters alignment"),
            ({**RESPONSE, "words": None}, "Typecast omitted words alignment"),
            ({**RESPONSE, "words": [None]}, "Invalid Typecast alignment segment"),
        ]
        for interval in [{"text": "hi", "start": True, "end": 1}, {"text": "hi", "start": 1, "end": 0},
                         {"text": "hi", "start": -1, "end": 0}, {"text": "hi", "start": 0, "end": 1e308},
                         {"text": 0, "start": 0, "end": 1}, {"text": "hi", "start": 0},
                         {"text": "hi", "start": 1e-323, "end": 5e-324}]:
            # Unrequested tracks still have to be well formed.
            cases.append(({**RESPONSE, "characters": [interval]}, "Invalid Typecast alignment interval"))
        for value, message in cases:
            with self.subTest(value=value):
                body = Body([json.dumps(value).encode()])
                items: list[SynthesisItem] = []
                with self.assertRaises(TypeError) as caught:
                    async with synthesize({**REQUEST, "timestamp_granularity": "word"}, auth=AUTH, transport=Transport(body, content_type="application/json")) as stream:
                        async for item in stream:
                            items.append(item)
                self.assertEqual((str(caught.exception), items, body.closes), (message, [], 1))

    async def test_invalid_json_utf8_and_byte_limit(self) -> None:
        for wire in [b"{", b"null", b"NaN", b"\xff", b'{"audio_duration":Infinity}', b"[" * 1100]:
            body = Body([wire])
            with self.assertRaises(TypeError) as caught:
                async with synthesize({**REQUEST, "timestamp_granularity": "word"}, auth=AUTH, transport=Transport(body, content_type="application/json")) as stream:
                    await anext(stream)
            self.assertEqual((str(caught.exception), body.closes), ("Invalid Typecast timestamp response", 1))
        wire = json.dumps(RESPONSE).encode()
        body = Body([wire, b"unread"])
        with self.assertRaises(TypeError) as caught:
            async with synthesize({**REQUEST, "timestamp_granularity": "word"}, auth=AUTH, transport=Transport(body, content_type="application/json"), max_timestamp_response_bytes=len(wire)-1) as stream:
                await anext(stream)
        self.assertEqual((str(caught.exception), body.reads, body.closes), ("Typecast timestamp response exceeds max_timestamp_response_bytes", 1, 1))

    async def test_unrequested_null_alignment_and_bom(self) -> None:
        body = Body([b"\xef\xbb\xbf" + json.dumps({**RESPONSE, "characters": None}).encode()])
        async with synthesize({**REQUEST, "timestamp_granularity": "word"}, auth=AUTH, transport=Transport(body, content_type="application/json")) as stream:
            self.assertEqual([item async for item in stream], [{"correlation": "chunk", "audio": b"\0\xff", "duration_ms": 500, "timestamps": tuple(MARKS[:1])}, {"event": "done"}])

    async def test_first_chunk_unread_exit_and_uncapped_raw_audio(self) -> None:
        for read in [False, True]:
            body = Body([b"", b"RIFF", b"unread"], stall=True)
            async with synthesize(REQUEST, auth=AUTH, transport=Transport(body), max_timestamp_response_bytes=1) as stream:
                if read:
                    self.assertEqual(await anext(stream), b"RIFF")
                self.assertEqual((body.reads, body.closes), (2 if read else 0, 0))
            self.assertEqual(body.closes, 1)
            with self.assertRaises(StopAsyncIteration):
                await anext(stream)

    async def test_non_success_and_media_errors_close_unread_body(self) -> None:
        for status in [199, 301, 401, 429, 500]:
            body = Body([b"private response"])
            with self.assertRaises(TypecastError) as caught:
                async with synthesize(REQUEST, auth=AUTH, transport=Transport(body, status=status)) as stream:
                    await anext(stream)
            self.assertEqual((caught.exception.status, str(caught.exception), body.reads, body.closes), (status, f"Typecast returned HTTP {status}", 0, 1))
        for media in ["text/html", "application/json", "audio/mpeg"]:
            body = Body([b"unread"])
            with self.assertRaises(TypeError) as caught:
                async with synthesize(REQUEST, auth=AUTH, transport=Transport(body, content_type=media)) as stream:
                    await anext(stream)
            self.assertEqual((str(caught.exception), body.reads, body.closes), ("Typecast returned an unexpected content type", 0, 1))

    async def test_empty_audio_and_read_failure(self) -> None:
        body = Body([b"", b""])
        with self.assertRaises(TypeError) as caught:
            async with synthesize(REQUEST, auth=AUTH, transport=Transport(body)) as stream:
                await anext(stream)
        self.assertEqual((str(caught.exception), body.closes), ("Typecast returned no audio", 1))
        failure = ConnectionResetError("read failed")
        body = Body([b"first", failure], close_error=OSError("close failed"))
        with self.assertRaises(ConnectionResetError) as caught:
            async with synthesize(REQUEST, auth=AUTH, transport=Transport(body)) as stream:
                self.assertEqual(await anext(stream), b"first")
                await anext(stream)
        self.assertIs(caught.exception, failure)
        self.assertEqual(body.closes, 1)

    async def test_cancel_pending_body_read(self) -> None:
        body = Body([], stall=True)
        async def consume() -> None:
            async with synthesize(REQUEST, auth=AUTH, transport=Transport(body)) as stream:
                await anext(stream)
        task = asyncio.create_task(consume())
        async with asyncio.timeout(2):
            await body.reading.wait()
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
        self.assertEqual(body.closes, 1)

    async def test_cancel_after_timestamp_envelope_does_not_emit_done(self) -> None:
        body = Body([json.dumps(RESPONSE).encode()])
        items: list[SynthesisItem] = []
        async def consume() -> None:
            async with synthesize({**REQUEST, "timestamp_granularity": "word"}, auth=AUTH, transport=Transport(body, content_type="application/json")) as stream:
                items.append(await anext(stream))
                task = asyncio.current_task()
                assert task is not None
                task.cancel()
                items.append(await anext(stream))
        with self.assertRaises(asyncio.CancelledError):
            await asyncio.create_task(consume())
        self.assertEqual(items, [{"correlation": "chunk", "audio": b"\0\xff", "duration_ms": 500, "timestamps": tuple(MARKS[:1])}])
        self.assertEqual(body.closes, 1)

    async def test_cancel_before_headers(self) -> None:
        started, closed = asyncio.Event(), asyncio.Event()
        class PendingTransport:
            async def send(self, request: HttpRequest) -> HttpResponse:
                started.set()
                try:
                    return await asyncio.Future[HttpResponse]()
                finally:
                    closed.set()
        async def consume() -> None:
            async with synthesize(REQUEST, auth=AUTH, transport=PendingTransport()) as stream:
                await anext(stream)
        task = asyncio.create_task(consume())
        async with asyncio.timeout(2):
            await started.wait()
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
        self.assertTrue(closed.is_set())

    async def test_deadline_covers_headers_body_and_consumer_idle(self) -> None:
        class PendingTransport:
            async def send(self, request: HttpRequest) -> HttpResponse:
                return await asyncio.Future[HttpResponse]()
        with self.assertRaises(TimeoutError):
            async with synthesize(REQUEST, auth=AUTH, transport=PendingTransport(), timeout_ms=20) as stream:
                await anext(stream)
        for idle in [False, True]:
            body = Body([b"first"], stall=True)
            with self.assertRaises(TimeoutError):
                async with synthesize(REQUEST, auth=AUTH, transport=Transport(body), timeout_ms=20) as stream:
                    self.assertEqual(await anext(stream), b"first")
                    if idle:
                        await asyncio.Future[None]()
                    else:
                        await anext(stream)
            self.assertEqual(body.closes, 1)

    async def test_boundary_options_and_auth_precedence(self) -> None:
        with patch.dict(os.environ, {"TYPECAST_API_KEY": "fallback", "SPEECHSWITCH_TYPECAST_API_KEY": "scoped"}, clear=True):
            for auth, key in [(None, "scoped"), ({"typecast": {"api_key": "explicit"}}, "explicit")]:
                transport = Transport(Body([b"audio"]))
                async with synthesize(REQUEST, transport=transport, auth=cast(Auth | None, auth)) as stream:
                    self.assertEqual([item async for item in stream], [b"audio", {"event": "done"}])
                self.assertEqual(transport.requests[0].headers["X-API-KEY"], key)
            with self.assertRaises(TypeError) as caught:
                async with synthesize(REQUEST, transport=Transport(Body([])), auth={"typecast": {"api_key": ""}}):
                    self.fail("Empty explicit auth must not fall back")
            self.assertEqual(str(caught.exception), "Missing auth.typecast.apiKey configuration")
        for key in ["a\nb", "bad key", "é"]:
            with self.assertRaises(TypeError) as caught:
                async with synthesize(REQUEST, auth={"typecast": {"api_key": key}}, transport=Transport(Body([]))):
                    self.fail("Invalid header key")
            self.assertEqual(str(caught.exception), "Typecast API key must contain only visible ASCII characters")
        for base in ["ftp://example.test", "https://u:p@example.test", "https://example.test/#x", "https://example.test:bad", "https://example.test/%xx", "https://example.test/ bad"]:
            transport = Transport(Body([]))
            with self.assertRaises(TypeError) as caught:
                async with synthesize(REQUEST, auth=AUTH, transport=transport, base_url=base):
                    self.fail("Invalid endpoint")
            self.assertEqual(str(caught.exception), "Typecast endpoint must be HTTP(S) without credentials, fragments or invalid escapes")
            self.assertEqual(transport.requests, [])
        for timeout in [-1, True, 0.5, 2147483648]:
            with self.assertRaises(TypeError) as caught:
                async with synthesize(REQUEST, auth=AUTH, transport=Transport(Body([])), timeout_ms=cast(int, timeout)):
                    self.fail("Invalid timeout")
            self.assertEqual(str(caught.exception), "Typecast timeout_ms must be an integer between 0 and 2147483647")
        transport = Transport(Body([]))
        with self.assertRaises(TimeoutError) as caught:
            async with synthesize(REQUEST, auth=AUTH, transport=transport, timeout_ms=0):
                self.fail("Immediate deadline")
        self.assertEqual((str(caught.exception), transport.requests), ("Typecast synthesis deadline expired", []))
        for limit in [0, -1, True, 1.5, 9007199254740992]:
            with self.assertRaises(TypeError) as caught:
                async with synthesize(REQUEST, auth=AUTH, transport=Transport(Body([])), max_timestamp_response_bytes=cast(int, limit)):
                    self.fail("Invalid limit")
            self.assertEqual(str(caught.exception), "Typecast max_timestamp_response_bytes must be a positive safe integer")

    async def test_protocol_overrides(self) -> None:
        requests: list[TtsRequest] = [{**REQUEST, "timestamp_granularity": []}, {**REQUEST, "volume_scale": 0},
                                     {**REQUEST, "output": {"format": "wav", "sample_rate_hz": 44100}}]
        for request in requests:
            with self.assertRaises(TypeError) as caught:
                async with synthesize(request, auth=AUTH, transport=Transport(Body([])), protocol="stream"):
                    self.fail("Incompatible stream override")
            self.assertEqual(str(caught.exception), "Typecast composition, timestamps, volume scaling and 44.1 kHz WAV require ordinary synthesis")
        with self.assertRaises(TypeError) as caught:
            async with synthesize({**REQUEST, "output": {"format": "wav", "sample_rate_hz": 32000}}, auth=AUTH, transport=Transport(Body([])), protocol="http"):
                self.fail("Incompatible ordinary override")
        self.assertEqual(str(caught.exception), "Typecast ordinary WAV uses 44100 Hz, not 32000 Hz")
        with self.assertRaises(TypeError) as caught:
            async with synthesize(REQUEST, auth=AUTH, transport=Transport(Body([])), protocol=cast(Literal["http"], "socket")):
                self.fail("Unknown protocol")
        self.assertEqual(str(caught.exception), "Typecast protocol must be stream or http")
        transport = Transport(Body([b"audio"]))
        async with synthesize(REQUEST, auth=AUTH, transport=transport, protocol="http") as stream:
            self.assertEqual([item async for item in stream], [b"audio", {"event": "done"}])
        self.assertEqual(transport.requests[0].url, "https://api.typecast.ai/v1/text-to-speech")

    async def test_generated_schema_checks_precede_network(self) -> None:
        for fields in [{"emotion": "auto", "emotion_intensity": 1}, {"model": "ssfm-v21", "emotion": "auto"},
                       {"model": "ssfm-v21", "language": "hi"}, {"volume_scale": 0, "target_loudness_lufs": 0},
                       {"text": ""}, {"text": "😀" * 2001}, {"text": ["hi"]}, {"speed": 0}, {"pitch_semitones": 0.5},
                       {"random_seed": -1}, {"random_seed": 4294967296}, {"voice": "voice"}, {"reference_audio": b"audio"},
                       {"output": {"format": "mp3", "bit_rate_bps": 128000}}, {"output": {"format": "pcm"}}]:
            transport = Transport(Body([]))
            with self.assertRaises(TypeError) as caught:
                async with synthesize(cast(TtsRequest, {**REQUEST, **fields}), auth=AUTH, transport=transport):
                    self.fail("Invalid request")
            self.assertEqual((str(caught.exception), transport.requests), ("Invalid typecast TTS request", []))

    async def test_composition_totals_and_conversion_underflow(self) -> None:
        speech = {"kind": "speech", "model": "ssfm-v21", "text": "Hi", "voice": "tc_voice"}
        for segments in [[{"kind": "pause", "pause_ms": 1}],
                         [{**speech, "text": "😀" * 1001}, {**speech, "text": "x" * 1000}],
                         [speech, *[{"kind": "pause", "pause_ms": 10000}] * 7]]:
            transport = Transport(Body([]))
            with self.assertRaises(TypeError) as caught:
                async with synthesize(cast(TtsRequest, {"segments": segments}), auth=AUTH, transport=transport):
                    self.fail("Invalid composition")
            self.assertEqual((str(caught.exception), transport.requests), ("Typecast composition requires speech, at most 2000 total text code points and at most 60000 ms total pauses", []))
        with self.assertRaises(TypeError) as caught:
            async with synthesize(cast(TtsRequest, {"segments": [speech, {"kind": "pause", "pause_ms": 5e-324}]}), auth=AUTH, transport=Transport(Body([]))):
                self.fail("Underflowed pause")
        self.assertEqual(str(caught.exception), "Typecast pause cannot be represented as positive seconds")
        # Explicit surrogate pairs count the same as scalar code points in TypeScript.
        transport = Transport(Body([b"audio"]))
        async with synthesize(cast(TtsRequest, {"segments": [{**speech, "text": "\ud83d\ude00" * 1000}, {**speech, "text": "😀" * 1000}, *[{"kind": "pause", "pause_ms": 10000}] * 6]}), auth=AUTH, transport=transport) as stream:
            self.assertEqual([item async for item in stream], [b"audio", {"event": "done"}])
        self.assertEqual(len(transport.requests), 1)

    async def test_volume_rounding_matches_typescript(self) -> None:
        for scale, expected in [(0, 0), (0.005, 1), (math.nextafter(0.005, 0), 0), (0.025, 3), (2, 200)]:
            transport = Transport(Body([b"audio"]))
            async with synthesize({**REQUEST, "volume_scale": scale}, auth=AUTH, transport=transport) as stream:
                self.assertEqual([item async for item in stream], [b"audio", {"event": "done"}])
            self.assertEqual(json.loads(transport.requests[0].body)["output"]["volume"], expected)

    async def test_native_integer_fields_from_validated_integral_floats(self) -> None:
        transport = Transport(Body([b"audio"]))
        async with synthesize({**REQUEST, "random_seed": 42.0, "pitch_semitones": -2.0}, auth=AUTH, transport=transport) as stream:
            self.assertEqual([item async for item in stream], [b"audio", {"event": "done"}])
        payload = json.loads(transport.requests[0].body)
        self.assertEqual((payload["seed"], payload["output"]["audio_pitch"]), (42, -2))
        self.assertEqual((type(payload["seed"]), type(payload["output"]["audio_pitch"])), (int, int))

class TypecastTypes(unittest.TestCase):
    def test_smart_emotion_preserves_context_and_zero_loudness(self) -> None:
        request: TtsRequest = {"model": "ssfm-v30", "text": "Hello", "voice": "uc_voice", "emotion": "auto", "context_before": {"text": ""}, "random_seed": 0, "target_loudness_lufs": 0}
        self.assertEqual(request, {"model": "ssfm-v30", "text": "Hello", "voice": "uc_voice", "emotion": "auto", "context_before": {"text": ""}, "random_seed": 0, "target_loudness_lufs": 0})
