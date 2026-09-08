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
  expect(first.defaults).toStrictEqual({ stability: 0.5 });
  expect(second.defaults).toStrictEqual({ stability: 0.75 });
  const value = { model: "tts", text, output: { format: "mp3" } };
  first.validate(value);
  expect(value).not.toHaveProperty("stability");
});

test("checker-derived validators enforce unions, literals, never, optional boundaries and annotations", async () => {
  const { validate, code } = await generated(provider);
  expect(() => validate({ ...request, textBuffering: false })).not.toThrow();
  expect(() => validate({ ...request, textBuffering: false, textBufferThresholds: undefined })).not.toThrow();
  for (const value of [
    { ...request, textBuffering: false, textBufferThresholds: [50] }, { ...request, textBufferThresholds: [undefined] },
    { ...request, stability: 2 }, { ...request, output: { format: "pcm" } }, { ...request, output: { format: "mp3", sampleRateHz: 16000 } },
    { ...request, model: "dialogue", textBuffering: true }, { ...request, text: ["not async"] }, { ...request, output: undefined },
  ]) expect(() => validate(value)).toThrow(/Invalid fixture TTS request/);
  expect(code).toContain('"textBufferThresholds" in value');
  expect(code).not.toContain("JSON.parse"); expect(code).not.toContain("typeScriptType"); expect(code).not.toContain("SchemaType");
});

test("changing authored types changes executed validation, not just a generated banner", async () => {
  const old = await generated(provider);
  const relaxed = await generated(provider.replace("readonly textBufferThresholds?: never", "readonly textBufferThresholds?: readonly number[]").replace("@maximum 1", "@maximum 2").replace('readonly format: "mp3"', 'readonly format: "pcm"'));
  const value = { ...request, textBuffering: false, textBufferThresholds: [50], stability: 1.5, output: { format: "pcm" } };
  expect(() => old.validate(value)).toThrow(); expect(() => relaxed.validate(value)).not.toThrow();
  expect(() => relaxed.validate(request)).toThrow();
  expect(relaxed.code).not.toBe(old.code);
});

test("generated input-item checks narrow by the matching request variants without advancing input", async () => {
  const { validate } = await generated(provider);
  let acquired = false;
  const streaming = { [Symbol.asyncIterator]() { acquired = true; throw new Error("must not acquire input"); } };
  const tts = validate({ ...request, text: streaming });
  const dialogue = validate({ ...request, model: "dialogue", text: streaming });
  expect(acquired).toBe(false);
  for (const check of [tts, dialogue]) { expect(() => check("hello")).not.toThrow(); expect(() => check({ command: "flush" })).not.toThrow(); expect(() => check({ command: "unknown" })).toThrow(); expect(() => check(undefined)).toThrow(); }
  expect(() => tts({ command: "clear" })).not.toThrow(); expect(() => dialogue({ command: "clear" })).toThrow();
  expect(acquired).toBe(false);
});

test("nested required values, bytes, arrays and null survive type-derived validation", async () => {
  const { validate } = await generated(provider);
  const data = { bytes: Uint8Array.of(1), labels: ["x"], note: null };
  expect(() => validate({ ...request, data })).not.toThrow();
  for (const invalid of [{ ...data, note: undefined }, { ...data, bytes: [1] }, { ...data, labels: [undefined] }, { ...data, labels: [null] }]) expect(() => validate({ ...request, data: invalid })).toThrow();
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
  expect(error).toBeInstanceOf(TypeError);
  const message = (error as TypeError).message;
  expect(message.split("\n")).toHaveLength(7);
  for (const detail of [
    'request["stability"]: expected number <= 1',
    'request["data"]["bytes"]: expected Uint8Array',
    'request["data"]["labels"][0]: expected string',
    'request["data"]["labels"][1]: expected string',
    'request["model"]: field is not allowed',
    'request["output"]: required field',
  ]) expect(message).toContain(detail);
  expect(message).not.toContain('["note"]');
  expect(() => validate({ stability: 0.5, data: { bytes: new Uint8Array(), labels: [], note: null }, output: { format: "mp3" } })).not.toThrow();
});

test("invalid containers report their own path and allow sibling validation to continue", async () => {
  const { validate } = await generated(`export type TtsRequest = {
    readonly data: { readonly bytes: Uint8Array; readonly labels: readonly string[]; readonly note: string | null };
    readonly textBufferThresholds: readonly number[];
  };`);
  expect(() => validate({ data: null, textBufferThresholds: false })).toThrow(expect.objectContaining({ message: 'Invalid fixture TTS request:\nrequest["data"]: expected object\nrequest["textBufferThresholds"]: expected array' }));
  expect(() => validate(null)).toThrow(/request: expected object/);
});

test("overlapping streaming variants accept later item alternatives and isolate successive calls", async () => {
  const { validate } = await generated(`export type TtsRequest =
    | { readonly text: AsyncIterable<{ readonly command: "clear" }> }
    | { readonly text: AsyncIterable<{ readonly command: "flush" }> };`);
  const check = validate({ text });
  expect(() => check({ command: "flush" })).not.toThrow();
  let error: unknown;
  try { check({ command: "unknown" }); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(TypeError);
  expect((error as TypeError).message).toContain('text item["command"]: expected "clear"');
  expect((error as TypeError).message).toContain('text item["command"]: expected "flush"');
  expect(() => check({ command: "clear" })).not.toThrow();
  expect(() => check({ command: "flush" })).not.toThrow();
});
