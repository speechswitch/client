import { expect } from "expect";
import { test } from "node:test";
import { extractSpeechSpec } from "../../../codegen/specgen.ts";
import { providerSchemasFromSpeechSpec } from "./provider-schemas.ts";
import type { JsonValue } from "./provider-schema.ts";
import {
  changeSchemaField,
  initialValue,
  materialize,
  materializedRequest,
  objectFields,
  providerRequest,
  reconcileValue,
} from "./provider-request.ts";

const spec = extractSpeechSpec({
  root: `${import.meta.dirname}/fixtures/model-requests`,
  tsconfig: "tsconfig.json",
  baseFile: "base.ts",
  providers: [
    { id: "fixture", file: "provider.ts" },
    { id: "presence", file: "presence.ts" },
  ],
});
const provider = providerSchemasFromSpeechSpec(spec)[0]!;

test("uses model as the first selector and keeps optional model omission", () => {
  expect(provider.request.kind).toBe("discriminatedUnion");
  if (provider.request.kind !== "discriminatedUnion")
    throw new TypeError("Expected discriminated union");
  expect(provider.request.discriminator).toBe("model");
  expect(initialValue(provider.request)).toStrictEqual({ text: "", voice: "" });
  const fields = objectFields(provider.request, { model: "legacy" });
  expect(fields.map(({ name }) => name)).toStrictEqual([
    "model",
    "output",
    "speed",
    "text",
    "voice",
  ]);
  expect(fields[0]).toStrictEqual({
    name: "model",
    optional: true,
    description: "Model.",
    schema: { kind: "enum", values: ["legacy", "dialogue", "modern", "modern-fast"] },
  });
});

test("shows model-specific options and retains every same-model timestamp variant", () => {
  expect(objectFields(provider.request, { model: "modern" }).map(({ name }) => name)).toStrictEqual(
    ["model", "timestampGranularity", "language", "output", "speed", "text", "voice"],
  );
  expect(
    objectFields(provider.request, { model: "modern-fast", timestampGranularity: "character" }).map(
      ({ name }) => name,
    ),
  ).toStrictEqual([
    "model",
    "timestampGranularity",
    "language",
    "output",
    "speed",
    "text",
    "timestampText",
    "voice",
  ]);
  expect(
    objectFields(provider.request, { model: "dialogue" }).map(({ name }) => name),
  ).toStrictEqual(["model", "language", "output", "text", "voice"]);
});

test("a model change removes only unsupported fields and preserves compatible nested output", () => {
  expect(
    changeSchemaField(
      provider.request,
      {
        model: "modern",
        text: "Hello",
        voice: "custom-voice",
        language: "fr",
        speed: 1.1,
        output: { format: "pcm", sampleRateHz: 24000 },
        timestampGranularity: "character",
        timestampText: "normalized",
      },
      "model",
      "dialogue",
    ),
  ).toStrictEqual({
    model: "dialogue",
    text: "Hello",
    voice: "custom-voice",
    language: "fr",
    output: { format: "pcm", sampleRateHz: 24000 },
  });
});

test("optional selectors can return to omission without retaining dependent fields", () => {
  expect(
    changeSchemaField(
      provider.request,
      {
        model: "modern",
        text: "Hello",
        voice: "v",
        timestampGranularity: "character",
        timestampText: "normalized",
      },
      "timestampGranularity",
      "",
    ),
  ).toStrictEqual({ model: "modern", text: "Hello", voice: "v" });
  expect(
    changeSchemaField(
      provider.request,
      {
        model: "modern",
        text: "Hello",
        voice: "v",
        language: "fr",
        speed: 1.1,
      },
      "model",
      "",
    ),
  ).toStrictEqual({ text: "Hello", voice: "v", speed: 1.1 });
});

test("saved requests are validated against their model without dropping incompatible fields", () => {
  expect(() =>
    materializedRequest(provider, { model: "dialogue", text: "Hello", voice: "v", speed: 1.1 }),
  ).toThrow(
    expect.objectContaining({
      name: "TypeError",
      message: "request: speed is not supported by this variant",
    }),
  );
  expect(() =>
    materializedRequest(provider, { model: "missing", text: "Hello", voice: "v" }),
  ).toThrow(
    expect.objectContaining({ name: "TypeError", message: "request: Expected a valid model" }),
  );
  expect(() =>
    materializedRequest(provider, {
      model: "modern",
      text: "Hello",
      voice: "v",
      timestampText: "normalized",
    }),
  ).toThrow(
    expect.objectContaining({
      name: "TypeError",
      message: "request: timestampText is not supported by this variant",
    }),
  );
});

test("nested output selectors preserve multiple encodings with the same format", () => {
  const output = objectFields(provider.request, { model: "modern" }).find(
    ({ name }) => name === "output",
  )!.schema;
  expect(
    objectFields(output, { format: "mp3" }).map(({ name, schema }) => ({ name, schema })),
  ).toStrictEqual([
    { name: "format", schema: { kind: "enum", values: ["mp3", "pcm"] } },
    { name: "sampleRateHz", schema: { kind: "enum", values: [44100, 22050] } },
    { name: "bitRateBps", schema: { kind: "enum", values: [64000, 128000] } },
  ]);
  expect(
    changeSchemaField(output, { format: "mp3", bitRateBps: 128000 }, "sampleRateHz", 22050),
  ).toStrictEqual({ format: "mp3", sampleRateHz: 22050, bitRateBps: 32000 });
  expect(() =>
    materialize(output, { format: "mp3", sampleRateHz: 22050, bitRateBps: 128000 }, false),
  ).toThrow(
    expect.objectContaining({
      name: "TypeError",
      message: "request.bitRateBps: Expected one of 32000",
    }),
  );
  expect(() =>
    materialize(output, { format: "pcm", sampleRateHz: 16000, bitRateBps: 64000 }, false),
  ).toThrow(
    expect.objectContaining({
      name: "TypeError",
      message: "request: bitRateBps is not supported by this variant",
    }),
  );
});

