"""MessagePack scalars, binary values and containers used by Fish's wire protocol.

No extension types, non-string map keys, duplicate keys or trailing data. Numeric
integers decoded from 64-bit wire forms must fit the canonical safe-integer range.
"""

import math
import struct
from speechswitch.validation import is_mapping, is_sequence

type Value = None | bool | int | float | str | bytes | list[Value] | dict[str, Value]


def encode(value: object) -> bytes:
    output = bytearray()

    def header(marker: int, size: int = 0, length: int = 0) -> None:
        output.append(marker)
        output.extend(length.to_bytes(size, "big", signed=False))

    def write(value: object, depth: int) -> None:
        if depth > 64:
            raise TypeError("MessagePack nesting exceeds 64 levels")
        if value is None or type(value) is bool:
            header(0xc0 if value is None else 0xc3 if value else 0xc2)
        elif isinstance(value, (int, float)):
            try:
                number = float(value)
            except OverflowError:
                raise TypeError("MessagePack numbers must be finite") from None
            if not math.isfinite(number):
                raise TypeError("MessagePack numbers must be finite")
            integer = int(value)
            if value == integer and 0 <= integer <= 0x7f:
                header(integer)
            elif value == integer and -32 <= integer < 0:
                header(integer + 256)
            elif value == integer and 0 <= integer <= 0xffffffff:
                size = 1 if integer <= 0xff else 2 if integer <= 0xffff else 4
                header({1: 0xcc, 2: 0xcd, 4: 0xce}[size], size, integer)
            elif value == integer and -0x80000000 <= integer < 0:
                header(0xd2)
                output.extend(integer.to_bytes(4, "big", signed=True))
            else:
                header(0xcb)
                # Match the canonical TypeScript number's double representation.
                # Schema @integer bounds separately reject unsafe integer fields.
                output.extend(struct.pack(">d", number))
        elif isinstance(value, (str, bytes)):
            data = value.encode("utf-8") if isinstance(value, str) else value
            size = len(data)
            if size > 0xffffffff:
                raise TypeError("MessagePack value exceeds 32-bit length")
            if isinstance(value, str) and size < 32:
                header(0xa0 | size)
            else:
                width = 1 if size <= 0xff else 2 if size <= 0xffff else 4
                marker = {1: 0xd9, 2: 0xda, 4: 0xdb} if isinstance(value, str) else {1: 0xc4, 2: 0xc5, 4: 0xc6}
                header(marker[width], width, size)
            output.extend(data)
        elif is_mapping(value) or is_sequence(value):
            size = len(value)
            if size > 0xffffffff:
                raise TypeError("MessagePack value exceeds 32-bit length")
            mapping = is_mapping(value)
            if size < 16:
                header((0x80 if mapping else 0x90) | size)
            else:
                width = 2 if size <= 0xffff else 4
                header((0xde if width == 2 else 0xdf) if mapping else (0xdc if width == 2 else 0xdd), width, size)
            if is_mapping(value):
                for key, child in value.items():
                    if not isinstance(key, str):
                        raise TypeError("MessagePack map key is not a string")
                    write(key, depth + 1)
                    write(child, depth + 1)
            else:
                for child in value:
                    write(child, depth + 1)
        else:
            raise TypeError("Unsupported MessagePack value")

    write(value, 0)
    return bytes(output)


def decode(data: bytes) -> Value:
    offset = 0

    def take(size: int) -> bytes:
        nonlocal offset
        if size > len(data) - offset:
            raise TypeError("Truncated MessagePack value")
        result = data[offset:offset + size]
        offset += size
        return result

    def integer(size: int, signed: bool = False) -> int:
        value = int.from_bytes(take(size), "big", signed=signed)
        if size == 8 and abs(value) > 9007199254740991:
            raise TypeError("MessagePack integer exceeds the safe integer range")
        return value

    def array(size: int, depth: int) -> list[Value]:
        if size > len(data) - offset:
            raise TypeError("Truncated MessagePack value")
        return [read(depth + 1) for _ in range(size)]

    def mapping(size: int, depth: int) -> dict[str, Value]:
        if size > (len(data) - offset) // 2:
            raise TypeError("Truncated MessagePack value")
        result: dict[str, Value] = {}
        for _ in range(size):
            key = read(depth + 1)
            if not isinstance(key, str):
                raise TypeError("MessagePack map key is not a string")
            if key in result:
                raise TypeError("MessagePack map contains duplicate keys")
            result[key] = read(depth + 1)
        return result

    def read(depth: int) -> Value:
        if depth > 64:
            raise TypeError("MessagePack nesting exceeds 64 levels")
        marker = integer(1)
        if marker <= 0x7f:
            return marker
        if marker >= 0xe0:
            return marker - 256
        if marker & 0xe0 == 0xa0:
            return take(marker & 31).decode("utf-8")
        if marker & 0xf0 == 0x90:
            return array(marker & 15, depth)
        if marker & 0xf0 == 0x80:
            return mapping(marker & 15, depth)
        if marker == 0xc0:
            return None
        if marker in (0xc2, 0xc3):
            return marker == 0xc3
        if marker in (0xc4, 0xc5, 0xc6):
            return take(integer({0xc4: 1, 0xc5: 2, 0xc6: 4}[marker]))
        if marker in (0xca, 0xcb):
            value: float = struct.unpack(">f" if marker == 0xca else ">d", take(4 if marker == 0xca else 8))[0]
            return value
        if 0xcc <= marker <= 0xd3:
            return integer(1 << ((marker - 0xcc) % 4), marker >= 0xd0)
        if marker in (0xd9, 0xda, 0xdb):
            return take(integer({0xd9: 1, 0xda: 2, 0xdb: 4}[marker])).decode("utf-8")
        if marker in (0xdc, 0xdd):
            return array(integer(2 if marker == 0xdc else 4), depth)
        if marker in (0xde, 0xdf):
            return mapping(integer(2 if marker == 0xde else 4), depth)
        raise TypeError(f"Unsupported MessagePack marker: 0x{marker:x}")

    value = read(0)
    if offset != len(data):
        raise TypeError("MessagePack frame contains trailing data")
    return value
