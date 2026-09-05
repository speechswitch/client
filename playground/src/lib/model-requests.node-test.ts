import assert from "node:assert/strict"
import { test } from "node:test"
import { extractSpeechSpec } from "../../../codegen/specgen.ts"
import { providerSchemasFromSpeechSpec } from "./provider-schemas.ts"
import type { JsonValue } from "./provider-schema.ts"
import { changeSchemaField, initialValue, materialize, materializedRequest, objectFields, providerRequest, reconcileValue } from "./provider-request.ts"

const spec = extractSpeechSpec({
  root: `${import.meta.dirname}/fixtures/model-requests`,
  tsconfig: "tsconfig.json", baseFile: "base.ts", providers: [
    { id: "fixture", file: "provider.ts" }, { id: "presence", file: "presence.ts" },
  ],
})
const provider = providerSchemasFromSpeechSpec(spec)[0]!

test("uses model as the first selector and keeps optional model omission", () => {
  assert.equal(provider.request.kind, "discriminatedUnion")
  assert.equal(provider.request.discriminator, "model")
  assert.deepEqual(initialValue(provider.request), { text: "", voice: "" })
  const fields = objectFields(provider.request, { model: "legacy" })
  assert.deepEqual(fields.map(({ name }) => name), ["model", "output", "speed", "text", "voice"])
  assert.deepEqual(fields[0], {
    name: "model", optional: true, description: "Model.",
    schema: { kind: "enum", values: ["legacy", "dialogue", "modern", "modern-fast"] },
  })
})

test("shows model-specific options and retains every same-model timestamp variant", () => {
  assert.deepEqual(objectFields(provider.request, { model: "modern" }).map(({ name }) => name),
    ["model", "timestampGranularity", "language", "output", "speed", "text", "voice"])
  assert.deepEqual(objectFields(provider.request, { model: "modern-fast", timestampGranularity: "character" }).map(({ name }) => name),
    ["model", "timestampGranularity", "language", "output", "speed", "text", "timestampText", "voice"])
  assert.deepEqual(objectFields(provider.request, { model: "dialogue" }).map(({ name }) => name),
    ["model", "language", "output", "text", "voice"])
})

test("a model change removes only unsupported fields and preserves compatible nested output", () => {
  assert.deepEqual(changeSchemaField(provider.request, {
    model: "modern", text: "Hello", voice: "custom-voice", language: "fr", speed: 1.1,
    output: { format: "pcm", sampleRateHz: 24000 },
    timestampGranularity: "character", timestampText: "normalized",
  }, "model", "dialogue"), {
    model: "dialogue", text: "Hello", voice: "custom-voice", language: "fr",
    output: { format: "pcm", sampleRateHz: 24000 },
  })
})

test("optional selectors can return to omission without retaining dependent fields", () => {
  assert.deepEqual(changeSchemaField(provider.request, {
    model: "modern", text: "Hello", voice: "v", timestampGranularity: "character", timestampText: "normalized",
  }, "timestampGranularity", ""), { model: "modern", text: "Hello", voice: "v" })
  assert.deepEqual(changeSchemaField(provider.request, {
    model: "modern", text: "Hello", voice: "v", language: "fr", speed: 1.1,
  }, "model", ""), { text: "Hello", voice: "v", speed: 1.1 })
})

test("saved requests are validated against their model without dropping incompatible fields", () => {
  assert.throws(() => materializedRequest(provider, { model: "dialogue", text: "Hello", voice: "v", speed: 1.1 }),
    { name: "TypeError", message: "request: speed is not supported by this variant" })
  assert.throws(() => materializedRequest(provider, { model: "missing", text: "Hello", voice: "v" }),
    { name: "TypeError", message: "request: Expected a valid model" })
  assert.throws(() => materializedRequest(provider, { model: "modern", text: "Hello", voice: "v", timestampText: "normalized" }),
    { name: "TypeError", message: "request: timestampText is not supported by this variant" })
})

test("nested output selectors preserve multiple encodings with the same format", () => {
  const output = objectFields(provider.request, { model: "modern" }).find(({ name }) => name === "output")!.schema
  assert.deepEqual(objectFields(output, { format: "mp3" }).map(({ name, schema }) => ({ name, schema })), [
    { name: "format", schema: { kind: "enum", values: ["mp3", "pcm"] } },
    { name: "sampleRateHz", schema: { kind: "enum", values: [44100, 22050] } },
    { name: "bitRateBps", schema: { kind: "enum", values: [64000, 128000] } },
  ])
  assert.deepEqual(changeSchemaField(output, { format: "mp3", bitRateBps: 128000 }, "sampleRateHz", 22050),
    { format: "mp3", sampleRateHz: 22050, bitRateBps: 32000 })
  assert.throws(() => materialize(output, { format: "mp3", sampleRateHz: 22050, bitRateBps: 128000 }, false),
    { name: "TypeError", message: "request.bitRateBps: Expected one of 32000" })
  assert.throws(() => materialize(output, { format: "pcm", sampleRateHz: 16000, bitRateBps: 64000 }, false),
    { name: "TypeError", message: "request: bitRateBps is not supported by this variant" })
})

