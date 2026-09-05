import type { SchemaType, SpeechSpec } from "../../../codegen/spec-model.ts"
import type {
  ObjectSchema,
  PropertySchema,
  ProviderSchema,
  Scalar,
  TypeSchema,
} from "./provider-schema.ts"

function literalValues(type: SchemaType): Scalar[] | undefined {
  const alternatives = type.kind === "union" ? type.anyOf : [type]
  const values = alternatives.map((alternative) =>
    alternative.kind === "literal" && alternative.value !== null ? alternative.value : undefined)
  return values.every((value) => value !== undefined) ? values as Scalar[] : undefined
}

function discriminator(
  alternatives: readonly Extract<SchemaType, { kind: "object" }>[],
): { name: string; values: Scalar[][] } | undefined {
  for (const candidate of alternatives[0]?.fields ?? []) {
    const values = alternatives.map((alternative) => {
      const field = alternative.fields.find(({ name }) => name === candidate.name)
      return field && !field.optional ? literalValues(field.type) : undefined
    })
    if (values.some((value) => value === undefined)) continue
    const flattened = values.flatMap((value) => value!)
    if (new Set(flattened.map((value) => `${typeof value}:${String(value)}`)).size === flattened.length) {
      return { name: candidate.name, values: values as Scalar[][] }
    }
  }
}

function objectSchema(type: Extract<SchemaType, { kind: "object" }>): ObjectSchema {
  return {
    kind: "object",
    properties: type.fields.map((field): PropertySchema => ({
      name: field.name,
      optional: field.optional,
      ...(field.documentation ? { description: field.documentation } : {}),
      ...(field.default !== undefined ? { default: field.default } : {}),
      schema: typeSchema(field.type),
    })),
  }
}

function typeSchema(type: SchemaType): TypeSchema {
  switch (type.kind) {
    case "string": return { kind: "string" }
    case "number": return { kind: "number" }
    case "boolean": return { kind: "boolean" }
    case "literal": return type.value === null
      ? { kind: "json" }
      : { kind: "enum", values: [type.value] }
    case "array": return { kind: "array", item: typeSchema(type.items) }
    case "async-iterable": return { kind: "array", item: typeSchema(type.items) }
    case "object": return objectSchema(type)
    case "union": {
      const values = literalValues(type)
      if (values) return { kind: "enum", values }

      if (type.anyOf.every((alternative) => alternative.kind === "object")) {
        const alternatives = type.anyOf as readonly Extract<SchemaType, { kind: "object" }>[]
        const discriminated = discriminator(alternatives)
        if (discriminated) {
          return {
            kind: "discriminatedUnion",
            discriminator: discriminated.name,
            variants: alternatives.map((alternative, index) => ({
              values: discriminated.values[index]!,
              schema: objectSchema(alternative),
            })),
          }
        }
      }

      return { kind: "json" }
    }
    case "bigint":
    case "bytes":
      return { kind: "json" }
  }
}

function requestBranches(request: SchemaType): {
  staticRequest: Extract<SchemaType, { kind: "object" }>
  streamingRequest?: Extract<SchemaType, { kind: "object" }>
} {
  const alternatives = request.kind === "union" ? request.anyOf : [request]
  const objects = alternatives.filter((alternative): alternative is Extract<SchemaType, { kind: "object" }> =>
    alternative.kind === "object")
  const staticRequest = objects.find((alternative) =>
    alternative.fields.some(({ name, type }) => name === "text" && type.kind === "string"))
  if (!staticRequest) throw new TypeError("Provider TtsRequest must contain a static string text branch")
  const streamingRequest = objects.find((alternative) =>
    alternative.fields.some(({ name, type }) => name === "text" && type.kind === "async-iterable"))
  return { staticRequest, ...(streamingRequest ? { streamingRequest } : {}) }
}

function streamingConstraints(request: Extract<SchemaType, { kind: "object" }>): Record<string, Scalar> {
  return Object.fromEntries(request.fields.flatMap((field) => {
    if (field.name === "text" || field.optional) return []
    const values = literalValues(field.type)
    return values?.length === 1 ? [[field.name, values[0]!]] : []
  }))
}

export function providerSchemasFromSpeechSpec(spec: SpeechSpec): ProviderSchema[] {
  return spec.tts.providers.map((provider) => {
    const branches = requestBranches(provider.request)
    return {
      id: provider.id,
      request: objectSchema(branches.staticRequest),
      ...(branches.streamingRequest ? {
        streamingText: { constraints: streamingConstraints(branches.streamingRequest) },
      } : {}),
    } satisfies ProviderSchema
  })
}
