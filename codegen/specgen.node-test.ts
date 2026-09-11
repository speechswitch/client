import assert from "node:assert/strict";
import { expect } from "expect";
import { afterEach, describe, test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractSpeechSpec } from "./specgen.ts";
import type { SpeechSpec } from "./spec-model.ts";
import { renderRequestSerializer } from "./request-serializer.ts";
import { pathToFileURL } from "node:url";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function extract(base: string, provider?: string): Promise<SpeechSpec> {
  const root = await mkdtemp(path.join(tmpdir(), "speech-switch-spec-"));
  directories.push(root);
  await writeFile(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, lib: ["ESNext"], types: [] },
      include: ["*.ts"],
    }),
  );
  await writeFile(path.join(root, "base.ts"), base);
  if (provider) await writeFile(path.join(root, "provider.ts"), provider);
  return extractSpeechSpec({
    root,
    tsconfig: "tsconfig.json",
    baseFile: "base.ts",
    providers: provider ? [{ id: "fixture", file: "provider.ts" }] : [],
  });
}

async function serializer(source: string) {
  const spec = await extract(source, source);
  const code = renderRequestSerializer(spec.tts.providers[0]!);
  const root = await mkdtemp(path.join(tmpdir(), "speech-switch-serializer-"));
  directories.push(root);
  const file = path.join(root, "serializer.ts");
  await writeFile(file, code);
  return import(pathToFileURL(file).href);
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
    [
      "/** Value. @integer */ readonly value: string",
      "value uses numeric bounds on a non-number type",
    ],
    [
      "/** Value. @integer false */ readonly value: number",
      "value @integer does not accept a value",
    ],
    [
      "/** Value. @integer @default 1.5 */ readonly value?: number",
      "value @default is not a safe integer",
    ],
    [
      "/** Value. @integer @minimum 0.1 @maximum 0.9 */ readonly value: number",
      "value has no safe integers within its bounds",
    ],
  ]) {
    test(`rejects ${field} with an exact diagnostic`, async () => {
      await assert.rejects(extract(`export type TtsRequest = {\n${field}\n};`), {
        message: `Speech spec: ${message}`,
      });
    });
  }
  test("integer bounds are inherited and checked after provider narrowing", async () => {
    const base = `export type TtsRequest = {
      /** Value. @integer @minimum 0 @maximum 10 */ readonly value?: number;
    };`;
    const spec = await extract(
      base,
      `export type TtsRequest = {
      /** @minimum 2 @default 2 */ readonly value?: number;
    };`,
    );
    const provider = spec.tts.providers[0]!.request;
    assert.equal(provider.kind, "object");
    if (provider.kind !== "object") return;
    assert.deepEqual(provider.fields[0]!.constraints, { integer: true, minimum: 2, maximum: 10 });
    await assert.rejects(
      extract(
        base,
        `export type TtsRequest = {
      /** @default 1.5 */ readonly value?: number;
    };`,
      ),
      { message: "Speech spec: value @default is not a safe integer" },
    );
    await assert.rejects(
      extract(
        base,
        `export type TtsRequest = {
      /** @minimum 0.1 @maximum 0.9 */ readonly value?: number;
    };`,
      ),
      { message: "Speech spec: value has no safe integers within its bounds" },
    );
  });
  test("extracts typed default metadata without changing provider narrowing", async () => {
    const spec = await extract(
      base,
      `export type TtsRequest = {
      /** @default "pcm" */ readonly format?: "mp3" | "pcm";
    };`,
    );
    const request = spec.tts.providers[0]!.request;
    if (request.kind !== "object") throw new Error("Expected object");
    expect(request.fields[0]!.default).toBe("pcm");
    expect(request.fields[0]!.optional).toBe(true);
  });

  test("rejects a default outside the provider's narrowed union", async () => {
    const result = extract(
      base,
      `export type TtsRequest = {
      /** @default "wav" */
      readonly format?: "mp3" | "pcm";
    };`,
    );
    await expect(result).rejects.toMatchObject({
      message: "Speech spec: format @default does not match its type",
    });
  });

  test("requires defaulted fields to be optional under the SDK's omission policy", async () => {
    const result = extract(
      base,
      `export type TtsRequest = {
      /** @default "pcm" */
      readonly format: "pcm";
    };`,
    );
    await expect(result).rejects.toMatchObject({
      message: "Speech spec: format @default requires an optional field",
    });
  });

  test("rejects undefined as a non-JSON default literal", async () => {
    const result = extract(
      base,
      `export type TtsRequest = {
      /** @default undefined */
      readonly format?: "pcm";
    };`,
    );
    await expect(result).rejects.toMatchObject({
      message: "Speech spec: format has an invalid @default; use a JSON literal",
    });
  });

  test("rejects a default below the minimum inherited from the base schema", async () => {
    const result = extract(
      base,
      `export type TtsRequest = {
      /** @default 4000 */
      readonly sampleRateHz?: number;
    };`,
    );
    await expect(result).rejects.toMatchObject({
      message: "Speech spec: sampleRateHz @default is below @minimum",
    });
  });

  test("extracts documented fields and valid provider narrowing", async () => {
    const spec = await extract(
      base,
      `
      /** Provider request. */
      export type TtsRequest = {
        readonly format: "mp3" | "pcm";
        /** @minimum 16000 */
        readonly sampleRateHz?: number;
      };
    `,
    );
    expect(spec.tts.providers[0]?.documentation).toBe("Provider request.");
    const request = spec.tts.providers[0]?.request;
    expect(request?.kind).toBe("object");
    if (request?.kind !== "object") throw new TypeError("Expected object request");
    expect(request.fields[0]?.documentation).toBe("Audio format.");
    expect(request.fields[1]?.constraints).toStrictEqual({ minimum: 16000, maximum: 48000 });
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
    expect(spec.tts.request.fields.map((field) => [field.name, field.type.kind])).toStrictEqual([
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
    await expect(required).rejects.toThrow(
      /undefined is only supported through optional properties/,
    );

    const nested = extract(`
      /** Normalized request. */
      export type TtsRequest = {
        /** Values. */
        readonly values?: Array<string | undefined>;
      };
    `);
    await expect(nested).rejects.toThrow(/undefined is only supported through optional properties/);
  });

  test("preserves mutually exclusive request variants", async () => {
    const spec = await extract(
      base,
      `
      type Voice = { readonly voice: string; readonly referenceAudio?: never };
      type Clone = { readonly voice?: never; readonly referenceAudio: Uint8Array };
      export type TtsRequest = Voice | Clone;
    `,
    );
    const request = spec.tts.providers[0]?.request;
    expect(request?.kind).toBe("union");
    if (request?.kind !== "union") throw new TypeError("Expected request union");
    expect(request.anyOf).toHaveLength(2);
    expect(
      request.anyOf
        .map((part) =>
          part.kind === "object" ? part.fields.map(({ name }) => name).join(",") : "",
        )
        .sort(),
    ).toStrictEqual(["referenceAudio", "voice"]);
    expect(
      request.anyOf
        .map((part) => (part.kind === "object" ? part.forbidden : []))
        .flat()
        .sort(),
    ).toStrictEqual(["referenceAudio", "voice"]);
  });

  test("reports all provider schema errors", async () => {
    const result = extract(
      base,
      `
      export type TtsRequest = {
        readonly format?: "flac";
        readonly vendorOption?: string;
      };
    `,
    );
    await expect(result).rejects.toThrow(/field format widens/);
    await expect(result).rejects.toThrow(/introduces unknown field vendorOption/);
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
    expect(output?.documentation).toBe("Requested audio representation.");
    expect(output?.type.kind).toBe("union");
    if (output?.type.kind !== "union") throw new TypeError("Expected provider output union");
    expect(output.type.anyOf).toHaveLength(2);

    const wider = extract(
      flatBase,
      provider.replace('readonly format: "pcm"', 'readonly format: "flac"'),
    );
    await expect(wider).rejects.toThrow(/widens/);
  });

  test("requires explicit provider fields", async () => {
    const result = extract(base, `export type TtsRequest = { readonly [field: string]: string }`);
    await expect(result).rejects.toThrow(/must list normalized fields explicitly/);
  });

  test("rejects partially overlapping unions", async () => {
    const result = extract(base, `export type TtsRequest = { readonly format?: "mp3" | "flac" }`);
    await expect(result).rejects.toThrow(/field format widens/);
  });

  test("rejects wider annotated constraints", async () => {
    const result = extract(
      base,
      `
      export type TtsRequest = {
        /** @maximum 96000 */
        readonly sampleRateHz?: number;
      };
    `,
    );
    await expect(result).rejects.toThrow(/constraints wider than the base field/);
  });

  test("requires documentation on every public base field", async () => {
    const result = extract(`export type TtsRequest = { readonly text?: string }`);
    await expect(result).rejects.toThrow(/public base field text must have documentation/);
  });

  test("requires the base schema to be exported", async () => {
    const result = extract(`type TtsRequest = { readonly text?: string }`);
    await expect(result).rejects.toThrow(/TtsRequest must be exported from base.ts/);
  });
});

