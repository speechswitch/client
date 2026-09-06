import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function extract(source: string, names: readonly string[]) {
  const root = await mkdtemp(path.join(tmpdir(), "speechswitch-output-schema-"));
  try {
    await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, lib: ["ESNext"], types: [] }, include: ["*.ts"] }));
    await writeFile(path.join(root, "schema.ts"), source);
    const script = `import { extractSchemaTypes } from ${JSON.stringify(pathToFileURL(path.join(import.meta.dir, "specgen.ts")).href)};
try { console.log(JSON.stringify([...extractSchemaTypes({ root: process.argv[1], tsconfig: "tsconfig.json", file: "schema.ts", names: ${JSON.stringify(names)} })])); }
catch (error) { console.error(error.message); process.exitCode = 1; }`;
    // TypeScript 7's native checker runs under Node, never inside Bun/browser execution.
    const child = Bun.spawn(["node", "--input-type=module", "-e", script, root], { stdout: "pipe", stderr: "pipe" });
    const [status, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { status, output: (status === 0 ? stdout : stderr).trim() };
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("named extraction uses concrete generic instantiations and preserves omission separately from null", async () => {
  const result = await extract('interface Mark<Kind extends string> { readonly kind: Kind; readonly end?: number | null } export type Timestamp = Mark<"word">; export type Stream = AsyncIterable<Timestamp | Uint8Array>;', ["Timestamp", "Stream"]);
  expect(result.status, result.output).toBe(0);
  const timestamp = { kind: "object", fields: [
    { name: "end", optional: true, documentation: "", typeScriptType: "number | null | undefined", type: { kind: "union", anyOf: [{ kind: "literal", value: null }, { kind: "number" }] } },
    { name: "kind", optional: false, documentation: "", typeScriptType: '"word"', type: { kind: "literal", value: "word" } },
  ] };
  expect(JSON.parse(result.output)).toEqual([
    ["Timestamp", timestamp],
    ["Stream", { kind: "async-iterable", items: { kind: "union", anyOf: [timestamp, { kind: "bytes" }] } }],
  ]);
});

test.each([
  ['export type Value = string;', ["Value", "Value"], "Speech spec: duplicate schema export Value"],
  ['export type Value = string;', ["Missing"], "Speech spec: Missing must be exported from schema.ts"],
  ['export type Value = { readonly required: number | undefined };', ["Value"], "Speech spec: undefined is only supported through optional properties"],
  ['export type Value = readonly (number | undefined)[];', ["Value"], "Speech spec: undefined is only supported through optional properties"],
])("named extraction rejects invalid export %# exactly", async (source, names, output) => {
  expect(await extract(source, names)).toEqual({ status: 1, output });
});
