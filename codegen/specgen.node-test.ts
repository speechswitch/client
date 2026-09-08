import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractSpeechSpec } from "./specgen.ts";
import type { SpeechSpec } from "./spec-model.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function extract(base: string, provider?: string): Promise<SpeechSpec> {
  const root = await mkdtemp(path.join(tmpdir(), "speech-switch-spec-"));
  directories.push(root);
  await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { strict: true, noEmit: true, lib: ["ESNext"], types: [] },
    include: ["*.ts"],
  }));
  await writeFile(path.join(root, "base.ts"), base);
  if (provider) await writeFile(path.join(root, "provider.ts"), provider);
  return extractSpeechSpec({
    root,
    tsconfig: "tsconfig.json",
    baseFile: "base.ts",
    providers: provider ? [{ id: "fixture", file: "provider.ts" }] : [],
  });
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
  for (const [field, message] of [
    ["/** Value. @exclusiveMinimum nope */ readonly value: number", "value has an invalid @exclusiveMinimum value"],
    ["/** Value. @exclusiveMinimum 1 @maximum 1 */ readonly value: number", "value has @exclusiveMinimum greater than or equal to @maximum"],
    ["/** Value. @exclusiveMinimum 0 */ readonly value: string", "value uses numeric bounds on a non-number type"],
    ["/** Value. @integer */ readonly value: string", "value uses numeric bounds on a non-number type"],
    ["/** Value. @integer false */ readonly value: number", "value @integer does not accept a value"],
    ["/** Value. @exclusiveMinimum 0 @default 0 */ readonly value?: number", "value @default is not above @exclusiveMinimum"],
    ["/** Value. @integer @default 1.5 */ readonly value?: number", "value @default is not a safe integer"],
    ["/** Value. @integer @minimum 0.1 @maximum 0.9 */ readonly value: number", "value has no safe integers within its bounds"],
    ["/** Value. @integer @exclusiveMinimum 9007199254740991 */ readonly value: number", "value has no safe integers within its bounds"],
  ]) {
    test(`rejects ${field} with an exact diagnostic`, async () => {
      await assert.rejects(extract(`export type TtsRequest = {\n${field}\n};`), { message: `Speech spec: ${message}` });
    });
  }
  test("integer and exclusive lower bounds are inherited and cannot be widened", async () => {
    const base = 'export type TtsRequest = {\n/** Value. @integer @exclusiveMinimum 0 @maximum 10 */\nreadonly value?: number };';
    const spec = await extract(base, 'export type TtsRequest = {\n/** @minimum 2 @default 2 */\nreadonly value?: number };');
    assert.deepEqual(spec.tts.request.fields[0]!.constraints, { integer: true, exclusiveMinimum: 0, maximum: 10 });
    const provider = spec.tts.providers[0]!.request;
    if (provider.kind !== "object") throw new Error("Expected object");
    assert.deepEqual(provider.fields[0]!.constraints, { integer: true, exclusiveMinimum: 0, minimum: 2, maximum: 10 });
    await assert.rejects(extract(base, 'export type TtsRequest = {\n/** @exclusiveMinimum -1 */\nreadonly value?: number };'), { message: "Speech spec: provider fixture field value has constraints wider than the base field" });
    await assert.rejects(extract(base, 'export type TtsRequest = {\n/** @default 1.5 */\nreadonly value?: number };'), { message: "Speech spec: value @default is not a safe integer" });
    await assert.rejects(extract(base, 'export type TtsRequest = {\n/** @exclusiveMinimum 10 */\nreadonly value?: number };'), { message: "Speech spec: value has @exclusiveMinimum greater than or equal to @maximum" });
  });
  test("extracts typed default metadata without changing provider narrowing", async () => {
    const spec = await extract(base, `export type TtsRequest = {
      /** @default "pcm" */ readonly format?: "mp3" | "pcm";
    };`);
    const request = spec.tts.providers[0]!.request;
    if (request.kind !== "object") throw new Error("Expected object");
    assert.equal(request.fields[0]!.default, "pcm");
    assert.equal(request.fields[0]!.optional, true);
  });

  test("rejects a default outside the provider's narrowed union", async () => {
    const result = extract(base, `export type TtsRequest = {
      /** @default "wav" */
      readonly format?: "mp3" | "pcm";
    };`);
    await assert.rejects(result, { message: "Speech spec: format @default does not match its type" });
  });

  test("requires defaulted fields to be optional under the SDK's omission policy", async () => {
    const result = extract(base, `export type TtsRequest = {
      /** @default "pcm" */
      readonly format: "pcm";
    };`);
    await assert.rejects(result, { message: "Speech spec: format @default requires an optional field" });
  });

  test("rejects undefined as a non-JSON default literal", async () => {
    const result = extract(base, `export type TtsRequest = {
      /** @default undefined */
      readonly format?: "pcm";
    };`);
    await assert.rejects(result, { message: "Speech spec: format has an invalid @default; use a JSON literal" });
  });

  test("rejects a default below the minimum inherited from the base schema", async () => {
    const result = extract(base, `export type TtsRequest = {
      /** @default 4000 */
      readonly sampleRateHz?: number;
    };`);
    await assert.rejects(result, { message: "Speech spec: sampleRateHz @default is below @minimum" });
  });

  test("extracts documented fields and valid provider narrowing", async () => {
    const spec = await extract(base, `
      /** Provider request. */
      export type TtsRequest = {
        readonly format: "mp3" | "pcm";
        /** @minimum 16000 */
        readonly sampleRateHz?: number;
      };
    `);
    assert.equal(spec.tts.providers[0]?.documentation, "Provider request.");
    const request = spec.tts.providers[0]?.request;
    assert.equal(request?.kind, "object");
    if (request?.kind !== "object") throw new TypeError("Expected object request");
    assert.equal(request.fields[0]?.documentation, "Audio format.");
    assert.deepEqual(request.fields[1]?.constraints, { minimum: 16000, maximum: 48000 });
  });

  test("classifies aliases through checker identities", async () => {
    const spec = await extract(`
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
    assert.deepEqual(spec.tts.request.fields.map((field) => [field.name, field.type.kind]), [
      ["audio", "bytes"],
      ["input", "async-iterable"],
      ["labels", "array"],
      ["vendorObject", "object"],
    ]);
  });

  test("does not erase undefined from required or nested types", async () => {
    const required = extract(`
      /** Normalized request. */
      export type TtsRequest = {
        /** Required value. */
        readonly value: string | undefined;
      };
    `);
    await assert.rejects(required, /undefined is only supported through optional properties/);

    const nested = extract(`
      /** Normalized request. */
      export type TtsRequest = {
        /** Values. */
        readonly values?: Array<string | undefined>;
      };
    `);
    await assert.rejects(nested, /undefined is only supported through optional properties/);
  });

  test("preserves mutually exclusive request variants", async () => {
    const spec = await extract(base, `
      type Voice = { readonly voice: string; readonly referenceAudio?: never };
      type Clone = { readonly voice?: never; readonly referenceAudio: Uint8Array };
      export type TtsRequest = Voice | Clone;
    `);
    const request = spec.tts.providers[0]?.request;
    assert.equal(request?.kind, "union");
    if (request?.kind !== "union") throw new TypeError("Expected request union");
    assert.equal(request.anyOf.length, 2);
    assert.deepEqual(request.anyOf
      .map((part) => part.kind === "object" ? part.fields.map(({ name }) => name).join(",") : "")
      .sort(), ["referenceAudio", "voice"]);
    assert.deepEqual(request.anyOf.map(part => part.kind === "object" ? part.forbidden : []).flat().sort(), ["referenceAudio", "voice"]);
  });

  test("reports all provider schema errors", async () => {
    const result = extract(base, `
      export type TtsRequest = {
        readonly format?: "flac";
        readonly vendorOption?: string;
      };
    `);
    await assert.rejects(result, /field format widens/);
    await assert.rejects(result, /introduces unknown field vendorOption/);
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
    const spec = await extract(flatBase, provider);
    const request = spec.tts.providers[0]?.request;
    if (request?.kind !== "object") throw new TypeError("Expected object request");
    const output = request.fields.find((field) => field.name === "output");
    assert.equal(output?.documentation, "Requested audio representation.");
    assert.equal(output?.type.kind, "union");
    if (output?.type.kind !== "union") throw new TypeError("Expected provider output union");
    assert.equal(output.type.anyOf.length, 2);

    const wider = extract(flatBase, provider.replace('readonly format: "pcm"', 'readonly format: "flac"'));
    await assert.rejects(wider, /widens/);
  });

  test("requires explicit provider fields", async () => {
    const result = extract(base, `export type TtsRequest = { readonly [field: string]: string }`);
    await assert.rejects(result, /must list normalized fields explicitly/);
  });

  test("rejects partially overlapping unions", async () => {
    const result = extract(base, `export type TtsRequest = { readonly format?: "mp3" | "flac" }`);
    await assert.rejects(result, /field format widens/);
  });

  test("rejects wider annotated constraints", async () => {
    const result = extract(base, `
      export type TtsRequest = {
        /** @maximum 96000 */
        readonly sampleRateHz?: number;
      };
    `);
    await assert.rejects(result, /constraints wider than the base field/);
  });

  test("requires documentation on every public base field", async () => {
    const result = extract(`export type TtsRequest = { readonly text?: string }`);
    await assert.rejects(result, /public base field text must have documentation/);
  });

  test("requires the base schema to be exported", async () => {
    const result = extract(`type TtsRequest = { readonly text?: string }`);
    await assert.rejects(result, /TtsRequest must be exported from base.ts/);
  });
});
