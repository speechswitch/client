import assert from "node:assert/strict";
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
  /** Streaming input. */ readonly text?: string | AsyncIterable<string | { readonly command: "clear" } | { readonly command: "flush" }>;
  /** Model. */ readonly model?: string;
  /** Buffer text. */ readonly textBuffering?: boolean;
  /** Character thresholds. */ readonly textBufferThresholds?: readonly number[];
  /** Voice consistency. */ readonly stability?: number;
  /** Audio representation. */ readonly output?: { readonly format: "mp3" | "pcm"; readonly sampleRateHz?: number };
  /** Nested data. */ readonly data?: { readonly bytes: Uint8Array; readonly labels: readonly string[]; readonly note: string | null };
};`;
const provider = `
interface Common {
  /** @minimum 0 @maximum 1 */ readonly stability?: number;
  readonly output: { readonly format: "mp3"; readonly sampleRateHz?: 24000 };
  readonly data?: { readonly bytes: Uint8Array; readonly labels: readonly string[]; readonly note: string | null };
}
interface Buffered extends Common { readonly model: "tts"; readonly text: AsyncIterable<string | { readonly command: "clear" } | { readonly command: "flush" }>; readonly textBuffering?: true; readonly textBufferThresholds?: readonly number[]; }
interface Unbuffered extends Common { readonly model: "tts"; readonly text: AsyncIterable<string | { readonly command: "clear" } | { readonly command: "flush" }>; readonly textBuffering: false; readonly textBufferThresholds?: never; }
interface Dialogue extends Common { readonly model: "dialogue"; readonly text: AsyncIterable<string | { readonly command: "flush" }>; readonly textBuffering?: never; readonly textBufferThresholds?: never; }
export type TtsRequest = Buffered | Unbuffered | Dialogue;
`;

async function generated(source: string) {
  const root = await mkdtemp(path.join(tmpdir(), "speechswitch-validator-")); directories.push(root);
  await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, lib: ["ESNext"], types: [] }, include: ["*.ts"] }));
  await writeFile(path.join(root, "base.ts"), base); await writeFile(path.join(root, "provider.ts"), source);
  const spec = extractSpeechSpec({ root, tsconfig: "tsconfig.json", baseFile: "base.ts", providers: [{ id: "fixture", file: "provider.ts" }] });
  const code = renderRequestValidator(spec.tts.providers[0]!);
  const output = path.join(root, "validator.mts");
  await writeFile(output, code);
  const module = await import(pathToFileURL(output).href);
  return { code, defaults: module.requestDefaults, validate: module.validateRequest as (value: unknown) => (item: unknown) => void };
}

const text = { async *[Symbol.asyncIterator]() { yield "hello"; } };
const request = { model: "tts", text, output: { format: "mp3" }, stability: 0.5 };

test("generates common defaults from annotations without mutating input", async () => {
  const first = await generated(provider.replace("@minimum 0 @maximum 1", "@default 0.5\n * @minimum 0 @maximum 1"));
  const second = await generated(provider.replace("@minimum 0 @maximum 1", "@default 0.75\n * @minimum 0 @maximum 1"));
  assert.deepEqual(first.defaults, { stability: 0.5 });
  assert.deepEqual(second.defaults, { stability: 0.75 });
  const value = { model: "tts", text, output: { format: "mp3" } };
  first.validate(value);
  assert.equal("stability" in value, false);
});

test("checker-derived validators enforce unions, literals, never, optional boundaries and annotations", async () => {
  const { validate, code } = await generated(provider);
  assert.doesNotThrow(() => validate({ ...request, textBuffering: false }));
  assert.doesNotThrow(() => validate({ ...request, textBuffering: false, textBufferThresholds: undefined }));
  for (const value of [
    { ...request, textBuffering: false, textBufferThresholds: [50] }, { ...request, textBufferThresholds: [undefined] },
    { ...request, stability: 2 }, { ...request, output: { format: "pcm" } }, { ...request, output: { format: "mp3", sampleRateHz: 16000 } },
    { ...request, model: "dialogue", textBuffering: true }, { ...request, text: ["not async"] }, { ...request, output: undefined },
  ]) assert.throws(() => validate(value), /Invalid fixture TTS request/);
  assert.ok(code.includes('"textBufferThresholds" in value'));
  assert.ok(!code.includes("JSON.parse")); assert.ok(!code.includes("typeScriptType")); assert.ok(!code.includes("SchemaType"));
});

test("changing authored types changes executed validation, not just a generated banner", async () => {
  const old = await generated(provider);
  const relaxed = await generated(provider.replace("readonly textBufferThresholds?: never", "readonly textBufferThresholds?: readonly number[]").replace("@maximum 1", "@maximum 2").replace('readonly format: "mp3"', 'readonly format: "pcm"'));
  const value = { ...request, textBuffering: false, textBufferThresholds: [50], stability: 1.5, output: { format: "pcm" } };
  assert.throws(() => old.validate(value)); assert.doesNotThrow(() => relaxed.validate(value));
  assert.throws(() => relaxed.validate(request));
  assert.notEqual(relaxed.code, old.code);
});

test("generated input-item checks narrow by the matching request variants without advancing input", async () => {
  const { validate } = await generated(provider);
  let acquired = false;
  const streaming = { [Symbol.asyncIterator]() { acquired = true; throw new Error("must not acquire input"); } };
  const tts = validate({ ...request, text: streaming });
  const dialogue = validate({ ...request, model: "dialogue", text: streaming });
  assert.equal(acquired, false);
  for (const check of [tts, dialogue]) { assert.doesNotThrow(() => check("hello")); assert.doesNotThrow(() => check({ command: "flush" })); assert.throws(() => check({ command: "unknown" })); assert.throws(() => check(undefined)); }
  assert.doesNotThrow(() => tts({ command: "clear" })); assert.throws(() => dialogue({ command: "clear" }));
  assert.equal(acquired, false);
});

test("nested required values, bytes, arrays and null survive type-derived validation", async () => {
  const { validate } = await generated(provider);
  const data = { bytes: Uint8Array.of(1), labels: ["x"], note: null };
  assert.doesNotThrow(() => validate({ ...request, data }));
  for (const invalid of [{ ...data, note: undefined }, { ...data, bytes: [1] }, { ...data, labels: [undefined] }, { ...data, labels: [null] }]) assert.throws(() => validate({ ...request, data: invalid }));
});

test("accumulates sibling and array errors while successful unions preserve earlier failures", async () => {
  const { validate } = await generated(`export type TtsRequest = {
    /** @minimum 0 @maximum 1 */ readonly stability: number;
    readonly data: { readonly bytes: Uint8Array; readonly labels: readonly string[]; readonly note: string | null };
    readonly model?: never;
    readonly output: { readonly format: "mp3" };
  };`);
  const value = { stability: 2, data: { bytes: [], labels: [null, 42], note: null }, model: "tts" };
  let error: unknown;
  try { validate(value); } catch (caught) { error = caught; }
  assert.ok(error instanceof TypeError);
  const message = error.message;
  assert.equal(message.split("\n").length, 7);
  for (const detail of [
    'request["stability"]: expected number <= 1',
    'request["data"]["bytes"]: expected Uint8Array',
    'request["data"]["labels"][0]: expected string',
    'request["data"]["labels"][1]: expected string',
    'request["model"]: field is not allowed',
    'request["output"]: required field',
  ]) assert.ok(message.includes(detail));
  assert.ok(!message.includes('["note"]'));
  assert.doesNotThrow(() => validate({ stability: 0.5, data: { bytes: new Uint8Array(), labels: [], note: null }, output: { format: "mp3" } }));
});

test("invalid containers report their own path and allow sibling validation to continue", async () => {
  const { validate } = await generated(`export type TtsRequest = {
    readonly data: { readonly bytes: Uint8Array; readonly labels: readonly string[]; readonly note: string | null };
    readonly textBufferThresholds: readonly number[];
  };`);
  assert.throws(() => validate({ data: null, textBufferThresholds: false }), { message: 'Invalid fixture TTS request:\nrequest["data"]: expected object\nrequest["textBufferThresholds"]: expected array' });
  assert.throws(() => validate(null), /request: expected object/);
});

test("overlapping streaming variants accept later item alternatives and isolate successive calls", async () => {
  const { validate } = await generated(`export type TtsRequest =
    | { readonly text: AsyncIterable<{ readonly command: "clear" }> }
    | { readonly text: AsyncIterable<{ readonly command: "flush" }> };`);
  const check = validate({ text });
  assert.doesNotThrow(() => check({ command: "flush" }));
  let error: unknown;
  try { check({ command: "unknown" }); } catch (caught) { error = caught; }
  assert.ok(error instanceof TypeError);
  assert.ok(error.message.includes('text item["command"]: expected "clear"'));
  assert.ok(error.message.includes('text item["command"]: expected "flush"'));
  assert.doesNotThrow(() => check({ command: "clear" }));
  assert.doesNotThrow(() => check({ command: "flush" }));
});
