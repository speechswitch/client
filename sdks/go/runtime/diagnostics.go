package runtime

import (
	"fmt"
	"reflect"
	"strings"
)

// Diagnostic markers distinguish missing concrete values from explicit JSON null.
type InvalidDiagnosticValue struct{}
type DiagnosticInput struct{}

// DiagnosticKey uses the same JSON string escaping as canonical request paths.
func DiagnosticKey(key string) string {
	var output strings.Builder
	output.WriteByte('"')
	for _, character := range key {
		switch character {
		case '"':
			output.WriteString(`\"`)
		case '\\':
			output.WriteString(`\\`)
		case '\n':
			output.WriteString(`\n`)
		case '\r':
			output.WriteString(`\r`)
		case '\t':
			output.WriteString(`\t`)
		case '\b':
			output.WriteString(`\b`)
		case '\f':
			output.WriteString(`\f`)
		default:
			if character < ' ' {
				fmt.Fprintf(&output, `\u%04x`, character)
			} else {
				output.WriteRune(character)
			}
		}
	}
	output.WriteByte('"')
	return output.String()
}

// DiagnosticJSON projects data only, retaining invalid scalar values for checks
// of other union alternatives. Cyclic edges become invalid-value markers.
func DiagnosticJSON(value JsonValue) any {
	type identity struct {
		kind    reflect.Kind
		pointer any
		length  int
	}
	ancestors := map[identity]bool{}
	var project func(JsonValue) any
	project = func(value JsonValue) any {
		reflected := reflect.ValueOf(value)
		if reflected.IsValid() && reflected.Kind() == reflect.Pointer {
			if reflected.IsNil() {
				return InvalidDiagnosticValue{}
			}
			value = reflected.Elem().Interface().(JsonValue)
		}
		switch item := value.(type) {
		case JsonNull:
			return nil
		case JsonBool:
			return bool(item)
		case JsonNumber:
			return float64(item)
		case JsonString:
			return string(item)
		case JsonArray:
			id := identity{reflect.Slice, reflect.ValueOf(item).UnsafePointer(), len(item)}
			if ancestors[id] {
				return InvalidDiagnosticValue{}
			}
			ancestors[id] = true
			defer delete(ancestors, id)
			result := make([]any, len(item))
			for index, child := range item {
				result[index] = project(child)
			}
			return result
		case JsonObject:
			id := identity{reflect.Map, reflect.ValueOf(item).UnsafePointer(), 0}
			if ancestors[id] {
				return InvalidDiagnosticValue{}
			}
			ancestors[id] = true
			defer delete(ancestors, id)
			result := make(map[string]any, len(item))
			for key, child := range item {
				result[key] = project(child)
			}
			return result
		default:
			return InvalidDiagnosticValue{}
		}
	}
	return project(value)
}

// IsDiagnosticJSON also guards malformed untyped input passed to item checkers.
func IsDiagnosticJSON(value any) bool {
	type identity struct {
		kind    reflect.Kind
		pointer any
		length  int
	}
	type frame struct {
		value any
		exit  *identity
	}
	ancestors := map[identity]bool{}
	pending := []frame{{value: value}}
	for len(pending) != 0 {
		next := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if next.exit != nil {
			delete(ancestors, *next.exit)
			continue
		}
		switch item := next.value.(type) {
		case nil, bool:
		case float64:
			if !IsJSONValue(JsonNumber(item)) {
				return false
			}
		case string:
			if !IsJSONValue(JsonString(item)) {
				return false
			}
		case []any:
			id := identity{reflect.Slice, reflect.ValueOf(item).UnsafePointer(), len(item)}
			if ancestors[id] {
				return false
			}
			ancestors[id] = true
			pending = append(pending, frame{exit: &id})
			for _, child := range item {
				pending = append(pending, frame{value: child})
			}
		case map[string]any:
			id := identity{reflect.Map, reflect.ValueOf(item).UnsafePointer(), 0}
			if ancestors[id] {
				return false
			}
			ancestors[id] = true
			pending = append(pending, frame{exit: &id})
			for key, child := range item {
				if !IsJSONValue(JsonString(key)) {
					return false
				}
				pending = append(pending, frame{value: child})
			}
		default:
			return false
		}
	}
	return true
}
