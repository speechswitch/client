package runtime

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"sort"
	"unicode/utf8"
)

// EncodeMessagePack accepts nil, bool, float64, string, []byte, []any and
// map[string]any. Maps are sorted for deterministic bytes; binary stays binary.
// Normalized numeric values use the canonical TypeScript double representation.
func EncodeMessagePack(value any) ([]byte, error) {
	var output []byte
	header := func(marker byte, width int, length uint64) {
		output = append(output, marker)
		for index := width - 1; index >= 0; index-- {
			output = append(output, byte(length>>(index*8)))
		}
	}
	var write func(any, int) error
	write = func(value any, depth int) error {
		if depth > 64 {
			return errors.New("MessagePack nesting exceeds 64 levels")
		}
		switch v := value.(type) {
		case nil:
			header(0xc0, 0, 0)
		case bool:
			if v {
				header(0xc3, 0, 0)
			} else {
				header(0xc2, 0, 0)
			}
		case float64:
			if math.IsNaN(v) || math.IsInf(v, 0) {
				return errors.New("MessagePack numbers must be finite")
			}
			switch {
			case math.Trunc(v) == v && v >= 0 && v <= 127:
				header(byte(v), 0, 0)
			case math.Trunc(v) == v && v >= -32 && v < 0:
				header(byte(int(v)+256), 0, 0)
			case math.Trunc(v) == v && v >= 0 && v <= 255:
				header(0xcc, 1, uint64(v))
			case math.Trunc(v) == v && v >= 0 && v <= 65535:
				header(0xcd, 2, uint64(v))
			case math.Trunc(v) == v && v >= 0 && v <= 4294967295:
				header(0xce, 4, uint64(v))
			case math.Trunc(v) == v && v >= -2147483648 && v < 0:
				header(0xd2, 4, uint64(uint32(int32(v))))
			default:
				header(0xcb, 8, math.Float64bits(v))
			}
		case string:
			if !utf8.ValidString(v) {
				return errors.New("MessagePack string is not valid UTF-8")
			}
			length := uint64(len(v))
			if length > math.MaxUint32 {
				return errors.New("MessagePack value exceeds 32-bit length")
			}
			switch {
			case length < 32:
				header(0xa0|byte(length), 0, 0)
			case length <= 255:
				header(0xd9, 1, length)
			case length <= 65535:
				header(0xda, 2, length)
			default:
				header(0xdb, 4, length)
			}
			output = append(output, v...)
		case []byte:
			length := uint64(len(v))
			if length > math.MaxUint32 {
				return errors.New("MessagePack value exceeds 32-bit length")
			}
			switch {
			case length <= 255:
				header(0xc4, 1, length)
			case length <= 65535:
				header(0xc5, 2, length)
			default:
				header(0xc6, 4, length)
			}
			output = append(output, v...)
		case []any:
			length := uint64(len(v))
			if length > math.MaxUint32 {
				return errors.New("MessagePack value exceeds 32-bit length")
			}
			switch {
			case length < 16:
				header(0x90|byte(length), 0, 0)
			case length <= 65535:
				header(0xdc, 2, length)
			default:
				header(0xdd, 4, length)
			}
			for _, child := range v {
				if err := write(child, depth+1); err != nil {
					return err
				}
			}
		case map[string]any:
			length := uint64(len(v))
			if length > math.MaxUint32 {
				return errors.New("MessagePack value exceeds 32-bit length")
			}
			switch {
			case length < 16:
				header(0x80|byte(length), 0, 0)
			case length <= 65535:
				header(0xde, 2, length)
			default:
				header(0xdf, 4, length)
			}
			keys := make([]string, 0, len(v))
			for key := range v {
				keys = append(keys, key)
			}
			sort.Strings(keys)
			for _, key := range keys {
				if err := write(key, depth+1); err != nil {
					return err
				}
				if err := write(v[key], depth+1); err != nil {
					return err
				}
			}
		default:
			return errors.New("Unsupported MessagePack value")
		}
		return nil
	}
	if err := write(value, 0); err != nil {
		return nil, err
	}
	return output, nil
}

// DecodeMessagePack checks lengths before allocating, enforces a depth limit and
// consumes exactly one value. Returned binary values own their bytes. Extension
// types, duplicate/non-string map keys and unsafe 64-bit integers are rejected.
func DecodeMessagePack(data []byte) (any, error) {
	d := messagePackReader{data: data}
	value, err := d.read(0)
	if err == nil && d.offset != len(data) {
		err = errors.New("MessagePack frame contains trailing data")
	}
	if err != nil {
		return nil, err
	}
	return value, nil
}

type messagePackReader struct {
	data   []byte
	offset int
}

