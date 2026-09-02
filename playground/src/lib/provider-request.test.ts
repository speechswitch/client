import { describe, expect, test } from "bun:test"

import { analyzeProviders } from "./analyze-providers.server"
import type { PropertySchema, TypeSchema } from "./provider-schema"
import {
  initialValue,
  materialize,
  selectDiscriminatedVariant,
} from "./provider-request"

function property(schema: TypeSchema, name: string): PropertySchema {
  if (schema.kind !== "object") throw new TypeError(`Expected an object schema, received ${schema.kind}`)
  const result = schema.properties.find((candidate) => candidate.name === name)
  if (!result) throw new TypeError(`Missing property ${name}`)
  return result
}

describe("provider request schemas", () => {
  const amazon = analyzeProviders().find(({ id }) => id === "amazon")!
  const output = property(amazon.operations[0]!.request, "output").schema

  test("initializes the first discriminated output branch", () => {
    expect(initialValue(output)).toEqual({ format: "mp3" })
  })

  test("validates values against the selected output branch", () => {
    expect(materialize(output, { format: "pcm", sampleRateHz: 16000 }, false)).toEqual({
      format: "pcm",
      sampleRateHz: 16000,
    })
    expect(() => materialize(output, { format: "pcm", sampleRateHz: 44100 }, false)).toThrow(
      "Expected one of 8000, 16000",
    )
  })

  test("drops only values invalidated by a discriminator change", () => {
    if (output.kind !== "discriminatedUnion") throw new TypeError(`Expected a discriminated union, received ${output.kind}`)
    expect(selectDiscriminatedVariant(output, { format: "mp3", sampleRateHz: 44100 }, "pcm")).toEqual({
      format: "pcm",
    })
    expect(selectDiscriminatedVariant(output, { format: "mp3", sampleRateHz: 16000 }, "pcm")).toEqual({
      format: "pcm",
      sampleRateHz: 16000,
    })
  })
})
