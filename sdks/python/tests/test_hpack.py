from pathlib import Path
import re
import unittest

from speechswitch.hpack import HpackDecoder, HpackError, decode_huffman, encode_headers


class HpackTests(unittest.TestCase):
    def test_rfc_huffman_dynamic_requests(self) -> None:
        decoder = HpackDecoder(4096, 65536)
        self.assertEqual(decoder.decode(bytes.fromhex("828684418cf1e3c2e5f23a6ba0ab90f4ff")),
            [(b":method", b"GET"), (b":scheme", b"http"), (b":path", b"/"), (b":authority", b"www.example.com")])
        self.assertEqual(decoder.decode(bytes.fromhex("828684be5886a8eb10649cbf")),
            [(b":method", b"GET"), (b":scheme", b"http"), (b":path", b"/"), (b":authority", b"www.example.com"), (b"cache-control", b"no-cache")])
        self.assertEqual(decoder.decode(bytes.fromhex("828785bf408825a849e95ba97d7f8925a849e95bb8e8b4bf")),
            [(b":method", b"GET"), (b":scheme", b"https"), (b":path", b"/index.html"), (b":authority", b"www.example.com"), (b"custom-key", b"custom-value")])

    def test_every_octet_against_independently_read_normative_codes(self) -> None:
        raw = (Path(__file__).parents[3] / "schemas/sources/google/08-hpack-rfc7541.txt").read_text()
        rows = re.findall(r"\(\s*(\d+)\)\s+([|01]+)\s+([a-f0-9]+)\s+\[\s*(\d+)\]", raw)
        self.assertEqual([int(row[0]) for row in rows], list(range(257)))
        bits = "".join(row[1].replace("|", "") for row in rows[:256])
        bits += "1" * (-len(bits) % 8)
        encoded = int(bits, 2).to_bytes(len(bits) // 8, "big")
        self.assertEqual(decode_huffman(encoded, 256), bytes(range(256)))

    def test_never_indexed_fields_and_multibyte_lengths(self) -> None:
        fields = [(b"authorization", b"Bearer test"), (b"long", b"x" * 300)]
        wire = encode_headers(fields)
        self.assertEqual(wire[:27], b"\x10\x0dauthorization\x0bBearer test")
        self.assertEqual(HpackDecoder(4096, 65536).decode(wire), fields)
        with self.assertRaises(HpackError) as caught:
            HpackDecoder(4096, 65536).decode(b"\xbe")
        self.assertEqual(str(caught.exception), "Invalid HPACK table index")

    def test_table_resize_eviction_and_oversized_entry(self) -> None:
        decoder = HpackDecoder(4096, 65536)
        self.assertEqual(decoder.decode(b"\x40\x01a\x01b"), [(b"a", b"b")])
        self.assertEqual(decoder.decode(b"\xbe"), [(b"a", b"b")])
        self.assertEqual(decoder.decode(b"\x20\x40\x01c\x01d"), [(b"c", b"d")])
        with self.assertRaises(HpackError) as caught:
            decoder.decode(b"\xbe")
        self.assertEqual(str(caught.exception), "Invalid HPACK table index")

    def test_exact_malformed_and_limit_errors(self) -> None:
        cases = [
            (b"\x80", "Invalid HPACK table index"), (b"\xff", "Truncated HPACK integer"),
            (b"\xff\xff\xff\xff\xff\x7f", "HPACK integer exceeds implementation limit"),
            (b"\x00\x02x", "Truncated HPACK string"),
            (b"\x82\x20", "HPACK table update follows a header"),
            (b"\x3f\xe2\x1f", "HPACK table update exceeds advertised limit"),
            (b"\x00\x84\xff\xff\xff\xff\x00", "HPACK Huffman EOS is forbidden"),
            (b"\x00\x81\xff\x00", "Invalid HPACK Huffman padding"),
            (b"\x00\x81\x00\x00", "Invalid HPACK Huffman padding"),
        ]
        for wire, message in cases:
            with self.subTest(wire=wire), self.assertRaises(HpackError) as caught:
                HpackDecoder(4096, 65536).decode(wire)
            self.assertEqual(str(caught.exception), message)
        with self.assertRaises(HpackError) as caught:
            HpackDecoder(4096, 32).decode(b"\x82")
        self.assertEqual(str(caught.exception), "HPACK header list exceeds byte limit")
        with self.assertRaises(HpackError) as caught:
            decode_huffman(bytes.fromhex("f1e3c2e5f23a6ba0ab90f4ff"), 2)
        self.assertEqual(str(caught.exception), "HPACK string exceeds byte limit")
