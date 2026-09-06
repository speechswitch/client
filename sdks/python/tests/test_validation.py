import unittest
from collections.abc import AsyncIterator, Iterator
from types import MappingProxyType

from speechswitch.generated.validators import amazon, async_, hume, murf, xai
from speechswitch.validation import code_point_length, is_json_value, is_number, utf16_units


class UntouchedInput:
    def __aiter__(self) -> AsyncIterator[object]:
        raise AssertionError("validation must not acquire or advance input")


class OversizedInput(list[object]):
    def __iter__(self) -> Iterator[object]:
        raise AssertionError("collection bounds must be checked before elements")


class ValidationTests(unittest.TestCase):
    def test_xai_commands_stay_out_of_amazon_and_static_input(self) -> None:
        source = UntouchedInput()
        request: dict[str, object] = {"text": source, "text_normalization": False, "replacements": []}
        check = xai.validate_request(request)
        items: list[object] = ["", {"command": "clear"}, {"command": "flush"}, {"command": "update", "replacements": []}]
        for item in items:
            check(item)
        # Unknown extra fields match TypeScript; only authored never fields are forbidden.
        check({"command": "clear", "replacements": None})
        for item in [{"command": "update"}, None, 1]:
            with self.assertRaises(TypeError) as failure:
                check(item)
            self.assertEqual(str(failure.exception), "Invalid xai TTS input item")
        self.assertEqual(request, {"text": source, "text_normalization": False, "replacements": []})
        amazon_input = amazon.validate_request({"model": "generative", "voice": "voice", "output": {"format": "mp3"}, "text": source})
        amazon_input("hello")
        with self.assertRaises(TypeError) as failure:
            amazon_input({"command": "clear"})
        self.assertEqual(str(failure.exception), "Invalid amazon TTS input item")
        static = xai.validate_request({"text": "hello"})
        with self.assertRaises(TypeError) as failure:
            static("extra text")
        self.assertEqual(str(failure.exception), "Invalid xai TTS input item")

    def test_omission_does_not_accept_none_or_insert_defaults(self) -> None:
        request = {"text": "hello"}
        xai.validate_request(MappingProxyType(request))
        self.assertEqual(request, {"text": "hello"})
        for field in ["voice", "model", "language", "output", "speed", "text_normalization"]:
            with self.subTest(field=field), self.assertRaises(TypeError) as failure:
                xai.validate_request({**request, field: None})
            self.assertEqual(str(failure.exception), "Invalid xai TTS request")

    def test_integer_rates_and_stream_updates_use_generated_bounds(self) -> None:
        for value in [8000, 24000.0, 48000]:
            async_.validate_request({"model": "flash_v1.5", "voice": "voice", "text": "text", "output": {"format": "pcm", "sample_rate_hz": value}})
        for value in [True, 7999, 24000.5, 48001, float("nan"), float("inf"), 10**1000]:
            with self.subTest(value=value), self.assertRaises(TypeError) as failure:
                async_.validate_request({"model": "flash_v1.5", "voice": "voice", "text": "text", "output": {"format": "pcm", "sample_rate_hz": value}})
            self.assertEqual(str(failure.exception), "Invalid async TTS request")
        check = murf.validate_request({"text": UntouchedInput(), "voice": "voice"})
        check({"command": "update", "speed_bias": 0, "max_buffer_delay_ms": 0})
        for item in [{"command": "update", "speed_bias": 0.5}, {"command": "update", "max_buffer_delay_ms": 1001}, {"command": "update", "speed": 1}]:
            with self.assertRaises(TypeError) as failure:
                check(item)
            self.assertEqual(str(failure.exception), "Invalid murf TTS input item")

    def test_json_rejects_cycles_nonfinite_numbers_and_nonstring_keys(self) -> None:
        shared = {"nested": [None, False, 0, ""]}
        self.assertTrue(is_json_value([shared, shared]))
        cycle: list[object] = []
        cycle.append(cycle)
        for value in [cycle, {1: "value"}, b"audio", float("inf"), float("nan"), object(), 10**1000]:
            self.assertFalse(is_json_value(value))
        self.assertFalse(is_number(True))
        deep: object = 0
        for _ in range(2000):
            deep = [deep]
        self.assertTrue(is_json_value(deep))

    def test_code_points_and_utf16_units_remain_distinct(self) -> None:
        self.assertEqual(utf16_units("😀"), "\ud83d\ude00")
        self.assertEqual(code_point_length("😀"), 1)
        self.assertEqual(code_point_length("\ud83d\ude00"), 1)
        self.assertEqual(code_point_length("\ud83d!"), 2)

    def test_hume_model_and_collection_invariants(self) -> None:
        request: dict[str, object] = {"model": "octave-2", "text": "hello", "voice": "voice", "output": {"format": "pcm"}}
        hume.validate_request(request)
        updates: list[dict[str, object]] = [{"instructions": "whisper"}, {"context_before": {"request_ids": []}}, {"context_before": {"request_ids": ["one", "two"]}}]
        for update in updates:
            with self.assertRaises(TypeError) as failure:
                hume.validate_request({**request, **update})
            self.assertEqual(str(failure.exception), "Invalid hume TTS request")
        with self.assertRaises(TypeError) as failure:
            hume.validate_request({**request, "context_before": {"request_ids": OversizedInput(["one", "two"])}})
        self.assertEqual(str(failure.exception), "Invalid hume TTS request")


if __name__ == "__main__":
    unittest.main()
