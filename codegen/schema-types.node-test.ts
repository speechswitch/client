import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractSchemaTypes } from "./specgen.ts";

async function extract(source: string, names: readonly string[]) {
  const root = await mkdtemp(path.join(tmpdir(), "speechswitch-output-schema-"));
  try {
    await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, lib: ["ESNext"], types: [] }, include: ["*.ts"] }));
    await writeFile(path.join(root, "schema.ts"), source);
    return extractSchemaTypes({ root, tsconfig: "tsconfig.json", file: "schema.ts", names });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("named extraction uses concrete generic instantiations and preserves omission separately from null", async () => {
  const result = await extract('interface Mark<Kind extends string> { readonly kind: Kind; readonly end?: number | null } export type Timestamp = Mark<"word">; export type Stream = AsyncIterable<Timestamp | Uint8Array>;', ["Timestamp", "Stream"]);
  const timestamp = { kind: "object", fields: [
    { name: "end", optional: true, documentation: "", typeScriptType: "number | null | undefined", type: { kind: "union", anyOf: [{ kind: "literal", value: null }, { kind: "number" }] } },
    { name: "kind", optional: false, documentation: "", typeScriptType: '"word"', type: { kind: "literal", value: "word" } },
  ] };
  assert.deepEqual([...result], [
    ["Timestamp", timestamp],
    ["Stream", { kind: "async-iterable", items: { kind: "union", anyOf: [timestamp, { kind: "bytes" }] } }],
  ]);
});

test("empty tuples retain their exact shape from checker identity", async () => {
  const result = await extract("export type Empty = readonly []; export type Mutable = [];", ["Empty", "Mutable"]);
  assert.deepEqual([...result], [["Empty", { kind: "empty-tuple" }], ["Mutable", { kind: "empty-tuple" }]]);
});

for (const [source, names, message] of [
  ['export type Value = readonly [string];', ["Value"], "Speech spec: nonempty tuple types are not supported: Value"],
  ['export type Value = string;', ["Value", "Value"], "Speech spec: duplicate schema export Value"],
  ['export type Value = string;', ["Missing"], "Speech spec: Missing must be exported from schema.ts"],
  ['export type Value = { readonly required: number | undefined };', ["Value"], "Speech spec: undefined is only supported through optional properties"],
  ['export type Value = readonly (number | undefined)[];', ["Value"], "Speech spec: undefined is only supported through optional properties"],
] as const) {
  test(`named extraction rejects ${source} (${names.join(", ")}) exactly`, async () => {
    await assert.rejects(extract(source, names), { message });
  });
}