test("streaming retains model-specific buffering options and supports mixed text unions", async () => {
  const streaming = provider.streamingText!.request;
  expect(objectFields(streaming, { model: "modern" }).map(({ name }) => name)).toStrictEqual([
    "model",
    "textBuffering",
    "language",
    "output",
    "speed",
    "text",
    "textBufferThresholds",
    "voice",
  ]);
  expect(
    objectFields(streaming, { model: "modern", textBuffering: false }).map(({ name }) => name),
  ).toStrictEqual(["model", "textBuffering", "language", "output", "speed", "text", "voice"]);
  expect(objectFields(streaming, { model: "dialogue" }).map(({ name }) => name)).toStrictEqual([
    "model",
    "language",
    "output",
    "text",
    "voice",
  ]);
  const request: JsonValue = {
    model: "modern",
    text: [{ text: "Hello" }, { text: " there", delayMs: 0 }],
    voice: "v",
    textBufferThresholds: [50, 100],
  };
  expect(materializedRequest(provider, request)).toStrictEqual(request);
  const { text, ...options } = providerRequest(request, provider.streamingText) as {
    text: AsyncIterable<string>;
  };
  expect(options).toStrictEqual({ model: "modern", voice: "v", textBufferThresholds: [50, 100] });
  expect(await Array.fromAsync(text)).toStrictEqual(["Hello", " there"]);
  expect(
    materializedRequest(provider, { model: "dialogue", text: ["Hello", " there"], voice: "v" }),
  ).toStrictEqual({ model: "dialogue", text: [{ text: "Hello" }, { text: " there" }], voice: "v" });
});

test("both client and server reject invalid streaming combinations", () => {
  const request = {
    model: "modern",
    text: ["Hello", " there"],
    voice: "v",
    textBuffering: false,
    textBufferThresholds: [50],
  };
  const error = {
    name: "TypeError",
    message: "request: textBufferThresholds is not supported by this variant",
  };
  expect(() => materializedRequest(provider, request)).toThrow(expect.objectContaining(error));
  expect(() => providerRequest(request, provider.streamingText)).toThrow(
    expect.objectContaining(error),
  );
  expect(() => materializedRequest({ ...provider, streamingText: undefined }, request)).toThrow(
    expect.objectContaining({
      name: "TypeError",
      message: "This provider does not support streaming text",
    }),
  );
});

test("switching transport reconciles its schema instead of copying one branch's fixed model", () => {
  expect(
    reconcileValue(provider.streamingText!.request, {
      model: "dialogue",
      text: "Hello",
      voice: "v",
      language: "fr",
    }),
  ).toStrictEqual({ model: "dialogue", text: "Hello", voice: "v", language: "fr" });
  expect(
    reconcileValue(provider.request, {
      model: "modern",
      text: "Hello",
      voice: "v",
      textBuffering: false,
    }),
  ).toStrictEqual({ model: "modern", text: "Hello", voice: "v" });
});

test("presence discriminators expose non-literal fields and their dependent options", () => {
  const presence = providerSchemasFromSpeechSpec(spec)[1]!;
  const initial = { model: "expressive", text: "Hello", voice: "v" };
  const fields = objectFields(presence.request, initial);
  expect(fields.map(({ name }) => name)).toStrictEqual([
    "timestampGranularity",
    "model",
    "text",
    "voice",
  ]);
  expect(fields[0]).toStrictEqual({
    name: "timestampGranularity",
    optional: true,
    presence: true,
    description: "Timestamp granularity.",
    schema: {
      kind: "union",
      variants: [
        { kind: "enum", values: ["character"] },
        { kind: "array", item: { kind: "enum", values: ["character"] } },
      ],
    },
  });
  const selected = changeSchemaField(presence.request, initial, "timestampGranularity", [
    "character",
  ])!;
  expect(selected).toStrictEqual({ ...initial, timestampGranularity: ["character"] });
  expect(objectFields(presence.request, selected).map(({ name }) => name)).toStrictEqual([
    "timestampGranularity",
    "model",
    "text",
    "timestampText",
    "voice",
  ]);
  expect(materializedRequest(presence, selected)).toStrictEqual(selected);
  expect(
    changeSchemaField(presence.request, selected, "timestampGranularity", "["),
  ).toBeUndefined();
  expect(
    changeSchemaField(
      presence.request,
      { ...initial, timestampGranularity: "character", timestampText: "normalized" },
      "timestampGranularity",
      undefined,
    ),
  ).toStrictEqual(initial);
});

test("a structured union accepts JSON editor input and validates each original alternative", () => {
  const presence = providerSchemasFromSpeechSpec(spec)[1]!;
  const request = {
    model: "expressive",
    text: "Hello",
    voice: "v",
    timestampGranularity: '["character"]',
  };
  expect(materializedRequest(presence, request)).toStrictEqual({
    ...request,
    timestampGranularity: ["character"],
  });
  expect(() =>
    materializedRequest(presence, { ...request, timestampGranularity: ["word"] }),
  ).toThrow(
    expect.objectContaining({
      name: "TypeError",
      message:
        "request.timestampGranularity: No matching variant: request.timestampGranularity: Expected one of character; request.timestampGranularity[0]: Expected one of character",
    }),
  );
});
