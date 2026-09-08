package runtime

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"math"
	"os"
	"reflect"
	"testing"
)

func hydrateMessagePack(value any) any {
	switch v := value.(type) {
	case map[string]any:
		if raw, ok := v["$bytes"].([]any); ok {
			data := make([]byte, len(raw))
			for i, n := range raw {
				data[i] = byte(n.(float64))
			}
			return data
		}
		for k, child := range v {
			v[k] = hydrateMessagePack(child)
		}
	case []any:
		for i, child := range v {
			v[i] = hydrateMessagePack(child)
		}
	}
	return value
}
func TestMessagePackSharedGoldens(t *testing.T) {
	data, err := os.ReadFile("../../fixtures/msgpack.json")
	if err != nil {
		t.Fatal(err)
	}
	var groups map[string][]struct {
		Hex   string
		Value any
		Error string
	}
	if err = json.Unmarshal(data, &groups); err != nil {
		t.Fatal(err)
	}
	for group, cases := range groups {
		for _, test := range cases {
			t.Run(group+"/"+test.Hex, func(t *testing.T) {
				wire, err := hex.DecodeString(test.Hex)
				if err != nil {
					t.Fatal(err)
				}
				value, err := DecodeMessagePack(wire)
				if group == "invalid" {
					if err == nil || err.Error() != test.Error {
						t.Fatalf("got %v, want %s", err, test.Error)
					}
					return
				}
				want := hydrateMessagePack(test.Value)
				if err != nil || !reflect.DeepEqual(value, want) {
					t.Fatalf("got %#v %v want %#v", value, err, want)
				}
				if group == "valid" {
					encoded, err := EncodeMessagePack(want)
					if err != nil {
						t.Fatal(err)
					}
					if _, mapValue := want.(map[string]any); !mapValue {
						if !bytes.Equal(encoded, wire) {
							t.Fatalf("got %x want %x", encoded, wire)
						}
					} else {
						decoded, err := DecodeMessagePack(encoded)
						if err != nil || !reflect.DeepEqual(decoded, want) {
							t.Fatalf("got %#v %v", decoded, err)
						}
					}
				}
			})
		}
	}
	encoded, err := EncodeMessagePack(map[string]any{"event": "audio", "audio": []byte{0, 255}})
	if err != nil || hex.EncodeToString(encoded) != "82a5617564696fc40200ffa56576656e74a5617564696f" {
		t.Fatalf("sorted native binary map: %x %v", encoded, err)
	}
}
func TestMessagePackBoundsUTF8AndOwnership(t *testing.T) {
	for _, value := range []any{string(bytes.Repeat([]byte{'a'}, 70000)), bytes.Repeat([]byte{1}, 70000), make([]any, 16), map[string]any{"__proto__": map[string]any{"polluted": true}}} {
		encoded, err := EncodeMessagePack(value)
		if err != nil {
			t.Fatal(err)
		}
		decoded, err := DecodeMessagePack(encoded)
		if err != nil || !reflect.DeepEqual(decoded, value) {
			t.Fatalf("roundtrip %T: %v", value, err)
		}
	}
	for _, value := range []any{math.Inf(1), math.NaN(), "\xff", make(chan int)} {
		if _, err := EncodeMessagePack(value); err == nil {
			t.Fatalf("accepted %T", value)
		}
	}
	if _, err := DecodeMessagePack([]byte{0xa1, 0xff}); err == nil || err.Error() != "MessagePack string is not valid UTF-8" {
		t.Fatal(err)
	}
	encoded := []byte{0xc4, 2, 1, 2}
	value, err := DecodeMessagePack(encoded)
	if err != nil {
		t.Fatal(err)
	}
	encoded[2] = 9
	if !bytes.Equal(value.([]byte), []byte{1, 2}) {
		t.Fatal("binary bytes borrowed")
	}
	nested := append(bytes.Repeat([]byte{0x91}, 66), 0)
	if _, err := DecodeMessagePack(nested); err == nil || err.Error() != "MessagePack nesting exceeds 64 levels" {
		t.Fatal(err)
	}
	cyclic := map[string]any{}
	cyclic["self"] = cyclic
	if _, err := EncodeMessagePack(cyclic); err == nil || err.Error() != "MessagePack nesting exceeds 64 levels" {
		t.Fatal(err)
	}
}
