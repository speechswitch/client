import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const rust = path.join(root, "sdks/rust");
const directory = mkdtempSync(path.join(tmpdir(), "speechswitch-rust-json-"));
try {
  const seeds = ["", "null", "true", "false", "0", "-0", "-12.5e+3", "1e400", "1e-400", "[]", "{}", '[0,true,null,"x"]', '{"a":1,"b":[{}]}', '{"a":1,"\\u0061":2}', '"hello"', '"π🚀"', '"\\ud800"', '"\\ud83d\\ude80"', '"\\ud800\\u0061"', '"\\n\\r\\t\\b\\f\\\\\\/\\\""'];
  const cases = new Set(seeds);
  for (const seed of seeds) {
    for (let index = 0; index <= seed.length; index++) {
      cases.add(seed.slice(0, index) + seed.slice(index + 1));
      for (const inserted of ['[', ']', '{', '}', ',', ':', '"', '\\', '\n', '\t', ' ', '-', '+', '0', 'a']) {
        cases.add(seed.slice(0, index) + inserted + seed.slice(index));
      }
    }
    for (const space of [" ", "\t", "\r\n", "\u00a0", "\u2028", "\ufeff"]) cases.add(space + seed + space);
  }
  for (let code = 0; code < 256; code++) {
    const character = String.fromCharCode(code);
    cases.add('"' + character + '"');
    cases.add(JSON.stringify(character));
    cases.add('"\\u' + code.toString(16).padStart(4, "0") + '"');
  }
  for (const high of [0xd7ff, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xe000]) {
    for (const low of [0, 0xd7ff, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xe000]) {
      cases.add('"\\u' + high.toString(16).padStart(4, "0") + '\\u' + low.toString(16).padStart(4, "0") + '"');
    }
  }
  const source = `
use std::io::{Read, Write};
mod runtime { pub use speechswitch_types::runtime::JsonValue; }
#[path = ${JSON.stringify(path.join(rust, "src/json.rs"))}] mod json;
fn main() {
    let mut input = Vec::new(); std::io::stdin().read_to_end(&mut input).unwrap();
    let mut cursor = 0; let mut output = Vec::new();
    while cursor < input.len() {
        let length = u32::from_le_bytes(input[cursor..cursor + 4].try_into().unwrap()) as usize;
        cursor += 4;
        let text = std::str::from_utf8(&input[cursor..cursor + length]).unwrap(); cursor += length;
        match json::Raw::parse(text) {
            Err(_) => output.push(0),
            Ok(value) => match value.string() {
                Err(_) => output.push(1),
                Ok(text) => {
                    output.push(2);
                    output.extend((text.len() as u32).to_le_bytes()); output.extend(text.as_bytes());
                }
            },
        }
    }
    std::io::stdout().write_all(&output).unwrap();
}
`;
  const sourcePath = path.join(directory, "json_check.rs");
  const binary = path.join(directory, "json_check");
  writeFileSync(sourcePath, source);
  const compiled = spawnSync("rustc", ["--edition=2021", "-A", "dead_code", "--extern", `speechswitch_types=${path.join(rust, "target/debug/libspeechswitch_types.rlib")}`, sourcePath, "-o", binary], { encoding: "utf8" });
  if (compiled.error) throw compiled.error;
  assert.equal(compiled.status, 0, compiled.stderr);
  const inputs = [...cases].map(text => Buffer.from(text));
  const records = inputs.flatMap(input => { const length = Buffer.alloc(4); length.writeUInt32LE(input.length); return [length, input]; });
  const result = spawnSync(binary, [], { input: Buffer.concat(records), maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr.toString());
  let cursor = 0;
  for (const input of inputs) {
    const text = input.toString();
    let expected: { valid: boolean; text?: string };
    try {
      const value: unknown = JSON.parse(text);
      expected = typeof value === "string" ? { valid: true, text: value.toWellFormed() } : { valid: true };
    } catch { expected = { valid: false }; }
    const tag = result.stdout[cursor++];
    let actual: { valid: boolean; text?: string } = { valid: tag !== 0 };
    if (tag === 2) {
      const length = result.stdout.readUInt32LE(cursor); cursor += 4;
      actual = { valid: true, text: result.stdout.subarray(cursor, cursor + length).toString() }; cursor += length;
    }
    assert.deepEqual(actual, expected, JSON.stringify(text));
  }
  assert.equal(cursor, result.stdout.length);
  console.log(`Rust wire JSON matches Node syntax and string decoding for ${inputs.length} cases.`);
} finally { rmSync(directory, { recursive: true, force: true }); }
