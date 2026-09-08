import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { compileLanguageTypes, identity, snake } from "./language-types.ts";
import { extractRepositorySpeechSpec } from "./repository-spec.ts";
import { renderRustPattern } from "./rust-pattern.ts";
import { patternFixtures } from "./pattern-fixtures.ts";
import type { SchemaConstraints, SchemaType } from "./spec-model.ts";

const root = path.resolve(import.meta.dirname, "..");
const spec = extractRepositorySpeechSpec(root);
const temporary = mkdtempSync(path.join(tmpdir(), "speechswitch-rust-validation-"));
const patterns = new Set<string>();
let count = 0;
interface Sample { readonly ts: unknown; readonly rust: string }
function quoted(value: string): string {
  return JSON.stringify(value).replace(/\\(?:u([0-9a-f]{4})|b|f|[\s\S])/gi, (escape, hex: string | undefined) => hex ? `\\u{${hex}}` : escape === "\\b" ? "\\u{8}" : escape === "\\f" ? "\\u{c}" : escape);
}
function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd: temporary, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, `${command}\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
}
try {
  // Build the real generated validators once, then compile each typed fixture
  // independently to keep compiler memory bounded for providers with many models.
  run("cargo", ["build", "--offline", "--manifest-path", path.join(root, "sdks/rust/Cargo.toml")]);
  for (const provider of spec.tts.providers) {
    const layout = compileLanguageTypes(provider.request, "rust", provider.id);
    const { validateRequest } = await import(pathToFileURL(path.join(root, `sdk/generated/validators/${provider.id}.ts`)).href) as { validateRequest(value: unknown): (item: unknown, field?: string) => void };
    function rustType(type: SchemaType): string {
      switch (type.kind) {
        case "string": return "String";
        case "number": return "f64";
        case "boolean": return "bool";
        case "bigint": return "runtime::BigInt";
        case "bytes": return "Vec<u8>";
        case "json-value": return "runtime::JsonValue";
        case "array": return `Vec<${rustType(type.items)}>`;
        case "record": return `std::collections::BTreeMap<String, ${rustType(type.values)}>`;
        case "async-iterable": return `runtime::StreamingInput<${rustType(type.items)}>`;
        default: return `provider::${layout.names.get(identity(type))!}`;
      }
    }
    function sample(type: SchemaType, constraints?: SchemaConstraints): Sample {
      if (constraints?.pattern) patterns.add(constraints.pattern);
      switch (type.kind) {
        case "literal": return { ts: type.value, rust: rustType(type) };
        case "string": {
          const value = ["a", "en", "en-US", "1", "tc_voice"].find(value => !constraints?.pattern || new RegExp(constraints.pattern).test(value));
          assert.notEqual(value, undefined); return { ts: value, rust: `${quoted(value!)}.to_string()` };
        }
        case "number": { const value = Math.max(constraints?.minimum ?? 0, constraints?.exclusiveMinimum === undefined ? 0 : constraints.exclusiveMinimum + 1); return { ts: value, rust: `${value}_f64` }; }
        case "boolean": return { ts: false, rust: "false" };
        case "bigint": return { ts: 123n, rust: '"123".parse().unwrap()' };
        case "bytes": return { ts: Uint8Array.of(1, 2), rust: "vec![1,2]" };
        case "json-value": return { ts: { value: [null, false, 0] }, rust: 'runtime::JsonValue::Object(std::collections::BTreeMap::from([("value".to_string(), runtime::JsonValue::Array(vec![runtime::JsonValue::Null, runtime::JsonValue::Bool(false), runtime::JsonValue::Number(0.0)]))]))' };
        case "async-iterable": return { ts: { [Symbol.asyncIterator]() { throw new Error("input acquired"); } }, rust: "Box::pin(Untouched)" };
        case "union": {
          const variant = layout.variants.get(identity(type))![0]!; const value = sample(variant.schema, constraints);
          return { ts: value.ts, rust: `${rustType(type)}::${variant.name}(${value.rust})` };
        }
        case "array": {
          const value = sample(type.items); const count = Math.max(1, constraints?.minItems ?? 0);
          return { ts: Array.from({ length: count }, () => value.ts), rust: `vec![${Array.from({ length: count }, () => value.rust).join(",")}]` };
        }
        case "record": { const value = sample(type.values); return { ts: { key: value.ts }, rust: `std::collections::BTreeMap::from([("key".to_string(), ${value.rust})])` }; }
        case "object": {
          const fields = type.fields.map(field => ({ field, value: field.optional ? null : sample(field.type, field.constraints) }));
          return { ts: Object.fromEntries(fields.flatMap(({ field, value }) => value ? [[field.name, value.ts]] : [])), rust: `${rustType(type)} { ${fields.map(({ field, value }) => `${snake(field.name)}: ${value?.rust ?? "None"}`).join(",")} }` };
        }
      }
    }
    function alternatives(type: SchemaType, constraints?: SchemaConstraints): Sample[] {
      const result = [sample(type, constraints)];
      if (type.kind === "number") {
        for (const value of [-1, 0, 0.5, 1, (constraints?.minimum ?? 0) - 1, (constraints?.maximum ?? 1) + 1]) result.push({ ts: value, rust: `${value}_f64` });
        result.push({ ts: NaN, rust: "f64::NAN" }, { ts: Infinity, rust: "f64::INFINITY" });
      } else if (type.kind === "string") {
        for (const value of ["", "\n", "😀", "a".repeat((constraints?.maxLength ?? 2) + 1)]) result.push({ ts: value, rust: `${quoted(value)}.to_string()` });
      } else if (type.kind === "union") {
        for (const variant of layout.variants.get(identity(type))!) {
          const value = sample(variant.schema, constraints);
          result.push({ ts: value.ts, rust: `${rustType(type)}::${variant.name}(${value.rust})` });
        }
      } else if (type.kind === "array") {
        result.push({ ts: [], rust: "vec![]" });
        if (constraints?.maxItems !== undefined && constraints.maxItems < 100) {
          const value = sample(type.items); const count = constraints.maxItems + 1;
          result.push({ ts: Array.from({ length: count }, () => value.ts), rust: `vec![${Array.from({ length: count }, () => value.rust).join(",")}]` });
        }
      }
      return result;
    }
    const checks: string[] = [];
    const branches = provider.request.kind === "union" ? provider.request.anyOf : [provider.request];
    function add(branch: SchemaType, request: Sample, label: string, items: { value: Sample; field: string }[] = []): void {
      let expected = ""; const expectedItems: string[] = [];
      try {
        const check = validateRequest(request.ts);
        for (const { value, field } of items) {
          try { check(value.ts, field); expectedItems.push(""); }
          catch (error) { assert.ok(error instanceof TypeError); expectedItems.push(error.message); }
        }
      } catch (error) { assert.ok(error instanceof TypeError); expected = error.message; }
      const value = provider.request.kind === "union" ? `provider::TtsRequest::${layout.variants.get(identity(provider.request))!.find(variant => identity(variant.schema) === identity(branch))!.name}(${request.rust})` : request.rust;
      checks.push(`{ let request = ${value}; let result = validator::validate_request(&request); let actual = result.as_ref().err().map_or("", |error| error.0.as_str()); assert_eq!(actual, ${quoted(expected)}, ${quoted(label)});
${items.length ? `if let Ok(check) = result { ${items.map((item, index) => `let item = ${item.value.rust}; let actual = check(&item, Some(${quoted(item.field)})).err().map_or_else(String::new, |error| error.0); assert_eq!(actual, ${quoted(expectedItems[index] ?? "")}, ${quoted(`${label}, input ${index}`)});`).join("\n")} }` : ""}
}`);
      count++;
    }
    for (const [index, branch] of branches.entries()) {
      if (branch.kind !== "object") throw new Error("Expected request object");
      const base = sample(branch); validateRequest(base.ts); add(branch, base, `branch ${index}`);
      for (const field of branch.fields) {
        for (const [variant, value] of alternatives(field.type, field.constraints).entries()) {
          add(branch, { ts: { ...base.ts as object, [field.name]: value.ts }, rust: `{ let mut value = ${base.rust}; value.${snake(field.name)} = ${field.optional ? `Some(${value.rust})` : value.rust}; value }` }, `branch ${index}, ${field.name}, case ${variant}`);
        }
        for (const part of field.type.kind === "union" ? field.type.anyOf : [field.type]) {
          if (part.kind !== "async-iterable") continue;
          const values = alternatives(part.items); values.push({ ts: false, rust: "false" });
          const items = values.map(value => ({ value, field: field.name }));
          add(branch, base, `branch ${index}, initial input ${field.name}`, items);
          const input = sample(part);
          const streamed = field.type.kind === "union" ? `${rustType(field.type)}::${layout.variants.get(identity(field.type))!.find(variant => identity(variant.schema) === identity(part))!.name}(${input.rust})` : input.rust;
          add(branch, { ts: { ...base.ts as object, [field.name]: input.ts }, rust: `{ let mut value = ${base.rust}; value.${snake(field.name)} = ${field.optional ? `Some(${streamed})` : streamed}; value }` }, `branch ${index}, actual input ${field.name}`, items);
        }
      }
    }
    const file = path.join(temporary, `${snake(provider.id)}.rs`);
    writeFileSync(file, `use speechswitch_types::{generated::{${snake(provider.id)} as provider, validators::${snake(provider.id)} as validator}, runtime};
