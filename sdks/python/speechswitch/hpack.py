"""Bounded RFC 7541 decoding; outbound fields are never indexed (including auth)."""

from collections.abc import Sequence
from speechswitch.hpack_tables import HUFFMAN, STATIC_TABLE


class HpackError(ValueError):
    pass


def _integer(value: int, prefix: int, mask: int) -> bytes:
    maximum = (1 << prefix) - 1
    if value < maximum:
        return bytes([mask | value])
    output = bytearray([mask | maximum])
    value -= maximum
    while value >= 128:
        output.append((value & 127) | 128)
        value >>= 7
    output.append(value)
    return bytes(output)


def encode_headers(fields: Sequence[tuple[bytes, bytes]]) -> bytes:
    output = bytearray()
    for name, value in fields:
        output.extend(b"\x10" + _integer(len(name), 7, 0) + name + _integer(len(value), 7, 0) + value)
    return bytes(output)


def decode_huffman(data: bytes, limit: int) -> bytes:
    output = bytearray()
    node, padding, bits = 0, 0, 0
    for byte in data:
        for shift in range(7, -1, -1):
            bit = (byte >> shift) & 1
            node = HUFFMAN[node][bit]
            if node < 0:
                raise HpackError("Invalid HPACK Huffman code")
            padding = (padding << 1) | bit
            bits += 1
            symbol = HUFFMAN[node][2]
            if symbol == 256:
                raise HpackError("HPACK Huffman EOS is forbidden")
            if symbol >= 0:
                if len(output) == limit:
                    raise HpackError("HPACK string exceeds byte limit")
                output.append(symbol)
                node, padding, bits = 0, 0, 0
    if bits > 7 or padding != (1 << bits) - 1:
        raise HpackError("Invalid HPACK Huffman padding")
    return bytes(output)


class HpackDecoder:
    def __init__(self, table_limit: int, header_limit: int) -> None:
        self._table_limit = table_limit
        self._header_limit = header_limit
        self._maximum = table_limit
        self._size = 0
        self._entries: list[tuple[bytes, bytes]] = []

    def _evict(self) -> None:
        while self._size > self._maximum:
            name, value = self._entries.pop()
            self._size -= len(name) + len(value) + 32

    def _entry(self, index: int) -> tuple[bytes, bytes]:
        if index <= 0 or index > len(STATIC_TABLE) + len(self._entries):
            raise HpackError("Invalid HPACK table index")
        return STATIC_TABLE[index - 1] if index <= len(STATIC_TABLE) else self._entries[index - len(STATIC_TABLE) - 1]

    def decode(self, data: bytes) -> list[tuple[bytes, bytes]]:
        position, size = 0, 0
        fields: list[tuple[bytes, bytes]] = []

        def integer(prefix: int) -> int:
            nonlocal position
            if position == len(data):
                raise HpackError("Truncated HPACK integer")
            maximum = (1 << prefix) - 1
            value = data[position] & maximum
            position += 1
            if value < maximum:
                return value
            for shift in range(0, 35, 7):
                if position == len(data):
                    raise HpackError("Truncated HPACK integer")
                byte = data[position]
                position += 1
                value += (byte & 127) << shift
                if value > 0x7FFFFFFF:
                    break
                if byte < 128:
                    return value
            raise HpackError("HPACK integer exceeds implementation limit")

        def string() -> bytes:
            nonlocal position
            if position == len(data):
                raise HpackError("Truncated HPACK string")
            huffman = bool(data[position] & 128)
            length = integer(7)
            if length > len(data) - position:
                raise HpackError("Truncated HPACK string")
            value = data[position:position + length]
            position += length
            if huffman:
                return decode_huffman(value, self._header_limit)
            if len(value) > self._header_limit:
                raise HpackError("HPACK string exceeds byte limit")
            return value

        if len(data) > self._header_limit:
            raise HpackError("HPACK block exceeds byte limit")
        while position < len(data):
            first = data[position]
            if first & 128:
                name, value = self._entry(integer(7))
            elif first & 64 or not first & 32:
                index = integer(6 if first & 64 else 4)
                name = self._entry(index)[0] if index else string()
                value = string()
                if first & 64:
                    entry_size = len(name) + len(value) + 32
                    if entry_size > self._maximum:
                        self._entries.clear()
                        self._size = 0
                    else:
                        self._entries.insert(0, (name, value))
                        self._size += entry_size
                        self._evict()
            else:
                if fields:
                    raise HpackError("HPACK table update follows a header")
                maximum = integer(5)
                if maximum > self._table_limit:
                    raise HpackError("HPACK table update exceeds advertised limit")
                self._maximum = maximum
                self._evict()
                continue
            size += len(name) + len(value) + 32
            if size > self._header_limit:
                raise HpackError("HPACK header list exceeds byte limit")
            fields.append((name, value))
        return fields