test("narrows map values and rejects undefined values", async () => {
  const base = `export type TtsRequest = {
  /** X. */
  x?: Readonly<Record<string, string>> };`;
  const spec = await extract(
    base,
    `export type TtsRequest = { x: Readonly<Record<string, "y">> };`,
  );
  const request = spec.tts.providers[0]!.request;
  if (request.kind !== "object") throw new Error("Expected object");
  expect(request.fields[0]!.type).toStrictEqual({
    kind: "record",
    items: { kind: "literal", value: "y" },
  });
  await expect(
    extract(`export type TtsRequest = {
  /** X. */
  x?: Record<string, string | undefined> };`),
  ).rejects.toThrow("undefined is only supported through optional properties");
  await expect(
    extract(base, `export type TtsRequest = { x: Record<string, number> };`),
  ).rejects.toThrow();
});

test("serializes only the selected contract without reading skipped fields", async () => {
  const { toRest, toV3 } = await serializer(`export type TtsRequest = {
    /** X. @serializeAs rest x-id
     * @serializeAs v3 y */ x?: string;
    /** Y. */ y?: number;
    /** Z. @serializeAs rest z */ z?: boolean;
  };`);
  let reads = 0;
  const request = Object.freeze({
    get x() {
      reads++;
      return "x";
    },
    get y() {
      throw new Error("Unmapped field must not be read");
    },
    z: false,
  });
  expect(toRest(request)).toStrictEqual({ "x-id": "x", z: false });
  expect(reads).toBe(1);
  expect(toV3(request)).toStrictEqual({ y: "x" });
  expect(toRest({ x: undefined })).toStrictEqual({});
});

