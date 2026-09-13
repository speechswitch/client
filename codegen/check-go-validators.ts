import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { compileLanguageTypes, identity, pascal, snake } from "./language-types.ts";
import { extractRepositorySpeechSpec } from "./repository-spec.ts";
import { renderGoPattern } from "./go-pattern.ts";
import { patternFixtures } from "./pattern-fixtures.ts";
import type { SchemaConstraints, SchemaType } from "./spec-model.ts";
import { arrayItemConstraints } from "./spec-model.ts";

const root = path.resolve(import.meta.dirname, "..");
const spec = extractRepositorySpeechSpec(root);
const temporary = mkdtempSync(path.join(tmpdir(), "speechswitch-go-validation-"));
const patterns = new Set<string>();
let count = 0;
interface Sample { readonly ts: unknown; readonly go: string }
try {
  writeFileSync(path.join(temporary, "go.mod"), `module validationfixtures\ngo 1.25\nrequire github.com/speechswitch/client/sdks/go v0.0.0\nreplace github.com/speechswitch/client/sdks/go => ${path.join(root, "sdks/go")}\n`);
  for (const provider of spec.tts.providers) {
    const layout = compileLanguageTypes(provider.request, "go", provider.id);
    const imports = new Set(["context", "testing", "github.com/speechswitch/client/sdks/go/runtime"]);
    const { validateRequest } = await import(pathToFileURL(path.join(root, `sdk/generated/validators/${provider.id}.ts`)).href) as { validateRequest(value: unknown): (item: unknown, field?: string) => void };
    function goType(type: SchemaType): string {
      switch (type.kind) {
        case "string": return "string";
        case "number": return "float64";
        case "boolean": return "bool";
        case "bigint": imports.add("math/big"); return "*big.Int";
        case "bytes": return "[]byte";
        case "empty-tuple": return "[0]struct{}";
        case "json-value": return "runtime.JsonValue";
        case "array": return `[]${goType(type.items)}`;
        case "record": return `map[string]${goType(type.values)}`;
        case "async-iterable": return `runtime.Input[${goType(type.items)}]`;
        default: return `provider.${layout.names.get(identity(type))!}`;
      }
    }
    function sample(type: SchemaType, constraints?: SchemaConstraints): Sample {
      if (constraints?.pattern) patterns.add(constraints.pattern);
      switch (type.kind) {
        case "literal": return { ts: type.value, go: `${goType(type)}{}` };
        case "empty-tuple": return { ts: [], go: "[0]struct{}{}" };
        case "string": {
          const value = ["a", "en", "en-US", "1", "tc_voice"].find(value => !constraints?.pattern || new RegExp(constraints.pattern).test(value));
          assert.notEqual(value, undefined); return { ts: value, go: JSON.stringify(value) };
        }
        case "number": { const value = Math.max(constraints?.minimum ?? 0, constraints?.exclusiveMinimum === undefined ? 0 : constraints.exclusiveMinimum + 1); return { ts: value, go: String(value) }; }
        case "boolean": return { ts: false, go: "false" };
        case "bigint": imports.add("math/big"); return { ts: 123n, go: "big.NewInt(123)" };
        case "bytes": return { ts: Uint8Array.of(1, 2), go: "[]byte{1,2}" };
        case "json-value": return { ts: { value: [null, false, 0] }, go: 'runtime.JsonObject{"value": runtime.JsonArray{runtime.JsonNull{}, runtime.JsonBool(false), runtime.JsonNumber(0)}}' };
        case "async-iterable": return { ts: { [Symbol.asyncIterator]() { throw new Error("input acquired"); } }, go: `&untouched[${goType(type.items)}]{}` };
        case "union": {
          const part = type.anyOf[0]!; const value = sample(part, constraints);
          return { ts: value.ts, go: `provider.${layout.variants.get(identity(type))![0]!.wrapper}{Value: ${value.go}}` };
        }
        case "array": {
          const value = sample(type.items, arrayItemConstraints(constraints)); const count = Math.max(1, constraints?.minItems ?? 0);
          return { ts: Array.from({ length: count }, () => value.ts), go: `${goType(type)}{${Array.from({ length: count }, () => value.go).join(",")}}` };
        }
        case "record": { const value = sample(type.values); return { ts: { key: value.ts }, go: `${goType(type)}{"key": ${value.go}}` }; }
        case "object": {
          const fields = type.fields.filter(field => !field.optional).map(field => ({ name: field.name, value: sample(field.type, field.constraints) }));
          return { ts: Object.fromEntries(fields.map(field => [field.name, field.value.ts])), go: `${goType(type)}{${fields.map(field => `${pascal(field.name)}: ${field.value.go}`).join(",")}}` };
        }
      }
    }
    function alternatives(type: SchemaType, constraints?: SchemaConstraints): Sample[] {
      const result = [sample(type, constraints)];
      if (type.kind === "number") {
        imports.add("math");
        for (const value of [-1, 0, 0.5, 1, (constraints?.minimum ?? 0) - 1, (constraints?.maximum ?? 1) + 1]) result.push({ ts: value, go: String(value) });
        result.push({ ts: NaN, go: "math.NaN()" }, { ts: Infinity, go: "math.Inf(1)" });
      } else if (type.kind === "string") {
        for (const value of ["", "\n", "😀", "a".repeat((constraints?.maxLength ?? 2) + 1)]) result.push({ ts: value, go: JSON.stringify(value) });
      } else if (type.kind === "union") {
        result.push({ ts: Symbol("missing Go interface"), go: "nil" });
        for (const variant of layout.variants.get(identity(type))!) {
          const value = sample(variant.schema, constraints);
          result.push({ ts: value.ts, go: `provider.${variant.wrapper}{Value: ${value.go}}` });
        }
      } else if (type.kind === "async-iterable") result.push({ ts: null, go: "nil" });
      else if (type.kind === "array") {
        result.push({ ts: [], go: "nil" });
        if (type.items.kind === "number" && arrayItemConstraints(constraints)) {
          const minimum = constraints?.itemMinimum ?? 0;
          const maximum = constraints?.itemMaximum ?? 500;
          for (const value of [minimum - 1, minimum, minimum + 0.5, maximum, maximum + 1]) result.push({ ts: [value], go: `[]float64{${value}}` });
          result.push({ ts: [NaN], go: "[]float64{math.NaN()}" }, { ts: [Infinity], go: "[]float64{math.Inf(1)}" });
          const mixed = [minimum - 1, maximum + 1, minimum + 0.5];
          result.push({ ts: mixed, go: `[]float64{${mixed.join(",")}}` });
        }
        if (constraints?.maxItems !== undefined && constraints.maxItems < 100) {
          const value = sample(type.items, arrayItemConstraints(constraints)); const count = constraints.maxItems + 1;
          result.push({ ts: Array.from({ length: count }, () => value.ts), go: `${goType(type)}{${Array.from({ length: count }, () => value.go).join(",")}}` });
        }
      }
      return result;
    }
    const checks: string[] = [];
    const branches = provider.request.kind === "union" ? provider.request.anyOf : [provider.request];
    function add(branch: SchemaType, request: Sample, label: string, items: { value: Sample; field: string }[] = []): void {
      let expected = "";
      const expectedItems: string[] = [];
      try {
        const check = validateRequest(request.ts);
        for (const { value, field } of items) {
          try { check(value.ts, field); expectedItems.push(""); }
          catch (error) { assert.ok(error instanceof TypeError); expectedItems.push(error.message); }
        }
      } catch (error) { assert.ok(error instanceof TypeError); expected = error.message; }
      const value = provider.request.kind === "union" ? `provider.${layout.variants.get(identity(provider.request))!.find(variant => identity(variant.schema) === identity(branch))!.wrapper}{Value: ${request.go}}` : request.go;
      checks.push(`{ ${items.length ? "check" : "_"}, err := provider.ValidateRequest(${value}); actual := ""; if err != nil { actual = err.Error() }; if actual != ${JSON.stringify(expected)} { t.Fatalf(${JSON.stringify(`${label}: got %q, expected %q`)}, actual, ${JSON.stringify(expected)}) }
${items.map((item, index) => `if err == nil { itemError := check(${item.value.go}, ${JSON.stringify(item.field)}); actual := ""; if itemError != nil { actual = itemError.Error() }; if actual != ${JSON.stringify(expectedItems[index] ?? "")} { t.Fatalf(${JSON.stringify(`${label}, input ${index}: got %q expected %q`)}, actual, ${JSON.stringify(expectedItems[index] ?? "")}) } }`).join("\n")}
}`);
      count++;
    }
    for (const [index, branch] of branches.entries()) {
      if (branch.kind !== "object") throw new Error("Expected request object");
      const base = sample(branch);
      validateRequest(base.ts);
      add(branch, base, `branch ${index}`);
      for (const field of branch.fields) {
        for (const [variant, value] of alternatives(field.type, field.constraints).entries()) {
          // A present nil Go union is invalid, not an omitted property or explicit null variant.
          const member = field.optional ? `runtime.Some(${goType(field.type)}(${value.go}))` : value.go;
          add(branch, { ts: { ...base.ts as object, [field.name]: value.ts }, go: `func() ${goType(branch)} { value := ${base.go}; value.${pascal(field.name)} = ${member}; return value }()` }, `branch ${index}, ${field.name}, case ${variant}`);
        }
        for (const part of field.type.kind === "union" ? field.type.anyOf : [field.type]) {
          if (part.kind !== "async-iterable") continue;
          const values = alternatives(part.items).filter(value => value.go !== "nil");
          values.push({ ts: false, go: "false" });
          const items = values.map(value => ({ value, field: field.name }));
          add(branch, base, `branch ${index}, initial input ${field.name}`, items);
          const input = sample(part);
          const streamed = field.type.kind === "union" ? `provider.${layout.variants.get(identity(field.type))!.find(variant => identity(variant.schema) === identity(part))!.wrapper}{Value: ${input.go}}` : input.go;
          const member = field.optional ? `runtime.Some(${goType(field.type)}(${streamed}))` : streamed;
          add(branch, { ts: { ...base.ts as object, [field.name]: input.ts }, go: `func() ${goType(branch)} { value := ${base.go}; value.${pascal(field.name)} = ${member}; return value }()` }, `branch ${index}, actual input ${field.name}`, items);
        }
      }
    }
    const directory = path.join(temporary, snake(provider.id)); mkdirSync(directory);
    writeFileSync(path.join(directory, "validation_test.go"), `package fixture
import (\nprovider "github.com/speechswitch/client/sdks/go/generated/${snake(provider.id)}"\n${[...imports].map(name => JSON.stringify(name)).join("\n")}\n)
type untouched[T any] struct{}
func (*untouched[T]) Next(context.Context) (T,error) { panic("validator advanced input") }
func (*untouched[T]) Close() error { panic("validator closed input") }
var _ runtime.Input[string] = &untouched[string]{}
${Array.from({ length: Math.ceil(checks.length / 32) }, (_, index) => `func TestRequestParity${index}(t *testing.T) {\n${checks.slice(index * 32, (index + 1) * 32).join("\n")}\n}`).join("\n")}
`);
  }
  const sources = [...patterns, "^(a?){3}$", "^(?:a|ab)*b$", "^(?!.*a).*$", "^(?:)*$", "[\\s\\S]?", "", "[^\\s\\S]"];
  const fixtures = patternFixtures(sources);
  const directory = path.join(temporary, "patterns"); mkdirSync(directory);
  writeFileSync(path.join(directory, "fixtures.json"), JSON.stringify({ inputs: fixtures.text.map(text => Array.from({ length: text.length }, (_, index) => text.charCodeAt(index))), expected: fixtures.patterns.map(pattern => pattern.expected) }));
  writeFileSync(path.join(directory, "patterns_test.go"), `package fixture
import ("encoding/json"; "os"; "testing")
${sources.map((source, index) => renderGoPattern(source, `pattern${index}`)).join("\n")}
func TestPatternParity(t *testing.T) {
    bytes, err := os.ReadFile("fixtures.json"); if err != nil { t.Fatal(err) }
    var fixture struct { Inputs [][]uint16; Expected [][]bool }
    if err := json.Unmarshal(bytes, &fixture); err != nil { t.Fatal(err) }
    patterns := []func([]uint16)bool{${sources.map((_, index) => `pattern${index}`).join(",")}}
    for pattern, check := range patterns { for input, units := range fixture.Inputs { if got := check(units); got != fixture.Expected[pattern][input] { t.Fatalf("pattern %d input %d: got %v expected %v", pattern, input, got, fixture.Expected[pattern][input]) } } }
}
`);
  const result = spawnSync("go", ["test", "-p", "2", "./..."], { cwd: temporary, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
  console.log(`Go/TypeScript validator parity: ${spec.tts.providers.length} providers, ${count} typed requests, ${patterns.size} schema patterns, ${sources.length * fixtures.text.length} pattern cases`);
} finally { rmSync(temporary, { recursive: true, force: true }); }
