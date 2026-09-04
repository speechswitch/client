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

const amazon = providerSchemasFromSpeechSpec(
  extractRepositorySpeechSpec(path.resolve(import.meta.dirname, "../../..")),
).find(({ id }) => id === "amazon")!
const output = property(amazon.request, "output").schema

describe("provider schemas", () => {
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
