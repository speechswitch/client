import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
  const script = `
    import { extractSpeechSpec } from ${JSON.stringify(pathToFileURL(path.join(import.meta.dir, "specgen.ts")).href)};
    import { renderRequestValidator } from ${JSON.stringify(pathToFileURL(path.join(import.meta.dir, "request-validator.ts")).href)};
    const spec = extractSpeechSpec({ root: process.argv[1], tsconfig: "tsconfig.json", baseFile: "base.ts", providers: [{ id: "fixture", file: "provider.ts" }] });
    process.stdout.write(renderRequestValidator(spec.tts.providers[0]));
  `;
  const process = Bun.spawn(["node", "--input-type=module", "-e", script, root], { stdout: "pipe", stderr: "pipe" });
  const [status, code, errors] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
  expect(status, errors).toBe(0);
  const javascript = new Bun.Transpiler({ loader: "ts" }).transformSync(code);
  const output = path.join(root, "validator.mjs");
  await writeFile(output, javascript);
  const module = await import(pathToFileURL(output).href);
  return { code, defaults: module.requestDefaults, validate: module.validateRequest as (value: unknown) => (item: unknown) => void };
}

const text = { async *[Symbol.asyncIterator]() { yield "hello"; } };
const request = { model: "tts", text, output: { format: "mp3" }, stability: 0.5 };

test("generates common defaults from annotations without mutating input", async () => {
  const first = await generated(provider.replace("@minimum 0 @maximum 1", "@default 0.5\n * @minimum 0 @maximum 1"));
  const second = await generated(provider.replace("@minimum 0 @maximum 1", "@default 0.75\n * @minimum 0 @maximum 1"));
  expect(first.defaults).toEqual({ stability: 0.5 });
  expect(second.defaults).toEqual({ stability: 0.75 });
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
  ]) expect(() => validate(value)).toThrow("Invalid fixture TTS request");
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