test("serializes nested objects and collections while preserving record keys", async () => {
  const { toRest } = await serializer(`interface X {
    /** @serializeAs rest y */ x: string;
    z?: number;
  }
  export type TtsRequest = {
    /** X. @serializeAs rest x */ x?: X;
    /** Y. @serializeAs rest y */ y?: readonly X[];
    /** Z. @serializeAs rest z */ z?: Readonly<Record<string, X>>;
    /** M. @serializeAs rest m */ m?: Readonly<Record<string, string>>;
  };`);
  const x = Object.freeze({ x: "x", z: 1 });
  const m = Object.freeze({ x: "y" });
  const result = toRest({ x, y: [x], z: { x }, m });
  expect(result).toStrictEqual({ x: { y: "x" }, y: [{ y: "x" }], z: { x: { y: "x" } }, m });
  expect(result.m).toBe(m);
  expect(x).toStrictEqual({ x: "x", z: 1 });
});

test("serializes shared union mappings and optional variant fields", async () => {
  const { toRest } = await serializer(`export type TtsRequest = {
    /** X. @serializeAs rest x */ x?:
      | {
          /** @serializeAs rest y */ x: "x" }
      | {
          /** @serializeAs rest y */ x: "y";
          /** @serializeAs rest z */ z?: number };
  };`);
  expect(toRest({ x: { x: "x" } })).toStrictEqual({ x: { y: "x" } });
  expect(toRest({ x: { x: "y", z: 0 } })).toStrictEqual({ x: { y: "y", z: 0 } });
});

test("rejects malformed and duplicate serialization annotations", async () => {
  await expect(
    serializer(`export type TtsRequest = {
    /** X. @serializeAs rest */ x?: string;
  };`),
  ).rejects.toThrow("x has an invalid @serializeAs; expected <contract> <field>");
  await expect(
    serializer(`export type TtsRequest = {
    /** X. @serializeAs rest x
     * @serializeAs rest y */ x?: string;
  };`),
  ).rejects.toThrow("x has duplicate @serializeAs for rest");
  await expect(
    serializer(`export type TtsRequest = {
    /** X. @serializeAs rest x */ x?: string;
    /** Y. @serializeAs rest x */ y?: string;
  };`),
  ).rejects.toThrow("Duplicate @serializeAs rest destination x");
});

test("rejects conflicting union mappings instead of emitting the wrong branch's fields", async () => {
  await expect(
    serializer(`export type TtsRequest = {
    /** X. @serializeAs rest x */ x?:
      | {
          /** @serializeAs rest x */ x: "x" }
      | {
          /** @serializeAs rest y */ x: "y" };
  };`),
  ).rejects.toThrow("Conflicting @serializeAs rest for x");
});

test("provider outputs must narrow a complete base container/codec variant", async () => {
  const base = `export type TtsRequest = {
    /** Audio output. */ readonly output?:
      | { readonly codec: "mp3"; readonly container?: never; readonly sampleFormat?: never }
      | { readonly codec: "pcm"; readonly container: "raw" | "wav"; readonly sampleFormat?: "int16" };
  };`;
  await expect(
    extract(
      base,
      `export type TtsRequest = {
    readonly output: { readonly codec: "pcm"; readonly container: "wav"; readonly sampleFormat?: "int16" };
  };`,
    ),
  ).resolves.toBeDefined();
  for (const output of [
    '{ readonly codec: "mp3"; readonly container: "wav" }',
    '{ readonly codec: "mp3" | "pcm"; readonly container: "raw" | "wav" }',
    '{ readonly codec: "pcm" }',
    '{ readonly container: "wav" }',
    '{ readonly codec: "mp3"; readonly sampleFormat: "int16" }',
  ]) {
    await expect(
      extract(base, `export type TtsRequest = { readonly output: ${output} };`),
    ).rejects.toThrow("provider fixture field output widens");
  }
});
