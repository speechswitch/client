"""Scalar protobuf primitives; generated clients own field numbers and shapes."""

import builtins
import math
import struct


class ProtoWriter:
    def __init__(self) -> None:
        self._data = bytearray()

    def uint32(self, value: object) -> "ProtoWriter":
        if type(value) is not int or not 0 <= value <= 0xFFFFFFFF:
            raise TypeError("Invalid protobuf uint32")
        return self._varint(value)

    def int32(self, value: object) -> "ProtoWriter":
        if type(value) is not int or not -2147483648 <= value <= 2147483647:
            raise TypeError("Invalid protobuf int32")
        return self._varint(value & 0xFFFFFFFFFFFFFFFF)

    def _varint(self, value: int) -> "ProtoWriter":
        while value > 127:
            self._data.append((value & 127) | 128)
            value >>= 7
        self._data.append(value)
        return self

    def bool(self, value: object) -> "ProtoWriter":
        if type(value) is not bool:
            raise TypeError("Invalid protobuf bool")
        return self.uint32(1 if value else 0)

    def double(self, value: object) -> "ProtoWriter":
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            raise TypeError("Invalid protobuf double")
        try:
            valid = math.isfinite(value)
        except OverflowError:
            valid = False
        if not valid:
            raise TypeError("Invalid protobuf double")
        self._data.extend(struct.pack("<d", value))
        return self

    def bytes(self, value: object) -> "ProtoWriter":
        if not isinstance(value, bytes):
            raise TypeError("Invalid protobuf bytes")
        self.uint32(len(value))
        self._data.extend(value)
        return self

    def string(self, value: object) -> "ProtoWriter":
        if not isinstance(value, str):
            raise TypeError("Invalid protobuf string")
        try:
            encoded = value.encode("utf-8")
        except UnicodeEncodeError:
            # Match TextEncoder: combine surrogate pairs and replace lone units.
            encoded = value.encode("utf-16-le", "surrogatepass").decode("utf-16-le", "replace").encode("utf-8")
        return self.bytes(encoded)

    def finish(self) -> builtins.bytes:
        return bytes(self._data)


class ProtoReader:
    def __init__(self, data: object) -> None:
        if not isinstance(data, builtins.bytes):
            raise TypeError("Invalid protobuf bytes")
        self._data = data
        self._offset = 0

    @property
    def done(self) -> bool:
        return self._offset == len(self._data)

    def _take(self, length: int) -> builtins.bytes:
        if length > len(self._data) - self._offset:
            raise TypeError("Truncated protobuf message")
        data = self._data[self._offset:self._offset + length]
        self._offset += length
        return data

    def _varint(self) -> int:
        result = 0
        for index in range(10):
            byte = self._take(1)[0]
            if index == 9 and byte > 1:
                raise TypeError("Invalid protobuf varint")
            result |= (byte & 127) << (index * 7)
            if byte & 128 == 0:
                return result
        raise TypeError("Invalid protobuf varint")

    def uint32(self) -> int:
        value = self._varint()
        if value > 0xFFFFFFFF:
            raise TypeError("Invalid protobuf uint32")
        return value

    def int32(self) -> int:
        value = self._varint() & 0xFFFFFFFF
        return value if value < 0x80000000 else value - 0x100000000

    def bool(self) -> builtins.bool:
        return self._varint() != 0

    def double(self) -> float:
        return float(struct.unpack("<d", self._take(8))[0])

    def bytes(self) -> builtins.bytes:
        return self._take(self.uint32())

    def string(self) -> str:
        return self.bytes().decode("utf-8", errors="strict")

    def skip(self, wire: int) -> None:
        if wire == 0:
            self._varint()
        elif wire == 1:
            self._take(8)
        elif wire == 2:
            self.bytes()
        elif wire == 5:
            self._take(4)
        else:
            raise TypeError(f"Unsupported protobuf wire type: {wire}")
