import assert from "node:assert/strict"
import path from "node:path"
import { describe, test } from "node:test"

import { extractRepositorySpeechSpec } from "../../../codegen/repository-spec.ts"
import type { PropertySchema, TypeSchema } from "./provider-schema.ts"
import { providerSchemasFromSpeechSpec } from "./provider-schemas.ts"
import {
  initialValue,
  materialize,
  selectDiscriminatedVariant,
  streamingTextSegments,
} from "./provider-request.ts"

function property(schema: TypeSchema, name: string): PropertySchema {
  assert.equal(schema.kind, "object")
  const result = schema.properties.find((candidate) => candidate.name === name)
  assert.ok(result, `Missing property ${name}`)
  return result
}

const speechSpec = extractRepositorySpeechSpec(path.resolve(import.meta.dirname, "../../.."))
const providers = providerSchemasFromSpeechSpec(speechSpec)
const amazon = providers.find(({ id }) => id === "amazon")!
const output = property(amazon.request, "output").schema
const fixture = providerSchemasFromSpeechSpec({ tts: { ...speechSpec.tts, providers: [{
  id: "fixture",
  request: { kind: "object", fields: [
    { name: "language", optional: true, documentation: "Language", typeScriptType: '"auto" | "fr"', default: "auto", type: { kind: "union", anyOf: [{ kind: "literal", value: "auto" }, { kind: "literal", value: "fr" }] } },
    { name: "text", optional: false, documentation: "Text", typeScriptType: "string", type: { kind: "string" } },
    { name: "replacements", optional: true, documentation: "Replacements", typeScriptType: "Replacement[]", type: { kind: "array", items: { kind: "object", fields: [
      { name: "pattern", optional: false, documentation: "Pattern", typeScriptType: "string", type: { kind: "string" } },
      { name: "replacement", optional: false, documentation: "Replacement", typeScriptType: "string", type: { kind: "string" } },
    ] } } },
  ] },
}] } })[0]!

describe("provider schemas", () => {
  test("initializes default metadata, including older saved requests, without overriding explicit values", () => {
    assert.equal(property(fixture.request, "language").default, "auto")
    assert.deepEqual(initialValue(fixture.request), { language: "auto", text: "" })
    assert.deepEqual(materialize(fixture.request, { text: "hello" }, false), { language: "auto", text: "hello" })
    assert.deepEqual(materialize(fixture.request, { text: "hello", language: "fr" }, false), { language: "fr", text: "hello" })
    assert.equal(property(amazon.request, "language").default, undefined)
  })

  test("nested materialization errors identify the field and array item", () => {
    assert.throws(() => materialize(fixture.request, {
      text: "hello", replacements: [{ replacement: "Acme Mobull" }],
    }, false), /request\.replacements\[0\]\.pattern: Expected a string/)
    assert.deepEqual(materialize(fixture.request, {
      text: "hello", replacements: '[{"pattern":"Acme Mobile","replacement":"Acme Mobull"}]',
    }, false), { language: "auto", text: "hello", replacements: [{ pattern: "Acme Mobile", replacement: "Acme Mobull" }] })
  })

  test("uses the normalized provider request produced by specgen", () => {
    assert.equal(property(amazon.request, "text").schema.kind, "string")
    assert.equal(output.kind, "discriminatedUnion")
    assert.deepEqual(amazon.streamingText?.constraints, { model: "generative" })
    assert.equal(property(amazon.request, "voice").description, "Provider voice identifier.")
  })

  test("preserves format-specific sample rates from discriminated output unions", () => {
    assert.equal(output.kind, "discriminatedUnion")
    assert.equal(output.discriminator, "format")
    assert.deepEqual(output.variants.map(({ values, schema }) => {
      const sampleRate = property(schema, "sampleRateHz").schema
      return { formats: values, sampleRates: sampleRate.kind === "enum" ? sampleRate.values : [] }
    }), [
      { formats: ["mp3", "ogg_vorbis"], sampleRates: [8000, 16000, 22050, 24000, 44100, 48000] },
      { formats: ["pcm"], sampleRates: [8000, 16000] },
      { formats: ["ogg_opus"], sampleRates: [48000] },
      { formats: ["alaw", "mulaw"], sampleRates: [8000] },
    ])
  })

  test("initializes and validates the selected output branch", () => {
    assert.deepEqual(initialValue(output), { format: "mp3" })
    assert.deepEqual(materialize(output, { format: "pcm", sampleRateHz: 16000 }, false), {
      format: "pcm",
      sampleRateHz: 16000,
    })
    assert.throws(
      () => materialize(output, { format: "pcm", sampleRateHz: 44100 }, false),
      /Expected one of 8000, 16000/,
    )
  })

  test("drops only values invalidated by a discriminator change", () => {
    assert.equal(output.kind, "discriminatedUnion")
    assert.deepEqual(selectDiscriminatedVariant(output, { format: "mp3", sampleRateHz: 44100 }, "pcm"), {
      format: "pcm",
    })
    assert.deepEqual(selectDiscriminatedVariant(output, { format: "mp3", sampleRateHz: 16000 }, "pcm"), {
      format: "pcm",
      sampleRateHz: 16000,
    })
  })

  test("normalizes delayed streaming segments without breaking plain-string history", () => {
    assert.deepEqual(streamingTextSegments(["hello ", { text: "world", delayMs: 250 }]), [
      { text: "hello " },
      { text: "world", delayMs: 250 },
    ])
    assert.throws(
      () => streamingTextSegments([{ text: "hello", delayMs: -1 }]),
      /Streaming text segment 1 delayMs must be a non-negative integer/,
    )
  })
})
