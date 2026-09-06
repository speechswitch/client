package runtime

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"unicode/utf8"
)

// ProtoWriter handles scalars only; generated clients own tags, shapes and oneofs.
// Finish returns owned bytes and the first error, never a partial successful message.
type ProtoWriter struct {
	data []byte
	err  error
}

func (w *ProtoWriter) varint(value uint64) *ProtoWriter {
	if w.err == nil {
		w.data = binary.AppendUvarint(w.data, value)
	}
	return w
}

func (w *ProtoWriter) Uint32(value uint32) *ProtoWriter { return w.varint(uint64(value)) }
func (w *ProtoWriter) Int32(value int32) *ProtoWriter   { return w.varint(uint64(int64(value))) }
func (w *ProtoWriter) Bool(value bool) *ProtoWriter {
	if value {
		return w.Uint32(1)
	}
	return w.Uint32(0)
}
func (w *ProtoWriter) Double(value float64) *ProtoWriter {
	if w.err == nil {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			w.err = errors.New("Invalid protobuf double")
		} else {
			w.data = binary.LittleEndian.AppendUint64(w.data, math.Float64bits(value))
		}
	}
	return w
}
func (w *ProtoWriter) Bytes(value []byte) *ProtoWriter {
	if w.err == nil {
		if uint64(len(value)) > math.MaxUint32 {
			w.err = errors.New("Invalid protobuf uint32")
		} else {
			w.Uint32(uint32(len(value)))
			w.data = append(w.data, value...)
		}
	}
	return w
}
func (w *ProtoWriter) String(value string) *ProtoWriter {
	if w.err != nil {
		return w
	}
	if !utf8.ValidString(value) {
		w.err = errors.New("Invalid protobuf UTF-8 string")
	}
	return w.Bytes([]byte(value))
}
func (w *ProtoWriter) Finish() ([]byte, error) {
	if w.err != nil {
		return nil, w.err
	}
	return bytes.Clone(w.data), nil
}

// ProtoReader borrows its input while reading; returned byte fields are owned.
// An error terminates Done so malformed messages cannot spin in a decode loop.
type ProtoReader struct {
	data   []byte
	offset int
	err    error
}

func NewProtoReader(data []byte) *ProtoReader { return &ProtoReader{data: data} }
func (r *ProtoReader) Done() bool             { return r.err != nil || r.offset == len(r.data) }
func (r *ProtoReader) Err() error             { return r.err }
func (r *ProtoReader) take(length uint64) []byte {
	if r.err != nil {
		return nil
	}
	if length > uint64(len(r.data)-r.offset) {
		r.err = errors.New("Truncated protobuf message")
		return nil
	}
	data := r.data[r.offset : r.offset+int(length)]
	r.offset += int(length)
	return data
}
func (r *ProtoReader) varint() uint64 {
	var result uint64
	for index := 0; index < 10; index++ {
		data := r.take(1)
		if r.err != nil {
			return 0
		}
		value := data[0]
		if index == 9 && value > 1 {
			r.err = errors.New("Invalid protobuf varint")
			return 0
		}
		result |= uint64(value&127) << (index * 7)
		if value&128 == 0 {
			return result
		}
	}
	r.err = errors.New("Invalid protobuf varint")
	return 0
}
func (r *ProtoReader) Uint32() uint32 {
	value := r.varint()
	if r.err == nil && value > math.MaxUint32 {
		r.err = errors.New("Invalid protobuf uint32")
	}
	return uint32(value)
}
func (r *ProtoReader) Int32() int32 { return int32(r.varint()) }
func (r *ProtoReader) Bool() bool   { return r.varint() != 0 }
func (r *ProtoReader) Double() float64 {
	data := r.take(8)
	if r.err != nil {
		return 0
	}
	return math.Float64frombits(binary.LittleEndian.Uint64(data))
}
func (r *ProtoReader) Bytes() []byte { return bytes.Clone(r.take(uint64(r.Uint32()))) }
func (r *ProtoReader) String() string {
	data := r.Bytes()
	if r.err == nil && !utf8.Valid(data) {
		r.err = errors.New("Invalid protobuf UTF-8 string")
	}
	return string(data)
}
func (r *ProtoReader) Skip(wire uint32) {
	if r.err != nil {
		return
	}
	switch wire {
	case 0:
		r.varint()
	case 1:
		r.take(8)
	case 2:
		r.take(uint64(r.Uint32()))
	case 5:
		r.take(4)
	default:
		r.err = fmt.Errorf("Unsupported protobuf wire type: %d", wire)
	}
}
