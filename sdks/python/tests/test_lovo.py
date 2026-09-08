import asyncio
import copy
import json
import unittest
from collections.abc import AsyncIterator, Mapping, Sequence
from pathlib import Path
from typing import Literal, cast
from unittest.mock import patch

from speechswitch.clients import lovo as wire
from speechswitch.generated.auth import Auth
from speechswitch.generated.lovo import TtsRequest
from speechswitch.generated.validators.lovo import validate_request
from speechswitch.http import HttpRequest, HttpResponse
from speechswitch.providers.lovo import LovoError, synthesize

FIXTURE: dict[str, dict[str, object]] = json.loads((Path(__file__).parents[2] / "fixtures/lovo.json").read_text())
AUTH: Auth = {"lovo": {"api_key": "test-key"}}


class Body:
    def __init__(self, chunks: Sequence[bytes | Exception], stall: bool = False) -> None:
        self.chunks, self.stall = list(chunks), stall
        self.reads = self.closes = 0
        self.waiting = asyncio.Event()
    def __aiter__(self) -> AsyncIterator[bytes]:
        return self
    async def __anext__(self) -> bytes:
        self.reads += 1
        if self.chunks:
            item = self.chunks.pop(0)
            if isinstance(item, Exception):
                raise item
            return item
        if self.stall:
            self.waiting.set()
            future: asyncio.Future[None] = asyncio.Future()
            await future
        raise StopAsyncIteration
    async def aclose(self) -> None:
        self.closes += 1


class Transport:
    def __init__(self, responses: list[HttpResponse]) -> None:
        self.responses = list(responses)
        self.requests: list[HttpRequest] = []
    async def send(self, request: HttpRequest) -> HttpResponse:
        self.requests.append(request)
        return self.responses.pop(0)


def response(value: object, status: int = 201) -> HttpResponse:
    data = json.dumps(value).encode()
    return HttpResponse(status, {}, Body([data[:7], data[7:]]))


def job(**changes: object) -> dict[str, object]:
    return {**FIXTURE["job"], "data": [copy.deepcopy(FIXTURE["output"])], **changes}


def request() -> TtsRequest:
    return {"text": "Hello", "voice": "existing-speaker"}


def envelope(audio: bytes, output: int = 0, asset: int = 0) -> dict[str, object]:
    return {"correlation": "ordered", "correlation_id": f"job/1:{output}:{asset}",
            "input_group_id": f"job/1:{output}", "audio": audio, "timestamps": ()}


