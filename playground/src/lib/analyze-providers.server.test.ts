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
  test("discovers operations directly from authored provider exports", () => {
    const amazon = analyzeProviders().find(({ id }) => id === "amazon")

    expect(amazon?.operations.map(({ id }) => id)).toEqual([
      "synthesize",
      "synthesizeWithTimestamps",
    ])
    expect(property(amazon!.operations[0]!.request, "text").schema.kind).toBe("string")
    expect(property(amazon!.operations[0]!.request, "output").schema.kind).toBe("object")
  })

  test("uses the static request branch and preserves the timestamp model subset", () => {
    const amazon = analyzeProviders().find(({ id }) => id === "amazon")!
    const synthesisModel = property(amazon.operations[0]!.request, "model").schema
    const timestampModel = property(amazon.operations[1]!.request, "model").schema

    expect(synthesisModel.kind === "enum" ? synthesisModel.values : []).toContain("generative")
    expect(timestampModel.kind === "enum" ? timestampModel.values : []).not.toContain("generative")
  })
})
