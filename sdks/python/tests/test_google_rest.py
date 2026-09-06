import asyncio
import json
import math
from collections.abc import AsyncIterator
from types import MappingProxyType
from typing import cast
import unittest

from speechswitch.clients import google_rest as stable, google_rest_beta as beta
from speechswitch.http import HttpRequest, HttpResponse


class Body:
    def __init__(self) -> None:
        self.reads = 0
        self.closed = False

    def __aiter__(self) -> AsyncIterator[bytes]:
        return self

    async def __anext__(self) -> bytes:
        self.reads += 1
        raise StopAsyncIteration

    async def aclose(self) -> None:
        self.closed = True


class Transport:
    def __init__(self) -> None:
        self.requests: list[HttpRequest] = []
        self.body = Body()
        self.response = HttpResponse(200, {}, self.body)

    async def send(self, request: HttpRequest) -> HttpResponse:
        self.requests.append(request)
        return self.response


class GoogleRestTests(unittest.IsolatedAsyncioTestCase):
    async def test_generated_requests_preserve_wire_fields_false_zero_and_custom_voices(self) -> None:
        for client, version in ((stable, "v1"), (beta, "v1beta1")):
            transport = Transport()
            headers = {"authorization": "Bearer test", "x-goog-user-project": "quota", "Content-Type": "bad"}
            response = await client.synthesize_speech({
                "advancedVoiceOptions": {"enableTextnorm": False, "safetySettings": {"settings": (
                    {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_ONLY_HIGH"},
                )}},
                "audioConfig": {"audioEncoding": "MP3", "volumeGainDb": 0, "effectsProfileId": ()},
                "input": {"text": "Acme 日本", "customPronunciations": {"pronunciations": (
                    {"phrase": "Acme", "pronunciation": "ˈækmi", "phoneticEncoding": "PHONETIC_ENCODING_IPA"},
                )}},
                "voice": {"languageCode": "en-US", "voiceClone": {"voiceCloningKey": "existing"}},
            }, base_url="https://proxy.invalid/google/?tenant=one&blank=", headers=headers, transport=transport)
            self.assertIs(response, transport.response)
            self.assertEqual((transport.body.reads, transport.body.closed), (0, False))
            self.assertEqual(len(transport.requests), 1)
            request = transport.requests[0]
            self.assertEqual((request.method, request.url, dict(request.headers)), (
                "POST", f"https://proxy.invalid/google/{version}/text:synthesize?tenant=one&blank=",
                {"authorization": "Bearer test", "x-goog-user-project": "quota", "content-type": "application/json"},
            ))
            self.assertEqual(json.loads(request.body), {
                "advancedVoiceOptions": {"enableTextnorm": False, "safetySettings": {"settings": [
                    {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_ONLY_HIGH"},
                ]}},
                "audioConfig": {"audioEncoding": "MP3", "volumeGainDb": 0, "effectsProfileId": []},
                "input": {"text": "Acme 日本", "customPronunciations": {"pronunciations": [
                    {"phrase": "Acme", "pronunciation": "ˈækmi", "phoneticEncoding": "PHONETIC_ENCODING_IPA"},
                ]}},
                "voice": {"languageCode": "en-US", "voiceClone": {"voiceCloningKey": "existing"}},
            })
            self.assertEqual(headers["Content-Type"], "bad")
            await response.body.aclose()

    async def test_query_replacement_and_no_response_buffering_even_on_error(self) -> None:
        for client, version in ((stable, "v1"), (beta, "v1beta1")):
            transport = Transport()
            transport.response = HttpResponse(429, {"retry-after": "1"}, transport.body)
            response = await client.list_voices({"languageCode": "en US"},
                base_url="https://proxy.invalid/g/?tenant=a&languageCode=old&tenant=b&languageCode=older",
                headers=MappingProxyType({"x-goog-api-key": "test"}), transport=transport)
            self.assertEqual(transport.requests, [HttpRequest("GET",
                f"https://proxy.invalid/g/{version}/voices?tenant=a&tenant=b&languageCode=en+US",
                {"x-goog-api-key": "test"}, b"")])
            self.assertIs(response, transport.response)
            self.assertEqual((transport.body.reads, transport.body.closed), (0, False))
            await response.body.aclose()

    async def test_runtime_wire_validation_happens_before_transport(self) -> None:
        cases: list[object] = [
            {"input": None}, {"audioConfig": {"audioEncoding": "FLAC"}},
            {"audioConfig": {"sampleRateHertz": True}}, {"audioConfig": {"sampleRateHertz": 1.5}},
            {"audioConfig": {"volumeGainDb": math.nan}}, {"audioConfig": {"volumeGainDb": math.inf}},
            {"audioConfig": {"effectsProfileId": "not an array"}}, {"input": {"text": False}},
            {"advancedVoiceOptions": {"enableTextnorm": None}},
            {"voice": {"multiSpeakerVoiceConfig": {"speakerVoiceConfigs": [{"speakerAlias": None}]}}},
        ]
        for client in (stable, beta):
            transport = Transport()
            for request in cases:
                with self.subTest(request=request), self.assertRaises(TypeError) as caught:
                    await client.synthesize_speech(cast(stable.SynthesizeSpeechRequest, request),
                        base_url=client.DEFAULT_BASE_URL, headers={}, transport=transport)
                self.assertEqual(str(caught.exception), "Invalid Google synthesizeSpeech input")
            self.assertEqual(transport.requests, [])

    async def test_invalid_origin_rejected_without_sending(self) -> None:
        transport = Transport()
        for url in ("ftp://proxy.invalid", "https://user:pass@proxy.invalid", "https://proxy.invalid/#fragment", "/relative"):
            with self.subTest(url=url), self.assertRaises(TypeError) as caught:
                await stable.synthesize_speech({}, base_url=url, headers={}, transport=transport)
            self.assertEqual(str(caught.exception), "Google base_url must be an HTTP(S) URL without credentials or a fragment")
        self.assertEqual(transport.requests, [])

    async def test_cancellation_reaches_the_injected_transport(self) -> None:
        entered = asyncio.Event()
        cleaned = asyncio.Event()

        class PendingTransport:
            async def send(self, request: HttpRequest) -> HttpResponse:
                entered.set()
                try:
                    await asyncio.Future[None]()
                finally:
                    cleaned.set()
                raise AssertionError("unreachable")

        task = asyncio.create_task(stable.synthesize_speech({}, base_url=stable.DEFAULT_BASE_URL,
            headers={}, transport=PendingTransport()))
        await asyncio.wait_for(entered.wait(), 1)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertTrue(cleaned.is_set())

    def test_response_types_allow_absence_but_reject_explicit_null_and_malformed_fields(self) -> None:
        for client in (stable, beta):
            self.assertEqual(client.decode_synthesize_speech_response(b'{"audioContent":"AP8=","future":1}'), {"audioContent": "AP8=", "future": 1})
            self.assertEqual(client.decode_synthesize_speech_response(b'{}'), {})
            self.assertEqual(client.decode_list_voices_response(b'{"voices":[{"name":"Kore","languageCodes":["en-US"],"naturalSampleRateHertz":24000,"ssmlGender":"FEMALE"}]}'),
                {"voices": [{"name": "Kore", "languageCodes": ["en-US"], "naturalSampleRateHertz": 24000, "ssmlGender": "FEMALE"}]})
            for data in (b'{"audioContent":null}', b'{"audioContent":0}', b'[]'):
                with self.assertRaises(TypeError) as caught:
                    client.decode_synthesize_speech_response(data)
                self.assertEqual(str(caught.exception), "Invalid Google synthesizeSpeech response")
            for data in (b'{"voices":{}}', b'{"voices":[{"ssmlGender":"INVALID"}]}', b'{"voices":[{"naturalSampleRateHertz":true}]}'):
                with self.assertRaises(TypeError) as caught:
                    client.decode_list_voices_response(data)
                self.assertEqual(str(caught.exception), "Invalid Google listVoices response")
            with self.assertRaises(TypeError) as caught:
                client.decode_synthesize_speech_response(b'{"unknown":NaN}')
            self.assertEqual(str(caught.exception), "Invalid Google JSON constant")


if __name__ == "__main__":
    unittest.main()
