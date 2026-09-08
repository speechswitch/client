import json
from pathlib import Path
import unittest
from typing import NotRequired, TypedDict, cast

from speechswitch.generated.transport import SseMessage
from speechswitch.sse import SseDecoder


class Fixture(TypedDict):
    name: str
    text: NotRequired[str]
    hex: NotRequired[str]
    limit: NotRequired[int]
    events: list[SseMessage]
    error: NotRequired[str]


class SseTests(unittest.TestCase):
    def test_shared_fixtures(self) -> None:
        fixtures = cast(list[Fixture], json.loads(
            (Path(__file__).parents[2] / "fixtures/sse.json").read_text(encoding="utf-8")
        ))
        for fixture in fixtures:
            wire = bytes.fromhex(fixture["hex"]) if "hex" in fixture else fixture.get("text", "").encode()
            for split in range(len(wire) + 1):
                with self.subTest(name=fixture["name"], split=split):
                    decoder = SseDecoder(fixture.get("limit", 4096))
                    events: list[SseMessage] = []
                    error: str | None = None
                    try:
                        for chunk in (wire[:split], b"", wire[split:]):
                            for byte in chunk:
                                event = decoder.push(byte)
                                if event is not None:
                                    events.append(event)
                    except ValueError as caught:
                        error = str(caught)
                    self.assertEqual(events, fixture["events"])
                    self.assertEqual(error, fixture.get("error"))
                    if error is not None:
                        with self.assertRaises(ValueError) as failed:
                            decoder.push(10)
                        self.assertEqual(str(failed.exception), "SSE decoder is closed")
                    decoder.finish()
                    decoder.finish()
                    with self.assertRaises(ValueError) as closed:
                        decoder.push(10)
                    self.assertEqual(str(closed.exception), "SSE decoder is closed")

    def test_invalid_limits(self) -> None:
        for limit in (0, -1, True):
            with self.subTest(limit=limit), self.assertRaises(ValueError) as caught:
                SseDecoder(limit)
            self.assertEqual(str(caught.exception), "SSE event limit must be positive")

    def test_invalid_byte_is_terminal(self) -> None:
        for byte in (-1, 256, True):
            decoder = SseDecoder(100)
            with self.assertRaises(ValueError) as caught:
                decoder.push(byte)
            self.assertEqual(str(caught.exception), "SSE input must be a byte")
            with self.assertRaises(ValueError) as closed:
                decoder.push(10)
            self.assertEqual(str(closed.exception), "SSE decoder is closed")

    def test_CR_dispatch_does_not_wait_for_next_read(self) -> None:
        decoder = SseDecoder(100)
        for byte in b"data: x\r":
            self.assertIsNone(decoder.push(byte))
        self.assertEqual(decoder.push(13), {"event": "message", "data": "x"})
