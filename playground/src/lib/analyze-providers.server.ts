import type { SchemaField, SchemaType, SpeechSpec } from "../../../codegen/spec-model.ts"
import speechSpec from "../../../sdk/generated/speech-spec.json"
import type {
  ObjectSchema,
  PropertySchema,
  ProviderOperationSchema,
  ProviderSchema,
  Scalar,
  TypeSchema,
} from "./provider-schema"

function title(value: string): string {
  return value
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function scalarLiteral(type: SchemaType): Scalar | undefined {
  return type.kind === "literal" && type.value !== null ? type.value : undefined
}

function literalValues(type: SchemaType): Scalar[] | undefined {
  const alternatives = type.kind === "union" ? type.anyOf : [type]
  const values = alternatives.map(scalarLiteral)
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

function propertySchema(field: SchemaField): PropertySchema {
  return {
    name: field.name,
    optional: field.optional,
    ...(field.documentation ? { description: field.documentation } : {}),
    schema: typeSchema(field.type, field.typeScriptType),
  }
}

function objectSchema(type: Extract<SchemaType, { kind: "object" }>, label: string): ObjectSchema {
  return {
    kind: "object",
    label,
    properties: type.fields.map(propertySchema),
  }
}

function typeSchema(type: SchemaType, label: string): TypeSchema {
  switch (type.kind) {
    case "string": return { kind: "string", label }
    case "number": return { kind: "number", label }
    case "boolean": return { kind: "boolean", label }
    case "literal": return type.value === null
      ? { kind: "json", label }
      : { kind: "enum", label, values: [type.value] }
    case "array": return { kind: "array", label, item: typeSchema(type.items, "item") }
    case "async-iterable": return { kind: "array", label, item: typeSchema(type.items, "item") }
    case "object": return objectSchema(type, label)
    case "union": {
      const values = literalValues(type)
      if (values) return { kind: "enum", label, values }

      if (type.anyOf.every((alternative) => alternative.kind === "object")) {
        const alternatives = type.anyOf as readonly Extract<SchemaType, { kind: "object" }>[]
        const discriminated = discriminator(alternatives)
        if (discriminated) {
          return {
            kind: "discriminatedUnion",
            label,
            discriminator: discriminated.name,
            variants: alternatives.map((alternative, index) => ({
              values: discriminated.values[index]!,
              schema: objectSchema(alternative, label),
            })),
          }
        }
      }

      if (type.anyOf.every((alternative) => alternative.kind === "string")) return { kind: "string", label }
      if (type.anyOf.every((alternative) => alternative.kind === "number")) return { kind: "number", label }
      if (type.anyOf.every((alternative) => alternative.kind === "boolean")) return { kind: "boolean", label }
      return { kind: "json", label }
    }
    case "bigint":
    case "bytes":
      return { kind: "json", label }
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

export function analyzeProviders(): ProviderSchema[] {
  return (speechSpec as unknown as SpeechSpec).tts.providers.map((provider) => {
    const branches = requestBranches(provider.request)
    const operation = {
      id: "synthesize",
      label: "Synthesis",
      ...(provider.documentation ? { description: provider.documentation } : {}),
      request: objectSchema(branches.staticRequest, "TtsRequest"),
      ...(branches.streamingRequest ? {
        streamingText: { constraints: streamingConstraints(branches.streamingRequest) },
      } : {}),
    } satisfies ProviderOperationSchema
    return { id: provider.id, label: title(provider.id), operations: [operation] }
  })
}