class LovoTests(unittest.IsolatedAsyncioTestCase):
    async def test_shared_fixture_and_early_bytes_without_asset_auth(self) -> None:
        body = Body([b"\x01"], stall=True)
        metadata = response(job())
        transport = Transport([metadata, HttpResponse(200, {}, body)])
        r: TtsRequest = {**request(), "speed": 0.5, "voice_style": "style"}
        async with synthesize(r, auth=AUTH, transport=transport, base_url="https://proxy.invalid/root/?tenant=one") as audio:
            self.assertEqual(await anext(audio), envelope(b"\x01"))
            self.assertEqual(body.reads, 1)
            self.assertEqual(cast(Body, metadata.body).closes, 1)
        self.assertEqual(body.closes, 1)
        first, asset = transport.requests
        self.assertEqual(first.url, "https://proxy.invalid/root/api/v1/tts/sync?tenant=one")
        self.assertEqual(first.method, "POST")
        self.assertEqual(first.headers, {"X-API-KEY": "test-key", "content-type": "application/json"})
        self.assertEqual(json.loads(first.body), FIXTURE["wire"])
        self.assertEqual(asset, HttpRequest("GET", "https://audio.invalid/result.wav", {}, b""))
        self.assertEqual(FIXTURE["envelope"], {"correlation": "ordered", "correlationId": "job/1:0:0", "inputGroupId": "job/1:0", "timestamps": []})

    async def test_both_modes_poll_and_encode_job_ids(self) -> None:
        modes: tuple[Literal["sync", "async"], ...] = ("sync", "async")
        for mode in modes:
            responses = [
                response(job(status="in_progress", data=[], callbackUrls=[])),
                response(job(status="in_progress", data=[], callbackUrls=[]), 200),
                response(job(callbackUrls=[]), 200),
                HttpResponse(200, {}, Body([b"", b"\x01\x02"])),
            ]
            transport = Transport(responses)
            async with synthesize(request(), auth=AUTH, transport=transport, mode=mode, poll_interval_ms=0) as audio:
                self.assertEqual([v async for v in audio], [envelope(b"\x01\x02")])
            self.assertEqual([r.url for r in transport.requests], [
                "https://api.genny.lovo.ai/api/v1/tts" + ("/sync" if mode == "sync" else ""),
                "https://api.genny.lovo.ai/api/v1/tts/job%2F1", "https://api.genny.lovo.ai/api/v1/tts/job%2F1",
                "https://audio.invalid/result.wav"])
            self.assertEqual(json.loads(transport.requests[0].body), {"text": "Hello", "speaker": "existing-speaker", "speed": 1})
            self.assertEqual(transport.requests[1].headers, {"X-API-KEY": "test-key"})
            self.assertEqual([cast(Body, r.body).closes for r in responses], [1, 1, 1, 1])

    async def test_done_async_create_requires_retrieval(self) -> None:
        transport = Transport([response(job(data="untyped extra", callbackUrls=[])), response(job(callbackUrls=[]), 200), HttpResponse(200, {}, Body([b"a"]))])
        async with synthesize(request(), auth=AUTH, transport=transport, mode="async") as audio:
            self.assertEqual([v async for v in audio], [envelope(b"a")])
        self.assertEqual([r.method for r in transport.requests], ["POST", "GET", "GET"])

    async def test_multiple_files_keep_distinct_identity(self) -> None:
        urls = ["https://audio.invalid/1", "https://audio.invalid/2", "https://audio.invalid/3"]
        outputs = [{**FIXTURE["output"], "urls": urls[:2]}, {**FIXTURE["output"], "urls": urls[2:]}]
        transport = Transport([response(job(data=outputs)), *[HttpResponse(200, {}, Body([bytes([i])])) for i in range(3)]])
        async with synthesize(request(), auth=AUTH, transport=transport) as audio:
            self.assertEqual([v async for v in audio], [envelope(b"\0"), envelope(b"\1", 0, 1), envelope(b"\2", 1, 0)])
        self.assertEqual([r.url for r in transport.requests[1:]], urls)
        self.assertEqual([r.headers for r in transport.requests[1:]], [{}, {}, {}])

    async def test_invalid_results_are_exact_and_precede_all_downloads(self) -> None:
        empty_urls: list[str] = []
        cases = [
            (job(data=[]), "LOVO completed without audio outputs"),
            (job(data=[{**FIXTURE["output"], "status": "pending"}]), "LOVO completed without usable audio URLs"),
            (job(data=[{**FIXTURE["output"], "urls": empty_urls}]), "LOVO completed without usable audio URLs"),
            (job(id=".."), "LOVO returned an invalid job ID"),
            (job(type="dubbing"), "LOVO returned a non-TTS job"),
            (job(data=[{**FIXTURE["output"], "urls": [3]}]), "Invalid LOVO sync-tts response"),
            (job(data=[{**FIXTURE["output"], "emphasis": [{"position": 0, "value": 0.1}]}]), "Invalid LOVO sync-tts response"),
        ]
        for value, message in cases:
            transport = Transport([response(value)])
            with self.assertRaises(TypeError) as error:
                async with synthesize(request(), auth=AUTH, transport=transport) as audio:
                    await anext(audio)
            self.assertEqual(str(error.exception), message)
            self.assertEqual(len(transport.requests), 1)

    async def test_errors_preserve_status_code_job_and_retry(self) -> None:
        for field in ("error", "output"):
            failure = {"code": "synthesis_failed", "message": "Voice unavailable"}
            value = job(error=failure) if field == "error" else job(data=[FIXTURE["output"], {**FIXTURE["output"], "error": failure}])
            transport = Transport([response(value)])
            with self.assertRaises(LovoError) as caught:
                async with synthesize(request(), auth=AUTH, transport=transport) as audio:
                    await anext(audio)
            e = caught.exception
            self.assertEqual((str(e), e.status_code, e.code, e.job_id, e.retry_after), ("Voice unavailable", None, "synthesis_failed", "job/1", None))
            self.assertEqual(len(transport.requests), 1)
        for asset in (False, True):
            body = Body([b"Rate limited"])
            failure = HttpResponse(429, {"Retry-After": "5"}, body)
            transport = Transport([response(job()), failure] if asset else [failure])
            with self.assertRaises(LovoError) as caught:
                async with synthesize(request(), auth=AUTH, transport=transport) as audio:
                    await anext(audio)
            e = caught.exception
            self.assertEqual((str(e), e.status_code, e.code, e.job_id, e.retry_after),
                             ("Rate limited", 429, None, "job/1" if asset else None, "5"))
            self.assertEqual(body.closes, 1)

    async def test_unsafe_assets_and_late_invalid_outputs_never_fetch(self) -> None:
        for url, expected in [
            ("http://elsewhere.invalid/a", "LOVO returned an unsafe audio URL"),
            ("https://u:p@audio.invalid/a", "LOVO URL must be HTTP(S) without credentials, fragments or invalid escapes"),
            ("file:///tmp/a", "LOVO URL must be HTTP(S) without credentials, fragments or invalid escapes"),
            ("https://audio.invalid/%zz", "LOVO URL must be HTTP(S) without credentials, fragments or invalid escapes"),
        ]:
            transport = Transport([response(job(data=[FIXTURE["output"], {**FIXTURE["output"], "urls": [url]}]))])
            with self.assertRaises(TypeError) as caught:
                async with synthesize(request(), auth=AUTH, transport=transport) as audio:
                    await anext(audio)
            self.assertEqual(str(caught.exception), expected)
            self.assertEqual(len(transport.requests), 1)
        transport = Transport([response(job(data=[{**FIXTURE["output"], "urls": ["http://localhost:4567/a"]}])), HttpResponse(200, {}, Body([b"a"]))])
        async with synthesize(request(), auth=AUTH, transport=transport, base_url="http://localhost:4567") as audio:
            self.assertEqual([v async for v in audio], [envelope(b"a")])
        self.assertEqual(transport.requests[1].headers, {})

    async def test_metadata_body_bounds_invalid_json_and_redirects(self) -> None:
        for status, chunks, limit, kind, message in [
            (201, [b"{"], 1024, TypeError, "LOVO returned invalid JSON"),
            (201, [b"NaN"], 1024, TypeError, "LOVO returned invalid JSON"),
            (201, [b"123", b"4"], 3, TypeError, "LOVO response exceeds max_json_bytes"),
            (500, [b"1234"], 3, TypeError, "LOVO response exceeds max_json_bytes"),
            (302, [], 1024, LovoError, "LOVO returned HTTP 302; expected 201"),
        ]:
            body = Body(chunks)
            transport = Transport([HttpResponse(status, {"Location": "https://elsewhere.invalid"}, body)])
            with self.assertRaises(kind) as error:
                async with synthesize(request(), auth=AUTH, transport=transport, max_json_bytes=limit) as audio:
                    await anext(audio)
            self.assertEqual(str(error.exception), message)
            self.assertEqual(body.closes, 1)
            self.assertEqual(len(transport.requests), 1)

    async def test_cancel_pending_metadata_and_audio_reads(self) -> None:
        for asset in (False, True):
            body = Body([], stall=True)
            stalled = HttpResponse(200 if asset else 201, {}, body)
            transport = Transport([response(job()), stalled] if asset else [stalled])
            async def consume() -> None:
                async with synthesize(request(), auth=AUTH, transport=transport) as audio:
                    await anext(audio)
            task = asyncio.create_task(consume())
            await asyncio.wait_for(body.waiting.wait(), 1)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            self.assertEqual(body.closes, 1)
            self.assertEqual([r.method for r in transport.requests], ["POST", "GET"] if asset else ["POST"])

    async def test_deadline_interrupts_polling_without_remote_cancellation(self) -> None:
        pending = response(job(status="in_progress", data=[]))
        transport = Transport([pending])
        with self.assertRaises(TimeoutError):
            async with synthesize(request(), auth=AUTH, transport=transport, poll_interval_ms=1000, timeout_ms=10) as audio:
                await anext(audio)
        self.assertEqual(len(transport.requests), 1)
        self.assertEqual(cast(Body, pending.body).closes, 1)

    async def test_generated_validation_precedes_io_and_counts_unicode_points(self) -> None:
        for change in [{"model": "pro"}, {"output": {"format": "mp3"}}, {"text": ""}, {"text": "😀" * 501}, {"speed": False}, {"speed": 3.01}]:
            transport = Transport([])
            r = cast(TtsRequest, {**request(), **change})
            with self.assertRaises(TypeError) as expected:
                validate_request(r)
            with self.assertRaises(TypeError) as error:
                async with synthesize(r, transport=transport):
                    self.fail("invalid request accepted")
            self.assertEqual(error.exception.args, expected.exception.args)
            self.assertEqual(transport.requests, [])
        for text in ["😀" * 500, "\ud83d\ude00" * 500]:
            self.assertTrue(wire.is_create_speech_input({"text": text, "speaker": "v"}))
        self.assertFalse(wire.is_create_speech_input({"text": "😀" * 501, "speaker": "v"}))

    async def test_environment_and_explicit_empty_key(self) -> None:
        with patch.dict("os.environ", {"LOVO_API_KEY": "native", "SPEECHSWITCH_LOVO_API_KEY": "scoped"}):
            for auth, expected in [(None, "scoped"), (AUTH, "test-key")]:
                transport = Transport([response(job()), HttpResponse(200, {}, Body([]))])
                async with synthesize(request(), auth=auth, transport=transport) as audio:
                    self.assertEqual([v async for v in audio], [])
                self.assertEqual(transport.requests[0].headers["X-API-KEY"], expected)
            with self.assertRaises(TypeError) as error:
                async with synthesize(request(), auth={"lovo": {"api_key": ""}}, transport=Transport([])):
                    self.fail("empty credential accepted")
            self.assertEqual(str(error.exception), "Missing auth.lovo.apiKey configuration")

    async def test_changed_poll_and_inconsistent_done_creation_fail(self) -> None:
        for mode, initial, polled, expected in [
            ("sync", job(status="in_progress"), job(id="other", callbackUrls=[]), "LOVO returned a different job ID while polling"),
            ("async", job(callbackUrls=[]), job(status="in_progress", callbackUrls=[]), "LOVO returned an inconsistent completed job"),
        ]:
            transport = Transport([response(initial), response(polled, 200)])
            with self.assertRaises(TypeError) as error:
                async with synthesize(request(), auth=AUTH, transport=transport, mode=cast(Literal["sync", "async"], mode), poll_interval_ms=0) as audio:
                    await anext(audio)
            self.assertEqual(str(error.exception), expected)
            self.assertEqual(len(transport.requests), 2)


if __name__ == "__main__":
    unittest.main()
