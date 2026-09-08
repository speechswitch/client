import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractSpeechSpec } from "./specgen.ts";
import { renderLanguageTypes } from "./language-types.ts";

const root = path.resolve(import.meta.dirname, "..");
const rust = path.join(root, "sdks/rust"); const go = path.join(root, "sdks/go"); const python = path.join(root, "sdks/python");
function run(command: string, args: string[], cwd: string, status = 0) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.status, status, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result;
}

run("cargo", ["build", "--offline", "--target-dir", path.join(rust, "target")], rust);
run("cargo", ["test", "--offline", "--target-dir", path.join(rust, "target")], rust);
run("go", ["test", "./..."], go);
run("pyright", [], python);
run("python3", ["-m", "compileall", "-q", "speechswitch"], python);
run("python3", ["-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"], python);

const rustErrors = run("rustc", ["--edition=2021", "--crate-type=lib", "--emit=metadata", "--out-dir", "target", "--extern", "speechswitch_types=target/debug/libspeechswitch_types.rlib", "--error-format=json", "tests/compile_fail/invalid.rs"], rust, 1);
assert.deepEqual(rustErrors.stderr.trim().split("\n").map(line => JSON.parse(line)).filter(error => error.level === "error" && error.code).map(error => ({ code: error.code.code, line: error.spans.find((span: { is_primary: boolean }) => span.is_primary).line_start })),
  [{ code: "E0609", line: 4 }, { code: "E0308", line: 7 }, { code: "E0308", line: 10 }]);

const pyErrors = JSON.parse(run("pyright", ["--outputjson", "tests/invalid.py"], python, 1).stdout);
assert.deepEqual(pyErrors.generalDiagnostics.map((error: { severity: string; rule: string; range: { start: { line: number } } }) => ({ severity: error.severity, rule: error.rule, line: error.range.start.line + 1 })),
  [4, 5, 6, 7, 8].map(line => ({ severity: "error", rule: "reportAssignmentType", line })));

const rustJsonErrors = run("rustc", ["--edition=2021", "--crate-type=lib", "--emit=metadata", "--out-dir", "target", "--extern", "speechswitch_types=target/debug/libspeechswitch_types.rlib", "--error-format=json", "tests/compile_fail/json.rs"], rust, 1);
assert.deepEqual(rustJsonErrors.stderr.trim().split("\n").map(line => JSON.parse(line)).filter(error => error.level === "error" && error.code).map(error => ({ code: error.code.code, line: error.spans.find((span: { is_primary: boolean }) => span.is_primary).line_start })), [{ code: "E0308", line: 2 }]);
const pyJsonErrors = JSON.parse(run("pyright", ["--outputjson", "tests/invalid_json.py"], python, 1).stdout);
assert.deepEqual(pyJsonErrors.generalDiagnostics.map((error: { severity: string; rule: string; range: { start: { line: number } } }) => ({ severity: error.severity, rule: error.rule, line: error.range.start.line + 1 })), [{ severity: "error", rule: "reportAssignmentType", line: 3 }]);
const goJsonErrors = run("go", ["test", "./testdata/invalidjson"], go, 1);
assert.equal(goJsonErrors.stderr, '# github.com/speechswitch/client/sdks/go/testdata/invalidjson\ntestdata/invalidjson/invalid.go:3:31: cannot use []byte{…} (value of type []byte) as "github.com/speechswitch/client/sdks/go/runtime".JsonValue value in variable declaration: []byte does not implement "github.com/speechswitch/client/sdks/go/runtime".JsonValue (missing method isJsonValue)\n');

