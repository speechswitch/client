import { afterEach, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

test("array bounds generate executable checks and sparse elements cannot evade validation", async () => {
  const bounded = await generated(provider.replace("readonly textBufferThresholds?: readonly number[]", "\n/** @minItems 1 @maxItems 2 */\nreadonly textBufferThresholds?: readonly number[]"));
  expect(bounded.validate({ ...request, textBufferThresholds: [0] })).toBeTypeOf("function");
  expect(bounded.validate({ ...request, textBufferThresholds: [0, 1] })).toBeTypeOf("function");
  for (const items of [[], [0, 1, 2], Array(1), [undefined]]) assert.throws(() => bounded.validate({ ...request, textBufferThresholds: items }), TypeError);
  const loose = await generated(provider);
  const sparse = Array(1); Object.defineProperty(sparse, "every", { value: () => true });
  assert.throws(() => loose.validate({ ...request, textBufferThresholds: sparse }), TypeError);
});

test("array bounds accumulate exact cardinality and element diagnostics", async () => {
  const { validate } = await generated(`export type TtsRequest = {
    /** @minItems 1 @maxItems 2 */ readonly textBufferThresholds: readonly number[];
  };`);
  for (const [items, details] of [
    [[], ['request["textBufferThresholds"]: expected at least 1 items']],
    [[0, 1, 2], ['request["textBufferThresholds"]: expected at most 2 items']],
    [Array(1), ['request["textBufferThresholds"][0]: expected finite number']],
    [[undefined, 0, undefined], [
      'request["textBufferThresholds"][0]: expected finite number',
      'request["textBufferThresholds"][2]: expected finite number',
      'request["textBufferThresholds"]: expected at most 2 items',
    ]],
    [false, ['request["textBufferThresholds"]: expected array']],
  ] as const) assert.throws(() => validate({ textBufferThresholds: items }), {
    name: "TypeError", message: ["Invalid fixture TTS request:", ...details].join("\n"),
  });
  assert.doesNotThrow(() => validate({ textBufferThresholds: [0, 1] }));
});

const directories: string[] = [];
test("string bounds count Unicode code points and accumulate exact field diagnostics", async () => {
  const { validate } = await generated(`export type TtsRequest = {
    /** @maxLength 2 */ readonly text: string;
    /** @maxLength 1 */ readonly model?: string;
  };`);
  for (const text of ["", "ab", "😀😀"]) assert.doesNotThrow(() => validate({ text, model: undefined }));
  assert.doesNotThrow(() => validate({ text: "😀😀", model: "😀" }));
  assert.throws(() => validate({ text: "😀😀😀", model: "😀😀" }), {
    name: "TypeError", message: [
      "Invalid fixture TTS request:",
      'request["model"]: expected at most 1 Unicode code points',
      'request["text"]: expected at most 2 Unicode code points',
    ].join("\n"),
  });
  assert.throws(() => validate({ text: [] }), {
    name: "TypeError", message: 'Invalid fixture TTS request:\nrequest["text"]: expected string',
  });
});

afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

const base = `export type TtsRequest = {
  /** Streaming input. */ readonly text?: string | AsyncIterable<string | { readonly command: "clear" } | { readonly command: "flush" }>;
  /** Model. */ readonly model?: string;
  /** Buffer text. */ readonly textBuffering?: boolean;
  /** Character thresholds. */ readonly textBufferThresholds?: readonly number[];
  /** Voice consistency. */ readonly stability?: number;
  /** Audio representation. */ readonly output?: { readonly format: "mp3" | "pcm"; readonly sampleRateHz?: number };
  /** Nested data. */ readonly data?: { readonly bytes: Uint8Array; readonly labels: readonly string[]; readonly note: string | null };
  /** Dialogue. */ readonly turns?: AsyncIterable<{ readonly speaker: string; readonly text: string }>;
  /** Metadata. */ readonly metadata?: { readonly [key: string]: string | number };
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
  return { code, defaults: module.requestDefaults, validate: module.validateRequest as (value: unknown) => (item: unknown, field?: string) => void };
}

const text = { async *[Symbol.asyncIterator]() { yield "hello"; } };
const request = { model: "tts", text, output: { format: "mp3" }, stability: 0.5 };

test.each(["", "?"])("a mixed string/stream field %s enables item validation only for an actual stream", async optional => {
  const { validate } = await generated(`export type TtsRequest = { readonly text${optional}: string | AsyncIterable<string | { readonly command: "clear" }> };`);
  const staticInput = validate({ text: "hello" });
  expect(() => staticInput("more")).toThrow(new TypeError("Invalid fixture TTS input item:\ntext item: streaming input is not supported by this request"));
  expect(() => staticInput({ command: "clear" })).toThrow(new TypeError("Invalid fixture TTS input item:\ntext item: streaming input is not supported by this request"));
  const stream = validate({ text: { [Symbol.asyncIterator]() { throw new Error("input acquired"); } } });
  expect(() => stream("more")).not.toThrow();
  expect(() => stream({ command: "clear" })).not.toThrow();
  if (optional) {
    expect(() => validate({})("more")).toThrow(new TypeError("Invalid fixture TTS input item:\ntext item: streaming input is not supported by this request"));
    expect(() => validate({ text: undefined })("more")).toThrow(new TypeError("Invalid fixture TTS input item:\ntext item: streaming input is not supported by this request"));
  }
});

test("accumulated errors retain exact integer and exclusive-bound diagnostics", async () => {
  const { validate } = await generated(`export type TtsRequest = {
    /** @integer @exclusiveMinimum 0 @maximum 10 */ readonly stability: number;
  };`);
  for (const [stability, errors] of [
    [-1.5, ['request["stability"]: expected number > 0', 'request["stability"]: expected safe integer']],
    [0, ['request["stability"]: expected number > 0']],
    [1.5, ['request["stability"]: expected safe integer']],
    [11, ['request["stability"]: expected number <= 10']],
    [Number.MAX_SAFE_INTEGER + 1, ['request["stability"]: expected safe integer', 'request["stability"]: expected number <= 10']],
    [NaN, ['request["stability"]: expected finite number']],
    [Infinity, ['request["stability"]: expected finite number']],
  ] as const) {
    assert.throws(() => validate({ stability }), {
      name: "TypeError", message: ["Invalid fixture TTS request:", ...errors].join("\n"),
    });
  }
  for (const stability of [1, 10]) assert.doesNotThrow(() => validate({ stability }));
});
test("integer and exclusive bounds compile into executable specialized checks", async () => {
  const positive = await generated(provider.replace("@minimum 0 @maximum 1", "@exclusiveMinimum 0 @maximum 1"));
  expect(() => positive.validate({ ...request, stability: Number.MIN_VALUE })).not.toThrow();
  assert.throws(() => positive.validate({ ...request, stability: 0 }), TypeError);
  const integer = await generated(provider.replace("@minimum 0 @maximum 1", "@integer @minimum 0"));
  for (const value of [0, 1, Number.MAX_SAFE_INTEGER]) expect(() => integer.validate({ ...request, stability: value })).not.toThrow();
  for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => integer.validate({ ...request, stability: value }), TypeError);
});

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
  const { validate } = await generated(provider);
  expect(() => validate({ ...request, textBuffering: false })).not.toThrow();
  expect(() => validate({ ...request, textBuffering: false, textBufferThresholds: undefined })).not.toThrow();
  for (const value of [
    { ...request, textBuffering: false, textBufferThresholds: [50] }, { ...request, textBufferThresholds: [undefined] },
    { ...request, stability: 2 }, { ...request, output: { format: "pcm" } }, { ...request, output: { format: "mp3", sampleRateHz: 16000 } },
    { ...request, model: "dialogue", textBuffering: true }, { ...request, text: ["not async"] }, { ...request, output: undefined },
  ]) assert.throws(() => validate(value), TypeError);
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

test("record checks accumulate keyed diagnostics and preserve escaped field paths", async () => {
  const { validate } = await generated(`export type TtsRequest = {
    readonly metadata: { readonly [key: string]: string };
    readonly stability: number;
  };`);
  assert.throws(() => validate({ metadata: { first: 1, 'a"b': undefined }, stability: false }), {
    name: "TypeError", message: [
      "Invalid fixture TTS request:",
      'request["metadata"]["first"]: expected string',
      'request["metadata"]["a\\"b"]: expected string',
      'request["stability"]: expected finite number',
    ].join("\n"),
  });
  for (const metadata of [[], null, new Date()]) assert.throws(() => validate({ metadata, stability: 0 }), {
    name: "TypeError", message: 'Invalid fixture TTS request:\nrequest["metadata"]: expected plain object',
  });
  assert.doesNotThrow(() => validate({ metadata: Object.assign(Object.create(null), { value: "ok" }), stability: 0 }));
});

test("input checks distinguish fields and preserve each model's async item types", async () => {
  const { validate } = await generated(`
    interface Voice { readonly model: "voice"; readonly text: AsyncIterable<string>; readonly turns?: never; }
    interface Dialogue { readonly model: "dialogue"; readonly text?: never; readonly turns: AsyncIterable<{ readonly speaker: "Alice" | "Bob"; readonly text: string }>; }
    interface Mixed { readonly model: "mixed"; readonly text: AsyncIterable<string>; readonly turns: AsyncIterable<{ readonly speaker: "Alice"; readonly text: string }>; }
    export type TtsRequest = Voice | Dialogue | Mixed;
  `);
  const voice = validate({ model: "voice", text });
  const dialogue = validate({ model: "dialogue", turns: text });
  const mixed = validate({ model: "mixed", text, turns: text });
  expect(() => voice("hello")).not.toThrow();
  expect(() => dialogue({ speaker: "Bob", text: "hello" }, "turns")).not.toThrow();
  expect(() => mixed({ speaker: "Alice", text: "hello" }, "turns")).not.toThrow();
  for (const [run, diagnostic] of [
    [() => voice("hello", "turns"), "turns item: streaming input is not supported by this request"],
    [() => dialogue("hello"), "text item: streaming input is not supported by this request"],
    [() => dialogue({ speaker: "Alice", text: "hello" }), "text item: streaming input is not supported by this request"],
    [() => dialogue("hello", "turns"), "turns item: expected object"],
    [() => mixed({ speaker: "Bob", text: "hello" }, "turns"), 'turns item["speaker"]: expected "Alice"'],
    [() => mixed({ speaker: "Alice", text: undefined }, "turns"), 'turns item["text"]: expected string'],
    [() => mixed("hello", "unknown"), "unknown item: streaming input is not supported by this request"],
  ] as const) assert.throws(run, { name: "TypeError", message: `Invalid fixture TTS input item:\n${diagnostic}` });
});

test("accumulates sibling and array errors while successful unions preserve earlier failures", async () => {
  const { validate } = await generated(`export type TtsRequest = {
    /** @minimum 0 @maximum 1 */ readonly stability: number;
    readonly data: { readonly bytes: Uint8Array; readonly labels: readonly string[]; readonly note: string | null };
    readonly model?: never;
    readonly output: { readonly format: "mp3" };
  };`);
  const value = { stability: 2, data: { bytes: [], labels: [null, 42], note: null }, model: "tts" };
  assert.throws(() => validate(value), { name: "TypeError", message: [
    "Invalid fixture TTS request:",
    'request["data"]["bytes"]: expected Uint8Array',
    'request["data"]["labels"][0]: expected string',
    'request["data"]["labels"][1]: expected string',
    'request["output"]: required field',
    'request["stability"]: expected number <= 1',
    'request["model"]: field is not allowed',
  ].join("\n") });
  expect(() => validate({ stability: 0.5, data: { bytes: new Uint8Array(), labels: [], note: null }, output: { format: "mp3" } })).not.toThrow();
});

test("invalid containers report their own path and allow sibling validation to continue", async () => {
  const { validate } = await generated(`export type TtsRequest = {
    readonly data: { readonly bytes: Uint8Array; readonly labels: readonly string[]; readonly note: string | null };
    readonly textBufferThresholds: readonly number[];
  };`);
  assert.throws(() => validate({ data: null, textBufferThresholds: false }), {
    name: "TypeError", message: 'Invalid fixture TTS request:\nrequest["data"]: expected object\nrequest["textBufferThresholds"]: expected array',
  });
  assert.throws(() => validate(null), { name: "TypeError", message: 'Invalid fixture TTS request:\nrequest: expected object' });
});

test("overlapping streaming variants accept later item alternatives and isolate successive calls", async () => {
  const { validate } = await generated(`export type TtsRequest =
    | { readonly text: AsyncIterable<{ readonly command: "clear" }> }
    | { readonly text: AsyncIterable<{ readonly command: "flush" }> };`);
  const check = validate({ text });
  expect(() => check({ command: "flush" })).not.toThrow();
  assert.throws(() => check({ command: "unknown" }), {
    name: "TypeError", message: 'Invalid fixture TTS input item:\ntext item["command"]: expected "clear"\ntext item["command"]: expected "flush"',
  });
  expect(() => check({ command: "clear" })).not.toThrow();
  expect(() => check({ command: "flush" })).not.toThrow();
});
