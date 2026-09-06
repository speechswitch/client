"""Execute a freshly generated, deliberately changed contract, not a golden template."""
import asyncio
import json
import unittest
from typing import get_args, get_type_hints

import wire
from speechswitch.http import HttpResponse


class Body:
    def __aiter__(self):
        return self

    async def __anext__(self):
        raise StopAsyncIteration

    async def aclose(self):
        pass


class ClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_http(self):
        calls = []
        response = HttpResponse(200, {}, Body())

        class Transport:
            async def send(self, request):
                calls.append(request)
                return response

        options = {"api_key": "test-key", "base_url": wire.DEFAULT_BASE_URL + "/?trace=1", "transport": Transport()}
        valid = {"text": 8, "language": "en-us", "voice_id": 1, "extra_flag": True}
        for invalid in [{**valid, "text": "hello"}, {**valid, "text": 4}, {**valid, "text": 10},
                        {**valid, "text": True}, {key: value for key, value in valid.items() if key != "extra_flag"},
                        {**valid, "extra_flag": None}, {**valid, "language": "invented"}]:
            with self.subTest(invalid=invalid):
                with self.assertRaises(TypeError) as error:
                    await wire.stream_speech(invalid, **options)
                self.assertEqual(str(error.exception), "Invalid CAMB HTTP synthesis request")
        self.assertEqual(calls, [])
        self.assertIs(await wire.stream_speech(valid, **options), response)
        self.assertEqual(len(calls), 1)
        request = calls[0]
        self.assertEqual((request.method, request.url, dict(request.headers), json.loads(request.body)),
                         ("POST", "https://new.invalid/api/new-tts?trace=1",
                          {"new-key": "test-key", "content-type": "application/json"}, valid))
        self.assertIs(get_type_hints(wire.HttpInput)["text"], float)
        self.assertIs(get_type_hints(wire.HttpInput)["extra_flag"], bool)
        self.assertEqual(wire.HttpInput.__required_keys__, {"text", "language", "voice_id", "extra_flag"})
        self.assertEqual(wire.DEFAULT_WEB_SOCKET_URL, "wss://live.invalid/apis/live-tts/ws")

    def test_messages(self):
        self.assertEqual(get_args(wire.ServerMessage), (wire.SessionReady, wire.SegmentStart, bytes, wire.SegmentDone, wire.SegmentSkipped, wire.SessionDone, wire.SessionError, wire.Added))
        valid = {"type": "added", "count": 3, "items": [{"value": "hello"}]}
        for value in [valid, {**valid, "nickname": None}, {**valid, "nickname": "😀x"},
                      {**valid, "a-b": {"flag": True}, "a_b": {"flag": 2.5}}]:
            self.assertEqual(wire.decode_message(json.dumps(value)), value)
        self.assertTrue(wire.is_server_message({**valid, "nickname": "\ud83d\ude00x"}))
        for value in [{**valid, "count": 3.5}, {**valid, "count": True}, {**valid, "count": 10**1000},
                      {**valid, "nickname": "😀"}, {**valid, "nickname": "abc"}, {**valid, "items": [None]},
                      {**valid, "items": [{}]}, {**valid, "extra": True}, {**valid, "a_b": {"flag": False}},
                      {key: value for key, value in valid.items() if key != "count"}]:
            with self.subTest(value=value):
                with self.assertRaises(TypeError) as error:
                    wire.decode_message(json.dumps(value))
                self.assertEqual(str(error.exception), "Invalid CAMB WebSocket message")
        self.assertEqual(wire.decode_message(b"\x00\xff"), b"\x00\xff")
        self.assertEqual(wire.decode_message('{"type":"segment.start","segment_id":1,"text":"hi","word_timestamps":null}'),
                         {"type": "segment.start", "segment_id": 1, "text": "hi", "word_timestamps": None})
        with self.assertRaises(TypeError) as error:
            wire.decode_message('{"type":"session.done","extra":NaN}')
        self.assertEqual(str(error.exception), "Invalid CAMB WebSocket JSON")
        self.assertEqual(json.loads(wire.encode_message({"type": "text.chunk", "text": "hello", "index": 0})),
                         {"type": "text.chunk", "text": "hello", "index": 0})
        with self.assertRaises(TypeError) as error:
            wire.encode_message({"type": "text.chunk", "text": None})
        self.assertEqual(str(error.exception), "Invalid CAMB WebSocket input")


if __name__ == "__main__":
    unittest.main()