const rustOpenaiErrors = run("rustc", ["--edition=2021", "--crate-type=lib", "--emit=metadata", "--out-dir", "target", "--extern", "speechswitch_types=target/debug/libspeechswitch_types.rlib", "--error-format=json", "tests/compile_fail/openai.rs"], rust, 1);
assert.deepEqual(rustOpenaiErrors.stderr.trim().split("\n").map(line => JSON.parse(line)).filter(error => error.level === "error" && error.code).map(error => ({ code: error.code.code, line: error.spans.find((span: { is_primary: boolean }) => span.is_primary).line_start })), [{ code: "E0609", line: 3 }]);
const pyOpenaiErrors = JSON.parse(run("pyright", ["--outputjson", "tests/invalid_openai.py"], python, 1).stdout);
assert.deepEqual(pyOpenaiErrors.generalDiagnostics.map((error: { severity: string; rule: string; range: { start: { line: number } } }) => ({ severity: error.severity, rule: error.rule, line: error.range.start.line + 1 })), [{ severity: "error", rule: "reportAssignmentType", line: 2 }]);
const goOpenaiErrors = run("go", ["test", "./testdata/invalidopenai"], go, 1);
assert.equal(goOpenaiErrors.stderr, '# github.com/speechswitch/client/sdks/go/testdata/invalidopenai\ntestdata/invalidopenai/invalid.go:4:13: request.Instructions undefined (type *openai.TtsRequestTextVoice15a214fc has no field or method Instructions)\n');

const rustStreamErrors = run("rustc", ["--edition=2021", "--crate-type=lib", "--emit=metadata", "--out-dir", "target", "--extern", "speechswitch_types=target/debug/libspeechswitch_types.rlib", "--error-format=json", "tests/compile_fail/stream.rs"], rust, 1);
assert.deepEqual(rustStreamErrors.stderr.trim().split("\n").map(line => JSON.parse(line)).filter(error => error.level === "error" && error.code).map(error => ({ code: error.code.code, line: error.spans.find((span: { is_primary: boolean }) => span.is_primary).line_start })),
  [{ code: "E0308", line: 3 }, { code: "E0308", line: 6 }, { code: "E0599", line: 9 }]);
const pyStreamErrors = JSON.parse(run("pyright", ["--outputjson", "tests/invalid_stream.py"], python, 1).stdout);
assert.deepEqual(pyStreamErrors.generalDiagnostics.map((error: { severity: string; rule: string; range: { start: { line: number } } }) => ({ severity: error.severity, rule: error.rule, line: error.range.start.line + 1 })),
  [2, 3, 4].map(line => ({ severity: "error", rule: "reportAssignmentType", line })));
const goStreamErrors = run("go", ["test", "./testdata/invalidstream"], go, 1);
assert.equal(goStreamErrors.stderr, `# github.com/speechswitch/client/sdks/go/testdata/invalidstream
testdata/invalidstream/invalid.go:3:57: cannot use "base64" (untyped string constant) as []byte value in struct literal
testdata/invalidstream/invalid.go:4:45: cannot use "cancel" (untyped string constant) as stream.ClearEventEvent value in struct literal
testdata/invalidstream/invalid.go:5:44: cannot use stream.AudioStreamItemAsBytes{…} (value of struct type stream.AudioStreamItemAsBytes) as stream.TimestampStreamItem value in variable declaration: stream.AudioStreamItemAsBytes does not implement stream.TimestampStreamItem (missing method isTimestampStreamItem)
`);

const goErrors = run("go", ["test", "./testdata/invalid"], go, 1);
assert.equal(goErrors.stderr, `# github.com/speechswitch/client/sdks/go/testdata/invalid
testdata/invalid/invalid.go:10:13: request.Instructions undefined (type *hume.TtsRequestOctave2TextVoice has no field or method Instructions)
testdata/invalid/invalid.go:12:68: cannot use "cancel" (untyped string constant) as xai.TtsRequestStreamingTextTextItemClearCommand value in variable declaration
testdata/invalid/invalid.go:14:12: cannot use input (variable of interface type "github.com/speechswitch/client/sdks/go/runtime".Input[xai.TtsRequestStreamingTextTextItem]) as "github.com/speechswitch/client/sdks/go/runtime".Input[string] value in return statement: "github.com/speechswitch/client/sdks/go/runtime".Input[xai.TtsRequestStreamingTextTextItem] does not implement "github.com/speechswitch/client/sdks/go/runtime".Input[string] (wrong type for method Next)
\t\thave Next(context.Context) (xai.TtsRequestStreamingTextTextItem, error)
\t\twant Next(context.Context) (string, error)
`);

