"""Execute a changed contract to detect static wire templates."""
import asyncio
import copy
import json
import unittest

import wire
from speechswitch.http import HttpResponse


class Body:
    def __aiter__(self): return self
    async def __anext__(self): raise StopAsyncIteration
    async def aclose(self): pass


class Tests(unittest.IsolatedAsyncioTestCase):
    async def test_changed_transport_and_guards(self):
        calls = []
        class Transport:
            async def send(self, request):
                calls.append(request)
                return HttpResponse(202, {}, Body())
        options = dict(api_key="key", base_url=wire.DEFAULT_BASE_URL, transport=Transport())
        self.assertEqual(wire.DEFAULT_BASE_URL, "https://changed.invalid/root/?tenant=one")
        self.assertEqual(wire.CREATE_SPEECH_STATUS, 202)
        await wire.get_speech_job({"id": "a/b?x"}, **options)
        self.assertEqual((calls[0].method, calls[0].url, calls[0].headers, calls[0].body),
                         ("POST", "https://changed.invalid/root/new/a%2Fb%3Fx?tenant=one", {"changed-key": "key"}, b""))
        with self.assertRaises(TypeError) as error:
            await wire.get_speech_job({"id": "x"}, **options)
        self.assertEqual(str(error.exception), "Invalid LOVO async-retrieve-job request")
        valid = {"text": 7, "speaker": "v", "enabled": False, "nickname": "😀a"}
        for input in [{**valid, "text": "Hi"}, {**valid, "text": 7.5}, {**valid, "text": True},
                      {**valid, "text": 4}, {**valid, "text": 11}, {**valid, "nickname": "a"},
                      {"text": 7, "speaker": "v"}]:
            with self.assertRaises(TypeError) as error:
                await wire.create_speech(input, **options)
            self.assertEqual(str(error.exception), "Invalid LOVO sync-tts request")
        self.assertEqual(len(calls), 1)
        await wire.create_speech(valid, **options)
        self.assertEqual(json.loads(calls[-1].body), valid)
        await wire.create_speech({**valid, "nickname": None}, **options)
        self.assertEqual(json.loads(calls[-1].body), {**valid, "nickname": None})

    async def test_changed_nested_response(self):
        output = dict(status="new_status", text="Hi", speaker="v", speakerStyle="s", speed=1,
                      pause=[], emphasis=[{"position": 0, "value": 0.1}], pronunciations=[], urls=[1])
        job = dict(id="job", type="tts", status="done", progress=1, team="team", createdAt="now", data=[output])
        self.assertEqual(wire.decode_create_speech(job), job)
        for change in [{"status": "succeeded"}, {"urls": ["https://audio.invalid"]}, {"urls": [True]},
                       {"urls": [1.5]}, {"emphasis": [{"position": 0, "value": 0.25}]}]:
            with self.assertRaises(TypeError) as error:
                wire.decode_create_speech({**job, "data": [{**output, **change}]})
            self.assertEqual(str(error.exception), "Invalid LOVO sync-tts response")
        absent = copy.deepcopy(output); del absent["urls"]
        with self.assertRaises(TypeError) as error:
            wire.decode_create_speech({**job, "data": [absent]})
        self.assertEqual(str(error.exception), "Invalid LOVO sync-tts response")


unittest.main()