func (d *messagePackReader) take(length uint64) ([]byte, error) {
	if length > uint64(len(d.data)-d.offset) {
		return nil, errors.New("Truncated MessagePack value")
	}
	result := d.data[d.offset : d.offset+int(length)]
	d.offset += int(length)
	return result, nil
}
func (d *messagePackReader) integer(width int) (uint64, error) {
	bytes, err := d.take(uint64(width))
	if err != nil {
		return 0, err
	}
	var result uint64
	for _, b := range bytes {
		result = result<<8 | uint64(b)
	}
	return result, nil
}
func (d *messagePackReader) array(length uint64, depth int) (any, error) {
	if length > uint64(len(d.data)-d.offset) {
		return nil, errors.New("Truncated MessagePack value")
	}
	result := make([]any, 0, int(length))
	for index := uint64(0); index < length; index++ {
		v, err := d.read(depth + 1)
		if err != nil {
			return nil, err
		}
		result = append(result, v)
	}
	return result, nil
}
func (d *messagePackReader) object(length uint64, depth int) (any, error) {
	if length > uint64((len(d.data)-d.offset)/2) {
		return nil, errors.New("Truncated MessagePack value")
	}
	result := make(map[string]any, int(length))
	for index := uint64(0); index < length; index++ {
		raw, err := d.read(depth + 1)
		if err != nil {
			return nil, err
		}
		key, ok := raw.(string)
		if !ok {
			return nil, errors.New("MessagePack map key is not a string")
		}
		if _, exists := result[key]; exists {
			return nil, errors.New("MessagePack map contains duplicate keys")
		}
		value, err := d.read(depth + 1)
		if err != nil {
			return nil, err
		}
		result[key] = value
	}
	return result, nil
}
func (d *messagePackReader) string(length uint64) (any, error) {
	data, err := d.take(length)
	if err != nil {
		return nil, err
	}
	if !utf8.Valid(data) {
		return nil, errors.New("MessagePack string is not valid UTF-8")
	}
	return string(data), nil
}
func (d *messagePackReader) read(depth int) (any, error) {
	if depth > 64 {
		return nil, errors.New("MessagePack nesting exceeds 64 levels")
	}
	raw, err := d.integer(1)
	if err != nil {
		return nil, err
	}
	marker := byte(raw)
	switch {
	case marker <= 127:
		return float64(marker), nil
	case marker >= 0xe0:
		return float64(int(marker) - 256), nil
	case marker&0xe0 == 0xa0:
		return d.string(uint64(marker & 31))
	case marker&0xf0 == 0x90:
		return d.array(uint64(marker&15), depth)
	case marker&0xf0 == 0x80:
		return d.object(uint64(marker&15), depth)
	}
	switch marker {
	case 0xc0:
		return nil, nil
	case 0xc2:
		return false, nil
	case 0xc3:
		return true, nil
	case 0xc4, 0xc5, 0xc6, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf:
		widths := map[byte]int{0xc4: 1, 0xc5: 2, 0xc6: 4, 0xd9: 1, 0xda: 2, 0xdb: 4, 0xdc: 2, 0xdd: 4, 0xde: 2, 0xdf: 4}
		length, err := d.integer(widths[marker])
		if err != nil {
			return nil, err
		}
		switch marker {
		case 0xc4, 0xc5, 0xc6:
			bytes, err := d.take(length)
			if err != nil {
				return nil, err
			}
			return append([]byte{}, bytes...), nil
		case 0xd9, 0xda, 0xdb:
			return d.string(length)
		case 0xdc, 0xdd:
			return d.array(length, depth)
		default:
			return d.object(length, depth)
		}
	case 0xca:
		bytes, err := d.take(4)
		if err != nil {
			return nil, err
		}
		return float64(math.Float32frombits(binary.BigEndian.Uint32(bytes))), nil
	case 0xcb:
		bytes, err := d.take(8)
		if err != nil {
			return nil, err
		}
		return math.Float64frombits(binary.BigEndian.Uint64(bytes)), nil
	case 0xcc, 0xcd, 0xce, 0xcf, 0xd0, 0xd1, 0xd2, 0xd3:
		width := 1 << ((marker - 0xcc) % 4)
		value, err := d.integer(width)
		if err != nil {
			return nil, err
		}
		if marker >= 0xd0 {
			signed := int64(value)
			if width < 8 {
				shift := 64 - width*8
				signed = int64(value<<shift) >> shift
			}
			if signed < -9007199254740991 || signed > 9007199254740991 {
				return nil, errors.New("MessagePack integer exceeds the safe integer range")
			}
			return float64(signed), nil
		}
		if value > 9007199254740991 {
			return nil, errors.New("MessagePack integer exceeds the safe integer range")
		}
		return float64(value), nil
	default:
		return nil, fmt.Errorf("Unsupported MessagePack marker: 0x%x", marker)
	}
}
