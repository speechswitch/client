import json
import math
from pathlib import Path
import re
from typing import cast
import unittest

from speechswitch.clients import google_grpc as stable, google_grpc_beta as beta
from speechswitch.protobuf import ProtoReader, ProtoWriter
from speechswitch.validation import is_mapping, is_sequence


def snake(value: object) -> object:
    if is_mapping(value):
        fields: dict[str, object] = {}
        for key, child in value.items():
            if not isinstance(key, str):
                raise TypeError("Fixture keys must be strings")
            fields[re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", key).lower()] = snake(child)
        return fields
    if is_sequence(value):
        return [snake(child) for child in value]
    return value


class GoogleProtobufTests(unittest.TestCase):
    def test_shared_wire_goldens(self) -> None:
        cases = cast(list[dict[str, object]], json.loads((Path(__file__).parents[2] / "fixtures/google-protobuf.json").read_text()))
        for case in cases:
            request = snake(case["request"])
            expected = bytes.fromhex(cast(str, case["hex"]))
            self.assertEqual(stable.encode_streaming_request(cast(stable.StreamingSynthesizeRequest, request)), expected)
            self.assertEqual(beta.encode_streaming_request(cast(beta.StreamingSynthesizeRequest, request)), expected)
        self.assertEqual(stable.STREAMING_SYNTHESIZE_PATH, "/google.cloud.texttospeech.v1.TextToSpeech/StreamingSynthesize")
        self.assertEqual(beta.STREAMING_SYNTHESIZE_PATH, "/google.cloud.texttospeech.v1beta1.TextToSpeech/StreamingSynthesize")

    def test_response_unknown_fields_duplicates_and_malformed_data(self) -> None:
        for client in (stable, beta):
            self.assertEqual(client.decode_streaming_response(b""), {})
            self.assertEqual(client.decode_streaming_response(bytes.fromhex("0a0300ff010a00")), {"audio_content": b""})
            self.assertEqual(client.decode_streaming_response(bytes.fromhex("10012a0201020a0200ff")), {"audio_content": bytes([0, 255])})
            for wire, message in [("00", "Invalid protobuf field number"), ("0801", "Invalid protobuf wire type for StreamingSynthesizeResponse.audioContent"), ("0a0401", "Truncated protobuf message"), ("13", "Unsupported protobuf wire type: 3"), ("ffffffffffffffffff02", "Invalid protobuf varint")]:
                with self.subTest(wire=wire), self.assertRaises(TypeError) as caught:
                    client.decode_streaming_response(bytes.fromhex(wire))
                self.assertEqual(str(caught.exception), message)

    def test_oneofs_required_fields_false_and_zero(self) -> None:
        self.assertEqual(stable.encode_streaming_request({"input": {"text": "", "prompt": ""}}), bytes.fromhex("12040a003200"))
        self.assertEqual(stable.encode_streaming_audio_config({"audio_encoding": "AUDIO_ENCODING_UNSPECIFIED", "sample_rate_hertz": 0, "speaking_rate": 0}), bytes.fromhex("08001000190000000000000000"))
        cases: list[tuple[object, str]] = [
            ({"streaming_config": {}, "input": {}}, "StreamingSynthesizeRequest.streamingRequest permits at most one field"),
            ({"streaming_config": {}}, "Missing StreamingSynthesizeConfig.voice"),
            ({"streaming_config": {"voice": {}}}, "Missing VoiceSelectionParams.languageCode"),
            ({"input": {"text": "hi", "markup": "pause"}}, "StreamingSynthesisInput.inputSource permits at most one field"),
        ]
        for value, message in cases:
            with self.assertRaises(TypeError) as caught:
                stable.encode_streaming_request(cast(stable.StreamingSynthesizeRequest, value))
            self.assertEqual(str(caught.exception), message)


class ScalarProtobufTests(unittest.TestCase):
    def test_scalars_and_owned_bytes(self) -> None:
        writer = ProtoWriter().uint32(0xFFFFFFFF).int32(-2147483648).bool(False).double(1.25).bytes(b"\x00\xff").string("日本")
        data = writer.finish()
        writer.uint32(1)
        reader = ProtoReader(data)
        self.assertEqual(reader.uint32(), 0xFFFFFFFF)
        self.assertEqual(reader.int32(), -2147483648)
        self.assertIs(reader.bool(), False)
        self.assertEqual(reader.double(), 1.25)
        self.assertEqual(reader.bytes(), b"\x00\xff")
        self.assertEqual(reader.string(), "日本")
        self.assertTrue(reader.done)
        self.assertEqual(ProtoWriter().string("\ud800\ud83d\ude00").finish(), bytes.fromhex("07efbfbdf09f9880"))

    def test_exact_scalar_rejections(self) -> None:
        with self.assertRaises(TypeError) as caught:
            ProtoReader(bytearray([1, 2]))
        self.assertEqual(str(caught.exception), "Invalid protobuf bytes")
        for value in (-1, 0x100000000, 0.5, True, "1", None):
            with self.assertRaises(TypeError) as caught:
                ProtoWriter().uint32(value)
            self.assertEqual(str(caught.exception), "Invalid protobuf uint32")
        for value in (-2147483649, 2147483648, False):
            with self.assertRaises(TypeError) as caught:
                ProtoWriter().int32(value)
            self.assertEqual(str(caught.exception), "Invalid protobuf int32")
        for value in (math.inf, math.nan, 10**400, True, None):
            with self.assertRaises(TypeError) as caught:
                ProtoWriter().double(value)
            self.assertEqual(str(caught.exception), "Invalid protobuf double")
        with self.assertRaises(UnicodeDecodeError):
            ProtoReader(b"\x01\xff").string()
        for data, message in [(b"\x80", "Truncated protobuf message"), (b"\xff" * 9 + b"\x02", "Invalid protobuf varint"), (bytes.fromhex("8080808010"), "Invalid protobuf uint32")]:
            with self.assertRaises(TypeError) as caught:
                ProtoReader(data).uint32()
            self.assertEqual(str(caught.exception), message)


if __name__ == "__main__":
    unittest.main()
