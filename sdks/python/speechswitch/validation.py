from collections.abc import Mapping, Sequence
from math import isfinite
from typing import Protocol, TypeGuard


class InputValidator(Protocol):
    def __call__(self, item: object, field: str = "text") -> None: ...


def is_number(value: object) -> TypeGuard[int | float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return isfinite(value)
    except OverflowError:
        return False


def is_mapping(value: object) -> TypeGuard[Mapping[object, object]]:
    return isinstance(value, Mapping)


def is_sequence(value: object) -> TypeGuard[Sequence[object]]:
    return isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray, memoryview))


def utf16_units(value: str) -> str:
    encoded = value.encode("utf-16-le", "surrogatepass")
    return "".join(chr(encoded[index] | encoded[index + 1] << 8) for index in range(0, len(encoded), 2))


def code_point_length(value: str) -> int:
    # Python can contain an explicit surrogate pair as well as a scalar character.
    return len(value.encode("utf-16-le", "surrogatepass").decode("utf-16-le", "surrogatepass"))


def is_json_value(value: object) -> bool:
    ancestors: set[int] = set()
    pending: list[tuple[bool, object]] = [(False, value)]
    while pending:
        exiting, item = pending.pop()
        if exiting:
            ancestors.remove(id(item))
            continue
        if item is None or isinstance(item, (str, bool)) or is_number(item):
            continue
        if id(item) in ancestors:
            return False
        if is_mapping(item):
            if not all(isinstance(key, str) for key in item):
                return False
            children = item.values()
        elif is_sequence(item) and isinstance(item, (list, tuple)):
            children = item
        else:
            return False
        ancestors.add(id(item))
        pending.append((True, item))
        pending.extend((False, child) for child in children)
    return True
