import json
import unittest
from types import MappingProxyType
from collections.abc import AsyncIterator
import wire
from speechswitch.http import HttpRequest, HttpResponse


class Transport:
    def __init__(self) -> None:
        self.requests: list[HttpRequest] = []

    async def send(self, request: HttpRequest) -> HttpResponse:
        self.requests.append(request)
        return HttpResponse(201, {}, self)

    def __aiter__(self) -> AsyncIterator[bytes]:
        return self

    async def __anext__(self) -> bytes:
        raise StopAsyncIteration

    async def aclose(self) -> None:
        pass


class WireTests(unittest.IsolatedAsyncioTestCase):
    async def test_changed_contract_controls_transport_and_validation(self) -> None:
        self.assertEqual(wire.DEFAULT_BASE_URL, "https://changed.invalid/root")
        self.assertEqual(wire.SPEECH_STATUS, 201)
        transport = Transport()
        request = {"model": "tts-1", "input": "😀😀", "voice": MappingProxyType({"id": "saved"}), "enabled": False, "fraction": 0.25}
        response = await wire.create_speech(request, api_key="test", base_url=wire.DEFAULT_BASE_URL + "/?tenant=one", transport=transport)
        self.assertEqual(response.status, 201)
        captured = transport.requests[0]
        self.assertEqual(captured.url, "https://changed.invalid/root/changed/speech?tenant=one")
        self.assertEqual(captured.method, "POST")
        self.assertEqual(captured.headers, {"Authorization": "Bearer test", "Content-Type": "application/json", "Accept": "application/octet-stream, text/event-stream"})
        self.assertEqual(json.loads(captured.body), request)
        for change in [{"input": "abc"}, {"enabled": 0}, {"speed": True}, {"speed": float("nan")}, {"fraction": 0.5}, {"voice": {"id": None}}, {"extra": 1}]:
            with self.assertRaises(TypeError) as error:
                await wire.create_speech({**request, **change}, api_key="test", base_url=wire.DEFAULT_BASE_URL, transport=transport)
            self.assertEqual(str(error.exception), "Invalid OpenAI speech wire request")
        del request["enabled"]
        self.assertFalse(wire.is_speech_request(request))
        self.assertEqual(len(transport.requests), 1)

    def test_changed_event_literal_and_nested_type(self) -> None:
        event = {"type": "speech.completed", "usage": {"input_tokens": "0", "output_tokens": 1, "total_tokens": 1}, "future": True}
        self.assertEqual(wire.decode_speech_event(event), event)
        for invalid in [{**event, "type": "speech.audio.done"}, {**event, "usage": {"input_tokens": 0, "output_tokens": 1, "total_tokens": 1}}, {**event, "usage": {"input_tokens": "", "output_tokens": 1, "total_tokens": 1}}]:
            with self.assertRaises(TypeError) as error:
                wire.decode_speech_event(invalid)
            self.assertEqual(str(error.exception), "Invalid OpenAI speech event")


if __name__ == "__main__":
    unittest.main()
