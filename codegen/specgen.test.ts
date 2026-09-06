import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { SpeechSpec } from "./spec-model.ts";

const directories: string[] = [];
const specgenUrl = pathToFileURL(path.join(import.meta.dir, "specgen.ts")).href;

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function extract(base: string, provider?: string): Promise<{ readonly status: number; readonly output: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "speech-switch-spec-"));
  directories.push(root);
  await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { strict: true, noEmit: true, lib: ["ESNext"], types: [] },
    include: ["*.ts"],
  }));
  await writeFile(path.join(root, "base.ts"), base);
  if (provider) await writeFile(path.join(root, "provider.ts"), provider);
  const script = [
    `import { extractSpeechSpec } from ${JSON.stringify(specgenUrl)};`,
    "try {",
    "  const root = process.argv[1];",
    `  const value = extractSpeechSpec({ root, tsconfig: "tsconfig.json", baseFile: "base.ts", providers: ${provider ? '[{ id: "fixture", file: "provider.ts" }]' : "[]"} });`,
    "  process.stdout.write(JSON.stringify(value));",
    "} catch (error) {",
    "  process.stdout.write(JSON.stringify(error instanceof Error ? error.message : String(error)));",
    "  process.exitCode = 1;",
    "}",
  ].join("\n");
  const process = Bun.spawn(["node", "--input-type=module", "-e", script, root], {
    cwd: path.resolve(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [status, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  // The native checker's shutdown diagnostics share stderr. Keep the extractor's
  // exact error as structured output; retain stderr for failures without a result.
  return { status, output: status === 0 ? stdout : stdout ? JSON.parse(stdout) : stderr };
}

const base = `
/** Normalized request. */
export type TtsRequest = {
  /** Audio format. */
  readonly format?: "mp3" | "pcm" | "wav";
  /** Sample rate.\n   * @minimum 8000\n   * @maximum 48000\n   */
  readonly sampleRateHz?: number;
  /** Voice identifier. */
  readonly voice?: string;
  /** Reference audio bytes. */
  readonly referenceAudio?: Uint8Array;
  /** Provider labels. */
  readonly labels?: readonly string[];
};
`;

describe("TypeScript 7 speech specification", () => {
  test.each([
    ["/** Items. @itemMinimum nope */ readonly values: number[]", "values has an invalid @itemMinimum value"],
    ["/** Items. @itemMaximum Infinity */ readonly values: number[]", "values has an invalid @itemMaximum value"],
    ["/** Items. @itemInteger false */ readonly values: number[]", "values @itemInteger does not accept a value"],
    ["/** Items. @itemMinimum 50 @itemMaximum 49 */ readonly values: number[]", "values items has @minimum greater than @maximum"],
    ["/** Items. @itemInteger @itemMinimum 0.1 @itemMaximum 0.9 */ readonly values: number[]", "values items has no safe integers within its bounds"],
    ["/** Items. @itemInteger */ readonly values: number", "values uses item bounds on a non-array type"],
    ["/** Items. @itemInteger */ readonly values: AsyncIterable<number>", "values uses item bounds on a non-array type"],
    ["/** Items. @itemInteger */ readonly values: number[] | number", "values uses item bounds on a non-array type"],
    ["/** Items. @itemInteger */ readonly values: string[]", "values uses numeric item bounds on a non-number element type"],
    ["/** Items. @itemInteger */ readonly values: (number | undefined)[]", "undefined is only supported through optional properties"],
    ["/** Items. @itemInteger */ readonly values?: (number | null)[]", "values uses numeric item bounds on a non-number element type"],
    ["/** Items. @itemMinimum 1 */ readonly values: number[][]", "values uses numeric item bounds on a non-number element type"],
  ])("invalid numeric array-item annotation %# has an exact diagnostic", async (field, message) => {
    expect(await extract(`export type TtsRequest = {\n${field}\n};`)).toEqual({ status: 1, output: `Speech spec: ${message}` });
  });
  test("numeric array-item bounds inherit independently and reject widening", async () => {
    const base = 'export type TtsRequest = {\n/** Values. @itemInteger @itemMinimum 50 @itemMaximum 500 */\nreadonly values?: readonly number[] };';
    const result = await extract(base, 'export type TtsRequest = {\n/** @itemMinimum 100 */\nreadonly values?: number[] | readonly (100 | 200)[] };');
    expect(result.status, result.output).toBe(0);
    const spec = JSON.parse(result.output) as SpeechSpec;
    const provider = spec.tts.providers[0]!.request;
    if (provider.kind !== "object") throw new Error("Expected object");
    expect(provider.fields[0]!.constraints).toEqual({ itemInteger: true, itemMinimum: 100, itemMaximum: 500 });
    for (const annotation of ["@itemMinimum 49", "@itemMaximum 501"]) {
      expect(await extract(base, `export type TtsRequest = {\n/** ${annotation} */\nreadonly values?: number[] };`)).toEqual({ status: 1, output: "Speech spec: provider fixture field values has constraints wider than the base field" });
    }
    expect(await extract(base, 'export type TtsRequest = {\n/** @itemMinimum 501 */\nreadonly values?: number[] };')).toEqual({ status: 1, output: "Speech spec: values items has @minimum greater than @maximum" });
  });
  test.each([
    ["/** Items. @minItems -1 */ readonly labels: string[]", "labels has an invalid @minItems value"],
    ["/** Items. @maxItems 1.5 */ readonly labels: string[]", "labels has an invalid @maxItems value"],
    ["/** Items. @minItems 3 @maxItems 2 */ readonly labels: string[]", "labels has @minItems greater than @maxItems"],
    ["/** Items. @minItems 1 */ readonly labels: string", "labels uses array bounds on a non-array type"],
    ["/** Items. @maxItems 1 */ readonly labels: AsyncIterable<string>", "labels uses array bounds on a non-array type"],
    ["/** Items. @maxItems 1 */ readonly labels: string[] | string", "labels uses array bounds on a non-array type"],
  ])("invalid array-bound annotation %# has an exact diagnostic", async (field, message) => {
    expect(await extract(`export type TtsRequest = {\n${field}\n};`)).toEqual({ status: 1, output: `Speech spec: ${message}` });
  });
  test("array bounds inherit after independent normalization and reject widening", async () => {
    const base = 'export type TtsRequest = {\n/** Items. @minItems 1 @maxItems 50 */\nreadonly labels: readonly string[] };';
    const result = await extract(base, 'export type TtsRequest = {\n/** @maxItems 2 */\nreadonly labels: readonly string[] };');
    expect(result.status, result.output).toBe(0);
    const spec = JSON.parse(result.output) as SpeechSpec;
    const provider = spec.tts.providers[0]!.request;
    if (provider.kind !== "object") throw new Error("Expected object");
    expect(provider.fields[0]!.constraints).toEqual({ minItems: 1, maxItems: 2 });
    expect(await extract(base, 'export type TtsRequest = {\n/** @minItems 0 */\nreadonly labels: string[] };')).toEqual({ status: 1, output: "Speech spec: provider fixture field labels has constraints wider than the base field" });
    expect(await extract(base, 'export type TtsRequest = {\n/** @maxItems 51 */\nreadonly labels: string[] };')).toEqual({ status: 1, output: "Speech spec: provider fixture field labels has constraints wider than the base field" });
    expect(await extract(base, 'export type TtsRequest = {\n/** @maxItems 0 */\nreadonly labels: string[] };')).toEqual({ status: 1, output: "Speech spec: labels has @minItems greater than @maxItems" });
  });
  test.each([
    ["/** Value. @exclusiveMinimum nope */ readonly value: number", "value has an invalid @exclusiveMinimum value"],
    ["/** Value. @exclusiveMinimum 1 @maximum 1 */ readonly value: number", "value has @exclusiveMinimum greater than or equal to @maximum"],
    ["/** Value. @exclusiveMinimum 0 */ readonly value: string", "value uses numeric bounds on a non-number type"],
    ["/** Value. @integer */ readonly value: string", "value uses numeric bounds on a non-number type"],
    ["/** Value. @integer false */ readonly value: number", "value @integer does not accept a value"],
    ["/** Value. @exclusiveMinimum 0 @default 0 */ readonly value?: number", "value @default is not above @exclusiveMinimum"],
    ["/** Value. @integer @default 1.5 */ readonly value?: number", "value @default is not a safe integer"],
    ["/** Value. @integer @minimum 0.1 @maximum 0.9 */ readonly value: number", "value has no safe integers within its bounds"],
    ["/** Value. @integer @exclusiveMinimum 9007199254740991 */ readonly value: number", "value has no safe integers within its bounds"],
  ])("invalid integer/exclusive-bound annotation %# has an exact diagnostic", async (field, message) => {
    expect(await extract(`export type TtsRequest = {\n${field}\n};`)).toEqual({ status: 1, output: `Speech spec: ${message}` });
  });
  test("integer and exclusive lower bounds are inherited and cannot be widened", async () => {
    const base = 'export type TtsRequest = {\n/** Value. @integer @exclusiveMinimum 0 @maximum 10 */\nreadonly value?: number };';
    const result = await extract(base, 'export type TtsRequest = {\n/** @minimum 2 @default 2 */\nreadonly value?: number };');
    expect(result.status, result.output).toBe(0);
    const spec = JSON.parse(result.output) as SpeechSpec;
    expect(spec.tts.request.fields[0]!.constraints).toEqual({ integer: true, exclusiveMinimum: 0, maximum: 10 });
    const provider = spec.tts.providers[0]!.request;
    if (provider.kind !== "object") throw new Error("Expected object");
    expect(provider.fields[0]!.constraints).toEqual({ integer: true, exclusiveMinimum: 0, minimum: 2, maximum: 10 });
    expect(await extract(base, 'export type TtsRequest = {\n/** @exclusiveMinimum -1 */\nreadonly value?: number };')).toEqual({ status: 1, output: "Speech spec: provider fixture field value has constraints wider than the base field" });
    expect(await extract(base, 'export type TtsRequest = {\n/** @default 1.5 */\nreadonly value?: number };')).toEqual({ status: 1, output: "Speech spec: value @default is not a safe integer" });
    expect(await extract(base, 'export type TtsRequest = {\n/** @exclusiveMinimum 10 */\nreadonly value?: number };')).toEqual({ status: 1, output: "Speech spec: value has @exclusiveMinimum greater than or equal to @maximum" });
  });
  test("inherits and narrows Unicode string length constraints independently", async () => {
    const result = await extract('export type TtsRequest = {\n/** Text. @maxLength 4 */\nreadonly text: string };',
      'export type TtsRequest = {\n/** @maxLength 2 */\nreadonly text: string };');
    expect(result.status, result.output).toBe(0);
    const spec = JSON.parse(result.output) as SpeechSpec;
    expect(spec.tts.request.fields[0]!.constraints).toEqual({ maxLength: 4 });
    const provider = spec.tts.providers[0]!.request;
    if (provider.kind !== "object") throw new Error("Expected object");
    expect(provider.fields[0]!.constraints).toEqual({ maxLength: 2 });
  });
  test.each([
    ['/** Text. @maxLength -1 */ readonly text: string', 'text has an invalid @maxLength value'],
    ['/** Text. @maxLength 1.5 */ readonly text: string', 'text has an invalid @maxLength value'],
    ['/** Text. @maxLength 2 */ readonly text: number', 'text uses @maxLength on a non-string type'],
    ['/** Text. @maxLength 2 @default "abc" */ readonly text?: string', 'text @default exceeds @maxLength'],
  ])("invalid string length annotation %# has an exact diagnostic", async (field, message) => {
    expect(await extract(`export type TtsRequest = {\n${field}\n};`)).toEqual({ status: 1, output: `Speech spec: ${message}` });
  });
  test("providers cannot widen inherited maximum string length", async () => {
    expect(await extract('export type TtsRequest = {\n/** Text. @maxLength 2 */\nreadonly text: string };',
      'export type TtsRequest = {\n/** @maxLength 3 */\nreadonly text: string };')).toEqual({ status: 1, output: "Speech spec: provider fixture field text has constraints wider than the base field" });
  });
  test("normalizes independent JSON algebras and string-keyed records through type identities", async () => {
    const definition = (name: string) => `type ${name} = string | number | boolean | null | readonly ${name}[] | { readonly [key: string]: ${name} };`;
    const result = await extract(`${definition("Value")} export type TtsRequest = {\n/** Metadata. */\nreadonly metadata?: { readonly [key: string]: Value } };`,
      `${definition("Renamed")} export type TtsRequest = { readonly metadata?: { readonly [name: string]: Renamed } };`);
    expect(result.status, result.output).toBe(0);
    const spec = JSON.parse(result.output) as SpeechSpec;
    expect(spec.tts.request.fields[0]!.type).toEqual({ kind: "record", values: { kind: "json-value" } });
    const provider = spec.tts.providers[0]!.request;
    if (provider.kind !== "object") throw new Error("Expected object");
    expect(provider.fields[0]!.type).toEqual({ kind: "record", values: { kind: "json-value" } });
    expect(provider.fields[0]!.documentation).toBe("Metadata.");
  });
  test("record values never erase nested undefined", async () => {
    const result = await extract('export type TtsRequest = {\n/** Metadata. */\nreadonly metadata?: { readonly [key: string]: string | undefined } };');
    expect(result).toEqual({ status: 1, output: "Speech spec: undefined is only supported through optional properties" });
  });
  test("a JSON-like recursive alias cannot hide undefined in array elements", async () => {
    const result = await extract('type JsonValue = string | number | boolean | null | readonly (JsonValue | undefined)[] | { readonly [key: string]: JsonValue };\nexport type TtsRequest = {\n/** Metadata. */\nreadonly metadata?: { readonly [key: string]: JsonValue } };');
    expect(result).toEqual({ status: 1, output: "Speech spec: undefined is only supported through optional properties" });
  });
  test("record value narrowing rejects a provider's wider scalar", async () => {
    const result = await extract('export type TtsRequest = {\n/** Metadata. */\nreadonly metadata?: { readonly [key: string]: string } };',
      'export type TtsRequest = { readonly metadata?: { readonly [key: string]: number } };');
    expect(result).toEqual({ status: 1, output: "Speech spec: provider fixture field metadata widens { readonly [key: string]: string; } | undefined to { readonly [key: string]: number; } | undefined" });
  });
  test("extracts typed default metadata without changing provider narrowing", async () => {
    const result = await extract(base, `export type TtsRequest = {
      /** @default "pcm" */ readonly format?: "mp3" | "pcm";
    };`);
    expect(result.status, result.output).toBe(0);
    const spec = JSON.parse(result.output) as SpeechSpec;
    const request = spec.tts.providers[0]!.request;
    if (request.kind !== "object") throw new Error("Expected object");
    expect(request.fields[0]!.default).toBe("pcm");
    expect(request.fields[0]!.optional).toBe(true);
  });

  test("rejects a default outside the provider's narrowed union", async () => {
    const result = await extract(base, `export type TtsRequest = {
      /** @default "wav" */
      readonly format?: "mp3" | "pcm";
    };`);
    expect(result).toEqual({
      status: 1,
      output: "Speech spec: format @default does not match its type",
    });
  });

  test("requires defaulted fields to be optional under the SDK's omission policy", async () => {
    const result = await extract(base, `export type TtsRequest = {
      /** @default "pcm" */
      readonly format: "pcm";
    };`);
    expect(result).toEqual({
      status: 1,
      output: "Speech spec: format @default requires an optional field",
    });
  });

  test("rejects undefined as a non-JSON default literal", async () => {
    const result = await extract(base, `export type TtsRequest = {
      /** @default undefined */
      readonly format?: "pcm";
    };`);
    expect(result).toEqual({
      status: 1,
      output: "Speech spec: format has an invalid @default; use a JSON literal",
    });
  });

  test("rejects a default below the minimum inherited from the base schema", async () => {
    const result = await extract(base, `export type TtsRequest = {
      /** @default 4000 */
      readonly sampleRateHz?: number;
    };`);
    expect(result).toEqual({
      status: 1,
      output: "Speech spec: sampleRateHz @default is below @minimum",
    });
  });

  test("extracts documented fields and valid provider narrowing", async () => {
    const result = await extract(base, `
      /** Provider request. */
      export type TtsRequest = {
        readonly format: "mp3" | "pcm";
        /** @minimum 16000 */
        readonly sampleRateHz?: number;
      };
    `);
    expect(result.status, result.output).toBe(0);
    const spec = JSON.parse(result.output) as SpeechSpec;
    expect(spec.tts.providers[0]?.documentation).toBe("Provider request.");
    const request = spec.tts.providers[0]?.request;
    expect(request?.kind).toBe("object");
    if (request?.kind !== "object") throw new TypeError("Expected object request");
    expect(request.fields[0]?.documentation).toBe("Audio format.");
    expect(request.fields[1]?.constraints).toEqual({ minimum: 16000, maximum: 48000 });
  });

  test("classifies aliases through checker identities", async () => {
    const result = await extract(`
      type Audio = Uint8Array;
      type Input = AsyncIterable<string>;
      type Labels = ReadonlyArray<string>;
      namespace Vendor { export interface Uint8Array { readonly value: string } }
      /** Normalized request. */
      export type TtsRequest = {
        /** Audio bytes. */
        readonly audio?: Audio;
        /** Streaming input. */
        readonly input?: Input;
        /** Labels. */
        readonly labels?: Labels;
        /** Vendor object. */
        readonly vendorObject?: Vendor.Uint8Array;
      };
    `);
    expect(result.status, result.output).toBe(0);
    const spec = JSON.parse(result.output) as SpeechSpec;
    expect(spec.tts.request.fields.map((field) => [field.name, field.type.kind])).toEqual([
      ["audio", "bytes"],
      ["input", "async-iterable"],
      ["labels", "array"],
      ["vendorObject", "object"],
    ]);
  });

  test("does not erase undefined from required or nested types", async () => {
    const required = await extract(`
      /** Normalized request. */
      export type TtsRequest = {
        /** Required value. */
        readonly value: string | undefined;
      };
    `);
    expect(required.status).toBe(1);
    expect(required.output).toContain("undefined is only supported through optional properties");

    const nested = await extract(`
      /** Normalized request. */
      export type TtsRequest = {
        /** Values. */
        readonly values?: Array<string | undefined>;
      };
    `);
    expect(nested.status).toBe(1);
    expect(nested.output).toContain("undefined is only supported through optional properties");
  });

  test("preserves mutually exclusive request variants", async () => {
    const result = await extract(base, `
      type Voice = { readonly voice: string; readonly referenceAudio?: never };
      type Clone = { readonly voice?: never; readonly referenceAudio: Uint8Array };
      export type TtsRequest = Voice | Clone;
    `);
    expect(result.status, result.output).toBe(0);
    const spec = JSON.parse(result.output) as SpeechSpec;
    const request = spec.tts.providers[0]?.request;
    expect(request?.kind).toBe("union");
    if (request?.kind !== "union") throw new TypeError("Expected request union");
    expect(request.anyOf).toHaveLength(2);
    expect(request.anyOf
      .map((part) => part.kind === "object" ? part.fields.map(({ name }) => name).join(",") : "")
      .sort()).toEqual(["referenceAudio", "voice"]);
    expect(request.anyOf.map(part => part.kind === "object" ? part.forbidden : []).flat().sort()).toEqual(["referenceAudio", "voice"]);
  });

  test("reports all provider schema errors", async () => {
    const result = await extract(base, `
      export type TtsRequest = {
        readonly format?: "flac";
        readonly vendorOption?: string;
      };
    `);
    expect(result.status).toBe(1);
    expect(result.output).toContain("field format widens");
    expect(result.output).toContain("introduces unknown field vendorOption");
  });

  test("validates every provider output variant against a flat base", async () => {
    const flatBase = `
      export type TtsRequest = {
        /** Requested audio representation. */
        readonly output?: {
          readonly format: "mp3" | "pcm";
          readonly sampleRateHz?: number;
          readonly bitRateBps?: number;
        };
      };
    `;
    const provider = `
      export type TtsRequest = {
        readonly output:
          | { readonly format: "mp3"; readonly bitRateBps?: number }
          | { readonly format: "pcm"; readonly sampleRateHz: 24000; readonly bitRateBps?: never };
      };
    `;
    const result = await extract(flatBase, provider);
    expect(result.status, result.output).toBe(0);
    const spec = JSON.parse(result.output) as SpeechSpec;
    const request = spec.tts.providers[0]?.request;
    if (request?.kind !== "object") throw new TypeError("Expected object request");
    const output = request.fields.find((field) => field.name === "output");
    expect(output?.documentation).toBe("Requested audio representation.");
    expect(output?.type.kind).toBe("union");
    if (output?.type.kind !== "union") throw new TypeError("Expected provider output union");
    expect(output.type.anyOf).toHaveLength(2);

    const wider = await extract(flatBase, provider.replace('readonly format: "pcm"', 'readonly format: "flac"'));
    expect(wider.status).toBe(1);
    expect(wider.output).toContain("widens");
  });

  test("requires explicit provider fields", async () => {
    const result = await extract(base, `export type TtsRequest = { readonly [field: string]: string }`);
    expect(result.status).toBe(1);
    expect(result.output).toContain("must list normalized fields explicitly");
  });

  test("rejects partially overlapping unions", async () => {
    const result = await extract(base, `export type TtsRequest = { readonly format?: "mp3" | "flac" }`);
    expect(result.status).toBe(1);
    expect(result.output).toContain("field format widens");
  });

  test("rejects wider annotated constraints", async () => {
    const result = await extract(base, `
      export type TtsRequest = {
        /** @maximum 96000 */
        readonly sampleRateHz?: number;
      };
    `);
    expect(result.status).toBe(1);
    expect(result.output).toContain("constraints wider than the base field");
  });

  test("requires documentation on every public base field", async () => {
    const result = await extract(`export type TtsRequest = { readonly text?: string }`);
    expect(result.status).toBe(1);
    expect(result.output).toContain("public base field text must have documentation");
  });

  test("requires the base schema to be exported", async () => {
    const result = await extract(`type TtsRequest = { readonly text?: string }`);
    expect(result.status).toBe(1);
    expect(result.output).toContain("TtsRequest must be exported from base.ts");
  });
});
