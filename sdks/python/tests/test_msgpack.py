import json
import math
import unittest
from pathlib import Path
from collections.abc import Sequence
from typing import cast
from speechswitch.msgpack import encode, decode
from speechswitch.validation import is_mapping, is_sequence


def hydrate(value: object) -> object:
    if is_mapping(value):
        if "$bytes" in value:
            values = value["$bytes"]
            assert is_sequence(values) and all(isinstance(item, int) for item in values)
            return bytes(cast(Sequence[int], values))
        return {str(k): hydrate(v) for k, v in value.items()}
    if is_sequence(value):
        return [hydrate(v) for v in value]
    return value


class MessagePackTests(unittest.TestCase):
    def test_shared_wire_goldens(self) -> None:
        fixtures = json.loads((Path(__file__).parents[2] / "fixtures/msgpack.json").read_text())
        for group in ["valid", "alternate"]:
            for case in fixtures[group]:
                with self.subTest(group=group, hex=case["hex"]):
                    value = hydrate(case["value"])
                    self.assertEqual(decode(bytes.fromhex(case["hex"])), value)
                    if group == "valid":
                        self.assertEqual(encode(value).hex(), case["hex"])
        for case in fixtures["invalid"]:
            with self.subTest(hex=case["hex"]), self.assertRaises(TypeError) as raised:
                decode(bytes.fromhex(case["hex"]))
            self.assertEqual(str(raised.exception), case["error"])

    def test_lengths_nested_values_and_strict_utf8(self) -> None:
        for value in ["a" * 300, "a" * 70000, bytes(300), bytes(70000), list(range(16)), dict.fromkeys((str(i) for i in range(16)), 0), {"__proto__": {"polluted": True}}]:
            self.assertEqual(decode(encode(value)), value)
        with self.assertRaises(UnicodeDecodeError):
            decode(bytes.fromhex("a1ff"))
        with self.assertRaises(UnicodeEncodeError):
            encode("\ud800")
        for value in [math.nan, math.inf, -math.inf, 10 ** 1000]:
            with self.assertRaises(TypeError) as raised:
                encode(value)
            self.assertEqual(str(raised.exception), "MessagePack numbers must be finite")
        nested: object = 0
        for _ in range(66):
            nested = [nested]
        for action in [lambda: encode(nested), lambda: decode(bytes([0x91] * 66 + [0]))]:
            with self.assertRaises(TypeError) as raised:
                action()
            self.assertEqual(str(raised.exception), "MessagePack nesting exceeds 64 levels")
