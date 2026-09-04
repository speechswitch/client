import { describe, expect, test } from "bun:test"

import { analyzeProviders } from "./analyze-providers.server"
import type { PropertySchema, TypeSchema } from "./provider-schema"

function property(schema: TypeSchema, name: string): PropertySchema {
  if (schema.kind !== "object") throw new TypeError(`Expected an object schema, received ${schema.kind}`)
  const result = schema.properties.find((candidate) => candidate.name === name)
  if (!result) throw new TypeError(`Missing property ${name}`)
  return result
}

describe("provider schema analysis", () => {
  test("uses the normalized provider request produced by specgen", () => {
    const amazon = analyzeProviders().find(({ id }) => id === "amazon")

    expect(amazon?.operations.map(({ id }) => id)).toEqual(["synthesize"])
    expect(property(amazon!.operations[0]!.request, "text").schema.kind).toBe("string")
    expect(property(amazon!.operations[0]!.request, "output").schema.kind).toBe("discriminatedUnion")
    expect(amazon!.operations[0]!.streamingText?.constraints).toEqual({ model: "generative" })
    expect(property(amazon!.operations[0]!.request, "voice").description).toBe("Provider voice identifier.")
  })

  test("preserves format-specific sample rates from discriminated output unions", () => {
    const amazon = analyzeProviders().find(({ id }) => id === "amazon")!
    const output = property(amazon.operations[0]!.request, "output").schema
    if (output.kind !== "discriminatedUnion") throw new TypeError(`Expected a discriminated union, received ${output.kind}`)

    expect(output.discriminator).toBe("format")
    expect(output.variants.map(({ values, schema }) => ({
      formats: values,
      sampleRates: (() => {
        const sampleRate = property(schema, "sampleRateHz").schema
        return sampleRate.kind === "enum" ? sampleRate.values : []
      })(),
    }))).toEqual([
      { formats: ["mp3", "ogg_vorbis"], sampleRates: [8000, 16000, 22050, 24000, 44100, 48000] },
      { formats: ["pcm"], sampleRates: [8000, 16000] },
      { formats: ["ogg_opus"], sampleRates: [48000] },
      { formats: ["alaw", "mulaw"], sampleRates: [8000] },
    ])
  })

})
