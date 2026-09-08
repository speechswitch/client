import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { extractRepositorySpeechSpec } from "./repository-spec.ts";
import { snake } from "./language-types.ts";
import { patternFixtures } from "./pattern-fixtures.ts";
import { extractSchemaTypes } from "./specgen.ts";
import { renderPythonValidator } from "./python-validator.ts";
import type { SchemaConstraints, SchemaType } from "./spec-model.ts";

const root = path.resolve(import.meta.dirname, "..");
const spec = extractRepositorySpeechSpec(root);
interface Pair { readonly ts: unknown; readonly py: unknown }
const stream: Pair = { ts: { [Symbol.asyncIterator]() { throw new Error("Validator acquired input"); } }, py: { $stream: true } };
const patterns = new Set<string>();
function sample(type: SchemaType, constraints?: SchemaConstraints): Pair {
  switch (type.kind) {
    case "literal": return { ts: type.value, py: type.value };
    case "string": {
      const value = ["a", "en", "en-US", "1", "tc_voice"].find(value => !constraints?.pattern || new RegExp(constraints.pattern).test(value));
      assert.notEqual(value, undefined, "Add a valid fixture candidate for the new pattern");
      return { ts: value, py: value };
    }
    case "number": {
      let value = Math.max(constraints?.minimum ?? 0, constraints?.exclusiveMinimum === undefined ? 0 : constraints.exclusiveMinimum + 1);
      if (constraints?.integer) value = Math.ceil(value);
      return { ts: value, py: value };
    }
    case "boolean": return { ts: false, py: false };
    case "bigint": return { ts: 123n, py: { $bigint: "123" } };
    case "bytes": return { ts: Uint8Array.of(1, 2), py: { $bytes: [1, 2] } };
    case "async-iterable": return stream;
    case "json-value": return { ts: { nested: [false, null, 0, ""] }, py: { nested: [false, null, 0, ""] } };
    case "union": return sample(type.anyOf[0]!, constraints);
    case "array": {
      const item = sample(type.items); const count = Math.max(1, constraints?.minItems ?? 0);
      return { ts: Array.from({ length: count }, () => item.ts), py: Array.from({ length: count }, () => item.py) };
    }
    case "record": { const item = sample(type.values); return { ts: { preservedKey: item.ts }, py: { preservedKey: item.py } }; }
    case "object": {
      const fields = type.fields.filter(field => !field.optional).map(field => ({ name: field.name, value: sample(field.type, field.constraints) }));
      return { ts: Object.fromEntries(fields.map(field => [field.name, field.value.ts])), py: Object.fromEntries(fields.map(field => [snake(field.name), field.value.py])) };
    }
  }
}
function visit(type: SchemaType): void {
  if (type.kind === "object") for (const field of type.fields) { if (field.constraints?.pattern) patterns.add(field.constraints.pattern); visit(field.type); }
  else if (type.kind === "union") type.anyOf.forEach(visit);
  else if (type.kind === "array" || type.kind === "async-iterable") visit(type.items);
  else if (type.kind === "record") visit(type.values);
}
const cases: { module: string; value: unknown; items: { value: unknown; field: string }[]; expected: string[]; label: string }[] = [];
for (const provider of spec.tts.providers) {
  visit(provider.request);
  const { validateRequest } = await import(pathToFileURL(path.join(root, `sdk/generated/validators/${provider.id}.ts`)).href) as {
    validateRequest(value: unknown): (item: unknown, field?: string) => void;
  };
  function add(value: Pair, label: string, items: { value: Pair; field: string }[] = [], valid = false): void {
    const expected: string[] = [];
    try {
      const check = validateRequest(value.ts); expected.push("valid");
      for (const item of items) {
        try { check(item.value.ts, item.field); expected.push("valid"); }
        catch (error) { assert.ok(error instanceof TypeError); expected.push(error.message); }
      }
    } catch (error) { assert.ok(error instanceof TypeError); expected.push(error.message); }
    if (valid) assert.equal(expected[0], "valid", `${provider.id} ${label}: invalid fixture seed`);
    cases.push({ module: snake(provider.id), value: value.py, items: items.map(item => ({ value: item.value.py, field: snake(item.field) })), expected, label: `${provider.id} ${label}` });
  }
  const branches = provider.request.kind === "union" ? provider.request.anyOf : [provider.request];
  for (const [index, branch] of branches.entries()) {
    assert.equal(branch.kind, "object"); if (branch.kind !== "object") throw new Error("Expected object request");
    const request = sample(branch);
    const fields = branch.fields;
    const inputs: { value: Pair; field: string }[] = [];
    for (const field of fields) for (const part of field.type.kind === "union" ? field.type.anyOf : [field.type]) {
      if (part.kind !== "async-iterable") continue;
      for (const item of part.items.kind === "union" ? part.items.anyOf : [part.items]) inputs.push({ value: sample(item), field: field.name });
      for (const value of [null, true, 1, { command: "unknown" }, { command: "update" }]) inputs.push({ value: { ts: value, py: value }, field: field.name });
    }
    add(request, `branch ${index}`, inputs, true);
    for (const field of fields) {
      const values: Pair[] = [sample(field.type, field.constraints), ...[null, true, 0, -1, 0.5, "", [], {}].map(value => ({ ts: value, py: value }))];
      if (field.constraints?.minimum !== undefined) values.push({ ts: field.constraints.minimum - 1, py: field.constraints.minimum - 1 });
      if (field.constraints?.maximum !== undefined) values.push({ ts: field.constraints.maximum + 1, py: field.constraints.maximum + 1 });
      for (const [variant, value] of values.entries()) add({ ts: { ...request.ts as object, [field.name]: value.ts }, py: { ...request.py as object, [snake(field.name)]: value.py } }, `branch ${index} field ${field.name} case ${variant}`);
    }
    for (const field of branch.forbidden ?? []) add({ ts: { ...request.ts as object, [field]: false }, py: { ...request.py as object, [snake(field)]: false } }, `branch ${index} forbidden ${field}`);
  }
}
const { text, patterns: patternCases } = patternFixtures(patterns);
const result = spawnSync("python3", ["-c", `
import importlib, json, re, sys
from speechswitch.validation import utf16_units
class Input:
    def __aiter__(self):
        raise AssertionError("validator acquired input")
def decode(value):
    if isinstance(value, list): return [decode(item) for item in value]
    if isinstance(value, dict):
        if "$stream" in value: return Input()
        if "$bytes" in value: return bytes(value["$bytes"])
        if "$bigint" in value: return int(value["$bigint"])
        return {key: decode(item) for key, item in value.items()}
    return value
payload = json.load(sys.stdin)
for case in payload["cases"]:
    actual = []
    try:
        check = importlib.import_module("speechswitch.generated.validators." + case["module"]).validate_request(decode(case["value"]))
        actual.append("valid")
        for item in case["items"]:
            try:
                check(decode(item["value"]), item["field"])
                actual.append("valid")
            except TypeError as error: actual.append(str(error))
    except TypeError as error: actual.append(str(error))
    assert actual == case["expected"], (case["label"], actual, case["expected"])
for case in payload["patterns"]:
    pattern = re.compile(case["translated"])
    for value, expected in zip(payload["text"], case["expected"], strict=True):
        actual = pattern.search(utf16_units(value)) is not None
        assert actual == expected, (case["source"], repr(value[:50]), len(value), actual, expected)
print(json.dumps({"providers": len({case["module"] for case in payload["cases"]}), "requests": len(payload["cases"]), "patterns": len(payload["patterns"]), "patternCases": len(payload["patterns"]) * len(payload["text"])}))
`], { cwd: path.join(root, "sdks/python"), encoding: "utf8", input: JSON.stringify({ cases, patterns: patternCases, text }), maxBuffer: 1024 * 1024 });
assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
console.log(`Python/TypeScript validator parity: ${result.stdout.trim()}`);