// Compile uncommon shapes from real authored TypeScript too: nullable/optional
// values, byte arrays, unbounded integers, fractional literals and stream unions.
const spec = extractSpeechSpec({ root: path.join(root, "codegen/fixtures/languages"), tsconfig: "tsconfig.json", baseFile: "schema.ts", providers: [] });
const fixture = { kind: "object" as const, fields: spec.tts.request.fields };
const temporary = mkdtempSync(path.join(tmpdir(), "speechswitch-language-types-"));
try {
  for (const [language, extension] of [["rust", "rs"], ["go", "go"], ["python", "py"]] as const) {
    writeFileSync(path.join(temporary, `fixture.${extension}`), renderLanguageTypes(fixture, language, "fixture"));
  }
  writeFileSync(path.join(temporary, "main.rs"), `#[path = ${JSON.stringify(path.join(rust, "src/runtime.rs"))}] pub mod runtime;
mod fixture;
fn main() {
    assert_eq!(fixture::TtsRequestFractionalLiteral.value(), 0.25);
    assert_eq!(fixture::TtsRequestEscapedLiteral.value().as_bytes(), &[92, 117, 48, 48, 48, 48, 0]);
    let absent: Option<fixture::TtsRequestOptional> = None;
    let explicit_null = Some(fixture::TtsRequestOptional::Null(Default::default()));
    let explicit_false = Some(fixture::TtsRequestOptional::False(Default::default()));
    assert!(absent.is_none());
    assert!(matches!(explicit_null, Some(fixture::TtsRequestOptional::Null(_))));
    assert!(matches!(explicit_false, Some(fixture::TtsRequestOptional::False(_))));
}
`);
  run("rustc", ["--edition=2021", "-o", path.join(temporary, "fixture-rust"), path.join(temporary, "main.rs")], root);
  run(path.join(temporary, "fixture-rust"), [], root);
  writeFileSync(path.join(temporary, "fixture_test.go"), `package fixture
import ("testing"; "github.com/speechswitch/client/sdks/go/runtime")
func TestFixture(t *testing.T) {
    if (TtsRequestFractionalLiteral{}).Value() != 0.25 { t.Fatal("wrong literal") }
    if (TtsRequestEscapedLiteral{}).Value() != string([]byte{92, 117, 48, 48, 48, 48, 0}) { t.Fatal("wrong string escaping") }
    var omitted runtime.Optional[TtsRequestOptional]
    var null TtsRequestOptional = TtsRequestOptionalAsNull{}
    explicit := runtime.Some(null)
    if omitted.Present || !explicit.Present { t.Fatal("lost presence") }
}
`);
  run("go", ["test", path.join(temporary, "fixture.go"), path.join(temporary, "fixture_test.go")], go);
  run("pyright", ["--pythonversion", "3.13", path.join(temporary, "fixture.py")], python);
  run("python3", ["-c", `import sys; from typing import get_args; sys.path.insert(0, ${JSON.stringify(temporary)}); import fixture; assert fixture.TtsRequest.__optional_keys__ == frozenset({"optional"}); assert fixture.TtsRequest.__required_keys__ == frozenset({"required_nullable", "bytes", "integer", "fractional_literal", "escaped_literal", "items", "text"}); assert fixture.TtsRequestFractionalLiteral.VALUE.value == 0.25; assert get_args(fixture.TtsRequestEscapedLiteral.__value__) == (bytes([92, 117, 48, 48, 48, 48, 0]).decode(),)`], python);
} finally { rmSync(temporary, { recursive: true, force: true }); }
console.log("Rust, Python and Go compile; HTTP lifecycle tests, output streams, runtime primitives, uncommon schema shapes and all 26 expected type errors pass.");
