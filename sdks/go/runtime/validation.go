package runtime

import (
	"math"
	"reflect"
	"unicode/utf8"
)

// InputValidator checks consumed items without acquiring or advancing a producer.
// The optional field is its canonical name (for example "text" or "turns").
type InputValidator func(item any, field ...string) error

// Interfaces can contain a typed nil producer even when the interface is non-nil.
func IsNilInput[T any](value Input[T]) bool {
	if value == nil {
		return true
	}
	reflected := reflect.ValueOf(value)
	switch reflected.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Pointer, reflect.Slice:
		return reflected.IsNil()
	default:
		return false
	}
}

// IsJSONValue checks the closed data algebra, including pointer forms permitted
// by Go's method sets. Nil collections are empty; a nil interface is not JsonNull.
func IsJSONValue(value JsonValue) bool {
	type identity struct {
		kind    reflect.Kind
		pointer any
		length  int
	}
	type frame struct {
		value JsonValue
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
		value := next.value
		switch item := value.(type) {
		case *JsonNull:
			if item == nil {
				return false
			}
			value = *item
		case *JsonBool:
			if item == nil {
				return false
			}
			value = *item
		case *JsonNumber:
			if item == nil {
				return false
			}
			value = *item
		case *JsonString:
			if item == nil {
				return false
			}
			value = *item
		case *JsonArray:
			if item == nil {
				return false
			}
			value = *item
		case *JsonObject:
			if item == nil {
				return false
			}
			value = *item
		}
		switch item := value.(type) {
		case JsonNull, JsonBool:
		case JsonNumber:
			if math.IsNaN(float64(item)) || math.IsInf(float64(item), 0) {
				return false
			}
		case JsonString:
			if !utf8.ValidString(string(item)) {
				return false
			}
		case JsonArray:
			id := identity{kind: reflect.Slice, pointer: reflect.ValueOf(item).UnsafePointer(), length: len(item)}
			if ancestors[id] {
				return false
			}
			ancestors[id] = true
			pending = append(pending, frame{exit: &id})
			for _, child := range item {
				pending = append(pending, frame{value: child})
			}
		case JsonObject:
			id := identity{kind: reflect.Map, pointer: reflect.ValueOf(item).UnsafePointer()}
			if ancestors[id] {
				return false
			}
			ancestors[id] = true
			pending = append(pending, frame{exit: &id})
			for key, child := range item {
				if !utf8.ValidString(key) {
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