const diagnostic = extractSchemaTypes({ root: path.join(root, "codegen/fixtures/languages"), tsconfig: "tsconfig.json", file: "schema.ts", names: ["DiagnosticRequest"] }).get("DiagnosticRequest")!;
const diagnostics = spawnSync("python3", ["-c", renderPythonValidator({ id: "diagnostics", request: diagnostic }) + String.raw`
class Input:
    def __aiter__(self): raise AssertionError("input acquired")
class Indexed(list):
    def __iter__(self): raise AssertionError("custom collection iterator acquired")
def rejected(call, expected):
    try: call()
    except TypeError as error: assert str(error) == expected, (str(error), expected)
    else: raise AssertionError("invalid value accepted")
request = dict(choice={"mode": "pcm"}, labels=["ok"], sample_rate_hz=1, text=Input())
check = validate_request(request)
check("valid")
rejected(lambda: validate_request({**request, "labels": Indexed([False, "ok", None]), "sample_rate_hz": -0.5}),
    'Invalid diagnostics TTS request:\nrequest["labels"][0]: expected string\nrequest["labels"][2]: expected string\nrequest["labels"]: expected at most 2 items\nrequest["sampleRateHz"]: expected number >= 1\nrequest["sampleRateHz"]: expected safe integer')
rejected(lambda: validate_request({**request, "metadata": {'a"b': False}, "sample_rate_hz": 11}),
    'Invalid diagnostics TTS request:\nrequest["metadata"]["a\\"b"]: expected finite number\nrequest["sampleRateHz"]: expected number <= 10')
rejected(lambda: check({"command": "update", "speed": 0}),
    'Invalid diagnostics TTS input item:\ntext item: expected string\ntext item["speed"]: expected number >= 0.5')
check({"command": "update", "speed": 1})
rejected(lambda: check(None), 'Invalid diagnostics TTS input item:\ntext item: expected string\ntext item: expected object')
check("still valid")
rejected(lambda: validate_request({**request, "labels": False, "sample_rate_hz": 11}),
    'Invalid diagnostics TTS request:\nrequest["labels"]: expected array\nrequest["sampleRateHz"]: expected number <= 10')
rejected(lambda: validate_request({key: value for key, value in request.items() if key != "sample_rate_hz"}),
    'Invalid diagnostics TTS request:\nrequest["sampleRateHz"]: required field')
print("Python accumulated diagnostic fixtures pass")
`], { cwd: path.join(root, "sdks/python"), encoding: "utf8" });
assert.equal(diagnostics.status, 0, `${diagnostics.error ?? ""}\n${diagnostics.stdout}\n${diagnostics.stderr}`);
console.log(diagnostics.stdout.trim());
