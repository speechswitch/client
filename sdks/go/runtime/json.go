package runtime

// JsonValue is a closed JSON data algebra, not an untyped arbitrary Go value.
// As with generated numeric types, finite-number checks belong at network boundaries.
type JsonValue interface{ isJsonValue() }
type JsonNull struct{}

func (JsonNull) isJsonValue() {}

type JsonBool bool

func (JsonBool) isJsonValue() {}

type JsonNumber float64

func (JsonNumber) isJsonValue() {}

type JsonString string

func (JsonString) isJsonValue() {}

type JsonArray []JsonValue

func (JsonArray) isJsonValue() {}

type JsonObject map[string]JsonValue

func (JsonObject) isJsonValue() {}
