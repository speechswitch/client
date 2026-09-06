package runtime

import (
	"bytes"
	"encoding/hex"
	"math"
	"testing"
)

func TestProtoScalarsAndOwnership(t *testing.T) {
	var writer ProtoWriter
	data, err := writer.Uint32(math.MaxUint32).Int32(math.MinInt32).Bool(false).Double(1.25).Bytes([]byte{0, 255}).String("日本").Finish()
	if err != nil {
		t.Fatal(err)
	}
	if actual := hex.EncodeToString(data); actual != "ffffffff0f80808080f8ffffffff0100000000000000f43f0200ff06e697a5e69cac" {
		t.Fatalf("scalar bytes: %s", actual)
	}
	reader := NewProtoReader(data)
	if reader.Uint32() != math.MaxUint32 || reader.Int32() != math.MinInt32 || reader.Bool() || reader.Double() != 1.25 || !bytes.Equal(reader.Bytes(), []byte{0, 255}) || reader.String() != "日本" || !reader.Done() || reader.Err() != nil {
		t.Fatalf("scalar roundtrip: %v", reader.Err())
	}
	writer.Uint32(1)
	if !reader.Done() {
		t.Fatal("writer changed completed result")
	}
	data[0] = 0
	again, err := writer.Finish()
	if err != nil || again[0] != 255 {
		t.Fatalf("Finish returned borrowed storage: %x, %v", again, err)
	}
	input := []byte{2, 1, 2}
	owned := NewProtoReader(input).Bytes()
	input[1] = 99
	if !bytes.Equal(owned, []byte{1, 2}) {
		t.Fatalf("Bytes returned borrowed storage: %x", owned)
	}
}

func TestProtoScalarErrorsAreSticky(t *testing.T) {
	for _, value := range []float64{math.Inf(1), math.Inf(-1), math.NaN()} {
		var writer ProtoWriter
		data, err := writer.Uint32(8).Double(value).String("\xff").Finish()
		if data != nil || err == nil || err.Error() != "Invalid protobuf double" {
			t.Fatalf("non-finite input: %x, %v", data, err)
		}
	}
	var writer ProtoWriter
	data, err := writer.String("\xff").Finish()
	if data != nil || err == nil || err.Error() != "Invalid protobuf UTF-8 string" {
		t.Fatalf("invalid UTF-8: %x, %v", data, err)
	}
	for _, test := range []struct {
		hex, error string
		read       func(*ProtoReader)
	}{
		{"80", "Truncated protobuf message", func(r *ProtoReader) { r.Uint32() }},
		{"ffffffffffffffffff02", "Invalid protobuf varint", func(r *ProtoReader) { r.Uint32() }},
		{"ffffffffffffffffff01", "Invalid protobuf uint32", func(r *ProtoReader) { r.Uint32() }},
		{"0301", "Truncated protobuf message", func(r *ProtoReader) { r.Bytes() }},
		{"ffffffff0f", "Truncated protobuf message", func(r *ProtoReader) { r.Bytes() }},
		{"01", "Truncated protobuf message", func(r *ProtoReader) { r.Double() }},
		{"01ff", "Invalid protobuf UTF-8 string", func(r *ProtoReader) { r.String() }},
	} {
		t.Run(test.hex, func(t *testing.T) {
			data, err := hex.DecodeString(test.hex)
			if err != nil {
				t.Fatal(err)
			}
			reader := NewProtoReader(data)
			test.read(reader)
			if reader.Err() == nil || reader.Err().Error() != test.error || !reader.Done() {
				t.Fatalf("error: %v, done: %v", reader.Err(), reader.Done())
			}
			original := reader.Err()
			reader.Skip(7)
			reader.Uint32()
			if reader.Err() != original {
				t.Fatal("lost first error")
			}
		})
	}
}

func TestProtoUnknownFieldsAndIntegerSemantics(t *testing.T) {
	for _, test := range []struct {
		wire uint32
		data []byte
	}{
		{0, []byte{128, 1}}, {1, make([]byte, 8)}, {2, []byte{2, 1, 2}}, {5, make([]byte, 4)},
	} {
		reader := NewProtoReader(test.data)
		reader.Skip(test.wire)
		if reader.Err() != nil || !reader.Done() {
			t.Fatalf("skip %d: %v", test.wire, reader.Err())
		}
	}
	for wire, expected := range map[uint32]string{3: "Unsupported protobuf wire type: 3", 4: "Unsupported protobuf wire type: 4", 6: "Unsupported protobuf wire type: 6", 7: "Unsupported protobuf wire type: 7"} {
		reader := NewProtoReader(nil)
		reader.Skip(wire)
		if reader.Err() == nil || reader.Err().Error() != expected {
			t.Fatalf("skip %d: %v", wire, reader.Err())
		}
	}
	if !NewProtoReader([]byte{2}).Bool() {
		t.Fatal("nonzero protobuf bool must be true")
	}
	if NewProtoReader([]byte{255, 255, 255, 255, 15}).Int32() != -1 {
		t.Fatal("int32 must retain low signed bits")
	}
}

func FuzzProtoReaderProgress(f *testing.F) {
	for _, seed := range [][]byte{nil, {10, 0}, {255, 255}, {10, 255, 255, 255, 255, 15}, {255, 255, 255, 255, 255, 255, 255, 255, 255, 2}} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		reader := NewProtoReader(data)
		for steps := 0; !reader.Done(); steps++ {
			if steps >= len(data) {
				t.Fatal("reader did not make bounded progress")
			}
			tag := reader.Uint32()
			reader.Skip(tag & 7)
		}
	})
}
