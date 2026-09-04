import { describe, expect, test } from "bun:test"

import type { PropertySchema, TypeSchema } from "./provider-schema"
import { providerSchemasFromSpeechSpec } from "./provider-schemas"
import {
  initialValue,
  materialize,
  selectDiscriminatedVariant,
  streamingTextSegments,
} from "./provider-request"
import { repositorySpeechSpec } from "./repository-speech-spec.test-helper"

function property(schema: TypeSchema, name: string): PropertySchema {
  if (schema.kind !== "object") throw new TypeError(`Expected an object schema, received ${schema.kind}`)
  const result = schema.properties.find((candidate) => candidate.name === name)
  if (!result) throw new TypeError(`Missing property ${name}`)
  return result
}

describe("provider request schemas", () => {
  const output = repositorySpeechSpec().then((spec) => {
    const amazon = providerSchemasFromSpeechSpec(spec).find(({ id }) => id === "amazon")!
    return property(amazon.operations[0]!.request, "output").schema
  })

  test("initializes the first discriminated output branch", async () => {
    expect(initialValue(await output)).toEqual({ format: "mp3" })
  })

  test("validates values against the selected output branch", async () => {
    const schema = await output
    expect(materialize(schema, { format: "pcm", sampleRateHz: 16000 }, false)).toEqual({
      format: "pcm",
      sampleRateHz: 16000,
    })
    expect(() => materialize(schema, { format: "pcm", sampleRateHz: 44100 }, false)).toThrow(
      "Expected one of 8000, 16000",
    )
  })

  test("drops only values invalidated by a discriminator change", async () => {
    const schema = await output
    if (schema.kind !== "discriminatedUnion") throw new TypeError(`Expected a discriminated union, received ${schema.kind}`)
    expect(selectDiscriminatedVariant(schema, { format: "mp3", sampleRateHz: 44100 }, "pcm")).toEqual({
      format: "pcm",
    })
    expect(selectDiscriminatedVariant(schema, { format: "mp3", sampleRateHz: 16000 }, "pcm")).toEqual({
      format: "pcm",
      sampleRateHz: 16000,
    })
  })

  test("normalizes delayed streaming segments without breaking plain-string history", () => {
    expect(streamingTextSegments(["hello ", { text: "world", delayMs: 250 }])).toEqual([
      { text: "hello " },
      { text: "world", delayMs: 250 },
    ])
    expect(() => streamingTextSegments([{ text: "hello", delayMs: -1 }])).toThrow(
      "Streaming text segment 1 delayMs must be a non-negative integer",
    )
  })
})