struct Untouched;
impl<T> runtime::InputStream<T> for Untouched {
    fn poll_next(self: std::pin::Pin<&mut Self>, _: &mut std::task::Context<'_>) -> std::task::Poll<Option<Result<T, Box<dyn std::error::Error + Send + Sync>>>> { panic!("validator advanced input") }
}
${Array.from({ length: Math.ceil(checks.length / 32) }, (_, index) => `#[test] fn request_parity_${index}() {\n${checks.slice(index * 32, (index + 1) * 32).join("\n")}\n}`).join("\n")}
`);
    const executable = path.join(temporary, "requests");
    run("rustc", ["--edition=2021", "--test", "--extern", `speechswitch_types=${path.join(root, "sdks/rust/target/debug/libspeechswitch_types.rlib")}`, "-o", executable, file]);
    run(executable, []);
  }
  const sources = [...patterns, "^(a?){3}$", "^(?:a|ab)*b$", "^(?!.*a).*$", "^(?:)*$", "[\\s\\S]?", "", "[^\\s\\S]"];
  const fixtures = patternFixtures(sources);
  const chunks = fixtures.text.map((text, index) => {
    const bytes = Buffer.alloc(4 + text.length * 2 + sources.length); bytes.writeUInt32LE(text.length);
    for (let unit = 0; unit < text.length; unit++) bytes.writeUInt16LE(text.charCodeAt(unit), 4 + unit * 2);
    for (let pattern = 0; pattern < sources.length; pattern++) bytes[4 + text.length * 2 + pattern] = Number(fixtures.patterns[pattern]!.expected[index]);
    return bytes;
  });
  writeFileSync(path.join(temporary, "patterns.bin"), Buffer.concat(chunks));
  const patternFile = path.join(temporary, "patterns.rs");
  writeFileSync(patternFile, `${sources.map((source, index) => renderRustPattern(source, `pattern${index}`)).join("\n")}
#[test] fn pattern_parity() {
    let mut fixture = include_bytes!("patterns.bin").as_slice();
    let patterns: &[fn(&[u16]) -> bool] = &[${sources.map((_, index) => `pattern${index}`).join(",")}];
    let mut input = 0;
    while !fixture.is_empty() {
        let length = u32::from_le_bytes(fixture[..4].try_into().unwrap()) as usize;
        let units: Vec<_> = fixture[4..4 + length * 2].chunks_exact(2).map(|bytes| u16::from_le_bytes([bytes[0], bytes[1]])).collect();
        let expected = &fixture[4 + length * 2..4 + length * 2 + patterns.len()];
        for (pattern, check) in patterns.iter().enumerate() { assert_eq!(check(&units), expected[pattern] != 0, "pattern {} input {}", pattern, input); }
        input += 1; fixture = &fixture[4 + length * 2 + patterns.len()..];
    }
    assert_eq!(input, ${fixtures.text.length});
}
`);
  run("rustc", ["--edition=2021", "--test", "-D", "warnings", "-o", path.join(temporary, "patterns"), patternFile]);
  run(path.join(temporary, "patterns"), []);
  console.log(`Rust/TypeScript validator parity: ${spec.tts.providers.length} providers, ${count} typed requests, ${patterns.size} schema patterns, ${sources.length * fixtures.text.length} pattern cases`);
} finally { rmSync(temporary, { recursive: true, force: true }); }