test("streaming retains model-specific buffering options and supports mixed text unions", async () => {
  const streaming = provider.streamingText!.request
  assert.deepEqual(objectFields(streaming, { model: "modern" }).map(({ name }) => name),
    ["model", "textBuffering", "language", "output", "speed", "text", "textBufferThresholds", "voice"])
  assert.deepEqual(objectFields(streaming, { model: "modern", textBuffering: false }).map(({ name }) => name),
    ["model", "textBuffering", "language", "output", "speed", "text", "voice"])
  assert.deepEqual(objectFields(streaming, { model: "dialogue" }).map(({ name }) => name),
    ["model", "language", "output", "text", "voice"])
  const request: JsonValue = { model: "modern", text: [{ text: "Hello" }, { text: " there", delayMs: 0 }], voice: "v", textBufferThresholds: [50, 100] }
  assert.deepEqual(materializedRequest(provider, request), request)
  const { text, ...options } = providerRequest(request, provider.streamingText) as { text: AsyncIterable<string> }
  assert.deepEqual(options, { model: "modern", voice: "v", textBufferThresholds: [50, 100] })
  assert.deepEqual(await Array.fromAsync(text), ["Hello", " there"])
  assert.deepEqual(materializedRequest(provider, { model: "dialogue", text: ["Hello", " there"], voice: "v" }),
    { model: "dialogue", text: [{ text: "Hello" }, { text: " there" }], voice: "v" })
})

test("both client and server reject invalid streaming combinations", () => {
  const request = { model: "modern", text: ["Hello", " there"], voice: "v", textBuffering: false, textBufferThresholds: [50] }
  const error = { name: "TypeError", message: "request: textBufferThresholds is not supported by this variant" }
  assert.throws(() => materializedRequest(provider, request), error)
  assert.throws(() => providerRequest(request, provider.streamingText), error)
  assert.throws(() => materializedRequest({ ...provider, streamingText: undefined }, request),
    { name: "TypeError", message: "This provider does not support streaming text" })
})

test("switching transport reconciles its schema instead of copying one branch's fixed model", () => {
  assert.deepEqual(reconcileValue(provider.streamingText!.request, {
    model: "dialogue", text: "Hello", voice: "v", language: "fr",
  }), { model: "dialogue", text: "Hello", voice: "v", language: "fr" })
  assert.deepEqual(reconcileValue(provider.request, {
    model: "modern", text: "Hello", voice: "v", textBuffering: false,
  }), { model: "modern", text: "Hello", voice: "v" })
})

test("presence discriminators expose non-literal fields and their dependent options", () => {
  const presence = providerSchemasFromSpeechSpec(spec)[1]!
  const initial = { model: "expressive", text: "Hello", voice: "v" }
  const fields = objectFields(presence.request, initial)
  assert.deepEqual(fields.map(({ name }) => name), ["timestampGranularity", "model", "text", "voice"])
  assert.deepEqual(fields[0], {
    name: "timestampGranularity", optional: true, presence: true, description: "Timestamp granularity.",
    schema: { kind: "union", variants: [
      { kind: "enum", values: ["character"] }, { kind: "array", item: { kind: "enum", values: ["character"] } },
    ] },
  })
  const selected = changeSchemaField(presence.request, initial, "timestampGranularity", ["character"])!
  assert.deepEqual(selected, { ...initial, timestampGranularity: ["character"] })
  assert.deepEqual(objectFields(presence.request, selected).map(({ name }) => name),
    ["timestampGranularity", "model", "text", "timestampText", "voice"])
  assert.deepEqual(materializedRequest(presence, selected), selected)
  assert.equal(changeSchemaField(presence.request, selected, "timestampGranularity", "["), undefined)
  assert.deepEqual(changeSchemaField(presence.request, { ...initial, timestampGranularity: "character", timestampText: "normalized" },
    "timestampGranularity", undefined), initial)
})

test("a structured union accepts JSON editor input and validates each original alternative", () => {
  const presence = providerSchemasFromSpeechSpec(spec)[1]!
  const request = { model: "expressive", text: "Hello", voice: "v", timestampGranularity: '["character"]' }
  assert.deepEqual(materializedRequest(presence, request), { ...request, timestampGranularity: ["character"] })
  assert.throws(() => materializedRequest(presence, { ...request, timestampGranularity: ["word"] }), {
    name: "TypeError",
    message: "request.timestampGranularity: No matching variant: request.timestampGranularity: Expected one of character; request.timestampGranularity[0]: Expected one of character",
  })
})
