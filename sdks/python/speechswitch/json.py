from collections.abc import Mapping

type JsonValue = str | float | bool | None | list[JsonValue] | tuple[JsonValue, ...] | Mapping[str, JsonValue]
