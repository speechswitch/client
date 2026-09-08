import { expect } from "expect";
import { afterEach, test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { extractSpeechSpec } from "./specgen.ts";
import { renderRequestValidator } from "./request-validator.ts";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

const base = `export type TtsRequest = {
  /** Streaming input. */ readonly text?: AsyncIterable<{ readonly command: "clear" } | { readonly command: "flush" }>;
  /** Model. */ readonly model?: string;
  /** Voice consistency. */ readonly stability?: number;
  /** Audio representation. */ readonly output?: { readonly format: "mp3" | "pcm" };
  /** Nested data. */ readonly data?: { readonly bytes: Uint8Array; readonly labels: readonly string[]; readonly note: string | null };
};`;
async function generated(source: string) {
  const root = await mkdtemp(path.join(tmpdir(), "speechswitch-validator-")); directories.push(root);
  await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, lib: ["ESNext"], types: [] }, include: ["*.ts"] }));
  await writeFile(path.join(root, "base.ts"), base); await writeFile(path.join(root, "provider.ts"), source);
  const spec = extractSpeechSpec({ root, tsconfig: "tsconfig.json", baseFile: "base.ts", providers: [{ id: "fixture", file: "provider.ts" }] });
  const code = renderRequestValidator(spec.tts.providers[0]!);
  const output = path.join(root, "validator.mts");
  await writeFile(output, code);
  const module = await import(pathToFileURL(output).href);
  return { defaults: module.requestDefaults, validate: module.validateRequest as (value: unknown) => (item: unknown) => void };
}

const requestSchema = `export type TtsRequest = {
  /** @default 0.5 @minimum 0 @maximum 1 */ readonly stability?: number;
  readonly data: { readonly bytes: Uint8Array; readonly labels: readonly string[]; readonly note: string | null };
  readonly model?: never;
  readonly output: { readonly format: "mp3" };
};`;

test("exports defaults and accepts valid requests without mutating them", async () => {
  const { validate, defaults } = await generated(requestSchema);
  const request = { data: { bytes: new Uint8Array(), labels: ["hello"], note: null }, output: { format: "mp3" } };
  expect(defaults).toStrictEqual({ stability: 0.5 });
  expect(() => validate(request)).not.toThrow();
  expect(request).not.toHaveProperty("stability");
  expect(() => validate({ ...request, stability: undefined, model: undefined })).not.toThrow();
});

test("accumulates errors across fields and array items, discarding failed alternatives of a valid union", async () => {
  const { validate } = await generated(requestSchema);
  expect(() => validate({ stability: 2, data: { bytes: [], labels: [null, 42], note: null }, model: "tts" })).toThrow(new TypeError(`Invalid fixture TTS request:
request["data"]["bytes"]: expected Uint8Array
request["data"]["labels"][0]: expected string
request["data"]["labels"][1]: expected string
request["output"]: required field
request["stability"]: expected number <= 1
request["model"]: field is not allowed`));
});

test("reports invalid containers without trying to validate their children", async () => {
  const { validate } = await generated(requestSchema);
  expect(() => validate({ data: null, output: { format: "pcm" } })).toThrow(new TypeError(`Invalid fixture TTS request:
request["data"]: expected object
request["output"]["format"]: expected "mp3"`));
});

test("restricts streaming commands to the selected model without opening the input iterator", async () => {
  const { validate } = await generated(`export type TtsRequest =
    | { readonly model: "tts"; readonly text: AsyncIterable<{ readonly command: "clear" }> }
    | { readonly model: "dialogue"; readonly text: AsyncIterable<{ readonly command: "flush" }> };`);
  const text = { [Symbol.asyncIterator]() { throw new Error("Validation must not open the input iterator"); } };
  const tts = validate({ model: "tts", text });
  expect(() => tts({ command: "clear" })).not.toThrow();
  const dialogue = validate({ model: "dialogue", text });
  expect(() => dialogue({ command: "flush" })).not.toThrow();
  expect(() => dialogue({ command: "clear" })).toThrow(new TypeError(`Invalid fixture TTS input item:
text item["command"]: expected "flush"`));
});

test("accepts items from either matching variant and keeps errors local to each item", async () => {
  const { validate } = await generated(`export type TtsRequest =
    | { readonly text: AsyncIterable<{ readonly command: "clear" }> }
    | { readonly text: AsyncIterable<{ readonly command: "flush" }> };`);
  const check = validate({ text: (async function* () {})() });
  expect(() => check({ command: "flush" })).not.toThrow();
  expect(() => check({ command: "unknown" })).toThrow(new TypeError(`Invalid fixture TTS input item:
text item["command"]: expected "clear"
text item["command"]: expected "flush"`));
  expect(() => check({ command: "clear" })).not.toThrow();
});
