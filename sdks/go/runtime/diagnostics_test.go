package runtime_test

import (
	"math"
	"reflect"
	"testing"

	"github.com/speechswitch/client/sdks/go/runtime"
)

func TestDiagnosticKeysUseCanonicalJSONEscapes(t *testing.T) {
	for _, test := range []struct{ key, want string }{
		{"a\"b\\c\n\r\t\b\f\x00", `"a\"b\\c\n\r\t\b\f\u0000"`},
		{"<>&😀\u2028\u2029", "\"<>&😀\u2028\u2029\""},
		{`\u2028`, `"\\u2028"`},
	} {
		if got := runtime.DiagnosticKey(test.key); got != test.want {
			t.Fatalf("got %q, want %q", got, test.want)
		}
	}
}

func TestDiagnosticJSONPreservesValuesAndRejectsCycles(t *testing.T) {
	shared := runtime.JsonObject{"value": runtime.JsonArray{runtime.JsonNull{}, runtime.JsonBool(false), runtime.JsonNumber(0), runtime.JsonString("😀")}}
	projected := runtime.DiagnosticJSON(runtime.JsonArray{shared, &shared})
	want := []any{map[string]any{"value": []any{nil, false, float64(0), "😀"}}, map[string]any{"value": []any{nil, false, float64(0), "😀"}}}
	if !reflect.DeepEqual(projected, want) || !runtime.IsDiagnosticJSON(projected) {
		t.Fatalf("unexpected projection: %#v", projected)
	}
	cyclic := runtime.JsonObject{}
	cyclic["self"] = cyclic
	array := runtime.JsonArray{nil}
	array[0] = &array
	var missing *runtime.JsonString
	for _, value := range []runtime.JsonValue{nil, missing, cyclic, array, runtime.JsonNumber(math.NaN()), runtime.JsonString(string([]byte{255}))} {
		if runtime.IsDiagnosticJSON(runtime.DiagnosticJSON(value)) {
			t.Fatal("invalid JSON accepted")
		}
	}
	raw := map[string]any{}
	raw["self"] = raw
	if runtime.IsDiagnosticJSON(raw) {
		t.Fatal("raw cycle accepted")
	}
	var deep runtime.JsonValue = runtime.JsonNull{}
	for index := 0; index < 2000; index++ {
		deep = runtime.JsonArray{deep}
	}
	if !runtime.IsDiagnosticJSON(runtime.DiagnosticJSON(deep)) {
		t.Fatal("deep JSON rejected")
	}
}
